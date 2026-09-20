import { currentMenus } from '@components/MenuBar/currentMenus';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { isSeparator, type MenuEntry } from '@components/MenuBar/menuDefs';

interface MenuState {
  open: boolean;
  menuIndex: number;
  itemIndex: number;
  subIndex: number;
  subOpen: boolean;
}

const firstSelectable = (items: readonly unknown[], from: number, dir: 1 | -1): number => {
  const n = items.length;
  let i = from;
  for (let k = 0; k < n; k += 1) {
    const node = items[i] as never;
    if (!isSeparator(node)) return i;
    i = (i + dir + n) % n;
  }
  return from;
};

interface MenuActions {
  openMenu: (index: number) => void;
  close: () => void;
  moveMenu: (dir: 1 | -1) => void;
  moveItem: (dir: 1 | -1) => void;
  setItem: (index: number) => void;
  setMenu: (index: number) => void;
  openSub: () => void;
  closeSub: () => void;
  moveSub: (dir: 1 | -1) => void;
  setSub: (index: number) => void;
  current: () => MenuEntry | null;
}

export const useMenuStore = create<MenuState & MenuActions>()(
  immer((set, get) => ({
    open: false,
    menuIndex: 0,
    itemIndex: 0,
    subIndex: 0,
    subOpen: false,

    openMenu: (index) =>
      { set((s) => {
        s.open = true;
        s.menuIndex = Math.max(0, Math.min(currentMenus().length - 1, index));
        const items = currentMenus()[s.menuIndex]?.items ?? [];
        s.itemIndex = firstSelectable(items, 0, 1);
        s.subOpen = false;
        s.subIndex = 0;
      }); },

    close: () =>
      { set((s) => {
        s.open = false;
        s.subOpen = false;
      }); },

    setMenu: (index) =>
      { set((s) => {
        if (index === s.menuIndex) return;
        s.menuIndex = Math.max(0, Math.min(currentMenus().length - 1, index));
        const items = currentMenus()[s.menuIndex]?.items ?? [];
        s.itemIndex = firstSelectable(items, 0, 1);
        s.subOpen = false;
      }); },

    moveMenu: (dir) =>
      { set((s) => {
        s.menuIndex = (s.menuIndex + dir + currentMenus().length) % currentMenus().length;
        const items = currentMenus()[s.menuIndex]?.items ?? [];
        s.itemIndex = firstSelectable(items, 0, 1);
        s.subOpen = false;
      }); },

    moveItem: (dir) =>
      { set((s) => {
        const items = currentMenus()[s.menuIndex]?.items ?? [];
        if (!items.length) return;
        const next = (s.itemIndex + dir + items.length) % items.length;
        s.itemIndex = firstSelectable(items, next, dir);
      }); },

    setItem: (index) =>
      { set((s) => {
        const items = currentMenus()[s.menuIndex]?.items ?? [];
        if (index < 0 || index >= items.length) return;
        const node = items[index];
        if (node && isSeparator(node)) return;
        s.itemIndex = index;
        s.subOpen = false;
      }); },

    openSub: () =>
      { set((s) => {
        s.subOpen = true;
        s.subIndex = 0;
      }); },

    closeSub: () =>
      { set((s) => {
        s.subOpen = false;
      }); },

    moveSub: (dir) =>
      { set((s) => {
        const items = currentMenus()[s.menuIndex]?.items ?? [];
        const node = items[s.itemIndex];
        const sub = node && !isSeparator(node) ? (node.submenu ?? []) : [];
        if (!sub.length) return;
        s.subIndex = (s.subIndex + dir + sub.length) % sub.length;
      }); },

    setSub: (index) =>
      { set((s) => {
        s.subIndex = Math.max(0, index);
      }); },

    current: () => {
      const s = get();
      const items = currentMenus()[s.menuIndex]?.items ?? [];
      const node = items[s.itemIndex];
      if (!node || isSeparator(node)) return null;
      if (s.subOpen && node.submenu) return node.submenu[s.subIndex] ?? null;
      return node;
    },
  })),
);
