import type { DiskFiles, DiskStore } from '../../src/services/db/diskRepository';

/** A disk store in memory, standing in for IndexedDB; `failing` makes writes reject. */
export function memoryDiskStore(initial: DiskFiles = {}) {
  const files: DiskFiles = { ...initial };
  const control = { failing: false, writes: 0 };
  const fail = () => {
    control.writes++;
    if (control.failing) return Promise.reject(new Error('Quota exceeded'));
    return null;
  };
  const store: DiskStore = {
    load: () => Promise.resolve({ ...files }),
    save(changes) {
      const failed = fail();
      if (failed) return failed;
      for (const [name, content] of changes) {
        if (content === null) Reflect.deleteProperty(files, name);
        else files[name] = content;
      }
      return Promise.resolve();
    },
    replace(next) {
      const failed = fail();
      if (failed) return failed;
      for (const name of Object.keys(files)) Reflect.deleteProperty(files, name);
      Object.assign(files, next);
      return Promise.resolve();
    },
  };
  return { store, files, control };
}
