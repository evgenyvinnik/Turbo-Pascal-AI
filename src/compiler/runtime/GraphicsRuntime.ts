import type { BgiDriverBackend } from './BgiKernel';
import { BGI_FONT } from '../../tui/bgiFont';
import type { StrokeFont } from './StrokeFont';
import { defined } from '../../utils/defined';

/** The VGA's palette when BIOS mode 13h starts, as six-bit red, green and
 * blue: the sixteen EGA colors, a gray ramp, then rings of 24 hues at three
 * brightnesses and three saturations, and black. */
export function defaultVgaPalette(): [number, number, number][] {
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

/** The VGA's DAC in its 16-colour modes: the EGA's 64 colours, then black.
 * Bits 2, 1 and 0 of a colour are two thirds of red, green and blue,
 * and bits 5, 4 and 3 a third more. */
export function egaDac(): [number, number, number][] {
  const level = (colour: number, high: number, low: number) =>
    ((colour >> high) & 1) * 42 + ((colour >> low) & 1) * 21;
  return Array.from({ length: 256 }, (_, colour): [number, number, number] =>
    colour < 64 ? [level(colour, 2, 5), level(colour, 1, 4), level(colour, 0, 3)] : [0, 0, 0]
  );
}
/** The palette registers the EGA and VGA start with: the sixteen colours
 * as entries of the 64, brown being 20. */
export const DEFAULT_PALETTE = [0, 1, 2, 3, 4, 5, 20, 7, 56, 57, 58, 59, 60, 61, 62, 63];
/** A built-in driver's mode: its name, size, colours and pages, and for
 * CGA's four-colour modes which of its palettes it shows. */
export interface GraphMode {
  name: string;
  width: number;
  height: number;
  colours: 2 | 4 | 16;
  pages: number;
  cga?: number;
}
const cga = (adapter: string): Record<number, GraphMode> =>
  Object.fromEntries(
    [0, 1, 2, 3].map((palette): [number, GraphMode] => [
      palette,
      {
        name: `320 x 200 ${adapter} C${String(palette)}`,
        width: 320,
        height: 200,
        colours: 4,
        pages: 1,
        cga: palette,
      },
    ])
  );
/** The drivers the emulated VGA runs as Borland's CGA and EGAVGA drivers do,
 * by number, and their modes. A VGA has the modes of the CGA, MCGA and EGA
 * before it; the pages are what each mode's share of its 256K holds. */
export const BUILT_IN_MODES: Record<number, Record<number, GraphMode>> = {
  1: {
    ...cga('CGA'),
    4: { name: '640 x 200 CGA', width: 640, height: 200, colours: 2, pages: 1 },
  },
  2: {
    ...cga('MCGA'),
    4: { name: '640 x 200 MCGA', width: 640, height: 200, colours: 2, pages: 1 },
    5: { name: '640 x 480 MCGA', width: 640, height: 480, colours: 2, pages: 1 },
  },
  3: {
    0: { name: '640 x 200 EGA', width: 640, height: 200, colours: 16, pages: 4 },
    1: { name: '640 x 350 EGA', width: 640, height: 350, colours: 16, pages: 2 },
  },
  4: {
    0: { name: '640 x 200 EGA64', width: 640, height: 200, colours: 16, pages: 1 },
    1: { name: '640 x 350 EGA64', width: 640, height: 350, colours: 4, pages: 1 },
  },
  5: { 3: { name: '640 x 350 EGA MONO', width: 640, height: 350, colours: 2, pages: 2 } },
  9: {
    0: { name: '640 x 200 VGA', width: 640, height: 200, colours: 16, pages: 4 },
    1: { name: '640 x 350 VGA', width: 640, height: 350, colours: 16, pages: 2 },
    2: { name: '640 x 480 VGA', width: 640, height: 480, colours: 16, pages: 1 },
  },
};
/** CGA's four-colour palettes 0 to 3: colours 1, 2 and 3 of each, as the
 * sixteen colours number them; colour 0 is the background. */
const CGA_PALETTES = [
  [10, 12, 14],
  [11, 13, 15],
  [2, 4, 6],
  [3, 5, 7],
];

/** Deterministic, palette-index BGI framebuffer. Drawing works in Node and browsers. */
export class GraphicsRuntime {
  width = 640;
  height = 480;
  pixels: Uint8Array = new Uint8Array(640 * 480);
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
  /** The built-in driver's mode, while one is on. */
  modeInfo: GraphMode = defined(BUILT_IN_MODES[9]?.[2]);
  /** SetLineStyle's style, 0 to 4, of which UserBitLn uses linePattern. */
  lineStyle = 0;
  thickness = 1;
  /** SetFillPattern's eight rows of eight dots, for UserFill. */
  userFill = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  /** SetWriteMode: 0 copies lines onto the screen, 1 XORs them. */
  writeMode = 0;
  /** Where the last arc was drawn, for GetArcCoords. */
  arc = { x: 0, y: 0, xStart: 0, yStart: 0, xEnd: 0, yEnd: 0 };
  /** GetAspectRatio's two numbers: a circle's height is its width times
   * x / y. */
  aspect = { x: 10000, y: 10000 };
  /** The sixteen palette registers, each an entry of the DAC. */
  registers = DEFAULT_PALETTE.slice();
  /** The DAC in the 16-colour modes, which SetRGBPalette changes. */
  planarDac = egaDac();
  /** The mode's screens: SetActivePage draws on one (pixels), and
   * SetVisualPage shows one. */
  pages: Uint8Array[] = [this.pixels];
  activePage = 0;
  visualPage = 0;
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
  /** A BGI driver the program loaded, whose code draws in place of the
   * built-in VGA's, on the emulated PC's screen. */
  external: BgiDriverBackend | null = null;

  reset(): void {
    this.detach();
    this.init(9, 2);
    this.initialized = false;
  }
  /** Draws through a loaded driver from now on, on its screen. */
  attach(backend: BgiDriverBackend, driver: number, mode: number): void {
    this.detach();
    this.external = backend;
    this.width = backend.width;
    this.height = backend.height;
    this.pixels = new Uint8Array(0);
    this.pages = [this.pixels];
    this.activePage = this.visualPage = 0;
    this.aspect = { x: backend.aspect || 10000, y: 10000 };
    this.palette = null;
    this.dac = null;
    this.decoration = [];
    this.driver = driver;
    this.mode = mode;
    this.initialized = true;
    this.result = 0;
    this.defaults();
  }
  /** Leaves a loaded driver's graphics. */
  detach(): void {
    const backend = this.external;
    if (!backend) return;
    this.external = null;
    backend.close();
    this.initialized = false;
    this.revision++;
  }
  /** The highest colour the screen shows. */
  maxColor(): number {
    return this.external?.maxColour ?? this.modeInfo.colours - 1;
  }
  /** What clearing writes: the background colour's number in the 16-colour
   * modes, and colour 0, which shows the background, in the others. */
  private get blank(): number {
    return this.modeInfo.colours === 16 ? this.background : 0;
  }
  /** A circle's height for its radius, in the aspect ratio. */
  circleHeight(radius: number): number {
    return this.aspect.y > 0 ? Math.round((radius * this.aspect.x) / this.aspect.y) : radius;
  }
  /** GetPaletteSize: the colours the palette holds. */
  paletteSize(): number {
    return this.maxColor() + 1;
  }
  /** SetPalette: a palette register set to one of the 64 EGA colours, or
   * under a loaded driver, sent to its PALETTE function. */
  setPalette(register: number, colour: number): boolean {
    if (register < 0 || register >= Math.min(16, this.paletteSize())) return false;
    this.registers[register] = colour & 63;
    this.external?.setPalette(register, colour);
    this.revision++;
    return true;
  }
  paletteColours(): number[] {
    return this.registers.slice();
  }
  defaultPaletteColours(): number[] {
    return this.external ? Array.from({ length: 16 }, (_, i) => i) : DEFAULT_PALETTE.slice();
  }
  /** SetRGBPalette: a DAC entry's red, green and blue, of which the DAC
   * keeps the top six bits of each. */
  setRgb(entry: number, red: number, green: number, blue: number): void {
    const levels: [number, number, number] = [
      (red & 0xff) >> 2,
      (green & 0xff) >> 2,
      (blue & 0xff) >> 2,
    ];
    if (this.external) this.external.setRgb(entry, ...levels);
    else this.planarDac[entry & 0xff] = levels;
    this.revision++;
  }
  /** GetViewSettings: the viewport on the screen, and whether it clips. */
  viewSettings(): { left: number; top: number; right: number; bottom: number; clip: boolean } {
    return { ...this.viewport };
  }
  /** Sends the driver what has changed of the colours, styles and viewport. */
  private sendSettings(backend: BgiDriverBackend): void {
    backend.setColour(this.color, this.fillColor);
    backend.setFill(this.fillPattern, this.fillPattern === 12 ? this.userFill : undefined);
    backend.setLine(this.lineStyle, this.linePattern, this.thickness);
    const view = this.viewport;
    if (view.clip) backend.setClip(view.left, view.top, view.right, view.bottom);
    else backend.setClip(0, 0, this.width - 1, this.height - 1);
  }
  /** A point in the viewport, on the screen. */
  private onScreen(x: number, y: number): [number, number] {
    return [Math.round(x) + this.viewport.left, Math.round(y) + this.viewport.top];
  }
  init(driver: number, mode: number): void {
    if (driver === 0) [driver, mode] = [9, 2];
    const modes = BUILT_IN_MODES[driver],
      info = modes?.[mode];
    if (!info) {
      this.initialized = false;
      this.result = modes ? -10 : -4;
      this.revision++;
      return;
    }
    this.palette = null;
    this.dac = null;
    this.decoration = [];
    this.driver = driver;
    this.mode = mode;
    this.modeInfo = info;
    this.width = info.width;
    this.height = info.height;
    this.pages = Array.from({ length: info.pages }, () => new Uint8Array(this.width * this.height));
    this.pixels = defined(this.pages[0]);
    this.activePage = this.visualPage = 0;
    this.planarDac = egaDac();
    // A round circle on a 4:3 screen: its height in dots over its width.
    this.aspect = { x: Math.round((10000 * this.height * 4) / (this.width * 3)), y: 10000 };
    this.initialized = true;
    this.result = 0;
    this.defaults();
  }
  /** GraphDefaults: the settings InitGraph starts with, the screen kept. */
  defaults(): void {
    this.color = this.fillColor = this.maxColor();
    this.background = this.x = this.y = this.direction = this.font = this.horizontalJustify = 0;
    this.charSize = this.fillPattern = this.thickness = 1;
    this.strokeFont = null;
    this.customScale = { x: 1, y: 1 };
    this.linePattern = 0xffff;
    this.lineStyle = this.writeMode = 0;
    this.userFill = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    this.registers = DEFAULT_PALETTE.slice();
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
    this.pages = [this.pixels];
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
    if (this.external) return this.external.colours();
    const rgb = ([red, green, blue]: [number, number, number]) =>
      (eightBit(red) << 16) | (eightBit(green) << 8) | eightBit(blue);
    if (this.dac) return this.dac.map(rgb);
    if (this.palette || !this.initialized) return undefined;
    // Each of the sixteen colours shows a palette register's entry of the DAC.
    const colour = (index: number) =>
      rgb(this.planarDac[(this.registers[index & 15] ?? 0) & 0xff] ?? [0, 0, 0]);
    const info = this.modeInfo;
    if (info.cga !== undefined)
      return [this.background, ...(CGA_PALETTES[info.cga] ?? [])].map((index) =>
        rgb(this.planarDac[defined(DEFAULT_PALETTE[index & 15])] ?? [0, 0, 0])
      );
    // Two colours: the background, and white.
    if (info.colours === 2)
      return [this.background, 15].map((index) =>
        rgb(this.planarDac[defined(DEFAULT_PALETTE[index & 15])] ?? [0, 0, 0])
      );
    return Array.from({ length: info.colours }, (_, index) => colour(index));
  }
  /** Ports 3C7h, 3C8h and 3C9h: choose an entry to read or write, then its
   * red, green and blue in turn. */
  dacPort(port: number, value?: number): number {
    const dac = this.dac;
    if (!dac) return 0xff;
    if (value === undefined) {
      if (port !== 0x3c9) return port === 0x3c8 ? this.dacWrite.index : 0;
      const level = defined(defined(dac[this.dacRead.index])[this.dacRead.component]);
      if (++this.dacRead.component === 3)
        this.dacRead = { index: (this.dacRead.index + 1) & 255, component: 0 };
      return level;
    }
    if (port === 0x3c8) this.dacWrite = { index: value & 255, component: 0 };
    else if (port === 0x3c7) this.dacRead = { index: value & 255, component: 0 };
    else if (port === 0x3c9) {
      defined(dac[this.dacWrite.index])[this.dacWrite.component] = value & 63;
      if (++this.dacWrite.component === 3)
        this.dacWrite = { index: (this.dacWrite.index + 1) & 255, component: 0 };
      this.revision++;
    }
    return 0;
  }
  /** The screen as colors, for display. */
  display(): Uint8Array {
    if (this.external) return this.external.screen().slice();
    const palette = this.palette;
    // Graph3 and mode 13h keep one screen, pixels; Graph's modes may show
    // a page other than the one drawn on.
    const screen =
      this.visualPage === this.activePage
        ? this.pixels
        : (this.pages[this.visualPage] ?? this.pixels);
    const shown = palette ? screen.map((color) => palette[color] ?? 0) : screen.slice();
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
    if (index >= 0 && this.external) {
      this.external.putPixel(...this.onScreen(x, y), color);
      this.revision++;
    } else if (index >= 0) {
      this.pixels[index] = color & this.maxColor();
      this.revision++;
    }
  }
  getPixel(x: number, y: number): number {
    if (this.external)
      return this.position(x, y) < 0 ? -1 : this.external.getPixel(...this.onScreen(x, y));
    return this.pixels[this.position(x, y)] ?? -1;
  }
  clear(viewportOnly = false): void {
    const backend = this.external;
    if (backend) {
      if (!viewportOnly) backend.clear();
      else {
        // The viewport in the background colour: an empty fill.
        backend.setColour(this.color, this.background);
        backend.setFill(0);
        backend.setClip(0, 0, this.width - 1, this.height - 1);
        const view = this.viewport;
        backend.bar(view.left, view.top, view.right, view.bottom);
      }
      this.x = this.y = 0;
      this.revision++;
      return;
    }
    if (!viewportOnly) this.pixels.fill(this.blank);
    else
      for (let y = this.viewport.top; y <= this.viewport.bottom; y++) {
        this.pixels.fill(
          this.blank,
          y * this.width + this.viewport.left,
          y * this.width + this.viewport.right + 1
        );
      }
    this.x = this.y = 0;
    this.revision++;
  }
  /** A line as Line, LineTo, LineRel, Rectangle and DrawPoly draw it, in
   * SetWriteMode's mode. */
  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    this.line(x1, y1, x2, y2, this.writeMode === 1);
  }
  line(x1: number, y1: number, x2: number, y2: number, xor = false): void {
    const backend = this.external;
    // XORed through the driver's own write mode, where it has one.
    if (backend && (!xor || backend.setWriteMode(1))) {
      this.sendSettings(backend);
      const [ax, ay] = this.onScreen(x1, y1),
        [bx, by] = this.onScreen(x2, y2);
      backend.line(ax, ay, bx, by);
      // A thick line is three, side by side across its run.
      if (this.thickness === 3) {
        const steep = Math.abs(by - ay) > Math.abs(bx - ax);
        for (const side of [-1, 1])
          if (steep) backend.line(ax + side, ay, bx + side, by);
          else backend.line(ax, ay + side, bx, by + side);
      }
      // Only lines XOR: what is drawn next copies.
      if (xor) backend.setWriteMode(0);
      this.revision++;
      return;
    }
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
    // XORed, each dot of the line changes once, however thick it is.
    const dots = new Map<string, [number, number]>();
    const plot = (x: number, y: number) => {
      if (xor) dots.set(`${String(x)},${String(y)}`, [x, y]);
      else this.pixel(x, y);
    };
    for (;;) {
      if ((this.linePattern >>> (15 - (step % 16))) & 1) {
        const radius = this.thickness === 3 ? 1 : 0;
        for (let yy = -radius; yy <= radius; yy++)
          for (let xx = -radius; xx <= radius; xx++) plot(x1 + xx, y1 + yy);
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
    for (const [x, y] of dots.values()) {
      const old = this.getPixel(x, y);
      if (old >= 0) this.pixel(x, y, old ^ this.color);
    }
  }
  rectangle(x1: number, y1: number, x2: number, y2: number, xor = false): void {
    this.line(x1, y1, x2, y1, xor);
    this.line(x2, y1, x2, y2, xor);
    this.line(x2, y2, x1, y2, xor);
    this.line(x1, y2, x1, y1, xor);
  }
  /** A dot of the active page, by screen position, outside clipping. */
  private screenDot(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    if (this.external) return this.external.getPixel(x, y);
    return this.pixels[y * this.width + x] ?? 0;
  }
  /** The bits a dot takes in an image: its mode's, or a loaded driver's. */
  private get bitsPerDot(): number {
    return this.external?.bitsPerPixel ?? Math.log2(this.modeInfo.colours);
  }
  /** The bit planes an image's rows hold: four for 16 colours, two for
   * four, one for two; none where a dot takes a byte or more. */
  private get planes(): number {
    return this.bitsPerDot < 8 ? this.bitsPerDot : 0;
  }
  /** The bytes an image's rows take: the bit planes from the highest down,
   * as the BGI's 16-colour drivers save them, of eight dots a byte; or
   * whole bytes a dot. */
  private rowBytes(width: number): number {
    return this.planes ? Math.ceil(width / 8) * this.planes : (width * this.bitsPerDot) / 8;
  }
  /** ImageSize: GetImage's bytes, a word each for the width and height less
   * one, the rows, and a spare word; 0 if that reaches 64K. */
  imageSize(x1: number, y1: number, x2: number, y2: number): number {
    const width = Math.abs(x2 - x1) + 1,
      height = Math.abs(y2 - y1) + 1;
    const size = 6 + this.rowBytes(width) * height;
    if (size < 0x10000) return size;
    this.result = -11;
    return 0;
  }
  /** GetImage: a rectangle of the viewport, in ImageSize's layout. */
  getImage(x1: number, y1: number, x2: number, y2: number): Uint8Array {
    const [left, top] = this.onScreen(Math.min(x1, x2), Math.min(y1, y2));
    const width = Math.abs(x2 - x1) + 1,
      height = Math.abs(y2 - y1) + 1,
      row = this.rowBytes(width);
    const image = new Uint8Array(6 + row * height);
    // The driver's own SAVEBITMAP, where it has one.
    const saved = this.external?.saveImage(left, top, width, height, row);
    if (saved) {
      image.set(saved);
      return image;
    }
    const view = new DataView(image.buffer);
    view.setUint16(0, width - 1, true);
    view.setUint16(2, height - 1, true);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const dot = this.screenDot(left + x, top + y),
          at = 4 + y * row;
        if (!this.planes)
          for (let byte = 0; byte < this.bitsPerDot / 8; byte++)
            image[at + (x * this.bitsPerDot) / 8 + byte] = (dot >> (byte * 8)) & 0xff;
        else
          for (let plane = 0; plane < this.planes; plane++)
            if ((dot >> plane) & 1) {
              const index = at + (this.planes - 1 - plane) * (row / this.planes) + (x >> 3);
              image[index] = (image[index] ?? 0) | (0x80 >> (x & 7));
            }
      }
    return image;
  }
  /** The width and height GetImage's first two words give an image. */
  imageExtent(header: Uint8Array): { width: number; height: number; size: number } {
    const view = new DataView(header.buffer, header.byteOffset, 4);
    const width = view.getUint16(0, true) + 1,
      height = view.getUint16(2, true) + 1;
    return { width, height, size: 6 + this.rowBytes(width) * height };
  }
  /** PutImage: an image at a point of the viewport, copied (0), XORed (1),
   * ORed (2), ANDed (3) or inverted (4) onto what is there, and clipped. */
  putImage(x: number, y: number, image: Uint8Array, operation: number): void {
    const { width, height } = this.imageExtent(image),
      row = this.rowBytes(width),
      mask = this.maxColor();
    if (this.external?.restoreImage(...this.onScreen(x, y), image, operation)) {
      this.revision++;
      return;
    }
    for (let yy = 0; yy < height; yy++)
      for (let xx = 0; xx < width; xx++) {
        const at = 4 + yy * row;
        let dot = 0;
        if (!this.planes)
          for (let byte = 0; byte < this.bitsPerDot / 8; byte++)
            dot |= (image[at + (xx * this.bitsPerDot) / 8 + byte] ?? 0) << (byte * 8);
        else
          for (let plane = 0; plane < this.planes; plane++)
            if (
              ((image[at + (this.planes - 1 - plane) * (row / this.planes) + (xx >> 3)] ?? 0) <<
                (xx & 7)) &
              0x80
            )
              dot |= 1 << plane;
        if (this.position(x + xx, y + yy) < 0) continue;
        const old = this.getPixel(x + xx, y + yy);
        const value = [dot, old ^ dot, old | dot, old & dot, ~dot][operation] ?? dot;
        this.pixel(x + xx, y + yy, value & mask);
      }
  }
  /** SetActivePage and SetVisualPage, of the pages the mode has. */
  setPage(page: number, visual: boolean): void {
    if (this.external) {
      if (this.external.setPage(page, visual)) {
        if (visual) this.visualPage = page;
        else this.activePage = page;
        this.revision++;
      }
      return;
    }
    const screen = this.pages[page];
    if (!screen) return;
    if (visual) this.visualPage = page;
    else {
      this.activePage = page;
      this.pixels = screen;
    }
    this.revision++;
  }
  /** DrawPoly: lines from point to point, in SetWriteMode's mode. */
  drawPoly(points: [number, number][]): void {
    for (let i = 1; i < points.length; i++)
      this.drawLine(...defined(points[i - 1]), ...defined(points[i]));
  }
  /** FillPoly: the polygon's inside in the fill style, by the even-odd rule
   * at each dot's centre, then its outline in the line style. */
  fillPoly(points: [number, number][]): void {
    if (points.length < 2) return;
    const ys = points.map(([, y]) => y);
    const backend = this.external;
    if (backend) this.sendSettings(backend);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      const crossings: number[] = [];
      points.forEach(([ax, ay], i) => {
        const [bx, by] = defined(points[(i + 1) % points.length]);
        if (ay <= y !== by <= y) crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      });
      crossings.sort((p, q) => p - q);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const left = Math.ceil(defined(crossings[i]) - 0.5),
          right = Math.floor(defined(crossings[i + 1]) - 0.5);
        if (right < left) continue;
        if (backend) backend.bar(...this.onScreen(left, y), ...this.onScreen(right, y));
        else for (let x = left; x <= right; x++) this.fillPixel(x, y);
      }
    }
    if (backend) this.revision++;
    points.forEach((point, i) => {
      this.line(...point, ...defined(points[(i + 1) % points.length]));
    });
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
      ((this.userFill[y & 7] ?? 0) >> (7 - (x & 7))) & 1,
    ];
    this.pixel(x, y, patterns[this.fillPattern] ? this.fillColor : this.blank);
  }
  bar(x1: number, y1: number, x2: number, y2: number): void {
    const backend = this.external;
    if (backend) {
      this.sendSettings(backend);
      backend.bar(...this.onScreen(x1, y1), ...this.onScreen(x2, y2));
      this.revision++;
      return;
    }
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
    const at = (degrees: number): [number, number] => [
      Math.round(x + Math.cos((degrees * Math.PI) / 180) * rx),
      Math.round(y - Math.sin((degrees * Math.PI) / 180) * ry),
    ];
    const [xStart, yStart] = at(start),
      [xEnd, yEnd] = at(end);
    this.arc = { x, y, xStart, yStart, xEnd, yEnd };
    const backend = this.external;
    if (fill && backend) {
      // As Borland's kernel emulates a filled shape: a bar a row's run.
      this.sendSettings(backend);
      for (let yy = -ry; yy <= ry; yy++) {
        const half =
          ry === 0 ? rx : Math.floor(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))));
        let run: number | undefined;
        for (let xx = -half; xx <= half + 1; xx++) {
          const angle =
            ((Math.atan2(-yy / (ry || 1), xx / (rx || 1)) * 180) / Math.PI - start + 720) % 360;
          const inside = xx <= half && (!sector || sweep >= 360 || angle <= sweep);
          if (inside && run === undefined) run = xx;
          if (!inside && run !== undefined) {
            backend.bar(...this.onScreen(x + run, y + yy), ...this.onScreen(x + xx - 1, y + yy));
            run = undefined;
          }
        }
      }
      this.revision++;
    } else if (fill) {
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
    const backend = this.external;
    if (backend) {
      this.sendSettings(backend);
      backend.flood(...this.onScreen(x, y), border);
      this.revision++;
      return;
    }
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
      const index = defined(pending[start++]);
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
    if (this.external) {
      // The driver's own font, which it scales and turns.
      this.sendSettings(this.external);
      const [sx, sy] = this.onScreen(x, this.direction === 1 ? y - w + 1 : y);
      this.external.text(text, sx, sy, Math.max(1, s), this.direction);
      this.revision++;
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
