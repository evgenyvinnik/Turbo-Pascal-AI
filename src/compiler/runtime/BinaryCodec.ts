import { PascalError } from '../errors/PascalError';
import {
  Float80,
  decodeComp,
  decodeExtended,
  encodeComp,
  encodeExtended,
} from '../codegen/float80';
import type { StackValue } from './Machine';
import type { MemoryAccess } from './FileRuntime';

export interface BinaryCell {
  /** A value's kind; a `gap` is bytes between variables, which hold
   * nothing and read as zero. */
  kind: string;
  bytes: number;
  signed?: boolean;
  /** Ordinal byte containing the set's lower bound; omitted layouts start at zero. */
  setByteOffset?: number;
  /** The cell's place from the variable's start, where cells are not all
   * consecutive, as a variant record's shadow is not. */
  offset?: number;
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
    if (cell.kind === 'gap') {
      offset += cell.bytes;
      return;
    }
    const at = address + (cell.offset ?? index);
    const value = memory.read(at);
    if (cell.kind === 'string') {
      const text = String(value).slice(0, cell.bytes - 1);
      bytes[offset] = text.length;
      const characters = (memory.characters?.(at) ?? text).slice(0, cell.bytes - 1);
      for (let i = 0; i < characters.length; i++)
        bytes[offset + i + 1] = characters.charCodeAt(i) & 255;
    } else if (cell.kind === 'set') {
      const baseByte = cell.setByteOffset ?? 0;
      for (const member of JSON.parse(String(value)) as number[]) {
        const byte = (member >>> 3) - baseByte;
        if (member >= 0 && byte >= 0 && byte < cell.bytes)
          bytes[offset + byte]! |= 1 << (member & 7);
      }
    } else if (cell.kind === 'comp') {
      bytes.set(encodeComp(value instanceof Float80 ? value : Number(value)), offset);
    } else if (cell.kind === 'real' && cell.bytes === 10) {
      bytes.set(encodeExtended(value instanceof Float80 ? value : Number(value)), offset);
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
      const number = Math.trunc(
        cell.kind === 'char'
          ? String(value).charCodeAt(0) || 0
          : cell.kind === 'pointer' && memory.pointerBits
            ? memory.pointerBits(value)
            : Number(value)
      );
      if (cell.bytes <= 4) {
        // Two's complement in the cell's bytes, low byte first.
        let bits = ((number % 2 ** 32) + 2 ** 32) % 2 ** 32;
        for (let i = 0; i < cell.bytes; i++) {
          bytes[offset + i] = bits & 255;
          bits = Math.floor(bits / 256);
        }
      } else {
        let bits = BigInt.asUintN(cell.bytes * 8, BigInt(Number.isFinite(number) ? number : 0));
        for (let i = 0; i < cell.bytes; i++) {
          bytes[offset + i] = Number(bits & 255n);
          bits >>= 8n;
        }
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
  let characters: string | undefined;
  layout.forEach((cell, index) => {
    if (offset >= input.length) return;
    if (cell.kind === 'gap') {
      offset += cell.bytes;
      return;
    }
    let value: StackValue = 0;
    characters = undefined;
    if (cell.kind === 'string') {
      const length = Math.min(bytes[offset] ?? 0, cell.bytes - 1);
      value = String.fromCharCode(...bytes.subarray(offset + 1, offset + 1 + length));
      if (memory.setCharacters)
        characters = String.fromCharCode(...bytes.subarray(offset + 1, offset + cell.bytes));
    } else if (cell.kind === 'set') {
      const members: number[] = [];
      const baseOrdinal = (cell.setByteOffset ?? 0) * 8;
      for (let i = 0; i < cell.bytes * 8; i++)
        if ((bytes[offset + (i >>> 3)] ?? 0) & (1 << (i & 7))) members.push(baseOrdinal + i);
      value = JSON.stringify(members);
    } else if (cell.kind === 'comp') value = decodeComp(bytes.subarray(offset, offset + 8));
    else if (cell.kind === 'real' && cell.bytes === 10)
      value = decodeExtended(bytes.subarray(offset, offset + 10));
    else if (cell.kind === 'real') {
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
      const signed = cell.kind === 'integer' && (cell.signed ?? cell.bytes > 1);
      let number: number;
      if (cell.bytes <= 4) {
        number = 0;
        for (let i = cell.bytes - 1; i >= 0; i--) number = number * 256 + (bytes[offset + i] ?? 0);
        if (signed && number >= 2 ** (cell.bytes * 8 - 1)) number -= 2 ** (cell.bytes * 8);
      } else {
        let bits = 0n;
        for (let i = cell.bytes - 1; i >= 0; i--)
          bits = bits * 256n + BigInt(bytes[offset + i] ?? 0);
        number = Number(signed ? BigInt.asIntN(cell.bytes * 8, bits) : bits);
      }
      value = cell.kind === 'pointer' && memory.pointerValue ? memory.pointerValue(number) : number;
    }
    memory.write(address + (cell.offset ?? index), value);
    if (characters !== undefined)
      memory.setCharacters?.(address + (cell.offset ?? index), characters);
    offset += cell.bytes;
  });
}

const starts = new WeakMap<BinaryCell[], Float64Array>();
/** The byte each cell of a layout starts at, and after them its size. */
function cellStarts(layout: BinaryCell[]): Float64Array {
  let sums = starts.get(layout);
  if (!sums) {
    sums = new Float64Array(layout.length + 1);
    layout.forEach((cell, index) => {
      sums![index + 1] = sums![index]! + cell.bytes;
    });
    starts.set(layout, sums);
  }
  return sums;
}
/** How many bytes a layout holds. */
export function layoutSize(layout: BinaryCell[]): number {
  return cellStarts(layout)[layout.length]!;
}
/** The cell of a layout that holds a byte, and the byte it starts at. */
export function cellAtByte(
  layout: BinaryCell[],
  byte: number
): { index: number; at: number } | undefined {
  const sums = cellStarts(layout);
  if (byte < 0 || byte >= sums[layout.length]!) return undefined;
  let low = 0,
    high = layout.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (sums[middle]! <= byte) low = middle;
    else high = middle - 1;
  }
  return { index: low, at: sums[low]! };
}
const placed = new WeakMap<BinaryCell[], BinaryCell[]>();
/** A layout whose every cell says where it lies, so a slice of it does. */
function withOffsets(layout: BinaryCell[]): BinaryCell[] {
  let cells = placed.get(layout);
  if (!cells) {
    cells = layout.every((cell) => cell.offset !== undefined)
      ? layout
      : layout.map((cell, index) => ({ ...cell, offset: cell.offset ?? index }));
    placed.set(layout, cells);
  }
  return cells;
}
/** The cells holding bytes [start, start + length), and the byte the
 * first starts at. */
function span(
  layout: BinaryCell[],
  start: number,
  length: number
): { cells: BinaryCell[]; from: number } {
  const sums = cellStarts(layout);
  if (start < 0 || start + length > sums[layout.length]!)
    throw new PascalError('Access beyond the variable');
  if (length <= 0) return { cells: [], from: start };
  const first = cellAtByte(layout, start)!.index,
    last = cellAtByte(layout, start + length - 1)!.index;
  return { cells: withOffsets(layout).slice(first, last + 1), from: sums[first]! };
}

/** Some of a variable's bytes, encoding only the cells that hold them. */
export function readBytes(
  memory: MemoryAccess,
  address: number,
  layout: BinaryCell[],
  start: number,
  length: number
): Uint8Array {
  const { cells, from } = span(layout, start, length);
  return encodeBinary(memory, address, cells).slice(start - from, start - from + length);
}

/** Store bytes into a variable, decoding only the cells that hold them. */
export function writeBytes(
  memory: MemoryAccess,
  address: number,
  layout: BinaryCell[],
  start: number,
  bytes: Uint8Array
): void {
  const { cells, from } = span(layout, start, bytes.length);
  if (!cells.length) return;
  const encoded = encodeBinary(memory, address, cells);
  encoded.set(bytes, start - from);
  decodeBinary(memory, address, cells, encoded);
}
