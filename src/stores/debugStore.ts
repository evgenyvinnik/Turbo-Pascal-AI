import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type DebugStatus = 'stopped' | 'running' | 'paused' | 'stepping';

export interface Breakpoint {
  id: string;
  file: string;
  line: number;
  enabled: boolean;
  condition?: string;
}

export interface WatchVariable {
  id: string;
  expression: string;
  value: unknown;
  type: string;
}

export interface StackFrame {
  id: string;
  name: string;
  file: string;
  line: number;
  locals: Map<string, { value: unknown; type: string }>;
}

export interface VMRegisters {
  pc: number;
  sp: number;
  mp: number;
  np: number;
  ep: number;
}

interface DebugState {
  status: DebugStatus;
  machine: unknown | null;
  breakpoints: Map<string, Breakpoint>;
  watches: WatchVariable[];
  callStack: StackFrame[];
  registers: VMRegisters;
  currentLine: number | null;
  currentFile: string | null;
}

interface DebugActions {
  startDebugging: (bytecode: unknown) => void;
  stopDebugging: () => void;
  pause: () => void;
  resume: () => void;
  stepInto: () => void;
  stepOver: () => void;
  stepOut: () => void;
  runToLine: (line: number) => void;
  addBreakpoint: (file: string, line: number) => void;
  removeBreakpoint: (id: string) => void;
  toggleBreakpoint: (id: string) => void;
  addWatch: (expression: string) => void;
  removeWatch: (id: string) => void;
  updateRegisters: (registers: VMRegisters) => void;
  setCurrentPosition: (file: string | null, line: number | null) => void;
}

const initialRegisters: VMRegisters = {
  pc: 0,
  sp: 0,
  mp: 0,
  np: 0,
  ep: 0,
};

export const useDebugStore = create<DebugState & DebugActions>()(
  immer((set, _get) => ({
    status: 'stopped',
    machine: null,
    breakpoints: new Map(),
    watches: [],
    callStack: [],
    registers: initialRegisters,
    currentLine: null,
    currentFile: null,

    startDebugging: (bytecode) =>
      set((state) => {
        state.machine = bytecode;
        state.status = 'running';
        state.callStack = [];
        state.registers = initialRegisters;
      }),

    stopDebugging: () =>
      set((state) => {
        state.status = 'stopped';
        state.machine = null;
        state.callStack = [];
        state.currentLine = null;
        state.currentFile = null;
      }),

    pause: () =>
      set((state) => {
        state.status = 'paused';
      }),

    resume: () =>
      set((state) => {
        state.status = 'running';
      }),

    stepInto: () =>
      set((state) => {
        state.status = 'stepping';
      }),

    stepOver: () =>
      set((state) => {
        state.status = 'stepping';
      }),

    stepOut: () =>
      set((state) => {
        state.status = 'stepping';
      }),

    runToLine: (_line) =>
      set((state) => {
        state.status = 'running';
      }),

    addBreakpoint: (file, line) =>
      set((state) => {
        const id = `bp-${file}-${line}`;
        state.breakpoints.set(id, {
          id,
          file,
          line,
          enabled: true,
        });
      }),

    removeBreakpoint: (id) =>
      set((state) => {
        state.breakpoints.delete(id);
      }),

    toggleBreakpoint: (id) =>
      set((state) => {
        const bp = state.breakpoints.get(id);
        if (bp) {
          bp.enabled = !bp.enabled;
        }
      }),

    addWatch: (expression) =>
      set((state) => {
        state.watches.push({
          id: `watch-${Date.now()}`,
          expression,
          value: undefined,
          type: 'unknown',
        });
      }),

    removeWatch: (id) =>
      set((state) => {
        state.watches = state.watches.filter((w) => w.id !== id);
      }),

    updateRegisters: (registers) =>
      set((state) => {
        state.registers = registers;
      }),

    setCurrentPosition: (file, line) =>
      set((state) => {
        state.currentFile = file;
        state.currentLine = line;
      }),
  }))
);
