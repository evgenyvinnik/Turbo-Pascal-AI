import { afterEach, describe, expect, it, vi } from 'vitest';

const diskKey = 'turbo-pascal.virtual-disk.v1';
async function diskWith(initial: Record<string, string>, failWrites = false) {
  vi.resetModules();
  const values = new Map([[diskKey, JSON.stringify(initial)]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('Quota exceeded');
      values.set(key, value);
    },
  });
  const files = await import('../../src/components/IDE/programFiles');
  return { ...files, values };
}

afterEach(() => vi.unstubAllGlobals());

describe('atomic browser file imports', () => {
  it('commits DOS replacements and deletions together at full capacity', async () => {
    const disk = await diskWith({ 'OLD.BIN': 'a'.repeat(8 * 1024 * 1024 - 1), 'KEPT.BIN': 'b' });
    disk.applyProgramFileChanges(new Map([['KEPT.BIN', 'expanded'], ['OLD.BIN', null]]));
    expect(disk.programDisk.snapshot()).toEqual({ 'KEPT.BIN': 'expanded' });
    expect(JSON.parse(disk.values.get(diskKey)!)).toEqual({ 'KEPT.BIN': 'expanded' });
  });

  it('keeps all DOS changes uncommitted when browser storage rejects them', async () => {
    const disk = await diskWith({ 'KEPT.BIN': '\0ÿ', 'OLD.TXT': 'old' }, true);
    expect(() => disk.applyProgramFileChanges(new Map([['NEW.BIN', 'new'], ['OLD.TXT', null]]))).toThrow(/Browser storage/);
    expect(disk.programDisk.snapshot()).toEqual({ 'KEPT.BIN': '\0ÿ', 'OLD.TXT': 'old' });
  });
  it('preserves the disk when browser persistence rejects a complete batch', async () => {
    const disk = await diskWith({ 'KEPT.TXT': 'previous contents' }, true);
    await expect(
      disk.importProgramFiles([
        new File(['first'], 'one.txt'),
        new File(['program T;begin end.'], 'new.pas'),
      ])
    ).rejects.toThrow(/Browser storage/);
    expect(disk.programDisk.snapshot()).toEqual({ 'KEPT.TXT': 'previous contents' });
    expect(JSON.parse(disk.values.get(diskKey)!)).toEqual({ 'KEPT.TXT': 'previous contents' });
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
    expect(disk.values.get(diskKey)).toBe('{}');
  });
});
