import type { Buffer, TPWindow, WindowKind } from '../../stores/desktopStore';
import type { Breakpoint } from '../../stores/debugStore';
import type { DialogValues } from '../../stores/dialogStore';
import type { useIdeStore } from '../../stores/ideStore';
import type { Pos } from '../../stores/textBuffer';
import type { Rect } from '../../tui/Screen';

export type WorkspaceBuffer = Omit<Buffer, 'error' | 'highlight'>;

export interface WorkspaceSnapshot {
  version: 1;
  desktop: {
    buffers: Record<string, WorkspaceBuffer>;
    windows: TPWindow[];
    activeId: string | null;
    clipboard: string;
    seq: number;
    untitled: number;
  };
  ide: Pick<ReturnType<typeof useIdeStore.getState>,
    'helpTopic' | 'search' | 'destination' | 'primaryFile' | 'optionsFile' | 'directory' |
    'compilerOptions' | 'optionDialogs' | 'tools' | 'programParameters' | 'defines'>;
  debug: {
    breakpoints: Breakpoint[];
    watches: { id: string; expression: string }[];
  };
  histories: Record<string, string[]>;
  output: { programOutput: string[]; messages: string[] };
}

export class UnsupportedWorkspaceVersionError extends Error {
  constructor(version: number) {
    super(`This workspace was saved with unsupported version ${String(version)}.`);
    this.name = 'UnsupportedWorkspaceVersionError';
  }
}

function malformed(path: string): never {
  throw new Error(`The saved workspace contains invalid ${path}.`);
}

function safeKey(value: string, path: string): string {
  if (!value || value === '__proto__' || value === 'constructor' || value === 'prototype') malformed(path);
  return value;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) malformed(path);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) malformed(path);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) safeKey(key, path);
  return result;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) malformed(path);
  // IndexedDB can contain sparse arrays even though our own writer never
  // creates them. Materialize holes so each missing item is validated too.
  return Array.from(value as unknown[]);
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') malformed(path);
  return value;
}

function identifier(value: unknown, path: string): string {
  return safeKey(string(value, path), path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') malformed(path);
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) malformed(path);
  return value;
}

function strings(value: unknown, path: string): string[] {
  return array(value, path).map(item => string(item, path));
}

function lines(value: unknown, path: string): string[] {
  const result = strings(value, path);
  if (result.length === 0) malformed(path);
  return result;
}

function record<T>(value: unknown, path: string, decode: (item: unknown, key: string) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(object(value, path)).map(([key, item]) => [key, decode(item, key)]));
}

function position(value: unknown, content: string[], path: string, scroll = false): Pos {
  const source = object(value, path);
  const line = Math.min(integer(source.line, `${path}.line`), content.length - 1);
  const columnLimit = scroll
    ? content.reduce((maximum, text) => Math.max(maximum, text.length), 0)
    : (content[line]?.length ?? 0);
  return { line, col: Math.min(integer(source.col, `${path}.col`), columnLimit) };
}

function undoHistory(value: unknown, path: string): WorkspaceBuffer['undo'] {
  return array(value, path).map(item => {
    const source = object(item, path);
    const content = lines(source.lines, `${path}.lines`);
    return { lines: content, cursor: position(source.cursor, content, `${path}.cursor`) };
  });
}

function buffer(value: unknown, key: string): WorkspaceBuffer {
  const path = `buffer ${key}`;
  const source = object(value, path);
  const id = identifier(source.id, `${path}.id`);
  if (id !== key) malformed(`${path}.id`);
  const content = lines(source.lines, `${path}.lines`);
  return {
    id,
    name: string(source.name, `${path}.name`),
    path: string(source.path, `${path}.path`),
    lines: content,
    cursor: position(source.cursor, content, `${path}.cursor`),
    scroll: position(source.scroll, content, `${path}.scroll`, true),
    anchor: source.anchor === null ? null : position(source.anchor, content, `${path}.anchor`),
    modified: boolean(source.modified, `${path}.modified`),
    insert: boolean(source.insert, `${path}.insert`),
    undo: undoHistory(source.undo, `${path}.undo`),
    redo: undoHistory(source.redo, `${path}.redo`),
  };
}

function rect(value: unknown, path: string): Rect {
  const source = object(value, path);
  // Window movement permits partially clipped frames. Keep those layouts while
  // bounding rendering work and bringing wholly off-screen origins into view.
  return {
    x: Math.min(integer(source.x, `${path}.x`), 79),
    y: Math.max(1, Math.min(integer(source.y, `${path}.y`), 23)),
    w: Math.min(integer(source.w, `${path}.w`, 1), 80),
    h: Math.min(integer(source.h, `${path}.h`, 1), 23),
  };
}

const WINDOW_KINDS = new Set<string>(['edit', 'output', 'watches', 'callstack', 'messages', 'help', 'registers']);

function window(value: unknown): TPWindow {
  const source = object(value, 'window');
  const kind = string(source.kind, 'window kind');
  if (!WINDOW_KINDS.has(kind)) malformed('window kind');
  return {
    id: identifier(source.id, 'window ID'),
    kind: kind as WindowKind,
    num: integer(source.num, 'window number', 1),
    rect: rect(source.rect, 'window geometry'),
    prevRect: source.prevRect === null ? null : rect(source.prevRect, 'previous window geometry'),
    bufferId: source.bufferId === null ? null : identifier(source.bufferId, 'window buffer ID'),
    title: string(source.title, 'window title'),
    scroll: integer(source.scroll, 'window scroll'),
    selected: integer(source.selected, 'window selection'),
  };
}

function ide(value: unknown): WorkspaceSnapshot['ide'] {
  const source = object(value, 'IDE settings');
  const search = object(source.search, 'search settings');
  if (source.destination !== 'Memory' && source.destination !== 'Disk') malformed('compile destination');
  const compilerOptions = record(source.compilerOptions, 'compiler options', item =>
    array(item, 'compiler option flags').map(flag => boolean(flag, 'compiler option flag')));
  const optionDialogs = record<DialogValues>(source.optionDialogs, 'option dialogs', item =>
    record(item, 'option dialog values', option => {
      if (typeof option === 'string') return option;
      if (typeof option === 'number') return integer(option, 'option selection');
      return array(option, 'option flags').map(flag => boolean(flag, 'option flag'));
    }));
  return {
    helpTopic: string(source.helpTopic, 'help topic'),
    search: {
      text: string(search.text, 'search text'),
      replacement: string(search.replacement, 'replacement text'),
      caseSensitive: boolean(search.caseSensitive, 'case-sensitive search'),
      wholeWords: boolean(search.wholeWords, 'whole-word search'),
      regularExpression: search.regularExpression === undefined ? false : boolean(search.regularExpression, 'regular-expression search'),
      backward: boolean(search.backward, 'backward search'),
      selectedOnly: boolean(search.selectedOnly, 'selection search'),
      entireScope: boolean(search.entireScope, 'search scope'),
      promptOnReplace: boolean(search.promptOnReplace, 'replacement prompt'),
    },
    destination: source.destination,
    primaryFile: string(source.primaryFile, 'primary file'),
    optionsFile: source.optionsFile === undefined ? 'TURBO.TP' : string(source.optionsFile, 'options file'),
    directory: string(source.directory, 'working directory'),
    compilerOptions,
    optionDialogs,
    tools: array(source.tools, 'tools').map(item => {
      const tool = object(item, 'tool');
      return {
        title: string(tool.title, 'tool title'),
        program: string(tool.program, 'tool program'),
        params: string(tool.params, 'tool parameters'),
      };
    }),
    programParameters: string(source.programParameters, 'program parameters'),
    defines: string(source.defines, 'compiler defines'),
  };
}

function uniqueIds(values: { id: string }[], path: string): void {
  if (new Set(values.map(value => value.id)).size !== values.length) malformed(path);
}

function debug(value: unknown): WorkspaceSnapshot['debug'] {
  const source = object(value, 'debug settings');
  const breakpoints = array(source.breakpoints, 'breakpoints').map((item): Breakpoint => {
    const breakpoint = object(item, 'breakpoint');
    return {
      id: identifier(breakpoint.id, 'breakpoint ID'),
      file: string(breakpoint.file, 'breakpoint file'),
      line: integer(breakpoint.line, 'breakpoint line', 1),
      enabled: boolean(breakpoint.enabled, 'breakpoint enabled state'),
      ...(breakpoint.condition === undefined ? {} : { condition: string(breakpoint.condition, 'breakpoint condition') }),
      ...(breakpoint.passCount === undefined ? {} : { passCount: integer(breakpoint.passCount, 'breakpoint pass count') }),
    };
  });
  const watches = array(source.watches, 'watches').map(item => {
    const watch = object(item, 'watch');
    return { id: identifier(watch.id, 'watch ID'), expression: string(watch.expression, 'watch expression') };
  });
  uniqueIds(breakpoints, 'duplicate breakpoint IDs');
  uniqueIds(watches, 'duplicate watch IDs');
  return { breakpoints, watches };
}

/** Decode persisted data without trusting it as executable Zustand state. */
export function decodeWorkspace(payload: unknown): WorkspaceSnapshot {
  const source = object(payload, 'snapshot');
  const version = integer(source.version, 'snapshot version', 1);
  if (version > 1) throw new UnsupportedWorkspaceVersionError(version);
  const desktop = object(source.desktop, 'desktop');
  const buffers = record(desktop.buffers, 'buffers', buffer);
  const windows = array(desktop.windows, 'windows').map(window);
  uniqueIds(windows, 'duplicate window IDs');
  const activeId = desktop.activeId === null ? null : identifier(desktop.activeId, 'active window ID');
  if (activeId === null ? windows.length !== 0 : !windows.some(item => item.id === activeId)) malformed('active window');
  for (const item of windows) {
    if (item.kind === 'edit') {
      if (item.bufferId === null || !Object.hasOwn(buffers, item.bufferId)) malformed('editor buffer reference');
    } else if (item.bufferId !== null) malformed('tool window buffer reference');
  }
  let seq = integer(desktop.seq, 'window counter');
  let untitled = integer(desktop.untitled, 'untitled file counter');
  for (const id of [...Object.keys(buffers), ...windows.map(item => item.id)]) {
    const match = /^[wb](\d+)$/.exec(id);
    if (match) seq = Math.max(seq, integer(Number(match[1]), 'numeric window or buffer ID'));
  }
  for (const item of Object.values(buffers)) {
    const match = /^NONAME(\d+)\.PAS$/i.exec(item.name);
    if (match) untitled = Math.max(untitled, integer(Number(match[1]), 'untitled file name') + 1);
  }
  if (seq >= Number.MAX_SAFE_INTEGER || untitled >= Number.MAX_SAFE_INTEGER) malformed('exhausted file counters');
  const debugState = debug(source.debug);
  const outputSource = object(source.output, 'output');
  const output = {
    programOutput: strings(outputSource.programOutput, 'program output'),
    messages: strings(outputSource.messages, 'messages'),
  };
  for (const item of windows) {
    const rowCount = item.kind === 'output' ? output.programOutput.length
      : item.kind === 'messages' ? output.messages.length
      : item.kind === 'watches' ? debugState.watches.length
      : item.kind === 'callstack' || item.kind === 'registers' ? 0 : null;
    if (rowCount !== null) {
      item.scroll = Math.min(item.scroll, Math.max(0, rowCount - 1));
      item.selected = Math.min(item.selected, Math.max(0, rowCount - 1));
    }
  }
  return {
    version: 1,
    desktop: {
      buffers, windows, activeId,
      clipboard: string(desktop.clipboard, 'clipboard'),
      seq, untitled,
    },
    ide: ide(source.ide),
    debug: debugState,
    histories: record(source.histories, 'input histories', item => strings(item, 'input history')),
    output,
  };
}
