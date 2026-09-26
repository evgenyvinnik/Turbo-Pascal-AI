/**
 * Instruction set of p-machine. This machine language is compatible with the
 * p-code of 1978 UCSD Pascal.
 *
 * References:
 *     http://cs2.uco.edu/~trt/cs4173/pspec.pdf
 *     http://cs2.uco.edu/~trt/cs4933/P-MachineSimulator.pdf
 */

import { PascalError } from '../errors/PascalError';

// Bit layout constants for instruction encoding. The opcode and operand 1
// fill the low 17 bits; operand 2, an address or offset, is the rest of the
// number above them, so a program or a frame may exceed 32K.
const OPCODE_BITS = 8;
const OPERAND1_BITS = 9;
const OPCODE_MASK = (1 << OPCODE_BITS) - 1;
const OPERAND1_MASK = (1 << OPERAND1_BITS) - 1;
const OPERAND2_MAX = 2 ** 31 - 1;
const OPCODE_SHIFT = 0;
const OPERAND1_SHIFT = OPCODE_SHIFT + OPCODE_BITS;
const OPERAND2_SHIFT = OPERAND1_SHIFT + OPERAND1_BITS;
const OPERAND2_SCALE = 2 ** OPERAND2_SHIFT;

/**
 * Opcodes for the P-machine instruction set
 */
export enum Opcode {
  // Subprogram linkage
  /** Call user procedure - argsize, iaddr */
  CUP = 0x00,
  /** Call standard procedure - argsize, stdfunction */
  CSP = 0x01,
  /** Entry - register, amount */
  ENT = 0x02,
  /** Mark stack - level */
  MST = 0x03,
  /** Return - type */
  RTN = 0x04,

  // Comparison
  /** Equality - type */
  EQU = 0x05,
  /** Inequality - type */
  NEQ = 0x06,
  /** Greater than - type */
  GRT = 0x07,
  /** Greater than or equal - type */
  GEQ = 0x08,
  /** Less than - type */
  LES = 0x09,
  /** Less than or equal - type */
  LEQ = 0x0a,

  // Integer arithmetic
  /** Integer addition */
  ADI = 0x0b,
  /** Integer subtraction */
  SBI = 0x0c,
  /** Integer sign inversion */
  NGI = 0x0d,
  /** Integer multiplication */
  MPI = 0x0e,
  /** Integer division */
  DVI = 0x0f,
  /** Integer modulo */
  MOD = 0x10,
  /** Integer absolute value */
  ABI = 0x11,
  /** Integer square */
  SQI = 0x12,
  /** Integer increment - i-type */
  INC = 0x13,
  /** Integer decrement - i-type */
  DEC = 0x14,

  // Real arithmetic
  /** Real addition */
  ADR = 0x15,
  /** Real subtraction */
  SBR = 0x16,
  /** Real sign inversion */
  NGR = 0x17,
  /** Real multiplication */
  MPR = 0x18,
  /** Real division */
  DVR = 0x19,
  /** Real absolute value */
  ABR = 0x1a,
  /** Real square */
  SQR = 0x1b,

  // Boolean
  /** Inclusive OR */
  IOR = 0x1c,
  /** AND */
  AND = 0x1d,
  /** Exclusive OR */
  XOR = 0x1e,
  /** NOT */
  NOT = 0x1f,

  // Set operations
  /** Set membership */
  INN = 0x20,
  /** Set union */
  UNI = 0x21,
  /** Set intersection */
  INT = 0x22,
  /** Set difference */
  DIF = 0x23,
  /** Set complement */
  CMP = 0x24,
  /** Generate singleton set */
  SGS = 0x25,

  // Jump
  /** Unconditional jump - iaddr */
  UJP = 0x26,
  /** Indexed jump - iaddr */
  XJP = 0x27,
  /** False jump - iaddr */
  FJP = 0x28,
  /** True jump - iaddr */
  TJP = 0x29,

  // Conversion
  /** Integer to real */
  FLT = 0x2a,
  /** Integer to real (2nd entry on stack) */
  FLO = 0x2b,
  /** Truncate. UCSD p-code also uses this opcode for round, integer to char, and anything to integer. */
  TRC = 0x2c,

  // Termination
  /** Stop */
  STP = 0x30,

  // Data reference
  /** Load address of data - level, offset */
  LDA = 0x31,
  /** Load constant - type, cindex */
  LDC = 0x32,
  /** Load indirect - type */
  LDI = 0x33,
  /** Load value (address) - level, offset */
  LVA = 0x34,
  /** Load value (boolean) - level, offset */
  LVB = 0x35,
  /** Load value (character) - level, offset */
  LVC = 0x36,
  /** Load value (integer) - level, offset */
  LVI = 0x37,
  /** Load value (real) - level, offset */
  LVR = 0x38,
  /** Load value (set) - level, offset */
  LVS = 0x39,
  /** Store indirect - type */
  STI = 0x3a,
  /** Compute indexed address - stride */
  IXA = 0x3b,
}

/**
 * Register identifiers for the P-machine
 */
export enum Register {
  /** Stack pointer */
  SP = 0x00,
  /** Extreme pointer (not used in this machine) */
  EP = 0x01,
  /** Mark pointer */
  MP = 0x02,
  /** Program counter */
  PC = 0x03,
  /** New pointer */
  NP = 0x04,
}

/**
 * Type codes for the P-machine
 */
export enum TypeCode {
  /** Address (pointer) */
  A = 0x00,
  /** Boolean */
  B = 0x01,
  /** Character */
  C = 0x02,
  /** Integer */
  I = 0x03,
  /** Real */
  R = 0x04,
  /** String */
  S = 0x05,
  /** Set */
  T = 0x06,
  /** Procedure (void) */
  P = 0x07,
  /** Any type */
  X = 0x08,
}

/**
 * The Mark is the area at the bottom of each frame. It contains (low to high address):
 *
 *     Return value (rv).
 *     Static link (sl).
 *     Dynamic link (dl).
 *     Extreme pointer (es), not used.
 *     Return address (ra).
 */
export const MARK_SIZE = 5;

/**
 * Map from opcode number to name
 */
export const opcodeToName: Record<number, string> = {
  [Opcode.CUP]: 'CUP',
  [Opcode.CSP]: 'CSP',
  [Opcode.ENT]: 'ENT',
  [Opcode.MST]: 'MST',
  [Opcode.RTN]: 'RTN',
  [Opcode.EQU]: 'EQU',
  [Opcode.NEQ]: 'NEQ',
  [Opcode.GRT]: 'GRT',
  [Opcode.GEQ]: 'GEQ',
  [Opcode.LES]: 'LES',
  [Opcode.LEQ]: 'LEQ',
  [Opcode.ADI]: 'ADI',
  [Opcode.SBI]: 'SBI',
  [Opcode.NGI]: 'NGI',
  [Opcode.MPI]: 'MPI',
  [Opcode.DVI]: 'DVI',
  [Opcode.MOD]: 'MOD',
  [Opcode.ABI]: 'ABI',
  [Opcode.SQI]: 'SQI',
  [Opcode.INC]: 'INC',
  [Opcode.DEC]: 'DEC',
  [Opcode.ADR]: 'ADR',
  [Opcode.SBR]: 'SBR',
  [Opcode.NGR]: 'NGR',
  [Opcode.MPR]: 'MPR',
  [Opcode.DVR]: 'DVR',
  [Opcode.ABR]: 'ABR',
  [Opcode.SQR]: 'SQR',
  [Opcode.IOR]: 'IOR',
  [Opcode.AND]: 'AND',
  [Opcode.XOR]: 'XOR',
  [Opcode.NOT]: 'NOT',
  [Opcode.INN]: 'INN',
  [Opcode.UNI]: 'UNI',
  [Opcode.INT]: 'INT',
  [Opcode.DIF]: 'DIF',
  [Opcode.CMP]: 'CMP',
  [Opcode.SGS]: 'SGS',
  [Opcode.UJP]: 'UJP',
  [Opcode.XJP]: 'XJP',
  [Opcode.FJP]: 'FJP',
  [Opcode.TJP]: 'TJP',
  [Opcode.FLT]: 'FLT',
  [Opcode.FLO]: 'FLO',
  [Opcode.STP]: 'STP',
  [Opcode.LDA]: 'LDA',
  [Opcode.LDC]: 'LDC',
  [Opcode.LDI]: 'LDI',
  [Opcode.LVA]: 'LVA',
  [Opcode.LVB]: 'LVB',
  [Opcode.LVC]: 'LVC',
  [Opcode.LVI]: 'LVI',
  [Opcode.LVR]: 'LVR',
  [Opcode.LVS]: 'LVS',
  [Opcode.STI]: 'STI',
  [Opcode.IXA]: 'IXA',
};

/**
 * Instruction utility functions
 */
export const inst = {
  // Re-export opcodes for backward compatibility
  ...Opcode,

  // Re-export type codes for backward compatibility
  A: TypeCode.A,
  B: TypeCode.B,
  C: TypeCode.C,
  I: TypeCode.I,
  R: TypeCode.R,
  S: TypeCode.S,
  T: TypeCode.T,
  P: TypeCode.P,
  X: TypeCode.X,

  // Re-export registers
  REG_SP: Register.SP,
  REG_EP: Register.EP,
  REG_MP: Register.MP,
  REG_PC: Register.PC,
  REG_NP: Register.NP,

  // Mark size
  MARK_SIZE,

  // Opcode name lookup
  opcodeToName,

  /**
   * Construct a machine language instruction.
   * @param opcode - The opcode
   * @param operand1 - First operand (default 0)
   * @param operand2 - Second operand (default 0)
   * @returns The encoded instruction as a number
   */
  make(opcode: Opcode | number, operand1 = 0, operand2 = 0): number {
    // Sanity check
    if (operand1 < 0) {
      throw new PascalError(`negative operand1: ${String(operand1)}`);
    }
    if (operand1 > OPERAND1_MASK) {
      throw new PascalError(`too large operand1: ${String(operand1)}`);
    }
    if (operand2 < 0) {
      throw new PascalError(`negative operand2: ${String(operand2)}`);
    }
    if (operand2 > OPERAND2_MAX) {
      throw new PascalError(`too large operand2: ${String(operand2)}`);
    }

    return ((opcode << OPCODE_SHIFT) | (operand1 << OPERAND1_SHIFT)) + operand2 * OPERAND2_SCALE;
  },

  /**
   * Return the opcode of the instruction.
   * @param instruction - The encoded instruction
   * @returns The opcode
   */
  getOpcode(instruction: number): number {
    return (instruction >>> OPCODE_SHIFT) & OPCODE_MASK;
  },

  /**
   * Return operand 1 of the instruction.
   * @param instruction - The encoded instruction
   * @returns Operand 1
   */
  getOperand1(instruction: number): number {
    return (instruction >>> OPERAND1_SHIFT) & OPERAND1_MASK;
  },

  /**
   * Return operand 2 of the instruction.
   * @param instruction - The encoded instruction
   * @returns Operand 2
   */
  getOperand2(instruction: number): number {
    // Most instructions fit 31 bits, where a shift is quicker than division.
    return instruction < 0x80000000
      ? instruction >>> OPERAND2_SHIFT
      : Math.floor(instruction / OPERAND2_SCALE);
  },

  /**
   * Return a string version of the instruction.
   * @param instruction - The encoded instruction
   * @returns A disassembled string representation
   */
  disassemble(instruction: number): string {
    const opcode = this.getOpcode(instruction);
    const operand1 = this.getOperand1(instruction);
    const operand2 = this.getOperand2(instruction);

    const name = opcodeToName[opcode] ?? `0x${opcode.toString(16)}`;
    return `${name} ${String(operand1)} ${String(operand2)}`;
  },

  /**
   * Converts a type code like TypeCode.I to "integer", or throw if not valid.
   * @param typeCode - The type code
   * @returns The human-readable name
   */
  typeCodeToName(typeCode: TypeCode): string {
    switch (typeCode) {
      case TypeCode.A:
        return 'pointer';
      case TypeCode.B:
        return 'boolean';
      case TypeCode.C:
        return 'char';
      case TypeCode.I:
        return 'integer';
      case TypeCode.R:
        return 'real';
      case TypeCode.S:
        return 'string';
      case TypeCode.T:
        return 'set';
      case TypeCode.P:
        return 'void';
      case TypeCode.X:
        return 'any';
      default:
        throw new PascalError(`unknown type code ${String(typeCode)}`);
    }
  },
};

// Default export for convenience
export default inst;
