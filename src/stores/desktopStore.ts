import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Rect } from '@/tui/Screen';
import {
  clampPos,
  comparePos,
  deleteRange,
  fromLines,
  getRange,
  insertText,
  orderRange,
  toLines,
  wordEnd,
  wordStart,
  type Pos,
} from './textBuffer';

export const DESKTOP: Rect = { x: 0, y: 1, w: 80, h: 23 };

export type WindowKind = 'edit' | 'output' | 'watches' | 'callstack' | 'messages' | 'help';

export interface Buffer {
  id: string;
  name: string;
  path: string;
  lines: string[];
  cursor: Pos;
  scroll: Pos;
  anchor: Pos | null;
  modified: boolean;
  insert: boolean;
  error: { line: number; message: string } | null;
  highlight: number | null;
  undo: { lines: string[]; cursor: Pos }[];
  redo: { lines: string[]; cursor: Pos }[];
}

export interface TPWindow {
  id: string;
  kind: WindowKind;
  num: number;
  rect: Rect;
  prevRect: Rect | null;
  bufferId: string | null;
  title: string;
  scroll: number;
  selected: number;
}

interface DesktopState {
  buffers: Record<string, Buffer>;
  windows: TPWindow[];
  activeId: string | null;
  clipboard: string;
  seq: number;
  untitled: number;
}

const emptyBuffer = (id: string, name: string, path: string, text: string): Buffer => ({
  id,
  name,
  path,
  lines: toLines(text),
  cursor: { line: 0, col: 0 },
  scroll: { line: 0, col: 0 },
  anchor: null,
  modified: false,
  insert: true,
  error: null,
  highlight: null,
  undo: [],
  redo: [],
});

const nextNum = (windows: TPWindow[]): number => {
  for (let n = 1; n <= 9; n += 1) if (!windows.some((w) => w.num === n)) return n;
  return windows.length + 1;
};

const TOOL_RECT: Record<Exclude<WindowKind, 'edit'>, Rect> = {
  output: { x: 0, y: 17, w: 80, h: 7 },
  watches: { x: 0, y: 17, w: 80, h: 7 },
  callstack: { x: 0, y: 17, w: 80, h: 7 },
  messages: { x: 0, y: 17, w: 80, h: 7 },
  help: { x: 4, y: 2, w: 72, h: 20 },
};

const TOOL_TITLE: Record<Exclude<WindowKind, 'edit'>, string> = {
  output: 'Output',
  watches: 'Watches',
  callstack: 'Call stack',
  messages: 'Messages',
  help: 'Help',
};

interface DesktopActions {
  newFile: () => void;
  openFile: (name: string, path: string, text: string) => void;
  closeWindow: (id?: string) => void;
  closeAll: () => void;
  focusWindow: (id: string) => void;
  cycleWindow: (dir: 1 | -1) => void;
  selectByNumber: (n: number) => void;
  zoomActive: () => void;
  tile: () => void;
  cascade: () => void;
  setRect: (id: string, rect: Rect) => void;
  toggleTool: (kind: Exclude<WindowKind, 'edit'>) => void;
  openTool: (kind: Exclude<WindowKind, 'edit'>) => void;
  setToolSelection: (id: string, index: number) => void;
  scrollTool: (id: string, delta: number) => void;

  // buffer editing (acts on the focused edit window)
  activeBuffer: () => Buffer | null;
  activeWindow: () => TPWindow | null;
  edit: (fn: (b: Buffer) => void) => void;
  typeText: (text: string) => void;
  newline: () => void;
  backspace: () => void;
  del: () => void;
  moveCursor: (to: Pos, extend: boolean) => void;
  moveBy: (dLine: number, dCol: number, extend: boolean) => void;
  moveWord: (dir: 1 | -1, extend: boolean) => void;
  home: (extend: boolean) => void;
  end: (extend: boolean) => void;
  pageMove: (dir: 1 | -1, extend: boolean, pageSize: number) => void;
  gotoLine: (line: number) => void;
  selectAll: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
  toggleInsert: () => void;
  markSaved: (name?: string, path?: string) => void;
  setError: (line: number, message: string) => void;
  clearError: () => void;
  setHighlight: (line: number | null) => void;
  ensureVisible: (pageSize: number, pageCols: number) => void;
}

const snapshot = (b: Buffer) => {
  b.undo.push({ lines: [...b.lines], cursor: { ...b.cursor } });
  if (b.undo.length > 200) b.undo.shift();
  b.redo = [];
  b.modified = true;
};

export const useDesktopStore = create<DesktopState & DesktopActions>()(
  immer((set, get) => ({
    buffers: {},
    windows: [],
    activeId: null,
    clipboard: '',
    seq: 0,
    untitled: 0,

    newFile: () =>
      { set((s) => {
        const name = `NONAME${String(s.untitled).padStart(2, '0')}.PAS`;
        s.untitled += 1;
        s.seq += 1;
        const id = `w${String(s.seq)}`;
        const bufId = `b${String(s.seq)}`;
        s.buffers[bufId] = emptyBuffer(bufId, name, name, '');
        s.windows.push({
          id,
          kind: 'edit',
          num: nextNum(s.windows),
          rect: { ...DESKTOP },
          prevRect: null,
          bufferId: bufId,
          title: name,
          scroll: 0,
          selected: 0,
        });
        s.activeId = id;
      }); },

    openFile: (name, path, text) =>
      { set((s) => {
        const existing = Object.values(s.buffers).find((b) => b.path === path);
        if (existing) {
          const win = s.windows.find((w) => w.bufferId === existing.id);
          if (win) {
            s.activeId = win.id;
            return;
          }
        }
        s.seq += 1;
        const id = `w${String(s.seq)}`;
        const bufId = existing?.id ?? `b${String(s.seq)}`;
        if (!existing) s.buffers[bufId] = emptyBuffer(bufId, name, path, text);
        s.windows.push({
          id,
          kind: 'edit',
          num: nextNum(s.windows),
          rect: { ...DESKTOP },
          prevRect: null,
          bufferId: bufId,
          title: name,
          scroll: 0,
          selected: 0,
        });
        s.activeId = id;
      }); },

    closeWindow: (id) =>
      { set((s) => {
        const target = id ?? s.activeId;
        if (!target) return;
        const idx = s.windows.findIndex((w) => w.id === target);
        if (idx < 0) return;
        const [removed] = s.windows.splice(idx, 1);
        const orphan = removed?.bufferId;
        if (orphan && !s.windows.some((w) => w.bufferId === orphan)) {
          s.buffers = Object.fromEntries(Object.entries(s.buffers).filter(([k]) => k !== orphan));
        }
        s.activeId = s.windows.length ? (s.windows[s.windows.length - 1]?.id ?? null) : null;
      }); },

    closeAll: () =>
      { set((s) => {
        s.windows = [];
        s.buffers = {};
        s.activeId = null;
      }); },

    focusWindow: (id) =>
      { set((s) => {
        const idx = s.windows.findIndex((w) => w.id === id);
        if (idx < 0) return;
        const [win] = s.windows.splice(idx, 1);
        if (win) s.windows.push(win);
        s.activeId = id;
      }); },

    cycleWindow: (dir) =>
      { set((s) => {
        if (s.windows.length < 2) return;
        if (dir === 1) {
          const front = s.windows.pop();
          if (front) s.windows.unshift(front);
        } else {
          const back = s.windows.shift();
          if (back) s.windows.push(back);
        }
        s.activeId = s.windows[s.windows.length - 1]?.id ?? null;
      }); },

    selectByNumber: (n) =>
      { set((s) => {
        const idx = s.windows.findIndex((w) => w.num === n);
        if (idx < 0) return;
        const [win] = s.windows.splice(idx, 1);
        if (win) {
          s.windows.push(win);
          s.activeId = win.id;
        }
      }); },

    zoomActive: () =>
      { set((s) => {
        const win = s.windows.find((w) => w.id === s.activeId);
        if (!win) return;
        if (win.prevRect) {
          win.rect = win.prevRect;
          win.prevRect = null;
        } else {
          win.prevRect = { ...win.rect };
          win.rect = { ...DESKTOP };
        }
      }); },

    tile: () =>
      { set((s) => {
        const n = s.windows.length;
        if (n === 0) return;
        const cols = n <= 2 ? 1 : Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        s.windows.forEach((win, i) => {
          const cx = i % cols;
          const cy = Math.floor(i / cols);
          const w = Math.floor(DESKTOP.w / cols);
          const h = Math.floor(DESKTOP.h / rows);
          win.prevRect = null;
          win.rect = {
            x: DESKTOP.x + cx * w,
            y: DESKTOP.y + cy * h,
            w: cx === cols - 1 ? DESKTOP.w - cx * w : w,
            h: cy === rows - 1 ? DESKTOP.h - cy * h : h,
          };
        });
      }); },

    cascade: () =>
      { set((s) => {
        s.windows.forEach((win, i) => {
          win.prevRect = null;
          win.rect = {
            x: DESKTOP.x + i,
            y: DESKTOP.y + i,
            w: Math.max(20, DESKTOP.w - i),
            h: Math.max(5, DESKTOP.h - i),
          };
        });
      }); },

    setRect: (id, rect) =>
      { set((s) => {
        const win = s.windows.find((w) => w.id === id);
        if (!win) return;
        win.rect = {
          x: Math.max(0, Math.min(DESKTOP.w - 10, rect.x)),
          y: Math.max(DESKTOP.y, Math.min(DESKTOP.y + DESKTOP.h - 3, rect.y)),
          w: Math.max(10, Math.min(DESKTOP.w, rect.w)),
          h: Math.max(3, Math.min(DESKTOP.h, rect.h)),
        };
      }); },

    toggleTool: (kind) => {
      const win = get().windows.find((w) => w.kind === kind);
      if (win) {
        if (get().activeId === win.id) get().closeWindow(win.id);
        else get().focusWindow(win.id);
      } else {
        get().openTool(kind);
      }
    },

    openTool: (kind) =>
      { set((s) => {
        const existing = s.windows.find((w) => w.kind === kind);
        if (existing) {
          const idx = s.windows.indexOf(existing);
          s.windows.splice(idx, 1);
          s.windows.push(existing);
          s.activeId = existing.id;
          return;
        }
        s.seq += 1;
        const id = `w${String(s.seq)}`;
        s.windows.push({
          id,
          kind,
          num: nextNum(s.windows),
          rect: { ...TOOL_RECT[kind] },
          prevRect: null,
          bufferId: null,
          title: TOOL_TITLE[kind],
          scroll: 0,
          selected: 0,
        });
        s.activeId = id;
      }); },

    setToolSelection: (id, index) =>
      { set((s) => {
        const win = s.windows.find((w) => w.id === id);
        if (win) win.selected = Math.max(0, index);
      }); },

    scrollTool: (id, delta) =>
      { set((s) => {
        const win = s.windows.find((w) => w.id === id);
        if (win) win.scroll = Math.max(0, win.scroll + delta);
      }); },

    activeWindow: () => get().windows.find((w) => w.id === get().activeId) ?? null,

    activeBuffer: () => {
      const win = get().windows.find((w) => w.id === get().activeId);
      if (!win?.bufferId) return null;
      return get().buffers[win.bufferId] ?? null;
    },

    edit: (fn) =>
      { set((s) => {
        const win = s.windows.find((w) => w.id === s.activeId);
        if (!win?.bufferId) return;
        const buf = s.buffers[win.bufferId];
        if (buf) fn(buf);
      }); },

    typeText: (text) =>
      { get().edit((b) => {
        snapshot(b);
        if (b.anchor && comparePos(b.anchor, b.cursor) !== 0) {
          b.cursor = deleteRange(b.lines, b.anchor, b.cursor);
          b.anchor = null;
        } else if (!b.insert) {
          const line = b.lines[b.cursor.line] ?? '';
          b.lines[b.cursor.line] =
            line.slice(0, b.cursor.col) + line.slice(b.cursor.col + text.length);
        }
        b.cursor = insertText(b.lines, b.cursor, text);
        b.error = null;
      }); },

    newline: () =>
      { get().edit((b) => {
        snapshot(b);
        if (b.anchor && comparePos(b.anchor, b.cursor) !== 0) {
          b.cursor = deleteRange(b.lines, b.anchor, b.cursor);
          b.anchor = null;
        }
        const line = b.lines[b.cursor.line] ?? '';
        const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
        b.cursor = insertText(b.lines, b.cursor, `\n${indent}`);
        b.error = null;
      }); },

    backspace: () =>
      { get().edit((b) => {
        snapshot(b);
        if (b.anchor && comparePos(b.anchor, b.cursor) !== 0) {
          b.cursor = deleteRange(b.lines, b.anchor, b.cursor);
          b.anchor = null;
          return;
        }
        if (b.cursor.col > 0) {
          b.cursor = deleteRange(b.lines, { line: b.cursor.line, col: b.cursor.col - 1 }, b.cursor);
        } else if (b.cursor.line > 0) {
          const prevLen = (b.lines[b.cursor.line - 1] ?? '').length;
          b.cursor = deleteRange(b.lines, { line: b.cursor.line - 1, col: prevLen }, b.cursor);
        } else {
          b.undo.pop();
        }
      }); },

    del: () =>
      { get().edit((b) => {
        snapshot(b);
        if (b.anchor && comparePos(b.anchor, b.cursor) !== 0) {
          b.cursor = deleteRange(b.lines, b.anchor, b.cursor);
          b.anchor = null;
          return;
        }
        const line = b.lines[b.cursor.line] ?? '';
        if (b.cursor.col < line.length) {
          deleteRange(b.lines, b.cursor, { line: b.cursor.line, col: b.cursor.col + 1 });
        } else if (b.cursor.line < b.lines.length - 1) {
          deleteRange(b.lines, b.cursor, { line: b.cursor.line + 1, col: 0 });
        } else {
          b.undo.pop();
        }
      }); },

    moveCursor: (to, extend) =>
      { get().edit((b) => {
        if (extend && !b.anchor) b.anchor = { ...b.cursor };
        if (!extend) b.anchor = null;
        b.cursor = clampPos(b.lines, to);
      }); },

    moveBy: (dLine, dCol, extend) =>
      { get().edit((b) => {
        if (extend && !b.anchor) b.anchor = { ...b.cursor };
        if (!extend) b.anchor = null;
        let { line, col } = b.cursor;
        if (dCol !== 0) {
          col += dCol;
          if (col < 0) {
            if (line > 0) {
              line -= 1;
              col = (b.lines[line] ?? '').length;
            } else col = 0;
          } else if (col > (b.lines[line] ?? '').length) {
            if (line < b.lines.length - 1) {
              line += 1;
              col = 0;
            } else col = (b.lines[line] ?? '').length;
          }
        }
        if (dLine !== 0) line += dLine;
        b.cursor = clampPos(b.lines, { line, col });
      }); },

    moveWord: (dir, extend) =>
      { get().edit((b) => {
        if (extend && !b.anchor) b.anchor = { ...b.cursor };
        if (!extend) b.anchor = null;
        const line = b.lines[b.cursor.line] ?? '';
        const col = dir === 1 ? wordEnd(line, b.cursor.col) : wordStart(line, b.cursor.col);
        b.cursor = clampPos(b.lines, { line: b.cursor.line, col });
      }); },

    home: (extend) =>
      { get().edit((b) => {
        if (extend && !b.anchor) b.anchor = { ...b.cursor };
        if (!extend) b.anchor = null;
        b.cursor = { line: b.cursor.line, col: 0 };
      }); },

    end: (extend) =>
      { get().edit((b) => {
        if (extend && !b.anchor) b.anchor = { ...b.cursor };
        if (!extend) b.anchor = null;
        b.cursor = { line: b.cursor.line, col: (b.lines[b.cursor.line] ?? '').length };
      }); },

    pageMove: (dir, extend, pageSize) =>
      { get().edit((b) => {
        if (extend && !b.anchor) b.anchor = { ...b.cursor };
        if (!extend) b.anchor = null;
        b.cursor = clampPos(b.lines, { line: b.cursor.line + dir * pageSize, col: b.cursor.col });
        b.scroll.line = Math.max(0, b.scroll.line + dir * pageSize);
      }); },

    gotoLine: (line) =>
      { get().edit((b) => {
        b.anchor = null;
        b.cursor = clampPos(b.lines, { line: line - 1, col: 0 });
      }); },

    selectAll: () =>
      { get().edit((b) => {
        b.anchor = { line: 0, col: 0 };
        b.cursor = {
          line: b.lines.length - 1,
          col: (b.lines[b.lines.length - 1] ?? '').length,
        };
      }); },

    copy: () => {
      const b = get().activeBuffer();
      if (!b?.anchor) return;
      const text = getRange(b.lines, b.anchor, b.cursor);
      set((s) => {
        s.clipboard = text;
      });
    },

    cut: () => {
      get().copy();
      get().edit((b) => {
        if (!b.anchor) return;
        snapshot(b);
        b.cursor = deleteRange(b.lines, b.anchor, b.cursor);
        b.anchor = null;
      });
    },

    paste: () => {
      const text = get().clipboard;
      if (!text) return;
      get().edit((b) => {
        snapshot(b);
        if (b.anchor && comparePos(b.anchor, b.cursor) !== 0) {
          b.cursor = deleteRange(b.lines, b.anchor, b.cursor);
          b.anchor = null;
        }
        b.cursor = insertText(b.lines, b.cursor, text);
      });
    },

    clearSelection: () =>
      { get().edit((b) => {
        if (!b.anchor) return;
        snapshot(b);
        b.cursor = deleteRange(b.lines, b.anchor, b.cursor);
        b.anchor = null;
      }); },

    undo: () =>
      { get().edit((b) => {
        const prev = b.undo.pop();
        if (!prev) return;
        b.redo.push({ lines: [...b.lines], cursor: { ...b.cursor } });
        b.lines = prev.lines;
        b.cursor = clampPos(prev.lines, prev.cursor);
        b.anchor = null;
      }); },

    redo: () =>
      { get().edit((b) => {
        const next = b.redo.pop();
        if (!next) return;
        b.undo.push({ lines: [...b.lines], cursor: { ...b.cursor } });
        b.lines = next.lines;
        b.cursor = clampPos(next.lines, next.cursor);
        b.anchor = null;
      }); },

    toggleInsert: () =>
      { get().edit((b) => {
        b.insert = !b.insert;
      }); },

    markSaved: (name, path) =>
      { set((s) => {
        const win = s.windows.find((w) => w.id === s.activeId);
        if (!win?.bufferId) return;
        const buf = s.buffers[win.bufferId];
        if (!buf) return;
        buf.modified = false;
        if (name) {
          buf.name = name;
          buf.path = path ?? name;
          win.title = name;
        }
      }); },

    setError: (line, message) =>
      { get().edit((b) => {
        b.error = { line, message };
        b.cursor = clampPos(b.lines, { line: line - 1, col: 0 });
      }); },

    clearError: () =>
      { get().edit((b) => {
        b.error = null;
      }); },

    setHighlight: (line) =>
      { get().edit((b) => {
        b.highlight = line;
        if (line !== null) b.cursor = clampPos(b.lines, { line: line - 1, col: b.cursor.col });
      }); },

    ensureVisible: (pageSize, pageCols) =>
      { get().edit((b) => {
        if (b.cursor.line < b.scroll.line) b.scroll.line = b.cursor.line;
        if (b.cursor.line > b.scroll.line + pageSize - 1) {
          b.scroll.line = b.cursor.line - pageSize + 1;
        }
        if (b.cursor.col < b.scroll.col) b.scroll.col = b.cursor.col;
        if (b.cursor.col > b.scroll.col + pageCols - 1) {
          b.scroll.col = b.cursor.col - pageCols + 1;
        }
        b.scroll.line = Math.max(0, Math.min(b.scroll.line, Math.max(0, b.lines.length - 1)));
        b.scroll.col = Math.max(0, b.scroll.col);
      }); },
  })),
);

export const bufferText = (b: Buffer): string => fromLines(b.lines);
export const selectionRange = (b: Buffer): [Pos, Pos] | null =>
  b.anchor && comparePos(b.anchor, b.cursor) !== 0 ? orderRange(b.anchor, b.cursor) : null;
