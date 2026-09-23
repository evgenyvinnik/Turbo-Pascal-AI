/** Semantic analysis and P-code generation for the parser's Pascal AST. */
import { Parser } from '../parser/Parser';
import { Lexer, Stream } from '../lexer';
import type { UnitNode } from '../parser/Node';
import { PascalError } from '../errors/PascalError';
import {
  NodeType,
  type Node,
  type ProgramNode,
  type BlockNode,
  type ProcedureNode,
  type FunctionNode,
  type ParameterNode,
  type VarDeclarationNode,
  type TypeDeclarationNode,
  type ConstDeclarationNode,
  type TypedConstDeclarationNode,
  type VariantPart,
  type ArrayConstantNode,
  type RecordConstantNode,
  type AssignmentNode,
  type CallNode,
  type BinaryOpNode,
  type UnaryOpNode,
  type ArrayAccessNode,
  type FieldAccessNode,
  type IfStatementNode,
  type WhileStatementNode,
  type RepeatStatementNode,
  type ForStatementNode,
  type CaseStatementNode,
  type ArrayTypeNode,
  type RecordTypeNode,
  type SubrangeTypeNode,
  type EnumTypeNode,
} from '../parser/Node';
import { Opcode, TypeCode, MARK_SIZE } from '../types';
import { InternalProcedure, NativeRegistry } from '../runtime/Native';
import { CONSOLE_INPUT, CONSOLE_KEYBOARD, CONSOLE_OUTPUT } from '../runtime/FileRuntime';
import type { BinaryCell } from '../runtime/BinaryCodec';
import type { RawInstruction } from '../asm/parse';
import { assemble, type AsmName } from '../asm/resolve';
import type { AsmBlock, AsmVariable, Operand } from '../asm/types';
import { NativePascalRequired } from '../errors/NativePascalRequired';
import { decodeInline, type InlineByte } from '../asm/inline';
import { ModuleLoader, StandardUnit } from '../stdlib/modules';
import { ParamMode, type BuiltinDef } from '../stdlib/builtin';
import { TypeKind } from '../symbols/Symbol';
import { Bytecode, type DebugType, type VariantPartInfo, type ViewShape } from './Bytecode';
import {
  roundReal48,
  integerOperation,
  realOperation,
  coprocessorOperation,
  coprocessorValue,
  compValue,
  defaultRealWidth,
  formatReal,
} from './numeric';

export interface CompilerOptions {
  /** Resolve a user unit from the current virtual workspace. Names are case insensitive. */
  resolveUnit?: (name: string) => string | UnitNode | undefined;
}
interface CompiledUnit { node: UnitNode; scope: Scope; exports: Map<string, Symbol>; state: 'interface' | 'implementation' | 'ready'; debugStart?: number; debugEnd?: number }

/** Kept as an alias for callers that previously imported the compiler AST type. */
export type INode = Node;
type Value = number | string | boolean | null;
type Kind =
  | 'integer'
  | 'real'
  | 'boolean'
  | 'char'
  | 'string'
  | 'array'
  | 'record'
  | 'pointer'
  | 'set'
  | 'file'
  | 'void'
  /** An untyped `var` or `const` parameter: an address with no type. */
  | 'untyped';
interface PascalType {
  kind: Kind;
  size: number;
  byteSize: number;
  capacity?: number;
  openString?: boolean;
  /** Maximum-length string type declared under P+, retained by type aliases. */
  openStringDeclaration?: boolean;
  openCapacity?: Variable;
  /** Comp: an 8087 real that holds 64-bit integers. */
  comp?: boolean;
  /** `array of T` in a parameter list; indices run from 0 to the hidden High. */
  openArray?: boolean;
  openHigh?: Variable;
  base?: PascalType;
  element?: PascalType;
  index?: PascalType;
  low?: number;
  high?: number;
  fields?: Map<string, RecordField>;
  /** A variant record's storage as files store it: the fixed part, the tag,
   * and each variant part's bytes, its shadow. */
  layout?: { offset: number; type: PascalType }[];
  /** Every cell of a variant record: those of each case and the shadows. */
  initialLayout?: { offset: number; type: PascalType }[];
  /** The variant parts in a record, its fields' records included, to bring
   * up to date when its bytes change as a whole. */
  variantRefresh?: { part: number; offset: number }[];
  /** The record's own variant parts, nested ones too, and the byte each
   * starts at. */
  variantParts?: { part: number; byteStart: number }[];
  /** An untyped parameter's hidden companion: the layout its caller passed. */
  untypedLayout?: Variable;
  /** Nominal identity shared by aliases and subranges of one enumeration. */
  enumeration?: object;
  procedureSignature?: { parameters: Parameter[]; result: PascalType };
  object?: { id: number; ancestor?: PascalType | undefined; hasVirtual: boolean; methods: Map<string, Routine> };
}
interface Variable {
  kind: 'variable';
  name: string;
  type: PascalType;
  offset: number;
  scope: Scope;
  reference: boolean;
  result?: boolean;
  parameter?: boolean;
  container?: Variable;
  /** A variable declared absolute over one of another layout: it is a view
   * of that variable's bytes, with no storage of its own. */
  view?: { target: Variable };
  /** A field reached through WITH that lies in variant cases: those cases,
   * and the record type it is a field of. */
  variants?: { part: number; case: number }[];
  containerType?: PascalType;
  /** A typed constant: program-lifetime storage, whatever scope names it. */
  static?: boolean;
  /** A `const` parameter. */
  readOnly?: boolean;
}
/** One scalar cell of a typed constant's initial value. */
interface StaticStore {
  offset: number;
  type: PascalType;
  value: Value;
  /** After the stores: a variant part of the record at `offset` follows the
   * case given. */
  sync?: { part: number; case: number };
}
/** A record's field. One in a variant case lists the cases it is in, the
 * innermost first; a store into it brings those parts up to date. */
interface RecordField {
  offset: number;
  type: PascalType;
  privateOwner?: Scope;
  /** Where the field lies in Turbo Pascal's layout of the record. */
  byteOffset?: number;
  variants?: { part: number; case: number }[];
}
interface Constant {
  kind: 'constant';
  type: PascalType;
  value: Value;
}
interface TypeSymbol {
  kind: 'type';
  type: PascalType;
}
interface Parameter {
  openString?: boolean;
  name: string;
  type: PascalType;
  reference: boolean;
  /** A `const` parameter, which the routine may not change. */
  readOnly?: boolean;
}
interface Routine {
  kind: 'routine';
  proceduralId: number;
  methodOwner?: PascalType;
  privateOwner?: Scope;
  virtual?: boolean;
  dynamicIndex?: number;
  name: string;
  type: PascalType;
  parameters: Parameter[];
  declaration: ProcedureNode | FunctionNode;
  parent: Scope;
  address?: number;
  patches: number[];
}
type Symbol = Variable | Constant | TypeSymbol | Routine;
interface Loop {
  breaks: number[];
  continues: number[];
}
interface Scope {
  id: number;
  name: string;
  /** `uses` are the goto statements that jump to the label. */
  labels: Map<string, { node: Node; address?: number; patches: number[]; uses: Node[] }>;
  withRecords: { pointer: Variable; type: PascalType }[];
  parent: Scope | null;
  level: number;
  /** On a module's outermost scope: the module is compiled for the 8087. */
  coprocessor?: boolean;
  /** Value open array parameters, which the routine copies when it starts. */
  openCopies?: Variable[];
  symbols: Map<string, Symbol>;
  imports: Map<string, Map<string, Symbol>>;
  methodOwner?: PascalType;
  self?: Variable;
  constructorBody?: boolean;
  nextOffset: number;
  locals: Variable[];
  routines: Routine[];
  exits: number[];
  loops: Loop[];
}
const INTEGER: PascalType = { kind: 'integer', size: 1, byteSize: 2, low: -32768, high: 32767 };
const SHORTINT: PascalType = { ...INTEGER, byteSize: 1, low: -128, high: 127 };
const BYTE: PascalType = { ...INTEGER, byteSize: 1, low: 0, high: 255 };
const WORD: PascalType = { ...INTEGER, low: 0, high: 65535 };
const LONGINT: PascalType = {
  kind: 'integer',
  size: 1,
  byteSize: 4,
  low: -2147483648,
  high: 2147483647,
};
const REAL: PascalType = { kind: 'real', size: 1, byteSize: 6 };
const UNTYPED: PascalType = { kind: 'untyped', size: 1, byteSize: 0 };
/** The System unit's variables. They sit at fixed addresses just past the
 * program's mark, so a unit and the program that uses it see the same cells. */
interface StandardVariable {
  name: string;
  kind: 'word' | 'longint' | 'integer' | 'byte' | 'boolean' | 'pointer' | 'text';
  initial: number;
  /** A unit's variable, declared only where that unit is used. */
  unit?: string;
}
const STANDARD_VARIABLES: readonly StandardVariable[] = [
  { name: 'ExitCode', kind: 'word', initial: 0 },
  { name: 'RandSeed', kind: 'longint', initial: 0 },
  { name: 'FileMode', kind: 'word', initial: 2 },
  { name: 'Test8087', kind: 'byte', initial: 3 },
  { name: 'Test8086', kind: 'byte', initial: 3 },
  { name: 'ExitProc', kind: 'pointer', initial: 0 },
  { name: 'ErrorAddr', kind: 'pointer', initial: 0 },
  // The heap's bounds and top, which the machine keeps current. It grows
  // down from HeapOrg towards HeapEnd.
  { name: 'HeapOrg', kind: 'pointer', initial: 0 },
  { name: 'HeapPtr', kind: 'pointer', initial: 0 },
  { name: 'HeapEnd', kind: 'pointer', initial: 0 },
  // Input and Output start on the console's handles; a program may assign
  // them to files on the drive.
  { name: 'Input', kind: 'text', initial: CONSOLE_INPUT },
  { name: 'Output', kind: 'text', initial: CONSOLE_OUTPUT },
  // The Crt unit's; the machine keeps the first four in step with the screen.
  { name: 'TextAttr', kind: 'byte', initial: 7, unit: 'crt' },
  { name: 'WindMin', kind: 'word', initial: 0, unit: 'crt' },
  { name: 'WindMax', kind: 'word', initial: 0x184f, unit: 'crt' },
  { name: 'LastMode', kind: 'word', initial: 3, unit: 'crt' },
  { name: 'CheckBreak', kind: 'boolean', initial: 1, unit: 'crt' },
  { name: 'CheckEOF', kind: 'boolean', initial: 0, unit: 'crt' },
  { name: 'CheckSnow', kind: 'boolean', initial: 0, unit: 'crt' },
  { name: 'DirectVideo', kind: 'boolean', initial: 1, unit: 'crt' },
  // The Printer unit's Lst, opened on LPT1 when the program starts.
  { name: 'Lst', kind: 'text', initial: 0, unit: 'printer' },
  // The Dos unit's result of its last call.
  { name: 'DosError', kind: 'integer', initial: 0, unit: 'dos' },
  { name: 'OvrResult', kind: 'integer', initial: 0, unit: 'overlay' },
  { name: 'OvrTrapCount', kind: 'word', initial: 0, unit: 'overlay' },
  { name: 'OvrLoadCount', kind: 'word', initial: 0, unit: 'overlay' },
  { name: 'OvrFileMode', kind: 'byte', initial: 0, unit: 'overlay' },
  // Turbo3's keyboard file, read without echo, and its Ctrl+Break switch.
  { name: 'Kbd', kind: 'text', initial: CONSOLE_KEYBOARD, unit: 'turbo3' },
  { name: 'CBreak', kind: 'boolean', initial: 1, unit: 'turbo3' },
];
/** Builtins of the System unit, which extended syntax does not cover. */
const SYSTEM_UNIT: string = StandardUnit.SYSTEM;
/** What 8087 arithmetic produces; stores round it to the variable's type. */
const EXTENDED: PascalType = { ...REAL, byteSize: 10 };
const BOOLEAN: PascalType = { kind: 'boolean', size: 1, byteSize: 1, low: 0, high: 1 };
const CHAR: PascalType = { kind: 'char', size: 1, byteSize: 1, low: 0, high: 255 };
const STRING: PascalType = { kind: 'string', size: 1, byteSize: 256, capacity: 255 };
const POINTER: PascalType = { kind: 'pointer', size: 1, byteSize: 4 };
const TEXTFILE: PascalType = { kind: 'file', size: 1, byteSize: 256, element: CHAR };
const VOID: PascalType = { kind: 'void', size: 0, byteSize: 0 };
const SET: PascalType = { kind: 'set', size: 1, byteSize: 32, base: INTEGER, low: 0, high: 255 };

export class Compiler {
  private bytecode = new Bytecode();
  private native = new NativeRegistry();
  private modules = new ModuleLoader();
  private scope!: Scope;
  private helpers = new Map<string, number>();
  private line = 1;
  private sourceFile: string | undefined;
  private scopeId = 0;
  private ioChecking = true;
  private units = new Map<string, CompiledUnit>();
  private initializationOrder: CompiledUnit[] = [];
  private compilerOptions: CompilerOptions = {};
  private globalOffset = MARK_SIZE;
  /** Whether a module uses the Printer unit, whose Lst the program opens. */
  private printerUsed = false;
  /** The standard units any module uses, whose variables the machine sets up. */
  private standardUnits = new Set<string>();
  /** The standard units' types, variables and constants, for qualified names
   * such as System.Integer and Crt.TextAttr. */
  private standardSymbols = new Map<string, Map<string, Symbol>>();
  /** The types standard units declare in Pascal, by unit. */
  private unitDeclarations = new Map<string, Map<string, Symbol>>();
  /** Byte layouts and view maps already numbered, by their JSON. */
  private layoutIds = new Map<string, number>();
  private viewMapIds = new Map<string, number>();
  private refreshIds = new Map<string, number>();
  /** Halt statements, which jump to the program's exit procedures. */
  private haltJumps: number[] = [];
  /** The program's name, which ParamStr(0) reports. */
  private programName = 'PROGRAM';
  /** Typed constants, set once when the program starts. */
  private typedConstants: { variable: Variable; stores: StaticStore[] }[] = [];
  private objectTypes: PascalType[] = [];
  private routineValues: Routine[] = [];

  compile(root: Node, options: CompilerOptions = {}): Bytecode {
    if (root.type === NodeType.UNIT) {
      const unit = root as UnitNode;
      return this.compile({ ...root, type: NodeType.PROGRAM, name: `$compile_${unit.name}`, uses: [unit.name],
        block: { type: NodeType.BLOCK, declarations: [], statements: [], lineNumber: root.lineNumber, sourceFile: root.sourceFile } }, {
        ...options, resolveUnit: name => name.toLowerCase() === unit.name.toLowerCase() ? unit : options.resolveUnit?.(name),
      });
    }
    this.native = new NativeRegistry();
    this.bytecode = new Bytecode(this.native);
    this.modules = new ModuleLoader();
    this.helpers = new Map();
    this.scopeId = 0;
    this.ioChecking = true;
    this.units = new Map();
    this.initializationOrder = [];
    this.compilerOptions = options;
    this.globalOffset = MARK_SIZE + STANDARD_VARIABLES.length;
    this.printerUsed = false;
    this.standardUnits = new Set();
    this.unitDeclarations = new Map();
    this.layoutIds = new Map();
    this.viewMapIds = new Map();
    this.refreshIds = new Map();
    this.haltJumps = [];
    this.objectTypes = [];
    this.routineValues = [];
    this.typedConstants = [];
    this.line = root.lineNumber ?? 1;
    this.sourceFile = typeof root.sourceFile === 'string' ? root.sourceFile : undefined;
    if (root.type !== NodeType.PROGRAM) this.fail(root, 'A Pascal program is required');
    const program = root as ProgramNode;
    this.programName = program.name;
    this.scope = this.newScope(null, program.name);
    this.scope.nextOffset = this.globalOffset;
    this.scope.coprocessor = this.usesCoprocessor(root);
    this.addBuiltins();
    const programScope = this.scope;
    this.importUnits(program.uses ?? [], root);
    this.scope.nextOffset = this.globalOffset;
    this.declarations(program.block.declarations);
    this.globalOffset = this.scope.nextOffset;
    for (const unit of this.initializationOrder) {
      this.scope = unit.scope;
      for (const routine of this.scope.routines) this.compileRoutine(routine);
    }
    this.scope = programScope;
    for (const routine of this.scope.routines) this.compileRoutine(routine);
    // Typed constants in routines take program storage beyond the globals.
    this.scope.nextOffset = Math.max(this.scope.nextOffset, this.globalOffset);
    // Unit globals share the program activation, but retain separate lexical namespaces.
    this.scope.locals.unshift(...this.initializationOrder.flatMap(unit => unit.scope.locals));
    this.bytecode.setStartAddress();
    const block = { ...program.block, statements: [
      ...this.initializationOrder.map(unit => ({ type: NodeType.UNIT_INITIALIZATION, unit })),
      ...program.block.statements,
    ] };
    // The machine sets up the System unit's variables and those of the
    // standard units in use.
    this.bytecode.standardVariables = STANDARD_VARIABLES.flatMap((standard, index) =>
      standard.unit && !this.standardUnits.has(standard.unit)
        ? []
        : [{ name: standard.name, address: MARK_SIZE + index, initial: standard.initial }]
    );
    this.compileBody(block, undefined);
    return this.bytecode;
  }

  private importUnits(names: string[], node: Node): void {
    for (const name of names) {
      if (this.modules.useUnit(name)) {
        // A standard unit's variables join the module that uses it.
        this.standardUnits.add(name.toLowerCase());
        for (const standard of STANDARD_VARIABLES)
          if (standard.unit === name.toLowerCase()) this.declareStandard(standard);
        if (name.toLowerCase() === 'printer') this.printerUsed = true;
        this.importUnitDeclarations(name.toLowerCase());
        continue;
      }
      const unit = this.loadUnit(name, node);
      this.scope.imports.set(name.toLowerCase(), unit.exports);
    }
  }
  /** A standard unit's own types, declared once from its Pascal source and
   * imported as a source unit's are, so a program's names come first. */
  private importUnitDeclarations(unit: string): void {
    const source = this.modules.getUnit(unit)?.declarations;
    if (!source) return;
    let exports = this.unitDeclarations.get(unit);
    if (!exports) {
      const program = new Parser(new Lexer(new Stream(`program ${unit}; ${source} begin end.`))).parse();
      const before = new Set(this.scope.symbols.keys());
      this.declarations(program.block.declarations);
      exports = new Map();
      for (const [key, symbol] of [...this.scope.symbols]) {
        if (before.has(key)) continue;
        exports.set(key, symbol);
        this.scope.symbols.delete(key);
      }
      this.unitDeclarations.set(unit, exports);
    }
    this.scope.imports.set(unit, exports);
  }
  /** A type a standard unit declares, as its routines take it. */
  private unitType(unit: string, name: string): PascalType | undefined {
    const symbol = this.unitDeclarations.get(unit)?.get(name.toLowerCase());
    return symbol?.kind === 'type' ? symbol.type : undefined;
  }
  private loadUnit(name: string, node: Node): CompiledUnit {
    const key = name.toLowerCase(), existing = this.units.get(key);
    if (existing) {
      if (existing.state === 'interface') this.fail(node, `Circular unit interface dependency "${name}"`);
      return existing;
    }
    const source = this.compilerOptions.resolveUnit?.(name);
    if (source === undefined) this.fail(node, `Unknown unit "${name}"`);
    const unitNode = typeof source === 'string' ? new Parser(new Lexer(new Stream(source))).parseUnit() : source;
    if (unitNode.name.toLowerCase() !== key) this.fail(unitNode, `Unit name "${unitNode.name}" does not match "${name}"`);
    const parent = this.scope, scope = this.newScope(null, unitNode.name);
    const unit: CompiledUnit = { node: unitNode, scope, exports: new Map(), state: 'interface' };
    this.units.set(key, unit);
    this.scope = scope;
    scope.coprocessor = this.usesCoprocessor(unitNode);
    this.addBuiltins();
    this.importUnits(unitNode.interfaceUses, unitNode);
    scope.nextOffset = this.globalOffset;
    const builtinNames = new Set(scope.symbols.keys());
    this.declarations(unitNode.interfaceSection);
    for (const [name, symbol] of scope.symbols) if (!builtinNames.has(name)) unit.exports.set(name, symbol);
    this.globalOffset = scope.nextOffset;
    unit.state = 'implementation';
    this.importUnits(unitNode.implementationUses, unitNode);
    scope.nextOffset = this.globalOffset;
    this.declarations(unitNode.implementationSection);
    this.globalOffset = scope.nextOffset;
    unit.state = 'ready';
    this.initializationOrder.push(unit);
    this.scope = parent;
    return unit;
  }
  private qualified(node: Node): Node {
    if (node.type !== NodeType.FIELD_ACCESS || (node.record as Node).type !== NodeType.IDENTIFIER) return node;
    const name = String((node.record as Node).name), key = name.toLowerCase();
    for (let scope: Scope | null = this.scope; scope; scope = scope.parent) {
      if (scope.imports.has(key) || this.units.get(key)?.scope === scope) {
        return { ...node, type: NodeType.IDENTIFIER, name: `${name}.${String(node.field)}` };
      }
    }
    // The standard units qualify their names too, as in System.MemAvail.
    if ((key === 'system' || this.standardUnits.has(key)) && !this.lookup(name))
      return { ...node, type: NodeType.IDENTIFIER, name: `${name}.${String(node.field)}` };
    return node;
  }

  private newScope(parent: Scope | null, name: string): Scope {
    return {
      id: this.scopeId++,
      name,
      labels: new Map(),
      withRecords: [],
      parent,
      level: parent ? parent.level + 1 : 0,
      symbols: new Map(),
      imports: new Map(),
      nextOffset: MARK_SIZE,
      locals: [],
      routines: [],
      exits: [],
      loops: [],
    };
  }

  private addBuiltins(): void {
    const types: Record<string, PascalType> = {
      integer: INTEGER,
      shortint: SHORTINT,
      byte: BYTE,
      word: WORD,
      longint: LONGINT,
      real: REAL,
      single: { ...REAL, byteSize: 4 },
      double: { ...REAL, byteSize: 8 },
      extended: EXTENDED,
      comp: { ...REAL, byteSize: 8, comp: true },
      boolean: BOOLEAN,
      bytebool: BOOLEAN,
      wordbool: { ...BOOLEAN, byteSize: 2 },
      longbool: { ...BOOLEAN, byteSize: 4 },
      pchar: { ...POINTER, base: CHAR },
      char: CHAR,
      string: STRING,
      pointer: POINTER,
      text: TEXTFILE,
    };
    this.standardSymbols = new Map([['system', new Map<string, Symbol>()]]);
    const system = (name: string, symbol: Symbol) => {
      this.scope.symbols.set(name, symbol);
      this.standardSymbols.get('system')!.set(name, symbol);
    };
    for (const [name, type] of Object.entries(types)) system(name, { kind: 'type', type });
    for (const standard of STANDARD_VARIABLES) if (!standard.unit) this.declareStandard(standard);
    for (const [name, value] of Object.entries({ maxint: 32767, pi: Math.PI }))
      system(name, {
        kind: 'constant',
        type: name === 'pi' ? this.realResult() : INTEGER,
        value: name === 'pi' && !this.coprocessorMode() ? roundReal48(value) : value,
      });
  }

  private atSource<T>(node: Node, action: () => T): T {
    const previousLine = this.line, previousFile = this.sourceFile;
    this.line = node.lineNumber ?? this.line;
    if (typeof node.sourceFile === 'string') this.sourceFile = node.sourceFile;
    try { return action(); } finally { this.line = previousLine; this.sourceFile = previousFile; }
  }
  private fail(node: Node, message: string): never {
    const error = new PascalError(message, node.lineNumber ?? this.line);
    if (node.sourceFile) Object.assign(error, { sourceFile: node.sourceFile });
    throw error;
  }
  private emit(opcode: Opcode, p = 0, q = 0): number {
    const address = this.bytecode.getNextAddress();
    this.bytecode.add(opcode, p, q);
    this.bytecode.sourceLines[address] = this.line;
    if (this.sourceFile) this.bytecode.sourceFiles[address] = this.sourceFile;
    if (opcode === Opcode.CSP) this.bytecode.ioChecks[address] = this.ioChecking;
    return address;
  }
  private patch(address: number, destination = this.bytecode.getNextAddress()): void {
    this.bytecode.setOperand2(address, destination);
  }
  private literal(value: Value, type: PascalType): void {
    this.emit(Opcode.LDC, this.typeCode(type), this.bytecode.addConstant(value));
  }
  private typeCode(type: PascalType): TypeCode {
    return {
      integer: TypeCode.I,
      real: TypeCode.R,
      boolean: TypeCode.B,
      char: TypeCode.C,
      string: TypeCode.S,
      array: TypeCode.A,
      record: TypeCode.A,
      pointer: TypeCode.A,
      set: TypeCode.T,
      file: TypeCode.A,
      void: TypeCode.P,
      untyped: TypeCode.A,
    }[type.kind];
  }
  private lookup(name: string): Symbol | undefined {
    for (const record of [...this.scope.withRecords].reverse()) {
      const field = record.type.fields?.get(name.toLowerCase());
      if (field?.privateOwner && !this.inModule(field.privateOwner)) this.fail({ type: NodeType.IDENTIFIER }, `Private object member "${name}"`);
      if (field)
        return {
          kind: 'variable',
          name,
          type: field.type,
          offset: field.offset,
          scope: this.scope,
          reference: false,
          container: record.pointer,
          ...(field.variants ? { variants: field.variants, containerType: record.type } : {}),
        };
    }
    const [qualifier, member] = name.toLowerCase().split('.');
    const standard = member === undefined ? undefined : this.standardSymbols.get(qualifier!);
    if (standard && (qualifier === 'system' || this.standardUnits.has(qualifier!))) {
      const symbol = standard.get(member!);
      if (symbol) return symbol;
      const constant = this.modules.lookupConstant(name);
      if (constant) return { kind: 'constant', type: INTEGER, value: constant.value };
    }
    for (let scope: Scope | null = this.scope; scope; scope = scope.parent) {
      const symbol = scope.symbols.get(name.toLowerCase());
      if (symbol) return symbol;
      const field = scope.methodOwner?.fields?.get(name.toLowerCase());
      if (field?.privateOwner && !this.inModule(field.privateOwner)) this.fail({ type: NodeType.IDENTIFIER }, `Private object member "${name}"`);
      if (field && scope.self) return { kind: 'variable', name, type: field.type, offset: field.offset,
        scope: this.scope, reference: false, container: scope.self };
      if (name.includes('.')) {
        const [unitName, member] = name.toLowerCase().split('.');
        const exported = scope.imports.get(unitName!)?.get(member!);
        if (exported) return exported;
        if (scope.name.toLowerCase() === unitName) return scope.symbols.get(member!);
      } else {
        for (const exports of [...scope.imports.values()].reverse()) {
          const imported = exports.get(name.toLowerCase());
          if (imported) return imported;
        }
      }
    }
    const constant = this.modules.lookupConstant(name);
    return constant ? { kind: 'constant', type: INTEGER, value: constant.value } : undefined;
  }
  private declare(name: string, symbol: Symbol, node: Node): void {
    if (this.scope.methodOwner?.fields?.has(name.toLowerCase()) || this.scope.methodOwner?.object?.methods.has(name.toLowerCase()))
      this.fail(node, `Duplicate object member "${name}"`);
    // A program may declare a System or standard-unit name again, as Turbo
    // Pascal lets it; the unit's stays reachable qualified, as System.Double.
    const existing = this.scope.symbols.get(name.toLowerCase());
    if (existing && ![...this.standardSymbols.values()].some((unit) => [...unit.values()].includes(existing)))
      this.fail(node, `Duplicate identifier "${name}"`);
    this.scope.symbols.set(name.toLowerCase(), symbol);
  }
  private variable(name: string, type: PascalType, node: Node, reference = false): Variable {
    const variable: Variable = {
      kind: 'variable',
      name,
      type,
      offset: this.scope.nextOffset,
      scope: this.scope,
      reference,
    };
    this.scope.nextOffset += reference ? 1 : type.size;
    if (this.scope.nextOffset > 32767)
      this.fail(node, 'Variable storage exceeds the supported frame size');
    this.declare(name, variable, node);
    return variable;
  }
  private temp(type = INTEGER): Variable {
    const variable: Variable = {
      kind: 'variable',
      name: '$temporary',
      type,
      offset: this.scope.nextOffset,
      scope: this.scope,
      reference: false,
    };
    this.scope.nextOffset += type.size;
    return variable;
  }
  private addressVariable(variable: Variable): void {
    if (variable.view) {
      const target = variable.view.target;
      this.emitView(() => { this.addressVariable(target); }, () => { this.emitLayoutOf(target); }, variable.type, 0,
        target.type.kind === 'untyped' ? -1 : this.refreshListId(target.type), []);
      return;
    }
    if (variable.container) {
      if (variable.container.type.object) this.addressVariable(variable.container);
      else this.loadVariable(variable.container);
      this.literal(variable.offset, INTEGER);
      this.emit(Opcode.ADI);
      return;
    }
    this.emit(Opcode.LDA, this.scope.level - variable.scope.level, variable.offset);
    if (variable.reference) this.emit(Opcode.LDI, TypeCode.A);
  }
  private loadVariable(variable: Variable): void {
    this.addressVariable(variable);
    this.emit(Opcode.LDI, this.typeCode(variable.type));
  }
  private aggregate(type: PascalType): boolean {
    return type.kind === 'array' || type.kind === 'record';
  }
  private numeric(type: PascalType): boolean {
    return (type.kind === 'integer' && !type.enumeration) || type.kind === 'real';
  }
  private integerRangeType(low: number, high: number, node: Node): PascalType {
    const type = [SHORTINT, BYTE, INTEGER, WORD, LONGINT].find(
      (candidate) => low >= candidate.low! && high <= candidate.high!
    );
    if (!type || !Number.isSafeInteger(low) || !Number.isSafeInteger(high))
      this.fail(node, 'Integer constant out of range');
    return type;
  }
  private promoteInteger(type: PascalType): PascalType {
    if (type.enumeration) return type;
    const base = type.base?.kind === 'integer' ? type.base : type;
    return base.byteSize >= 2 ? base : (base.low ?? 0) < 0 ? INTEGER : WORD;
  }
  private integerResultType(left: PascalType, right: PascalType, operator: string): PascalType {
    const a = left.base?.kind === 'integer' ? left.base : left;
    const b = right.base?.kind === 'integer' ? right.base : right;
    if (operator === 'shl' || operator === 'shr') return this.promoteInteger(a);
    const type =
      [SHORTINT, BYTE, INTEGER, WORD, LONGINT].find(
        (candidate) =>
          Math.min(a.low!, b.low!) >= candidate.low! &&
          Math.max(a.high!, b.high!) <= candidate.high!
      ) ?? LONGINT;
    return ['and', 'or', 'xor'].includes(operator) ? type : this.promoteInteger(type);
  }
  private integerHelper(operator: string, type: PascalType, node: Node, arity = 2): void {
    const bits = type.byteSize * 8,
      signed = (type.low ?? 0) < 0;
    const checked = Boolean(node.overflowChecking),
      line = node.lineNumber ?? this.line;
    this.helper(
      `int-${operator}-${String(bits)}-${String(signed)}-${String(checked)}-${String(line)}`,
      arity,
      (a, b) => {
        const value = Number(a),
          other = Number(b ?? 0);
        const format = { bits, signed };
        if (operator === 'negate') return integerOperation('-', 0, value, format, checked, line);
        if (operator === 'abs')
          return value < 0 ? integerOperation('-', 0, value, format, checked, line) : value;
        if (operator === 'sqr') return integerOperation('*', value, value, format, checked, line);
        if (operator === 'succ' || operator === 'pred')
          return integerOperation(operator === 'succ' ? '+' : '-', value, 1, format, checked, line);
        return integerOperation(operator, value, other, format, checked, line);
      }
    );
  }
  /** Fold only pure numeric trees, so calls and variable reads retain their effects. */
  /** Whether the compiler can work an expression out, as Turbo Pascal does
   * with constant expressions. High, Low and SizeOf of an open parameter are
   * not constant: their values come from the caller. */
  private constantExpression(node: Node): boolean {
    node = this.qualified(node);
    switch (node.type) {
      case NodeType.NUMBER:
      case NodeType.STRING:
      case NodeType.BOOLEAN:
      case NodeType.NIL:
        return true;
      case NodeType.IDENTIFIER:
        return this.lookup(String(node.name))?.kind === 'constant';
      case NodeType.UNARY_OP:
        return this.constantExpression(node.operand as Node);
      case NodeType.BINARY_OP:
        return (
          this.constantExpression((node as BinaryOpNode).left) &&
          this.constantExpression((node as BinaryOpNode).right)
        );
      case NodeType.CALL: {
        const call = node as CallNode;
        const name = call.name.toLowerCase();
        if (this.lookupRoutine(call.name)) return false;
        const symbol = this.lookup(call.name);
        if (symbol?.kind === 'type') return call.arguments.every((argument) => this.constantExpression(argument));
        if (symbol) return false;
        if (['sizeof', 'high', 'low'].includes(name)) {
          const argument = call.arguments[0];
          if (!argument) return false;
          const target = argument.type === NodeType.IDENTIFIER ? this.lookup(String(argument.name)) : undefined;
          const type = target?.kind === 'type' ? target.type : this.expressionType(argument);
          return !type.openHigh && !type.openCapacity;
        }
        return (
          ['abs', 'chr', 'hi', 'lo', 'length', 'odd', 'ord', 'pred', 'succ', 'round', 'swap', 'trunc', 'ptr'].includes(name) &&
          call.arguments.length > 0 &&
          call.arguments.every((argument) => this.constantExpression(argument))
        );
      }
      default:
        return false;
    }
  }
  /** Turbo Pascal reports a constant that cannot fit where it is used. */
  private checkConstantRange(node: Node, target: PascalType): void {
    if (!this.ordinal(target) || target.low === undefined || target.high === undefined) return;
    if (!this.constantExpression(node)) return;
    const value = this.constant(node);
    if (!this.ordinal(value.type)) return;
    const ordinal = this.ordinalValue(value.value);
    if (ordinal < target.low || ordinal > target.high) this.fail(node, 'Constant out of range');
  }
  private numericConstant(node: Node): boolean {
    if (node.type === NodeType.NUMBER) return true;
    if (node.type === NodeType.IDENTIFIER) {
      const value = this.lookup(node.name as string);
      return value?.kind === 'constant' && this.numeric(value.type);
    }
    if (node.type === NodeType.UNARY_OP)
      return (
        ['+', '-', 'not'].includes(String(node.operator).toLowerCase()) &&
        this.numericConstant(node.operand as Node)
      );
    if (node.type === NodeType.BINARY_OP)
      return (
        ['+', '-', '*', '/', 'div', 'mod', 'shl', 'shr', 'and', 'or', 'xor'].includes(
          String(node.operator).toLowerCase()
        ) &&
        this.numericConstant(node.left as Node) &&
        this.numericConstant(node.right as Node)
      );
    return false;
  }
  private ordinal(type: PascalType): boolean {
    return ['integer', 'char', 'boolean'].includes(type.kind);
  }
  /** Single, Double and Extended: the 8087 types, which keep full precision. */
  private coprocessorReal(type: PascalType): boolean {
    return type.kind === 'real' && type.byteSize !== 6;
  }
  /** Whether the current module is compiled for the 8087 ({$N+}). */
  private coprocessorMode(): boolean {
    let scope = this.scope;
    while (scope.parent) scope = scope.parent;
    return scope.coprocessor ?? false;
  }
  /** Turbo Pascal needs {$N+} for the 8087 types (Comp among them), so a module that names one
   * is taken to be compiled for the 8087 even without the switch. */
  private usesCoprocessor(root: Node): boolean {
    const seen = new Set<object>();
    const visit = (value: unknown): boolean => {
      if (typeof value !== 'object' || value === null || seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) return value.some(visit);
      const node = value as Node;
      if (node.numericProcessing === true) return true;
      if (
        (node.type === NodeType.IDENTIFIER || node.type === NodeType.CALL) &&
        /^(?:single|double|extended|comp)$/i.test(String(node.name))
      )
        return true;
      return Object.values(node).some(visit);
    };
    return visit(root);
  }
  /** Arithmetic on these operands is done by the 8087 rather than in software. */
  private coprocessorArithmetic(left: PascalType, right: PascalType): boolean {
    return this.coprocessorMode() || this.coprocessorReal(left) || this.coprocessorReal(right);
  }
  /** The type of a real value computed in the current module. */
  private realResult(): PascalType {
    return this.coprocessorMode() ? EXTENDED : REAL;
  }
  private text(type: PascalType): boolean {
    return type.kind === 'string' || type.kind === 'char';
  }
  private compatible(target: PascalType, source: PascalType, reference = false): boolean {
    if (target.procedureSignature || source.procedureSignature) {
      if (target.procedureSignature && source.procedureSignature) return this.proceduralCompatible(target, source);
      return !reference && ((target.procedureSignature && source.kind === 'pointer' && !source.base) ||
        (source.procedureSignature && target.kind === 'pointer' && !target.base)) ? true : false;
    }
    if (target.kind === source.kind) {
      if (target.enumeration || source.enumeration) {
        if (target.enumeration !== source.enumeration) return false;
      }
      if (target.kind === 'pointer')
        return !target.base || !source.base || target.base === source.base || (!reference && this.descendsFrom(source.base, target.base));
      if (target.object && source.object) return this.descendsFrom(source, target);
      if (target.kind === 'set')
        return !target.base || !source.base || this.compatible(target.base, source.base);
      if (target.kind === 'file')
        return (
          target === source ||
          (target.element?.kind === source.element?.kind && target.base === source.base)
        );
      if (reference && target.kind === 'string') return Boolean(target.openString) === Boolean(source.openString) && target.capacity === source.capacity;
      if (reference && this.ordinal(target))
        return (
          target.byteSize === source.byteSize &&
          target.low === source.low &&
          target.high === source.high
        );
      if (this.aggregate(target))
        return (
          target === source ||
          (target.kind === 'array' &&
            target.low === source.low &&
            target.high === source.high &&
            this.compatible(target.element!, source.element!, true))
        );
      return true;
    }
    return (
      !reference &&
      ((target.kind === 'real' && source.kind === 'integer' && !source.enumeration) ||
        (target.kind === 'string' && source.kind === 'char'))
    );
  }
  private requireType(node: Node, target: PascalType, source: PascalType, reference = false): void {
    if (target.kind === 'untyped' || source.kind === 'untyped')
      this.fail(node, 'An untyped parameter needs a typecast, such as Integer(X)');
    if (reference && target.kind === 'string' && source.kind === 'string' && (target.openString || node.strictVarStrings === false)) return;
    if (!this.compatible(target, source, reference)) {
      if (reference && target.kind === 'string' && source.kind === 'string')
        this.fail(node, 'VAR string parameters require matching capacities');
      if (target.enumeration || source.enumeration)
        this.fail(node, 'Type mismatch: incompatible enumeration types');
      this.fail(node, `Type mismatch: expected ${target.kind}, found ${source.kind}`);
    }
  }
  private helper(
    name: string,
    arity: number,
    implementation: (...args: unknown[]) => unknown
  ): void {
    let index = this.helpers.get(name);
    if (index === undefined) {
      index = 1000 + this.helpers.size;
      this.helpers.set(name, index);
      this.native.register(index, `$${name}`, arity, true, implementation);
    }
    this.emit(Opcode.CSP, arity, index);
  }

  private declarations(declarations: Node[]): void {
    for (const node of declarations) {
      if (node.type === NodeType.TYPE_DECLARATION)
        this.declare(String(node.name), { kind: 'type', type: { ...VOID } }, node);
    }
    for (const node of declarations) {
      this.line = node.lineNumber ?? this.line;
      switch (node.type) {
        case NodeType.LABEL_DECLARATION:
          for (const label of node.labels as string[]) {
            const key = label.toLowerCase();
            if (this.scope.labels.has(key)) this.fail(node, 'Duplicate label');
            this.scope.labels.set(key, { node, patches: [], uses: [] });
          }
          break;
        case NodeType.CONST_DECLARATION: {
          const declaration = node as ConstDeclarationNode;
          const constant = this.constant(declaration.value);
          this.declare(declaration.name, constant, node);
          break;
        }
        case NodeType.TYPED_CONST_DECLARATION: {
          const declaration = node as TypedConstDeclarationNode;
          const type = this.resolveType(declaration.constType);
          this.typedConstant(declaration.name, type, declaration);
          break;
        }
        case NodeType.TYPE_DECLARATION: {
          const declaration = node as TypeDeclarationNode;
          const symbol = this.scope.symbols.get(declaration.name.toLowerCase()) as TypeSymbol;
          if (declaration.typeValue.type === NodeType.OBJECT_TYPE)
            this.resolveObject(declaration.typeValue, symbol.type, declaration.name);
          else Object.assign(symbol.type, this.resolveType(declaration.typeValue));
          break;
        }
        case NodeType.VAR_DECLARATION: {
          const declaration = node as VarDeclarationNode;
          // The names are declared as their type is read, so a type cannot
          // name a variable it declares, even one a System type shares.
          const standard = [...this.standardSymbols.values()].flatMap((unit) => [...unit.values()]);
          const names = new Set(
            declaration.names
              .map((name) => name.toLowerCase())
              .filter((name) => { const existing = this.scope.symbols.get(name); return existing !== undefined && standard.includes(existing); })
          );
          const mentions = (type: unknown): boolean =>
            typeof type === 'object' && type !== null &&
            (((type as Node).type === NodeType.IDENTIFIER && names.has(String((type as Node).name).toLowerCase())) ||
              Object.values(type).some((value) => (Array.isArray(value) ? value.some(mentions) : mentions(value))));
          if (mentions(declaration.varType)) this.fail(node, 'Error in type definition');
          const type = this.resolveType(declaration.varType);
          if (declaration.absolute) {
            const found = this.lookup(declaration.absolute);
            if (found?.kind !== 'variable')
              this.fail(node, `Variable expected: "${declaration.absolute}"`);
            // A name over a variable of the same layout shares its cells. One
            // of another layout is a view of its bytes, as Turbo Pascal
            // overlays them.
            const target = found.view?.target ?? found;
            const same = !found.view && target.type.kind !== 'untyped' &&
              JSON.stringify(this.binaryLayout(target.type)) === JSON.stringify(this.binaryLayout(type));
            for (const name of declaration.names)
              this.declare(name, same
                ? { ...found, name, type, parameter: false, readOnly: false }
                : { kind: 'variable', name, type, offset: target.offset, scope: target.scope, reference: false, view: { target } }, node);
            break;
          }
          for (const name of declaration.names)
            this.scope.locals.push(this.variable(name, type, node));
          break;
        }
        case NodeType.PROCEDURE:
        case NodeType.FUNCTION: {
          const declaration = node as ProcedureNode | FunctionNode;
          const parameters = this.parameterList(declaration.parameters);
          if (declaration.name.includes('.')) {
            const owner = this.lookup(declaration.name.split('.')[0]!);
            if (owner?.kind !== 'type' || !owner.type.object)
              this.fail(node, `Unknown object type "${declaration.name.split('.')[0]!}"`);
          } else if (['constructor', 'destructor'].includes(String(declaration.routineKind)))
            this.fail(node, `A ${String(declaration.routineKind)} must be a method of an object`);
          const previous = this.scope.symbols.get(declaration.name.toLowerCase());
          const type = declaration.type === NodeType.FUNCTION
            ? declaration.returnType ? this.resolveType(declaration.returnType)
              : previous?.kind === 'routine' ? previous.type : this.fail(node, 'Function return type required')
            : declaration.routineKind === 'constructor' ? BOOLEAN : VOID;
          if (this.aggregate(type) || type.procedureSignature)
            this.fail(node, 'Functions returning arrays or records are not supported');
          if (declaration.interrupt) {
            // The registers, from Flags to BP, as Word value parameters; a
            // handler may declare only the last of them.
            if (declaration.type === NodeType.FUNCTION) this.fail(node, 'An interrupt routine must be a procedure');
            if (this.scope.parent || declaration.name.includes('.')) this.fail(node, 'Interrupt procedures cannot be nested or methods');
            if (parameters.length > 12 || parameters.some((parameter) => parameter.reference || parameter.type.kind !== 'integer' || parameter.type.byteSize !== 2))
              this.fail(node, 'Interrupt procedure parameters must be Word registers');
          }
          if (
            previous?.kind === 'routine' &&
            previous.declaration.isForward &&
            !declaration.isForward
          ) {
            if (
              parameters.length &&
              (parameters.length !== previous.parameters.length ||
                parameters.some((param, i) => !this.sameParameter(param, previous.parameters[i]!)))
            )
              this.fail(node, 'Forward declaration parameter mismatch');
            if (previous.declaration.routineKind !== declaration.routineKind) this.fail(node, 'Routine kind does not match declaration');
            this.requireType(node, previous.type, type, true);
            if (previous.declaration.farCalls) declaration.farCalls = true;
            previous.declaration = declaration;
            if (parameters.length) previous.parameters = parameters;
          } else {
            const routine: Routine = {
              kind: 'routine',
              proceduralId: this.routineValues.length + 1,
              name: declaration.name,
              type,
              parameters,
              declaration,
              parent: this.scope,
              patches: [],
            };
            this.declare(declaration.name, routine, node);
            this.scope.routines.push(routine);
            this.routineValues.push(routine);
          }
          break;
        }
        default:
          this.fail(node, `Unsupported declaration: ${node.type}`);
      }
    }
  }

  /** The parameters a routine or procedural type declares, in order. */
  private parameterList(nodes: Node[]): Parameter[] {
    const parameters: Parameter[] = [];
    for (const parameterNode of nodes) {
      const parameter = parameterNode as ParameterNode;
      const type = this.parameterType(parameterNode);
      // Untyped parameters are passed by address; so are open arrays, whose
      // variables are set up when the routine is compiled.
      const reference =
        parameterNode.type === NodeType.VAR_PARAMETER || type.kind === 'untyped';
      for (const name of parameter.names)
        parameters.push({
          name,
          type,
          reference,
          ...(type.openString ? { openString: true } : {}),
          ...(parameter.constant ? { readOnly: true } : {}),
        });
    }
    return parameters;
  }
  /** Parameters that a forward declaration or procedural type must repeat. */
  private sameParameter(a: Parameter, b: Parameter): boolean {
    if (a.reference !== b.reference || Boolean(a.readOnly) !== Boolean(b.readOnly)) return false;
    if (Boolean(a.type.openString) !== Boolean(b.type.openString)) return false;
    if (a.type.kind === 'untyped' || b.type.kind === 'untyped') return a.type.kind === b.type.kind;
    if (a.type.openArray || b.type.openArray)
      return (
        Boolean(a.type.openArray && b.type.openArray) &&
        this.compatible(a.type.element!, b.type.element!, true)
      );
    return this.compatible(a.type, b.type, true);
  }
  private parameterType(parameter: Node): PascalType {
    if (!parameter.paramType) return UNTYPED;
    const node = parameter.paramType as Node;
    if (node.type === NodeType.OPEN_ARRAY_TYPE) {
      const element = this.resolveType(node.elementType as Node);
      return { kind: 'array', size: 1, byteSize: 0, low: 0, element, index: INTEGER, openArray: true };
    }
    const explicitOpenString = node.type === NodeType.IDENTIFIER && String(node.name).toLowerCase() === 'openstring' && !this.lookup(String(node.name));
    const type = explicitOpenString ? STRING : this.resolveType(node);
    // TP7's P switch changes VAR string formals only. Value strings always
    // receive an independent ordinary short string with capacity 255.
    if (parameter.type === NodeType.VAR_PARAMETER && type.kind === 'string' &&
      (explicitOpenString || type.openStringDeclaration))
      return { ...type, openString: true };
    return type;
  }
  private proceduralType(routine: Routine): PascalType {
    return { ...POINTER, procedureSignature: { parameters: routine.parameters, result: routine.type } };
  }
  private proceduralCompatible(target: PascalType, source: PascalType): boolean {
    const a = target.procedureSignature!, b = source.procedureSignature!;
    return this.compatible(a.result, b.result, true) && a.parameters.length === b.parameters.length &&
      a.parameters.every((parameter, index) => this.sameParameter(parameter, b.parameters[index]!));
  }
  private inModule(owner: Scope): boolean {
    let module = this.scope;
    while (module.parent) module = module.parent;
    return module === owner;
  }
  private descendsFrom(type: PascalType, ancestor: PascalType): boolean {
    for (let current: PascalType | undefined = type; current; current = current.object?.ancestor)
      if (current === ancestor || (current.object !== undefined && current.object === ancestor.object)) return true;
    return false;
  }
  private resolveObject(node: Node, type: PascalType, name: string): void {
    if (this.scope.level !== 0) this.fail(node, 'Object types must be declared at program or unit level');
    const ancestor = node.ancestor ? this.resolveType(node.ancestor as Node) : undefined;
    if (ancestor && !ancestor.object) this.fail(node, 'Object ancestor required');
    const fields: NonNullable<PascalType['fields']> = new Map(ancestor?.fields ?? [['$vmt', { offset: 0, type: INTEGER }]]);
    Object.assign(type, { kind: 'record', size: ancestor?.size ?? 1, byteSize: ancestor?.byteSize ?? 0,
      fields, object: { id: this.objectTypes.length + 1, ancestor, hasVirtual: ancestor?.object?.hasVirtual ?? false, methods: new Map(ancestor?.object?.methods ?? []) } });
    this.objectTypes.push(type);
    for (const field of node.fields as VarDeclarationNode[]) {
      const fieldType = this.resolveType(field.varType);
      for (const fieldName of field.names) {
        if (fields.has(fieldName.toLowerCase()) || type.object!.methods.has(fieldName.toLowerCase())) this.fail(field, `Duplicate object member "${fieldName}"`);
        fields.set(fieldName.toLowerCase(), { offset: type.size, type: fieldType, ...(field.privateMember ? { privateOwner: this.scope } : {}) });
        type.size += fieldType.size; type.byteSize += fieldType.byteSize;
      }
    }
    const declared = new Set<string>();
    for (const method of node.methods as (ProcedureNode | FunctionNode)[]) {
      const key = method.name.toLowerCase();
      if (declared.has(key) || fields.has(key)) this.fail(method, `Duplicate object member "${method.name}"`);
      declared.add(key);
      const inherited = type.object!.methods.get(key);
      const declaration = { ...method, name: `${name}.${method.name}` };
      this.declarations([declaration]);
      const routine = this.scope.symbols.get(declaration.name.toLowerCase()) as Routine;
      routine.methodOwner = type;
      if (method.privateMember) routine.privateOwner = this.scope;
      routine.virtual = Boolean(method.virtual);
      if (routine.virtual && method.routineKind === 'constructor') this.fail(method, 'Constructors cannot be virtual');
      if (method.dynamicIndex) {
        const index = this.constant(method.dynamicIndex as Node);
        if (index.type.kind !== 'integer' || Number(index.value) < 1 || Number(index.value) > 65535)
          this.fail(method, 'Dynamic method index must be 1..65535');
        routine.dynamicIndex = Number(index.value);
        if ([...type.object!.methods].some(([name, other]) => name !== key && other.dynamicIndex === routine.dynamicIndex))
          this.fail(method, 'Duplicate dynamic method index');
      }
      if (routine.virtual && !type.object!.hasVirtual) { type.object!.hasVirtual = true; type.byteSize += 2; }
      if (inherited?.virtual) {
        if (!routine.virtual || routine.dynamicIndex !== inherited.dynamicIndex || routine.parameters.length !== inherited.parameters.length ||
          routine.parameters.some((parameter, index) => parameter.name.toLowerCase() !== inherited.parameters[index]!.name.toLowerCase() || parameter.reference !== inherited.parameters[index]!.reference ||
            !this.compatible(parameter.type, inherited.parameters[index]!.type, true)) ||
          !this.compatible(routine.type, inherited.type, true)) this.fail(method, 'Virtual method override must match the inherited signature');
      }
      type.object!.methods.set(key, routine);
    }
  }

  private resolveType(node: Node): PascalType {
    switch (node.type) {
      case NodeType.PROCEDURAL_TYPE: {
        const parameters = this.parameterList(node.parameters as Node[]);
        const result = node.returnType ? this.resolveType(node.returnType as Node) : VOID;
        if (this.aggregate(result) || result.procedureSignature) this.fail(node, 'Invalid procedural function result type');
        return { ...POINTER, procedureSignature: { parameters, result } };
      }
      case NodeType.INTEGER_TYPE:
        return INTEGER;
      case NodeType.REAL_TYPE:
        return REAL;
      case NodeType.BOOLEAN_TYPE:
        return BOOLEAN;
      case NodeType.CHAR_TYPE:
        return CHAR;
      case NodeType.STRING_TYPE: {
        const capacity = node.length === undefined ? 255 : Number(node.length);
        if (!Number.isInteger(capacity) || capacity < 0 || capacity > 255)
          this.fail(node, 'String capacity must be 0..255');
        return { ...STRING, capacity, byteSize: capacity + 1, openStringDeclaration: Boolean(node.openStrings) && capacity === 255 };
      }
      case NodeType.POINTER_TYPE: {
        const baseNode = node.baseType as Node;
        if (baseNode.type === NodeType.IDENTIFIER) {
          const symbol = this.lookup(String(baseNode.name));
          if (symbol?.kind !== 'type') this.fail(baseNode, 'Unknown pointer target type');
          return { ...POINTER, base: symbol.type };
        }
        return { ...POINTER, base: this.resolveType(baseNode) };
      }
      case NodeType.SET_TYPE: {
        const base = this.resolveType(node.baseType as Node);
        if (!this.ordinal(base)) this.fail(node, 'Set elements must have an ordinal type');
        const low = base.low ?? 0,
          high = base.high ?? 255;
        if (low < 0 || high > 255 || low > high) this.fail(node, 'Set range must be within 0..255');
        return { ...SET, base, low, high, byteSize: Math.floor(high / 8) - Math.floor(low / 8) + 1 };
      }
      case NodeType.FILE_TYPE:
        return node.componentType
          ? {
              kind: 'file',
              size: 1,
              byteSize: 128,
              base: this.resolveType(node.componentType as Node),
            }
          : { kind: 'file', size: 1, byteSize: 128 };
      case NodeType.IDENTIFIER: {
        const symbol = this.lookup(node.name as string);
        if (symbol?.kind !== 'type') this.fail(node, `Unknown type "${String(node.name)}"`);
        if (symbol.type.kind === 'void')
          this.fail(node, 'Forward type references require a pointer');
        return symbol.type;
      }
      case NodeType.SUBRANGE_TYPE: {
        const { low, high } = node as SubrangeTypeNode;
        const a = this.constant(low),
          b = this.constant(high);
        if (!this.ordinal(a.type) || !this.compatible(a.type, b.type))
          this.fail(node, 'Invalid subrange bounds');
        const lower = this.ordinalValue(a.value),
          upper = this.ordinalValue(b.value);
        if (upper < lower) this.fail(node, 'Subrange lower bound exceeds upper bound');
        const base = a.type.kind === 'integer' && !a.type.enumeration ? this.integerRangeType(lower, upper, node) : a.type;
        return { ...base, base, low: lower, high: upper };
      }
      case NodeType.ENUM_TYPE: {
        const values = (node as EnumTypeNode).values;
        const type: PascalType = {
          kind: 'integer',
          size: 1,
          byteSize: 1,
          low: 0,
          high: values.length - 1,
          enumeration: {},
        };
        values.forEach((name, value) => {
          this.declare(name, { kind: 'constant', type, value }, node);
        });
        return type;
      }
      case NodeType.ARRAY_TYPE: {
        const array = node as ArrayTypeNode;
        let element = this.resolveType(array.elementType);
        for (const indexNode of [...array.indexTypes].reverse()) {
          const indexType = this.resolveType(indexNode);
          const low =
            indexType.low ??
            (indexType.kind === 'boolean' || indexType.kind === 'char' ? 0 : undefined);
          const high =
            indexType.high ??
            (indexType.kind === 'boolean' ? 1 : indexType.kind === 'char' ? 255 : undefined);
          if (low === undefined || high === undefined)
            this.fail(indexNode, 'Array index type requires finite bounds');
          const size = (high - low + 1) * element.size;
          // Turbo Pascal's limit on a structure is 65520 bytes. Variables are
          // held to the frame's; a type this large serves typecasts and views.
          if (size < 1 || (high - low + 1) * element.byteSize > 65520) this.fail(node, 'Array size exceeds supported storage');
          element = {
            kind: 'array',
            size,
            byteSize: (high - low + 1) * element.byteSize,
            low,
            high,
            element,
            index: indexType,
          };
        }
        return element;
      }
      case NodeType.RECORD_TYPE: {
        const record = node as RecordTypeNode;
        const fields = new Map<string, RecordField>();
        type Cell = { offset: number; type: PascalType };
        // Each case of a variant part has cells of its own, after the cases
        // before it; the part's shadow, as large as its largest case, holds
        // the bytes they share. `byteStart` is where the fields start in
        // Turbo Pascal's layout.
        const place = (
          declarations: VarDeclarationNode[],
          variant: VariantPart | undefined,
          cell: number,
          byteStart: number,
          variants: { part: number; case: number }[]
        ): { cell: number; bytes: number; storage: Cell[]; all: Cell[]; nested: { part: number; offset: number }[] } => {
          const storage: Cell[] = [];
          const nested: { part: number; offset: number }[] = [];
          let bytes = 0;
          const add = (name: string, type: PascalType, at: Node) => {
            if (fields.has(name.toLowerCase())) this.fail(at, `Duplicate field "${name}"`);
            fields.set(name.toLowerCase(), { offset: cell, type, byteOffset: byteStart + bytes, ...(variants.length ? { variants } : {}) });
            storage.push({ offset: cell, type });
            nested.push(...this.variantRefreshes(type, cell));
            cell += type.size;
            bytes += type.byteSize;
          };
          for (const field of declarations) {
            const type = this.resolveType(field.varType);
            for (const name of field.names) add(name, type, field);
          }
          if (!variant) return { cell, bytes, storage, all: [...storage], nested };
          const at = { type: NodeType.RECORD_TYPE, lineNumber: variant.lineNumber } as Node;
          const tagType = this.resolveType(variant.tagType);
          if (!this.ordinal(tagType)) this.fail(at, 'Variant tag must have an ordinal type');
          if (variant.tagName) add(variant.tagName, tagType, at);
          const all = [...storage];
          const part = this.bytecode.variantParts.length;
          this.bytecode.variantParts.push({ shadow: 0, bytes: 0, cases: [] });
          const cases: VariantPartInfo['cases'] = [];
          let largest = 0;
          for (const [index, variantCase] of variant.cases.entries()) {
            for (const label of variantCase.labels) {
              const values = label.type === NodeType.RANGE ? [label.low as Node, label.high as Node] : [label];
              for (const value of values) this.requireType(value, tagType, this.constant(value).type);
            }
            const placed = place(variantCase.fields, variantCase.variant, cell, byteStart + bytes, [{ part, case: index }, ...variants]);
            cell = placed.cell;
            largest = Math.max(largest, placed.bytes);
            all.push(...placed.all);
            cases.push({
              cells: placed.storage.flatMap((entry) => this.cells(entry.type, entry.offset)).map((entry) => ({ offset: entry.offset, cell: this.binaryCell(entry.type) })),
              nested: placed.nested,
            });
          }
          this.bytecode.variantParts[part] = { shadow: cell, bytes: largest, cases };
          ownParts.push({ part, byteStart: byteStart + bytes });
          for (let index = 0; index < largest; index++) {
            storage.push({ offset: cell, type: BYTE });
            all.push({ offset: cell++, type: BYTE });
          }
          nested.push({ part, offset: 0 });
          return { cell, bytes: bytes + largest, storage, all, nested };
        };
        const ownParts: { part: number; byteStart: number }[] = [];
        const placed = place(record.fields, record.variant, 0, 0, []);
        return {
          kind: 'record',
          size: placed.cell,
          byteSize: placed.bytes,
          fields,
          ...(record.variant ? { layout: placed.storage, initialLayout: placed.all, variantParts: ownParts } : {}),
          ...(placed.nested.length ? { variantRefresh: placed.nested } : {}),
        };
      }
      default:
        this.fail(node, `Unsupported type: ${node.type}`);
    }
  }

  private constant(node: Node): Constant {
    node = this.qualified(node);
    switch (node.type) {
      case NodeType.SET_LITERAL: {
        const values: number[] = [];
        const type = this.setLiteralType(node);
        for (const element of node.elements as Node[]) {
          const low = this.constant(
            element.type === NodeType.RANGE ? (element.low as Node) : element
          );
          const high = element.type === NodeType.RANGE ? this.constant(element.high as Node) : low;
          if (!this.ordinal(low.type) || !this.compatible(low.type, high.type))
            this.fail(element, 'Ordinal set element required');
          if (type.base) this.requireType(element, type.base, low.type);
          const a = this.ordinalValue(low.value),
            b = this.ordinalValue(high.value);
          if (a < 0 || a > 255 || b < 0 || b > 255) this.fail(element, 'Set element out of range');
          for (let value = a; value <= b; value++) values.push(value);
        }
        return { kind: 'constant', type, value: this.encodeSet(values) };
      }
      case NodeType.NUMBER:
        return {
          kind: 'constant',
          type: node.isReal
            ? this.realResult()
            : this.integerRangeType(Number(node.value), Number(node.value), node),
          value: node.isReal
            ? this.coprocessorMode()
              ? coprocessorValue(Number(node.value), node.lineNumber)
              : roundReal48(Number(node.value), node.lineNumber)
            : Number(node.value),
        };
      case NodeType.STRING:
        return {
          kind: 'constant',
          type: (node.value as string).length === 1 ? CHAR : STRING,
          value: node.value as string,
        };
      case NodeType.CALL:
        return this.constantCall(node as CallNode);
      case NodeType.BOOLEAN:
        return { kind: 'constant', type: BOOLEAN, value: node.value ? 1 : 0 };
      case NodeType.NIL:
        return { kind: 'constant', type: POINTER, value: 0 };
      case NodeType.IDENTIFIER: {
        const symbol = this.lookup(node.name as string);
        if (symbol?.kind !== 'constant')
          this.fail(node, `Constant expected: "${String(node.name)}"`);
        return symbol;
      }
      case NodeType.UNARY_OP: {
        const unary = node as UnaryOpNode;
        // -2147483648 is valid even though the positive token alone is not.
        if (
          unary.operator === '-' &&
          unary.operand.type === NodeType.NUMBER &&
          !unary.operand.isReal
        ) {
          const number = -Number(unary.operand.value);
          return {
            kind: 'constant',
            type: this.integerRangeType(number, number, node),
            value: number,
          };
        }
        const value = this.constant(unary.operand);
        if (unary.operator === '-' && this.numeric(value.type)) {
          const number = -Number(value.value);
          return {
            ...value,
            type:
              value.type.kind === 'real' ? value.type : this.integerRangeType(number, number, node),
            value: number,
          };
        }
        if (unary.operator === '+' && this.numeric(value.type)) return value;
        if (unary.operator.toLowerCase() === 'not' && value.type.kind === 'boolean')
          return { ...value, value: value.value ? 0 : 1 };
        if (unary.operator.toLowerCase() === 'not' && value.type.kind === 'integer' && this.numeric(value.type)) {
          const number = ~Number(value.value);
          return { ...value, type: this.integerRangeType(number, number, node), value: number };
        }
        return this.fail(node, 'Invalid constant expression');
      }
      case NodeType.BINARY_OP: {
        const binary = node as BinaryOpNode;
        const left = this.constant(binary.left),
          right = this.constant(binary.right);
        const operator = binary.operator.toLowerCase();
        if (operator === 'in') {
          if (right.type.kind !== 'set' || !this.ordinal(left.type) ||
            (right.type.base && !this.compatible(right.type.base, left.type)))
            this.fail(node, 'IN requires an ordinal value and a matching set');
          return { kind: 'constant', type: BOOLEAN,
            value: Number(this.decodeSet(right.value).includes(this.ordinalValue(left.value))) };
        }
        if (left.type.kind === 'set' || right.type.kind === 'set') {
          this.requireType(node, left.type, right.type);
          if (!['+', '-', '*', '=', '<>', '<=', '>='].includes(operator))
            this.fail(node, 'Invalid set operator');
          return {
            kind: 'constant',
            type: ['+', '-', '*'].includes(operator) ? left.type : BOOLEAN,
            value: this.setOperation(operator, left.value, right.value),
          };
        }
        if (operator === '+' && this.text(left.type) && this.text(right.type))
          return {
            kind: 'constant',
            type: STRING,
            value: String(left.value) + String(right.value),
          };
        if (['=', '<>', '<', '>', '<=', '>='].includes(operator)) {
          if (!(this.numeric(left.type) && this.numeric(right.type)) &&
            !(this.text(left.type) && this.text(right.type)) &&
            !this.compatible(left.type, right.type))
            this.fail(node, 'Incompatible comparison operands');
          const a = this.text(left.type) ? String(left.value) : Number(left.value);
          const b = this.text(right.type) ? String(right.value) : Number(right.value);
          const result = operator === '=' ? a === b : operator === '<>' ? a !== b
            : operator === '<' ? a < b : operator === '>' ? a > b
            : operator === '<=' ? a <= b : a >= b;
          return { kind: 'constant', type: BOOLEAN, value: Number(result) };
        }
        if (left.type.kind === 'boolean' && right.type.kind === 'boolean' && ['and', 'or', 'xor'].includes(operator)) {
          const a = Boolean(left.value), b = Boolean(right.value);
          return { kind: 'constant', type: BOOLEAN,
            value: Number(operator === 'and' ? a && b : operator === 'or' ? a || b : a !== b) };
        }
        if (!this.numeric(left.type) || !this.numeric(right.type))
          this.fail(node, 'Numeric constant expression expected');
        const a = Number(left.value),
          b = Number(right.value);
        if (['/', 'div', 'mod'].includes(operator) && b === 0)
          this.fail(node, 'Division by zero in constant expression');
        const real = operator === '/' || left.type.kind === 'real' || right.type.kind === 'real';
        if (real && !['+', '-', '*', '/'].includes(operator))
          this.fail(node, 'Integer operands required');
        const coprocessor = real && this.coprocessorArithmetic(left.type, right.type);
        const value = real
          ? (coprocessor ? coprocessorOperation : realOperation)(operator, a, b, node.lineNumber)
          : integerOperation(operator, a, b, { bits: 32, signed: true }, true, node.lineNumber);
        return {
          kind: 'constant',
          type: real ? (coprocessor ? EXTENDED : REAL) : this.integerRangeType(value, value, node),
          value,
        };
      }
      default:
        this.fail(node, 'Constant expression expected');
    }
  }
  private decodeSet(value: unknown): number[] {
    return JSON.parse(String(value)) as number[];
  }
  private encodeSet(values: number[]): string {
    return JSON.stringify([...new Set(values)].sort((a, b) => a - b));
  }
  private setOperation(operator: string, a: unknown, b: unknown): Value {
    const x = this.decodeSet(a),
      y = this.decodeSet(b);
    if (operator === '+') return this.encodeSet([...x, ...y]);
    if (operator === '-') return this.encodeSet(x.filter((value) => !y.includes(value)));
    if (operator === '*') return this.encodeSet(x.filter((value) => y.includes(value)));
    const subset = x.every((value) => y.includes(value)),
      superset = y.every((value) => x.includes(value));
    return (
      operator === '='
        ? subset && superset
        : operator === '<>'
          ? !(subset && superset)
          : operator === '<='
            ? subset
            : superset
    )
      ? 1
      : 0;
  }
  private setLiteralType(node: Node): PascalType {
    const elements = node.elements as Node[];
    const first = elements[0];
    if (!first) return { kind: 'set', size: 1, byteSize: 32, low: 0, high: 255 };
    const base = this.expressionType(first.type === NodeType.RANGE ? (first.low as Node) : first);
    if (!this.ordinal(base)) this.fail(node, 'Ordinal set element required');
    return { ...SET, base };
  }
  private setLiteral(node: Node): PascalType {
    const type = this.setLiteralType(node);
    this.literal('[]', SET);
    for (const element of node.elements as Node[]) {
      const low = element.type === NodeType.RANGE ? (element.low as Node) : element;
      const high = element.type === NodeType.RANGE ? (element.high as Node) : undefined;
      this.requireType(low, type.base!, this.expression(low));
      if (high) this.requireType(high, type.base!, this.expression(high));
      const line = node.lineNumber ?? this.line;
      this.helper(
        `set-add-${high ? 'range' : 'value'}-${String(line)}`,
        high ? 3 : 2,
        (set, a, b) => {
          const from = this.ordinalValue(a as Value),
            to = b === undefined ? from : this.ordinalValue(b as Value);
          if (from < 0 || to > 255 || from > 255 || to < 0)
            throw new PascalError('Set element out of range', line);
          const values = this.decodeSet(set);
          for (let value = from; value <= to; value++) values.push(value);
          return this.encodeSet(values);
        }
      );
    }
    return type;
  }

  private ordinalValue(value: Value): number {
    return typeof value === 'string' ? value.charCodeAt(0) : Number(value);
  }

  private compileRoutine(routine: Routine): void {
    const declaration = routine.declaration;
    // An inline routine has no code of its own; each call inserts it.
    if (declaration.inlineCode) return;
    if (!declaration.block)
      this.fail(declaration, `Unresolved forward declaration "${routine.name}"`);
    const parent = this.scope, previousFile = this.sourceFile;
    if (typeof declaration.sourceFile === 'string') this.sourceFile = declaration.sourceFile;
    this.scope = this.newScope(parent, routine.name);
    this.scope.constructorBody = routine.declaration.routineKind === 'constructor';
    if (routine.methodOwner) {
      this.scope.methodOwner = routine.methodOwner;
      this.scope.self = this.variable('Self', routine.methodOwner, declaration, true);
      this.scope.self.parameter = true;
    }
    if (routine.type.kind !== 'void' && !this.scope.constructorBody)
      this.scope.symbols.set(routine.name.split('.').at(-1)!.toLowerCase(), {
        kind: 'variable',
        name: routine.name,
        type: routine.type,
        offset: 0,
        scope: this.scope,
        reference: false,
        result: true,
      });
    for (const parameter of routine.parameters) {
      // Each activation's open parameters get their own hidden High, and its
      // untyped ones the layout of what was passed.
      const open = parameter.openString || parameter.type.openArray;
      const untyped = parameter.type.kind === 'untyped';
      const type = open || untyped ? { ...parameter.type } : parameter.type;
      if (parameter.openString) type.openString = true;
      const variable = this.variable(
        parameter.name,
        type,
        declaration,
        parameter.reference || Boolean(type.openArray)
      );
      variable.parameter = true;
      if (parameter.readOnly) variable.readOnly = true;
      if (untyped) type.untypedLayout = this.variable(`$layout_${parameter.name}`, INTEGER, declaration);
      if (parameter.openString) {
        const capacity = this.variable(`$high_${parameter.name}`, INTEGER, declaration);
        type.openCapacity = capacity;
      }
      if (type.openArray) {
        type.openHigh = this.variable(`$high_${parameter.name}`, INTEGER, declaration);
        if (!parameter.reference && !parameter.readOnly) (this.scope.openCopies ??= []).push(variable);
      }
    }
    this.declarations(declaration.block.declarations);
    for (const child of this.scope.routines) this.compileRoutine(child);
    routine.address = this.bytecode.getNextAddress();
    for (const patch of routine.patches) this.patch(patch, routine.address);
    if (declaration.interrupt)
      this.bytecode.interruptHandlers[routine.proceduralId] = { address: routine.address, parameters: routine.parameters.length };
    this.compileBody(declaration.block, routine);
    this.scope = parent;
    this.sourceFile = previousFile;
  }

  private compileBody(block: BlockNode, routine: Routine | undefined): void {
    if (typeof block.sourceFile === 'string') this.sourceFile = block.sourceFile;
    this.line = block.lineNumber ?? routine?.declaration.lineNumber ?? this.line;
    const entry = this.emit(Opcode.ENT);
    for (const local of this.scope.locals) this.initialize(local.type, local.offset);
    // Lst is open for writing before any unit initialization runs.
    if (!routine && this.printerUsed) {
      const lst = { type: NodeType.IDENTIFIER, name: 'Lst', internalVariable: this.printerFile() } as Node;
      const call = (name: string, args: Node[]) => {
        this.statement({ type: NodeType.CALL, name, arguments: args, lineNumber: block.lineNumber } as Node);
      };
      call('Assign', [lst, { type: NodeType.STRING, value: 'LPT1' } as Node]);
      call('Rewrite', [lst]);
    }
    // Typed constants have their values before any unit initialization runs.
    if (!routine)
      for (const { variable, stores } of this.typedConstants) {
        this.initialize(variable.type, variable.offset);
        for (const store of stores) {
          this.emit(Opcode.LDA, 0, store.offset);
          if (store.sync) {
            this.literal(store.sync.part, INTEGER);
            this.literal(store.sync.case, INTEGER);
            this.emit(Opcode.CSP, 3, InternalProcedure.VARIANT_SYNC);
            continue;
          }
          this.literal(store.value, store.type);
          this.emit(Opcode.STI, this.typeCode(store.type));
        }
      }
    // A value open array gets its own copy, so the caller's array is untouched.
    for (const variable of this.scope.openCopies ?? []) {
      const { element, openHigh } = variable.type;
      this.emit(Opcode.LDA, 0, variable.offset);
      this.addressVariable(variable);
      this.loadVariable(openHigh!);
      this.literal(1, INTEGER);
      this.emit(Opcode.ADI);
      this.literal(element!.size, INTEGER);
      this.emit(Opcode.MPI);
      this.emit(Opcode.CSP, 2, InternalProcedure.COPY_TO_HEAP);
      this.emit(Opcode.STI, TypeCode.A);
    }
    if (routine && routine.type.kind !== 'void') {
      this.initialize(routine.type, 0);
      if (this.scope.constructorBody) { this.emit(Opcode.LDA, 0, 0); this.literal(true, BOOLEAN); this.emit(Opcode.STI, TypeCode.B); }
    }
    // A real BEGIN boundary lets the debugger inspect initialized locals and parameters.
    this.line = block.beginLineNumber ?? block.lineNumber ?? this.line;
    this.bytecode.statementLines[this.bytecode.getNextAddress()] = this.line;
    this.emit(Opcode.UJP, 0, this.bytecode.getNextAddress() + 1);
    for (const statement of block.statements) this.statement(statement);
    for (const label of this.scope.labels.values())
      if (label.address === undefined && label.patches.length)
        this.fail(label.uses[0] ?? label.node, 'Undefined label');
    for (const exit of this.scope.exits) this.patch(exit);
    this.line = block.endLineNumber ?? this.line;
    this.bytecode.statementLines[this.bytecode.getNextAddress()] = this.line;
    for (const variable of this.scope.openCopies ?? []) {
      this.addressVariable(variable);
      this.emit(Opcode.CSP, 1, InternalProcedure.FREE_HEAP_COPY);
    }
    if (!routine) this.exitChain(block);
    this.emit(routine ? Opcode.RTN : Opcode.STP, routine ? this.typeCode(routine.type) : 0);
    if (this.scope.nextOffset > 32767) this.fail(block, 'Frame storage exceeds supported size');
    this.bytecode.setOperand2(entry, this.scope.nextOffset);
    if (!routine) for (const unit of this.initializationOrder)
      this.recordDebugScope(unit.scope, unit.debugStart ?? entry, unit.debugEnd ?? entry, this.scope.nextOffset);
    this.recordDebugScope(this.scope, entry, this.bytecode.getNextAddress(), this.scope.nextOffset);
  }
  private recordDebugScope(scope: Scope, start: number, end: number, frameSize: number): void {
    this.bytecode.debugScopes.push({
      id: scope.id,
      parentId: scope.parent?.id ?? null,
      name: scope.name,
      level: scope.level,
      start,
      end,
      frameSize,
      variables: [...scope.symbols.values()]
        .filter((symbol): symbol is Variable => symbol.kind === 'variable')
        .map((variable) => ({
          name: variable.name,
          offset: variable.offset,
          reference: variable.reference,
          ...(variable.parameter ? { parameter: true } : {}),
          ...(variable.static ? { static: true } : {}),
          type: this.debugType(variable.type),
        })),
      constants: [...scope.symbols.entries()]
        .filter((entry): entry is [string, Constant] => entry[1].kind === 'constant')
        .map(([name, value]) => ({ name, value: value.value, type: this.debugType(value.type) })),
    });
  }
  private debugType(type: PascalType, seen = new Set<PascalType>()): DebugType {
    const result: DebugType = { kind: type.kind, size: type.size, byteSize: type.byteSize };
    if (type.low !== undefined) result.low = type.low;
    if (type.high !== undefined) result.high = type.high;
    if (type.capacity !== undefined) result.capacity = type.capacity;
    if (seen.has(type)) return result;
    const visited = new Set(seen);
    visited.add(type);
    if (type.element) result.element = this.debugType(type.element, visited);
    if (type.base) result.base = this.debugType(type.base, visited);
    if (type.fields)
      result.fields = Object.fromEntries(
        [...type.fields].filter(([name]) => !name.startsWith('$')).map(([name, field]) => [
          name,
          { offset: field.offset, type: this.debugType(field.type, visited) },
        ])
      );
    return result;
  }

  /** A standard function or a value typecast in a constant expression. These
   * are the functions Turbo Pascal evaluates when it compiles. */
  private constantCall(call: CallNode): Constant {
    const name = call.name.toLowerCase(),
      [argument, second] = call.arguments;
    const integer = (value: number): Constant => ({
      kind: 'constant',
      type: this.integerRangeType(value, value, call),
      value,
    });
    const target = this.lookup(call.name);
    if (target?.kind === 'type' && argument && !second && this.ordinal(target.type)) {
      // A value typecast keeps the value's low bytes, read as the new type.
      const source = this.constant(argument);
      if (!this.ordinal(source.type)) this.fail(call, 'Ordinal typecast required');
      const bits = BigInt(target.type.byteSize * 8),
        number = BigInt(this.ordinalValue(source.value));
      const value = Number((target.type.low ?? 0) < 0 ? BigInt.asIntN(Number(bits), number) : BigInt.asUintN(Number(bits), number));
      const type = target.type;
      if (type.kind === 'char') return { kind: 'constant', type, value: String.fromCharCode(value) };
      if (type.kind === 'boolean') return { kind: 'constant', type, value: value ? 1 : 0 };
      return { kind: 'constant', type: type.enumeration ? type : this.integerRangeType(value, value, call), value };
    }
    if (!argument || (second && name !== 'ptr')) this.fail(call, 'Constant expression expected');
    if (name === 'sizeof' || name === 'high' || name === 'low') {
      const symbol = argument.type === NodeType.IDENTIFIER ? this.lookup(String(argument.name)) : undefined;
      const type = symbol?.kind === 'type' ? symbol.type : this.expressionType(argument);
      if (name === 'sizeof') return integer(type.byteSize);
      if (type.kind === 'string') return integer(name === 'high' ? (type.capacity ?? 255) : 0);
      const bounds = type.kind === 'array' ? type.index : type;
      const value = name === 'high' ? type.high : type.low;
      if (!bounds || value === undefined || !this.ordinal(bounds))
        this.fail(call, 'Ordinal, array or string type expected');
      if (bounds.kind === 'char') return { kind: 'constant', type: CHAR, value: String.fromCharCode(value) };
      return { kind: 'constant', type: bounds.kind === 'integer' && !bounds.enumeration ? this.integerRangeType(value, value, call) : bounds, value };
    }
    const value = this.constant(argument);
    const number = () => {
      if (!this.numeric(value.type)) this.fail(argument, 'Numeric constant expression expected');
      return Number(value.value);
    };
    const ordinal = () => {
      if (!this.ordinal(value.type)) this.fail(argument, 'Ordinal constant expression expected');
      return this.ordinalValue(value.value);
    };
    switch (name) {
      case 'abs':
        return value.type.kind === 'real' ? { ...value, value: Math.abs(number()) } : integer(Math.abs(number()));
      case 'chr': {
        const code = ordinal();
        if (code < 0 || code > 255) this.fail(call, 'Constant out of range');
        return { kind: 'constant', type: CHAR, value: String.fromCharCode(code) };
      }
      case 'hi':
        return integer((ordinal() >> 8) & 255);
      case 'lo':
        return integer(ordinal() & 255);
      case 'swap': {
        const word = ordinal();
        return integer(((word & 255) << 8) | ((word >> 8) & 255));
      }
      case 'length':
        if (!this.text(value.type)) this.fail(argument, 'String constant expected');
        return integer(String(value.value).length);
      case 'odd':
        return { kind: 'constant', type: BOOLEAN, value: ordinal() & 1 };
      case 'ord':
        return integer(ordinal());
      case 'pred':
      case 'succ': {
        const next = ordinal() + (name === 'succ' ? 1 : -1);
        if ((value.type.low !== undefined && next < value.type.low) || (value.type.high !== undefined && next > value.type.high))
          this.fail(call, 'Constant out of range');
        if (value.type.kind === 'char') return { kind: 'constant', type: CHAR, value: String.fromCharCode(next) };
        return value.type.kind === 'integer' && !value.type.enumeration ? integer(next) : { ...value, value: next };
      }
      case 'round':
      case 'trunc': {
        const real = number();
        return integer(name === 'trunc' ? Math.trunc(real) : Math.sign(real) * Math.round(Math.abs(real)));
      }
      case 'ptr': {
        // A segment and offset; the P-machine has no such addresses, but
        // Ptr(0, 0) is nil.
        const offset = second ? this.ordinalValue(this.constant(second).value) : 0;
        return { kind: 'constant', type: POINTER, value: ordinal() * 16 + offset };
      }
      default:
        return this.fail(call, 'Constant expression expected');
    }
  }
  /** A typed constant is an initialized variable that lives as long as the
   * program, even when a routine declares it, and keeps its value between
   * calls. Its value is worked out here, in the declaring scope. */
  private typedConstant(name: string, type: PascalType, node: TypedConstDeclarationNode): void {
    if (type.kind === 'file') this.fail(node, 'Typed constants of this type are not supported');
    let root = this.scope;
    while (root.parent) root = root.parent;
    // Module-level constants sit among the globals; a routine's go after them.
    const module = root === this.scope;
    const offset = module ? this.scope.nextOffset : this.globalOffset;
    if (module) this.scope.nextOffset += type.size;
    else this.globalOffset += type.size;
    if (offset + type.size > 32767)
      this.fail(node, 'Variable storage exceeds the supported frame size');
    const variable: Variable = {
      kind: 'variable',
      name,
      type,
      offset,
      scope: root,
      reference: false,
      static: true,
    };
    const stores: StaticStore[] = [];
    this.typedConstantValue(type, node.value, offset, stores);
    this.declare(name, variable, node);
    this.typedConstants.push({ variable, stores });
  }
  private typedConstantValue(
    type: PascalType,
    node: Node,
    offset: number,
    stores: StaticStore[]
  ): void {
    if (type.kind === 'array' && type.element) {
      const element = type.element,
        count = (type.high ?? 0) - (type.low ?? 0) + 1;
      if (element.kind === 'char' && node.type !== NodeType.ARRAY_CONSTANT && count > 1) {
        // An array of Char takes a string of exactly its length.
        const text = this.constant(node);
        if (!this.text(text.type) || String(text.value).length !== count)
          this.fail(node, `String constant of length ${String(count)} expected`);
        for (let index = 0; index < count; index++) {
          const value = String(text.value).charAt(index);
          stores.push({ offset: offset + index * element.size, type: element, value });
        }
        return;
      }
      // Parentheses around one value alone are only grouping, so a list that
      // does not fit may still be the single element of a one-element array.
      const list =
        node.type === NodeType.ARRAY_CONSTANT ? (node as ArrayConstantNode).elements : undefined;
      const elements = list?.length === count ? list : count === 1 ? [node] : (list ?? []);
      if (elements.length !== count)
        this.fail(node, `Array constant of ${String(count)} elements expected`);
      for (const [index, value] of elements.entries())
        this.typedConstantValue(element, value, offset + index * element.size, stores);
      return;
    }
    if (type.kind === 'record' && type.fields) {
      if (node.type !== NodeType.RECORD_CONSTANT) this.fail(node, 'Record constant expected');
      // An object constant's method table is set, so its virtual methods work
      // without a constructor call, as in Turbo Pascal.
      if (type.object) stores.push({ offset, type: INTEGER, value: type.object.id });
      // Fields are given in declaration order, from the first; any after the
      // last one given stay zero. Only the fields of other variant cases,
      // which share storage with the ones given, may be passed over.
      const fields = [...type.fields.entries()].filter(([key]) => !key.startsWith('$'));
      let next = 0;
      for (const { name, value } of (node as RecordConstantNode).fields) {
        const key = name.toLowerCase();
        if (!type.fields.has(key)) this.fail(value, `Unknown record field "${name}"`);
        const index = fields.findIndex(([field], position) => position >= next && field === key);
        const given = fields[index]?.[1];
        const skipped = fields.slice(next, index < 0 ? undefined : index);
        // Only the fields of the other cases of a variant part may be passed over.
        const otherCase = (field: RecordField) =>
          field.variants?.some((variant) => given?.variants?.some((chosen) => chosen.part === variant.part && chosen.case !== variant.case));
        if (!given || skipped.some(([, field]) => !otherCase(field)))
          this.fail(value, `Record field "${String(fields[next]?.[0])}" expected`);
        this.typedConstantValue(given.type, value, offset + given.offset, stores);
        for (const variant of given.variants ?? []) stores.push({ offset, type: INTEGER, value: 0, sync: variant });
        next = index + 1;
      }
      return;
    }
    if (type.procedureSignature) {
      // A procedural constant holds a routine, known when it is declared.
      if (node.type === NodeType.NIL) {
        stores.push({ offset, type, value: 0 });
        return;
      }
      const routine = node.type === NodeType.IDENTIFIER ? this.lookup(String(node.name)) : undefined;
      if (routine?.kind !== 'routine') this.fail(node, 'Procedure or function expected');
      if (routine.parent.level !== 0 || routine.methodOwner)
        this.fail(node, 'Procedural values require a non-nested procedure or function');
      if (!routine.declaration.farCalls)
        this.fail(node, 'Procedural values require a FAR procedure or function');
      if (!this.proceduralCompatible(type, this.proceduralType(routine)))
        this.fail(node, 'Type mismatch: the routine does not fit the procedural type');
      stores.push({ offset, type, value: routine.proceduralId });
      return;
    }
    if (type.kind === 'pointer' && node.type !== NodeType.NIL) {
      const text = this.charPointer(type) ? this.textConstant(node) : undefined;
      if (text === undefined) {
        stores.push({ offset, type, value: this.staticAddress(node) });
        return;
      }
      const block = this.staticText(text, node);
      stores.push(...block.stores, { offset, type, value: block.offset });
      return;
    }
    const constant = this.constant(node);
    this.requireType(node, type, constant.type);
    let value = constant.value;
    if (type.kind === 'real')
      value =
        type.comp
          ? compValue(Number(value), node.lineNumber)
          : type.byteSize === 6
          ? roundReal48(Number(value), node.lineNumber)
          : type.byteSize === 4
            ? Math.fround(Number(value))
            : Number(value);
    else if (type.kind === 'string') value = String(value).slice(0, type.capacity);
    else if (this.ordinal(type) && type.low !== undefined && type.high !== undefined) {
      const ordinal = this.ordinalValue(value);
      if (ordinal < type.low || ordinal > type.high) this.fail(node, 'Constant out of range');
    }
    stores.push({ offset, type, value });
  }

  /** The text of a string or character constant, when the node is one. */
  private textConstant(node: Node): string | undefined {
    if (node.extendedSyntax === false || !this.constantExpression(node)) return undefined;
    const value = this.constant(node);
    return this.text(value.type) ? String(value.value) : undefined;
  }
  /** Under {$X+} a zero-based array of Char stands for a PChar to its first
   * character. Leaves that address on the stack when the node is one. */
  private emitCharArrayPointer(node: Node): boolean {
    if (node.extendedSyntax === false) return false;
    const type = this.expressionType(node);
    if (type.kind !== 'array' || type.openArray || type.element?.kind !== 'char' || type.low !== 0) return false;
    this.address(node);
    return true;
  }
  /** A string constant used as a PChar: its characters are written to their
   * own storage where it is used, and its address is left on the stack. */
  private emitStaticText(text: string, node: Node): void {
    const { offset, stores } = this.staticText(text, node);
    for (const store of stores) {
      this.emit(Opcode.LDA, this.scope.level, store.offset);
      this.literal(store.value, store.type);
      this.emit(Opcode.STI, this.typeCode(store.type));
    }
    this.literal(offset, POINTER);
  }
  /** Whether a type is a pointer to Char, which {$X+} lets hold a string. */
  private charPointer(type: PascalType): boolean {
    return type.kind === 'pointer' && type.base?.kind === 'char';
  }
  /** A null-terminated copy of a string constant, in storage that lasts as
   * long as the program: its address and the cells that fill it. */
  private staticText(text: string, node: Node): { offset: number; stores: StaticStore[] } {
    const element = CHAR;
    const type: PascalType = {
      kind: 'array',
      size: text.length + 1,
      byteSize: text.length + 1,
      low: 0,
      high: text.length,
      element,
      index: INTEGER,
    };
    let root = this.scope;
    while (root.parent) root = root.parent;
    // The program's frame grows to hold the text, whether it is filled when
    // the program starts or where the constant is used.
    const offset = Math.max(this.globalOffset, root.nextOffset);
    this.globalOffset = root.nextOffset = offset + type.size;
    if (offset + type.size > 32767)
      this.fail(node, 'Variable storage exceeds the supported frame size');
    const stores: StaticStore[] = [];
    for (let index = 0; index <= text.length; index++)
      stores.push({ offset: offset + index, type: element, value: text.charAt(index) || '\0' });
    return { offset, stores };
  }
  /** A pointer typed constant's value: the address of a global variable, a
   * typed constant, or a part of one, which is fixed when the program starts
   * since the program's frame begins at address 0. */
  private staticAddress(node: Node): number {
    if (node.type === NodeType.CALL) {
      // A typecast such as PString(@S) keeps the address.
      const { name, arguments: [operand, ...rest] } = node as CallNode;
      if (operand && !rest.length && this.lookup(name)?.kind === 'type')
        return this.staticAddress(operand);
    }
    if (node.type !== NodeType.ADDRESS_OF) this.fail(node, 'Constant expression expected');
    return this.staticLocation(node.operand as Node).offset;
  }
  private staticLocation(node: Node): { offset: number; type: PascalType } {
    if (node.type === NodeType.IDENTIFIER) {
      const symbol = this.lookup(String(node.name));
      const global = symbol?.kind === 'variable' && symbol.scope.level === 0;
      if (global && !symbol.reference && !symbol.container)
        return { offset: symbol.offset, type: symbol.type };
    } else if (node.type === NodeType.ARRAY_ACCESS) {
      const access = node as ArrayAccessNode;
      let location = this.staticLocation(access.array);
      for (const index of access.indices) {
        const array = location.type;
        if (array.kind !== 'array' || !array.element) this.fail(index, 'Array required');
        const low = array.low ?? 0,
          position = this.ordinalValue(this.constant(index).value);
        if (position < low || position > (array.high ?? 0))
          this.fail(index, 'Constant out of range');
        location = {
          offset: location.offset + (position - low) * array.element.size,
          type: array.element,
        };
      }
      return location;
    } else if (node.type === NodeType.FIELD_ACCESS) {
      const access = node as FieldAccessNode;
      const location = this.staticLocation(access.record);
      const field = location.type.fields?.get(access.field.toLowerCase());
      if (!field) this.fail(node, `Unknown record field "${access.field}"`);
      return { offset: location.offset + field.offset, type: field.type };
    }
    return this.fail(node, 'Address of a global variable expected');
  }

  private initialize(type: PascalType, offset: number): void {
    if (type.kind === 'array') {
      for (let index = 0; index < type.size; index += type.element!.size)
        this.initialize(type.element!, offset + index);
    } else if (type.kind === 'record') {
      for (const field of type.initialLayout ?? type.fields!.values())
        this.initialize(field.type, offset + field.offset);
    } else {
      this.emit(Opcode.LDA, 0, offset);
      // Storage starts zeroed, as Turbo Pascal's does: a Char is #0, never the
      // empty string, which is no character at all.
      this.literal(type.kind === 'char' ? '\0' : this.text(type) ? '' : type.kind === 'set' ? '[]' : 0, type);
      this.emit(Opcode.STI, this.typeCode(type));
    }
  }

  /** An empty statement, such as the body of `while c do ;`, emits no code. */
  private statement(node: Node | null): void {
    if (!node) return;
    this.atSource(node, () => { this.emitStatement(node); });
  }
  private emitStatement(node: Node): void {
    this.line = node.lineNumber ?? this.line;
    if (node.type !== NodeType.BLOCK && node.type !== NodeType.LABELED_STATEMENT)
      this.bytecode.statementLines[this.bytecode.getNextAddress()] = this.line;
    switch (node.type) {
      case NodeType.UNIT_INITIALIZATION: {
        const parent = this.scope, unit = node.unit as CompiledUnit;
        this.scope = unit.scope;
        this.scope.nextOffset = parent.nextOffset;
        unit.debugStart = this.bytecode.getNextAddress();
        for (const statement of unit.node.initialization.statements) this.statement(statement);
        for (const exit of this.scope.exits) this.patch(exit);
        for (const label of this.scope.labels.values())
          if (label.address === undefined && label.patches.length)
            this.fail(label.uses[0] ?? label.node, 'Undefined label');
        unit.debugEnd = this.bytecode.getNextAddress();
        parent.nextOffset = this.scope.nextOffset;
        this.scope = parent;
        return;
      }
      case NodeType.WITH_STATEMENT: {
        const count = this.scope.withRecords.length;
        for (const record of node.records as Node[]) {
          const pointer = this.temp(POINTER);
          this.addressVariable(pointer);
          const type = this.address(record);
          if (type.kind !== 'record') this.fail(record, 'WITH requires a record');
          this.emit(Opcode.STI, TypeCode.A);
          this.scope.withRecords.push({ pointer, type });
        }
        if (node.body) this.statement(node.body as Node);
        this.scope.withRecords.length = count;
        // A record in a variant case, changed through WITH, brings the case's
        // record up to date.
        for (const record of node.records as Node[]) this.emitVariantSyncs(this.variantChain(record));
        return;
      }
      case NodeType.GOTO_STATEMENT: {
        const key = String(node.label).toLowerCase();
        let destination: Scope | null = this.scope;
        while (destination && !destination.labels.has(key)) destination = destination.parent;
        if (!destination) this.fail(node, 'Undeclared label');
        // Turbo Pascal's goto stays within the routine or program block that
        // declares the label.
        if (destination !== this.scope) this.fail(node, 'Label not within current block');
        const label = destination.labels.get(key)!;
        label.uses.push(node);
        const jump = this.emit(
          Opcode.UJP,
          this.scope.level - destination.level,
          label.address ?? 0
        );
        if (label.address === undefined) label.patches.push(jump);
        return;
      }
      case NodeType.LABELED_STATEMENT: {
        const label = this.scope.labels.get(String(node.label).toLowerCase());
        if (!label) this.fail(node, 'Undeclared label');
        if (label.address !== undefined) this.fail(node, 'Duplicate label definition');
        label.address = this.bytecode.getNextAddress();
        for (const jump of label.patches) this.patch(jump, label.address);
        if (node.statement) this.statement(node.statement as Node);
        return;
      }
      case NodeType.BLOCK:
        for (const statement of (node as BlockNode).statements) this.statement(statement);
        return;
      case NodeType.ASSIGNMENT:
        this.assignment(node as AssignmentNode);
        return;
      case NodeType.CALL:
        this.call(node as CallNode, false);
        return;
      case NodeType.IF_STATEMENT: {
        const branch = node as IfStatementNode;
        this.requireType(branch.condition, BOOLEAN, this.expression(branch.condition));
        const jump = this.emit(Opcode.FJP);
        this.statement(branch.thenBranch);
        if (branch.elseBranch) {
          const end = this.emit(Opcode.UJP);
          this.patch(jump);
          this.statement(branch.elseBranch);
          this.patch(end);
        } else this.patch(jump);
        return;
      }
      case NodeType.WHILE_STATEMENT: {
        const loopNode = node as WhileStatementNode;
        const start = this.bytecode.getNextAddress();
        this.requireType(loopNode.condition, BOOLEAN, this.expression(loopNode.condition));
        const end = this.emit(Opcode.FJP);
        const loop = this.beginLoop();
        this.statement(loopNode.body);
        this.emit(Opcode.UJP, 0, start);
        this.patch(end);
        this.endLoop(loop, start);
        return;
      }
      case NodeType.REPEAT_STATEMENT: {
        const loopNode = node as RepeatStatementNode;
        const start = this.bytecode.getNextAddress();
        const loop = this.beginLoop();
        for (const statement of loopNode.statements) this.statement(statement);
        const condition = this.bytecode.getNextAddress();
        this.requireType(loopNode.condition, BOOLEAN, this.expression(loopNode.condition));
        this.emit(Opcode.FJP, 0, start);
        this.endLoop(loop, condition);
        return;
      }
      case NodeType.FOR_STATEMENT:
        this.forStatement(node as ForStatementNode);
        return;
      case NodeType.CASE_STATEMENT:
        this.caseStatement(node as CaseStatementNode);
        return;
      case NodeType.EXIT:
        this.scope.exits.push(this.emit(Opcode.UJP));
        return;
      case NodeType.ASM_STATEMENT:
        this.assemblyStatement(node);
        return;
      case NodeType.INLINE_STATEMENT: {
        const variables: Variable[] = [];
        const block = this.inlineBlock(node, variables);
        this.emitAssembly(block, variables);
        for (const variable of variables) this.emitVariantRefresh({ variable }, variable.type);
        return;
      }
      default:
        this.fail(node, `Unsupported statement: ${node.type}`);
    }
  }
  private beginLoop(): Loop {
    const loop: Loop = { breaks: [], continues: [] };
    this.scope.loops.push(loop);
    return loop;
  }
  private endLoop(loop: Loop, continueAddress: number): void {
    this.scope.loops.pop();
    for (const jump of loop.breaks) this.patch(jump);
    for (const jump of loop.continues) this.patch(jump, continueAddress);
  }
  private forStatement(node: ForStatementNode): void {
    const variable = this.lookup(node.variable);
    if (variable?.kind !== 'variable') this.fail(node, `Undeclared variable "${node.variable}"`);
    if (!this.ordinal(variable.type))
      this.fail(node, 'For loop variable must have an ordinal type');
    // Turbo Pascal counts with a simple variable of this routine or a global
    // one, never one reached through an enclosing routine's frame.
    const local = this.scope.symbols.get(node.variable.toLowerCase()) === variable;
    if ((!local && variable.scope.level !== 0) || variable.reference)
      this.fail(node, `Invalid FOR control variable "${node.variable}"`);
    this.requireWritable({ type: NodeType.IDENTIFIER, name: node.variable, lineNumber: node.lineNumber });
    // As in Turbo Pascal, both bounds are evaluated before the variable is
    // assigned, and an empty range leaves the variable untouched.
    const first = this.temp(variable.type);
    this.addressVariable(first);
    this.requireType(node.start, variable.type, this.expression(node.start));
    this.emit(Opcode.STI, this.typeCode(variable.type));
    const limit = this.temp(variable.type);
    this.addressVariable(limit);
    this.requireType(node.end, variable.type, this.expression(node.end));
    this.emit(Opcode.STI, this.typeCode(variable.type));
    this.loadVariable(first);
    this.loadVariable(limit);
    this.emit(node.direction === 'downto' ? Opcode.GEQ : Opcode.LEQ, this.typeCode(variable.type));
    const empty = this.emit(Opcode.FJP);
    this.addressVariable(variable);
    this.loadVariable(first);
    this.emit(Opcode.STI, this.typeCode(variable.type));
    const start = this.bytecode.getNextAddress();
    const loop = this.beginLoop();
    this.statement(node.body);
    const next = this.bytecode.getNextAddress();
    // Stop on the final value instead of stepping past it: the variable ends
    // holding the last value and never leaves its type, so a Byte loop to 255
    // does not reach 256.
    this.loadVariable(variable);
    this.loadVariable(limit);
    this.emit(Opcode.EQU, this.typeCode(variable.type));
    const last = this.emit(Opcode.TJP);
    this.addressVariable(variable);
    this.loadVariable(variable);
    this.helper(`step-${variable.type.kind}-${node.direction}`, 1, (value) => {
      const increment = node.direction === 'downto' ? -1 : 1;
      return variable.type.kind === 'char'
        ? String.fromCharCode(String(value).charCodeAt(0) + increment)
        : Number(value) + increment;
    });
    this.emit(Opcode.STI, this.typeCode(variable.type));
    this.emit(Opcode.UJP, 0, start);
    this.patch(empty);
    this.patch(last);
    this.endLoop(loop, next);
  }
  private caseStatement(node: CaseStatementNode): void {
    const selectorType = this.expressionType(node.selector);
    if (!this.ordinal(selectorType) && !this.text(selectorType))
      this.fail(node, 'Case selector must be ordinal');
    const selector = this.temp(selectorType);
    this.addressVariable(selector);
    this.expression(node.selector);
    this.emit(Opcode.STI, this.typeCode(selectorType));
    const exits: number[] = [];
    const labels: { low: number | string; high: number | string }[] = [];
    const rememberLabel = (low: Constant, high: Constant, label: Node): void => {
      const lower = this.text(selectorType) ? String(low.value) : Number(low.value);
      const upper = this.text(selectorType) ? String(high.value) : Number(high.value);
      if (lower > upper) this.fail(label, 'Case range lower bound exceeds upper bound');
      if (labels.some(previous => lower <= previous.high && upper >= previous.low))
        this.fail(label, 'Duplicate or overlapping case label');
      labels.push({ low: lower, high: upper });
    };
    for (const item of node.cases) {
      const matches: number[] = [];
      for (const label of item.labels) {
        if (label.type === NodeType.RANGE) {
          const low = this.constant(label.low as Node),
            high = this.constant(label.high as Node);
          this.requireType(label, selectorType, low.type);
          this.requireType(label, selectorType, high.type);
          rememberLabel(low, high, label);
          this.loadVariable(selector);
          this.literal(low.value, low.type);
          this.emit(Opcode.GEQ, this.typeCode(selectorType));
          this.loadVariable(selector);
          this.literal(high.value, high.type);
          this.emit(Opcode.LEQ, this.typeCode(selectorType));
          this.emit(Opcode.AND);
        } else {
          const value = this.constant(label);
          this.requireType(label, selectorType, value.type);
          rememberLabel(value, value, label);
          this.loadVariable(selector);
          this.literal(value.value, value.type);
          this.emit(Opcode.EQU, this.typeCode(selectorType));
        }
        matches.push(this.emit(Opcode.TJP));
      }
      const skip = this.emit(Opcode.UJP);
      for (const match of matches) this.patch(match);
      this.statement(item.statement);
      exits.push(this.emit(Opcode.UJP));
      this.patch(skip);
    }
    for (const statement of node.elseClause ?? []) this.statement(statement);
    for (const exit of exits) this.patch(exit);
  }

  private objectVmtOffsets(type: PascalType, start = 0): Set<number> {
    const offsets = new Set<number>();
    if (type.object) offsets.add(start);
    if (type.kind === 'record') for (const [name, field] of type.fields!) {
      if (name === '$vmt') continue;
      for (const offset of this.objectVmtOffsets(field.type, start + field.offset)) offsets.add(offset);
    }
    if (type.kind === 'array') for (let offset = 0; offset < type.size; offset += type.element!.size)
      for (const item of this.objectVmtOffsets(type.element!, start + offset)) offsets.add(item);
    return offsets;
  }
  private assignment(node: AssignmentNode): void {
    // A store into a variant case brings its record's other cases up to date.
    if (this.variantChain(node.target).length) {
      this.withVariantSyncs([node.target], [false], ([target]) => {
        this.assign({ ...node, target: target! });
      });
      return;
    }
    this.assign(node);
  }
  private assign(node: AssignmentNode): void {
    const targetType = this.expressionType(node.target, true);
    this.requireWritable(node.target);
    this.checkConstantRange(node.value, targetType);
    if (this.aggregate(targetType)) {
      const sourceType = this.expressionType(node.value);
      if (targetType.openArray || sourceType.openArray)
        this.fail(node, 'Open arrays cannot be assigned as a whole');
      this.requireType(node, targetType, sourceType);
      const destination = this.temp(POINTER),
        source = this.temp(POINTER);
      this.addressVariable(destination);
      this.address(node.target);
      this.emit(Opcode.STI, TypeCode.A);
      this.addressVariable(source);
      this.address(node.value);
      this.emit(Opcode.STI, TypeCode.A);
      const vmtOffsets = this.objectVmtOffsets(targetType);
      for (let index = 0; index < targetType.size; index++) {
        if (vmtOffsets.has(index)) continue;
        this.loadVariable(destination);
        this.literal(index, INTEGER);
        this.emit(Opcode.ADI);
        this.loadVariable(source);
        this.literal(index, INTEGER);
        this.emit(Opcode.ADI);
        this.emit(Opcode.CSP, 2, InternalProcedure.COPY_AGGREGATE_CELL);
      }
      return;
    }
    this.address(node.target);
    // {$X+} lets a string constant become a PChar, in storage of its own.
    const text = this.charPointer(targetType) ? this.textConstant(node.value) : undefined;
    if (text !== undefined || (this.charPointer(targetType) && this.emitCharArrayPointer(node.value))) {
      if (text !== undefined) this.emitStaticText(text, node.value);
      this.emit(Opcode.STI, this.typeCode(targetType));
      return;
    }
    this.requireType(node.value, targetType, targetType.procedureSignature ? this.proceduralValue(node.value) : this.expression(node.value));
    this.checkRange(targetType, node);
    this.emit(Opcode.STI, this.typeCode(targetType));
  }

  /** The variant cases a designator lies in, the innermost first, each
   * with the record it is a case of. */
  private variantChain(node: Node): { base: Node; part: number; case: number }[] {
    node = this.qualified(node);
    if (node.internalVariable) return [];
    if (node.type === NodeType.FIELD_ACCESS) {
      const record = node.record as Node;
      const field = this.expressionType(record).fields?.get(String(node.field).toLowerCase());
      return [...(field?.variants ?? []).map((variant) => ({ base: record, ...variant })), ...this.variantChain(record)];
    }
    if (node.type === NodeType.ARRAY_ACCESS) return this.variantChain(node.array as Node);
    if (node.type === NodeType.IDENTIFIER) {
      const symbol = this.lookup(String(node.name));
      if (symbol?.kind !== 'variable' || !symbol.variants || !symbol.container) return [];
      const base = {
        type: NodeType.POINTER_DEREF,
        pointer: { type: NodeType.IDENTIFIER, internalVariable: { ...symbol.container, type: { ...POINTER, base: symbol.containerType } } },
      } as Node;
      return symbol.variants.map((variant) => ({ base, ...variant }));
    }
    return [];
  }
  /** Whether evaluating an expression again could do something else. */
  private hasSideEffects(node: Node): boolean {
    if (node.type === NodeType.CALL) return true;
    if (node.type === NodeType.IDENTIFIER && !node.internalVariable) return this.lookup(String(node.name))?.kind === 'routine';
    return Object.values(node).some((value) =>
      Array.isArray(value)
        ? value.some((item) => typeof item === 'object' && item !== null && 'type' in item && this.hasSideEffects(item as Node))
        : typeof value === 'object' && value !== null && 'type' in value && this.hasSideEffects(value as Node)
    );
  }
  private replaceNode(node: Node, target: Node, replacement: Node): Node {
    if (node === target) return replacement;
    const copy: Node = { ...node };
    for (const [key, value] of Object.entries(node))
      if (typeof value === 'object' && value !== null && 'type' in value) copy[key] = this.replaceNode(value as Node, target, replacement);
    return copy;
  }
  /** Compile what stores into `targets`, then bring the variant records
   * they lie in, or that they are, up to date. A record whose address could
   * change is found once, before. */
  private withVariantSyncs<T>(targets: Node[], refresh: boolean[], compile: (targets: Node[]) => T): T {
    const settled = targets.map((target) => {
      const outer = this.variantChain(target).at(-1);
      if (!outer || !this.hasSideEffects(outer.base)) return target;
      const pointer = this.temp({ ...POINTER, base: this.expressionType(outer.base) });
      this.addressVariable(pointer);
      this.address(outer.base);
      this.emit(Opcode.STI, TypeCode.A);
      const replacement = { type: NodeType.POINTER_DEREF, pointer: { type: NodeType.IDENTIFIER, internalVariable: pointer }, lineNumber: target.lineNumber } as Node;
      return this.replaceNode(target, outer.base, replacement);
    });
    const result = compile(settled);
    settled.forEach((target, index) => {
      if (refresh[index]) this.emitVariantRefresh({ node: target }, this.expressionType(target));
      this.emitVariantSyncs(this.variantChain(target));
    });
    return result;
  }
  private emitVariantSyncs(chain: { base: Node; part: number; case: number }[]): void {
    for (const { base, part, case: index } of chain) {
      this.address(base);
      this.literal(part, INTEGER);
      this.literal(index, INTEGER);
      this.emit(Opcode.CSP, 3, InternalProcedure.VARIANT_SYNC);
    }
  }
  /** After a variable's bytes changed as a whole: its variant parts follow. */
  private emitVariantRefresh(target: { node: Node } | { variable: Variable }, type: PascalType): void {
    const parts = this.variantRefreshes(type, 0);
    if (!parts.length) return;
    if ('variable' in target) this.addressVariable(target.variable);
    else this.address(target.node);
    this.literal(this.refreshListId(type), INTEGER);
    this.emit(Opcode.CSP, 2, InternalProcedure.VARIANT_REFRESH);
  }
  /** The arguments a call may store into: those passed to var parameters. */
  private writtenArguments(node: CallNode): number[] {
    const candidates = (indexes: number[]) =>
      indexes.filter((index) => {
        const argument = node.arguments[index];
        if (!argument || ![NodeType.IDENTIFIER, NodeType.FIELD_ACCESS, NodeType.ARRAY_ACCESS, NodeType.POINTER_DEREF].includes(argument.type)) return false;
        try {
          return this.variantChain(argument).length > 0 || this.variantRefreshes(this.expressionType(argument), 0).length > 0;
        } catch {
          return false;
        }
      });
    const all = node.arguments.map((_, index) => index);
    if (node.receiver) return [];
    const routine = this.lookupRoutine(node.name);
    if (routine)
      return candidates(all.filter((index) => {
        const parameter = routine.parameters[index];
        return parameter !== undefined && parameter.reference && !parameter.readOnly;
      }));
    const name = node.name.toLowerCase().replace(/^.*\./, '');
    const builtin = this.modules.lookupProcedure(node.name)?.proc;
    if (!builtin) {
      const symbol = this.lookup(node.name);
      const parameters = symbol?.kind === 'variable' ? symbol.type.procedureSignature?.parameters : undefined;
      return parameters ? candidates(all.filter((index) => parameters[index]?.reference)) : [];
    }
    const known: Record<string, number[]> = {
      inc: [0], dec: [0], str: [1], val: [1, 2], insert: [1], delete: [0], fillchar: [0], move: [1],
      blockread: [1, 3], blockwrite: [3], getdir: [1], getmem: [0], mark: [0], new: [0],
    };
    if (name === 'read' || name === 'readln') return candidates(all);
    return candidates(known[name] ?? all.filter((index) => builtin.params[index]?.mode === ParamMode.VAR));
  }

  /** Determine expression types without emitting code, for address/aggregate dispatch. */
  private expressionType(node: Node, rawProcedure = false): PascalType {
    node = this.qualified(node);
    if (node.internalVariable) return (node.internalVariable as Variable).type;
    if (this.numericConstant(node)) return this.constant(node).type;
    switch (node.type) {
      case NodeType.FORMATTED_ARGUMENT:
        return this.expressionType(node.value as Node);
      case NodeType.STRING_TYPE:
      case NodeType.INTEGER_TYPE:
      case NodeType.REAL_TYPE:
      case NodeType.BOOLEAN_TYPE:
      case NodeType.CHAR_TYPE:
        return this.resolveType(node);
      case NodeType.NUMBER:
        return this.constant(node).type;
      case NodeType.STRING:
        return String(node.value).length === 1 ? CHAR : STRING;
      case NodeType.BOOLEAN:
        return BOOLEAN;
      case NodeType.NIL:
        return POINTER;
      case NodeType.SET_LITERAL:
        return this.setLiteralType(node);
      case NodeType.ADDRESS_OF: {
        if (this.routineAddress(node.operand as Node)) return POINTER;
        // The address of an untyped parameter is an untyped Pointer.
        const base = this.expressionType(node.operand as Node);
        return base.kind === 'untyped' ? POINTER : { ...POINTER, base };
      }
      case NodeType.POINTER_DEREF: {
        const pointer = this.expressionType(node.pointer as Node);
        if (pointer.kind !== 'pointer' || !pointer.base || pointer.base.kind === 'void')
          this.fail(node, 'Typed pointer required');
        return pointer.base;
      }
      case NodeType.IDENTIFIER: {
        const symbol = this.lookup(node.name as string);
        if (symbol) return !rawProcedure && symbol.kind === 'variable' && symbol.type.procedureSignature ? symbol.type.procedureSignature.result : symbol.type;
        const method = this.methodTarget({ ...node, type: NodeType.CALL, name: String(node.name), arguments: [] });
        if (method) return method.routine.type;
        const builtin = this.modules.lookupProcedure(node.name as string)?.proc;
        if (builtin?.isFunction) return this.builtinReturn(builtin, []);
        return this.fail(node, `Undeclared identifier "${String(node.name)}"`);
      }
      case NodeType.CALL: {
        let call = node as CallNode;
        if (call.receiver) {
          const qualified = this.qualified({ type: NodeType.FIELD_ACCESS, record: call.receiver, field: call.name });
          if (qualified.type === NodeType.IDENTIFIER) call = { ...call, receiver: undefined, name: String(qualified.name) };
        }
        if (call.name.toLowerCase() === 'assigned') return BOOLEAN;
        const callable = this.proceduralTarget(call);
        if (callable) return callable.type.procedureSignature!.result;
        const method = this.methodTarget(call);
        if (method) return method.routine.type;
        const cast = this.lookup(call.name);
        if (cast?.kind === 'type') return cast.type;
        const routine = this.lookupRoutine(call.name);
        if (routine) return routine.type;
        if (call.name.toLowerCase() === 'new' && call.arguments[0]) return this.expressionType(call.arguments[0]);
        const builtin = this.modules.lookupProcedure(call.name)?.proc;
        if (builtin) return this.builtinReturn(builtin, call.arguments);
        return this.fail(node, `Undeclared procedure or function "${call.name}"`);
      }
      case NodeType.ARRAY_ACCESS: {
        const access = node as ArrayAccessNode;
        let type = this.expressionType(access.array);
        if (this.charPointer(type) && access.indices.length === 1) return CHAR;
        for (const index of access.indices) {
          if (type.kind === 'string') type = CHAR;
          else if (type.kind === 'array') type = type.element!;
          else this.fail(index, 'Array or string expected');
        }
        return !rawProcedure && type.procedureSignature ? type.procedureSignature.result : type;
      }
      case NodeType.FIELD_ACCESS: {
        const access = node as FieldAccessNode;
        const type = this.expressionType(access.record);
        const method = type.object?.methods.get(access.field.toLowerCase());
        if (method) {
          if (method.privateOwner && !this.inModule(method.privateOwner)) this.fail(node, `Private object method "${access.field}"`);
          return method.type;
        }
        const field = type.fields?.get(access.field.toLowerCase());
        if (!field) this.fail(node, `Unknown record field "${access.field}"`);
        if (field.privateOwner && !this.inModule(field.privateOwner)) this.fail(node, `Private object member "${access.field}"`);
        return !rawProcedure && field.type.procedureSignature ? field.type.procedureSignature.result : field.type;
      }
      case NodeType.UNARY_OP: {
        const operand = this.expressionType((node as UnaryOpNode).operand);
        return operand.kind === 'integer' && (node as UnaryOpNode).operator !== 'not'
          ? this.promoteInteger(operand)
          : operand;
      }
      case NodeType.BINARY_OP: {
        const binary = node as BinaryOpNode;
        const operator = binary.operator.toLowerCase();
        if (['=', '<>', '<', '>', '<=', '>=', 'in'].includes(operator)) return BOOLEAN;
        const left = this.expressionType(binary.left),
          right = this.expressionType(binary.right);
        if (operator === '+' && this.text(left) && this.text(right)) return STRING;
        if (operator === '-' && this.charPointer(left) && this.charPointer(right)) return WORD;
        if (operator === '/' || left.kind === 'real' || right.kind === 'real')
          return this.coprocessorArithmetic(left, right) ? EXTENDED : REAL;
        if (left.kind === 'integer' && right.kind === 'integer')
          return this.integerResultType(left, right, operator);
        return left;
      }
      default:
        this.fail(node, `Unsupported expression: ${node.type}`);
    }
  }
  private expression(node: Node): PascalType {
    return this.atSource(node, () => this.emitExpression(node));
  }
  private emitExpression(node: Node): PascalType {
    node = this.qualified(node);
    if (node.internalVariable) { const variable = node.internalVariable as Variable; this.loadVariable(variable); return variable.type; }
    this.line = node.lineNumber ?? this.line;
    // A standard function of constants is worked out while compiling, so a
    // value that does not fit is reported then, as Turbo Pascal reports it.
    if (node.type === NodeType.CALL && this.constantExpression(node)) {
      const folded = this.constant(node);
      if (!this.aggregate(folded.type)) {
        this.literal(folded.value, folded.type);
        return folded.type;
      }
    }
    if (this.numericConstant(node)) {
      const value = this.constant(node);
      this.literal(value.value, value.type);
      return value.type;
    }
    switch (node.type) {
      case NodeType.SET_LITERAL:
        return this.setLiteral(node);
      case NodeType.ADDRESS_OF: {
        // @P of a procedure is a value ExitProc and procedural calls can use.
        const routine = this.routineAddress(node.operand as Node);
        if (routine) {
          this.literal(routine.proceduralId, POINTER);
          return POINTER;
        }
        // A pointer into a variant case views its record's bytes, so what is
        // stored through it reaches the other cases.
        const operand = node.operand as Node;
        const chain = this.variantChain(operand);
        if (chain.length) {
          const inner = chain[0]!;
          const record = this.expressionType(inner.base);
          const base = this.expressionType(operand);
          this.emitView(() => { this.address(inner.base); }, () => { this.literal(this.layoutId(record), INTEGER); }, record, 0,
            this.refreshListId(record), chain.slice(1), () => { this.address(operand); });
          return { ...POINTER, base };
        }
        const base = this.address(operand);
        return base.kind === 'untyped' ? POINTER : { ...POINTER, base };
      }
      case NodeType.POINTER_DEREF: {
        const type = this.address(node);
        if (this.aggregate(type))
          this.fail(node, 'Aggregate pointer value requires an assignment or matching parameter');
        this.emit(Opcode.LDI, this.typeCode(type));
        return type;
      }
      case NodeType.NUMBER:
      case NodeType.STRING:
      case NodeType.BOOLEAN:
      case NodeType.NIL: {
        const constant = this.constant(node);
        this.literal(constant.value, constant.type);
        return constant.type;
      }
      case NodeType.IDENTIFIER: {
        const symbol = this.lookup(node.name as string);
        if (symbol?.kind === 'constant') {
          this.literal(symbol.value, symbol.type);
          return symbol.type;
        }
        if (symbol?.kind === 'variable') {
          if (symbol.type.procedureSignature) return this.proceduralCall({ ...node, type: NodeType.CALL, name: String(node.name), arguments: [] }, true, { node, type: symbol.type });
          if (this.aggregate(symbol.type))
            this.fail(node, 'Array or record value requires an assignment or matching parameter');
          this.loadVariable(symbol);
          return symbol.type;
        }
        if (symbol?.kind === 'type')
          this.fail(node, `Type "${String(node.name)}" cannot be used as a value`);
        return this.call(
          { ...node, type: NodeType.CALL, name: node.name as string, arguments: [] },
          true
        );
      }
      case NodeType.CALL:
        return this.call(node as CallNode, true);
      case NodeType.ARRAY_ACCESS: {
        const callbackType = this.expressionType(node, true);
        if (callbackType.procedureSignature) return this.proceduralCall({ ...node, type: NodeType.CALL, name: '$indirect', arguments: [] }, true, { node, type: callbackType });
        const access = node as ArrayAccessNode;
        if (this.expressionType(access.array).kind === 'string') {
          if (access.indices.length !== 1) this.fail(node, 'A string requires one index');
          const base = access.array;
          const variable = base.type === NodeType.IDENTIFIER && this.lookup(base.name as string)?.kind === 'variable';
          if (variable || [NodeType.ARRAY_ACCESS, NodeType.FIELD_ACCESS, NodeType.POINTER_DEREF].includes(base.type)) {
            this.address(node);
            this.emit(Opcode.LDI, TypeCode.C);
            return CHAR;
          }
          this.expression(access.array);
          this.requireType(access.indices[0]!, INTEGER, this.expression(access.indices[0]!));
          const line = node.lineNumber ?? this.line;
          this.helper(`string-index-${String(line)}`, 2, (value, index) => {
            const text = String(value),
              at = Number(index);
            if (at === 0) return String.fromCharCode(text.length);
            if (!Number.isInteger(at) || at < 1 || at > text.length)
              throw new PascalError('String index out of bounds', line);
            return text.charAt(at - 1);
          });
          return CHAR;
        }
        const type = this.address(node);
        if (this.aggregate(type))
          this.fail(node, 'Array or record value requires an assignment or matching parameter');
        this.emit(Opcode.LDI, this.typeCode(type));
        return type;
      }
      case NodeType.FIELD_ACCESS: {
        const callbackType = this.expressionType(node, true);
        if (callbackType.procedureSignature) return this.proceduralCall({ ...node, type: NodeType.CALL, name: '$indirect', arguments: [] }, true, { node, type: callbackType });
        const access = node as FieldAccessNode;
        if (this.expressionType(access.record).object?.methods.has(access.field.toLowerCase()))
          return this.call({ ...node, type: NodeType.CALL, name: access.field, receiver: access.record, arguments: [] }, true);
        const type = this.address(node);
        if (this.aggregate(type))
          this.fail(node, 'Array or record value requires an assignment or matching parameter');
        this.emit(Opcode.LDI, this.typeCode(type));
        return type;
      }
      case NodeType.UNARY_OP: {
        const unary = node as UnaryOpNode;
        const operand = this.expression(unary.operand),
          operator = unary.operator.toLowerCase();
        const type =
          operand.kind === 'integer' && operator !== 'not' ? this.promoteInteger(operand) : operand;
        if (operator === 'not') {
          if (type.kind === 'boolean') this.emit(Opcode.NOT);
          else if (type.kind === 'integer' && this.numeric(type)) this.integerHelper('not', type, node, 1);
          else this.fail(node, 'NOT requires a boolean or integer operand');
        } else {
          if (!this.numeric(type)) this.fail(node, 'Numeric operand expected');
          if (operator === '-') {
            if (type.kind === 'real') this.emit(Opcode.NGR);
            else this.integerHelper('negate', type, node, 1);
          } else if (operator !== '+') this.fail(node, `Unsupported unary operator "${operator}"`);
        }
        return type;
      }
      case NodeType.BINARY_OP:
        return this.binary(node as BinaryOpNode);
      default:
        this.fail(node, `Unsupported expression: ${node.type}`);
    }
  }
  private binary(node: BinaryOpNode): PascalType {
    const operation = node.operator.toLowerCase();
    if (!node.completeBooleanEvaluation && (operation === 'and' || operation === 'or') && this.expressionType(node.left).kind === 'boolean') {
      this.requireType(node.right, BOOLEAN, this.expressionType(node.right));
      this.expression(node.left);
      const branch = this.emit(Opcode.FJP);
      if (operation === 'and') this.expression(node.right); else this.literal(true, BOOLEAN);
      const end = this.emit(Opcode.UJP);
      this.patch(branch);
      if (operation === 'and') this.literal(false, BOOLEAN); else this.expression(node.right);
      this.patch(end);
      return BOOLEAN;
    }
    const left = this.expression(node.left),
      right = this.expression(node.right),
      operator = node.operator.toLowerCase();
    this.line = node.lineNumber ?? this.line;
    // {$X+} moves a PChar by a count, or measures the distance between two.
    if (node.extendedSyntax !== false && (operator === '+' || operator === '-') && this.charPointer(left)) {
      if (right.kind === 'integer' && !right.enumeration) {
        this.emit(operator === '+' ? Opcode.ADI : Opcode.SBI);
        return left;
      }
      if (operator === '-' && this.charPointer(right)) {
        this.emit(Opcode.SBI);
        return WORD;
      }
    }
    if (operator === 'in') {
      if (
        right.kind !== 'set' ||
        !this.ordinal(left) ||
        (right.base && !this.compatible(right.base, left))
      )
        this.fail(node, 'IN requires an ordinal value and a matching set');
      this.helper('set-in', 2, (value, set) =>
        this.decodeSet(set).includes(this.ordinalValue(value as Value)) ? 1 : 0
      );
      return BOOLEAN;
    }
    if (left.kind === 'set' || right.kind === 'set') {
      this.requireType(node, left, right);
      if (!['+', '-', '*', '=', '<>', '<=', '>='].includes(operator))
        this.fail(node, 'Invalid set operator');
      this.helper(`set-${operator}`, 2, (a, b) => this.setOperation(operator, a, b));
      return ['+', '-', '*'].includes(operator) ? left : BOOLEAN;
    }
    const comparisons: Record<string, Opcode> = {
      '=': Opcode.EQU,
      '<>': Opcode.NEQ,
      '<': Opcode.LES,
      '>': Opcode.GRT,
      '<=': Opcode.LEQ,
      '>=': Opcode.GEQ,
    };
    if (comparisons[operator] !== undefined) {
      if (
        !(this.numeric(left) && this.numeric(right)) &&
        !(this.text(left) && this.text(right)) &&
        !this.compatible(left, right)
      )
        this.fail(node, 'Incompatible comparison operands');
      if (this.aggregate(left)) this.fail(node, 'Array and record comparisons are not supported');
      this.emit(comparisons[operator], this.typeCode(left));
      return BOOLEAN;
    }
    if (operator === '+' && this.text(left) && this.text(right)) {
      this.helper('string-concat', 2, (a, b) => (String(a) + String(b)).slice(0, 255));
      return STRING;
    }
    if (['and', 'or', 'xor'].includes(operator)) {
      if (left.kind !== right.kind || !['integer', 'boolean'].includes(left.kind))
        this.fail(node, 'AND, OR and XOR require matching integer or boolean operands');
      if (left.kind === 'boolean') {
        this.emit(operator === 'and' ? Opcode.AND : operator === 'or' ? Opcode.IOR : Opcode.XOR);
        return BOOLEAN;
      }
      if (!this.numeric(left) || !this.numeric(right))
        this.fail(node, 'AND, OR and XOR require matching integer or boolean operands');
      const type = this.integerResultType(left, right, operator);
      this.integerHelper(operator, type, node);
      return type;
    }
    if (!this.numeric(left) || !this.numeric(right))
      this.fail(node, `Numeric operands required for "${operator}"`);
    if (['div', 'mod', 'shl', 'shr'].includes(operator)) {
      this.requireType(node.left, INTEGER, left);
      this.requireType(node.right, INTEGER, right);
      const type = this.integerResultType(left, right, operator);
      this.integerHelper(operator, type, node);
      return type;
    }
    if (!['+', '-', '*', '/'].includes(operator))
      this.fail(node, `Unsupported operator "${operator}"`);
    if (operator === '/' || left.kind === 'real' || right.kind === 'real') {
      const line = node.lineNumber ?? this.line;
      // Real uses 48-bit software arithmetic; 8087 code computes at full
      // precision, with an Extended result.
      if (this.coprocessorArithmetic(left, right)) {
        this.helper(`8087-${operator}-${String(line)}`, 2, (a, b) =>
          coprocessorOperation(operator, Number(a), Number(b), line)
        );
        return EXTENDED;
      }
      this.helper(`real-${operator}-${String(line)}`, 2, (a, b) =>
        realOperation(operator, Number(a), Number(b), line)
      );
      return REAL;
    }
    const type = this.integerResultType(left, right, operator);
    this.integerHelper(operator, type, node);
    return type;
  }

  private address(node: Node): PascalType {
    return this.atSource(node, () => this.emitAddress(node));
  }
  private emitAddress(node: Node): PascalType {
    node = this.qualified(node);
    this.line = node.lineNumber ?? this.line;
    if (node.internalVariable) {
      const variable = node.internalVariable as Variable; this.addressVariable(variable); return variable.type;
    }
    if (node.type === NodeType.POINTER_DEREF) {
      const pointer = this.expression(node.pointer as Node);
      if (pointer.kind !== 'pointer' || !pointer.base || pointer.base.kind === 'void')
        this.fail(node, 'Typed pointer required');
      const line = node.lineNumber ?? this.line;
      this.helper(`pointer-check-${String(line)}`, 1, (value) => {
        if (value === null || Number(value) === 0)
          throw new PascalError('Nil pointer dereference', line);
        return value;
      });
      return pointer.base;
    }
    if (node.type === NodeType.IDENTIFIER) {
      const symbol = this.lookup(node.name as string);
      if (symbol?.kind !== 'variable')
        this.fail(
          node,
          symbol
            ? `Variable required: "${String(node.name)}"`
            : `Undeclared variable "${String(node.name)}"`
        );
      this.addressVariable(symbol);
      return symbol.type;
    }
    if (node.type === NodeType.ARRAY_ACCESS) {
      const access = node as ArrayAccessNode;
      // {$X+} indexes a PChar from the character it points at.
      if (this.charPointer(this.expressionType(access.array)) && access.indices.length === 1) {
        if (node.extendedSyntax === false) this.fail(node, 'Array or string expected');
        this.expression(access.array);
        this.requireType(access.indices[0]!, INTEGER, this.expression(access.indices[0]!));
        this.emit(Opcode.ADI);
        return CHAR;
      }
      let type = this.address(access.array);
      if (type.kind === 'string') {
        if (access.indices.length !== 1) this.fail(node, 'A string requires one index');
        // A constant index no string can have is rejected while compiling;
        // one within 0..255 but past this string's length fails when it runs.
        this.checkConstantRange(access.indices[0]!, { ...INTEGER, low: 0, high: 255 });
        this.requireType(access.indices[0]!, INTEGER, this.expression(access.indices[0]!));
        this.stringCapacity(type);
        this.emit(Opcode.CSP, 3, InternalProcedure.STRING_CHARACTER_ADDRESS);
        return CHAR;
      }
      for (const index of access.indices) {
        if (type.kind !== 'array') this.fail(node, 'An array variable is required');
        if (!type.openArray && type.low !== undefined && type.high !== undefined)
          this.checkConstantRange(index, { ...INTEGER, low: type.low, high: type.high });
        const indexType = this.expression(index);
        if (!this.ordinal(indexType)) this.fail(index, 'Array index must be ordinal');
        this.requireType(index, type.index!, indexType);
        if (type.openArray) {
          // Open arrays run from 0 to the High their caller passed.
          const line = node.lineNumber ?? this.line,
            checked = Boolean(node.rangeChecking);
          this.loadVariable(type.openHigh!);
          this.helper(`open-array-index-${String(line)}-${String(checked)}`, 2, (value, high) => {
            const indexValue = Number(value);
            if (!Number.isInteger(indexValue) || (checked && (indexValue < 0 || indexValue > Number(high))))
              throw new PascalError(
                `Array index ${String(indexValue)} out of bounds (0..${String(high)})`,
                line
              );
            return indexValue;
          });
          this.emit(Opcode.IXA, 0, type.element!.size);
          type = type.element!;
          continue;
        }
        const low = type.low!,
          high = type.high!,
          line = node.lineNumber ?? this.line;
        const checked = Boolean(node.rangeChecking);
        this.helper(`array-index-${String(low)}-${String(high)}-${String(line)}-${String(checked)}`, 1, (value) => {
          const indexValue = typeof value === 'string' ? value.charCodeAt(0) : Number(value);
          if (!Number.isInteger(indexValue) || (checked && (indexValue < low || indexValue > high)))
            throw new PascalError(
              `Array index ${String(indexValue)} out of bounds (${String(low)}..${String(high)})`,
              line
            );
          return indexValue - low;
        });
        this.emit(Opcode.IXA, 0, type.element!.size);
        type = type.element!;
      }
      return type;
    }
    if (node.type === NodeType.FIELD_ACCESS) {
      const access = node as FieldAccessNode;
      const type = this.address(access.record);
      const field = type.fields?.get(access.field.toLowerCase());
      if (!field) this.fail(node, `Unknown record field "${access.field}"`);
      if (field.privateOwner && !this.inModule(field.privateOwner)) this.fail(node, `Private object member "${access.field}"`);
      this.literal(field.offset, INTEGER);
      this.emit(Opcode.ADI);
      return field.type;
    }
    const cast = this.untypedCast(node);
    if (cast) {
      this.castAddress(cast);
      return cast.type;
    }
    const record = this.fileRecordCast(node);
    if (record) {
      // FileRec(F) and TextRec(F): a record of the file's state, as DOS and
      // the System unit keep it. Stores into it do not change the file.
      const temp = this.temp(record.type);
      this.address(record.operand);
      this.addressVariable(temp);
      this.literal(JSON.stringify(this.binaryLayout(record.type)), STRING);
      this.emit(Opcode.CSP, 3, 333);
      this.addressVariable(temp);
      return record.type;
    }
    this.fail(node, 'Variable required');
  }
  private checkRange(type: PascalType, node: Node): void {
    if (type.kind === 'real') {
      const line = node.lineNumber ?? this.line;
      if (type.comp) this.helper(`comp-${String(line)}`, 1, (value) => compValue(Number(value), line));
      else if (type.byteSize === 6)
        this.helper(`real48-${String(line)}`, 1, (value) => roundReal48(Number(value), line));
      else if (type.byteSize === 4)
        this.helper(`single-${String(line)}`, 1, (value) => {
          const result = Math.fround(Number(value));
          if (!Number.isFinite(result)) throw new PascalError('Real overflow', line);
          return result;
        });
      return;
    }
    if (type.kind === 'string') {
      if (type.openCapacity) {
        this.stringCapacity(type);
        this.helper('open-string-copy', 2, (value, capacity) => String(value).slice(0, Number(capacity)));
        return;
      }
      const capacity = type.capacity ?? 255;
      this.helper(`shortstring-${String(capacity)}`, 1, (value) =>
        String(value).slice(0, capacity)
      );
      return;
    }
    if (type.kind === 'set') {
      const low = type.low ?? 0,
        high = type.high ?? 255,
        line = node.lineNumber ?? this.line;
      const checked = Boolean(node.rangeChecking);
      this.helper(`set-range-${String(low)}-${String(high)}-${String(line)}-${String(checked)}`, 1, (value) => {
        if (checked && this.decodeSet(value).some((member) => member < low || member > high))
          throw new PascalError('Set element out of range', line);
        return JSON.stringify(this.decodeSet(value).filter(member => member >= low && member <= high));
      });
      return;
    }
    if (type.low === undefined || type.high === undefined) return;
    const low = type.low,
      high = type.high,
      line = node.lineNumber ?? this.line;
    const checked = Boolean(node.rangeChecking), bits = type.byteSize * 8, signed = low < 0;
    // Char and Byte share their range, but not what the check returns.
    this.helper(`range-${type.kind}-${String(low)}-${String(high)}-${String(line)}-${String(checked)}-${String(bits)}`, 1, (value) => {
      const number = typeof value === 'string' ? value.charCodeAt(0) : Number(value);
      if (checked && (number < low || number > high))
        throw new PascalError(`Range check error (${String(low)}..${String(high)})`, line);
      const wrapped = Number(signed ? BigInt.asIntN(bits, BigInt(Math.trunc(number))) : BigInt.asUintN(bits, BigInt(Math.trunc(number))));
      return type.kind === 'char' ? String.fromCharCode(wrapped) : wrapped;
    });
  }

  private stringCapacity(type: PascalType): void {
    if (type.openCapacity) this.loadVariable(type.openCapacity);
    else this.literal(type.capacity ?? 255, INTEGER);
  }

  private lookupRoutine(name: string): Routine | undefined {
    const symbol = this.lookup(name);
    if (symbol?.kind === 'routine') return symbol;
    if (symbol?.kind === 'variable' && symbol.result) {
      for (let scope = this.scope.parent; scope; scope = scope.parent) {
        const routine = scope.symbols.get(name.toLowerCase());
        if (routine?.kind === 'routine') return routine;
      }
    }
    return undefined;
  }
  private call(node: CallNode, expression: boolean): PascalType {
    const previous = this.ioChecking;
    this.ioChecking = node.ioChecking === undefined ? true : Boolean(node.ioChecking);
    try {
      // Arguments a call may change, which lie in variant cases or hold
      // variant records, bring those records up to date afterwards.
      const written = this.writtenArguments(node);
      if (!written.length) return this.compileCall(node, expression);
      const routine = node.receiver ? undefined : this.lookupRoutine(node.name);
      const builtin = !routine && !node.receiver && this.modules.lookupProcedure(node.name) !== undefined;
      // A routine may change an untyped parameter's bytes as a whole, by
      // FillChar or a typecast; so may a standard routine.
      return this.withVariantSyncs(
        written.map((index) => node.arguments[index]!),
        written.map((index) => builtin || routine?.parameters[index]?.type.kind === 'untyped'),
        (targets) => {
          const args = [...node.arguments];
          written.forEach((index, at) => (args[index] = targets[at]!));
          return this.compileCall({ ...node, arguments: args }, expression);
        }
      );
    } finally {
      this.ioChecking = previous;
    }
  }
  private emitRoutineCall(node: CallNode, expression: boolean, routine: Routine, bound?: Variable): PascalType {
      if (expression && routine.type.kind === 'void')
        this.fail(node, 'Procedure cannot be used as an expression');
      if (!expression && routine.type.kind !== 'void' && routine.declaration.routineKind !== 'constructor')
        return this.discardResult(node, routine.type, () => this.emitRoutineCall(node, true, routine, bound));
      if (routine.parameters.length !== node.arguments.length)
        this.fail(
          node,
          `Wrong number of arguments for "${node.name}" (expected ${String(routine.parameters.length)})`
        );
      if (routine.declaration.inlineCode) return this.inlineCall(node, routine);
      this.emit(Opcode.MST, this.scope.level - routine.parent.level);
      let words = 0;
      if (bound) { this.loadVariable(bound); words++; }
      routine.parameters.forEach((parameter, index) => {
        const argument = node.arguments[index]!;
        if (parameter.type.openArray) {
          this.openArrayArgument(argument, parameter);
          words += 2;
        } else if (parameter.type.kind === 'untyped') {
          // Any variable: its address, and the layout of its bytes, which
          // FillChar, Move and typecasts in the routine go by.
          const type = this.address(argument);
          if (!parameter.readOnly) this.requireWritable(argument);
          if (type.kind !== 'untyped') this.literal(this.layoutId(type), INTEGER);
          else if (type.untypedLayout) this.loadVariable(type.untypedLayout);
          else this.literal(-1, INTEGER);
          words += 2;
        } else if (parameter.reference) {
          this.requireType({ ...argument, strictVarStrings: node.strictVarStrings }, parameter.type, this.address(argument), true);
          this.requireWritable(argument);
          words++;
        } else if (this.aggregate(parameter.type)) {
          this.requireType(argument, parameter.type, this.expressionType(argument));
          const source = this.temp(POINTER);
          this.addressVariable(source);
          this.address(argument);
          this.emit(Opcode.STI, TypeCode.A);
          for (let cell = 0; cell < parameter.type.size; cell++) {
            this.loadVariable(source);
            this.literal(cell, INTEGER);
            this.emit(Opcode.ADI);
            this.emit(Opcode.CSP, 1, InternalProcedure.LOAD_AGGREGATE_CELL);
            words++;
          }
        } else {
          const text = this.charPointer(parameter.type) ? this.textConstant(argument) : undefined;
          if (text !== undefined) this.emitStaticText(text, argument);
          else if (this.charPointer(parameter.type) && this.emitCharArrayPointer(argument)) {
            // passed as a pointer to its first character
          } else {
            this.requireType(argument, parameter.type, parameter.type.procedureSignature ? this.proceduralValue(argument) : this.expression(argument));
            this.checkRange(parameter.type, argument);
          }
          words++;
        }
        if (parameter.type.openString) {
          this.stringCapacity(this.expressionType(argument));
          words++;
        }
      });
      const address = this.emit(Opcode.CUP, words, routine.address ?? 0);
      if (routine.address === undefined) routine.patches.push(address);
      return routine.type;
  }

  /** A function called as a statement, which {$X+} allows: the result is
   * stored where nothing reads it. */
  private discardResult(node: CallNode, type: PascalType, call: () => PascalType): PascalType {
    if (node.extendedSyntax === false) this.fail(node, 'Function result must be used');
    const sink = this.temp(type);
    this.addressVariable(sink);
    call();
    this.emit(Opcode.STI, this.typeCode(type));
    return VOID;
  }
  /** An open array argument: the array's address, then its High. Any
   * one-dimensional array of the element type fits, whatever its bounds. */
  private openArrayArgument(argument: Node, parameter: Parameter): void {
    const type = this.address(argument);
    const element = parameter.type.element!;
    if (type.kind !== 'array' || !type.element || !this.compatible(element, type.element, true))
      this.fail(argument, 'Type mismatch: open array argument must be an array of its element type');
    if (parameter.reference && !parameter.readOnly) this.requireWritable(argument);
    if (type.openHigh) this.loadVariable(type.openHigh);
    else this.literal((type.high ?? 0) - (type.low ?? 0), INTEGER);
  }
  /** The end of a program. While ExitProc holds a procedure, it is cleared
   * and that procedure called, so each exit procedure can chain to the one it
   * replaced; Halt and run-time errors come here too. */
  private exitChain(block: Node): void {
    const chain = this.bytecode.getNextAddress();
    for (const jump of this.haltJumps) this.patch(jump, chain);
    this.bytecode.exitChain = chain;
    const exitProc = this.standardVariable('ExitProc');
    const signature: PascalType = { ...POINTER, procedureSignature: { parameters: [], result: VOID } };
    const held = this.temp(signature);
    this.emit(Opcode.LDA, 0, exitProc);
    this.emit(Opcode.LDI, TypeCode.A);
    this.literal(0, POINTER);
    this.emit(Opcode.NEQ, TypeCode.A);
    const done = this.emit(Opcode.FJP);
    this.addressVariable(held);
    this.emit(Opcode.LDA, 0, exitProc);
    this.emit(Opcode.LDI, TypeCode.A);
    this.emit(Opcode.STI, TypeCode.A);
    this.emit(Opcode.LDA, 0, exitProc);
    this.literal(0, POINTER);
    this.emit(Opcode.STI, TypeCode.A);
    const target = { type: NodeType.IDENTIFIER, name: 'ExitProc', internalVariable: held } as Node;
    const call = { type: NodeType.CALL, name: 'ExitProc', arguments: [], lineNumber: block.endLineNumber } as CallNode;
    this.proceduralCall(call, false, { node: target, type: signature });
    this.emit(Opcode.UJP, 0, chain);
    this.patch(done);
  }
  /** Assembly the P-machine does not run goes to the native compiler. */
  private unsupportedAssembly(reason: string): never {
    throw new NativePascalRequired(this.sourceFile ?? this.programName, `${reason} requires the native DOS compiler`);
  }
  /** The function result the current routine returns, if any. */
  private resultVariable(): Variable | undefined {
    for (const symbol of this.scope.symbols.values()) if (symbol.kind === 'variable' && symbol.result) return symbol;
    return undefined;
  }
  /** The byte offset of a cell within a type, in Turbo Pascal's layout. */
  private byteOffset(type: PascalType, cellOffset: number): number {
    return this.cells(type).filter((cell) => cell.offset < cellOffset).reduce((sum, cell) => sum + cell.type.byteSize, 0);
  }
  /** A name in an asm statement: a variable, with any fields after it, a
   * constant, or a record type's field offset. */
  private assemblyName(path: string[], line: number, pointers: Map<Variable, Variable>, assembler: boolean): AsmName | undefined {
    const at = { type: NodeType.IDENTIFIER, lineNumber: line } as Node;
    const fields = (type: PascalType, names: string[]): { type: PascalType; offset: number } => {
      let offset = 0;
      for (const name of names) {
        const field = type.kind === 'record' ? type.fields?.get(name.toLowerCase()) : undefined;
        if (!field) this.fail(at, `Unknown record field "${name}"`);
        offset += field.byteOffset ?? this.byteOffset(type, field.offset);
        type = field.type;
      }
      return { type, offset };
    };
    const first = path[0]!;
    const symbol = first.toLowerCase() === '@result' ? this.resultVariable() : this.lookup(first);
    if (!symbol) {
      if (first.toLowerCase() === '@result') this.fail(at, '@Result is only valid in a function');
      return undefined;
    }
    if (symbol.kind === 'constant') {
      if (path.length > 1) this.fail(at, 'Invalid assembler operand');
      const value = symbol.value;
      if (typeof value === 'number' && Number.isInteger(value)) return { kind: 'constant', value };
      if (typeof value === 'boolean') return { kind: 'constant', value: value ? 1 : 0 };
      if (typeof value === 'string' && value.length === 1) return { kind: 'constant', value: value.charCodeAt(0) };
      return this.fail(at, 'Integer constant expected');
    }
    if (symbol.kind === 'type') {
      const { type, offset } = fields(symbol.type, path.slice(1));
      return { kind: 'type', size: type.byteSize, offset };
    }
    if (symbol.kind === 'routine') return this.unsupportedAssembly('Naming a routine in assembler');
    if (symbol.container) return this.unsupportedAssembly('Fields reached through WITH or Self in assembler');
    if (symbol.type.openArray || symbol.type.openString) return this.unsupportedAssembly('Open parameters in assembler');
    const { type, offset } = fields(symbol.type, path.slice(1));
    // A var parameter holds its variable's address, as it does on the 8086
    // stack. So does a large value parameter of an assembler routine, which
    // Turbo Pascal does not copy.
    const indirect = symbol.reference || (assembler && symbol.parameter === true && symbol.type.byteSize > 4);
    if (indirect) {
      let key = symbol;
      if (!symbol.reference) {
        key = pointers.get(symbol) ?? this.temp(POINTER);
        pointers.set(symbol, key);
      }
      const target = symbol.type.kind === 'untyped' ? undefined : this.binaryLayout(symbol.type);
      return {
        kind: 'variable',
        key,
        variable: { name: symbol.name, layout: [{ kind: 'pointer', bytes: 4 }], pointer: true, ...(target ? { target } : {}) },
        displacement: offset,
        size: type.byteSize,
      };
    }
    const variable: AsmVariable = { name: symbol.name, layout: this.binaryLayout(symbol.type) };
    if (symbol.type.kind === 'pointer' && symbol.type.base) variable.target = this.binaryLayout(symbol.type.base);
    // An array's operand size is its element's, as the built-in assembler has it.
    let sized = type;
    while (sized.kind === 'array' && sized.element) sized = sized.element;
    return { kind: 'variable', key: symbol, variable, displacement: offset, size: sized.byteSize };
  }
  /** asm ... end: the block runs on the machine's 8086, over the cells of
   * the variables it names, whose addresses are its arguments. */
  private assemblyStatement(node: Node): void {
    const assembler = node.assembler === true;
    const line = node.lineNumber ?? this.line;
    const raw = node.instructions as RawInstruction[];
    const pointers = new Map<Variable, Variable>();
    const { block, keys } = assemble(raw, {
      resolve: (path, at) => this.assemblyName(path, at, pointers, assembler),
      unsupported: (reason) => this.unsupportedAssembly(reason),
    }, line);
    const result = assembler ? this.resultVariable() : undefined;
    if (result) {
      const type = result.type;
      const kind = type.kind === 'char' ? 'char' : type.kind === 'boolean' ? 'boolean' : type.kind === 'pointer' ? 'pointer' : 'integer';
      if (!['integer', 'char', 'boolean', 'pointer'].includes(type.kind) || ![1, 2, 4].includes(type.byteSize))
        this.unsupportedAssembly('An assembler function of this result type');
      block.result = { size: type.byteSize as 1 | 2 | 4, kind, signed: (type.low ?? 0) < 0 };
      this.emit(Opcode.LDA, 0, result.offset);
    }
    for (const [parameter, pointer] of pointers) {
      this.emit(Opcode.LDA, 0, pointer.offset);
      this.emit(Opcode.LDA, this.scope.level - parameter.scope.level, parameter.offset);
      this.emit(Opcode.STI, TypeCode.A);
    }
    this.emitAssembly(block, keys as Variable[]);
    if (result) this.emit(Opcode.STI, this.typeCode(result.type));
    // The block may have changed a variant record's bytes.
    for (const variable of keys as Variable[]) this.emitVariantRefresh({ variable }, variable.type);
  }
  /** inline(...): its elements' bytes, decoded into the 8086's
   * instructions. A variable's name stands for its address. */
  private inlineBlock(node: Node, variables: Variable[]): AsmBlock {
    const line = node.lineNumber ?? this.line;
    const layouts: AsmVariable[] = [];
    const pointers = new Map<Variable, Variable>();
    const bytes: InlineByte[] = [];
    type Part = { negative: boolean; value?: number; name?: string; location?: boolean };
    for (const element of node.elements as { size?: 1 | 2; parts: Part[] }[]) {
      let value = 0;
      let reference: { index: number; displacement: number } | undefined;
      for (const part of element.parts) {
        const sign = part.negative ? -1 : 1;
        if (part.value !== undefined) value += sign * part.value;
        else if (part.location) value += sign * bytes.length;
        else {
          const name = this.assemblyName(part.name!.split('.'), line, pointers, false);
          if (!name) this.fail(node, `Unknown identifier "${part.name!}"`);
          if (name.kind === 'constant') value += sign * name.value;
          else if (name.kind === 'type') value += sign * name.offset;
          else {
            if (reference || part.negative) this.fail(node, 'Invalid inline element');
            let index = variables.indexOf(name.key as Variable);
            if (index < 0) {
              index = variables.push(name.key as Variable) - 1;
              layouts.push(name.variable);
            }
            reference = { index, displacement: name.displacement };
          }
        }
      }
      const size = element.size ?? (reference || value < 0 || value > 255 ? 2 : 1);
      bytes.push({ value: value & 0xff, ...(reference ? { variable: reference.index, displacement: reference.displacement + value } : {}) });
      if (size === 2) bytes.push({ value: (value >> 8) & 0xff });
    }
    const instructions = decodeInline(bytes, line, (reason) => this.unsupportedAssembly(reason));
    return { instructions, variables: layouts, line };
  }
  /** A call to an inline routine runs its code in place, with the
   * arguments pushed on the stack for the code to take. */
  private inlineCall(node: CallNode, routine: Routine): PascalType {
    const sizes: (1 | 2 | 4)[] = [];
    routine.parameters.forEach((parameter, index) => {
      const type = parameter.type;
      if (parameter.reference || !['integer', 'char', 'boolean', 'pointer'].includes(type.kind) || ![1, 2, 4].includes(type.byteSize))
        this.unsupportedAssembly('This parameter of an inline routine');
      const argument = node.arguments[index]!;
      this.requireType(argument, type, this.expression(argument));
      sizes.push(type.byteSize as 1 | 2 | 4);
    });
    const variables: Variable[] = [];
    const block = this.inlineBlock(routine.declaration.inlineCode as Node, variables);
    if (variables.length) this.unsupportedAssembly('Variables named in an inline routine');
    block.stackArguments = sizes;
    const type = routine.type;
    if (type.kind !== 'void') {
      if (!['integer', 'char', 'boolean', 'pointer'].includes(type.kind) || ![1, 2, 4].includes(type.byteSize))
        this.unsupportedAssembly('An inline function of this result type');
      block.result = {
        size: type.byteSize as 1 | 2 | 4,
        kind: type.kind === 'char' ? 'char' : type.kind === 'boolean' ? 'boolean' : type.kind === 'pointer' ? 'pointer' : 'integer',
        signed: (type.low ?? 0) < 0,
      };
    }
    const index = this.bytecode.assembly.push(block) - 1;
    this.literal(index, INTEGER);
    this.emit(Opcode.CSP, sizes.length + 1, InternalProcedure.ASSEMBLY);
    return type;
  }
  private emitAssembly(block: AsmBlock, variables: (Variable | { node: Node })[]): void {
    const index = this.bytecode.assembly.push(block) - 1;
    for (const variable of variables) {
      if ('node' in variable) this.address(variable.node);
      else if (variable.view) this.addressVariable(variable);
      else this.emit(Opcode.LDA, this.scope.level - variable.scope.level, variable.offset);
    }
    this.literal(index, INTEGER);
    this.emit(Opcode.CSP, variables.length + 1, InternalProcedure.ASSEMBLY);
  }
  /** Intr and MsDos: the registers come from Regs, the interrupt runs on
   * the machine's 8086, and Regs gets the registers and flags back. */
  private interruptCall(node: CallNode, builtin: BuiltinDef): PascalType {
    const args = node.arguments;
    if (args.length !== builtin.params.length) this.fail(node, `Wrong number of arguments for "${builtin.name}"`);
    const regs = args.at(-1)!;
    this.requireWritable(regs);
    const type = this.expressionType(regs);
    if (type !== this.unitType('dos', 'Registers')) this.fail(regs, 'Type mismatch: Registers expected');
    const line = node.lineNumber ?? this.line;
    const keys: (Variable | { node: Node })[] = [{ node: regs }];
    const variables: AsmVariable[] = [{ name: 'Regs', layout: this.binaryLayout(type) }];
    let number: Operand = { kind: 'immediate', value: 0x21 };
    if (args.length === 2) {
      const intNo = args[0]!;
      if (this.numericConstant(intNo)) number = { kind: 'immediate', value: Number(this.constant(intNo).value) & 0xff };
      else {
        const temp = this.temp(BYTE);
        this.addressVariable(temp);
        this.requireType(intNo, INTEGER, this.expression(intNo));
        this.emit(Opcode.STI, TypeCode.I);
        keys.push(temp);
        variables.push({ name: 'IntNo', layout: [this.binaryCell(BYTE)] });
        number = { kind: 'memory', size: 1, variable: 1, registers: [], displacement: 0 };
      }
    }
    const words = ['ax', 'bx', 'cx', 'dx', 'bp', 'si', 'di', 'ds', 'es'] as const;
    const field = (index: number): Operand => ({ kind: 'memory', size: 2, variable: 0, registers: [], displacement: index * 2 });
    const instructions: AsmBlock['instructions'] = [
      ...words.map((register, index) => ({ mnemonic: 'mov', operands: [{ kind: 'register', register } as Operand, field(index)], line })),
      { mnemonic: 'int', operands: [number], line },
      { mnemonic: 'pushf', operands: [], line },
      { mnemonic: 'pop', operands: [field(9)], line },
      ...words.map((register, index) => ({ mnemonic: 'mov', operands: [field(index), { kind: 'register', register } as Operand], line })),
    ];
    this.emitAssembly({ instructions, variables, line }, keys);
    return VOID;
  }
  /** A System or standard-unit variable, in its fixed cell. */
  private declareStandard(standard: StandardVariable): void {
    const types = { word: WORD, longint: LONGINT, integer: INTEGER, byte: BYTE, boolean: BOOLEAN, pointer: POINTER, text: TEXTFILE };
    const symbol = this.standardSymbol(standard.name, types[standard.kind]), unit = standard.unit ?? 'system';
    this.scope.symbols.set(standard.name.toLowerCase(), symbol);
    if (!this.standardSymbols.has(unit)) this.standardSymbols.set(unit, new Map());
    this.standardSymbols.get(unit)!.set(standard.name.toLowerCase(), symbol);
  }
  private standardSymbol(name: string, type: PascalType): Variable {
    let root = this.scope;
    while (root.parent) root = root.parent;
    return { kind: 'variable', name, type, offset: this.standardVariable(name), scope: root, reference: false };
  }
  /** Lst: output to the printer, which is the file LPT1 on the virtual drive. */
  private printerFile(): Variable {
    return this.standardSymbol('Lst', TEXTFILE);
  }
  /** The address of one of the System unit's own variables. */
  private standardVariable(name: string): number {
    return MARK_SIZE + STANDARD_VARIABLES.findIndex((standard) => standard.name === name);
  }
  /** The routine @P names, when P is a procedure or function rather than a
   * variable. */
  private routineAddress(node: Node): Routine | undefined {
    const resolved = this.qualified(node);
    if (resolved.type !== NodeType.IDENTIFIER) return undefined;
    const symbol = this.lookup(String(resolved.name));
    return symbol?.kind === 'routine' ? symbol : undefined;
  }
  /** T(x) for an untyped parameter x: the bytes its caller passed, seen as
   * a T, however large, as TByteArray(x) is. */
  private castAddress(cast: { type: PascalType; operand: Node }): void {
    const operand = this.qualified(cast.operand);
    const source = operand.type === NodeType.IDENTIFIER ? this.lookup(String(operand.name)) : undefined;
    if (source?.kind !== 'variable') {
      this.address(cast.operand);
      return;
    }
    this.emitView(() => { this.address(cast.operand); }, () => { this.emitLayoutOf(source); }, cast.type, 0, -1, []);
  }
  /** FileRec(F) or TextRec(F) of a file variable. */
  private fileRecordCast(node: Node): { type: PascalType; operand: Node } | undefined {
    if (node.type !== NodeType.CALL) return undefined;
    const { name, arguments: [operand, ...rest] } = node as CallNode;
    const target = this.lookup(name);
    if (!operand || rest.length || target?.kind !== 'type') return undefined;
    if (target.type !== this.unitType('dos', 'FileRec') && target.type !== this.unitType('dos', 'TextRec')) return undefined;
    return this.expressionType(operand).kind === 'file' ? { type: target.type, operand } : undefined;
  }
  /** A typecast T(x) of an untyped parameter x, which gives it a type. */
  private untypedCast(node: Node): { type: PascalType; operand: Node } | undefined {
    if (node.type !== NodeType.CALL) return undefined;
    const { name, arguments: [operand, ...rest] } = node as CallNode;
    const target = this.lookup(name);
    if (!operand || rest.length || target?.kind !== 'type') return undefined;
    return this.expressionType(operand).kind === 'untyped' ? { type: target.type, operand } : undefined;
  }
  /** A const parameter cannot be assigned, or passed where it could change.
   * Writing through a pointer it holds is allowed. */
  private requireWritable(node: Node): void {
    node = this.qualified(node);
    if (node.type === NodeType.IDENTIFIER) {
      const symbol = this.lookup(String(node.name));
      if (symbol?.kind === 'variable' && symbol.readOnly)
        this.fail(node, `Constant parameter "${String(node.name)}" cannot be modified`);
    } else if (node.type === NodeType.ARRAY_ACCESS) this.requireWritable((node as ArrayAccessNode).array);
    else if (node.type === NodeType.FIELD_ACCESS) this.requireWritable((node as FieldAccessNode).record);
    else if (node.type === NodeType.CALL && (node as CallNode).arguments.length === 1)
      this.requireWritable((node as CallNode).arguments[0]!);
  }

  private proceduralValue(node: Node): PascalType {
    node = this.qualified(node);
    if (node.type === NodeType.IDENTIFIER) {
      const symbol = this.lookup(String(node.name));
      if (symbol?.kind === 'routine') {
        if (symbol.parent.level !== 0 || symbol.methodOwner) this.fail(node, 'Procedural values require a non-nested procedure or function');
        if (!symbol.declaration.farCalls) this.fail(node, 'Procedural values require a FAR procedure or function');
        const type = this.proceduralType(symbol); this.literal(symbol.proceduralId, type); return type;
      }
    }
    const type = this.expressionType(node, true);
    if (type.procedureSignature) { this.address(node); this.emit(Opcode.LDI, TypeCode.A); return type; }
    return this.expression(node);
  }
  private proceduralTarget(node: CallNode): { node: Node; type: PascalType } | undefined {
    if (node.callee) {
      const type = this.expressionType(node.callee, true);
      if (!type.procedureSignature) this.fail(node, 'Procedural variable required');
      return { node: node.callee, type };
    }
    if (node.receiver) {
      const receiver = this.expressionType(node.receiver, true);
      const field = receiver.fields?.get(node.name.toLowerCase());
      if (field?.type.procedureSignature) return { node: { ...node, type: NodeType.FIELD_ACCESS, record: node.receiver, field: node.name }, type: field.type };
      return undefined;
    }
    const symbol = this.lookup(node.name);
    if (symbol?.kind === 'variable' && symbol.type.procedureSignature)
      return { node: { ...node, type: NodeType.IDENTIFIER, name: node.name }, type: symbol.type };
    return undefined;
  }
  private proceduralCall(node: CallNode, expression: boolean, target: { node: Node; type: PascalType }): PascalType {
    const signature = target.type.procedureSignature!;
    if (expression && signature.result.kind === 'void') this.fail(node, 'Procedure cannot be used as an expression');
    if (!expression && signature.result.kind !== 'void')
      return this.discardResult(node, signature.result, () => this.proceduralCall(node, true, target));
    if (node.arguments.length !== signature.parameters.length) this.fail(node, 'Wrong number of procedural arguments');
    const value = this.temp(POINTER);
    this.addressVariable(value); this.proceduralValue(target.node); this.emit(Opcode.STI, TypeCode.A);
    const exits: number[] = [];
    for (const routine of this.routineValues.filter(routine => routine.parent.level === 0 && !routine.methodOwner && this.proceduralCompatible(target.type, this.proceduralType(routine)))) {
      this.loadVariable(value); this.literal(routine.proceduralId, INTEGER); this.emit(Opcode.EQU, TypeCode.I);
      const next = this.emit(Opcode.FJP);
      this.emitRoutineCall(node, expression, routine);
      exits.push(this.emit(Opcode.UJP)); this.patch(next);
    }
    const line = node.lineNumber ?? this.line;
    this.helper(`nil-procedural-call-${String(line)}`, 0, () => { throw new PascalError('Nil or invalid procedural variable', line); });
    for (const exit of exits) this.patch(exit);
    return signature.result;
  }

  private methodTarget(node: CallNode): { routine: Routine; receiver: Node; type: PascalType } | undefined {
    if (!node.receiver && !node.inherited) {
      for (const record of [...this.scope.withRecords].reverse()) {
        const routine = record.type.object?.methods.get(node.name.toLowerCase());
        if (routine) {
          if (routine.privateOwner && !this.inModule(routine.privateOwner)) this.fail(node, `Private object method "${node.name}"`);
          return { routine, type: record.type, receiver: { type: NodeType.POINTER_DEREF,
            pointer: { type: NodeType.IDENTIFIER, internalVariable: { ...record.pointer, type: { ...POINTER, base: record.type } } } } };
        }
      }
    }
    if (node.receiver) {
      const type = this.expressionType(node.receiver);
      const target = this.qualified(node.receiver);
      if (target.type === NodeType.IDENTIFIER && this.lookup(String(target.name))?.kind === 'type') {
        for (let scope: Scope | null = this.scope; scope; scope = scope.parent) {
          if (scope.methodOwner && scope.self && this.descendsFrom(scope.methodOwner, type)) {
            const routine = type.object?.methods.get(node.name.toLowerCase());
            if (!routine) this.fail(node, `Unknown object method "${node.name}"`);
            if (routine.privateOwner && !this.inModule(routine.privateOwner)) this.fail(node, `Private object method "${node.name}"`);
            node.inherited = true;
            return { routine, type, receiver: { type: NodeType.IDENTIFIER, internalVariable: scope.self } };
          }
        }
        this.fail(node, 'Qualified method calls require Self of the same object or a descendant');
      }
      const routine = type.object?.methods.get(node.name.toLowerCase());
      if (!routine) this.fail(node, `Unknown object method "${node.name}"`);
      if (routine.privateOwner && !this.inModule(routine.privateOwner)) this.fail(node, `Private object method "${node.name}"`);
      return { routine, receiver: node.receiver, type };
    }
    for (let scope: Scope | null = this.scope; scope; scope = scope.parent) {
      if (scope.methodOwner && scope.self) {
        const type = node.inherited ? scope.methodOwner.object?.ancestor : scope.methodOwner;
        const routine = type?.object?.methods.get(node.name.toLowerCase());
        if (routine && type) return { routine, type, receiver: { type: NodeType.IDENTIFIER, name: 'Self', internalVariable: scope.self } };
      }
      const shadow = scope.symbols.get(node.name.toLowerCase());
      if (shadow && !(shadow.kind === 'variable' && shadow.result) && !node.inherited) return undefined;
    }
    if (node.inherited) this.fail(node, 'Inherited method not found');
    return undefined;
  }
  private methodCall(node: CallNode, expression: boolean, method: { routine: Routine; receiver: Node; type: PascalType }): PascalType {
    const bound = this.temp({ ...POINTER, base: method.type });
    this.addressVariable(bound); this.address(method.receiver); this.emit(Opcode.STI, TypeCode.A);
    if (method.routine.declaration.routineKind === 'constructor' && !node.inherited) {
      this.loadVariable(bound); this.literal(method.type.object!.id, INTEGER); this.emit(Opcode.STI, TypeCode.I);
    }
    if (!method.routine.virtual || node.inherited) {
      const result = this.emitRoutineCall(node, expression, method.routine, bound);
      if (!expression && method.routine.declaration.routineKind === 'constructor') this.helper('discard-constructor-result', 1, () => undefined);
      return result;
    }
    const exits: number[] = [];
    for (const type of this.objectTypes.filter(type => this.descendsFrom(type, method.type))) {
      this.loadVariable(bound); this.emit(Opcode.LDI, TypeCode.I);
      this.literal(type.object!.id, INTEGER); this.emit(Opcode.EQU, TypeCode.I);
      const next = this.emit(Opcode.FJP);
      this.emitRoutineCall(node, expression, type.object!.methods.get(node.name.toLowerCase())!, bound);
      exits.push(this.emit(Opcode.UJP)); this.patch(next);
    }
    const line = node.lineNumber ?? this.line;
    this.helper(`uninitialized-object-${String(line)}`, 0, () => { throw new PascalError('Object not initialized', line); });
    for (const exit of exits) this.patch(exit);
    return method.routine.type;
  }

  private compileCall(node: CallNode, expression: boolean): PascalType {
    if (node.name.toLowerCase() === 'assigned' && !node.receiver) {
      if (!expression || node.arguments.length !== 1) this.fail(node, 'Assigned requires one pointer or procedural value');
      const type = this.expressionType(node.arguments[0]!, true);
      if (type.kind !== 'pointer') this.fail(node, 'Assigned requires a pointer or procedural value');
      if (type.procedureSignature) this.proceduralValue(node.arguments[0]!); else this.expression(node.arguments[0]!);
      this.literal(0, INTEGER); this.emit(Opcode.NEQ, TypeCode.A); return BOOLEAN;
    }
    if (node.name.toLowerCase() === 'fail' && !node.receiver) {
      if (expression || node.arguments.length || !this.scope.constructorBody) this.fail(node, 'Fail is only valid inside a constructor');
      this.emit(Opcode.LDA, 0, 0); this.literal(false, BOOLEAN); this.emit(Opcode.STI, TypeCode.B);
      this.scope.exits.push(this.emit(Opcode.UJP));
      return VOID;
    }
    if (node.receiver) {
      const qualified = this.qualified({ type: NodeType.FIELD_ACCESS, record: node.receiver, field: node.name, lineNumber: node.lineNumber });
      if (qualified.type === NodeType.IDENTIFIER) return this.compileCall({ ...node, receiver: undefined, name: String(qualified.name) }, expression);
    }
    const callable = this.proceduralTarget(node);
    if (callable) return this.proceduralCall(node, expression, callable);
    const method = this.methodTarget(node);
    if (method) return this.methodCall(node, expression, method);
    const routine = this.lookupRoutine(node.name);
    if (routine) return this.emitRoutineCall(node, expression, routine);
    const shadow = this.lookup(node.name);
    const cast = expression ? this.untypedCast(node) : undefined;
    if (cast) {
      if (this.aggregate(cast.type))
        this.fail(node, 'Array or record value requires an assignment or matching parameter');
      this.castAddress(cast);
      this.emit(Opcode.LDI, this.typeCode(cast.type));
      return cast.type;
    }
    if (shadow?.kind === 'type') {
      if (!expression || node.arguments.length !== 1)
        this.fail(node, 'Typecast requires one value');
      const target = shadow.type,
        source = this.expression(node.arguments[0]!);
      // A pointer typecast keeps the address and changes what it points to.
      if (target.kind === 'pointer' && source.kind === 'pointer') return target;
      if (!this.ordinal(target) || !this.ordinal(source))
        this.fail(node, 'Ordinal typecast required');
      const bits = target.byteSize * 8,
        signed = (target.low ?? 0) < 0;
      this.helper(`cast-${target.kind}-${String(bits)}-${String(signed)}`, 1, (value) => {
        const number = BigInt(this.ordinalValue(value as Value));
        const result = Number(signed ? BigInt.asIntN(bits, number) : BigInt.asUintN(bits, number));
        return target.kind === 'char'
          ? String.fromCharCode(result)
          : target.kind === 'boolean'
            ? result
              ? 1
              : 0
            : result;
      });
      return target;
    }
    if (shadow) this.fail(node, `"${node.name}" is not a procedure or function`);
    const found = this.modules.lookupProcedure(node.name);
    if (!found) this.fail(node, `Undeclared procedure or function "${node.name}"`);
    // Extended syntax covers unit functions such as ReadKey, but not System's.
    if (!expression && found.proc.isFunction && found.unit === SYSTEM_UNIT)
      this.fail(node, 'Function result must be used');
    return this.builtin(node, found.proc, expression);
  }

  private builtinReturn(builtin: BuiltinDef, arguments_: Node[]): PascalType {
    const name = builtin.name.toLowerCase();
    if ((name === 'high' || name === 'low') && arguments_[0]) {
      const type = this.expressionType(arguments_[0]);
      return type.kind === 'array' ? type.index! : type.kind === 'string' ? INTEGER : type;
    }
    if (['abs', 'sqr', 'succ', 'pred'].includes(name) && arguments_[0]) {
      const type = this.expressionType(arguments_[0]);
      if (!['abs', 'sqr'].includes(name)) return type;
      if (type.kind === 'integer') return this.promoteInteger(type);
      return type.kind === 'real' && this.coprocessorMode() ? EXTENDED : type;
    }
    if (name === 'random' && arguments_.length === 0) return this.realResult();
    if (name === 'memavail' || name === 'maxavail') return LONGINT;
    // The Strings unit's pointers are PChars, which {$X+} can index and move.
    if (builtin.procedureIndex >= 350 && builtin.procedureIndex <= 370 && builtin.returnType === TypeKind.POINTER)
      return { ...POINTER, base: CHAR };
    if (name === 'hi' || name === 'lo') return BYTE;
    if (name === 'swap' && arguments_[0]) return this.promoteInteger(this.expressionType(arguments_[0]));
    if (['trunc', 'round', 'filepos', 'filesize'].includes(name)) return LONGINT;
    const types: Partial<Record<TypeKind, PascalType>> = {
      [TypeKind.INTEGER]: INTEGER,
      [TypeKind.REAL]: this.realResult(),
      [TypeKind.BOOLEAN]: BOOLEAN,
      [TypeKind.CHAR]: CHAR,
      [TypeKind.STRING]: STRING,
      [TypeKind.POINTER]: POINTER,
    };
    return builtin.isFunction ? (types[builtin.returnType!] ?? INTEGER) : VOID;
  }
  private builtin(node: CallNode, builtin: BuiltinDef, expression: boolean): PascalType {
    // System.WriteLn is WriteLn.
    const name = node.name.toLowerCase().replace(/^.*\./, ''),
      args = node.arguments;
    if (expression && !builtin.isFunction && builtin.name.toLowerCase() !== 'new')
      this.fail(node, 'Procedure cannot be used as an expression');
    if (!expression && builtin.isFunction)
      return this.discardResult(node, this.builtinReturn(builtin, args), () => this.builtin(node, builtin, true));
    if (name === 'new' || name === 'dispose') {
      if (args.length < 1 || args.length > 2) this.fail(node, `Wrong number of arguments for "${node.name}"`);
      let pointerNode = args[0]!;
      const type = this.expressionType(pointerNode);
      const pointerType = pointerNode.type === NodeType.IDENTIFIER && this.lookup(String(pointerNode.name));
      if (expression && name === 'new' && pointerType && pointerType.kind === 'type') {
        const result = this.temp(type);
        pointerNode = { ...pointerNode, internalVariable: result };
      } else if (expression) this.fail(node, 'New function requires a pointer type');
      if (type.kind !== 'pointer' || !type.base || type.base.kind === 'void') this.fail(node, 'Typed pointer variable required');
      const methodNode = args[1];
      let methodCall: CallNode | undefined;
      if (methodNode) {
        if (!type.base.object || ![NodeType.IDENTIFIER, NodeType.CALL].includes(methodNode.type)) this.fail(methodNode, 'Object constructor or destructor expected');
        const method = type.base.object.methods.get(String(methodNode.name).toLowerCase());
        if (!method || method.declaration.routineKind !== (name === 'new' ? 'constructor' : 'destructor'))
          this.fail(methodNode, name === 'new' ? 'Constructor expected' : 'Destructor expected');
        methodCall = { ...methodNode, type: NodeType.CALL, name: String(methodNode.name),
          arguments: methodNode.type === NodeType.CALL ? (methodNode as CallNode).arguments : [],
          receiver: { type: NodeType.POINTER_DEREF, pointer: pointerNode } };
      }
      if (name === 'dispose' && methodCall) this.call(methodCall, false);
      this.address(pointerNode);
      if (name === 'new') {
        this.literal(type.base.size, INTEGER);
        this.literal(JSON.stringify(this.defaults(type.base)), STRING);
      }
      this.emit(Opcode.CSP, name === 'new' ? 3 : 1, builtin.procedureIndex);
      if (name === 'new' && methodCall) {
        this.call(methodCall, true);
        const failed = this.emit(Opcode.FJP), done = this.emit(Opcode.UJP);
        this.patch(failed);
        this.address(pointerNode); this.emit(Opcode.CSP, 1, this.modules.lookupProcedure('dispose')!.proc.procedureIndex);
        this.patch(done);
      }
      if (expression) { this.expression(pointerNode); return type; }
      return VOID;
    }
    if (name === 'assigned' && args.length === 1 && this.expressionType(args[0]!, true).procedureSignature) {
      this.proceduralValue(args[0]!); this.literal(0, INTEGER); this.emit(Opcode.NEQ, TypeCode.A); return BOOLEAN;
    }
    const required = builtin.variadic
      ? (builtin.minArgs ?? 0)
      : builtin.params.filter((param) => !param.optional).length;
    if (args.length < required || (!builtin.variadic && args.length > builtin.params.length))
      this.fail(node, `Wrong number of arguments for "${node.name}"`);
    if (name === 'sizeof') {
      const type = this.expressionType(args[0]!);
      if (type.openHigh) {
        this.loadVariable(type.openHigh);
        this.literal(1, INTEGER);
        this.emit(Opcode.ADI);
        this.literal(type.element!.byteSize, INTEGER);
        this.emit(Opcode.MPI);
      } else if (type.openCapacity) { this.stringCapacity(type); this.literal(1, INTEGER); this.emit(Opcode.ADI); }
      else this.literal(type.byteSize, INTEGER);
      return INTEGER;
    }
    if (name === 'high' || name === 'low') {
      const type = this.expressionType(args[0]!);
      if (type.openHigh) {
        if (name === 'high') this.loadVariable(type.openHigh);
        else this.literal(0, INTEGER);
        return INTEGER;
      }
      if (type.kind === 'string') {
        if (name === 'high') this.stringCapacity(type); else this.literal(0, INTEGER);
        return INTEGER;
      }
      const result = type.kind === 'array' ? type.index! : type;
      const value = name === 'high' ? type.high : type.low;
      if (!this.ordinal(result) || value === undefined) this.fail(node, 'Ordinal, array or string type expected');
      this.literal(result.kind === 'char' ? String.fromCharCode(value) : value, result);
      return result;
    }
    if (['delete', 'insert', 'str', 'val'].includes(name))
      return this.stringMutation(node, builtin);
    if (name === 'fillchar' || name === 'move') {
      // They change bytes, so the runtime needs each variable's byte layout:
      // its type's, or an untyped parameter's caller's.
      const layout = (argument: Node): (() => void) => {
        const type = this.expressionType(argument);
        if (type.openArray) this.fail(argument, `${builtin.name} needs a variable whose type is known here`);
        if (type.kind === 'untyped') {
          const operand = this.qualified(argument);
          const source = operand.type === NodeType.IDENTIFIER ? this.lookup(String(operand.name)) : undefined;
          if (source?.kind !== 'variable') this.fail(argument, `${builtin.name} needs a variable whose type is known here`);
          return () => { this.emitLayoutOf(source); };
        }
        const text = JSON.stringify(this.binaryLayout(type));
        return () => { this.literal(text, STRING); };
      };
      if (name === 'fillchar') {
        this.requireWritable(args[0]!);
        const target = layout(args[0]!);
        this.address(args[0]!);
        this.requireType(args[1]!, INTEGER, this.expression(args[1]!));
        if (!this.ordinal(this.expression(args[2]!)))
          this.fail(args[2]!, 'FillChar needs a byte or character value');
        target();
        this.emit(Opcode.CSP, 4, builtin.procedureIndex);
      } else {
        this.requireWritable(args[1]!);
        const source = layout(args[0]!),
          target = layout(args[1]!);
        this.address(args[0]!);
        this.address(args[1]!);
        this.requireType(args[2]!, INTEGER, this.expression(args[2]!));
        source();
        target();
        this.emit(Opcode.CSP, 5, builtin.procedureIndex);
      }
      return VOID;
    }
    if (name === 'addr')
      return this.expression({ type: NodeType.ADDRESS_OF, operand: args[0], lineNumber: node.lineNumber });
    if (name === 'settextbuf') {
      // The virtual drive has no buffers to size; the arguments are checked.
      const file = this.expressionType(args[0]!);
      if (file.kind !== 'file' || file.element?.kind !== 'char' || file.base)
        this.fail(args[0]!, 'Text file variable required');
      this.expressionType(args[1]!);
      if (args[2]) this.requireType(args[2], INTEGER, this.expressionType(args[2]));
      return VOID;
    }
    if (name === 'getmem' || name === 'freemem') {
      this.requireWritable(args[0]!);
      const pointer = this.address(args[0]!);
      if (pointer.kind !== 'pointer' || pointer.procedureSignature) this.fail(args[0]!, 'Pointer variable required');
      this.requireType(args[1]!, INTEGER, this.expression(args[1]!));
      if (name === 'getmem') {
        // A typed pointer's block starts as New would leave it.
        const base = pointer.base && pointer.base.kind !== 'void' ? this.defaults(pointer.base) : [];
        this.literal(JSON.stringify(base), STRING);
      }
      this.emit(Opcode.CSP, name === 'getmem' ? 3 : 2, builtin.procedureIndex);
      return VOID;
    }
    if (name === 'typeof') {
      // Turbo Pascal gives a pointer to the object's method table; the
      // P-machine identifies the type instead, which compares the same way.
      const argument = args[0]!;
      const symbol = argument.type === NodeType.IDENTIFIER ? this.lookup(String(argument.name)) : undefined;
      const type = symbol?.kind === 'type' ? symbol.type : this.expressionType(argument);
      if (!type.object) this.fail(argument, 'Object type or variable required');
      // Only an object with virtual methods has a method table to point at.
      if (!type.object.hasVirtual) this.fail(argument, 'TypeOf needs an object type with virtual methods');
      this.literal(type.object.id, POINTER);
      return POINTER;
    }
    if (name === 'mark' || name === 'release') {
      this.requireWritable(args[0]!);
      const pointer = this.address(args[0]!);
      if (pointer.kind !== 'pointer') this.fail(args[0]!, 'Pointer variable required');
      this.emit(Opcode.CSP, 1, builtin.procedureIndex);
      return VOID;
    }
    if (name === 'random' || name === 'randomize') {
      // Turbo Pascal's own sequence, which RandSeed carries.
      for (const argument of args) this.requireType(argument, INTEGER, this.expression(argument));
      this.literal(this.standardVariable('RandSeed'), INTEGER);
      this.emit(Opcode.CSP, args.length + 1, builtin.procedureIndex);
      return name === 'random' ? (args.length ? LONGINT : this.realResult()) : VOID;
    }
    if (builtin.procedureIndex === 512 || builtin.procedureIndex === 513 || builtin.procedureIndex === 518) {
      // Graph3's GetPic, PutPic and Pattern read or fill a variable's bytes.
      if (args.length !== builtin.params.length) this.fail(node, `Wrong number of arguments for "${builtin.name}"`);
      if (builtin.procedureIndex === 512) this.requireWritable(args[0]!);
      const type = this.address(args[0]!);
      if (type.kind === 'untyped' || type.openArray) this.fail(args[0]!, `${builtin.name} needs a variable whose type is known here`);
      for (const argument of args.slice(1)) this.requireType(argument, INTEGER, this.expression(argument));
      this.literal(JSON.stringify(this.binaryLayout(type)), STRING);
      this.emit(Opcode.CSP, args.length + 1, builtin.procedureIndex);
      return VOID;
    }
    if (builtin.procedureIndex >= 450 && builtin.procedureIndex <= 456) {
      // Every unit is resident, so the Overlay unit's procedures succeed:
      // OvrResult is ovrOk after each one.
      for (const [index, argument] of args.entries())
        this.requireType(argument, builtin.params[index]?.type === TypeKind.STRING ? STRING : INTEGER, this.expression(argument));
      this.emit(Opcode.CSP, args.length, builtin.procedureIndex);
      if (builtin.isFunction) return LONGINT;
      this.emit(Opcode.LDA, this.scope.level, this.standardVariable('OvrResult'));
      this.literal(0, INTEGER);
      this.emit(Opcode.STI, TypeCode.I);
      return VOID;
    }
    if (name === 'paramstr') {
      this.requireType(args[0]!, INTEGER, this.expression(args[0]!));
      this.literal(`C:\\${this.programName.toUpperCase()}.EXE`, STRING);
      this.emit(Opcode.CSP, 2, builtin.procedureIndex);
      return STRING;
    }
    if (name === 'blockread' || name === 'blockwrite') {
      const file = this.address(args[0]!);
      if (file.kind !== 'file' || file.base || file.element)
        this.fail(args[0]!, 'Untyped file required');
      const buffer = this.address(args[1]!);
      this.requireType(args[2]!, INTEGER, this.expression(args[2]!));
      if (args[3]) this.requireType(args[3], INTEGER, this.address(args[3]));
      else this.literal(-1, INTEGER);
      // An untyped parameter's buffer goes by its caller's layout.
      const operand = this.qualified(args[1]!);
      const source = buffer.kind === 'untyped' && operand.type === NodeType.IDENTIFIER ? this.lookup(String(operand.name)) : undefined;
      if (source?.kind === 'variable') this.emitLayoutOf(source);
      else this.literal(JSON.stringify(this.binaryLayout(buffer)), STRING);
      this.emit(Opcode.CSP, 5, builtin.procedureIndex);
      return VOID;
    }
    if (
      [
        'assign',
        'reset',
        'rewrite',
        'append',
        'close',
        'eof',
        'eoln',
        'seekeof',
        'seekeoln',
        'filepos',
        'filesize',
        'seek',
        'erase',
        'rename',
        'truncate',
      ].includes(name) &&
      args.length
    ) {
      const type = this.address(args[0]!);
      if (type.kind !== 'file') this.fail(args[0]!, 'File variable required');
      let count = 1;
      for (const arg of args.slice(1)) {
        this.expression(arg);
        count++;
      }
      if (name === 'assign') {
        this.literal(type.element ? 0 : (type.base?.size ?? -1), INTEGER);
        count++;
        if (type.base) {
          this.literal(JSON.stringify(this.binaryLayout(type.base)), STRING);
          count++;
        }
      }
      this.emit(Opcode.CSP, count, builtin.procedureIndex);
      return this.builtinReturn(builtin, args);
    }
    if (
      ['write', 'writeln', 'read', 'readln'].includes(name) &&
      args[0] &&
      this.expressionType(args[0]).kind === 'file'
    )
      return this.fileIO(node);
    if (name === 'write' || name === 'writeln') {
      for (const arg of args) this.outputArgument(arg);
      this.emit(Opcode.CSP, args.length, builtin.procedureIndex);
      return VOID;
    }
    if (name === 'read' || name === 'readln') {
      const checked: { argument: Node; type: PascalType; address: Variable }[] = [];
      for (const arg of args) {
        const type = this.expressionType(arg);
        if (this.aggregate(type) || type.kind === 'pointer')
          this.fail(arg, 'Read requires a scalar or string variable');
        this.requireWritable(arg);
        if (
          type.low !== undefined ||
          type.high !== undefined ||
          type.kind === 'string' ||
          type.kind === 'real'
        ) {
          // Retain the exact destination: input can change variables used in its index.
          const address = this.temp(POINTER);
          this.addressVariable(address);
          this.address(arg);
          this.emit(Opcode.STI, TypeCode.A);
          this.loadVariable(address);
          checked.push({ argument: arg, type, address });
        } else this.address(arg);
        this.literal(this.typeCode(type), INTEGER);
      }
      this.line = node.lineNumber ?? this.line;
      const readCall = this.emit(Opcode.CSP, args.length * 2, builtin.procedureIndex);
      for (const { argument, type, address } of checked) {
        this.loadVariable(address);
        this.loadVariable(address);
        this.emit(Opcode.LDI, this.typeCode(type));
        this.checkRange(type, argument);
        this.emit(Opcode.STI, this.typeCode(type));
      }
      this.bytecode.ioErrorTargets[readCall] = this.bytecode.getNextAddress();
      return VOID;
    }
    if (name === 'inc' || name === 'dec') {
      this.requireWritable(args[0]!);
      const address = this.temp(POINTER);
      this.addressVariable(address);
      const type = this.address(args[0]!);
      if (!this.ordinal(type)) this.fail(args[0]!, 'Inc and Dec require an ordinal variable');
      this.emit(Opcode.STI, TypeCode.A);
      this.loadVariable(address);
      this.loadVariable(address);
      this.emit(Opcode.LDI, this.typeCode(type));
      if (args[1]) this.requireType(args[1], INTEGER, this.expression(args[1]));
      else this.literal(1, INTEGER);
      this.helper(`${name}-${type.kind}`, 2, (value, count) => {
        const change = Number(count) * (name === 'inc' ? 1 : -1);
        return type.kind === 'char'
          ? String.fromCharCode(String(value).charCodeAt(0) + change)
          : Number(value) + change;
      });
      this.checkRange(type, node);
      this.emit(Opcode.STI, this.typeCode(type));
      return VOID;
    }
    if (name === 'exit') {
      this.scope.exits.push(this.emit(Opcode.UJP));
      return VOID;
    }
    if (builtin.procedureIndex === 331 || builtin.procedureIndex === 332) return this.interruptCall(node, builtin);
    // Keep ends the program as Halt does; nothing stays resident.
    if (name === 'halt' || (name === 'keep' && builtin.procedureIndex === 323)) {
      // Halt sets ExitCode, then ends the program through its exit
      // procedures, as the end of the main block does.
      this.emit(Opcode.LDA, this.scope.level, this.standardVariable('ExitCode'));
      if (args[0]) this.requireType(args[0], INTEGER, this.expression(args[0]));
      else this.literal(0, INTEGER);
      this.emit(Opcode.STI, TypeCode.I);
      this.haltJumps.push(this.emit(Opcode.UJP, this.scope.level, 0));
      return VOID;
    }
    if (name === 'break' || name === 'continue') {
      const loop = this.scope.loops.at(-1);
      if (!loop) this.fail(node, `${node.name} is only valid inside a loop`);
      (name === 'break' ? loop.breaks : loop.continues).push(this.emit(Opcode.UJP));
      return VOID;
    }
    let layouts = 0;
    args.forEach((arg, index) => {
      const parameter = builtin.params[index];
      if (parameter?.mode === ParamMode.VAR) {
        this.requireWritable(arg);
        const type = this.address(arg);
        if (parameter.type !== TypeKind.POINTER && parameter.type !== (type.kind as TypeKind))
          this.fail(arg, `Type mismatch in VAR argument for ${node.name}`);
        // A unit's record, such as SearchRec, goes with its byte layout.
        if (parameter.typeName) {
          const expected = this.unitType(this.modules.lookupProcedure(node.name)?.unit.toLowerCase() ?? '', parameter.typeName);
          if (type !== expected) this.fail(arg, `Type mismatch: ${parameter.typeName} expected`);
          this.literal(JSON.stringify(this.binaryLayout(type)), STRING);
          layouts++;
        }
      } else {
        const text = parameter?.type === TypeKind.POINTER ? this.textConstant(arg) : undefined;
        if (text !== undefined) {
          this.emitStaticText(text, arg);
          return;
        }
        if (parameter?.type === TypeKind.POINTER && this.emitCharArrayPointer(arg)) return;
        const type = this.expression(arg);
        if (['ord', 'succ', 'pred'].includes(name)) {
          if (!this.ordinal(type)) this.fail(arg, `${node.name} requires an ordinal argument`);
        } else if (name === 'concat') {
          if (!this.text(type)) this.fail(arg, 'Concat requires strings');
        } else if (parameter) {
          const target = (
            {
              integer: INTEGER,
              real: REAL,
              boolean: BOOLEAN,
              char: CHAR,
              string: STRING,
              pointer: POINTER,
            } as Partial<Record<TypeKind, PascalType>>
          )[parameter.type];
          if (target) this.requireType(arg, target, type);
        }
      }
    });
    const returnType = this.builtinReturn(builtin, args);
    this.line = node.lineNumber ?? this.line;
    if (['abs', 'sqr', 'succ', 'pred'].includes(name) && returnType.kind === 'integer') {
      this.integerHelper(name, returnType, node, 1);
    } else if (name === 'sqr' && returnType.kind === 'real') {
      const line = node.lineNumber ?? this.line;
      const coprocessor = this.coprocessorMode() || this.coprocessorReal(returnType);
      const operation = coprocessor ? coprocessorOperation : realOperation;
      this.helper(`${coprocessor ? '8087' : 'real'}-sqr-${String(line)}`, 1, (value) =>
        operation('*', Number(value), Number(value), line)
      );
    } else {
      this.emit(Opcode.CSP, args.length + layouts, builtin.procedureIndex);
      if (returnType.kind === 'real') this.checkRange(returnType, node);
      else if (['trunc', 'round'].includes(name)) this.checkRange(LONGINT, node);
    }
    return returnType;
  }
  private binaryLayout(type: PascalType): BinaryCell[] {
    const cells = this.cells(type);
    // A variant record's cells, besides the bytes it stores, leave gaps.
    const gaps = cells.some((cell, index) => cell.offset !== index);
    return cells.map((cell) => ({ ...this.binaryCell(cell.type), ...(gaps ? { offset: cell.offset } : {}) }));
  }
  private binaryCell(type: PascalType): BinaryCell {
    return {
      kind: type.kind,
      bytes: type.byteSize,
      signed: (type.low ?? 0) < 0,
      ...(type.kind === 'set' ? { setByteOffset: Math.floor((type.low ?? 0) / 8) } : {}),
    };
  }
  /** A type's byte layout, by number. */
  private layoutId(type: PascalType): number {
    const layout = this.binaryLayout(type);
    const key = JSON.stringify(layout);
    let id = this.layoutIds.get(key);
    if (id === undefined) {
      id = this.bytecode.layouts.push(layout) - 1;
      this.layoutIds.set(key, id);
    }
    return id;
  }
  /** Where each cell of a type lies in its bytes, the cases of variant parts
   * and their shadows included: how a view shows bytes as the type. Arrays
   * stay one element and a count, however large. */
  private viewShape(type: PascalType): ViewShape {
    if (type.kind === 'array' && type.element) {
      const element = type.element;
      return { kind: 'array', count: type.size / element.size, cells: element.size, bytes: element.byteSize, element: this.viewShape(element) };
    }
    if (type.kind === 'record' && type.fields) {
      const fields = [...type.fields.values()].map((field) => ({
        offset: field.offset,
        cells: field.type.size,
        byte: field.byteOffset ?? this.byteOffset(type, field.offset),
        shape: this.viewShape(field.type),
      }));
      const shadows = (type.variantParts ?? []).map(({ part, byteStart }) => {
        const info = this.bytecode.variantParts[part]!;
        const shape: ViewShape = { kind: 'array', count: info.bytes, cells: 1, bytes: 1, element: { kind: 'cell', cell: this.binaryCell(BYTE) } };
        return { offset: info.shadow, cells: info.bytes, byte: byteStart, shape };
      });
      return { kind: 'record', fields: [...fields, ...shadows] };
    }
    return { kind: 'cell', cell: this.binaryCell(type) };
  }
  private viewMapId(type: PascalType): number {
    const map = this.viewShape(type);
    const key = JSON.stringify(map);
    let id = this.viewMapIds.get(key);
    if (id === undefined) {
      id = this.bytecode.viewMaps.push(map) - 1;
      this.viewMapIds.set(key, id);
    }
    return id;
  }
  /** The list of variant parts a change to a type's bytes brings up to
   * date, by number, or -1 for none. */
  private refreshListId(type: PascalType): number {
    const parts = this.variantRefreshes(type, 0);
    if (!parts.length) return -1;
    const key = JSON.stringify(parts);
    let id = this.refreshIds.get(key);
    if (id === undefined) {
      id = this.bytecode.variantRefreshes.push(parts) - 1;
      this.refreshIds.set(key, id);
    }
    return id;
  }
  /** The layout of a variable's bytes: its type's, or for an untyped
   * parameter, the one its caller passed. */
  private emitLayoutOf(variable: Variable): void {
    if (variable.type.kind === 'untyped') {
      if (variable.type.untypedLayout) this.loadVariable(variable.type.untypedLayout);
      else this.literal(-1, INTEGER);
    } else this.literal(this.layoutId(variable.type), INTEGER);
  }
  /** VIEW: an address that shows a variable's bytes as `type`, from `start`.
   * The variable's variant parts follow what is stored through it, as do the
   * variant cases in `syncs`; `cell` picks a cell of the view. */
  private emitView(
    target: () => void,
    layout: () => void,
    type: PascalType,
    start: number,
    refresh: number,
    syncs: { base: Node; part: number; case: number }[],
    cell?: () => void
  ): void {
    target();
    layout();
    this.literal(this.viewMapId(type), INTEGER);
    this.literal(start, INTEGER);
    this.literal(refresh, INTEGER);
    this.literal(syncs.length, INTEGER);
    for (const sync of syncs) {
      this.address(sync.base);
      this.literal(sync.part, INTEGER);
      this.literal(sync.case, INTEGER);
    }
    cell?.();
    this.emit(Opcode.CSP, 6 + syncs.length * 3 + (cell ? 1 : 0), InternalProcedure.VIEW);
  }
  /** The variant parts inside a type, at an offset, to bring up to date
   * after its bytes change as a whole. */
  private variantRefreshes(type: PascalType, offset: number): { part: number; offset: number }[] {
    if (type.kind === 'array' && type.element) {
      const inner = this.variantRefreshes(type.element, 0);
      if (!inner.length) return [];
      return Array.from({ length: type.size / type.element.size }, (_, index) =>
        inner.map((entry) => ({ part: entry.part, offset: entry.offset + offset + index * type.element!.size }))
      ).flat();
    }
    return (type.variantRefresh ?? []).map((entry) => ({ part: entry.part, offset: entry.offset + offset }));
  }

  private cells(type: PascalType, offset = 0): { offset: number; type: PascalType }[] {
    if (type.kind === 'array')
      return Array.from({ length: type.size / type.element!.size }, (_, index) =>
        this.cells(type.element!, offset + index * type.element!.size)
      ).flat();
    if (type.kind === 'record')
      return (type.layout ?? [...type.fields!.values()]).flatMap((field) =>
        this.cells(field.type, offset + field.offset)
      );
    return [{ offset, type }];
  }
  private validateInput(pointer: Variable, type: PascalType, node: Node): void {
    for (const cell of this.cells(type)) {
      this.loadVariable(pointer);
      this.literal(cell.offset, INTEGER);
      this.emit(Opcode.ADI);
      this.loadVariable(pointer);
      this.literal(cell.offset, INTEGER);
      this.emit(Opcode.ADI);
      this.emit(Opcode.LDI, this.typeCode(cell.type));
      this.checkRange(cell.type, node);
      this.emit(Opcode.STI, this.typeCode(cell.type));
    }
  }
  private defaults(type: PascalType): Value[] {
    if (type.kind === 'array')
      return Array.from({ length: type.size / type.element!.size }, () =>
        this.defaults(type.element!)
      ).flat();
    if (type.kind === 'record') {
      // By offset, since the cases of a variant part share cells.
      const values: Value[] = Array.from({ length: type.size }, () => 0);
      for (const field of type.initialLayout ?? [...type.fields!.values()]) {
        const cells = this.defaults(field.type);
        for (const [index, value] of cells.entries()) values[field.offset + index] = value;
      }
      return values;
    }
    return [this.text(type) ? '' : type.kind === 'set' ? '[]' : 0];
  }
  private stringMutation(node: CallNode, builtin: BuiltinDef): PascalType {
    const name = node.name.toLowerCase(),
      args = node.arguments;
    if (name === 'delete') {
      this.requireWritable(args[0]!);
      const type = this.address(args[0]!);
      this.requireType(args[0]!, STRING, type);
      this.requireType(args[1]!, INTEGER, this.expression(args[1]!));
      this.requireType(args[2]!, INTEGER, this.expression(args[2]!));
      this.emit(Opcode.CSP, 3, builtin.procedureIndex);
    } else if (name === 'insert') {
      this.requireType(args[0]!, STRING, this.expression(args[0]!));
      this.requireWritable(args[1]!);
      const type = this.address(args[1]!);
      this.requireType(args[1]!, STRING, type);
      this.requireType(args[2]!, INTEGER, this.expression(args[2]!));
      this.stringCapacity(type);
      this.emit(Opcode.CSP, 4, builtin.procedureIndex);
    } else if (name === 'str') {
      const value =
        args[0]!.type === NodeType.FORMATTED_ARGUMENT ? (args[0]!.value as Node) : args[0]!;
      if (!this.numeric(this.expressionType(value)))
        this.fail(value, 'Str requires a numeric argument');
      this.outputArgument(args[0]!);
      this.requireWritable(args[1]!);
      const type = this.address(args[1]!);
      this.requireType(args[1]!, STRING, type);
      this.stringCapacity(type);
      this.emit(Opcode.CSP, 3, builtin.procedureIndex);
    } else {
      this.requireType(args[0]!, STRING, this.expression(args[0]!));
      this.requireWritable(args[1]!);
      this.requireWritable(args[2]!);
      const type = this.address(args[1]!);
      if (!this.numeric(type)) this.fail(args[1]!, 'Val requires a numeric target');
      this.requireType(args[2]!, INTEGER, this.address(args[2]!));
      this.literal(this.typeCode(type), INTEGER);
      if (type.kind === 'integer') {
        this.literal(type.low ?? -2147483648, INTEGER);
        this.literal(type.high ?? 2147483647, INTEGER);
      }
      this.emit(Opcode.CSP, type.kind === 'integer' ? 6 : 4, builtin.procedureIndex);
    }
    return VOID;
  }
  private fileIO(node: CallNode): PascalType {
    const name = node.name.toLowerCase(),
      [file, ...args] = node.arguments;
    const type = this.expressionType(file!);
    const writing = name === 'write' || name === 'writeln';
    if (type.base) {
      if (name === 'writeln' || name === 'readln')
        this.fail(node, 'ReadLn/WriteLn require a text file');
      for (const arg of args) {
        this.requireType(arg, type.base, this.expressionType(arg));
        this.address(file!);
        if (writing) {
          if (this.aggregate(type.base)) {
            const pointer = this.temp(POINTER);
            this.addressVariable(pointer);
            this.address(arg);
            this.emit(Opcode.STI, TypeCode.A);
            for (let cell = 0; cell < type.base.size; cell++) {
              this.loadVariable(pointer);
              this.literal(cell, INTEGER);
              this.emit(Opcode.ADI);
              this.emit(Opcode.LDI);
            }
          } else this.expression(arg);
          this.emit(Opcode.CSP, type.base.size + 1, 78);
        } else {
          const destination = this.temp(POINTER);
          this.addressVariable(destination);
          this.address(arg);
          this.emit(Opcode.STI, TypeCode.A);
          this.loadVariable(destination);
          this.literal(type.base.size, INTEGER);
          const readCall = this.emit(Opcode.CSP, 3, 79);
          this.validateInput(destination, type.base, arg);
          this.bytecode.ioErrorTargets[readCall] = this.bytecode.getNextAddress();
        }
      }
      return VOID;
    }
    if (!type.element) this.fail(node, 'Untyped files require BlockRead/BlockWrite');
    this.address(file!);
    if (writing) {
      for (const arg of args) this.outputArgument(arg);
      this.emit(Opcode.CSP, args.length + 1, name === 'write' ? 70 : 71);
    } else {
      const targets: { pointer: Variable; type: PascalType; node: Node }[] = [];
      for (const arg of args) {
        this.requireWritable(arg);
        const pointer = this.temp(POINTER);
        this.addressVariable(pointer);
        const target = this.address(arg);
        this.emit(Opcode.STI, TypeCode.A);
        this.loadVariable(pointer);
        targets.push({ pointer, type: target, node: arg });
        if (this.aggregate(target) || ['set', 'pointer', 'file'].includes(target.kind))
          this.fail(arg, 'Scalar input variable required');
        this.literal(this.typeCode(target), INTEGER);
      }
      const readCall = this.emit(Opcode.CSP, args.length * 2 + 1, name === 'read' ? 72 : 73);
      for (const target of targets) this.validateInput(target.pointer, target.type, target.node);
      this.bytecode.ioErrorTargets[readCall] = this.bytecode.getNextAddress();
    }
    return VOID;
  }

  private outputArgument(node: Node): void {
    // Formatting is a parser node only within Write/WriteLn arguments.
    const formatted = (node.type as string) === 'formattedArgument';
    const value = formatted ? (node.value as Node) : node;
    const type = this.expression(value);
    if (this.aggregate(type) || ['pointer', 'file', 'set'].includes(type.kind))
      this.fail(node, 'Write requires a scalar or string value');
    // Under {$N+} every real is written by the 8087 routine, as Extended.
    const coprocessor = this.coprocessorMode() || this.coprocessorReal(type);
    if (formatted) {
      const width = node.width as Node;
      this.requireType(width, INTEGER, this.expression(width));
      if (node.precision) {
        const precision = node.precision as Node;
        this.requireType(precision, INTEGER, this.expression(precision));
        if (!this.numeric(type)) this.fail(node, 'Decimal precision requires a numeric value');
      } else this.literal(-1, INTEGER);
    } else {
      this.literal(type.kind === 'real' ? defaultRealWidth(coprocessor) : 0, INTEGER);
      this.literal(-1, INTEGER);
    }
    const line = node.lineNumber ?? this.line;
    const real = type.kind === 'real';
    const kind = real && coprocessor ? '8087' : type.kind;
    this.helper(`format-${kind}-${String(line)}`, 3, (raw, rawWidth, rawPrecision) => {
      const width = Number(rawWidth),
        precision = Number(rawPrecision);
      // A negative precision asks a real for floating-point form.
      if (width < 0 || width > 32767 || (!real && precision < -1) || precision > 100)
        throw new PascalError('Invalid output field width or precision', line);
      if (real) return formatReal(Number(raw), width, precision, coprocessor);
      const text =
        type.kind === 'boolean'
          ? raw
            ? 'TRUE'
            : 'FALSE'
          : precision >= 0
            ? Number(raw).toFixed(precision)
            : String((raw as Value) ?? '');
      return text.padStart(width, ' ');
    });
  }
}

export default Compiler;
