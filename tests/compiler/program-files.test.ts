import { describe, expect, it, vi } from 'vitest';
import { memoryDiskStore } from './memoryDiskStore';

/** Fresh modules over a stored drive holding `initial`, as a page load sees it. */
async function diskWith(initial: Record<string, string>) {
  vi.resetModules();
  const memory = memoryDiskStore(initial);
  const files = await import('../../src/components/IDE/programFiles');
  files.setDiskStore(memory.store);
  await files.loadProgramDisk();
  const errors: string[] = [];
  files.onDiskError((message) => errors.push(message));
  return { ...files, ...memory, errors };
}

describe('atomic browser file imports', () => {
  it('commits DOS replacements and deletions together at full capacity', async () => {
    const disk = await diskWith({ 'OLD.BIN': 'a'.repeat(8 * 1024 * 1024 - 1), 'KEPT.BIN': 'b' });
    disk.applyProgramFileChanges(
      new Map([
        ['KEPT.BIN', 'expanded'],
        ['OLD.BIN', null],
      ])
    );
    expect(disk.programDisk.snapshot()).toEqual({ 'KEPT.BIN': 'expanded' });
    await disk.flushProgramDisk();
    expect(disk.files).toEqual({ 'KEPT.BIN': 'expanded' });
  });

  it('keeps the files when storage rejects a write, and writes the whole drive later', async () => {
    const disk = await diskWith({ 'KEPT.BIN': '\0ÿ', 'OLD.TXT': 'old' });
    disk.control.failing = true;
    disk.applyProgramFileChanges(
      new Map([
        ['NEW.BIN', 'new'],
        ['OLD.TXT', null],
      ])
    );
    await disk.flushProgramDisk();
    expect(disk.errors).toEqual([disk.DISK_SAVE_ERROR]);
    expect(disk.programDisk.snapshot()).toEqual({ 'KEPT.BIN': '\0ÿ', 'NEW.BIN': 'new' });
    expect(disk.programDiskSaving()).toBe(false);
    // Storage works again: the next save carries everything, the failed change too.
    disk.control.failing = false;
    disk.writeVirtualFile('LATER.TXT', 'later');
    await disk.flushProgramDisk();
    expect(disk.files).toEqual({ 'KEPT.BIN': '\0ÿ', 'NEW.BIN': 'new', 'LATER.TXT': 'later' });
  });

  it("writes a program's changes once its run ends, only what changed", async () => {
    const disk = await diskWith({ 'A.TXT': 'a', 'B.TXT': 'b' });
    disk.programDisk.write('C.TXT', 'c');
    disk.programDisk.remove('A.TXT');
    expect(disk.files).toEqual({ 'A.TXT': 'a', 'B.TXT': 'b' });
    disk.persistProgramFiles();
    disk.persistProgramFiles();
    await disk.flushProgramDisk();
    expect(disk.files).toEqual({ 'B.TXT': 'b', 'C.TXT': 'c' });
    expect(disk.control.writes).toBe(1);
  });

  it('counts existing disk contents when enforcing the eight MiB capacity', async () => {
    const existing = 'x'.repeat(7 * 1024 * 1024);
    const disk = await diskWith({ 'EXISTING.BIN': existing });
    await expect(
      disk.importProgramFiles([
        new File(['small'], 'small.txt'),
        new File([new Uint8Array(2 * 1024 * 1024)], 'new.bin'),
      ])
    ).rejects.toThrow(/virtual disk exceeds its 8 MiB capacity/);
    expect(disk.virtualFiles()).toEqual(['EXISTING.BIN']);
    expect(disk.programDisk.read('EXISTING.BIN')).toBe(existing);
    await disk.flushProgramDisk();
    expect(disk.control.writes).toBe(0);
  });

  it('rejects invalid UTF-8 source without committing preceding data files', async () => {
    const disk = await diskWith({});
    await expect(
      disk.importProgramFiles([
        new File(['data'], 'data.txt'),
        new File([new Uint8Array([255])], 'invalid.pas'),
      ])
    ).rejects.toThrow(/not a UTF-8 Pascal source/);
    expect(disk.programDisk.snapshot()).toEqual({});
    await disk.flushProgramDisk();
    expect(disk.control.writes).toBe(0);
  });
});
