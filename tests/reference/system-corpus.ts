import type { ReferenceCase } from './corpus';

/** System unit routines, types and declarations beyond the core language.
 * Comp is left to the unit tests: on aarch64 Free Pascal makes it an integer
 * type, while in Turbo Pascal it is an 8087 real. */
export const systemCases: ReferenceCase[] = [
  {
    name: 'system-functions-in-constant-expressions',
    source: `program T;
var tb: Byte;
const A = Trunc(1.7); B = Round(1.5); C = Abs(-5); S = 'Hello!'; D = Length(S);
  E = Lo($1234); F = Hi($1234); G = Chr(66); H = Odd(3); I = Ord('3'); J = Pred(34);
  L = SizeOf(tb); M = Succ('a'); N = Swap($1234); W = High(Word); K = Char(65) + 'z';
  Letters: array[Low(Byte)..3] of Char = 'abcd';
begin
  WriteLn(A, ' ', B, ' ', C, ' ', D, ' ', E, ' ', F, ' ', G, ' ', H, ' ', I, ' ', J);
  WriteLn(L, ' ', M, ' ', N, ' ', W, ' ', K, ' ', Letters[3])
end.`,
    output: ['1 2 5 6 52 18 B TRUE 51 33', '1 b 13330 65535 Az d'],
  },
  {
    name: 'system-fillchar-and-move-work-on-bytes',
    source: `program T;
type Rec = record Name: string[5]; Count: Integer end;
var b: array[1..4] of Byte; w: array[1..2] of Word; r: Rec; source, target: array[1..3] of Char; n: Word;
begin
  FillChar(b, SizeOf(b), 7); FillChar(w, SizeOf(w), 1); WriteLn(b[1] + b[4], ' ', w[2]);
  r.Name := 'abc'; r.Count := 9; FillChar(r, SizeOf(r), 0); WriteLn('[', r.Name, '] ', r.Count);
  source[1] := 'x'; source[2] := 'y'; source[3] := 'z'; FillChar(target, 3, '-');
  Move(source, target, 2); WriteLn(target[1], target[2], target[3]);
  n := 258; WriteLn(Hi(n), ' ', Lo(n), ' ', Swap(n))
end.`,
    output: ['14 257', '[] 0', 'xy-', '1 2 513'],
  },
  {
    name: 'system-boolean-types-and-absolute',
    source: `program T;
var wb: WordBool; lb: LongBool; bb: ByteBool; l: LongInt; k: LongInt absolute l;
begin
  wb := True; lb := not wb; bb := wb and not lb; l := 5; k := k + 1;
  WriteLn(wb, ' ', lb, ' ', bb, ' ', SizeOf(wb), SizeOf(lb), SizeOf(bb), ' ', l)
end.`,
    output: ['TRUE FALSE TRUE 241 6'],
  },
  {
    name: 'system-heap-parameters-and-files',
    source: `program T;
type PInt = ^Integer;
var p: PInt; q: Pointer; f: Text; buffer: array[1..256] of Char; line: string; x: Integer;
begin
  GetMem(p, SizeOf(Integer)); p^ := 9; Write(p^, ' '); FreeMem(p, SizeOf(Integer));
  q := Addr(x); PInt(q)^ := 4; WriteLn(x, ' ', ParamCount, ' [', ParamStr(1), ']');
  Assign(f, 'flush.txt'); SetTextBuf(f, buffer); Rewrite(f); WriteLn(f, 'kept'); Flush(f); Close(f);
  Reset(f); ReadLn(f, line); Close(f); WriteLn(line)
end.`,
    output: ['9 4 0 []', 'kept'],
  },
  {
    name: 'system-runerror-stops-with-its-code',
    source: `program T; begin WriteLn('before'); RunError(204); WriteLn('after') end.`,
    output: ['before'],
    exitCode: 204,
  },
];
