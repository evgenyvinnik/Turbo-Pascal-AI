import Dexie, { type Table } from 'dexie';

export interface FileRecord {
  path: string; // Primary key
  name: string;
  content: string;
  type: 'file';
  parentPath: string;
  createdAt: number;
  modifiedAt: number;
  size: number;
}

export interface DirectoryRecord {
  path: string; // Primary key
  name: string;
  type: 'directory';
  parentPath: string | null;
  createdAt: number;
  modifiedAt: number;
}

export interface SettingsRecord {
  category: 'editor' | 'compiler' | 'ui' | 'keybindings';
  data: Record<string, unknown>;
  updatedAt: number;
}

export interface SessionRecord {
  id?: number;
  name: string;
  openFiles: string[];
  activeFile: string | null;
  paneLayout: 'single' | 'split-horizontal' | 'split-vertical';
  cursorPositions: Record<string, { line: number; column: number }>;
  createdAt: number;
  updatedAt: number;
}

export interface RecentFileRecord {
  path: string;
  accessedAt: number;
}

export interface BreakpointRecord {
  id: string;
  filePath: string;
  line: number;
  enabled: boolean;
  condition: string | null;
  hitCount: number;
}

/** The payload schema is owned and validated by the workspace state layer. */
export interface WorkspaceRecord {
  id: string;
  schemaVersion: number;
  payload: unknown;
  updatedAt: number;
  revision: number;
  writerId?: string;
}

export class TurboPascalDB extends Dexie {
  files!: Table<FileRecord, string>;
  directories!: Table<DirectoryRecord, string>;
  settings!: Table<SettingsRecord, string>;
  sessions!: Table<SessionRecord, number>;
  recentFiles!: Table<RecentFileRecord, string>;
  breakpoints!: Table<BreakpointRecord, string>;
  workspaces!: Table<WorkspaceRecord, string>;

  constructor() {
    super('TurboPascalIDE');

    this.version(1).stores({
      files: 'path, parentPath, modifiedAt, name',
      directories: 'path, parentPath, name',
      settings: 'category',
      sessions: '++id, name, updatedAt',
      recentFiles: 'path, accessedAt',
      breakpoints: 'id, filePath',
    });

    // Dexie retains the version 1 stores and their contents when adding this
    // store. Existing saved files, sessions, and settings are left intact.
    this.version(2).stores({
      workspaces: 'id, updatedAt',
    });
  }
}

export const db = new TurboPascalDB();
