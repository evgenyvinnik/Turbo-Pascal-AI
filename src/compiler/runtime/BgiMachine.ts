/**
 * The PC a BGI graphics driver runs on: an 8086 (Cpu86), a VGA with a VESA
 * 1.2 BIOS, and the program's memory, which the driver reaches through the
 * far pointers the Graph unit hands it. The driver's code lies in a segment
 * of its own, and the Graph unit calls it as Borland's does: a far call to
 * the code's first byte, its entry, with the function's number times two in
 * SI and its arguments in registers.
 *
 * Memory: the program's below A000; the VGA's window at A000, 64K of a
 * megabyte of video memory chosen by the VESA bank; C000, the video BIOS,
 * empty; D000, the driver; E000, the Graph unit's own data and the stack it
 * calls the driver on; F000, the BIOS: its 8x8 font, its VESA tables and
 * the routine that switches banks.
 */
import { AX, BP, BX, CS, CX, Cpu86, CpuFault, DI, DS, DX, ES, SI, SP, SS, type Bus } from './Cpu86';
import { BGI_FONT } from '../../tui/bgiFont';
import { defaultVgaPalette } from './GraphicsRuntime';

export const DRIVER_SEGMENT = 0xd000;
export const SCRATCH_SEGMENT = 0xe000;
export const BIOS_SEGMENT = 0xf000;
/** Where the 8x8 font lies: all 256 characters, which the IBM BIOS splits
 * between F000:FA6E and the INT 1Fh vector. */
const FONT_OFFSET = 0xa000;
const VBE_MODES_OFFSET = 0x0100;
const OEM_OFFSET = 0x0140;
const WINDOW_FUNCTION_OFFSET = 0x0180;
/** A HLT the driver returns to: its calls end there. */
const RETURN_OFFSET = 0xfff0;
const STACK_TOP = 0xfffe;
const VIDEO_MEMORY = 1 << 20;
/** How many instructions one driver call may take before it is taken to hang. */
const CALL_BUDGET = 50_000_000;

/** The VESA modes the video BIOS offers: 256 colours, a byte a dot. */
export const VESA_MODES: Record<number, { width: number; height: number }> = {
  0x100: { width: 640, height: 400 },
  0x101: { width: 640, height: 480 },
  0x103: { width: 800, height: 600 },
  0x105: { width: 1024, height: 768 },
};

/** The program's memory, below the video memory. */
export interface ProgramMemory {
  read(linear: number): number;
  write(linear: number, value: number): void;
}

export type Registers = Partial<
  Record<'ax' | 'bx' | 'cx' | 'dx' | 'si' | 'di' | 'bp' | 'es' | 'ds', number>
>;
const REGISTER_INDEX = { ax: AX, bx: BX, cx: CX, dx: DX, si: SI, di: DI, bp: BP } as const;

export class BgiMachine implements Bus {
  readonly cpu = new Cpu86(this);
  /** Video memory, and the screen it shows. */
  readonly video = new Uint8Array(VIDEO_MEMORY);
  width = 0;
  height = 0;
  /** Bytes from one line of dots to the next. */
  bytesPerLine = 0;
  /** Where the visible screen starts in video memory. */
  displayStart = 0;
  graphics = false;
  /** The DAC: 256 colours of six-bit red, green and blue. */
  readonly dac = new Uint8Array(256 * 3);
  /** The VESA window's position in video memory. */
  private bank = 0;
  private readonly driver = new Uint8Array(0x10000);
  private readonly scratch = new Uint8Array(0x10000);
  private readonly bios = new Uint8Array(0x10000);
  private readonly sequencer = new Uint8Array(5);
  private readonly graphicsController = new Uint8Array(9);
  private readonly crtc = new Uint8Array(0x19);
  private sequencerIndex = 0;
  private graphicsIndex = 0;
  private crtcIndex = 0;
  private dacWrite = 0;
  private dacRead = 0;
  private pelMask = 0xff;
  private retrace = 0;
  /** The mode BIOS calls report: 3 (text), 13h, or a VESA one. */
  private mode = 3;
  /** Bumped whenever the screen may have changed, for the display. */
  revision = 0;

  constructor(private readonly program: ProgramMemory) {
    this.bios.set(BGI_FONT.subarray(0, 8 * 256), FONT_OFFSET);
    const modes = Object.keys(VESA_MODES).map(Number);
    modes.forEach((mode, index) => {
      this.bios[VBE_MODES_OFFSET + index * 2] = mode & 0xff;
      this.bios[VBE_MODES_OFFSET + index * 2 + 1] = mode >> 8;
    });
    this.bios[VBE_MODES_OFFSET + modes.length * 2] = 0xff;
    this.bios[VBE_MODES_OFFSET + modes.length * 2 + 1] = 0xff;
    const oem = 'P-machine VGA\0';
    for (let i = 0; i < oem.length; i++) this.bios[OEM_OFFSET + i] = oem.charCodeAt(i);
    // The window function: push ax; mov ax, 4F05h; int 10h; pop ax; retf.
    this.bios.set([0x50, 0xb8, 0x05, 0x4f, 0xcd, 0x10, 0x58, 0xcb], WINDOW_FUNCTION_OFFSET);
    this.bios[RETURN_OFFSET] = 0xf4;
    this.resetDac();
  }

  /** Loads a driver's code, which its .BGI file holds after its header. */
  load(code: Uint8Array): void {
    this.driver.fill(0);
    this.driver.set(code.subarray(0, this.driver.length));
  }
  /** The driver's own bytes, for the Graph unit's reading of its tables. */
  driverByte(offset: number): number {
    return this.driver[offset & 0xffff] ?? 0;
  }
  driverWord(offset: number): number {
    return this.driverByte(offset) | (this.driverByte(offset + 1) << 8);
  }
  /** The Graph unit's own memory, where it puts what it hands the driver. */
  scratchBytes(): Uint8Array {
    return this.scratch;
  }

  /** Calls a driver function: SI is its number times two. Returns the
   * registers it leaves. */
  callFunction(number: number, registers: Registers = {}): Registers {
    return this.callFar(DRIVER_SEGMENT, 0, { ...registers, si: number * 2 });
  }
  /** A far call into the driver's code, returning to the BIOS's HLT. */
  callFar(segment: number, offset: number, registers: Registers = {}): Registers {
    const cpu = this.cpu;
    cpu.setSegment(SS, SCRATCH_SEGMENT);
    cpu.set16(SP, STACK_TOP);
    cpu.setSegment(DS, registers.ds ?? SCRATCH_SEGMENT);
    cpu.setSegment(ES, registers.es ?? SCRATCH_SEGMENT);
    for (const [name, index] of Object.entries(REGISTER_INDEX))
      cpu.set16(index, registers[name as keyof typeof REGISTER_INDEX] ?? 0);
    cpu.halted = false;
    cpu.farCall(segment, offset, BIOS_SEGMENT, RETURN_OFFSET);
    if (cpu.run(CALL_BUDGET) >= CALL_BUDGET)
      throw new CpuFault('The graphics driver did not return');
    if (cpu.segment(CS) !== BIOS_SEGMENT || cpu.ip !== RETURN_OFFSET + 1)
      throw new CpuFault('The graphics driver halted');
    const out: Registers = { es: cpu.segment(ES), ds: cpu.segment(DS) };
    for (const [name, index] of Object.entries(REGISTER_INDEX))
      out[name as keyof typeof REGISTER_INDEX] = cpu.get16(index);
    return out;
  }

  // ---------- The bus ----------

  read8(linear: number): number {
    if (linear < 0xa0000) return this.program.read(linear);
    if (linear < 0xb0000) return this.graphics ? (this.video[this.windowAddress(linear)] ?? 0) : 0;
    if (linear < 0xc0000) return this.program.read(linear);
    if (linear < 0xd0000) return 0;
    if (linear < 0xe0000) return this.driver[linear - 0xd0000] ?? 0;
    if (linear < 0xf0000) return this.scratch[linear - 0xe0000] ?? 0;
    return this.bios[linear - 0xf0000] ?? 0;
  }
  write8(linear: number, value: number): void {
    if (linear < 0xa0000) this.program.write(linear, value);
    else if (linear < 0xb0000) {
      if (this.graphics) {
        this.video[this.windowAddress(linear)] = value;
        this.revision++;
      }
    } else if (linear < 0xc0000) this.program.write(linear, value);
    else if (linear >= 0xd0000 && linear < 0xe0000) this.driver[linear - 0xd0000] = value;
    else if (linear >= 0xe0000 && linear < 0xf0000) this.scratch[linear - 0xe0000] = value;
  }
  private windowAddress(linear: number): number {
    return (this.bank + (linear - 0xa0000)) % VIDEO_MEMORY;
  }

  input(port: number, size: 1 | 2): number {
    if (size === 2) return this.input(port, 1) | (this.input(port + 1, 1) << 8);
    switch (port) {
      case 0x3c4:
        return this.sequencerIndex;
      case 0x3c5:
        return this.sequencer[this.sequencerIndex] ?? 0;
      case 0x3ce:
        return this.graphicsIndex;
      case 0x3cf:
        return this.graphicsController[this.graphicsIndex] ?? 0;
      case 0x3d4:
        return this.crtcIndex;
      case 0x3d5:
        return this.crtc[this.crtcIndex] ?? 0;
      case 0x3c6:
        return this.pelMask;
      case 0x3c9: {
        const value = this.dac[this.dacRead] ?? 0;
        this.dacRead = (this.dacRead + 1) % this.dac.length;
        return value;
      }
      case 0x3da:
        // Display enable and vertical retrace come and go, so waits end.
        this.retrace ^= 0x09;
        return this.retrace;
      default:
        return 0xff;
    }
  }
  output(port: number, value: number, size: 1 | 2): void {
    if (size === 2) {
      this.output(port, value & 0xff, 1);
      this.output(port + 1, value >> 8, 1);
      return;
    }
    // A plain VGA: the registers past its own read as nothing and hold nothing,
    // so a driver's probes for other makers' chips find none.
    switch (port) {
      case 0x3c4:
        this.sequencerIndex = value;
        return;
      case 0x3c5:
        if (this.sequencerIndex < this.sequencer.length)
          this.sequencer[this.sequencerIndex] = value;
        return;
      case 0x3ce:
        this.graphicsIndex = value;
        return;
      case 0x3cf:
        if (this.graphicsIndex < this.graphicsController.length)
          this.graphicsController[this.graphicsIndex] = value;
        return;
      case 0x3d4:
        this.crtcIndex = value;
        return;
      case 0x3d5:
        if (this.crtcIndex < this.crtc.length) this.crtc[this.crtcIndex] = value;
        // The start address, which page flipping moves.
        if (this.crtcIndex === 0x0c || this.crtcIndex === 0x0d) {
          this.displayStart = (((this.crtc[0x0c] ?? 0) << 8) | (this.crtc[0x0d] ?? 0)) * 4;
          this.revision++;
        }
        return;
      case 0x3c6:
        this.pelMask = value;
        return;
      case 0x3c7:
        this.dacRead = (value & 0xff) * 3;
        return;
      case 0x3c8:
        this.dacWrite = (value & 0xff) * 3;
        return;
      case 0x3c9:
        this.dac[this.dacWrite] = value & 63;
        this.dacWrite = (this.dacWrite + 1) % this.dac.length;
        this.revision++;
        return;
    }
  }

  interrupt(cpu: Cpu86, number: number): boolean {
    // A divide error, or BOUND's: a fault in the driver.
    if (number === 0 || number === 5) throw new CpuFault('The graphics driver faulted');
    // Other services, such as a mouse driver's INT 33h, are not installed:
    // the call returns with the registers as they were, as their empty
    // vectors' IRET does.
    if (number !== 0x10) return true;
    const ax = cpu.get16(AX),
      ah = ax >> 8,
      al = ax & 0xff;
    if (ah === 0x00) this.setMode(al & 0x7f, (al & 0x80) === 0);
    else if (ah === 0x0f) {
      cpu.set16(AX, ((this.graphics ? this.width / 8 : 80) << 8) | (this.mode & 0xff));
      cpu.set8(7, 0);
    } else if (ax === 0x1130) {
      // The 8x8 font, for the driver's own text.
      cpu.setSegment(ES, BIOS_SEGMENT);
      cpu.set16(BP, FONT_OFFSET);
      cpu.set16(CX, 8);
      cpu.set8(2, 24);
    } else if (ah === 0x10) this.dacService(cpu, al);
    else if (ah === 0x1a && al === 0) {
      // VGA with analog colour display.
      cpu.set8(0, 0x1a);
      cpu.set16(BX, 0x0008);
    } else if (ah === 0x12 && (cpu.get16(BX) & 0xff) === 0x10) {
      cpu.set16(BX, 0x0003);
      cpu.set16(CX, 0x0009);
    } else if (ah === 0x4f) this.vesa(cpu, al);
    return true;
  }

  /** INT 10h AH=00h, and VESA's set mode. */
  private setMode(mode: number, clear: boolean, vesa = false): boolean {
    if (vesa) {
      const size = VESA_MODES[mode];
      if (!size) return false;
      this.width = size.width;
      this.height = size.height;
    } else if (mode === 0x13) {
      this.width = 320;
      this.height = 200;
    } else {
      this.graphics = false;
      this.mode = mode;
      this.revision++;
      return true;
    }
    this.graphics = true;
    this.mode = mode;
    this.bytesPerLine = this.width;
    this.bank = 0;
    this.displayStart = 0;
    this.crtc[0x0c] = this.crtc[0x0d] = 0;
    if (clear) this.video.fill(0);
    this.resetDac();
    this.revision++;
    return true;
  }
  private resetDac(): void {
    defaultVgaPalette().forEach(([red, green, blue], index) => {
      this.dac[index * 3] = red;
      this.dac[index * 3 + 1] = green;
      this.dac[index * 3 + 2] = blue;
    });
  }
  /** INT 10h AH=10h: the DAC's registers. */
  private dacService(cpu: Cpu86, al: number): void {
    const index = cpu.get16(BX);
    switch (al) {
      case 0x10:
        // DH red, CH green, CL blue.
        this.dac[(index & 0xff) * 3] = cpu.get8(6) & 63;
        this.dac[(index & 0xff) * 3 + 1] = cpu.get8(5) & 63;
        this.dac[(index & 0xff) * 3 + 2] = cpu.get8(1) & 63;
        this.revision++;
        return;
      case 0x12: {
        // CX colours from BX, from ES:DX.
        const count = cpu.get16(CX);
        for (let i = 0; i < count * 3; i++) {
          const at = ((index & 0xff) * 3 + i) % this.dac.length;
          this.dac[at] = cpu.readByte(cpu.segment(ES), (cpu.get16(DX) + i) & 0xffff) & 63;
        }
        this.revision++;
        return;
      }
      case 0x15:
        cpu.set8(6, this.dac[(index & 0xff) * 3] ?? 0);
        cpu.set8(5, this.dac[(index & 0xff) * 3 + 1] ?? 0);
        cpu.set8(1, this.dac[(index & 0xff) * 3 + 2] ?? 0);
        return;
      case 0x17: {
        const count = cpu.get16(CX);
        for (let i = 0; i < count * 3; i++)
          cpu.writeByte(
            cpu.segment(ES),
            (cpu.get16(DX) + i) & 0xffff,
            this.dac[((index & 0xff) * 3 + i) % this.dac.length] ?? 0
          );
        return;
      }
    }
  }
  /** INT 10h AH=4Fh: the VESA BIOS, version 1.2. */
  private vesa(cpu: Cpu86, al: number): void {
    const es = cpu.segment(ES),
      di = cpu.get16(DI);
    const word = (offset: number, value: number) =>
      { cpu.writeWord(es, (di + offset) & 0xffff, value); };
    const byte = (offset: number, value: number) =>
      { cpu.writeByte(es, (di + offset) & 0xffff, value); };
    let ok = true;
    switch (al) {
      case 0x00:
        for (let i = 0; i < 256; i++) byte(i, 0);
        'VESA'.split('').forEach((char, i) => { byte(i, char.charCodeAt(0)); });
        word(4, 0x0102);
        word(6, OEM_OFFSET);
        word(8, BIOS_SEGMENT);
        word(14, VBE_MODES_OFFSET);
        word(16, BIOS_SEGMENT);
        word(18, VIDEO_MEMORY >> 16);
        break;
      case 0x01: {
        const size = VESA_MODES[cpu.get16(CX) & 0x1ff];
        if (!size) {
          ok = false;
          break;
        }
        for (let i = 0; i < 256; i++) byte(i, 0);
        word(0, 0x001b);
        byte(2, 0x07);
        byte(3, 0x00);
        word(4, 64);
        word(6, 64);
        word(8, 0xa000);
        word(10, 0);
        word(12, WINDOW_FUNCTION_OFFSET);
        word(14, BIOS_SEGMENT);
        word(16, size.width);
        word(18, size.width);
        word(20, size.height);
        byte(22, 8);
        byte(23, 8);
        byte(24, 1);
        byte(25, 8);
        byte(26, 1);
        byte(27, 4);
        byte(28, 0);
        byte(29, Math.max(0, Math.floor(VIDEO_MEMORY / (size.width * size.height)) - 1));
        byte(30, 1);
        break;
      }
      case 0x02:
        ok = this.setMode(cpu.get16(BX) & 0x1ff, (cpu.get16(BX) & 0x8000) === 0, true);
        break;
      case 0x03:
        cpu.set16(BX, this.mode);
        break;
      case 0x05:
        if (cpu.get16(BX) >> 8 === 0) this.bank = (cpu.get16(DX) * 0x10000) % VIDEO_MEMORY;
        else cpu.set16(DX, Math.floor(this.bank / 0x10000));
        break;
      case 0x06:
        // Logical line length: kept at the screen's width.
        cpu.set16(BX, this.bytesPerLine);
        cpu.set16(CX, this.width);
        cpu.set16(DX, Math.floor(VIDEO_MEMORY / Math.max(1, this.bytesPerLine)));
        break;
      case 0x07:
        if ((cpu.get16(BX) & 0xff) === 0) {
          this.displayStart = cpu.get16(DX) * this.bytesPerLine + cpu.get16(CX);
          this.revision++;
        } else {
          cpu.set16(CX, this.displayStart % Math.max(1, this.bytesPerLine));
          cpu.set16(DX, Math.floor(this.displayStart / Math.max(1, this.bytesPerLine)));
        }
        break;
      default:
        ok = false;
    }
    cpu.set16(AX, ok ? 0x004f : 0x014f);
  }

  /** The screen, a byte a dot, from the display start. */
  screen(): Uint8Array {
    const size = this.width * this.height;
    const start = this.displayStart % VIDEO_MEMORY;
    if (start + size <= VIDEO_MEMORY && this.bytesPerLine === this.width)
      return this.video.subarray(start, start + size);
    const out = new Uint8Array(size);
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        out[y * this.width + x] =
          this.video[(start + y * this.bytesPerLine + x) % VIDEO_MEMORY] ?? 0;
    return out;
  }
  /** The DAC as 24-bit colours, for the display. */
  colours(): number[] {
    const colours: number[] = [];
    for (let index = 0; index < 256; index++) {
      const [red, green, blue] = [0, 1, 2].map((component) => {
        const level = (this.dac[index * 3 + component] ?? 0) & (this.pelMask >> 2);
        return Math.round((level * 255) / 63);
      });
      colours.push(((red ?? 0) << 16) | ((green ?? 0) << 8) | (blue ?? 0));
    }
    return colours;
  }
}
