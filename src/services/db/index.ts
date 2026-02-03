// Database instance and types
export {
  db,
  TurboPascalDB,
  type FileRecord,
  type DirectoryRecord,
  type SettingsRecord,
  type SessionRecord,
  type RecentFileRecord,
  type BreakpointRecord,
} from './database';

// File repository
export {
  createFile,
  readFile,
  updateFile,
  deleteFile,
  createDirectory,
  deleteDirectory,
  listDirectory,
  moveNode,
  renameNode,
  pathExists,
  getRecentFiles,
  addToRecentFiles,
  searchFiles,
  getAllFiles,
  getAllDirectories,
  initializeRootDirectory,
  type FileSystemNode,
} from './fileRepository';

// Settings repository
export {
  getSettings,
  saveSettings,
  getAllSettings,
  resetSettings,
  resetAllSettings,
  exportSettings,
  importSettings,
  type SettingsCategory,
  type EditorSettings,
  type CompilerSettings,
  type UISettings,
  type KeybindingsSettings,
  type SettingsData,
} from './settingsRepository';

// Session repository
export {
  saveSession,
  loadSession,
  getRecentSessions,
  deleteSession,
  getAllSessions,
  getSessionCount,
  findSessionsByName,
  getMostRecentSession,
  duplicateSession,
  touchSession,
  pruneOldSessions,
  sessionNameExists,
  generateUniqueSessionName,
  type SessionInput,
} from './sessionRepository';
