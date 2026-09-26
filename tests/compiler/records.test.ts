import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string): string[] {
  const machine = new Machine(compile(source), { maxInstructions: 100_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('Variant records', () => {
  it('packs fields as Turbo Pascal does, with each variant part as large as its largest case', () => {
    expect(
      execute(`program T;
      type Node = record
          Id: Integer;
          case Leaf: Boolean of
            True: (Value: LongInt);
            False: (case Wide: Boolean of True: (Left, Right: Integer); False: (Only: Integer))
        end;
        Untagged = record case Byte of 0: (B: Byte); 1: (S: string[5]) end;
      begin WriteLn(SizeOf(Node), ' ', SizeOf(Untagged)) end.`)
    ).toEqual(['8 6']);
  });

  it('starts every case at zero, as the first case sees it', () => {
    expect(
      execute(`program T; type PR = ^TR; TR = record case B: Boolean of True: (I: Integer); False: (S: string[3]) end;
      var p: PR; r: TR;
      begin New(p); WriteLn(p^.I, ' ', r.I, ' ', Ord(r.B)); Dispose(p) end.`)
    ).toEqual(['0 0 0']);
  });

  it('requires tags of an ordinal type and labels that fit them', () => {
    expect(() =>
      compile('program T; type R = record case Real of 1: (A: Integer) end; begin end.')
    ).toThrow(/Variant tag must have an ordinal type/);
    expect(() =>
      compile("program T; type R = record case Boolean of 'x': (A: Integer) end; begin end.")
    ).toThrow(/Type mismatch/);
  });

  it('lets a typed constant skip only the fields of other cases', () => {
    expect(() =>
      compile(`program T; type R = record X: Integer; case T: Boolean of True: (A: Integer); False: (B: Integer) end;
      const C: R = (X: 1; B: 2); begin end.`)
    ).toThrow(/Record field "t" expected/);
    expect(
      execute(`program T; type R = record X: Integer; case T: Boolean of True: (A: Integer); False: (B, D: Integer) end;
      const C: R = (X: 1; T: False; B: 2; D: 3); begin WriteLn(C.X, C.B, C.D) end.`)
    ).toEqual(['123']);
  });

  it('overlays the cases byte by byte, as Turbo Pascal stores them', () => {
    expect(
      execute(`program T; type W = record case Integer of 0: (w, v: Word); 1: (lo, hi, lo2, hi2: Byte); 2: (c: array[1..4] of Char) end;
      const K: W = (lo: 1; hi: 2);
      var r: W;
      begin r.w := $1234; r.v := $5678; WriteLn(r.lo, ' ', r.hi, ' ', r.lo2, ' ', r.hi2);
        r.hi := 1; WriteLn(r.w, ' ', r.v, ' ', K.w); r.c[1] := 'A'; WriteLn(r.w) end.`)
    ).toEqual(['52 18 120 86', '308 22136 513', '321']);
    // A string copies its length and characters; the bytes after keep theirs.
    expect(
      execute(`program T; type L = record case Byte of 0: (l: LongInt); 1: (s: string[3]) end; var x: L;
      begin x.l := $43424103; WriteLn(x.s); x.s := 'hi'; WriteLn(x.l) end.`)
    ).toEqual(['ABC', '1130981378']);
  });

  it('keeps the cases in step after var parameters, WITH and byte-level changes', () => {
    const machine = new Machine(
      compile(`program T; type W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
      var r, s: W; f: file of W; code: Integer;
      procedure Bump(var b: Byte); begin Inc(b, 16) end;
      begin r.w := $0102; Inc(r.lo); Bump(r.hi); Write(r.w, ' ');
        Val('772', r.w, code); Write(r.lo, r.hi, ' ');
        with r do begin lo := 0; hi := 1 end; Write(r.w, ' ');
        FillChar(s, SizeOf(s), 1); Write(s.w, ' '); Move(r, s, 1); Write(s.w, ' ');
        Assign(f, 'W.DAT'); Rewrite(f); Write(f, r); Reset(f); Read(f, s); Close(f); WriteLn(s.lo, s.hi) end.`),
      { maxInstructions: 100_000 }
    );
    machine.run();
    expect(machine.getOutput()).toEqual(['4355 43 256 257 256 01']);
  });

  it('finds a record whose address has side effects once', () => {
    expect(
      execute(`program T; type W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
      var a: array[1..3] of W; i: Integer;
      function Next: Integer; begin Inc(i); Next := i end;
      begin i := 0; a[Next].w := $0708; WriteLn(i, ' ', a[1].lo, ' ', a[1].hi) end.`)
    ).toEqual(['1 8 7']);
  });

  it('overlays nested cases and records inside cases', () => {
    expect(
      execute(`program T; type W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
        TNode = record kind: Byte; case Byte of
          0: (x: Word; case Byte of 0: (y: LongInt); 1: (a, b: Word));
          1: (bytes: array[0..6] of Byte) end;
        Outer = record id: Byte; case Boolean of False: (n: W); True: (c: array[0..1] of Char) end;
      var n: TNode; o: Outer;
      begin n.x := $0304; n.y := $0A0B0C0D; WriteLn(n.bytes[0], ' ', n.bytes[5], ' ', n.a, ' ', n.b);
        n.a := 1; WriteLn(n.y); o.n.w := $4344; WriteLn(o.c[0], o.c[1]); with o.n do lo := $61; WriteLn(o.c[0]);
        n.bytes[2] := $FF; WriteLn(n.a, ' ', n.y) end.`)
    ).toEqual(['4 10 3085 2571', '168493057', 'DC', 'a', '255 168493311']);
  });

  it('shows assembly the bytes, and the fields what assembly stores', () => {
    expect(
      execute(`program T; type W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end; var r: W; a: Byte;
      procedure Set7(var x: W); assembler; asm les di, x; mov byte ptr es:[di+1], 7 end;
      begin r.w := $1234; asm mov al, r.hi; mov a, al; mov r.lo, 5 end; WriteLn(a, ' ', r.w); Set7(r); WriteLn(r.w) end.`)
    ).toEqual(['18 4613', '1797']);
  });
});

describe('Range checks', () => {
  it('keeps Char and Byte stores apart on one line', () => {
    expect(
      execute(
        "program T; var b: array[0..3] of Byte; c: array[1..4] of Char; begin c[1] := 'Z'; b[1] := 66; WriteLn(b[1] + 1, c[1]) end."
      )
    ).toEqual(['67Z']);
  });
});
