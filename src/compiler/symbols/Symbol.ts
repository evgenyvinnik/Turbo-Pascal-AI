/**
 * Symbol kinds for Pascal
 */
export enum SymbolKind {
  CONSTANT = 'constant',
  VARIABLE = 'variable',
  TYPE = 'type',
  PROCEDURE = 'procedure',
  FUNCTION = 'function',
  PARAMETER = 'parameter',
  FIELD = 'field',
  UNIT = 'unit',
}

/**
 * Base type kinds
 */
export enum TypeKind {
  INTEGER = 'integer',
  REAL = 'real',
  BOOLEAN = 'boolean',
  CHAR = 'char',
  STRING = 'string',
  ARRAY = 'array',
  RECORD = 'record',
  SET = 'set',
  POINTER = 'pointer',
  SUBRANGE = 'subrange',
  ENUM = 'enum',
  FILE = 'file',
  PROCEDURE = 'procedure',
  FUNCTION = 'function',
  VOID = 'void',
}

export interface TypeInfo {
  kind: TypeKind;
  size: number;
  elementType?: TypeInfo;
  returnType?: TypeInfo;
  params?: Symbol[];
  fields?: Map<string, Symbol>;
  min?: number;
  max?: number;
  baseType?: TypeInfo;
}

export class Symbol {
  name: string;
  kind: SymbolKind;
  typeInfo: TypeInfo;
  address: number;
  level: number;
  value?: unknown;

  constructor(name: string, kind: SymbolKind, typeInfo: TypeInfo) {
    this.name = name;
    this.kind = kind;
    this.typeInfo = typeInfo;
    this.address = 0;
    this.level = 0;
  }
}
