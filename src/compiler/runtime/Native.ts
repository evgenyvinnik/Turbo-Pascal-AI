/**
 * Native procedure interface for built-in Pascal functions
 *
 * This module provides an interface for registering and calling native
 * (JavaScript-implemented) procedures and functions that can be invoked
 * from Pascal code using the CSP (Call Standard Procedure) instruction.
 */

import { INative } from '../codegen/Bytecode';
import { BuiltinProcedure } from '../stdlib/builtin';
import { PascalError } from '../errors/PascalError';
import { Float80, absReal, extendedOperation, fracReal, intReal, roundReal, sqrtReal, truncReal } from '../codegen/float80';

/**
 * Native procedure function signature
 * Uses unknown[] for compatibility with INative interface
 */
export type NativeProcedure = (...args: unknown[]) => unknown;

/** VM services used by generated code, outside the public Pascal routines. */
export enum InternalProcedure {
  STRING_CHARACTER_ADDRESS = 900,
  COPY_AGGREGATE_CELL = 901,
  LOAD_AGGREGATE_CELL = 902,
  /** Copy cells to a new heap block, for a value open array parameter. */
  COPY_TO_HEAP = 903,
  /** Release a block from COPY_TO_HEAP when the routine returns. */
  FREE_HEAP_COPY = 904,
  /** Run an asm block: its variables' addresses, then the block's index. */
  ASSEMBLY = 905,
  /** After a store into one case of a variant part: the record's address,
   * the part and the case. The part's bytes follow the case, and every
   * other case follows the bytes. */
  VARIANT_SYNC = 906,
  /** After a variable's bytes changed as a whole: its address and the list
   * of variant parts in its type, whose cases follow their bytes. */
  VARIANT_REFRESH = 907,
  /** An address that shows a variable's bytes as another type: an absolute
   * variable, a typecast, or the address @ takes. Its arguments are the
   * variable's address, its layout, the view's map, the byte the view starts
   * at, the variable's variant parts, whether the view shows the variable as
   * its own type, the variant cases it lies in, and the cell wanted. */
  VIEW = 908,
  /** A pointer about to be dereferenced as a type, by that type's map: an
   * address @ took of a variable of another layout becomes a view of its
   * bytes as the type. */
  RETYPE = 909,
  /** Two pointers about to be compared, as the bytes they address. */
  NORMALIZE_POINTERS = 910,
  /** Port[P] and PortW[P]: an address that reads and writes an I/O port,
   * from the port and how many bytes it moves. */
  PORT = 911,
  /** The characters from an address up to a null: a PChar, or under {$X+} a
   * zero-based array of Char, as the text it holds. */
  C_STRING = 912,
  /** The characters of a packed string type, array[M..N] of Char, from its
   * address and N: a string of all of them. */
  PACKED_STRING = 913,
  /** Stores text in a zero-based array of Char, then a null: the text, the
   * array's address and the most characters it takes. */
  STORE_C_STRING = 914,
  /** A pointer value as the 32 bits of its segment and offset, for a value
   * typecast such as LongInt(@Buffer). */
  POINTER_BITS = 915,
}

/**
 * Native procedure definition
 */
export interface NativeProcedureDef {
  /** Name of the procedure */
  name: string;
  /** Number of parameters */
  paramCount: number;
  /** Whether this is a function (returns a value) */
  isFunction: boolean;
  /** The implementation */
  implementation: NativeProcedure;
}

/**
 * Standard procedure indices
 */
export enum StandardProcedure {
  /** WriteLn - output with newline */
  WRITELN = 0,
  /** Write - output without newline */
  WRITE = 1,
  /** ReadLn - read line from input */
  READLN = 2,
  /** Read - read from input */
  READ = 3,
  /** New - allocate heap memory */
  NEW = 4,
  /** Dispose - free heap memory */
  DISPOSE = 5,
  /** Halt - terminate program */
  HALT = 6,
  /** Inc - increment variable */
  INC = 7,
  /** Dec - decrement variable */
  DEC = 8,
  /** Abs - absolute value */
  ABS = 10,
  /** Sqr - square */
  SQR = 11,
  /** Sqrt - square root */
  SQRT = 12,
  /** Sin - sine */
  SIN = 13,
  /** Cos - cosine */
  COS = 14,
  /** Arctan - arctangent */
  ARCTAN = 15,
  /** Exp - e^x */
  EXP = 16,
  /** Ln - natural log */
  LN = 17,
  /** Trunc - truncate to integer */
  TRUNC = 18,
  /** Round - round to integer */
  ROUND = 19,
  /** Ord - ordinal value */
  ORD = 20,
  /** Chr - character from ordinal */
  CHR = 21,
  /** Succ - successor */
  SUCC = 22,
  /** Pred - predecessor */
  PRED = 23,
  /** Odd - test if odd */
  ODD = 24,
  /** Eof - end of file */
  EOF = 25,
  /** Eoln - end of line */
  EOLN = 26,
  /** Length - string length */
  LENGTH = 30,
  /** Copy - substring */
  COPY = 31,
  /** Concat - string concatenation */
  CONCAT = 32,
  /** Pos - find substring */
  POS = 33,
  /** Delete - delete from string */
  DELETE = 34,
  /** Insert - insert into string */
  INSERT = 35,
  /** Str - number to string */
  STR = 36,
  /** Val - string to number */
  VAL = 37,
  /** Upcase - convert to uppercase */
  UPCASE = 38,
  /** Random - random number */
  RANDOM = 51,
  /** Randomize - seed random */
  RANDOMIZE = 52,
}

/**
 * Native procedures registry for the P-machine
 *
 * This class manages the registration and lookup of native procedures
 * that can be called from Pascal bytecode.
 */
export class NativeRegistry implements INative {
  /** Array of procedure implementations indexed by procedure number */
  procedures: Array<(...args: unknown[]) => unknown>;

  /** Map of procedure names to their indices */
  private nameToIndex: Map<string, number>;

  /** Definitions of registered procedures */
  private definitions: Map<number, NativeProcedureDef>;

  /**
   * Creates a new NativeRegistry with standard Pascal procedures
   */
  constructor() {
    this.procedures = [];
    this.nameToIndex = new Map();
    this.definitions = new Map();
    this.registerStandardProcedures();
  }

  /**
   * Register standard Pascal procedures and functions
   */
  private registerStandardProcedures(): void {
    // Math functions
    // An Extended beyond a double's precision keeps it, as the 8087 does;
    // the transcendental functions compute in a double.
    this.register(StandardProcedure.ABS, 'Abs', 1, true, (x) => {
      return x instanceof Float80 ? absReal(x) : Math.abs(this.toNumber(x));
    });

    this.register(StandardProcedure.SQR, 'Sqr', 1, true, (x) => {
      if (x instanceof Float80) return extendedOperation('*', x, x);
      const n = this.toNumber(x);
      return n * n;
    });

    this.register(StandardProcedure.SQRT, 'Sqrt', 1, true, (x) => {
      return x instanceof Float80 ? sqrtReal(x) : Math.sqrt(this.toNumber(x));
    });

    this.register(StandardProcedure.SIN, 'Sin', 1, true, (x) => {
      return Math.sin(this.toNumber(x));
    });

    this.register(StandardProcedure.COS, 'Cos', 1, true, (x) => {
      return Math.cos(this.toNumber(x));
    });

    this.register(StandardProcedure.ARCTAN, 'Arctan', 1, true, (x) => {
      return Math.atan(this.toNumber(x));
    });

    this.register(StandardProcedure.EXP, 'Exp', 1, true, (x) => {
      return Math.exp(this.toNumber(x));
    });

    this.register(StandardProcedure.LN, 'Ln', 1, true, (x) => {
      return Math.log(this.toNumber(x));
    });

    this.register(StandardProcedure.TRUNC, 'Trunc', 1, true, (x) => {
      return x instanceof Float80 ? Number(truncReal(x)) : Math.trunc(this.toNumber(x));
    });

    this.register(StandardProcedure.ROUND, 'Round', 1, true, (x) => {
      if (x instanceof Float80) return Number(roundReal(x));
      const value = this.toNumber(x);
      return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
    });

    this.register(BuiltinProcedure.FRAC, 'Frac', 1, true, (x) => {
      if (x instanceof Float80) return fracReal(x);
      const value = this.toNumber(x);
      return value - Math.trunc(value);
    });
    this.register(BuiltinProcedure.INT, 'Int', 1, true, (x) => (x instanceof Float80 ? intReal(x) : Math.trunc(this.toNumber(x))));

    // Ordinal functions
    this.register(StandardProcedure.ORD, 'Ord', 1, true, (x) => {
      if (typeof x === 'string') {
        return x.charCodeAt(0);
      }
      if (typeof x === 'boolean') {
        return x ? 1 : 0;
      }
      return this.toNumber(x);
    });

    this.register(StandardProcedure.CHR, 'Chr', 1, true, (x) => {
      const code = this.toNumber(x);
      if (!Number.isInteger(code) || code < 0 || code > 255) throw new PascalError('Character code out of range');
      return String.fromCharCode(code);
    });

    this.register(StandardProcedure.SUCC, 'Succ', 1, true, (x) => {
      if (typeof x === 'string') {
        return String.fromCharCode(x.charCodeAt(0) + 1);
      }
      return this.toNumber(x) + 1;
    });

    this.register(StandardProcedure.PRED, 'Pred', 1, true, (x) => {
      if (typeof x === 'string') {
        return String.fromCharCode(x.charCodeAt(0) - 1);
      }
      return this.toNumber(x) - 1;
    });

    this.register(StandardProcedure.ODD, 'Odd', 1, true, (x) => {
      return (this.toNumber(x) & 1) !== 0 ? 1 : 0;
    });

    // String functions
    this.register(StandardProcedure.LENGTH, 'Length', 1, true, (s) => {
      return this.toText(s).length;
    });

    this.register(StandardProcedure.COPY, 'Copy', 3, true, (s, index, count) => {
      const str = this.toText(s);
      const i = this.toNumber(index);
      const c = this.toNumber(count);
      if (i < 1 || c <= 0) return '';
      return str.slice(i - 1, i - 1 + c);
    });

    this.register(StandardProcedure.CONCAT, 'Concat', -1, true, (...args) => {
      return args.map((a) => this.toText(a)).join('');
    });

    this.register(StandardProcedure.POS, 'Pos', 2, true, (substr, s) => {
      const str = this.toText(s);
      const sub = this.toText(substr);
      const pos = str.indexOf(sub);
      return pos === -1 ? 0 : pos + 1;
    });

    this.register(StandardProcedure.UPCASE, 'Upcase', 1, true, (c) => {
      return this.toText(c).replace(/[a-z]/g, (letter) => letter.toUpperCase());
    });

    // Random functions
    this.register(StandardProcedure.RANDOM, 'Random', 1, true, (n) => {
      if (n === undefined) return Math.random();
      const max = this.toNumber(n);
      if (!Number.isInteger(max) || max < 0) throw new PascalError('Invalid random range');
      return Math.floor(Math.random() * max);
    });

    this.register(StandardProcedure.RANDOMIZE, 'Randomize', 0, false, () => {
      // JavaScript doesn't have a seedable random, so this is a no-op
    });
  }

  /**
   * Register a native procedure
   * @param index - Procedure index
   * @param name - Procedure name
   * @param paramCount - Number of parameters (-1 for variadic)
   * @param isFunction - Whether this returns a value
   * @param implementation - The implementation function
   */
  register(
    index: number,
    name: string,
    paramCount: number,
    isFunction: boolean,
    implementation: NativeProcedure
  ): void {
    this.procedures[index] = implementation;
    this.nameToIndex.set(name.toUpperCase(), index);
    this.definitions.set(index, {
      name,
      paramCount,
      isFunction,
      implementation,
    });
  }

  /**
   * Get a procedure index by name
   * @param name - Procedure name (case-insensitive)
   */
  getIndex(name: string): number | undefined {
    return this.nameToIndex.get(name.toUpperCase());
  }

  /**
   * Get a procedure definition by index
   * @param index - Procedure index
   */
  getDefinition(index: number): NativeProcedureDef | undefined {
    return this.definitions.get(index);
  }

  /**
   * Check if a procedure exists
   * @param name - Procedure name (case-insensitive)
   */
  has(name: string): boolean {
    return this.nameToIndex.has(name.toUpperCase());
  }

  /**
   * Get all registered procedure names
   */
  getNames(): string[] {
    return Array.from(this.nameToIndex.keys());
  }

  /**
   * Convert a stack value to text. The stack holds only primitives, and
   * nil reads as the empty string.
   */
  private toText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  /**
   * Convert a stack value to a number
   */
  private toNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
    if (value instanceof Float80) return value.valueOf();
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return isNaN(n) ? 0 : n;
    }
    return 0;
  }
}

/**
 * Create a new native registry with standard procedures
 */
export function createNativeRegistry(): NativeRegistry {
  return new NativeRegistry();
}

export default NativeRegistry;
