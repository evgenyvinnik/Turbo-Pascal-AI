import { decodeBinary, encodeBinary, type BinaryCell } from './BinaryCodec';
import type { StackValue } from './Machine';
import type { FileRuntime, MemoryAccess } from './FileRuntime';
import { DIRECTORY, type VirtualFileSystem } from './VirtualFileSystem';

const HIDDEN = 0x02,
  SYSTEM = 0x04,
  VOLUME = 0x08;

/** The environment the Dos unit reports, as GetEnv does. */
export const ENVIRONMENT: readonly (readonly [string, string])[] = [
  ['COMSPEC', 'C:\\COMMAND.COM'],
  ['PATH', 'C:\\'],
  ['TEMP', 'C:\\TEMP'],
];

interface Found {
  name: string;
  size: number;
  time: number;
  attributes: number;
}

/** A name matched as DOS matches it: eight characters and three, where `?`
 * takes any one, even none, and `*` the rest of its part. */
export function dosMatch(name: string, pattern: string): boolean {
  const split = (text: string): [string, string] => {
    if (text === '.' || text === '..') return [text, ''];
    const dot = text.indexOf('.');
    return dot < 0 ? [text, ''] : [text.slice(0, dot), text.slice(dot + 1)];
  };
  const expand = (part: string, length: number) => {
    let out = '';
    for (const char of part) {
      if (char === '*') return out.padEnd(length, '?');
      out += char;
    }
    return out.slice(0, length).padEnd(length, ' ');
  };
  const [patternName, patternExt] = split(pattern.toUpperCase());
  const [fileName, fileExt] = split(name.toUpperCase());
  const matches = (wanted: string, actual: string) => {
    for (let index = 0; index < wanted.length; index++)
      if (wanted[index] !== '?' && wanted[index] !== (actual[index] ?? ' ')) return false;
    return true;
  };
  return (
    matches(expand(patternName, 8), fileName.padEnd(8, ' ')) &&
    matches(expand(patternExt, 3), fileExt.padEnd(3, ' '))
  );
}

/** The Dos unit's routines that reach the virtual drive and DOS's state. */
export class DosUnit {
  private checkBreak = false;
  private verify = false;
  private searches = new Map<number, { found: Found[]; next: number }>();
  private nextSearch = 1;
  constructor(
    private memory: MemoryAccess,
    private disk: VirtualFileSystem,
    private files: FileRuntime
  ) {}

  reset(): void {
    this.checkBreak = false;
    this.verify = false;
    this.searches.clear();
    this.nextSearch = 1;
  }

  /** Routines 310 to 330. DosError is set to the result's `dosError`. */
  invoke(
    index: number,
    args: StackValue[]
  ): { result?: StackValue; dosError?: number } | undefined {
    const a = Number(args[0]);
    const text = (value: StackValue | undefined) => String(value ?? '');
    switch (index) {
      case 310:
        this.memory.write(a, this.checkBreak ? 1 : 0);
        return {};
      case 311:
        this.checkBreak = Boolean(args[0]);
        return {};
      case 312:
        this.memory.write(a, this.verify ? 1 : 0);
        return {};
      case 313:
        this.verify = Boolean(args[0]);
        return {};
      case 314:
      case 315:
      case 316:
      case 317:
        return this.fileInformation(index, a, Number(args[1]));
      case 318:
        return this.findFirst(
          text(args[0]),
          Number(args[1]),
          Number(args[2]),
          this.layout(args[3])
        );
      case 319:
        return this.findNext(a, this.layout(args[1]));
      case 320:
        this.unpack(a, Number(args[1]), this.layout(args[2]));
        return {};
      case 321:
        this.memory.write(Number(args[2]), this.pack(a, this.layout(args[1])));
        return {};
      case 322:
        return {};
      case 324: {
        // The P-machine cannot load another program: DOS answers as it does
        // for a Turbo Pascal program whose heap took all memory.
        const path = text(args[0]);
        const found = path.toUpperCase() === ENVIRONMENT[0]![1] || this.exists(path);
        return { dosError: found ? 8 : 2 };
      }
      case 325:
        return { result: 0 };
      case 326:
        return { result: this.search(text(args[0]), text(args[1])) };
      case 327:
        return { result: this.expand(text(args[0])) };
      case 328: {
        const path = text(args[0]);
        const at = Math.max(path.lastIndexOf('\\'), path.lastIndexOf(':'));
        const rest = path.slice(at + 1),
          dot = rest.lastIndexOf('.');
        this.memory.write(Number(args[1]), path.slice(0, at + 1).slice(0, 67));
        this.memory.write(Number(args[2]), (dot < 0 ? rest : rest.slice(0, dot)).slice(0, 8));
        this.memory.write(Number(args[3]), (dot < 0 ? '' : rest.slice(dot)).slice(0, 4));
        return {};
      }
      case 333:
        this.fileRecord(a, Number(args[1]), this.layout(args[2]));
        return {};
      case 329:
        return { result: ENVIRONMENT.length };
      case 330: {
        const entry = ENVIRONMENT[a - 1];
        return { result: entry ? `${entry[0]}=${entry[1]}` : '' };
      }
    }
    return undefined;
  }

  /** FileRec and TextRec: the handle DOS gave the file, its mode, its record
   * or buffer size and the name it was assigned, in either record's layout. */
  private fileRecord(file: number, record: number, layout: BinaryCell[]): void {
    const state = this.files.fileRecord(file);
    const bytes = new Uint8Array(layout.reduce((size, cell) => size + cell.bytes, 0));
    const view = new DataView(bytes.buffer);
    const modes = { none: 0xd7b0, closed: 0xd7b0, read: 0xd7b1, write: 0xd7b2, update: 0xd7b3 };
    view.setUint16(0, state.handle, true);
    view.setUint16(2, modes[state.mode], true);
    view.setUint16(4, state.text ? 128 : state.recordSize & 0xffff, true);
    for (let index = 0; index < Math.min(79, state.name.length); index++) bytes[48 + index] = state.name.charCodeAt(index) & 0xff;
    decodeBinary(this.memory, record, layout, bytes);
  }
  private layout(value: StackValue | undefined): BinaryCell[] {
    return JSON.parse(String(value ?? '[]')) as BinaryCell[];
  }
  private exists(name: string): boolean {
    try {
      return this.disk.exists(name);
    } catch {
      return false;
    }
  }
  /** GetFAttr, SetFAttr, GetFTime and SetFTime. The times need the file
   * open, as DOS's handle calls do. */
  private fileInformation(index: number, file: number, value: number): { dosError: number } {
    const assigned = this.files.fileName(file);
    if (!assigned?.name) return { dosError: 3 };
    if ((index === 316 || index === 317) && !assigned.open) return { dosError: 6 };
    try {
      if (index === 314) this.memory.write(value, this.disk.attributesOf(assigned.name));
      else if (index === 315) {
        if (value & (VOLUME | DIRECTORY)) return { dosError: 5 };
        this.disk.setAttributes(assigned.name, value);
      } else if (index === 316) this.memory.write(value, this.disk.timeOf(assigned.name) | 0);
      else this.disk.setTime(assigned.name, value);
      return { dosError: 0 };
    } catch {
      return { dosError: 2 };
    }
  }
  /** FindFirst: the entries of a directory that match a name and whose
   * special attributes, hidden, system and directory, are asked for. */
  private findFirst(
    path: string,
    attributes: number,
    record: number,
    layout: BinaryCell[]
  ): { dosError: number } {
    const name = path.replaceAll('/', '\\');
    const at = Math.max(name.lastIndexOf('\\'), name.lastIndexOf(':'));
    const directory = name.slice(0, at + 1),
      pattern = name.slice(at + 1) || '*.*';
    let where: string;
    try {
      where = this.disk.directoryPath(directory || '.');
    } catch {
      return { dosError: 3 };
    }
    if (!this.disk.isDirectory(where)) return { dosError: 3 };
    if (attributes === VOLUME) return { dosError: 18 };
    const entries: Found[] = [
      ...(where && attributes & DIRECTORY
        ? ['.', '..'].map((dots) => ({ name: dots, size: 0, time: 0, attributes: DIRECTORY }))
        : []),
      ...this.disk.list(where),
    ];
    const found = entries.filter(
      (entry) =>
        dosMatch(entry.name, pattern) &&
        (entry.attributes & (HIDDEN | SYSTEM | DIRECTORY) & ~attributes) === 0
    );
    const id = this.nextSearch++;
    this.searches.set(id, { found, next: 0 });
    const bytes = encodeBinary(this.memory, record, layout);
    new DataView(bytes.buffer).setUint32(0, id, true);
    decodeBinary(this.memory, record, layout, bytes);
    return this.findNext(record, layout);
  }
  /** FindNext: the next match, in SearchRec's layout. Its Fill holds which
   * search it continues. */
  private findNext(record: number, layout: BinaryCell[]): { dosError: number } {
    const bytes = encodeBinary(this.memory, record, layout);
    const view = new DataView(bytes.buffer);
    const search = this.searches.get(view.getUint32(0, true));
    const entry = search?.found[search.next];
    if (!search || !entry) return { dosError: 18 };
    search.next++;
    bytes[21] = entry.attributes;
    view.setUint32(22, entry.time >>> 0, true);
    view.setUint32(26, entry.size, true);
    const shown = entry.name.slice(0, 12);
    bytes[30] = shown.length;
    for (let index = 0; index < 12; index++)
      bytes[31 + index] = index < shown.length ? shown.charCodeAt(index) : 0;
    decodeBinary(this.memory, record, layout, bytes);
    return { dosError: 0 };
  }
  /** DateTime's six words, from a packed time. */
  private unpack(packed: number, record: number, layout: BinaryCell[]): void {
    const time = packed >>> 0;
    const fields = [
      (time >>> 25) + 1980,
      (time >>> 21) & 15,
      (time >>> 16) & 31,
      (time >>> 11) & 31,
      (time >>> 5) & 63,
      (time & 31) * 2,
    ];
    const bytes = new Uint8Array(12);
    fields.forEach((value, index) => {
      new DataView(bytes.buffer).setUint16(index * 2, value & 0xffff, true);
    });
    decodeBinary(this.memory, record, layout, bytes);
  }
  private pack(record: number, layout: BinaryCell[]): number {
    const view = new DataView(encodeBinary(this.memory, record, layout).buffer);
    const [year, month, day, hour, minute, second] = Array.from({ length: 6 }, (_, index) =>
      view.getUint16(index * 2, true)
    ) as [number, number, number, number, number, number];
    return (
      ((year - 1980) << 25) |
      ((month & 15) << 21) |
      ((day & 31) << 16) |
      ((hour & 31) << 11) |
      ((minute & 63) << 5) |
      ((second >> 1) & 31) |
      0
    );
  }
  /** FExpand: a name with its drive and whole path, in capitals. */
  private expand(path: string): string {
    let name = path.toUpperCase().replaceAll('/', '\\');
    let drive = 'C';
    if (/^[A-Z]:/.test(name)) {
      drive = name.charAt(0);
      name = name.slice(2);
    }
    if (!name.startsWith('\\')) name = `${this.disk.currentDirectory.slice(2)}\\${name}`;
    const parts: string[] = [];
    for (const part of name.split('\\')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return `${drive}:\\${parts.join('\\')}${path.endsWith('\\') && parts.length ? '\\' : ''}`;
  }
  /** FSearch: the name itself where it is, or in the first directory of the
   * list that holds it. */
  private search(path: string, directories: string): string {
    if (this.exists(path)) return path;
    for (const directory of directories.split(';')) {
      if (!directory) continue;
      const candidate = `${directory}${/[\\:]$/.test(directory) ? '' : '\\'}${path}`;
      if (this.exists(candidate)) return candidate;
    }
    return '';
  }
}
