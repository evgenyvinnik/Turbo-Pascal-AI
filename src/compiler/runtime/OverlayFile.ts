/**
 * The .OVR file a program with overlays is compiled to disk with, which the
 * Overlay unit's OvrInit opens and the overlay manager loads units from. It
 * holds each overlaid unit's code: its P-code here, as Turbo Pascal's holds
 * its 8086 code. "FBOV", the number of units, then each unit's name, as a
 * length and its characters, the number of its instructions, and those
 * instructions, eight bytes each, least significant first.
 */
export interface OverlayUnit {
  name: string;
  code: number[];
}

const SIGNATURE = 'FBOV';

export function encodeOverlayFile(units: readonly OverlayUnit[]): Uint8Array {
  const bytes: number[] = [...Array.from(SIGNATURE, (char) => char.charCodeAt(0))];
  const word = (value: number) => bytes.push(value & 0xff, (value >>> 8) & 0xff);
  const long = (value: number) => {
    word(value & 0xffff);
    word((value >>> 16) & 0xffff);
  };
  word(units.length);
  for (const unit of units) {
    bytes.push(unit.name.length, ...Array.from(unit.name, (char) => char.charCodeAt(0) & 0xff));
    long(unit.code.length);
    for (const instruction of unit.code) {
      long(instruction % 2 ** 32);
      long(Math.floor(instruction / 2 ** 32));
    }
  }
  return Uint8Array.from(bytes);
}

/** The units a .OVR file holds, or undefined when it is not one. */
export function decodeOverlayFile(bytes: Uint8Array): OverlayUnit[] | undefined {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== SIGNATURE) return undefined;
  let at = 4;
  const need = (count: number) => at + count <= bytes.length;
  const word = () => {
    const value = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
    at += 2;
    return value;
  };
  const long = () => (word() | (word() << 16)) >>> 0;
  if (!need(2)) return undefined;
  const count = word();
  const units: OverlayUnit[] = [];
  for (let unit = 0; unit < count; unit++) {
    if (!need(1)) return undefined;
    const length = bytes[at++] ?? 0;
    if (!need(length + 4)) return undefined;
    const name = String.fromCharCode(...bytes.subarray(at, at + length));
    at += length;
    const size = long();
    if (!need(size * 8)) return undefined;
    const code: number[] = [];
    for (let i = 0; i < size; i++) code.push(long() + long() * 2 ** 32);
    units.push({ name, code });
  }
  return at === bytes.length ? units : undefined;
}

/** The bytes an overlay takes in the overlay buffer: its code's. */
export function overlaySize(unit: OverlayUnit): number {
  return unit.code.length * 8;
}
