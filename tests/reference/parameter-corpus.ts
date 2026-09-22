import type { ReferenceCase } from './corpus';

/** Turbo Pascal 7's parameter forms beyond value and VAR: constant
 * parameters, open arrays and untyped parameters. */
export const parameterCases: ReferenceCase[] = [
  {
    name: 'const-parameters-are-read-only-values',
    source: `program T;
type Point = record X, Y: Integer end;
procedure Show(const s: string; const n: Integer; const p: Point; const c: Char);
begin WriteLn(s, ' ', n, ' ', p.X + p.Y, ' ', c) end;
procedure Twice(const n: Integer); forward;
procedure Twice(const n: Integer); begin WriteLn(n * 2) end;
var q: Point;
begin q.X := 3; q.Y := 4; Show('abc', 42, q, 'z'); Twice(21) end.`,
    output: ['abc 42 7 z', '42'],
  },
  {
    name: 'const-parameter-cannot-be-assigned',
    source: `program T; procedure P(const n: Integer); begin n := 1 end; begin P(2) end.`,
    reject: true,
  },
  {
    name: 'const-parameter-cannot-be-passed-as-var',
    source: `program T; procedure Change(var n: Integer); begin n := 1 end;
procedure P(const n: Integer); begin Change(n) end; begin P(2) end.`,
    reject: true,
  },
  {
    name: 'open-array-parameters-take-any-bounds',
    source: `program T;
function Sum(const a: array of Integer): LongInt;
var i: Integer; s: LongInt;
begin s := 0; for i := Low(a) to High(a) do s := s + a[i]; Sum := s end;
function Count(const a: array of Integer): Integer; begin Count := Sum(a) div (High(a) + 1) end;
var v: array[5..8] of Integer; w: array[-1..0] of Integer; i: Integer;
begin
  for i := 5 to 8 do v[i] := i; w[-1] := 10; w[0] := 20;
  WriteLn(Sum(v), ' ', Sum(w), ' ', Count(v), ' ', Count(w))
end.`,
    output: ['26 30 6 15'],
  },
  {
    name: 'open-array-var-and-value-semantics',
    source: `program T;
procedure Clear(a: array of Integer); var i: Integer;
begin for i := 0 to High(a) do a[i] := 0; Write(a[0], ' ') end;
procedure Fill(var a: array of Integer; value: Integer); var i: Integer;
begin for i := 0 to High(a) do a[i] := value + i end;
function Size(const a: array of Integer): Integer; begin Size := SizeOf(a) end;
var v: array[1..3] of Integer;
begin
  v[1] := 7; v[2] := 8; v[3] := 9; Clear(v); WriteLn(v[1], v[2], v[3]);
  Fill(v, 40); WriteLn(v[1], ' ', v[3], ' ', Size(v), ' ', SizeOf(v))
end.`,
    output: ['0 789', '40 42 6 6'],
  },
  {
    name: 'open-arrays-of-records-strings-and-chars',
    source: `program T;
type Item = record Name: string[8]; Qty: Integer end;
function Total(const items: array of Item): Integer; var i, t: Integer;
begin t := 0; for i := 0 to High(items) do t := t + items[i].Qty; Total := t end;
function Longest(const words: array of string): Integer; var i, n: Integer;
begin n := 0; for i := 0 to High(words) do if Length(words[i]) > n then n := Length(words[i]); Longest := n end;
function Last(const c: array of Char): Char; begin Last := c[High(c)] end;
var stock: array[1..2] of Item; words: array[0..2] of string; letters: array['a'..'c'] of Char;
begin
  stock[1].Name := 'pen'; stock[1].Qty := 3; stock[2].Name := 'ink'; stock[2].Qty := 4;
  words[0] := 'a'; words[1] := 'abcd'; words[2] := 'ab';
  letters['a'] := 'x'; letters['b'] := 'y'; letters['c'] := 'z';
  WriteLn(Total(stock), ' ', Longest(words), ' ', Last(letters))
end.`,
    output: ['7 4 z'],
  },
  {
    name: 'open-array-element-type-must-match',
    source: `program T; procedure P(const a: array of Integer); begin end;
var b: array[1..3] of Byte; begin P(b) end.`,
    reject: true,
  },
  {
    name: 'untyped-parameters-are-used-through-typecasts',
    source: `program T;
procedure Store(var target; value: Integer); begin Integer(target) := value end;
function Fetch(const source): LongInt; begin Fetch := LongInt(source) end;
procedure Swap(var a, b); var t: Integer; begin t := Integer(a); Integer(a) := Integer(b); Integer(b) := t end;
var i, j: Integer; l: LongInt; p: ^Integer;
procedure Point(var x); begin p := @x end;
begin
  Store(i, 42); j := 7; Swap(i, j); l := 123456; Point(j);
  WriteLn(i, ' ', j, ' ', Fetch(l), ' ', p^)
end.`,
    output: ['7 42 123456 42'],
  },
  {
    name: 'untyped-parameter-needs-a-typecast',
    source: `program T; procedure P(var x); begin x := 1 end; var i: Integer; begin P(i) end.`,
    reject: true,
  },
  {
    name: 'procedural-types-with-const-and-open-array-parameters',
    source: `program T;
type Reducer = function(const a: array of Integer): Integer;
{$F+} function First(const a: array of Integer): Integer; begin First := a[0] end;
function Top(const a: array of Integer): Integer; begin Top := a[High(a)] end; {$F-}
var r: Reducer; v: array[1..3] of Integer;
begin v[1] := 4; v[2] := 5; v[3] := 6; r := First; Write(r(v), ' '); r := Top; WriteLn(r(v)) end.`,
    output: ['4 6'],
  },
];
