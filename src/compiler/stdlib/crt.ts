/**
 * CRT Unit for console I/O operations
 *
 * This module defines the interface for the CRT (Cathode Ray Tube) unit,
 * which provides console-related functions in Turbo Pascal.
 * In a web environment, these will be mapped to terminal emulation.
 */

import { TypeKind } from '../symbols/Symbol';
import { ParamMode, type BuiltinDef } from './builtin';

/**
 * CRT Unit name constant
 */
export const CRT_UNIT_NAME = 'CRT';

/**
 * Standard text color constants (EGA colors 0-15)
 */
export enum TextColors {
  Black = 0,
  Blue = 1,
  Green = 2,
  Cyan = 3,
  Red = 4,
  Magenta = 5,
  Brown = 6,
  LightGray = 7,
  DarkGray = 8,
  LightBlue = 9,
  LightGreen = 10,
  LightCyan = 11,
  LightRed = 12,
  LightMagenta = 13,
  Yellow = 14,
  White = 15,
}

/**
 * Text mode constants
 */
export enum TextModes {
  /** 40x25 B/W on Color Adapter */
  BW40 = 0,
  /** 40x25 Color on Color Adapter */
  CO40 = 1,
  /** 80x25 B/W on Color Adapter */
  BW80 = 2,
  /** 80x25 Color on Color Adapter */
  CO80 = 3,
  /** 80x25 on Monochrome Adapter */
  Mono = 7,
  /** EGA 43-line mode or VGA 50-line mode */
  Font8x8 = 256,
}

/**
 * CRT procedure indices
 * These are offset from the built-in procedures to avoid conflicts
 */
export enum CrtProcedure {
  // Screen control
  CLRSCR = 100,
  CLREOL = 101,
  GOTOXY = 102,
  WHEREX = 103,
  WHEREY = 104,
  WINDOW = 105,
  INSLINE = 106,
  DELLINE = 107,

  // Color and video
  TEXTCOLOR = 110,
  TEXTBACKGROUND = 111,
  HIGHVIDEO = 112,
  LOWVIDEO = 113,
  NORMVIDEO = 114,
  TEXTMODE = 115,

  // Keyboard
  KEYPRESSED = 120,
  READKEY = 121,

  // Sound
  SOUND = 130,
  NOSOUND = 131,
  DELAY = 132,

  // Cursor
  CURSOROFF = 140,
  CURSORON = 141,
}

/**
 * CRT global variables
 */
export interface CrtVariables {
  /** If true, output goes directly to video memory */
  DirectVideo: boolean;
  /** If true, scrolling stops at bottom of window */
  CheckBreak: boolean;
  /** If true, Ctrl+C breaks program */
  CheckEOF: boolean;
  /** Stores the last text mode */
  LastMode: number;
  /** Blink attribute for text */
  TextAttr: number;
  /** Left column of the current window */
  WindMin: number;
  /** Right column of the current window */
  WindMax: number;
}

/**
 * Default CRT variable values
 */
export const DEFAULT_CRT_VARIABLES: CrtVariables = {
  DirectVideo: true,
  CheckBreak: true,
  CheckEOF: false,
  LastMode: TextModes.CO80,
  TextAttr: (TextColors.Black << 4) | TextColors.LightGray,
  WindMin: 0x0000, // (0,0) - top-left
  WindMax: 0x184F, // (79,24) - bottom-right for 80x25
};

/**
 * CRT screen control procedures
 */
export const CRT_SCREEN_PROCS: BuiltinDef[] = [
  {
    name: 'ClrScr',
    isFunction: false,
    params: [],
    description: 'Clear the screen and move cursor to upper-left corner',
    procedureIndex: CrtProcedure.CLRSCR,
  },
  {
    name: 'ClrEol',
    isFunction: false,
    params: [],
    description: 'Clear from cursor position to end of line',
    procedureIndex: CrtProcedure.CLREOL,
  },
  {
    name: 'GotoXY',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Move cursor to position (X, Y) in the current window',
    procedureIndex: CrtProcedure.GOTOXY,
  },
  {
    name: 'WhereX',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the current X coordinate of the cursor',
    procedureIndex: CrtProcedure.WHEREX,
  },
  {
    name: 'WhereY',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the current Y coordinate of the cursor',
    procedureIndex: CrtProcedure.WHEREY,
  },
  {
    name: 'Window',
    isFunction: false,
    params: [
      { name: 'X1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'X2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Define a text window on the screen',
    procedureIndex: CrtProcedure.WINDOW,
  },
  {
    name: 'InsLine',
    isFunction: false,
    params: [],
    description: 'Insert a blank line at the cursor position',
    procedureIndex: CrtProcedure.INSLINE,
  },
  {
    name: 'DelLine',
    isFunction: false,
    params: [],
    description: 'Delete the line at the cursor position',
    procedureIndex: CrtProcedure.DELLINE,
  },
];

/**
 * CRT color and video procedures
 */
export const CRT_COLOR_PROCS: BuiltinDef[] = [
  {
    name: 'TextColor',
    isFunction: false,
    params: [
      { name: 'Color', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the foreground text color',
    procedureIndex: CrtProcedure.TEXTCOLOR,
  },
  {
    name: 'TextBackground',
    isFunction: false,
    params: [
      { name: 'Color', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the background text color',
    procedureIndex: CrtProcedure.TEXTBACKGROUND,
  },
  {
    name: 'HighVideo',
    isFunction: false,
    params: [],
    description: 'Select high-intensity text colors',
    procedureIndex: CrtProcedure.HIGHVIDEO,
  },
  {
    name: 'LowVideo',
    isFunction: false,
    params: [],
    description: 'Select low-intensity text colors',
    procedureIndex: CrtProcedure.LOWVIDEO,
  },
  {
    name: 'NormVideo',
    isFunction: false,
    params: [],
    description: 'Restore normal text attributes',
    procedureIndex: CrtProcedure.NORMVIDEO,
  },
  {
    name: 'TextMode',
    isFunction: false,
    params: [
      { name: 'Mode', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the text mode',
    procedureIndex: CrtProcedure.TEXTMODE,
  },
];

/**
 * CRT keyboard procedures
 */
export const CRT_KEYBOARD_PROCS: BuiltinDef[] = [
  {
    name: 'KeyPressed',
    isFunction: true,
    returnType: TypeKind.BOOLEAN,
    params: [],
    description: 'Check if a key has been pressed',
    procedureIndex: CrtProcedure.KEYPRESSED,
  },
  {
    name: 'ReadKey',
    isFunction: true,
    returnType: TypeKind.CHAR,
    params: [],
    description: 'Read a character from the keyboard without echoing',
    procedureIndex: CrtProcedure.READKEY,
  },
];

/**
 * CRT sound and delay procedures
 */
export const CRT_SOUND_PROCS: BuiltinDef[] = [
  {
    name: 'Sound',
    isFunction: false,
    params: [
      { name: 'Hz', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Start playing a sound at the specified frequency',
    procedureIndex: CrtProcedure.SOUND,
  },
  {
    name: 'NoSound',
    isFunction: false,
    params: [],
    description: 'Turn off the sound',
    procedureIndex: CrtProcedure.NOSOUND,
  },
  {
    name: 'Delay',
    isFunction: false,
    params: [
      { name: 'Ms', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Pause execution for a specified number of milliseconds',
    procedureIndex: CrtProcedure.DELAY,
  },
];

/**
 * All CRT procedures
 */
export const ALL_CRT_PROCS: BuiltinDef[] = [
  ...CRT_SCREEN_PROCS,
  ...CRT_COLOR_PROCS,
  ...CRT_KEYBOARD_PROCS,
  ...CRT_SOUND_PROCS,
];

/**
 * CRT constants for export
 */
export const CRT_CONSTANTS: Map<string, number> = new Map([
  // Text colors
  ['BLACK', TextColors.Black],
  ['BLUE', TextColors.Blue],
  ['GREEN', TextColors.Green],
  ['CYAN', TextColors.Cyan],
  ['RED', TextColors.Red],
  ['MAGENTA', TextColors.Magenta],
  ['BROWN', TextColors.Brown],
  ['LIGHTGRAY', TextColors.LightGray],
  ['DARKGRAY', TextColors.DarkGray],
  ['LIGHTBLUE', TextColors.LightBlue],
  ['LIGHTGREEN', TextColors.LightGreen],
  ['LIGHTCYAN', TextColors.LightCyan],
  ['LIGHTRED', TextColors.LightRed],
  ['LIGHTMAGENTA', TextColors.LightMagenta],
  ['YELLOW', TextColors.Yellow],
  ['WHITE', TextColors.White],
  // Blink attribute
  ['BLINK', 128],
  // Text modes
  ['BW40', TextModes.BW40],
  ['CO40', TextModes.CO40],
  ['BW80', TextModes.BW80],
  ['CO80', TextModes.CO80],
  ['MONO', TextModes.Mono],
  ['FONT8X8', TextModes.Font8x8],
]);

/**
 * Map of CRT procedure names to their definitions
 */
export const CRT_PROC_MAP: Map<string, BuiltinDef> = new Map(
  ALL_CRT_PROCS.map((def) => [def.name.toUpperCase(), def])
);

/**
 * Check if a name is a CRT procedure
 * @param name - The name to check (case-insensitive)
 */
export function isCrtProc(name: string): boolean {
  return CRT_PROC_MAP.has(name.toUpperCase());
}

/**
 * Get a CRT procedure definition by name
 * @param name - The name to look up (case-insensitive)
 */
export function getCrtProc(name: string): BuiltinDef | undefined {
  return CRT_PROC_MAP.get(name.toUpperCase());
}

/**
 * Get a CRT constant value by name
 * @param name - The constant name (case-insensitive)
 */
export function getCrtConstant(name: string): number | undefined {
  return CRT_CONSTANTS.get(name.toUpperCase());
}

/**
 * CRT Unit interface for the module system
 */
export interface CrtUnit {
  name: string;
  procedures: BuiltinDef[];
  constants: Map<string, number>;
  variables: CrtVariables;
}

/**
 * Create a new CRT unit instance
 */
export function createCrtUnit(): CrtUnit {
  return {
    name: CRT_UNIT_NAME,
    procedures: ALL_CRT_PROCS,
    constants: CRT_CONSTANTS,
    variables: { ...DEFAULT_CRT_VARIABLES },
  };
}

export default {
  CRT_UNIT_NAME,
  TextColors,
  TextModes,
  CrtProcedure,
  ALL_CRT_PROCS,
  CRT_CONSTANTS,
  CRT_PROC_MAP,
  isCrtProc,
  getCrtProc,
  getCrtConstant,
  createCrtUnit,
};
