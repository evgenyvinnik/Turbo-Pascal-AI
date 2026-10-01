/**
 * The Graph unit's side of a BGI driver it loaded: what Borland's kernel
 * does with a driver's code. It installs the driver for a mode, reads the
 * device status table the driver answers with, switches to graphics, and
 * then draws through the driver's functions, by their numbers in its
 * vector table: lines with VECT, bars with PATBAR, dots with PUTPIXEL, text
 * in the driver's own font with TEXT, fills with FLOODFILL. The functions a
 * driver leaves to the kernel (its vector points at EMULATE, the five bytes
 * at 10h the kernel would patch with a far jump) are drawn from those.
 */
import { CpuFault } from './Cpu86';
import { BgiMachine, SCRATCH_SEGMENT, type ProgramMemory } from './BgiMachine';

/** The driver functions, by their number in its vector table. */
export const enum DriverFunction {
  Install = 0,
  Init = 1,
  Clear = 2,
  Post = 3,
  Move = 4,
  Draw = 5,
  Vect = 6,
  Bar3D = 8,
  PatBar = 9,
  Arc = 10,
  PieSlice = 11,
  FilledEllipse = 12,
  Palette = 13,
  AllPalette = 14,
  Colour = 15,
  FillStyle = 16,
  LineStyle = 17,
  TextStyle = 18,
  Text = 19,
  TextSize = 20,
  FloodFill = 22,
  GetPixel = 23,
  PutPixel = 24,
  BitmapUtil = 25,
  SaveBitmap = 26,
  RestoreBitmap = 27,
  SetClip = 28,
  ColourQuery = 29,
}
/** Where a driver's EMULATE lies: the kernel's emulation answers there. */
const EMULATE = 0x10;
/** Where the Graph unit puts what it hands the driver, in its own segment. */
const DIT_OFFSET = 0x0000;
const TEXT_OFFSET = 0x0100;
const PATTERN_OFFSET = 0x0200;

/** A driver that could not be opened: Graph's error code for it. */
export class DriverRefused extends Error {
  constructor(readonly code: number) {
    super(`Graphics driver refused: ${String(code)}`);
  }
}

export class BgiDriverBackend {
  readonly machine: BgiMachine;
  /** The screen's size in dots, from the driver's device status table. */
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
  readonly maxColour: number;
  readonly modeName: string;
  readonly modeCount: number;
  /** The offset of the driver's vector table, read from its entry. */
  private readonly vectors: number;
  private colour = -1;
  private fillColour = -1;
  private fillPattern = -1;
  private userPattern = '';
  private lineStyle = -1;
  private linePattern = -1;
  private clip = '';
  private fontSize = -1;
  private fontDirection = -1;

  private constructor(machine: BgiMachine, mode: number) {
    this.machine = machine;
    // The entry's CALL WORD PTR [SI+vectors] holds the table's offset.
    this.vectors = machine.driverWord(7);
    this.modeCount = this.call(DriverFunction.Install, { ax: 1, cx: mode }).cx ?? 0;
    const names = this.call(DriverFunction.Install, { ax: 2, cx: mode });
    this.modeName = this.pascalString(((names.es ?? 0) << 4) + (names.bx ?? 0));
    const status = this.call(DriverFunction.Install, { ax: 0, cx: mode });
    const table = ((status.es ?? 0) << 4) + (status.bx ?? 0);
    const byte = (offset: number) => machine.read8(table + offset);
    const word = (offset: number) => byte(offset) | (byte(offset + 1) << 8);
    const code = byte(0) >= 128 ? byte(0) - 256 : byte(0);
    if (code < 0) throw new DriverRefused(code);
    this.width = word(2) + 1;
    this.height = word(4) + 1;
    this.aspect = word(14);
    const scratch = machine.scratchBytes();
    scratch.fill(0, DIT_OFFSET, DIT_OFFSET + 16);
    this.call(DriverFunction.Init, { es: SCRATCH_SEGMENT, bx: DIT_OFFSET });
    if (!machine.graphics) throw new DriverRefused(-10);
    this.maxColour = this.call(DriverFunction.ColourQuery, { ax: 0 }).cx ?? 15;
  }

  /** Loads a driver's code and installs it for a mode, switching to graphics. */
  static open(code: Uint8Array, mode: number, program: ProgramMemory): BgiDriverBackend {
    const machine = new BgiMachine(program);
    machine.load(code);
    // A driver's entry starts PUSH DS / PUSH CS / POP DS, and 'CB' follows it.
    if (code[0] !== 0x1e || code[12] !== 0x43 || code[13] !== 0x42) throw new DriverRefused(-4);
    try {
      return new BgiDriverBackend(machine, mode);
    } catch (error) {
      if (error instanceof CpuFault) throw new DriverRefused(-4);
      throw error;
    }
  }

  private call(fn: DriverFunction, registers: Parameters<BgiMachine['callFunction']>[1] = {}) {
    return this.machine.callFunction(fn, registers);
  }
  /** The name the driver gives one of its modes. */
  nameOfMode(mode: number): string {
    const names = this.call(DriverFunction.Install, { ax: 2, cx: mode });
    return this.pascalString(((names.es ?? 0) << 4) + (names.bx ?? 0));
  }
  /** Whether the driver leaves a function to the kernel. */
  emulated(fn: DriverFunction): boolean {
    return this.machine.driverWord(this.vectors + fn * 2) === EMULATE;
  }
  private pascalString(linear: number): string {
    const length = this.machine.read8(linear);
    let text = '';
    for (let i = 1; i <= length; i++) text += String.fromCharCode(this.machine.read8(linear + i));
    return text;
  }
  private word(value: number): number {
    return Math.round(value) & 0xffff;
  }

  // ---------- Settings, sent when they change ----------

  setColour(colour: number, fillColour: number): void {
    if (colour === this.colour && fillColour === this.fillColour) return;
    this.colour = colour;
    this.fillColour = fillColour;
    this.call(DriverFunction.Colour, { ax: ((fillColour & 0xff) << 8) | (colour & 0xff) });
  }
  /** A fill style, 0 to 11 as Turbo Pascal numbers them, or 12 for the
   * user's eight bytes. */
  setFill(pattern: number, user?: readonly number[]): void {
    const key = user?.join(',') ?? '';
    if (pattern === this.fillPattern && key === this.userPattern) return;
    this.fillPattern = pattern;
    this.userPattern = key;
    if (pattern === 12 && user) {
      this.machine.scratchBytes().set(user.slice(0, 8), PATTERN_OFFSET);
      this.call(DriverFunction.FillStyle, { ax: 0xff, es: SCRATCH_SEGMENT, bx: PATTERN_OFFSET });
    } else this.call(DriverFunction.FillStyle, { ax: pattern & 0xff });
  }
  setLine(style: number, pattern: number, thickness: number): void {
    if (style === this.lineStyle && pattern === this.linePattern) return;
    this.lineStyle = style;
    this.linePattern = pattern;
    this.call(DriverFunction.LineStyle, { ax: style, bx: pattern & 0xffff, cx: thickness });
  }
  setClip(left: number, top: number, right: number, bottom: number): void {
    const key = `${String(left)},${String(top)},${String(right)},${String(bottom)}`;
    if (key === this.clip) return;
    this.clip = key;
    this.call(DriverFunction.SetClip, { ax: left, bx: top, cx: right, dx: bottom });
  }

  // ---------- Drawing ----------

  clear(): void {
    this.call(DriverFunction.Clear);
  }
  putPixel(x: number, y: number, colour: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.call(DriverFunction.PutPixel, { ax: x, bx: y, dx: colour & 0xff });
  }
  getPixel(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return (this.call(DriverFunction.GetPixel, { ax: x, bx: y }).dx ?? 0) & 0xff;
  }
  line(x1: number, y1: number, x2: number, y2: number): void {
    this.call(DriverFunction.Vect, {
      ax: this.word(x1),
      bx: this.word(y1),
      cx: this.word(x2),
      dx: this.word(y2),
    });
  }
  bar(x1: number, y1: number, x2: number, y2: number): void {
    this.call(DriverFunction.PatBar, {
      ax: this.word(Math.min(x1, x2)),
      bx: this.word(Math.min(y1, y2)),
      cx: this.word(Math.max(x1, x2)),
      dx: this.word(Math.max(y1, y2)),
    });
  }
  flood(x: number, y: number, border: number): void {
    if (!this.emulated(DriverFunction.FloodFill)) {
      this.call(DriverFunction.FloodFill, { ax: x, bx: y, cx: border & 0xff });
      return;
    }
    // The kernel's own fill: a run a row, each with PATBAR, found with GETPIXEL.
    const seen = new Uint8Array(this.width * this.height);
    const pending: [number, number][] = [[x, y]];
    const open = (xx: number, yy: number) =>
      xx >= 0 &&
      yy >= 0 &&
      xx < this.width &&
      yy < this.height &&
      !seen[yy * this.width + xx] &&
      this.getPixel(xx, yy) !== (border & 0xff);
    while (pending.length) {
      const [px, py] = pending.pop() ?? [0, 0];
      if (!open(px, py)) continue;
      let left = px,
        right = px;
      while (open(left - 1, py)) left--;
      while (open(right + 1, py)) right++;
      for (let xx = left; xx <= right; xx++) seen[py * this.width + xx] = 1;
      this.bar(left, py, right, py);
      for (const yy of [py - 1, py + 1])
        for (let xx = left; xx <= right; xx++) if (open(xx, yy)) pending.push([xx, yy]);
    }
  }
  /** Text in the driver's own font, at a point, `size` times its 8x8. */
  text(text: string, x: number, y: number, size: number, direction: number): void {
    if (size !== this.fontSize || direction !== this.fontDirection) {
      this.fontSize = size;
      this.fontDirection = direction;
      this.call(DriverFunction.TextStyle, { ax: (direction & 1) << 8, bx: size * 8, cx: size * 8 });
    }
    const bytes = Array.from(text.slice(0, 255), (char) => char.charCodeAt(0) & 0xff);
    if (this.emulated(DriverFunction.Text)) {
      this.emulateText(bytes, x, y, size, direction);
      return;
    }
    this.machine.scratchBytes().set(bytes, TEXT_OFFSET);
    this.call(DriverFunction.Move, { ax: this.word(x), bx: this.word(y) });
    this.call(DriverFunction.Text, { es: SCRATCH_SEGMENT, bx: TEXT_OFFSET, cx: bytes.length });
  }
  /** The kernel's own 8x8 text, with PATBAR for each dot, from the BIOS's font. */
  private emulateText(
    bytes: number[],
    x: number,
    y: number,
    size: number,
    direction: number
  ): void {
    const font = this.machine.font();
    // Dots in the line colour, solid, whatever the fill is.
    const [colour, fillColour, pattern] = [this.colour, this.fillColour, this.fillPattern];
    this.setColour(colour, colour);
    this.setFill(1);
    bytes.forEach((code, index) => {
      for (let row = 0; row < 8; row++) {
        const bits = font[code * 8 + row] ?? 0;
        for (let column = 0; column < 8; column++) {
          if (!(bits & (0x80 >> column))) continue;
          const along = (index * 8 + column) * size,
            across = row * size;
          if (direction === 1) {
            const top = y + (bytes.length * 8 - 1) * size - along;
            this.bar(x + across, top - size + 1, x + across + size - 1, top);
          } else this.bar(x + along, y + across, x + along + size - 1, y + across + size - 1);
        }
      }
    });
    this.setColour(colour, fillColour);
    this.setFill(pattern);
  }
  /** SetPalette: the driver's PALETTE function, register AX to colour BX. */
  setPalette(register: number, colour: number): void {
    this.call(DriverFunction.Palette, { ax: register & 0x3fff, bx: colour & 0xffff });
  }
  /** SetRGBPalette: a DAC entry's six-bit red, green and blue, set as the
   * VGA's ports would. */
  setRgb(entry: number, red: number, green: number, blue: number): void {
    this.machine.dac.set([red & 63, green & 63, blue & 63], (entry & 0xff) * 3);
    this.machine.revision++;
  }
  /** Leaves graphics. */
  close(): void {
    this.call(DriverFunction.Post);
  }

  /** The screen, a byte a dot, as the display shows it. */
  screen(): Uint8Array {
    return this.machine.screen().subarray(0, this.width * this.height);
  }
  colours(): number[] {
    return this.machine.colours();
  }
  get revision(): number {
    return this.machine.revision;
  }
}
