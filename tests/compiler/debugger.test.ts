import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { SourceDebugger } from '../../src/compiler/runtime/SourceDebugger';

const source = `program DebugDemo;
var total: Integer;
procedure Add(value: Integer);
begin
  total := total + value;
end;
begin
  total := 1;
  Add(4);
  total := total * 2;
  WriteLn(total);
end.`;

function create(sourceText = source): SourceDebugger {
  const bytecode = new Compiler().compile(new Parser(new Lexer(new Stream(sourceText))).parse());
  const machine = new Machine(bytecode, { maxInstructions: 100_000 });
  machine.reset();
  return new SourceDebugger(machine, bytecode);
}

function execute(debuggerSession: SourceDebugger, command: Parameters<SourceDebugger['command']>[0], line = 0): void {
  debuggerSession.command(command, line);
  debuggerSession.runSlice(100_000);
}

describe('source debugger', () => {
  it('steps into a routine and reads real parameters, globals and call frames', () => {
    const debug = create();
    execute(debug, 'entry');
    expect(debug.getLine()).toBe(7);
    execute(debug, 'into');
    expect(debug.getLine()).toBe(8);
    expect(debug.evaluate('total').value).toBe(0);
    execute(debug, 'into');
    expect(debug.getLine()).toBe(9);
    expect(debug.evaluate('total').value).toBe(1);
    execute(debug, 'into');
    expect(debug.getLine()).toBe(4);
    execute(debug, 'into');
    expect(debug.getLine()).toBe(5);
    expect(debug.evaluate('value + total').value).toBe(5);
    expect(debug.frames().map((frame) => frame.name)).toEqual(['Add', 'DebugDemo']);
    execute(debug, 'out');
    expect(debug.getLine()).toBe(10);
    expect(debug.evaluate('total').value).toBe(5);
  });

  it('steps over calls and modifies actual VM storage before continuing', () => {
    const debug = create();
    execute(debug, 'entry');
    execute(debug, 'over');
    execute(debug, 'over');
    execute(debug, 'over');
    expect(debug.getLine()).toBe(10);
    expect(debug.frames().map((frame) => frame.name)).toEqual(['DebugDemo']);
    expect(debug.modify('total', '7').value).toBe(7);
    execute(debug, 'run');
    expect(debug.machine.getState()).toBe(MachineState.STOPPED);
    expect(debug.machine.getOutput()).toEqual(['14']);
  });

  it('runs to the requested source line before its statement executes', () => {
    const debug = create();
    execute(debug, 'cursor', 10);
    expect(debug.isPaused()).toBe(true);
    expect(debug.getLine()).toBe(10);
    expect(debug.evaluate('total').value).toBe(5);
  });

  it('hits a conditional breakpoint and resumes past that same instruction', () => {
    const debug = create(`program LoopTest;
var i: Integer;
begin
  for i := 1 to 3 do
    WriteLn(i);
end.`);
    debug.setBreakpoints(() => [{ line: 5, enabled: true, condition: 'i = 2' }]);
    execute(debug, 'run');
    expect(debug.isPaused()).toBe(true);
    expect(debug.evaluate('i').value).toBe(2);
    expect(debug.machine.getOutput()).toEqual(['1']);
    execute(debug, 'run');
    expect(debug.machine.getOutput()).toEqual(['1', '2', '3']);
    expect(debug.machine.getState()).toBe(MachineState.STOPPED);
  });

  it('inspects lexical parent locals and writes through var parameters', () => {
    const debug = create(`program Nested;
var result: Integer;
procedure Outer(var answer: Integer);
var local: Integer;
  procedure Inner;
  begin
    answer := local + 1;
  end;
begin
  local := 12;
  Inner;
end;
begin
  Outer(result);
  WriteLn(result);
end.`);
    execute(debug, 'cursor', 7);
    expect(debug.evaluate('local').value).toBe(12);
    expect(debug.frames().map((frame) => frame.name)).toEqual(['Inner', 'Outer', 'Nested']);
    debug.modify('local', '20');
    execute(debug, 'run');
    expect(debug.machine.getOutput()).toEqual(['21']);
  });

  it('inspects and modifies array elements and rejects invalid modification', () => {
    const debug = create(`program ArrayDebug;
var values: array[2..4] of Integer;
begin
  values[2] := 6;
  WriteLn(values[2]);
end.`);
    execute(debug, 'cursor', 5);
    expect(debug.evaluate('values[2] * 2').value).toBe(12);
    expect(() => debug.modify('values[2]', '2.5')).toThrow('integer');
    expect(() => debug.evaluate('values[1]')).toThrow('out of range');
    debug.modify('values[2]', '9');
    execute(debug, 'run');
    expect(debug.machine.getOutput()).toEqual(['9']);
  });

  it('preserves a returned var value while paused at the routine END', () => {
    const debug = create();
    execute(debug, 'cursor', 6);
    expect(debug.frames()[0]?.name).toBe('Add');
    expect(debug.frames()[0]?.arguments).toEqual([4]);
    expect(debug.evaluate('total').value).toBe(5);
  });

  it('evaluates typed pointers, sets and Pascal string indexes', () => {
    const debug = create(`program ExtendedDebug;
type Entry = record value: Integer; end;
var p: ^Entry; values: set of 0..9; caption: String[5];
begin
  New(p);
  p^.value := 4;
  values := [1,3..5];
  caption := 'Hello';
  WriteLn(p^.value, caption);
  Dispose(p);
end.`);
    execute(debug, 'cursor', 9);
    expect(debug.evaluate('p^.value + 2').value).toBe(6);
    expect(debug.evaluate('4 in values').value).toBe(true);
    expect(debug.evaluate('values * [3..4] = [3,4]').value).toBe(true);
    expect(debug.evaluate('Ord(caption[0])').value).toBe(5);
    debug.modify('p^.value', '8');
    debug.modify('caption[1]', "'J'");
    debug.modify('values', '[2,4]');
    expect(debug.evaluate('3 in values').value).toBe(false);
    expect(() => debug.modify('values', '[10]')).toThrow('out of range');
    expect(() => debug.modify('caption', "'Too long'")).toThrow('capacity');
    expect(() => debug.modify('p^.value', '65535')).toThrow('out of range');
    execute(debug, 'run');
    expect(debug.machine.getOutput()).toEqual(['8Jello']);
  });

  it('counts matching breakpoint passes before stopping', () => {
    const debug = create(`program Passing;
var i: Integer;
begin
  for i := 1 to 4 do
    WriteLn(i);
end.`);
    debug.setBreakpoints(() => [{ line: 5, enabled: true, passCount: 2 }]);
    execute(debug, 'run');
    expect(debug.evaluate('i').value).toBe(3);
    expect(debug.machine.getOutput()).toEqual(['1', '2']);
  });
});
