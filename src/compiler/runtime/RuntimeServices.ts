import { PascalError } from '../errors/PascalError';
import { TypeCode } from '../types/inst';
import type { StackValue } from './Machine';
import { TextConsole } from './TextConsole';
import { GraphicsRuntime } from './GraphicsRuntime';
import { FileRuntime, type MemoryAccess } from './FileRuntime';
import { VirtualFileSystem } from './VirtualFileSystem';
import { parseStrokeFont } from './StrokeFont';
import { roundReal48 } from '../codegen/numeric';

interface Host extends MemoryAccess {
  allocate(words: number, defaults: StackValue[]): number;
  free(address: number): void;
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
  readonly files: FileRuntime;
  private clockOffset = 0;
  private fontPath = '';
  constructor(
    private host: Host,
    private disk: VirtualFileSystem
  ) {
    this.files = new FileRuntime(host, disk);
  }
  reset(): void {
    this.console.reset();
    this.graphics.reset();
    this.files.reset();
    this.clockOffset = 0;
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
    if (index >= 350 && index <= 356) return this.strings(index, args);
    return this.files.invoke(index, args, ioChecking);
  }
  private strings(index: number, args: StackValue[]): Result {
    const a = Number(args[0]),
      b = Number(args[1]);
    const read = (address: number): string => {
      let text = '';
      for (let i = 0; i < 65536; i++) {
        const value = this.host.read(address + i);
        if (value === 0 || value === '\0' || value === null || value === '') return text;
        text += typeof value === 'string' ? (value[0] ?? '') : String.fromCharCode(Number(value));
      }
      throw new PascalError('Unterminated string');
    };
    const write = (address: number, text: string): void => {
      for (let i = 0; i < text.length; i++) this.host.write(address + i, text[i]!);
      this.host.write(address + text.length, '\0');
    };
    const text = read(a);
    if (index === 350) return { result: text.length };
    if (index === 351 || index === 352) {
      write(a, (index === 352 ? text : '') + read(b));
      return { result: a };
    }
    if (index === 353) {
      const other = read(b);
      return { result: text === other ? 0 : text < other ? -1 : 1 };
    }
    if (index === 354) {
      const position = text.indexOf(read(b));
      return { result: position < 0 ? 0 : a + position };
    }
    write(
      a,
      index === 355
        ? text.replace(/[a-z]/g, (letter) => letter.toUpperCase())
        : text.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    );
    return { result: a };
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
