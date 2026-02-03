/**
 * Character stream for reading input source code
 * Provides character-by-character access with peek-ahead capability
 */
export class Stream {
  /** The input string being read */
  private readonly input: string;

  /** Current position in the input string */
  private position: number;

  /** Current line number (1-based) */
  private lineNumber: number;

  /**
   * Creates a new Stream from an input string
   * @param input - The source code to stream
   */
  constructor(input: string) {
    this.input = input;
    this.position = 0;
    this.lineNumber = 1;
  }

  /**
   * Returns the next character and advances the position
   * @returns The next character, or null if at end of input
   */
  next(): string | null {
    const ch = this.peek();
    if (ch === '\n') {
      this.lineNumber++;
    }
    if (ch !== null) {
      this.position++;
    }
    return ch;
  }

  /**
   * Returns the next character without advancing the position
   * @returns The next character, or null if at end of input
   */
  peek(): string | null {
    if (this.position >= this.input.length) {
      return null;
    }
    return this.input[this.position] ?? null;
  }

  /**
   * Pushes back a character to re-read it
   * @param ch - The character that was previously read
   * @throws Error if at start of stream or character doesn't match
   */
  pushBack(ch: string): void {
    if (this.position === 0) {
      throw new Error("Can't push back at start of stream");
    }
    this.position--;
    const currentChar = this.input[this.position];
    if (currentChar !== ch) {
      throw new Error("Pushed back character doesn't match");
    }
    // Adjust line number if pushing back a newline
    if (ch === '\n') {
      this.lineNumber--;
    }
  }

  /**
   * Checks if the stream has reached the end of input
   * @returns true if at end of input, false otherwise
   */
  isEof(): boolean {
    return this.position >= this.input.length;
  }

  /**
   * Returns the current line number (1-based)
   * @returns The current line number
   */
  getLineNumber(): number {
    return this.lineNumber;
  }

  /**
   * Returns the current position in the stream
   * @returns The current position (0-based)
   */
  getPosition(): number {
    return this.position;
  }
}
