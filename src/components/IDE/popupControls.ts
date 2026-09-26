import { Screen } from '@/tui/Screen';
import { usePopupStore, historyGroup } from '@stores/popupStore';
import { useDialogStore, focusedControl, dialogFocusables } from '@stores/dialogStore';
import { useDesktopStore } from '@stores/desktopStore';
import { useCompilerStore } from '@stores/compilerStore';
import { isMenuItemDisabled, isSeparator, type MenuContext } from '@components/MenuBar/menuDefs';
import type { InputControl } from '@components/Dialogs/types';
import { EDITOR_LOCAL_MENU } from './localMenu';
import { runCommand } from './commands';

export function localMenuContext(): MenuContext {
  const desktop = useDesktopStore.getState(),
    compiler = useCompilerStore.getState();
  return {
    buffer: desktop.activeBuffer(),
    clipboard: desktop.clipboard,
    runtimeActive: ['running', 'waiting', 'paused'].includes(compiler.runtimeStatus),
    hasBytecode: Boolean(compiler.result?.bytecode),
  };
}

export function openInputHistory(control?: InputControl): boolean {
  const dialog = useDialogStore.getState().top();
  const target = control ?? (dialog ? focusedControl(dialog) : null);
  if (!dialog || target?.kind !== 'input' || target.history === false || target.readOnly)
    return false;
  const history = usePopupStore.getState().histories[historyGroup(dialog.def.id, target.id)] ?? [];
  const value = String(dialog.values[target.id] ?? '');
  const entries = history.length ? history : value ? [value] : [];
  if (!entries.length) return true;
  useDialogStore.getState().setFocus(dialogFocusables(dialog.def).indexOf(target));
  usePopupStore.getState().show({
    kind: 'history',
    entries: [...entries],
    selected: 0,
    horizontal: 0,
    dialogId: dialog.def.id,
    controlId: target.id,
    rect: {
      x: Math.max(0, dialog.def.rect.x + target.x - 1),
      y: Math.min(16, dialog.def.rect.y + target.y - 1),
      w: Math.min(60, target.w + 2),
      h: 8,
    },
  });
  return true;
}

export function inputHistoryHit(col: number, row: number): boolean {
  const dialog = useDialogStore.getState().top();
  if (!dialog) return false;
  for (const control of dialog.def.controls)
    if (control.kind === 'input' && control.history !== false && !control.readOnly) {
      const x = dialog.def.rect.x + control.x + control.w,
        y = dialog.def.rect.y + control.y;
      if (row === y && col >= x && col < x + 3) return openInputHistory(control);
    }
  return false;
}

function choosePopup(): void {
  const state = usePopupStore.getState(),
    popup = state.popup;
  if (!popup) return;
  if (popup.kind === 'history') {
    const value = popup.entries[popup.selected],
      dialog = useDialogStore.getState();
    if (value !== undefined && dialog.top()?.def.id === popup.dialogId) {
      dialog.setValue(popup.controlId, value);
      dialog.setCaret(value.length, true);
    }
    state.close();
  } else {
    const item = EDITOR_LOCAL_MENU[popup.selected];
    if (!item || isSeparator(item) || isMenuItemDisabled(item, localMenuContext())) return;
    state.close();
    runCommand(item.id);
  }
}

function movePopup(delta: number): void {
  const state = usePopupStore.getState(),
    popup = state.popup;
  if (!popup) return;
  const count = popup.kind === 'history' ? popup.entries.length : EDITOR_LOCAL_MENU.length;
  let selected = popup.selected;
  for (let i = 0; i < count; i++) {
    selected = (selected + delta + count) % count;
    if (popup.kind === 'history' || !isSeparator(EDITOR_LOCAL_MENU[selected]!)) break;
  }
  state.select(selected);
}

export function handlePopupKey(event: KeyboardEvent): boolean {
  const state = usePopupStore.getState(),
    popup = state.popup;
  if (!popup) return false;
  if (event.key === 'Escape') state.close();
  else if (event.key === 'Enter') choosePopup();
  else if (event.key === 'ArrowUp') movePopup(-1);
  else if (event.key === 'ArrowDown') movePopup(1);
  else if (event.key === 'Home') state.select(0);
  else if (event.key === 'End')
    state.select(
      popup.kind === 'history' ? popup.entries.length - 1 : EDITOR_LOCAL_MENU.length - 1
    );
  else if (popup.kind === 'history' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
    state.scroll(event.key === 'ArrowRight' ? 1 : -1);
  else if (popup.kind === 'local' && event.key.length === 1) {
    const index = EDITOR_LOCAL_MENU.findIndex(
      (item) => !isSeparator(item) && Screen.hotKey(item.label) === event.key.toLowerCase()
    );
    if (index >= 0) {
      state.select(index);
      choosePopup();
    }
  }
  return true;
}

export function handlePopupMouse(col: number, row: number, activate: boolean): boolean {
  const state = usePopupStore.getState(),
    popup = state.popup;
  if (!popup) return false;
  const r = popup.rect;
  if (col < r.x || col >= r.x + r.w || row < r.y || row >= r.y + r.h) {
    if (activate) state.close();
    return true;
  }
  if (popup.kind === 'history' && row === r.y && col >= r.x + 2 && col <= r.x + 4) {
    if (activate) state.close();
    return true;
  }
  if (row > r.y && row < r.y + r.h - 1) {
    const top = popup.kind === 'history' ? Math.max(0, popup.selected - (r.h - 2) + 1) : 0;
    const index = top + row - r.y - 1;
    const valid =
      popup.kind === 'history'
        ? index < popup.entries.length
        : EDITOR_LOCAL_MENU[index] && !isSeparator(EDITOR_LOCAL_MENU[index]);
    if (valid) {
      state.select(index);
      if (activate) choosePopup();
    }
  }
  return true;
}
