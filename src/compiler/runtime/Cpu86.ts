/**
 * An 8086 with the 80186's additions, running machine code from a flat
 * megabyte as a PC does: instructions are fetched byte by byte at CS:IP, and
 * memory, ports and software interrupts go through a bus. It runs the code
 * of programs' BGI graphics drivers, which the built-in assembler's
 * instruction-level machine cannot: their code is bytes, reached by far
 * calls into a segment of their own.
 */

/** What the processor reads, writes and calls out to. */
export interface Bus {
  read8(linear: number): number;
  write8(linear: number, value: number): void;
  input(port: number, size: 1 | 2): number;
  output(port: number, value: number, size: 1 | 2): void;
  /** A software or exception interrupt. True when the bus served it, as a
   * BIOS routine would; otherwise the interrupt vector table is followed. */
  interrupt(cpu: Cpu86, number: number): boolean;
}

/** The word registers in the order instructions encode them. */
export const AX = 0,
  CX = 1,
  DX = 2,
  BX = 3,
  SP = 4,
  BP = 5,
  SI = 6,
  DI = 7;
/** The segment registers in the order instructions encode them. */
export const ES = 0,
  CS = 1,
  SS = 2,
  DS = 3;

const CF = 0x0001,
  PF = 0x0004,
  AF = 0x0010,
  ZF = 0x0040,
  SF = 0x0080,
  TF = 0x0100,
  IF = 0x0200,
  DF = 0x0400,
  OF = 0x0800;
export const FLAGS = { CF, PF, AF, ZF, SF, TF, IF, DF, OF };

const PARITY = new Uint8Array(256);
for (let value = 0; value < 256; value++) {
  let bits = 0;
  for (let bit = value; bit; bit >>= 1) bits += bit & 1;
  PARITY[value] = bits % 2 === 0 ? PF : 0;
}

export class CpuFault extends Error {}

export class Cpu86 {
  readonly regs = new Uint16Array(8);
  readonly sregs = new Uint16Array(4);
  ip = 0;
  /** Bit 1 is always set, as the 8086's FLAGS has it. */
  flags = 0x0002;
  halted = false;
  /** Instructions run, in all. */
  executed = 0;
  private segmentOverride = -1;
  private repeat: 0 | 0xf2 | 0xf3 = 0;
  /** The current instruction's ModR/M fields and effective address. */
  private mod = 0;
  private reg = 0;
  private rm = 0;
  private ea = 0;
  private eaSegment = 0;

  constructor(readonly bus: Bus) {}

  // ---------- Registers ----------

  get8(index: number): number {
    const word = this.regs[index & 3] ?? 0;
    return index < 4 ? word & 0xff : word >> 8;
  }
  set8(index: number, value: number): void {
    const at = index & 3;
    const word = this.regs[at] ?? 0;
    this.regs[at] =
      index < 4 ? (word & 0xff00) | (value & 0xff) : (word & 0xff) | ((value & 0xff) << 8);
  }
  get16(index: number): number {
    return this.regs[index] ?? 0;
  }
  set16(index: number, value: number): void {
    this.regs[index] = value;
  }
  segment(index: number): number {
    return this.sregs[index] ?? 0;
  }
  setSegment(index: number, value: number): void {
    this.sregs[index] = value;
  }
  flag(mask: number): boolean {
    return (this.flags & mask) !== 0;
  }
  setFlag(mask: number, on: boolean): void {
    this.flags = on ? this.flags | mask : this.flags & ~mask;
  }

  // ---------- Memory ----------

  static linear(segment: number, offset: number): number {
    return ((segment << 4) + (offset & 0xffff)) & 0xfffff;
  }
  readByte(segment: number, offset: number): number {
    return this.bus.read8(Cpu86.linear(segment, offset)) & 0xff;
  }
  readWord(segment: number, offset: number): number {
    return this.readByte(segment, offset) | (this.readByte(segment, (offset + 1) & 0xffff) << 8);
  }
  writeByte(segment: number, offset: number, value: number): void {
    this.bus.write8(Cpu86.linear(segment, offset), value & 0xff);
  }
  writeWord(segment: number, offset: number, value: number): void {
    this.writeByte(segment, offset, value);
    this.writeByte(segment, (offset + 1) & 0xffff, value >> 8);
  }
  push(value: number): void {
    const sp = (this.get16(SP) - 2) & 0xffff;
    this.set16(SP, sp);
    this.writeWord(this.segment(SS), sp, value);
  }
  pop(): number {
    const sp = this.get16(SP);
    const value = this.readWord(this.segment(SS), sp);
    this.set16(SP, (sp + 2) & 0xffff);
    return value;
  }
  private fetch8(): number {
    const value = this.readByte(this.segment(CS), this.ip);
    this.ip = (this.ip + 1) & 0xffff;
    return value;
  }
  private fetch16(): number {
    const low = this.fetch8();
    return low | (this.fetch8() << 8);
  }
  private fetchSigned8(): number {
    const value = this.fetch8();
    return value >= 0x80 ? value - 0x100 : value;
  }

  // ---------- ModR/M ----------

  private modrm(): void {
    const byte = this.fetch8();
    this.mod = byte >> 6;
    this.reg = (byte >> 3) & 7;
    this.rm = byte & 7;
    if (this.mod === 3) return;
    let offset = 0;
    let segment = DS;
    switch (this.rm) {
      case 0:
        offset = this.get16(BX) + this.get16(SI);
        break;
      case 1:
        offset = this.get16(BX) + this.get16(DI);
        break;
      case 2:
        offset = this.get16(BP) + this.get16(SI);
        segment = SS;
        break;
      case 3:
        offset = this.get16(BP) + this.get16(DI);
        segment = SS;
        break;
      case 4:
        offset = this.get16(SI);
        break;
      case 5:
        offset = this.get16(DI);
        break;
      case 6:
        if (this.mod === 0) offset = this.fetch16();
        else {
          offset = this.get16(BP);
          segment = SS;
        }
        break;
      case 7:
        offset = this.get16(BX);
        break;
    }
    if (this.mod === 1) offset += this.fetchSigned8();
    else if (this.mod === 2) offset += this.fetch16();
    this.ea = offset & 0xffff;
    this.eaSegment = this.segmentOverride >= 0 ? this.segmentOverride : segment;
  }
  private readRm8(): number {
    return this.mod === 3
      ? this.get8(this.rm)
      : this.readByte(this.segment(this.eaSegment), this.ea);
  }
  private readRm16(): number {
    return this.mod === 3
      ? this.get16(this.rm)
      : this.readWord(this.segment(this.eaSegment), this.ea);
  }
  private writeRm8(value: number): void {
    if (this.mod === 3) this.set8(this.rm, value);
    else this.writeByte(this.segment(this.eaSegment), this.ea, value);
  }
  private writeRm16(value: number): void {
    if (this.mod === 3) this.set16(this.rm, value);
    else this.writeWord(this.segment(this.eaSegment), this.ea, value);
  }
  /** The segment a string source or a memory-offset operand uses. */
  private dataSegment(): number {
    return this.segment(this.segmentOverride >= 0 ? this.segmentOverride : DS);
  }

  // ---------- Arithmetic ----------

  private logicFlags(result: number, size: 8 | 16): number {
    const mask = size === 8 ? 0xff : 0xffff;
    const sign = size === 8 ? 0x80 : 0x8000;
    result &= mask;
    this.flags &= ~(CF | OF | AF | ZF | SF | PF);
    if (result === 0) this.flags |= ZF;
    if (result & sign) this.flags |= SF;
    this.flags |= PARITY[result & 0xff] ?? 0;
    return result;
  }
  private add(a: number, b: number, carry: number, size: 8 | 16): number {
    const mask = size === 8 ? 0xff : 0xffff;
    const sign = size === 8 ? 0x80 : 0x8000;
    const sum = a + b + carry;
    const result = this.logicFlags(sum, size);
    if (sum > mask) this.flags |= CF;
    if ((a ^ b ^ sum) & 0x10) this.flags |= AF;
    if (~(a ^ b) & (a ^ sum) & sign) this.flags |= OF;
    return result;
  }
  private sub(a: number, b: number, borrow: number, size: 8 | 16): number {
    const sign = size === 8 ? 0x80 : 0x8000;
    const difference = a - b - borrow;
    const result = this.logicFlags(difference, size);
    if (difference < 0) this.flags |= CF;
    if ((a ^ b ^ difference) & 0x10) this.flags |= AF;
    if ((a ^ b) & (a ^ difference) & sign) this.flags |= OF;
    return result;
  }
  /** ADD, OR, ADC, SBB, AND, SUB, XOR, CMP by their number. */
  private alu(operation: number, a: number, b: number, size: 8 | 16): number {
    const carry = this.flags & CF;
    switch (operation) {
      case 0:
        return this.add(a, b, 0, size);
      case 1:
        return this.logicFlags(a | b, size);
      case 2:
        return this.add(a, b, carry, size);
      case 3:
        return this.sub(a, b, carry, size);
      case 4:
        return this.logicFlags(a & b, size);
      case 5:
      case 7:
        return this.sub(a, b, 0, size);
      default:
        return this.logicFlags(a ^ b, size);
    }
  }
  private incDec(value: number, delta: 1 | -1, size: 8 | 16): number {
    const carry = this.flags & CF;
    const result = delta === 1 ? this.add(value, 1, 0, size) : this.sub(value, 1, 0, size);
    this.flags = (this.flags & ~CF) | carry;
    return result;
  }
  /** ROL, ROR, RCL, RCR, SHL, SHR, SAL, SAR by their number, `count` times. */
  private shift(operation: number, value: number, count: number, size: 8 | 16): number {
    // The 80186 takes the count modulo 32.
    count &= 0x1f;
    if (count === 0) return value;
    const bits = size;
    const mask = size === 8 ? 0xff : 0xffff;
    const sign = size === 8 ? 0x80 : 0x8000;
    let result = value & mask;
    let carry = this.flag(CF) ? 1 : 0;
    switch (operation) {
      case 0:
        for (let i = 0; i < count; i++) {
          carry = result & sign ? 1 : 0;
          result = ((result << 1) | carry) & mask;
        }
        this.setFlag(CF, carry === 1);
        this.setFlag(OF, ((result & sign ? 1 : 0) ^ carry) === 1);
        return result;
      case 1:
        for (let i = 0; i < count; i++) {
          carry = result & 1;
          result = (result >> 1) | (carry ? sign : 0);
        }
        this.setFlag(CF, carry === 1);
        this.setFlag(OF, (((result >> (bits - 1)) ^ (result >> (bits - 2))) & 1) === 1);
        return result;
      case 2:
        for (let i = 0; i < count; i++) {
          const out = result & sign ? 1 : 0;
          result = ((result << 1) | carry) & mask;
          carry = out;
        }
        this.setFlag(CF, carry === 1);
        this.setFlag(OF, ((result & sign ? 1 : 0) ^ carry) === 1);
        return result;
      case 3:
        for (let i = 0; i < count; i++) {
          const out = result & 1;
          result = (result >> 1) | (carry ? sign : 0);
          carry = out;
        }
        this.setFlag(CF, carry === 1);
        this.setFlag(OF, (((result >> (bits - 1)) ^ (result >> (bits - 2))) & 1) === 1);
        return result;
      case 4:
      case 6: {
        // A product, not <<, so that counts past 16 keep their carry exact.
        const wide = result * 2 ** count;
        const out = Math.floor(wide / 2 ** bits) % 2;
        result = this.logicFlags(wide % 2 ** bits, size);
        this.setFlag(CF, out === 1);
        this.setFlag(OF, ((result & sign ? 1 : 0) ^ out) === 1);
        return result;
      }
      case 5: {
        const out = (result >> (count - 1)) & 1;
        const original = result;
        result = this.logicFlags(result >> count, size);
        this.setFlag(CF, out === 1);
        this.setFlag(OF, count === 1 && (original & sign) !== 0);
        return result;
      }
      default: {
        const signed = result & sign ? result - (mask + 1) : result;
        const out = count >= bits ? (signed < 0 ? 1 : 0) : (signed >> (count - 1)) & 1;
        result = this.logicFlags(signed >> Math.min(count, bits), size);
        this.setFlag(CF, out === 1);
        this.setFlag(OF, false);
        return result;
      }
    }
  }

  // ---------- Control ----------

  /** Raise an interrupt: the bus may serve it; else through the vector table. */
  interrupt(number: number): void {
    if (this.bus.interrupt(this, number)) return;
    this.push(this.flags);
    this.push(this.segment(CS));
    this.push(this.ip);
    this.setFlag(IF | TF, false);
    this.ip = this.readWord(0, number * 4);
    this.setSegment(CS, this.readWord(0, number * 4 + 2));
  }
  /** A far call from outside: pushes `returnSegment:returnOffset`, then jumps. */
  farCall(segment: number, offset: number, returnSegment: number, returnOffset: number): void {
    this.push(returnSegment);
    this.push(returnOffset);
    this.setSegment(CS, segment);
    this.ip = offset;
  }
  private jumpShort(displacement: number, condition: boolean): void {
    if (condition) this.ip = (this.ip + displacement) & 0xffff;
  }
  private condition(code: number): boolean {
    const cf = this.flag(CF),
      zf = this.flag(ZF),
      sf = this.flag(SF),
      of = this.flag(OF),
      pf = this.flag(PF);
    switch (code >> 1) {
      case 0:
        return of !== ((code & 1) === 1);
      case 1:
        return cf !== ((code & 1) === 1);
      case 2:
        return zf !== ((code & 1) === 1);
      case 3:
        return (cf || zf) !== ((code & 1) === 1);
      case 4:
        return sf !== ((code & 1) === 1);
      case 5:
        return pf !== ((code & 1) === 1);
      case 6:
        return (sf !== of) !== ((code & 1) === 1);
      default:
        return (zf || sf !== of) !== ((code & 1) === 1);
    }
  }

  /** Run until `stop` is true before an instruction, the processor halts, or
   * `budget` instructions have run. Returns the instructions run. */
  run(budget: number, stop?: (cpu: Cpu86) => boolean): number {
    let count = 0;
    while (count < budget && !this.halted) {
      if (stop?.(this)) break;
      this.step();
      count++;
    }
    return count;
  }

  /** One instruction, with its prefixes. */
  step(): void {
    this.segmentOverride = -1;
    this.repeat = 0;
    const start = this.ip;
    let opcode = this.fetch8();
    for (;;) {
      if (opcode === 0x26 || opcode === 0x2e || opcode === 0x36 || opcode === 0x3e)
        this.segmentOverride = (opcode >> 3) & 3;
      else if (opcode === 0xf2 || opcode === 0xf3) this.repeat = opcode;
      else if (opcode !== 0xf0) break;
      opcode = this.fetch8();
    }
    this.executed++;
    this.execute(opcode, start);
  }

  private execute(opcode: number, start: number): void {
    // The eight ALU operations, each in six forms.
    if (opcode < 0x40 && (opcode & 7) < 6) {
      const operation = opcode >> 3;
      switch (opcode & 7) {
        case 0: {
          this.modrm();
          const result = this.alu(operation, this.readRm8(), this.get8(this.reg), 8);
          if (operation !== 7) this.writeRm8(result);
          return;
        }
        case 1: {
          this.modrm();
          const result = this.alu(operation, this.readRm16(), this.get16(this.reg), 16);
          if (operation !== 7) this.writeRm16(result);
          return;
        }
        case 2: {
          this.modrm();
          const result = this.alu(operation, this.get8(this.reg), this.readRm8(), 8);
          if (operation !== 7) this.set8(this.reg, result);
          return;
        }
        case 3: {
          this.modrm();
          const result = this.alu(operation, this.get16(this.reg), this.readRm16(), 16);
          if (operation !== 7) this.set16(this.reg, result);
          return;
        }
        case 4: {
          const result = this.alu(operation, this.get8(0), this.fetch8(), 8);
          if (operation !== 7) this.set8(0, result);
          return;
        }
        default: {
          const result = this.alu(operation, this.get16(AX), this.fetch16(), 16);
          if (operation !== 7) this.set16(AX, result);
          return;
        }
      }
    }
    if (opcode >= 0x40 && opcode <= 0x4f) {
      const register = opcode & 7;
      this.set16(register, this.incDec(this.get16(register), opcode < 0x48 ? 1 : -1, 16));
      return;
    }
    if (opcode >= 0x50 && opcode <= 0x57) {
      // PUSH SP pushes SP as it is after the push on the 8086 and 80186.
      if (opcode === 0x54) this.push((this.get16(SP) - 2) & 0xffff);
      else this.push(this.get16(opcode & 7));
      return;
    }
    if (opcode >= 0x58 && opcode <= 0x5f) {
      this.set16(opcode & 7, this.pop());
      return;
    }
    if (opcode >= 0x70 && opcode <= 0x7f) {
      const displacement = this.fetchSigned8();
      this.jumpShort(displacement, this.condition(opcode & 0x0f));
      return;
    }
    if (opcode >= 0x91 && opcode <= 0x97) {
      const register = opcode & 7;
      const value = this.get16(register);
      this.set16(register, this.get16(AX));
      this.set16(AX, value);
      return;
    }
    if (opcode >= 0xb0 && opcode <= 0xb7) {
      this.set8(opcode & 7, this.fetch8());
      return;
    }
    if (opcode >= 0xb8 && opcode <= 0xbf) {
      this.set16(opcode & 7, this.fetch16());
      return;
    }
    if (opcode >= 0xd8 && opcode <= 0xdf) {
      // An 8087 instruction: no coprocessor answers here, so it is skipped.
      this.modrm();
      return;
    }
    switch (opcode) {
      case 0x06:
      case 0x0e:
      case 0x16:
      case 0x1e:
        this.push(this.segment(opcode >> 3));
        return;
      case 0x07:
      case 0x17:
      case 0x1f:
        this.setSegment(opcode >> 3, this.pop());
        return;
      case 0x27:
      case 0x2f:
        this.decimalAdjust(opcode === 0x2f);
        return;
      case 0x37:
      case 0x3f:
        this.asciiAdjust(opcode === 0x3f);
        return;
      case 0x60: {
        const sp = this.get16(SP);
        for (const register of [AX, CX, DX, BX]) this.push(this.get16(register));
        this.push(sp);
        for (const register of [BP, SI, DI]) this.push(this.get16(register));
        return;
      }
      case 0x61:
        for (const register of [DI, SI, BP]) this.set16(register, this.pop());
        this.pop();
        for (const register of [BX, DX, CX, AX]) this.set16(register, this.pop());
        return;
      case 0x62: {
        this.modrm();
        const index = this.signed16(this.get16(this.reg));
        const segment = this.segment(this.eaSegment);
        const low = this.signed16(this.readWord(segment, this.ea));
        const high = this.signed16(this.readWord(segment, (this.ea + 2) & 0xffff));
        if (index < low || index > high) {
          this.ip = start;
          this.interrupt(5);
        }
        return;
      }
      case 0x68:
        this.push(this.fetch16());
        return;
      case 0x69:
      case 0x6b: {
        this.modrm();
        const a = this.signed16(this.readRm16());
        const b = opcode === 0x69 ? this.signed16(this.fetch16()) : this.fetchSigned8();
        this.set16(this.reg, this.multiplyFlags(a * b, 16) & 0xffff);
        return;
      }
      case 0x6a:
        this.push(this.fetchSigned8() & 0xffff);
        return;
      case 0x6c:
      case 0x6d:
      case 0x6e:
      case 0x6f:
        this.stringIo(opcode);
        return;
      case 0x80:
      case 0x81:
      case 0x82:
      case 0x83: {
        this.modrm();
        const size = opcode & 1 ? 16 : 8;
        const value = size === 8 ? this.readRm8() : this.readRm16();
        const immediate =
          opcode === 0x81
            ? this.fetch16()
            : opcode === 0x83
              ? this.fetchSigned8() & 0xffff
              : this.fetch8();
        const result = this.alu(this.reg, value, immediate, size);
        if (this.reg !== 7) {
          if (size === 8) this.writeRm8(result);
          else this.writeRm16(result);
        }
        return;
      }
      case 0x84:
        this.modrm();
        this.logicFlags(this.readRm8() & this.get8(this.reg), 8);
        return;
      case 0x85:
        this.modrm();
        this.logicFlags(this.readRm16() & this.get16(this.reg), 16);
        return;
      case 0x86: {
        this.modrm();
        const value = this.readRm8();
        this.writeRm8(this.get8(this.reg));
        this.set8(this.reg, value);
        return;
      }
      case 0x87: {
        this.modrm();
        const value = this.readRm16();
        this.writeRm16(this.get16(this.reg));
        this.set16(this.reg, value);
        return;
      }
      case 0x88:
        this.modrm();
        this.writeRm8(this.get8(this.reg));
        return;
      case 0x89:
        this.modrm();
        this.writeRm16(this.get16(this.reg));
        return;
      case 0x8a:
        this.modrm();
        this.set8(this.reg, this.readRm8());
        return;
      case 0x8b:
        this.modrm();
        this.set16(this.reg, this.readRm16());
        return;
      case 0x8c:
        this.modrm();
        this.writeRm16(this.segment(this.reg & 3));
        return;
      case 0x8d:
        this.modrm();
        this.set16(this.reg, this.ea);
        return;
      case 0x8e:
        this.modrm();
        this.setSegment(this.reg & 3, this.readRm16());
        return;
      case 0x8f:
        this.modrm();
        this.writeRm16(this.pop());
        return;
      case 0x90:
      case 0x9b:
        return;
      case 0x98:
        this.set16(AX, this.get8(0) & 0x80 ? this.get8(0) | 0xff00 : this.get8(0));
        return;
      case 0x99:
        this.set16(DX, this.get16(AX) & 0x8000 ? 0xffff : 0);
        return;
      case 0x9a: {
        const offset = this.fetch16();
        const segment = this.fetch16();
        this.farCall(segment, offset, this.segment(CS), this.ip);
        return;
      }
      case 0x9c:
        this.push(this.flags);
        return;
      case 0x9d:
        this.flags = (this.pop() & 0x0fd5) | 0xf002;
        return;
      case 0x9e:
        this.flags = (this.flags & 0xff00) | (this.get8(4) & 0xd5) | 0x02;
        return;
      case 0x9f:
        this.set8(4, this.flags & 0xff);
        return;
      case 0xa0:
        this.set8(0, this.readByte(this.dataSegment(), this.fetch16()));
        return;
      case 0xa1:
        this.set16(AX, this.readWord(this.dataSegment(), this.fetch16()));
        return;
      case 0xa2:
        this.writeByte(this.dataSegment(), this.fetch16(), this.get8(0));
        return;
      case 0xa3:
        this.writeWord(this.dataSegment(), this.fetch16(), this.get16(AX));
        return;
      case 0xa4:
      case 0xa5:
      case 0xa6:
      case 0xa7:
      case 0xaa:
      case 0xab:
      case 0xac:
      case 0xad:
      case 0xae:
      case 0xaf:
        this.stringInstruction(opcode);
        return;
      case 0xa8:
        this.logicFlags(this.get8(0) & this.fetch8(), 8);
        return;
      case 0xa9:
        this.logicFlags(this.get16(AX) & this.fetch16(), 16);
        return;
      case 0xc0:
      case 0xc1:
      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3: {
        this.modrm();
        const size = opcode & 1 ? 16 : 8;
        const value = size === 8 ? this.readRm8() : this.readRm16();
        const count = opcode <= 0xc1 ? this.fetch8() : opcode <= 0xd1 ? 1 : this.get8(1);
        const result = this.shift(this.reg, value, count, size);
        if (size === 8) this.writeRm8(result);
        else this.writeRm16(result);
        return;
      }
      case 0xc2: {
        const bytes = this.fetch16();
        this.ip = this.pop();
        this.set16(SP, (this.get16(SP) + bytes) & 0xffff);
        return;
      }
      case 0xc3:
        this.ip = this.pop();
        return;
      case 0xc4:
      case 0xc5: {
        this.modrm();
        const segment = this.segment(this.eaSegment);
        this.set16(this.reg, this.readWord(segment, this.ea));
        this.setSegment(opcode === 0xc4 ? ES : DS, this.readWord(segment, (this.ea + 2) & 0xffff));
        return;
      }
      case 0xc6:
        this.modrm();
        this.writeRm8(this.fetch8());
        return;
      case 0xc7:
        this.modrm();
        this.writeRm16(this.fetch16());
        return;
      case 0xc8: {
        const size = this.fetch16();
        const level = this.fetch8() & 0x1f;
        this.push(this.get16(BP));
        const frame = this.get16(SP);
        for (let i = 1; i < level; i++) {
          this.set16(BP, (this.get16(BP) - 2) & 0xffff);
          this.push(this.readWord(this.segment(SS), this.get16(BP)));
        }
        if (level > 0) this.push(frame);
        this.set16(BP, frame);
        this.set16(SP, (this.get16(SP) - size) & 0xffff);
        return;
      }
      case 0xc9:
        this.set16(SP, this.get16(BP));
        this.set16(BP, this.pop());
        return;
      case 0xca:
      case 0xcb: {
        const bytes = opcode === 0xca ? this.fetch16() : 0;
        this.ip = this.pop();
        this.setSegment(CS, this.pop());
        this.set16(SP, (this.get16(SP) + bytes) & 0xffff);
        return;
      }
      case 0xcc:
        this.interrupt(3);
        return;
      case 0xcd:
        this.interrupt(this.fetch8());
        return;
      case 0xce:
        if (this.flag(OF)) this.interrupt(4);
        return;
      case 0xcf:
        this.ip = this.pop();
        this.setSegment(CS, this.pop());
        this.flags = (this.pop() & 0x0fd5) | 0xf002;
        return;
      case 0xd4: {
        const base = this.fetch8();
        if (base === 0) {
          this.ip = start;
          this.interrupt(0);
          return;
        }
        const al = this.get8(0);
        this.set8(4, Math.floor(al / base));
        this.set8(0, this.logicFlags(al % base, 8));
        return;
      }
      case 0xd5: {
        const base = this.fetch8();
        const result = (this.get8(0) + this.get8(4) * base) & 0xff;
        this.set16(AX, this.logicFlags(result, 8));
        return;
      }
      case 0xd6:
        this.set8(0, this.flag(CF) ? 0xff : 0);
        return;
      case 0xd7:
        this.set8(0, this.readByte(this.dataSegment(), (this.get16(BX) + this.get8(0)) & 0xffff));
        return;
      case 0xe0:
      case 0xe1:
      case 0xe2:
      case 0xe3: {
        const displacement = this.fetchSigned8();
        if (opcode === 0xe3) {
          this.jumpShort(displacement, this.get16(CX) === 0);
          return;
        }
        const cx = (this.get16(CX) - 1) & 0xffff;
        this.set16(CX, cx);
        const zf = this.flag(ZF);
        const taken = cx !== 0 && (opcode === 0xe2 || (opcode === 0xe1 ? zf : !zf));
        this.jumpShort(displacement, taken);
        return;
      }
      case 0xe4:
        this.set8(0, this.bus.input(this.fetch8(), 1));
        return;
      case 0xe5:
        this.set16(AX, this.bus.input(this.fetch8(), 2));
        return;
      case 0xe6:
        this.bus.output(this.fetch8(), this.get8(0), 1);
        return;
      case 0xe7:
        this.bus.output(this.fetch8(), this.get16(AX), 2);
        return;
      case 0xe8: {
        const displacement = this.fetch16();
        this.push(this.ip);
        this.ip = (this.ip + displacement) & 0xffff;
        return;
      }
      case 0xe9:
        this.ip = (this.ip + this.fetch16()) & 0xffff;
        return;
      case 0xea: {
        const offset = this.fetch16();
        this.setSegment(CS, this.fetch16());
        this.ip = offset;
        return;
      }
      case 0xeb:
        this.jumpShort(this.fetchSigned8(), true);
        return;
      case 0xec:
        this.set8(0, this.bus.input(this.get16(DX), 1));
        return;
      case 0xed:
        this.set16(AX, this.bus.input(this.get16(DX), 2));
        return;
      case 0xee:
        this.bus.output(this.get16(DX), this.get8(0), 1);
        return;
      case 0xef:
        this.bus.output(this.get16(DX), this.get16(AX), 2);
        return;
      case 0xf4:
        this.halted = true;
        return;
      case 0xf5:
        this.flags ^= CF;
        return;
      case 0xf6:
      case 0xf7:
        this.group3(opcode === 0xf7 ? 16 : 8, start);
        return;
      case 0xf8:
      case 0xf9:
        this.setFlag(CF, opcode === 0xf9);
        return;
      case 0xfa:
      case 0xfb:
        this.setFlag(IF, opcode === 0xfb);
        return;
      case 0xfc:
      case 0xfd:
        this.setFlag(DF, opcode === 0xfd);
        return;
      case 0xfe: {
        this.modrm();
        if (this.reg > 1) throw new CpuFault(`Invalid instruction FE /${String(this.reg)}`);
        this.writeRm8(this.incDec(this.readRm8(), this.reg === 0 ? 1 : -1, 8));
        return;
      }
      case 0xff:
        this.group5();
        return;
    }
    throw new CpuFault(
      `Invalid instruction ${opcode.toString(16).padStart(2, '0')}h at ${this.segment(CS).toString(16)}:${start.toString(16)}`
    );
  }

  private signed16(value: number): number {
    return value & 0x8000 ? value - 0x10000 : value;
  }
  /** CF and OF for a product that does not fit its half. */
  private multiplyFlags(product: number, size: 8 | 16): number {
    const limit = size === 8 ? 0x80 : 0x8000;
    const overflow = product < -limit || product >= limit;
    this.setFlag(CF | OF, overflow);
    return product;
  }

  private group3(size: 8 | 16, start: number): void {
    this.modrm();
    const value = size === 8 ? this.readRm8() : this.readRm16();
    const mask = size === 8 ? 0xff : 0xffff;
    switch (this.reg) {
      case 0:
      case 1:
        this.logicFlags(value & (size === 8 ? this.fetch8() : this.fetch16()), size);
        return;
      case 2:
        if (size === 8) this.writeRm8(~value);
        else this.writeRm16(~value);
        return;
      case 3: {
        const result = this.sub(0, value, 0, size);
        this.setFlag(CF, value !== 0);
        if (size === 8) this.writeRm8(result);
        else this.writeRm16(result);
        return;
      }
      case 4:
        if (size === 8) {
          const product = this.get8(0) * value;
          this.set16(AX, product);
          this.setFlag(CF | OF, product > 0xff);
        } else {
          const product = this.get16(AX) * value;
          this.set16(AX, product & 0xffff);
          this.set16(DX, Math.floor(product / 0x10000));
          this.setFlag(CF | OF, product > 0xffff);
        }
        this.setFlag(ZF, false);
        return;
      case 5:
        if (size === 8) {
          const a = this.get8(0) & 0x80 ? this.get8(0) - 0x100 : this.get8(0);
          const b = value & 0x80 ? value - 0x100 : value;
          this.set16(AX, this.multiplyFlags(a * b, 8) & 0xffff);
        } else {
          const product = this.signed16(this.get16(AX)) * this.signed16(value);
          this.multiplyFlags(product, 16);
          this.set16(AX, product & 0xffff);
          this.set16(DX, Math.floor(product / 0x10000) & 0xffff);
        }
        return;
      default: {
        const signed = this.reg === 7;
        if (value === 0) {
          this.ip = start;
          this.interrupt(0);
          return;
        }
        let dividend: number, divisor: number;
        if (size === 8) {
          dividend = signed ? this.signed16(this.get16(AX)) : this.get16(AX);
          divisor = signed && value & 0x80 ? value - 0x100 : value;
        } else {
          const wide = this.get16(DX) * 0x10000 + this.get16(AX);
          dividend = signed && this.get16(DX) & 0x8000 ? wide - 0x100000000 : wide;
          divisor = signed ? this.signed16(value) : value;
        }
        const quotient = Math.trunc(dividend / divisor);
        const remainder = dividend - quotient * divisor;
        const limit = size === 8 ? 0x80 : 0x8000;
        if (signed ? quotient >= limit || quotient < -limit : quotient > mask) {
          this.ip = start;
          this.interrupt(0);
          return;
        }
        if (size === 8) {
          this.set8(0, quotient);
          this.set8(4, remainder);
        } else {
          this.set16(AX, quotient & 0xffff);
          this.set16(DX, remainder & 0xffff);
        }
        return;
      }
    }
  }

  private group5(): void {
    this.modrm();
    switch (this.reg) {
      case 0:
      case 1:
        this.writeRm16(this.incDec(this.readRm16(), this.reg === 0 ? 1 : -1, 16));
        return;
      case 2: {
        const target = this.readRm16();
        this.push(this.ip);
        this.ip = target;
        return;
      }
      case 3: {
        const segment = this.segment(this.eaSegment);
        const offset = this.readWord(segment, this.ea);
        const code = this.readWord(segment, (this.ea + 2) & 0xffff);
        this.farCall(code, offset, this.segment(CS), this.ip);
        return;
      }
      case 4:
        this.ip = this.readRm16();
        return;
      case 5: {
        const segment = this.segment(this.eaSegment);
        this.ip = this.readWord(segment, this.ea);
        this.setSegment(CS, this.readWord(segment, (this.ea + 2) & 0xffff));
        return;
      }
      case 6:
        this.push(this.readRm16());
        return;
      default:
        throw new CpuFault('Invalid instruction FF /7');
    }
  }

  /** MOVS, CMPS, STOS, LODS and SCAS, with their repeat prefixes. */
  private stringInstruction(opcode: number): void {
    const size = opcode & 1 ? 2 : 1;
    const step = this.flag(DF) ? -size : size;
    const source = this.dataSegment();
    const compares = opcode === 0xa6 || opcode === 0xa7 || opcode === 0xae || opcode === 0xaf;
    for (;;) {
      if (this.repeat && this.get16(CX) === 0) return;
      const si = this.get16(SI),
        di = this.get16(DI),
        es = this.segment(ES);
      switch (opcode) {
        case 0xa4:
        case 0xa5:
          if (size === 1) this.writeByte(es, di, this.readByte(source, si));
          else this.writeWord(es, di, this.readWord(source, si));
          this.set16(SI, (si + step) & 0xffff);
          this.set16(DI, (di + step) & 0xffff);
          break;
        case 0xa6:
        case 0xa7:
          if (size === 1) this.sub(this.readByte(source, si), this.readByte(es, di), 0, 8);
          else this.sub(this.readWord(source, si), this.readWord(es, di), 0, 16);
          this.set16(SI, (si + step) & 0xffff);
          this.set16(DI, (di + step) & 0xffff);
          break;
        case 0xaa:
        case 0xab:
          if (size === 1) this.writeByte(es, di, this.get8(0));
          else this.writeWord(es, di, this.get16(AX));
          this.set16(DI, (di + step) & 0xffff);
          break;
        case 0xac:
        case 0xad:
          if (size === 1) this.set8(0, this.readByte(source, si));
          else this.set16(AX, this.readWord(source, si));
          this.set16(SI, (si + step) & 0xffff);
          break;
        default:
          if (size === 1) this.sub(this.get8(0), this.readByte(es, di), 0, 8);
          else this.sub(this.get16(AX), this.readWord(es, di), 0, 16);
          this.set16(DI, (di + step) & 0xffff);
          break;
      }
      if (!this.repeat) return;
      this.set16(CX, (this.get16(CX) - 1) & 0xffff);
      if (compares && this.flag(ZF) !== (this.repeat === 0xf3)) return;
    }
  }
  /** INS and OUTS, with REP. */
  private stringIo(opcode: number): void {
    const size = opcode & 1 ? 2 : 1;
    const step = this.flag(DF) ? -size : size;
    for (;;) {
      if (this.repeat && this.get16(CX) === 0) return;
      const port = this.get16(DX);
      if (opcode <= 0x6d) {
        const di = this.get16(DI);
        const value = this.bus.input(port, size);
        if (size === 1) this.writeByte(this.segment(ES), di, value);
        else this.writeWord(this.segment(ES), di, value);
        this.set16(DI, (di + step) & 0xffff);
      } else {
        const si = this.get16(SI);
        const source = this.dataSegment();
        this.bus.output(
          port,
          size === 1 ? this.readByte(source, si) : this.readWord(source, si),
          size
        );
        this.set16(SI, (si + step) & 0xffff);
      }
      if (!this.repeat) return;
      this.set16(CX, (this.get16(CX) - 1) & 0xffff);
    }
  }

  private decimalAdjust(subtract: boolean): void {
    let al = this.get8(0);
    const oldAl = al,
      oldCarry = this.flag(CF);
    let carry = false;
    if ((al & 0x0f) > 9 || this.flag(AF)) {
      al = subtract ? al - 6 : al + 6;
      carry = oldCarry || (subtract ? oldAl < 6 : al > 0xff);
      this.setFlag(AF, true);
    } else this.setFlag(AF, false);
    if (oldAl > 0x99 || oldCarry) {
      al = subtract ? al - 0x60 : al + 0x60;
      carry = true;
    }
    const af = this.flag(AF);
    this.set8(0, this.logicFlags(al, 8));
    this.setFlag(AF, af);
    this.setFlag(CF, carry);
  }
  private asciiAdjust(subtract: boolean): void {
    const adjust = (this.get8(0) & 0x0f) > 9 || this.flag(AF);
    if (adjust) {
      this.set16(AX, subtract ? (this.get16(AX) - 6) & 0xffff : (this.get16(AX) + 0x106) & 0xffff);
      if (subtract) this.set8(4, this.get8(4) - 1);
    }
    this.set8(0, this.get8(0) & 0x0f);
    this.setFlag(AF | CF, adjust);
  }
}
