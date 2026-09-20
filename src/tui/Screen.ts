import { C, type Attr } from './palette';
import { DOUBLE, SINGLE, SHADE_DARK, SHADE_MEDIUM, TRI_DOWN, TRI_LEFT, TRI_RIGHT, TRI_UP, BLOCK_SMALL, type BoxChars } from './chars';

export interface Run {
  x: number;
  text: string;
  fg: number;
  bg: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * An 80x25 character cell buffer. Everything the IDE shows is painted into one
 * of these each frame, exactly the way the original text-mode program wrote
 * into VGA memory.
 */
export class Screen {
  readonly cols: number;
  readonly rows: number;
  readonly ch: string[];
  readonly fg: Uint8Array;
  readonly bg: Uint8Array;

  constructor(cols = 80, rows = 25) {
    this.cols = cols;
    this.rows = rows;
    this.ch = new Array<string>(cols * rows).fill(' ');
    this.fg = new Uint8Array(cols * rows);
    this.bg = new Uint8Array(cols * rows);
  }

  clear(a: Attr, ch = ' '): void {
    this.ch.fill(ch);
    this.fg.fill(a.fg);
    this.bg.fill(a.bg);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  put(x: number, y: number, ch: string, a: Attr): void {
    if (!this.inside(x, y)) return;
    const i = y * this.cols + x;
    this.ch[i] = ch;
    this.fg[i] = a.fg;
    this.bg[i] = a.bg;
  }

  /** Re-colours a cell without touching its glyph. */
  paint(x: number, y: number, a: Attr): void {
    if (!this.inside(x, y)) return;
    const i = y * this.cols + x;
    this.fg[i] = a.fg;
    this.bg[i] = a.bg;
  }

  write(x: number, y: number, text: string, a: Attr): number {
    for (let i = 0; i < text.length; i += 1) this.put(x + i, y, text[i] ?? ' ', a);
    return x + text.length;
  }

  /**
   * Writes a label where `~` brackets the keyboard accelerator, the notation
   * Turbo Vision itself used ("~F~ile").
   */
  writeHot(x: number, y: number, text: string, a: Attr, hotFg: number): number {
    let cx = x;
    let hot = false;
    for (const c of text) {
      if (c === '~') {
        hot = !hot;
        continue;
      }
      this.put(cx, y, c, hot ? { fg: hotFg, bg: a.bg } : a);
      cx += 1;
    }
    return cx;
  }

  /** Length of a `~hot~` label once the markers are removed. */
  static plainLength(text: string): number {
    return text.replace(/~/g, '').length;
  }

  static plain(text: string): string {
    return text.replace(/~/g, '');
  }

  /** Accelerator key of a `~hot~` label, lowercased. */
  static hotKey(text: string): string | null {
    const m = /~(.)~/.exec(text);
    return m?.[1] ? m[1].toLowerCase() : null;
  }

  fill(r: Rect, ch: string, a: Attr): void {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) this.put(x, y, ch, a);
    }
  }

  hLine(x: number, y: number, w: number, ch: string, a: Attr): void {
    for (let i = 0; i < w; i += 1) this.put(x + i, y, ch, a);
  }

  vLine(x: number, y: number, h: number, ch: string, a: Attr): void {
    for (let i = 0; i < h; i += 1) this.put(x, y + i, ch, a);
  }

  /** Draws a frame; the interior is left untouched. */
  frame(r: Rect, a: Attr, double = false, box?: BoxChars): void {
    const b = box ?? (double ? DOUBLE : SINGLE);
    const { x, y, w, h } = r;
    this.put(x, y, b.tl, a);
    this.put(x + w - 1, y, b.tr, a);
    this.put(x, y + h - 1, b.bl, a);
    this.put(x + w - 1, y + h - 1, b.br, a);
    this.hLine(x + 1, y, w - 2, b.t, a);
    this.hLine(x + 1, y + h - 1, w - 2, b.b, a);
    this.vLine(x, y + 1, h - 2, b.l, a);
    this.vLine(x + w - 1, y + 1, h - 2, b.r, a);
  }

  /** Frame plus interior fill. */
  box(r: Rect, a: Attr, double = false): void {
    this.fill(r, ' ', a);
    this.frame(r, a, double);
  }

  /** Centres `text` inside the top border, padded with a space either side. */
  centerTitle(r: Rect, text: string, a: Attr): void {
    if (!text) return;
    const label = ` ${text} `;
    const x = r.x + Math.max(1, Math.floor((r.w - label.length) / 2));
    this.write(x, r.y, label.slice(0, Math.max(0, r.w - 2)), a);
  }

  /** The classic drop shadow: two columns right, one row down, dimmed. */
  shadow(r: Rect): void {
    const dim = (x: number, y: number) => {
      if (!this.inside(x, y)) return;
      const i = y * this.cols + x;
      this.bg[i] = C.Black;
      this.fg[i] = C.DarkGray;
    };
    for (let y = r.y + 1; y < r.y + r.h; y += 1) {
      dim(r.x + r.w, y);
      dim(r.x + r.w + 1, y);
    }
    for (let x = r.x + 2; x < r.x + r.w + 2; x += 1) dim(x, r.y + r.h);
  }

  /**
   * Turbo Vision button shadow: a lower half block beside the face and upper
   * half blocks underneath, drawn in black over whatever is behind.
   */
  buttonShadow(r: Rect): void {
    const glyph = (x: number, y: number, ch: string) => {
      if (!this.inside(x, y)) return;
      const i = y * this.cols + x;
      this.ch[i] = ch;
      this.fg[i] = C.Black;
    };
    glyph(r.x + r.w, r.y, '\u2584');
    for (let x = r.x + 1; x <= r.x + r.w; x += 1) glyph(x, r.y + 1, '\u2580');
  }

  /**
   * Turbo Vision scrollbar: dithered track, solid thumb, triangular end caps.
   */
  scrollBar(
    x: number,
    y: number,
    len: number,
    vertical: boolean,
    pos: number,
    max: number,
    a: Attr,
  ): void {
    if (len < 2) return;
    const at = (i: number, ch: string) => {
      if (vertical) this.put(x, y + i, ch, a);
      else this.put(x + i, y, ch, a);
    };
    at(0, vertical ? TRI_UP : TRI_LEFT);
    at(len - 1, vertical ? TRI_DOWN : TRI_RIGHT);
    const enabled = max > 0;
    // Blue on cyan makes the dark shade a sparse cyan pattern, as in the IDE.
    for (let i = 1; i < len - 1; i += 1) at(i, enabled ? SHADE_MEDIUM : SHADE_DARK);
    const track = len - 2;
    if (track > 0 && enabled) {
      const t = Math.round((pos / max) * (track - 1));
      at(1 + Math.min(track - 1, Math.max(0, t)), BLOCK_SMALL);
    }
  }

  /** Splits every row into runs of identical attributes, for rendering. */
  toRuns(): Run[][] {
    const out: Run[][] = [];
    for (let y = 0; y < this.rows; y += 1) {
      const row: Run[] = [];
      let cur: Run | null = null;
      for (let x = 0; x < this.cols; x += 1) {
        const i = y * this.cols + x;
        const ch = this.ch[i] ?? ' ';
        const fg = this.fg[i] ?? 0;
        const bg = this.bg[i] ?? 0;
        if (cur === null || cur.fg !== fg || cur.bg !== bg) {
          cur = { x, text: ch, fg, bg };
          row.push(cur);
        } else {
          cur.text += ch;
        }
      }
      out.push(row);
    }
    return out;
  }
}
