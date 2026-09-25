import { CP437, glyphCode } from '../../tui/vgaFont';
import type { TextConsole } from './TextConsole';

/** Colour text video memory, as Mem[$B800:0] reaches it. */
export const VIDEO_TEXT = 0xb8000;
/** The BIOS data area, at segment $40. */
export const BIOS_DATA = 0x400;

/** What the machine shows of the PC around the program. */
export interface LowMemoryHost {
  console: TextConsole;
  /** The time of day, for the BIOS tick count. */
  now(): Date;
  /** How many keys wait to be read, which the BIOS keyboard buffer holds. */
  keysAvailable(): number;
}

/** The real-mode memory outside the program's own segments: the screen in
 * colour text video memory, the BIOS data area, and plain RAM that keeps
 * what is stored in it. */
export class LowMemory {
  private ram = new Map<number, number>();
  constructor(private host: LowMemoryHost) {}

  reset(): void {
    this.ram.clear();
  }

  read(linear: number): number {
    const screen = this.screenCell(linear);
    if (screen) {
      const { console, index, attribute } = screen;
      return attribute ? console.attributes[index] ?? 7 : glyphCode(console.chars[index] ?? ' ');
    }
    const bios = this.bios(linear - BIOS_DATA);
    return bios ?? this.ram.get(linear) ?? 0;
  }

  write(linear: number, byte: number): void {
    const screen = this.screenCell(linear);
    if (screen) {
      const { console, index, attribute } = screen;
      if (attribute) console.attributes[index] = byte & 0xff;
      else console.chars[index] = CP437[byte & 0xff] ?? '?';
      if (!console.active) console.touch();
      console.revision++;
      return;
    }
    this.ram.set(linear, byte & 0xff);
  }

  /** The screen cell a byte of video memory shows: its character, or at an
   * odd address its attribute. */
  private screenCell(linear: number): { console: TextConsole; index: number; attribute: boolean } | undefined {
    const console = this.host.console;
    const offset = linear - VIDEO_TEXT;
    if (offset < 0 || offset >= console.cols * console.rows * 2) return undefined;
    return { console, index: offset >> 1, attribute: (offset & 1) === 1 };
  }

  /** The BIOS's variables the program can see change: the video mode and
   * screen size, the cursor, the keyboard buffer and the tick count. */
  private bios(offset: number): number | undefined {
    const console = this.host.console;
    const word = (value: number, at: number) => (offset === at ? value & 0xff : offset === at + 1 ? (value >> 8) & 0xff : undefined);
    if (offset === 0x49) return console.lastMode & 0xff;
    if (offset === 0x4a || offset === 0x4b) return word(console.cols, 0x4a);
    if (offset === 0x50 || offset === 0x51) {
      const cursor = console.getCursor();
      return offset === 0x50 ? cursor.x : cursor.y;
    }
    if (offset === 0x62) return 0;
    if (offset === 0x84) return console.rows - 1;
    // The keyboard buffer's head and tail, apart while keys wait.
    if (offset === 0x1a || offset === 0x1b) return word(0x1e, 0x1a);
    if (offset === 0x1c || offset === 0x1d) return word(0x1e + 2 * Math.min(15, this.host.keysAvailable()), 0x1c);
    if (offset >= 0x6c && offset <= 0x6f) {
      const now = this.host.now();
      const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
      const ticks = Math.floor((seconds * 1193180) / 65536);
      return (ticks >>> ((offset - 0x6c) * 8)) & 0xff;
    }
    return undefined;
  }
}

/** The PC's I/O ports, as Port and PortW reach them: the VGA status
 * register's retrace, whose waits then end, the keyboard's scan code, and
 * the PC speaker, whose timer channel 2 sets the pitch and port 61h turns it
 * on. Other ports read as $FF and ignore what is written. */
export class Ports {
  private toggle = 0;
  private timer = { divisor: 0, low: true, gate: 0 };
  constructor(private host: { sound(frequency: number): void; scanCode(): number }) {}

  reset(): void {
    this.toggle = 0;
    this.timer = { divisor: 0, low: true, gate: 0 };
  }
  read(port: number, bytes: number): number {
    const one = (at: number) => {
      if (at === 0x3da) return (this.toggle ^= 0x09);
      if (at === 0x61) return this.timer.gate;
      if (at === 0x60) return this.host.scanCode() & 0xff;
      return 0xff;
    };
    return bytes === 2 ? one(port) | (one((port + 1) & 0xffff) << 8) : one(port);
  }
  write(port: number, value: number, bytes: number): void {
    const one = (at: number, byte: number) => {
      const timer = this.timer;
      if (at === 0x43) timer.low = true;
      else if (at === 0x42) {
        timer.divisor = timer.low ? (timer.divisor & 0xff00) | byte : (timer.divisor & 0xff) | (byte << 8);
        timer.low = !timer.low;
      } else if (at === 0x61) {
        timer.gate = byte;
        this.host.sound((byte & 3) === 3 && timer.divisor ? Math.round(1193180 / timer.divisor) : 0);
      }
    };
    one(port, value & 0xff);
    if (bytes === 2) one((port + 1) & 0xffff, (value >> 8) & 0xff);
  }
}
