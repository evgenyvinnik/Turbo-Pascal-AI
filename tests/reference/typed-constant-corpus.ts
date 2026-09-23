import type { ReferenceCase } from './corpus';

/** Typed constants: initialized variables with static storage, which keep
 * their values between calls of the routine that declares them. */
export const typedConstantCases: ReferenceCase[] = [
  {
    name: 'typed-constant-scalars',
    source: `program T;
const N: Integer = 5; R: Real = 1.5; S: string[10] = 'abc'; C: Char = 'x';
  B: Boolean = True; W: Word = 65535; X: Integer = (1 + 2) * 3; L: LongInt = -7;
begin WriteLn(N, ' ', R:0:2, ' ', S, ' ', C, ' ', B, ' ', W, ' ', X, ' ', L) end.`,
    output: ['5 1.50 abc x TRUE 65535 9 -7'],
  },
  {
    name: 'typed-constant-keeps-its-value-between-calls',
    source: `program T;
procedure Count;
const Calls: Integer = 0;
begin Inc(Calls); Write(Calls, ' ') end;
function Depth(n: Integer): Integer;
const Deepest: Integer = 0;
begin if n > Deepest then Deepest := n; if n < 3 then Depth := Depth(n + 1) else Depth := Deepest end;
begin Count; Count; Count; WriteLn; WriteLn(Depth(1)) end.`,
    output: ['1 2 3 ', '3'],
  },
  {
    name: 'typed-constant-is-writable',
    source: `program T;
const Total: Integer = 10; Name: string = 'old';
begin Total := Total + 5; Name := Name + '!'; WriteLn(Total, ' ', Name) end.`,
    output: ['15 old!'],
  },
  {
    name: 'typed-constant-arrays',
    source: `program T;
const A: array[1..3] of Integer = (10, 20, 30);
  M: array[1..2, 1..3] of Integer = ((1, 2, 3), (4, 5, 6));
  W: array[1..3] of Char = 'abc';
  Names: array[0..1] of string[5] = ('one', 'two');
  Only: array[1..1] of Integer = (7);
var i, j: Integer;
begin
  for i := 1 to 3 do Write(A[i], ' '); WriteLn;
  for i := 1 to 2 do for j := 1 to 3 do Write(M[i, j]); WriteLn;
  WriteLn(W[1], W[2], W[3], ' ', Names[0], Names[1], ' ', Only[1])
end.`,
    output: ['10 20 30 ', '123456', 'abc onetwo 7'],
  },
  {
    name: 'typed-constant-records',
    source: `program T;
type Point = record X, Y: Integer; Tag: Char end;
const Origin: Point = (X: 1; Y: 2; Tag: 'o');
  Corners: array[1..2] of Point = ((X: 0; Y: 0; Tag: 'a'), (X: 9; Y: 9; Tag: 'b'));
begin
  WriteLn(Origin.X, ' ', Origin.Y, ' ', Origin.Tag);
  WriteLn(Corners[2].X, Corners[1].Tag, Corners[2].Tag)
end.`,
    output: ['1 2 o', '9ab'],
  },
  {
    name: 'typed-constant-enums-and-sets',
    source: `program T;
type Color = (Red, Green, Blue);
const Favourite: Color = Green; Mix: set of Color = [Red, Blue];
  Vowels: set of Char = ['a', 'e', 'i', 'o', 'u'];
begin WriteLn(Ord(Favourite), ' ', Blue in Mix, ' ', Green in Mix, ' ', 'e' in Vowels) end.`,
    output: ['1 TRUE FALSE TRUE'],
  },
  {
    name: 'typed-constant-addresses-of-globals',
    source: `program T;
type Rec = record A, B: Integer end; PRec = ^Rec; PInt = ^Integer;
var G: Integer;
const Cfg: array[1..2] of Rec = ((A: 1; B: 2), (A: 3; B: 4));
  P: PRec = @Cfg[2]; Q: PInt = PInt(@Cfg[1].B); R: ^Integer = @G; N: Pointer = nil;
begin G := 7; WriteLn(P^.A, ' ', Q^, ' ', R^, ' ', N = nil); P^.B := 9; WriteLn(Cfg[2].B) end.`,
    output: ['3 2 7 TRUE', '9'],
  },
  {
    name: 'typed-constant-procedures-and-objects',
    source: `program T;
type Op = function(a, b: Integer): Integer;
  Shape = object Sides: Integer; Name: string[8] end;
{$F+} function Add(a, b: Integer): Integer; begin Add := a + b end;
function Mul(a, b: Integer): Integer; begin Mul := a * b end; {$F-}
const Ops: array[1..2] of Op = (Add, Mul);
  Square: Shape = (Sides: 4; Name: 'square');
var i: Integer;
begin for i := 1 to 2 do Write(Ops[i](3, 4), ' '); WriteLn(Square.Name, ' ', Square.Sides) end.`,
    output: ['7 12 square 4'],
  },
  {
    name: 'typed-constant-in-a-unit-is-set-before-its-initialization',
    source: `program T; uses Counter;
begin WriteLn(Start, ' ', Next, ' ', Next) end.`,
    units: {
      Counter: `unit Counter;
interface
const Start: Integer = 100;
function Next: Integer;
implementation
function Next: Integer;
const Current: Integer = 0;
begin Inc(Current); Next := Start + Current end;
begin Start := Start + 1 end.`,
    },
    output: ['101 102 103'],
  },
  {
    name: 'typed-constant-is-not-a-constant-expression',
    source: `program T; const A: Integer = 1; B = A + 1; begin WriteLn(B) end.`,
    reject: true,
  },
];
