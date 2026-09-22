import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { errorWith } from './matchers';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string): string[] {
  const machine = new Machine(compile(source), { maxInstructions: 100_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('Typed constants', () => {
  it('sets a routine constant once, not on every call, beside its locals', () => {
    expect(
      execute(`program T;
      procedure P;
      const Seen: Integer = 40; var local: Integer;
      begin local := 1; Seen := Seen + local; Write(Seen, ' ') end;
      procedure Q; var a, b, c: Integer; begin a := 7; b := 8; c := 9; P end;
      begin P; Q; P; WriteLn end.`)
    ).toEqual(['41 42 43 ']);
  });

  it('rounds reals and keeps strings within their declared types', () => {
    expect(
      execute(`program T;
      const R: Real = 0.1; D: Double = 0.1; S: string[3] = 'abcdef'; E: Real = 2;
      begin WriteLn(R:0:15, ' ', D:0:17, ' ', S, ' ', E:0:1) end.`)
    ).toEqual(['0.100000000000023 0.10000000000000001 abc 2.0']);
  });

  it('rejects values that do not fit the type, as Turbo Pascal does', () => {
    // Free Pascal only warns and wraps; Turbo Pascal 7 reports error 76.
    expect(() => compile('program T; const B: Byte = 300; begin end.')).toThrow(
      /Constant out of range/
    );
    expect(() => compile('program T; type D = 1..9; const X: D = 10; begin end.')).toThrow(
      /Constant out of range/
    );
    expect(() =>
      compile('program T; const A: array[1..3] of Integer = (1, 2); begin end.')
    ).toThrow(/Array constant of 3 elements expected/);
    expect(() => compile("program T; const W: array[1..3] of Char = 'ab'; begin end.")).toThrow(
      /String constant of length 3 expected/
    );
    expect(() =>
      compile('program T; type P = record X, Y: Integer end; const O: P = (Y: 1; X: 2); begin end.')
    ).toThrow(/Record field "x" expected/);
    expect(() =>
      compile('program T; type P = record X, Y: Integer end; const O: P = (Y: 1); begin end.')
    ).toThrow(/Record field "x" expected/);
    // A written-out type directs the parse: the inner parentheses are missing.
    expect(() =>
      compile(`program T;
      const M: array[1..2, 1..2] of Integer = (
        1, 2, 3, 4);
      begin end.`)
    ).toThrow(errorWith({ lineNumber: 3, message: "Expected '(', found '1'" }));
    expect(() => compile("program T; const N: Integer = 'x'; begin end.")).toThrow(/Type mismatch/);
    expect(() => compile('program T; var f: Text; const F2: Text = 1; begin end.')).toThrow(
      /Typed constants of this type are not supported/
    );
  });

  it('holds only addresses that are fixed when the program starts', () => {
    expect(() =>
      compile('program T; procedure P; var x: Integer; const Q: ^Integer = @x; begin end; begin end.')
    ).toThrow(/Address of a global variable expected/);
    expect(() => compile('program T; var x: Integer; const Q: ^Integer = x; begin end.')).toThrow(
      /Constant expression expected/
    );
  });

  it('leaves record fields it does not name at zero', () => {
    expect(
      execute(`program T; type P = record X: Integer; S: string; C: Char end;
      const O: P = (X: 3);
      begin WriteLn(O.X, '[', O.S, ']', Ord(O.C)) end.`)
    ).toEqual(['3[]0']);
  });
});
