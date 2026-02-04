import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  screenMode: '80x25' | '80x50';
  showLineNumbers: boolean;
  highlightCurrentLine: boolean;
  syntaxHighlighting: boolean;
  showWhitespace: boolean;
  autoIndent: boolean;
  insertMode: boolean;
}

export interface CompilerSettings {
  targetMemoryModel: 'small' | 'medium' | 'large';
  stackSize: number;
  heapSize: number;
  rangeChecking: boolean;
  stackChecking: boolean;
  ioChecking: boolean;
  overflowChecking: boolean;
  debugInfo: boolean;
}

export interface UISettings {
  theme: 'turbo-blue' | 'turbo-black';
  language: 'en' | 'de' | 'ru';
  showFileExplorer: boolean;
  showDebugPanel: boolean;
  showStatusBar: boolean;
  panelSizes: { left: number; right: number; bottom: number };
}

interface SettingsState {
  editor: EditorSettings;
  compiler: CompilerSettings;
  ui: UISettings;
}

interface SettingsActions {
  updateEditorSettings: (settings: Partial<EditorSettings>) => void;
  updateCompilerSettings: (settings: Partial<CompilerSettings>) => void;
  updateUISettings: (settings: Partial<UISettings>) => void;
  resetToDefaults: () => void;
}

const defaultEditorSettings: EditorSettings = {
  fontSize: 14,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  autoSave: false,
  autoSaveDelay: 5000,
  screenMode: '80x25',
  showLineNumbers: true,
  highlightCurrentLine: true,
  syntaxHighlighting: true,
  showWhitespace: false,
  autoIndent: true,
  insertMode: true,
};

const defaultCompilerSettings: CompilerSettings = {
  targetMemoryModel: 'small',
  stackSize: 16384,
  heapSize: 655360,
  rangeChecking: true,
  stackChecking: true,
  ioChecking: true,
  overflowChecking: true,
  debugInfo: true,
};

const defaultUISettings: UISettings = {
  theme: 'turbo-blue',
  language: 'en',
  showFileExplorer: true,
  showDebugPanel: false,
  showStatusBar: true,
  panelSizes: { left: 200, right: 250, bottom: 150 },
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    immer((set) => ({
      editor: defaultEditorSettings,
      compiler: defaultCompilerSettings,
      ui: defaultUISettings,

      updateEditorSettings: (settings) =>
        set((state) => {
          Object.assign(state.editor, settings);
        }),

      updateCompilerSettings: (settings) =>
        set((state) => {
          Object.assign(state.compiler, settings);
        }),

      updateUISettings: (settings) =>
        set((state) => {
          Object.assign(state.ui, settings);
        }),

      resetToDefaults: () =>
        set((state) => {
          state.editor = defaultEditorSettings;
          state.compiler = defaultCompilerSettings;
          state.ui = defaultUISettings;
        }),
    })),
    {
      name: 'turbo-pascal-settings',
    }
  )
);
