import { PascalError } from '../errors/PascalError';

/** DOS's null device. DOS treats a device name as the device in any
 * directory and with any extension, so C:\TEMP\NUL.TXT is NUL too. */
const isNullDevice = (path: string) => /^NUL(?:\.[^/]*)?$/.test(path.split('/').at(-1) ?? '');

/** A time as DOS packs it: the date in the high word, the time in the low
 * one, to two seconds. */
export function packDosTime(date: Date): number {
  return (
    ((((date.getFullYear() - 1980) & 0x7f) << 25) |
      ((date.getMonth() + 1) << 21) |
      (date.getDate() << 16) |
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1)) >>>
    0
  );
}

/** DOS's file attributes. */
export const READ_ONLY = 0x01;
export const DIRECTORY = 0x10;
export const ARCHIVE = 0x20;

/** A program's DOS drive. It never accesses host files or host environment variables. */
export class VirtualFileSystem {
  readonly capacity = 8 * 1024 * 1024;
  private files = new Map<string, string>();
  /** When each file was last written, packed as DOS packs it. */
  private times = new Map<string, number>();
  /** Attributes a program set; others are just Archive. */
  private attributes = new Map<string, number>();
  /** The order entries were made in, which DOS lists them in. */
  private made = new Map<string, number>();
  /** Directories MkDir made; a file's path makes its own directories too. */
  private directories = new Set<string>();
  /** The current directory, which relative names start from; '' is the root. */
  private current = '';
  revision = 0;

  constructor(initial: Record<string, string> = {}) {
    for (const [name, content] of Object.entries(initial)) this.write(name, content);
  }
  /** A name as its key on the drive, from the root. */
  normalize(name: string): string {
    const path = this.resolve(name, '');
    if (!path) throw new PascalError('Invalid file name');
    return path;
  }
  /** A name a program gives, which starts from its current directory. */
  resolveName(name: string): string {
    const path = this.resolve(name, this.current);
    if (!path) throw new PascalError('Invalid file name');
    return path;
  }
  /** A name as a path from the root, where '' is the root itself. A relative
   * name starts from the given directory. */
  private resolve(name: string, from: string): string {
    const parts: string[] = [];
    const path = name.replace(/^[a-z]:/i, '').replaceAll('\\', '/');
    const whole = path.startsWith('/') || !from ? path : `${from}/${path}`;
    for (const part of whole.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part.toUpperCase());
    }
    return parts.join('/');
  }
  exists(name: string): boolean {
    const path = this.normalize(name);
    return isNullDevice(path) || this.files.has(path);
  }
  read(name: string): string {
    const path = this.normalize(name);
    if (isNullDevice(path)) return '';
    const value = this.files.get(path);
    if (value === undefined) throw new PascalError(`File not found: ${name}`);
    return value;
  }
  write(name: string, content: string): void {
    const path = this.normalize(name);
    if (isNullDevice(path)) return;
    if ((this.attributes.get(path) ?? 0) & READ_ONLY)
      throw new PascalError(`File access denied: ${name}`);
    if (this.used - (this.files.get(path)?.length ?? 0) + content.length > this.capacity)
      throw new PascalError('Disk full');
    if (!this.files.has(path)) this.made.set(path, this.made.size);
    this.files.set(path, content);
    this.times.set(path, packDosTime(new Date()));
    this.revision++;
  }
  remove(name: string): void {
    const path = this.normalize(name);
    if (isNullDevice(path) || (this.attributes.get(path) ?? 0) & READ_ONLY)
      throw new PascalError(`File access denied: ${name}`);
    if (!this.files.delete(path)) throw new PascalError(`File not found: ${name}`);
    this.times.delete(path);
    this.attributes.delete(path);
    this.revision++;
  }
  /** A file's attributes: Archive, and any a program set. */
  attributesOf(name: string): number {
    const path = this.normalize(name);
    if (this.files.has(path)) return this.attributes.get(path) ?? ARCHIVE;
    if (this.isDirectory(path)) return DIRECTORY;
    throw new PascalError(`File not found: ${name}`);
  }
  setAttributes(name: string, attributes: number): void {
    const path = this.normalize(name);
    if (!this.files.has(path)) throw new PascalError(`File not found: ${name}`);
    this.attributes.set(path, attributes & 0x27);
  }
  /** When a file was last written, packed; files the drive started with
   * count from when it did. */
  timeOf(name: string): number {
    const path = this.normalize(name);
    if (!this.files.has(path)) throw new PascalError(`File not found: ${name}`);
    return this.times.get(path) ?? packDosTime(new Date());
  }
  setTime(name: string, time: number): void {
    const path = this.normalize(name);
    if (!this.files.has(path)) throw new PascalError(`File not found: ${name}`);
    this.times.set(path, time >>> 0);
  }
  /** The files and directories directly in a directory, in the order they
   * were made, with DOS's names, sizes, times and attributes. */
  list(directory: string): { name: string; size: number; time: number; attributes: number }[] {
    const prefix = directory ? `${directory}/` : '';
    const entries = new Map<
      string,
      { name: string; size: number; time: number; attributes: number; order: number }
    >();
    for (const [path, content] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const [first, ...rest] = path.slice(prefix.length).split('/');
      if (!first) continue;
      if (rest.length) {
        if (!entries.has(first))
          entries.set(first, {
            name: first,
            size: 0,
            time: this.times.get(prefix + first) ?? this.times.get(path) ?? 0,
            attributes: DIRECTORY,
            order: this.made.get(prefix + first) ?? this.made.get(path) ?? 0,
          });
      } else
        entries.set(first, {
          name: first,
          size: content.length,
          time: this.times.get(path) ?? packDosTime(new Date()),
          attributes: this.attributes.get(path) ?? ARCHIVE,
          order: this.made.get(path) ?? 0,
        });
    }
    for (const path of this.directories) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
      const name = path.slice(prefix.length);
      if (name && !entries.has(name))
        entries.set(name, {
          name,
          size: 0,
          time: this.times.get(path) ?? 0,
          attributes: DIRECTORY,
          order: this.made.get(path) ?? 0,
        });
    }
    return [...entries.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...entry }) => entry);
  }
  /** A directory name a program gives, as a path from the root. */
  directoryPath(name: string): string {
    return this.resolve(name, this.current);
  }
  rename(from: string, to: string): void {
    if (isNullDevice(this.normalize(from)) || isNullDevice(this.normalize(to)))
      throw new PascalError(`File access denied: ${from}`);
    if (this.exists(to)) throw new PascalError(`File already exists: ${to}`);
    // A renamed file keeps its time and attributes, read-only or not.
    const source = this.normalize(from),
      target = this.normalize(to);
    const value = this.read(from);
    this.files.delete(source);
    this.files.set(target, value);
    for (const table of [this.times, this.attributes, this.made]) {
      const entry = table.get(source);
      table.delete(source);
      if (entry !== undefined) table.set(target, entry);
    }
    this.revision++;
  }
  /** Whether a path names a directory: the root, one MkDir made, or one a
   * file lies in. */
  isDirectory(path: string): boolean {
    if (!path) return true;
    if (this.directories.has(path)) return true;
    const prefix = `${path}/`;
    return [...this.files.keys()].some((file) => file.startsWith(prefix));
  }
  makeDirectory(name: string): void {
    const path = this.resolveName(name);
    const parent = path.split('/').slice(0, -1).join('/');
    if (!this.isDirectory(parent)) throw new PascalError(`Path not found: ${name}`);
    if (this.isDirectory(path) || this.files.has(path))
      throw new PascalError(`File access denied: ${name}`);
    this.directories.add(path);
    this.made.set(path, this.made.size);
    this.times.set(path, packDosTime(new Date()));
    this.revision++;
  }
  changeDirectory(name: string): void {
    const path = this.resolve(name, this.current);
    if (!this.isDirectory(path)) throw new PascalError(`Path not found: ${name}`);
    this.current = path;
  }
  removeDirectory(name: string): void {
    const path = this.resolveName(name);
    if (!this.directories.has(path) && !this.isDirectory(path))
      throw new PascalError(`Path not found: ${name}`);
    // DOS refuses a directory that holds files, or the current one.
    if (path === this.current || [...this.files.keys()].some((file) => file.startsWith(`${path}/`)))
      throw new PascalError(`File access denied: ${name}`);
    this.directories.delete(path);
    this.revision++;
  }
  /** The current directory as DOS names it, such as C:\\SUB. */
  get currentDirectory(): string {
    return `C:\\${this.current.replaceAll('/', '\\')}`;
  }
  get used(): number {
    return [...this.files.values()].reduce((sum, file) => sum + file.length, 0);
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
