import type { VariantPartInfo } from '../codegen/Bytecode';
import { decodeBinary, encodeBinary } from './BinaryCodec';
import type { MemoryAccess } from './FileRuntime';

/** A variant record's cases overlay one another byte by byte, as in Turbo
 * Pascal. Each case keeps its fields in cells of its own; the part's shadow
 * holds its bytes, which the cases are kept in step with. */
export class VariantRuntime {
  constructor(
    private memory: MemoryAccess,
    private parts: VariantPartInfo[]
  ) {}

  /** A store into case `caseIndex`: its bytes become the part's, and every
   * case follows them. Bytes beyond the case keep what they held, as do those
   * past a string's length, which Turbo Pascal does not copy either. */
  sync(base: number, partIndex: number, caseIndex: number): void {
    const part = this.parts[partIndex];
    const variantCase = part?.cases[caseIndex];
    if (!part || !variantCase) return;
    let at = 0;
    for (const { offset, cell } of variantCase.cells) {
      const bytes = encodeBinary(this.memory, base + offset, [cell]);
      const used = cell.kind === 'string' ? (bytes[0] ?? 0) + 1 : bytes.length;
      for (let index = 0; index < used && at + index < part.bytes; index++)
        this.memory.write(base + part.shadow + at + index, bytes[index] ?? 0);
      at += bytes.length;
    }
    this.refresh(base, partIndex);
  }

  /** Every case of a part from its bytes, and the parts inside them. */
  refresh(base: number, partIndex: number): void {
    const part = this.parts[partIndex];
    if (!part) return;
    const bytes = new Uint8Array(part.bytes);
    for (let at = 0; at < part.bytes; at++)
      bytes[at] = Number(this.memory.read(base + part.shadow + at) ?? 0) & 0xff;
    for (const variantCase of part.cases) {
      let at = 0;
      for (const { offset, cell } of variantCase.cells) {
        if (at >= bytes.length) break;
        decodeBinary(this.memory, base + offset, [cell], bytes.subarray(at, at + cell.bytes));
        at += cell.bytes;
      }
      for (const nested of variantCase.nested) this.refresh(base + nested.offset, nested.part);
    }
  }
}
