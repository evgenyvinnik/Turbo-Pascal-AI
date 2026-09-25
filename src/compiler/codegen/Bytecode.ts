/**
 * Bytecode container class
 *
 * Stores all bytecodes for a program, along with accompanying
 * data such as program constants and typed constants.
 */

import { inst, Opcode } from '../types';
import type { AsmBlock } from '../asm/types';
import type { BinaryCell } from '../runtime/BinaryCodec';

/** How a type's cells lie in its bytes: one cell, an array of elements that
 * are `cells` cells and `bytes` bytes each, or a record's fields, each at a
 * cell offset and a byte. */
export type ViewShape =
  | { kind: 'cell'; cell: BinaryCell }
  | { kind: 'array'; count: number; cells: number; bytes: number; element: ViewShape }
  | { kind: 'record'; fields: { offset: number; cells: number; byte: number; bytes?: number; shape: ViewShape }[] };

/** The cell at a cell offset in a shape, and the byte it starts at. */
export function shapeCell(shape: ViewShape, offset: number): { byte: number; cell: BinaryCell } | undefined {
  if (shape.kind === 'cell') return offset === 0 ? { byte: 0, cell: shape.cell } : undefined;
  if (shape.kind === 'array') {
    const index = Math.floor(offset / shape.cells);
    if (index < 0 || index >= shape.count) return undefined;
    const inner = shapeCell(shape.element, offset - index * shape.cells);
    return inner && { byte: index * shape.bytes + inner.byte, cell: inner.cell };
  }
  const field = fieldAt(shape, offset);
  const inner = field && shapeCell(field.shape, offset - field.offset);
  return field && inner && { byte: field.byte + inner.byte, cell: inner.cell };
}

type RecordShape = Extract<ViewShape, { kind: 'record' }>;
const sortedFields = new WeakMap<RecordShape, RecordShape['fields']>();
/** The field of a record's shape that holds a cell. Fields' cells never
 * overlap, so a record of many, as the data segment is, is searched in
 * order of their cells. */
function fieldAt(shape: RecordShape, offset: number): RecordShape['fields'][number] | undefined {
  if (shape.fields.length <= 8)
    return shape.fields.find((field) => offset >= field.offset && offset < field.offset + field.cells);
  let fields = sortedFields.get(shape);
  if (!fields) {
    fields = shape.fields.filter((field) => field.cells > 0).sort((a, b) => a.offset - b.offset);
    sortedFields.set(shape, fields);
  }
  let low = 0, high = fields.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (fields[middle]!.offset <= offset) low = middle;
    else high = middle - 1;
  }
  const field = fields[low];
  return field && offset >= field.offset && offset < field.offset + field.cells ? field : undefined;
}

/** How many bytes a shape spans. */
export function shapeBytes(shape: ViewShape): number {
  if (shape.kind === 'cell') return shape.cell.bytes;
  if (shape.kind === 'array') return shape.count * shape.bytes;
  return shape.fields.reduce((size, field) => Math.max(size, field.byte + (field.bytes ?? shapeBytes(field.shape))), 0);
}

/** How many cells a shape spans. */
export function shapeSize(shape: ViewShape): number {
  if (shape.kind === 'cell') return 1;
  if (shape.kind === 'array') return shape.count * shape.cells;
  return shape.fields.reduce((size, field) => Math.max(size, field.offset + field.cells), 0);
}

/** Whether the cells of `shape`, from `offset` on, lie in their bytes as
 * those of `target` do: the same cells, the same distances apart. */
export function sameShape(shape: ViewShape, offset: number, target: ViewShape): boolean {
  const first = shapeCell(shape, offset);
  if (!first) return false;
  const size = shapeSize(target);
  for (let cell = 0; cell < size; cell++) {
    const wanted = shapeCell(target, cell);
    if (!wanted) continue;
    const found = shapeCell(shape, offset + cell);
    if (!found || found.byte - first.byte !== wanted.byte) return false;
    const a = found.cell,
      b = wanted.cell;
    if (a.kind !== b.kind || a.bytes !== b.bytes || Boolean(a.signed) !== Boolean(b.signed) || (a.setByteOffset ?? 0) !== (b.setByteOffset ?? 0))
      return false;
  }
  return true;
}

/** Where variables lie in the bytes of a segment of Turbo Pascal's memory:
 * the data segment's globals and typed constants, or one routine's frame on
 * the stack. Cell offsets are from the start of the frame that holds them. */
export interface SegmentLayout {
  /** The bytes in order, with the gaps between variables. */
  layout: BinaryCell[];
  /** Each variable's cells and the byte it starts at. */
  shape: ViewShape;
  /** The variant parts in the variables, by number in variantRefreshes, or -1. */
  refresh: number;
  /** The cells of variables with variant parts, whose cases follow only
   * stores that go through their bytes. */
  variantCells: [number, number][];
  bytes: number;
}
export const EMPTY_SEGMENT: SegmentLayout = { layout: [], shape: { kind: 'record', fields: [] }, refresh: -1, variantCells: [], bytes: 0 };

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

  /** Byte layouts of types, by number: what an untyped parameter's caller
   * passes, and what an absolute variable and its variable are copied by. */
  public layouts: BinaryCell[][] = [];

  /** How types' cells lie in their bytes, by number. A view shows a
   * variable's bytes as such a type. */
  public viewMaps: ViewShape[] = [];

  /** Every variant part of the program's record types, by number. */
  public variantParts: VariantPartInfo[] = [];

  /** Lists of variant parts inside a type, by number, which a byte-level
   * change to a variable of that type brings up to date. */
  public variantRefreshes: { part: number; offset: number }[][] = [];

  /** The data segment: the globals and typed constants, in the main frame. */
  public dataSegment: SegmentLayout = EMPTY_SEGMENT;

  /** Each routine's frame on the stack, by the address the routine starts at. */
  public frames: Record<number, SegmentLayout> = {};

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
