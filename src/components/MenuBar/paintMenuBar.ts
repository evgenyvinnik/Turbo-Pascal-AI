import { Screen, type Rect } from '@/tui/Screen';
import { SUBMENU_MARK, SINGLE, TEE_LEFT, TEE_RIGHT } from '@/tui/chars';
import { TP } from '@styles/tpTheme';
import { MENUS, isSeparator, menuBarPositions, type MenuNode } from './menuDefs';

export interface MenuPaintState {
  open: boolean;
  menuIndex: number;
  itemIndex: number;
  subOpen: boolean;
  subIndex: number;
}

/** Widest `label + gap + shortcut` in the popup, i.e. the content column. */
export const contentWidth = (items: MenuNode[]): number =>
  items.reduce((max, node) => {
    if (isSeparator(node)) return max;
    const label = Screen.plainLength(node.label);
    const extra = node.shortcut ? node.shortcut.length + 2 : node.submenu ? 2 : 0;
    return Math.max(max, label + extra);
  }, 0);

export const popupRect = (items: MenuNode[], anchorX: number): Rect => {
  const boxW = contentWidth(items) + 6;
  const x = Math.max(0, Math.min(80 - boxW, anchorX - 2));
  return { x, y: 1, w: boxW, h: items.length + 2 };
};

function paintPopup(scr: Screen, items: MenuNode[], box: Rect, selected: number): void {
  scr.fill(box, ' ', TP.menu);
  const frame: Rect = { x: box.x + 1, y: box.y, w: box.w - 2, h: box.h };
  scr.frame(frame, TP.menu, false);
  const contentX = frame.x + 2;
  const contentRight = frame.x + frame.w - 3;

  items.forEach((node, i) => {
    const y = frame.y + 1 + i;
    if (isSeparator(node)) {
      scr.put(frame.x, y, TEE_RIGHT, TP.menu);
      scr.hLine(frame.x + 1, y, frame.w - 2, SINGLE.t, TP.menu);
      scr.put(frame.x + frame.w - 1, y, TEE_LEFT, TP.menu);
      return;
    }
    const isSel = i === selected;
    const base = node.disabled
      ? isSel
        ? TP.menuDisabledSelected
        : TP.menuDisabled
      : isSel
        ? TP.menuSelected
        : TP.menu;
    if (isSel) {
      scr.fill({ x: frame.x + 1, y, w: frame.w - 2, h: 1 }, ' ', base);
    }
    scr.writeHot(contentX, y, node.label, base, node.disabled ? base.fg : TP.menuHot);
    if (node.shortcut) {
      scr.write(contentRight - node.shortcut.length + 1, y, node.shortcut, base);
    } else if (node.submenu) {
      scr.put(contentRight, y, SUBMENU_MARK, base);
    }
  });

  scr.shadow(box);
}

/** Draws the top menu bar and, when open, the dropped-down menu and submenu. */
export function paintMenuBar(scr: Screen, state: MenuPaintState): void {
  scr.fill({ x: 0, y: 0, w: scr.cols, h: 1 }, ' ', TP.menuBar);
  const xs = menuBarPositions();

  MENUS.forEach((menu, i) => {
    const x = xs[i] ?? 0;
    const len = Screen.plainLength(menu.label);
    const selected = state.open && i === state.menuIndex;
    const base = selected ? TP.menuBarSelected : TP.menuBar;
    if (selected) scr.fill({ x: x - 1, y: 0, w: len + 2, h: 1 }, ' ', base);
    scr.writeHot(x, 0, menu.label, base, TP.menuBarHot);
  });

  if (!state.open) return;
  const menu = MENUS[state.menuIndex];
  if (!menu) return;
  const box = popupRect(menu.items, xs[state.menuIndex] ?? 0);
  paintPopup(scr, menu.items, box, state.itemIndex);

  if (!state.subOpen) return;
  const node = menu.items[state.itemIndex];
  if (!node || isSeparator(node) || !node.submenu) return;
  // Turbo Pascal drops the submenu just below its parent item, indented to the
  // parent's content column, covering whatever is left of the parent menu.
  const subItems: MenuNode[] = node.submenu;
  const subW = contentWidth(subItems) + 6;
  const subBox: Rect = {
    x: Math.max(0, Math.min(80 - subW, box.x + 3)),
    y: Math.min(24 - (subItems.length + 2), box.y + 2 + state.itemIndex),
    w: subW,
    h: subItems.length + 2,
  };
  paintPopup(scr, subItems, subBox, state.subIndex);
}

export const menuBarHit = (col: number): number => {
  const xs = menuBarPositions();
  for (let i = 0; i < MENUS.length; i += 1) {
    const x = xs[i] ?? 0;
    const len = Screen.plainLength(MENUS[i]?.label ?? '');
    if (col >= x - 1 && col <= x + len) return i;
  }
  return -1;
};
