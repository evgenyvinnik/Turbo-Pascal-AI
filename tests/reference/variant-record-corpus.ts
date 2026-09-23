import type { ReferenceCase } from './corpus';

/** Records with variant parts: cases that share storage after the fixed part.
 * Sizes are checked only where Free Pascal's field alignment agrees with
 * Turbo Pascal's packed records. */
export const variantRecordCases: ReferenceCase[] = [
  {
    name: 'variant-record-with-a-tag-field',
    source: `program T;
type Kind = (Circle, Rect);
  Shape = record
    Name: string[10];
    case K: Kind of
      Circle: (Radius: Integer);
      Rect: (W, H: Integer)
  end;
function Area(const s: Shape): Integer;
begin case s.K of Circle: Area := 3 * s.Radius * s.Radius; Rect: Area := s.W * s.H end end;
var a, b: Shape;
begin
  a.Name := 'disc'; a.K := Circle; a.Radius := 2;
  b.Name := 'box'; b.K := Rect; b.W := 3; b.H := 4;
  WriteLn(a.Name, ' ', Area(a), ' ', b.Name, ' ', Area(b), ' ', SizeOf(Shape))
end.`,
    output: ['disc 12 box 12 16'],
  },
  {
    name: 'variant-record-cases-share-storage',
    source: `program T;
type Pair = record
    case Integer of
      0: (A, B: Integer);
      1, 2: (C: Integer);
      3..5: (D: Integer; E: Word)
  end;
var p: Pair;
begin p.A := 5; p.B := 6; WriteLn(p.C, ' ', p.D, ' ', p.E, ' ', SizeOf(Pair)); p.C := 9; WriteLn(p.A) end.`,
    output: ['5 5 6 4', '9'],
  },
  {
    name: 'variant-record-nested-variant-and-with',
    source: `program T;
type Node = record
    Id: Integer;
    case Leaf: Boolean of
      True: (Value: LongInt);
      False: (case Wide: Boolean of True: (Left, Right: Integer); False: (Only: Integer))
  end;
var n: Node;
begin
  with n do begin Id := 1; Leaf := False; Wide := True; Left := 10; Right := 20 end;
  WriteLn(n.Id, ' ', n.Left + n.Right)
end.`,
    output: ['1 30'],
  },
  {
    name: 'variant-record-typed-constant-gives-one-case',
    source: `program T;
type Kind = (Num, Chr);
  Cell = record case K: Kind of Num: (N: Integer); Chr: (C: Char) end;
const Letter: Cell = (K: Chr; C: 'q'); Number: Cell = (K: Num; N: 42);
begin WriteLn(Ord(Letter.K), Letter.C, ' ', Ord(Number.K), ' ', Number.N) end.`,
    output: ['1q 0 42'],
  },
  {
    name: 'variant-record-cases-overlay-byte-by-byte',
    source: `program T;
type W = packed record case Integer of 0: (w, v: Word); 1: (lo, hi, lo2, hi2: Byte); 2: (c: array[1..4] of Char) end;
  L = packed record case Byte of 0: (l: LongInt); 1: (a, b: Word); 2: (s: string[3]) end;
const K: W = (lo: 1; hi: 2);
var r, u: W; x: L; code: Integer;
procedure Bump(var b: Byte); begin b := b + 16 end;
begin
  r.w := $1234; r.v := $5678; WriteLn(r.lo, ' ', r.hi, ' ', r.lo2, ' ', r.hi2);
  r.hi := 1; WriteLn(r.w, ' ', r.v, ' ', K.w);
  Inc(r.lo); Bump(r.hi2); WriteLn(r.w, ' ', r.v);
  Val('16706', r.w, code); WriteLn(r.c[1], r.c[2]);
  with r do begin lo2 := 67; hi2 := 68 end; WriteLn(r.c[3], r.c[4], ' ', r.v);
  FillChar(u, SizeOf(u), 65); WriteLn(u.w, ' ', u.c[4]);
  x.l := $43424103; WriteLn(x.a, ' ', x.b, ' ', x.s);
  x.s := 'hi'; WriteLn(x.a, ' ', x.l);
  Move(x, u, 4); WriteLn(u.lo, ' ', u.hi, ' ', u.c[3], u.c[4])
end.`,
    output: ['52 18 120 86', '308 22136 513', '309 26232', 'BA', 'CD 17475', '16705 A', '16643 17218 ABC', '26626 1130981378', '2 104 iC'],
  },
  {
    name: 'variant-record-nested-cases-and-fields-overlay',
    source: `program T;
type W = packed record case Integer of 0: (w: Word); 1: (lo, hi: Byte) end;
  TNode = packed record kind: Byte; case Byte of
    0: (x: Word; case Byte of 0: (y: LongInt); 1: (a, b: Word));
    1: (bytes: array[0..6] of Byte) end;
  Outer = packed record id: Byte; inner: W; case Boolean of False: (n: W); True: (c: array[0..1] of Char) end;
var n: TNode; o: Outer; arr: array[1..3] of W; i: Integer; p: ^W;
function Next: Integer; begin Inc(i); Next := i end;
begin
  n.x := $0304; n.y := $0A0B0C0D; WriteLn(n.bytes[0], ' ', n.bytes[2], ' ', n.bytes[5], ' ', n.a, ' ', n.b);
  n.bytes[6] := 7; WriteLn(n.b); n.a := 1; WriteLn(n.y);
  o.inner.w := $4142; WriteLn(o.inner.lo); o.n.w := $4344; WriteLn(o.c[0], o.c[1]);
  with o.n do lo := $61; WriteLn(o.c[0]);
  i := 0; arr[Next].w := $0708; WriteLn(i, ' ', arr[1].lo, ' ', arr[1].hi);
  New(p); p^.w := $0506; WriteLn(p^.lo, ' ', p^.hi); Dispose(p)
end.`,
    output: ['4 13 10 3085 2571', '2571', '168493057', '66', 'DC', 'a', '1 8 7', '6 5'],
  },
  {
    name: 'variant-record-files-keep-the-bytes',
    source: `program T;
type R = packed record tag: Byte; case Byte of 0: (w: Word); 1: (lo, hi: Byte) end;
var f: file of R; a, b: R;
begin
  a.tag := 9; a.w := $0102;
  Assign(f, 'variant.dat'); Rewrite(f); Write(f, a); Close(f);
  Reset(f); Read(f, b); Close(f); Erase(f);
  WriteLn(b.tag, ' ', b.lo, ' ', b.hi, ' ', SizeOf(R))
end.`,
    output: ['9 2 1 3'],
  },
  {
    name: 'variant-record-field-names-are-unique',
    source: `program T; type R = record A: Integer; case Boolean of True: (A: Char) end; begin end.`,
    reject: true,
  },
];
