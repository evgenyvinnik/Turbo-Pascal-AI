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

/**
 * Stack value type - can hold numbers, strings, or booleans
 */
export type StackValue = number | string | boolean | null;

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
  /** Machine has stopped */
  STOPPED = 'stopped',
  /** Machine encountered an error */
  ERROR = 'error',
}

/**
 * Configuration options for the Machine
 */
export interface MachineConfig {
  /** Stack size in words (default 65536) */
  stackSize?: number;
  /** Heap size in words (default 65536) */
  heapSize?: number;
  /** Maximum instructions to execute (0 = unlimited) */
  maxInstructions?: number;
  /** Enable debug tracing */
  debug?: boolean;
}

/**
 * P-machine virtual machine for executing Pascal bytecode
 */
export class Machine {
  /** The bytecode being executed */
  private bytecode: Bytecode;

  /** Data store (stack and heap combined) */
  private dstore: StackValue[];

  /** Stack pointer - points to top of stack */
  private sp: number = 0;

  /** Mark pointer - points to base of current stack frame */
  private mp: number = 0;

  /** Program counter - index of next instruction to execute */
  private pc: number = 0;

  /** Extreme pointer - highest stack address used (not used in this implementation) */
  private ep: number = 0;

  /** New pointer - base of heap (grows downward) */
  private np: number = 0;

  /** Current execution state */
  private state: MachineState = MachineState.READY;

  /** Output buffer for Write/WriteLn */
  private output: string[] = [];

  /** Input buffer for Read/ReadLn */
  private input: string[] = [];

  /** Current input position */
  private inputPos: number = 0;

  /** Number of instructions executed */
  private instructionCount: number = 0;

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
    this.config = {
      stackSize: config.stackSize ?? 65536,
      heapSize: config.heapSize ?? 65536,
      maxInstructions: config.maxInstructions ?? 0,
      debug: config.debug ?? false,
    };

    // Initialize data store with combined stack and heap size
    const totalSize = this.config.stackSize + this.config.heapSize;
    this.dstore = new Array(totalSize).fill(0);

    // Initialize heap pointer to top of memory
    this.np = totalSize;

    // Copy typed constants to the beginning of dstore
    for (let i = 0; i < bytecode.typedConstants.length; i++) {
      this.dstore[i] = bytecode.typedConstants[i]!;
    }
  }

  /**
   * Reset the machine to its initial state
   */
  reset(): void {
    this.sp = 0;
    this.mp = 0;
    this.pc = this.bytecode.startAddress;
    this.ep = 0;
    this.np = this.config.stackSize + this.config.heapSize;
    this.state = MachineState.READY;
    this.output = [];
    this.inputPos = 0;
    this.instructionCount = 0;
    this.trace = [];

    // Re-initialize dstore
    this.dstore.fill(0);
    for (let i = 0; i < this.bytecode.typedConstants.length; i++) {
      this.dstore[i] = this.bytecode.typedConstants[i]!;
    }
  }

  /**
   * Run the program until completion or error
   */
  run(): void {
    this.pc = this.bytecode.startAddress;
    this.state = MachineState.RUNNING;

    while (this.state === MachineState.RUNNING) {
      this.step();

      // Check instruction limit
      if (
        this.config.maxInstructions > 0 &&
        this.instructionCount >= this.config.maxInstructions
      ) {
        this.state = MachineState.ERROR;
        throw new PascalError('Maximum instruction count exceeded');
      }
    }
  }

  /**
   * Execute a single instruction
   * @returns true if execution should continue, false if stopped
   */
  step(): boolean {
    if (this.state !== MachineState.RUNNING && this.state !== MachineState.PAUSED) {
      return false;
    }

    if (this.pc < 0 || this.pc >= this.bytecode.istore.length) {
      this.state = MachineState.STOPPED;
      return false;
    }

    const instruction = this.bytecode.istore[this.pc]!;
    const opcode = inst.getOpcode(instruction);
    const p = inst.getOperand1(instruction);
    const q = inst.getOperand2(instruction);

    if (this.config.debug) {
      this.trace.push(
        `PC=${this.pc} SP=${this.sp} MP=${this.mp}: ${inst.disassemble(instruction)}`
      );
    }

    this.pc++;
    this.instructionCount++;

    try {
      this.execute(opcode, p, q);
    } catch (error) {
      this.state = MachineState.ERROR;
      throw error;
    }

    return this.state === MachineState.RUNNING;
  }

  /**
   * Execute an instruction
   * @param opcode - The operation code
   * @param p - First operand (typically level or type)
   * @param q - Second operand (typically offset or address)
   */
  private execute(opcode: number, p: number, q: number): void {
    switch (opcode) {
      // ==================== Subprogram Linkage ====================

      case Opcode.CUP:
        // Call user procedure
        // p = parameter size, q = procedure address
        this.dstore[this.mp + 4] = this.pc; // Save return address
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
        if (p === Register.SP) {
          this.sp = this.mp + q - 1;
        } else if (p === Register.EP) {
          this.ep = this.sp + q;
          if (this.ep >= this.np) {
            throw new PascalError('Stack overflow');
          }
        }
        break;

      case Opcode.MST:
        // Mark stack - prepare for procedure call
        // p = static link level difference
        this.push(0); // Return value slot
        this.push(this.base(p)); // Static link
        this.push(this.mp); // Dynamic link
        this.push(0); // Extreme pointer (unused)
        this.push(0); // Return address (filled by CUP)
        this.mp = this.sp - MARK_SIZE + 1;
        break;

      case Opcode.RTN:
        // Return from procedure/function
        // p = return type
        {
          const returnValue =
            p !== TypeCode.P ? (this.dstore[this.mp] ?? 0) : 0;
          const oldMp = this.mp;
          this.sp = oldMp - 1;
          this.pc = this.dstore[oldMp + 4] as number;
          this.mp = this.dstore[oldMp + 2] as number;
          if (p !== TypeCode.P) {
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
          this.push(a === b ? 1 : 0);
        }
        break;

      case Opcode.NEQ:
        // Inequality comparison
        {
          const b = this.pop();
          const a = this.pop();
          this.push(a !== b ? 1 : 0);
        }
        break;

      case Opcode.GRT:
        // Greater than comparison
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a > b ? 1 : 0);
        }
        break;

      case Opcode.GEQ:
        // Greater than or equal comparison
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a >= b ? 1 : 0);
        }
        break;

      case Opcode.LES:
        // Less than comparison
        {
          const b = this.popNumber();
          const a = this.popNumber();
          this.push(a < b ? 1 : 0);
        }
        break;

      case Opcode.LEQ:
        // Less than or equal comparison
        {
          const b = this.popNumber();
          const a = this.popNumber();
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
          const a = this.popNumber();
          this.push(-a);
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
          const a = this.popNumber();
          this.push(Math.trunc(a));
        }
        break;

      // ==================== Termination ====================

      case Opcode.STP:
        // Stop execution
        this.state = MachineState.STOPPED;
        break;

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
          this.push(this.dstore[address] ?? 0);
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
          this.push(this.dstore[address] ?? 0);
        }
        break;

      case Opcode.STI:
        // Store indirect
        // p = type
        {
          const value = this.pop();
          const address = this.popNumber();
          this.dstore[address] = value;
        }
        break;

      case Opcode.IXA:
        // Indexed address
        // q = element size (stride)
        {
          const address = this.popNumber();
          const index = this.popNumber();
          this.push(address + index * q);
        }
        break;

      default:
        throw new PascalError(`Unknown opcode: 0x${opcode.toString(16)}`);
    }
  }

  /**
   * Push a value onto the stack
   */
  private push(value: StackValue): void {
    this.sp++;
    if (this.sp >= this.np) {
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
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (typeof value === 'string') {
      return value.charCodeAt(0) || 0;
    }
    return 0;
  }

  /**
   * Find the base address at a given static level
   * @param level - Number of static levels to traverse
   */
  private base(level: number): number {
    let b = this.mp;
    while (level > 0) {
      b = (this.dstore[b + 1] as number) ?? 0;
      level--;
    }
    return b;
  }

  /**
   * Call a standard (built-in) procedure
   * @param argCount - Number of arguments
   * @param procIndex - Procedure index
   */
  private callStandardProcedure(argCount: number, procIndex: number): void {
    // Check if there's a native procedure registered
    if (this.bytecode.native?.procedures[procIndex]) {
      const args: StackValue[] = [];
      for (let i = 0; i < argCount; i++) {
        args.unshift(this.pop());
      }
      const result = this.bytecode.native.procedures[procIndex]!(...args);
      if (result !== undefined && result !== null) {
        this.push(result as StackValue);
      }
      return;
    }

    // Built-in standard procedures
    // These are common Pascal standard library procedures
    switch (procIndex) {
      case 0:
        // WriteLn
        {
          const values: string[] = [];
          for (let i = 0; i < argCount; i++) {
            values.unshift(String(this.pop()));
          }
          this.output.push(values.join(''));
        }
        break;

      case 1:
        // Write
        {
          const values: string[] = [];
          for (let i = 0; i < argCount; i++) {
            values.unshift(String(this.pop()));
          }
          if (this.output.length === 0) {
            this.output.push('');
          }
          this.output[this.output.length - 1] += values.join('');
        }
        break;

      case 2:
        // ReadLn
        this.inputPos++;
        break;

      case 3:
        // Read
        // Pop the address and store the next input value there
        if (argCount > 0) {
          const address = this.popNumber();
          const value = this.input[this.inputPos] ?? '';
          this.dstore[address] = value;
        }
        break;

      default:
        throw new PascalError(`Unknown standard procedure: ${procIndex}`);
    }
  }

  /**
   * Set input for Read/ReadLn operations
   * @param lines - Array of input lines
   */
  setInput(lines: string[]): void {
    this.input = lines;
    this.inputPos = 0;
  }

  /**
   * Get the program output
   */
  getOutput(): string[] {
    return [...this.output];
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
   * Halt execution immediately
   */
  halt(): void {
    this.state = MachineState.STOPPED;
  }
}

export default Machine;
