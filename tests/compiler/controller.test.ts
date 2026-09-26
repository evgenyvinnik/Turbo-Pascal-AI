import { afterEach, describe, expect, it, vi } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { ExecutionController, ExecutionEvent } from '../../src/compiler/runtime/Control';
import { MachineState } from '../../src/compiler/runtime/Machine';

const controllerFor = (source: string) =>
  new ExecutionController(
    new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()),
    { maxInstructions: 1000 }
  );

afterEach(() => vi.useRealTimers());

describe('execution controller', () => {
  it('waits for Delay before resuming and does not emit a premature STOP', () => {
    vi.useFakeTimers();
    const controller = controllerFor(
      "program T; uses Crt; begin WriteLn('before'); Delay(250); WriteLn('after') end."
    );
    const events: ExecutionEvent[] = [];
    controller.addEventListener((event) => events.push(event));
    controller.run();
    vi.advanceTimersByTime(20);
    expect(controller.getState()).toBe(MachineState.SLEEPING);
    expect(controller.getOutput()).toEqual(['before']);
    expect(events).not.toContain(ExecutionEvent.STOP);
    vi.advanceTimersByTime(250);
    expect(controller.getOutput()).toEqual(['before', 'after']);
    expect(controller.getState()).toBe(MachineState.STOPPED);
    expect(events).toContain(ExecutionEvent.STOP);
  });
  it('starts from READY, emits input requests, and resumes after input', () => {
    vi.useFakeTimers();
    const controller = controllerFor(
      'program T; var n: Integer; begin ReadLn(n); WriteLn(n * 2) end.'
    );
    const events: ExecutionEvent[] = [];
    controller.addEventListener((event) => events.push(event));
    controller.run();
    vi.runAllTimers();
    expect(controller.getState()).toBe(MachineState.WAITING);
    expect(events).toContain(ExecutionEvent.INPUT);
    expect(events).not.toContain(ExecutionEvent.STOP);
    controller.provideInput('21');
    vi.runAllTimers();
    expect(controller.getState()).toBe(MachineState.STOPPED);
    expect(controller.getOutput()).toEqual(['42']);
    expect(events).toContain(ExecutionEvent.STOP);
  });

  it('emits every same-line Write change', () => {
    vi.useFakeTimers();
    const controller = controllerFor("program T; begin Write('a'); Write('b'); WriteLn('c') end.");
    const outputs: string[][] = [];
    controller.addEventListener((event, data) => {
      if (event === ExecutionEvent.OUTPUT) outputs.push(data?.output ?? []);
    });
    controller.run();
    vi.runAllTimers();
    expect(outputs).toEqual([['a'], ['ab'], ['abc']]);
    expect(controller.getState()).toBe(MachineState.STOPPED);
  });

  it('emits output again when a completed program is restarted', () => {
    vi.useFakeTimers();
    const controller = controllerFor("program T; begin WriteLn('hello') end.");
    const outputs: string[][] = [];
    controller.addEventListener((event, data) => {
      if (event === ExecutionEvent.OUTPUT) outputs.push(data?.output ?? []);
    });
    controller.run();
    vi.runAllTimers();
    controller.run();
    vi.runAllTimers();
    expect(outputs).toEqual([['hello'], ['hello']]);
    expect(controller.getState()).toBe(MachineState.STOPPED);
  });
});
