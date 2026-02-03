import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type CompilationStatus = 'idle' | 'lexing' | 'parsing' | 'compiling' | 'success' | 'error';

export interface CompilationError {
  message: string;
  line: number;
  column: number;
  file: string;
  severity: 'error' | 'warning' | 'hint';
}

export interface CompilationResult {
  bytecode: unknown | null;
  parseTree: unknown | null;
  errors: CompilationError[];
  warnings: CompilationError[];
  compilationTime: number;
}

interface CompilerState {
  status: CompilationStatus;
  currentFile: string | null;
  result: CompilationResult | null;
  outputLines: string[];
}

interface CompilerActions {
  compile: (source: string, filename: string) => Promise<CompilationResult>;
  clearErrors: () => void;
  clearOutput: () => void;
  appendOutput: (line: string) => void;
  setStatus: (status: CompilationStatus) => void;
}

export const useCompilerStore = create<CompilerState & CompilerActions>()(
  immer((set, _get) => ({
    status: 'idle',
    currentFile: null,
    result: null,
    outputLines: [],

    compile: async (_source, filename) => {
      set((state) => {
        state.status = 'compiling';
        state.currentFile = filename;
      });

      // TODO: Implement actual compilation
      const startTime = Date.now();

      // Placeholder result
      const result: CompilationResult = {
        bytecode: null,
        parseTree: null,
        errors: [],
        warnings: [],
        compilationTime: Date.now() - startTime,
      };

      set((state) => {
        state.status = result.errors.length > 0 ? 'error' : 'success';
        state.result = result;
      });

      return result;
    },

    clearErrors: () =>
      set((state) => {
        if (state.result) {
          state.result.errors = [];
          state.result.warnings = [];
        }
      }),

    clearOutput: () =>
      set((state) => {
        state.outputLines = [];
      }),

    appendOutput: (line) =>
      set((state) => {
        state.outputLines.push(line);
      }),

    setStatus: (status) =>
      set((state) => {
        state.status = status;
      }),
  }))
);
