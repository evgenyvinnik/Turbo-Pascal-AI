/**
 * P-machine virtual machine for executing Pascal bytecode
 *
 * This implements a stack-based virtual machine compatible with the UCSD Pascal
 * P-code instruction set. It executes compiled bytecode and manages the runtime
 * stack, heap, and program execution.
 *
 * References:
 *     http://cs2.uco.edu/~trt/cs4173/pspec.pdf
 *     http://cs2.uco.edu/~trt/cs4933/P-MachineSimulator.pdf
 */

import { Opcode, TypeCode, Register, MARK_SIZE, inst } from '../types/inst';
import { Bytecode } from '../codegen/Bytecode';
import { PascalError } from '../errors/PascalError';
import { describePascalDiagnostic } from '../errors/diagnostics';
import { InternalProcedure, NativeRegistry } from './Native';
import { BuiltinProcedure } from '../stdlib/builtin';
import { CrtProcedure } from '../stdlib/crt';
import { RuntimeServices } from './RuntimeServices';
import { VirtualFileSystem } from './VirtualFileSystem';
import { Float80, compareReal, negateReal, parseReal, truncReal } from '../codegen/float80';
import { encodeDosText, decodeDosText } from '../encoding';
import { Asm86, scanCode, type AsmHost, type AsmState } from './Asm86';
import { VariantRuntime } from './Variants';
import type { MemoryAccess } from './FileRuntime';
import { AddressSpace, HEAP_BYTES, LINEAR_BASE, MAX_CELLS, PORT_BASE, STACK_SEGMENT, STACK_TOP, VIEW_BASE } from './AddressSpace';
import { Heap, type BlockType } from './Heap';
import { LowMemory, Ports } from './LowMemory';

/** How many 8086 instructions an asm block runs before the machine lets
 * the rest of the program, and the page, have a turn. */
const ASSEMBLY_SLICE = 5_000;

/**
 * Stack value type - can hold numbers, strings, or booleans
 */
export type StackValue = number | string | boolean | null | Float80;

/**
 * Execution state of the machine
 */
export enum MachineState {
  /** Machine is ready to run */
  READY = 'ready',
  /** Machine is currently running */
  RUNNING = 'running',
  /** Machine is paused */
  PAUSED = 'paused',
  /** Execution is suspended until more console input is supplied. */
  WAITING = 'waiting',
  SLEEPING = 'sleeping',
  /** Machine has stopped */
  STOPPED = 'stopped',
  /** Machine encountered an error */
  ERROR = 'error',
}

/**
 * Configuration options for the Machine
 */
export interface MachineConfig {
  /** Stack size in words (default 131072): room for a full data segment's
   * globals and the frames of the calls on top of them. */
  stackSize?: number;
  /** Heap size in words (default as many as the heap's bytes) */
  heapSize?: number;
  /** Maximum instructions to execute (0 = unlimited) */
  maxInstructions?: number;
  /** Enable debug tracing */
  debug?: boolean;
  /** Limit captured console output to keep runaway programs bounded. */
  maxOutputChars?: number;
  fileSystem?: VirtualFileSystem;
  onSound?: (frequency: number) => void;
}

/**
 * P-machine virtual machine for executing Pascal bytecode
 */
export class Machine {
  /** The bytecode being executed */
  private bytecode: Bytecode;
  /** The standard variables' cells in the main frame, by name. */
  private standardCells: Map<string, number>;

  /** Data store (stack and heap combined) */
  private dstore: StackValue[];
  private stringCharacters = new Map<number, { address: number; index: number; capacity: number }>();
  private stringBacking = new Map<number, string>();

  /** Stack pointer - points to top of stack */
  private sp: number = -1;

  /** Mark pointer - points to base of current stack frame */
  private mp: number = 0;

  /** Program counter - index of next instruction to execute */
  private pc: number = 0;

  /** Extreme pointer - highest stack address used (not used in this implementation) */
  private ep: number = 0;

  /** The heap: its blocks take cells down from the top of the store. */
  private heap: Heap;
  /** New pointer - base of heap (grows downward) */
  private get np(): number {
    return this.heap.np;
  }
  /** The stack's last cell plus one: the heap's cells all lie above it. */
  private stackLimit: number;
  /** The memory around the program, and Turbo Pascal's memory as a whole. */
  private low: LowMemory;
  private space: AddressSpace;
  private ports: Ports;
  /** Where each frame's bytes start on the stack, set as it is called: its
   * caller's less its own size, as Turbo Pascal's stack grows down. */
  private frameLinear: Float64Array;
  /** Where the main frame starts: the data segment's cells. */
  private globalBase: number;

  /** Current execution state */
  private state: MachineState = MachineState.READY;

  /** Output buffer for Write/WriteLn */
  private output: string[] = [];
  private outputLine = '';
  private outputChars = 0;

  /** Input buffer for Read/ReadLn */
  private input: string[] = [];

  /** Current input position */
  private inputPos: number = 0;
  private inputColumn = 0;
  /** DOS keyboard bytes are independent of the line-oriented Read/ReadLn buffer. */
  private keyQueue = '';
  /** An asm block that stopped part way, to wait for a key or its turn,
   * and where it stopped. */
  private assemblyResume:
    | { pc: number; sp: number; state: AsmState; key: boolean; handler?: { mp: number; parameters: number; registers: number[] } }
    | undefined;
  /** Keeps variant records' cases in step with their bytes. */
  private variants: VariantRuntime;
  /** The frames of interrupt procedures running now, innermost last. */
  private interruptFrames: number[] = [];
  /** A timer interrupt that came while the program waited for a key or in
   * Delay: its frame, and when that delay ends. */
  private idleTick: { frame: number; sleeping: number | undefined } | undefined;
  /** When the timer next ticks, 18.2 times a second. */
  private nextTick = 0;
  /** The scan code of the last key pressed. */
  private lastScanCode = 0;
  private readonly native = new NativeRegistry();
  private readonly services: RuntimeServices;
  private wakeTime = 0;

  /** Number of instructions executed */
  private instructionCount: number = 0;

  /** The program's ExitCode: Halt sets it, and so does a run-time error. */
  private exitCode = 0;
  /** A run-time error held while the exit procedures run, reported after
   * them unless one clears ErrorAddr. */
  private pendingError: unknown;
  private inExitChain = false;

  /** Configuration options */
  private config: Required<MachineConfig>;

  /** Debug trace log */
  private trace: string[] = [];

  /**
   * Creates a new P-machine instance
   * @param bytecode - The compiled bytecode to execute
   * @param config - Optional configuration options
   */
  constructor(bytecode: Bytecode, config: MachineConfig = {}) {
    this.bytecode = bytecode;
    this.standardCells = new Map(bytecode.standardVariables.map((standard) => [standard.name, standard.address]));
    this.variants = new VariantRuntime(
      { read: (address) => this.peek(address), write: (address, value) => { this.poke(address, value); } },
      bytecode.variantParts
    );
    this.config = {
      stackSize: config.stackSize ?? 131072,
      heapSize: config.heapSize ?? HEAP_BYTES,
      maxInstructions: config.maxInstructions ?? 0,
      debug: config.debug ?? false,
      maxOutputChars: config.maxOutputChars ?? 1_048_576,
      fileSystem: config.fileSystem ?? new VirtualFileSystem(),
      onSound: config.onSound ?? (() => undefined),
    };

    // Initialize data store with combined stack and heap size
    const totalSize = this.config.stackSize + this.config.heapSize;
    if (totalSize > MAX_CELLS) throw new RangeError('The stack and heap are too large');
    this.dstore = new Array<StackValue>(totalSize).fill(0);

    // The heap's cells lie above the stack's; it has no more bytes than
    // cells, so its cells never run out first.
    this.heap = new Heap(this.config.stackSize, totalSize, Math.min(HEAP_BYTES, this.config.heapSize), () => true);
    this.globalBase = bytecode.typedConstants.length;
    this.frameLinear = new Float64Array(this.config.stackSize);
    this.stackLimit = this.config.stackSize;

    // Copy typed constants to the beginning of dstore
    for (let i = 0; i < bytecode.typedConstants.length; i++) {
      this.dstore[i] = bytecode.typedConstants[i]!;
    }
    this.pc = bytecode.startAddress;
    this.mp = bytecode.typedConstants.length;
    this.sp = this.mp - 1;
    for (const standard of bytecode.standardVariables) this.dstore[this.mp + standard.address] = standard.initial;
    this.services = new RuntimeServices({
      ...this.memory,
      allocate: (words, defaults, bytes, type) => this.allocate(words, defaults, bytes, type),
      free: (address) => { this.free(address); },
      heapAvailable: () => this.heap.available(),
      stackPointer: () => this.space.stackPointer(),
      heapTop: () => this.space.heapPointer(this.heap.pointer),
      releaseHeap: (address) => { this.releaseHeap(address); },
      sound: this.config.onSound,
      layout: (id) => this.bytecode.layouts[id] ?? [],
      viewMap: (id) => this.bytecode.viewMaps[id],
      refreshes: (id) => this.bytecode.variantRefreshes[id] ?? [],
      bytesAt: (address, layout, length) => this.space.bytesAt(address, layout, length),
      putBytes: (address, layout, bytes) => { this.space.putBytes(address, layout, bytes); },
      reach: (address, layout) => this.space.reach(address, layout),
      segmentOf: (address) => this.space.segmentOf(address),
      pointer: (segment, offset) => this.space.pointer(segment, offset),
    }, this.config.fileSystem);
    this.low = new LowMemory({ console: this.services.console, graphics: this.services.graphics, now: () => new Date(), keysAvailable: () => this.keysAvailable() });
    this.ports = new Ports({ sound: (frequency) => { this.config.onSound(frequency); }, scanCode: () => this.lastScanCode, graphics: this.services.graphics });
    this.space = new AddressSpace({
      memory: this.memory,
      bytecode,
      heap: this.heap,
      low: this.low,
      variants: this.variants,
      cells: totalSize,
      globalBase: this.globalBase,
      frame: () => ({ base: this.mp, top: this.sp }),
      caller: (base) => Number(this.dstore[base + 2] ?? 0),
      routine: (base) => Number(this.dstore[base + 3] ?? 0),
      frameLinear: (base) => this.frameLinear[base] ?? STACK_SEGMENT * 16 + STACK_TOP,
      stringCharacter: (reference) => this.stringCharacter(reference),
    });
    this.startHeapVariables();
  }

  /**
   * Reset the machine to its initial state
   */
  reset(): void {
    this.mp = this.bytecode.typedConstants.length;
    this.sp = this.mp - 1;
    this.pendingError = undefined;
    this.inExitChain = false;
    this.pc = this.bytecode.startAddress;
    this.ep = 0;
    this.heap.reset();
    this.low.reset();
    this.ports.reset();
    this.space.reset();
    this.state = MachineState.READY;
    this.exitCode = 0;
    this.output = [];
    this.outputLine = '';
    this.outputChars = 0;
    this.inputPos = 0;
    this.inputColumn = 0;
    this.keyQueue = '';
    this.assemblyResume = undefined;
    this.interruptFrames = [];
    this.idleTick = undefined;
    this.nextTick = 0;
    this.lastScanCode = 0;
    this.instructionCount = 0;
    this.trace = [];
    this.wakeTime = 0;
    this.stringCharacters.clear();
    this.stringBacking.clear();
    this.services.reset();

    // Re-initialize dstore
    this.dstore.fill(0);
    for (let i = 0; i < this.bytecode.typedConstants.length; i++) {
      this.dstore[i] = this.bytecode.typedConstants[i]!;
    }
    // The System unit's variables start again with their own values.
    for (const standard of this.bytecode.standardVariables)
      this.dstore[this.mp + standard.address] = standard.initial;
    this.startHeapVariables();
  }

  /**
   * Run the program until completion or error
   */
  run(): void {
    while (this.state === MachineState.READY || this.state === MachineState.PAUSED || this.state === MachineState.RUNNING) {
      this.runSlice();
    }
  }

  /** Execute a bounded slice, preserving registers when paused or awaiting input. */
  runSlice(budget = 10_000): void {
    if (!Number.isInteger(budget) || budget <= 0) throw new RangeError('Invalid instruction budget');
    if (this.state === MachineState.STOPPED || this.state === MachineState.ERROR) return;
    if (this.state === MachineState.WAITING && !this.tickWhileIdle()) return;
    if (!this.wake()) return;
    this.state = MachineState.RUNNING;
    for (let i = 0; i < budget && this.getState() === MachineState.RUNNING; i += 1) this.step();
    if (this.getState() === MachineState.RUNNING) this.state = MachineState.PAUSED;
  }

  /**
   * Execute a single instruction
   * @returns true if execution should continue, false if stopped
   */
  step(): boolean {
    if (this.state !== MachineState.RUNNING && this.state !== MachineState.PAUSED && this.state !== MachineState.READY) {
      return false;
    }
    this.state = MachineState.RUNNING;

    if (this.pc < 0 || this.pc >= this.bytecode.istore.length) {
      this.state = MachineState.ERROR;
      throw new PascalError('Invalid instruction address', this.getSourceLine());
    }

    // The timer interrupt, when the program handles it, between instructions.
    if ((this.instructionCount & 255) === 0 && this.services.vectors.size && !this.interruptFrames.length) this.timerTick();

    const instruction = this.bytecode.istore[this.pc]!;
    const opcode = inst.getOpcode(instruction);
    const p = inst.getOperand1(instruction);
    const q = inst.getOperand2(instruction);

    if (this.config.debug) {
      this.trace.push(
        `PC=${String(this.pc)} SP=${String(this.sp)} MP=${String(this.mp)}: ${inst.disassemble(instruction)}`
      );
    }

    this.pc++;
    this.instructionCount++;

    try {
      if (this.config.maxInstructions > 0 && this.instructionCount > this.config.maxInstructions) {
        throw new PascalError('Maximum instruction count exceeded');
      }
      this.execute(opcode as Opcode, p, q);
    } catch (error) {
      // As in Turbo Pascal, a run-time error ends the program with its error
      // number as the exit code. One with no Borland number exits with 255.
      const code = describePascalDiagnostic(error, 'runtime').code ?? 255;
      if (error instanceof PascalError) {
        if (error.lineNumber < 1) Object.assign(error, { lineNumber: this.getSourceLine() });
        if (!('sourceFile' in error) && this.getSourceFile()) Object.assign(error, { sourceFile: this.getSourceFile() });
      }
      // With an exit procedure installed, the program first runs its exit
      // procedures, with ExitCode and ErrorAddr set, from the main block.
      const chain = this.bytecode.exitChain;
      if (chain !== undefined && !this.inExitChain && this.standardValue('ExitProc')) {
        this.inExitChain = true;
        this.pendingError = error;
        this.setStandardValue('ExitCode', code);
        this.setStandardValue('ErrorAddr', Math.max(1, this.pc));
        const main = this.bytecode.debugScopes.find((scope) => chain >= scope.start && chain < scope.end);
        this.mp = this.bytecode.typedConstants.length;
        this.sp = this.mp + (main?.frameSize ?? 0) - 1;
        this.pc = chain;
        this.state = MachineState.RUNNING;
        return true;
      }
      this.state = MachineState.ERROR;
      this.exitCode = code;
      throw error;
    }

    return this.getState() === MachineState.RUNNING;
  }

  /**
   * Execute an instruction
   * @param opcode - The operation code
   * @param p - First operand (typically level or type)
   * @param q - Second operand (typically offset or address)
   */
  private execute(opcode: Opcode, p: number, q: number): void {
    switch (opcode) {
      // ==================== Subprogram Linkage ====================

      case Opcode.CUP:
        // Call user procedure
        // p = parameter size, q = procedure address
        this.mp = this.sp - MARK_SIZE - p + 1;
        this.dstore[this.mp + 3] = q; // The routine, whose frame this is
        this.dstore[this.mp + 4] = this.pc; // Save return address
        this.placeFrame(q);
        this.pc = q;
        break;

      case Opcode.CSP:
        // Call standard procedure
        // p = argument count, q = procedure index
        this.callStandardProcedure(p, q);
        break;

      case Opcode.ENT:
        // Entry - set up registers
        // p = register (0=SP, 2=MP), q = amount
        if ((p as Register) === Register.SP) {
          if (this.mp + q > this.stackLimit) throw new PascalError('Stack overflow');
          this.sp = this.mp + q - 1;
        } else if ((p as Register) === Register.EP) {
          this.ep = this.sp + q;
          if (this.ep >= this.np) {
            throw new PascalError('Stack overflow');
          }
        }
        break;

      case Opcode.MST:
        // Mark stack - prepare for procedure call
        // p = static link level difference
        {
          const staticLink = this.base(p);
          this.push(0); // Return value slot
          this.push(staticLink);
          this.push(this.mp); // Dynamic link
          this.push(0); // Extreme pointer (unused)
          this.push(0); // Return address (filled by CUP)
          // Arguments are evaluated in the caller; CUP installs the new frame.
        }
        break;

      case Opcode.RTN:
        // Return from procedure/function
        // p = return type
        {
          const returnValue =
            (p as TypeCode) !== TypeCode.P ? (this.dstore[this.mp] ?? 0) : 0;
          const oldMp = this.mp;
          if (this.interruptFrames.at(-1) === oldMp) this.interruptFrames.pop();
          if (this.idleTick !== undefined) this.returnFromIdleTick(oldMp);
          this.sp = oldMp - 1;
          this.pc = this.dstore[oldMp + 4] as number;
          this.mp = this.dstore[oldMp + 2] as number;
          if ((p as TypeCode) !== TypeCode.P) {
            this.push(returnValue);
          }
        }
        break;

      // ==================== Comparison Operations ====================

      case Opcode.EQU:
        // Equality comparison
        {
          const b = this.pop();
          const a = this.pop();
          this.push((a instanceof Float80 || b instanceof Float80 ? this.compareExtended(a, b) === 0 : a === b) ? 1 : 0);
        }
        break;

      case Opcode.NEQ:
        // Inequality comparison
        {
          const b = this.pop();
          const a = this.pop();
          this.push((a instanceof Float80 || b instanceof Float80 ? this.compareExtended(a, b) !== 0 : a !== b) ? 1 : 0);
        }
        break;

      case Opcode.GRT:
        // Greater than comparison
        {
          if (this.extendedOnTop()) {
            this.push(this.popCompare() > 0 ? 1 : 0);
            break;
          }
          const b = this.popComparable(p);
          const a = this.popComparable(p);
          this.push(a > b ? 1 : 0);
        }
        break;

      case Opcode.GEQ:
        // Greater than or equal comparison
        {
          if (this.extendedOnTop()) {
            this.push(this.popCompare() >= 0 ? 1 : 0);
            break;
          }
          const b = this.popComparable(p);
          const a = this.popComparable(p);
          this.push(a >= b ? 1 : 0);
        }
        break;

      case Opcode.LES:
        // Less than comparison
        {
          if (this.extendedOnTop()) {
            this.push(this.popCompare() < 0 ? 1 : 0);
            break;
          }
          const b = this.popComparable(p);
          const a = this.popComparable(p);
          this.push(a < b ? 1 : 0);
        }
        break;

      case Opcode.LEQ:
        // Less than or equal comparison
        {
          if (this.extendedOnTop()) {
            this.push(this.popCompare() <= 0 ? 1 : 0);
            break;
          }
          const b = this.popComparable(p);
          const a = this.popComparable(p);
          this.push(a <= b ? 1 : 0);
        }
        break;

      // ==================== Integer Arithmetic ====================

      case Opcode.ADI:
        // Add integers
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push((a + b) | 0);
        }
        break;

      case Opcode.SBI:
        // Subtract integers
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push((a - b) | 0);
        }
        break;

      case Opcode.NGI:
        // Negate integer
        {
          const a = this.popNumber();
          this.push(-a | 0);
        }
        break;

      case Opcode.MPI:
        // Multiply integers
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push((a * b) | 0);
        }
        break;

      case Opcode.DVI:
        // Divide integers
        {
          const b = this.popNumber();
          const a = this.popNumber();
          if (b === 0) {
            throw new PascalError('Division by zero');
          }
          this.push(Math.trunc(a / b));
        }
        break;

      case Opcode.MOD:
        // Modulo
        {
          const b = this.popNumber();
          const a = this.popNumber();
          if (b === 0) {
            throw new PascalError('Division by zero');
          }
          this.push(a % b);
        }
        break;

      case Opcode.ABI:
        // Absolute value (integer)
        {
          const a = this.popNumber();
          this.push(Math.abs(a) | 0);
        }
        break;

      case Opcode.SQI:
        // Square (integer)
        {
          const a = this.popNumber();
          this.push((a * a) | 0);
        }
        break;

      case Opcode.INC:
        // Increment
        // p = type code (usually integer)
        {
          const a = this.popNumber();
          this.push(a + 1);
        }
        break;

      case Opcode.DEC:
        // Decrement
        // p = type code (usually integer)
        {
          const a = this.popNumber();
          this.push(a - 1);
        }
        break;

      // ==================== Real Arithmetic ====================

      case Opcode.ADR:
        // Add reals
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a + b);
        }
        break;

      case Opcode.SBR:
        // Subtract reals
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a - b);
        }
        break;

      case Opcode.NGR:
        // Negate real
        {
          const a = this.pop();
          this.push(a instanceof Float80 ? negateReal(a) : -Number(a ?? 0));
        }
        break;

      case Opcode.MPR:
        // Multiply reals
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a * b);
        }
        break;

      case Opcode.DVR:
        // Divide reals
        {
          const b = this.popNumber();
          const a = this.popNumber();
          if (b === 0) {
            throw new PascalError('Division by zero');
          }
          this.push(a / b);
        }
        break;

      case Opcode.ABR:
        // Absolute value (real)
        {
          const a = this.popNumber();
          this.push(Math.abs(a));
        }
        break;

      case Opcode.SQR:
        // Square (real)
        {
          const a = this.popNumber();
          this.push(a * a);
        }
        break;

      // ==================== Boolean Operations ====================

      case Opcode.IOR:
        // Inclusive OR
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a !== 0 || b !== 0 ? 1 : 0);
        }
        break;

      case Opcode.AND:
        // AND
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a !== 0 && b !== 0 ? 1 : 0);
        }
        break;

      case Opcode.XOR:
        // Exclusive OR
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push((a !== 0) !== (b !== 0) ? 1 : 0);
        }
        break;

      case Opcode.NOT:
        // Logical NOT
        {
          const a = this.popNumber();
          this.push(a === 0 ? 1 : 0);
        }
        break;

      // ==================== Set Operations ====================

      case Opcode.INN:
        // Set membership test
        {
          const set = this.popNumber();
          const element = this.popNumber();
          this.push(((set >> element) & 1) !== 0 ? 1 : 0);
        }
        break;

      case Opcode.UNI:
        // Set union
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a | b);
        }
        break;

      case Opcode.INT:
        // Set intersection
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a & b);
        }
        break;

      case Opcode.DIF:
        // Set difference
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a & ~b);
        }
        break;

      case Opcode.CMP:
        // Set complement
        {
          const a = this.popNumber();
          this.push(~a);
        }
        break;

      case Opcode.SGS:
        // Generate singleton set
        {
          const element = this.popNumber();
          this.push(1 << element);
        }
        break;

      // ==================== Jump Operations ====================

      case Opcode.UJP:
        // Unconditional jump
        if (p > 0) {
          const target = this.bytecode.debugScopes.find((scope) => q >= scope.start && q < scope.end);
          if (!target) throw new PascalError('Invalid nonlocal label');
          this.mp = this.base(p);
          this.sp = this.mp + target.frameSize - 1;
        }
        this.pc = q;
        break;

      case Opcode.XJP:
        // Indexed jump
        {
          const index = this.popNumber();
          this.pc = q + index;
        }
        break;

      case Opcode.FJP:
        // Jump if false
        {
          const condition = this.popNumber();
          if (condition === 0) {
            this.pc = q;
          }
        }
        break;

      case Opcode.TJP:
        // Jump if true
        {
          const condition = this.popNumber();
          if (condition !== 0) {
            this.pc = q;
          }
        }
        break;

      // ==================== Conversion Operations ====================

      case Opcode.FLT:
        // Integer to real (top of stack)
        // No-op in JavaScript since all numbers are floats
        break;

      case Opcode.FLO:
        // Integer to real (second entry on stack)
        // No-op in JavaScript since all numbers are floats
        break;

      case Opcode.TRC:
        // Truncate real to integer (also ORD, CHR, RND depending on context)
        {
          const a = this.pop();
          this.push(a instanceof Float80 ? Number(truncReal(a)) : Math.trunc(this.numberOf(a)));
        }
        break;

      // ==================== Termination ====================

      case Opcode.STP: {
        // A program ends with the status ExitCode holds, as Turbo Pascal does.
        this.exitCode = this.standardValue('ExitCode') ?? this.exitCode;
        const pending = this.pendingError;
        this.pendingError = undefined;
        if (pending !== undefined && this.standardValue('ErrorAddr'))
          throw pending instanceof Error ? pending : new PascalError('Run-time error');
        this.state = MachineState.STOPPED;
        break;
      }

      // ==================== Data Reference Operations ====================

      case Opcode.LDA:
        // Load address
        // p = level, q = offset
        this.push(this.base(p) + q);
        break;

      case Opcode.LDC:
        // Load constant
        // p = type, q = constant index
        {
          const value = this.bytecode.getConstant(q);
          this.push(value);
        }
        break;

      case Opcode.LDI:
        // Load indirect
        // p = type
        {
          const address = this.popNumber();
          this.checkAddress(address);
          this.push(this.peek(address));
        }
        break;

      case Opcode.LVA:
      case Opcode.LVB:
      case Opcode.LVC:
      case Opcode.LVI:
      case Opcode.LVR:
      case Opcode.LVS:
        // Load value
        // p = level, q = offset
        {
          const address = this.base(p) + q;
          this.checkAddress(address);
          this.push(this.dstore[address] ?? 0);
        }
        break;

      case Opcode.STI:
        // Store indirect
        // p = type
        {
          const value = this.pop();
          const address = this.popNumber();
          this.checkAddress(address);
          this.poke(address, value);
        }
        break;

      case Opcode.IXA:
        // Indexed address
        // q = element size (stride)
        {
          const index = this.popNumber();
          const address = this.popNumber();
          this.push(address + index * q);
        }
        break;

      default:
        throw new PascalError(`Unknown opcode: 0x${Number(opcode).toString(16)}`);
    }
  }

  /**
   * Push a value onto the stack
   */
  private push(value: StackValue): void {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new PascalError('Invalid numeric result');
    }
    this.sp++;
    if (this.sp >= this.stackLimit) {
      throw new PascalError('Stack overflow');
    }
    this.dstore[this.sp] = value;
  }

  /**
   * Pop a value from the stack
   */
  private pop(): StackValue {
    if (this.sp < 0) {
      throw new PascalError('Stack underflow');
    }
    const value = this.dstore[this.sp];
    this.sp--;
    return value ?? 0;
  }

  /**
   * Pop a number from the stack
   */
  private popNumber(): number {
    const value = this.pop();
    if (typeof value === 'number') {
      return value;
    }
    if (value instanceof Float80) return value.valueOf();
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (typeof value === 'string') {
      return value.charCodeAt(0) || 0;
    }
    return 0;
  }

  /** Whether either of the two values about to be compared is an Extended
   * beyond a double's precision, which is ordered exactly. */
  private extendedOnTop(): boolean {
    const b = this.dstore[this.sp], a = this.dstore[this.sp - 1];
    return (typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null);
  }
  /** Pops two values and compares them exactly: negative, zero or positive. */
  private popCompare(): number {
    const b = this.pop(), a = this.pop();
    return this.compareExtended(a, b);
  }
  private compareExtended(a: StackValue, b: StackValue): number {
    return compareReal(a instanceof Float80 ? a : Number(a ?? 0), b instanceof Float80 ? b : Number(b ?? 0));
  }
  private numberOf(value: StackValue): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') return value.charCodeAt(0) || 0;
    return value instanceof Float80 ? value.valueOf() : 0;
  }
  private popComparable(type: number): number | string {
    return (type as TypeCode) === TypeCode.S || (type as TypeCode) === TypeCode.C ? String(this.pop()) : this.popNumber();
  }

  /** The store as the byte codec reads and writes it: a string's
   * characters past its length, and pointers as segment and offset. */
  private get memory(): MemoryAccess {
    return {
      read: (address) => this.peek(address),
      write: (address, value) => { this.poke(address, value); },
      characters: (address) => (address < this.dstore.length && typeof this.dstore[address] === 'string' ? this.stringBytes(address) : undefined),
      setCharacters: (address, characters) => {
        if (address < this.dstore.length && typeof this.dstore[address] === 'string') this.stringBacking.set(address, characters);
      },
      pointerBits: (value) => this.space.pointerBits(value),
      pointerValue: (bits) => this.space.pointerValue(bits),
    };
  }
  private checkAddress(address: number): void {
    if (!Number.isInteger(address) || address < 0 ||
      (address >= this.dstore.length && address < LINEAR_BASE && !this.stringCharacter(address)) ||
      (address >= VIEW_BASE && !this.space.viewCell(address))) {
      throw new PascalError('Invalid memory address');
    }
  }

  /**
   * Find the base address at a given static level
   * @param level - Number of static levels to traverse
   */
  private base(level: number): number {
    let b = this.mp;
    while (level > 0) {
      const link = this.dstore[b + 1];
      b = typeof link === 'number' ? link : 0;
      level--;
    }
    return b;
  }

  /**
   * Call a standard (built-in) procedure
   * @param argCount - Number of arguments
   * @param procIndex - Procedure index
   */
  private callStandardProcedure(argCount: number, procedureIndex: number): void {
    // Most calls are the compiler's helpers and the machine's services for
    // views and pointers, which neither touch the screen nor do I/O.
    if (procedureIndex >= 1000 || (procedureIndex >= (InternalProcedure.VIEW as number) && procedureIndex <= (InternalProcedure.PORT as number))) {
      this.quickProcedure(argCount, procedureIndex);
      return;
    }
    // Crt's TextAttr, WindMin and WindMax are the screen's own: what the
    // program stored there takes effect, and what the call changed shows.
    const attribute = this.standardValue('TextAttr');
    if (attribute === undefined) {
      this.standardProcedure(argCount, procedureIndex);
      return;
    }
    const screen = this.services.console;
    screen.attribute = attribute & 0xff;
    const min = this.standardValue('WindMin') ?? 0, max = this.standardValue('WindMax') ?? 0;
    if (min !== screen.windMin || max !== screen.windMax)
      screen.window((min & 0xff) + 1, (min >> 8) + 1, (max & 0xff) + 1, (max >> 8) + 1);
    try {
      this.standardProcedure(argCount, procedureIndex);
    } finally {
      this.setStandardValue('TextAttr', screen.attribute);
      this.setStandardValue('WindMin', screen.windMin);
      this.setStandardValue('WindMax', screen.windMax);
      this.setStandardValue('LastMode', screen.lastMode);
    }
  }
  /** A helper or an address service: its arguments, its work, its result. */
  private quickProcedure(argCount: number, procedureIndex: number): void {
    const args: StackValue[] = new Array<StackValue>(argCount);
    for (let i = argCount - 1; i >= 0; i -= 1) args[i] = this.pop();
    switch (procedureIndex) {
      case InternalProcedure.VIEW as number:
        this.push(this.space.view(args.map(Number)));
        return;
      case InternalProcedure.RETYPE as number:
        this.push(this.space.retype(Number(args[0]), Number(args[1])));
        return;
      case InternalProcedure.NORMALIZE_POINTERS as number: {
        const a = args[0] ?? 0, b = args[1] ?? 0;
        // Nil, and two cells, are what they are: no other form names their bytes.
        const plain = a === 0 || b === 0 || a === b ||
          (typeof a === 'number' && typeof b === 'number' && a < this.dstore.length && b < this.dstore.length);
        this.push(plain ? a : this.space.normalize(a));
        this.push(plain ? b : this.space.normalize(b));
        return;
      }
      case InternalProcedure.PORT as number:
        this.push(PORT_BASE + (Number(args[1]) === 2 ? 0x10000 : 0) + (Number(args[0]) & 0xffff));
        return;
    }
    const procedure = this.bytecode.native?.procedures[procedureIndex] ?? this.native.procedures[procedureIndex];
    if (!procedure) throw new PascalError(`Unsupported standard procedure: ${String(procedureIndex)}`);
    const result = procedure(...args);
    if (typeof result === 'number' && !Number.isFinite(result)) throw new PascalError('Invalid numeric result');
    if (result !== undefined && result !== null) this.push(result as StackValue);
  }
  private standardProcedure(argCount: number, procedureIndex: number): void {
    if (procedureIndex === (InternalProcedure.ASSEMBLY as number)) {
      this.runAssembly(argCount);
      return;
    }
    const procIndex = procedureIndex as BuiltinProcedure | CrtProcedure;
    // Plain Write, Read, Eof and Eoln use Output and Input. A program that has
    // assigned one of them to a file on the drive reaches that file instead.
    const plainRead = [BuiltinProcedure.READ, BuiltinProcedure.READLN, BuiltinProcedure.EOF, BuiltinProcedure.EOLN, BuiltinProcedure.SEEKEOF, BuiltinProcedure.SEEKEOLN].includes(procIndex as BuiltinProcedure);
    const plainWrite = procIndex === BuiltinProcedure.WRITE || procIndex === BuiltinProcedure.WRITELN;
    const eofLike = [BuiltinProcedure.EOF, BuiltinProcedure.EOLN, BuiltinProcedure.SEEKEOF, BuiltinProcedure.SEEKEOLN].includes(procIndex as BuiltinProcedure);
    if ((plainWrite || plainRead) && !(eofLike && argCount > 0)) {
      const standard = this.standardAddress(plainWrite ? 'Output' : 'Input');
      if (standard !== undefined && !this.services.files.isConsole(standard, plainWrite ? 'write' : 'read')) {
        for (let at = this.sp; at > this.sp - argCount; at--) this.dstore[at + 1] = this.dstore[at] ?? 0;
        this.dstore[this.sp - argCount + 1] = standard;
        this.sp++;
        const file = procIndex === BuiltinProcedure.WRITE ? 70 : procIndex === BuiltinProcedure.WRITELN ? 71
          : procIndex === BuiltinProcedure.READ ? 72 : procIndex === BuiltinProcedure.READLN ? 73 : procedureIndex;
        this.standardProcedure(argCount + 1, file);
        return;
      }
    }
    // A text file on the console, such as Input and Output or one assigned to
    // '': the machine reads and writes it, so a read waits for input as the
    // console forms do.
    if ([25, 26, 70, 71, 72, 73, 97, 98].includes(procedureIndex) && argCount >= 1) {
      const file = Number(this.dstore[this.sp - argCount + 1]);
      const writing = procedureIndex === 70 || procedureIndex === 71;
      if (this.services.files.isConsole(file, writing ? 'write' : 'read')) {
        if (writing) {
          const text: StackValue[] = [];
          for (let i = 1; i < argCount; i += 1) text.unshift(this.pop());
          this.pop();
          this.writeOutput(text.map((value) => String(value ?? '')).join('') + (procedureIndex === 71 ? '\n' : ''));
        } else if ((procedureIndex === 72 || procedureIndex === 73) && this.services.files.isKeyboard(file)) {
          this.keyboardRead(argCount - 1);
        } else if (procedureIndex === 72 || procedureIndex === 73) {
          this.consoleRead(argCount - 1, procedureIndex === 73, 1);
        } else {
          this.pop();
          this.standardProcedure(0, procedureIndex);
        }
        return;
      }
    }
    if ([BuiltinProcedure.READ, BuiltinProcedure.READLN, BuiltinProcedure.WRITE, BuiltinProcedure.WRITELN].includes(procIndex as BuiltinProcedure) && this.services.files.pendingError) {
      const callAddress = this.pc - 1;
      if (this.bytecode.ioChecks[callAddress] ?? true) throw new PascalError(`I/O error ${String(this.services.files.pendingError)}`);
      this.sp -= argCount;
      this.pc = this.bytecode.ioErrorTargets[callAddress] ?? this.pc;
      return;
    }
    if (procIndex === BuiltinProcedure.READ || procIndex === BuiltinProcedure.READLN) {
      this.consoleRead(argCount, procIndex === BuiltinProcedure.READLN, 0);
      return;
    }
    if ((procIndex === CrtProcedure.KEYPRESSED || procIndex === CrtProcedure.READKEY) && !this.services.console.active)
      this.services.console.touch();
    if (procIndex === CrtProcedure.READKEY && !this.keyQueue.length && this.inputPos >= this.input.length) {
      this.pc -= 1;
      this.instructionCount -= 1;
      this.state = MachineState.WAITING;
      return;
    }
    const args: StackValue[] = [];
    for (let i = 0; i < argCount; i += 1) args.unshift(this.pop());

    if (procedureIndex === (InternalProcedure.STRING_CHARACTER_ADDRESS as number)) {
      this.push(this.stringCharacterAddress(Number(args[0]), Number(args[1]), Number(args[2])));
      return;
    }
    if (procedureIndex === (InternalProcedure.COPY_TO_HEAP as number)) {
      const source = Number(args[0]), words = Number(args[1]);
      const copy = this.allocate(words, []);
      for (let cell = 0; cell < words; cell++) {
        this.checkAddress(source + cell);
        const value = this.peek(source + cell);
        const bytes = typeof value === 'string' ? this.stringBytes(source + cell) : undefined;
        this.poke(copy + cell, value);
        if (bytes !== undefined) this.stringBacking.set(copy + cell, bytes);
      }
      this.push(copy);
      return;
    }
    if (procedureIndex === (InternalProcedure.VARIANT_SYNC as number)) {
      this.variants.sync(Number(args[0]), Number(args[1]), Number(args[2]));
      return;
    }
    if (procedureIndex === (InternalProcedure.VARIANT_REFRESH as number)) {
      for (const { part, offset } of this.bytecode.variantRefreshes[Number(args[1])] ?? []) this.variants.refresh(Number(args[0]) + offset, part);
      return;
    }
    if (procedureIndex === (InternalProcedure.FREE_HEAP_COPY as number)) {
      this.free(Number(args[0]));
      return;
    }
    if (procedureIndex === (InternalProcedure.COPY_AGGREGATE_CELL as number) ||
      procedureIndex === (InternalProcedure.LOAD_AGGREGATE_CELL as number)) {
      const loading = procedureIndex === (InternalProcedure.LOAD_AGGREGATE_CELL as number);
      const source = Number(args[loading ? 0 : 1]);
      this.checkAddress(source);
      const value = this.peek(source);
      const bytes = typeof value === 'string' ? this.stringBytes(source) : undefined;
      const destination = loading ? this.sp + 1 : Number(args[0]);
      if (loading) this.push(value);
      else this.poke(destination, value);
      if (bytes === undefined) this.stringBacking.delete(destination);
      else this.stringBacking.set(destination, bytes);
      return;
    }

    switch (procIndex) {
      case BuiltinProcedure.WRITE:
      case BuiltinProcedure.WRITELN:
        this.writeOutput(args.map((value) => typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value ?? '')).join(''));
        if (procIndex === BuiltinProcedure.WRITELN) this.writeOutput('\n');
        return;
      case BuiltinProcedure.HALT: {
        // A bare Halt is Halt(0), even after the program assigned ExitCode.
        const code = args[0];
        this.exitCode = typeof code === 'number' ? Math.trunc(code) : 0;
        this.setStandardValue('ExitCode', this.exitCode & 0xffff);
        // Stop as the program's end does. DOS leaves any sound playing, so
        // unlike halt() this does not silence the speaker.
        this.state = MachineState.STOPPED;
        return;
      }
      case BuiltinProcedure.EOF:
        if (args.length) break;
        this.push(this.inputPos >= this.input.length ? 1 : 0);
        return;
      case BuiltinProcedure.SEEKEOF:
      case BuiltinProcedure.SEEKEOLN: {
        if (args.length) break;
        // Skip blanks, and for SeekEof whole line ends, in the console input.
        const seekEof = procIndex === BuiltinProcedure.SEEKEOF;
        for (;;) {
          const line = this.input[this.inputPos];
          if (line === undefined) break;
          while (this.inputColumn < line.length && /[ \t]/.test(line[this.inputColumn]!)) this.inputColumn++;
          if (!seekEof || this.inputColumn < line.length) break;
          this.inputPos++;
          this.inputColumn = 0;
        }
        const line = this.input[this.inputPos];
        this.push(line === undefined || (!seekEof && this.inputColumn >= line.length) ? 1 : 0);
        return;
      }
      case BuiltinProcedure.EOLN:
        if (args.length) break;
        this.push(this.inputPos >= this.input.length || this.inputColumn >= (this.input[this.inputPos]?.length ?? 0) ? 1 : 0);
        return;
      case CrtProcedure.CLRSCR:
        this.output = [];
        this.outputLine = '';
        this.outputChars = 0;
        this.services.console.clear();
        return;
      case CrtProcedure.KEYPRESSED:
        this.push(this.keyQueue.length || this.inputPos < this.input.length ? 1 : 0);
        return;
      case CrtProcedure.READKEY:
        this.push(this.takeKey());
        return;
    }
    const service = this.services.invoke(procedureIndex, args, this.bytecode.ioChecks[this.pc - 1] ?? true);
    if (service) {
      if (service.ioError) this.pc = this.bytecode.ioErrorTargets[this.pc - 1] ?? this.pc;
      if (service.dosError !== undefined) this.setStandardValue('DosError', service.dosError);
      if (service.result !== undefined) this.push(service.result);
      if (service.delay !== undefined && service.delay > 0) {
        this.wakeTime = Date.now() + service.delay;
        this.state = MachineState.SLEEPING;
      }
      return;
    }
    // Check if there's a native procedure registered
    const procedure = this.bytecode.native?.procedures[procIndex] ?? this.native.procedures[procIndex];
    if (procedure) {
      const result = procedure(...args);
      if (typeof result === 'number' && !Number.isFinite(result)) throw new PascalError('Invalid numeric result');
      if (result !== undefined && result !== null) {
        this.push(result as StackValue);
      }
      return;
    }
    throw new PascalError(`Unsupported standard procedure: ${String(procIndex)}`);
  }

  private writeOutput(text: string): void {
    if (this.outputChars + text.length > this.config.maxOutputChars) throw new PascalError('Maximum output size exceeded');
    this.outputChars += text.length;
    this.services.console.write(text);
    const parts = decodeDosText(text).replace(/\r\n/g, '\n').split('\n');
    this.outputLine += parts[0] ?? '';
    for (let i = 1; i < parts.length; i += 1) {
      this.output.push(this.outputLine);
      this.outputLine = parts[i] ?? '';
    }
  }

  /** Read address/type pairs atomically so a suspended read never loses arguments. */
  /** Read from the console into the targets on top of the stack, below which
   * `extra` cells (a file variable) also belong to the call. Without input
   * yet, the instruction is retried with its arguments intact. */
  private consoleRead(argCount: number, wholeLine: boolean, extra: number): void {
    const callAddress = this.pc - 1;
    const checked = this.bytecode.ioChecks[callAddress] ?? true;
    try {
      if (!this.readInput(argCount, wholeLine)) {
        this.pc -= 1;
        this.instructionCount -= 1;
        this.state = MachineState.WAITING;
        return;
      }
      this.sp -= extra;
    } catch (error) {
      this.services.files.recordError(error, checked, true);
      this.sp -= argCount + extra;
      this.inputPos++;
      this.inputColumn = 0;
      this.pc = this.bytecode.ioErrorTargets[callAddress] ?? this.pc;
    }
  }
  /** What an asm block reaches through the machine. */
  private assemblyHost(): AsmHost {
    return {
      read: (address) => this.peek(address),
      write: (address, value) => {
        this.checkAddress(address);
        this.poke(address, value);
      },
      output: (text) => {
        this.writeOutput(text);
      },
      keysAvailable: () => this.keysAvailable(),
      takeKey: () => this.takeKey(),
      peekKey: () => {
        if (this.keyQueue.length) return this.keyQueue.charAt(0);
        if (this.inputPos >= this.input.length) return undefined;
        return this.input[this.inputPos]?.[this.inputColumn] ?? '\r';
      },
      console: this.services.console,
      graphics: this.services.graphics,
      sound: (frequency) => {
        this.config.onSound(frequency);
      },
      now: () => new Date(),
      handles: (number) => this.handler(number) !== undefined,
      scanCode: () => this.lastScanCode,
      readLinear: (linear, length) => this.space.readLinear(linear, length),
      writeLinear: (linear, bytes) => { this.space.writeLinear(linear, bytes); },
      linearPointer: (linear) => LINEAR_BASE + linear,
    };
  }
  /** The program's interrupt procedure for an interrupt, if it set one. */
  private handler(number: number): { address: number; parameters: number } | undefined {
    const vector = this.services.vectors.get(number);
    return vector === undefined ? undefined : this.bytecode.interruptHandlers[vector];
  }
  /** Call the program's interrupt procedure, as the interrupt would, to
   * return to `returnPc`. Its parameters are the registers it declares. */
  private callInterrupt(number: number, returnPc: number, registers: number[] = []): number | undefined {
    const handler = this.handler(number);
    if (!handler) return undefined;
    this.push(0);
    this.push(this.bytecode.typedConstants.length);
    this.push(this.mp);
    this.push(0);
    this.push(0);
    for (let index = 12 - handler.parameters; index < 12; index++) this.push(registers[index] ?? 0);
    this.mp = this.sp - MARK_SIZE - handler.parameters + 1;
    this.dstore[this.mp + 3] = handler.address;
    this.dstore[this.mp + 4] = returnPc;
    this.placeFrame(handler.address);
    this.pc = handler.address;
    this.interruptFrames.push(this.mp);
    return this.mp;
  }
  /** Interrupts 08h and 1Ch, when the program handles them. */
  private timerTick(): number | undefined {
    const now = Date.now();
    if (now < this.nextTick) return undefined;
    this.nextTick = now + 55;
    return this.callInterrupt(0x08, this.pc) ?? this.callInterrupt(0x1c, this.pc);
  }
  /** When the timer interrupt next comes, if the program handles it. It
   * comes while the program waits for a key or in Delay too, as the PC's
   * timer interrupts the BIOS's keyboard wait and Delay's loop, so the host
   * runs the machine then. */
  nextTimerTick(): number | undefined {
    if (this.handler(0x08) === undefined && this.handler(0x1c) === undefined) return undefined;
    return Math.max(this.nextTick, Date.now());
  }
  /** The timer's interrupt while the program waits: its interrupt
   * procedure runs, and then the program waits again, for the key in
   * ReadKey or Read, or for the rest of its Delay. An asm block waiting for
   * a key keeps its registers, so it waits on undisturbed. */
  tickWhileIdle(): boolean {
    if (this.interruptFrames.length || this.nextTimerTick() === undefined || Date.now() < this.nextTick) return false;
    const instruction = this.bytecode.istore[this.pc];
    if (this.state === MachineState.WAITING && instruction !== undefined && inst.getOpcode(instruction) === (Opcode.CSP as number) &&
      inst.getOperand2(instruction) === (InternalProcedure.ASSEMBLY as number)) return false;
    const sleeping = this.state === MachineState.SLEEPING ? this.wakeTime : undefined;
    const frame = this.timerTick();
    if (frame === undefined) return false;
    this.idleTick = { frame, sleeping };
    this.state = MachineState.PAUSED;
    return true;
  }
  /** Raise an interrupt the program handles, before its next instruction.
   * False when no interrupt procedure handles it. */
  raiseInterrupt(number: number): boolean {
    if (this.state === MachineState.STOPPED || this.state === MachineState.ERROR) return false;
    return this.callInterrupt(number, this.pc) !== undefined;
  }
  /** Run an asm block. Its arguments are its variables' addresses, then the
   * block's number; an assembler function's result is left on the stack. */
  private runAssembly(argCount: number): void {
    const block = this.bytecode.assembly[Number(this.dstore[this.sp])];
    if (!block) throw new PascalError('Invalid assembler block');
    // An inline routine's arguments come first; its code pops them.
    const values = block.stackArguments ?? [];
    const args: number[] = [];
    for (let i = values.length; i < argCount - 1; i++) args.push(Number(this.dstore[this.sp - argCount + 1 + i]));
    const call = this.pc - 1;
    const saved = this.assemblyResume?.pc === call && this.assemblyResume.sp === this.sp ? this.assemblyResume : undefined;
    this.assemblyResume = undefined;
    if (!this.services.console.active) this.services.console.touch();
    const cpu = new Asm86(block, args, this.assemblyHost(), saved?.state);
    if (!saved)
      values.forEach((size, index) => {
        const value = this.dstore[this.sp - argCount + 1 + index];
        const number = typeof value === 'string' ? value.charCodeAt(0) || 0 : Number(value);
        if (size === 4) cpu.state.stack.push((number >>> 16) & 0xffff, number & 0xffff);
        else cpu.state.stack.push(number & 0xffff);
      });
    // Back from an interrupt procedure: its register parameters are still
    // in its frame, just above the stack.
    if (saved?.handler) {
      const { mp, parameters, registers } = saved.handler;
      const after = [...registers];
      for (let index = 0; index < parameters; index++) after[12 - parameters + index] = Number(this.dstore[mp + MARK_SIZE + index] ?? 0);
      cpu.restoreRegisters(registers, after);
    }
    const outcome = cpu.run(ASSEMBLY_SLICE);
    this.instructionCount += cpu.executed;
    if (this.config.maxInstructions > 0 && this.instructionCount > this.config.maxInstructions)
      throw new PascalError('Maximum instruction count exceeded');
    const suspend = (key = false) => {
      this.assemblyResume = { pc: call, sp: this.sp, state: cpu.state, key };
      this.pc = call;
    };
    switch (outcome.kind) {
      case 'done':
        this.sp -= argCount;
        if (outcome.result) this.push(outcome.result[0] as StackValue);
        return;
      case 'key':
        suspend(true);
        this.instructionCount -= 1;
        this.state = MachineState.WAITING;
        return;
      case 'yield':
        suspend();
        this.state = MachineState.PAUSED;
        return;
      case 'delay':
        suspend();
        this.wakeTime = Date.now() + outcome.milliseconds;
        this.state = MachineState.SLEEPING;
        return;
      case 'halt':
        this.haltProgram(outcome.code);
        return;
      case 'interrupt': {
        const registers = cpu.registerValues();
        suspend();
        const mp = this.callInterrupt(outcome.number, call, registers)!;
        this.assemblyResume!.handler = { mp, parameters: this.handler(outcome.number)!.parameters, registers };
      }
    }
  }
  /** End the program as Halt does: through its exit procedures, from the
   * main block, with ExitCode set. */
  private haltProgram(code: number): void {
    this.exitCode = code;
    this.setStandardValue('ExitCode', code & 0xffff);
    const chain = this.bytecode.exitChain;
    if (chain === undefined) {
      this.state = MachineState.STOPPED;
      return;
    }
    const main = this.bytecode.debugScopes.find((scope) => chain >= scope.start && chain < scope.end);
    this.mp = this.bytecode.typedConstants.length;
    this.sp = this.mp + (main?.frameSize ?? 0) - 1;
    this.pc = chain;
  }
  /** The next key: one pressed, or else the next character of the typed
   * input, where an empty line is Enter. */
  private takeKey(): string {
    if (this.keyQueue.length) {
      const key = this.keyQueue.charAt(0);
      this.keyQueue = this.keyQueue.slice(1);
      return key;
    }
    const line = this.input[this.inputPos] ?? '';
    const key = line[this.inputColumn] ?? '\r';
    this.inputColumn += 1;
    if (this.inputColumn >= line.length) {
      this.inputPos += 1;
      this.inputColumn = 0;
    }
    return key;
  }
  /** How many keys takeKey can give without waiting. */
  private keysAvailable(): number {
    let keys = this.keyQueue.length;
    for (let line = this.inputPos; line < this.input.length; line++)
      keys += Math.max(1, this.input[line]?.length ?? 0) - (line === this.inputPos ? this.inputColumn : 0);
    return keys;
  }
  /** Read(Kbd, ...): each character takes one key, as it is pressed and
   * without echo. Without enough keys yet, the call waits as ReadKey does. */
  private keyboardRead(argCount: number): void {
    const targets: number[] = [];
    for (let i = 0; i < argCount; i += 2) {
      if (Number(this.dstore[this.sp - argCount + i + 2]) !== (TypeCode.C as number))
        throw new PascalError('Only characters can be read from the keyboard');
      targets.push(Number(this.dstore[this.sp - argCount + i + 1]));
    }
    if (!this.services.console.active) this.services.console.touch();
    if (this.keysAvailable() < targets.length) {
      this.pc -= 1;
      this.instructionCount -= 1;
      this.state = MachineState.WAITING;
      return;
    }
    for (const target of targets) {
      this.checkAddress(target);
      this.poke(target, this.takeKey());
    }
    this.sp -= argCount + 1;
  }
  /** The address of one of the System unit's variables, by name. */
  private standardAddress(name: string): number | undefined {
    const address = this.standardCells.get(name);
    // They live in the main program's frame, whichever routine is running.
    return address === undefined ? undefined : this.bytecode.typedConstants.length + address;
  }
  private readInput(argCount: number, wholeLine: boolean): boolean {
    if (argCount % 2 !== 0) throw new PascalError('Invalid input argument list');
    let pos = this.inputPos;
    let col = this.inputColumn;
    const values: { address: number; value: StackValue }[] = [];
    for (let i = 0; i < argCount; i += 2) {
      const address = Number(this.dstore[this.sp - argCount + i + 1]);
      const type = Number(this.dstore[this.sp - argCount + i + 2]) as TypeCode;
      this.checkAddress(address);
      if (pos >= this.input.length) return false;
      let line = this.input[pos] ?? '';
      let value: StackValue;
      if (type === TypeCode.S) {
        value = line.slice(col);
        col = line.length;
      } else if (type === TypeCode.C) {
        value = line[col] ?? '\n';
        col += 1;
        if (col > line.length) { pos += 1; col = 0; }
      } else {
        for (;;) {
          while (col < line.length && /\s/.test(line[col] ?? '')) col += 1;
          if (col < line.length) break;
          pos += 1;
          col = 0;
          if (pos >= this.input.length) return false;
          line = this.input[pos] ?? '';
        }
        const start = col;
        while (col < line.length && !/\s/.test(line[col] ?? '')) col += 1;
        const token = line.slice(start, col);
        if (type === TypeCode.I) {
          if (!/^[+-]?\d+$/.test(token)) throw new PascalError(`Invalid integer input: ${token}`);
          value = Number(token);
          if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) throw new PascalError('Integer input out of range');
        } else if (type === TypeCode.R) {
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) throw new PascalError(`Invalid real input: ${token}`);
          // Read exactly, to Extended's 64 bits; the store rounds it to the
          // variable's type.
          try {
            value = parseReal(token) ?? 0;
          } catch {
            throw new PascalError('Real input out of range');
          }
        } else if (type === TypeCode.B) {
          if (!/^(true|false)$/i.test(token)) throw new PascalError(`Invalid boolean input: ${token}`);
          value = token.toLowerCase() === 'true' ? 1 : 0;
        } else throw new PascalError('Unsupported input type');
      }
      values.push({ address, value });
    }
    if (wholeLine) {
      if (pos >= this.input.length) return false;
      pos += 1;
      col = 0;
    }
    for (const { address, value } of values) this.poke(address, value);
    this.sp -= argCount;
    this.inputPos = pos;
    this.inputColumn = col;
    return true;
  }

  /**
   * Set input for Read/ReadLn operations
   * @param lines - Array of input lines
   */
  setInput(lines: string[]): void {
    this.input = lines.map(encodeDosText);
    this.inputPos = 0;
    this.inputColumn = 0;
    if (this.state === MachineState.WAITING) this.state = MachineState.PAUSED;
  }

  /** Supply one interactive line without resetting execution or earlier input. */
  provideInput(line: string, echo = false): void {
    const bytes = encodeDosText(line);
    this.input.push(bytes);
    if (echo) this.writeOutput(`${bytes}\n`);
    if (this.state === MachineState.WAITING) this.state = MachineState.PAUSED;
  }

  /** Queue Unicode key text, or one raw DOS extended-key pair (NUL + scan byte). */
  provideKey(text: string): void {
    if (!text.length) return;
    const bytes = text.length === 2 && text.charCodeAt(0) === 0 && text.charCodeAt(1) <= 255
      ? text
      : encodeDosText(text);
    this.keyQueue += bytes;
    this.lastScanCode = bytes.charCodeAt(0) === 0 ? bytes.charCodeAt(1) : scanCode(bytes.charAt(0));
    if (this.state === MachineState.WAITING && this.getInputMode() === 'key')
      this.state = MachineState.PAUSED;
    // A program's keyboard interrupt procedure hears each key.
    if (this.handler(9)) this.raiseInterrupt(9);
  }

  /**
   * Get the program output
   */
  getOutput(): string[] {
    return this.outputLine ? [...this.output, this.outputLine] : [...this.output];
  }

  /**
   * Get the current execution state
   */
  getState(): MachineState {
    return this.state;
  }

  /**
   * Get the current program counter
   */
  getPC(): number {
    return this.pc;
  }

  getSourceLine(): number {
    return this.bytecode.sourceLines[Math.max(0, this.pc - 1)] ?? -1;
  }

  getNextSourceLine(): number { return this.bytecode.sourceLines[this.pc] ?? -1; }
  getSourceFile(): string | undefined { return this.bytecode.sourceFiles[Math.max(0, this.pc - 1)]; }
  getRegisters(): { pc: number; sp: number; mp: number; np: number; ep: number } {
    return { pc: this.pc, sp: this.sp, mp: this.mp, np: this.np, ep: this.ep };
  }
  getConsole() { return this.services.console; }
  getGraphics() { return this.services.graphics; }
  getFileSystem() { return this.config.fileSystem; }
  getWakeTime(): number { return this.wakeTime; }
  /** Memory at a segment and offset, as Mem, MemW and MemL reach it: a
   * little-endian number of `bytes` bytes, read or written. */
  readMemory(segment: number, offset: number, bytes: number): number {
    const linear = ((segment & 0xffff) * 16 + (offset & 0xffff)) % 0x100000;
    return Array.from(this.space.readLinear(linear, bytes)).reduceRight((value, byte) => value * 256 + byte, 0);
  }
  writeMemory(segment: number, offset: number, bytes: number, value: number): void {
    const linear = ((segment & 0xffff) * 16 + (offset & 0xffff)) % 0x100000;
    this.space.writeLinear(linear, Uint8Array.from({ length: bytes }, (_, index) => Math.floor(value / 256 ** index) & 0xff));
  }
  /** Ptr: the pointer a segment and offset make. */
  pointerTo(segment: number, offset: number): number {
    return this.space.pointer(segment, offset);
  }
  wake(): boolean {
    if (this.state !== MachineState.SLEEPING) return true;
    if (Date.now() < this.wakeTime) return this.tickWhileIdle();
    this.state = MachineState.PAUSED;
    return true;
  }
  getInputMode(): 'key' | 'line' {
    const instruction = this.bytecode.istore[this.pc];
    if (instruction === undefined || inst.getOpcode(instruction) !== (Opcode.CSP as number)) return 'line';
    const procedure = inst.getOperand2(instruction), argCount = inst.getOperand1(instruction);
    if (procedure === (CrtProcedure.READKEY as number)) return 'key';
    if (procedure === (InternalProcedure.ASSEMBLY as number)) return this.assemblyResume?.key ? 'key' : 'line';
    // Read(Kbd, ...) waits for keys, not a line.
    return (procedure === 72 || procedure === 73) && argCount >= 1 &&
      this.services.files.isKeyboard(Number(this.dstore[this.sp - argCount + 1])) ? 'key' : 'line';
  }
  /** Stable character references preserve aliasing across VAR calls and input. */
  /** A character within a string, from an address @S[I] produced. The
   * reference is linear in the index, so a PChar walking the string stays
   * within it; the capacity of one taken earlier bounds a write. */
  private stringCharacter(reference: number): { address: number; index: number; capacity: number } | undefined {
    const known = this.stringCharacters.get(reference);
    if (known) return known;
    if (!Number.isInteger(reference) || reference < this.dstore.length || reference >= LINEAR_BASE) return undefined;
    const offset = reference - this.dstore.length;
    const address = Math.floor(offset / 256),
      index = offset % 256;
    if (address >= this.dstore.length || typeof this.dstore[address] !== 'string') return undefined;
    const capacity = this.stringCharacters.get(reference - index)?.capacity ?? 255;
    return index > capacity ? undefined : { address, index, capacity };
  }

  stringCharacterAddress(address: number, index: number, capacity: number): number {
    this.checkAddress(address);
    if (address >= this.dstore.length || !Number.isInteger(capacity) || capacity < 0 || capacity > 255 ||
      !Number.isInteger(index) || index < 0 || index > capacity)
      throw new PascalError('String index out of bounds');
    const reference = this.dstore.length + address * 256 + index;
    this.stringCharacters.set(reference, { address, index, capacity });
    return reference;
  }

  private stringBytes(address: number): string {
    const current = this.dstore[address];
    const text = typeof current === 'string' ? current : '';
    const previous = this.stringBacking.get(address) ?? '';
    return text + previous.slice(text.length);
  }

  poke(address: number, value: StackValue): void {
    this.checkAddress(address);
    if (address >= VIEW_BASE) {
      this.space.poke(address, value);
      return;
    }
    if (address >= PORT_BASE) {
      const port = address - PORT_BASE;
      this.ports.write(port & 0xffff, Number(value), port >= 0x10000 ? 2 : 1);
      return;
    }
    if (address >= LINEAR_BASE) {
      this.space.pokeLinear(address, value);
      return;
    }
    const character = this.stringCharacter(address);
    if (character) {
      const text = String(this.dstore[character.address] ?? '');
      let bytes = this.stringBytes(character.address).padEnd(character.capacity, '\0');
      if (character.index === 0) {
        const length = String(value).charCodeAt(0);
        if (length > character.capacity) throw new PascalError('String length exceeds capacity');
        this.dstore[character.address] = bytes.slice(0, length);
      } else {
        bytes = bytes.slice(0, character.index - 1) + (String(value).charAt(0) || '\0') + bytes.slice(character.index);
        this.dstore[character.address] = bytes.slice(0, text.length);
      }
      this.stringBacking.set(character.address, bytes);
      return;
    }
    if (typeof value === 'string') this.stringBacking.set(address, value + this.stringBytes(address).slice(value.length));
    else this.stringBacking.delete(address);
    this.dstore[address] = value;
  }

  /** A heap block of `words` cells holding `bytes` bytes, the cells set to
   * `defaults`; a typed one knows how its bytes lie. */
  private allocate(words: number, defaults: StackValue[], bytes = words, type?: BlockType & { map?: number }): number {
    const address = this.heap.allocate(words, bytes, type, type?.map);
    for (let i = 0; i < words; i++) this.dstore[address + i] = defaults[i] ?? 0;
    this.setStandardValue('HeapPtr', this.space.heapPointer(this.heap.pointer));
    return address;
  }
  /** A timer interrupt that came during Delay: the delay goes on. */
  private returnFromIdleTick(frame: number): void {
    if (this.idleTick?.frame !== frame) return;
    const until = this.idleTick.sleeping;
    this.idleTick = undefined;
    if (until !== undefined && Date.now() < until) {
      this.wakeTime = until;
      this.state = MachineState.SLEEPING;
    }
  }
  /** A new frame's bytes lie below its caller's. */
  private placeFrame(routine: number): void {
    const caller = Number(this.dstore[this.mp + 2] ?? 0);
    const below = caller > this.globalBase ? (this.frameLinear[caller] ?? 0) : STACK_SEGMENT * 16 + STACK_TOP;
    this.frameLinear[this.mp] = below - (this.bytecode.frames[routine]?.bytes ?? 0);
  }
  /** HeapOrg and HeapEnd bound the heap, which grows down from HeapOrg;
   * HeapPtr follows its top. */
  private startHeapVariables(): void {
    this.setStandardValue('HeapOrg', this.space.heapPointer(0));
    this.setStandardValue('HeapEnd', this.space.heapPointer(this.heap.size));
    this.setStandardValue('HeapPtr', this.space.heapPointer(this.heap.pointer));
  }
  /** One of the System unit's variables, by name. */
  private standardValue(name: string): number | undefined {
    const address = this.standardAddress(name);
    return address === undefined ? undefined : Number(this.dstore[address] ?? 0);
  }
  private setStandardValue(name: string, value: number): void {
    const address = this.standardAddress(name);
    if (address !== undefined) this.dstore[address] = value;
  }
  /** Release, which drops every block above a HeapPtr Mark recorded. */
  private releaseHeap(pointer: number): void {
    this.heap.release(this.space.heapOffset(pointer));
    this.setStandardValue('HeapPtr', this.space.heapPointer(this.heap.pointer));
  }
  private free(address: number): void {
    this.heap.free(this.space.blockStart(address));
    this.setStandardValue('HeapPtr', this.space.heapPointer(this.heap.pointer));
  }

  /**
   * Get the current stack pointer
   */
  getSP(): number {
    return this.sp;
  }

  /**
   * Get the current mark pointer
   */
  getMP(): number {
    return this.mp;
  }

  /**
   * Get the number of instructions executed
   */
  getInstructionCount(): number {
    return this.instructionCount;
  }

  /**
   * Get the debug trace log
   */
  getTrace(): string[] {
    return [...this.trace];
  }

  /**
   * Get the value at a stack address
   * @param address - The stack address
   */
  peek(address: number): StackValue {
    if (address < this.dstore.length) return this.dstore[address] ?? 0;
    if (address >= VIEW_BASE) return this.space.peek(address) ?? 0;
    if (address >= PORT_BASE) {
      const port = address - PORT_BASE;
      return this.ports.read(port & 0xffff, port >= 0x10000 ? 2 : 1);
    }
    if (address >= LINEAR_BASE) return this.space.peekLinear(address);
    const character = this.stringCharacter(address);
    if (character) {
      const text = String(this.dstore[character.address] ?? '');
      return character.index === 0 ? String.fromCharCode(text.length)
        : this.stringBytes(character.address).charAt(character.index - 1) || '\0';
    }
    return this.dstore[address] ?? 0;
  }

  /**
   * Get a range of stack values
   * @param start - Start address
   * @param count - Number of values to get
   */
  peekRange(start: number, count: number): StackValue[] {
    const result: StackValue[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.dstore[start + i] ?? 0);
    }
    return result;
  }

  /**
   * The exit status the program ends with: the low byte of ExitCode, which is
   * what DOS reports in ERRORLEVEL. Meaningful once the machine has stopped
   * or failed with a run-time error.
   */
  getExitCode(): number {
    return this.exitCode & 0xff;
  }

  /**
   * Halt execution immediately
   */
  halt(): void {
    this.state = MachineState.STOPPED;
    this.config.onSound(0);
  }
}

export default Machine;
