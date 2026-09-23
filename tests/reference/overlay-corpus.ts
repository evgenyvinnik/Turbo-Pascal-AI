import type { ReferenceCase } from './corpus';

/** Storage seen as another type: absolute variables, typecasts of untyped
 * parameters, and pointers into variant cases. Records are packed, so Free
 * Pascal lays their bytes out as Turbo Pascal does. */
export const overlayCases: ReferenceCase[] = [
  {
    name: 'overlay-variable-typecasts-see-bytes',
    source: `program T;
type WordRec = packed record Lo, Hi: Byte end;
  LongRec = packed record Lo, Hi: Word end;
  Bytes4 = array[0..3] of Byte;
  V = packed record case Integer of 0: (w: Word); 1: (x, y: Byte) end;
var w: Word; l: LongInt; s: Single; c: Char; r: V;
begin
  w := $1234; WriteLn(WordRec(w).Lo, ' ', WordRec(w).Hi); WordRec(w).Hi := 1; WriteLn(w);
  l := $00050006; WriteLn(LongRec(l).Lo, ' ', LongRec(l).Hi); LongRec(l).Hi := 7; Inc(LongRec(l).Lo); WriteLn(l);
  s := 1.0; WriteLn(LongInt(s)); l := $40490FDB; WriteLn(Single(l):0:5);
  WriteLn(Bytes4(l)[3]); Bytes4(l)[0] := 0; WriteLn(l);
  c := 'A'; Byte(c) := 66; WriteLn(c);
  r.w := $0102; WordRec(r.w).Lo := 9; WriteLn(r.x, ' ', r.w)
end.`,
    output: [
      '52 18',
      '308',
      '6 5',
      '458759',
      '1065353216',
      '3.14159',
      '64',
      '1078529792',
      'B',
      '9 265',
    ],
  },
  {
    name: 'overlay-address-typecast-to-another-pointer',
    source: `program T;
type PWord = ^Word; PByte = ^Byte; PSingle = ^Single;
var l: LongInt;
begin
  l := $00050006; WriteLn(PWord(@l)^); PWord(@l)^ := 9; WriteLn(l); PByte(@l)^ := 1; WriteLn(l);
  l := $3F800000; WriteLn(PSingle(@l)^:0:1); Inc(PByte(@l)^); WriteLn(l)
end.`,
    output: ['6', '327689', '327681', '1.0', '1065353217'],
  },
  {
    name: 'overlay-pointers-of-another-type-see-bytes',
    source: `program T;
type TBytes = array[0..3] of Byte; PBytes = ^TBytes; TR = packed record a: Byte; w: Word end;
  PNode = ^TNode; TNode = record v: Integer; next: PNode end;
var l: LongInt; pw: ^Word; pb: ^Byte; ps: ^Single; pt: PBytes; p: Pointer; r: TR;
  head, n: PNode; pp: ^PNode; i: Integer;
procedure Take(var x: LongInt); var pv: ^Word; begin pv := @x; pv^ := 1 end;
begin
  l := $00050006; pw := @l; WriteLn(pw^); pw^ := 9; WriteLn(l); p := @l; pb := p; pb^ := 1; WriteLn(l);
  l := $3F800000; ps := @l; WriteLn(ps^:0:1); pt := @l; WriteLn(pt^[3]); pt^[0] := 7; WriteLn(l);
  r.w := $0102; pb := @r.w; WriteLn(pb^); Inc(pb^); WriteLn(r.w);
  l := $00050006; Take(l); WriteLn(l);
  head := nil;
  for i := 1 to 3 do begin pp := @head; while pp^ <> nil do pp := @pp^^.next; New(pp^); pp^^.v := i; pp^^.next := nil end;
  n := head; while n <> nil do begin Write(n^.v); n := n^.next end; WriteLn
end.`,
    output: ['6', '327689', '327681', '1.0', '63', '1065353223', '2', '259', '327681', '123'],
  },
  {
    name: 'overlay-address-is-untyped-by-default',
    source: `program T;
type TA = array[0..3] of Byte; PA = ^TA;
  R = packed record id: Byte; bytes: array[0..3] of Byte end;
var x: R; pt: PA; pw: ^Word; w: Word;
begin
  pt := @x.bytes; pt^[1] := 7; WriteLn(x.bytes[1]);
  w := 5; pw := @w; WriteLn(pw^)
end.`,
    output: ['7', '5'],
  },
  {
    name: 'overlay-typed-address-under-t-plus-must-match',
    source: `program T; {$T+}
type TA = array[0..3] of Byte; PA = ^TA;
  R = packed record id: Byte; bytes: array[0..3] of Byte end;
var x: R; pt: PA;
begin pt := @x.bytes end.`,
    reject: true,
  },
  {
    name: 'overlay-variable-typecast-must-keep-the-size',
    source: `program T;
type WordRec = packed record Lo, Hi: Byte end;
var l: LongInt;
begin WordRec(l).Lo := 1 end.`,
    reject: true,
  },
  {
    name: 'overlay-absolute-variables-share-bytes',
    source: `program T;
type Parts = packed record Lo, Hi: Word end;
var w: Word; b: array[0..1] of Byte absolute w; c: Char absolute w;
  l: LongInt; p: Parts absolute l;
  s: string[4]; len: Byte absolute s;
  x: Integer; y: Integer absolute x;
  pb: ^Byte;
procedure Inner(var v: Word); var vb: array[0..1] of Byte absolute v; begin vb[0] := 7 end;
procedure Outer;
var loc: Word;
  procedure Nested; var nb: array[0..1] of Byte absolute loc; begin nb[1] := 1 end;
begin loc := 0; Nested; WriteLn(loc) end;
begin
  w := $1234; WriteLn(b[0], ' ', b[1], ' ', c); b[1] := 1; WriteLn(w); Inc(b[0]); WriteLn(w);
  l := $00050006; WriteLn(p.Lo, ' ', p.Hi); p.Hi := 7; WriteLn(l);
  s := 'abc'; WriteLn(len); len := 2; WriteLn(s);
  x := 5; Inc(y); WriteLn(x);
  pb := @b[1]; pb^ := 9; WriteLn(w);
  FillChar(b, 2, 0); WriteLn(w);
  w := $1111; Inner(w); WriteLn(w); Outer
end.`,
    output: ['52 18 4', '308', '309', '6 5', '458758', '3', 'ab', '6', '2357', '0', '4359', '256'],
  },
  {
    name: 'overlay-untyped-parameters-are-bytes',
    source: `program T;
type TBytes = array[0..65519] of Byte;
  Rec = packed record a: Byte; s: string[3] end;
var w: Word; l: LongInt; r: Rec; f: file; data: file of Byte; i: Byte;
procedure Dump(var x; n: Word); var k: Word; begin for k := 0 to n - 1 do Write(TBytes(x)[k], ' '); WriteLn end;
function Sum(const x; n: Word): Word; var k, s: Word; b: TBytes absolute x;
begin s := 0; for k := 0 to n - 1 do s := s + b[k]; Sum := s end;
procedure Fill(var x; n: Word; v: Byte); begin FillChar(x, n, v) end;
procedure Twice(var x; n: Word); begin Fill(x, n, 65); TBytes(x)[0] := 66 end;
procedure Copy2(const from; var dest; n: Word); begin Move(from, dest, n) end;
procedure Load(var x; n: Word); var got: Word; begin BlockRead(f, x, n, got) end;
begin
  w := $0102; Dump(w, 2); l := -2; Dump(l, 4);
  r.a := 5; r.s := 'hi'; Dump(r, 3); WriteLn(Sum(r, 3));
  Twice(w, 2); WriteLn(w); Copy2(w, l, 2); WriteLn(l);
  Fill(l, 4, 0); WriteLn(l);
  Assign(data, 'overlay.bin'); Rewrite(data); for i := 1 to 4 do Write(data, i); Close(data);
  Assign(f, 'overlay.bin'); Reset(f, 1); Load(l, 4); Close(f); Erase(f); WriteLn(l)
end.`,
    output: ['2 1 ', '254 255 255 255 ', '5 2 104 ', '111', '16706', '-48830', '0', '67305985'],
  },
  {
    name: 'overlay-pointers-into-variant-cases',
    source: `program T;
type TA = array[0..3] of Byte; PA = ^TA;
  W = packed record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
  R = packed record id: Byte; case Byte of 0: (bytes: TA); 1: (l: LongInt) end;
var v: W; x: R; p: ^Byte; q: ^Word; pt: PA; pl: ^LongInt;
begin
  v.w := $1234; p := @v.lo; p^ := 5; WriteLn(v.w, ' ', p^);
  q := @v.w; q^ := $0102; WriteLn(v.lo, ' ', p^);
  p := @v.hi; Inc(p^); WriteLn(v.w);
  x.l := 0; pt := @x.bytes; pt^[2] := 5; WriteLn(x.l);
  pl := @x.l; pl^ := $01020304; WriteLn(pt^[0], ' ', pt^[3]);
  p := @x.bytes[1]; WriteLn(p = @x.bytes[1], ' ', p^); p^ := 0; WriteLn(x.l)
end.`,
    output: ['4613 5', '2 2', '514', '327680', '4 1', 'TRUE 3', '16908292'],
  },
];
