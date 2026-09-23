import { PascalError } from '../errors/PascalError';
import { TypeCode } from '../types/inst';
import type { StackValue } from './Machine';
import { TextConsole } from './TextConsole';
import { GraphicsRuntime } from './GraphicsRuntime';
import { Graph3 } from './Graph3';
import { FileRuntime, type MemoryAccess } from './FileRuntime';
import { VirtualFileSystem } from './VirtualFileSystem';
import { parseStrokeFont } from './StrokeFont';
import { roundReal48 } from '../codegen/numeric';
import { decodeBinary, encodeBinary, type BinaryCell } from './BinaryCodec';

interface Host extends MemoryAccess {
  allocate(words: number, defaults: StackValue[]): number;
  free(address: number): void;
  /** Free heap space, in total and in the largest block, in cells. */
  heapAvailable(): { total: number; largest: number };
  /** The current stack pointer, which SPtr reports. */
  stackPointer(): number;
  /** The heap top, which Mark records and Release returns to. */
  heapTop(): number;
  releaseHeap(address: number): void;
  sound(frequency: number): void;
}
interface Result {
  result?: StackValue;
  delay?: number;
  ioError?: number;
}

/** Stateful standard-library services called by the VM's CSP instruction. */
export class RuntimeServices {
  readonly console = new TextConsole();
  readonly graphics = new GraphicsRuntime();
  readonly graph3 = new Graph3(this.graphics);
  readonly files: FileRuntime;
  private clockOffset = 0;
  private fontPath = '';
  /** The Overlay unit's buffer and probation sizes. Every unit is resident,
   * so they only report back what the program set. */
  private overlayBuffer = 0;
  private overlayRetry = 0;
  /** Interrupt vectors a program has set. The others hold the addresses of
   * the BIOS and DOS handlers, which only compare and restore. */
  readonly vectors = new Map<number, number>();
  constructor(
    private host: Host,
    private disk: VirtualFileSystem
  ) {
    this.files = new FileRuntime(host, disk);
  }
  /** The characters of a null-terminated string. A nil PChar reads as empty. */
  private cString(address: number): string {
    let text = '';
    for (let at = address; address !== 0 && text.length < 65535; at++) {
      const value = this.host.read(at);
      const char = typeof value === 'string' ? value.charAt(0) : value ? String.fromCharCode(Number(value)) : '';
      if (!char || char === '\0') break;
      text += char;
    }
    return text;
  }
  private putCString(address: number, text: string): void {
    if (!address) throw new PascalError('Nil pointer dereference');
    for (let index = 0; index < text.length; index++) this.host.write(address + index, text[index]!);
    this.host.write(address + text.length, '\0');
  }
  /** Turbo Pascal's Strings unit. Comparisons give the difference of the
   * first characters that differ, as it does. */
  private strings(index: number, args: StackValue[]): Result {
    const a = Number(args[0]),
      b = Number(args[1]),
      c = Number(args[2]);
    const compare = (x: string, y: string, limit = Infinity, fold = false) => {
      for (let at = 0; at < limit; at++) {
        let p = x.charCodeAt(at) || 0,
          q = y.charCodeAt(at) || 0;
        if (fold) [p, q] = [String.fromCharCode(p).toUpperCase().charCodeAt(0), String.fromCharCode(q).toUpperCase().charCodeAt(0)];
        if (p !== q || !p) return p - q;
      }
      return 0;
    };
    const cased = (upper: boolean) => {
      const text = this.cString(a);
      this.putCString(a, text.replace(/[a-z]/gi, (char) => (upper ? char.toUpperCase() : char.toLowerCase())));
      return { result: a };
    };
    switch (index) {
      case 350:
        return { result: this.cString(a).length };
      case 351:
        this.putCString(a, this.cString(b));
        return { result: a };
      case 352:
        this.putCString(a, this.cString(a) + this.cString(b));
        return { result: a };
      case 353:
        return { result: compare(this.cString(a), this.cString(b)) };
      case 354: {
        const at = this.cString(a).indexOf(this.cString(b));
        return { result: at < 0 ? 0 : a + at };
      }
      case 355:
        return cased(true);
      case 356:
        return cased(false);
      case 357:
        return { result: a + this.cString(a).length };
      case 358: {
        // A raw copy of Count characters, which may overlap.
        const cells = Array.from({ length: Math.max(0, c) }, (_, at) => this.host.read(b + at));
        for (const [at, cell] of cells.entries()) this.host.write(a + at, cell);
        return { result: a };
      }
      case 359: {
        const text = this.cString(b);
        this.putCString(a, text);
        return { result: a + text.length };
      }
      case 360:
        this.putCString(a, this.cString(b).slice(0, Math.max(0, c)));
        return { result: a };
      case 361:
        this.putCString(a, String(args[1] ?? ''));
        return { result: a };
      case 362:
        this.putCString(a, (this.cString(a) + this.cString(b)).slice(0, Math.max(0, c)));
        return { result: a };
      case 363:
        return { result: compare(this.cString(a), this.cString(b), Infinity, true) };
      case 364:
        return { result: compare(this.cString(a), this.cString(b), c) };
      case 365:
        return { result: compare(this.cString(a), this.cString(b), c, true) };
      case 366:
      case 367: {
        // The terminating null can be found too, as in Turbo Pascal.
        const text = this.cString(a) + '\0';
        const char = String(args[1] ?? '').charAt(0) || '\0';
        const at = index === 366 ? text.indexOf(char) : text.lastIndexOf(char);
        return { result: at < 0 ? 0 : a + at };
      }
      case 368:
        return { result: this.cString(a).slice(0, 255) };
      case 369: {
        const text = this.cString(a);
        if (!text) return { result: 0 };
        return { result: this.host.allocate(text.length + 1, [...text.split(''), '\0']) };
      }
      default:
        if (a) this.host.free(a);
        return {};
    }
  }
  reset(): void {
    this.console.reset();
    this.graphics.reset();
    this.graph3.reset();
    this.files.reset();
    this.clockOffset = 0;
    this.overlayBuffer = 0;
    this.overlayRetry = 0;
    this.vectors.clear();
    this.host.sound(0);
  }
  invoke(index: number, args: StackValue[], ioChecking = true): Result | undefined {
    const a = Number(args[0]),
      b = Number(args[1]),
      c = Number(args[2]),
      d = Number(args[3]);
    const readString = (address: number) => String(this.host.read(address) ?? '');
    switch (index) {
      case 4: {
        const defaults = typeof args[2] === 'string' ? (JSON.parse(args[2]) as StackValue[]) : [];
        this.host.write(a, this.host.allocate(b, defaults));
        return {};
      }
      case 5:
        this.host.free(Number(this.host.read(a)));
        this.host.write(a, 0);
        return {};
      // FillChar and Move work on the variables' bytes, in the layout their
      // types give, so a cell holding a word changes byte by byte.
      case 60: {
        const layout = JSON.parse(String(args[3])) as BinaryCell[];
        const bytes = encodeBinary(this.host, a, layout);
        bytes.fill(typeof args[2] === 'string' ? args[2].charCodeAt(0) : c & 255, 0, Math.max(0, Math.min(b, bytes.length)));
        decodeBinary(this.host, a, layout, bytes);
        return {};
      }
      case 61: {
        const source = encodeBinary(this.host, a, JSON.parse(String(args[3])) as BinaryCell[]);
        const layout = JSON.parse(String(args[4])) as BinaryCell[];
        const target = encodeBinary(this.host, b, layout);
        target.set(source.subarray(0, Math.max(0, Math.min(c, source.length, target.length))));
        decodeBinary(this.host, b, layout, target);
        return {};
      }
      case 63:
        return { result: (a >> 8) & 255 };
      case 64:
        return { result: a & 255 };
      case 65:
        return { result: ((a & 255) << 8) | ((a >> 8) & 255) };
      case 84: {
        const defaults = typeof args[2] === 'string' ? (JSON.parse(args[2]) as StackValue[]) : [];
        this.host.write(a, this.host.allocate(Math.max(1, b, defaults.length), defaults));
        return {};
      }
      case 85:
        this.host.free(Number(this.host.read(a)));
        return {};
      case 86:
        return { result: this.host.heapAvailable().total };
      case 87:
        return { result: this.host.heapAvailable().largest };
      case 88:
        throw new PascalError(`Run-time error ${String(args.length ? a : 0)}`);
      case 42:
        // One address space: a pointer is its offset, and every segment is 0.
        return { result: a * 16 + b };
      case 91:
        return { result: 0 };
      case 92:
        return { result: a };
      case 93:
        return { result: this.host.stackPointer() };
      // Turbo Pascal's own generator: RandSeed carries the sequence, so a
      // program that sets it gets the same numbers again.
      case 51: {
        const seedAddress = Number(args[args.length - 1]);
        const seed = (Math.imul(Number(this.host.read(seedAddress)), 134775813) + 1) | 0;
        this.host.write(seedAddress, seed);
        const fraction = (seed >>> 0) / 2 ** 32;
        if (args.length < 2) return { result: fraction };
        const range = a;
        if (!Number.isInteger(range) || range < 0) throw new PascalError('Invalid random range');
        return { result: Math.floor(fraction * range) };
      }
      case 52:
        this.host.write(Number(args[0]), (Date.now() & 0xffffffff) | 0);
        return {};
      case 95:
        this.host.write(a, this.host.heapTop());
        return {};
      case 96:
        this.host.releaseHeap(Number(this.host.read(a)));
        return {};
      case 89:
        return { result: 0 };
      case 90:
        return { result: a === 0 ? String(args[1]) : '' };
      case 34: {
        const text = readString(a);
        if (b >= 1 && c > 0) this.host.write(a, text.slice(0, b - 1) + text.slice(b - 1 + c));
        return {};
      }
      case 35: {
        const text = readString(b),
          at = Math.max(0, Math.min(text.length, c - 1));
        this.host.write(
          b,
          (text.slice(0, at) + String(args[0]) + text.slice(at)).slice(0, Number(args[3] ?? 255))
        );
        return {};
      }
      case 36:
        this.host.write(b, String(args[0]).slice(0, Number(args[2] ?? 255)));
        return {};
      case 37: {
        const text = String(args[0]),
          type = d as TypeCode;
        const pattern =
          type === TypeCode.I
            ? /^[+-]?(?:\d+|\$[\da-f]+)$/i
            : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
        let value = Number(text);
        if (/^[+-]?\$[\da-f]+$/i.test(text))
          value = (text.startsWith('-') ? -1 : 1) * parseInt(text.replace(/^[+-]?\$/, ''), 16);
        let code = 0;
        if (!pattern.test(text) || !Number.isFinite(value)) {
          const prefix = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(text)?.[0] ?? '';
          code = Math.max(1, Math.min(text.length, prefix.length + 1));
        } else if (
          type === TypeCode.I &&
          (!Number.isInteger(value) ||
            value < Number(args[4] ?? -2147483648) ||
            value > Number(args[5] ?? 2147483647))
        )
          code = Math.max(1, text.length);
        if (code === 0 && type === TypeCode.R) {
          try {
            value = roundReal48(value);
          } catch {
            code = Math.max(1, text.length);
          }
        }
        if (code === 0) this.host.write(b, value);
        this.host.write(c, code);
        return {};
      }
      case 101:
        this.console.clearEol();
        return {};
      case 102:
        this.console.goto(a, b);
        return {};
      case 103:
        return { result: this.console.x };
      case 104:
        return { result: this.console.y };
      case 105:
        this.console.window(a, b, c, d);
        return {};
      case 106:
        this.console.insertLine();
        return {};
      case 107:
        this.console.deleteLine();
        return {};
      case 110:
        this.console.attribute = (this.console.attribute & 0x70) | (a & 0x8f);
        this.console.touch();
        return {};
      case 111:
        this.console.attribute = (this.console.attribute & 0x8f) | ((a & 7) << 4);
        this.console.touch();
        return {};
      case 112:
        this.console.attribute |= 8;
        this.console.touch();
        return {};
      case 113:
        this.console.attribute &= ~8;
        this.console.touch();
        return {};
      case 114:
        this.console.attribute = 7;
        this.console.touch();
        return {};
      case 115:
        // TextMode also ends Turbo Pascal 3's graphics.
        this.graph3.leave();
        this.console.mode(a);
        return {};
      case 130:
        this.host.sound(Math.max(0, a));
        return {};
      case 131:
        this.host.sound(0);
        return {};
      case 132:
        return { delay: Math.max(0, a) };
      case 308:
        if (b === 0xf000_0000 + (a & 255)) this.vectors.delete(a & 255);
        else this.vectors.set(a & 255, b);
        return {};
      case 309:
        this.host.write(b, this.vectors.get(a & 255) ?? 0xf000_0000 + (a & 255));
        return {};
      // The Overlay unit: nothing to load, so each call succeeds.
      case 450:
      case 451:
      case 456:
        return {};
      case 452:
        this.overlayBuffer = Math.max(0, a);
        return {};
      case 453:
        return { result: this.overlayBuffer };
      case 454:
        this.overlayRetry = Math.max(0, a);
        return {};
      case 455:
        return { result: this.overlayRetry };
      // Turbo3: the heap in 16-byte paragraphs, and Turbo Pascal 3's video
      // attributes, yellow and light gray on black.
      case 461:
        return { result: Math.floor(this.host.heapAvailable().total / 16) };
      case 462:
        return { result: Math.floor(this.host.heapAvailable().largest / 16) };
      case 466:
      case 467:
      case 468:
        this.console.attribute = index === 468 ? 0x07 : 0x0e;
        this.console.touch();
        return {};
      case 140:
        this.console.cursorVisible = false;
        this.console.touch();
        return {};
      case 141:
        this.console.cursorVisible = true;
        this.console.touch();
        return {};
    }
    if (index >= 200 && index < 300) return this.graph(index, args);
    if (index >= 300 && index <= 307) {
      const date = new Date(Date.now() + this.clockOffset);
      switch (index) {
        case 300:
          [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getDay()].forEach(
            (value, i) => {
              this.host.write(Number(args[i]), value);
            }
          );
          return {};
        case 301:
          [
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            Math.floor(date.getMilliseconds() / 10),
          ].forEach((value, i) => {
            this.host.write(Number(args[i]), value);
          });
          return {};
        case 302: {
          if (a < 1980 || a > 2099 || b < 1 || b > 12 || c < 1 || c > new Date(a, b, 0).getDate())
            return {};
          date.setFullYear(a, b - 1, c);
          this.clockOffset = date.getTime() - Date.now();
          return {};
        }
        case 303: {
          if (a < 0 || a > 23 || b < 0 || b > 59 || c < 0 || c > 59 || d < 0 || d > 99) return {};
          date.setHours(a, b, c, d * 10);
          this.clockOffset = date.getTime() - Date.now();
          return {};
        }
        case 304:
          return {
            result:
              (
                { COMSPEC: 'C:\\COMMAND.COM', PATH: 'C:\\', TEMP: 'C:\\TEMP' } as Record<
                  string,
                  string
                >
              )[String(args[0]).toUpperCase()] ?? '',
          };
        case 305:
          return { result: 0x1606 };
        case 306:
          return { result: this.disk.capacity - this.disk.used };
        case 307:
          return { result: this.disk.capacity };
      }
    }
    if (index >= 350 && index <= 370) return this.strings(index, args);
    if (index >= 500 && index < 550) return this.turbo3Graphics(index, args);
    return this.files.invoke(index, args, ioChecking);
  }
  /** The Graph3 unit. */
  private turbo3Graphics(index: number, args: StackValue[]): Result {
    const g = this.graph3,
      [a = 0, b = 0, c = 0, d = 0, e = 0] = args.map(Number);
    const bytes = (address: number, layout: StackValue | undefined) =>
      encodeBinary(this.host, address, JSON.parse(String(layout)) as BinaryCell[]);
    const turtle = (action: () => void): Result => {
      action();
      return g.delay > 0 ? { delay: g.delay } : {};
    };
    switch (index) {
      case 500:
        g.setMode('mono');
        return {};
      case 501:
        g.setMode('color');
        return {};
      case 502:
        g.setMode('hires');
        return {};
      case 503:
        g.setHiResColor(a);
        return {};
      case 504:
        g.palette(a);
        return {};
      case 505:
        g.graphBackground(a);
        return {};
      case 506:
        g.graphWindow(a, b, c, d);
        return {};
      case 507:
        g.plot(a, b, c);
        return {};
      case 508:
        g.draw(a, b, c, d, e);
        return {};
      case 509:
        g.colorTable([a, b, c, d]);
        return {};
      case 510:
        g.arc(a, b, c, d, e);
        return {};
      case 511:
        g.circle(a, b, c, d);
        return {};
      case 512: {
        // GetPic fills as much of the buffer variable as it holds.
        const layout = JSON.parse(String(args[5])) as BinaryCell[];
        const target = encodeBinary(this.host, a, layout);
        const picture = g.getPic(b, c, d, e);
        target.set(picture.subarray(0, target.length));
        decodeBinary(this.host, a, layout, target);
        return {};
      }
      case 513:
        g.putPic(bytes(a, args[3]), b, c);
        return {};
      case 514:
        return { result: g.getDotColor(a, b) };
      case 515:
        g.fillScreen(a);
        return {};
      case 516:
        g.fillShape(a, b, c, d);
        return {};
      case 517:
        g.fillPattern(a, b, c, d, e);
        return {};
      case 518:
        g.pattern(bytes(a, args[1]));
        return {};
      case 520:
        return turtle(() => {
          g.forward(-a);
        });
      case 521:
        g.clearScreen();
        return {};
      case 522:
        return turtle(() => {
          g.forward(a);
        });
      case 523:
        return { result: g.heading };
      case 524:
        g.setVisible(false);
        return {};
      case 525:
        return turtle(() => {
          g.home();
        });
      case 526:
        g.setWrap(false);
        return {};
      case 527:
        g.setPen(true);
        return {};
      case 528:
        g.setPen(false);
        return {};
      case 529:
        return turtle(() => {
          g.setHeading(a);
        });
      case 530:
        g.setPenColor(a);
        return {};
      case 531:
        return turtle(() => {
          g.setPosition(a, b);
        });
      case 532:
        g.setVisible(true);
        return {};
      case 533:
        return turtle(() => {
          g.turn(-a);
        });
      case 534:
        return turtle(() => {
          g.turn(a);
        });
      case 535:
        g.delay = Math.max(0, a);
        return {};
      case 536:
        return { result: g.turtleThere ? 1 : 0 };
      case 537:
        g.turtleWindow(a, b, c, d);
        return {};
      case 538:
        g.setWrap(true);
        return {};
      case 539:
        return { result: g.xcor };
      case 540:
        return { result: g.ycor };
    }
    throw new PascalError('Unknown Graph3 routine');
  }
  private graph(index: number, args: StackValue[]): Result | undefined {
    const g = this.graphics,
      [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args.map(Number);
    if (index === 200) {
      g.init(Number(this.host.read(a)), Number(this.host.read(b)));
      this.fontPath = String(args[2] ?? '');
      this.host.write(a, g.driver);
      this.host.write(b, g.mode);
      return {};
    }
    if (index === 201 || index === 207) {
      g.initialized = false;
      g.revision++;
      return {};
    }
    if (index === 202) {
      this.host.write(a, 9);
      this.host.write(b, 2);
      return {};
    }
    if (index === 205) {
      const result = g.result;
      g.result = 0;
      return { result };
    }
    if (index === 206)
      return {
        result:
          (
            {
              0: 'No error',
          '-1': 'Graphics not initialized',
          '-4': 'Invalid graphics driver',
              '-8': 'Font file not found',
              '-10': 'Invalid graphics mode',
              '-11': 'Graphics error',
              '-13': 'Invalid font file',
            } as Record<number, string>
          )[a] ?? `Graphics error ${String(a)}`,
      };
    if (!g.initialized) throw new PascalError('Graphics not initialized');
    switch (index) {
      case 203:
        return { result: g.mode };
      case 204:
        g.init(g.driver, a);
        return {};
      case 210:
        g.color = a & 15;
        return {};
      case 211:
        return { result: g.color };
      case 212:
        g.background = a & 15;
        return {};
      case 213:
        return { result: g.background };
      case 214:
        return { result: 15 };
      case 220:
        g.pixel(a, b, c);
        return {};
      case 221:
        return { result: g.getPixel(a, b) };
      case 222:
        g.line(a, b, c, d);
        return {};
      case 223:
        g.line(g.x, g.y, a, b);
        g.x = a;
        g.y = b;
        return {};
      case 224:
        g.line(g.x, g.y, g.x + a, g.y + b);
        g.x += a;
        g.y += b;
        return {};
      case 225:
        g.x = a;
        g.y = b;
        return {};
      case 226:
        g.x += a;
        g.y += b;
        return {};
      case 227:
        g.rectangle(a, b, c, d);
        return {};
      case 228:
        g.bar(a, b, c, d);
        return {};
      case 229:
        g.bar(a, b, c, d);
        g.rectangle(a, b, c, d);
        g.line(c, b, c + e, b - e);
        g.line(c, d, c + e, d - e);
        g.line(c + e, b - e, c + e, d - e);
        if (f) {
          g.line(a, b, a + e, b - e);
          g.line(a + e, b - e, c + e, b - e);
        }
        return {};
      case 230:
        g.ellipse(a, b, 0, 360, c, c);
        return {};
      case 231:
        g.ellipse(a, b, c, d, e, e);
        return {};
      case 232:
        g.ellipse(a, b, c, d, e, f);
        return {};
      case 233:
        g.ellipse(a, b, 0, 360, c, d, true);
        return {};
      case 234:
        g.ellipse(a, b, c, d, e, f, true, true);
        return {};
      case 235:
        g.ellipse(a, b, c, d, e, e, true, true);
        return {};
      case 240:
        g.flood(a, b, c);
        return {};
      case 241:
        g.fillPattern = a;
        g.fillColor = b & 15;
        return {};
      case 250:
        g.linePattern = [0xffff, 0xcccc, 0xfc78, 0xf8f8, b][a] ?? 0xffff;
        g.thickness = c === 3 ? 3 : 1;
        return {};
      case 260:
        g.text(String(args[0]));
        if (g.direction === 0) g.x += g.textWidth(String(args[0]));
        return {};
      case 261:
        g.text(String(args[2]), a, b);
        return {};
      case 262: {
        if (a < 0 || a > 10 || b < 0 || b > 1 || c < 0 || c > 10) {
          g.result = -11;
          return {};
        }
        if (a !== 0) {
          const name =
            ['', 'TRIP', 'LITT', 'SANS', 'GOTH', 'SCRI', 'SIMP', 'TSCR', 'LCOM', 'EURO', 'BOLD'][
              a
            ]! + '.CHR';
          const path = this.fontPath ? this.fontPath + '/' + name : name;
          if (!this.disk.exists(path)) {
            g.result = -8;
            return {};
          }
          try {
            g.strokeFont = parseStrokeFont(
              Uint8Array.from(this.disk.read(path), (char) => char.charCodeAt(0))
            );
          } catch {
            g.result = -13;
            return {};
          }
        }
        g.font = a;
        g.direction = b;
        g.charSize = a === 0 ? Math.max(1, c) : c;
        return {};
      }
      case 265:
        if (b <= 0 || d <= 0) {
          g.result = -11;
          return {};
        }
        g.customScale = { x: a / b, y: c / d };
        return {};
      case 264:
        g.horizontalJustify = a;
        g.verticalJustify = b;
        return {};
      case 266:
        return { result: g.textWidth(String(args[0])) };
      case 267:
        return { result: g.textHeight() };
      case 270:
        g.view(a, b, c, d, Boolean(e));
        return {};
      case 272:
        g.clear();
        return {};
      case 273:
        g.clear(true);
        return {};
      case 274:
        return { result: g.width - 1 };
      case 275:
        return { result: g.height - 1 };
      case 276:
        return { result: g.x };
      case 277:
        return { result: g.y };
      default:
        return undefined;
    }
  }
}
