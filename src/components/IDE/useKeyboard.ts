import { Screen } from '@/tui/Screen';
import { MENUS, isSeparator } from '@components/MenuBar/menuDefs';
import { dialogFocusables, focusedControl, useDialogStore } from '@stores/dialogStore';
import { useDesktopStore } from '@stores/desktopStore';
import { useMenuStore } from '@stores/menuStore';
import { runCommand } from './commands';

/** Function-key and Alt/Ctrl accelerators, exactly as the IDE shows them. */
export const SHORTCUTS: Record<string, string> = {
  F1: 'help.contents',
  F2: 'file.save',
  F3: 'file.open',
  F4: 'run.gotocursor',
  F5: 'window.zoom',
  F6: 'window.next',
  F7: 'run.trace',
  F8: 'run.stepover',
  F9: 'compile.make',
  'shift+F1': 'help.index',
  'shift+F2': 'tools.grep',
  'shift+F3': 'tools.tasm',
  'shift+F4': 'tools.tdebug',
  'shift+F5': 'tools.tprof',
  'shift+F6': 'window.previous',
  'ctrl+F1': 'help.topic',
  'ctrl+F2': 'run.reset',
  'ctrl+F3': 'debug.callstack',
  'ctrl+F4': 'debug.evaluate',
  'ctrl+F7': 'debug.addwatch',
  'ctrl+F9': 'run.run',
  'alt+F1': 'help.previous',
  'alt+F3': 'window.close',
  'alt+F5': 'debug.userscreen',
  'alt+F7': 'tools.prev',
  'alt+F8': 'tools.next',
  'alt+F9': 'compile.compile',
  'alt+F10': 'menu.local',
  'alt+x': 'file.exit',
  'alt+0': 'window.list',
};

export const shortcutKey = (e: KeyboardEvent): string => {
  const mods = `${e.altKey ? 'alt+' : ''}${e.ctrlKey || e.metaKey ? 'ctrl+' : ''}${e.shiftKey ? 'shift+' : ''}`;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return `${mods}${key}`;
};

/** Menu navigation while a menu is dropped down. */
export function handleMenuKey(e: KeyboardEvent): boolean {
  const m = useMenuStore.getState();
  const menu = MENUS[m.menuIndex];
  if (!menu) return false;

  switch (e.key) {
    case 'Escape':
      if (m.subOpen) m.closeSub();
      else m.close();
      return true;
    case 'ArrowLeft':
      if (m.subOpen) m.closeSub();
      else m.moveMenu(-1);
      return true;
    case 'ArrowRight': {
      const node = menu.items[m.itemIndex];
      if (!m.subOpen && node && !isSeparator(node) && node.submenu) m.openSub();
      else m.moveMenu(1);
      return true;
    }
    case 'ArrowUp':
      if (m.subOpen) m.moveSub(-1);
      else m.moveItem(-1);
      return true;
    case 'ArrowDown':
      if (m.subOpen) m.moveSub(1);
      else m.moveItem(1);
      return true;
    case 'Enter': {
      const node = m.current();
      if (!node || node.disabled) return true;
      if (node.submenu && !m.subOpen) {
        m.openSub();
        return true;
      }
      m.close();
      runCommand(node.id);
      return true;
    }
    default:
      break;
  }

  if (e.key.length === 1) {
    const ch = e.key.toLowerCase();
    const items = m.subOpen
      ? ((menu.items[m.itemIndex] as { submenu?: typeof menu.items }).submenu ?? [])
      : menu.items;
    const idx = items.findIndex((n) => !isSeparator(n) && Screen.hotKey(n.label) === ch);
    if (idx >= 0) {
      const node = items[idx];
      if (node && !isSeparator(node) && !node.disabled) {
        if (node.submenu) {
          m.setItem(idx);
          m.openSub();
          return true;
        }
        m.close();
        runCommand(node.id);
      }
      return true;
    }
  }
  return false;
}

/** Keyboard handling inside a modal dialog box. */
export function handleDialogKey(e: KeyboardEvent): boolean {
  const store = useDialogStore.getState();
  const top = store.top();
  if (!top) return false;

  if (top.def.anyKey) {
    store.close('ok');
    return true;
  }

  const controls = dialogFocusables(top.def);
  const control = focusedControl(top);

  if (e.key === 'Escape') {
    store.close('cancel');
    return true;
  }

  if (e.key === 'Tab') {
    store.moveFocus(e.shiftKey ? -1 : 1);
    return true;
  }

  if (e.key === 'Enter') {
    if (control?.kind === 'button') store.close(control.result);
    else {
      const def = controls.find((c) => c.kind === 'button' && c.default);
      store.close(def && def.kind === 'button' ? def.result : 'ok');
    }
    return true;
  }

  if (control?.kind === 'input') {
    const value = String(top.values[control.id] ?? '');
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const next = top.selectAll ? e.key : value.slice(0, top.caret) + e.key + value.slice(top.caret);
      store.setValue(control.id, next);
      store.setCaret(top.selectAll ? 1 : top.caret + 1);
      return true;
    }
    if (e.key === 'Backspace') {
      if (top.selectAll) {
        store.setValue(control.id, '');
        store.setCaret(0);
      } else if (top.caret > 0) {
        store.setValue(control.id, value.slice(0, top.caret - 1) + value.slice(top.caret));
        store.setCaret(top.caret - 1);
      }
      return true;
    }
    if (e.key === 'Delete') {
      store.setValue(control.id, value.slice(0, top.caret) + value.slice(top.caret + 1));
      store.setCaret(top.caret);
      return true;
    }
    if (e.key === 'ArrowLeft') {
      store.setCaret(Math.max(0, top.caret - 1));
      return true;
    }
    if (e.key === 'ArrowRight') {
      store.setCaret(Math.min(value.length, top.caret + 1));
      return true;
    }
    if (e.key === 'Home') {
      store.setCaret(0);
      return true;
    }
    if (e.key === 'End') {
      store.setCaret(value.length);
      return true;
    }
  }

  if (control?.kind === 'checks' || control?.kind === 'radios') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const next = top.clusterRow + dir;
      if (next < 0 || next >= control.items.length) store.moveFocus(dir === 1 ? 1 : -1);
      else {
        store.setClusterRow(next);
        if (control.kind === 'radios') store.setValue(control.id, next);
      }
      return true;
    }
    if (e.key === ' ') {
      if (control.kind === 'radios') store.setValue(control.id, top.clusterRow);
      else {
        const current = [...((top.values[control.id] as boolean[] | undefined) ?? [])];
        current[top.clusterRow] = !current[top.clusterRow];
        store.setValue(control.id, current);
      }
      return true;
    }
  }

  if (control?.kind === 'list') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const n = control.items.length;
      const next = Math.max(0, Math.min(n - 1, Number(top.values[control.id] ?? 0) + dir));
      store.setValue(control.id, next);
      return true;
    }
  }

  if (e.altKey && e.key.length === 1) {
    const ch = e.key.toLowerCase();
    const idx = controls.findIndex((c) => {
      const label = c.kind === 'button' ? c.label : '';
      return label && Screen.hotKey(label) === ch;
    });
    if (idx >= 0) {
      const c = controls[idx];
      if (c?.kind === 'button') {
        store.close(c.result);
        return true;
      }
    }
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    store.moveFocus(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
    return true;
  }

  return true;
}

/** Editing keys for the focused Edit window. */
export function handleEditorKey(e: KeyboardEvent, pageSize: number, pageCols: number): boolean {
  const d = useDesktopStore.getState();
  const win = d.activeWindow();
  if (!win || win.kind !== 'edit') return false;
  const shift = e.shiftKey;
  const ctrl = e.ctrlKey || e.metaKey;

  const after = () => { d.ensureVisible(pageSize, pageCols); };

  switch (e.key) {
    case 'ArrowLeft':
      if (ctrl) d.moveWord(-1, shift);
      else d.moveBy(0, -1, shift);
      after();
      return true;
    case 'ArrowRight':
      if (ctrl) d.moveWord(1, shift);
      else d.moveBy(0, 1, shift);
      after();
      return true;
    case 'ArrowUp':
      d.moveBy(-1, 0, shift);
      after();
      return true;
    case 'ArrowDown':
      d.moveBy(1, 0, shift);
      after();
      return true;
    case 'Home':
      d.home(shift);
      after();
      return true;
    case 'End':
      d.end(shift);
      after();
      return true;
    case 'PageUp':
      d.pageMove(-1, shift, pageSize);
      after();
      return true;
    case 'PageDown':
      d.pageMove(1, shift, pageSize);
      after();
      return true;
    case 'Enter':
      d.newline();
      after();
      return true;
    case 'Backspace':
      d.backspace();
      after();
      return true;
    case 'Delete':
      if (shift) d.cut();
      else if (ctrl) d.clearSelection();
      else d.del();
      after();
      return true;
    case 'Insert':
      if (ctrl) d.copy();
      else if (shift) d.paste();
      else d.toggleInsert();
      after();
      return true;
    case 'Tab':
      d.typeText('  ');
      after();
      return true;
    case 'Escape':
      d.moveCursor(d.activeBuffer()?.cursor ?? { line: 0, col: 0 }, false);
      return true;
    default:
      break;
  }

  if (ctrl && e.key.toLowerCase() === 'y') {
    d.edit((b) => {
      if (b.lines.length > 1) b.lines.splice(b.cursor.line, 1);
      else b.lines[0] = '';
      b.cursor = { line: Math.min(b.cursor.line, b.lines.length - 1), col: 0 };
      b.modified = true;
    });
    return true;
  }

  if (e.key.length === 1 && !ctrl && !e.altKey) {
    d.typeText(e.key);
    after();
    return true;
  }
  return false;
}
