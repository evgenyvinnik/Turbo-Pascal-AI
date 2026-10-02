import { VirtualFileSystem } from '../../compiler/runtime/VirtualFileSystem';
import { encodeDosText } from '../../compiler/encoding';
import {
  indexedDbDiskStore,
  type DiskChanges,
  type DiskFiles,
  type DiskStore,
} from '../../services/db/diskRepository';

export const PROGRAM_IMPORT_LIMIT = 8 * 1024 * 1024;
export const DISK_SAVE_ERROR = 'Browser storage is full or unavailable. Files could not be saved.';

/** Every running program and file import shares the same in-memory DOS drive.
 * It is the drive programs read and write as they run; IndexedDB keeps a copy,
 * written behind it. */
export const programDisk = new VirtualFileSystem();

let store: DiskStore = indexedDbDiskStore;
/** What the store holds once the queued writes land. */
let stored: DiskFiles = {};
/** A write failed, so what the store holds is unknown: the next write replaces it. */
let stale = false;
let savedRevision = programDisk.revision;
let writes: Promise<void> = Promise.resolve();
let pendingWrites = 0;
const errorListeners = new Set<(message: string) => void>();

/** Swaps the durable store, for tests. */
export function setDiskStore(next: DiskStore): void {
  store = next;
}
/** Told when a write to the store fails; the drive itself keeps its files. */
export function onDiskError(listener: (message: string) => void): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}
/** Settles once every write so far has landed or failed. */
export function flushProgramDisk(): Promise<void> {
  return writes;
}
export const programDiskSaving = (): boolean => pendingWrites > 0;

/** Fills the drive from the store, as a page load starts. */
export async function loadProgramDisk(): Promise<void> {
  await writes;
  const files = await store.load();
  for (const name of Object.keys(programDisk.snapshot())) programDisk.remove(name);
  for (const [name, content] of Object.entries(files)) {
    try {
      programDisk.write(name, content);
    } catch {
      // A name the drive cannot hold, or no room left: the rest still load.
    }
  }
  stored = programDisk.snapshot();
  stale = false;
  savedRevision = programDisk.revision;
}

function queue(write: () => Promise<void>): void {
  pendingWrites++;
  writes = writes.then(write).then(
    () => {
      pendingWrites--;
    },
    () => {
      pendingWrites--;
      stale = true;
      // The next change, or the next program's end, writes the drive again.
      savedRevision = -1;
      for (const listener of errorListeners) listener(DISK_SAVE_ERROR);
    }
  );
}

/** Writes what changed on the drive since the last write to the store. */
function persist(): void {
  const snapshot = programDisk.snapshot();
  savedRevision = programDisk.revision;
  if (stale) {
    stale = false;
    stored = snapshot;
    queue(() => store.replace(snapshot));
    return;
  }
  const changes = new Map<string, string | null>();
  for (const [name, content] of Object.entries(snapshot))
    if (stored[name] !== content) changes.set(name, content);
  for (const name of Object.keys(stored)) if (!(name in snapshot)) changes.set(name, null);
  stored = snapshot;
  if (changes.size) queue(() => store.save(changes));
}

export function persistProgramFiles(): void {
  if (programDisk.revision !== savedRevision) persist();
}

export const virtualFiles = (): string[] => Object.keys(programDisk.snapshot());
export const readVirtualFile = (name: string): string | null =>
  programDisk.exists(name) ? programDisk.read(name) : null;

/** Editor saves can replace their own files; a file the drive has no room for
 * throws before anything changes. */
export function writeVirtualFile(name: string, content: string): void {
  new VirtualFileSystem(programDisk.snapshot()).write(name, content);
  programDisk.write(name, content);
  persist();
}

/** Commit a DOS shell's file changes atomically, including deletions. */
export function applyProgramFileChanges(changes: DiskChanges): void {
  const snapshot = programDisk.snapshot();
  for (const [name, content] of changes) {
    const path = programDisk.normalize(name);
    if (content === null) Reflect.deleteProperty(snapshot, path);
    else snapshot[path] = content;
  }
  // Throws, changing nothing, when the result does not fit on the drive.
  new VirtualFileSystem(snapshot);
  // Free replaced entries before writes so a valid final snapshot cannot fail
  // partway through because of a temporary peak in capacity.
  for (const name of changes.keys()) if (programDisk.exists(name)) programDisk.remove(name);
  for (const [name, content] of changes) {
    if (content !== null) programDisk.write(name, content);
  }
  persist();
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
  try {
    new VirtualFileSystem(snapshot);
  } catch {
    throw new Error('The virtual disk exceeds its 8 MiB capacity. No files were imported.');
  }
  if (imported.size) {
    // Capacity already checked. This synchronous commit cannot interleave with
    // a VM slice or another browser drop event.
    for (const [name, contents] of imported) programDisk.write(name, contents);
    persist();
  }
  return { sources, files: [...imported.keys()] };
}
