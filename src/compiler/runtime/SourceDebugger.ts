import type { Bytecode, DebugScope, DebugType } from '../codegen/Bytecode';
import { Lexer, Stream } from '../lexer';
import { Parser } from '../parser';
import { NodeType, type Node, type AssignmentNode, type BinaryOpNode, type UnaryOpNode, type ArrayAccessNode, type FieldAccessNode, type IdentifierNode, type CallNode } from '../parser/Node';
import { Machine, MachineState, type StackValue } from './Machine';
import { decodeDosText } from '../encoding';
import { sourcePath } from '../project';

export type DebugAction = 'run' | 'entry' | 'into' | 'over' | 'out' | 'cursor';
export interface SourceBreakpoint { line: number; file?: string; enabled: boolean; condition?: string; passCount?: number }
export interface DebugValue { value: unknown; type: string }
export interface DebugFrame { name: string; line: number; file?: string | undefined; mp: number; locals: Record<string, DebugValue>; arguments: unknown[] }
interface Location { address: number; type: DebugType }

export function formatDebugValue(value: unknown): string {
  if (value instanceof Set) return `[${[...value].join(',')}]`;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return decodeDosText(value);
  return value === undefined ? 'Unknown' : JSON.stringify(value);
}

/** Source-level execution and inspection over the same VM used by Run. */
export class SourceDebugger {
  private action: DebugAction = 'run';
  private initialDepth = 0;
  private executed = false;
  private targetLine = 0;
  private targetFile: string | undefined;
  private paused = false;
  private breakpointProvider: () => SourceBreakpoint[] = () => [];
  private hits = new Map<string, number>();

  constructor(readonly machine: Machine, readonly bytecode: Bytecode) {}

  setBreakpoints(provider: () => SourceBreakpoint[]): void { this.breakpointProvider = provider; }
  isPaused(): boolean { return this.paused; }
  continueAfterInput(): void { this.executed = false; }
  getLine(): number { return this.bytecode.sourceLines[this.machine.getPC()] ?? this.machine.getSourceLine(); }
  getFile(): string | undefined { return this.bytecode.sourceFiles[this.machine.getPC()] ?? this.machine.getSourceFile(); }

  command(action: DebugAction, targetLine = 0, targetFile?: string): void {
    this.action = action;
    this.targetLine = targetLine;
    this.targetFile = targetFile;
    this.initialDepth = this.frames().length;
    this.executed = false;
    this.paused = false;
  }

  /** Returns at a real statement boundary, input request, delay, halt or budget. */
  runSlice(budget = 5_000): void {
    if (this.paused) return;
    for (let count = 0; count < budget; count += 1) {
      const state = this.machine.getState();
      if (state === MachineState.STOPPED || state === MachineState.ERROR || state === MachineState.WAITING) return;
      if (state === MachineState.SLEEPING && !this.machine.wake()) return;
      const line = this.bytecode.statementLines[this.machine.getPC()];
      if (line !== undefined) {
        const depth = this.action === 'over' || this.action === 'out' ? this.frames().length : 0;
        const step = this.action === 'entry'
          || (this.executed && this.action === 'into')
          || (this.executed && this.action === 'over' && depth <= this.initialDepth)
          || (this.executed && this.action === 'out' && depth < this.initialDepth)
          || (this.action === 'cursor' && line === this.targetLine && (!this.targetFile || sourcePath(this.targetFile) === sourcePath(this.getFile() ?? '')));
        const breakpoint = (this.executed || this.action === 'entry') && this.breakpointProvider().some((point) => {
          if (!point.enabled || point.line !== line || (point.file && this.getFile() && sourcePath(point.file) !== sourcePath(this.getFile()!)) || (point.condition && !this.evaluate(point.condition).value)) return false;
          const key = `${this.getFile() ?? ''}:${String(line)}:${point.condition ?? ''}`;
          const count = (this.hits.get(key) ?? 0) + 1;
          this.hits.set(key, count);
          return count > (point.passCount ?? 0);
        });
        if (step || breakpoint) { this.paused = true; return; }
      }
      this.machine.step();
      this.executed = true;
    }
  }

  private scopeAt(pc: number): DebugScope | undefined {
    return this.bytecode.debugScopes.find((scope) => pc >= scope.start && pc < scope.end);
  }

  frames(): DebugFrame[] {
    const frames: DebugFrame[] = [];
    let mp = this.machine.getMP();
    let pc = this.machine.getPC();
    const visited = new Set<number>();
    while (!visited.has(mp) && frames.length < 256) {
      visited.add(mp);
      const scope = this.scopeAt(pc);
      if (!scope) break;
      const locals: Record<string, DebugValue> = {};
      const args: unknown[] = [];
      for (const variable of scope.variables) {
        const address = variable.reference ? Number(this.machine.peek(mp + variable.offset)) : mp + variable.offset;
        locals[variable.name] = { value: this.readValue(address, variable.type), type: variable.type.kind };
        if (variable.parameter) args.push(locals[variable.name]?.value);
      }
      frames.push({ name: scope.name, line: this.bytecode.sourceLines[pc] ?? 0, file: this.bytecode.sourceFiles[pc], mp, locals, arguments: args });
      if (mp === 0) break;
      pc = Number(this.machine.peek(mp + 4)) - 1;
      mp = Number(this.machine.peek(mp + 2));
    }
    return frames;
  }

  private symbol(name: string): Location | DebugValue {
    let scope = this.scopeAt(this.machine.getPC());
    let mp = this.machine.getMP();
    while (scope) {
      const variable = scope.variables.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (variable) return {
        address: variable.reference ? Number(this.machine.peek(mp + variable.offset)) : mp + variable.offset,
        type: variable.type,
      };
      const constant = scope.constants.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (constant) return { value: constant.type.kind === 'boolean' ? Boolean(constant.value) : constant.type.kind === 'set' ? new Set(JSON.parse(String(constant.value)) as number[]) : constant.value, type: constant.type.kind };
      mp = Number(this.machine.peek(mp + 1));
      const parentId = scope.parentId;
      scope = this.bytecode.debugScopes.find((candidate) => candidate.id === parentId);
    }
    throw new Error(`Unknown identifier "${name}"`);
  }

  private readValue(address: number, type: DebugType, depth = 0): unknown {
    if (depth > 8) return '...';
    if (type.kind === 'array' && type.element) {
      const element = type.element;
      const count = Math.min(256, Math.floor(type.size / element.size));
      return Array.from({ length: count }, (_, index) => this.readValue(address + index * element.size, element, depth + 1));
    }
    if (type.kind === 'record' && type.fields) {
      return Object.fromEntries(Object.entries(type.fields).map(([name, field]) => [name, this.readValue(address + field.offset, field.type, depth + 1)]));
    }
    const value = this.machine.peek(address);
    if (type.kind === 'set') return new Set(JSON.parse(String(value || '[]')) as number[]);
    return type.kind === 'boolean' ? Boolean(value) : value;
  }

  private readLocation(location: Location): unknown {
    return this.readValue(location.address, location.type);
  }

  private parse(expression: string): Node {
    const program = new Parser(new Lexer(new Stream(`program DebugExpression; begin debugValue := ${expression}; end.`))).parse();
    if (program.block.statements.length !== 1 || program.block.statements[0]?.type !== NodeType.ASSIGNMENT) throw new Error('Enter one Pascal expression');
    return (program.block.statements[0] as AssignmentNode).value;
  }

  private location(node: Node): Location {
    if (node.type === NodeType.IDENTIFIER) {
      const symbol = this.symbol((node as IdentifierNode).name);
      if ('address' in symbol) return symbol;
      throw new Error('A constant cannot be modified');
    }
    if (node.type === NodeType.ARRAY_ACCESS) {
      const access = node as ArrayAccessNode;
      let result = this.location(access.array);
      for (const indexNode of access.indices) {
        const index = Number(this.value(indexNode));
        if (result.type.kind === 'string') {
          result = { address: this.machine.stringCharacterAddress(result.address, index, result.type.capacity ?? 255),
            type: { kind: 'char', size: 1, byteSize: 1 } };
          continue;
        }
        if (result.type.kind !== 'array' || !result.type.element) throw new Error('An array is required');
        const low = result.type.low ?? 0;
        const high = result.type.high ?? low + result.type.size / result.type.element.size - 1;
        if (!Number.isInteger(index) || index < low || index > high) throw new Error('Array index out of range');
        result = { address: result.address + (index - low) * result.type.element.size, type: result.type.element };
      }
      return result;
    }
    if (node.type === NodeType.FIELD_ACCESS) {
      const access = node as FieldAccessNode;
      const base = this.location(access.record);
      const entry = Object.entries(base.type.fields ?? {}).find(([name]) => name.toLowerCase() === access.field.toLowerCase());
      if (!entry) throw new Error(`Unknown field "${access.field}"`);
      return { address: base.address + entry[1].offset, type: entry[1].type };
    }
    if (node.type === NodeType.POINTER_DEREF) {
      const pointer = this.location(node.pointer as Node);
      if (pointer.type.kind !== 'pointer' || !pointer.type.base) throw new Error('A typed pointer is required');
      const address = Number(this.readLocation(pointer));
      if (!address) throw new Error('Cannot dereference NIL');
      this.machine.peek(address);
      return { address, type: pointer.type.base };
    }
    throw new Error('A variable, array element or record field is required');
  }

  private value(node: Node): unknown {
    switch (node.type) {
      case NodeType.NUMBER:
      case NodeType.STRING:
      case NodeType.BOOLEAN: return node.value;
      case NodeType.NIL: return 0;
      case NodeType.ADDRESS_OF: return this.location(node.operand as Node).address;
      case NodeType.SET_LITERAL: {
        const values = new Set<number>();
        for (const element of node.elements as Node[]) {
          const first = this.ordinal(this.value(element.type === NodeType.RANGE ? element.low as Node : element));
          const last = element.type === NodeType.RANGE ? this.ordinal(this.value(element.high as Node)) : first;
          if (first < 0 || last > 255 || !Number.isInteger(first) || !Number.isInteger(last)) throw new Error('Set element out of range');
          for (let item = first; item <= last; item += 1) values.add(item);
        }
        return values;
      }
      case NodeType.IDENTIFIER: {
        const symbol = this.symbol((node as IdentifierNode).name);
        return 'address' in symbol ? this.readValue(symbol.address, symbol.type) : symbol.value;
      }
      case NodeType.ARRAY_ACCESS:
      case NodeType.FIELD_ACCESS:
      case NodeType.POINTER_DEREF: {
        const location = this.location(node);
        return this.readLocation(location);
      }
      case NodeType.UNARY_OP: {
        const unary = node as UnaryOpNode;
        const value = this.value(unary.operand);
        if (unary.operator === '-') return -Number(value);
        if (unary.operator === '+') return Number(value);
        if (unary.operator === 'not') return typeof value === 'boolean' ? !value : ~Number(value);
        break;
      }
      case NodeType.BINARY_OP: {
        const binary = node as BinaryOpNode;
        const left = this.value(binary.left);
        const right = this.value(binary.right);
        if (binary.operator.toLowerCase() === 'in') {
          if (!(right instanceof Set)) throw new Error('A set is required after IN');
          return right.has(this.ordinal(left));
        }
        if (left instanceof Set && right instanceof Set) {
          const subset = (a: Set<unknown>, b: Set<unknown>) => [...a].every((item) => b.has(item));
          switch (binary.operator) {
            case '+': return new Set([...left, ...right]);
            case '-': return new Set([...left].filter((item) => !right.has(item)));
            case '*': return new Set([...left].filter((item) => right.has(item)));
            case '=': return left.size === right.size && subset(left, right);
            case '<>': return left.size !== right.size || !subset(left, right);
            case '<=': return subset(left, right);
            case '>=': return subset(right, left);
          }
          throw new Error('Unsupported set operation');
        }
        switch (binary.operator.toLowerCase()) {
          case '+': return typeof left === 'string' || typeof right === 'string' ? String(left) + String(right) : Number(left) + Number(right);
          case '-': return Number(left) - Number(right);
          case '*': return Number(left) * Number(right);
          case '/': if (Number(right) === 0) throw new Error('Division by zero'); return Number(left) / Number(right);
          case 'div': if (Number(right) === 0) throw new Error('Division by zero'); return Math.trunc(Number(left) / Number(right));
          case 'mod': if (Number(right) === 0) throw new Error('Division by zero'); return Number(left) % Number(right);
          case '=': return left === right;
          case '<>': return left !== right;
          case '<': return typeof left === 'string' && typeof right === 'string' ? left < right : Number(left) < Number(right);
          case '>': return typeof left === 'string' && typeof right === 'string' ? left > right : Number(left) > Number(right);
          case '<=': return typeof left === 'string' && typeof right === 'string' ? left <= right : Number(left) <= Number(right);
          case '>=': return typeof left === 'string' && typeof right === 'string' ? left >= right : Number(left) >= Number(right);
          case 'and': return typeof left === 'boolean' && typeof right === 'boolean' ? left && right : Number(left) & Number(right);
          case 'or': return typeof left === 'boolean' && typeof right === 'boolean' ? left || right : Number(left) | Number(right);
          case 'xor': return typeof left === 'boolean' && typeof right === 'boolean' ? left !== right : Number(left) ^ Number(right);
          case 'shl': return Number(left) << Number(right);
          case 'shr': return Number(left) >>> Number(right);
        }
        break;
      }
      case NodeType.CALL: {
        const call = node as CallNode;
        const args = call.arguments.map((arg) => this.value(arg));
        const functions: Record<string, () => unknown> = {
          abs: () => Math.abs(Number(args[0])), sqr: () => Number(args[0]) ** 2,
          sqrt: () => Math.sqrt(Number(args[0])), round: () => Math.sign(Number(args[0])) * Math.floor(Math.abs(Number(args[0])) + 0.5),
          trunc: () => Math.trunc(Number(args[0])), length: () => String(args[0]).length,
          ord: () => typeof args[0] === 'string' ? args[0].charCodeAt(0) : Number(args[0]),
          chr: () => String.fromCharCode(Number(args[0])), odd: () => Number(args[0]) % 2 !== 0,
          succ: () => Number(args[0]) + 1, pred: () => Number(args[0]) - 1,
        };
        const invoke = functions[call.name.toLowerCase()];
        if (invoke) return invoke();
        throw new Error('Only pure built-in functions can be evaluated while paused');
      }
    }
    throw new Error('Unsupported debugger expression');
  }

  evaluate(expression: string): DebugValue {
    const node = this.parse(expression);
    const value = this.value(node);
    return { value, type: typeof value };
  }

  private ordinal(value: unknown): number { return typeof value === 'string' ? value.charCodeAt(0) : Number(value); }

  modify(expression: string, replacement: string): DebugValue {
    if (!this.paused) throw new Error('Pause the program before modifying a variable');
    const location = this.location(this.parse(expression));
    const value = this.value(this.parse(replacement));
    const kind = location.type.kind;
    if (kind === 'integer' || kind === 'real') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (kind === 'integer' && !Number.isInteger(value))) throw new Error(`A valid ${kind} value is required`);
      if ((location.type.low !== undefined && value < location.type.low) || (location.type.high !== undefined && value > location.type.high)) throw new Error('Value out of range');
    } else if (kind === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('A boolean value is required');
    } else if (kind === 'string' || kind === 'char') {
      if (typeof value !== 'string' || (kind === 'char' && value.length !== 1)) throw new Error(`A ${kind} value is required`);
      if (kind === 'string' && value.length > (location.type.capacity ?? 255)) throw new Error('String capacity exceeded');
    } else if (kind === 'pointer') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error('A valid pointer address is required');
      if (value) this.machine.peek(value);
    } else if (kind === 'set') {
      if (!(value instanceof Set)) throw new Error('A set value is required');
      for (const item of value) if (Number(item) < (location.type.low ?? 0) || Number(item) > (location.type.high ?? 255)) throw new Error('Set element out of range');
    } else throw new Error('Only scalar variables can be modified');
    this.machine.poke(location.address, (kind === 'boolean' ? Number(value) : value instanceof Set ? JSON.stringify([...value].sort((a, b) => Number(a) - Number(b))) : value) as StackValue);
    return this.evaluate(expression);
  }
}
