import { PascalError } from '../errors/PascalError';
import type { AsmBlock, Instruction, Operand, Register, WordRegister } from '../asm/types';
import { registerSize } from '../asm/types';
import { decodeBinary, encodeBinary, type BinaryCell } from './BinaryCodec';
import type { MemoryAccess } from './FileRuntime';
import type { TextConsole } from './TextConsole';
import type { GraphicsRuntime } from './GraphicsRuntime';
import { CODE_SEGMENT, DATA_SEGMENT, STACK_SEGMENT } from './AddressSpace';

/** An address the P-machine can follow: a variable's cells, a byte offset
 * into them, and the layout that turns those cells into bytes. */
export interface AsmPointer {
  base: number;
  layout: BinaryCell[] | undefined;
  offset: number;
  /** Memory by address, from a segment register: its segment's first byte,
   * which `offset` counts from. */
  linear?: number;
  /** What a pointer cell at the start of this memory points at. */
  target?: BinaryCell[] | undefined;
}
export type AsmValue = number | AsmPointer;
type StackValue = number | string | boolean | AsmPointer;

/** What the machine lends the assembler: memory, the screen and keyboard. */
export interface AsmHost extends MemoryAccess {
  output(text: string): void;
  keysAvailable(): number;
  takeKey(): string;
  peekKey(): string | undefined;
  console: TextConsole;
  /** The graphics screen, which BIOS mode 13h shows. */
  graphics?: GraphicsRuntime;
  sound(frequency: number): void;
  now(): Date;
  /** Whether the program's own interrupt procedure handles an interrupt. */
  handles(number: number): boolean;
  /** The scan code of the last key, which port 60h reads. */
  scanCode(): number;
  /** Memory by linear address, as a segment and offset reach it. */
  readLinear?(linear: number, length: number): Uint8Array;
  writeLinear?(linear: number, bytes: Uint8Array): void;
  /** The address a pointer register holding memory by address stores. */
  linearPointer?(linear: number): number;
}

/** An interrupt procedure's parameters, in order: the registers the
 * interrupt pushed. */
export const INTERRUPT_REGISTERS = [
  'flags',
  'cs',
  'ip',
  'ax',
  'bx',
  'cx',
  'dx',
  'si',
  'di',
  'ds',
  'es',
  'bp',
] as const;

export interface AsmState {
  index: number;
  registers: Record<WordRegister, AsmValue>;
  segments: Record<'es' | 'cs' | 'ss' | 'ds', number>;
  flags: number;
  stack: AsmValue[];
  calls: number[];
  /** The PC speaker's timer divisor, written a byte at a time. */
  timer: { divisor: number; low: boolean; gate: number };
  toggle: number;
}

export type AsmOutcome =
  | { kind: 'done'; result?: StackValue[] }
  | { kind: 'key' }
  | { kind: 'yield' }
  | { kind: 'delay'; milliseconds: number }
  | { kind: 'halt'; code: number }
  | { kind: 'interrupt'; number: number };

const FLAG = {
  cf: 0x1,
  pf: 0x4,
  af: 0x10,
  zf: 0x40,
  sf: 0x80,
  if: 0x200,
  df: 0x400,
  of: 0x800,
} as const;
type Flag = keyof typeof FLAG;
const isPointer = (value: AsmValue | undefined): value is AsmPointer => typeof value === 'object';
/** The conditional jumps, by the flags they test. */
const CONDITIONS: Record<string, ((f: (name: Flag) => boolean) => boolean) | undefined> = {
  jo: (f) => f('of'),
  jno: (f) => !f('of'),
  jb: (f) => f('cf'),
  jc: (f) => f('cf'),
  jnae: (f) => f('cf'),
  jae: (f) => !f('cf'),
  jnb: (f) => !f('cf'),
  jnc: (f) => !f('cf'),
  je: (f) => f('zf'),
  jz: (f) => f('zf'),
  jne: (f) => !f('zf'),
  jnz: (f) => !f('zf'),
  jbe: (f) => f('cf') || f('zf'),
  jna: (f) => f('cf') || f('zf'),
  ja: (f) => !f('cf') && !f('zf'),
  jnbe: (f) => !f('cf') && !f('zf'),
  js: (f) => f('sf'),
  jns: (f) => !f('sf'),
  jp: (f) => f('pf'),
  jpe: (f) => f('pf'),
  jnp: (f) => !f('pf'),
  jpo: (f) => !f('pf'),
  jl: (f) => f('sf') !== f('of'),
  jnge: (f) => f('sf') !== f('of'),
  jge: (f) => f('sf') === f('of'),
  jnl: (f) => f('sf') === f('of'),
  jle: (f) => f('zf') || f('sf') !== f('of'),
  jng: (f) => f('zf') || f('sf') !== f('of'),
  jg: (f) => !f('zf') && f('sf') === f('of'),
  jnle: (f) => !f('zf') && f('sf') === f('of'),
};

/** Scan codes for the keys that type characters, as BIOS reports them. */
const SCAN_CODES: Record<string, number> = {
  '\x1b': 0x01,
  '1': 0x02,
  '2': 0x03,
  '3': 0x04,
  '4': 0x05,
  '5': 0x06,
  '6': 0x07,
  '7': 0x08,
  '8': 0x09,
  '9': 0x0a,
  '0': 0x0b,
  '-': 0x0c,
  '=': 0x0d,
  '\b': 0x0e,
  '\t': 0x0f,
  q: 0x10,
  w: 0x11,
  e: 0x12,
  r: 0x13,
  t: 0x14,
  y: 0x15,
  u: 0x16,
  i: 0x17,
  o: 0x18,
  p: 0x19,
  '[': 0x1a,
  ']': 0x1b,
  '\r': 0x1c,
  a: 0x1e,
  s: 0x1f,
  d: 0x20,
  f: 0x21,
  g: 0x22,
  h: 0x23,
  j: 0x24,
  k: 0x25,
  l: 0x26,
  ';': 0x27,
  "'": 0x28,
  '`': 0x29,
  '\\': 0x2b,
  z: 0x2c,
  x: 0x2d,
  c: 0x2e,
  v: 0x2f,
  b: 0x30,
  n: 0x31,
  m: 0x32,
  ',': 0x33,
  '.': 0x34,
  '/': 0x35,
  ' ': 0x39,
};
const SHIFTED = '!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:"~|ZXCVBNM<>?';
const UNSHIFTED = "1234567890-=qwertyuiop[]asdfghjkl;'`\\zxcvbnm,./";
export function scanCode(char: string): number {
  const shifted = SHIFTED.indexOf(char);
  return SCAN_CODES[shifted >= 0 ? UNSHIFTED[shifted]! : char.toLowerCase()] ?? 0;
}

const prefixCache = new WeakMap<BinaryCell[], number[]>();
function prefixes(layout: BinaryCell[]): number[] {
  let sums = prefixCache.get(layout);
  if (!sums) {
    sums = [0];
    for (const cell of layout) sums.push(sums.at(-1)! + cell.bytes);
    prefixCache.set(layout, sums);
  }
  return sums;
}

/** Turbo Pascal's built-in assembler, run over the P-machine's variables. */
export class Asm86 {
  readonly state: AsmState;
  constructor(
    private block: AsmBlock,
    private args: number[],
    private host: AsmHost,
    state?: AsmState
  ) {
    this.state = state ?? {
      index: 0,
      registers: { ax: 0, cx: 0, dx: 0, bx: 0, sp: 0xfffe, bp: 0, si: 0, di: 0 },
      segments: { es: DATA_SEGMENT, cs: CODE_SEGMENT, ss: STACK_SEGMENT, ds: DATA_SEGMENT },
      flags: FLAG.if,
      stack: [],
      calls: [],
      timer: { divisor: 0, low: true, gate: 0 },
      toggle: 0,
    };
  }

  /** Run until the block ends, waits for a key, or has run `budget`
   * instructions. `executed` counts what ran. */
  executed = 0;
  run(budget: number): AsmOutcome {
    const instructions = this.block.instructions;
    while (this.state.index < instructions.length) {
      if (this.executed >= budget) return { kind: 'yield' };
      const instruction = instructions[this.state.index]!;
      try {
        const outcome = this.execute(instruction);
        if (outcome) return outcome;
      } catch (error) {
        if (error instanceof PascalError && error.lineNumber < 1)
          Object.assign(error, { lineNumber: instruction.line });
        throw error;
      }
      this.executed++;
    }
    return this.finish();
  }
  /** An assembler function returns AL, AX or DX:AX, as its type says. */
  private finish(): AsmOutcome {
    const result = this.block.result;
    if (!result) return { kind: 'done' };
    const ax = this.state.registers.ax;
    if (result.kind === 'pointer')
      return { kind: 'done', result: [isPointer(ax) ? this.cellAddress(ax) : ax] };
    const low = this.number(ax);
    let value =
      result.size === 1
        ? low & 0xff
        : result.size === 2
          ? low
          : ((this.number(this.state.registers.dx) << 16) | low) >>> 0;
    if (result.signed) value = result.size === 4 ? value | 0 : this.signed(value, result.size);
    if (result.kind === 'char')
      return { kind: 'done', result: [String.fromCharCode(value & 0xff)] };
    if (result.kind === 'boolean') return { kind: 'done', result: [value !== 0 ? 1 : 0] };
    return { kind: 'done', result: [value] };
  }

  // ---------- Registers, flags and memory ----------
  private number(value: AsmValue): number {
    if (isPointer(value)) throw new PascalError('An address cannot be used as a number here');
    return value;
  }
  private flag(name: Flag): boolean {
    return (this.state.flags & FLAG[name]) !== 0;
  }
  private setFlag(name: Flag, on: boolean): void {
    this.state.flags = on ? this.state.flags | FLAG[name] : this.state.flags & ~FLAG[name];
  }
  private register(register: Register): AsmValue {
    const r = this.state.registers;
    switch (register) {
      case 'al':
      case 'cl':
      case 'dl':
      case 'bl':
        return this.number(r[`${register.charAt(0)}x` as WordRegister]) & 0xff;
      case 'ah':
      case 'ch':
      case 'dh':
      case 'bh':
        return (this.number(r[`${register.charAt(0)}x` as WordRegister]) >> 8) & 0xff;
      case 'es':
      case 'cs':
      case 'ss':
      case 'ds':
        return this.state.segments[register];
      default:
        return r[register];
    }
  }
  private setRegister(register: Register, value: AsmValue): void {
    const r = this.state.registers;
    switch (register) {
      case 'al':
      case 'cl':
      case 'dl':
      case 'bl': {
        const word = `${register.charAt(0)}x` as WordRegister;
        r[word] = (this.number(r[word]) & 0xff00) | (this.number(value) & 0xff);
        return;
      }
      case 'ah':
      case 'ch':
      case 'dh':
      case 'bh': {
        const word = `${register.charAt(0)}x` as WordRegister;
        r[word] = (this.number(r[word]) & 0xff) | ((this.number(value) & 0xff) << 8);
        return;
      }
      case 'es':
      case 'cs':
      case 'ss':
      case 'ds':
        // One address space: every segment is zero.
        this.state.segments[register] = isPointer(value) ? 0 : value & 0xffff;
        return;
      default:
        r[register] = isPointer(value) ? value : value & 0xffff;
    }
  }
  private variable(index: number): AsmPointer {
    const variable = this.block.variables[index]!;
    return { base: this.args[index]!, layout: variable.layout, offset: 0, target: variable.target };
  }
  /** Where a memory operand points. */
  private address(operand: Extract<Operand, { kind: 'memory' | 'address' }>): AsmPointer {
    let pointer: AsmPointer | undefined =
      operand.variable === undefined ? undefined : this.variable(operand.variable);
    let offset = operand.displacement;
    if (operand.kind === 'memory')
      for (const register of operand.registers) {
        const value = this.register(register);
        if (isPointer(value)) {
          if (pointer) throw new PascalError('Invalid address combination');
          pointer = value;
        } else offset += value;
      }
    if (!pointer) return this.absolute(operand.kind === 'memory' ? operand.segment ?? (operand.registers.includes('bp') ? 'ss' : 'ds') : 'ds', offset);
    return { ...pointer, offset: pointer.offset + offset };
  }
  /** Memory at a segment register and an offset, as the 8086 addresses it. */
  private absolute(segment: 'es' | 'cs' | 'ss' | 'ds', offset: number): AsmPointer {
    return { base: 0, layout: undefined, offset: offset & 0xffff, linear: this.state.segments[segment] * 16 };
  }
  /** Where a register points: at a variable, or at memory by address. */
  private pointerIn(register: WordRegister, segment: 'es' | 'ds'): AsmPointer {
    const value = this.register(register);
    return isPointer(value) ? value : this.absolute(segment, value);
  }
  private readAbsolute(pointer: AsmPointer, size: number): number {
    const bytes = this.linearHost().readLinear!(((pointer.linear ?? 0) + pointer.offset) % 0x100000, size);
    let value = 0;
    for (let i = size - 1; i >= 0; i--) value = value * 256 + (bytes[i] ?? 0);
    return value;
  }
  private linearHost(): AsmHost {
    if (!this.host.readLinear || !this.host.writeLinear) throw new PascalError('Absolute memory addresses are not supported');
    return this.host;
  }
  /** The cells covering `size` bytes at a pointer. */
  private span(
    pointer: AsmPointer,
    size: number
  ): { first: number; last: number; start: number; sums: number[]; layout: BinaryCell[] } {
    const layout = pointer.layout;
    if (!layout) throw new PascalError('The type this address points at is not known');
    const sums = prefixes(layout);
    if (pointer.offset < 0 || pointer.offset + size > sums.at(-1)!)
      throw new PascalError('Memory access outside the variable');
    let first = 0;
    while (sums[first + 1]! <= pointer.offset) first++;
    let last = first;
    while (sums[last + 1]! < pointer.offset + size) last++;
    return { first, last, start: sums[first]!, sums, layout };
  }
  private read(pointer: AsmPointer, size: number): AsmValue {
    if (pointer.linear !== undefined) return this.readAbsolute(pointer, size);
    const { first, last, start, layout } = this.span(pointer, size);
    const cell = layout[first]!;
    // A pointer cell reads as an address the assembler can follow, with
    // segment zero.
    if (cell.kind === 'pointer' && first === last) {
      const within = pointer.offset - start;
      if (within >= 2) return 0;
      const target = Number(this.host.read(pointer.base + (cell.offset ?? first)) ?? 0);
      return target ? { base: target, layout: pointer.target, offset: 0 } : 0;
    }
    const bytes = encodeBinary(this.host, this.cellsBase(pointer, first), layout.slice(first, last + 1));
    let value = 0;
    for (let i = size - 1; i >= 0; i--)
      value = value * 256 + (bytes[pointer.offset - start + i] ?? 0);
    return value;
  }
  private write(pointer: AsmPointer, size: number, value: AsmValue): void {
    if (pointer.linear !== undefined) {
      const bytes = new Uint8Array(size);
      let number = isPointer(value) ? this.cellAddress(value) : value;
      for (let i = 0; i < size; i++) {
        bytes[i] = number & 0xff;
        number = Math.floor(number / 256);
      }
      this.linearHost().writeLinear!(((pointer.linear ?? 0) + pointer.offset) % 0x100000, bytes);
      return;
    }
    const { first, last, start, layout } = this.span(pointer, size);
    const cell = layout[first]!;
    if (cell.kind === 'pointer' && first === last) {
      const within = pointer.offset - start;
      if (within >= 2) return;
      this.host.write(pointer.base + (cell.offset ?? first), isPointer(value) ? this.cellAddress(value) : value);
      return;
    }
    const cells = layout.slice(first, last + 1);
    const bytes = encodeBinary(this.host, this.cellsBase(pointer, first), cells);
    let number = this.number(value);
    for (let i = 0; i < size; i++) {
      bytes[pointer.offset - start + i] = number & 0xff;
      number = Math.floor(number / 256);
    }
    decodeBinary(this.host, this.cellsBase(pointer, first), cells, bytes);
  }
  /** Where a slice of a layout starting at `first` is encoded from: cells
   * with offsets of their own count from the variable's start. */
  private cellsBase(pointer: AsmPointer, first: number): number {
    return pointer.layout?.[first]?.offset === undefined ? pointer.base + first : pointer.base;
  }
  /** A pointer as the P-machine stores it: the address of a cell. */
  private cellAddress(pointer: AsmPointer): number {
    if (pointer.linear !== undefined)
      return this.host.linearPointer?.(((pointer.linear) + pointer.offset) % 0x100000) ?? 0;
    if (!pointer.layout) return pointer.base;
    const sums = prefixes(pointer.layout);
    const index = sums.indexOf(pointer.offset);
    if (index < 0)
      throw new PascalError('An address inside a variable cannot be stored in a pointer');
    return pointer.base + (pointer.layout[index]?.offset ?? index);
  }
  private size(instruction: Instruction, at = 0): 1 | 2 | 4 {
    for (const operand of instruction.operands.slice(at)) {
      if (operand.kind === 'register') return registerSize(operand.register);
      if (operand.kind === 'memory' && operand.size) return operand.size;
    }
    throw new PascalError('Operand size unknown');
  }
  private get(operand: Operand, size: number): AsmValue {
    switch (operand.kind) {
      case 'register':
        return this.register(operand.register);
      case 'immediate':
        return size === 1 ? operand.value & 0xff : operand.value & 0xffff;
      case 'address':
        return this.address(operand);
      case 'memory':
        return this.read(this.address(operand), size);
      case 'label':
        throw new PascalError('Invalid operand');
    }
  }
  private set(operand: Operand, size: number, value: AsmValue): void {
    if (operand.kind === 'register') this.setRegister(operand.register, value);
    else if (operand.kind === 'memory') this.write(this.address(operand), size, value);
    else throw new PascalError('Invalid destination operand');
  }

  // ---------- Arithmetic ----------
  private logic(result: number, size: number): number {
    const mask = size === 1 ? 0xff : 0xffff;
    result &= mask;
    this.setFlag('cf', false);
    this.setFlag('of', false);
    this.results(result, size);
    return result;
  }
  private results(result: number, size: number): void {
    const bits = size * 8;
    this.setFlag('zf', result === 0);
    this.setFlag('sf', ((result >> (bits - 1)) & 1) === 1);
    let parity = result & 0xff;
    parity ^= parity >> 4;
    parity ^= parity >> 2;
    parity ^= parity >> 1;
    this.setFlag('pf', (parity & 1) === 0);
  }
  private add(a: number, b: number, carry: number, size: number, keepCarry = false): number {
    const bits = size * 8,
      mask = size === 1 ? 0xff : 0xffff,
      sign = 1 << (bits - 1);
    const raw = a + b + carry,
      result = raw & mask;
    if (!keepCarry) this.setFlag('cf', raw > mask);
    this.setFlag('of', ((a ^ result) & (b ^ result) & sign) !== 0);
    this.setFlag('af', ((a ^ b ^ result) & 0x10) !== 0);
    this.results(result, size);
    return result;
  }
  private subtract(a: number, b: number, borrow: number, size: number, keepCarry = false): number {
    const bits = size * 8,
      mask = size === 1 ? 0xff : 0xffff,
      sign = 1 << (bits - 1);
    const raw = a - b - borrow,
      result = raw & mask;
    if (!keepCarry) this.setFlag('cf', raw < 0);
    this.setFlag('of', ((a ^ b) & (a ^ result) & sign) !== 0);
    this.setFlag('af', ((a ^ b ^ result) & 0x10) !== 0);
    this.results(result, size);
    return result;
  }
  private signed(value: number, size: number): number {
    const bits = size * 8;
    return (value << (32 - bits)) >> (32 - bits);
  }
  /** ADD, SUB, INC and DEC move an address along its variable. */
  private pointerArithmetic(mnemonic: string, a: AsmValue, b: AsmValue): AsmValue | undefined {
    if (!isPointer(a) && !isPointer(b)) return undefined;
    if (mnemonic === 'add' && isPointer(a) && !isPointer(b))
      return { ...a, offset: a.offset + this.signed(b, 2) };
    if (mnemonic === 'add' && isPointer(b) && !isPointer(a))
      return { ...b, offset: b.offset + this.signed(a, 2) };
    if (mnemonic === 'sub' && isPointer(a) && !isPointer(b))
      return { ...a, offset: a.offset - this.signed(b, 2) };
    if (
      (mnemonic === 'sub' || mnemonic === 'cmp') &&
      isPointer(a) &&
      isPointer(b) &&
      a.base === b.base
    )
      return this.subtract(a.offset & 0xffff, b.offset & 0xffff, 0, 2);
    if (mnemonic === 'cmp' && isPointer(a) !== isPointer(b)) {
      // Against nil (0), an address is simply not nil.
      if ((isPointer(a) ? b : a) !== 0)
        throw new PascalError('An address cannot be compared with a number');
      this.state.flags &= ~(FLAG.zf | FLAG.cf | FLAG.sf | FLAG.of);
      return isPointer(a) ? a : b;
    }
    if (
      (mnemonic === 'or' || mnemonic === 'xor' || mnemonic === 'test' || mnemonic === 'and') &&
      (isPointer(a) ? b : a) === 0 &&
      mnemonic !== 'and'
    ) {
      this.state.flags &= ~(FLAG.zf | FLAG.cf | FLAG.sf | FLAG.of);
      return isPointer(a) ? a : b;
    }
    throw new PascalError('Invalid arithmetic on an address');
  }

  private jump(operand: Operand | undefined): void {
    if (operand?.kind !== 'label')
      throw new PascalError('Only labels in this block can be jumped to');
    this.state.index = operand.target;
  }
  private condition(mnemonic: string): boolean | undefined {
    const test = CONDITIONS[mnemonic];
    if (!test) return undefined;
    const flags = this.state.flags;
    return test((name) => (flags & FLAG[name]) !== 0);
  }

  /** One instruction. Returns an outcome when the block must stop. */
  private execute(instruction: Instruction): AsmOutcome | undefined {
    const { mnemonic, operands } = instruction;
    const [a, b, c] = operands;
    const r = this.state.registers;
    this.state.index++;
    const taken = this.condition(mnemonic);
    if (taken !== undefined) {
      if (taken) this.jump(a);
      return undefined;
    }
    switch (mnemonic) {
      case 'nop':
      case 'wait':
      case 'hlt':
      case 'lock':
        return undefined;
      case 'mov': {
        const size = this.size(instruction);
        this.set(a!, size, this.get(b!, size));
        return undefined;
      }
      case 'xchg': {
        const size = this.size(instruction);
        const first = this.get(a!, size),
          second = this.get(b!, size);
        this.set(a!, size, second);
        this.set(b!, size, first);
        return undefined;
      }
      case 'lea':
        if (b?.kind !== 'memory') throw new PascalError('Memory operand expected');
        this.set(a!, 2, this.address(b));
        return undefined;
      case 'les':
      case 'lds': {
        if (b?.kind !== 'memory') throw new PascalError('Memory operand expected');
        const pointer = this.address(b);
        this.set(a!, 2, this.read(pointer, 2));
        this.setRegister(mnemonic === 'les' ? 'es' : 'ds', 0);
        return undefined;
      }
      case 'add':
      case 'adc':
      case 'sub':
      case 'sbb':
      case 'cmp': {
        const size = this.size(instruction);
        const x = this.get(a!, size),
          y = this.get(b!, size);
        const moved = this.pointerArithmetic(mnemonic, x, y);
        if (moved !== undefined) {
          if (mnemonic !== 'cmp') this.set(a!, size, moved);
          return undefined;
        }
        const carry = (mnemonic === 'adc' || mnemonic === 'sbb') && this.flag('cf') ? 1 : 0;
        const result =
          mnemonic === 'add' || mnemonic === 'adc'
            ? this.add(this.number(x), this.number(y), carry, size)
            : this.subtract(this.number(x), this.number(y), carry, size);
        if (mnemonic !== 'cmp') this.set(a!, size, result);
        return undefined;
      }
      case 'inc':
      case 'dec': {
        const size = this.size(instruction);
        const value = this.get(a!, size);
        if (isPointer(value)) {
          this.set(a!, size, { ...value, offset: value.offset + (mnemonic === 'inc' ? 1 : -1) });
          return undefined;
        }
        this.set(
          a!,
          size,
          mnemonic === 'inc'
            ? this.add(value, 1, 0, size, true)
            : this.subtract(value, 1, 0, size, true)
        );
        return undefined;
      }
      case 'neg': {
        const size = this.size(instruction);
        const value = this.number(this.get(a!, size));
        this.set(a!, size, this.subtract(0, value, 0, size));
        this.setFlag('cf', value !== 0);
        return undefined;
      }
      case 'not': {
        const size = this.size(instruction);
        this.set(a!, size, ~this.number(this.get(a!, size)) & (size === 1 ? 0xff : 0xffff));
        return undefined;
      }
      case 'and':
      case 'or':
      case 'xor':
      case 'test': {
        const size = this.size(instruction);
        const x = this.get(a!, size),
          y = this.get(b!, size);
        const kept = this.pointerArithmetic(mnemonic, x, y);
        if (kept !== undefined) {
          if (mnemonic !== 'test') this.set(a!, size, kept);
          return undefined;
        }
        const p = this.number(x),
          q = this.number(y);
        const result = this.logic(
          mnemonic === 'or' ? p | q : mnemonic === 'xor' ? p ^ q : p & q,
          size
        );
        if (mnemonic !== 'test') this.set(a!, size, result);
        return undefined;
      }
      case 'shl':
      case 'sal':
      case 'shr':
      case 'sar':
      case 'rol':
      case 'ror':
      case 'rcl':
      case 'rcr': {
        const size = this.size(instruction);
        const bits = size * 8,
          mask = size === 1 ? 0xff : 0xffff;
        const count = (b ? this.number(this.get(b, 1)) : 1) & 0x1f;
        let value = this.number(this.get(a!, size));
        if (count === 0) return undefined;
        let carry = this.flag('cf');
        for (let i = 0; i < count; i++) {
          const high = ((value >> (bits - 1)) & 1) === 1,
            low = (value & 1) === 1;
          switch (mnemonic) {
            case 'shl':
            case 'sal':
              carry = high;
              value = (value << 1) & mask;
              break;
            case 'shr':
              carry = low;
              value >>>= 1;
              break;
            case 'sar':
              carry = low;
              value = (value >> 1) | (high ? 1 << (bits - 1) : 0);
              break;
            case 'rol':
              carry = high;
              value = ((value << 1) | (high ? 1 : 0)) & mask;
              break;
            case 'ror':
              carry = low;
              value = (value >>> 1) | (low ? 1 << (bits - 1) : 0);
              break;
            case 'rcl':
              value = ((value << 1) | (carry ? 1 : 0)) & mask;
              carry = high;
              break;
            case 'rcr':
              value = (value >>> 1) | (carry ? 1 << (bits - 1) : 0);
              carry = low;
              break;
          }
        }
        this.set(a!, size, value);
        this.setFlag('cf', carry);
        const top = ((value >> (bits - 1)) & 1) === 1;
        if (['shl', 'sal', 'rol', 'rcl'].includes(mnemonic)) this.setFlag('of', top !== carry);
        else if (mnemonic === 'sar') this.setFlag('of', false);
        else this.setFlag('of', top !== (((value >> (bits - 2)) & 1) === 1));
        if (['shl', 'sal', 'shr', 'sar'].includes(mnemonic)) this.results(value, size);
        return undefined;
      }
      case 'mul':
      case 'imul': {
        if (mnemonic === 'imul' && b) {
          // The 286's IMUL reg, r/m, immediate.
          const size = 2;
          const product =
            this.signed(this.number(this.get(c ? b : a!, size)), 2) *
            this.signed(this.number(this.get(c ?? b, size)), 2);
          this.set(a!, size, product & 0xffff);
          const overflow = product !== this.signed(product & 0xffff, 2);
          this.setFlag('cf', overflow);
          this.setFlag('of', overflow);
          return undefined;
        }
        const size = this.size(instruction);
        const source = this.number(this.get(a!, size));
        if (size === 1) {
          const al = this.number(this.register('al'));
          const product =
            mnemonic === 'mul' ? al * source : this.signed(al, 1) * this.signed(source, 1);
          r.ax = product & 0xffff;
          const overflow =
            mnemonic === 'mul' ? product > 0xff : product !== this.signed(product & 0xff, 1);
          this.setFlag('cf', overflow);
          this.setFlag('of', overflow);
        } else {
          const ax = this.number(r.ax);
          const product =
            mnemonic === 'mul' ? ax * source : this.signed(ax, 2) * this.signed(source, 2);
          r.ax = product & 0xffff;
          r.dx = Math.floor(product / 65536) & 0xffff;
          const overflow =
            mnemonic === 'mul' ? product > 0xffff : product !== this.signed(product & 0xffff, 2);
          this.setFlag('cf', overflow);
          this.setFlag('of', overflow);
        }
        return undefined;
      }
      case 'div':
      case 'idiv': {
        const size = this.size(instruction);
        const divisor = this.number(this.get(a!, size));
        const signedDivision = mnemonic === 'idiv';
        const d = signedDivision ? this.signed(divisor, size) : divisor;
        if (d === 0) throw new PascalError('Division by zero');
        const dividend =
          size === 1
            ? signedDivision
              ? this.signed(this.number(r.ax), 2)
              : this.number(r.ax)
            : signedDivision
              ? (this.number(r.dx) << 16) | this.number(r.ax)
              : this.number(r.dx) * 65536 + this.number(r.ax);
        const quotient = Math.trunc(dividend / d),
          remainder = dividend - quotient * d;
        const limit =
          size === 1
            ? signedDivision
              ? [-128, 127]
              : [0, 255]
            : signedDivision
              ? [-32768, 32767]
              : [0, 65535];
        if (quotient < limit[0]! || quotient > limit[1]!) throw new PascalError('Division by zero');
        if (size === 1) r.ax = ((remainder & 0xff) << 8) | (quotient & 0xff);
        else {
          r.ax = quotient & 0xffff;
          r.dx = remainder & 0xffff;
        }
        return undefined;
      }
      case 'cbw':
        r.ax = this.signed(this.number(r.ax) & 0xff, 1) & 0xffff;
        return undefined;
      case 'cwd':
        r.dx = this.number(r.ax) & 0x8000 ? 0xffff : 0;
        return undefined;
      case 'push': {
        const value = a!.kind === 'immediate' ? a!.value & 0xffff : this.get(a!, 2);
        this.state.stack.push(value);
        return undefined;
      }
      case 'pop': {
        if (!this.state.stack.length) throw new PascalError('Stack underflow in assembler');
        this.set(a!, 2, this.state.stack.pop()!);
        return undefined;
      }
      case 'pushf':
        this.state.stack.push(this.state.flags);
        return undefined;
      case 'popf':
        this.state.flags = this.number(this.state.stack.pop() ?? 0);
        return undefined;
      case 'pusha':
        this.state.stack.push(r.ax, r.cx, r.dx, r.bx, r.sp, r.bp, r.si, r.di);
        return undefined;
      case 'popa': {
        const values = this.state.stack.splice(-8);
        if (values.length < 8) throw new PascalError('Stack underflow in assembler');
        [r.ax, r.cx, r.dx, r.bx, , r.bp, r.si, r.di] = values as [
          AsmValue,
          AsmValue,
          AsmValue,
          AsmValue,
          AsmValue,
          AsmValue,
          AsmValue,
          AsmValue,
        ];
        return undefined;
      }
      case 'lahf':
        this.setRegister('ah', this.state.flags & 0xff);
        return undefined;
      case 'sahf':
        this.state.flags = (this.state.flags & 0xff00) | this.number(this.register('ah'));
        return undefined;
      case 'clc':
        this.setFlag('cf', false);
        return undefined;
      case 'stc':
        this.setFlag('cf', true);
        return undefined;
      case 'cmc':
        this.setFlag('cf', !this.flag('cf'));
        return undefined;
      case 'cld':
        this.setFlag('df', false);
        return undefined;
      case 'std':
        this.setFlag('df', true);
        return undefined;
      case 'cli':
        this.setFlag('if', false);
        return undefined;
      case 'sti':
        this.setFlag('if', true);
        return undefined;
      case 'jmp':
        this.jump(a);
        return undefined;
      case 'jcxz':
        if (this.number(r.cx) === 0) this.jump(a);
        return undefined;
      case 'loop':
      case 'loope':
      case 'loopz':
      case 'loopne':
      case 'loopnz': {
        r.cx = (this.number(r.cx) - 1) & 0xffff;
        const more =
          r.cx !== 0 &&
          (mnemonic === 'loop' ||
            (mnemonic === 'loope' || mnemonic === 'loopz') === this.flag('zf'));
        if (more) this.jump(a);
        return undefined;
      }
      case 'call':
        this.state.calls.push(this.state.index);
        this.jump(a);
        return undefined;
      case 'ret':
      case 'retf':
      case 'iret':
        if (!this.state.calls.length) {
          this.state.index = this.block.instructions.length;
          return undefined;
        }
        this.state.index = this.state.calls.pop()!;
        return undefined;
      case 'xlat':
      case 'xlatb': {
        const table = this.pointerIn('bx', 'ds');
        this.setRegister(
          'al',
          this.read({ ...table, offset: table.offset + this.number(this.register('al')) }, 1)
        );
        return undefined;
      }
      case 'in':
        this.setRegister(
          a!.kind === 'register' ? a!.register : 'al',
          this.port(this.number(this.get(b!, 2)))
        );
        return undefined;
      case 'out':
        this.out(this.number(this.get(a!, 2)), this.number(this.get(b!, 1)));
        return undefined;
      case 'int':
        return this.interrupt(
          a?.kind === 'immediate' ? a.value & 0xff : this.number(this.get(a!, 1))
        );
      case 'into':
        return this.flag('of') ? this.interrupt(4) : undefined;
      case 'movsb':
      case 'movsw':
      case 'stosb':
      case 'stosw':
      case 'lodsb':
      case 'lodsw':
      case 'scasb':
      case 'scasw':
      case 'cmpsb':
      case 'cmpsw':
        this.stringInstruction(instruction);
        return undefined;
    }
    throw new PascalError(`Unsupported instruction: ${mnemonic.toUpperCase()}`);
  }

  private stringInstruction(instruction: Instruction): void {
    const r = this.state.registers;
    const size = instruction.mnemonic.endsWith('b') ? 1 : 2;
    const kind = instruction.mnemonic.slice(0, 4);
    const step = this.flag('df') ? -size : size;
    const move = (register: 'si' | 'di') => {
      const value = r[register];
      r[register] = isPointer(value)
        ? { ...value, offset: value.offset + step }
        : (value + step) & 0xffff;
    };
    // SI in DS, or the segment the instruction names; DI always in ES.
    const at = (register: 'si' | 'di'): AsmPointer =>
      this.pointerIn(register, register === 'di' ? 'es' : 'ds');
    const once = (): boolean => {
      switch (kind) {
        case 'movs':
          this.write(at('di'), size, this.read(at('si'), size));
          move('si');
          move('di');
          return true;
        case 'stos':
          this.write(at('di'), size, this.register(size === 1 ? 'al' : 'ax'));
          move('di');
          return true;
        case 'lods':
          this.setRegister(size === 1 ? 'al' : 'ax', this.read(at('si'), size));
          move('si');
          return true;
        case 'scas':
          this.subtract(
            this.number(this.register(size === 1 ? 'al' : 'ax')),
            this.number(this.read(at('di'), size)),
            0,
            size
          );
          move('di');
          return true;
        default:
          this.subtract(
            this.number(this.read(at('si'), size)),
            this.number(this.read(at('di'), size)),
            0,
            size
          );
          move('si');
          move('di');
          return true;
      }
    };
    if (!instruction.repeat) {
      once();
      return undefined;
    }
    while (this.number(r.cx) !== 0) {
      once();
      r.cx = (this.number(r.cx) - 1) & 0xffff;
      this.executed++;
      if ((kind === 'scas' || kind === 'cmps') && instruction.repeat === 'repe' && !this.flag('zf'))
        break;
      if ((kind === 'scas' || kind === 'cmps') && instruction.repeat === 'repne' && this.flag('zf'))
        break;
    }
    return undefined;
  }

  // ---------- Ports ----------
  private port(port: number): number {
    // The VGA status register: retrace comes and goes, so waits end.
    if (port === 0x3da) return (this.state.toggle ^= 0x09);
    if (port === 0x61) return this.state.timer.gate;
    if (port === 0x60) return this.host.scanCode();
    return 0xff;
  }
  /** The PC speaker: the timer's channel 2 sets the pitch, port 61h turns
   * it on. */
  private out(port: number, value: number): void {
    const timer = this.state.timer;
    if (port === 0x43) timer.low = true;
    else if (port === 0x42) {
      timer.divisor = timer.low
        ? (timer.divisor & 0xff00) | value
        : (timer.divisor & 0xff) | (value << 8);
      timer.low = !timer.low;
    } else if (port === 0x61) {
      timer.gate = value;
      this.host.sound((value & 3) === 3 && timer.divisor ? Math.round(1193180 / timer.divisor) : 0);
    }
  }

  // ---------- Interrupts ----------
  private key(): { char: string; scan: number } {
    const char = this.host.takeKey();
    if (char === '\0') return { char: '\0', scan: this.host.takeKey().charCodeAt(0) };
    return { char, scan: scanCode(char) };
  }
  private needKeys(count = 2): AsmOutcome | undefined {
    const next = this.host.peekKey();
    if (next === undefined || (next === '\0' && this.host.keysAvailable() < count)) {
      this.state.index--;
      return { kind: 'key' };
    }
    return undefined;
  }
  /** A text string at DS:DX ending in '$'. */
  private dollarString(): string {
    const start = this.pointerIn('dx', 'ds');
    let text = '';
    for (let offset = start.offset; ; offset++) {
      const byte = this.number(this.read({ ...start, offset }, 1));
      if (byte === 0x24) return text;
      text += String.fromCharCode(byte);
    }
  }
  private unsupported(number: number, service: number): never {
    const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, '0');
    throw new PascalError(`Interrupt ${hex(number)}h function ${hex(service)}h is not supported`);
  }
  /** The registers an interrupt procedure receives, as numbers. */
  registerValues(): number[] {
    const value = (name: (typeof INTERRUPT_REGISTERS)[number]): number => {
      if (name === 'flags') return this.state.flags;
      if (name === 'cs' || name === 'ip') return 0;
      if (name === 'ds' || name === 'es') return this.state.segments[name];
      const register = this.state.registers[name];
      return isPointer(register) ? 0 : register;
    };
    return INTERRUPT_REGISTERS.map(value);
  }
  /** Take back what an interrupt procedure left in its register
   * parameters, where it changed them. */
  restoreRegisters(before: number[], after: number[]): void {
    INTERRUPT_REGISTERS.forEach((name, index) => {
      const value = after[index];
      if (value === undefined || value === before[index] || name === 'cs' || name === 'ip') return;
      if (name === 'flags') this.state.flags = value & 0xffff;
      else this.setRegister(name, value & 0xffff);
    });
  }
  private interrupt(number: number): AsmOutcome | undefined {
    if (this.host.handles(number)) return { kind: 'interrupt', number };
    const r = this.state.registers;
    const ah = this.number(this.register('ah')),
      al = this.number(this.register('al'));
    const screen = this.host.console;
    const date = this.host.now();
    switch (number) {
      case 0x10:
        switch (ah) {
          case 0x00:
            // Mode 13h: 320 by 200 dots of 256 colors.
            if ((al & 0x7f) === 0x13 && this.host.graphics) {
              this.host.graphics.vgaMode();
              return undefined;
            }
            if (![0, 1, 2, 3, 7].includes(al & 0x7f)) this.unsupported(number, ah);
            this.host.graphics?.textMode();
            screen.mode(al & 0x7f);
            return undefined;
          case 0x01:
            screen.cursorVisible = (this.number(this.register('ch')) & 0x20) === 0;
            screen.touch();
            return undefined;
          case 0x02: {
            const [x, y] = [this.number(this.register('dl')), this.number(this.register('dh'))];
            screen.goto(x + 1 - (screen.windMin & 0xff), y + 1 - (screen.windMin >> 8));
            return undefined;
          }
          case 0x03: {
            const cursor = screen.getCursor();
            this.setRegister('dl', cursor.x);
            this.setRegister('dh', cursor.y);
            r.cx = 0x0607;
            return undefined;
          }
          case 0x08: {
            const cursor = screen.getCursor(),
              index = cursor.y * screen.cols + cursor.x;
            this.setRegister('al', (screen.chars[index] ?? ' ').charCodeAt(0));
            this.setRegister('ah', screen.attributes[index] ?? 7);
            return undefined;
          }
          case 0x09:
          case 0x0a: {
            const cursor = screen.getCursor();
            const count = this.number(r.cx);
            for (let i = 0; i < count; i++) {
              const index = cursor.y * screen.cols + cursor.x + i;
              if (index >= screen.chars.length) break;
              screen.chars[index] = String.fromCharCode(al);
              if (ah === 0x09) screen.attributes[index] = this.number(this.register('bl'));
            }
            screen.touch();
            return undefined;
          }
          case 0x0e:
            this.host.output(String.fromCharCode(al));
            return undefined;
          // A dot of mode 13h's screen: written from AL, or read into it.
          case 0x0c:
          case 0x0d: {
            const graphics = this.host.graphics;
            if (!graphics?.dac) this.unsupported(number, ah);
            const x = this.number(r.cx), y = this.number(r.dx);
            if (x < graphics.width && y < graphics.height) {
              if (ah === 0x0c) {
                graphics.pixels[y * graphics.width + x] = al;
                graphics.revision++;
              } else this.setRegister('al', graphics.pixels[y * graphics.width + x] ?? 0);
            }
            return undefined;
          }
          case 0x0f:
            this.setRegister('al', screen.lastMode & 0xff);
            this.setRegister('ah', screen.cols);
            this.setRegister('bh', 0);
            return undefined;
          case 0x10:
          case 0x11:
          case 0x12:
            return undefined;
        }
        return this.unsupported(number, ah);
      case 0x16:
        switch (ah) {
          case 0x00:
          case 0x10: {
            const wait = this.needKeys();
            if (wait) return wait;
            const { char, scan } = this.key();
            this.setRegister('al', char.charCodeAt(0));
            this.setRegister('ah', scan);
            return undefined;
          }
          case 0x01:
          case 0x11: {
            const next = this.host.peekKey();
            this.setFlag('zf', next === undefined);
            if (next !== undefined) {
              this.setRegister('al', next.charCodeAt(0));
              this.setRegister('ah', next === '\0' ? 0 : scanCode(next));
            }
            return undefined;
          }
          case 0x02:
          case 0x12:
            r.ax = this.number(r.ax) & 0xff00;
            return undefined;
        }
        return this.unsupported(number, ah);
      case 0x21:
        switch (ah) {
          case 0x00:
            return { kind: 'halt', code: 0 };
          case 0x01:
          case 0x07:
          case 0x08: {
            const wait = this.needKeys(1);
            if (wait) return wait;
            const char = this.host.takeKey();
            this.setRegister('al', char.charCodeAt(0));
            if (ah === 0x01 && char !== '\0') this.host.output(char === '\r' ? '\r' : char);
            return undefined;
          }
          case 0x02:
            this.host.output(String.fromCharCode(this.number(this.register('dl'))));
            return undefined;
          case 0x06: {
            const dl = this.number(this.register('dl'));
            if (dl !== 0xff) {
              this.host.output(String.fromCharCode(dl));
              return undefined;
            }
            const next = this.host.peekKey();
            this.setFlag('zf', next === undefined);
            this.setRegister('al', next === undefined ? 0 : this.host.takeKey().charCodeAt(0));
            return undefined;
          }
          case 0x09:
            this.host.output(this.dollarString());
            return undefined;
          case 0x0b:
            this.setRegister('al', this.host.peekKey() === undefined ? 0 : 0xff);
            return undefined;
          case 0x19:
            this.setRegister('al', 2);
            return undefined;
          case 0x2a:
            r.cx = date.getFullYear();
            this.setRegister('dh', date.getMonth() + 1);
            this.setRegister('dl', date.getDate());
            this.setRegister('al', date.getDay());
            return undefined;
          case 0x2c:
            this.setRegister('ch', date.getHours());
            this.setRegister('cl', date.getMinutes());
            this.setRegister('dh', date.getSeconds());
            this.setRegister('dl', Math.floor(date.getMilliseconds() / 10));
            return undefined;
          case 0x30:
            r.ax = 0x1606;
            r.bx = 0;
            r.cx = 0;
            return undefined;
          case 0x4c:
            return { kind: 'halt', code: al };
        }
        return this.unsupported(number, ah);
      case 0x1a:
        if (ah !== 0) return this.unsupported(number, ah);
        {
          const midnight = new Date(date);
          midnight.setHours(0, 0, 0, 0);
          const ticks = Math.floor(((date.getTime() - midnight.getTime()) / 1000) * 18.2065);
          r.cx = (ticks >>> 16) & 0xffff;
          r.dx = ticks & 0xffff;
          this.setRegister('al', 0);
        }
        return undefined;
      case 0x15:
        if (ah !== 0x86) return this.unsupported(number, ah);
        this.setFlag('cf', false);
        return {
          kind: 'delay',
          milliseconds: Math.round((this.number(r.cx) * 65536 + this.number(r.dx)) / 1000),
        };
      case 0x33:
        // No mouse driver is installed.
        r.ax = 0;
        r.bx = 0;
        return undefined;
      case 0x12:
        r.ax = 640;
        return undefined;
    }
    return this.unsupported(number, ah);
  }
}
