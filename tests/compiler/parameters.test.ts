import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { errorWith } from './matchers';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string): string[] {
  const machine = new Machine(compile(source), { maxInstructions: 5_000_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('Parameter forms', () => {
  it('rejects every way a const parameter could change', () => {
    const rejected = (body: string, extra = '') => {
      expect(() =>
        compile(`program T; var g: Integer; ${extra}
        procedure P(const n: Integer; const s: string); var i: Integer; begin ${body} end;
        begin end.`)
      ).toThrow(/Constant parameter "(?:n|s)" cannot be modified/);
    };
    rejected('n := 1');
    rejected('Inc(n)');
    rejected('ReadLn(n)');
    rejected('for n := 1 to 2 do');
    rejected("s[1] := 'x'");
    rejected('Delete(s, 1, 1)');
    rejected("Insert('x', s, 1)");
    rejected('Str(1, s)');
    rejected('Val(s, n, g)');
    rejected('Change(n)', 'procedure Change(var x); begin end;');
  });

  it('keeps the fields WITH gives of a const record parameter from changing', () => {
    const source = (body: string) => `program T; type PR = ^R; I = record n: Integer end;
      R = record q: PR; ofs: LongInt; a: array[1..2] of Byte; inner: I end;
      procedure P(const r: R); var x: LongInt; begin ${body} end;
      var v, w: R; begin v.q := @w; v.ofs := 4; P(v); WriteLn(w.ofs) end.`;
    for (const body of [
      'with r do ofs := ofs + 1',
      'with r do Inc(a[1])',
      'with r do with inner do n := 1',
      'with r do ReadLn(ofs)',
    ])
      expect(() => compile(source(body))).toThrow(/Constant parameter "r" cannot be modified/);
    expect(
      execute(source('with r do begin x := ofs + 1; WriteLn(x) end; with r.q^ do ofs := 9'))
    ).toEqual(['5', '9']);
  });

  it('lets a const pointer parameter write through the pointer', () => {
    expect(
      execute(`program T; type PInt = ^Integer; var v: Integer;
      procedure P(const p: PInt); begin p^ := 5 end;
      begin P(@v); WriteLn(v) end.`)
    ).toEqual(['5']);
  });

  it('checks open array indices against the High the caller passed', () => {
    const machine = new Machine(
      compile(`program T; {$R+}
      procedure P(const a: array of Integer); begin WriteLn(a[High(a)]); WriteLn(a[High(a) + 1]) end;
      var v: array[1..3] of Integer;
      begin v[3] := 9; P(v) end.`)
    );
    expect(() => {
      machine.run();
    }).toThrowError(errorWith({ message: 'Array index 3 out of bounds (0..2)', lineNumber: 2 }));
    expect(machine.getOutput()).toEqual(['9']);
  });

  it('frees the copy of a value open array when the routine returns', () => {
    // 200 calls copying 1000 cells each would exhaust the 65536-cell heap.
    expect(
      execute(`program T; var v: array[1..1000] of Integer; i, n: Integer;
      function Touch(a: array of Integer): Integer; begin a[0] := 1; Touch := High(a) end;
      begin n := 0; for i := 1 to 200 do n := Touch(v); WriteLn(n, ' ', v[1]) end.`)
    ).toEqual(['999 0']);
  });

  it('gives each activation its own copy and High', () => {
    expect(
      execute(`program T; var v: array[1..4] of Integer; i: Integer;
      function Depth(a: array of Integer; n: Integer): Integer;
      begin a[0] := n; if n < 3 then Depth := Depth(a, n + 1) * 10 + a[0] else Depth := a[0] end;
      begin for i := 1 to 4 do v[i] := 0; WriteLn(Depth(v, 1), ' ', v[1]) end.`)
    ).toEqual(['321 0']);
  });

  it('rejects whole open array assignment and Delphi array of const', () => {
    expect(() =>
      compile(`program T; procedure P(var a, b: array of Integer); begin a := b end; begin end.`)
    ).toThrow(/Open arrays cannot be assigned as a whole/);
    expect(() =>
      compile('program T; procedure P(a: array of const); begin end; begin end.')
    ).toThrow(/Array of const is not Turbo Pascal/);
  });

  it('keeps forward declarations and procedural types strict about parameter modes', () => {
    expect(() =>
      compile(`program T; procedure P(const n: Integer); forward;
      procedure P(n: Integer); begin end; begin end.`)
    ).toThrow(/Forward declaration parameter mismatch/);
    expect(() =>
      compile(`program T; type Reducer = procedure(const a: array of Integer);
      {$F+} procedure Q(const a: array of Byte); begin end; {$F-}
      var f: Reducer; begin f := Q end.`)
    ).toThrow(/Type mismatch/);
  });
});
