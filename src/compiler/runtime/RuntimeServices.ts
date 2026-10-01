import { PascalError } from '../errors/PascalError';
import { TypeCode } from '../types/inst';
import type { StackValue } from './Machine';
import { TextConsole } from './TextConsole';
import { BUILT_IN_MODES, GraphicsRuntime } from './GraphicsRuntime';
import { Graph3 } from './Graph3';
import { DosUnit, ENVIRONMENT } from './DosUnit';
import { FileRuntime, type MemoryAccess } from './FileRuntime';
import { VirtualFileSystem } from './VirtualFileSystem';
import { hersheyFont, parseStrokeFont, type StrokeFont } from './StrokeFont';
import { BGI_HEADER_BYTES, parseBgiDriver } from './BgiDriver';
import { BgiDriverBackend, DriverRefused } from './BgiKernel';
import { decodeOverlayFile, overlaySize, type OverlayUnit } from './OverlayFile';
import { roundReal48 } from '../codegen/numeric';
import { decodeBinary, encodeBinary, type BinaryCell } from './BinaryCodec';
import type { ViewShape } from '../codegen/Bytecode';
import type { BlockType } from './Heap';
import { CODE_SEGMENT, DATA_SEGMENT, STACK_SEGMENT } from './AddressSpace';
import { compReal, parseReal } from '../codegen/float80';
import { defined } from '../../utils/defined';

const BYTE_CELL: BinaryCell = { kind: 'integer', bytes: 1, signed: false };

interface Host extends MemoryAccess {
  /** A heap block: its cells, what they start as, its bytes, and how the
   * bytes lie when its type is known. */
  allocate(
    words: number,
    defaults: StackValue[],
    bytes?: number,
    type?: BlockType & { map?: number }
  ): number;
  free(address: number): void;
  /** Free heap space, in total and in the largest block, in bytes. */
  heapAvailable(): { total: number; largest: number };
  /** The current stack pointer, which SPtr reports. */
  stackPointer(): number;
  /** The heap top, which Mark records and Release returns to. */
  heapTop(): number;
  /** Whether nothing has been allocated: HeapPtr is still HeapOrg. */
  heapEmpty?(): boolean;
  /** Memory by linear address, which a loaded graphics driver reaches. */
  readLinear?(linear: number, length: number): Uint8Array;
  writeLinear?(linear: number, bytes: Uint8Array): void;
  releaseHeap(address: number): void;
  sound(frequency: number): void;
  /** A layout by its number, as an untyped parameter's caller passes it. */
  layout?(id: number): BinaryCell[];
  /** A type's view map and its list of variant parts, by number. */
  viewMap?(id: number): ViewShape | undefined;
  refreshes?(id: number): { part: number; offset: number }[];
  /** Seg and Ofs of an address, and the address Ptr makes. */
  segmentOf?(address: number): { segment: number; offset: number };
  pointer?(segment: number, offset: number): number;
}
interface Result {
  result?: StackValue;
  delay?: number;
  ioError?: number;
  /** What the Dos unit's DosError becomes. */
  dosError?: number;
}

/** The drivers Turbo Pascal's Graph unit numbers 1 to 10, by the files they
 * load, and the modes each offers. */
const STANDARD_DRIVERS = [
  '',
  'CGA',
  'CGA',
  'EGAVGA',
  'EGAVGA',
  'EGAVGA',
  'IBM8514',
  'HERC',
  'ATT',
  'EGAVGA',
  'PC3270',
];
const MODE_RANGES: Record<number, [number, number]> = {
  1: [0, 4],
  2: [0, 5],
  3: [0, 1],
  4: [0, 1],
  5: [3, 3],
  6: [0, 1],
  7: [0, 0],
  8: [0, 5],
  9: [0, 2],
  10: [0, 0],
};
/** The stroked fonts Turbo Pascal numbers 1 to 10, by their files. */
const STANDARD_FONTS = [
  '',
  'TRIP',
  'LITT',
  'SANS',
  'GOTH',
  'SCRI',
  'SIMP',
  'TSCR',
  'LCOM',
  'EURO',
  'BOLD',
];

/** Stateful standard-library services called by the VM's CSP instruction. */
export class RuntimeServices {
  readonly console = new TextConsole();
  readonly graphics = new GraphicsRuntime();
  readonly graph3 = new Graph3(this.graphics, this.console);
  readonly files: FileRuntime;
  private clockOffset = 0;
  private fontPath = '';
  /** Drivers InstallUserDriver added, numbered from 11, and the drivers and
   * fonts RegisterBGIdriver and RegisterBGIfont took from memory. */
  private userDrivers: string[] = [];
  /** Registered drivers' code, by name. */
  private registeredDrivers = new Map<string, Uint8Array>();
  /** The code and number of the driver InitGraph loaded, for SetGraphMode. */
  private loadedDriver: { code: Uint8Array; number: number } | undefined;
  private userFonts: string[] = [];
  private registeredFonts = new Map<number, StrokeFont>();
  /** The name of the driver InitGraph loaded. */
  private driverName = '';
  /** The units {$O} overlays, which the program's .OVR file holds. */
  overlays: readonly OverlayUnit[] = [];
  /** The overlay manager, once OvrInit opens the file: the file, the buffer's
   * size, the overlays in it, the least recently used first, and the
   * probation area's size. */
  private overlayFile: string | undefined;
  private overlayBuffer = 0;
  private overlaysLoaded: number[] = [];
  private overlayRetry = 0;
  /** Interrupt vectors a program has set. The others hold the addresses of
   * the BIOS and DOS handlers, which only compare and restore. */
  readonly vectors = new Map<number, number>();
  constructor(
    private host: Host,
    private disk: VirtualFileSystem,
    private programArguments: readonly string[] = []
  ) {
    this.files = new FileRuntime(host, disk, (value) => this.layoutOf(value));
    this.dos = new DosUnit(host, disk, this.files);
  }
  readonly dos: DosUnit;
  /** The characters of a null-terminated string. A nil PChar reads as empty. */
  private cString(address: number): string {
    let text = '';
    for (let at = address; address !== 0 && text.length < 65535; at++) {
      const value = this.host.read(at);
      const char =
        typeof value === 'string'
          ? value.charAt(0)
          : value
            ? String.fromCharCode(Number(value))
            : '';
      if (!char || char === '\0') break;
      text += char;
    }
    return text;
  }
  private putCString(address: number, text: string): void {
    if (!address) throw new PascalError('Nil pointer dereference');
    for (let index = 0; index < text.length; index++)
      this.host.write(address + index, defined(text[index]));
    this.host.write(address + text.length, '\0');
  }
  /** Turbo Pascal's Strings unit. Comparisons give the difference of the
   * first characters that differ, as it does. */
  private strings(index: number, args: StackValue[]): Result {
    const a = Number(args[0]),
      b = Number(args[1]),
      c = Number(args[2]);
    const compare = (x: string, y: string, limit = Infinity, fold = false) => {
      for (let at = 0; at < limit; at++) {
        let p = x.charCodeAt(at) || 0,
          q = y.charCodeAt(at) || 0;
        if (fold)
          [p, q] = [
            String.fromCharCode(p).toUpperCase().charCodeAt(0),
            String.fromCharCode(q).toUpperCase().charCodeAt(0),
          ];
        if (p !== q || !p) return p - q;
      }
      return 0;
    };
    const cased = (upper: boolean) => {
      const text = this.cString(a);
      this.putCString(
        a,
        text.replace(/[a-z]/gi, (char) => (upper ? char.toUpperCase() : char.toLowerCase()))
      );
      return { result: a };
    };
    switch (index) {
      case 350:
        return { result: this.cString(a).length };
      case 351:
        this.putCString(a, this.cString(b));
        return { result: a };
      case 352:
        this.putCString(a, this.cString(a) + this.cString(b));
        return { result: a };
      case 353:
        return { result: compare(this.cString(a), this.cString(b)) };
      case 354: {
        const at = this.cString(a).indexOf(this.cString(b));
        return { result: at < 0 ? 0 : a + at };
      }
      case 355:
        return cased(true);
      case 356:
        return cased(false);
      case 357:
        return { result: a + this.cString(a).length };
      case 358: {
        // A raw copy of Count characters, which may overlap.
        const cells = Array.from({ length: Math.max(0, c) }, (_, at) => this.host.read(b + at));
        for (const [at, cell] of cells.entries()) this.host.write(a + at, cell);
        return { result: a };
      }
      case 359: {
        const text = this.cString(b);
        this.putCString(a, text);
        return { result: a + text.length };
      }
      case 360:
        this.putCString(a, this.cString(b).slice(0, Math.max(0, c)));
        return { result: a };
      case 361:
        this.putCString(a, String(args[1] ?? ''));
        return { result: a };
      case 362:
        this.putCString(a, (this.cString(a) + this.cString(b)).slice(0, Math.max(0, c)));
        return { result: a };
      case 363:
        return { result: compare(this.cString(a), this.cString(b), Infinity, true) };
      case 364:
        return { result: compare(this.cString(a), this.cString(b), c) };
      case 365:
        return { result: compare(this.cString(a), this.cString(b), c, true) };
      case 366:
      case 367: {
        // The terminating null can be found too, as in Turbo Pascal.
        const text = this.cString(a) + '\0';
        const char = String(args[1] ?? '').charAt(0) || '\0';
        const at = index === 366 ? text.indexOf(char) : text.lastIndexOf(char);
        return { result: at < 0 ? 0 : a + at };
      }
      case 368:
        return { result: this.cString(a).slice(0, 255) };
      case 369: {
        const text = this.cString(a);
        if (!text) return { result: 0 };
        return { result: this.host.allocate(text.length + 1, [...text.split(''), '\0']) };
      }
      default:
        if (a) this.host.free(a);
        return {};
    }
  }
  reset(): void {
    this.console.reset();
    this.graphics.reset();
    this.graph3.reset();
    this.files.reset();
    this.dos.reset();
    this.clockOffset = 0;
    this.overlayFile = undefined;
    this.overlayBuffer = 0;
    this.overlaysLoaded = [];
    this.overlayRetry = 0;
    this.vectors.clear();
    this.host.sound(0);
  }
  /** A heap block's type: `count` of a type, by its layout and map, then
   * `rest` bytes. */
  private blockType(
    layout: number,
    map: number,
    refresh: number,
    variants: StackValue | undefined,
    count: number,
    rest: number,
    unitBytes = 0,
    unitCells = 0
  ): BlockType {
    const cells = this.host.layout?.(layout) ?? [],
      shape = this.host.viewMap?.(map);
    const parts = refresh >= 0 ? (this.host.refreshes?.(refresh) ?? []) : [];
    const ranges = typeof variants === 'string' ? (JSON.parse(variants) as [number, number][]) : [];
    if (count === 1 && rest === 0 && shape)
      return { layout: cells, shape, refresh: parts, variantCells: ranges };
    const repeated: BinaryCell[] = [];
    for (let index = 0; index < count; index++)
      cells.forEach((cell, at) =>
        repeated.push({ ...cell, offset: index * unitCells + (cell.offset ?? at) })
      );
    for (let index = 0; index < rest; index++)
      repeated.push({ ...BYTE_CELL, offset: count * unitCells + index });
    const byte: ViewShape = { kind: 'cell', cell: BYTE_CELL };
    return {
      layout: repeated,
      shape: {
        kind: 'record',
        fields: [
          ...(count && shape
            ? [
                {
                  offset: 0,
                  cells: count * unitCells,
                  byte: 0,
                  shape: {
                    kind: 'array' as const,
                    count,
                    cells: unitCells,
                    bytes: unitBytes,
                    element: shape,
                  },
                },
              ]
            : []),
          ...(rest
            ? [
                {
                  offset: count * unitCells,
                  cells: rest,
                  byte: count * unitBytes,
                  shape: { kind: 'array' as const, count: rest, cells: 1, bytes: 1, element: byte },
                },
              ]
            : []),
        ],
      },
      refresh: Array.from({ length: count }, (_, index) =>
        parts.map((part) => ({ part: part.part, offset: part.offset + index * unitCells }))
      ).flat(),
      variantCells: Array.from({ length: count }, (_, index) =>
        ranges.map(([from, to]): [number, number] => [
          from + index * unitCells,
          to + index * unitCells,
        ])
      ).flat(),
    };
  }
  /** Bytes at an address, as far as they reach. */
  private reach(address: number, layout: BinaryCell[]): number {
    return (
      this.host.reach?.(address, layout) ?? layout.reduce((size, cell) => size + cell.bytes, 0)
    );
  }
  private bytesAt(address: number, layout: BinaryCell[], length: number): Uint8Array {
    if (this.host.bytesAt) return this.host.bytesAt(address, layout, length);
    return encodeBinary(this.host, address, layout).subarray(0, length);
  }
  private putBytes(address: number, layout: BinaryCell[], bytes: Uint8Array): void {
    if (this.host.putBytes) {
      this.host.putBytes(address, layout, bytes);
      return;
    }
    const target = encodeBinary(this.host, address, layout);
    target.set(bytes.subarray(0, target.length));
    decodeBinary(this.host, address, layout, target);
  }
  /** A byte layout: written out, or by its number. */
  layoutOf(value: StackValue | undefined): BinaryCell[] {
    if (typeof value === 'number') return this.host.layout?.(value) ?? [];
    return JSON.parse(String(value ?? '[]')) as BinaryCell[];
  }
  invoke(index: number, args: StackValue[], ioChecking = true): Result | undefined {
    const a = Number(args[0]),
      b = Number(args[1]),
      c = Number(args[2]),
      d = Number(args[3]);
    const readString = (address: number) => String(this.host.read(address) ?? '');
    switch (index) {
      // New: the type's cells, bytes and layout, so a pointer of another
      // type sees the block's bytes.
      case 4: {
        const defaults = typeof args[2] === 'string' ? (JSON.parse(args[2]) as StackValue[]) : [];
        const [bytes = b, layout, map, refresh = -1] = args.slice(3, 7).map(Number);
        const type =
          layout === undefined || map === undefined
            ? undefined
            : this.blockType(layout, map, refresh, args[7], 1, 0);
        this.host.write(
          a,
          this.host.allocate(
            b,
            defaults,
            bytes,
            type && map !== undefined ? { ...type, map } : type
          )
        );
        return {};
      }
      case 5:
        this.host.free(Number(this.host.read(a)));
        this.host.write(a, 0);
        return {};
      // FillChar and Move work on the variables' bytes, in the layout their
      // types give, so a cell holding a word changes byte by byte.
      // A count past the variable runs on into what follows it in memory.
      case 60: {
        const layout = this.layoutOf(args[3]);
        const count = Math.max(0, Math.min(b, this.reach(a, layout)));
        this.putBytes(
          a,
          layout,
          new Uint8Array(count).fill(typeof args[2] === 'string' ? args[2].charCodeAt(0) : c & 255)
        );
        return {};
      }
      case 61: {
        const source = this.layoutOf(args[3]),
          target = this.layoutOf(args[4]);
        const count = Math.max(0, Math.min(c, this.reach(a, source), this.reach(b, target)));
        this.putBytes(b, target, this.bytesAt(a, source, count));
        return {};
      }
      case 63:
        return { result: (a >> 8) & 255 };
      case 64:
        return { result: a & 255 };
      case 65:
        return { result: ((a & 255) << 8) | ((a >> 8) & 255) };
      // GetMem: as many bytes as asked for, which hold as many of the
      // pointer's type (or of an array's element) as fit, then bytes.
      case 84: {
        const unit = typeof args[2] === 'string' ? (JSON.parse(args[2]) as StackValue[]) : [];
        const [layout, map, unitBytes = 0, unitCells = 0, refresh = -1] = args
          .slice(3, 8)
          .map(Number);
        if (!Number.isInteger(b) || b < 0) throw new PascalError('Invalid allocation size');
        if (layout === undefined || map === undefined) {
          this.host.write(a, this.host.allocate(Math.max(1, b, unit.length), unit));
          return {};
        }
        const count = unitBytes > 0 ? Math.floor(b / unitBytes) : 0,
          rest = b - count * unitBytes;
        const type = this.blockType(
          layout,
          map,
          refresh,
          args[8],
          count,
          rest,
          unitBytes,
          unitCells
        );
        const defaults = Array.from({ length: count }, () => unit).flat();
        this.host.write(
          a,
          this.host.allocate(
            Math.max(1, count * unitCells + rest),
            defaults,
            b,
            count === 1 && rest === 0 ? { ...type, map } : type
          )
        );
        return {};
      }
      case 85:
        this.host.free(Number(this.host.read(a)));
        return {};
      case 86:
        return { result: this.host.heapAvailable().total };
      case 87:
        return { result: this.host.heapAvailable().largest };
      case 88:
        throw new PascalError(`Run-time error ${String(args.length ? a : 0)}`);
      case 42:
        return { result: this.host.pointer?.(a, b) ?? a * 16 + b };
      case 91:
        return { result: this.host.segmentOf?.(a).segment ?? 0 };
      case 92:
        return { result: this.host.segmentOf?.(a).offset ?? a };
      case 600:
        return { result: CODE_SEGMENT };
      case 601:
        return { result: DATA_SEGMENT };
      case 602:
        return { result: STACK_SEGMENT };
      case 93:
        return { result: this.host.stackPointer() };
      // Turbo Pascal's own generator: RandSeed carries the sequence, so a
      // program that sets it gets the same numbers again.
      case 51: {
        const seedAddress = Number(args[args.length - 1]);
        const seed = (Math.imul(Number(this.host.read(seedAddress)), 134775813) + 1) | 0;
        this.host.write(seedAddress, seed);
        const fraction = (seed >>> 0) / 2 ** 32;
        if (args.length < 2) return { result: fraction };
        const range = a;
        if (!Number.isInteger(range) || range < 0) throw new PascalError('Invalid random range');
        return { result: Math.floor(fraction * range) };
      }
      case 52:
        this.host.write(Number(args[0]), (Date.now() & 0xffffffff) | 0);
        return {};
      case 95:
        this.host.write(a, this.host.heapTop());
        return {};
      case 96:
        this.host.releaseHeap(Number(this.host.read(a)));
        return {};
      case 89:
        return { result: this.programArguments.length };
      case 90:
        return { result: a === 0 ? String(args[1]) : (this.programArguments[a - 1] ?? '') };
      case 34: {
        const text = readString(a);
        if (b >= 1 && c > 0) this.host.write(a, text.slice(0, b - 1) + text.slice(b - 1 + c));
        return {};
      }
      case 35: {
        const text = readString(b),
          at = Math.max(0, Math.min(text.length, c - 1));
        this.host.write(
          b,
          (text.slice(0, at) + String(args[0]) + text.slice(at)).slice(0, Number(args[3] ?? 255))
        );
        return {};
      }
      case 36:
        this.host.write(b, String(args[0]).slice(0, Number(args[2] ?? 255)));
        return {};
      case 37: {
        const text = String(args[0]),
          type = d as TypeCode;
        const pattern =
          type === TypeCode.I
            ? /^[+-]?(?:\d+|\$[\da-f]+)$/i
            : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
        let value = Number(text);
        if (/^[+-]?\$[\da-f]+$/i.test(text))
          value = (text.startsWith('-') ? -1 : 1) * parseInt(text.replace(/^[+-]?\$/, ''), 16);
        let code = 0;
        if (!pattern.test(text) || !Number.isFinite(value)) {
          const prefix = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(text)?.[0] ?? '';
          code = Math.max(1, Math.min(text.length, prefix.length + 1));
        } else if (
          type === TypeCode.I &&
          (!Number.isInteger(value) ||
            value < Number(args[4] ?? -2147483648) ||
            value > Number(args[5] ?? 2147483647))
        )
          code = Math.max(1, text.length);
        let real: StackValue = value;
        if (code === 0 && type === TypeCode.R) {
          // Read exactly, then rounded to the variable's type: Real, Single,
          // Double, Extended, or Comp (9).
          try {
            const exact = parseReal(text) ?? value,
              precision = Number(args[4] ?? 6);
            real =
              precision === 6
                ? roundReal48(Number(exact))
                : precision === 4
                  ? Math.fround(Number(exact))
                  : precision === 8
                    ? Number(exact)
                    : precision === 9
                      ? compReal(exact)
                      : exact;
          } catch {
            code = Math.max(1, text.length);
          }
        }
        if (code === 0) this.host.write(b, type === TypeCode.R ? real : value);
        this.host.write(c, code);
        return {};
      }
      case 101:
        this.console.clearEol();
        return {};
      case 102:
        this.console.goto(a, b);
        return {};
      case 103:
        return { result: this.console.x };
      case 104:
        return { result: this.console.y };
      case 105:
        this.console.window(a, b, c, d);
        return {};
      case 106:
        this.console.insertLine();
        return {};
      case 107:
        this.console.deleteLine();
        return {};
      case 110:
        this.console.attribute = (this.console.attribute & 0x70) | (a & 0x8f);
        this.console.touch();
        return {};
      case 111:
        this.console.attribute = (this.console.attribute & 0x8f) | ((a & 7) << 4);
        this.console.touch();
        return {};
      case 112:
        this.console.attribute |= 8;
        this.console.touch();
        return {};
      case 113:
        this.console.attribute &= ~8;
        this.console.touch();
        return {};
      case 114:
        this.console.attribute = 7;
        this.console.touch();
        return {};
      case 115:
        // TextMode also ends Turbo Pascal 3's graphics.
        this.graph3.leave();
        this.console.mode(a);
        return {};
      case 130:
        this.host.sound(Math.max(0, a));
        return {};
      case 131:
        this.host.sound(0);
        return {};
      case 132:
        return { delay: Math.max(0, a) };
      case 308:
        if (b === 0xf000_0000 + (a & 255)) this.vectors.delete(a & 255);
        else this.vectors.set(a & 255, b);
        return {};
      case 309:
        this.host.write(b, this.vectors.get(a & 255) ?? 0xf000_0000 + (a & 255));
        return {};
      // The Overlay unit. Each procedure gives what OvrResult becomes:
      // ovrOk, ovrError (-1), ovrNotFound (-2) or ovrNoEMSDriver (-5).
      case 450:
        return { result: this.overlayInit(String(args[0] ?? '')) };
      case 451:
        // There is no EMS driver to load the overlays into.
        return { result: this.overlayFile === undefined ? -1 : -5 };
      case 452: {
        // At least the largest overlay, and set before the heap is used.
        const smallest = Math.max(0, ...this.overlays.map(overlaySize));
        if (this.overlayFile === undefined || a < smallest || this.host.heapEmpty?.() === false)
          return { result: -1 };
        this.overlayBuffer = a;
        return { result: 0 };
      }
      case 453:
        return { result: this.overlayBuffer };
      case 454:
        if (this.overlayFile === undefined) return { result: -1 };
        this.overlayRetry = Math.max(0, a);
        return { result: 0 };
      case 455:
        return { result: this.overlayRetry };
      case 456:
        if (this.overlayFile === undefined) return { result: -1 };
        this.overlaysLoaded = [];
        return { result: 0 };
      // Turbo3: the heap in 16-byte paragraphs, and Turbo Pascal 3's video
      // attributes, yellow and light gray on black.
      case 461:
        return { result: Math.floor(this.host.heapAvailable().total / 16) };
      case 462:
        return { result: Math.floor(this.host.heapAvailable().largest / 16) };
      case 466:
      case 467:
      case 468:
        this.console.attribute = index === 468 ? 0x07 : 0x0e;
        this.console.touch();
        return {};
      case 140:
        this.console.cursorVisible = false;
        this.console.touch();
        return {};
      case 141:
        this.console.cursorVisible = true;
        this.console.touch();
        return {};
    }
    if (index >= 200 && index < 300) return this.graph(index, args);
    if (index >= 300 && index <= 307) {
      const date = new Date(Date.now() + this.clockOffset);
      switch (index) {
        case 300:
          [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getDay()].forEach(
            (value, i) => {
              this.host.write(Number(args[i]), value);
            }
          );
          return {};
        case 301:
          [
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            Math.floor(date.getMilliseconds() / 10),
          ].forEach((value, i) => {
            this.host.write(Number(args[i]), value);
          });
          return {};
        case 302: {
          if (a < 1980 || a > 2099 || b < 1 || b > 12 || c < 1 || c > new Date(a, b, 0).getDate())
            return {};
          date.setFullYear(a, b - 1, c);
          this.clockOffset = date.getTime() - Date.now();
          return {};
        }
        case 303: {
          if (a < 0 || a > 23 || b < 0 || b > 59 || c < 0 || c > 59 || d < 0 || d > 99) return {};
          date.setHours(a, b, c, d * 10);
          this.clockOffset = date.getTime() - Date.now();
          return {};
        }
        case 304:
          return {
            result: ENVIRONMENT.find(([name]) => name === String(args[0]).toUpperCase())?.[1] ?? '',
          };
        case 305:
          return { result: 0x1606 };
        case 306:
          return { result: this.disk.capacity - this.disk.used };
        case 307:
          return { result: this.disk.capacity };
      }
    }
    if (index >= 310 && index <= 333) return this.dos.invoke(index, args);
    if (index >= 350 && index <= 370) return this.strings(index, args);
    if (index >= 500 && index < 550) return this.turbo3Graphics(index, args);
    return this.files.invoke(index, args, ioChecking);
  }
  /** The Graph3 unit. */
  private turbo3Graphics(index: number, args: StackValue[]): Result {
    const g = this.graph3,
      [a = 0, b = 0, c = 0, d = 0, e = 0] = args.map(Number);
    const bytes = (address: number, layout: StackValue | undefined) =>
      encodeBinary(this.host, address, JSON.parse(String(layout)) as BinaryCell[]);
    const turtle = (action: () => void): Result => {
      action();
      return g.delay > 0 ? { delay: g.delay } : {};
    };
    switch (index) {
      case 500:
        g.setMode('mono');
        return {};
      case 501:
        g.setMode('color');
        return {};
      case 502:
        g.setMode('hires');
        return {};
      case 503:
        g.setHiResColor(a);
        return {};
      case 504:
        g.palette(a);
        return {};
      case 505:
        g.graphBackground(a);
        return {};
      case 506:
        g.graphWindow(a, b, c, d);
        return {};
      case 507:
        g.plot(a, b, c);
        return {};
      case 508:
        g.draw(a, b, c, d, e);
        return {};
      case 509:
        g.colorTable([a, b, c, d]);
        return {};
      case 510:
        g.arc(a, b, c, d, e);
        return {};
      case 511:
        g.circle(a, b, c, d);
        return {};
      case 512: {
        // GetPic fills as much of the buffer variable as it holds.
        const layout = JSON.parse(String(args[5])) as BinaryCell[];
        const target = encodeBinary(this.host, a, layout);
        const picture = g.getPic(b, c, d, e);
        target.set(picture.subarray(0, target.length));
        decodeBinary(this.host, a, layout, target);
        return {};
      }
      case 513:
        g.putPic(bytes(a, args[3]), b, c);
        return {};
      case 514:
        return { result: g.getDotColor(a, b) };
      case 515:
        g.fillScreen(a);
        return {};
      case 516:
        g.fillShape(a, b, c, d);
        return {};
      case 517:
        g.fillPattern(a, b, c, d, e);
        return {};
      case 518:
        g.pattern(bytes(a, args[1]));
        return {};
      case 520:
        return turtle(() => {
          g.forward(-a);
        });
      case 521:
        g.clearScreen();
        return {};
      case 522:
        return turtle(() => {
          g.forward(a);
        });
      case 523:
        return { result: g.heading };
      case 524:
        g.setVisible(false);
        return {};
      case 525:
        return turtle(() => {
          g.home();
        });
      case 526:
        g.setWrap(false);
        return {};
      case 527:
        g.setPen(true);
        return {};
      case 528:
        g.setPen(false);
        return {};
      case 529:
        return turtle(() => {
          g.setHeading(a);
        });
      case 530:
        g.setPenColor(a);
        return {};
      case 531:
        return turtle(() => {
          g.setPosition(a, b);
        });
      case 532:
        g.setVisible(true);
        return {};
      case 533:
        return turtle(() => {
          g.turn(-a);
        });
      case 534:
        return turtle(() => {
          g.turn(a);
        });
      case 535:
        g.delay = Math.max(0, a);
        return {};
      case 536:
        return { result: g.turtleThere ? 1 : 0 };
      case 537:
        g.turtleWindow(a, b, c, d);
        return {};
      case 538:
        g.setWrap(true);
        return {};
      case 539:
        return { result: g.xcor };
      case 540:
        return { result: g.ycor };
    }
    throw new PascalError('Unknown Graph3 routine');
  }
  /** OvrInit: opens the overlay file, which must hold this program's
   * overlays, and gives the buffer room for the largest. */
  private overlayInit(name: string): number {
    this.overlayFile = undefined;
    this.overlaysLoaded = [];
    const path = name.trim();
    if (!path || !this.disk.exists(path)) return -2;
    if (!this.overlayFileMatches(path)) return -1;
    this.overlayFile = path;
    this.overlayBuffer = Math.max(0, ...this.overlays.map(overlaySize));
    return 0;
  }
  /** Whether a file holds this program's overlays, every one as compiled. */
  private overlayFileMatches(path: string, only?: number): boolean {
    if (!this.disk.exists(path)) return false;
    const units = decodeOverlayFile(this.fileBytes(path));
    if (!units || units.length !== this.overlays.length) return false;
    return this.overlays.every(
      (unit, index) =>
        (only !== undefined && index !== only) ||
        (units[index]?.name === unit.name &&
          units[index].code.length === unit.code.length &&
          units[index].code.every((word, at) => word === unit.code[at]))
    );
  }
  /** An overlaid unit's code is entered: it must be in the buffer, or be
   * read into it from the file, pushing out the least recently used. */
  enterOverlay(index: number): void {
    if (this.overlayFile === undefined) throw new PascalError('Overlay manager not installed');
    const loaded = this.overlaysLoaded.indexOf(index);
    if (loaded >= 0) {
      this.overlaysLoaded.splice(loaded, 1);
      this.overlaysLoaded.push(index);
      return;
    }
    if (!this.overlayFileMatches(this.overlayFile, index))
      throw new PascalError('Overlay file read error');
    this.overlaysLoaded.push(index);
    const size = (at: number) => overlaySize(this.overlays[at] ?? { name: '', code: [] });
    let used = this.overlaysLoaded.reduce((total, at) => total + size(at), 0);
    while (used > this.overlayBuffer && this.overlaysLoaded.length > 1) {
      used -= size(this.overlaysLoaded.shift() ?? index);
    }
  }
  /** A file on the drive: in the directory InitGraph was given, or else the
   * current one, as the Graph unit looks for drivers and fonts. */
  private find(name: string): string | undefined {
    const candidates = this.fontPath ? [this.fontPath + '/' + name, name] : [name];
    return candidates.find((path) => this.disk.exists(path));
  }
  private fileBytes(path: string): Uint8Array {
    return Uint8Array.from(this.disk.read(path), (char) => char.charCodeAt(0));
  }
  /** InitGraph: the driver asked for, or the one DetectGraph would pick, from
   * a driver RegisterBGIdriver took or its .BGI file. The emulated VGA is
   * EGAVGA's hardware, which, with no file, is taken as linked in. */
  private initGraph(driverAddress: number, modeAddress: number): void {
    const g = this.graphics;
    let driver = Number(this.host.read(driverAddress));
    let mode = Number(this.host.read(modeAddress));
    if (driver === 0) [driver, mode] = [9, 2];
    const name = driver >= 11 ? this.userDrivers[driver - 11] : STANDARD_DRIVERS[driver];
    const fail = (code: number) => {
      g.detach();
      g.initialized = false;
      g.result = code;
      g.revision++;
    };
    if (name === undefined) {
      fail(-4);
      return;
    }
    let code = this.registeredDrivers.get(name);
    if (!code) {
      const path = this.find(name + '.BGI');
      if (path) {
        const bytes = this.fileBytes(path);
        const header = parseBgiDriver(bytes);
        if (header?.name !== name) {
          fail(-4);
          return;
        }
        code = bytes.subarray(header.headerSize, header.headerSize + header.codeSize);
      }
    }
    if (name === 'EGAVGA' || name === 'CGA') {
      // The P-machine's own VGA, in the modes of the CGA, MCGA, EGA and VGA
      // that Borland's CGA and EGAVGA drivers use, with or without the file.
      g.detach();
      this.loadedDriver = undefined;
      g.init(driver, mode);
      if (!g.initialized) return;
    } else {
      // Any other driver's code runs, on the emulated PC.
      if (!code) {
        fail(-3);
        return;
      }
      if (!this.openDriver(code, driver, mode)) return;
    }
    this.driverName = name;
    this.host.write(driverAddress, g.driver);
    this.host.write(modeAddress, g.mode);
  }
  /** Loads a driver's code and switches it to a mode; false, with GraphResult
   * set, when it refuses. */
  private openDriver(code: Uint8Array, driver: number, mode: number): boolean {
    const g = this.graphics;
    const host = this.host;
    try {
      const backend = BgiDriverBackend.open(code, mode, {
        read: (linear) => host.readLinear?.(linear, 1)[0] ?? 0,
        write: (linear, value) => {
          host.writeLinear?.(linear, Uint8Array.of(value));
        },
      });
      g.attach(backend, driver, mode);
      this.loadedDriver = { code, number: driver };
      return true;
    } catch (error) {
      if (!(error instanceof DriverRefused)) throw error;
      g.detach();
      g.initialized = false;
      g.result = error.code;
      g.revision++;
      return false;
    }
  }
  /** The routines that install and register drivers and fonts, and describe
   * the driver's modes. */
  private driversAndFonts(index: number, args: StackValue[]): Result | undefined {
    const g = this.graphics;
    const [a = 0, b = 0, c = 0] = args.map(Number);
    const baseName = (text: StackValue | undefined) =>
      String(text ?? '')
        .trim()
        .toUpperCase()
        .replace(/^.*[\\/:]/, '')
        .replace(/\.[^.]*$/, '');
    const failed = (code: number) => {
      g.result = code;
      return { result: code };
    };
    switch (index) {
      case 208:
        if (g.initialized) g.defaults();
        return {};
      case 209:
        return {};
      case 292: {
        const name = baseName(args[0]);
        const standard = STANDARD_DRIVERS.indexOf(name);
        if (standard > 0) return { result: standard };
        const known = this.userDrivers.indexOf(name);
        if (known >= 0) return { result: 11 + known };
        if (this.userDrivers.length >= 10) return failed(-11);
        this.userDrivers.push(name);
        return { result: 10 + this.userDrivers.length };
      }
      case 293: {
        if (!a) return failed(-4);
        const header = parseBgiDriver(this.bytesAt(a, [], BGI_HEADER_BYTES));
        if (!header) return failed(-4);
        const standard = STANDARD_DRIVERS.indexOf(header.name);
        const user = this.userDrivers.indexOf(header.name);
        if (standard <= 0 && user < 0) return failed(-4);
        const image = this.bytesAt(a, [], header.headerSize + header.codeSize);
        this.registeredDrivers.set(header.name, image.slice(header.headerSize));
        return { result: standard > 0 ? standard : 11 + user };
      }
      case 294: {
        const name = baseName(args[0]);
        const standard = STANDARD_FONTS.indexOf(name);
        if (standard > 0) return { result: standard };
        const known = this.userFonts.indexOf(name);
        if (known >= 0) return { result: 11 + known };
        if (this.userFonts.length >= 10) return failed(-11);
        this.userFonts.push(name);
        return { result: 10 + this.userFonts.length };
      }
      case 295: {
        if (!a) return failed(-13);
        // The font's header gives its size: the header's, then the strokes'.
        const head = this.bytesAt(a, [], 0x80);
        const marker = head.indexOf(0x1a);
        const word = (at: number) => (head[at] ?? 0) | ((head[at + 1] ?? 0) << 8);
        if (head[0] !== 0x50 || head[1] !== 0x4b || marker < 0) return failed(-13);
        const fontName = String.fromCharCode(
          ...head.subarray(marker + 3, marker + 7)
        ).toUpperCase();
        let font: StrokeFont;
        try {
          font = parseStrokeFont(this.bytesAt(a, [], word(marker + 1) + word(marker + 7)));
        } catch {
          return failed(-13);
        }
        const standard = STANDARD_FONTS.indexOf(fontName);
        const user = this.userFonts.indexOf(fontName);
        const number = standard > 0 ? standard : user >= 0 ? 11 + user : -1;
        if (number < 0) return failed(-14);
        this.registeredFonts.set(number, font);
        return { result: number };
      }
      case 296:
        return { result: this.driverName };
      case 297:
        return {
          result: g.external
            ? g.external.nameOfMode(a)
            : (BUILT_IN_MODES[g.driver]?.[a]?.name ?? ''),
        };
      case 298: {
        if (g.external) return { result: g.external.modeCount - 1 };
        return {
          result: Math.max(...Object.keys(BUILT_IN_MODES[g.driver] ?? { 0: 0 }).map(Number)),
        };
      }
      case 299: {
        const loaded = this.loadedDriver?.number === a ? g.external : null;
        const [low, high] = loaded ? [0, loaded.modeCount - 1] : (MODE_RANGES[a] ?? [-1, -1]);
        this.host.write(b, low);
        this.host.write(c, high);
        return {};
      }
    }
    return undefined;
  }
  private graph(index: number, args: StackValue[]): Result | undefined {
    const g = this.graphics,
      [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args.map(Number);
    if (index === 200) {
      this.fontPath = String(args[2] ?? '').replace(/[\\/]+$/, '');
      this.initGraph(a, b);
      return {};
    }
    const driverOrFont = this.driversAndFonts(index, args);
    if (driverOrFont) return driverOrFont;
    if (index === 201 || index === 207) {
      g.detach();
      g.initialized = false;
      g.revision++;
      return {};
    }
    if (index === 202) {
      this.host.write(a, 9);
      this.host.write(b, 2);
      return {};
    }
    if (index === 205) {
      const result = g.result;
      g.result = 0;
      return { result };
    }
    if (index === 206)
      return {
        result:
          (
            {
              0: 'No error',
              '-1': 'Graphics not initialized',
              '-2': 'Graphics hardware not detected',
              '-3': 'Device driver file not found',
              '-4': 'Invalid graphics driver',
              '-5': 'Not enough memory to load driver',
              '-8': 'Font file not found',
              '-9': 'Not enough memory to load font',
              '-10': 'Invalid graphics mode',
              '-11': 'Graphics error',
              '-12': 'Graphics I/O error',
              '-13': 'Invalid font file',
              '-14': 'Invalid font number',
              '-15': 'Invalid device number',
              '-18': 'Invalid version number',
            } as Record<number, string>
          )[a] ?? `Graphics error ${String(a)}`,
      };
    if (!g.initialized)
      throw new PascalError('BGI Error: Graphics not initialized (use InitGraph)');
    switch (index) {
      case 203:
        return { result: g.mode };
      case 204:
        if (g.external && this.loadedDriver)
          this.openDriver(this.loadedDriver.code, this.loadedDriver.number, a);
        else g.init(g.driver, a);
        return {};
      case 210:
        g.color = a & g.maxColor();
        return {};
      case 211:
        return { result: g.color };
      // Any of the sixteen colours, which CGA's colour 0 shows.
      case 212:
        g.background = a & (g.external ? g.maxColor() : 15);
        return {};
      case 213:
        return { result: g.background };
      case 214:
        return { result: g.maxColor() };
      case 220:
        g.pixel(a, b, c);
        return {};
      case 221:
        return { result: g.getPixel(a, b) };
      case 222:
        g.drawLine(a, b, c, d);
        return {};
      case 223:
        g.drawLine(g.x, g.y, a, b);
        g.x = a;
        g.y = b;
        return {};
      case 224:
        g.drawLine(g.x, g.y, g.x + a, g.y + b);
        g.x += a;
        g.y += b;
        return {};
      case 225:
        g.x = a;
        g.y = b;
        return {};
      case 226:
        g.x += a;
        g.y += b;
        return {};
      case 227:
        g.rectangle(a, b, c, d, g.writeMode === 1);
        return {};
      case 228:
        g.bar(a, b, c, d);
        return {};
      case 229:
        g.bar(a, b, c, d);
        g.rectangle(a, b, c, d);
        g.line(c, b, c + e, b - e);
        g.line(c, d, c + e, d - e);
        g.line(c + e, b - e, c + e, d - e);
        if (f) {
          g.line(a, b, a + e, b - e);
          g.line(a + e, b - e, c + e, b - e);
        }
        return {};
      // A circle's height is its radius in the aspect ratio.
      case 230:
        g.ellipse(a, b, 0, 360, c, g.circleHeight(c));
        return {};
      case 231:
        g.ellipse(a, b, c, d, e, g.circleHeight(e));
        return {};
      case 232:
        g.ellipse(a, b, c, d, e, f);
        return {};
      case 233:
        g.ellipse(a, b, 0, 360, c, d, true);
        return {};
      case 234:
        g.ellipse(a, b, c, d, e, f, true, true);
        return {};
      case 235:
        g.ellipse(a, b, c, d, e, g.circleHeight(e), true, true);
        return {};
      case 240:
        g.flood(a, b, c);
        return {};
      case 241:
        g.fillPattern = a;
        g.fillColor = b & g.maxColor();
        return {};
      case 250:
        g.lineStyle = a >= 0 && a <= 4 ? a : 0;
        g.linePattern = [0xffff, 0xcccc, 0xfc78, 0xf8f8, b][a] ?? 0xffff;
        g.thickness = c === 3 ? 3 : 1;
        return {};
      case 260:
        g.text(String(args[0]));
        if (g.direction === 0) g.x += g.textWidth(String(args[0]));
        return {};
      case 261:
        g.text(String(args[2]), a, b);
        return {};
      case 262: {
        if (b < 0 || b > 1 || c < 0 || c > 10) {
          g.result = -11;
          return {};
        }
        // The ten fonts Turbo Pascal knows, then those InstallUserFont added.
        if (a < 0 || a > 10 + this.userFonts.length) {
          g.result = -14;
          return {};
        }
        if (a !== 0) {
          const registered = this.registeredFonts.get(a);
          if (registered) g.strokeFont = registered;
          else {
            const name = (STANDARD_FONTS[a] ?? this.userFonts[a - 11] ?? '') + '.CHR';
            const path = this.find(name);
            // With no file, a standard font's Hershey stand-in, as if linked in.
            const builtIn = path ? undefined : hersheyFont(STANDARD_FONTS[a] ?? '');
            if (builtIn) g.strokeFont = builtIn;
            else if (!path) {
              g.result = -8;
              return {};
            } else
              try {
                g.strokeFont = parseStrokeFont(this.fileBytes(path));
              } catch {
                g.result = -13;
                return {};
              }
          }
        }
        g.font = a;
        g.direction = b;
        g.charSize = a === 0 ? Math.max(1, c) : c;
        return {};
      }
      case 265:
        if (b <= 0 || d <= 0) {
          g.result = -11;
          return {};
        }
        g.customScale = { x: a / b, y: c / d };
        return {};
      case 264:
        g.horizontalJustify = a;
        g.verticalJustify = b;
        return {};
      case 266:
        return { result: g.textWidth(String(args[0])) };
      case 267:
        return { result: g.textHeight() };
      case 270:
        g.view(a, b, c, d, Boolean(e));
        return {};
      case 272:
        g.clear();
        return {};
      case 273:
        g.clear(true);
        return {};
      case 274:
        return { result: g.width - 1 };
      case 275:
        return { result: g.height - 1 };
      case 276:
        return { result: g.x };
      case 277:
        return { result: g.y };
      default:
        return this.graphState(index, args);
    }
  }
  /** Graph's palettes, settings records, polygons, images, aspect ratio and
   * pages. A record or buffer argument comes as its address, then its
   * byte layout. */
  private graphState(index: number, args: StackValue[]): Result | undefined {
    const g = this.graphics,
      [a = 0, b = 0, c = 0, d = 0, e = 0] = args.map(Number);
    /** Fields in turn, each a value and its bytes, into a record. */
    const put = (address: number, layout: StackValue | undefined, fields: [number, number][]) => {
      const bytes = new Uint8Array(fields.reduce((size, [, width]) => size + width, 0));
      const view = new DataView(bytes.buffer);
      let at = 0;
      for (const [field, width] of fields) {
        if (width === 1) view.setUint8(at, field & 0xff);
        else view.setUint16(at, field & 0xffff, true);
        at += width;
      }
      this.putBytes(address, this.layoutOf(layout), bytes);
    };
    const bytes = (address: number, layout: StackValue | undefined, length: number) =>
      this.bytesAt(address, this.layoutOf(layout), length);
    /** A PaletteType: its size, then sixteen registers. */
    const palette = (address: number, layout: StackValue | undefined, colours: number[]) => {
      put(address, layout, [
        [Math.min(g.paletteSize(), 16), 1],
        ...colours.slice(0, 16).map((colour): [number, number] => [colour, 1]),
      ]);
    };
    /** DrawPoly's and FillPoly's points: pairs of Integers. */
    const points = (): [number, number][] => {
      const view = new DataView(bytes(b, args[2], a * 4).buffer);
      return Array.from({ length: Math.min(a, Math.floor(view.byteLength / 4)) }, (_, i) => [
        view.getInt16(i * 4, true),
        view.getInt16(i * 4 + 2, true),
      ]);
    };
    switch (index) {
      case 215:
        if (!g.setPalette(a, b)) g.result = -11;
        return {};
      case 216:
        palette(a, args[1], g.paletteColours());
        return {};
      case 217: {
        const view = bytes(a, args[1], 17);
        Array.from(view.subarray(1, 17)).forEach((colour, register) => {
          // An entry of -1 leaves its register as it is.
          if (register < (view[0] ?? 0) && colour !== 0xff) g.setPalette(register, colour);
        });
        return {};
      }
      case 218:
        palette(a, args[1], g.defaultPaletteColours());
        return {};
      case 219:
        return { result: g.paletteSize() };
      case 245:
        g.setRgb(a, b, c, d);
        return {};
      case 236:
        g.drawPoly(points());
        return {};
      case 237:
        g.fillPoly(points());
        return {};
      case 238: {
        const arc = g.arc;
        put(a, args[1], [
          [arc.x, 2],
          [arc.y, 2],
          [arc.xStart, 2],
          [arc.yStart, 2],
          [arc.xEnd, 2],
          [arc.yEnd, 2],
        ]);
        return {};
      }
      case 242:
        put(a, args[1], [
          [g.fillPattern, 2],
          [g.fillColor, 2],
        ]);
        return {};
      case 243:
        g.userFill = Array.from(bytes(a, args[1], 8));
        g.fillPattern = 12;
        g.fillColor = c & g.maxColor();
        return {};
      case 244:
        put(
          a,
          args[1],
          g.userFill.map((row): [number, number] => [row, 1])
        );
        return {};
      case 251:
        put(a, args[1], [
          [g.lineStyle, 2],
          [g.linePattern, 2],
          [g.thickness, 2],
        ]);
        return {};
      case 252:
        g.writeMode = a & 1;
        return {};
      case 263:
        put(a, args[1], [
          [g.font, 2],
          [g.direction, 2],
          [g.charSize, 2],
          [g.horizontalJustify, 2],
          [g.verticalJustify, 2],
        ]);
        return {};
      case 271: {
        const view = g.viewSettings();
        put(a, args[1], [
          [view.left, 2],
          [view.top, 2],
          [view.right, 2],
          [view.bottom, 2],
          [view.clip ? 1 : 0, 1],
        ]);
        return {};
      }
      case 280:
        this.putBytes(e, this.layoutOf(args[5]), g.getImage(a, b, c, d));
        return {};
      case 281: {
        const { size } = g.imageExtent(bytes(c, args[3], 4));
        g.putImage(a, b, bytes(c, args[3], size), Number(args[4]));
        return {};
      }
      case 282:
        return { result: g.imageSize(a, b, c, d) };
      case 290:
        g.aspect = { x: a, y: b };
        return {};
      case 291:
        this.host.write(a, g.aspect.x);
        this.host.write(b, g.aspect.y);
        return {};
      case 283:
        g.setPage(a, false);
        return {};
      case 284:
        g.setPage(a, true);
        return {};
      default:
        return undefined;
    }
  }
}
