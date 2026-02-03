import { TokenType, RESERVED_WORDS, SYMBOLS } from '../types';
import { PascalError } from '../errors/PascalError';
import { Stream } from './Stream';
import { Token } from './Token';

/**
 * Lexer for Pascal source code
 * Tokenizes input into a stream of tokens for parsing
 */
export class Lexer {
  /** The character stream being read */
  private readonly stream: Stream;

  /** Lookahead token for peek() functionality */
  private peekedToken: Token | null;

  /** Set of reserved words for fast lookup (lowercase) */
  private readonly reservedWordSet: Set<string>;

  /** Symbols sorted by length (longest first) for proper matching */
  private readonly sortedSymbols: readonly string[];

  /** Whether to print tokens for debugging */
  private readonly debugPrintTokens: boolean;

  /**
   * Creates a new Lexer
   * @param stream - The character stream to tokenize
   * @param debugPrintTokens - Whether to print tokens for debugging (default: false)
   */
  constructor(stream: Stream, debugPrintTokens = false) {
    this.stream = stream;
    this.peekedToken = null;
    this.debugPrintTokens = debugPrintTokens;

    // Create set of reserved words (lowercase for case-insensitive comparison)
    this.reservedWordSet = new Set(
      RESERVED_WORDS.map((word) => word.toLowerCase())
    );

    // Sort symbols by length (longest first) for proper matching
    this.sortedSymbols = [...SYMBOLS].sort((a, b) => b.length - a.length);
  }

  /**
   * Returns the next token and advances the lexer position
   * @returns The next token
   * @throws PascalError if an unexpected character is encountered
   */
  next(): Token {
    let token: Token;

    if (this.peekedToken !== null) {
      token = this.peekedToken;
      this.peekedToken = null;
    } else {
      token = this.readNextToken();
    }

    if (this.debugPrintTokens) {
      console.log(token.toString());
    }

    return token;
  }

  /**
   * Returns the next token without advancing the lexer position
   * @returns The next token
   */
  peek(): Token {
    if (this.peekedToken === null) {
      this.peekedToken = this.readNextToken();
    }
    return this.peekedToken;
  }

  /**
   * Reads the next token from the stream
   * @returns The next token
   * @throws PascalError if an unexpected character is encountered
   */
  private readNextToken(): Token {
    this.skipWhitespace();

    const lineNumber = this.stream.getLineNumber();
    const ch = this.stream.peek();

    // End of file
    if (ch === null) {
      return this.createToken('', TokenType.EOF, lineNumber);
    }

    // Check for comments first
    if (ch === '{') {
      return this.readBraceComment(lineNumber);
    }

    if (ch === '(') {
      const nextCh = this.peekAhead(1);
      if (nextCh === '*') {
        return this.readParenComment(lineNumber);
      }
    }

    // String literal
    if (ch === "'") {
      return this.readString(lineNumber);
    }

    // Number
    if (this.isDigit(ch)) {
      return this.readNumber(lineNumber);
    }

    // Identifier or reserved word
    if (this.isIdentifierStart(ch)) {
      return this.readIdentifierOrReservedWord(lineNumber);
    }

    // Symbol
    const symbol = this.tryReadSymbol();
    if (symbol !== null) {
      return this.createToken(symbol, TokenType.SYMBOL, lineNumber);
    }

    // Unknown character
    throw new PascalError(
      `Unexpected character: "${ch}"`,
      lineNumber,
      this.stream.getPosition()
    );
  }

  /**
   * Skips whitespace characters (space, tab, newline, carriage return)
   */
  private skipWhitespace(): void {
    while (true) {
      const ch = this.stream.peek();
      if (ch === null) {
        break;
      }
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.stream.next();
      } else {
        break;
      }
    }
  }

  /**
   * Peeks ahead by a specified number of characters
   * @param offset - Number of characters to look ahead (0-based)
   * @returns The character at the offset, or null if beyond end
   */
  private peekAhead(offset: number): string | null {
    // Read characters up to offset
    const chars: string[] = [];
    for (let i = 0; i <= offset; i++) {
      const ch = this.stream.next();
      if (ch === null) {
        // Push back what we read and return null
        for (let j = chars.length - 1; j >= 0; j--) {
          this.stream.pushBack(chars[j]!);
        }
        return null;
      }
      chars.push(ch);
    }

    // Get the character at offset
    const result = chars[offset] ?? null;

    // Push back all characters in reverse order
    for (let i = chars.length - 1; i >= 0; i--) {
      this.stream.pushBack(chars[i]!);
    }

    return result;
  }

  /**
   * Reads a brace-style comment { ... }
   * @param lineNumber - The starting line number
   * @returns A comment token
   */
  private readBraceComment(lineNumber: number): Token {
    let content = '';

    // Skip opening brace
    this.stream.next();

    while (true) {
      const ch = this.stream.next();
      if (ch === null) {
        throw new PascalError('Unterminated comment', lineNumber);
      }
      if (ch === '}') {
        break;
      }
      content += ch;
    }

    return this.createToken(content, TokenType.COMMENT, lineNumber);
  }

  /**
   * Reads a parenthesis-style comment (* ... *)
   * @param lineNumber - The starting line number
   * @returns A comment token
   */
  private readParenComment(lineNumber: number): Token {
    let content = '';

    // Skip opening (*
    this.stream.next(); // (
    this.stream.next(); // *

    while (true) {
      const ch = this.stream.next();
      if (ch === null) {
        throw new PascalError('Unterminated comment', lineNumber);
      }
      if (ch === '*') {
        const nextCh = this.stream.peek();
        if (nextCh === ')') {
          this.stream.next(); // consume )
          break;
        }
      }
      content += ch;
    }

    return this.createToken(content, TokenType.COMMENT, lineNumber);
  }

  /**
   * Reads a string literal (single-quoted)
   * Handles doubled quotes as escape for single quote
   * @param lineNumber - The starting line number
   * @returns A string token
   */
  private readString(lineNumber: number): Token {
    let content = '';

    // Skip opening quote
    this.stream.next();

    while (true) {
      const ch = this.stream.next();
      if (ch === null) {
        throw new PascalError('Unterminated string', lineNumber);
      }
      if (ch === "'") {
        // Check for doubled quote (escape)
        const nextCh = this.stream.peek();
        if (nextCh === "'") {
          this.stream.next(); // consume second quote
          content += "'";
        } else {
          // End of string
          break;
        }
      } else {
        content += ch;
      }
    }

    return this.createToken(content, TokenType.STRING, lineNumber);
  }

  /**
   * Reads a number (integer or real with optional E notation)
   * @param lineNumber - The starting line number
   * @returns A number token
   */
  private readNumber(lineNumber: number): Token {
    let value = '';

    // Read integer part
    while (true) {
      const ch = this.stream.peek();
      if (ch === null || !this.isDigit(ch)) {
        break;
      }
      value += this.stream.next();
    }

    // Check for decimal point
    const dotCh = this.stream.peek();
    if (dotCh === '.') {
      // Look ahead to make sure it's not '..'
      const afterDot = this.peekAhead(1);
      if (afterDot !== null && afterDot !== '.') {
        value += this.stream.next(); // consume '.'

        // Read fractional part
        while (true) {
          const ch = this.stream.peek();
          if (ch === null || !this.isDigit(ch)) {
            break;
          }
          value += this.stream.next();
        }
      }
    }

    // Check for exponent
    const expCh = this.stream.peek();
    if (expCh !== null && (expCh === 'e' || expCh === 'E')) {
      value += this.stream.next(); // consume 'e' or 'E'

      // Check for sign
      const signCh = this.stream.peek();
      if (signCh === '+' || signCh === '-') {
        value += this.stream.next();
      }

      // Read exponent digits
      let hasExponentDigits = false;
      while (true) {
        const ch = this.stream.peek();
        if (ch === null || !this.isDigit(ch)) {
          break;
        }
        value += this.stream.next();
        hasExponentDigits = true;
      }

      if (!hasExponentDigits) {
        throw new PascalError('Invalid number: missing exponent digits', lineNumber);
      }
    }

    return this.createToken(value, TokenType.NUMBER, lineNumber);
  }

  /**
   * Reads an identifier or reserved word
   * @param lineNumber - The starting line number
   * @returns An identifier or reserved word token
   */
  private readIdentifierOrReservedWord(lineNumber: number): Token {
    let value = '';

    while (true) {
      const ch = this.stream.peek();
      if (ch === null || !this.isIdentifierChar(ch)) {
        break;
      }
      value += this.stream.next();
    }

    // Check if it's a reserved word (case-insensitive)
    const lowerValue = value.toLowerCase();
    if (this.reservedWordSet.has(lowerValue)) {
      return this.createToken(value, TokenType.RESERVED_WORD, lineNumber);
    }

    return this.createToken(value, TokenType.IDENTIFIER, lineNumber);
  }

  /**
   * Tries to read a symbol from the stream
   * Uses longest-match principle
   * @returns The symbol string, or null if no symbol matches
   */
  private tryReadSymbol(): string | null {
    for (const symbol of this.sortedSymbols) {
      if (this.matchSymbol(symbol)) {
        return symbol;
      }
    }
    return null;
  }

  /**
   * Checks if the stream matches a specific symbol and consumes it
   * @param symbol - The symbol to match
   * @returns true if the symbol was matched and consumed
   */
  private matchSymbol(symbol: string): boolean {
    const chars: string[] = [];

    for (let i = 0; i < symbol.length; i++) {
      const ch = this.stream.next();
      if (ch === null) {
        // Push back what we read
        for (let j = chars.length - 1; j >= 0; j--) {
          this.stream.pushBack(chars[j]!);
        }
        return false;
      }
      chars.push(ch);
      if (ch !== symbol[i]) {
        // Push back what we read
        for (let j = chars.length - 1; j >= 0; j--) {
          this.stream.pushBack(chars[j]!);
        }
        return false;
      }
    }

    return true;
  }

  /**
   * Creates a token with the given value, type, and line number
   * @param value - The token value
   * @param type - The token type
   * @param lineNumber - The line number
   * @returns A new Token
   */
  private createToken(value: string, type: TokenType, lineNumber: number): Token {
    const token = new Token(value, type);
    token.lineNumber = lineNumber;
    return token;
  }

  /**
   * Checks if a character is a digit (0-9)
   * @param ch - The character to check
   * @returns true if the character is a digit
   */
  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  /**
   * Checks if a character can start an identifier (letter or underscore)
   * @param ch - The character to check
   * @returns true if the character can start an identifier
   */
  private isIdentifierStart(ch: string): boolean {
    return (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_'
    );
  }

  /**
   * Checks if a character can be part of an identifier (letter, digit, or underscore)
   * @param ch - The character to check
   * @returns true if the character can be part of an identifier
   */
  private isIdentifierChar(ch: string): boolean {
    return this.isIdentifierStart(ch) || this.isDigit(ch);
  }
}
