import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Screen } from '@/tui/Screen';
import { TextScreen, type CellEvent } from '@/tui/TextScreen';
import { MENUS, isSeparator, menuBarPositions } from '@components/MenuBar/menuDefs';
import { menuBarHit, popupRect } from '@components/MenuBar/paintMenuBar';
import { clientRect } from '@components/Window/paintWindow';
import { GraphicsCanvas } from '@components/GraphicsCanvas';
import { paintScreen } from './paintScreen';
import { helpLines, runCommand } from './commands';
import { handleDialogKey, handleEditorKey, handleMenuKey, SHORTCUTS, shortcutKey } from './useKeyboard';
import { useDesktopStore, type TPWindow } from '@stores/desktopStore';
import { useMenuStore } from '@stores/menuStore';
import { focusedControl, useDialogStore } from '@stores/dialogStore';
import { useCompilerStore } from '@stores/compilerStore';
import { useDebugStore } from '@stores/debugStore';
import { useIdeStore } from '@stores/ideStore';

const styles = stylex.create({
  root: {
    position: 'absolute',
    inset: 0,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
});

interface DragState {
  mode: 'move' | 'resize';
  id: string;
  offsetX: number;
  offsetY: number;
}

/** Watch values arrive from the VM as unknown; show something readable. */
const formatWatch = (value: unknown): string => {
  if (value === null || value === undefined) return 'Unknown identifier';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const contains = (w: TPWindow, col: number, row: number) =>
  col >= w.rect.x && col < w.rect.x + w.rect.w && row >= w.rect.y && row < w.rect.y + w.rect.h;

export function IDE() {
  const windows = useDesktopStore((s) => s.windows);
  const buffers = useDesktopStore((s) => s.buffers);
  const activeId = useDesktopStore((s) => s.activeId);
  const newFile = useDesktopStore((s) => s.newFile);

  const menu = useMenuStore((s) => s);
  const dialogs = useDialogStore((s) => s.stack);

  const programOutput = useCompilerStore((s) => s.programOutput);
  const compileMessages = useCompilerStore((s) => s.messages);
  const watches = useDebugStore((s) => s.watches);
  const callStack = useDebugStore((s) => s.callStack);
  const helpTopic = useIdeStore((s) => s.helpTopic);

  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    if (useDesktopStore.getState().windows.length === 0) newFile();
  }, [newFile]);

  const tools = useMemo(
    () => ({
      output: programOutput.length ? programOutput : [],
      watches: watches.map((w) => `${w.expression}: ${formatWatch(w.value)}`),
      callstack: callStack.map((f) => f.name),
      messages: compileMessages,
      help: helpLines(helpTopic),
    }),
    [programOutput, watches, callStack, compileMessages, helpTopic],
  );

  const hint = useMemo(() => {
    const top = dialogs[dialogs.length - 1];
    if (top) {
      const c = focusedControl(top);
      return c && 'hint' in c ? c.hint : 'Close this dialog box';
    }
    if (menu.open) {
      const items = MENUS[menu.menuIndex]?.items ?? [];
      const node = items[menu.itemIndex];
      if (node && !isSeparator(node)) {
        if (menu.subOpen && node.submenu) return node.submenu[menu.subIndex]?.hint ?? node.hint;
        return node.hint;
      }
    }
    return null;
  }, [dialogs, menu]);

  const painted = paintScreen({
    windows,
    buffers,
    activeId,
    menu: {
      open: menu.open,
      menuIndex: menu.menuIndex,
      itemIndex: menu.itemIndex,
      subOpen: menu.subOpen,
      subIndex: menu.subIndex,
    },
    dialogs,
    tools,
    hint,
  });

  const pageSize = useMemo(() => {
    const win = windows.find((w) => w.id === activeId);
    return win ? Math.max(1, clientRect(win.rect).h) : 21;
  }, [windows, activeId]);

  const pageCols = useMemo(() => {
    const win = windows.find((w) => w.id === activeId);
    return win ? Math.max(1, clientRect(win.rect).w) : 78;
  }, [windows, activeId]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (useDialogStore.getState().stack.length > 0) {
        if (handleDialogKey(e)) e.preventDefault();
        return;
      }

      if (useMenuStore.getState().open) {
        if (handleMenuKey(e)) e.preventDefault();
        return;
      }

      if (e.key === 'F10' && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        useMenuStore.getState().openMenu(0);
        return;
      }

      const combo = shortcutKey(e);
      const command = SHORTCUTS[combo];
      if (command) {
        e.preventDefault();
        runCommand(command);
        return;
      }

      if (e.altKey && !e.ctrlKey && e.key.length === 1) {
        const ch = e.key.toLowerCase();
        const idx = MENUS.findIndex((m) => Screen.hotKey(m.label) === ch);
        if (idx >= 0) {
          e.preventDefault();
          useMenuStore.getState().openMenu(idx);
          return;
        }
      }

      if (handleEditorKey(e, pageSize, pageCols)) e.preventDefault();
    },
    [pageSize, pageCols],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [onKeyDown]);

  const onCellDown = useCallback(
    (e: CellEvent) => {
      const d = useDesktopStore.getState();
      const dialogStore = useDialogStore.getState();
      const menuStore = useMenuStore.getState();
      const top = dialogStore.top();

      if (top) {
        const r = top.def.rect;
        if (e.row === r.y && e.col >= r.x + 2 && e.col <= r.x + 4 && !top.def.noClose) {
          dialogStore.close('cancel');
          return;
        }
        if (top.def.anyKey) {
          dialogStore.close('ok');
          return;
        }
        for (const hit of painted.dialogHits) {
          const inside =
            e.col >= hit.rect.x &&
            e.col < hit.rect.x + hit.rect.w &&
            e.row >= hit.rect.y &&
            e.row < hit.rect.y + hit.rect.h;
          if (!inside) continue;
          dialogStore.setFocus(hit.focusIndex);
          const refreshed = useDialogStore.getState().top();
          const control = refreshed ? focusedControl(refreshed) : null;
          if (hit.row !== undefined && control) {
            if (control.kind === 'radios') {
              dialogStore.setValue(control.id, hit.row);
              dialogStore.setClusterRow(hit.row);
            } else if (control.kind === 'checks') {
              const values = [...((top.values[control.id] as boolean[] | undefined) ?? [])];
              values[hit.row] = !values[hit.row];
              dialogStore.setValue(control.id, values);
              dialogStore.setClusterRow(hit.row);
            } else if (control.kind === 'list') {
              dialogStore.setValue(control.id, hit.row);
            }
          }
          if (hit.activate && control?.kind === 'button') dialogStore.close(control.result);
          return;
        }
        return;
      }

      if (e.row === 0) {
        const idx = menuBarHit(e.col);
        if (idx < 0) {
          menuStore.close();
          return;
        }
        if (menuStore.open && menuStore.menuIndex === idx) menuStore.close();
        else menuStore.openMenu(idx);
        return;
      }

      if (menuStore.open) {
        const items = MENUS[menuStore.menuIndex]?.items ?? [];
        const box = popupRect(items, menuBarPositions()[menuStore.menuIndex] ?? 0);
        const inside =
          e.col >= box.x && e.col < box.x + box.w && e.row > box.y && e.row < box.y + box.h - 1;
        if (inside) {
          const index = e.row - box.y - 1;
          const node = items[index];
          if (node && !isSeparator(node) && !node.disabled) {
            if (node.submenu) {
              menuStore.setItem(index);
              menuStore.openSub();
            } else {
              menuStore.close();
              runCommand(node.id);
            }
          }
          return;
        }
        menuStore.close();
        return;
      }

      if (e.row === 24) {
        for (const hit of painted.statusHits) {
          if (e.col >= hit.from && e.col <= hit.to) {
            runCommand(hit.command);
            return;
          }
        }
        return;
      }

      const win = [...windows].reverse().find((w) => contains(w, e.col, e.row));
      if (!win) return;
      if (win.id !== activeId) d.focusWindow(win.id);

      const r = win.rect;
      if (e.row === r.y) {
        if (e.col >= r.x + 2 && e.col <= r.x + 4) {
          d.closeWindow(win.id);
          return;
        }
        if (e.col >= r.x + r.w - 7 && e.col <= r.x + r.w - 3) {
          d.zoomActive();
          return;
        }
        drag.current = { mode: 'move', id: win.id, offsetX: e.col - r.x, offsetY: e.row - r.y };
        return;
      }

      if (e.row === r.y + r.h - 1 && e.col >= r.x + r.w - 2) {
        drag.current = { mode: 'resize', id: win.id, offsetX: 0, offsetY: 0 };
        return;
      }

      const client = clientRect(r);
      const inClient =
        e.col >= client.x &&
        e.col < client.x + client.w &&
        e.row >= client.y &&
        e.row < client.y + client.h;
      if (!inClient) return;

      if (win.kind === 'edit' && win.bufferId) {
        const buf = useDesktopStore.getState().buffers[win.bufferId];
        if (!buf) return;
        d.moveCursor(
          {
            line: buf.scroll.line + (e.row - client.y),
            col: buf.scroll.col + (e.col - client.x),
          },
          e.shift,
        );
        return;
      }
      d.setToolSelection(win.id, win.scroll + (e.row - client.y));
    },
    [painted.dialogHits, painted.statusHits, windows, activeId],
  );

  const onCellMove = useCallback((e: CellEvent) => {
    const state = drag.current;
    if (!state) return;
    const d = useDesktopStore.getState();
    const win = d.windows.find((w) => w.id === state.id);
    if (!win) return;
    if (state.mode === 'move') {
      d.setRect(win.id, {
        ...win.rect,
        x: e.col - state.offsetX,
        y: Math.max(1, e.row - state.offsetY),
      });
    } else {
      d.setRect(win.id, {
        ...win.rect,
        w: Math.max(12, e.col - win.rect.x + 1),
        h: Math.max(4, e.row - win.rect.y + 1),
      });
    }
  }, []);

  const onCellUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onWheel = useCallback((e: CellEvent & { deltaY: number }) => {
    const d = useDesktopStore.getState();
    const win = d.activeWindow();
    if (!win) return;
    const step = e.deltaY > 0 ? 3 : -3;
    if (win.kind === 'edit') {
      d.edit((b) => {
        b.scroll.line = Math.max(0, Math.min(b.lines.length - 1, b.scroll.line + step));
      });
      return;
    }
    d.scrollTool(win.id, step);
  }, []);

  return (
    <div {...stylex.props(styles.root)}>
      <TextScreen
        screen={painted.screen}
        cursor={
          painted.cursor
            ? { col: painted.cursor.col, row: painted.cursor.row, visible: true, fat: painted.cursor.fat }
            : null
        }
        onCellDown={onCellDown}
        onCellMove={onCellMove}
        onCellUp={onCellUp}
        onWheel={onWheel}
      />
      <GraphicsCanvas />
    </div>
  );
}
