import type { BinaryCell } from '../runtime/BinaryCodec';

/** The 8086's registers, as the built-in assembler names them. */
export const WORD_REGISTERS = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'] as const;
export const BYTE_REGISTERS = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'] as const;
export const SEGMENT_REGISTERS = ['es', 'cs', 'ss', 'ds'] as const;
export type WordRegister = (typeof WORD_REGISTERS)[number];
export type ByteRegister = (typeof BYTE_REGISTERS)[number];
export type SegmentRegister = (typeof SEGMENT_REGISTERS)[number];
export type Register = WordRegister | ByteRegister | SegmentRegister;

export function registerSize(register: Register): 1 | 2 {
  return (BYTE_REGISTERS as readonly string[]).includes(register) ? 1 : 2;
}

/** A resolved operand. Memory is a Pascal variable (its cells' address is
 * one of the block's arguments) plus a byte displacement, or whatever the
 * base registers point at. */
export type Operand =
  | { kind: 'register'; register: Register }
  | { kind: 'immediate'; value: number }
  | { kind: 'address'; variable: number; displacement: number }
  | {
      kind: 'memory';
      size?: 1 | 2 | 4;
      variable?: number;
      registers: WordRegister[];
      displacement: number;
      /** A segment override, as ES:[DI]. */
      segment?: SegmentRegister;
    }
  | { kind: 'label'; target: number };

export interface Instruction {
  mnemonic: string;
  operands: Operand[];
  repeat?: 'rep' | 'repe' | 'repne';
  line: number;
}

/** A variable the block names. Its argument is the address of its cells,
 * or for a var parameter, of the cell holding the variable's address. */
export interface AsmVariable {
  name: string;
  layout: BinaryCell[];
  /** A cell that holds an address: a var parameter or a pointer. */
  pointer?: boolean;
  /** The layout of what that address points at, when known. */
  target?: BinaryCell[];
}

export interface AsmBlock {
  instructions: Instruction[];
  variables: AsmVariable[];
  /** An inline routine's arguments, which its code finds on the stack:
   * the size of each, in the order they were pushed. */
  stackArguments?: (1 | 2 | 4)[];
  /** An assembler function's result: AL, AX or DX:AX. */
  result?: { size: 1 | 2 | 4; kind: 'integer' | 'char' | 'boolean' | 'pointer'; signed: boolean };
  line: number;
}
