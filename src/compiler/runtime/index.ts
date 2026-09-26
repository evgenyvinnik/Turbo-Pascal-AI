/**
 * Runtime module barrel export
 *
 * Exports the P-machine virtual machine and supporting runtime
 * infrastructure for executing compiled Pascal bytecode.
 */

// P-machine virtual machine
export { Machine, MachineState, type StackValue, type MachineConfig } from './Machine';

// Native procedure interface
export {
  NativeRegistry,
  StandardProcedure,
  createNativeRegistry,
  type NativeProcedure,
  type NativeProcedureDef,
} from './Native';

// Execution control
export {
  ExecutionController,
  ExecutionEvent,
  createController,
  type Breakpoint,
  type ExecutionListener,
  type ExecutionEventData,
} from './Control';
