import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { Lexer, Stream } from '@compiler/lexer';
import { Parser } from '@compiler/parser';
import { Compiler as PascalCompiler, Bytecode } from '@compiler/codegen';
import { PascalError } from '@compiler/errors';

export type CompilationStatus = 'idle' | 'lexing' | 'parsing' | 'compiling' | 'success' | 'error';

export interface CompilationError {
  message: string;
  line: number;
  column: number;
  file: string;
  severity: 'error' | 'warning' | 'hint';
}

export interface CompilationResult {
  bytecode: Bytecode | null;
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
  /** Text the running program wrote to the console. */
  programOutput: string[];
  /** Tool window messages, newest run last. */
  messages: string[];
}

interface CompilerActions {
  compile: (source: string, filename: string) => Promise<CompilationResult>;
  clearErrors: () => void;
  clearOutput: () => void;
  appendOutput: (line: string) => void;
  setProgramOutput: (lines: string[]) => void;
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
    messages: [],

    compile: async (source, filename) => {
      const startTime = Date.now();
      const errors: CompilationError[] = [];
      const warnings: CompilationError[] = [];
      let bytecode: Bytecode | null = null;
      let parseTree: unknown = null;

      // Clear previous output
      set((state) => {
        state.outputLines = [];
        state.status = 'lexing';
        state.currentFile = filename;
      });

      get().appendOutput(`Compiling ${filename}...`);

      try {
        // Step 1: Lexing
        set((state) => {
          state.status = 'lexing';
        });
        get().appendOutput('Lexical analysis...');

        const stream = new Stream(source);
        const lexer = new Lexer(stream);

        // Step 2: Parsing
        set((state) => {
          state.status = 'parsing';
        });
        get().appendOutput('Parsing...');

        const parser = new Parser(lexer);
        parseTree = parser.parse();

        // Step 3: Code generation
        set((state) => {
          state.status = 'compiling';
        });
        get().appendOutput('Generating bytecode...');

        const compiler = new PascalCompiler();
        bytecode = compiler.compile(parseTree as Parameters<typeof compiler.compile>[0]);

        const compilationTime = Date.now() - startTime;
        get().appendOutput(`Compiled successfully in ${compilationTime}ms`);
        get().appendOutput(`Generated ${bytecode.istore.length} instructions`);

        const result: CompilationResult = {
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

        if (error instanceof PascalError) {
          errors.push({
            message: error.message,
            line: error.lineNumber,
            column: error.columnNumber,
            file: filename,
            severity: 'error',
          });
          get().appendOutput(`Error at line ${error.lineNumber}: ${error.message}`);
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

    setProgramOutput: (lines) =>
      set((state) => {
        state.programOutput = lines;
      }),

    setMessages: (lines) =>
      set((state) => {
        state.messages = lines;
      }),

    setStatus: (status) =>
      set((state) => {
        state.status = status;
      }),
  }))
);
