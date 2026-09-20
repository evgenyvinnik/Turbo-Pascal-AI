import { unzipSync } from 'fflate';

export const DOS_CAPACITY = 8 * 1024 * 1024;
export type DosFiles = Record<string, string>;

export function bytesToString(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return result;
}

export function stringToBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0) & 255);
}

export function dosPath(value: string): string {
  const path = value.replace(/^[a-z]:/i, '').replaceAll('\\', '/');
  const segments = path.split('/').filter((part) => part && part !== '.');
  if (!segments.length || segments.some((part) => part === '..' || /[:*?"<>|]/.test(part) || Array.from(part).some((char) => char.charCodeAt(0) < 32))) throw new Error(`Invalid DOS path: ${value}`);
  return segments.join('/').toUpperCase();
}

/** Three-way merge: concurrent browser changes are never silently replaced. */
export function reconcileDosFiles(initial: DosFiles, current: DosFiles, result: DosFiles): Map<string, string | null> {
  const changes = new Map<string, string | null>();
  for (const name of new Set([...Object.keys(initial), ...Object.keys(result)])) {
    if (name.startsWith('__TPTOOLS/') || name.startsWith('.JSDOS/')) continue;
    if (initial[name] === result[name]) continue;
    if (current[name] !== initial[name] && current[name] !== result[name]) throw new Error(`${name} changed in both DOS and the browser. Export the DOS files before returning.`);
    changes.set(name, result[name] ?? null);
  }
  const candidate = { ...current };
  for (const [path, contents] of changes) {
    if (contents === null) Reflect.deleteProperty(candidate, path);
    else candidate[path] = contents;
  }
  if (Object.values(candidate).reduce((n, contents) => n + contents.length, 0) > DOS_CAPACITY) throw new Error('The DOS files exceed the browser drive’s 8 MiB capacity. Export the DOS files before returning.');
  return changes;
}

/** Enforce expanded-size and path limits before fflate allocates ZIP entries. */
export function importDosArchive(bytes: Uint8Array): DosFiles {
  let size = 0;
  const names = new Set<string>();
  const archive = unzipSync(bytes, {
    filter(entry) {
      if (entry.name.endsWith('/')) return false;
      const name = dosPath(entry.name);
      if (name.startsWith('.JSDOS/') || name.startsWith('__TPTOOLS/')) return false;
      if (names.has(name)) throw new Error(`Duplicate DOS file name: ${name}`);
      names.add(name);
      size += entry.originalSize;
      if (size > DOS_CAPACITY) throw new Error('The expanded ZIP exceeds the browser drive’s 8 MiB capacity.');
      return true;
    },
  });
  return Object.fromEntries(Object.entries(archive).map(([path, content]) => [dosPath(path), bytesToString(content)]));
}
