/**
 * The PC a BGI graphics driver runs on: an 8086 (Cpu86), a VGA with a VESA
 * 1.2 BIOS, and the program's memory, which the driver reaches through the
 * far pointers the Graph unit hands it. The driver's code lies in a segment
 * of its own, and the Graph unit calls it as Borland's does: a far call to
 * the code's first byte, its entry, with the function's number times two in
 * SI and its arguments in registers.
 *
 * Memory: the program's below A000; the VGA's window at A000, 64K of a
 * megabyte of video memory chosen by the VESA bank: a byte a dot in the
 * 256-colour modes, or in the 16-colour ones four bit planes of 256K, which
 * the graphics controller writes and reads as the VGA's does; C000, the video BIOS,
 * empty; D000, the driver; E000, the Graph unit's own data and the stack it
 * calls the driver on; F000, the BIOS: its 8x8 font, its VESA tables and
 * the routine that switches banks.
 */
import { AX, BP, BX, CS, CX, Cpu86, CpuFault, DI, DS, DX, ES, SI, SP, SS, type Bus } from './Cpu86';
import { BGI_FONT } from '../../tui/bgiFont';
import { DEFAULT_PALETTE, defaultVgaPalette, egaDac } from './GraphicsRuntime';

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

const PLANE = VIDEO_MEMORY / 4;

/** The VESA modes the video BIOS offers: 256 colours, a byte a dot, or 16
 * in four bit planes. */
export const VESA_MODES: Record<number, { width: number; height: number; planar?: boolean }> = {
  0x100: { width: 640, height: 400 },
  0x101: { width: 640, height: 480 },
  0x102: { width: 800, height: 600, planar: true },
  0x103: { width: 800, height: 600 },
  0x104: { width: 1024, height: 768, planar: true },
  0x105: { width: 1024, height: 768 },
};
/** The BIOS's 16-colour modes, in bit planes: EGA's and VGA's. */
const PLANAR_MODES: Record<number, { width: number; height: number }> = {
  0x0d: { width: 320, height: 200 },
  0x0e: { width: 640, height: 200 },
  0x10: { width: 640, height: 350 },
  0x12: { width: 640, height: 480 },
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
  /** Whether the mode keeps 16 colours in four bit planes. */
  planar = false;
  /** The four latches, which a read of the planes fills. */
  private readonly latches = new Uint8Array(4);
  /** The attribute controller's registers: the sixteen palette registers,
   * which give a planar dot's DAC entry, then the mode control and the rest;
   * its port takes an index and a value in turn. */
  private readonly attributes = new Uint8Array(0x15);
  private attributeIndex = 0;
  private attributeData = false;
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
  /** The BIOS's 8x8 font: eight bytes a character. */
  font(): Uint8Array {
    return this.bios.subarray(FONT_OFFSET, FONT_OFFSET + 8 * 256);
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
    if (linear < 0xb0000) return this.graphics ? this.readVideo(this.windowAddress(linear)) : 0;
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
        this.writeVideo(this.windowAddress(linear), value);
        this.revision++;
      }
    } else if (linear < 0xc0000) this.program.write(linear, value);
    else if (linear >= 0xd0000 && linear < 0xe0000) this.driver[linear - 0xd0000] = value;
    else if (linear >= 0xe0000 && linear < 0xf0000) this.scratch[linear - 0xe0000] = value;
  }
  private windowAddress(linear: number): number {
    return (this.bank + (linear - 0xa0000)) % (this.planar ? PLANE : VIDEO_MEMORY);
  }
  /** A read through the graphics controller: it fills the latches, and in
   * read mode 0 gives the plane Read Map Select names, in read mode 1 a bit
   * for each dot whose colour matches Color Compare in the planes Color
   * Don't Care keeps. */
  private readVideo(address: number): number {
    if (!this.planar) {
      const value = this.video[address] ?? 0;
      this.latches[0] = value;
      return value;
    }
    for (let plane = 0; plane < 4; plane++)
      this.latches[plane] = this.video[plane * PLANE + address] ?? 0;
    const gc = this.graphicsController;
    if (!((gc[5] ?? 0) & 0x08)) return this.latches[(gc[4] ?? 0) & 3] ?? 0;
    let match = 0xff;
    for (let plane = 0; plane < 4; plane++) {
      if (!(((gc[7] ?? 0) >> plane) & 1)) continue;
      const wanted = ((gc[2] ?? 0) >> plane) & 1 ? 0xff : 0;
      match &= ~((this.latches[plane] ?? 0) ^ wanted);
    }
    return match & 0xff;
  }
  /** The logic unit: a value combined with a latch, or left as it is. */
  private combine(value: number, latch: number): number {
    switch (((this.graphicsController[3] ?? 0) >> 3) & 3) {
      case 1:
        return value & latch;
      case 2:
        return value | latch;
      case 3:
        return value ^ latch;
      default:
        return value;
    }
  }
  /** A write through the graphics controller, in its write mode: the data
   * rotated, or set/reset's colour, combined with the latches by the logic
   * unit, under the bit mask, into the planes the map mask enables. */
  private writeVideo(address: number, data: number): void {
    const gc = this.graphicsController;
    const rotate = (gc[3] ?? 0) & 7;
    const rotated = ((data >> rotate) | (data << (8 - rotate))) & 0xff;
    if (!this.planar) {
      // A byte a dot: the logic unit and bit mask still stand between the
      // CPU and the dot, as XOR drawing in the 256-colour modes uses.
      const mask = gc[8] ?? 0xff;
      const latch = this.latches[0] ?? 0;
      this.video[address] = (this.combine(rotated, latch) & mask) | (latch & ~mask & 0xff);
      return;
    }
    const mode = (gc[5] ?? 0) & 3;
    const enable = (this.sequencer[2] ?? 0x0f) & 0x0f;
    for (let plane = 0; plane < 4; plane++) {
      if (!((enable >> plane) & 1)) continue;
      const latch = this.latches[plane] ?? 0;
      const setReset = ((gc[0] ?? 0) >> plane) & 1 ? 0xff : 0;
      let value: number,
        mask = gc[8] ?? 0xff;
      if (mode === 1) value = latch;
      else if (mode === 2) value = this.combine((data >> plane) & 1 ? 0xff : 0, latch);
      else if (mode === 3) {
        value = this.combine(setReset, latch);
        mask &= rotated;
      } else value = this.combine(((gc[1] ?? 0) >> plane) & 1 ? setReset : rotated, latch);
      if (mode !== 1) value = (value & mask) | (latch & ~mask & 0xff);
      this.video[plane * PLANE + address] = value;
    }
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
      case 0x3c0:
        return this.attributeIndex;
      case 0x3c1:
        return this.attributes[this.attributeIndex & 0x1f] ?? 0;
      case 0x3da:
        // Display enable and vertical retrace come and go, so waits end.
        // Reading it also sends the attribute controller's port back to
        // taking an index.
        this.attributeData = false;
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
      case 0x3c0:
        if (this.attributeData && this.attributeIndex < this.attributes.length) {
          this.attributes[this.attributeIndex] = value;
          this.revision++;
        } else if (!this.attributeData) this.attributeIndex = value & 0x1f;
        this.attributeData = !this.attributeData;
        return;
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
          // In bytes of the planes, or four dots a byte in mode 13h's chain 4.
          this.displayStart =
            (((this.crtc[0x0c] ?? 0) << 8) | (this.crtc[0x0d] ?? 0)) * (this.planar ? 1 : 4);
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
    const size = vesa
      ? VESA_MODES[mode]
      : mode === 0x13
        ? { width: 320, height: 200 }
        : PLANAR_MODES[mode];
    if (size) {
      this.width = size.width;
      this.height = size.height;
      this.planar = vesa ? Boolean(VESA_MODES[mode]?.planar) : mode !== 0x13;
    } else if (vesa) return false;
    else {
      this.graphics = false;
      this.mode = mode;
      this.revision++;
      return true;
    }
    this.graphics = true;
    this.mode = mode;
    this.bytesPerLine = this.planar ? this.width / 8 : this.width;
    this.bank = 0;
    this.displayStart = 0;
    this.crtc[0x0c] = this.crtc[0x0d] = 0;
    if (clear) this.video.fill(0);
    // The registers as the BIOS leaves them: all planes written, write mode
    // 0, no set/reset, rotation or logic, every bit, and the EGA's palette.
    this.graphicsController.fill(0);
    this.graphicsController[7] = 0x0f;
    this.graphicsController[8] = 0xff;
    this.sequencer[2] = 0x0f;
    this.attributes.fill(0);
    this.attributes.set(DEFAULT_PALETTE, 0);
    this.attributes[0x12] = 0x0f;
    this.resetDac();
    this.revision++;
    return true;
  }
  private resetDac(): void {
    // The 16-colour modes start with the EGA's 64 colours.
    (this.planar ? egaDac() : defaultVgaPalette()).forEach(([red, green, blue], index) => {
      this.dac[index * 3] = red;
      this.dac[index * 3 + 1] = green;
      this.dac[index * 3 + 2] = blue;
    });
  }
  /** INT 10h AH=10h: the DAC's registers. */
  private dacService(cpu: Cpu86, al: number): void {
    const index = cpu.get16(BX);
    switch (al) {
      case 0x00:
        // Palette register BL to BH.
        if ((index & 0xff) < 16) this.attributes[index & 0xff] = (index >> 8) & 0x3f;
        this.revision++;
        return;
      case 0x02:
        // All sixteen, and the overscan, from ES:DX.
        for (let i = 0; i < 17; i++)
          this.attributes[i === 16 ? 0x11 : i] = cpu.readByte(
            cpu.segment(ES),
            (cpu.get16(DX) + i) & 0xffff
          );
        this.revision++;
        return;
      case 0x07:
        cpu.set8(7, this.attributes[index & 0x1f] ?? 0);
        return;
      case 0x09:
        for (let i = 0; i < 17; i++)
          cpu.writeByte(
            cpu.segment(ES),
            (cpu.get16(DX) + i) & 0xffff,
            this.attributes[i === 16 ? 0x11 : i] ?? 0
          );
        return;
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
    const word = (offset: number, value: number) => {
      cpu.writeWord(es, (di + offset) & 0xffff, value);
    };
    const byte = (offset: number, value: number) => {
      cpu.writeByte(es, (di + offset) & 0xffff, value);
    };
    let ok = true;
    switch (al) {
      case 0x00:
        for (let i = 0; i < 256; i++) byte(i, 0);
        'VESA'.split('').forEach((char, i) => {
          byte(i, char.charCodeAt(0));
        });
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
        // Bytes a line, the size, the character cell, the planes, the bits
        // a dot, the banks, and the memory model: 3 planar, 4 packed.
        word(16, size.planar ? size.width / 8 : size.width);
        word(18, size.width);
        word(20, size.height);
        byte(22, 8);
        byte(23, 8);
        byte(24, size.planar ? 4 : 1);
        byte(25, size.planar ? 4 : 8);
        byte(26, 1);
        byte(27, size.planar ? 3 : 4);
        byte(28, 0);
        byte(
          29,
          Math.max(
            0,
            Math.floor((size.planar ? PLANE * 8 : VIDEO_MEMORY) / (size.width * size.height)) - 1
          )
        );
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
        if (cpu.get16(BX) >> 8 === 0)
          this.bank = (cpu.get16(DX) * 0x10000) % (this.planar ? PLANE : VIDEO_MEMORY);
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

  /** The screen, a byte a dot, from the display start: in the 16-colour
   * modes, each dot's four plane bits through its palette register. */
  screen(): Uint8Array {
    const size = this.width * this.height;
    if (this.planar) {
      const out = new Uint8Array(size);
      const lineBytes = this.bytesPerLine;
      for (let y = 0; y < this.height; y++)
        for (let byte = 0; byte < lineBytes; byte++) {
          const at = (this.displayStart + y * lineBytes + byte) % PLANE;
          const planes = [0, 1, 2, 3].map((plane) => this.video[plane * PLANE + at] ?? 0);
          for (let bit = 0; bit < 8; bit++) {
            const x = byte * 8 + bit;
            if (x >= this.width) break;
            let colour = 0;
            planes.forEach((bits, plane) => {
              colour |= ((bits >> (7 - bit)) & 1) << plane;
            });
            out[y * this.width + x] =
              (this.attributes[colour & (this.attributes[0x12] ?? 0x0f)] ?? 0) & 0x3f;
          }
        }
      return out;
    }
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
