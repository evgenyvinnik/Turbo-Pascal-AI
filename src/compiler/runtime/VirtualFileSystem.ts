import { PascalError } from '../errors/PascalError';

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
    return this.files.has(this.normalize(name));
  }
  read(name: string): string {
    const value = this.files.get(this.normalize(name));
    if (value === undefined) throw new PascalError(`File not found: ${name}`);
    return value;
  }
  write(name: string, content: string): void {
    const path = this.normalize(name);
    if (this.used - (this.files.get(path)?.length ?? 0) + content.length > this.capacity)
      throw new PascalError('Disk full');
    this.files.set(path, content);
    this.revision++;
  }
  remove(name: string): void {
    if (!this.files.delete(this.normalize(name))) throw new PascalError(`File not found: ${name}`);
    this.revision++;
  }
  rename(from: string, to: string): void {
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
