import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const machineFor = (source: string) =>
  new Machine(new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()), {
    maxInstructions: 100_000,
  });

describe('interactive DOS keyboard queue', () => {
  it('lets a running KeyPressed loop consume a Unicode key without line input', () => {
    const machine = machineFor(`program T;uses Crt;var key:Char;
      begin repeat until KeyPressed;key:=ReadKey;WriteLn(Ord(key), ',', KeyPressed)end.`);
    machine.runSlice(100);
    expect(machine.getState()).toBe(MachineState.PAUSED);
    expect(machine.getConsole().active).toBe(true);
    const revision = machine.getConsole().revision;
    machine.runSlice(100);
    expect(machine.getConsole().revision).toBe(revision);
    machine.provideKey('é');
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['130,FALSE']);
  });

  it('wakes ReadKey, preserves extended scan bytes, and consumes a pair one byte at a time', () => {
    const machine = machineFor(`program T;uses Crt;var key:Char;
      begin key:=ReadKey;WriteLn(Ord(key), ',', KeyPressed);key:=ReadKey;WriteLn(Ord(key), ',', KeyPressed)end.`);
    machine.run();
    expect(machine.getState()).toBe(MachineState.WAITING);
    expect(machine.getInputMode()).toBe('key');
    expect(machine.getConsole().active).toBe(true);
    machine.provideKey('\0' + String.fromCharCode(141));
    expect(machine.getState()).toBe(MachineState.PAUSED);
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['0,TRUE', '141,FALSE']);
  });

  it('consumes queued keys before legacy setInput characters and retains legacy empty-line Enter', () => {
    const machine = machineFor(`program T;uses Crt;
      begin WriteLn(KeyPressed, ':', ReadKey, ',', KeyPressed, ':', ReadKey, ',', Ord(ReadKey), ',', KeyPressed)end.`);
    machine.setInput(['z', '']);
    machine.provideKey('a');
    machine.run();
    expect(machine.getOutput()).toEqual(['TRUE:a,TRUE:z,13,FALSE']);
  });

  it('does not wake a ReadLn wait or consume queued keys as line input', () => {
    const machine = machineFor(`program T;uses Crt;var n:Integer;
      begin ReadLn(n);WriteLn(n, ',', Ord(ReadKey))end.`);
    machine.run();
    expect(machine.getInputMode()).toBe('line');
    machine.provideKey('x');
    expect(machine.getState()).toBe(MachineState.WAITING);
    machine.provideInput('42');
    machine.run();
    expect(machine.getOutput()).toEqual(['42,120']);
  });

  it('clears queued keys on reset and ignores empty delivery while waiting', () => {
    const machine = machineFor(`program T;uses Crt;var key:Char;
      begin WriteLn(KeyPressed);key:=ReadKey;WriteLn(key)end.`);
    machine.provideKey('stale');
    machine.reset();
    machine.run();
    expect(machine.getOutput()).toEqual(['FALSE']);
    expect(machine.getState()).toBe(MachineState.WAITING);
    machine.provideKey('');
    expect(machine.getState()).toBe(MachineState.WAITING);
    machine.provideKey('n');
    machine.run();
    expect(machine.getOutput()).toEqual(['FALSE', 'n']);
  });
});
