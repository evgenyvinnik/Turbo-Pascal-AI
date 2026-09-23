import { PascalError } from './PascalError';

/** Borland TP 7 Programmer's Reference, chapter 4. Error numbers are part of
 * the language/tool interface; explanatory detail remains our own diagnostic.
 * https://turbopascal.nl/docs/Turbo_Pascal_Version_7.0_Programmers_Reference_1992.pdf
 */
export const COMPILER_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  2: 'Identifier expected', 3: 'Unknown identifier', 4: 'Duplicate identifier',
  5: 'Syntax error', 6: 'Error in real constant', 7: 'Error in integer constant',
  8: 'String constant exceeds line', 10: 'Unexpected end of file',
  12: 'Type identifier expected', 15: 'File not found', 17: 'Invalid compiler directive',
  19: 'Undefined type in pointer definition', 20: 'Variable identifier expected',
  21: 'Error in type', 23: 'Set base type out of range', 25: 'Invalid string length',
  26: 'Type mismatch', 27: 'Invalid subrange base type', 28: 'Lower bound greater than upper bound',
  29: 'Ordinal type expected', 31: 'Constant expected', 32: 'Integer or real constant expected',
  33: 'Pointer type identifier expected', 34: 'Invalid function result type',
  35: 'Label identifier expected', 36: 'BEGIN expected', 37: 'END expected',
  38: 'Integer expression expected', 39: 'Ordinal expression expected',
  40: 'Boolean expression expected', 41: 'Operand types do not match operator',
  42: 'Error in expression', 44: 'Field identifier expected', 50: 'DO expected',
  54: 'OF expected', 55: 'INTERFACE expected', 57: 'THEN expected',
  58: 'TO or DOWNTO expected', 59: 'Undefined forward', 61: 'Invalid typecast',
  62: 'Division by zero', 63: 'Invalid file type',
  64: 'Cannot Read or Write variables of this type', 65: 'Pointer variable expected',
  67: 'String expression expected', 68: 'Circular unit reference', 69: 'Unit name mismatch',
  73: 'IMPLEMENTATION expected', 75: 'Record or object variable expected',
  76: 'Constant out of range', 77: 'File variable expected',
  79: 'Integer or real expression expected', 81: 'Label already defined',
  82: 'Undefined label in preceding statement part', 84: 'UNIT expected',
  85: '";" expected', 86: '":" expected', 87: '"," expected',
  88: '"(" expected', 89: '")" expected', 90: '"=" expected',
  91: '":=" expected', 92: '"[" or "(." expected', 93: '"]" or ".)" expected',
  94: '"." expected', 95: '".." expected', 104: 'Ordinal variable expected',
  108: 'Overflow in arithmetic operation', 109: 'No enclosing FOR, WHILE, or REPEAT statement',
  113: 'Error in statement', 116: 'Must be in 8087 mode to compile this',
  117: 'Target address not found', 119: 'No inherited methods are accessible here',
  121: 'Invalid qualifier', 162: 'ASM expected',
};

export const RUNTIME_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  1: 'Invalid function number', 2: 'File not found', 3: 'Path not found',
  4: 'Too many open files', 5: 'File access denied', 6: 'Invalid file handle',
  12: 'Invalid file access code', 15: 'Invalid drive number',
  16: 'Cannot remove current directory', 17: 'Cannot rename across drives',
  18: 'No more files', 100: 'Disk read error', 101: 'Disk write error',
  102: 'File not assigned', 103: 'File not open', 104: 'File not open for input',
  105: 'File not open for output', 106: 'Invalid numeric format',
  200: 'Division by zero', 201: 'Range check error', 202: 'Stack overflow error',
  203: 'Heap overflow error', 204: 'Invalid pointer operation',
  205: 'Floating point overflow', 206: 'Floating point underflow',
  207: 'Invalid floating point operation', 210: 'Object not initialized',
  211: 'Call to abstract method', 215: 'Arithmetic overflow error',
};

export interface PascalDiagnostic {
  phase: 'compiler' | 'runtime';
  /** Absent when an implementation limit has no honest Borland equivalent. */
  code?: number;
  message: string;
  detail: string;
  lineNumber: number;
  columnNumber: number;
  sourceFile?: string;
}

const EXPECTED: Readonly<Record<string, number>> = {
  begin: 36, end: 37, do: 50, of: 54, interface: 55, then: 57,
  implementation: 73, unit: 84, asm: 162,
  ';': 85, ':': 86, ',': 87, '(': 88, ')': 89, '=': 90, ':=': 91,
  '[': 92, ']': 93, '.': 94, '..': 95,
};
const COMPILE_PATTERNS: readonly (readonly [RegExp, number])[] = [
  [/^Expected identifier,/, 2], [/^(?:Undeclared (?:identifier|variable|procedure or function)|Unknown type)\b/, 3],
  [/^Duplicate (?:identifier|field)\b/, 4], [/^Unexpected character:|^Unexpected token after program:/, 5],
  [/^Invalid number: missing exponent digits$/, 6], [/^Invalid hexadecimal integer$|^Integer constant out of range$/, 7],
  [/^Unterminated string$/, 8], [/^Unterminated comment$|^Unexpected end of file$/, 10],
  [/^(?:Unknown unit|Unit source not found|Include file not found|File not found)\b/, 15],
  [/^Invalid compiler directive\b/, 17], [/^Unknown pointer target type$/, 19],
  [/^Variable required$/, 20], [/^Expected type,/, 21], [/^Set range must be within 0\.\.255$/, 23],
  [/^String capacity must be/, 25], [/^Type mismatch|^VAR string parameters require matching capacities$|^Incompatible comparison operands$/, 26],
  [/^Invalid subrange bounds$/, 27], [/^(?:Subrange|Case range) lower bound exceeds upper bound$/, 28],
  [/^Set elements must have an ordinal type$/, 29], [/^(?:Constant expected|Constant expression expected)/, 31],
  [/^Numeric constant expression expected$/, 32], [/^Typed pointer required$/, 33],
  [/^Functions returning arrays or records are not supported$/, 34], [/^Label expected$|^Undeclared label$/, 35],
  [/^Integer operands required$/, 38], [/^Ordinal set element required$|^Case selector must be ordinal$/, 39],
  [/^Boolean expression expected$/, 40],
  [/^IN requires|^Invalid set operator$|^AND, OR and XOR require|^NOT requires|^Numeric operands required/, 41],
  [/^Unexpected token in expression:|^Invalid constant expression$/, 42], [/^Unknown record field\b/, 44],
  [/^Expected 'to' or 'downto',/, 58], [/^Unresolved forward declaration\b/, 59],
  [/^Ordinal typecast required$|^Typecast requires one value$|^Invalid typecast/, 61], [/^Division by zero/, 62],
  [/^ReadLn\/WriteLn require a text file$|^Untyped files require BlockRead\/BlockWrite$/, 63],
  [/^Read requires a scalar or string variable$|^Write requires a scalar or string value$/, 64],
  [/^Pointer variable required$/, 65], [/^Concat requires strings$/, 67],
  [/^Circular (?:unit|interface) reference\b/, 68], [/^Unit name mismatch\b/, 69],
  [/^WITH requires a record$/, 75], [/^Set element out of range$|^Character code out of range$/, 76],
  [/^File variable required$/, 77], [/^Numeric operand expected$|^Str requires a numeric argument$/, 79],
  [/^Duplicate label definition$/, 81], [/^Undefined label$/, 82],
  [/^Inc and Dec require an ordinal variable$/, 104], [/^Arithmetic overflow$/, 108],
  [/^\w+ is only valid inside a loop$/, 109], [/^Unexpected token in statement:/, 113],
  [/^Array or string expected$|^An array variable is required$/, 121],
];
const RUNTIME_PATTERNS: readonly (readonly [RegExp, number])[] = [
  [/^File not found\b/, 2], [/^Invalid file name$|^Path not found\b/, 3],
  [/^Read past end of file$/, 100], [/^Disk full$/, 101], [/^File is not assigned$/, 102],
  [/^File is not open$/, 103], [/^File is not open for reading$/, 104], [/^File is not open for writing$/, 105],
  [/^Invalid (?:integer|real|boolean) input:|^Invalid (?:number|boolean) in file$|^(?:Integer|Real) input out of range$/, 106],
  [/^Division by zero$/, 200], [/^Range check error|^Array index .* out of bounds|^String index out of bounds$|^Set element out of range$|^Character code out of range$/, 201],
  [/^Stack overflow$/, 202], [/^Heap overflow$/, 203], [/^Invalid or disposed pointer$/, 204],
  [/^Real overflow$/, 205], [/^Invalid numeric result$/, 207],
  [/^Object not initialized$/, 210], [/^Call to abstract method$/, 211], [/^Arithmetic overflow$/, 215],
];

/** Presentation adapter: never changes exception identity or source coordinates. */
export function describePascalDiagnostic(error: unknown, phase: PascalDiagnostic['phase']): PascalDiagnostic {
  const detail = error instanceof Error ? error.message : String(error);
  let code: number | undefined;
  if (error instanceof PascalError) {
    if (phase === 'compiler') {
      const expected = /^Expected '([^']+)', found /.exec(detail)?.[1];
      code = expected ? EXPECTED[expected.toLowerCase()] : undefined;
      code ??= COMPILE_PATTERNS.find(([pattern]) => pattern.test(detail))?.[1];
    } else {
      const explicit = /^(?:I\/O error|Run-time error|Runtime error) (\d+)\b/.exec(detail);
      code = explicit ? Number(explicit[1]) : RUNTIME_PATTERNS.find(([pattern]) => pattern.test(detail))?.[1];
      if (code !== undefined && (code < 0 || code > 255)) code = undefined;
    }
  }
  const messages = phase === 'compiler' ? COMPILER_ERROR_MESSAGES : RUNTIME_ERROR_MESSAGES;
  const sourceFile = error instanceof PascalError && 'sourceFile' in error && typeof error.sourceFile === 'string' ? error.sourceFile : undefined;
  return {
    phase, ...(code === undefined ? {} : { code }), message: code === undefined ? detail : messages[code] ?? detail,
    detail, lineNumber: error instanceof PascalError ? error.lineNumber : -1,
    columnNumber: error instanceof PascalError ? error.columnNumber : -1,
    ...(sourceFile === undefined ? {} : { sourceFile }),
  };
}

export function formatPascalDiagnostic(diagnostic: PascalDiagnostic): string {
  const prefix = diagnostic.phase === 'runtime' ? 'Run-time error' : 'Error';
  return `${prefix}${diagnostic.code === undefined ? '' : ` ${String(diagnostic.code)}`}: ${diagnostic.message}`;
}
