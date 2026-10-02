/**
 * A Microsoft-compatible mouse driver, which programs reach through INT 33h:
 * the browser's mouse, moved over the program's screen, is its mouse.
 *
 * Positions are the driver's virtual screen: in text mode 640 by 200, eight
 * to a character cell; in graphics the screen's own dots, with x doubled in
 * the 320-wide modes, as the real driver counts them.
 */
import { defined } from '../../utils/defined';

/** The registers INT 33h takes and gives back. */
export interface MouseRegisters {
  ax: number;
  bx: number;
  cx: number;
  dx: number;
}
/** The screen the mouse moves over: its dots, or text's 80 by 25. */
export interface MouseScreen {
  width: number;
  height: number;
  text: boolean;
}
/** Where the cursor shows, in character cells or in the screen's dots. */
export interface MouseCursor {
  x: number;
  y: number;
}

const BUTTONS = 3;

export class MouseDriver {
  /** The position, in the driver's virtual coordinates. */
  private x = 0;
  private y = 0;
  /** Bit 0 the left button, bit 1 the right, bit 2 the middle. */
  private buttons = 0;
  /** The cursor shows while this is 0; Show adds one up to 0, Hide takes one. */
  private shown = -1;
  private range = { left: 0, right: 639, top: 0, bottom: 199 };
  private presses = Array.from({ length: BUTTONS }, () => ({ count: 0, x: 0, y: 0 }));
  private releases = Array.from({ length: BUTTONS }, () => ({ count: 0, x: 0, y: 0 }));
  /** Motion since the last reading of the counters, in mickeys. */
  private mickeys = { x: 0, y: 0 };
  /** Bumped whenever what the cursor shows changes. */
  revision = 0;

  constructor(private readonly screen: () => MouseScreen) {
    this.reset();
  }

  /** The virtual screen's size for the screen as it is now. */
  private virtual(): { width: number; height: number; scale: number } {
    const screen = this.screen();
    if (screen.text) return { width: 640, height: 200, scale: 1 };
    const scale = screen.width <= 320 ? 2 : 1;
    return { width: screen.width * scale, height: screen.height, scale };
  }
  /** Function 0: the ranges cover the screen, the cursor hides in its middle. */
  private reset(): void {
    const { width, height } = this.virtual();
    this.range = { left: 0, right: width - 1, top: 0, bottom: height - 1 };
    this.x = Math.floor(width / 2);
    this.y = Math.floor(height / 2);
    this.shown = -1;
    this.presses.forEach((press) => Object.assign(press, { count: 0, x: 0, y: 0 }));
    this.releases.forEach((release) => Object.assign(release, { count: 0, x: 0, y: 0 }));
    this.mickeys = { x: 0, y: 0 };
    this.revision++;
  }
  private clamp(): void {
    const { left, right, top, bottom } = this.range;
    this.x = Math.min(right, Math.max(left, this.x));
    this.y = Math.min(bottom, Math.max(top, this.y));
  }
  /** In text mode the driver gives the top left of the cell. */
  private reported(): { x: number; y: number } {
    if (!this.screen().text) return { x: this.x, y: this.y };
    return { x: this.x & ~7, y: this.y & ~7 };
  }

  // ---------- The hardware: the browser's mouse ----------

  /** The mouse at a point of the screen, as fractions of its width and
   * height, with these buttons down. */
  move(fractionX: number, fractionY: number, buttons = this.buttons): void {
    const { width, height } = this.virtual();
    const x = Math.floor(Math.min(0.9999, Math.max(0, fractionX)) * width),
      y = Math.floor(Math.min(0.9999, Math.max(0, fractionY)) * height);
    // Eight mickeys to eight dots across, sixteen to eight down.
    this.mickeys.x += x - this.x;
    this.mickeys.y += (y - this.y) * 2;
    this.x = x;
    this.y = y;
    this.clamp();
    const at = this.reported();
    for (let button = 0; button < BUTTONS; button++) {
      const bit = 1 << button;
      const record =
        buttons & bit && !(this.buttons & bit)
          ? this.presses[button]
          : !(buttons & bit) && this.buttons & bit
            ? this.releases[button]
            : undefined;
      if (record) Object.assign(record, { count: record.count + 1, x: at.x, y: at.y });
    }
    this.buttons = buttons & 7;
    this.revision++;
  }
  /** Where the cursor shows, while the program shows it. */
  cursor(): MouseCursor | null {
    if (this.shown !== 0) return null;
    const screen = this.screen();
    if (screen.text) return { x: this.x >> 3, y: this.y >> 3 };
    return { x: Math.floor(this.x / this.virtual().scale), y: this.y };
  }

  // ---------- INT 33h ----------

  /** One INT 33h call: the function in AX, the answer in the registers.
   * False for a function this driver does not have. */
  service(r: MouseRegisters): boolean {
    const button = r.bx < BUTTONS ? r.bx : 0;
    switch (r.ax) {
      case 0x00:
        this.reset();
        r.ax = 0xffff;
        r.bx = 2;
        return true;
      case 0x01:
        if (this.shown < 0) this.shown++;
        this.revision++;
        return true;
      case 0x02:
        this.shown--;
        this.revision++;
        return true;
      case 0x03: {
        const at = this.reported();
        r.bx = this.buttons;
        r.cx = at.x;
        r.dx = at.y;
        return true;
      }
      case 0x04:
        this.x = r.cx;
        this.y = r.dx;
        this.clamp();
        this.revision++;
        return true;
      case 0x05:
      case 0x06: {
        const record = defined((r.ax === 5 ? this.presses : this.releases)[button]);
        r.ax = this.buttons;
        r.bx = record.count;
        r.cx = record.x;
        r.dx = record.y;
        record.count = 0;
        return true;
      }
      case 0x07:
        this.range.left = Math.min(r.cx, r.dx);
        this.range.right = Math.max(r.cx, r.dx);
        this.clamp();
        return true;
      case 0x08:
        this.range.top = Math.min(r.cx, r.dx);
        this.range.bottom = Math.max(r.cx, r.dx);
        this.clamp();
        return true;
      case 0x0b:
        r.cx = this.mickeys.x & 0xffff;
        r.dx = this.mickeys.y & 0xffff;
        this.mickeys = { x: 0, y: 0 };
        return true;
      // The cursor's shape, the mickey ratio and the sensitivity: taken,
      // and the cursor drawn as it is.
      case 0x09:
      case 0x0a:
      case 0x0f:
      case 0x1a:
      case 0x1d:
        return true;
      case 0x21:
        r.ax = 0xffff;
        r.bx = 2;
        return true;
      case 0x24:
        // Version 6.26 of a PS/2 mouse's driver.
        r.bx = 0x0626;
        r.cx = 0x0400;
        return true;
      default:
        return false;
    }
  }
}
