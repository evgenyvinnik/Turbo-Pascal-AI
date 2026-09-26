import { PascalError } from '../errors/PascalError';
import type { AsmExpression, RawInstruction, RawOperand } from './parse';
import {
  registerSize,
  SEGMENT_REGISTERS,
  type AsmBlock,
  type AsmVariable,
  type Instruction,
  type Operand,
  type SegmentRegister,
  type WordRegister,
} from './types';

/** What a name in an operand means. A variable is identified by `key`, so
 * each is passed to the block once. */
export type AsmName =
  | { kind: 'constant'; value: number }
  | { kind: 'variable'; key: unknown; variable: AsmVariable; displacement: number; size?: number }
  | { kind: 'type'; size: number; offset: number };

export interface AsmContext {
  resolve(path: string[], line: number): AsmName | undefined;
  /** Assembly the P-machine does not run: the native compiler takes it. */
  unsupported(reason: string): never;
  /** {$G+}: 80286 opcodes are enabled. They are unless this is false. */
  instructions286?: boolean;
}

/** Instructions and forms the 80286 added to the 8086's: an immediate
 * PUSH, IMUL with an immediate, and a shift or rotate by a count other than
 * one, as well as these mnemonics. */
const OPCODES_286 = new Set([
  'pusha',
  'popa',
  'enter',
  'leave',
  'bound',
  'ins',
  'insb',
  'insw',
  'outs',
  'outsb',
  'outsw',
]);
const SHIFTS = new Set(['shl', 'sal', 'shr', 'sar', 'rol', 'ror', 'rcl', 'rcr']);
function needs286(mnemonic: string, operands: Operand[]): boolean {
  if (OPCODES_286.has(mnemonic)) return true;
  if (mnemonic === 'push') return operands[0]?.kind === 'immediate';
  if (mnemonic === 'imul') return operands.length > 1;
  if (SHIFTS.has(mnemonic)) {
    const count = operands[1];
    return count?.kind === 'immediate' && count.value !== 1;
  }
  return false;
}

const JUMPS = new Set([
  'jo',
  'jno',
  'jb',
  'jc',
  'jnae',
  'jae',
  'jnb',
  'jnc',
  'je',
  'jz',
  'jne',
  'jnz',
  'jbe',
  'jna',
  'ja',
  'jnbe',
  'js',
  'jns',
  'jp',
  'jpe',
  'jnp',
  'jpo',
  'jl',
  'jnge',
  'jge',
  'jnl',
  'jle',
  'jng',
  'jg',
  'jnle',
  'jmp',
  'jcxz',
  'loop',
  'loope',
  'loopz',
  'loopne',
  'loopnz',
  'call',
]);
const SUPPORTED = new Set([
  ...JUMPS,
  'mov',
  'xchg',
  'lea',
  'les',
  'lds',
  'add',
  'adc',
  'sub',
  'sbb',
  'cmp',
  'inc',
  'dec',
  'neg',
  'not',
  'and',
  'or',
  'xor',
  'test',
  'shl',
  'sal',
  'shr',
  'sar',
  'rol',
  'ror',
  'rcl',
  'rcr',
  'mul',
  'imul',
  'div',
  'idiv',
  'cbw',
  'cwd',
  'push',
  'pop',
  'pushf',
  'popf',
  'pusha',
  'popa',
  'lahf',
  'sahf',
  'clc',
  'stc',
  'cmc',
  'cld',
  'std',
  'cli',
  'sti',
  'ret',
  'retf',
  'iret',
  'xlat',
  'xlatb',
  'in',
  'out',
  'int',
  'into',
  'movsb',
  'movsw',
  'stosb',
  'stosw',
  'lodsb',
  'lodsw',
  'scasb',
  'scasw',
  'cmpsb',
  'cmpsw',
  'nop',
  'wait',
  'hlt',
]);
/** Instructions whose two operands must be the same size. */
const SAME_SIZE = new Set([
  'mov',
  'add',
  'adc',
  'sub',
  'sbb',
  'cmp',
  'and',
  'or',
  'xor',
  'test',
  'xchg',
]);
const OPERAND_COUNTS: Record<string, number[]> = {
  mov: [2],
  xchg: [2],
  lea: [2],
  les: [2],
  lds: [2],
  add: [2],
  adc: [2],
  sub: [2],
  sbb: [2],
  cmp: [2],
  and: [2],
  or: [2],
  xor: [2],
  test: [2],
  inc: [1],
  dec: [1],
  neg: [1],
  not: [1],
  mul: [1],
  div: [1],
  idiv: [1],
  imul: [1, 2, 3],
  push: [1],
  pop: [1],
  int: [1],
  in: [2],
  out: [2],
  shl: [1, 2],
  sal: [1, 2],
  shr: [1, 2],
  sar: [1, 2],
  rol: [1, 2],
  ror: [1, 2],
  rcl: [1, 2],
  rcr: [1, 2],
  ret: [0, 1],
  retf: [0, 1],
};

interface Value {
  constant: number;
  variable?: { key: unknown; variable: AsmVariable; size?: number | undefined };
  label?: string;
  address?: boolean;
  size?: number;
}

/** Resolve an asm block's names: its labels, and the Pascal variables and
 * constants it uses. */
export function assemble(
  raw: RawInstruction[],
  context: AsmContext,
  line: number
): { block: AsmBlock; keys: unknown[] } {
  const labels = new Map<string, number>();
  let count = 0;
  for (const instruction of raw) {
    for (const label of instruction.labels) {
      if (!label.startsWith('@')) context.unsupported('Pascal labels in assembler');
      if (labels.has(label)) throw new PascalError(`Duplicate label "${label}"`, instruction.line);
      labels.set(label, count);
    }
    if (instruction.mnemonic) count++;
  }
  const keys: unknown[] = [];
  const variables: AsmVariable[] = [];
  const slot = (key: unknown, variable: AsmVariable): number => {
    let index = keys.indexOf(key);
    if (index < 0) {
      index = keys.length;
      keys.push(key);
      variables.push(variable);
    }
    return index;
  };

  const instructions: Instruction[] = [];
  for (const instruction of raw) {
    const mnemonic = instruction.mnemonic;
    if (!mnemonic) continue;
    const at = instruction.line;
    const fail = (message: string): never => {
      throw new PascalError(message, at);
    };
    if (['db', 'dw', 'dd'].includes(mnemonic)) context.unsupported('Data in assembler');
    // Turbo Pascal's other instructions: BCD, the 286's protected mode and
    // the 8087's.
    if (!SUPPORTED.has(mnemonic)) context.unsupported(`The ${mnemonic.toUpperCase()} instruction`);
    const counts = OPERAND_COUNTS[mnemonic] ?? (JUMPS.has(mnemonic) ? [1] : [0]);
    if (!counts.includes(instruction.operands.length)) fail('Invalid number of operands');

    const evaluate = (expression: AsmExpression): Value => {
      switch (expression.kind) {
        case 'number':
          return { constant: expression.value };
        case 'name': {
          const first = expression.path[0]!.toLowerCase();
          if (first.startsWith('@') && first !== '@result' && expression.path.length === 1)
            return { constant: 0, label: first };
          const name = context.resolve(expression.path, at);
          if (!name) return fail(`Unknown identifier "${expression.path.join('.')}"`);
          if (name.kind === 'constant') return { constant: name.value };
          if (name.kind === 'type') return { constant: name.offset, size: name.size };
          return {
            constant: name.displacement,
            variable: { key: name.key, variable: name.variable, size: name.size },
            ...(name.size ? { size: name.size } : {}),
          };
        }
        case 'unary': {
          const operand = evaluate(expression.operand);
          switch (expression.operator) {
            case 'offset':
              if (!operand.variable) return fail('Memory reference expected');
              return { ...operand, address: true };
            case 'seg':
              return { constant: 0 };
            case 'type':
              return { constant: operand.size ?? 0 };
          }
          if (operand.variable || operand.label) return fail('Constant expected');
          switch (expression.operator) {
            case '-':
              return { constant: -operand.constant };
            case '+':
              return operand;
            case 'not':
              return { constant: ~operand.constant };
            case 'low':
              return { constant: operand.constant & 0xff };
            default:
              return { constant: (operand.constant >> 8) & 0xff };
          }
        }
        case 'binary': {
          const left = evaluate(expression.left),
            right = evaluate(expression.right);
          if (left.label || right.label) return fail('Constant expected');
          if (expression.operator === '+' || expression.operator === '-') {
            if (right.variable && (expression.operator === '-' || left.variable))
              return fail('Invalid register combination');
            const variable = left.variable ?? right.variable;
            const constant =
              expression.operator === '+'
                ? left.constant + right.constant
                : left.constant - right.constant;
            return {
              constant,
              ...(variable ? { variable } : {}),
              ...(left.address || right.address ? { address: true } : {}),
            };
          }
          if (left.variable || right.variable) return fail('Constant expected');
          const [a, b] = [left.constant, right.constant];
          switch (expression.operator) {
            case '*':
              return { constant: a * b };
            case '/':
              return b === 0 ? fail('Division by zero') : { constant: Math.trunc(a / b) };
            case 'mod':
              return b === 0 ? fail('Division by zero') : { constant: a % b };
            case 'shl':
              return { constant: a << b };
            case 'shr':
              return { constant: a >>> b };
            case 'and':
              return { constant: a & b };
            case 'or':
              return { constant: a | b };
            default:
              return { constant: a ^ b };
          }
        }
      }
    };

    const operand = (raw: RawOperand): Operand => {
      if (raw.kind === 'register') {
        return { kind: 'register', register: raw.register };
      }
      if (raw.kind === 'memory') {
        const registers = raw.registers;
        const bases = registers.filter((register) => register === 'bx' || register === 'bp').length,
          indexes = registers.filter((register) => register === 'si' || register === 'di').length;
        if (registers.length !== bases + indexes || bases > 1 || indexes > 1)
          fail('Invalid register combination');
        const value = raw.displacement ? evaluate(raw.displacement) : { constant: 0 };
        if (value.label || value.address) fail('Invalid operand');
        const size =
          raw.size ??
          (value.variable?.size && [1, 2, 4].includes(value.variable.size)
            ? value.variable.size
            : undefined);
        return {
          kind: 'memory',
          ...(size ? { size: size as 1 | 2 | 4 } : {}),
          ...(value.variable
            ? { variable: slot(value.variable.key, value.variable.variable) }
            : {}),
          registers: registers as WordRegister[],
          displacement: value.constant,
          ...(raw.segment && (SEGMENT_REGISTERS as readonly string[]).includes(raw.segment)
            ? { segment: raw.segment as SegmentRegister }
            : {}),
        };
      }
      const value = evaluate(raw.expression);
      if (value.label) {
        const target = labels.get(value.label);
        if (target === undefined) fail(`Unknown label "${value.label}"`);
        return { kind: 'label', target: target! };
      }
      if (value.variable && value.address) {
        return {
          kind: 'address',
          variable: slot(value.variable.key, value.variable.variable),
          displacement: value.constant,
        };
      }
      if (value.variable) {
        const size =
          raw.size ??
          (value.variable.size && [1, 2, 4].includes(value.variable.size)
            ? value.variable.size
            : undefined);
        return {
          kind: 'memory',
          ...(size ? { size: size as 1 | 2 | 4 } : {}),
          variable: slot(value.variable.key, value.variable.variable),
          registers: [],
          displacement: value.constant,
          ...(raw.segment && (SEGMENT_REGISTERS as readonly string[]).includes(raw.segment)
            ? { segment: raw.segment as SegmentRegister }
            : {}),
        };
      }
      return { kind: 'immediate', value: value.constant };
    };
    const operands = instruction.operands.map(operand);
    if (context.instructions286 === false && needs286(mnemonic, operands))
      fail('286/287 instructions are not enabled');
    if (JUMPS.has(mnemonic) && operands[0]?.kind !== 'label') {
      if (mnemonic === 'call') context.unsupported('Calls from assembler');
      fail('Label expected');
    }
    if (SAME_SIZE.has(mnemonic)) {
      const register = operands.find(
        (entry): entry is Extract<Operand, { kind: 'register' }> => entry.kind === 'register'
      );
      const memory = operands.find(
        (entry): entry is Extract<Operand, { kind: 'memory' }> => entry.kind === 'memory'
      );
      if (register && memory?.size && memory.size !== registerSize(register.register))
        fail('Operand size mismatch');
      const registers = operands.filter(
        (entry): entry is Extract<Operand, { kind: 'register' }> => entry.kind === 'register'
      );
      if (
        registers.length === 2 &&
        registerSize(registers[0]!.register) !== registerSize(registers[1]!.register)
      )
        fail('Operand size mismatch');
    }
    const repeat =
      instruction.prefix === 'rep'
        ? 'rep'
        : instruction.prefix === 'repe' || instruction.prefix === 'repz'
          ? 'repe'
          : instruction.prefix === 'repne' || instruction.prefix === 'repnz'
            ? 'repne'
            : undefined;
    instructions.push({ mnemonic, operands, ...(repeat ? { repeat } : {}), line: at });
  }
  return { block: { instructions, variables, line }, keys };
}
