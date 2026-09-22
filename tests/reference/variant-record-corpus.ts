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
    name: 'variant-record-field-names-are-unique',
    source: `program T; type R = record A: Integer; case Boolean of True: (A: Char) end; begin end.`,
    reject: true,
  },
];
