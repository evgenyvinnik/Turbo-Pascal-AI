import { create } from 'zustand';

export interface ConsoleSnapshot {
  cols: number;
  rows: number;
  chars: string[];
  attributes: Uint8Array;
  x: number;
  y: number;
  cursorVisible: boolean;
  revision: number;
  attribute: number;
}
/** The program's graphics screen; `colors`, as RGB, are mode 13h's palette
 * where it replaces the EGA's sixteen. */
export interface GraphicsSnapshot {
  width: number;
  height: number;
  pixels: Uint8Array;
  revision: number;
  colors?: number[];
}
/** Where the program's mouse cursor shows: a character cell, or a dot of
 * the graphics screen. */
export interface MouseCursorSnapshot {
  x: number;
  y: number;
}
/** The browser's mouse over the program's screen: where, as fractions of
 * the screen, and which buttons are down (bit 0 left, 1 right, 2 middle). */
export type ProgramMouseHandler = (fractionX: number, fractionY: number, buttons: number) => void;

interface ProgramScreenState {
  visible: boolean;
  kind: 'text' | 'graphics';
  console: ConsoleSnapshot | null;
  graphics: GraphicsSnapshot | null;
  input: string;
  waiting: boolean;
  /** The mouse cursor, while the program shows it. */
  mouse: MouseCursorSnapshot | null;
  /** What the running program's mouse driver hears. */
  mouseHandler: ProgramMouseHandler | null;
  show: () => void;
  hide: () => void;
}
export const useProgramScreenStore = create<ProgramScreenState>((set) => ({
  visible: false,
  kind: 'text',
  console: null,
  graphics: null,
  input: '',
  waiting: false,
  mouse: null,
  mouseHandler: null,
  show: () => {
    set({ visible: true });
  },
  hide: () => {
    set({ visible: false });
  },
}));

/** The buttons down, as the program screens see them press and release. */
let mouseButtons = 0;
/** A mouse event over a program screen, at a point given as fractions of the
 * screen. DOM buttons 0, 2 and 1 are the driver's left, right and middle. */
export function programMouse(
  fractionX: number,
  fractionY: number,
  kind: 'down' | 'move' | 'up',
  button = 0
): void {
  const bit = button === 0 ? 1 : button === 2 ? 2 : button === 1 ? 4 : 0;
  if (kind === 'down') mouseButtons |= bit;
  else if (kind === 'up') mouseButtons &= ~bit;
  useProgramScreenStore.getState().mouseHandler?.(fractionX, fractionY, mouseButtons);
}
