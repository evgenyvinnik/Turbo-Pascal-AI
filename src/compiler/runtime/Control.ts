/**
 * Execution control for the P-machine
 *
 * This module provides high-level control over bytecode execution,
 * including pause, resume, single-step, and breakpoint support.
 */

import { Machine, MachineState, StackValue, MachineConfig } from './Machine';
import { Bytecode } from '../codegen/Bytecode';
import { inst } from '../types/inst';

/**
 * Breakpoint definition
 */
export interface Breakpoint {
  /** Unique identifier for this breakpoint */
  id: number;
  /** Instruction address where breakpoint is set */
  address: number;
  /** Whether this breakpoint is enabled */
  enabled: boolean;
  /** Optional condition expression */
  condition?: string;
  /** Hit count */
  hitCount: number;
}

/**
 * Execution event types
 */
export enum ExecutionEvent {
  /** Execution started */
  START = 'start',
  /** Single step completed */
  STEP = 'step',
  /** Hit a breakpoint */
  BREAKPOINT = 'breakpoint',
  /** Execution paused */
  PAUSE = 'pause',
  /** Execution resumed */
  RESUME = 'resume',
  /** Execution stopped */
  STOP = 'stop',
  /** Runtime error occurred */
  ERROR = 'error',
  /** Output was generated */
  OUTPUT = 'output',
  /** Program is waiting for console input. */
  INPUT = 'input',
}

/**
 * Event listener callback type
 */
export type ExecutionListener = (event: ExecutionEvent, data?: ExecutionEventData) => void;

/**
 * Data associated with execution events
 */
export interface ExecutionEventData {
  /** Current program counter */
  pc?: number;
  /** Current stack pointer */
  sp?: number;
  /** Current mark pointer */
  mp?: number;
  /** Instruction that was executed */
  instruction?: string;
  /** Breakpoint that was hit */
  breakpoint?: Breakpoint;
  /** Error message */
  error?: string;
  /** Output lines */
  output?: string[];
}

/**
 * Execution controller for the P-machine
 *
 * Provides high-level control over bytecode execution including:
 * - Run, pause, resume, stop
 * - Single-step execution
 * - Breakpoint management
 * - Event notifications
 */
export class ExecutionController {
  /** The underlying P-machine */
  private machine: Machine;

  /** The bytecode being executed */
  private bytecode: Bytecode;

  /** Registered breakpoints */
  private breakpoints: Map<number, Breakpoint>;

  /** Next breakpoint ID */
  private nextBreakpointId: number = 1;

  /** Event listeners */
  private listeners: ExecutionListener[] = [];

  /** Whether execution is paused */
  private paused: boolean = false;

  /** Interval handle for run loop */
  private runIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Number of instructions to execute per tick */
  private instructionsPerTick: number = 1000;

  /** Last output length for detecting new output */
  private lastOutputLength: number = 0;
  private lastOutputLine = '';

  /**
   * Creates a new ExecutionController
   * @param bytecode - The bytecode to execute
   * @param config - Optional machine configuration
   */
  constructor(bytecode: Bytecode, config?: MachineConfig) {
    this.bytecode = bytecode;
    this.machine = new Machine(bytecode, config);
    this.breakpoints = new Map();
  }

  /**
   * Start or resume execution
   */
  run(): void {
    if (
      this.machine.getState() === MachineState.STOPPED ||
      this.machine.getState() === MachineState.ERROR
    ) {
      this.reset();
    }

    this.paused = false;
    this.emit(ExecutionEvent.START);
    this.startRunLoop();
  }

  /**
   * Pause execution
   */
  pause(): void {
    this.paused = true;
    this.stopRunLoop();
    this.emit(ExecutionEvent.PAUSE, this.getEventData());
  }

  /**
   * Resume execution after pause
   */
  resume(): void {
    if (!this.paused) return;

    this.paused = false;
    this.emit(ExecutionEvent.RESUME, this.getEventData());
    this.startRunLoop();
  }

  /**
   * Stop execution completely
   */
  stop(): void {
    this.stopRunLoop();
    this.machine.halt();
    this.emit(ExecutionEvent.STOP, this.getEventData());
  }

  /**
   * Execute a single instruction
   * @returns true if execution can continue
   */
  step(): boolean {
    this.stopRunLoop();
    this.paused = true;

    const state = this.machine.getState();
    if (state === MachineState.STOPPED || state === MachineState.ERROR) {
      return false;
    }

    try {
      if (!this.machine.wake()) return false;
      const canContinue = this.machine.step();
      this.checkForNewOutput();
      this.emit(ExecutionEvent.STEP, this.getEventData());
      return canContinue;
    } catch (error) {
      this.emit(ExecutionEvent.ERROR, {
        ...this.getEventData(),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Step over a procedure call (not implemented - acts like step)
   */
  stepOver(): boolean {
    // TODO: Implement step-over by tracking call depth
    return this.step();
  }

  /**
   * Step out of current procedure (not implemented - acts like step)
   */
  stepOut(): boolean {
    // TODO: Implement step-out by running until return
    return this.step();
  }

  /**
   * Reset the machine to initial state
   */
  reset(): void {
    this.stopRunLoop();
    this.machine.reset();
    this.paused = false;
    this.lastOutputLength = 0;
    this.lastOutputLine = '';
  }

  /**
   * Add a breakpoint at an instruction address
   * @param address - The instruction address
   * @returns The created breakpoint
   */
  addBreakpoint(address: number): Breakpoint {
    const bp: Breakpoint = {
      id: this.nextBreakpointId++,
      address,
      enabled: true,
      hitCount: 0,
    };
    this.breakpoints.set(address, bp);
    return bp;
  }

  /**
   * Remove a breakpoint by ID
   * @param id - The breakpoint ID
   * @returns true if breakpoint was found and removed
   */
  removeBreakpoint(id: number): boolean {
    for (const [address, bp] of this.breakpoints) {
      if (bp.id === id) {
        this.breakpoints.delete(address);
        return true;
      }
    }
    return false;
  }

  /**
   * Remove a breakpoint at an address
   * @param address - The instruction address
   * @returns true if breakpoint was found and removed
   */
  removeBreakpointAt(address: number): boolean {
    return this.breakpoints.delete(address);
  }

  /**
   * Toggle a breakpoint on/off
   * @param id - The breakpoint ID
   */
  toggleBreakpoint(id: number): void {
    for (const bp of this.breakpoints.values()) {
      if (bp.id === id) {
        bp.enabled = !bp.enabled;
        break;
      }
    }
  }

  /**
   * Clear all breakpoints
   */
  clearBreakpoints(): void {
    this.breakpoints.clear();
  }

  /**
   * Get all breakpoints
   */
  getBreakpoints(): Breakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  /**
   * Get a breakpoint at an address
   * @param address - The instruction address
   */
  getBreakpointAt(address: number): Breakpoint | undefined {
    return this.breakpoints.get(address);
  }

  /**
   * Add an event listener
   * @param listener - The listener callback
   */
  addEventListener(listener: ExecutionListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove an event listener
   * @param listener - The listener to remove
   */
  removeEventListener(listener: ExecutionListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Get the current machine state
   */
  getState(): MachineState {
    return this.machine.getState();
  }

  /**
   * Check if execution is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Get the current program counter
   */
  getPC(): number {
    return this.machine.getPC();
  }

  /**
   * Get the current stack pointer
   */
  getSP(): number {
    return this.machine.getSP();
  }

  /**
   * Get the current mark pointer
   */
  getMP(): number {
    return this.machine.getMP();
  }

  /**
   * Get the program output
   */
  getOutput(): string[] {
    return this.machine.getOutput();
  }

  /**
   * Set program input
   * @param lines - Array of input lines
   */
  setInput(lines: string[]): void {
    this.machine.setInput(lines);
  }

  provideInput(line: string, echo = false): void {
    const waiting = this.machine.getState() === MachineState.WAITING;
    this.machine.provideInput(line, echo);
    this.checkForNewOutput();
    if (waiting && !this.paused) this.startRunLoop();
  }

  /**
   * Get the number of instructions executed
   */
  getInstructionCount(): number {
    return this.machine.getInstructionCount();
  }

  /**
   * Get the debug trace log
   */
  getTrace(): string[] {
    return this.machine.getTrace();
  }

  /**
   * Peek at a stack value
   * @param address - The stack address
   */
  peek(address: number): StackValue {
    return this.machine.peek(address);
  }

  /**
   * Get a range of stack values
   * @param start - Start address
   * @param count - Number of values
   */
  peekRange(start: number, count: number): StackValue[] {
    return this.machine.peekRange(start, count);
  }

  /**
   * Get the current instruction as a string
   */
  getCurrentInstruction(): string {
    const pc = this.machine.getPC();
    if (pc < 0 || pc >= this.bytecode.istore.length) {
      return '';
    }
    const instruction = this.bytecode.istore[pc]!;
    return inst.disassemble(instruction);
  }

  /**
   * Set instructions per tick for the run loop
   * @param count - Number of instructions per tick
   */
  setInstructionsPerTick(count: number): void {
    this.instructionsPerTick = Math.max(1, count);
  }

  /**
   * Start the run loop
   */
  private startRunLoop(): void {
    if (this.runIntervalId !== null) return;

    this.runIntervalId = setInterval(() => {
      this.runTick();
    }, 4);
  }

  /**
   * Stop the run loop
   */
  private stopRunLoop(): void {
    if (this.runIntervalId !== null) {
      clearInterval(this.runIntervalId);
      this.runIntervalId = null;
    }
  }

  /**
   * Execute one tick of the run loop
   */
  private runTick(): void {
    if (this.paused) {
      this.stopRunLoop();
      return;
    }

    try {
      if (!this.machine.wake()) return;
      for (let i = 0; i < this.instructionsPerTick; i++) {
        const pc = this.machine.getPC();

        // Check for breakpoint
        const bp = this.breakpoints.get(pc);
        if (bp && bp.enabled) {
          bp.hitCount++;
          this.paused = true;
          this.stopRunLoop();
          this.emit(ExecutionEvent.BREAKPOINT, {
            ...this.getEventData(),
            breakpoint: bp,
          });
          return;
        }

        // Execute instruction
        const canContinue = this.machine.step();
        this.checkForNewOutput();

        if (!canContinue) {
          if (this.machine.getState() === MachineState.SLEEPING) return;
          this.stopRunLoop();
          this.emit(
            this.machine.getState() === MachineState.WAITING
              ? ExecutionEvent.INPUT
              : ExecutionEvent.STOP,
            this.getEventData()
          );
          return;
        }
      }
    } catch (error) {
      this.stopRunLoop();
      this.emit(ExecutionEvent.ERROR, {
        ...this.getEventData(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check for new output and emit event if found
   */
  private checkForNewOutput(): void {
    const output = this.machine.getOutput();
    const lastLine = output.at(-1) ?? '';
    if (output.length !== this.lastOutputLength || lastLine !== this.lastOutputLine) {
      this.lastOutputLength = output.length;
      this.lastOutputLine = lastLine;
      this.emit(ExecutionEvent.OUTPUT, {
        ...this.getEventData(),
        output,
      });
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: ExecutionEvent, data?: ExecutionEventData): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get current event data
   */
  private getEventData(): ExecutionEventData {
    return {
      pc: this.machine.getPC(),
      sp: this.machine.getSP(),
      mp: this.machine.getMP(),
      instruction: this.getCurrentInstruction(),
    };
  }
}

/**
 * Create a new execution controller
 * @param bytecode - The bytecode to execute
 * @param config - Optional machine configuration
 */
export function createController(bytecode: Bytecode, config?: MachineConfig): ExecutionController {
  return new ExecutionController(bytecode, config);
}

export default ExecutionController;
