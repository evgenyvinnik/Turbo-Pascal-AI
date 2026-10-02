import { db } from './database';

/** Where the drive was kept before it moved to IndexedDB. */
export const LEGACY_DISK_KEY = 'turbo-pascal.virtual-disk.v1';

/** The drive's files by path: a change gives the new contents, or null to delete. */
export type DiskFiles = Record<string, string>;
export type DiskChanges = ReadonlyMap<string, string | null>;

/** Durable storage for the program drive. */
export interface DiskStore {
  load(): Promise<DiskFiles>;
  /** Applies these changes together. */
  save(changes: DiskChanges): Promise<void>;
  /** Replaces everything stored with these files. */
  replace(files: DiskFiles): Promise<void>;
}

function legacyDisk(): DiskFiles | null {
  try {
    const raw = localStorage.getItem(LEGACY_DISK_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return null;
  }
}

function forgetLegacyDisk(): void {
  try {
    localStorage.removeItem(LEGACY_DISK_KEY);
  } catch {
    // Storage that cannot be read had nothing to carry across.
  }
}

export const indexedDbDiskStore: DiskStore = {
  async load() {
    const legacy = legacyDisk();
    const files = await db.transaction('rw', db.disk, async () => {
      const stored: DiskFiles = Object.fromEntries(
        (await db.disk.toArray()).map((file) => [file.name, file.content])
      );
      // A drive from localStorage joins the stored one; a file in both is
      // already the newer copy here.
      const carried = Object.entries(legacy ?? {}).filter(([name]) => !(name in stored));
      if (carried.length)
        await db.disk.bulkPut(carried.map(([name, content]) => ({ name, content })));
      return { ...Object.fromEntries(carried), ...stored };
    });
    if (legacy) forgetLegacyDisk();
    return files;
  },
  async save(changes) {
    const puts = [...changes]
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([name, content]) => ({ name, content }));
    const deletes = [...changes].filter(([, content]) => content === null).map(([name]) => name);
    await db.transaction('rw', db.disk, async () => {
      if (deletes.length) await db.disk.bulkDelete(deletes);
      if (puts.length) await db.disk.bulkPut(puts);
    });
  },
  async replace(files) {
    await db.transaction('rw', db.disk, async () => {
      await db.disk.clear();
      await db.disk.bulkPut(Object.entries(files).map(([name, content]) => ({ name, content })));
    });
  },
};
