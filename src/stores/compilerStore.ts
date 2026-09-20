import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { Compiler as PascalCompiler, Bytecode } from '@compiler/codegen';
import { PascalError, describePascalDiagnostic, formatPascalDiagnostic } from '@compiler/errors';
import { NativePascalRequired, parseProject, type ProjectOptions } from '@compiler/project';
import { NodeType, type Node } from '@compiler/parser/Node';

export type CompilationStatus = 'idle' | 'lexing' | 'parsing' | 'compiling' | 'success' | 'error';
export type RuntimeStatus = 'idle' | 'running' | 'paused' | 'waiting' | 'completed' | 'stopped' | 'error';

export interface CompilationError {
  message: string;
  code?: number;
  detail?: string;
  line: number;
  column: number;
  file: string;
  severity: 'error' | 'warning' | 'hint';
}

export interface CompilationResult {
  isUnit?: boolean;
  nativeRequired?: boolean;
  bytecode: Bytecode | null;
  parseTree: Node | null;
  errors: CompilationError[];
  warnings: CompilationError[];
  compilationTime: number;
}

interface CompilerState {
  status: CompilationStatus;
  currentFile: string | null;
  result: CompilationResult | null;
  outputLines: string[];
  /** Text the running program wrote to the console. */
  programOutput: string[];
  runtimeStatus: RuntimeStatus;
  runtimeError: string | null;
  /** Tool window messages, newest run last. */
  messages: string[];
}

interface CompilerActions {
  compile: (source: string, filename: string, options?: ProjectOptions) => Promise<CompilationResult>;
  clearErrors: () => void;
  clearOutput: () => void;
  appendOutput: (line: string) => void;
  setProgramOutput: (lines: string[]) => void;
  setRuntime: (status: RuntimeStatus, error?: string | null) => void;
  setMessages: (lines: string[]) => void;
  setStatus: (status: CompilationStatus) => void;
}

export const useCompilerStore = create<CompilerState & CompilerActions>()(
  immer((set, get) => ({
    status: 'idle',
    currentFile: null,
    result: null,
    outputLines: [],
    programOutput: [],
    runtimeStatus: 'idle',
    runtimeError: null,
    messages: [],

    compile: async (source, filename, options) => {
      const startTime = Date.now();
      const errors: CompilationError[] = [];
      const warnings: CompilationError[] = [];
      let bytecode: Bytecode | null = null;
      let parseTree: Node | null = null;

      // Clear previous output
      set((state) => {
        state.outputLines = [];
        state.status = 'lexing';
        state.currentFile = filename;
      });

      get().appendOutput(`Compiling ${filename}...`);
      await Promise.resolve();

      try {
        // Step 1: Lexing
        set((state) => {
          state.status = 'lexing';
        });
        get().appendOutput('Lexical analysis...');

        // Step 2: Parsing
        set((state) => {
          state.status = 'parsing';
        });
        get().appendOutput('Parsing...');

        const project = parseProject(source, filename, options);
        parseTree = project.tree;

        // Step 3: Code generation
        set((state) => {
          state.status = 'compiling';
        });
        get().appendOutput('Generating bytecode...');

        const compiler = new PascalCompiler();
        bytecode = compiler.compile(project.tree, { resolveUnit: project.resolveUnit });
        bytecode.sources = project.sources;

        const compilationTime = Date.now() - startTime;
        get().appendOutput(`Compiled successfully in ${String(compilationTime)}ms`);
        get().appendOutput(`Generated ${String(bytecode.istore.length)} instructions`);

        const result: CompilationResult = {
          isUnit: project.tree.type === NodeType.UNIT,
          bytecode,
          parseTree,
          errors,
          warnings,
          compilationTime,
        };

        set((state) => {
          state.status = 'success';
          state.result = result;
        });

        return result;
      } catch (error) {
        const compilationTime = Date.now() - startTime;
        if (error instanceof NativePascalRequired) {
          const result = { bytecode: null, parseTree: null, errors: [], warnings: [], compilationTime, nativeRequired: true };
          set(state => { state.status = 'idle'; state.result = result; });
          return result;
        }

        if (error instanceof PascalError) {
          const diagnostic = describePascalDiagnostic(error, 'compiler');
          errors.push({
            message: diagnostic.message,
            ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
            detail: diagnostic.detail,
            line: diagnostic.lineNumber,
            column: diagnostic.columnNumber,
            file: diagnostic.sourceFile ?? filename,
            severity: 'error',
          });
          get().appendOutput(`${diagnostic.sourceFile ?? filename}(${String(diagnostic.lineNumber)}): ${formatPascalDiagnostic(diagnostic)}`);
        } else if (error instanceof Error) {
          errors.push({
            message: error.message,
            line: 0,
            column: 0,
            file: filename,
            severity: 'error',
          });
          get().appendOutput(`Error: ${error.message}`);
        }

        const result: CompilationResult = {
          bytecode: null,
          parseTree,
          errors,
          warnings,
          compilationTime,
        };

        set((state) => {
          state.status = 'error';
          state.result = result;
        });

        return result;
      }
    },

    clearErrors: () =>
      { set((state) => {
        if (state.result) {
          state.result.errors = [];
          state.result.warnings = [];
        }
      }); },

    clearOutput: () =>
      { set((state) => {
        state.outputLines = [];
      }); },

    appendOutput: (line) =>
      { set((state) => {
        state.outputLines.push(line);
      }); },

    setProgramOutput: (lines) =>
      { set((state) => {
        state.programOutput = lines;
      }); },

    setRuntime: (status, error = null) => {
      set((state) => {
        state.runtimeStatus = status;
        state.runtimeError = error;
      });
    },

    setMessages: (lines) =>
      { set((state) => {
        state.messages = lines;
      }); },

    setStatus: (status) =>
      { set((state) => {
        state.status = status;
      }); },
  }))
);
