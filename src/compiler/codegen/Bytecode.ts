/**
 * Bytecode container class
 *
 * Stores all bytecodes for a program, along with accompanying
 * data such as program constants and typed constants.
 */

import { inst, Opcode } from '../types';
import type { AsmBlock } from '../asm/types';
import type { BinaryCell } from '../runtime/BinaryCodec';

/** A variant part of a record: its cases, each in cells of its own, and its
 * shadow, the part's bytes as Turbo Pascal stores them. Offsets are cells
 * from the start of the record. */
export interface VariantPartInfo {
  shadow: number;
  bytes: number;
  cases: {
    /** The case's cells in byte order, with a nested variant part's shadow
     * standing for that part. */
    cells: { offset: number; cell: BinaryCell }[];
    /** Variant parts inside the case, to bring up to date after it. */
    nested: { part: number; offset: number }[];
  }[];
}

/**
 * Interface for native procedure registry
 */
export interface INative {
  /** Array of native procedure implementations */
  procedures: Array<(...args: unknown[]) => unknown>;
}

export interface DebugType {
  kind: string;
  size: number;
  byteSize?: number;
  capacity?: number;
  low?: number;
  high?: number;
  element?: DebugType;
  base?: DebugType;
  fields?: Record<string, { offset: number; type: DebugType }>;
}
export interface DebugScope {
  id: number;
  parentId: number | null;
  name: string;
  level: number;
  start: number;
  end: number;
  frameSize: number;
  variables: {
    name: string;
    offset: number;
    reference: boolean;
    parameter?: boolean;
    /** A typed constant: the offset is in the program's frame, not this one. */
    static?: boolean;
    type: DebugType;
  }[];
  constants: { name: string; value: number | string | boolean | null; type: DebugType }[];
}

/**
 * Represents a compiled bytecode object containing instructions and constants
 */
export class Bytecode {
  /**
   * Instruction store - array of encoded instructions
   */
  public istore: number[] = [];

  /**
   * Constants store - ordered list of JavaScript constant objects (numbers, strings, etc.)
   */
  public constants: Array<number | string | boolean | null> = [];

  /**
   * Typed constants - copied to the start of dstore when bytecode is loaded
   */
  public typedConstants: number[] = [];

  /** The System unit's own variables, by address, with the value each starts
   * with: ExitCode, RandSeed, FileMode, Test8087 and Test8086. */
  public standardVariables: { name: string; address: number; initial: number }[] = [];

  /** The program's asm statements and inline code, which the machine's
   * 8086 runs over Pascal variables. */
  public assembly: AsmBlock[] = [];

  /** Every variant part of the program's record types, by number. */
  public variantParts: VariantPartInfo[] = [];

  /** Lists of variant parts inside a type, by number, which a byte-level
   * change to a variable of that type brings up to date. */
  public variantRefreshes: { part: number; offset: number }[][] = [];

  /** Interrupt procedures, by the value @Handler gives: where each starts
   * and how many of the register parameters it declares. */
  public interruptHandlers: Record<number, { address: number; parameters: number }> = {};

  /** Where the program's exit procedures run: the end of the main block,
   * which Halt and a run-time error reach as well. */
  public exitChain?: number;

  /**
   * Index into istore where program should start
   */
  public startAddress = 0;

  /**
   * Map from istore address to comment for debugging/disassembly
   */
  public comments: Record<number, string> = {};

  /** Source line for each instruction, used to report runtime errors. */
  public sourceLines: Record<number, number> = {};
  public sourceFiles: Record<number, string> = {};
  public sources: Record<string, string> = {};
  public statementLines: Record<number, number> = {};
  /** Per-call Pascal I/O checking directive; omitted entries default to checked. */
  public ioChecks: Record<number, boolean> = {};
  /** Resume after generated input checks when unchecked I/O fails. */
  public ioErrorTargets: Record<number, number> = {};
  public debugScopes: DebugScope[] = [];

  /**
   * Native methods registry
   */
  public native: INative | null;

  /**
   * Creates a new Bytecode container
   * @param native - Optional native procedures registry
   */
  constructor(native?: INative | null) {
    this.native = native ?? null;
  }

  /**
   * Add a constant (of any type), returning the constant index (cindex).
   * Re-uses existing constants if they match.
   * @param c - The constant value to add
   * @returns The index of the constant in the constants array
   */
  addConstant(c: number | string | boolean | null): number {
    // Re-use existing constants. We could use a hash table for this.
    for (let i = 0; i < this.constants.length; i++) {
      if (c === this.constants[i]) {
        return i;
      }
    }

    // Add new constant
    this.constants.push(c);
    return this.constants.length - 1;
  }

  /**
   * Add an array of words to the end of the typed constants.
   * @param raw - Array of raw constant values
   * @returns The address of the item that was just added
   */
  addTypedConstants(raw: number[]): number {
    const address = this.typedConstants.length;

    // Append entire "raw" array to the back of the typedConstants array
    this.typedConstants.push(...raw);

    return address;
  }

  /**
   * Add an opcode to the instruction store.
   * @param opcode - The opcode to add
   * @param operand1 - First operand (default 0)
   * @param operand2 - Second operand (default 0)
   * @param comment - Optional comment for debugging
   */
  add(opcode: Opcode | number, operand1 = 0, operand2 = 0, comment?: string): void {
    const instruction = inst.make(opcode, operand1, operand2);
    const address = this.getNextAddress();
    this.istore.push(instruction);
    if (comment) {
      this.addComment(address, comment);
    }
  }

  /**
   * Replace operand2 of the instruction at the given address.
   * Used for patching forward jumps.
   * @param address - The address of the instruction to modify
   * @param operand2 - The new value for operand2
   */
  setOperand2(address: number, operand2: number): void {
    const instruction = this.istore[address]!;
    const newInstruction = inst.make(
      inst.getOpcode(instruction),
      inst.getOperand1(instruction),
      operand2
    );
    this.istore[address] = newInstruction;
  }

  /**
   * Return the next address to be added to the instruction store.
   * @returns The next available address
   */
  getNextAddress(): number {
    return this.istore.length;
  }

  /**
   * Set the starting address to the next instruction that will be added.
   */
  setStartAddress(): void {
    this.startAddress = this.getNextAddress();
  }

  /**
   * Add a comment to an address (for debugging/disassembly).
   * @param address - The address to annotate
   * @param comment - The comment text
   */
  addComment(address: number, comment: string): void {
    const existingComment = this.comments[address];
    if (existingComment) {
      // Add to existing comment
      this.comments[address] = existingComment + '; ' + comment;
    } else {
      this.comments[address] = comment;
    }
  }

  /**
   * Return a printable version of the bytecode object.
   * @returns A formatted string with constants and instructions
   */
  print(): string {
    return this.printConstants() + '\n' + this.printIstore();
  }

  /**
   * Return a printable version of the constant table.
   * @returns A formatted string of constants
   */
  printConstants(): string {
    const lines: string[] = [];
    for (let i = 0; i < this.constants.length; i++) {
      const value = this.constants[i];
      const displayValue = typeof value === 'string' ? `'${value}'` : value;
      lines.push(`${this.rightAlign(i, 4)}: ${String(displayValue)}`);
    }

    return 'Constants:\n' + lines.join('\n') + '\n';
  }

  /**
   * Return a printable version of the instruction store.
   * @returns A formatted string of disassembled instructions
   */
  printIstore(): string {
    const lines: string[] = [];
    for (let address = 0; address < this.istore.length; address++) {
      const instruction = this.istore[address]!;
      let line =
        this.rightAlign(address, 4) + ': ' + this.leftAlign(inst.disassemble(instruction), 11);
      const comment = this.comments[address];
      if (comment) {
        line += ' ; ' + comment;
      }
      lines.push(line);
    }

    return 'Istore:\n' + lines.join('\n') + '\n';
  }

  /**
   * Right-align a value in a field of the given width.
   * @param value - The value to align
   * @param width - The field width
   * @returns The padded string
   */
  private rightAlign(value: number | string, width: number): string {
    const s = String(value);
    return s.padStart(width, ' ');
  }

  /**
   * Left-align a value in a field of the given width.
   * @param value - The value to align
   * @param width - The field width
   * @returns The padded string
   */
  private leftAlign(value: string, width: number): string {
    return value.padEnd(width, ' ');
  }

  /**
   * Get the instruction at the given address.
   * @param address - The instruction address
   * @returns The encoded instruction
   */
  getInstruction(address: number): number {
    return this.istore[address]!;
  }

  /**
   * Get the total number of instructions.
   * @returns The number of instructions
   */
  getInstructionCount(): number {
    return this.istore.length;
  }

  /**
   * Get a constant by its index.
   * @param index - The constant index
   * @returns The constant value
   */
  getConstant(index: number): number | string | boolean | null {
    return this.constants[index]!;
  }

  /**
   * Get the total number of constants.
   * @returns The number of constants
   */
  getConstantCount(): number {
    return this.constants.length;
  }
}

export default Bytecode;
