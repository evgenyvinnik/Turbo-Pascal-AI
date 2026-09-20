import { currentMenus } from '@components/MenuBar/currentMenus';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Screen } from '@/tui/Screen';
import { TextScreen, type CellEvent } from '@/tui/TextScreen';
import { isMenuItemDisabled, isSeparator, menuBarPositions } from '@components/MenuBar/menuDefs';
import { DosWorkspace } from '@components/DosWorkspace/DosWorkspace';
import { menuBarHit, popupRect, popupScrollOffset, submenuRect } from '@components/MenuBar/paintMenuBar';
import { clientRect } from '@components/Window/paintWindow';
import { GraphicsCanvas } from '@components/GraphicsCanvas';
import { paintScreen } from './paintScreen';
import { helpLines, runCommand } from './commands';
import { handleDialogKey, handleEditorKey, handleMenuKey, commandForShortcut, shortcutKey } from './useKeyboard';
import { useDesktopStore, type TPWindow } from '@stores/desktopStore';
import { useMenuStore } from '@stores/menuStore';
import { focusedControl, useDialogStore } from '@stores/dialogStore';
import { useCompilerStore } from '@stores/compilerStore';
import { useDebugStore } from '@stores/debugStore';
import { useIdeStore } from '@stores/ideStore';
import { useProgramScreenStore } from '@stores/programScreenStore';
import { ProgramTextScreen } from './ProgramTextScreen';
import { ProgramFileDrop } from './ProgramFileDrop';
import { usePopupStore } from '@stores/popupStore';
import { EDITOR_LOCAL_MENU, openLocalMenu } from './localMenu';
import { handlePopupKey, handlePopupMouse, inputHistoryHit } from './popupControls';
import { handleProgramScreenKey } from './runtimeSession';
import { formatDebugValue } from '@compiler/runtime/SourceDebugger';
import { followHelpLine, getHelpLines, isReferenceHelp, navigateHelp } from './helpNavigation';
import { useWorkspaceStore } from '@stores/workspaceStore';
import { dismissWorkspaceNotice, initializeWorkspace, retryWorkspace } from './workspacePersistence';

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
  return formatDebugValue(value);
};

const contains = (w: TPWindow, col: number, row: number) =>
  col >= w.rect.x && col < w.rect.x + w.rect.w && row >= w.rect.y && row < w.rect.y + w.rect.h;

export function IDE() {
  const windows = useDesktopStore((s) => s.windows);
  const buffers = useDesktopStore((s) => s.buffers);
  const activeId = useDesktopStore((s) => s.activeId);
  const clipboard = useDesktopStore((s) => s.clipboard);
  const workspace = useWorkspaceStore();

  const menu = useMenuStore((s) => s);
  const popup = usePopupStore((s) => s.popup);
  const dialogs = useDialogStore((s) => s.stack);

  const programOutput = useCompilerStore((s) => s.programOutput);
  const runtimeStatus = useCompilerStore((s) => s.runtimeStatus);
  const hasBytecode = useCompilerStore((s) => Boolean(s.result?.bytecode));
  const runtimeActive = runtimeStatus === 'running' || runtimeStatus === 'waiting' || runtimeStatus === 'paused';
  const compileMessages = useCompilerStore((s) => s.messages);
  const watches = useDebugStore((s) => s.watches);
  const callStack = useDebugStore((s) => s.callStack);
  const breakpoints = useDebugStore((s) => s.breakpoints);
  const registers = useDebugStore((s) => s.registers);
  const helpTopic = useIdeStore((s) => s.helpTopic);
  const configuredTools = useIdeStore((s) => s.tools);
  const programTextVisible = useProgramScreenStore((s) => s.visible && s.kind === 'text');

  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    void initializeWorkspace();
  }, []);

  const tools = useMemo(
    () => ({
      output: programOutput.length ? programOutput : [],
      watches: watches.map((w) => `${w.expression}: ${formatWatch(w.value)}`),
      callstack: callStack.map((f) => f.label ?? f.name),
      messages: compileMessages,
      help: helpLines(helpTopic),
      helpTopic,
      registers: [...(['pc', 'sp', 'mp', 'np', 'ep'] as const).map((name) => `${name.toUpperCase()} ${registers[name].toString(16).toUpperCase().padStart(4, '0')}`), '', 'P-machine'],
    }),
    [programOutput, watches, callStack, compileMessages, helpTopic, registers],
  );

  const hint = useMemo(() => {
    if (workspace.conflict) return 'Other tab changed. Ctrl+Shift+S keeps this tab; backs up other.';
    if (workspace.status === 'error') return workspace.ready
      ? 'Workspace not saved. Ctrl+Shift+S retries.'
      : 'Workspace could not be opened. Ctrl+Shift+S retries.';
    if (!workspace.ready) return 'Restoring workspace...';
    if (workspace.notice) return workspace.notice;
    if (popup?.kind === 'local') {
      const item = EDITOR_LOCAL_MENU[popup.selected];
      if (item && !isSeparator(item)) return item.hint;
    }
    const top = dialogs[dialogs.length - 1];
    if (top) {
      if (top.def.id === 'compiling' || top.def.id === 'program-arguments') return null;
      const c = focusedControl(top);
      if (c?.kind === 'checks' || c?.kind === 'radios') return c.items[top.clusterRow]?.hint ?? c.hint;
      return c && 'hint' in c ? c.hint : 'Close this dialog box';
    }
    if (menu.open) {
      const items = currentMenus()[menu.menuIndex]?.items ?? [];
      const node = items[menu.itemIndex];
      if (node && !isSeparator(node)) {
        if (menu.subOpen && node.submenu) return node.submenu[menu.subIndex]?.hint ?? node.hint;
        return node.hint;
      }
    }
    return null;
  }, [dialogs, menu, popup, configuredTools, workspace.ready, workspace.status, workspace.notice, workspace.conflict]);

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
    popup,
    tools,
    hint,
    clipboard,
    runtimeActive,
    hasBytecode,
    breakpoints: [...breakpoints.values()].filter((point) => point.enabled),
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
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        retryWorkspace();
        return;
      }
      if (!useWorkspaceStore.getState().ready) { e.preventDefault(); return; }
      if (useWorkspaceStore.getState().notice) dismissWorkspaceNotice();
      if (shortcutKey(e) === 'ctrl+F2') {
        e.preventDefault();
        runCommand('run.reset');
        return;
      }
      if (handleProgramScreenKey(e)) { e.preventDefault(); return; }
      if (handlePopupKey(e)) { e.preventDefault(); return; }
      if (e.key === 'F1' && !useDialogStore.getState().top()?.def.anyKey) {
        e.preventDefault();
        const command = e.shiftKey ? 'help.index' : e.altKey ? 'help.previous' : e.ctrlKey ? 'help.topic' : useDialogStore.getState().top()?.def.id === 'context-help' || useDesktopStore.getState().activeWindow()?.kind === 'help' ? 'help.using' : 'help.context';
        runCommand(command);
        return;
      }
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

      if (useDesktopStore.getState().activeWindow()?.kind === 'help') {
        if (e.key === 'Escape') {
          e.preventDefault();
          useDesktopStore.getState().closeWindow();
          return;
        }
        if (e.key === 'F1' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          runCommand('help.using');
          return;
        }
        const desktop = useDesktopStore.getState();
        const help = desktop.activeWindow();
        if (!help) return;
        const lines = getHelpLines(useIdeStore.getState().helpTopic);
        if (navigateHelp(e.key === 'Tab' && e.shiftKey ? 'Shift+Tab' : e.key, pageSize)) { e.preventDefault(); return; }
        if (e.key === 'Enter') { e.preventDefault(); followHelpLine(lines[help.selected] ?? '', help.selected); return; }
      }

      const combo = shortcutKey(e);
      const command = commandForShortcut(combo);
      if (command) {
        e.preventDefault();
        runCommand(command);
        return;
      }

      if (e.altKey && !e.ctrlKey && e.key.length === 1) {
        const ch = e.key.toLowerCase();
        const idx = currentMenus().findIndex((m) => Screen.hotKey(m.label) === ch);
        if (idx >= 0) {
          e.preventDefault();
          useMenuStore.getState().openMenu(idx);
          return;
        }
      }

      const desktop = useDesktopStore.getState();
      const output = desktop.activeWindow();
      if (output?.kind === 'messages' && e.key === 'Enter') { e.preventDefault(); runCommand('tools.gotosource'); return; }
      if (output?.kind === 'callstack' && e.key === 'Enter') { e.preventDefault(); runCommand('debug.gotosource'); return; }
      if (output?.kind === 'watches' && e.key === 'Delete') {
        const watch = useDebugStore.getState().watches[output.selected];
        if (watch) useDebugStore.getState().removeWatch(watch.id);
        e.preventDefault(); return;
      }
      if ((output?.kind === 'callstack' || output?.kind === 'watches' || output?.kind === 'messages') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        desktop.setToolSelection(output.id, Math.max(0, output.selected + (e.key === 'ArrowDown' ? 1 : -1)));
        e.preventDefault(); return;
      }
      if (output?.kind === 'output') {
        const maxScroll = Math.max(0, useCompilerStore.getState().programOutput.length - pageSize);
        const offsets: Record<string, number> = {
          ArrowUp: -1,
          ArrowDown: 1,
          PageUp: -pageSize,
          PageDown: pageSize,
          Home: -output.scroll,
          End: maxScroll - output.scroll,
        };
        const offset = offsets[e.key];
        if (offset !== undefined) {
          e.preventDefault();
          desktop.scrollTool(output.id, Math.min(maxScroll, Math.max(0, output.scroll + offset)) - output.scroll);
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
      if (!useWorkspaceStore.getState().ready) return;
      if (useWorkspaceStore.getState().status === 'error' && !useWorkspaceStore.getState().conflict && e.row === 24 && e.col >= 11) {
        retryWorkspace();
        return;
      }
      if (useWorkspaceStore.getState().notice) dismissWorkspaceNotice();
      if (handlePopupMouse(e.col, e.row, true)) return;
      const d = useDesktopStore.getState();
      const dialogStore = useDialogStore.getState();
      const menuStore = useMenuStore.getState();
      const top = dialogStore.top();

      if (top) {
        if (inputHistoryHit(e.col, e.row)) return;
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
            } else if (control.kind === 'list' || control.kind === 'swatches') {
              dialogStore.setValue(control.id, hit.row);
            }
          }
          if (hit.activate && control?.kind === 'button') {
            if (control.result === 'help') runCommand('help.context');
            else dialogStore.close(control.result);
          }
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
        const items = currentMenus()[menuStore.menuIndex]?.items ?? [];
        const box = popupRect(items, menuBarPositions()[menuStore.menuIndex] ?? 0);
        const parent = items[menuStore.itemIndex];
        if (menuStore.subOpen && parent && !isSeparator(parent) && parent.submenu) {
          const subBox = submenuRect(parent.submenu, box, menuStore.itemIndex);
          if (e.col >= subBox.x && e.col < subBox.x + subBox.w && e.row > subBox.y && e.row < subBox.y + subBox.h - 1) {
            const node = parent.submenu[e.row - subBox.y - 1];
            if (node && !isMenuItemDisabled(node, { buffer: d.activeBuffer(), clipboard: d.clipboard, runtimeActive, hasBytecode, hasMessages: useCompilerStore.getState().messages.some((message) => /\(\d+\):/.test(message)) })) {
              menuStore.close();
              runCommand(node.id);
            }
            return;
          }
        }
        const inside =
          e.col >= box.x && e.col < box.x + box.w && e.row > box.y && e.row < box.y + box.h - 1;
        if (inside) {
          const index = e.row - box.y - 1 + popupScrollOffset(items, menuStore.itemIndex, box.h - 2);
          const node = items[index];
          if (node && !isSeparator(node) && !isMenuItemDisabled(node, { buffer: d.activeBuffer(), clipboard: d.clipboard, runtimeActive, hasBytecode, hasMessages: useCompilerStore.getState().messages.some((message) => /\(\d+\):/.test(message)) })) {
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
      if (e.button === 2 && win.kind === 'edit') { openLocalMenu(e.col, e.row); return; }

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
      if (win.kind === 'help') followHelpLine(getHelpLines(useIdeStore.getState().helpTopic)[win.scroll + e.row - client.y] ?? '', win.scroll + e.row - client.y, e.col - client.x - (isReferenceHelp(useIdeStore.getState().helpTopic) ? 0 : 1));
    },
    [painted.dialogHits, painted.statusHits, windows, activeId, runtimeActive, hasBytecode],
  );

  const onCellMove = useCallback((e: CellEvent) => {
    if (!useWorkspaceStore.getState().ready) return;
    if (handlePopupMouse(e.col, e.row, false)) return;
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
    if (!useWorkspaceStore.getState().ready) return;
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
    <div {...stylex.props(styles.root)} data-testid="workspace-status" data-status={workspace.status}
      data-workspace-ready={workspace.ready} data-workspace-error={workspace.error ?? undefined}>
      {programTextVisible ? <ProgramTextScreen /> : <TextScreen
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
      />}
      <GraphicsCanvas />
      <DosWorkspace />
      {workspace.ready && <ProgramFileDrop />}
    </div>
  );
}
