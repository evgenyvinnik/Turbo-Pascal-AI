import { PascalError } from '../errors/PascalError';

/** DOS's null device. DOS treats a device name as the device in any
 * directory and with any extension, so C:\TEMP\NUL.TXT is NUL too. */
const isNullDevice = (path: string) => /^NUL(?:\.[^/]*)?$/.test(path.split('/').at(-1) ?? '');

/** A program's DOS drive. It never accesses host files or host environment variables. */
export class VirtualFileSystem {
  readonly capacity = 8 * 1024 * 1024;
  private files = new Map<string, string>();
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
    if (this.used - (this.files.get(path)?.length ?? 0) + content.length > this.capacity)
      throw new PascalError('Disk full');
    this.files.set(path, content);
    this.revision++;
  }
  remove(name: string): void {
    if (isNullDevice(this.normalize(name))) throw new PascalError(`File access denied: ${name}`);
    if (!this.files.delete(this.normalize(name))) throw new PascalError(`File not found: ${name}`);
    this.revision++;
  }
  rename(from: string, to: string): void {
    if (isNullDevice(this.normalize(from)) || isNullDevice(this.normalize(to))) throw new PascalError(`File access denied: ${from}`);
    if (this.exists(to)) throw new PascalError(`File already exists: ${to}`);
    const value = this.read(from);
    this.write(to, value);
    this.remove(from);
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
    if (this.isDirectory(path) || this.files.has(path)) throw new PascalError(`File access denied: ${name}`);
    this.directories.add(path);
    this.revision++;
  }
  changeDirectory(name: string): void {
    const path = this.resolve(name, this.current);
    if (!this.isDirectory(path)) throw new PascalError(`Path not found: ${name}`);
    this.current = path;
  }
  removeDirectory(name: string): void {
    const path = this.resolveName(name);
    if (!this.directories.has(path) && !this.isDirectory(path)) throw new PascalError(`Path not found: ${name}`);
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
