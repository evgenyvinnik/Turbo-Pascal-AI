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
import type { BinaryCell } from '../runtime/BinaryCodec';
import { ModuleLoader } from '../stdlib/modules';
import { BuiltinProcedure, ParamMode, type BuiltinDef } from '../stdlib/builtin';
import { TypeKind } from '../symbols/Symbol';
import { Bytecode, type DebugType } from './Bytecode';
import { roundReal48, integerOperation, realOperation } from './numeric';

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
  | 'void';
interface PascalType {
  kind: Kind;
  size: number;
  byteSize: number;
  capacity?: number;
  openString?: boolean;
  /** Maximum-length string type declared under P+, retained by type aliases. */
  openStringDeclaration?: boolean;
  openCapacity?: Variable;
  base?: PascalType;
  element?: PascalType;
  index?: PascalType;
  low?: number;
  high?: number;
  fields?: Map<string, { offset: number; type: PascalType; privateOwner?: Scope }>;
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
  labels: Map<string, { node: Node; address?: number; patches: number[] }>;
  withRecords: { pointer: Variable; type: PascalType }[];
  parent: Scope | null;
  level: number;
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
    this.globalOffset = MARK_SIZE;
    this.objectTypes = [];
    this.routineValues = [];
    this.line = root.lineNumber ?? 1;
    this.sourceFile = typeof root.sourceFile === 'string' ? root.sourceFile : undefined;
    if (root.type !== NodeType.PROGRAM) this.fail(root, 'A Pascal program is required');
    const program = root as ProgramNode;
    this.scope = this.newScope(null, program.name);
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
    // Unit globals share the program activation, but retain separate lexical namespaces.
    this.scope.locals.unshift(...this.initializationOrder.flatMap(unit => unit.scope.locals));
    this.bytecode.setStartAddress();
    const block = { ...program.block, statements: [
      ...this.initializationOrder.map(unit => ({ type: NodeType.UNIT_INITIALIZATION, unit })),
      ...program.block.statements,
    ] };
    this.compileBody(block, undefined);
    return this.bytecode;
  }

  private importUnits(names: string[], node: Node): void {
    for (const name of names) {
      if (this.modules.useUnit(name)) continue;
      const unit = this.loadUnit(name, node);
      this.scope.imports.set(name.toLowerCase(), unit.exports);
    }
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
      extended: { ...REAL, byteSize: 10 },
      boolean: BOOLEAN,
      char: CHAR,
      string: STRING,
      pointer: POINTER,
      text: TEXTFILE,
    };
    for (const [name, type] of Object.entries(types))
      this.scope.symbols.set(name, { kind: 'type', type });
    for (const [name, value] of Object.entries({ maxint: 32767, pi: Math.PI }))
      this.scope.symbols.set(name, {
        kind: 'constant',
        type: name === 'pi' ? REAL : INTEGER,
        value: name === 'pi' ? roundReal48(value) : value,
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
        };
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
    if (this.scope.symbols.has(name.toLowerCase()))
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
            this.scope.labels.set(key, { node, patches: [] });
          }
          break;
        case NodeType.CONST_DECLARATION: {
          const declaration = node as ConstDeclarationNode;
          const constant = this.constant(declaration.value);
          this.declare(declaration.name, constant, node);
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
          const type = this.resolveType(declaration.varType);
          for (const name of declaration.names)
            this.scope.locals.push(this.variable(name, type, node));
          break;
        }
        case NodeType.PROCEDURE:
        case NodeType.FUNCTION: {
          const declaration = node as ProcedureNode | FunctionNode;
          const parameters: Parameter[] = [];
          for (const parameterNode of declaration.parameters) {
            const parameter = parameterNode as ParameterNode;
            const type = this.parameterType(parameterNode);
            for (const name of parameter.names)
              parameters.push({
                name,
                type,
                reference: parameterNode.type === NodeType.VAR_PARAMETER,
                ...(type.openString ? { openString: true } : {}),
              });
          }
          const previous = this.scope.symbols.get(declaration.name.toLowerCase());
          const type = declaration.type === NodeType.FUNCTION
            ? declaration.returnType ? this.resolveType(declaration.returnType)
              : previous?.kind === 'routine' ? previous.type : this.fail(node, 'Function return type required')
            : declaration.routineKind === 'constructor' ? BOOLEAN : VOID;
          if (this.aggregate(type) || type.procedureSignature)
            this.fail(node, 'Functions returning arrays or records are not supported');
          if (
            previous?.kind === 'routine' &&
            previous.declaration.isForward &&
            !declaration.isForward
          ) {
            if (
              parameters.length &&
              (parameters.length !== previous.parameters.length ||
                parameters.some(
                  (param, i) =>
                    param.reference !== previous.parameters[i]!.reference ||
                    !this.compatible(param.type, previous.parameters[i]!.type, true)
                ))
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

  private parameterType(parameter: Node): PascalType {
    const node = parameter.paramType as Node;
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
      a.parameters.every((parameter, index) => {
        const other = b.parameters[index]!;
        return parameter.reference === other.reference && Boolean(parameter.type.openString) === Boolean(other.type.openString) &&
          this.compatible(parameter.type, other.type, true);
      });
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
        const parameters: Parameter[] = [];
        for (const parameter of node.parameters as Node[]) {
          const type = this.parameterType(parameter);
          for (const name of parameter.names as string[]) parameters.push({ name, type, reference: parameter.type === NodeType.VAR_PARAMETER, ...(type.openString ? { openString: true } : {}) });
        }
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
          if (size < 1 || size > 32760) this.fail(node, 'Array size exceeds supported storage');
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
        const fields = new Map<string, { offset: number; type: PascalType }>();
        let size = 0,
          byteSize = 0;
        for (const field of (node as RecordTypeNode).fields) {
          const type = this.resolveType(field.varType);
          for (const name of field.names) {
            if (fields.has(name.toLowerCase())) this.fail(field, `Duplicate field "${name}"`);
            fields.set(name.toLowerCase(), { offset: size, type });
            size += type.size;
            byteSize += type.byteSize;
          }
        }
        return { kind: 'record', size, byteSize, fields };
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
            ? REAL
            : this.integerRangeType(Number(node.value), Number(node.value), node),
          value: node.isReal
            ? roundReal48(Number(node.value), node.lineNumber)
            : Number(node.value),
        };
      case NodeType.STRING:
        return {
          kind: 'constant',
          type: (node.value as string).length === 1 ? CHAR : STRING,
          value: node.value as string,
        };
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
            type: value.type.kind === 'real' ? REAL : this.integerRangeType(number, number, node),
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
        const value = real
          ? realOperation(operator, a, b, node.lineNumber)
          : integerOperation(operator, a, b, { bits: 32, signed: true }, true, node.lineNumber);
        return {
          kind: 'constant',
          type: real ? REAL : this.integerRangeType(value, value, node),
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
      const type = parameter.openString ? { ...parameter.type, openString: true } : parameter.type;
      const variable = this.variable(parameter.name, type, declaration, parameter.reference);
      variable.parameter = true;
      if (parameter.openString) {
        const capacity = this.variable(`$high_${parameter.name}`, INTEGER, declaration);
        type.openCapacity = capacity;
      }
    }
    this.declarations(declaration.block.declarations);
    for (const child of this.scope.routines) this.compileRoutine(child);
    routine.address = this.bytecode.getNextAddress();
    for (const patch of routine.patches) this.patch(patch, routine.address);
    this.compileBody(declaration.block, routine);
    this.scope = parent;
    this.sourceFile = previousFile;
  }

  private compileBody(block: BlockNode, routine: Routine | undefined): void {
    if (typeof block.sourceFile === 'string') this.sourceFile = block.sourceFile;
    this.line = block.lineNumber ?? routine?.declaration.lineNumber ?? this.line;
    const entry = this.emit(Opcode.ENT);
    for (const local of this.scope.locals) this.initialize(local.type, local.offset);
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
        this.fail(label.node, 'Undefined label');
    for (const exit of this.scope.exits) this.patch(exit);
    this.line = block.endLineNumber ?? this.line;
    this.bytecode.statementLines[this.bytecode.getNextAddress()] = this.line;
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

  private initialize(type: PascalType, offset: number): void {
    if (type.kind === 'array') {
      for (let index = 0; index < type.size; index += type.element!.size)
        this.initialize(type.element!, offset + index);
    } else if (type.kind === 'record') {
      for (const field of type.fields!.values()) this.initialize(field.type, offset + field.offset);
    } else {
      this.emit(Opcode.LDA, 0, offset);
      this.literal(this.text(type) ? '' : type.kind === 'set' ? '[]' : 0, type);
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
        for (const label of this.scope.labels.values()) if (label.address === undefined && label.patches.length) this.fail(label.node, 'Undefined label');
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
        return;
      }
      case NodeType.GOTO_STATEMENT: {
        const key = String(node.label).toLowerCase();
        let destination: Scope | null = this.scope;
        while (destination && !destination.labels.has(key)) destination = destination.parent;
        if (!destination) this.fail(node, 'Undeclared label');
        const label = destination.labels.get(key)!;
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
    this.addressVariable(variable);
    this.requireType(node.start, variable.type, this.expression(node.start));
    this.emit(Opcode.STI, this.typeCode(variable.type));
    const limit = this.temp(variable.type);
    this.addressVariable(limit);
    this.requireType(node.end, variable.type, this.expression(node.end));
    this.emit(Opcode.STI, this.typeCode(variable.type));
    const start = this.bytecode.getNextAddress();
    this.loadVariable(variable);
    this.loadVariable(limit);
    this.emit(node.direction === 'downto' ? Opcode.GEQ : Opcode.LEQ, this.typeCode(variable.type));
    const end = this.emit(Opcode.FJP);
    const loop = this.beginLoop();
    this.statement(node.body);
    const next = this.bytecode.getNextAddress();
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
    this.patch(end);
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
    const targetType = this.expressionType(node.target, true);
    if (this.aggregate(targetType)) {
      const sourceType = this.expressionType(node.value);
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
    this.requireType(node.value, targetType, targetType.procedureSignature ? this.proceduralValue(node.value) : this.expression(node.value));
    this.checkRange(targetType, node);
    this.emit(Opcode.STI, this.typeCode(targetType));
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
      case NodeType.ADDRESS_OF:
        return { ...POINTER, base: this.expressionType(node.operand as Node) };
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
        if (operator === '/' || left.kind === 'real' || right.kind === 'real') return REAL;
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
    if (this.numericConstant(node)) {
      const value = this.constant(node);
      this.literal(value.value, value.type);
      return value.type;
    }
    switch (node.type) {
      case NodeType.SET_LITERAL:
        return this.setLiteral(node);
      case NodeType.ADDRESS_OF:
        return { ...POINTER, base: this.address(node.operand as Node) };
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
      let type = this.address(access.array);
      if (type.kind === 'string') {
        if (access.indices.length !== 1) this.fail(node, 'A string requires one index');
        this.requireType(access.indices[0]!, INTEGER, this.expression(access.indices[0]!));
        this.stringCapacity(type);
        this.emit(Opcode.CSP, 3, InternalProcedure.STRING_CHARACTER_ADDRESS);
        return CHAR;
      }
      for (const index of access.indices) {
        if (type.kind !== 'array') this.fail(node, 'An array variable is required');
        const indexType = this.expression(index);
        if (!this.ordinal(indexType)) this.fail(index, 'Array index must be ordinal');
        this.requireType(index, type.index!, indexType);
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
    this.fail(node, 'Variable required');
  }
  private checkRange(type: PascalType, node: Node): void {
    if (type.kind === 'real') {
      const line = node.lineNumber ?? this.line;
      if (type.byteSize === 6)
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
    this.helper(`range-${String(low)}-${String(high)}-${String(line)}-${String(checked)}-${String(bits)}`, 1, (value) => {
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
      return this.compileCall(node, expression);
    } finally {
      this.ioChecking = previous;
    }
  }
  private emitRoutineCall(node: CallNode, expression: boolean, routine: Routine, bound?: Variable): PascalType {
      if (expression && routine.type.kind === 'void')
        this.fail(node, 'Procedure cannot be used as an expression');
      if (!expression && routine.type.kind !== 'void' && routine.declaration.routineKind !== 'constructor')
        this.fail(node, 'Function result must be used');
      if (routine.parameters.length !== node.arguments.length)
        this.fail(
          node,
          `Wrong number of arguments for "${node.name}" (expected ${String(routine.parameters.length)})`
        );
      this.emit(Opcode.MST, this.scope.level - routine.parent.level);
      let words = 0;
      if (bound) { this.loadVariable(bound); words++; }
      routine.parameters.forEach((parameter, index) => {
        const argument = node.arguments[index]!;
        if (parameter.reference) {
          this.requireType({ ...argument, strictVarStrings: node.strictVarStrings }, parameter.type, this.address(argument), true);
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
          this.requireType(argument, parameter.type, parameter.type.procedureSignature ? this.proceduralValue(argument) : this.expression(argument));
          this.checkRange(parameter.type, argument);
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
    if (!expression && signature.result.kind !== 'void') this.fail(node, 'Function result must be used');
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
    if (shadow?.kind === 'type') {
      if (!expression || node.arguments.length !== 1)
        this.fail(node, 'Typecast requires one value');
      const target = shadow.type,
        source = this.expression(node.arguments[0]!);
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
    const builtin = this.modules.lookupProcedure(node.name)?.proc;
    if (!builtin) this.fail(node, `Undeclared procedure or function "${node.name}"`);
    return this.builtin(node, builtin, expression);
  }

  private builtinReturn(builtin: BuiltinDef, arguments_: Node[]): PascalType {
    const name = builtin.name.toLowerCase();
    if ((name === 'high' || name === 'low') && arguments_[0]) {
      const type = this.expressionType(arguments_[0]);
      return type.kind === 'array' ? type.index! : type.kind === 'string' ? INTEGER : type;
    }
    if (['abs', 'sqr', 'succ', 'pred'].includes(name) && arguments_[0])
      return ['abs', 'sqr'].includes(name) && this.expressionType(arguments_[0]).kind === 'integer'
        ? this.promoteInteger(this.expressionType(arguments_[0]))
        : this.expressionType(arguments_[0]);
    if (name === 'random' && arguments_.length === 0) return REAL;
    if (['trunc', 'round', 'filepos', 'filesize'].includes(name)) return LONGINT;
    const types: Partial<Record<TypeKind, PascalType>> = {
      [TypeKind.INTEGER]: INTEGER,
      [TypeKind.REAL]: REAL,
      [TypeKind.BOOLEAN]: BOOLEAN,
      [TypeKind.CHAR]: CHAR,
      [TypeKind.STRING]: STRING,
      [TypeKind.POINTER]: POINTER,
    };
    return builtin.isFunction ? (types[builtin.returnType!] ?? INTEGER) : VOID;
  }
  private builtin(node: CallNode, builtin: BuiltinDef, expression: boolean): PascalType {
    const name = node.name.toLowerCase(),
      args = node.arguments;
    if (expression && !builtin.isFunction && builtin.name.toLowerCase() !== 'new')
      this.fail(node, 'Procedure cannot be used as an expression');
    if (!expression && builtin.isFunction) this.fail(node, 'Function result must be used');
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
      if (type.openCapacity) { this.stringCapacity(type); this.literal(1, INTEGER); this.emit(Opcode.ADI); }
      else this.literal(type.byteSize, INTEGER);
      return INTEGER;
    }
    if (name === 'high' || name === 'low') {
      const type = this.expressionType(args[0]!);
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
    if (name === 'blockread' || name === 'blockwrite') {
      const file = this.address(args[0]!);
      if (file.kind !== 'file' || file.base || file.element)
        this.fail(args[0]!, 'Untyped file required');
      const buffer = this.address(args[1]!);
      this.requireType(args[2]!, INTEGER, this.expression(args[2]!));
      if (args[3]) this.requireType(args[3], INTEGER, this.address(args[3]));
      else this.literal(-1, INTEGER);
      this.literal(JSON.stringify(this.binaryLayout(buffer)), STRING);
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
    if (name === 'halt') {
      // The VM records the exit code, then stops as at the program's end.
      if (args[0]) this.requireType(args[0], INTEGER, this.expression(args[0]));
      this.emit(Opcode.CSP, args[0] ? 1 : 0, BuiltinProcedure.HALT);
      return VOID;
    }
    if (name === 'break' || name === 'continue') {
      const loop = this.scope.loops.at(-1);
      if (!loop) this.fail(node, `${node.name} is only valid inside a loop`);
      (name === 'break' ? loop.breaks : loop.continues).push(this.emit(Opcode.UJP));
      return VOID;
    }
    args.forEach((arg, index) => {
      const parameter = builtin.params[index];
      if (parameter?.mode === ParamMode.VAR) {
        const type = this.address(arg);
        if (parameter.type !== TypeKind.POINTER && parameter.type !== (type.kind as TypeKind))
          this.fail(arg, `Type mismatch in VAR argument for ${node.name}`);
      } else {
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
      this.helper(`real-sqr-${String(line)}`, 1, (value) =>
        realOperation('*', Number(value), Number(value), line)
      );
    } else {
      this.emit(Opcode.CSP, args.length, builtin.procedureIndex);
      if (returnType.kind === 'real') this.checkRange(returnType, node);
      else if (['trunc', 'round'].includes(name)) this.checkRange(LONGINT, node);
    }
    return returnType;
  }
  private binaryLayout(type: PascalType): BinaryCell[] {
    return this.cells(type).map((cell) => ({
      kind: cell.type.kind,
      bytes: cell.type.byteSize,
      signed: (cell.type.low ?? 0) < 0,
      ...(cell.type.kind === 'set'
        ? { setByteOffset: Math.floor((cell.type.low ?? 0) / 8) }
        : {}),
    }));
  }

  private cells(type: PascalType, offset = 0): { offset: number; type: PascalType }[] {
    if (type.kind === 'array')
      return Array.from({ length: type.size / type.element!.size }, (_, index) =>
        this.cells(type.element!, offset + index * type.element!.size)
      ).flat();
    if (type.kind === 'record')
      return [...type.fields!.values()].flatMap((field) =>
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
    if (type.kind === 'record')
      return [...type.fields!.values()].flatMap((field) => this.defaults(field.type));
    return [this.text(type) ? '' : type.kind === 'set' ? '[]' : 0];
  }
  private stringMutation(node: CallNode, builtin: BuiltinDef): PascalType {
    const name = node.name.toLowerCase(),
      args = node.arguments;
    if (name === 'delete') {
      const type = this.address(args[0]!);
      this.requireType(args[0]!, STRING, type);
      this.requireType(args[1]!, INTEGER, this.expression(args[1]!));
      this.requireType(args[2]!, INTEGER, this.expression(args[2]!));
      this.emit(Opcode.CSP, 3, builtin.procedureIndex);
    } else if (name === 'insert') {
      this.requireType(args[0]!, STRING, this.expression(args[0]!));
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
      const type = this.address(args[1]!);
      this.requireType(args[1]!, STRING, type);
      this.stringCapacity(type);
      this.emit(Opcode.CSP, 3, builtin.procedureIndex);
    } else {
      this.requireType(args[0]!, STRING, this.expression(args[0]!));
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
    if (formatted) {
      const width = node.width as Node;
      this.requireType(width, INTEGER, this.expression(width));
      if (node.precision) {
        const precision = node.precision as Node;
        this.requireType(precision, INTEGER, this.expression(precision));
        if (!this.numeric(type)) this.fail(node, 'Decimal precision requires a numeric value');
      } else this.literal(-1, INTEGER);
    } else {
      this.literal(0, INTEGER);
      this.literal(-1, INTEGER);
    }
    const line = node.lineNumber ?? this.line;
    this.helper(`format-${type.kind}-${String(line)}`, 3, (raw, rawWidth, rawPrecision) => {
      const width = Number(rawWidth),
        precision = Number(rawPrecision);
      if (width < 0 || width > 32767 || precision < -1 || precision > 100)
        throw new PascalError('Invalid output field width or precision', line);
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
