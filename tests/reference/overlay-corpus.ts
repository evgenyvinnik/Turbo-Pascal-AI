import type { ReferenceCase } from './corpus';

/** Storage seen as another type: absolute variables, typecasts of untyped
 * parameters, and pointers into variant cases. Records are packed, so Free
 * Pascal lays their bytes out as Turbo Pascal does. */
export const overlayCases: ReferenceCase[] = [
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
