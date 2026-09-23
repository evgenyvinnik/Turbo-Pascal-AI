/**
 * Built-in Pascal procedures and functions
 *
 * This module defines the interface for standard Pascal built-in
 * procedures and functions that are available without any uses clause.
 * These are part of the Pascal language specification.
 */

import { TypeKind, type TypeInfo } from '../symbols/Symbol';

/**
 * Parameter passing mode
 */
export enum ParamMode {
  /** Pass by value */
  VALUE = 'value',
  /** Pass by reference (VAR parameter) */
  VAR = 'var',
  /** Constant parameter (Turbo Pascal extension) */
  CONST = 'const',
}

/**
 * Parameter definition for built-in procedures/functions
 */
export interface BuiltinParam {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: TypeKind;
  /** Passing mode */
  mode: ParamMode;
  /** Whether this parameter is optional */
  optional?: boolean;
}

/**
 * Built-in procedure or function definition
 */
export interface BuiltinDef {
  /** Name of the procedure/function */
  name: string;
  /** Whether this is a function (returns a value) */
  isFunction: boolean;
  /** Return type (for functions) */
  returnType?: TypeKind;
  /** Parameters */
  params: BuiltinParam[];
  /** Whether this accepts variadic arguments (like WriteLn) */
  variadic?: boolean;
  /** Minimum number of arguments for variadic procedures */
  minArgs?: number;
  /** Description of the procedure/function */
  description: string;
  /** Standard procedure index (for code generation) */
  procedureIndex: number;
}

/**
 * Standard procedure indices for built-ins
 * These match the CSP instruction operands
 */
export enum BuiltinProcedure {
  // I/O procedures
  WRITE = 1,
  WRITELN = 0,
  READ = 3,
  READLN = 2,

  // Ordinal functions
  INC = 7,
  DEC = 8,
  ORD = 20,
  CHR = 21,
  SUCC = 22,
  PRED = 23,
  ODD = 24,

  // Math functions
  ABS = 10,
  SQR = 11,
  SQRT = 12,
  SIN = 13,
  COS = 14,
  ARCTAN = 15,
  EXP = 16,
  LN = 17,

  // Type conversion functions
  TRUNC = 18,
  ROUND = 19,
  FRAC = 27,
  INT = 28,

  // String functions
  LENGTH = 30,
  COPY = 31,
  CONCAT = 32,
  POS = 33,
  DELETE = 34,
  INSERT = 35,
  STR = 36,
  VAL = 37,
  UPCASE = 38,

  // Memory management
  NEW = 4,
  DISPOSE = 5,
  SIZEOF = 40,
  ADDR = 41,
  PTR = 42,

  // Control flow
  HALT = 6,
  EXIT = 43,
  BREAK = 44,
  CONTINUE = 45,

  // File I/O
  EOF = 25,
  EOLN = 26,
  ASSIGN = 46,
  RESET = 47,
  REWRITE = 48,
  APPEND = 49,
  CLOSE = 50,

  // Random
  RANDOM = 51,
  RANDOMIZE = 52,

  // Misc
  FILLCHAR = 60,
  MOVE = 61,
  SIZEOF_VAR = 62,
  HI = 63,
  LO = 64,
  SWAP = 65,
  HIGH = 66,
  LOW = 67,
  FLUSH = 82,
  SETTEXTBUF = 83,
  GETMEM = 84,
  FREEMEM = 85,
  MEMAVAIL = 86,
  MAXAVAIL = 87,
  RUNERROR = 88,
  PARAMCOUNT = 89,
  PARAMSTR = 90,
  SEG = 91,
  OFS = 92,
  SPTR = 93,
  TYPEOF = 94,
  MARK = 95,
  RELEASE = 96,
  SEEKEOF = 97,
  SEEKEOLN = 98,
  MKDIR = 99,
  CHDIR = 108,
  RMDIR = 109,
  GETDIR = 116,
}

/**
 * Built-in I/O procedures
 */
export const IO_BUILTINS: BuiltinDef[] = [
  {
    name: 'Write',
    isFunction: false,
    params: [],
    variadic: true,
    minArgs: 1,
    description: 'Write values to standard output without a newline',
    procedureIndex: BuiltinProcedure.WRITE,
  },
  {
    name: 'WriteLn',
    isFunction: false,
    params: [],
    variadic: true,
    minArgs: 0,
    description: 'Write values to standard output followed by a newline',
    procedureIndex: BuiltinProcedure.WRITELN,
  },
  {
    name: 'Read',
    isFunction: false,
    params: [],
    variadic: true,
    minArgs: 1,
    description: 'Read values from standard input',
    procedureIndex: BuiltinProcedure.READ,
  },
  {
    name: 'ReadLn',
    isFunction: false,
    params: [],
    variadic: true,
    minArgs: 0,
    description: 'Read values from standard input and skip to end of line',
    procedureIndex: BuiltinProcedure.READLN,
  },
  {
    name: 'Eof',
    isFunction: true,
    returnType: TypeKind.BOOLEAN,
    params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR, optional: true }],
    description: 'Test whether the supplied standard input has been consumed',
    procedureIndex: BuiltinProcedure.EOF,
  },
  {
    name: 'Eoln',
    isFunction: true,
    returnType: TypeKind.BOOLEAN,
    params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR, optional: true }],
    description: 'Test whether standard input is at the end of a line',
    procedureIndex: BuiltinProcedure.EOLN,
  },
];

/**
 * Built-in ordinal procedures and functions
 */
export const ORDINAL_BUILTINS: BuiltinDef[] = [
  {
    name: 'Inc',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VAR },
      { name: 'N', type: TypeKind.INTEGER, mode: ParamMode.VALUE, optional: true },
    ],
    description: 'Increment a variable by 1 or by N',
    procedureIndex: BuiltinProcedure.INC,
  },
  {
    name: 'Dec',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VAR },
      { name: 'N', type: TypeKind.INTEGER, mode: ParamMode.VALUE, optional: true },
    ],
    description: 'Decrement a variable by 1 or by N',
    procedureIndex: BuiltinProcedure.DEC,
  },
  {
    name: 'Ord',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.CHAR, mode: ParamMode.VALUE }],
    description: 'Return the ordinal value of a character or enumerated type',
    procedureIndex: BuiltinProcedure.ORD,
  },
  {
    name: 'Chr',
    isFunction: true,
    returnType: TypeKind.CHAR,
    params: [{ name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description: 'Return the character with the given ordinal value',
    procedureIndex: BuiltinProcedure.CHR,
  },
  {
    name: 'Succ',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description: 'Return the successor of an ordinal value',
    procedureIndex: BuiltinProcedure.SUCC,
  },
  {
    name: 'Pred',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description: 'Return the predecessor of an ordinal value',
    procedureIndex: BuiltinProcedure.PRED,
  },
  {
    name: 'Odd',
    isFunction: true,
    returnType: TypeKind.BOOLEAN,
    params: [{ name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description: 'Test if a value is odd',
    procedureIndex: BuiltinProcedure.ODD,
  },
];

/**
 * Built-in math functions
 */
export const MATH_BUILTINS: BuiltinDef[] = [
  {
    name: 'Abs',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the absolute value',
    procedureIndex: BuiltinProcedure.ABS,
  },
  {
    name: 'Sqr',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the square of a number',
    procedureIndex: BuiltinProcedure.SQR,
  },
  {
    name: 'Sqrt',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the square root of a number',
    procedureIndex: BuiltinProcedure.SQRT,
  },
  {
    name: 'Sin',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the sine of an angle in radians',
    procedureIndex: BuiltinProcedure.SIN,
  },
  {
    name: 'Cos',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the cosine of an angle in radians',
    procedureIndex: BuiltinProcedure.COS,
  },
  {
    name: 'ArcTan',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the arctangent of a number in radians',
    procedureIndex: BuiltinProcedure.ARCTAN,
  },
  {
    name: 'Exp',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return e raised to the power X',
    procedureIndex: BuiltinProcedure.EXP,
  },
  {
    name: 'Ln',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the natural logarithm of X',
    procedureIndex: BuiltinProcedure.LN,
  },
];

/**
 * Built-in type conversion functions
 */
export const CONVERSION_BUILTINS: BuiltinDef[] = [
  {
    name: 'Trunc',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Truncate a real number to an integer (towards zero)',
    procedureIndex: BuiltinProcedure.TRUNC,
  },
  {
    name: 'Round',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Round a real number to the nearest integer',
    procedureIndex: BuiltinProcedure.ROUND,
  },
  {
    name: 'Frac',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the fractional part of a real number',
    procedureIndex: BuiltinProcedure.FRAC,
  },
  {
    name: 'Int',
    isFunction: true,
    returnType: TypeKind.REAL,
    params: [{ name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE }],
    description: 'Return the integer part of a real number as a real',
    procedureIndex: BuiltinProcedure.INT,
  },
];

/**
 * Built-in string functions and procedures
 */
export const STRING_BUILTINS: BuiltinDef[] = [
  {
    name: 'Length',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'S', type: TypeKind.STRING, mode: ParamMode.VALUE }],
    description: 'Return the length of a string',
    procedureIndex: BuiltinProcedure.LENGTH,
  },
  {
    name: 'Copy',
    isFunction: true,
    returnType: TypeKind.STRING,
    params: [
      { name: 'S', type: TypeKind.STRING, mode: ParamMode.VALUE },
      { name: 'Index', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Count', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Return a substring of S starting at Index with Count characters',
    procedureIndex: BuiltinProcedure.COPY,
  },
  {
    name: 'Concat',
    isFunction: true,
    returnType: TypeKind.STRING,
    params: [],
    variadic: true,
    minArgs: 2,
    description: 'Concatenate multiple strings',
    procedureIndex: BuiltinProcedure.CONCAT,
  },
  {
    name: 'Pos',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [
      { name: 'Substr', type: TypeKind.STRING, mode: ParamMode.VALUE },
      { name: 'S', type: TypeKind.STRING, mode: ParamMode.VALUE },
    ],
    description: 'Find the position of Substr in S (0 if not found)',
    procedureIndex: BuiltinProcedure.POS,
  },
  {
    name: 'Delete',
    isFunction: false,
    params: [
      { name: 'S', type: TypeKind.STRING, mode: ParamMode.VAR },
      { name: 'Index', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Count', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Delete Count characters from S starting at Index',
    procedureIndex: BuiltinProcedure.DELETE,
  },
  {
    name: 'Insert',
    isFunction: false,
    params: [
      { name: 'Source', type: TypeKind.STRING, mode: ParamMode.VALUE },
      { name: 'S', type: TypeKind.STRING, mode: ParamMode.VAR },
      { name: 'Index', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Insert Source into S at position Index',
    procedureIndex: BuiltinProcedure.INSERT,
  },
  {
    name: 'Str',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.REAL, mode: ParamMode.VALUE },
      { name: 'S', type: TypeKind.STRING, mode: ParamMode.VAR },
    ],
    description: 'Convert a number to a string',
    procedureIndex: BuiltinProcedure.STR,
  },
  {
    name: 'Val',
    isFunction: false,
    params: [
      { name: 'S', type: TypeKind.STRING, mode: ParamMode.VALUE },
      { name: 'V', type: TypeKind.REAL, mode: ParamMode.VAR },
      { name: 'Code', type: TypeKind.INTEGER, mode: ParamMode.VAR },
    ],
    description: 'Convert a string to a number, returning error code',
    procedureIndex: BuiltinProcedure.VAL,
  },
  {
    name: 'UpCase',
    isFunction: true,
    returnType: TypeKind.CHAR,
    params: [{ name: 'C', type: TypeKind.CHAR, mode: ParamMode.VALUE }],
    description: 'Convert a character to uppercase',
    procedureIndex: BuiltinProcedure.UPCASE,
  },
];

/**
 * Built-in memory management procedures
 */
export const MEMORY_BUILTINS: BuiltinDef[] = [
  ...(['High', 'Low'] as const).map(name => ({
    name, isFunction: true, returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description: `Return the ${name === 'High' ? 'upper' : 'lower'} bound of an ordinal, array, or string`,
    procedureIndex: name === 'High' ? BuiltinProcedure.HIGH : BuiltinProcedure.LOW,
  })),
  {
    name: 'New',
    isFunction: false,
    params: [{ name: 'P', type: TypeKind.POINTER, mode: ParamMode.VAR }],
    description: 'Allocate memory for a pointer variable',
    procedureIndex: BuiltinProcedure.NEW,
  },
  {
    name: 'Dispose',
    isFunction: false,
    params: [{ name: 'P', type: TypeKind.POINTER, mode: ParamMode.VAR }],
    description: 'Free memory allocated for a pointer variable',
    procedureIndex: BuiltinProcedure.DISPOSE,
  },
  {
    name: 'SizeOf',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description: 'Return the size in bytes of a type or variable',
    procedureIndex: BuiltinProcedure.SIZEOF,
  },
];

/**
 * Built-in control flow procedures
 */
export const CONTROL_BUILTINS: BuiltinDef[] = [
  {
    name: 'Halt',
    isFunction: false,
    params: [
      { name: 'ExitCode', type: TypeKind.INTEGER, mode: ParamMode.VALUE, optional: true },
    ],
    description: 'Terminate program execution with an optional exit code',
    procedureIndex: BuiltinProcedure.HALT,
  },
  {
    name: 'Exit',
    isFunction: false,
    params: [],
    description: 'Exit the current procedure or function',
    procedureIndex: BuiltinProcedure.EXIT,
  },
  {
    name: 'Break',
    isFunction: false,
    params: [],
    description: 'Break out of the current loop',
    procedureIndex: BuiltinProcedure.BREAK,
  },
  {
    name: 'Continue',
    isFunction: false,
    params: [],
    description: 'Continue to the next iteration of the current loop',
    procedureIndex: BuiltinProcedure.CONTINUE,
  },
];

/**
 * Built-in random number functions
 */
export const RANDOM_BUILTINS: BuiltinDef[] = [
  {
    name: 'Random',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [
      { name: 'Range', type: TypeKind.INTEGER, mode: ParamMode.VALUE, optional: true },
    ],
    description: 'Return a random number (0..Range-1 or 0.0..1.0)',
    procedureIndex: BuiltinProcedure.RANDOM,
  },
  {
    name: 'Randomize',
    isFunction: false,
    params: [],
    description: 'Initialize the random number generator',
    procedureIndex: BuiltinProcedure.RANDOMIZE,
  },
];

/** Standard file services operate on the browser's Pascal virtual drive. */
export const FILE_BUILTINS: BuiltinDef[] = [
  { name: 'Assign', isFunction: false, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }, { name: 'Name', type: TypeKind.STRING, mode: ParamMode.VALUE }], description: 'Associate a file variable with a file name', procedureIndex: 46 },
  ...(['Reset', 'Rewrite', 'Append', 'Close'] as const).map((name, offset): BuiltinDef => ({ name, isFunction: false, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }, ...(offset < 2 ? [{ name: 'RecordSize', type: TypeKind.INTEGER, mode: ParamMode.VALUE, optional: true }] : [])], description: `${name} a file`, procedureIndex: 47 + offset })),
  ...(['FilePos', 'FileSize'] as const).map((name, offset): BuiltinDef => ({ name, isFunction: true, returnType: TypeKind.INTEGER, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }], description: `${name} in records`, procedureIndex: 66 + offset })),
  { name: 'Seek', isFunction: false, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }, { name: 'Position', type: TypeKind.INTEGER, mode: ParamMode.VALUE }], description: 'Move to a file record', procedureIndex: 68 },
  { name: 'Erase', isFunction: false, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }], description: 'Remove a closed file', procedureIndex: 69 },
  { name: 'Rename', isFunction: false, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }, { name: 'Name', type: TypeKind.STRING, mode: ParamMode.VALUE }], description: 'Rename a closed file', procedureIndex: 74 },
  { name: 'IOResult', isFunction: true, returnType: TypeKind.INTEGER, params: [], description: 'Return the last I/O result', procedureIndex: 75 },
  { name: 'Truncate', isFunction: false, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }], description: 'Truncate a file at its current position', procedureIndex: 76 },
  ...(['BlockRead', 'BlockWrite'] as const).map((name, offset): BuiltinDef => ({ name, isFunction: false, params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }, { name: 'Buffer', type: TypeKind.INTEGER, mode: ParamMode.VAR }, { name: 'Count', type: TypeKind.INTEGER, mode: ParamMode.VALUE }, { name: 'Result', type: TypeKind.INTEGER, mode: ParamMode.VAR, optional: true }], description: `${name} binary records`, procedureIndex: 80 + offset })),
];

/**
 * All built-in procedures and functions
 */
/**
 * The rest of Turbo Pascal's System unit: memory, byte and program routines
 */
export const SYSTEM_BUILTINS: BuiltinDef[] = [
  {
    name: 'FillChar',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.POINTER, mode: ParamMode.VAR },
      { name: 'Count', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Value', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Fill the first Count bytes of a variable with a byte or character',
    procedureIndex: BuiltinProcedure.FILLCHAR,
  },
  {
    name: 'Move',
    isFunction: false,
    params: [
      { name: 'Source', type: TypeKind.POINTER, mode: ParamMode.VAR },
      { name: 'Dest', type: TypeKind.POINTER, mode: ParamMode.VAR },
      { name: 'Count', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Copy Count bytes from one variable to another',
    procedureIndex: BuiltinProcedure.MOVE,
  },
  ...(
    [
      ['Hi', BuiltinProcedure.HI, 'Return the high-order byte of a word'],
      ['Lo', BuiltinProcedure.LO, 'Return the low-order byte of a word'],
      ['Swap', BuiltinProcedure.SWAP, 'Exchange the high- and low-order bytes of a word'],
    ] as const
  ).map(([name, procedureIndex, description]) => ({
    name,
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description,
    procedureIndex,
  })),
  {
    name: 'Addr',
    isFunction: true,
    returnType: TypeKind.POINTER,
    params: [{ name: 'X', type: TypeKind.POINTER, mode: ParamMode.VAR }],
    description: 'Return the address of a variable, as @ does',
    procedureIndex: BuiltinProcedure.ADDR,
  },
  {
    name: 'Flush',
    isFunction: false,
    params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR }],
    description: 'Write out the buffer of a text file open for output',
    procedureIndex: BuiltinProcedure.FLUSH,
  },
  {
    name: 'SetTextBuf',
    isFunction: false,
    params: [
      { name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR },
      { name: 'Buf', type: TypeKind.POINTER, mode: ParamMode.VAR },
      { name: 'Size', type: TypeKind.INTEGER, mode: ParamMode.VALUE, optional: true },
    ],
    description: 'Give a text file its own buffer',
    procedureIndex: BuiltinProcedure.SETTEXTBUF,
  },
  ...(['GetMem', 'FreeMem'] as const).map((name) => ({
    name,
    isFunction: false,
    params: [
      { name: 'P', type: TypeKind.POINTER, mode: ParamMode.VAR },
      { name: 'Size', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: name === 'GetMem' ? 'Allocate a heap block of Size bytes' : 'Release a block from GetMem',
    procedureIndex: name === 'GetMem' ? BuiltinProcedure.GETMEM : BuiltinProcedure.FREEMEM,
  })),
  ...(['MemAvail', 'MaxAvail'] as const).map((name) => ({
    name,
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: name === 'MemAvail' ? 'Return the free heap space' : 'Return the largest free heap block',
    procedureIndex: name === 'MemAvail' ? BuiltinProcedure.MEMAVAIL : BuiltinProcedure.MAXAVAIL,
  })),
  {
    name: 'RunError',
    isFunction: false,
    params: [{ name: 'ErrorCode', type: TypeKind.INTEGER, mode: ParamMode.VALUE, optional: true }],
    description: 'Stop the program with a run-time error',
    procedureIndex: BuiltinProcedure.RUNERROR,
  },
  {
    name: 'ParamCount',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the number of command-line parameters',
    procedureIndex: BuiltinProcedure.PARAMCOUNT,
  },
  ...(
    [
      ['Seg', 'the segment of a variable, always 0 in the P-machine'],
      ['CSeg', 'the code segment, always 0 in the P-machine'],
      ['DSeg', 'the data segment, always 0 in the P-machine'],
      ['SSeg', 'the stack segment, always 0 in the P-machine'],
    ] as const
  ).map(([name, description]) => ({
    name,
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: name === 'Seg' ? [{ name: 'X', type: TypeKind.POINTER, mode: ParamMode.VAR }] : [],
    description,
    procedureIndex: BuiltinProcedure.SEG,
  })),
  ...(['SeekEof', 'SeekEoln'] as const).map((name) => ({
    name,
    isFunction: true,
    returnType: TypeKind.BOOLEAN,
    params: [{ name: 'F', type: TypeKind.FILE, mode: ParamMode.VAR, optional: true }],
    description: `Skip blanks${name === 'SeekEof' ? ' and line ends' : ''}, then test for ${name === 'SeekEof' ? 'the end of the file' : 'the end of the line'}`,
    procedureIndex: name === 'SeekEof' ? BuiltinProcedure.SEEKEOF : BuiltinProcedure.SEEKEOLN,
  })),
  ...(
    [
      ['MkDir', BuiltinProcedure.MKDIR, 'Make a directory on the virtual drive'],
      ['ChDir', BuiltinProcedure.CHDIR, 'Change the current directory'],
      ['RmDir', BuiltinProcedure.RMDIR, 'Remove an empty directory'],
    ] as const
  ).map(([name, procedureIndex, description]) => ({
    name,
    isFunction: false,
    params: [{ name: 'S', type: TypeKind.STRING, mode: ParamMode.VALUE }],
    description,
    procedureIndex,
  })),
  {
    name: 'GetDir',
    isFunction: false,
    params: [
      { name: 'D', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'S', type: TypeKind.STRING, mode: ParamMode.VAR },
    ],
    description: 'Get the current directory of a drive (0 is the current drive)',
    procedureIndex: BuiltinProcedure.GETDIR,
  },
  {
    name: 'TypeOf',
    isFunction: true,
    returnType: TypeKind.POINTER,
    params: [{ name: 'X', type: TypeKind.POINTER, mode: ParamMode.VALUE }],
    description: "An object type's identity, as Turbo Pascal's method-table pointer serves",
    procedureIndex: BuiltinProcedure.TYPEOF,
  },
  ...(['Mark', 'Release'] as const).map((name) => ({
    name,
    isFunction: false,
    params: [{ name: 'P', type: TypeKind.POINTER, mode: ParamMode.VAR }],
    description:
      name === 'Mark' ? 'Record the current heap top in a pointer' : 'Release the heap back to a marked top',
    procedureIndex: name === 'Mark' ? BuiltinProcedure.MARK : BuiltinProcedure.RELEASE,
  })),
  {
    name: 'Ofs',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [{ name: 'X', type: TypeKind.POINTER, mode: ParamMode.VAR }],
    description: 'The address of a variable within its segment',
    procedureIndex: BuiltinProcedure.OFS,
  },
  {
    name: 'SPtr',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'The current stack pointer',
    procedureIndex: BuiltinProcedure.SPTR,
  },
  {
    name: 'Ptr',
    isFunction: true,
    returnType: TypeKind.POINTER,
    params: [
      { name: 'Seg', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Ofs', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'A pointer to a segment and offset; the P-machine keeps one address space',
    procedureIndex: BuiltinProcedure.PTR,
  },
  {
    name: 'ParamStr',
    isFunction: true,
    returnType: TypeKind.STRING,
    params: [{ name: 'Index', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
    description: 'Return a command-line parameter; ParamStr(0) is the program',
    procedureIndex: BuiltinProcedure.PARAMSTR,
  },
];

export const ALL_BUILTINS: BuiltinDef[] = [
  ...IO_BUILTINS,
  ...ORDINAL_BUILTINS,
  ...MATH_BUILTINS,
  ...CONVERSION_BUILTINS,
  ...STRING_BUILTINS,
  ...MEMORY_BUILTINS,
  ...CONTROL_BUILTINS,
  ...RANDOM_BUILTINS,
  ...FILE_BUILTINS,
  ...SYSTEM_BUILTINS,
];

/**
 * Map of built-in names to their definitions (case-insensitive)
 */
export const BUILTIN_MAP: Map<string, BuiltinDef> = new Map(
  ALL_BUILTINS.map((def) => [def.name.toUpperCase(), def])
);

/**
 * Check if a name is a built-in procedure or function
 * @param name - The name to check (case-insensitive)
 */
export function isBuiltin(name: string): boolean {
  return BUILTIN_MAP.has(name.toUpperCase());
}

/**
 * Get a built-in definition by name
 * @param name - The name to look up (case-insensitive)
 */
export function getBuiltin(name: string): BuiltinDef | undefined {
  return BUILTIN_MAP.get(name.toUpperCase());
}

/**
 * Get the return type info for a built-in function
 * @param name - The function name
 */
export function getBuiltinReturnType(name: string): TypeInfo | undefined {
  const builtin = getBuiltin(name);
  if (builtin && builtin.isFunction && builtin.returnType) {
    return {
      kind: builtin.returnType,
      size: getTypeSize(builtin.returnType),
    };
  }
  return undefined;
}

/**
 * Get the size of a type kind
 */
function getTypeSize(kind: TypeKind): number {
  switch (kind) {
    case TypeKind.BOOLEAN:
    case TypeKind.CHAR:
      return 1;
    case TypeKind.INTEGER:
      return 2;
    case TypeKind.REAL:
      return 8;
    case TypeKind.STRING:
      return 256; // Default string size
    case TypeKind.POINTER:
      return 4;
    default:
      return 0;
  }
}

export default {
  ALL_BUILTINS,
  BUILTIN_MAP,
  isBuiltin,
  getBuiltin,
  getBuiltinReturnType,
  BuiltinProcedure,
  ParamMode,
};
