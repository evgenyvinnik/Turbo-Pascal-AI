import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { isFocusable, type Control, type DialogDef } from '@components/Dialogs/types';
import { usePopupStore, historyGroup } from './popupStore';
import { COLOR_ITEMS } from '@components/Dialogs/dialogDefs';

export type DialogValues = Record<string, string | number | boolean[]>;

export interface OpenDialog {
  def: DialogDef;
  values: DialogValues;
  focus: number;
  /** Caret offset inside the focused input. */
  caret: number;
  /** A freshly focused input shows its text selected, like Turbo Vision. */
  selectAll: boolean;
  /** Highlighted row inside the focused check box or radio button cluster. */
  clusterRow: number;
  onClose?: ((result: string, values: DialogValues) => void) | undefined;
}

interface DialogState {
  stack: OpenDialog[];
}

const focusables = (def: DialogDef): Control[] => def.controls.filter(isFocusable);

interface DialogActions {
  open: (
    def: DialogDef,
    values?: DialogValues,
    onClose?: (result: string, values: DialogValues) => void
  ) => void;
  close: (result: string) => void;
  closeAll: () => void;
  top: () => OpenDialog | null;
  setValue: (id: string, value: string | number | boolean[]) => void;
  setFocus: (index: number) => void;
  moveFocus: (dir: 1 | -1) => void;
  setCaret: (caret: number, selectAll?: boolean) => void;
  setClusterRow: (row: number) => void;
}

export const useDialogStore = create<DialogState & DialogActions>()(
  immer((set, get) => ({
    stack: [],

    open: (def, values = {}, onClose) => {
      set((s) => {
        const initial: DialogValues = {};
        for (const c of def.controls) {
          if (c.kind === 'input') initial[c.id] = '';
          if (c.kind === 'checks') initial[c.id] = c.items.map(() => false);
          if (c.kind === 'radios' || c.kind === 'list' || c.kind === 'swatches') initial[c.id] = 0;
        }
        const merged = { ...initial, ...values };
        const list = focusables(def);
        const wanted = def.focus ? list.findIndex((c) => 'id' in c && c.id === def.focus) : 0;
        const focus = Math.max(0, wanted);
        const first = list[focus];
        s.stack.push({
          def,
          values: merged,
          focus,
          caret: first?.kind === 'input' ? String(merged[first.id] ?? '').length : 0,
          selectAll: true,
          clusterRow: first?.kind === 'radios' ? Number(merged[first.id] ?? 0) : 0,
          onClose,
        });
      });
    },

    close: (result) => {
      const top = get().stack[get().stack.length - 1];
      if (top && result !== 'cancel' && result !== 'help')
        for (const control of top.def.controls)
          if (control.kind === 'input' && control.history !== false && !control.readOnly)
            usePopupStore
              .getState()
              .remember(historyGroup(top.def.id, control.id), String(top.values[control.id] ?? ''));
      usePopupStore.getState().close();
      set((s) => {
        s.stack.pop();
      });
      top?.onClose?.(result, top.values);
    },

    closeAll: () => {
      set((s) => {
        s.stack = [];
      });
    },

    top: () => get().stack[get().stack.length - 1] ?? null,

    setValue: (id, value) => {
      set((s) => {
        const top = s.stack[s.stack.length - 1];
        if (top) {
          top.values[id] = value;
          if (top.def.id === 'colors' && (id === 'group' || id === 'item')) {
            const group = Number(top.values.group ?? 4);
            if (id === 'group') {
              top.values.item = 0;
              const list = top.def.controls.find(
                (control) => control.kind === 'list' && control.id === 'item'
              );
              if (list?.kind === 'list')
                list.items =
                  group === 2
                    ? ['Frame passive', 'Frame active', 'Frame icons', 'Normal text', 'Status line']
                    : group === 4
                      ? [...COLOR_ITEMS]
                      : COLOR_ITEMS.slice(0, 7);
            }
            const item = Number(top.values.item ?? 0);
            const color =
              group === 4
                ? [
                    [7, 1],
                    [15, 1],
                    [10, 1],
                    [1, 3],
                    [1, 3],
                    [14, 1],
                    [0, 3],
                    [14, 4],
                    [15, 4],
                    [0, 3],
                  ][item]
                : group === 2
                  ? [0, 7]
                  : [1, 3];
            top.values.foreground = color?.[0] ?? 7;
            top.values.background = color?.[1] ?? 1;
          }
        }
      });
    },

    setFocus: (index) => {
      set((s) => {
        const top = s.stack[s.stack.length - 1];
        if (!top) return;
        const list = focusables(top.def);
        if (!list.length) return;
        top.focus = (index + list.length) % list.length;
        const c = list[top.focus];
        if (c?.kind === 'input') {
          top.caret = String(top.values[c.id] ?? '').length;
          top.selectAll = true;
        }
        top.clusterRow = c?.kind === 'radios' ? Number(top.values[c.id] ?? 0) : 0;
      });
    },

    moveFocus: (dir) => {
      const top = get().stack[get().stack.length - 1];
      if (!top) return;
      get().setFocus(top.focus + dir);
    },

    setClusterRow: (row) => {
      set((s) => {
        const top = s.stack[s.stack.length - 1];
        if (top) top.clusterRow = Math.max(0, row);
      });
    },

    setCaret: (caret, selectAll = false) => {
      set((s) => {
        const top = s.stack[s.stack.length - 1];
        if (!top) return;
        top.caret = Math.max(0, caret);
        top.selectAll = selectAll;
      });
    },
  }))
);

export const focusedControl = (d: OpenDialog): Control | null => focusables(d.def)[d.focus] ?? null;

export const dialogFocusables = focusables;
