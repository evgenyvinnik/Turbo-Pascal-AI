/**
 * Graph Unit for graphics operations
 *
 * This module defines the interface for the Graph unit,
 * which provides graphics-related functions in Turbo Pascal.
 * In a web environment, these will be mapped to HTML Canvas.
 */

import { TypeKind } from '../symbols/Symbol';
import { ParamMode, type BuiltinDef } from './builtin';

/**
 * Graph Unit name constant
 */
export const GRAPH_UNIT_NAME = 'GRAPH';

/**
 * Graphics driver constants
 * In web mode, we simulate VGA graphics
 */
export enum GraphicsDriver {
  Detect = 0,
  CGA = 1,
  MCGA = 2,
  EGA = 3,
  EGA64 = 4,
  EGAMono = 5,
  IBM8514 = 6,
  HercMono = 7,
  ATT400 = 8,
  VGA = 9,
  PC3270 = 10,
}

/**
 * Graphics mode constants for VGA
 */
export enum GraphicsMode {
  VGALo = 0,    // 640x200, 16 colors
  VGAMed = 1,   // 640x350, 16 colors
  VGAHi = 2,    // 640x480, 16 colors
}

/**
 * EGA 16-color palette constants
 */
export enum EgaColors {
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
 * EGA color RGB values for Canvas rendering
 */
export const EGA_PALETTE: { [key: number]: string } = {
  [EgaColors.Black]: '#000000',
  [EgaColors.Blue]: '#0000AA',
  [EgaColors.Green]: '#00AA00',
  [EgaColors.Cyan]: '#00AAAA',
  [EgaColors.Red]: '#AA0000',
  [EgaColors.Magenta]: '#AA00AA',
  [EgaColors.Brown]: '#AA5500',
  [EgaColors.LightGray]: '#AAAAAA',
  [EgaColors.DarkGray]: '#555555',
  [EgaColors.LightBlue]: '#5555FF',
  [EgaColors.LightGreen]: '#55FF55',
  [EgaColors.LightCyan]: '#55FFFF',
  [EgaColors.LightRed]: '#FF5555',
  [EgaColors.LightMagenta]: '#FF55FF',
  [EgaColors.Yellow]: '#FFFF55',
  [EgaColors.White]: '#FFFFFF',
};

/**
 * Line styles
 */
export enum LineStyle {
  SolidLn = 0,
  DottedLn = 1,
  CenterLn = 2,
  DashedLn = 3,
  UserBitLn = 4,
}

/**
 * Line thickness
 */
export enum LineThickness {
  NormWidth = 1,
  ThickWidth = 3,
}

/**
 * Fill styles
 */
export enum FillStyle {
  EmptyFill = 0,
  SolidFill = 1,
  LineFill = 2,
  LtSlashFill = 3,
  SlashFill = 4,
  BkSlashFill = 5,
  LtBkSlashFill = 6,
  HatchFill = 7,
  XHatchFill = 8,
  InterleaveFill = 9,
  WideDotFill = 10,
  CloseDotFill = 11,
  UserFill = 12,
}

/**
 * Text font constants
 */
export enum TextFont {
  DefaultFont = 0,
  TriplexFont = 1,
  SmallFont = 2,
  SansSerifFont = 3,
  GothicFont = 4,
}

/**
 * Text direction constants
 */
export enum TextDirection {
  HorizDir = 0,
  VertDir = 1,
}

/**
 * Text justification constants (horizontal)
 */
export enum HorizJust {
  LeftText = 0,
  CenterText = 1,
  RightText = 2,
}

/**
 * Text justification constants (vertical)
 */
export enum VertJust {
  BottomText = 0,
  CenterText = 1,
  TopText = 2,
}

/**
 * Clip modes
 */
export enum ClipMode {
  ClipOn = 1,
  ClipOff = 0,
}

/**
 * Graphics result codes
 */
export enum GraphResult {
  grOk = 0,
  grNoInitGraph = -1,
  grNotDetected = -2,
  grFileNotFound = -3,
  grInvalidDriver = -4,
  grNoLoadMem = -5,
  grNoScanMem = -6,
  grNoFloodMem = -7,
  grFontNotFound = -8,
  grNoFontMem = -9,
  grInvalidMode = -10,
  grError = -11,
  grIOerror = -12,
  grInvalidFont = -13,
  grInvalidFontNum = -14,
  grInvalidDeviceNum = -15,
  grInvalidVersion = -18,
}

/**
 * Graph procedure indices
 * These are offset from other procedures to avoid conflicts
 */
export enum GraphProcedure {
  /** Base offset for Graph procedures */
  BASE = 200,

  // Initialization
  INITGRAPH = 200,
  CLOSEGRAPH = 201,
  DETECTGRAPH = 202,
  GETGRAPHMODE = 203,
  SETGRAPHMODE = 204,
  GRAPHRESULT = 205,
  GRAPHERRORMSG = 206,
  RESTORECRTMODE = 207,

  // Color and palette
  SETCOLOR = 210,
  GETCOLOR = 211,
  SETBKCOLOR = 212,
  GETBKCOLOR = 213,
  GETMAXCOLOR = 214,
  SETPALETTE = 215,
  GETPALETTE = 216,
  SETALLPALETTE = 217,
  GETDEFAULTPALETTE = 218,

  // Drawing primitives
  PUTPIXEL = 220,
  GETPIXEL = 221,
  LINE = 222,
  LINETO = 223,
  LINEREL = 224,
  MOVETO = 225,
  MOVEREL = 226,
  RECTANGLE = 227,
  BAR = 228,
  BAR3D = 229,
  CIRCLE = 230,
  ARC = 231,
  ELLIPSE = 232,
  FILELLIPSE = 233,
  SECTOR = 234,
  PIESLICE = 235,
  DRAWPOLY = 236,
  FILLPOLY = 237,

  // Fill operations
  FLOODFILL = 240,
  SETFILLSTYLE = 241,
  GETFILLSETTINGS = 242,
  SETFILLPATTERN = 243,
  GETFILLPATTERN = 244,

  // Line style
  SETLINESTYLE = 250,
  GETLINESETTINGS = 251,
  SETWRITEMODE = 252,

  // Text output
  OUTTEXT = 260,
  OUTTEXTXY = 261,
  SETTEXTSTYLE = 262,
  GETTEXTSETTINGS = 263,
  SETTEXTJUSTIFY = 264,
  SETUSERCHARSIZE = 265,
  TEXTWIDTH = 266,
  TEXTHEIGHT = 267,

  // Viewport and screen
  SETVIEWPORT = 270,
  GETVIEWSETTINGS = 271,
  CLEARDEVICE = 272,
  CLEARVIEWPORT = 273,
  GETMAXX = 274,
  GETMAXY = 275,
  GETX = 276,
  GETY = 277,

  // Image operations
  GETIMAGE = 280,
  PUTIMAGE = 281,
  IMAGESIZE = 282,

  // Aspect ratio
  SETASPECTRATIO = 290,
  GETASPECTRATIO = 291,
}

/**
 * Graphics initialization procedures
 */
export const GRAPH_INIT_PROCS: BuiltinDef[] = [
  {
    name: 'InitGraph',
    isFunction: false,
    params: [
      { name: 'GraphDriver', type: TypeKind.INTEGER, mode: ParamMode.VAR },
      { name: 'GraphMode', type: TypeKind.INTEGER, mode: ParamMode.VAR },
      { name: 'PathToDriver', type: TypeKind.STRING, mode: ParamMode.VALUE },
    ],
    description: 'Initialize the graphics system',
    procedureIndex: GraphProcedure.INITGRAPH,
  },
  {
    name: 'CloseGraph',
    isFunction: false,
    params: [],
    description: 'Close the graphics system and return to text mode',
    procedureIndex: GraphProcedure.CLOSEGRAPH,
  },
  {
    name: 'DetectGraph',
    isFunction: false,
    params: [
      { name: 'GraphDriver', type: TypeKind.INTEGER, mode: ParamMode.VAR },
      { name: 'GraphMode', type: TypeKind.INTEGER, mode: ParamMode.VAR },
    ],
    description: 'Detect graphics hardware and recommend settings',
    procedureIndex: GraphProcedure.DETECTGRAPH,
  },
  {
    name: 'GraphResult',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the error code from the last graphics operation',
    procedureIndex: GraphProcedure.GRAPHRESULT,
  },
  {
    name: 'GraphErrorMsg',
    isFunction: true,
    returnType: TypeKind.STRING,
    params: [
      { name: 'ErrorCode', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Return an error message string for a graphics error code',
    procedureIndex: GraphProcedure.GRAPHERRORMSG,
  },
];

/**
 * Graphics color procedures
 */
export const GRAPH_COLOR_PROCS: BuiltinDef[] = [
  {
    name: 'SetColor',
    isFunction: false,
    params: [
      { name: 'Color', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the current drawing color',
    procedureIndex: GraphProcedure.SETCOLOR,
  },
  {
    name: 'GetColor',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the current drawing color',
    procedureIndex: GraphProcedure.GETCOLOR,
  },
  {
    name: 'SetBkColor',
    isFunction: false,
    params: [
      { name: 'Color', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the background color',
    procedureIndex: GraphProcedure.SETBKCOLOR,
  },
  {
    name: 'GetBkColor',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the current background color',
    procedureIndex: GraphProcedure.GETBKCOLOR,
  },
  {
    name: 'GetMaxColor',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the maximum color value (15 for EGA/VGA)',
    procedureIndex: GraphProcedure.GETMAXCOLOR,
  },
];

/**
 * Graphics primitive drawing procedures
 */
export const GRAPH_DRAW_PROCS: BuiltinDef[] = [
  {
    name: 'PutPixel',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Color', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a pixel at (X, Y) in the specified color',
    procedureIndex: GraphProcedure.PUTPIXEL,
  },
  {
    name: 'GetPixel',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Return the color of the pixel at (X, Y)',
    procedureIndex: GraphProcedure.GETPIXEL,
  },
  {
    name: 'Line',
    isFunction: false,
    params: [
      { name: 'X1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'X2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a line from (X1, Y1) to (X2, Y2)',
    procedureIndex: GraphProcedure.LINE,
  },
  {
    name: 'LineTo',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a line from the current position to (X, Y)',
    procedureIndex: GraphProcedure.LINETO,
  },
  {
    name: 'LineRel',
    isFunction: false,
    params: [
      { name: 'Dx', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Dy', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a line relative to the current position',
    procedureIndex: GraphProcedure.LINEREL,
  },
  {
    name: 'MoveTo',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Move the current position to (X, Y)',
    procedureIndex: GraphProcedure.MOVETO,
  },
  {
    name: 'MoveRel',
    isFunction: false,
    params: [
      { name: 'Dx', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Dy', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Move the current position relative by (Dx, Dy)',
    procedureIndex: GraphProcedure.MOVEREL,
  },
  {
    name: 'Rectangle',
    isFunction: false,
    params: [
      { name: 'X1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'X2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a rectangle outline',
    procedureIndex: GraphProcedure.RECTANGLE,
  },
  {
    name: 'Bar',
    isFunction: false,
    params: [
      { name: 'X1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'X2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a filled rectangle (bar)',
    procedureIndex: GraphProcedure.BAR,
  },
  {
    name: 'Bar3D',
    isFunction: false,
    params: [
      { name: 'X1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'X2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Depth', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Top', type: TypeKind.BOOLEAN, mode: ParamMode.VALUE },
    ],
    description: 'Draw a 3D bar',
    procedureIndex: GraphProcedure.BAR3D,
  },
  {
    name: 'Circle',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Radius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a circle centered at (X, Y)',
    procedureIndex: GraphProcedure.CIRCLE,
  },
  {
    name: 'Arc',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'StAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'EndAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Radius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a circular arc',
    procedureIndex: GraphProcedure.ARC,
  },
  {
    name: 'Ellipse',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'StAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'EndAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'XRadius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'YRadius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw an elliptical arc',
    procedureIndex: GraphProcedure.ELLIPSE,
  },
  {
    name: 'FillEllipse',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'XRadius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'YRadius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a filled ellipse',
    procedureIndex: GraphProcedure.FILELLIPSE,
  },
  {
    name: 'PieSlice',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'StAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'EndAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Radius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a filled pie slice',
    procedureIndex: GraphProcedure.PIESLICE,
  },
  {
    name: 'Sector',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'StAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'EndAngle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'XRadius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'YRadius', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Draw a filled elliptical pie slice (sector)',
    procedureIndex: GraphProcedure.SECTOR,
  },
];

/**
 * Graphics fill procedures
 */
export const GRAPH_FILL_PROCS: BuiltinDef[] = [
  {
    name: 'FloodFill',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Border', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Flood fill an area starting at (X, Y) until Border color',
    procedureIndex: GraphProcedure.FLOODFILL,
  },
  {
    name: 'SetFillStyle',
    isFunction: false,
    params: [
      { name: 'Pattern', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Color', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the fill pattern and color',
    procedureIndex: GraphProcedure.SETFILLSTYLE,
  },
  {
    name: 'SetLineStyle',
    isFunction: false,
    params: [
      { name: 'LineStyle', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Pattern', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Thickness', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the line style, pattern, and thickness',
    procedureIndex: GraphProcedure.SETLINESTYLE,
  },
];

/**
 * Graphics text output procedures
 */
export const GRAPH_TEXT_PROCS: BuiltinDef[] = [
  {
    name: 'OutText',
    isFunction: false,
    params: [
      { name: 'TextString', type: TypeKind.STRING, mode: ParamMode.VALUE },
    ],
    description: 'Output text at the current position',
    procedureIndex: GraphProcedure.OUTTEXT,
  },
  {
    name: 'OutTextXY',
    isFunction: false,
    params: [
      { name: 'X', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'TextString', type: TypeKind.STRING, mode: ParamMode.VALUE },
    ],
    description: 'Output text at position (X, Y)',
    procedureIndex: GraphProcedure.OUTTEXTXY,
  },
  {
    name: 'SetTextStyle',
    isFunction: false,
    params: [
      { name: 'Font', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Direction', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'CharSize', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the text font, direction, and character size',
    procedureIndex: GraphProcedure.SETTEXTSTYLE,
  },
  {
    name: 'SetTextJustify',
    isFunction: false,
    params: [
      { name: 'Horiz', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Vert', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set the text justification',
    procedureIndex: GraphProcedure.SETTEXTJUSTIFY,
  },
  {
    name: 'SetUserCharSize',
    isFunction: false,
    params: [
      { name: 'MultX', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'DivX', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'MultY', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'DivY', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
    ],
    description: 'Set custom horizontal and vertical stroke font scaling',
    procedureIndex: GraphProcedure.SETUSERCHARSIZE,
  },
  {
    name: 'TextWidth',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [
      { name: 'TextString', type: TypeKind.STRING, mode: ParamMode.VALUE },
    ],
    description: 'Return the width of a text string in pixels',
    procedureIndex: GraphProcedure.TEXTWIDTH,
  },
  {
    name: 'TextHeight',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [
      { name: 'TextString', type: TypeKind.STRING, mode: ParamMode.VALUE },
    ],
    description: 'Return the height of a text string in pixels',
    procedureIndex: GraphProcedure.TEXTHEIGHT,
  },
];

/**
 * Graphics viewport and screen procedures
 */
export const GRAPH_VIEWPORT_PROCS: BuiltinDef[] = [
  {
    name: 'SetViewPort',
    isFunction: false,
    params: [
      { name: 'X1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y1', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'X2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Y2', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
      { name: 'Clip', type: TypeKind.BOOLEAN, mode: ParamMode.VALUE },
    ],
    description: 'Set the current viewport',
    procedureIndex: GraphProcedure.SETVIEWPORT,
  },
  {
    name: 'ClearDevice',
    isFunction: false,
    params: [],
    description: 'Clear the entire graphics screen',
    procedureIndex: GraphProcedure.CLEARDEVICE,
  },
  {
    name: 'ClearViewPort',
    isFunction: false,
    params: [],
    description: 'Clear the current viewport',
    procedureIndex: GraphProcedure.CLEARVIEWPORT,
  },
  {
    name: 'GetMaxX',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the maximum X coordinate',
    procedureIndex: GraphProcedure.GETMAXX,
  },
  {
    name: 'GetMaxY',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the maximum Y coordinate',
    procedureIndex: GraphProcedure.GETMAXY,
  },
  {
    name: 'GetX',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the current X position',
    procedureIndex: GraphProcedure.GETX,
  },
  {
    name: 'GetY',
    isFunction: true,
    returnType: TypeKind.INTEGER,
    params: [],
    description: 'Return the current Y position',
    procedureIndex: GraphProcedure.GETY,
  },
];

/**
 * All Graph procedures
 */
export const ALL_GRAPH_PROCS: BuiltinDef[] = [
  ...GRAPH_INIT_PROCS,
  ...GRAPH_COLOR_PROCS,
  ...GRAPH_DRAW_PROCS,
  ...GRAPH_FILL_PROCS,
  ...GRAPH_TEXT_PROCS,
  ...GRAPH_VIEWPORT_PROCS,
];

/**
 * Graph constants for export
 */
export const GRAPH_CONSTANTS: Map<string, number> = new Map<string, number>([
  // Graphics drivers
  ['DETECT', GraphicsDriver.Detect as number],
  ['CGA', GraphicsDriver.CGA as number],
  ['MCGA', GraphicsDriver.MCGA as number],
  ['EGA', GraphicsDriver.EGA as number],
  ['EGA64', GraphicsDriver.EGA64 as number],
  ['EGAMONO', GraphicsDriver.EGAMono as number],
  ['IBM8514', GraphicsDriver.IBM8514 as number],
  ['HERCMONO', GraphicsDriver.HercMono as number],
  ['ATT400', GraphicsDriver.ATT400 as number],
  ['VGA', GraphicsDriver.VGA as number],
  ['PC3270', GraphicsDriver.PC3270 as number],

  // Graphics modes
  ['VGALO', GraphicsMode.VGALo as number],
  ['VGAMED', GraphicsMode.VGAMed as number],
  ['VGAHI', GraphicsMode.VGAHi as number],

  // Colors
  ['BLACK', EgaColors.Black],
  ['BLUE', EgaColors.Blue],
  ['GREEN', EgaColors.Green],
  ['CYAN', EgaColors.Cyan],
  ['RED', EgaColors.Red],
  ['MAGENTA', EgaColors.Magenta],
  ['BROWN', EgaColors.Brown],
  ['LIGHTGRAY', EgaColors.LightGray],
  ['DARKGRAY', EgaColors.DarkGray],
  ['LIGHTBLUE', EgaColors.LightBlue],
  ['LIGHTGREEN', EgaColors.LightGreen],
  ['LIGHTCYAN', EgaColors.LightCyan],
  ['LIGHTRED', EgaColors.LightRed],
  ['LIGHTMAGENTA', EgaColors.LightMagenta],
  ['YELLOW', EgaColors.Yellow],
  ['WHITE', EgaColors.White],

  // Line styles
  ['SOLIDLN', LineStyle.SolidLn],
  ['DOTTEDLN', LineStyle.DottedLn],
  ['CENTERLN', LineStyle.CenterLn],
  ['DASHEDLN', LineStyle.DashedLn],
  ['USERBITLN', LineStyle.UserBitLn],

  // Line thickness
  ['NORMWIDTH', LineThickness.NormWidth],
  ['THICKWIDTH', LineThickness.ThickWidth],

  // Fill styles
  ['EMPTYFILL', FillStyle.EmptyFill],
  ['SOLIDFILL', FillStyle.SolidFill],
  ['LINEFILL', FillStyle.LineFill],
  ['LTSLASHFILL', FillStyle.LtSlashFill],
  ['SLASHFILL', FillStyle.SlashFill],
  ['BKSLASHFILL', FillStyle.BkSlashFill],
  ['LTBKSLASHFILL', FillStyle.LtBkSlashFill],
  ['HATCHFILL', FillStyle.HatchFill],
  ['XHATCHFILL', FillStyle.XHatchFill],
  ['INTERLEAVEFILL', FillStyle.InterleaveFill],
  ['WIDEDOTFILL', FillStyle.WideDotFill],
  ['CLOSEDOTFILL', FillStyle.CloseDotFill],
  ['USERFILL', FillStyle.UserFill],

  // Fonts
  ['DEFAULTFONT', TextFont.DefaultFont],
  ['TRIPLEXFONT', TextFont.TriplexFont],
  ['SMALLFONT', TextFont.SmallFont],
  ['SANSSERIFFONT', TextFont.SansSerifFont],
  ['GOTHICFONT', TextFont.GothicFont],

  // Text direction
  ['HORIZDIR', TextDirection.HorizDir],
  ['VERTDIR', TextDirection.VertDir],

  // Text justification
  ['LEFTTEXT', HorizJust.LeftText],
  ['CENTERTEXT', HorizJust.CenterText],
  ['RIGHTTEXT', HorizJust.RightText],
  ['BOTTOMTEXT', VertJust.BottomText],
  ['TOPTEXT', VertJust.TopText],

  // Clip modes
  ['CLIPON', ClipMode.ClipOn],
  ['CLIPOFF', ClipMode.ClipOff],

  // Graphics result codes
  ['GROK', GraphResult.grOk],
  ['GRNOINITGRAPH', GraphResult.grNoInitGraph],
  ['GRNOTDETECTED', GraphResult.grNotDetected],
  ['GRFILENOTFOUND', GraphResult.grFileNotFound],
  ['GRINVALIDDRIVER', GraphResult.grInvalidDriver],
  ['GRNOLOADMEM', GraphResult.grNoLoadMem],
  ['GRNOSCANMEM', GraphResult.grNoScanMem],
  ['GRNOFLOODMEM', GraphResult.grNoFloodMem],
  ['GRFONTNOTFOUND', GraphResult.grFontNotFound],
  ['GRNOFONTMEM', GraphResult.grNoFontMem],
  ['GRINVALIDMODE', GraphResult.grInvalidMode],
  ['GRERROR', GraphResult.grError],
  ['GRIOERROR', GraphResult.grIOerror],
  ['GRINVALIDFONT', GraphResult.grInvalidFont],
  ['GRINVALIDFONTNUM', GraphResult.grInvalidFontNum],
]);

/**
 * Map of Graph procedure names to their definitions
 */
export const GRAPH_PROC_MAP: Map<string, BuiltinDef> = new Map(
  ALL_GRAPH_PROCS.map((def) => [def.name.toUpperCase(), def])
);

/**
 * Check if a name is a Graph procedure
 * @param name - The name to check (case-insensitive)
 */
export function isGraphProc(name: string): boolean {
  return GRAPH_PROC_MAP.has(name.toUpperCase());
}

/**
 * Get a Graph procedure definition by name
 * @param name - The name to look up (case-insensitive)
 */
export function getGraphProc(name: string): BuiltinDef | undefined {
  return GRAPH_PROC_MAP.get(name.toUpperCase());
}

/**
 * Get a Graph constant value by name
 * @param name - The constant name (case-insensitive)
 */
export function getGraphConstant(name: string): number | undefined {
  return GRAPH_CONSTANTS.get(name.toUpperCase());
}

/**
 * Graphics state for runtime
 */
export interface GraphicsState {
  /** Whether graphics mode is initialized */
  initialized: boolean;
  /** Current graphics driver */
  driver: GraphicsDriver;
  /** Current graphics mode */
  mode: GraphicsMode;
  /** Current drawing color */
  color: number;
  /** Current background color */
  bkColor: number;
  /** Current X position */
  x: number;
  /** Current Y position */
  y: number;
  /** Current line style */
  lineStyle: LineStyle;
  /** Current line thickness */
  lineThickness: LineThickness;
  /** Current fill style */
  fillStyle: FillStyle;
  /** Current fill color */
  fillColor: number;
  /** Current text font */
  textFont: TextFont;
  /** Current text direction */
  textDirection: TextDirection;
  /** Current text char size (1-10) */
  textCharSize: number;
  /** Last graphics operation result */
  graphResult: GraphResult;
  /** Viewport boundaries */
  viewport: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    clip: boolean;
  };
}

/**
 * Default graphics state
 */
export const DEFAULT_GRAPHICS_STATE: GraphicsState = {
  initialized: false,
  driver: GraphicsDriver.VGA,
  mode: GraphicsMode.VGAHi,
  color: EgaColors.White,
  bkColor: EgaColors.Black,
  x: 0,
  y: 0,
  lineStyle: LineStyle.SolidLn,
  lineThickness: LineThickness.NormWidth,
  fillStyle: FillStyle.SolidFill,
  fillColor: EgaColors.White,
  textFont: TextFont.DefaultFont,
  textDirection: TextDirection.HorizDir,
  textCharSize: 1,
  graphResult: GraphResult.grOk,
  viewport: {
    x1: 0,
    y1: 0,
    x2: 639,
    y2: 479,
    clip: true,
  },
};

/**
 * Graph Unit interface for the module system
 */
export interface GraphUnit {
  name: string;
  procedures: BuiltinDef[];
  constants: Map<string, number>;
  state: GraphicsState;
  palette: { [key: number]: string };
}

/**
 * Create a new Graph unit instance
 */
export function createGraphUnit(): GraphUnit {
  return {
    name: GRAPH_UNIT_NAME,
    procedures: ALL_GRAPH_PROCS,
    constants: GRAPH_CONSTANTS,
    state: { ...DEFAULT_GRAPHICS_STATE },
    palette: { ...EGA_PALETTE },
  };
}

export default {
  GRAPH_UNIT_NAME,
  GraphicsDriver,
  GraphicsMode,
  EgaColors,
  EGA_PALETTE,
  LineStyle,
  LineThickness,
  FillStyle,
  TextFont,
  TextDirection,
  HorizJust,
  VertJust,
  ClipMode,
  GraphResult,
  GraphProcedure,
  ALL_GRAPH_PROCS,
  GRAPH_CONSTANTS,
  GRAPH_PROC_MAP,
  isGraphProc,
  getGraphProc,
  getGraphConstant,
  DEFAULT_GRAPHICS_STATE,
  createGraphUnit,
};
