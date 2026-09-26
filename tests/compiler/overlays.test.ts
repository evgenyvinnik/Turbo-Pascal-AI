import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
const output = (source: string) => {
  const machine = new Machine(compile(source), { maxInstructions: 2_000_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
};

describe('Absolute variables', () => {
  it('overlay a variable of another type byte by byte', () => {
    expect(
      output(`program T; type Parts = record Lo, Hi: Word end;
      var w: Word; b: array[0..1] of Byte absolute w; c: Char absolute w; l: LongInt; p: Parts absolute l;
        s: string[4]; len: Byte absolute s;
      begin w := $1234; WriteLn(b[0], ' ', b[1], ' ', c); b[1] := 1; Inc(b[0]); WriteLn(w);
        l := $00050006; WriteLn(p.Lo, ' ', p.Hi); p.Hi := 7; WriteLn(l);
        s := 'abc'; Write(len, ' '); len := 2; WriteLn(s); FillChar(b, 2, 0); WriteLn(w) end.`)
    ).toEqual(['52 18 4', '309', '6 5', '458758', '3 ab', '0']);
  });

  it('share cells, and an address, where the layouts match', () => {
    expect(
      output(
        `program T; var x: Integer; y: Integer absolute x; begin x := 5; Inc(y); WriteLn(x, ' ', @x = @y) end.`
      )
    ).toEqual(['6 TRUE']);
  });

  it('overlay var parameters, outer locals and variant records', () => {
    expect(
      output(`program T; type W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
      var r: W; rb: array[0..1] of Byte absolute r; v: Word; pb: ^Byte;
      procedure Inner(var p: Word); var pb2: array[0..1] of Byte absolute p; begin pb2[0] := 7 end;
      procedure Outer; var loc: Word;
        procedure Nested; var nb: array[0..1] of Byte absolute loc; begin nb[1] := 1 end;
      begin loc := 0; Nested; WriteLn(loc) end;
      begin r.w := $0102; Write(rb[0], rb[1], ' '); rb[1] := 9; WriteLn(r.hi, ' ', r.w);
        v := $1111; Inner(v); WriteLn(v); Outer;
        pb := @rb[0]; pb^ := 3; WriteLn(r.lo, ' ', r.w);
        asm mov al, rb[1]; mov byte ptr v, al end; WriteLn(v) end.`)
    ).toEqual(['21 9 2306', '4359', '256', '3 2307', '4361']);
  });
});

describe('Views of bytes', () => {
  it('store a string as its length and characters, leaving the bytes after', () => {
    expect(
      output(`program T; var b: array[0..3] of Byte; s: string[3] absolute b;
      begin FillChar(b, 4, 65); s := 'x'; WriteLn(b[0], ' ', b[1], ' ', b[2], ' ', b[3], ' ', s) end.`)
    ).toEqual(['1 120 65 65 x']);
  });

  it('reach the record a pointed-to variant case lies in', () => {
    expect(
      output(`program T; type W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
        Outer = record id: Byte; case Boolean of False: (n: W); True: (c: array[0..1] of Char) end;
      var o: Outer; p: ^Byte;
      begin o.n.w := $4344; p := @o.n.lo; p^ := $61; WriteLn(o.c[0], o.c[1], ' ', o.n.w) end.`)
    ).toEqual(['aC 17249']);
  });
});

describe('Untyped parameters', () => {
  it("show their caller's bytes to typecasts, absolute and byte routines", () => {
    expect(
      output(`program T; type TBytes = array[0..65519] of Byte; Rec = record a: Byte; s: string[3] end;
      var w: Word; l: LongInt; r: Rec;
      procedure Dump(var x; n: Word); var k: Word; begin for k := 0 to n - 1 do Write(TBytes(x)[k], ' '); WriteLn end;
      function Sum(const x; n: Word): Word; var k, s: Word; b: TBytes absolute x; begin s := 0; for k := 0 to n - 1 do Inc(s, b[k]); Sum := s end;
      procedure Fill(var x; n: Word; v: Byte); begin FillChar(x, n, v) end;
      procedure Twice(var x; n: Word); begin Fill(x, n, 65); TBytes(x)[0] := 66 end;
      procedure Copy2(const from; var dest; n: Word); begin Move(from, dest, n) end;
      begin w := $0102; Dump(w, 2); l := -2; Dump(l, 4); r.a := 5; r.s := 'hi'; Dump(r, 5); WriteLn(Sum(r, 3));
        Twice(w, 2); Write(w, ' '); Copy2(w, l, 2); WriteLn(l, ' ', Word(w)) end.`)
    ).toEqual(['2 1 ', '254 255 255 255 ', '5 2 104 105 0 ', '111', '16706 -48830 16706']);
  });

  it("bring the caller's variant records up to date after a routine changes their bytes", () => {
    expect(
      output(`program T; type W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end; var r: W;
      procedure Fill(var x; n: Word); begin FillChar(x, n, 1) end;
      begin r.w := 0; Fill(r, 2); WriteLn(r.lo, ' ', r.hi, ' ', r.w) end.`)
    ).toEqual(['1 1 257']);
  });
});

describe('Pointers into variant cases', () => {
  it('reach the other cases through what they store', () => {
    expect(
      output(`program T; type TA = array[0..3] of Byte; PA = ^TA;
        W = record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
        R = record id: Byte; case Byte of 0: (bytes: TA); 1: (l: LongInt) end;
      var v: W; x: R; p: ^Byte; q: ^Word; pt: PA; pl: ^LongInt;
      begin v.w := $1234; p := @v.lo; p^ := 5; WriteLn(v.w, ' ', p^); q := @v.w; q^ := $0102; WriteLn(v.lo, ' ', p^);
        p := @v.hi; Inc(p^); WriteLn(v.w);
        x.l := 0; pt := @x.bytes; pt^[2] := 5; WriteLn(x.l); pl := @x.l; pl^ := $01020304; WriteLn(pt^[0], ' ', pt^[3]);
        p := @x.bytes[1]; WriteLn(p = @x.bytes[1], ' ', p^); p^ := 0; WriteLn(x.l) end.`)
    ).toEqual(['4613 5', '2 2', '514', '327680', '4 1', 'TRUE 3', '16908292']);
  });
});

describe('Variable typecasts', () => {
  it("see a variable's bytes as another type of its size", () => {
    expect(
      output(`program T; type WordRec = record Lo, Hi: Byte end; LongRec = record Lo, Hi: Word end; Bytes4 = array[0..3] of Byte;
        V = record case Integer of 0: (w: Word); 1: (x, y: Byte) end;
      var w: Word; l: LongInt; s: Single; c: Char; i: Integer; r: V; p: Pointer;
      begin w := $1234; Write(WordRec(w).Lo, ' ', WordRec(w).Hi, ' '); WordRec(w).Hi := 1; WriteLn(w);
        l := $00050006; Write(LongRec(l).Lo, ' ', LongRec(l).Hi, ' '); LongRec(l).Hi := 7; Inc(LongRec(l).Lo); WriteLn(l);
        s := 1.0; Write(LongInt(s), ' '); l := $40490FDB; WriteLn(Single(l):0:5);
        Write(Bytes4(l)[3], ' '); Bytes4(l)[0] := 0; WriteLn(l);
        c := 'A'; Byte(c) := 66; i := -1; Write(c, ' ', Word(i), ' '); Word(i) := 5; WriteLn(i);
        r.w := $0102; WordRec(r.w).Lo := 9; Write(r.x, ' ', r.w, ' '); p := @w; WriteLn(LongInt(p) > 0) end.`)
    ).toEqual([
      '52 18 308',
      '6 5 458759',
      '1065353216 3.14159',
      '64 1078529792',
      'B 65535 5',
      '9 265 TRUE',
    ]);
  });

  it('read an address typecast to another pointer type as the variable seen as that type', () => {
    expect(
      output(`program T; type PWord = ^Word; PByte = ^Byte; PSingle = ^Single; var l: LongInt;
      begin l := $00050006; Write(PWord(@l)^, ' '); PWord(@l)^ := 9; Write(l, ' '); PByte(@l)^ := 1; WriteLn(l);
        l := $3F800000; Write(PSingle(@l)^:0:1, ' '); Inc(PByte(@l)^); WriteLn(l) end.`)
    ).toEqual(['6 327689 327681', '1.0 1065353217']);
  });

  it('keep the size, and ordinal values convert as before', () => {
    expect(() =>
      compile(
        'program T; type WR = record Lo, Hi: Byte end; var l: LongInt; begin WR(l).Lo := 1 end.'
      )
    ).toThrow(/Invalid typecast/);
    expect(
      output(
        'program T; var w: Word; b: Byte; begin w := $1234; b := Byte(w); WriteLn(b, Char(65)) end.'
      )
    ).toEqual(['52A']);
  });
});

describe('The @ operator', () => {
  it('gives an untyped pointer unless {$T+} types it', () => {
    expect(
      output(`program T; type TA = array[0..3] of Byte; PA = ^TA; R = record id: Byte; bytes: array[0..3] of Byte end;
      var x: R; pt: PA; pw: ^Word; w: Word;
      begin pt := @x.bytes; pt^[1] := 7; w := 5; pw := @w; WriteLn(x.bytes[1], pw^) end.`)
    ).toEqual(['75']);
    expect(() =>
      compile(`program T; {$T+} type TA = array[0..3] of Byte; PA = ^TA; R = record id: Byte; bytes: array[0..3] of Byte end;
      var x: R; pt: PA; begin pt := @x.bytes end.`)
    ).toThrow(/Type mismatch/);
    expect(
      output('program T; {$T+} var w: Word; p: ^Word; begin w := 3; p := @w; WriteLn(p^) end.')
    ).toEqual(['3']);
  });
});

describe('Pointers of another type', () => {
  it('read and write the bytes of the variable whose address they hold', () => {
    expect(
      output(`program T; type TBytes = array[0..3] of Byte; PBytes = ^TBytes; TR = record a: Byte; w: Word end;
      var l: LongInt; pw: ^Word; pb: ^Byte; ps: ^Single; pt: PBytes; p: Pointer; r: TR; w: Word; q: ^Word; arr: array[1..3] of Word;
      procedure Take(var x: LongInt); var pv: ^Word; begin pv := @x; pv^ := 1 end;
      begin l := $00050006; pw := @l; Write(pw^, ' '); pw^ := 9; Write(l, ' '); p := @l; pb := p; pb^ := 1; WriteLn(l);
        l := $3F800000; ps := @l; Write(ps^:0:1, ' '); pt := @l; Write(pt^[3], ' '); pt^[0] := 7; WriteLn(l);
        w := 5; q := @w; WriteLn(q^, ' ', q = @w, ' ', @l = @l, ' ', pw = @l);
        r.w := $0102; pb := @r.w; Write(pb^, ' '); Inc(pb^); Write(r.w, ' ');
        arr[2] := $0304; pb := @arr[2]; pw := @arr[2]; WriteLn(pb^, ' ', pw^);
        l := $00050006; Take(l); WriteLn(l) end.`)
    ).toEqual([
      '6 327689 327681',
      '1.0 63 1065353223',
      '5 TRUE TRUE TRUE',
      '2 259 4 772',
      '327681',
    ]);
  });

  it('compare equal however the address was taken', () => {
    expect(
      output(`program T; type PW = ^Word; var p, q: PW; w: Word;
      begin New(p); q := @p^; w := 1; WriteLn(p = q, ' ', q = @p^, ' ', p <> @w) end.`)
    ).toEqual(['TRUE TRUE TRUE']);
  });

  it('keep lists, PChars and pointers of the same type working as before', () => {
    expect(
      output(`program T; uses Strings; type PNode = ^TNode; TNode = record v: Integer; next: PNode end;
      var head, n: PNode; pp: ^PNode; i: Integer; buf: array[0..15] of Char; p, q: PChar;
      begin head := nil;
        for i := 1 to 3 do begin pp := @head; while pp^ <> nil do pp := @pp^^.next; New(pp^); pp^^.v := i; pp^^.next := nil end;
        n := head; while n <> nil do begin Write(n^.v); n := n^.next end; WriteLn;
        StrCopy(@buf, 'hello'); p := @buf[0]; q := StrEnd(p); WriteLn(StrLen(p), ' ', q - p, ' ', p[1], p[4], ' ', StrPas(@buf[1])) end.`)
    ).toEqual(['123', '5 5 eo ello']);
  });
});

describe('Reading past the variable through a pointer', () => {
  const failure = (source: string) => {
    const machine = new Machine(compile(source), { maxInstructions: 2_000_000 });
    expect(() => {
      machine.run();
    }).toThrow(/Access beyond the variable/);
    expect(machine.getState()).toBe(MachineState.ERROR);
    return machine.getOutput();
  };

  it('is a run-time error rather than the memory that follows', () => {
    expect(
      failure(
        `program T; var w, x: Word; pl: ^LongInt; begin w := 1; x := 2; pl := @w; WriteLn(pl^) end.`
      )
    ).toEqual([]);
    expect(
      failure(
        `program T; var w, x: Word; pl: ^LongInt; begin w := 1; x := 2; pl := @w; pl^ := 7 end.`
      )
    ).toEqual([]);
    expect(
      failure(`program T; type T8 = array[0..7] of Byte; var l, x: LongInt; p: ^T8;
      begin l := 1; x := 5; p := @l; WriteLn(p^[3]); WriteLn(p^[4]) end.`)
    ).toEqual(['0']);
    expect(
      failure(`program T; type TR = record a, b: Word end; var r: TR; pl: ^LongInt; pw: ^Word;
      begin r.a := 1; r.b := 2; pw := @r.a; pl := Pointer(pw); WriteLn(pl^); pw := @r.b; pl := Pointer(pw); WriteLn(pl^) end.`)
    ).toEqual(['131073']);
    expect(
      failure(`program T; var a: array[1..2] of Byte; pw: ^Word;
      begin a[1] := 1; a[2] := 2; pw := @a[1]; WriteLn(pw^); pw := @a[2]; WriteLn(pw^) end.`)
    ).toEqual(['513']);
    expect(
      failure(`program T; procedure P(var x: Word); var pl: ^LongInt; begin pl := @x; WriteLn(pl^) end;
      var w: Word; begin w := 1; P(w) end.`)
    ).toEqual([]);
  });

  it('leaves addresses made by Ptr or from a string character plain, reading on past the variable', () => {
    expect(
      output(`program T; var l: LongInt; w, x: Word; s: string[3]; b: Byte; pw: ^Word; pl: ^LongInt;
      begin l := $00050006; pw := Ptr(Seg(l), Ofs(l)); WriteLn(pw^);
        w := 1; x := 2; pl := Ptr(Seg(w), Ofs(w)); WriteLn(pl^);
        s := 'ABC'; b := 1; pw := @s[1]; WriteLn(pw^); pw := @s[3]; WriteLn(pw^) end.`)
    ).toEqual(['6', '131073', '16961', '323']);
  });
});

describe('FileRec and TextRec', () => {
  it("show a file's handle, mode, record size and name", () => {
    expect(
      output(`program T; uses Dos; type R = record a: Word; b: LongInt end; var f: file of R; t: Text; u: file;
      function Name(const n: array of Char): string; var s: string; i: Integer;
      begin s := ''; i := 0; while n[i] <> #0 do begin s := s + n[i]; Inc(i) end; Name := s end;
      begin Assign(f, 'data.bin'); WriteLn(FileRec(f).Mode = fmClosed, ' ', Name(FileRec(f).Name), ' ', FileRec(f).RecSize);
        Rewrite(f); WriteLn(FileRec(f).Mode = fmInOut, ' ', FileRec(f).Handle >= 5); Close(f);
        Assign(t, 'x.txt'); Rewrite(t); WriteLn(TextRec(t).Mode = fmOutput, ' ', TextRec(t).BufSize, ' ', Name(TextRec(t).Name)); Close(t);
        WriteLn(TextRec(Output).Mode = fmOutput, ' ', TextRec(Output).Handle, ' ', TextRec(Input).Handle, ' ', SizeOf(FileRec), ' ', SizeOf(TextRec));
        Assign(u, 'x.txt'); Reset(u, 1); WriteLn(FileRec(u).RecSize, ' ', FileRec(u).Mode = fmInOut) end.`)
    ).toEqual(['TRUE data.bin 6', 'TRUE TRUE', 'TRUE 128 x.txt', 'TRUE 1 0 128 256', '1 TRUE']);
    expect(() => compile('program T; var f: Text; begin WriteLn(FileRec(f).Mode) end.')).toThrow(
      /Undeclared|Unknown/
    );
  });
});

describe('Structure sizes', () => {
  it("allow Turbo Pascal's 65520 bytes, and a type as large for typecasts", () => {
    expect(() => compile('program T; type B = array[0..65519] of Byte; begin end.')).not.toThrow();
    expect(() => compile('program T; type B = array[0..65520] of Byte; begin end.')).toThrow(
      /Array size exceeds supported storage/
    );
    // A global that large leaves no room for the System unit's own data.
    expect(() => compile('program T; var b: array[0..65519] of Byte; begin end.')).toThrow(
      /Data segment too large/
    );
    expect(
      output(`program T; var b: array[0..60000] of Byte; c: Byte;
      begin FillChar(b, SizeOf(b), 2); c := 5; b[60000] := 3; WriteLn(b[0] + b[59999] + b[60000], ' ', c) end.`)
    ).toEqual(['7 5']);
    // So may a program's code, past 32K instructions.
    const lines = Array.from(
      { length: 4000 },
      (_, i) => `if a > ${String(i)} then b := b + 1;`
    ).join('\n');
    expect(
      output(`program T; var a, b: LongInt; begin a := 5000; b := 0;\n${lines}\nWriteLn(b) end.`)
    ).toEqual(['4000']);
    expect(() => compile('program T; type R = Integer; var r: R; begin end.')).toThrow(
      /Duplicate identifier/
    );
  });
});
