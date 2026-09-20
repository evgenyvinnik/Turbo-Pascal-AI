import { VirtualFileSystem } from '../../compiler/runtime/VirtualFileSystem';
import { encodeDosText } from '../../compiler/encoding';

export const PROGRAM_DISK_KEY = 'turbo-pascal.virtual-disk.v1';
export const PROGRAM_IMPORT_LIMIT = 8 * 1024 * 1024;

function loadDisk(): VirtualFileSystem {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PROGRAM_DISK_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return new VirtualFileSystem();
    return new VirtualFileSystem(
      Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    );
  } catch {
    return new VirtualFileSystem();
  }
}

/** Every running program and file import shares the same in-memory DOS drive. */
export const programDisk = loadDisk();
let savedRevision = programDisk.revision;

function saveSnapshot(snapshot: Record<string, string>): void {
  try {
    localStorage.setItem(PROGRAM_DISK_KEY, JSON.stringify(snapshot));
  } catch {
    throw new Error('Browser storage is full or unavailable. Files could not be saved.');
  }
}

export function persistProgramFiles(): void {
  if (programDisk.revision === savedRevision) return;
  saveSnapshot(programDisk.snapshot());
  savedRevision = programDisk.revision;
}

export const virtualFiles = (): string[] => Object.keys(programDisk.snapshot());
export const readVirtualFile = (name: string): string | null =>
  programDisk.exists(name) ? programDisk.read(name) : null;

/** Editor saves can replace their own files; validate and persist before mutation. */
export function writeVirtualFile(name: string, content: string): void {
  const candidate = new VirtualFileSystem(programDisk.snapshot());
  candidate.write(name, content);
  saveSnapshot(candidate.snapshot());
  programDisk.write(name, content);
  savedRevision = programDisk.revision;
}

/** Commit a DOS shell's file changes atomically, including deletions. */
export function applyProgramFileChanges(changes: ReadonlyMap<string, string | null>): void {
  const snapshot = programDisk.snapshot();
  for (const [name, content] of changes) {
    const path = programDisk.normalize(name);
    if (content === null) Reflect.deleteProperty(snapshot, path);
    else snapshot[path] = content;
  }
  const candidate = new VirtualFileSystem(snapshot);
  saveSnapshot(candidate.snapshot());
  // Free replaced entries before writes so a valid final snapshot cannot fail
  // partway through because of a temporary peak in capacity.
  for (const name of changes.keys()) if (programDisk.exists(name)) programDisk.remove(name);
  for (const [name, content] of changes) {
    if (content !== null) programDisk.write(name, content);
  }
  savedRevision = programDisk.revision;
}

export interface ImportedSource {
  name: string;
  path: string;
  text: string;
}
export interface ImportedProgramFiles {
  sources: ImportedSource[];
  files: string[];
}

function byteString(bytes: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return result;
}

/** Read a whole batch before committing any file or opening any source window. */
export async function importProgramFiles(files: readonly File[]): Promise<ImportedProgramFiles> {
  if (files.reduce((total, file) => total + file.size, 0) > PROGRAM_IMPORT_LIMIT)
    throw new Error('The selected files exceed the 8 MiB import limit. No files were imported.');
  const sources: ImportedSource[] = [];
  const imported = new Map<string, string>();
  for (const file of files) {
    const path = programDisk.normalize(file.name);
    if (imported.has(path))
      throw new Error(`Duplicate file name: ${path}. No files were imported.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.pas$/i.test(path)) {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`${path} is not a UTF-8 Pascal source. No files were imported.`);
      }
      sources.push({ name: path, path, text });
      imported.set(path, encodeDosText(text));
    } else imported.set(path, byteString(bytes));
  }

  // Read the current disk only after asynchronous reads finish: a running Pascal
  // program may have written another file while the browser was loading bytes.
  const snapshot = programDisk.snapshot();
  for (const [name, contents] of imported) {
    if (snapshot[name] !== undefined && snapshot[name] !== contents)
      throw new Error(
        `${name} already exists. Rename the dropped file to keep both copies. No files were imported.`
      );
    snapshot[name] = contents;
  }
  let candidate: VirtualFileSystem;
  try {
    candidate = new VirtualFileSystem(snapshot);
  } catch {
    throw new Error('The virtual disk exceeds its 8 MiB capacity. No files were imported.');
  }
  if (imported.size) {
    saveSnapshot(candidate.snapshot());
    // Capacity and persistence already succeeded. This synchronous commit cannot
    // interleave with a VM slice or another browser drop event.
    for (const [name, contents] of imported) programDisk.write(name, contents);
    savedRevision = programDisk.revision;
  }
  return { sources, files: [...imported.keys()] };
}
