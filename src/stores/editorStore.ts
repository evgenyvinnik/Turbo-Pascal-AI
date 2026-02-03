import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface Position {
  line: number;
  column: number;
}

export interface Selection {
  start: Position;
  end: Position;
}

export interface EditorFile {
  id: string;
  name: string;
  path: string;
  content: string;
  isDirty: boolean;
  cursorPosition: Position;
  scrollPosition: { x: number; y: number };
  selections: Selection[];
  undoStack: string[];
  redoStack: string[];
}

export interface EditorPane {
  id: string;
  activeFileId: string | null;
  openFileIds: string[];
}

export type LayoutMode = 'single' | 'split-horizontal' | 'split-vertical';

interface EditorState {
  files: Map<string, EditorFile>;
  panes: EditorPane[];
  activePaneId: string;
  layout: LayoutMode;
  insertMode: boolean;
}

interface EditorActions {
  openFile: (path: string, name: string, content: string) => void;
  closeFile: (fileId: string) => void;
  updateContent: (fileId: string, content: string) => void;
  setCursorPosition: (fileId: string, position: Position) => void;
  setScrollPosition: (fileId: string, position: { x: number; y: number }) => void;
  setSelection: (fileId: string, selections: Selection[]) => void;
  undo: (fileId: string) => void;
  redo: (fileId: string) => void;
  splitPane: (direction: 'horizontal' | 'vertical') => void;
  setActivePane: (paneId: string) => void;
  setActiveFile: (paneId: string, fileId: string) => void;
  toggleInsertMode: () => void;
  markClean: (fileId: string) => void;
}

const createFileId = (path: string): string => {
  return btoa(path).replace(/[^a-zA-Z0-9]/g, '');
};

export const useEditorStore = create<EditorState & EditorActions>()(
  immer((set, _get) => ({
    files: new Map(),
    panes: [{ id: 'main', activeFileId: null, openFileIds: [] }],
    activePaneId: 'main',
    layout: 'single',
    insertMode: true,

    openFile: (path, name, content) =>
      set((state) => {
        const id = createFileId(path);
        if (!state.files.has(id)) {
          state.files.set(id, {
            id,
            name,
            path,
            content,
            isDirty: false,
            cursorPosition: { line: 1, column: 1 },
            scrollPosition: { x: 0, y: 0 },
            selections: [],
            undoStack: [],
            redoStack: [],
          });
        }
        const pane = state.panes.find((p) => p.id === state.activePaneId);
        if (pane && !pane.openFileIds.includes(id)) {
          pane.openFileIds.push(id);
        }
        if (pane) {
          pane.activeFileId = id;
        }
      }),

    closeFile: (fileId) =>
      set((state) => {
        state.files.delete(fileId);
        for (const pane of state.panes) {
          pane.openFileIds = pane.openFileIds.filter((id) => id !== fileId);
          if (pane.activeFileId === fileId) {
            pane.activeFileId = pane.openFileIds[0] ?? null;
          }
        }
      }),

    updateContent: (fileId, content) =>
      set((state) => {
        const file = state.files.get(fileId);
        if (file) {
          file.undoStack.push(file.content);
          file.redoStack = [];
          file.content = content;
          file.isDirty = true;
        }
      }),

    setCursorPosition: (fileId, position) =>
      set((state) => {
        const file = state.files.get(fileId);
        if (file) {
          file.cursorPosition = position;
        }
      }),

    setScrollPosition: (fileId, position) =>
      set((state) => {
        const file = state.files.get(fileId);
        if (file) {
          file.scrollPosition = position;
        }
      }),

    setSelection: (fileId, selections) =>
      set((state) => {
        const file = state.files.get(fileId);
        if (file) {
          file.selections = selections;
        }
      }),

    undo: (fileId) =>
      set((state) => {
        const file = state.files.get(fileId);
        if (file && file.undoStack.length > 0) {
          const previousContent = file.undoStack.pop()!;
          file.redoStack.push(file.content);
          file.content = previousContent;
        }
      }),

    redo: (fileId) =>
      set((state) => {
        const file = state.files.get(fileId);
        if (file && file.redoStack.length > 0) {
          const nextContent = file.redoStack.pop()!;
          file.undoStack.push(file.content);
          file.content = nextContent;
        }
      }),

    splitPane: (direction) =>
      set((state) => {
        state.layout = direction === 'horizontal' ? 'split-horizontal' : 'split-vertical';
        if (state.panes.length === 1) {
          state.panes.push({
            id: 'secondary',
            activeFileId: null,
            openFileIds: [],
          });
        }
      }),

    setActivePane: (paneId) =>
      set((state) => {
        state.activePaneId = paneId;
      }),

    setActiveFile: (paneId, fileId) =>
      set((state) => {
        const pane = state.panes.find((p) => p.id === paneId);
        if (pane) {
          pane.activeFileId = fileId;
        }
      }),

    toggleInsertMode: () =>
      set((state) => {
        state.insertMode = !state.insertMode;
      }),

    markClean: (fileId) =>
      set((state) => {
        const file = state.files.get(fileId);
        if (file) {
          file.isDirty = false;
        }
      }),
  }))
);
