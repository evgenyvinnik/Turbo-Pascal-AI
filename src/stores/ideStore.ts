import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface SearchSettings {
  text: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWords: boolean;
  backward: boolean;
  selectedOnly: boolean;
  entireScope: boolean;
  promptOnReplace: boolean;
}

interface IdeState {
  /** Topic key shown in the Help window. */
  helpTopic: string;
  search: SearchSettings;
  /** Compile > Destination toggles between Memory and Disk. */
  destination: 'Memory' | 'Disk';
  primaryFile: string;
  directory: string;
  compilerOptions: Record<string, boolean[]>;
  defines: string;
  lastCompile: { file: string; lines: number; ok: boolean; message: string } | null;
}

interface IdeActions {
  setHelpTopic: (topic: string) => void;
  setSearch: (patch: Partial<SearchSettings>) => void;
  toggleDestination: () => void;
  setPrimaryFile: (file: string) => void;
  setDirectory: (dir: string) => void;
  setCompilerOptions: (values: Record<string, boolean[]>, defines: string) => void;
  setLastCompile: (info: IdeState['lastCompile']) => void;
}

export const useIdeStore = create<IdeState & IdeActions>()(
  immer((set) => ({
    helpTopic: 'contents',
    search: {
      text: '',
      replacement: '',
      caseSensitive: false,
      wholeWords: false,
      backward: false,
      selectedOnly: false,
      entireScope: false,
      promptOnReplace: true,
    },
    destination: 'Memory',
    primaryFile: '',
    directory: 'A:\\',
    compilerOptions: {
      codegen: [false, false],
      codegen2: [true, false],
      runtime: [false, true, true, false],
      syntax: [true, false, true, false, false],
      debugging: [true, true],
      numeric: [false, true],
    },
    defines: '',
    lastCompile: null,

    setHelpTopic: (topic) =>
      { set((s) => {
        s.helpTopic = topic;
      }); },

    setSearch: (patch) =>
      { set((s) => {
        Object.assign(s.search, patch);
      }); },

    toggleDestination: () =>
      { set((s) => {
        s.destination = s.destination === 'Memory' ? 'Disk' : 'Memory';
      }); },

    setPrimaryFile: (file) =>
      { set((s) => {
        s.primaryFile = file;
      }); },

    setDirectory: (dir) =>
      { set((s) => {
        s.directory = dir;
      }); },

    setCompilerOptions: (values, defines) =>
      { set((s) => {
        s.compilerOptions = values;
        s.defines = defines;
      }); },

    setLastCompile: (info) =>
      { set((s) => {
        s.lastCompile = info;
      }); },
  })),
);
