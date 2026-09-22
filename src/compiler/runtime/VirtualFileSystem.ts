import { PascalError } from '../errors/PascalError';

/** DOS's null device. DOS treats a device name as the device in any
 * directory and with any extension, so C:\TEMP\NUL.TXT is NUL too. */
const isNullDevice = (path: string) => /^NUL(?:\.[^/]*)?$/.test(path.split('/').at(-1) ?? '');

/** A program's DOS drive. It never accesses host files or host environment variables. */
export class VirtualFileSystem {
  readonly capacity = 8 * 1024 * 1024;
  private files = new Map<string, string>();
  revision = 0;

  constructor(initial: Record<string, string> = {}) {
    for (const [name, content] of Object.entries(initial)) this.write(name, content);
  }
  normalize(name: string): string {
    const parts: string[] = [];
    for (const part of name
      .replace(/^[a-z]:/i, '')
      .replaceAll('\\', '/')
      .split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part.toUpperCase());
    }
    if (!parts.length) throw new PascalError('Invalid file name');
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
  get used(): number {
    return [...this.files.values()].reduce((sum, file) => sum + file.length, 0);
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
