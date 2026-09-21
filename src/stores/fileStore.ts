import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  parentId: string | null;
  children?: string[];
  createdAt: Date;
  modifiedAt: Date;
  size: number;
}

interface FileState {
  fileTree: Map<string, FileNode>;
  rootId: string;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  recentFiles: string[];
}

interface FileActions {
  loadFileTree: () => Promise<void>;
  createFile: (parentPath: string, name: string, content?: string) => Promise<string>;
  createDirectory: (parentPath: string, name: string) => Promise<string>;
  deleteNode: (path: string) => Promise<void>;
  renameNode: (path: string, newName: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  toggleExpanded: (path: string) => void;
  setSelected: (path: string | null) => void;
  addRecentFile: (path: string) => void;
}

const ROOT_ID = 'root';

export const useFileStore = create<FileState & FileActions>()(
  immer((set, _get) => ({
    fileTree: new Map([
      [
        ROOT_ID,
        {
          id: ROOT_ID,
          name: 'Projects',
          path: '/',
          type: 'directory' as const,
          parentId: null,
          children: [],
          createdAt: new Date(),
          modifiedAt: new Date(),
          size: 0,
        },
      ],
    ]),
    rootId: ROOT_ID,
    selectedPath: null,
    expandedDirs: new Set([ROOT_ID]),
    recentFiles: [],

    loadFileTree: async () => {
      // Will be implemented with IndexedDB
    },

    createFile: (parentPath, name, _content = '') => {
      const id = `file-${String(Date.now())}`;
      const path = `${parentPath}/${name}`;
      set((state) => {
        state.fileTree.set(id, {
          id,
          name,
          path,
          type: 'file',
          parentId: parentPath,
          createdAt: new Date(),
          modifiedAt: new Date(),
          size: 0,
        });
      });
      return Promise.resolve(id);
    },

    createDirectory: (parentPath, name) => {
      const id = `dir-${String(Date.now())}`;
      const path = `${parentPath}/${name}`;
      set((state) => {
        state.fileTree.set(id, {
          id,
          name,
          path,
          type: 'directory',
          parentId: parentPath,
          children: [],
          createdAt: new Date(),
          modifiedAt: new Date(),
          size: 0,
        });
      });
      return Promise.resolve(id);
    },

    deleteNode: (path) => {
      set((state) => {
        for (const [id, node] of state.fileTree) {
          if (node.path === path) {
            state.fileTree.delete(id);
            break;
          }
        }
      });
      return Promise.resolve();
    },

    renameNode: (path, newName) => {
      set((state) => {
        for (const node of state.fileTree.values()) {
          if (node.path === path) {
            node.name = newName;
            const parentPath = path.substring(0, path.lastIndexOf('/'));
            node.path = `${parentPath}/${newName}`;
            break;
          }
        }
      });
      return Promise.resolve();
    },

    readFile: (_path) => {
      // Will be implemented with IndexedDB
      return Promise.resolve('');
    },

    writeFile: async (_path, _content) => {
      // Will be implemented with IndexedDB
    },

    toggleExpanded: (path) => {
      set((state) => {
        if (state.expandedDirs.has(path)) {
          state.expandedDirs.delete(path);
        } else {
          state.expandedDirs.add(path);
        }
      });
    },

    setSelected: (path) => {
      set((state) => {
        state.selectedPath = path;
      });
    },

    addRecentFile: (path) => {
      set((state) => {
        state.recentFiles = [path, ...state.recentFiles.filter((p) => p !== path)].slice(0, 10);
      });
    },
  }))
);
