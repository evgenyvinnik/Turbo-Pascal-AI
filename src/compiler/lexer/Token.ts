import { TokenType, type IToken } from '../types';

/**
 * Token class representing a lexical token in Pascal source code
 */
export class Token implements IToken {
  /** The string value of the token */
  public readonly value: string;

  /** The type of the token */
  public readonly type: TokenType;

  /** The line number where the token was found (1-based) */
  public lineNumber: number;

  /**
   * Creates a new Token
   * @param value - The string value of the token
   * @param type - The token type
   */
  constructor(value: string, type: TokenType) {
    this.value = value;
    this.type = type;
    this.lineNumber = -1;
  }

  /**
   * Checks if this token is a specific reserved word (case-insensitive)
   * @param reservedWord - The reserved word to check against
   * @returns true if this token is the specified reserved word
   */
  isReservedWord(reservedWord: string): boolean {
    return (
      this.type === TokenType.RESERVED_WORD &&
      this.value.toLowerCase() === reservedWord.toLowerCase()
    );
  }

  /**
   * Checks if this token is a specific symbol
   * @param symbol - The symbol to check against
   * @returns true if this token is the specified symbol
   */
  isSymbol(symbol: string): boolean {
    return this.type === TokenType.SYMBOL && this.value === symbol;
  }

  /**
   * Checks if this token is equal to another token
   * The line number is not taken into account; only the type and value
   * @param other - The token to compare against
   * @returns true if tokens have the same type and value
   */
  isEqualTo(other: IToken): boolean {
    return this.type === other.type && this.value === other.value;
  }

  /**
   * Checks if this token is an identifier
   * @returns true if this token is an identifier
   */
  isIdentifier(): boolean {
    return this.type === TokenType.IDENTIFIER;
  }

  /**
   * Checks if this token is a number
   * @returns true if this token is a number
   */
  isNumber(): boolean {
    return this.type === TokenType.NUMBER;
  }

  /**
   * Checks if this token is a string literal
   * @returns true if this token is a string
   */
  isString(): boolean {
    return this.type === TokenType.STRING;
  }

  /**
   * Checks if this token is end of file
   * @returns true if this token is EOF
   */
  isEof(): boolean {
    return this.type === TokenType.EOF;
  }

  /**
   * Checks if this token is a comment
   * @returns true if this token is a comment
   */
  isComment(): boolean {
    return this.type === TokenType.COMMENT;
  }

  /**
   * Returns a string representation of the token
   * @returns A formatted string describing the token
   */
  toString(): string {
    // A reverse enum lookup is undefined for a value outside the enum.
    const names: Record<number, string | undefined> = TokenType;
    return `Token(${names[this.type] ?? 'UNKNOWN'}, "${this.value}", line ${String(this.lineNumber)})`;
  }
}
