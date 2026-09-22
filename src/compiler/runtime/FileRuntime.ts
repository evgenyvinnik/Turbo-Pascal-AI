import { PascalError } from '../errors/PascalError';
import { TypeCode } from '../types/inst';
import type { StackValue } from './Machine';
import { VirtualFileSystem } from './VirtualFileSystem';
import { encodeBinary, decodeBinary, type BinaryCell } from './BinaryCodec';
import { roundReal48 } from '../codegen/numeric';

export interface MemoryAccess {
  read(address: number): StackValue;
  write(address: number, value: StackValue): void;
}
interface FileHandle {
  name: string;
  words: number;
  recordSize: number;
  layout: BinaryCell[];
  mode: 'closed' | 'read' | 'write' | 'update';
  position: number;
}

export class FileRuntime {
  private handles = new Map<number, FileHandle>();
  private nextHandle = 1;
  private lastError = 0;
  constructor(
    private memory: MemoryAccess,
    readonly disk: VirtualFileSystem
  ) {}
  reset(): void {
    this.handles.clear();
    this.nextHandle = 1;
    this.lastError = 0;
  }
  private handle(address: number, mode?: FileHandle['mode']): FileHandle {
    const file = this.handles.get(Number(this.memory.read(address)));
    if (!file) throw new PascalError('File is not assigned');
    if (mode && file.mode !== mode && file.mode !== 'update')
      throw new PascalError(
        mode === 'read' ? 'File is not open for reading' : 'File is not open for writing'
      );
    return file;
  }
  get pendingError(): number {
    return this.lastError;
  }
  recordError(error: unknown, checked: boolean, input = false): number {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = input
      ? 106
      : message.startsWith('File not found')
        ? 2
        : message.startsWith('File access denied')
          ? 5
        : message === 'Invalid file name'
          ? 3
          : message === 'File is not assigned'
            ? 102
            : message === 'File is not open'
              ? 103
              : message === 'File is not open for reading'
                ? 104
                : message === 'File is not open for writing'
                  ? 105
                  : message.startsWith('Invalid number') ||
                      message.startsWith('Invalid boolean') ||
                      message === 'Real overflow'
                    ? 106
                    : message === 'Read past end of file'
                      ? 100
                      : 101;
    if (checked) throw error;
    return this.lastError;
  }
  invoke(
    index: number,
    args: StackValue[],
    checked = true
  ): { result?: StackValue; ioError?: number } | undefined {
    if (index === 75) {
      const result = this.lastError;
      this.lastError = 0;
      return { result };
    }
    if (
      ![
        25, 26, 46, 47, 48, 49, 50, 66, 67, 68, 69, 70, 71, 72, 73, 74, 76, 78, 79, 80, 81, 82,
      ].includes(index)
    )
      return undefined;
    const empty = [25, 26, 66, 67].includes(index) ? { result: 0 } : {};
    if (this.lastError) {
      if (checked) throw new PascalError(`I/O error ${String(this.lastError)}`);
      return { ...empty, ioError: this.lastError };
    }
    try {
      return this.execute(index, args);
    } catch (error) {
      return { ...empty, ioError: this.recordError(error, checked) };
    }
  }
  private execute(index: number, args: StackValue[]): { result?: StackValue } | undefined {
    const address = Number(args[0]);
    // Writes reach the drive at once, so Flush only checks the file is open.
    if (index === 82) {
      this.handle(address, 'write');
      return {};
    }
    if (index === 46) {
      const id = this.nextHandle++;
      const layout = JSON.parse(String(args[3] ?? '[]')) as BinaryCell[];
      this.handles.set(id, {
        name: this.disk.normalize(String(args[1])),
        words: Number(args[2] ?? 0),
        layout,
        recordSize: layout.length ? layout.reduce((size, cell) => size + cell.bytes, 0) : 128,
        mode: 'closed',
        position: 0,
      });
      this.memory.write(address, id);
      return {};
    }
    if (
      ![25, 26, 47, 48, 49, 50, 66, 67, 68, 69, 70, 71, 72, 73, 74, 76, 78, 79, 80, 81].includes(
        index
      )
    )
      return undefined;
    const file = this.handle(address);
    const typed = file.words > 0;
    const length = () =>
      Math.floor(this.disk.read(file.name).length / (file.words === 0 ? 1 : file.recordSize));
    if ([25, 26, 50, 66, 67, 68, 76].includes(index) && file.mode === 'closed')
      throw new PascalError('File is not open');
    if ((index === 47 || index === 48) && file.words < 0) {
      const size = Number(args[1] ?? 128);
      if (!Number.isInteger(size) || size < 1 || size > 65535)
        throw new PascalError('Invalid record size');
      file.recordSize = size;
    }
    switch (index) {
      case 47:
        this.disk.read(file.name);
        file.mode = file.words === 0 ? 'read' : 'update';
        file.position = 0;
        return {};
      case 48:
        this.disk.write(file.name, '');
        file.mode = file.words === 0 ? 'write' : 'update';
        file.position = 0;
        return {};
      case 49:
        file.position = length();
        file.mode = 'write';
        return {};
      case 50:
        file.mode = 'closed';
        return {};
      case 25:
        return { result: file.position >= length() ? 1 : 0 };
      case 26: {
        this.handle(address, 'read');
        const text = this.disk.read(file.name);
        return {
          result: file.position >= text.length || /[\r\n]/.test(text[file.position] ?? '') ? 1 : 0,
        };
      }
      case 66:
        return { result: file.position };
      case 67:
        return { result: length() };
      case 68:
        if (!Number.isInteger(args[1]) || Number(args[1]) < 0)
          throw new PascalError('Invalid file position');
        file.position = Number(args[1]);
        return {};
      case 69:
        if (file.mode !== 'closed') throw new PascalError('Close the file before erasing it');
        this.disk.remove(file.name);
        return {};
      case 74:
        if (file.mode !== 'closed') throw new PascalError('Close the file before renaming it');
        this.disk.rename(file.name, String(args[1]));
        file.name = this.disk.normalize(String(args[1]));
        return {};
      case 76:
        this.handle(address, 'write');
        this.disk.write(
          file.name,
          this.disk
            .read(file.name)
            .slice(0, file.position * (file.words === 0 ? 1 : file.recordSize))
        );
        return {};
      case 70:
      case 71: {
        this.handle(address, 'write');
        const content = this.disk.read(file.name),
          text = args.slice(1).join('') + (index === 71 ? '\r\n' : '');
        this.disk.write(
          file.name,
          content.slice(0, file.position) + text + content.slice(file.position + text.length)
        );
        file.position += text.length;
        return {};
      }
      case 72:
      case 73: {
        this.handle(address, 'read');
        const text = this.disk.read(file.name);
        for (let i = 1; i < args.length; i += 2) {
          const target = Number(args[i]),
            type = Number(args[i + 1]) as TypeCode;
          let value: StackValue;
          if (type === TypeCode.S) {
            const start = file.position;
            while (file.position < text.length && !/[\r\n]/.test(text[file.position]!))
              file.position++;
            value = text.slice(start, file.position);
          } else if (type === TypeCode.C) {
            if (file.position >= text.length) throw new PascalError('Read past end of file');
            value = text[file.position++]!;
          } else {
            while (file.position < text.length && /\s/.test(text[file.position]!)) file.position++;
            const start = file.position;
            while (file.position < text.length && !/\s/.test(text[file.position]!)) file.position++;
            const token = text.slice(start, file.position);
            if (!token) throw new PascalError('Read past end of file');
            if (type === TypeCode.B) {
              if (!/^(true|false)$/i.test(token)) throw new PascalError('Invalid boolean in file');
              value = token.toLowerCase() === 'true' ? 1 : 0;
            } else {
              const valid =
                type === TypeCode.I
                  ? /^[+-]?\d+$/.test(token)
                  : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token);
              value = Number(token);
              if (!valid || !Number.isFinite(value))
                throw new PascalError('Invalid number in file');
              if (type === TypeCode.R) value = roundReal48(value);
            }
          }
          this.memory.write(target, value);
        }
        if (index === 73) {
          while (file.position < text.length && !/[\r\n]/.test(text[file.position]!))
            file.position++;
          if (text[file.position] === '\r') file.position++;
          if (text[file.position] === '\n') file.position++;
        }
        return {};
      }
      case 78: {
        this.handle(address, 'write');
        const values = args.slice(1);
        if (!typed || values.length !== file.words || file.layout.length !== file.words)
          throw new PascalError('Typed file record size mismatch');
        const data = encodeBinary(
          { read: (offset) => values[offset] ?? 0, write: () => undefined },
          0,
          file.layout
        );
        const position = file.position * file.recordSize,
          content = this.disk.read(file.name);
        if (position + data.length > this.disk.capacity) throw new PascalError('Disk full');
        const prefix = content.slice(0, position).padEnd(position, '\0');
        this.disk.write(
          file.name,
          prefix +
            Array.from(data, (byte) => String.fromCharCode(byte)).join('') +
            content.slice(position + data.length)
        );
        file.position++;
        return {};
      }
      case 79: {
        this.handle(address, 'read');
        if (!typed || Number(args[2]) !== file.words || file.layout.length !== file.words)
          throw new PascalError('Typed file record size mismatch');
        const position = file.position * file.recordSize;
        const data = this.disk.read(file.name).slice(position, position + file.recordSize);
        if (data.length < file.recordSize) throw new PascalError('Read past end of file');
        decodeBinary(
          this.memory,
          Number(args[1]),
          file.layout,
          Uint8Array.from(data, (char) => char.charCodeAt(0))
        );
        file.position++;
        return {};
      }
      case 80:
      case 81: {
        if (file.words >= 0) throw new PascalError('Block I/O requires an untyped file');
        this.handle(address, index === 80 ? 'read' : 'write');
        const count = Number(args[2]),
          resultAddress = Number(args[3]),
          layout = JSON.parse(String(args[4])) as BinaryCell[];
        const bufferSize = layout.reduce((total, cell) => total + cell.bytes, 0);
        const size = count * file.recordSize;
        if (!Number.isInteger(count) || count < 0 || size > bufferSize)
          throw new PascalError('Block I/O exceeds buffer size');
        const position = file.position * file.recordSize;
        const content = this.disk.read(file.name);
        let actual = count;
        if (index === 80) {
          actual = Math.min(
            count,
            Math.floor(Math.max(0, content.length - position) / file.recordSize)
          );
          const data = Uint8Array.from(
            content.slice(position, position + actual * file.recordSize),
            (char) => char.charCodeAt(0)
          );
          decodeBinary(this.memory, Number(args[1]), layout, data);
        } else {
          if (position > content.length) throw new PascalError('Invalid file position');
          const data = encodeBinary(this.memory, Number(args[1]), layout).subarray(0, size);
          let text = '';
          for (let i = 0; i < data.length; i++) text += String.fromCharCode(data[i]!);
          this.disk.write(
            file.name,
            content.slice(0, position) + text + content.slice(position + size)
          );
        }
        file.position += actual;
        if (resultAddress >= 0) this.memory.write(resultAddress, actual);
        else if (actual !== count) throw new PascalError('Read past end of file');
        return {};
      }
    }
    return undefined;
  }
}
