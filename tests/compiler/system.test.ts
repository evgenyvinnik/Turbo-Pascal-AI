import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { compValue } from '../../src/compiler/codegen/numeric';
import { errorWith } from './matchers';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string): string[] {
  const machine = new Machine(compile(source), { maxInstructions: 100_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('System unit additions', () => {
  it('treats Comp as an 8087 real that stores whole numbers', () => {
    expect(
      execute(`program T; var c: Comp;
      begin c := 1234; WriteLn(c); c := c / 3; WriteLn(c:0:1, ' ', SizeOf(c)); c := 2.5; WriteLn(c:0:0) end.`)
    ).toEqual([' 1.23400000000000E+0003', '411.0 8', '2']);
    // The 8087 rounds halves to even, and faults outside 64 bits.
    expect([compValue(2.5), compValue(3.5), compValue(-2.5), compValue(-0.4)]).toEqual([2, 4, -2, 0]);
    expect(() => compValue(2 ** 63)).toThrow(/Invalid numeric result/);
  });

  it('reports heap space that GetMem takes and FreeMem returns', () => {
    expect(
      execute(`program T; type Big = array[1..500] of Integer; PBig = ^Big; var p: PBig; before: LongInt;
      begin before := MemAvail; GetMem(p, SizeOf(Big)); p^[500] := 3;
        WriteLn(before - MemAvail >= 500, ' ', p^[500], ' ', p^[1]); FreeMem(p, SizeOf(Big)); WriteLn(MemAvail = before, ' ', MaxAvail <= MemAvail) end.`)
    ).toEqual(['TRUE 3 0', 'TRUE TRUE']);
  });

  it('names the program in ParamStr(0) and has no parameters', () => {
    expect(execute(`program Demo; begin WriteLn(ParamStr(0), ' ', ParamCount, ' [', ParamStr(1), ']') end.`)).toEqual([
      'C:\\DEMO.EXE 0 []',
    ]);
  });

  it('rejects what these routines cannot do', () => {
    expect(() => compile('program T; procedure P(var x); begin FillChar(x, 2, 0) end; begin end.')).toThrow(
      /FillChar needs a variable whose type is known here/
    );
    expect(() => compile('program T; var w: Word absolute $0040:$0017; begin end.')).toThrow(
      /Absolute memory addresses are not supported/
    );
    expect(() => compile('program T; const C = 1; var w: Integer absolute C; begin end.')).toThrow(
      /Variable expected: "C"/
    );
    expect(() => compile('program T; const C = Chr(300); begin end.')).toThrow(/Constant out of range/);
    expect(() => compile("program T; const C = Length(5); begin end.")).toThrow(/String constant expected/);
    expect(() => compile('program T; var x: Integer; const C = Ord(x); begin end.')).toThrow(
      /Constant expected/
    );
  });

  it('keeps the low bytes in a constant typecast, as a value typecast does', () => {
    expect(
      execute(`program T; type Color = (Red, Green, Blue);
      const B = Byte(300); S = ShortInt(200); W = Word(-1); C = Color(2); X = Boolean(0);
      begin WriteLn(B, ' ', S, ' ', W, ' ', Ord(C), ' ', X) end.`)
    ).toEqual(['44 -56 65535 2 FALSE']);
  });

  it('rejects constants that cannot fit, whatever range checking says', () => {
    // Turbo Pascal reports these while compiling even under {$R-}; Free
    // Pascal only does so with range checks on.
    for (const source of [
      'program T; var b: Byte; begin b := 256 end.',
      'program T; type Small = 1..9; var s: Small; begin s := 0 end.',
      'program T; var a: array[1..3] of Integer; begin a[4] := 1 end.',
      "program T; var s: string; c: Char; begin c := s[256] end.",
      'program T; type Color = (Red, Green); var c: Color; begin c := Pred(Red) end.',
    ])
      expect(() => compile(source), source).toThrow(/Constant out of range/);
    // A value that is not constant is still checked when it runs.
    expect(() => compile('program T; var b: Byte; i: Integer; begin i := 256; b := i end.')).not.toThrow();
  });

  it('reports a constant a standard function cannot return, where it is written', () => {
    expect(() => compile('program T; begin WriteLn(Chr(300)) end.')).toThrow(
      errorWith({ message: 'Constant out of range', lineNumber: 1 })
    );
    expect(() =>
      compile(`program T; label done;
      begin
        goto done
      end.`)
    ).toThrow(errorWith({ message: 'Undefined label', lineNumber: 3 }));
    expect(() =>
      compile('program T; type Thing = object F: LongInt; procedure P; G: LongInt end; begin end.')
    ).toThrow(/Object fields must precede its methods/);
  });

  it('parses subrange bounds that start with a name', () => {
    expect(
      execute(`program T; const N = 3; type Small = N - 1..N + 1; Bytes = array[Low(Byte)..High(Byte) div 64] of Byte;
      begin WriteLn(Low(Small), ' ', High(Small), ' ', SizeOf(Bytes)) end.`)
    ).toEqual(['2 4 4']);
  });
});
