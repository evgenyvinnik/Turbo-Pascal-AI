/**
 * The header of a .BGI graphics driver, as Borland's Graph unit reads it
 * before it loads one: a signature, "pk" and two backspaces (or "FBGD" and
 * four, for a protected-mode BGI 3.0 driver), text naming the driver ended by
 * 0x1A, and at 0x80 the header proper: its size, the driver's number, the
 * size of its code, its version and the least Graph version it needs, and
 * its name. The code follows the header.
 */
export interface BgiDriverHeader {
  name: string;
  version: number;
  revision: number;
  minVersion: number;
  minRevision: number;
  /** Where the code starts, and how many bytes it is. */
  headerSize: number;
  codeSize: number;
}

/** How many bytes RegisterBGIdriver reads before it knows the code's size. */
export const BGI_HEADER_BYTES = 0xa0;

/** A driver's header, or undefined when the bytes are not one. */
export function parseBgiDriver(bytes: Uint8Array): BgiDriverHeader | undefined {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  const protectedMode = text(0, 8) === 'FBGD\x08\x08\x08\x08';
  if (!protectedMode && text(0, 4) !== 'pk\x08\x08') return undefined;
  const marker = bytes.subarray(0, 0x80).indexOf(0x1a);
  if (marker < 0) return undefined;
  const word = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  const headerSize = word(0x80);
  const codeSize = word(0x84);
  // The name follows the header's fields, which BGI 3.0 extends by its data
  // segment's offset and size.
  const nameAt = protectedMode ? 0x8e : 0x8a;
  const length = bytes[nameAt] ?? 0;
  const name = text(nameAt + 1, nameAt + 1 + length);
  if (
    headerSize < nameAt + 1 + length ||
    word(marker + 1) !== headerSize ||
    length < 1 ||
    length > 8 ||
    !/^[\x21-\x7e]+$/.test(name)
  )
    return undefined;
  return {
    name: name.toUpperCase(),
    version: bytes[0x86] ?? 0,
    revision: bytes[0x87] ?? 0,
    minVersion: bytes[0x88] ?? 0,
    minRevision: bytes[0x89] ?? 0,
    headerSize,
    codeSize,
  };
}
