import { PascalError } from '../errors/PascalError';
import type { StackValue } from './Machine';
import type { MemoryAccess } from './FileRuntime';

export interface BinaryCell {
  kind: string;
  bytes: number;
  signed?: boolean;
  /** Ordinal byte containing the set's lower bound; omitted layouts start at zero. */
  setByteOffset?: number;
}

/** Serialize Pascal data independently of the VM's one-JavaScript-value-per-word layout. */
export function encodeBinary(
  memory: MemoryAccess,
  address: number,
  layout: BinaryCell[]
): Uint8Array {
  const bytes = new Uint8Array(layout.reduce((size, cell) => size + cell.bytes, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  layout.forEach((cell, index) => {
    const value = memory.read(address + index);
    if (cell.kind === 'string') {
      const text = String(value).slice(0, cell.bytes - 1);
      bytes[offset] = text.length;
      for (let i = 0; i < text.length; i++) bytes[offset + i + 1] = text.charCodeAt(i) & 255;
    } else if (cell.kind === 'set') {
      const baseByte = cell.setByteOffset ?? 0;
      for (const member of JSON.parse(String(value)) as number[]) {
        const byte = (member >>> 3) - baseByte;
        if (member >= 0 && byte >= 0 && byte < cell.bytes)
          bytes[offset + byte]! |= 1 << (member & 7);
      }
    } else if (cell.kind === 'real') {
      const number = Number(value);
      if (cell.bytes === 8) view.setFloat64(offset, number, true);
      else if (cell.bytes === 4) view.setFloat32(offset, number, true);
      else if (cell.bytes === 6 && number !== 0) {
        const exponent = Math.floor(Math.log2(Math.abs(number)));
        if (exponent < -128 || exponent > 126 || !Number.isFinite(number))
          throw new PascalError('Real value out of binary range');
        let fraction = Math.round((Math.abs(number) / 2 ** exponent - 1) * 2 ** 39);
        let storedExponent = exponent + 129;
        if (fraction >= 2 ** 39) {
          fraction = 0;
          storedExponent++;
        }
        if (storedExponent > 255) throw new PascalError('Real value out of binary range');
        bytes[offset] = storedExponent;
        for (let i = 0; i < 5; i++) {
          bytes[offset + 1 + i] = fraction % 256;
          fraction = Math.floor(fraction / 256);
        }
        if (number < 0) bytes[offset + 5]! |= 128;
      }
    } else {
      let bits = BigInt(
        Math.trunc(cell.kind === 'char' ? String(value).charCodeAt(0) || 0 : Number(value))
      );
      bits = BigInt.asUintN(cell.bytes * 8, bits);
      for (let i = 0; i < cell.bytes; i++) {
        bytes[offset + i] = Number(bits & 255n);
        bits >>= 8n;
      }
    }
    offset += cell.bytes;
  });
  return bytes;
}

export function decodeBinary(
  memory: MemoryAccess,
  address: number,
  layout: BinaryCell[],
  input: Uint8Array
): void {
  const bytes = new Uint8Array(layout.reduce((size, cell) => size + cell.bytes, 0));
  bytes.set(input.subarray(0, bytes.length));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  layout.forEach((cell, index) => {
    if (offset >= input.length) return;
    let value: StackValue = 0;
    if (cell.kind === 'string') {
      const length = Math.min(bytes[offset] ?? 0, cell.bytes - 1);
      value = String.fromCharCode(...bytes.subarray(offset + 1, offset + 1 + length));
    } else if (cell.kind === 'set') {
      const members: number[] = [];
      const baseOrdinal = (cell.setByteOffset ?? 0) * 8;
      for (let i = 0; i < cell.bytes * 8; i++)
        if ((bytes[offset + (i >>> 3)] ?? 0) & (1 << (i & 7))) members.push(baseOrdinal + i);
      value = JSON.stringify(members);
    } else if (cell.kind === 'real') {
      if (cell.bytes === 8) value = view.getFloat64(offset, true);
      else if (cell.bytes === 4) value = view.getFloat32(offset, true);
      else if (cell.bytes === 6 && bytes[offset]) {
        let fraction = 0;
        for (let i = 4; i >= 0; i--)
          fraction = fraction * 256 + ((bytes[offset + 1 + i] ?? 0) & (i === 4 ? 127 : 255));
        value =
          (1 + fraction / 2 ** 39) *
          2 ** ((bytes[offset] ?? 0) - 129) *
          ((bytes[offset + 5] ?? 0) & 128 ? -1 : 1);
      }
    } else if (cell.kind === 'char') value = String.fromCharCode(bytes[offset] ?? 0);
    else {
      let bits = 0n;
      for (let i = cell.bytes - 1; i >= 0; i--) bits = bits * 256n + BigInt(bytes[offset + i] ?? 0);
      if (cell.kind === 'integer' && (cell.signed ?? cell.bytes > 1))
        bits = BigInt.asIntN(cell.bytes * 8, bits);
      value = Number(bits);
    }
    memory.write(address + index, value);
    offset += cell.bytes;
  });
}
