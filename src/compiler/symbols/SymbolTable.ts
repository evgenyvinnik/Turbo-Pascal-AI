/**
 * Symbol Table for Pascal compiler
 * Manages nested scopes and symbol lookup
 */

import { Symbol, SymbolKind, TypeInfo, TypeKind } from './Symbol';

/**
 * Represents a scope in the symbol table
 */
interface Scope {
  name: string;
  level: number;
  symbols: Map<string, Symbol>;
  parent: Scope | null;
}

/**
 * Built-in type sizes (in bytes)
 */
const TYPE_SIZES: Record<TypeKind, number> = {
  [TypeKind.INTEGER]: 2,
  [TypeKind.REAL]: 6,
  [TypeKind.BOOLEAN]: 1,
  [TypeKind.CHAR]: 1,
  [TypeKind.STRING]: 256,
  [TypeKind.POINTER]: 4,
  [TypeKind.VOID]: 0,
  [TypeKind.ARRAY]: 0,
  [TypeKind.RECORD]: 0,
  [TypeKind.SET]: 32,
  [TypeKind.SUBRANGE]: 2,
  [TypeKind.ENUM]: 2,
  [TypeKind.FILE]: 128,
  [TypeKind.PROCEDURE]: 0,
  [TypeKind.FUNCTION]: 0,
};

/**
 * Symbol Table class
 * Manages symbols across nested scopes for Pascal compilation
 */
export class SymbolTable {
  private currentScope: Scope;
  private globalScope: Scope;
  private scopeLevel: number;

  constructor() {
    this.scopeLevel = 0;
    this.globalScope = {
      name: 'global',
      level: 0,
      symbols: new Map(),
      parent: null,
    };
    this.currentScope = this.globalScope;

    this.initializeBuiltInTypes();
  }

  /**
   * Initialize built-in Pascal types
   */
  private initializeBuiltInTypes(): void {
    // Integer type
    this.insertBuiltInType('integer', {
      kind: TypeKind.INTEGER,
      size: TYPE_SIZES[TypeKind.INTEGER],
    });

    // Real type
    this.insertBuiltInType('real', {
      kind: TypeKind.REAL,
      size: TYPE_SIZES[TypeKind.REAL],
    });

    // Boolean type
    this.insertBuiltInType('boolean', {
      kind: TypeKind.BOOLEAN,
      size: TYPE_SIZES[TypeKind.BOOLEAN],
    });

    // Char type
    this.insertBuiltInType('char', {
      kind: TypeKind.CHAR,
      size: TYPE_SIZES[TypeKind.CHAR],
    });

    // String type
    this.insertBuiltInType('string', {
      kind: TypeKind.STRING,
      size: TYPE_SIZES[TypeKind.STRING],
    });

    // Built-in constants
    this.insertBuiltInConstant('true', TypeKind.BOOLEAN, true);
    this.insertBuiltInConstant('false', TypeKind.BOOLEAN, false);
    this.insertBuiltInConstant('nil', TypeKind.POINTER, null);
    this.insertBuiltInConstant('maxint', TypeKind.INTEGER, 32767);
  }

  /**
   * Insert a built-in type symbol
   */
  private insertBuiltInType(name: string, typeInfo: TypeInfo): void {
    const symbol = new Symbol(name, SymbolKind.TYPE, typeInfo);
    symbol.level = 0;
    this.globalScope.symbols.set(name.toLowerCase(), symbol);
  }

  /**
   * Insert a built-in constant symbol
   */
  private insertBuiltInConstant(name: string, typeKind: TypeKind, value: unknown): void {
    const typeInfo: TypeInfo = {
      kind: typeKind,
      size: TYPE_SIZES[typeKind],
    };
    const symbol = new Symbol(name, SymbolKind.CONSTANT, typeInfo);
    symbol.level = 0;
    symbol.value = value;
    this.globalScope.symbols.set(name.toLowerCase(), symbol);
  }

  /**
   * Push a new scope onto the stack
   */
  pushScope(name: string): void {
    this.scopeLevel++;
    const newScope: Scope = {
      name,
      level: this.scopeLevel,
      symbols: new Map(),
      parent: this.currentScope,
    };
    this.currentScope = newScope;
  }

  /**
   * Pop the current scope from the stack
   */
  popScope(): void {
    if (this.currentScope.parent) {
      this.currentScope = this.currentScope.parent;
      this.scopeLevel--;
    }
  }

  /**
   * Get the current scope level
   */
  getCurrentLevel(): number {
    return this.scopeLevel;
  }

  /**
   * Get the current scope name
   */
  getCurrentScopeName(): string {
    return this.currentScope.name;
  }

  /**
   * Insert a symbol into the current scope
   * Returns false if symbol already exists in current scope
   */
  insert(symbol: Symbol): boolean {
    const key = symbol.name.toLowerCase();

    // Check if symbol already exists in current scope
    if (this.currentScope.symbols.has(key)) {
      return false;
    }

    symbol.level = this.scopeLevel;
    this.currentScope.symbols.set(key, symbol);
    return true;
  }

  /**
   * Lookup a symbol by name in all scopes (current to global)
   */
  lookup(name: string): Symbol | undefined {
    const key = name.toLowerCase();
    let scope: Scope | null = this.currentScope;

    while (scope !== null) {
      const symbol = scope.symbols.get(key);
      if (symbol) {
        return symbol;
      }
      scope = scope.parent;
    }

    return undefined;
  }

  /**
   * Lookup a symbol only in the current scope
   */
  lookupCurrentScope(name: string): Symbol | undefined {
    return this.currentScope.symbols.get(name.toLowerCase());
  }

  /**
   * Lookup a symbol only in the global scope
   */
  lookupGlobal(name: string): Symbol | undefined {
    return this.globalScope.symbols.get(name.toLowerCase());
  }

  /**
   * Check if a symbol exists in any scope
   */
  exists(name: string): boolean {
    return this.lookup(name) !== undefined;
  }

  /**
   * Check if a symbol exists in the current scope
   */
  existsInCurrentScope(name: string): boolean {
    return this.lookupCurrentScope(name) !== undefined;
  }

  /**
   * Get all symbols in the current scope
   */
  getCurrentScopeSymbols(): Symbol[] {
    return Array.from(this.currentScope.symbols.values());
  }

  /**
   * Get a built-in type by name
   */
  getBuiltInType(name: string): TypeInfo | undefined {
    const symbol = this.lookupGlobal(name);
    if (symbol && symbol.kind === SymbolKind.TYPE) {
      return symbol.typeInfo;
    }
    return undefined;
  }

  /**
   * Create an integer type info
   */
  static integerType(): TypeInfo {
    return { kind: TypeKind.INTEGER, size: TYPE_SIZES[TypeKind.INTEGER] };
  }

  /**
   * Create a real type info
   */
  static realType(): TypeInfo {
    return { kind: TypeKind.REAL, size: TYPE_SIZES[TypeKind.REAL] };
  }

  /**
   * Create a boolean type info
   */
  static booleanType(): TypeInfo {
    return { kind: TypeKind.BOOLEAN, size: TYPE_SIZES[TypeKind.BOOLEAN] };
  }

  /**
   * Create a char type info
   */
  static charType(): TypeInfo {
    return { kind: TypeKind.CHAR, size: TYPE_SIZES[TypeKind.CHAR] };
  }

  /**
   * Create a string type info
   */
  static stringType(): TypeInfo {
    return { kind: TypeKind.STRING, size: TYPE_SIZES[TypeKind.STRING] };
  }

  /**
   * Create a void type info (for procedures)
   */
  static voidType(): TypeInfo {
    return { kind: TypeKind.VOID, size: TYPE_SIZES[TypeKind.VOID] };
  }

  /**
   * Create an array type info
   */
  static arrayType(elementType: TypeInfo, min: number, max: number): TypeInfo {
    const count = max - min + 1;
    return {
      kind: TypeKind.ARRAY,
      size: count * elementType.size,
      elementType,
      min,
      max,
    };
  }

  /**
   * Create a pointer type info
   */
  static pointerType(baseType: TypeInfo): TypeInfo {
    return {
      kind: TypeKind.POINTER,
      size: TYPE_SIZES[TypeKind.POINTER],
      baseType,
    };
  }

  /**
   * Create a record type info
   */
  static recordType(fields: Map<string, Symbol>): TypeInfo {
    let size = 0;
    for (const field of fields.values()) {
      size += field.typeInfo.size;
    }
    return {
      kind: TypeKind.RECORD,
      size,
      fields,
    };
  }

  /**
   * Create a procedure type info
   */
  static procedureType(params: Symbol[]): TypeInfo {
    return {
      kind: TypeKind.PROCEDURE,
      size: 0,
      params,
    };
  }

  /**
   * Create a function type info
   */
  static functionType(params: Symbol[], returnType: TypeInfo): TypeInfo {
    return {
      kind: TypeKind.FUNCTION,
      size: 0,
      params,
      returnType,
    };
  }

  /**
   * Check if two types are compatible
   */
  static areTypesCompatible(type1: TypeInfo, type2: TypeInfo): boolean {
    // Same kind is required
    if (type1.kind !== type2.kind) {
      // Integer and real are compatible for assignment (with conversion)
      if (
        (type1.kind === TypeKind.INTEGER && type2.kind === TypeKind.REAL) ||
        (type1.kind === TypeKind.REAL && type2.kind === TypeKind.INTEGER)
      ) {
        return true;
      }
      // Char and string are compatible
      if (
        (type1.kind === TypeKind.CHAR && type2.kind === TypeKind.STRING) ||
        (type1.kind === TypeKind.STRING && type2.kind === TypeKind.CHAR)
      ) {
        return true;
      }
      return false;
    }

    // For arrays, check element types and bounds
    if (type1.kind === TypeKind.ARRAY) {
      if (!type1.elementType || !type2.elementType) {
        return false;
      }
      return (
        this.areTypesCompatible(type1.elementType, type2.elementType) &&
        type1.min === type2.min &&
        type1.max === type2.max
      );
    }

    // For pointers, check base types
    if (type1.kind === TypeKind.POINTER) {
      if (!type1.baseType || !type2.baseType) {
        return true; // Untyped pointers are compatible
      }
      return this.areTypesCompatible(type1.baseType, type2.baseType);
    }

    return true;
  }
}
