import { create } from 'zustand';
import type { Rect } from '@/tui/Screen';

export type Popup =
  | {
      kind: 'local';
      rect: Rect;
      selected: number;
    }
  | {
      kind: 'history';
      rect: Rect;
      selected: number;
      entries: string[];
      dialogId: string;
      controlId: string;
      horizontal: number;
    };

export const historyGroup = (dialogId: string, controlId: string): string =>
  ['open', 'saveas', 'primary'].includes(dialogId) && controlId === 'name'
    ? 'filename'
    : `${dialogId}:${controlId}`;

interface PopupState {
  popup: Popup | null;
  histories: Record<string, string[]>;
  show: (popup: Popup) => void;
  close: () => void;
  select: (selected: number) => void;
  scroll: (delta: number) => void;
  remember: (group: string, value: string) => void;
}

export const usePopupStore = create<PopupState>((set) => ({
  popup: null,
  histories: { filename: ['*.PAS'] },
  show: (popup) => {
    set({ popup });
  },
  close: () => {
    set({ popup: null });
  },
  select: (selected) => {
    set((state) => ({ popup: state.popup ? { ...state.popup, selected } : null }));
  },
  scroll: (delta) => {
    set((state) => ({
      popup:
        state.popup?.kind === 'history'
          ? { ...state.popup, horizontal: Math.max(0, state.popup.horizontal + delta) }
          : state.popup,
    }));
  },
  remember: (group, value) => {
    if (!value.trim()) return;
    set((state) => ({
      histories: {
        ...state.histories,
        [group]: [
          value,
          ...(state.histories[group] ?? []).filter((entry) => entry !== value),
        ].slice(0, 20),
      },
    }));
  },
}));
