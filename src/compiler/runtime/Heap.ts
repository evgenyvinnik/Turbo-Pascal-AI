import { PascalError } from '../errors/PascalError';
import type { ViewShape } from '../codegen/Bytecode';
import type { BinaryCell } from './BinaryCodec';

/** What a heap block holds: its type's cells and bytes, as New and a typed
 * GetMem give it. A block without one keeps a value per byte. */
export interface BlockType {
  layout: BinaryCell[];
  shape: ViewShape;
  /** The variant parts in it, and the cell each record starts at. */
  refresh: { part: number; offset: number }[];
  /** The cells of its records with variant parts, whose cases follow only
   * stores that go through their bytes or name their fields. */
  variantCells: [number, number][];
}

export interface HeapBlock {
  /** The block's first cell and how many it has. */
  start: number;
  words: number;
  /** Its bytes: where they start from HeapOrg, and how many. */
  linear: number;
  bytes: number;
  type?: BlockType;
  /** The number of the view map New gave it, so a pointer of its own type
   * dereferences at once. */
  map?: number;
}

/** Turbo Pascal's heap. Blocks take cells from the top of the P-machine's
 * store down, and bytes from HeapOrg up, in eight-byte steps as Turbo Pascal
 * allocates them; a pointer's segment and offset are its block's bytes. */
export class Heap {
  /** The lowest cell in use; the stack must stay below it. */
  np: number;
  /** Where the used bytes end: HeapPtr. */
  private top = 0;
  /** Counts changes to the blocks, so what depends on them knows to look again. */
  generation = 0;
  private blocks = new Map<number, HeapBlock>();
  private freeCells: { address: number; words: number }[] = [];
  private freeBytes: { at: number; bytes: number }[] = [];
  /** The block each cell and each eight bytes lie in, by first cell plus one. */
  private cellBlocks: Int32Array;
  private byteBlocks: Int32Array;

  constructor(
    private readonly bottom: number,
    private readonly end: number,
    /** How many bytes the heap has. */
    readonly size: number,
    /** Whether a cell lies above the stack, so the heap can take it. */
    private readonly clear: (address: number) => boolean
  ) {
    this.np = end;
    this.cellBlocks = new Int32Array(Math.max(0, end - bottom));
    this.byteBlocks = new Int32Array(Math.ceil(size / 8));
  }

  reset(): void {
    this.generation++;
    this.np = this.end;
    this.top = 0;
    this.blocks.clear();
    this.freeCells = [];
    this.freeBytes = [];
    this.cellBlocks.fill(0);
    this.byteBlocks.fill(0);
  }

  /** A block of `words` cells and `bytes` bytes; its first cell. */
  allocate(words: number, bytes: number, type?: BlockType, map?: number): number {
    if (!Number.isInteger(words) || words <= 0) throw new PascalError('Invalid allocation size');
    const size = Math.max(8, Math.ceil(bytes / 8) * 8);
    const linear = this.takeBytes(size);
    let address: number;
    const free = this.freeCells.findIndex((block) => block.words >= words);
    if (free >= 0) {
      const block = this.freeCells[free]!;
      address = block.address;
      block.address += words;
      block.words -= words;
      if (block.words === 0) this.freeCells.splice(free, 1);
    } else {
      address = this.np - words;
      if (address < this.bottom || !this.clear(address)) {
        this.giveBytes(linear, size);
        throw new PascalError('Heap overflow');
      }
      this.np = address;
    }
    const block: HeapBlock = { start: address, words, linear, bytes, ...(type ? { type } : {}), ...(map !== undefined ? { map } : {}) };
    this.generation++;
    this.blocks.set(address, block);
    this.cellBlocks.fill(address + 1, address - this.bottom, address - this.bottom + words);
    this.byteBlocks.fill(address + 1, linear / 8, (linear + size) / 8);
    return address;
  }

  /** Dispose and FreeMem: the block starting at a cell. */
  free(address: number): void {
    const block = this.blocks.get(address);
    if (!block) throw new PascalError('Invalid or disposed pointer');
    this.drop(block);
  }

  /** Release: every block whose bytes lie at or above a HeapPtr that Mark
   * recorded, which then becomes the top. */
  release(linear: number): void {
    if (!Number.isInteger(linear) || linear < 0 || linear > this.size) throw new PascalError('Invalid or disposed pointer');
    for (const block of [...this.blocks.values()]) if (block.linear >= linear) this.drop(block);
    this.freeBytes = this.freeBytes.filter((range) => range.at + range.bytes <= linear);
    this.top = Math.min(this.top, linear);
    this.settle();
  }

  /** MemAvail and MaxAvail, in bytes: what lies above HeapPtr and in the
   * free list. */
  available(): { total: number; largest: number } {
    const above = this.size - this.top;
    return {
      total: above + this.freeBytes.reduce((sum, range) => sum + range.bytes, 0),
      largest: Math.max(above, ...this.freeBytes.map((range) => range.bytes)),
    };
  }

  /** HeapPtr: where the used bytes end. */
  get pointer(): number {
    return this.top;
  }

  blockAt(address: number): HeapBlock | undefined {
    const start = this.cellBlocks[address - this.bottom];
    return start ? this.blocks.get(start - 1) : undefined;
  }
  /** The block holding a byte of the heap, from HeapOrg. */
  blockAtLinear(linear: number): HeapBlock | undefined {
    const start = this.byteBlocks[Math.floor(linear / 8)];
    const block = start ? this.blocks.get(start - 1) : undefined;
    return block && linear >= block.linear && linear < block.linear + Math.max(8, Math.ceil(block.bytes / 8) * 8) ? block : undefined;
  }
  /** Whether a cell belongs to the heap's part of the store. */
  holds(address: number): boolean {
    return address >= this.bottom && address < this.end;
  }

  private drop(block: HeapBlock): void {
    const size = Math.max(8, Math.ceil(block.bytes / 8) * 8);
    this.generation++;
    this.blocks.delete(block.start);
    this.cellBlocks.fill(0, block.start - this.bottom, block.start - this.bottom + block.words);
    this.byteBlocks.fill(0, block.linear / 8, (block.linear + size) / 8);
    this.freeCells.push({ address: block.start, words: block.words });
    this.freeCells.sort((a, b) => a.address - b.address);
    for (let i = 0; i + 1 < this.freeCells.length;) {
      const first = this.freeCells[i]!, next = this.freeCells[i + 1]!;
      if (first.address + first.words === next.address) {
        first.words += next.words;
        this.freeCells.splice(i + 1, 1);
      } else i++;
    }
    this.giveBytes(block.linear, size);
  }

  /** Bytes from the free list, first fit, or from the top. */
  private takeBytes(size: number): number {
    const free = this.freeBytes.findIndex((range) => range.bytes >= size);
    if (free >= 0) {
      const range = this.freeBytes[free]!;
      const at = range.at;
      range.at += size;
      range.bytes -= size;
      if (range.bytes === 0) this.freeBytes.splice(free, 1);
      return at;
    }
    if (this.top + size > this.size) throw new PascalError('Heap overflow');
    const at = this.top;
    this.top += size;
    return at;
  }
  private giveBytes(at: number, size: number): void {
    this.freeBytes.push({ at, bytes: size });
    this.freeBytes.sort((a, b) => a.at - b.at);
    for (let i = 0; i + 1 < this.freeBytes.length;) {
      const first = this.freeBytes[i]!, next = this.freeBytes[i + 1]!;
      if (first.at + first.bytes === next.at) {
        first.bytes += next.bytes;
        this.freeBytes.splice(i + 1, 1);
      } else i++;
    }
    this.settle();
  }
  /** Free bytes at the top go back to it, and free cells at the bottom of
   * the used ones back to the unused. */
  private settle(): void {
    const last = this.freeBytes.at(-1);
    if (last && last.at + last.bytes >= this.top) {
      this.top = Math.min(this.top, last.at);
      this.freeBytes.pop();
    }
    const lowest = this.freeCells[0];
    if (lowest && lowest.address === this.np) {
      this.np += lowest.words;
      this.freeCells.shift();
    }
  }
}
