/**
 * Custom error class for Pascal compilation errors
 */
export class PascalError extends Error {
  /** The line number where the error occurred (1-based) */
  public readonly lineNumber: number;

  /** The column number where the error occurred (1-based) */
  public readonly columnNumber: number;

  /**
   * Creates a new PascalError
   * @param message - The error message
   * @param lineNumber - The line number where the error occurred (default: -1)
   * @param columnNumber - The column number where the error occurred (default: -1)
   */
  constructor(message: string, lineNumber = -1, columnNumber = -1) {
    super(message);
    this.name = 'PascalError';
    this.lineNumber = lineNumber;
    this.columnNumber = columnNumber;

    // Maintains proper stack trace for where the error was thrown (only available on V8).
    // Node's types declare it unconditionally, so type it as optional to keep the check.
    const ErrorWithCapture: {
      captureStackTrace?: (target: object, constructor: NewableFunction) => void;
    } = Error;
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, PascalError);
    }
  }

  /**
   * Returns a formatted string representation of the error
   */
  override toString(): string {
    if (this.lineNumber >= 0 && this.columnNumber >= 0) {
      return `${this.name} at line ${String(this.lineNumber)}, column ${String(this.columnNumber)}: ${this.message}`;
    } else if (this.lineNumber >= 0) {
      return `${this.name} at line ${String(this.lineNumber)}: ${this.message}`;
    }
    return `${this.name}: ${this.message}`;
  }
}
