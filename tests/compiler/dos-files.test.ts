import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import {
  bytesToString,
  dosPath,
  importDosArchive,
  reconcileDosFiles,
  stringToBytes,
  DOS_CAPACITY,
} from '../../src/services/dos/dosFiles';

describe('DOS file bridge', () => {
  it('preserves all byte values through the browser drive', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(stringToBytes(bytesToString(bytes))).toEqual(bytes);
  });
  it('merges new, updated and deleted DOS files without deleting unrelated browser files', () => {
    expect(
      Object.fromEntries(
        reconcileDosFiles(
          { 'A.DAT': 'a', 'B.DAT': 'b' },
          { 'A.DAT': 'a', 'B.DAT': 'b', 'C.DAT': 'c' },
          { 'A.DAT': 'updated', 'D.DAT': '\0ÿ' }
        )
      )
    ).toEqual({ 'A.DAT': 'updated', 'B.DAT': null, 'D.DAT': '\0ÿ' });
  });
  it('rejects concurrent edits, deletions and creations before committing any file', () => {
    expect(() => reconcileDosFiles({ A: 'a' }, { A: 'browser' }, { A: 'dos' })).toThrow(
      /both DOS and the browser/
    );
    expect(() => reconcileDosFiles({ A: 'a' }, { A: 'browser' }, {})).toThrow(
      /both DOS and the browser/
    );
    expect(() => reconcileDosFiles({}, { A: 'browser' }, { A: 'dos' })).toThrow(
      /both DOS and the browser/
    );
  });
  it('accepts matching concurrent edits and omits unchanged files', () => {
    expect(
      Object.fromEntries(
        reconcileDosFiles({ A: 'old', B: 'b' }, { A: 'same', B: 'b' }, { A: 'same', B: 'b' })
      )
    ).toEqual({ A: 'same' });
  });
  it('does not copy bundled debugger/configuration into the user drive', () => {
    expect(
      reconcileDosFiles({}, {}, { '__TPTOOLS/DEBUG.COM': 'binary', '.JSDOS/DOSBOX.CONF': 'config' })
        .size
    ).toBe(0);
  });
  it('imports ZIP paths and binary files without byte decoding', () => {
    const archive = zipSync({
      'tools/run.com': new Uint8Array([0, 128, 255]),
      'source.pas': new Uint8Array([65, 13, 10]),
    });
    expect(importDosArchive(archive)).toEqual({
      'TOOLS/RUN.COM': '\0\x80ÿ',
      'SOURCE.PAS': 'A\r\n',
    });
  });
  it('rejects case-colliding ZIP paths', () => {
    expect(() =>
      importDosArchive(zipSync({ 'a.com': new Uint8Array([1]), 'A.COM': new Uint8Array([2]) }))
    ).toThrow(/Duplicate/);
  });
  it('rejects traversal, control characters and invalid DOS paths', () => {
    for (const path of ['../A', 'A/../B', 'A\0', 'ABC:B', 'A*B', ''])
      expect(() => dosPath(path)).toThrow(/Invalid/);
    expect(dosPath('C:\\PASCAL\\UNIT1.PAS')).toBe('PASCAL/UNIT1.PAS');
  });
  it('rejects oversized expanded archives before allocating entries', () => {
    expect(() =>
      importDosArchive(zipSync({ 'big.dat': new Uint8Array(DOS_CAPACITY + 1) }))
    ).toThrow(/expanded ZIP/);
  });
  it('checks combined capacity including files changed only in the browser', () => {
    expect(() => reconcileDosFiles({}, { A: 'a'.repeat(DOS_CAPACITY) }, { B: 'b' })).toThrow(
      /8 MiB/
    );
  });
});
