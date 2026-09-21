import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type DialogType =
  | 'file-open'
  | 'file-save'
  | 'settings'
  | 'find-replace'
  | 'about'
  | 'goto-line'
  | 'find'
  | 'replace'
  | 'gotoLine'
  | 'compilerOptions'
  | 'editorOptions'
  | 'colors'
  | null;

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
}

export interface Notification {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error';
}

interface UIState {
  activeDialog: DialogType;
  dialogProps: Record<string, unknown>;
  menuOpen: string | null;
  contextMenu: { x: number; y: number; items: MenuItem[] } | null;
  isFullscreen: boolean;
  graphicsOverlayVisible: boolean;
  notifications: Notification[];
}

interface UIActions {
  openDialog: (type: DialogType, props?: Record<string, unknown>) => void;
  closeDialog: () => void;
  setDialog: (type: DialogType) => void;
  setMenuOpen: (menuId: string | null) => void;
  showContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  hideContextMenu: () => void;
  toggleFullscreen: () => void;
  showGraphicsOverlay: () => void;
  hideGraphicsOverlay: () => void;
  showNotification: (message: string, type: 'info' | 'warning' | 'error') => void;
  dismissNotification: (id: string) => void;
}

export const useUIStore = create<UIState & UIActions>()(
  immer((set) => ({
    activeDialog: null,
    dialogProps: {},
    menuOpen: null,
    contextMenu: null,
    isFullscreen: false,
    graphicsOverlayVisible: false,
    notifications: [],

    openDialog: (type, props = {}) => {
      set((state) => {
        state.activeDialog = type;
        state.dialogProps = props;
      });
    },

    closeDialog: () => {
      set((state) => {
        state.activeDialog = null;
        state.dialogProps = {};
      });
    },

    setDialog: (type) => {
      set((state) => {
        state.activeDialog = type;
        state.dialogProps = {};
      });
    },

    setMenuOpen: (menuId) => {
      set((state) => {
        state.menuOpen = menuId;
      });
    },

    showContextMenu: (x, y, items) => {
      set((state) => {
        state.contextMenu = { x, y, items };
      });
    },

    hideContextMenu: () => {
      set((state) => {
        state.contextMenu = null;
      });
    },

    toggleFullscreen: () => {
      set((state) => {
        state.isFullscreen = !state.isFullscreen;
      });
    },

    showGraphicsOverlay: () => {
      set((state) => {
        state.graphicsOverlayVisible = true;
      });
    },

    hideGraphicsOverlay: () => {
      set((state) => {
        state.graphicsOverlayVisible = false;
      });
    },

    showNotification: (message, type) => {
      set((state) => {
        state.notifications.push({
          id: `notif-${String(Date.now())}`,
          message,
          type,
        });
      });
    },

    dismissNotification: (id) => {
      set((state) => {
        state.notifications = state.notifications.filter((n) => n.id !== id);
      });
    },
  }))
);
