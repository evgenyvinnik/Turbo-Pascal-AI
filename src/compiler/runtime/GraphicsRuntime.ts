import { BGI_FONT } from '../../tui/bgiFont';
import type { StrokeFont } from './StrokeFont';

/** The VGA's palette when BIOS mode 13h starts, as six-bit red, green and
 * blue: the sixteen EGA colors, a gray ramp, then rings of 24 hues at three
 * brightnesses and three saturations, and black. */
function defaultVgaPalette(): [number, number, number][] {
  const ega: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 42],
    [0, 42, 0],
    [0, 42, 42],
    [42, 0, 0],
    [42, 0, 42],
    [42, 21, 0],
    [42, 42, 42],
    [21, 21, 21],
    [21, 21, 63],
    [21, 63, 21],
    [21, 63, 63],
    [63, 21, 21],
    [63, 21, 63],
    [63, 63, 21],
    [63, 63, 63],
  ];
  const grays = [0, 5, 8, 11, 14, 17, 20, 24, 28, 32, 36, 40, 45, 50, 56, 63].map(
    (v): [number, number, number] => [v, v, v]
  );
  const ring = ([a, b, c, d, e]: number[]): [number, number, number][] =>
    [
      [a, a, e],
      [b, a, e],
      [c, a, e],
      [d, a, e],
      [e, a, e],
      [e, a, d],
      [e, a, c],
      [e, a, b],
      [e, a, a],
      [e, b, a],
      [e, c, a],
      [e, d, a],
      [e, e, a],
      [d, e, a],
      [c, e, a],
      [b, e, a],
      [a, e, a],
      [a, e, b],
      [a, e, c],
      [a, e, d],
      [a, e, e],
      [a, d, e],
      [a, c, e],
      [a, b, e],
    ] as [number, number, number][];
  const steps = [
    [0, 16, 31, 47, 63],
    [31, 39, 47, 55, 63],
    [45, 49, 54, 58, 63],
    [0, 7, 14, 21, 28],
    [14, 17, 21, 24, 28],
    [20, 22, 24, 26, 28],
    [0, 4, 8, 12, 16],
    [8, 10, 12, 14, 16],
    [11, 12, 13, 15, 16],
  ];
  return [
    ...ega,
    ...grays,
    ...steps.flatMap(ring),
    ...Array.from({ length: 8 }, (): [number, number, number] => [0, 0, 0]),
  ];
}
/** A six-bit DAC level as eight bits. */
const eightBit = (level: number) => ((level & 63) << 2) | ((level & 63) >> 4);

/** Deterministic, palette-index BGI framebuffer. Drawing works in Node and browsers. */
export class GraphicsRuntime {
  width = 640;
  height = 480;
  pixels = new Uint8Array(640 * 480);
  initialized = false;
  revision = 0;
  driver = 9;
  mode = 2;
  result = 0;
  color = 15;
  background = 0;
  x = 0;
  y = 0;
  fillColor = 15;
  fillPattern = 1;
  linePattern = 0xffff;
  thickness = 1;
  charSize = 1;
  direction = 0;
  font = 0;
  strokeFont: StrokeFont | null = null;
  customScale = { x: 1, y: 1 };
  horizontalJustify = 0;
  verticalJustify = 2;
  /** Graph3's CGA screens hold color numbers, which this maps to colors. */
  palette: number[] | null = null;
  /** BIOS mode 13h's 256 colors, as the VGA's DAC holds them in six bits
   * each, while that mode is on. */
  dac: [number, number, number][] | null = null;
  /** The DAC's ports: the entry being written or read, and which of its
   * red, green and blue comes next. */
  private dacWrite = { index: 0, component: 0 };
  private dacRead = { index: 0, component: 0 };
  /** Dots shown over the screen without being part of it: Graph3's turtle. */
  decoration: { x: number; y: number; color: number }[] = [];
  private viewport = { left: 0, top: 0, right: 639, bottom: 479, clip: true };

  reset(): void {
    this.init(9, 2);
    this.initialized = false;
  }
  init(driver: number, mode: number): void {
    if ((driver !== 0 && driver !== 9) || (driver === 9 && (mode < 0 || mode > 2))) {
      this.initialized = false;
      this.result = driver !== 0 && driver !== 9 ? -4 : -10;
      this.revision++;
      return;
    }
    this.palette = null;
    this.dac = null;
    this.decoration = [];
    this.driver = driver === 0 ? 9 : driver;
    this.mode = driver === 0 ? 2 : mode;
    this.width = 640;
    this.height = this.mode === 0 ? 200 : this.mode === 1 ? 350 : 480;
    this.pixels = new Uint8Array(this.width * this.height);
    this.initialized = true;
    this.result = 0;
    this.color = this.fillColor = 15;
    this.background = this.x = this.y = this.direction = this.font = this.horizontalJustify = 0;
    this.charSize = this.fillPattern = this.thickness = 1;
    this.strokeFont = null;
    this.customScale = { x: 1, y: 1 };
    this.linePattern = 0xffff;
    this.verticalJustify = 2;
    this.viewport = { left: 0, top: 0, right: this.width - 1, bottom: this.height - 1, clip: true };
    this.revision++;
  }
  /** BIOS mode 13h: 320 by 200 dots of 256 colors, one byte each at
   * $A000:0, and the VGA's default palette. */
  vgaMode(): void {
    this.init(9, 0);
    this.width = 320;
    this.height = 200;
    this.pixels = new Uint8Array(320 * 200);
    this.mode = 0x13;
    this.dac = defaultVgaPalette();
    this.dacWrite = { index: 0, component: 0 };
    this.dacRead = { index: 0, component: 0 };
    this.viewport = { left: 0, top: 0, right: 319, bottom: 199, clip: true };
    this.revision++;
  }
  /** Leave a BIOS graphics mode for text. */
  textMode(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.dac = null;
    this.revision++;
  }
  /** The 256 colors as 24-bit RGB, while mode 13h is on. */
  colors(): number[] | undefined {
    return this.dac?.map(
      ([red, green, blue]) => (eightBit(red) << 16) | (eightBit(green) << 8) | eightBit(blue)
    );
  }
  /** Ports 3C7h, 3C8h and 3C9h: choose an entry to read or write, then its
   * red, green and blue in turn. */
  dacPort(port: number, value?: number): number {
    const dac = this.dac;
    if (!dac) return 0xff;
    if (value === undefined) {
      if (port !== 0x3c9) return port === 0x3c8 ? this.dacWrite.index : 0;
      const level = dac[this.dacRead.index]![this.dacRead.component]!;
      if (++this.dacRead.component === 3)
        this.dacRead = { index: (this.dacRead.index + 1) & 255, component: 0 };
      return level;
    }
    if (port === 0x3c8) this.dacWrite = { index: value & 255, component: 0 };
    else if (port === 0x3c7) this.dacRead = { index: value & 255, component: 0 };
    else if (port === 0x3c9) {
      dac[this.dacWrite.index]![this.dacWrite.component] = value & 63;
      if (++this.dacWrite.component === 3)
        this.dacWrite = { index: (this.dacWrite.index + 1) & 255, component: 0 };
      this.revision++;
    }
    return 0;
  }
  /** The screen as colors, for display. */
  display(): Uint8Array {
    const palette = this.palette;
    const shown = palette ? this.pixels.map((color) => palette[color] ?? 0) : this.pixels.slice();
    for (const dot of this.decoration)
      if (dot.x >= 0 && dot.y >= 0 && dot.x < this.width && dot.y < this.height)
        shown[dot.y * this.width + dot.x] = dot.color;
    return shown;
  }
  view(left: number, top: number, right: number, bottom: number, clip: boolean): void {
    if (
      left < 0 ||
      top < 0 ||
      right >= this.width ||
      bottom >= this.height ||
      right < left ||
      bottom < top
    ) {
      this.result = -11;
      return;
    }
    this.viewport = { left, top, right, bottom, clip };
    this.x = this.y = 0;
  }
  private position(x: number, y: number): number {
    x = Math.round(x) + this.viewport.left;
    y = Math.round(y) + this.viewport.top;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    if (
      this.viewport.clip &&
      (x < this.viewport.left ||
        x > this.viewport.right ||
        y < this.viewport.top ||
        y > this.viewport.bottom)
    )
      return -1;
    return y * this.width + x;
  }
  pixel(x: number, y: number, color = this.color): void {
    const index = this.position(x, y);
    if (index >= 0) {
      this.pixels[index] = color & 15;
      this.revision++;
    }
  }
  getPixel(x: number, y: number): number {
    return this.pixels[this.position(x, y)] ?? -1;
  }
  clear(viewportOnly = false): void {
    if (!viewportOnly) this.pixels.fill(this.background);
    else
      for (let y = this.viewport.top; y <= this.viewport.bottom; y++) {
        this.pixels.fill(
          this.background,
          y * this.width + this.viewport.left,
          y * this.width + this.viewport.right + 1
        );
      }
    this.x = this.y = 0;
    this.revision++;
  }
  line(x1: number, y1: number, x2: number, y2: number): void {
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    x2 = Math.round(x2);
    y2 = Math.round(y2);
    const dx = Math.abs(x2 - x1),
      dy = -Math.abs(y2 - y1),
      sx = x1 < x2 ? 1 : -1,
      sy = y1 < y2 ? 1 : -1;
    let error = dx + dy,
      step = 0;
    // Clip very large coordinates before raster traversal to bound each VM instruction.
    if (dx - dy > 1_000_000) {
      this.result = -11;
      return;
    }
    for (;;) {
      if ((this.linePattern >>> (15 - (step % 16))) & 1) {
        const radius = this.thickness === 3 ? 1 : 0;
        for (let yy = -radius; yy <= radius; yy++)
          for (let xx = -radius; xx <= radius; xx++) this.pixel(x1 + xx, y1 + yy);
      }
      if (x1 === x2 && y1 === y2) break;
      const twice = 2 * error;
      if (twice >= dy) {
        error += dy;
        x1 += sx;
      }
      if (twice <= dx) {
        error += dx;
        y1 += sy;
      }
      step++;
    }
  }
  rectangle(x1: number, y1: number, x2: number, y2: number): void {
    this.line(x1, y1, x2, y1);
    this.line(x2, y1, x2, y2);
    this.line(x2, y2, x1, y2);
    this.line(x1, y2, x1, y1);
  }
  private fillPixel(x: number, y: number): void {
    const patterns = [
      false,
      true,
      y % 4 === 0,
      (x + y) % 4 === 0,
      (x + y) % 8 < 3,
      (x - y + 1024) % 8 < 3,
      (x - y + 1024) % 4 === 0,
      x % 4 === 0 || y % 4 === 0,
      (x + y) % 4 === 0 || (x - y + 1024) % 4 === 0,
      x % 4 < 2 !== y % 4 < 2,
      x % 8 === 0 && y % 8 === 0,
      x % 4 === 0 && y % 4 === 0,
    ];
    this.pixel(x, y, patterns[this.fillPattern] ? this.fillColor : this.background);
  }
  bar(x1: number, y1: number, x2: number, y2: number): void {
    for (
      let y = Math.max(-this.viewport.top, Math.ceil(Math.min(y1, y2)));
      y <= Math.min(this.height, Math.max(y1, y2));
      y++
    )
      for (
        let x = Math.max(-this.viewport.left, Math.ceil(Math.min(x1, x2)));
        x <= Math.min(this.width, Math.max(x1, x2));
        x++
      )
        this.fillPixel(x, y);
  }
  ellipse(
    x: number,
    y: number,
    start: number,
    end: number,
    rx: number,
    ry: number,
    fill = false,
    sector = false
  ): void {
    if (rx < 0 || ry < 0 || rx > 10000 || ry > 10000) {
      this.result = -11;
      return;
    }
    const sweep = end >= start ? end - start : end + 360 - start;
    if (fill) {
      for (
        let yy = Math.max(-ry, -y - this.viewport.top);
        yy <= Math.min(ry, this.height - y);
        yy++
      ) {
        const half =
          ry === 0 ? rx : Math.floor(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))));
        for (
          let xx = Math.max(-half, -x - this.viewport.left);
          xx <= Math.min(half, this.width - x);
          xx++
        ) {
          const angle =
            ((Math.atan2(-yy / (ry || 1), xx / (rx || 1)) * 180) / Math.PI - start + 720) % 360;
          if (!sector || sweep >= 360 || angle <= sweep) this.fillPixel(x + xx, y + yy);
        }
      }
    }
    const steps = Math.max(
      1,
      Math.ceil(((Math.max(rx, ry) * Math.min(sweep, 360) * Math.PI) / 180) * 2)
    );
    let previous: [number, number] | undefined;
    for (let i = 0; i <= steps; i++) {
      const angle = ((start + (Math.min(sweep, 360) * i) / steps) * Math.PI) / 180;
      const point: [number, number] = [
        Math.round(x + Math.cos(angle) * rx),
        Math.round(y - Math.sin(angle) * ry),
      ];
      if (previous) this.line(...previous, ...point);
      else if (sector) this.line(x, y, ...point);
      previous = point;
    }
    if (sector && previous) this.line(x, y, ...previous);
  }
  flood(x: number, y: number, border: number): void {
    const visited = new Uint8Array(this.pixels.length);
    const pending = new Int32Array(this.pixels.length);
    let start = 0,
      end = 0;
    const enqueue = (xx: number, yy: number) => {
      const index = this.position(xx, yy);
      if (index < 0 || visited[index] || this.pixels[index] === border) return;
      visited[index] = 1;
      pending[end++] = index;
    };
    enqueue(x, y);
    while (start < end) {
      const index = pending[start++]!;
      const xx = (index % this.width) - this.viewport.left,
        yy = Math.floor(index / this.width) - this.viewport.top;
      this.fillPixel(xx, yy);
      enqueue(xx + 1, yy);
      enqueue(xx - 1, yy);
      enqueue(xx, yy + 1);
      enqueue(xx, yy - 1);
    }
  }
  private textScale(): { x: number; y: number } {
    if (this.charSize === 0) return this.customScale;
    const scale = [1, 3 / 5, 2 / 3, 3 / 4, 1, 4 / 3, 5 / 3, 2, 5 / 2, 3, 4][this.charSize] ?? 1;
    return { x: scale, y: scale };
  }
  textWidth(text: string): number {
    if (!this.strokeFont || this.font === 0) return text.length * 8 * Math.max(1, this.charSize);
    let width = 0;
    for (const char of text)
      width += Math.trunc(
        (this.strokeFont.glyphs.get(char.charCodeAt(0))?.width ?? 0) * this.textScale().x
      );
    return width;
  }
  textHeight(): number {
    return this.strokeFont && this.font !== 0
      ? Math.trunc((this.strokeFont.ascent - this.strokeFont.descent + 1) * this.textScale().y)
      : 8 * Math.max(1, this.charSize);
  }
  text(text: string, x = this.x, y = this.y): void {
    const w = this.textWidth(text),
      h = this.textHeight(),
      s = this.charSize;
    x -= this.horizontalJustify === 1 ? Math.floor(w / 2) : this.horizontalJustify === 2 ? w : 0;
    y -= this.verticalJustify === 0 ? h : this.verticalJustify === 1 ? Math.floor(h / 2) : 0;
    if (this.font !== 0 && this.strokeFont) {
      const scale = this.textScale(),
        oldPattern = this.linePattern,
        oldThickness = this.thickness;
      this.linePattern = 0xffff;
      this.thickness = 1;
      let advance = 0;
      for (const char of text) {
        const glyph = this.strokeFont.glyphs.get(char.charCodeAt(0));
        if (!glyph) continue;
        let previous: [number, number] | undefined;
        for (const stroke of glyph.strokes) {
          const xx = advance + Math.trunc(stroke.x * scale.x),
            yy = Math.trunc((this.strokeFont.ascent - stroke.y) * scale.y);
          const point: [number, number] =
            this.direction === 1 ? [x + yy, y - xx] : [x + xx, y + yy];
          if (stroke.draw && previous) this.line(...previous, ...point);
          previous = point;
        }
        advance += Math.trunc(glyph.width * scale.x);
      }
      this.linePattern = oldPattern;
      this.thickness = oldThickness;
      return;
    }
    for (let i = 0; i < text.length; i++)
      for (let row = 0; row < 8; row++) {
        const bits = BGI_FONT[text.charCodeAt(i) * 8 + row] ?? 0;
        for (let col = 0; col < 8; col++)
          if (bits & (128 >>> col)) {
            for (let dy = 0; dy < s; dy++)
              for (let dx = 0; dx < s; dx++) {
                const xx = (i * 8 + col) * s + dx,
                  yy = row * s + dy;
                if (this.direction === 1) this.pixel(x + yy, y - xx);
                else this.pixel(x + xx, y + yy);
              }
          }
      }
  }
}
