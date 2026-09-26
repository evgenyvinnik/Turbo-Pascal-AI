/**
 * Module loader for Pascal units
 *
 * This module manages the registration and loading of Pascal standard library
 * units (CRT, Graph, etc.) that can be imported with the USES clause.
 */

import { TypeKind, SymbolKind, type TypeInfo, Symbol } from '../symbols/Symbol';
import { type BuiltinDef, ALL_BUILTINS, isBuiltin, getBuiltin, ParamMode } from './builtin';
import { CRT_CONSTANTS, ALL_CRT_PROCS } from './crt';
import { GRAPH_CONSTANTS, ALL_GRAPH_PROCS } from './graph';

/**
 * Unit definition interface
 */
export interface UnitDefinition {
  /** Unit name */
  name: string;
  /** Procedures and functions exported by the unit */
  procedures: BuiltinDef[];
  /** Constants exported by the unit */
  constants: Map<string, number>;
  /** Type definitions exported by the unit */
  types?: Map<string, TypeInfo>;
  /** The unit's own types and constants, in Pascal, declared where it is used. */
  declarations?: string;
  /** Variables exported by the unit */
  variables?: Map<string, { type: TypeInfo; value?: unknown }>;
  /** Whether this unit requires initialization */
  needsInit?: boolean;
  /** Whether this unit requires finalization */
  needsFinal?: boolean;
}

/**
 * Available standard library units
 */
export enum StandardUnit {
  SYSTEM = 'SYSTEM',
  CRT = 'CRT',
  GRAPH = 'GRAPH',
  DOS = 'DOS',
  PRINTER = 'PRINTER',
  OVERLAY = 'OVERLAY',
  STRINGS = 'STRINGS',
  TURBO3 = 'TURBO3',
  GRAPH3 = 'GRAPH3',
}

/**
 * Module loader for Pascal units
 */
export class ModuleLoader {
  /** Map of loaded unit names to their definitions */
  private units: Map<string, UnitDefinition>;

  /** Map of all available procedure names to their unit */
  private procToUnit: Map<string, string>;

  /** Map of all available constant names to their unit */
  private constToUnit: Map<string, string>;

  /** Currently active units (from USES clause) */
  private activeUnits: Set<string>;

  constructor() {
    this.units = new Map();
    this.procToUnit = new Map();
    this.constToUnit = new Map();
    this.activeUnits = new Set();

    // Register all standard units
    this.registerStandardUnits();
  }

  /**
   * Register all standard library units
   */
  private registerStandardUnits(): void {
    // Register SYSTEM unit (implicit, contains builtins)
    this.registerUnit({
      name: StandardUnit.SYSTEM,
      procedures: ALL_BUILTINS,
      constants: new Map([
        ['MAXINT', 32767],
        ['MAXLONGINT', 2147483647],
        ['PI', 3.14159265358979],
        ['TRUE', 1],
        ['FALSE', 0],
      ]),
    });

    // SYSTEM is always active
    this.activeUnits.add(StandardUnit.SYSTEM);

    // Register CRT unit
    this.registerUnit({
      name: StandardUnit.CRT,
      procedures: ALL_CRT_PROCS,
      constants: CRT_CONSTANTS,
      needsInit: true,
    });

    // Register GRAPH unit
    this.registerUnit({
      name: StandardUnit.GRAPH,
      procedures: ALL_GRAPH_PROCS,
      constants: GRAPH_CONSTANTS,
      needsInit: true,
      needsFinal: true,
    });

    // Register DOS unit (stub)
    this.registerUnit({
      name: StandardUnit.DOS,
      procedures: this.createDosProcs(),
      constants: new Map([
        ['FMCLOSED', 0xd7b0],
        ['FMINPUT', 0xd7b1],
        ['FMOUTPUT', 0xd7b2],
        ['FMINOUT', 0xd7b3],
        ['READONLY', 0x01],
        ['HIDDEN', 0x02],
        ['SYSFILE', 0x04],
        ['VOLUMEID', 0x08],
        ['DIRECTORY', 0x10],
        ['ARCHIVE', 0x20],
        ['ANYFILE', 0x3f],
        ['FCARRY', 0x0001],
        ['FPARITY', 0x0004],
        ['FAUXILIARY', 0x0010],
        ['FZERO', 0x0040],
        ['FSIGN', 0x0080],
        ['FOVERFLOW', 0x0800],
      ]),
      declarations: `type
        ComStr = string[127]; PathStr = string[79]; DirStr = string[67]; NameStr = string[8]; ExtStr = string[4];
        Registers = record
          case Integer of
            0: (AX, BX, CX, DX, BP, SI, DI, DS, ES, Flags: Word);
            1: (AL, AH, BL, BH, CL, CH, DL, DH: Byte)
        end;
        SearchRec = record Fill: array[1..21] of Byte; Attr: Byte; Time: Longint; Size: Longint; Name: string[12] end;
        DateTime = record Year, Month, Day, Hour, Min, Sec: Word end;
        FileRec = record
          Handle, Mode, RecSize: Word;
          Private: array[1..26] of Byte;
          UserData: array[1..16] of Byte;
          Name: array[0..79] of Char
        end;
        TextBuf = array[0..127] of Char;
        TextRec = record
          Handle, Mode, BufSize, Private, BufPos, BufEnd: Word;
          BufPtr: ^TextBuf;
          OpenFunc, InOutFunc, FlushFunc, CloseFunc: Pointer;
          UserData: array[1..16] of Byte;
          Name: array[0..79] of Char;
          Buffer: TextBuf
        end;`,
    });

    // Register STRINGS unit (stub for null-terminated strings)
    this.registerUnit({
      name: StandardUnit.STRINGS,
      procedures: this.createStringsProcs(),
      constants: new Map(),
    });

    // Overlays: the P-machine keeps every unit resident, so each call succeeds.
    this.registerUnit({
      name: StandardUnit.OVERLAY,
      procedures: this.createOverlayProcs(),
      constants: new Map([
        ['OVROK', 0],
        ['OVRERROR', -1],
        ['OVRNOTFOUND', -2],
        ['OVRNOMEMORY', -3],
        ['OVRIOERROR', -4],
        ['OVRNOEMSDRIVER', -5],
        ['OVRNOEMSMEMORY', -6],
      ]),
    });

    // Turbo Pascal 3 compatibility: Kbd, CBreak and the routines that changed.
    this.registerUnit({
      name: StandardUnit.TURBO3,
      procedures: this.createTurbo3Procs(),
      constants: new Map(),
    });

    // Turbo Pascal 3's CGA graphics and turtlegraphics.
    this.registerUnit({
      name: StandardUnit.GRAPH3,
      procedures: this.createGraph3Procs(),
      constants: new Map([
        ['NORTH', 0],
        ['EAST', 90],
        ['SOUTH', 180],
        ['WEST', 270],
      ]),
    });

    // Register PRINTER unit (stub)
    this.registerUnit({
      name: StandardUnit.PRINTER,
      procedures: [],
      constants: new Map(),
      variables: new Map([['LST', { type: { kind: TypeKind.FILE, size: 0 } }]]),
    });
  }

  /**
   * Create DOS unit procedure stubs
   */
  private createDosProcs(): BuiltinDef[] {
    const value = (name: string, type = TypeKind.INTEGER) => ({
      name,
      type,
      mode: ParamMode.VALUE,
    });
    const out = (name: string, type = TypeKind.INTEGER) => ({ name, type, mode: ParamMode.VAR });
    const record = (name: string, typeName: string) => ({
      name,
      type: TypeKind.RECORD,
      mode: ParamMode.VAR,
      typeName,
    });
    const routine = (
      name: string,
      procedureIndex: number,
      params: BuiltinDef['params'],
      description: string,
      returnType?: TypeKind
    ): BuiltinDef => ({
      name,
      isFunction: returnType !== undefined,
      ...(returnType === undefined ? {} : { returnType }),
      params,
      description,
      procedureIndex,
    });
    const S = TypeKind.STRING,
      B = TypeKind.BOOLEAN;
    return [
      routine('GetCBreak', 310, [out('Break', B)], 'Whether DOS checks for Ctrl+Break'),
      routine('SetCBreak', 311, [value('Break', B)], 'Set whether DOS checks for Ctrl+Break'),
      routine('GetVerify', 312, [out('Verify', B)], 'Whether DOS verifies disk writes'),
      routine('SetVerify', 313, [value('Verify', B)], 'Set whether DOS verifies disk writes'),
      routine('GetFAttr', 314, [out('F', TypeKind.FILE), out('Attr')], "A file's attributes"),
      routine('SetFAttr', 315, [out('F', TypeKind.FILE), value('Attr')], "Set a file's attributes"),
      routine(
        'GetFTime',
        316,
        [out('F', TypeKind.FILE), out('Time')],
        'When a file was last written, packed'
      ),
      routine(
        'SetFTime',
        317,
        [out('F', TypeKind.FILE), value('Time')],
        'Set when a file was last written'
      ),
      routine(
        'FindFirst',
        318,
        [value('Path', S), value('Attr'), record('F', 'SearchRec')],
        'Find the first file that matches'
      ),
      routine('FindNext', 319, [record('F', 'SearchRec')], 'Find the next file that matches'),
      routine(
        'UnpackTime',
        320,
        [value('P'), record('T', 'DateTime')],
        'A packed time as a DateTime'
      ),
      routine('PackTime', 321, [record('T', 'DateTime'), out('P')], 'A DateTime as a packed time'),
      routine('SwapVectors', 322, [], 'Swap the interrupt vectors the System unit took'),
      routine('Keep', 323, [value('ExitCode')], 'End the program, staying resident'),
      routine('Exec', 324, [value('Path', S), value('ComLine', S)], 'Run another program'),
      routine('DosExitCode', 325, [], 'The exit code of the program Exec ran', TypeKind.INTEGER),
      routine(
        'FSearch',
        326,
        [value('Path', S), value('DirList', S)],
        'Find a file in a list of directories',
        S
      ),
      routine('FExpand', 327, [value('Path', S)], 'A file name with its drive and full path', S),
      routine(
        'FSplit',
        328,
        [value('Path', S), out('Dir', S), out('Name', S), out('Ext', S)],
        'Split a file name into its directory, name and extension'
      ),
      routine('EnvCount', 329, [], 'The number of environment strings', TypeKind.INTEGER),
      routine('EnvStr', 330, [value('Index')], 'An environment string, NAME=value', S),
      routine(
        'Intr',
        331,
        [value('IntNo'), record('Regs', 'Registers')],
        'Call a software interrupt'
      ),
      routine('MsDos', 332, [record('Regs', 'Registers')], 'Call DOS, interrupt 21h'),
      {
        name: 'GetDate',
        isFunction: false,
        params: [
          { name: 'Year', type: TypeKind.INTEGER, mode: ParamMode.VAR },
          { name: 'Month', type: TypeKind.INTEGER, mode: ParamMode.VAR },
          { name: 'Day', type: TypeKind.INTEGER, mode: ParamMode.VAR },
          { name: 'DayOfWeek', type: TypeKind.INTEGER, mode: ParamMode.VAR },
        ],
        description: 'Get the current date',
        procedureIndex: 300,
      },
      {
        name: 'GetTime',
        isFunction: false,
        params: [
          { name: 'Hour', type: TypeKind.INTEGER, mode: ParamMode.VAR },
          { name: 'Minute', type: TypeKind.INTEGER, mode: ParamMode.VAR },
          { name: 'Second', type: TypeKind.INTEGER, mode: ParamMode.VAR },
          { name: 'Sec100', type: TypeKind.INTEGER, mode: ParamMode.VAR },
        ],
        description: 'Get the current time',
        procedureIndex: 301,
      },
      {
        name: 'SetDate',
        isFunction: false,
        params: [
          { name: 'Year', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
          { name: 'Month', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
          { name: 'Day', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
        ],
        description: 'Set the current date',
        procedureIndex: 302,
      },
      {
        name: 'SetTime',
        isFunction: false,
        params: [
          { name: 'Hour', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
          { name: 'Minute', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
          { name: 'Second', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
          { name: 'Sec100', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
        ],
        description: 'Set the current time',
        procedureIndex: 303,
      },
      {
        name: 'GetEnv',
        isFunction: true,
        returnType: TypeKind.STRING,
        params: [{ name: 'EnvVar', type: TypeKind.STRING, mode: ParamMode.VALUE }],
        description: 'Get an environment variable value',
        procedureIndex: 304,
      },
      {
        name: 'DosVersion',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [],
        description: 'Return the DOS version number',
        procedureIndex: 305,
      },
      {
        name: 'DiskFree',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [{ name: 'Drive', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
        description: 'Return the free disk space in bytes',
        procedureIndex: 306,
      },
      {
        name: 'DiskSize',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [{ name: 'Drive', type: TypeKind.INTEGER, mode: ParamMode.VALUE }],
        description: 'Return the total disk size in bytes',
        procedureIndex: 307,
      },
      {
        name: 'SetIntVec',
        isFunction: false,
        params: [
          { name: 'IntNo', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
          { name: 'Vector', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Point an interrupt vector at a handler',
        procedureIndex: 308,
      },
      {
        name: 'GetIntVec',
        isFunction: false,
        params: [
          { name: 'IntNo', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
          { name: 'Vector', type: TypeKind.POINTER, mode: ParamMode.VAR },
        ],
        description: 'The address an interrupt vector holds',
        procedureIndex: 309,
      },
    ];
  }

  /**
   * Create STRINGS unit procedure stubs (null-terminated string functions)
   */
  /** The Overlay unit's routines. */
  private createOverlayProcs(): BuiltinDef[] {
    const longint = (name: string) => ({ name, type: TypeKind.INTEGER, mode: ParamMode.VALUE });
    const routine = (
      name: string,
      procedureIndex: number,
      params: BuiltinDef['params'],
      isFunction: boolean,
      description: string
    ): BuiltinDef => ({
      name,
      isFunction,
      ...(isFunction ? { returnType: TypeKind.INTEGER } : {}),
      params,
      description,
      procedureIndex,
    });
    return [
      routine(
        'OvrInit',
        450,
        [{ name: 'FileName', type: TypeKind.STRING, mode: ParamMode.VALUE }],
        false,
        'Open the overlay file'
      ),
      routine('OvrInitEMS', 451, [], false, 'Load the overlay file into expanded memory'),
      routine('OvrSetBuf', 452, [longint('Size')], false, 'Set the size of the overlay buffer'),
      routine('OvrGetBuf', 453, [], true, 'The size of the overlay buffer'),
      routine('OvrSetRetry', 454, [longint('Size')], false, 'Set the size of the probation area'),
      routine('OvrGetRetry', 455, [], true, 'The size of the probation area'),
      routine('OvrClearBuf', 456, [], false, 'Clear the overlay buffer'),
    ];
  }

  /** The Turbo3 unit's routines, which keep Turbo Pascal 3 programs working. */
  private createTurbo3Procs(): BuiltinDef[] {
    const file = (name: string) => ({ name, type: TypeKind.FILE, mode: ParamMode.VAR });
    return [
      {
        name: 'AssignKbd',
        isFunction: false,
        params: [file('F')],
        description: 'Assign a text file to the keyboard, read without echo',
        procedureIndex: 460,
      },
      {
        name: 'MemAvail',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [],
        description: 'The free heap, in 16-byte paragraphs',
        procedureIndex: 461,
      },
      {
        name: 'MaxAvail',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [],
        description: 'The largest free heap block, in paragraphs',
        procedureIndex: 462,
      },
      {
        name: 'LongFileSize',
        isFunction: true,
        returnType: TypeKind.REAL,
        params: [file('F')],
        description: 'The size of a file, as a real',
        procedureIndex: 463,
      },
      {
        name: 'LongFilePos',
        isFunction: true,
        returnType: TypeKind.REAL,
        params: [file('F')],
        description: 'The position in a file, as a real',
        procedureIndex: 464,
      },
      {
        name: 'LongSeek',
        isFunction: false,
        params: [file('F'), { name: 'Pos', type: TypeKind.REAL, mode: ParamMode.VALUE }],
        description: 'Move to a component given as a real',
        procedureIndex: 465,
      },
      {
        name: 'NormVideo',
        isFunction: false,
        params: [],
        description: 'Yellow text, as Turbo Pascal 3 wrote it',
        procedureIndex: 466,
      },
      {
        name: 'HighVideo',
        isFunction: false,
        params: [],
        description: 'Yellow text, as Turbo Pascal 3 wrote it',
        procedureIndex: 467,
      },
      {
        name: 'LowVideo',
        isFunction: false,
        params: [],
        description: 'Light gray text, as Turbo Pascal 3 wrote it',
        procedureIndex: 468,
      },
    ];
  }

  /** The Graph3 unit: Turbo Pascal 3's graphics, with integer parameters
   * throughout. GetPic, PutPic and Pattern take a variable of any type. */
  private createGraph3Procs(): BuiltinDef[] {
    const routine = (
      name: string,
      procedureIndex: number,
      names: string,
      description: string,
      returnType?: TypeKind
    ): BuiltinDef => ({
      name,
      isFunction: returnType !== undefined,
      ...(returnType === undefined ? {} : { returnType }),
      params: names
        ? names
            .split(',')
            .map((param) =>
              param === 'Buffer' || param === 'P'
                ? { name: param, type: TypeKind.POINTER, mode: ParamMode.VAR }
                : { name: param, type: TypeKind.INTEGER, mode: ParamMode.VALUE }
            )
        : [],
      description,
      procedureIndex,
    });
    const I = TypeKind.INTEGER;
    return [
      routine('GraphMode', 500, '', 'The 320x200 black and white screen'),
      routine('GraphColorMode', 501, '', 'The 320x200 four-color screen'),
      routine('HiRes', 502, '', 'The 640x200 two-color screen'),
      routine('HiResColor', 503, 'Color', 'The color HiRes draws in'),
      routine('Palette', 504, 'N', 'Select a color palette'),
      routine('GraphBackground', 505, 'Color', 'The background color'),
      routine('GraphWindow', 506, 'X1,Y1,X2,Y2', 'Make part of the screen the window'),
      routine('Plot', 507, 'X,Y,Color', 'Plot a dot'),
      routine('Draw', 508, 'X1,Y1,X2,Y2,Color', 'Draw a line'),
      routine('ColorTable', 509, 'C1,C2,C3,C4', 'Set the color translation table'),
      routine('Arc', 510, 'X,Y,Angle,Radius,Color', 'Draw an arc from X, Y'),
      routine('Circle', 511, 'X,Y,Radius,Color', 'Draw a circle'),
      routine('GetPic', 512, 'Buffer,X1,Y1,X2,Y2', 'Copy part of the screen into a variable'),
      routine('PutPic', 513, 'Buffer,X,Y', 'Copy a picture from a variable onto the screen'),
      routine('GetDotColor', 514, 'X,Y', 'The color of a dot', I),
      routine('FillScreen', 515, 'Color', 'Fill the window'),
      routine('FillShape', 516, 'X,Y,FillColor,BorderColor', 'Fill an area up to a border'),
      routine('FillPattern', 517, 'X1,Y1,X2,Y2,Color', 'Fill a rectangle with the pattern'),
      routine('Pattern', 518, 'P', 'Set the fill pattern'),
      routine('Back', 520, 'Dist', 'Move the turtle backwards'),
      routine('ClearScreen', 521, '', 'Clear the window and home the turtle'),
      routine('Forwd', 522, 'Dist', 'Move the turtle forwards'),
      routine('Heading', 523, '', 'The direction the turtle faces', I),
      routine('HideTurtle', 524, '', 'Hide the turtle'),
      routine('Home', 525, '', 'Put the turtle in the middle, facing up'),
      routine('NoWrap', 526, '', 'Stop the turtle at the window edge'),
      routine('PenDown', 527, '', 'Draw as the turtle moves'),
      routine('PenUp', 528, '', 'Move the turtle without drawing'),
      routine('SetHeading', 529, 'Angle', 'Turn the turtle to a heading'),
      routine('SetPenColor', 530, 'Color', 'The color the turtle draws in'),
      routine('SetPosition', 531, 'X,Y', 'Move the turtle without drawing'),
      routine('ShowTurtle', 532, '', 'Show the turtle'),
      routine('TurnLeft', 533, 'Angle', 'Turn the turtle left'),
      routine('TurnRight', 534, 'Angle', 'Turn the turtle right'),
      routine('TurtleDelay', 535, 'Delay', 'Pause after each turtle move'),
      routine('TurtleThere', 536, '', 'Whether the turtle shows in the window', TypeKind.BOOLEAN),
      routine('TurtleWindow', 537, 'X,Y,W,H', 'Make part of the screen the window, by its center'),
      routine('Wrap', 538, '', 'Bring the turtle back on the other side'),
      routine('Xcor', 539, '', "The turtle's X coordinate", I),
      routine('Ycor', 540, '', "The turtle's Y coordinate", I),
    ];
  }

  /** Turbo Pascal's Strings unit: null-terminated strings through PChar. */
  private createStringsProcs(): BuiltinDef[] {
    const pchar = (name: string) => ({ name, type: TypeKind.POINTER, mode: ParamMode.VALUE });
    const word = (name: string) => ({ name, type: TypeKind.INTEGER, mode: ParamMode.VALUE });
    const routine = (
      name: string,
      procedureIndex: number,
      params: BuiltinDef['params'],
      returnType: TypeKind | undefined,
      description: string
    ): BuiltinDef => ({
      name,
      isFunction: returnType !== undefined,
      ...(returnType === undefined ? {} : { returnType }),
      params,
      description,
      procedureIndex,
    });
    const P = TypeKind.POINTER,
      I = TypeKind.INTEGER;
    return [
      routine('StrLen', 350, [pchar('Str')], I, 'The number of characters before the null'),
      routine('StrCopy', 351, [pchar('Dest'), pchar('Source')], P, 'Copy Source to Dest'),
      routine('StrCat', 352, [pchar('Dest'), pchar('Source')], P, 'Append Source to Dest'),
      routine('StrComp', 353, [pchar('Str1'), pchar('Str2')], I, 'Compare two strings'),
      routine(
        'StrPos',
        354,
        [pchar('Str1'), pchar('Str2')],
        P,
        'The first occurrence of Str2 in Str1, or nil'
      ),
      routine('StrUpper', 355, [pchar('Str')], P, 'Convert to uppercase in place'),
      routine('StrLower', 356, [pchar('Str')], P, 'Convert to lowercase in place'),
      routine('StrEnd', 357, [pchar('Str')], P, 'A pointer to the terminating null'),
      routine(
        'StrMove',
        358,
        [pchar('Dest'), pchar('Source'), word('Count')],
        P,
        'Copy Count characters, nulls included'
      ),
      routine(
        'StrECopy',
        359,
        [pchar('Dest'), pchar('Source')],
        P,
        'Copy Source to Dest and point at its end'
      ),
      routine(
        'StrLCopy',
        360,
        [pchar('Dest'), pchar('Source'), word('MaxLen')],
        P,
        'Copy at most MaxLen characters'
      ),
      routine(
        'StrPCopy',
        361,
        [pchar('Dest'), { name: 'Source', type: TypeKind.STRING, mode: ParamMode.VALUE }],
        P,
        'Copy a Pascal string to Dest'
      ),
      routine(
        'StrLCat',
        362,
        [pchar('Dest'), pchar('Source'), word('MaxLen')],
        P,
        'Append, keeping Dest to MaxLen characters'
      ),
      routine('StrIComp', 363, [pchar('Str1'), pchar('Str2')], I, 'Compare, ignoring case'),
      routine(
        'StrLComp',
        364,
        [pchar('Str1'), pchar('Str2'), word('MaxLen')],
        I,
        'Compare at most MaxLen characters'
      ),
      routine(
        'StrLIComp',
        365,
        [pchar('Str1'), pchar('Str2'), word('MaxLen')],
        I,
        'Compare at most MaxLen characters, ignoring case'
      ),
      routine(
        'StrScan',
        366,
        [pchar('Str'), { name: 'Chr', type: TypeKind.CHAR, mode: ParamMode.VALUE }],
        P,
        'The first occurrence of Chr, or nil'
      ),
      routine(
        'StrRScan',
        367,
        [pchar('Str'), { name: 'Chr', type: TypeKind.CHAR, mode: ParamMode.VALUE }],
        P,
        'The last occurrence of Chr, or nil'
      ),
      routine(
        'StrPas',
        368,
        [pchar('Str')],
        TypeKind.STRING,
        'A null-terminated string as a Pascal string'
      ),
      routine('StrNew', 369, [pchar('Str')], P, 'A copy on the heap, or nil for an empty string'),
      routine('StrDispose', 370, [pchar('Str')], undefined, 'Release a string StrNew made'),
    ];
  }

  /**
   * Register a unit
   * @param unit - The unit definition to register
   */
  registerUnit(unit: UnitDefinition): void {
    const upperName = unit.name.toUpperCase();
    this.units.set(upperName, unit);

    // Map procedures to their unit
    for (const proc of unit.procedures) {
      this.procToUnit.set(proc.name.toUpperCase(), upperName);
    }

    // Map constants to their unit
    for (const [constName] of unit.constants) {
      this.constToUnit.set(constName.toUpperCase(), upperName);
    }
  }

  /**
   * Activate a unit (from USES clause)
   * @param unitName - The name of the unit to activate
   * @returns true if the unit was activated, false if not found
   */
  useUnit(unitName: string): boolean {
    const upperName = unitName.toUpperCase();
    if (!this.units.has(upperName)) {
      return false;
    }
    this.activeUnits.add(upperName);
    return true;
  }

  /**
   * Check if a unit is available
   * @param unitName - The name of the unit to check
   */
  hasUnit(unitName: string): boolean {
    return this.units.has(unitName.toUpperCase());
  }

  /**
   * Check if a unit is currently active
   * @param unitName - The name of the unit to check
   */
  isUnitActive(unitName: string): boolean {
    return this.activeUnits.has(unitName.toUpperCase());
  }

  /**
   * Get a unit definition
   * @param unitName - The name of the unit
   */
  getUnit(unitName: string): UnitDefinition | undefined {
    return this.units.get(unitName.toUpperCase());
  }

  /**
   * Get all active units
   */
  getActiveUnits(): string[] {
    return Array.from(this.activeUnits);
  }

  /**
   * Look up a procedure by name in active units
   * @param name - The procedure name (case-insensitive)
   * @returns The procedure definition and unit name, or undefined
   */
  lookupProcedure(name: string): { proc: BuiltinDef; unit: string } | undefined {
    // A name the program qualified, as in System.MemAvail, comes from that unit.
    const [qualifier, member] = name.toUpperCase().split('.');
    if (member !== undefined && qualifier !== undefined) {
      if (qualifier === (StandardUnit.SYSTEM as string)) {
        const proc = isBuiltin(member) ? getBuiltin(member) : undefined;
        return proc ? { proc, unit: qualifier } : undefined;
      }
      if (!this.activeUnits.has(qualifier)) return undefined;
      const proc = this.units
        .get(qualifier)
        ?.procedures.find((entry) => entry.name.toUpperCase() === member);
      return proc ? { proc, unit: qualifier } : undefined;
    }
    const upperName = name.toUpperCase();

    // Units a program uses shadow the System unit, the last one named first,
    // as in Turbo Pascal: Turbo3's MemAvail replaces System's.
    const activeList = Array.from(this.activeUnits).reverse();
    for (const unitName of activeList) {
      if (unitName === (StandardUnit.SYSTEM as string)) continue;
      const unit = this.units.get(unitName);
      if (unit) {
        for (const proc of unit.procedures) {
          if (proc.name.toUpperCase() === upperName) {
            return { proc, unit: unitName };
          }
        }
      }
    }

    if (isBuiltin(upperName)) {
      const proc = getBuiltin(upperName);
      if (proc) {
        return { proc, unit: StandardUnit.SYSTEM };
      }
    }

    for (const unitName of activeList) {
      const unit = this.units.get(unitName);
      if (unit) {
        for (const proc of unit.procedures) {
          if (proc.name.toUpperCase() === upperName) {
            return { proc, unit: unitName };
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Look up a constant by name in active units
   * @param name - The constant name (case-insensitive)
   * @returns The constant value and unit name, or undefined
   */
  lookupConstant(name: string): { value: number; unit: string } | undefined {
    const [qualifier, member] = name.toUpperCase().split('.');
    if (member !== undefined && qualifier !== undefined) {
      const value = this.activeUnits.has(qualifier)
        ? this.units.get(qualifier)?.constants.get(member)
        : undefined;
      return value === undefined ? undefined : { value, unit: qualifier };
    }
    const upperName = name.toUpperCase();

    // Check active units in reverse order (later units override earlier)
    const activeList = Array.from(this.activeUnits).reverse();
    for (const unitName of activeList) {
      const unit = this.units.get(unitName);
      if (unit) {
        const value = unit.constants.get(upperName);
        if (value !== undefined) {
          return { value, unit: unitName };
        }
      }
    }

    return undefined;
  }

  /**
   * Get all procedures available in active units
   */
  getAvailableProcedures(): BuiltinDef[] {
    const procs: BuiltinDef[] = [];
    const seen = new Set<string>();

    // Collect procedures from all active units (later units override earlier)
    const activeList = Array.from(this.activeUnits).reverse();
    for (const unitName of activeList) {
      const unit = this.units.get(unitName);
      if (unit) {
        for (const proc of unit.procedures) {
          const upperName = proc.name.toUpperCase();
          if (!seen.has(upperName)) {
            seen.add(upperName);
            procs.push(proc);
          }
        }
      }
    }

    return procs;
  }

  /**
   * Get all constants available in active units
   */
  getAvailableConstants(): Map<string, number> {
    const constants = new Map<string, number>();

    // Collect constants from all active units (later units override earlier)
    for (const unitName of this.activeUnits) {
      const unit = this.units.get(unitName);
      if (unit) {
        for (const [name, value] of unit.constants) {
          constants.set(name.toUpperCase(), value);
        }
      }
    }

    return constants;
  }

  /**
   * Reset active units (except SYSTEM)
   */
  resetActiveUnits(): void {
    this.activeUnits.clear();
    this.activeUnits.add(StandardUnit.SYSTEM);
  }

  /**
   * Get list of all registered unit names
   */
  getRegisteredUnits(): string[] {
    return Array.from(this.units.keys());
  }

  /**
   * Create symbol table entries for a unit's exports
   * @param unitName - The name of the unit
   */
  createUnitSymbols(unitName: string): Symbol[] {
    const unit = this.getUnit(unitName);
    if (!unit) {
      return [];
    }

    const symbols: Symbol[] = [];

    // Create symbols for procedures/functions
    for (const proc of unit.procedures) {
      const typeInfo: TypeInfo = proc.returnType
        ? {
            kind: proc.isFunction ? TypeKind.FUNCTION : TypeKind.PROCEDURE,
            size: 0,
            returnType: { kind: proc.returnType, size: 0 },
          }
        : {
            kind: proc.isFunction ? TypeKind.FUNCTION : TypeKind.PROCEDURE,
            size: 0,
          };

      const symbol = new Symbol(
        proc.name,
        proc.isFunction ? SymbolKind.FUNCTION : SymbolKind.PROCEDURE,
        typeInfo
      );
      symbol.value = proc.procedureIndex;
      symbols.push(symbol);
    }

    // Create symbols for constants
    for (const [name, value] of unit.constants) {
      const symbol = new Symbol(name, SymbolKind.CONSTANT, { kind: TypeKind.INTEGER, size: 2 });
      symbol.value = value;
      symbols.push(symbol);
    }

    return symbols;
  }
}

/**
 * Global module loader instance
 */
let globalModuleLoader: ModuleLoader | null = null;

/**
 * Get the global module loader instance
 */
export function getModuleLoader(): ModuleLoader {
  if (!globalModuleLoader) {
    globalModuleLoader = new ModuleLoader();
  }
  return globalModuleLoader;
}

/**
 * Create a new module loader instance
 */
export function createModuleLoader(): ModuleLoader {
  return new ModuleLoader();
}

/**
 * Reset the global module loader
 */
export function resetModuleLoader(): void {
  globalModuleLoader = null;
}

export default {
  ModuleLoader,
  StandardUnit,
  getModuleLoader,
  createModuleLoader,
  resetModuleLoader,
};
