import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { DialogValues } from './dialogStore';

export interface ToolSettings {
  title: string;
  program: string;
  params: string;
}

export interface SearchSettings {
  text: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWords: boolean;
  regularExpression: boolean;
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
  optionsFile: string;
  directory: string;
  compilerOptions: Record<string, boolean[]>;
  optionDialogs: Record<string, DialogValues>;
  tools: ToolSettings[];
  programParameters: string;
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
  setOptionDialog: (name: string, values: DialogValues) => void;
  setTools: (tools: ToolSettings[]) => void;
  setProgramParameters: (params: string) => void;
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
      regularExpression: false,
      backward: false,
      selectedOnly: false,
      entireScope: false,
      promptOnReplace: true,
    },
    destination: 'Memory',
    primaryFile: '',
    optionsFile: 'TURBO.TP',
    directory: 'A:\\',
    compilerOptions: {
      codegen: [false, false, true, false],
      runtime: [false, true, true, false],
      syntax: [true, false, true, false, false],
      debugging: [true, true],
      numeric: [false, true],
    },
    optionDialogs: {
      'options.memory': { stack: '16384', low: '0', high: '655360' },
      'options.linker': { map: 0, buffer: 0 },
      'options.debugger': { debugging: [true, false], swapping: 1 },
      'options.directories': { exe: '', include: '', unit: '', object: '' },
      'options.tools': { list: 0 },
      'env.preferences': {
        screen: 0,
        tracking: 0,
        autosave: [false, false, false],
        options: [false, true, false],
        desktop: 1,
      },
      'env.editor': {
        editor: [true, true, true, false, false, true, false, true, true, false, true, false, true],
        tab: '8',
        ext: '*.PAS;*.INC',
      },
      'env.mouse': { right: 1, reverse: [false] },
      'env.startup': {
        startup: [false, false, false, true, false, true, true, false],
        window: '32',
        editorheap: '28',
        overlay: '90',
        swap: '',
      },
      'env.colors': { group: 4, item: 7, foreground: 14, background: 4 },
    },
    tools: [
      { title: 'Grep', program: 'GREP.COM', params: '' },
      { title: 'Turbo Assembler', program: 'TASM.EXE', params: '' },
      { title: 'Turbo Debugger', program: 'TD.EXE', params: '' },
      { title: 'Turbo Profiler', program: 'TPROF.EXE', params: '' },
    ],
    programParameters: '',
    defines: '',
    lastCompile: null,

    setHelpTopic: (topic) => {
      set((s) => {
        s.helpTopic = topic;
      });
    },

    setSearch: (patch) => {
      set((s) => {
        Object.assign(s.search, patch);
      });
    },

    toggleDestination: () => {
      set((s) => {
        s.destination = s.destination === 'Memory' ? 'Disk' : 'Memory';
      });
    },

    setPrimaryFile: (file) => {
      set((s) => {
        s.primaryFile = file;
      });
    },

    setDirectory: (dir) => {
      set((s) => {
        s.directory = dir;
      });
    },

    setCompilerOptions: (values, defines) => {
      set((s) => {
        s.compilerOptions = values;
        s.defines = defines;
      });
    },

    setOptionDialog: (name, values) => {
      set((s) => {
        s.optionDialogs[name] = values;
      });
    },

    setTools: (tools) => {
      set((s) => {
        s.tools = tools;
      });
    },

    setProgramParameters: (params) => {
      set((s) => {
        s.programParameters = params;
      });
    },

    setLastCompile: (info) => {
      set((s) => {
        s.lastCompile = info;
      });
    },
  }))
);
