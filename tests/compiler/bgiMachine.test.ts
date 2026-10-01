import { describe, expect, it } from 'vitest';
import { BgiMachine } from '../../src/compiler/runtime/BgiMachine';
import { AX, BX } from '../../src/compiler/runtime/Cpu86';

const WINDOW = 0xa0000;
const PLANE = 0x40000;

/** The emulated PC, its BIOS asked for a mode. */
function vga(mode: number) {
  const machine = new BgiMachine({ read: () => 0, write: () => undefined });
  machine.cpu.set16(AX, mode);
  machine.interrupt(machine.cpu, 0x10);
  /** A graphics controller or sequencer register, by index and value. */
  const gc = (index: number, value: number) => {
    machine.output(0x3ce, (value << 8) | index, 2);
  };
  const sequencer = (index: number, value: number) => {
    machine.output(0x3c4, (value << 8) | index, 2);
  };
  const plane = (number: number, offset = 0) => machine.video[number * PLANE + offset];
  return { machine, gc, sequencer, plane };
}

describe("the emulated VGA's bit planes", () => {
  it('opens mode 12h in four planes, with the EGA palette', () => {
    const { machine } = vga(0x12);
    expect([machine.planar, machine.width, machine.height, machine.bytesPerLine]).toEqual([
      true,
      640,
      480,
      80,
    ]);
    // Colour 6 shows the EGA's brown, entry 20 of the DAC.
    expect(Array.from(machine.dac.subarray(20 * 3, 20 * 3 + 3))).toEqual([42, 21, 0]);
  });

  it('writes a colour to the dots the bit mask leaves, in write mode 2', () => {
    const { machine, gc, plane } = vga(0x12);
    gc(5, 2);
    gc(8, 0x81);
    machine.read8(WINDOW);
    machine.write8(WINDOW, 12);
    expect([0, 1, 2, 3].map((number) => plane(number))).toEqual([0, 0, 0x81, 0x81]);
    // The screen shows each dot's four bits through its palette register.
    const screen = machine.screen();
    expect([screen[0], screen[1], screen[7]]).toEqual([60, 0, 60]);
  });

  it("writes set/reset's colour, and rotates and combines the CPU's byte, in write mode 0", () => {
    const { machine, gc, sequencer, plane } = vga(0x12);
    gc(1, 0x0f);
    gc(0, 9);
    machine.write8(WINDOW, 0);
    expect([0, 1, 2, 3].map((number) => plane(number))).toEqual([0xff, 0, 0, 0xff]);
    // XOR with the latches a read filled, rotated right by one, in plane 0 only.
    gc(1, 0);
    gc(3, 0x18 | 1);
    sequencer(2, 1);
    machine.read8(WINDOW);
    machine.write8(WINDOW, 0x01);
    expect([plane(0), plane(3)]).toEqual([0x7f, 0xff]);
  });

  it('copies the latches in write mode 1, and ANDs the bit mask with the data in write mode 3', () => {
    const { machine, gc, plane } = vga(0x12);
    gc(1, 0x0f);
    gc(0, 5);
    machine.write8(WINDOW, 0);
    gc(1, 0);
    gc(5, 1);
    machine.read8(WINDOW);
    machine.write8(WINDOW + 10, 0x55);
    expect([0, 1, 2, 3].map((number) => plane(number, 10))).toEqual([0xff, 0, 0xff, 0]);
    gc(5, 3);
    gc(0, 2);
    machine.read8(WINDOW + 20);
    machine.write8(WINDOW + 20, 0xf0);
    expect([0, 1, 2, 3].map((number) => plane(number, 20))).toEqual([0, 0xf0, 0, 0]);
  });

  it('reads the plane Read Map Select names, or compares colours in read mode 1', () => {
    const { machine, gc } = vga(0x12);
    gc(5, 2);
    gc(8, 0xf0);
    machine.read8(WINDOW);
    machine.write8(WINDOW, 6);
    gc(8, 0x0f);
    machine.read8(WINDOW);
    machine.write8(WINDOW, 3);
    gc(5, 0);
    gc(4, 2);
    expect(machine.read8(WINDOW)).toBe(0xf0);
    gc(5, 0x08);
    gc(2, 3);
    gc(7, 0x0f);
    expect(machine.read8(WINDOW)).toBe(0x0f);
    // Planes left out of the comparison match whatever they hold: colours 6
    // and 3 share plane 1.
    gc(7, 0x02);
    expect(machine.read8(WINDOW)).toBe(0xff);
  });

  it('maps colours through the palette registers the BIOS and port 3C0h set', () => {
    const { machine, gc } = vga(0x12);
    gc(5, 2);
    machine.read8(WINDOW);
    machine.write8(WINDOW, 1);
    machine.cpu.set16(AX, 0x1000);
    machine.cpu.set16(BX, 0x3f01);
    machine.interrupt(machine.cpu, 0x10);
    expect(machine.screen()[0]).toBe(63);
    machine.input(0x3da, 1);
    machine.output(0x3c0, 1, 1);
    machine.output(0x3c0, 0x24, 1);
    expect(machine.screen()[0]).toBe(0x24);
  });

  it('combines with the latch in the 256-color modes too', () => {
    const { machine, gc } = vga(0x13);
    machine.write8(WINDOW + 5, 0x0f);
    gc(3, 0x18);
    machine.read8(WINDOW + 5);
    machine.write8(WINDOW + 5, 0xff);
    expect(machine.video[5]).toBe(0xf0);
  });
});
