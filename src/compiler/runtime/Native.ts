/**
 * Native procedure interface for built-in Pascal functions
 *
 * This module provides an interface for registering and calling native
 * (JavaScript-implemented) procedures and functions that can be invoked
 * from Pascal code using the CSP (Call Standard Procedure) instruction.
 */

import { INative } from '../codegen/Bytecode';

/**
 * Native procedure function signature
 * Uses unknown[] for compatibility with INative interface
 */
export type NativeProcedure = (...args: unknown[]) => unknown;

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
  RANDOM = 50,
  /** Randomize - seed random */
  RANDOMIZE = 51,
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
    this.register(StandardProcedure.ABS, 'Abs', 1, true, (x) => {
      return Math.abs(this.toNumber(x));
    });

    this.register(StandardProcedure.SQR, 'Sqr', 1, true, (x) => {
      const n = this.toNumber(x);
      return n * n;
    });

    this.register(StandardProcedure.SQRT, 'Sqrt', 1, true, (x) => {
      return Math.sqrt(this.toNumber(x));
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
      return Math.trunc(this.toNumber(x));
    });

    this.register(StandardProcedure.ROUND, 'Round', 1, true, (x) => {
      return Math.round(this.toNumber(x));
    });

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
      return String.fromCharCode(this.toNumber(x));
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
      return String(s ?? '').length;
    });

    this.register(StandardProcedure.COPY, 'Copy', 3, true, (s, index, count) => {
      const str = String(s ?? '');
      const i = this.toNumber(index);
      const c = this.toNumber(count);
      return str.substring(i - 1, i - 1 + c);
    });

    this.register(StandardProcedure.CONCAT, 'Concat', -1, true, (...args) => {
      return args.map((a) => String(a ?? '')).join('');
    });

    this.register(StandardProcedure.POS, 'Pos', 2, true, (substr, s) => {
      const str = String(s ?? '');
      const sub = String(substr ?? '');
      const pos = str.indexOf(sub);
      return pos === -1 ? 0 : pos + 1;
    });

    this.register(StandardProcedure.UPCASE, 'Upcase', 1, true, (c) => {
      return String(c ?? '').toUpperCase();
    });

    // Random functions
    this.register(StandardProcedure.RANDOM, 'Random', 1, true, (n) => {
      const max = this.toNumber(n);
      if (max === 0) {
        return Math.random();
      }
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
   * Convert a stack value to a number
   */
  private toNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
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
