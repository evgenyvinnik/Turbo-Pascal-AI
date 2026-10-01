import { describe, expect, it } from 'vitest';
import {
  AX,
  BP,
  BX,
  CS,
  CX,
  Cpu86,
  DI,
  DS,
  DX,
  ES,
  SI,
  SP,
  SS,
  FLAGS,
} from '../../src/compiler/runtime/Cpu86';
import { PROGRAMS } from '../fixtures/x86/programs';

/** Runs one of tests/fixtures/x86 at 1000:0000 until HLT. */
function run(name: string) {
  const memory = new Uint8Array(1 << 20);
  memory.set(Buffer.from(PROGRAMS[name] ?? '', 'hex'), 0x10000);
  const ports: [number, number][] = [];
  const cpu = new Cpu86({
    read8: (address) => memory[address] ?? 0,
    write8: (address, value) => {
      memory[address] = value;
    },
    input: () => 0xff,
    output: (port, value) => {
      ports.push([port, value]);
    },
    interrupt: () => false,
  });
  for (const segment of [CS, DS, ES]) cpu.setSegment(segment, 0x1000);
  cpu.setSegment(SS, 0x2000);
  cpu.set16(SP, 0xfffe);
  cpu.run(100_000);
  return { cpu, memory, ports };
}

describe('The 8086 that runs drivers', () => {
  it('computes and sets flags as the 8086 does', () => {
    const { cpu } = run('arithmetic');
    expect(cpu.halted).toBe(true);
    expect([BX, SI, DI, BP, DX, AX].map((register) => cpu.get16(register))).toEqual([
      0x8000, 10000, 0xfffd, 0xffff, 0x1234, 0xff88,
    ]);
    expect(cpu.flags & (FLAGS.CF | FLAGS.PF | FLAGS.SF | FLAGS.ZF | FLAGS.OF)).toBe(
      FLAGS.CF | FLAGS.PF | FLAGS.SF
    );
  });

  it('repeats strings, loops, calls far, adjusts BCD and interrupts through the vector table', () => {
    const { cpu } = run('control');
    expect(cpu.halted).toBe(true);
    expect({
      ax: cpu.get16(AX),
      bx: cpu.get16(BX),
      cx: cpu.get16(CX),
      dx: cpu.get16(DX),
      si: cpu.get16(SI),
      di: cpu.get16(DI),
      bp: cpu.get16(BP),
      sp: cpu.get16(SP),
    }).toEqual({
      ax: 0x4747,
      bx: 3,
      cx: 0xbeef,
      dx: 57,
      si: 0x1234,
      di: 0x5678,
      bp: 0,
      sp: 0xfffe,
    });
  });
});
