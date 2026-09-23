import { CP437 } from '../../tui/vgaFont';

/** The CRT unit's text video memory, independent of a browser or terminal. */
export class TextConsole {
  cols = 80;
  rows = 25;
  chars = Array<string>(80 * 25).fill(' ');
  attributes = new Uint8Array(80 * 25).fill(7);
  x = 1;
  y = 1;
  active = false;
  revision = 0;
  attribute = 7;
  cursorVisible = true;
  /** The mode TextMode last set, which Crt's LastMode reports. */
  lastMode = 3;
  private left = 0;
  private top = 0;
  private right = 79;
  private bottom = 24;
  getCursor(): { x: number; y: number } {
    return { x: this.left + this.x - 1, y: this.top + this.y - 1 };
  }

  reset(): void {
    this.mode(3);
    this.active = false;
  }
  mode(mode: number): void {
    this.lastMode = mode;
    this.cols = (mode & 3) < 2 ? 40 : 80;
    this.rows = mode & 256 ? 43 : 25;
    this.chars = Array<string>(this.cols * this.rows).fill(' ');
    this.attributes = new Uint8Array(this.cols * this.rows).fill(7);
    this.attribute = 7;
    this.left = this.top = 0;
    this.right = this.cols - 1;
    this.bottom = this.rows - 1;
    this.x = this.y = 1;
    this.active = true;
    this.revision++;
  }
  window(x1: number, y1: number, x2: number, y2: number): void {
    if (x1 < 1 || y1 < 1 || x2 > this.cols || y2 > this.rows || x2 < x1 || y2 < y1) return;
    this.left = x1 - 1;
    this.top = y1 - 1;
    this.right = x2 - 1;
    this.bottom = y2 - 1;
    this.x = this.y = 1;
    this.touch();
  }
  /** Crt's WindMin and WindMax: the window's corners, row in the high byte. */
  get windMin(): number {
    return (this.top << 8) | this.left;
  }
  get windMax(): number {
    return (this.bottom << 8) | this.right;
  }
  goto(x: number, y: number): void {
    if (x >= 1 && y >= 1 && x <= this.right - this.left + 1 && y <= this.bottom - this.top + 1) {
      this.x = x;
      this.y = y;
    }
    this.touch();
  }
  touch(): void {
    this.active = true;
    this.revision++;
  }
  clear(): void {
    for (let row = this.top; row <= this.bottom; row++) this.clearRow(row, this.left);
    this.x = this.y = 1;
    this.touch();
  }
  clearEol(): void {
    this.clearRow(this.top + this.y - 1, this.left + this.x - 1);
    this.touch();
  }
  insertLine(): void {
    for (let row = this.bottom; row > this.top + this.y - 1; row--) this.copyRow(row - 1, row);
    this.clearRow(this.top + this.y - 1, this.left);
    this.touch();
  }
  deleteLine(): void {
    for (let row = this.top + this.y - 1; row < this.bottom; row++) this.copyRow(row + 1, row);
    this.clearRow(this.bottom, this.left);
    this.touch();
  }
  private copyRow(from: number, to: number): void {
    for (let col = this.left; col <= this.right; col++) {
      this.chars[to * this.cols + col] = this.chars[from * this.cols + col] ?? ' ';
      this.attributes[to * this.cols + col] =
        this.attributes[from * this.cols + col] ?? this.attribute;
    }
  }
  private clearRow(row: number, start: number): void {
    for (let col = start; col <= this.right; col++) {
      this.chars[row * this.cols + col] = ' ';
      this.attributes[row * this.cols + col] = this.attribute;
    }
  }
  private newline(): void {
    this.y++;
    if (this.y > this.bottom - this.top + 1) {
      this.y--;
      for (let row = this.top; row < this.bottom; row++) this.copyRow(row + 1, row);
      this.clearRow(this.bottom, this.left);
    }
  }
  write(text: string): void {
    for (const char of text) {
      if (char === '\r') this.x = 1;
      else if (char === '\n') {
        this.x = 1;
        this.newline();
      } else if (char === '\b') this.x = Math.max(1, this.x - 1);
      else if (char === '\t') this.write(' '.repeat(8 - ((this.x - 1) % 8)));
      else if (char !== '\x07') {
        const index = (this.top + this.y - 1) * this.cols + this.left + this.x - 1;
        this.chars[index] = CP437[char.charCodeAt(0)] ?? '?';
        this.attributes[index] = this.attribute;
        this.x++;
        if (this.x > this.right - this.left + 1) {
          this.x = 1;
          this.newline();
        }
      }
    }
    this.revision++;
  }
}
