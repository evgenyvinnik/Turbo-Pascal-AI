import { create } from 'zustand';

export interface ConsoleSnapshot {
  cols: number; rows: number; chars: string[]; attributes: Uint8Array;
  x: number; y: number; cursorVisible: boolean; revision: number; attribute: number;
}
export interface GraphicsSnapshot { width: number; height: number; pixels: Uint8Array; revision: number }
interface ProgramScreenState {
  visible: boolean;
  kind: 'text' | 'graphics';
  console: ConsoleSnapshot | null;
  graphics: GraphicsSnapshot | null;
  input: string;
  waiting: boolean;
  show: () => void;
  hide: () => void;
}
export const useProgramScreenStore = create<ProgramScreenState>((set) => ({
  visible: false, kind: 'text', console: null, graphics: null, input: '', waiting: false,
  show: () => { set({ visible: true }); },
  hide: () => { set({ visible: false }); },
}));
