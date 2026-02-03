/**
 * Module loader for Pascal units
 *
 * This module manages the registration and loading of Pascal standard library
 * units (CRT, Graph, etc.) that can be imported with the USES clause.
 */

import { TypeKind, SymbolKind, type TypeInfo, Symbol } from '../symbols/Symbol';
import {
  type BuiltinDef,
  ALL_BUILTINS,
  BUILTIN_MAP,
  isBuiltin,
  getBuiltin,
  ParamMode,
} from './builtin';
import {
  CRT_UNIT_NAME,
  CRT_CONSTANTS,
  ALL_CRT_PROCS,
  CRT_PROC_MAP,
  type CrtUnit,
  createCrtUnit,
} from './crt';
import {
  GRAPH_UNIT_NAME,
  GRAPH_CONSTANTS,
  ALL_GRAPH_PROCS,
  GRAPH_PROC_MAP,
  type GraphUnit,
  createGraphUnit,
} from './graph';

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
        ['FMCLOSED', 0xD7B0],
        ['FMINPUT', 0xD7B1],
        ['FMOUTPUT', 0xD7B2],
        ['FMINOUT', 0xD7B3],
        ['READONLY', 0x01],
        ['HIDDEN', 0x02],
        ['SYSFILE', 0x04],
        ['VOLUMEID', 0x08],
        ['DIRECTORY', 0x10],
        ['ARCHIVE', 0x20],
        ['ANYFILE', 0x3F],
      ]),
    });

    // Register STRINGS unit (stub for null-terminated strings)
    this.registerUnit({
      name: StandardUnit.STRINGS,
      procedures: this.createStringsProcs(),
      constants: new Map(),
    });

    // Register PRINTER unit (stub)
    this.registerUnit({
      name: StandardUnit.PRINTER,
      procedures: [],
      constants: new Map(),
      variables: new Map([
        ['LST', { type: { kind: TypeKind.FILE, size: 0 } }],
      ]),
    });
  }

  /**
   * Create DOS unit procedure stubs
   */
  private createDosProcs(): BuiltinDef[] {
    return [
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
        params: [
          { name: 'EnvVar', type: TypeKind.STRING, mode: ParamMode.VALUE },
        ],
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
        params: [
          { name: 'Drive', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
        ],
        description: 'Return the free disk space in bytes',
        procedureIndex: 306,
      },
      {
        name: 'DiskSize',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [
          { name: 'Drive', type: TypeKind.INTEGER, mode: ParamMode.VALUE },
        ],
        description: 'Return the total disk size in bytes',
        procedureIndex: 307,
      },
    ];
  }

  /**
   * Create STRINGS unit procedure stubs (null-terminated string functions)
   */
  private createStringsProcs(): BuiltinDef[] {
    return [
      {
        name: 'StrLen',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [
          { name: 'S', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Return the length of a null-terminated string',
        procedureIndex: 350,
      },
      {
        name: 'StrCopy',
        isFunction: true,
        returnType: TypeKind.POINTER,
        params: [
          { name: 'Dest', type: TypeKind.POINTER, mode: ParamMode.VALUE },
          { name: 'Source', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Copy a null-terminated string',
        procedureIndex: 351,
      },
      {
        name: 'StrCat',
        isFunction: true,
        returnType: TypeKind.POINTER,
        params: [
          { name: 'Dest', type: TypeKind.POINTER, mode: ParamMode.VALUE },
          { name: 'Source', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Concatenate null-terminated strings',
        procedureIndex: 352,
      },
      {
        name: 'StrComp',
        isFunction: true,
        returnType: TypeKind.INTEGER,
        params: [
          { name: 'S1', type: TypeKind.POINTER, mode: ParamMode.VALUE },
          { name: 'S2', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Compare null-terminated strings',
        procedureIndex: 353,
      },
      {
        name: 'StrPos',
        isFunction: true,
        returnType: TypeKind.POINTER,
        params: [
          { name: 'Str', type: TypeKind.POINTER, mode: ParamMode.VALUE },
          { name: 'SubStr', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Find substring in a null-terminated string',
        procedureIndex: 354,
      },
      {
        name: 'StrUpper',
        isFunction: true,
        returnType: TypeKind.POINTER,
        params: [
          { name: 'S', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Convert null-terminated string to uppercase',
        procedureIndex: 355,
      },
      {
        name: 'StrLower',
        isFunction: true,
        returnType: TypeKind.POINTER,
        params: [
          { name: 'S', type: TypeKind.POINTER, mode: ParamMode.VALUE },
        ],
        description: 'Convert null-terminated string to lowercase',
        procedureIndex: 356,
      },
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
    const upperName = name.toUpperCase();

    // Check if it's a builtin first (SYSTEM unit)
    if (isBuiltin(upperName)) {
      const proc = getBuiltin(upperName);
      if (proc) {
        return { proc, unit: StandardUnit.SYSTEM };
      }
    }

    // Check active units in reverse order (later units override earlier)
    const activeList = Array.from(this.activeUnits).reverse();
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
      const symbol = new Symbol(
        name,
        SymbolKind.CONSTANT,
        { kind: TypeKind.INTEGER, size: 2 }
      );
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
