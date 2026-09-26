import { useMenuStore } from '@stores/menuStore';
import { useDesktopStore } from '@stores/desktopStore';
import { usePopupStore } from '@stores/popupStore';
import { MENUS, type MenuEntry, type MenuNode, isSeparator } from '@components/MenuBar/menuDefs';

const item = (id: string): MenuEntry => {
  for (const menu of MENUS)
    for (const node of menu.items) if (!isSeparator(node) && node.id === id) return { ...node };
  throw new Error(`Missing local-menu command: ${id}`);
};

export const EDITOR_LOCAL_MENU: MenuNode[] = [
  { ...item('edit.cut'), hint: 'Remove the selected text and put it in the Clipboard' },
  item('edit.copy'),
  item('edit.paste'),
  item('edit.clear'),
  { separator: true },
  {
    id: 'file.openatcursor',
    label: 'Open ~f~ile at cursor',
    hint: 'Open the file name at the cursor in a new Edit window',
  },
  {
    id: 'help.topic',
    label: 'Topic ~s~earch',
    shortcut: 'Ctrl+F1',
    hint: 'Find help on the word at the cursor',
  },
  { separator: true },
  {
    id: 'debug.togglebreak',
    label: 'Toggle brea~k~point',
    shortcut: 'Ctrl+F8',
    hint: 'Set or clear a breakpoint on the current line',
  },
  {
    id: 'run.gotocursor',
    label: '~G~o to cursor',
    shortcut: 'F4',
    hint: 'Run the program to the line containing the cursor',
  },
  {
    id: 'debug.evaluate',
    label: '~E~valuate/modify...',
    shortcut: 'Ctrl+F4',
    hint: 'Evaluate or modify a program expression',
  },
  {
    id: 'debug.addwatch',
    label: '~A~dd watch...',
    shortcut: 'Ctrl+F7',
    hint: 'Add an expression to the Watches window',
  },
  { separator: true },
  { id: 'env.editor', label: '~O~ptions...', hint: 'Change editor options' },
];

export function openLocalMenu(col?: number, row?: number): void {
  const window = useDesktopStore.getState().activeWindow();
  if (window?.kind !== 'edit') return;
  useMenuStore.getState().close();
  usePopupStore.getState().show({
    kind: 'local',
    rect: {
      x: Math.max(0, Math.min(45, col ?? window.rect.x + 1)),
      y: Math.max(1, Math.min(8, row ?? window.rect.y + 1)),
      w: 33,
      h: 16,
    },
    selected: 0,
  });
}
