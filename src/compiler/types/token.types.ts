/**
 * Token type definitions for the Pascal lexer
 */

/**
 * Enumeration of all token types recognized by the lexer
 */
export enum TokenType {
  IDENTIFIER = 0,
  NUMBER = 1,
  SYMBOL = 2,
  COMMENT = 3,
  STRING = 4,
  EOF = 5,
  RESERVED_WORD = 6,
  /** The text of an asm statement, up to its `end`. */
  ASSEMBLY = 7,
}

/**
 * Interface representing a token with its value, type, and position information
 */
export interface IToken {
  /** The string value of the token */
  value: string;
  /** The type of the token */
  type: TokenType;
  /** The line number where the token was found (1-based) */
  lineNumber: number;
}

/**
 * List of all Pascal reserved words (case-insensitive)
 */
export const RESERVED_WORDS: readonly string[] = [
  'program',
  'var',
  'begin',
  'end',
  'if',
  'then',
  'else',
  'while',
  'do',
  'repeat',
  'until',
  'for',
  'to',
  'downto',
  'case',
  'of',
  'function',
  'procedure',
  'const',
  'type',
  'array',
  'record',
  'object',
  'constructor',
  'destructor',
  'inherited',
  'string',
  'set',
  'file',
  'nil',
  'and',
  'or',
  'xor',
  'not',
  'div',
  'mod',
  'shl',
  'shr',
  'in',
  'uses',
  'unit',
  'interface',
  'implementation',
  'with',
  'label',
  'goto',
  'packed',
  'asm',
  'inline',
] as const;

/**
 * Type representing a valid Pascal reserved word
 */
export type ReservedWord = (typeof RESERVED_WORDS)[number];

/**
 * List of all Pascal symbols recognized by the lexer
 * Ordered by length (longest first) for proper matching
 */
export const SYMBOLS: readonly string[] = [
  ':=',
  '<=',
  '>=',
  '<>',
  '..',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ':',
  ';',
  ',',
  '.',
  '+',
  '-',
  '*',
  '/',
  '=',
  '<',
  '>',
  '^',
  '@',
] as const;

/**
 * Type representing a valid Pascal symbol
 */
export type Symbol = (typeof SYMBOLS)[number];
