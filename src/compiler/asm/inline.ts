import {
  BYTE_REGISTERS,
  SEGMENT_REGISTERS,
  WORD_REGISTERS,
  type Instruction,
  type Operand,
  type WordRegister,
} from './types';

/** One byte of inline code. A variable reference marks its first byte:
 * the offset it stands for is that variable's, plus a displacement. */
export interface InlineByte {
  value: number;
  variable?: number;
  displacement?: number;
}

const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
const SHIFTS = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'sal', 'sar'];
const JCC = [
  'jo',
  'jno',
  'jb',
  'jae',
  'je',
  'jne',
  'jbe',
  'ja',
  'js',
  'jns',
  'jp',
  'jnp',
  'jl',
  'jge',
  'jle',
  'jg',
];
const MEMORY_BASES: WordRegister[][] = [
  ['bx', 'si'],
  ['bx', 'di'],
  ['bp', 'si'],
  ['bp', 'di'],
  ['si'],
  ['di'],
  ['bp'],
  ['bx'],
];
const SIMPLE: Record<number, string> = {
  0x90: 'nop',
  0x98: 'cbw',
  0x99: 'cwd',
  0x9c: 'pushf',
  0x9d: 'popf',
  0x9e: 'sahf',
  0x9f: 'lahf',
  0x60: 'pusha',
  0x61: 'popa',
  0xa4: 'movsb',
  0xa5: 'movsw',
  0xa6: 'cmpsb',
  0xa7: 'cmpsw',
  0xaa: 'stosb',
  0xab: 'stosw',
  0xac: 'lodsb',
  0xad: 'lodsw',
  0xae: 'scasb',
  0xaf: 'scasw',
  0xc3: 'ret',
  0xcb: 'retf',
  0xce: 'into',
  0xcf: 'iret',
  0xd7: 'xlat',
  0xf4: 'hlt',
  0xf5: 'cmc',
  0xf8: 'clc',
  0xf9: 'stc',
  0xfa: 'cli',
  0xfb: 'sti',
  0xfc: 'cld',
  0xfd: 'std',
  0x9b: 'wait',
};

/** Decode inline machine code into the instructions the machine's 8086
 * runs. Code outside that set goes to the native compiler. */
export function decodeInline(
  bytes: InlineByte[],
  line: number,
  unsupported: (reason: string) => never
): Instruction[] {
  const instructions: Instruction[] = [];
  const starts: number[] = [];
  const jumps: { instruction: Instruction; target: number }[] = [];
  let at = 0;
  const hex = (value: number) => `$${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const byte = (): number => {
    const entry = bytes[at++];
    if (!entry) return unsupported('Incomplete inline machine code');
    return entry.value & 0xff;
  };
  const signed8 = (value: number) => (value << 24) >> 24;
  const word = (): number => byte() | (byte() << 8);
  /** An address that may be a variable's, from an inline reference. */
  const reference = (size: 1 | 2): { variable?: number; displacement: number } => {
    const entry = bytes[at];
    const value = size === 1 ? signed8(byte()) : word();
    if (entry?.variable !== undefined)
      return { variable: entry.variable, displacement: entry.displacement ?? 0 };
    return { displacement: value };
  };
  const register = (index: number, wide: boolean): Operand => ({
    kind: 'register',
    register: wide ? WORD_REGISTERS[index]! : BYTE_REGISTERS[index]!,
  });
  /** The r/m operand of a ModRM byte. */
  const rm = (modrm: number, wide: boolean): Operand => {
    const mod = modrm >> 6,
      rmField = modrm & 7;
    if (mod === 3) return register(rmField, wide);
    const size = wide ? 2 : 1;
    if (mod === 0 && rmField === 6) {
      const address = reference(2);
      return {
        kind: 'memory',
        size,
        ...(address.variable !== undefined ? { variable: address.variable } : {}),
        registers: [],
        displacement: address.displacement,
      };
    }
    const bases = MEMORY_BASES[rmField]!;
    const address = mod === 0 ? { displacement: 0 } : reference(mod === 1 ? 1 : 2);
    // [bp+x] is the local variable or parameter x.
    const registers =
      address.variable !== undefined ? bases.filter((base) => base !== 'bp') : bases;
    return {
      kind: 'memory',
      size,
      ...(address.variable !== undefined ? { variable: address.variable } : {}),
      registers,
      displacement: address.displacement,
    };
  };
  const immediate = (wide: boolean): Operand => ({
    kind: 'immediate',
    value: wide ? word() : byte(),
  });

  while (at < bytes.length) {
    starts.push(at);
    let repeat: Instruction['repeat'];
    let opcode = byte();
    for (;;) {
      if ([0x26, 0x2e, 0x36, 0x3e].includes(opcode)) opcode = byte();
      else if (opcode === 0xf3 || opcode === 0xf2) {
        repeat = opcode === 0xf3 ? 'rep' : 'repne';
        opcode = byte();
      } else break;
    }
    const emit = (mnemonic: string, operands: Operand[] = []): Instruction => {
      // REP before CMPS or SCAS repeats while equal.
      const kind = repeat === 'rep' && /^(cmps|scas)/.test(mnemonic) ? 'repe' : repeat;
      const instruction: Instruction = {
        mnemonic,
        operands,
        ...(kind ? { repeat: kind } : {}),
        line,
      };
      instructions.push(instruction);
      return instruction;
    };
    const jump = (mnemonic: string, displacement: number) => {
      jumps.push({
        instruction: emit(mnemonic, [{ kind: 'label', target: 0 }]),
        target: at + displacement,
      });
    };
    const wide = (opcode & 1) === 1;
    if (opcode < 0x40 && (opcode & 7) < 4) {
      const modrm = byte();
      const toRegister = (opcode & 2) !== 0;
      const operands = [rm(modrm, wide), register((modrm >> 3) & 7, wide)];
      emit(ALU[opcode >> 3]!, toRegister ? operands.reverse() : operands);
    } else if (opcode < 0x40 && (opcode & 7) < 6) {
      emit(ALU[opcode >> 3]!, [register(0, wide), immediate(wide)]);
    } else if ([0x06, 0x0e, 0x16, 0x1e].includes(opcode)) {
      emit('push', [{ kind: 'register', register: SEGMENT_REGISTERS[opcode >> 3]! }]);
    } else if ([0x07, 0x17, 0x1f].includes(opcode)) {
      emit('pop', [{ kind: 'register', register: SEGMENT_REGISTERS[opcode >> 3]! }]);
    } else if (opcode >= 0x40 && opcode < 0x60) {
      emit(['inc', 'dec', 'push', 'pop'][(opcode - 0x40) >> 3]!, [register(opcode & 7, true)]);
    } else if (SIMPLE[opcode]) {
      emit(SIMPLE[opcode]!);
    } else if (opcode === 0x68 || opcode === 0x6a) {
      emit('push', [
        { kind: 'immediate', value: opcode === 0x68 ? word() : signed8(byte()) & 0xffff },
      ]);
    } else if (opcode === 0x69 || opcode === 0x6b) {
      const modrm = byte();
      const source = rm(modrm, true);
      emit('imul', [
        register((modrm >> 3) & 7, true),
        source,
        { kind: 'immediate', value: opcode === 0x69 ? word() : signed8(byte()) & 0xffff },
      ]);
    } else if (opcode >= 0x70 && opcode < 0x80) {
      const displacement = signed8(byte());
      jump(JCC[opcode - 0x70]!, displacement);
    } else if (opcode >= 0x80 && opcode <= 0x83) {
      const modrm = byte();
      const target = rm(modrm, opcode !== 0x80 && opcode !== 0x82);
      const value = opcode === 0x81 ? word() : opcode === 0x83 ? signed8(byte()) & 0xffff : byte();
      emit(ALU[(modrm >> 3) & 7]!, [target, { kind: 'immediate', value }]);
    } else if (opcode >= 0x84 && opcode <= 0x8b) {
      const modrm = byte();
      const operands = [rm(modrm, wide), register((modrm >> 3) & 7, wide)];
      const mnemonic = opcode < 0x86 ? 'test' : opcode < 0x88 ? 'xchg' : 'mov';
      emit(mnemonic, opcode >= 0x8a ? operands.reverse() : operands);
    } else if (opcode === 0x8c || opcode === 0x8e) {
      const modrm = byte();
      const segment: Operand = { kind: 'register', register: SEGMENT_REGISTERS[(modrm >> 3) & 3]! };
      const other = rm(modrm, true);
      emit('mov', opcode === 0x8c ? [other, segment] : [segment, other]);
    } else if (opcode === 0x8d || opcode === 0xc4 || opcode === 0xc5) {
      const modrm = byte();
      const source = rm(modrm, true);
      emit(opcode === 0x8d ? 'lea' : opcode === 0xc4 ? 'les' : 'lds', [
        register((modrm >> 3) & 7, true),
        source,
      ]);
    } else if (opcode === 0x8f) {
      emit('pop', [rm(byte(), true)]);
    } else if (opcode >= 0x91 && opcode <= 0x97) {
      emit('xchg', [register(0, true), register(opcode & 7, true)]);
    } else if (opcode >= 0xa0 && opcode <= 0xa3) {
      const address = reference(2);
      const memory: Operand = {
        kind: 'memory',
        size: wide ? 2 : 1,
        ...(address.variable !== undefined ? { variable: address.variable } : {}),
        registers: [],
        displacement: address.displacement,
      };
      emit('mov', opcode < 0xa2 ? [register(0, wide), memory] : [memory, register(0, wide)]);
    } else if (opcode === 0xa8 || opcode === 0xa9) {
      emit('test', [register(0, wide), immediate(wide)]);
    } else if (opcode >= 0xb0 && opcode < 0xc0) {
      const wideMove = opcode >= 0xb8;
      emit('mov', [register(opcode & 7, wideMove), immediate(wideMove)]);
    } else if (opcode === 0xc0 || opcode === 0xc1 || (opcode >= 0xd0 && opcode <= 0xd3)) {
      const modrm = byte();
      const target = rm(modrm, wide);
      const count: Operand[] =
        opcode < 0xd0
          ? [{ kind: 'immediate', value: byte() }]
          : opcode >= 0xd2
            ? [{ kind: 'register', register: 'cl' }]
            : [];
      emit(SHIFTS[(modrm >> 3) & 7]!, [target, ...count]);
    } else if (opcode === 0xc2 || opcode === 0xca) {
      word();
      emit(opcode === 0xc2 ? 'ret' : 'retf');
    } else if (opcode === 0xc6 || opcode === 0xc7) {
      const modrm = byte();
      const target = rm(modrm, wide);
      emit('mov', [target, immediate(wide)]);
    } else if (opcode === 0xcd) {
      emit('int', [{ kind: 'immediate', value: byte() }]);
    } else if (opcode >= 0xe0 && opcode <= 0xe3) {
      const displacement = signed8(byte());
      jump(['loopne', 'loope', 'loop', 'jcxz'][opcode - 0xe0]!, displacement);
    } else if (opcode === 0xe4 || opcode === 0xe5) {
      emit('in', [register(0, wide), { kind: 'immediate', value: byte() }]);
    } else if (opcode === 0xe6 || opcode === 0xe7) {
      emit('out', [{ kind: 'immediate', value: byte() }, register(0, wide)]);
    } else if (opcode === 0xec || opcode === 0xed) {
      emit('in', [register(0, wide), { kind: 'register', register: 'dx' }]);
    } else if (opcode === 0xee || opcode === 0xef) {
      emit('out', [{ kind: 'register', register: 'dx' }, register(0, wide)]);
    } else if (opcode === 0xe8 || opcode === 0xe9 || opcode === 0xeb) {
      const displacement = opcode === 0xeb ? signed8(byte()) : (word() << 16) >> 16;
      jump(opcode === 0xe8 ? 'call' : 'jmp', displacement);
    } else if (opcode === 0xf6 || opcode === 0xf7) {
      const modrm = byte();
      const target = rm(modrm, wide);
      const operation = (modrm >> 3) & 7;
      if (operation === 1) unsupported(`Machine code ${hex(opcode)}`);
      if (operation === 0) emit('test', [target, immediate(wide)]);
      else emit(['', '', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'][operation]!, [target]);
    } else if (opcode === 0xfe || opcode === 0xff) {
      const modrm = byte();
      const operation = (modrm >> 3) & 7;
      if (operation > 1 && !(opcode === 0xff && operation === 6))
        unsupported(`Machine code ${hex(opcode)}`);
      emit(['inc', 'dec', '', '', '', '', 'push'][operation]!, [rm(modrm, wide)]);
    } else unsupported(`Machine code ${hex(opcode)}`);
  }
  // Jumps land on instructions, or just past the last.
  for (const { instruction, target } of jumps) {
    const index = target === bytes.length ? instructions.length : starts.indexOf(target);
    if (index < 0) unsupported('A jump into the middle of an instruction');
    instruction.operands = [{ kind: 'label', target: index }];
  }
  return instructions;
}
