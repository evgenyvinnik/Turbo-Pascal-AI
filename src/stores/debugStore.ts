import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

export type DebugStatus = 'stopped' | 'running' | 'paused' | 'stepping';

export interface Breakpoint {
  id: string;
  file: string;
  line: number;
  enabled: boolean;
  condition?: string;
  passCount?: number;
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
  label?: string;
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
  machine: unknown;
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
  updateSnapshot: (snapshot: { status: DebugStatus; file: string; line: number; frames: StackFrame[]; registers: VMRegisters; values: Record<string, { value: unknown; type: string }> }) => void;
  updateBreakpoint: (id: string, update: Partial<Pick<Breakpoint, 'enabled' | 'condition' | 'line' | 'passCount'>>) => void;
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

    startDebugging: (bytecode) => {
      set((state) => {
        state.machine = bytecode;
        state.status = 'running';
        state.callStack = [];
        state.registers = initialRegisters;
      });
    },

    stopDebugging: () => {
      set((state) => {
        state.status = 'stopped';
        state.machine = null;
        state.callStack = [];
        state.currentLine = null;
        state.currentFile = null;
        for (const watch of state.watches) { watch.value = undefined; watch.type = 'unknown'; }
      });
    },

    pause: () => {
      set((state) => {
        state.status = 'paused';
      });
    },

    resume: () => {
      set((state) => {
        state.status = 'running';
      });
    },

    stepInto: () => {
      set((state) => {
        state.status = 'stepping';
      });
    },

    stepOver: () => {
      set((state) => {
        state.status = 'stepping';
      });
    },

    stepOut: () => {
      set((state) => {
        state.status = 'stepping';
      });
    },

    runToLine: (_line) => {
      set((state) => {
        state.status = 'running';
      });
    },

    addBreakpoint: (file, line) => {
      set((state) => {
        const id = `bp-${file}-${String(line)}`;
        state.breakpoints.set(id, {
          id,
          file,
          line,
          enabled: true,
        });
      });
    },

    removeBreakpoint: (id) => {
      set((state) => {
        state.breakpoints.delete(id);
      });
    },

    toggleBreakpoint: (id) => {
      set((state) => {
        const bp = state.breakpoints.get(id);
        if (bp) {
          bp.enabled = !bp.enabled;
        }
      });
    },

    addWatch: (expression) => {
      set((state) => {
        state.watches.push({
          id: `watch-${String(Date.now())}`,
          expression,
          value: undefined,
          type: 'unknown',
        });
      });
    },

    removeWatch: (id) => {
      set((state) => {
        state.watches = state.watches.filter((w) => w.id !== id);
      });
    },

    updateRegisters: (registers) => {
      set((state) => {
        state.registers = registers;
      });
    },

    setCurrentPosition: (file, line) => {
      set((state) => {
        state.currentFile = file;
        state.currentLine = line;
      });
    },

    updateSnapshot: (snapshot) => { set((state) => {
      state.status = snapshot.status;
      state.currentFile = snapshot.file;
      state.currentLine = snapshot.line;
      state.callStack = snapshot.frames;
      state.registers = snapshot.registers;
      for (const watch of state.watches) {
        const result = snapshot.values[watch.expression];
        watch.value = result?.value;
        watch.type = result?.type ?? 'unknown';
      }
    }); },

    updateBreakpoint: (id, update) => { set((state) => {
      const breakpoint = state.breakpoints.get(id);
      if (breakpoint) Object.assign(breakpoint, update);
    }); },
  }))
);
