/**
 * Pascal Standard Library module
 *
 * This module provides the standard library units for Turbo Pascal,
 * including built-in procedures/functions, CRT, and Graph units.
 */

// Built-in procedures and functions
export {
  ParamMode,
  BuiltinProcedure,
  type BuiltinParam,
  type BuiltinDef,
  IO_BUILTINS,
  ORDINAL_BUILTINS,
  MATH_BUILTINS,
  CONVERSION_BUILTINS,
  STRING_BUILTINS,
  MEMORY_BUILTINS,
  CONTROL_BUILTINS,
  RANDOM_BUILTINS,
  ALL_BUILTINS,
  BUILTIN_MAP,
  isBuiltin,
  getBuiltin,
  getBuiltinReturnType,
} from './builtin';

// CRT unit
export {
  CRT_UNIT_NAME,
  TextColors,
  TextModes,
  CrtProcedure,
  CRT_SCREEN_PROCS,
  CRT_COLOR_PROCS,
  CRT_KEYBOARD_PROCS,
  CRT_SOUND_PROCS,
  ALL_CRT_PROCS,
  CRT_CONSTANTS,
  CRT_PROC_MAP,
  isCrtProc,
  getCrtProc,
  getCrtConstant,
  createCrtUnit,
  type CrtUnit,
  type CrtVariables,
  DEFAULT_CRT_VARIABLES,
} from './crt';

// Graph unit
export {
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
  GRAPH_INIT_PROCS,
  GRAPH_COLOR_PROCS,
  GRAPH_DRAW_PROCS,
  GRAPH_FILL_PROCS,
  GRAPH_TEXT_PROCS,
  GRAPH_VIEWPORT_PROCS,
  ALL_GRAPH_PROCS,
  GRAPH_CONSTANTS,
  GRAPH_PROC_MAP,
  isGraphProc,
  getGraphProc,
  getGraphConstant,
  createGraphUnit,
  type GraphUnit,
  type GraphicsState,
  DEFAULT_GRAPHICS_STATE,
} from './graph';

// Module loader
export {
  ModuleLoader,
  StandardUnit,
  type UnitDefinition,
  getModuleLoader,
  createModuleLoader,
  resetModuleLoader,
} from './modules';
