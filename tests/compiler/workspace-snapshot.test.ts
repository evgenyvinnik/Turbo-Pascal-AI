import { describe, expect, it } from 'vitest';
import {
  decodeWorkspace,
  UnsupportedWorkspaceVersionError,
  type WorkspaceSnapshot,
} from '../../src/services/db/workspaceSnapshot';

function fixture(): WorkspaceSnapshot {
  return {
    version: 1,
    desktop: {
      buffers: {
        b9: {
          id: 'b9',
          name: 'NONAME05.PAS',
          path: 'NONAME05.PAS',
          lines: ['program Kept;', 'begin end.'],
          cursor: { line: 0, col: 3 },
          scroll: { line: 0, col: 0 },
          anchor: { line: 0, col: 0 },
          modified: true,
          insert: false,
          undo: [{ lines: ['program Before;'], cursor: { line: 0, col: 15 } }],
          redo: [{ lines: ['program After;'], cursor: { line: 0, col: 14 } }],
        },
      },
      windows: [
        {
          id: 'w12',
          kind: 'edit',
          num: 1,
          bufferId: 'b9',
          title: 'NONAME05.PAS',
          rect: { x: 70, y: 18, w: 40, h: 12 },
          prevRect: { x: 0, y: 1, w: 80, h: 23 },
          scroll: 0,
          selected: 0,
        },
      ],
      activeId: 'w12',
      clipboard: 'kept clipboard',
      seq: 12,
      untitled: 6,
    },
    ide: {
      helpTopic: 'contents',
      destination: 'Memory',
      primaryFile: '',
      optionsFile: 'TURBO.TP',
      directory: 'A:\\',
      compilerOptions: { runtime: [false, true] },
      optionDialogs: { 'env.editor': { tab: '4', editor: [true, false] } },
      tools: [{ title: 'Grep', program: 'GREP.COM', params: '-n' }],
      programParameters: 'one two',
      defines: 'DEBUG',
      search: {
        text: 'Kept',
        replacement: 'New',
        caseSensitive: true,
        wholeWords: false,
        regularExpression: false,
        backward: false,
        selectedOnly: false,
        entireScope: true,
        promptOnReplace: true,
      },
    },
    debug: {
      breakpoints: [
        {
          id: 'bp-1',
          file: 'NONAME05.PAS',
          line: 2,
          enabled: true,
          condition: 'i = 5',
          passCount: 2,
        },
      ],
      watches: [{ id: 'watch-1', expression: 'i' }],
    },
    histories: { filename: ['*.PAS', 'KEPT.PAS'] },
    output: { programOutput: ['Hello'], messages: ['Compilation successful'] },
  };
}

describe('saved workspace validation', () => {
  it('reads version-one workspaces saved before regex and custom options filenames were persisted', () => {
    const source = fixture();
    Reflect.deleteProperty(source.ide, 'optionsFile');
    Reflect.deleteProperty(source.ide.search, 'regularExpression');
    const decoded = decodeWorkspace(source);
    expect(decoded.ide.optionsFile).toBe('TURBO.TP');
    expect(decoded.ide.search.regularExpression).toBe(false);
  });

  it('preserves usable layouts and durable history without retaining references to stored objects', () => {
    const source = fixture();
    const decoded = decodeWorkspace(source);
    expect(decoded).toEqual(source);
    source.desktop.buffers.b9!.lines[0] = 'changed after decoding';
    source.desktop.buffers.b9!.undo[0]!.lines[0] = 'changed undo';
    source.ide.optionDialogs['env.editor']!.tab = '99';
    source.output.programOutput.push('later');
    expect(decoded.desktop.buffers.b9!.lines[0]).toBe('program Kept;');
    expect(decoded.desktop.buffers.b9!.undo[0]!.lines[0]).toBe('program Before;');
    expect(decoded.ide.optionDialogs['env.editor']!.tab).toBe('4');
    expect(decoded.output.programOutput).toEqual(['Hello']);
  });

  it('repairs stale counters and positions before further editing can replace an existing buffer', () => {
    const source = fixture();
    source.desktop.seq = 0;
    source.desktop.untitled = 0;
    const buffer = source.desktop.buffers.b9!;
    buffer.cursor = { line: 999, col: 999 };
    buffer.anchor = { line: 0, col: 999 };
    buffer.scroll = { line: 999, col: 999 };
    buffer.undo[0]!.cursor = { line: 999, col: 999 };
    const decoded = decodeWorkspace(source);
    expect(decoded.desktop).toMatchObject({ seq: 12, untitled: 6 });
    expect(decoded.desktop.buffers.b9).toMatchObject({
      cursor: { line: 1, col: 10 },
      anchor: { line: 0, col: 13 },
      scroll: { line: 1, col: 13 },
      undo: [{ cursor: { line: 0, col: 15 } }],
    });
  });

  it('rejects missing text, sparse arrays and dangling editor references before hydration', () => {
    const empty = fixture();
    empty.desktop.buffers.b9!.lines = [];
    expect(() => decodeWorkspace(empty)).toThrow(/lines/);
    const sparse = fixture();
    sparse.desktop.buffers.b9!.lines = new Array<string>(2);
    expect(() => decodeWorkspace(sparse)).toThrow(/lines/);
    const dangling = fixture();
    dangling.desktop.windows[0]!.bufferId = 'missing';
    expect(() => decodeWorkspace(dangling)).toThrow(/buffer reference/);
    const active = fixture();
    active.desktop.activeId = 'missing';
    expect(() => decodeWorkspace(active)).toThrow(/active window/);
  });

  it('rejects unsafe record keys while keeping future formats distinguishable from corruption', () => {
    const unsafe = fixture();
    Object.defineProperty(unsafe.histories, '__proto__', { enumerable: true, value: ['poison'] });
    expect(() => decodeWorkspace(unsafe)).toThrow(/input histories/);
    expect(() => decodeWorkspace({ version: 2 })).toThrow(UnsupportedWorkspaceVersionError);
    expect(() => decodeWorkspace({ version: 1 })).not.toThrow(UnsupportedWorkspaceVersionError);
    expect(() => decodeWorkspace({ version: 1 })).toThrow(/desktop/);
  });
});
