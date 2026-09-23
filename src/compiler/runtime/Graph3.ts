import { PascalError } from '../errors/PascalError';
import type { GraphicsRuntime } from './GraphicsRuntime';

/** Colors 1 to 3 of Palette(0) to Palette(3) in GraphColorMode. */
const COLOR_PALETTES = [
  [2, 4, 6],
  [3, 5, 7],
  [10, 12, 14],
  [11, 13, 15],
];
/** What GraphMode shows on an RGB monitor. */
const MONO_PALETTES = [
  [1, 4, 7],
  [9, 12, 15],
];
/** The BGI driver number the Graph unit gives the CGA. */
const CGA = 1;

type Mode = 'mono' | 'color' | 'hires';

/**
 * Turbo Pascal 3's graphics, as the Graph3 unit keeps them: the CGA's
 * 320x200 four-color and 640x200 two-color screens, extended graphics and
 * turtlegraphics. The screen holds color numbers, not colors, so a new
 * palette recolors what is already drawn, as on the CGA.
 */
export class Graph3 {
  mode: Mode | null = null;
  private paletteNumber = 3;
  private background = 0;
  private hiResColor = 15;
  private table = [0, 1, 2, 3];
  private fill = Array<number>(8).fill(0xff);
  private window = { left: 0, top: 0, right: 319, bottom: 199 };
  private turtle = { x: 0, y: 0, heading: 0, pen: true, color: 3, visible: false, wrap: false };
  delay = 0;
  constructor(private g: GraphicsRuntime) {}

  reset(): void {
    this.mode = null;
    this.delay = 0;
  }
  private get active(): boolean {
    return this.mode !== null && this.g.initialized && this.g.driver === CGA;
  }
  private require(): void {
    if (!this.active) throw new PascalError('Graphics not initialized');
  }
  /** GraphMode, GraphColorMode and HiRes: a cleared screen, the BIOS
   * palette, the whole screen as the window and the turtle at home. */
  setMode(mode: Mode): void {
    const g = this.g;
    this.mode = mode;
    g.width = mode === 'hires' ? 640 : 320;
    g.height = 200;
    g.pixels = new Uint8Array(g.width * g.height);
    g.initialized = true;
    g.driver = CGA;
    g.mode = mode === 'hires' ? 4 : 0;
    g.result = 0;
    // The BIOS selects the bright palette and a black background.
    this.paletteNumber = mode === 'mono' ? 1 : 3;
    this.background = 0;
    this.hiResColor = 15;
    this.table = [0, 1, 2, 3];
    this.turtle = {
      x: 0,
      y: 0,
      heading: 0,
      pen: true,
      color: mode === 'hires' ? 1 : 3,
      visible: false,
      wrap: false,
    };
    this.setWindow(0, 0, g.width - 1, 199);
    this.showPalette();
  }
  /** TextMode leaves graphics. */
  leave(): void {
    if (!this.active) return;
    this.mode = null;
    this.g.initialized = false;
    this.g.palette = null;
    this.g.decoration = [];
    this.g.revision++;
  }
  private showPalette(): void {
    this.g.palette =
      this.mode === 'hires'
        ? [0, this.hiResColor]
        : [
            this.background,
            ...(this.mode === 'mono' ? MONO_PALETTES : COLOR_PALETTES)[this.paletteNumber]!,
          ];
    this.showTurtle();
    this.g.revision++;
  }
  palette(n: number): void {
    this.require();
    this.paletteNumber = this.mode === 'mono' ? n & 1 : n & 3;
    this.showPalette();
  }
  graphBackground(color: number): void {
    this.require();
    if (this.mode === 'hires') return;
    this.background = color & 15;
    this.showPalette();
  }
  setHiResColor(color: number): void {
    this.require();
    this.hiResColor = color & 15;
    this.showPalette();
  }
  colorTable(colors: number[]): void {
    this.require();
    this.table = colors.map((color) => color & 3);
  }
  graphWindow(x1: number, y1: number, x2: number, y2: number): void {
    this.require();
    this.setWindow(x1, y1, x2, y2);
  }
  /** TurtleWindow names the window by its center and size. */
  turtleWindow(x: number, y: number, width: number, height: number): void {
    this.require();
    const left = x - Math.trunc((width - 1) / 2),
      top = y - Math.trunc(height / 2) + 1;
    this.setWindow(left, top, left + width - 1, top + height - 1);
  }
  private setWindow(x1: number, y1: number, x2: number, y2: number): void {
    const window = {
      left: Math.max(0, Math.min(x1, x2)),
      top: Math.max(0, Math.min(y1, y2)),
      right: Math.min(this.g.width - 1, Math.max(x1, x2)),
      bottom: Math.min(this.g.height - 1, Math.max(y1, y2)),
    };
    if (window.left > window.right || window.top > window.bottom) return;
    this.window = window;
    this.home();
  }
  private inside(x: number, y: number): boolean {
    const w = this.window;
    return x >= w.left && x <= w.right && y >= w.top && y <= w.bottom;
  }
  /** A color number from 0 to 3 (0 or 1 in HiRes), or -1 for the color
   * table's entry for the dot's present color. */
  private put(x: number, y: number, color: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return;
    const index = y * this.g.width + x,
      mask = this.mode === 'hires' ? 1 : 3;
    this.g.pixels[index] = (color === -1 ? this.table[this.g.pixels[index]!]! : color) & mask;
  }
  /** Draw a set of dots once each, so a color table applies once per dot. */
  private putAll(points: Iterable<[number, number]>, color: number): void {
    const seen = new Set<number>();
    for (const [x, y] of points) {
      const key = Math.round(y) * 65536 + Math.round(x);
      if (seen.has(key)) continue;
      seen.add(key);
      this.put(x, y, color);
    }
    this.showTurtle();
    this.g.revision++;
  }
  private *linePoints(x1: number, y1: number, x2: number, y2: number): Generator<[number, number]> {
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    x2 = Math.round(x2);
    y2 = Math.round(y2);
    const dx = Math.abs(x2 - x1),
      dy = -Math.abs(y2 - y1),
      sx = x1 < x2 ? 1 : -1,
      sy = y1 < y2 ? 1 : -1;
    if (dx - dy > 100_000) return;
    let error = dx + dy;
    for (;;) {
      yield [x1, y1];
      if (x1 === x2 && y1 === y2) return;
      const twice = 2 * error;
      if (twice >= dy) {
        error += dy;
        x1 += sx;
      }
      if (twice <= dx) {
        error += dx;
        y1 += sy;
      }
    }
  }
  plot(x: number, y: number, color: number): void {
    this.require();
    this.putAll([[x, y]], color);
  }
  draw(x1: number, y1: number, x2: number, y2: number, color: number): void {
    this.require();
    this.putAll(this.linePoints(x1, y1, x2, y2), color);
  }
  /** The same radius across and down, so a circle looks round only in the
   * 320x200 modes, as the manual says. */
  circle(x: number, y: number, radius: number, color: number): void {
    this.require();
    this.putAll(this.arcPoints(x, y, 360, Math.abs(radius)), color);
  }
  /** Arc starts at X, Y, the top of its circle, and turns Angle degrees:
   * clockwise when Angle is positive, as turtle headings do. */
  arc(x: number, y: number, angle: number, radius: number, color: number): void {
    this.require();
    this.putAll(this.arcPoints(x, y + Math.abs(radius), angle, Math.abs(radius)), color);
  }
  private *arcPoints(
    cx: number,
    cy: number,
    angle: number,
    radius: number
  ): Generator<[number, number]> {
    if (radius > 10_000) return;
    const sweep = Math.max(-360, Math.min(360, angle));
    const steps = Math.max(1, Math.ceil(((Math.abs(sweep) * Math.PI) / 180) * radius * 2));
    for (let step = 0; step <= steps; step++) {
      const turn = ((sweep * step) / steps) * (Math.PI / 180);
      yield [cx + radius * Math.sin(turn), cy - radius * Math.cos(turn)];
    }
  }
  getDotColor(x: number, y: number): number {
    this.require();
    return this.inside(x, y) ? this.g.pixels[y * this.g.width + x]! : -1;
  }
  fillScreen(color: number): void {
    this.require();
    const w = this.window;
    for (let y = w.top; y <= w.bottom; y++)
      for (let x = w.left; x <= w.right; x++) this.put(x, y, color);
    this.showTurtle();
    this.g.revision++;
  }
  /** Fill the area around X, Y up to BorderColor, without the color table. */
  fillShape(x: number, y: number, fillColor: number, borderColor: number): void {
    this.require();
    const mask = this.mode === 'hires' ? 1 : 3,
      border = borderColor & mask,
      width = this.g.width;
    const seen = new Uint8Array(this.g.pixels.length);
    const pending: number[] = [];
    const visit = (xx: number, yy: number) => {
      if (!this.inside(xx, yy)) return;
      const index = yy * width + xx;
      if (seen[index] || this.g.pixels[index] === border) return;
      seen[index] = 1;
      pending.push(index);
    };
    visit(x, y);
    while (pending.length) {
      const index = pending.pop()!,
        xx = index % width,
        yy = Math.floor(index / width);
      this.g.pixels[index] = fillColor & mask;
      visit(xx + 1, yy);
      visit(xx - 1, yy);
      visit(xx, yy + 1);
      visit(xx, yy - 1);
    }
    this.showTurtle();
    this.g.revision++;
  }
  /** Pattern: eight rows of eight dots, the leftmost in the high bit. */
  pattern(rows: Uint8Array): void {
    this.fill = Array.from({ length: 8 }, (_, row) => rows[row] ?? 0);
  }
  fillPattern(x1: number, y1: number, x2: number, y2: number, color: number): void {
    this.require();
    const points: [number, number][] = [];
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
        if (((this.fill[y & 7] ?? 0) >> (7 - (x & 7))) & 1) points.push([x, y]);
    this.putAll(points, color);
  }
  /** GetPic's buffer: three words (2 for 320x200 or 1 for 640x200, the
   * width and the height), then each row's dots, leftmost in the high bits. */
  getPic(x1: number, y1: number, x2: number, y2: number): Uint8Array {
    this.require();
    const bits = this.mode === 'hires' ? 1 : 2,
      left = Math.min(x1, x2),
      top = Math.min(y1, y2),
      width = Math.abs(x2 - x1) + 1,
      height = Math.abs(y2 - y1) + 1,
      rowBytes = Math.ceil((width * bits) / 8);
    const buffer = new Uint8Array(6 + rowBytes * height);
    [bits, width, height].forEach((word, at) => {
      buffer[at * 2] = word & 255;
      buffer[at * 2 + 1] = (word >> 8) & 255;
    });
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const x = left + col,
          y = top + row;
        const dot =
          x < this.g.width && y < this.g.height && x >= 0 && y >= 0
            ? this.g.pixels[y * this.g.width + x]!
            : 0;
        const bit = col * bits;
        buffer[6 + row * rowBytes + (bit >> 3)]! |= dot << (8 - bits - (bit & 7));
      }
    return buffer;
  }
  /** PutPic draws a GetPic buffer with its lower left corner at X, Y,
   * through the color table. */
  putPic(buffer: Uint8Array, x: number, y: number): void {
    this.require();
    const word = (at: number) => (buffer[at] ?? 0) | ((buffer[at + 1] ?? 0) << 8);
    const bits = word(0) === 1 ? 1 : 2,
      width = word(2),
      height = word(4),
      rowBytes = Math.ceil((width * bits) / 8);
    const top = y - height + 1;
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const bit = col * bits;
        const dot =
          ((buffer[6 + row * rowBytes + (bit >> 3)] ?? 0) >> (8 - bits - (bit & 7))) &
          ((1 << bits) - 1);
        this.put(x + col, top + row, this.table[dot]!);
      }
    this.showTurtle();
    this.g.revision++;
  }

  // Turtlegraphics. Turtle coordinates put 0,0 in the middle of the window,
  // with Y upwards; heading 0 is up and headings turn clockwise.
  private get origin(): { x: number; y: number } {
    const w = this.window;
    return {
      x: w.left + Math.trunc((w.right - w.left) / 2),
      y: w.top + Math.trunc((w.bottom - w.top + 1) / 2),
    };
  }
  private screen(x: number, y: number): [number, number] {
    const origin = this.origin;
    return [origin.x + Math.round(x), origin.y - Math.round(y)];
  }
  home(): void {
    this.turtle.x = this.turtle.y = this.turtle.heading = 0;
    this.showTurtle();
  }
  clearScreen(): void {
    this.require();
    const w = this.window;
    for (let y = w.top; y <= w.bottom; y++)
      this.g.pixels.fill(0, y * this.g.width + w.left, y * this.g.width + w.right + 1);
    this.home();
    this.g.revision++;
  }
  /** Walk Dist steps along the heading, drawing with the pen down. Without
   * Wrap the turtle stops at the window's edge; with it, it comes back in
   * on the other side. */
  forward(distance: number): void {
    this.require();
    const t = this.turtle,
      radians = (t.heading * Math.PI) / 180,
      steps = Math.min(100_000, Math.ceil(Math.abs(distance)));
    const w = this.window,
      origin = this.origin;
    const span = { x: w.right - w.left + 1, y: w.bottom - w.top + 1 };
    const points: [number, number][] = [];
    let [x, y] = [t.x, t.y];
    const startedInside = this.inside(...this.screen(x, y));
    if (t.pen) points.push(this.screen(x, y));
    for (let step = 1; step <= steps; step++) {
      let nx = t.x + (distance * Math.sin(radians) * step) / steps,
        ny = t.y + (distance * Math.cos(radians) * step) / steps;
      if (t.wrap) {
        const wrap = (value: number, low: number, size: number) =>
          ((((value - low) % size) + size) % size) + low;
        nx = wrap(nx, w.left - origin.x, span.x);
        ny = wrap(ny, origin.y - w.bottom, span.y);
      } else if (startedInside && !this.inside(...this.screen(nx, ny))) break;
      [x, y] = [nx, ny];
      if (t.pen) points.push(this.screen(x, y));
    }
    [t.x, t.y] = [x, y];
    if (t.pen) this.putAll(points, t.color);
    else {
      this.showTurtle();
      this.g.revision++;
    }
  }
  turn(degrees: number): void {
    this.turtle.heading = (((this.turtle.heading + degrees) % 360) + 360) % 360;
    this.showTurtle();
    this.g.revision++;
  }
  setHeading(degrees: number): void {
    this.turtle.heading = 0;
    this.turn(degrees);
  }
  get heading(): number {
    return this.turtle.heading;
  }
  setPosition(x: number, y: number): void {
    this.require();
    this.turtle.x = x;
    this.turtle.y = y;
    this.showTurtle();
    this.g.revision++;
  }
  get xcor(): number {
    return Math.round(this.turtle.x);
  }
  get ycor(): number {
    return Math.round(this.turtle.y);
  }
  setPen(down: boolean): void {
    this.turtle.pen = down;
  }
  setPenColor(color: number): void {
    this.turtle.color = color === -1 ? -1 : color & (this.mode === 'hires' ? 1 : 3);
  }
  setWrap(wrap: boolean): void {
    this.turtle.wrap = wrap;
  }
  setVisible(visible: boolean): void {
    this.turtle.visible = visible;
    this.showTurtle();
    this.g.revision++;
  }
  get turtleThere(): boolean {
    return (
      this.active &&
      this.turtle.visible &&
      this.inside(...this.screen(this.turtle.x, this.turtle.y))
    );
  }
  /** The turtle, a small triangle pointing along its heading, drawn over
   * the screen rather than into it. */
  private showTurtle(): void {
    if (!this.active || !this.turtle.visible) {
      this.g.decoration = [];
      return;
    }
    const t = this.turtle,
      radians = (t.heading * Math.PI) / 180;
    const corner = (length: number, turn: number): [number, number] =>
      this.screen(t.x + length * Math.sin(radians + turn), t.y + length * Math.cos(radians + turn));
    const tip = corner(6, 0),
      left = corner(4, (140 * Math.PI) / 180),
      right = corner(4, (-140 * Math.PI) / 180);
    const color = this.g.palette?.[this.mode === 'hires' ? 1 : 3] ?? 15;
    this.g.decoration = [
      ...this.linePoints(...tip, ...left),
      ...this.linePoints(...left, ...right),
      ...this.linePoints(...right, ...tip),
    ]
      .filter(([x, y]) => this.inside(x, y))
      .map(([x, y]) => ({ x, y, color }));
  }
}
