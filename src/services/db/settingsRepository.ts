import { db, type SettingsRecord } from './database';

export type SettingsCategory = 'editor' | 'compiler' | 'ui' | 'keybindings';

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  theme: 'dark' | 'light' | 'classic';
  autoSave: boolean;
  autoSaveDelay: number;
}

export interface CompilerSettings {
  optimizationLevel: 0 | 1 | 2 | 3;
  targetPlatform: 'web' | 'native';
  strictMode: boolean;
  warningsAsErrors: boolean;
  generateSourceMaps: boolean;
}

export interface UISettings {
  sidebarVisible: boolean;
  sidebarWidth: number;
  outputPanelVisible: boolean;
  outputPanelHeight: number;
  statusBarVisible: boolean;
  language: string;
}

export interface KeybindingsSettings {
  bindings: Record<string, string>;
}

export type SettingsData = {
  editor: EditorSettings;
  compiler: CompilerSettings;
  ui: UISettings;
  keybindings: KeybindingsSettings;
};

const defaultSettings: SettingsData = {
  editor: {
    fontSize: 14,
    fontFamily: 'Consolas, Monaco, monospace',
    tabSize: 2,
    insertSpaces: true,
    wordWrap: false,
    lineNumbers: true,
    minimap: true,
    theme: 'classic',
    autoSave: true,
    autoSaveDelay: 1000,
  },
  compiler: {
    optimizationLevel: 2,
    targetPlatform: 'web',
    strictMode: true,
    warningsAsErrors: false,
    generateSourceMaps: true,
  },
  ui: {
    sidebarVisible: true,
    sidebarWidth: 250,
    outputPanelVisible: true,
    outputPanelHeight: 200,
    statusBarVisible: true,
    language: 'en',
  },
  keybindings: {
    bindings: {
      'editor.save': 'Ctrl+S',
      'editor.saveAll': 'Ctrl+Shift+S',
      'editor.undo': 'Ctrl+Z',
      'editor.redo': 'Ctrl+Y',
      'editor.find': 'Ctrl+F',
      'editor.replace': 'Ctrl+H',
      'editor.goToLine': 'Ctrl+G',
      'file.new': 'Ctrl+N',
      'file.open': 'Ctrl+O',
      'file.close': 'Ctrl+W',
      'compile.build': 'F9',
      'compile.run': 'Ctrl+F9',
      'debug.start': 'F5',
      'debug.stepOver': 'F8',
      'debug.stepInto': 'F7',
      'debug.stepOut': 'Shift+F8',
      'debug.toggleBreakpoint': 'F2',
    },
  },
};

/**
 * Get settings for a specific category
 */
export async function getSettings<T extends SettingsCategory>(
  category: T
): Promise<SettingsData[T]> {
  const record = await db.settings.get(category);

  if (record) {
    return record.data as unknown as SettingsData[T];
  }

  // Return default settings if no settings exist
  return defaultSettings[category];
}

/**
 * Save settings for a specific category
 */
export async function saveSettings<T extends SettingsCategory>(
  category: T,
  data: Partial<SettingsData[T]>
): Promise<SettingsRecord> {
  const existing = await db.settings.get(category);
  const currentData = existing?.data ?? defaultSettings[category];

  const mergedData = {
    ...currentData,
    ...data,
  };

  const record: SettingsRecord = {
    category,
    data: mergedData as Record<string, unknown>,
    updatedAt: Date.now(),
  };

  await db.settings.put(record);
  return record;
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<SettingsData> {
  const [editor, compiler, ui, keybindings] = await Promise.all([
    getSettings('editor'),
    getSettings('compiler'),
    getSettings('ui'),
    getSettings('keybindings'),
  ]);

  return {
    editor,
    compiler,
    ui,
    keybindings,
  };
}

/**
 * Reset settings for a specific category to defaults
 */
export async function resetSettings<T extends SettingsCategory>(
  category: T
): Promise<SettingsData[T]> {
  const defaultData = defaultSettings[category];

  const record: SettingsRecord = {
    category,
    data: defaultData as unknown as Record<string, unknown>,
    updatedAt: Date.now(),
  };

  await db.settings.put(record);
  return defaultData;
}

/**
 * Reset all settings to defaults
 */
export async function resetAllSettings(): Promise<SettingsData> {
  await Promise.all([
    resetSettings('editor'),
    resetSettings('compiler'),
    resetSettings('ui'),
    resetSettings('keybindings'),
  ]);

  return defaultSettings;
}

/**
 * Export all settings as JSON string
 */
export async function exportSettings(): Promise<string> {
  const settings = await getAllSettings();
  return JSON.stringify(settings, null, 2);
}

/**
 * Import settings from JSON string
 */
export async function importSettings(jsonString: string): Promise<void> {
  const settings = JSON.parse(jsonString) as Partial<SettingsData>;

  const promises: Promise<SettingsRecord>[] = [];

  if (settings.editor) {
    promises.push(saveSettings('editor', settings.editor));
  }
  if (settings.compiler) {
    promises.push(saveSettings('compiler', settings.compiler));
  }
  if (settings.ui) {
    promises.push(saveSettings('ui', settings.ui));
  }
  if (settings.keybindings) {
    promises.push(saveSettings('keybindings', settings.keybindings));
  }

  await Promise.all(promises);
}
