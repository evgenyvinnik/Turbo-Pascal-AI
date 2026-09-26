import { PascalError } from '../errors/PascalError';
import { EMPTY_SEGMENT, sameShape, shapeBytes, shapeCell, shapeSize, type Bytecode, type SegmentLayout, type ViewShape } from '../codegen/Bytecode';
import { cellAtByte, decodeBinary, encodeBinary, layoutSize, readBytes, writeBytes, type BinaryCell } from './BinaryCodec';
import type { MemoryAccess } from './FileRuntime';
import type { Heap, HeapBlock } from './Heap';
import { BIOS_DATA, VIDEO_TEXT, type LowMemory } from './LowMemory';
import type { StackValue } from './Machine';
import type { VariantRuntime } from './Variants';

/** The segments Turbo Pascal's program lives in: CSeg, DSeg and SSeg, and
 * the heap from HeapOrg to HeapEnd. */
export const CODE_SEGMENT = 0x1000;
export const DATA_SEGMENT = 0x2000;
export const STACK_SEGMENT = 0x3000;
export const HEAP_SEGMENT = 0x4000;
export const HEAP_END_SEGMENT = 0xa000;
const HEAP_START = HEAP_SEGMENT * 16;
/** How many bytes the heap holds. */
export const HEAP_BYTES = (HEAP_END_SEGMENT - HEAP_SEGMENT) * 16;
/** Where SP starts, at the top of the stack segment. */
export const STACK_TOP = 0xfff0;
/* Addresses are numbers in ranges that stay below 2^31, so the store and the
 * stack hold only small integers, which JavaScript engines keep fast:
 *   cells             from 0
 *   string characters from the store's size (its cells times 257 at most)
 *   linear addresses  LINEAR_BASE .. +1M
 *   I/O ports         PORT_BASE .. +128K
 *   far pointers      FAR_BASE, 64K for each segment they name
 *   views             VIEW_BASE, VIEW_SPAN cells each */
/** An address made from a segment and offset, as Ptr makes one, is this
 * plus its linear address, so adding to it moves byte by byte. */
export const LINEAR_BASE = 2 ** 28;
/** Port[P] is this plus P, and PortW[P] that plus 65536. */
export const PORT_BASE = LINEAR_BASE + 2 ** 24;
/** Ptr(S, O) whose segment is not the one Seg gives for its byte, as
 * Ptr($1234, $5678) is: this plus the segment's number in a list of such
 * segments times 64K, plus O. Seg and Ofs give S and O back. */
export const FAR_BASE = LINEAR_BASE + 2 ** 25;
/** Where views' addresses start. */
export const VIEW_BASE = 2 ** 29;
/** How many segments far pointers can name; past that Ptr is linear. */
const FAR_SEGMENTS = (VIEW_BASE - FAR_BASE) / 0x10000;
/** How many cells one view can show. */
const VIEW_SPAN = 1 << 17;
/** The largest store whose string characters' addresses stay below
 * LINEAR_BASE. */
export const MAX_CELLS = Math.floor(LINEAR_BASE / 257);
const MEGABYTE = 0x100000;
const RAW_SEGMENT = 0xf000;

/** The segment and offset Seg and Ofs give for a byte of memory: the data
 * and stack segments, the BIOS data area and text screen at their own
 * segments, and elsewhere a normalized pointer, as Turbo Pascal's heap
 * gives one. */
export function splitLinear(linear: number): { segment: number; offset: number } {
  const within = (segment: number, size: number) => linear >= segment * 16 && linear < segment * 16 + size;
  for (const segment of [DATA_SEGMENT, STACK_SEGMENT])
    if (within(segment, 0x10000)) return { segment, offset: linear - segment * 16 };
  if (within(BIOS_DATA >> 4, 0x100)) return { segment: BIOS_DATA >> 4, offset: linear - BIOS_DATA };
  if (within(VIDEO_TEXT >> 4, 0x8000)) return { segment: VIDEO_TEXT >> 4, offset: linear - VIDEO_TEXT };
  return { segment: linear >> 4, offset: linear & 15 };
}
/** Ptr(S, O) as an address: linear where S:O is how Seg and Ofs name its
 * byte, otherwise far, with S numbered in `segments`, which grows. */
export function farAddress(segment: number, offset: number, segments: number[]): number {
  segment &= 0xffff;
  offset &= 0xffff;
  if (!segment && !offset) return 0;
  const linear = (segment * 16 + offset) % MEGABYTE;
  const usual = splitLinear(linear);
  if (usual.segment === segment && usual.offset === offset) return LINEAR_BASE + linear;
  let index = segments.indexOf(segment);
  if (index < 0) {
    if (segments.length >= FAR_SEGMENTS) return LINEAR_BASE + linear;
    index = segments.push(segment) - 1;
  }
  return FAR_BASE + index * 0x10000 + offset;
}
/** Types whose RETYPE of a plain cell is remembered: keys stay small integers. */
const PLAIN_MAPS = 4096;

/** Variables whose bytes lie one after another in memory: the data
 * segment, a routine's frame, a heap block, or a single variable. */
export interface Region {
  key: string;
  /** The cell the layout's offsets count from. */
  target: number;
  layout: BinaryCell[];
  /** The variables' own shapes, from `target`. */
  shape: ViewShape;
  /** Where the first byte lies in memory, if it has an address there. */
  linear?: number;
  /** The variant parts in its variables, and the cell each record starts at. */
  refresh: { part: number; offset: number }[];
  /** The cells of variables with variant parts. */
  variantCells: [number, number][];
  /** The view of it as its own variables, once made, and that view as @
   * gives it, bounded by each variable. */
  identity?: number;
  boundedIdentity?: number;
  /** Whether it holds variables one after another, as the data segment and
   * a frame do, rather than one variable. */
  variables?: boolean;
  /** A frame's routine, which a later call at the same place may differ in. */
  routine?: number;
}

/** A variable's bytes shown as another type. Its cells are addresses past
 * every real one; loading one decodes it from the variable's bytes, and
 * storing one encodes it into them. */
interface View {
  region: Region;
  shape: ViewShape;
  start: number;
  /** Variant cases to bring up to date after a store, besides the region's
   * variant parts. */
  syncs: { base: number; part: number; case: number }[];
  /** A view of a region as its own variables, as @ gives: its cells are
   * theirs. */
  identity: boolean;
  /** Memory outside the program's variables, by address alone. */
  raw?: boolean;
  /** For a raw view made from a far pointer: the segment Ptr gave, which Seg
   * and Ofs of its cells keep. */
  segment?: number;
  /** The bytes of the variable @ took the address of, in the region: the
   * view reaches only these. */
  bound?: [number, number];
  /** A view of a region as its own variables, from @: what is retyped from
   * it reaches only the variable the address lies in. */
  bounded?: boolean;
}

/** Where an address points: a byte of a region, or of memory with no
 * variables of the program's in it. */
type Place = { region: Region; byte: number } | { linear: number };

export interface SpaceHost {
  memory: MemoryAccess;
  bytecode: Bytecode;
  heap: Heap;
  low: LowMemory;
  variants: VariantRuntime;
  /** How many cells the store has; addresses past it are not cells. */
  cells: number;
  /** The main frame, which holds the data segment. */
  globalBase: number;
  /** The innermost frame's first cell, and the last cell in use. */
  frame(): { base: number; top: number };
  /** The frame that called a frame. */
  caller(base: number): number;
  /** The routine a frame belongs to, by the address it starts at. */
  routine(base: number): number;
  /** Where a frame's bytes start on the stack, which the call recorded. */
  frameLinear(base: number): number;
  stringCharacter(reference: number): { address: number; index: number; capacity: number } | undefined;
}

/** Turbo Pascal's memory as the P-machine keeps it. Each variable holds a
 * value per cell, but lies in bytes at a segment and offset: the globals in
 * the data segment, the locals in their routine's frame on the stack, and
 * heap blocks between HeapOrg and HeapEnd. Views read and write the bytes;
 * addresses from Ptr are linear, and find their variable when used. */
export class AddressSpace {
  private views: View[] = [];
  private viewKeys = new Map<string, number>();
  /** Whether a view's cells from an offset already have a type's shape. */
  private shapeMatches = new Map<number, Map<number, boolean>>();
  /** Values a pointer's bytes cannot hold as a segment and offset, such as
   * a routine's address: their bytes name them by number instead. */
  private rawPointers: StackValue[] = [];
  private rawIds = new Map<StackValue, number>();
  private refreshRanges = new WeakMap<Region['refresh'], { part: number; offset: number; from: number; to: number }[]>();
  private dataRegion: Region | undefined;
  private regions = new Map<string, Region>();
  private frameRegions = new Map<number, Region>();
  /** What RETYPE made of a global's or heap block's cell, by the cell and
   * the type. */
  private plainRetypes = new Map<number, number>();
  private plainGeneration = -1;
  private blockRegions = new WeakMap<HeapBlock, Region>();
  private blockCount = 0;
  /** The segments far pointers name: the compiler's, then the program's. */
  private segments: number[] = [];

  constructor(private host: SpaceHost) {
    this.segments = [...host.bytecode.farSegments];
  }

  reset(): void {
    this.segments = [...this.host.bytecode.farSegments];
    this.views = [];
    this.viewKeys.clear();
    this.shapeMatches.clear();
    this.rawPointers = [];
    this.rawIds.clear();
    this.regions.clear();
    this.frameRegions.clear();
    this.plainRetypes.clear();
    this.plainGeneration = -1;
    this.blockRegions = new WeakMap();
    this.dataRegion = undefined;
  }

  private get viewBase(): number {
    return VIEW_BASE;
  }

  // ---------- Regions ----------

  private refreshList(id: number): Region['refresh'] {
    return id < 0 ? [] : (this.host.bytecode.variantRefreshes[id] ?? []);
  }

  private segmentRegion(key: string, target: number, segment: SegmentLayout, linear: number | undefined): Region {
    let region = this.regions.get(key);
    if (!region) {
      region = {
        key, target, layout: segment.layout, shape: segment.shape, refresh: this.refreshList(segment.refresh), variantCells: segment.variantCells, variables: true,
        ...(linear !== undefined ? { linear } : {}),
      };
      this.regions.set(key, region);
    }
    return region;
  }
  /** The data segment: the globals and typed constants. */
  private dataSegment(): Region {
    this.dataRegion ??= this.segmentRegion('ds', this.host.globalBase, this.host.bytecode.dataSegment, DATA_SEGMENT * 16);
    return this.dataRegion;
  }
  /** The frames on the stack, innermost first, each with where it lies,
   * until `stop` accepts one. */
  private frame(stop: (frame: { base: number; linear: number; segment: SegmentLayout }) => boolean):
    { base: number; routine: number; linear: number; segment: SegmentLayout } | undefined {
    let { base } = this.host.frame();
    while (base > this.host.globalBase) {
      const routine = this.host.routine(base);
      const frame = { base, routine, linear: this.host.frameLinear(base), segment: this.host.bytecode.frames[routine] ?? EMPTY_SEGMENT };
      if (stop(frame)) return frame;
      const caller = this.host.caller(base);
      if (caller >= base) break;
      base = caller;
    }
    return undefined;
  }
  private frameRegion(frame: { base: number; routine: number; segment: SegmentLayout; linear: number }): Region {
    const known = this.frameRegions.get(frame.base);
    if (known?.routine === frame.routine && known.linear === frame.linear) return known;
    const region: Region = {
      key: `frame:${String(frame.base)}:${String(frame.routine)}:${String(frame.linear)}`, target: frame.base,
      layout: frame.segment.layout, shape: frame.segment.shape, linear: frame.linear, refresh: this.refreshList(frame.segment.refresh),
      variantCells: frame.segment.variantCells, routine: frame.routine, variables: true,
    };
    this.frameRegions.set(frame.base, region);
    return region;
  }
  /** A heap block's bytes, while it lasts; one New gives later at the same
   * place is another. */
  private blockRegion(block: HeapBlock): Region | undefined {
    const type = block.type;
    if (!type) return undefined;
    let region = this.blockRegions.get(block);
    if (!region) {
      region = {
        key: `heap:${String(this.blockCount++)}`, target: block.start, layout: type.layout, shape: type.shape,
        linear: HEAP_START + block.linear, refresh: type.refresh, variantCells: type.variantCells,
      };
      this.blockRegions.set(block, region);
    }
    return region;
  }
  /** The region a cell holding one of the program's variables lies in, and
   * the byte its value starts at there. */
  private placeOfCell(address: number): { region: Region; byte: number } | undefined {
    const within = (region: Region) => {
      const entry = shapeCell(region.shape, address - region.target);
      return entry && { region, byte: entry.byte };
    };
    const heap = this.host.heap;
    if (heap.holds(address)) {
      const block = heap.blockAt(address);
      const region = block && this.blockRegion(block);
      return region && within(region);
    }
    if (address < this.host.globalBase || address > this.host.frame().top) return undefined;
    const global = within(this.dataSegment());
    if (global) return global;
    const frame = this.frame((candidate) => address >= candidate.base);
    return frame && within(this.frameRegion(frame));
  }
  /** The region holding a byte of memory, and the byte there. */
  private placeAt(linear: number): Place {
    const data = DATA_SEGMENT * 16, stack = STACK_SEGMENT * 16, heap = this.host.heap;
    if (linear >= data && linear < data + this.host.bytecode.dataSegment.bytes)
      return { region: this.dataSegment(), byte: linear - data };
    if (linear >= stack && linear < stack + 0x10000) {
      const frame = this.frame((candidate) => linear >= candidate.linear && linear < candidate.linear + candidate.segment.bytes);
      if (frame) return { region: this.frameRegion(frame), byte: linear - frame.linear };
    }
    if (linear >= HEAP_START && linear < HEAP_START + heap.size) {
      const block = heap.blockAtLinear(linear - HEAP_START);
      const region = block && this.blockRegion(block);
      if (block && region && linear - HEAP_START - block.linear < block.bytes) return { region, byte: linear - HEAP_START - block.linear };
    }
    return { linear };
  }
  /** Where any address points: a cell, a string's character, a view's cell
   * or a linear address. */
  private placeOf(address: number): Place | undefined {
    if (!Number.isFinite(address) || address < 0) return undefined;
    if (address >= LINEAR_BASE && address < PORT_BASE) return this.placeAt((address - LINEAR_BASE) % MEGABYTE);
    const far = this.farParts(address);
    if (far) return this.placeAt((far.segment * 16 + far.offset) % MEGABYTE);
    if (address >= this.viewBase) {
      const shown = this.viewCell(address);
      if (!shown) return undefined;
      const { view, byte } = shown;
      if (view.raw) return { linear: (view.region.linear ?? 0) + view.start + byte };
      return { region: view.region, byte: view.start + byte };
    }
    if (address >= this.host.cells && address < LINEAR_BASE) {
      const character = this.host.stringCharacter(address);
      if (!character) return undefined;
      const place = this.placeOfCell(character.address);
      if (place) return { region: place.region, byte: place.byte + character.index };
      return { region: this.stringRegion(character.address, character.capacity), byte: character.index };
    }
    return this.placeOfCell(address);
  }
  /** A string on its own, where no region holds it. */
  private stringRegion(address: number, capacity: number): Region {
    const key = `string:${String(address)}:${String(capacity)}`;
    let region = this.regions.get(key);
    if (!region) {
      const cell: BinaryCell = { kind: 'string', bytes: capacity + 1, offset: 0 };
      region = { key, target: address, layout: [cell], shape: { kind: 'cell', cell }, refresh: [], variantCells: [] };
      this.regions.set(key, region);
    }
    return region;
  }

  /** The linear address of an address, if it has one. */
  linearOf(address: number): number | undefined {
    const place = this.placeOf(address);
    if (!place) return undefined;
    if ('linear' in place) return place.linear;
    return place.region.linear === undefined ? undefined : place.region.linear + place.byte;
  }
  /** Seg and Ofs: an address's segment and offset. The globals are in the
   * data segment and the locals in the stack segment, at their own offsets;
   * a heap pointer is normalized, as Turbo Pascal's heap gives it. */
  segmentOf(address: number): { segment: number; offset: number } {
    const named = this.namedSegment(address);
    if (named) return named;
    const linear = this.linearOf(address);
    if (linear === undefined) return { segment: STACK_SEGMENT, offset: address & 0xffff };
    return splitLinear(linear);
  }
  /** The segment and offset of a far pointer, or of a view of memory made
   * from one, which keep the segment Ptr was given. */
  private namedSegment(address: number): { segment: number; offset: number } | undefined {
    const far = this.farParts(address);
    if (far) return far;
    if (address < this.viewBase) return undefined;
    const at = this.viewAt(address);
    const shown = at?.view.segment === undefined ? undefined : this.viewCell(address);
    if (!at || !shown || at.view.segment === undefined) return undefined;
    const offset = (at.view.region.linear ?? 0) + at.view.start + shown.byte - at.view.segment * 16;
    return offset >= 0 && offset <= 0xffff ? { segment: at.view.segment, offset } : undefined;
  }
  private farParts(address: number): { segment: number; offset: number } | undefined {
    if (address < FAR_BASE || address >= VIEW_BASE) return undefined;
    const segment = this.segments[Math.floor((address - FAR_BASE) / 0x10000)];
    return segment === undefined ? undefined : { segment, offset: (address - FAR_BASE) & 0xffff };
  }
  /** Ptr: the address a segment and offset make. */
  pointer(segment: number, offset: number): number {
    return farAddress(segment, offset, this.segments);
  }
  /** SPtr: the offset of the stack's top, below the innermost frame. */
  stackPointer(): number {
    const innermost = this.frame(() => true);
    return innermost ? innermost.linear - STACK_SEGMENT * 16 : STACK_TOP;
  }

  /** A pointer's bytes: its segment and offset. */
  pointerBits(value: StackValue): number {
    if (value === 0 || value === null || value === false) return 0;
    const number = Number(value);
    const named = Number.isFinite(number) ? this.namedSegment(number) : undefined;
    if (named) return named.segment * 0x10000 + named.offset;
    const linear = Number.isFinite(number) ? this.linearOf(number) : undefined;
    if (linear !== undefined) {
      const { segment, offset } = splitLinear(linear);
      return segment * 0x10000 + offset;
    }
    let id = this.rawIds.get(value);
    if (id === undefined) {
      id = this.rawPointers.push(value) - 1;
      this.rawIds.set(value, id);
    }
    return RAW_SEGMENT * 0x10000 + (id & 0xffff);
  }
  /** A pointer from its bytes. */
  pointerValue(bits: number): StackValue {
    if (!bits) return 0;
    const segment = Math.floor(bits / 0x10000) & 0xffff, offset = bits & 0xffff;
    if (segment === RAW_SEGMENT && offset < this.rawPointers.length) return this.rawPointers[offset] ?? 0;
    return this.pointer(segment, offset);
  }

  // ---------- Memory by address ----------

  /** Bytes of memory, from whichever variables and devices hold them. */
  readLinear(linear: number, length: number): Uint8Array {
    const bytes = new Uint8Array(Math.max(0, length));
    for (let index = 0; index < bytes.length;) {
      const place = this.placeAt((linear + index) % MEGABYTE);
      if ('linear' in place) {
        bytes[index] = this.host.low.read(place.linear);
        index++;
        continue;
      }
      const count = Math.min(bytes.length - index, layoutSize(place.region.layout) - place.byte);
      bytes.set(readBytes(this.host.memory, place.region.target, place.region.layout, place.byte, count), index);
      index += count;
    }
    return bytes;
  }
  writeLinear(linear: number, bytes: Uint8Array): void {
    for (let index = 0; index < bytes.length;) {
      const place = this.placeAt((linear + index) % MEGABYTE);
      if ('linear' in place) {
        this.host.low.write(place.linear, bytes[index] ?? 0);
        index++;
        continue;
      }
      const count = Math.min(bytes.length - index, layoutSize(place.region.layout) - place.byte);
      this.writeRegion(place.region, place.byte, bytes.subarray(index, index + count));
      index += count;
    }
  }
  /** Bytes into a region, whose variant records then follow them. */
  private writeRegion(region: Region, start: number, bytes: Uint8Array): void {
    writeBytes(this.host.memory, region.target, region.layout, start, bytes);
    for (const { part, offset } of this.refreshesWithin(region, start, bytes.length))
      this.host.variants.refresh(region.target + offset, part);
  }
  /** The variant parts of a region whose bytes a change touches. */
  private refreshesWithin(region: Region, start: number, length: number): { part: number; offset: number }[] {
    if (!region.refresh.length) return [];
    let ranges = this.refreshRanges.get(region.refresh);
    if (!ranges) {
      ranges = region.refresh.map(({ part, offset }) => {
        const info = this.host.bytecode.variantParts[part];
        const from = info ? shapeCell(region.shape, offset + info.shadow)?.byte : undefined;
        return { part, offset, from: from ?? 0, to: from === undefined ? Infinity : from + (info?.bytes ?? 0) };
      });
      this.refreshRanges.set(region.refresh, ranges);
    }
    return ranges.filter((range) => range.from < start + length && range.to > start);
  }

  /** `length` bytes from an address, running on past its variable into
   * whatever follows it, as FillChar, Move and BlockRead reach them. An
   * address with no place in memory has only its variable's bytes. */
  bytesAt(address: number, layout: BinaryCell[], length: number): Uint8Array {
    const linear = this.linearOf(address);
    if (linear !== undefined) return this.readLinear(linear, length);
    const place = this.placeOf(address);
    if (place && 'region' in place && place.byte + length <= layoutSize(place.region.layout))
      return readBytes(this.host.memory, place.region.target, place.region.layout, place.byte, length);
    const bytes = new Uint8Array(length);
    bytes.set(encodeBinary(this.host.memory, address, layout).subarray(0, length));
    return bytes;
  }
  /** Stores bytes at an address, as far as they reach. */
  putBytes(address: number, layout: BinaryCell[], bytes: Uint8Array): void {
    const linear = this.linearOf(address);
    if (linear !== undefined) {
      this.writeLinear(linear, bytes);
      return;
    }
    const place = this.placeOf(address);
    if (place && 'region' in place) {
      const room = layoutSize(place.region.layout) - place.byte;
      this.writeRegion(place.region, place.byte, bytes.subarray(0, Math.max(0, room)));
      return;
    }
    const size = layoutSize(layout);
    const target = encodeBinary(this.host.memory, address, layout);
    target.set(bytes.subarray(0, size));
    decodeBinary(this.host.memory, address, layout, target);
  }
  /** How many bytes an address can reach: all of memory past it, or just
   * its variable's. */
  reach(address: number, layout: BinaryCell[]): number {
    const linear = this.linearOf(address);
    if (linear !== undefined) return MEGABYTE - linear;
    const place = this.placeOf(address);
    return place && 'region' in place ? layoutSize(place.region.layout) - place.byte : layoutSize(layout);
  }

  // ---------- Views ----------

  private viewId(key: string, make: () => View): number {
    let id = this.viewKeys.get(key);
    if (id === undefined) {
      id = this.views.push(make()) - 1;
      this.viewKeys.set(key, id);
    }
    return id;
  }
  private viewAddress(id: number, cell = 0): number {
    return this.viewBase + id * VIEW_SPAN + cell;
  }
  /** A region shown as its own variables, as @ gives addresses in it. */
  private identity(region: Region): number {
    region.identity ??= this.viewId(`identity:${region.key}`, () => ({ region, shape: region.shape, start: 0, syncs: [], identity: true }));
    return this.viewAddress(region.identity);
  }
  /** A region shown as its own variables, as @ gives addresses in it: a
   * pointer of another type that holds one reaches only its variable. */
  private boundedIdentity(region: Region): number {
    region.boundedIdentity ??= this.viewId(`bounded:${region.key}`, () => ({ region, shape: region.shape, start: 0, syncs: [], identity: true, bounded: true }));
    return this.viewAddress(region.boundedIdentity);
  }
  /** The bytes, in its region, of the variable holding a cell: one of a
   * segment's variables, or the whole of any other region. */
  private variableBytes(region: Region, cell: number): [number, number] {
    const whole: [number, number] = [0, layoutSize(region.layout)];
    if (!region.variables || region.shape.kind !== 'record') return whole;
    const field = region.shape.fields.find((candidate) => cell >= candidate.offset && cell < candidate.offset + candidate.cells);
    return field ? [field.byte, field.byte + (field.bytes ?? shapeBytes(field.shape))] : whole;
  }
  /** Memory shown as a type from a linear address. */
  private rawView(linear: number, shape: ViewShape, map: number, segment?: number): number {
    const region: Region = { key: `raw:${String(linear)}`, target: 0, layout: [], shape, linear, refresh: [], variantCells: [] };
    return this.viewAddress(this.viewId(`raw:${String(linear)}:${String(map)}:${String(segment ?? '')}`,
      () => ({ region, shape, start: 0, syncs: [], identity: false, raw: true, ...(segment === undefined ? {} : { segment }) })));
  }
  /** Which view an address lies in, and its cell offset there. */
  private viewAt(address: number): { id: number; view: View; offset: number } | undefined {
    const offset = address - this.viewBase;
    if (offset < 0 || !Number.isInteger(offset)) return undefined;
    const id = Math.floor(offset / VIEW_SPAN);
    const view = this.views[id];
    return view ? { id, view, offset: offset % VIEW_SPAN } : undefined;
  }
  /** The view and cell an address shows, if it is a view's. */
  viewCell(address: number): { view: View; byte: number; cell: BinaryCell } | undefined {
    const at = this.viewAt(address);
    const entry = at && shapeCell(at.view.shape, at.offset);
    return at && entry ? { view: at.view, ...entry } : undefined;
  }

  /** VIEW: the address of a cell of a view, made once for what it shows.
   * Its arguments are the variable's address, its layout, the view's map,
   * the byte it starts at, the variable's variant parts, whether it shows
   * the variable as its own type, the variant cases it lies in, and the
   * cell wanted. A view of a variable with a place in memory shows the
   * bytes there, so reading past the variable reads what follows it. */
  view(args: number[]): number {
    const [target = 0, layoutId = 0, map = 0, start = 0, refresh = -1, identity = 0, count = 0] = args;
    const syncs = Array.from({ length: count }, (_, index) => ({
      base: args[7 + index * 3] ?? 0,
      part: args[8 + index * 3] ?? 0,
      case: args[9 + index * 3] ?? 0,
    }));
    const cell = args[7 + count * 3] ?? target;
    const shape = this.host.bytecode.viewMaps[map] ?? { kind: 'record', fields: [] };
    if (identity !== 0 && cell < this.host.cells) {
      const place = this.placeOfCell(cell);
      if (place) return this.boundedIdentity(place.region) + (cell - place.region.target);
    }
    const place = identity !== 0 ? undefined : this.placeOf(target);
    if (place && 'linear' in place) return this.rawView(place.linear + start, shape, map, this.farParts(target)?.segment) + (cell - target);
    if (place) {
      const key = `view:${place.region.key}:${String(map)}:${String(place.byte + start)}:${JSON.stringify(syncs)}`;
      return this.viewAddress(this.viewId(key, () => ({ region: place.region, shape, start: place.byte + start, syncs, identity: false })), cell - target);
    }
    // A variable with no place in memory, such as a temporary: its own bytes.
    const layout = this.host.bytecode.layouts[layoutId] ?? [];
    const key = JSON.stringify(args.slice(0, 7 + count * 3));
    const id = this.viewId(key, () => ({
      region: { key, target, layout, shape, refresh: this.refreshList(refresh), variantCells: refresh >= 0 ? [[0, Infinity]] : [] },
      shape, start, syncs, identity: identity !== 0,
    }));
    return this.viewAddress(id, cell - target);
  }

  /** RETYPE: a pointer dereferenced as the type of `map`. An address that
   * already has the type's shape stays, or becomes the variable's own cell;
   * one of another shape becomes a view of those bytes as the type. */
  retype(pointer: number, map: number): number {
    const shape = this.host.bytecode.viewMaps[map];
    if (!shape || !Number.isFinite(pointer) || pointer <= 0) return pointer;
    if (pointer < this.host.cells) {
      // What a global's or a heap block's cell became is kept while the
      // heap's blocks stay as they are; a frame's changes with each call.
      const heap = this.host.heap;
      // A block New made, dereferenced as its own type: the usual case.
      if (heap.holds(pointer) && heap.mapAt(pointer) === map) return pointer;
      if (this.plainGeneration !== heap.generation) {
        this.plainRetypes.clear();
        this.plainGeneration = heap.generation;
      }
      const key = map < PLAIN_MAPS ? pointer * PLAIN_MAPS + map : -1;
      const known = this.plainRetypes.get(key);
      if (known !== undefined) return known;
      // A block New made, as its own type: the usual case, at once.
      const block = heap.holds(pointer) ? heap.blockAt(pointer) : undefined;
      let result = pointer;
      if (block?.map !== map || block.start !== pointer) {
        const place = this.placeOfCell(pointer);
        if (!place) return pointer;
        result = this.retypeView(this.identity(place.region) + (pointer - place.region.target), map, shape);
        if (!block && place.region !== this.dataRegion) return result;
      }
      if (key >= 0) this.plainRetypes.set(key, result);
      return result;
    }
    if (this.viewAt(pointer)) return this.retypeView(pointer, map, shape);
    const character = pointer < LINEAR_BASE ? this.host.stringCharacter(pointer) : undefined;
    // A string's character, as a Char, is the character itself.
    if (character && shape.kind === 'cell' && shape.cell.kind === 'char') return pointer;
    const place = this.placeOf(pointer);
    if (!place) return pointer;
    if ('linear' in place) return this.rawView(place.linear, shape, map, this.farParts(pointer)?.segment);
    // A byte where a cell of the region starts is that cell.
    const at = cellAtByte(place.region.layout, place.byte);
    const cell = at && place.region.layout[at.index];
    if (at?.at === place.byte && cell && cell.kind !== 'gap' && !character) {
      const address = place.region.target + (cell.offset ?? at.index);
      if (shapeCell(place.region.shape, address - place.region.target))
        return this.retypeView(this.identity(place.region) + (address - place.region.target), map, shape);
    }
    const region = place.region;
    const key = `retype:${region.key}:${String(place.byte)}:${String(map)}`;
    return this.viewAddress(this.viewId(key, () => ({ region, shape, start: place.byte, syncs: [], identity: false })));
  }
  private retypeView(pointer: number, map: number, shape: ViewShape): number {
    const at = this.viewAt(pointer);
    if (!at) return pointer;
    const entry = shapeCell(at.view.shape, at.offset);
    if (!entry) return pointer;
    let byOffset = this.shapeMatches.get(at.id * 65536 + map);
    if (!byOffset) this.shapeMatches.set(at.id * 65536 + map, (byOffset = new Map<number, boolean>()));
    let matches = byOffset.get(at.offset);
    if (matches === undefined) {
      matches = sameShape(at.view.shape, at.offset, shape);
      byOffset.set(at.offset, matches);
    }
    const { view } = at;
    // Past the variable @ took the address of, the type is a view of bytes
    // that stops where the variable does.
    const bound = view.bound ?? (view.bounded ? this.variableBytes(view.region, at.offset) : undefined);
    if (matches && view.bounded && bound && view.start + entry.byte + shapeBytes(shape) > bound[1]) matches = false;
    if (matches) {
      // The variable's own cell, unless it lies in a record with variant
      // parts that the type covers only part of: stores into such a record's
      // cases are followed by the rest only when they name its fields, or go
      // through its bytes.
      const end = at.offset + shapeSize(shape);
      const plain = view.identity &&
        view.region.variantCells.every(([from, to]) => to <= at.offset || from >= end || (from >= at.offset && to <= end));
      return plain ? view.region.target + at.offset : pointer;
    }
    const id = this.viewId(`retype:${String(at.id)}:${String(at.offset)}:${String(map)}`, () => ({
      region: view.region, shape, start: view.start + entry.byte, syncs: view.syncs, identity: false, ...(view.raw ? { raw: true } : {}),
      ...(bound ? { bound } : {}),
    }));
    return this.viewAddress(id);
  }
  /** A pointer about to be compared: the byte of memory it points at, so
   * pointers to one byte compare equal however they were made. A far
   * pointer is its segment and offset, as Turbo Pascal compares all 32 bits:
   * Ptr($1234, $5678) is not Ptr($179B, 8). */
  normalize(value: StackValue): StackValue {
    if (typeof value !== 'number' || value === 0) return value;
    const named = this.namedSegment(value);
    if (named) return -1 - MEGABYTE - (named.segment * 0x10000 + named.offset);
    const linear = this.linearOf(value);
    if (linear !== undefined) return -1 - linear;
    const at = this.viewAt(value);
    return at?.view.identity ? at.view.region.target + at.offset : value;
  }

  /** A cell of a view: decoded from the bytes it shows. */
  peek(address: number): StackValue | undefined {
    const shown = this.viewCell(address);
    if (!shown) return undefined;
    const { view, byte, cell } = shown;
    const direct = this.directCell(view, byte, cell, false);
    if (direct !== undefined) return this.host.memory.read(direct);
    let value: StackValue = 0;
    decodeBinary({ read: () => 0, write: (_, decoded) => { value = decoded; }, pointerValue: (bits) => this.pointerValue(bits) },
      0, [{ ...cell, offset: 0 }], this.viewBytes(view, byte, cell.bytes));
    return value;
  }
  /** Stores into a cell of a view: encoded into the bytes it shows. A
   * string stores only its length and characters, as Turbo Pascal copies it. */
  poke(address: number, value: StackValue): boolean {
    const shown = this.viewCell(address);
    if (!shown) return false;
    const { view, byte, cell } = shown;
    const direct = this.directCell(view, byte, cell, true);
    if (direct !== undefined) {
      this.host.memory.write(direct, value);
      for (const sync of view.syncs) this.host.variants.sync(sync.base, sync.part, sync.case);
      return true;
    }
    const bytes = encodeBinary({ read: () => value, write: () => undefined, pointerBits: (pointer) => this.pointerBits(pointer) }, 0, [{ ...cell, offset: 0 }]);
    const used = cell.kind === 'string' ? (bytes[0] ?? 0) + 1 : bytes.length;
    this.putViewBytes(view, byte, bytes.subarray(0, used));
    for (const sync of view.syncs) this.host.variants.sync(sync.base, sync.part, sync.case);
    return true;
  }
  /** The cell a view's cell is, where the bytes beneath it are one cell of
   * the same type: then a load or store needs no bytes, as a pointer into a
   * GetMem block larger than a PByteArray's elements shows. A store into a
   * variant part's bytes still goes through them, so its cases follow. */
  private directCell(view: View, byte: number, cell: BinaryCell, store: boolean): number | undefined {
    if (view.raw) return undefined;
    const start = view.start + byte, region = view.region;
    const at = cellAtByte(region.layout, start);
    if (at?.at !== start) return undefined;
    const found = region.layout[at.index]!;
    if (found.kind !== cell.kind || found.bytes !== cell.bytes || Boolean(found.signed) !== Boolean(cell.signed) ||
      (found.setByteOffset ?? 0) !== (cell.setByteOffset ?? 0) || found.kind === 'gap') return undefined;
    this.beyond(view, start, cell.bytes);
    if (store && region.refresh.length && (region.linear === undefined || this.refreshesWithin(region, start, cell.bytes).length)) return undefined;
    return region.target + (found.offset ?? at.index);
  }
  /** Whether bytes from `start` lie outside the variable a view is bound to. */
  private beyond(view: View, start: number, length: number): void {
    if (view.bound && (start < view.bound[0] || start + length > view.bound[1])) throw new PascalError('Access beyond the variable');
  }
  private viewBytes(view: View, byte: number, length: number): Uint8Array {
    const start = view.start + byte, region = view.region;
    this.beyond(view, start, length);
    if (view.raw) return this.readLinear((region.linear ?? 0) + start, length);
    if (start >= 0 && start + length <= layoutSize(region.layout))
      return readBytes(this.host.memory, region.target, region.layout, start, length);
    if (region.linear === undefined) throw new PascalError('Access beyond the variable');
    return this.readLinear(region.linear + start, length);
  }
  private putViewBytes(view: View, byte: number, bytes: Uint8Array): void {
    const start = view.start + byte, region = view.region;
    this.beyond(view, start, bytes.length);
    if (view.raw) {
      this.writeLinear((region.linear ?? 0) + start, bytes);
      return;
    }
    if (start >= 0 && start + bytes.length <= layoutSize(region.layout)) {
      if (region.linear === undefined) {
        // A variable's own bytes: all its variant parts follow.
        writeBytes(this.host.memory, region.target, region.layout, start, bytes);
        for (const { part, offset } of region.refresh) this.host.variants.refresh(region.target + offset, part);
      } else this.writeRegion(region, start, bytes);
      return;
    }
    if (region.linear === undefined) throw new PascalError('Access beyond the variable');
    this.writeLinear(region.linear + start, bytes);
  }

  /** A linear address as a cell: one byte of memory. */
  peekLinear(address: number): number {
    return this.readLinear(this.linearByte(address), 1)[0] ?? 0;
  }
  pokeLinear(address: number, value: StackValue): void {
    const byte = typeof value === 'string' ? value.charCodeAt(0) : Number(value);
    this.writeLinear(this.linearByte(address), Uint8Array.of(byte & 0xff));
  }
  /** The byte of memory a linear or far address names. */
  private linearByte(address: number): number {
    const far = this.farParts(address);
    return far ? (far.segment * 16 + far.offset) % MEGABYTE : (address - LINEAR_BASE) % MEGABYTE;
  }
  /** The first cell of the heap block an address points into, for Dispose
   * and FreeMem. */
  blockStart(address: number): number {
    if (address < this.host.cells) return address;
    const linear = this.linearOf(address);
    const block = linear === undefined ? undefined : this.host.heap.blockAtLinear(linear - HEAP_START);
    return block && linear === HEAP_START + block.linear ? block.start : address;
  }
  /** A pointer to a byte of the heap, as HeapOrg, HeapPtr and HeapEnd are. */
  heapPointer(offset: number): number {
    return LINEAR_BASE + HEAP_START + offset;
  }
  /** Release's mark: a HeapPtr that Mark recorded, as a byte of the heap. */
  heapOffset(pointer: number): number {
    const linear = this.linearOf(pointer);
    if (linear === undefined) throw new PascalError('Invalid or disposed pointer');
    return linear - HEAP_START;
  }
}
