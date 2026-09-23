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
    name: 'system-standard-input-and-output-files',
    source: `program T; var s: string; n: Integer;
begin
  WriteLn(Output, 'to output'); Write(Output, 'same');
  WriteLn(Output, ' line');
  ReadLn(Input, s); Read(Input, n);
  WriteLn(s, ' ', n, ' ', Eof(Input), ' ', Eoln(Input))
end.`,
    input: 'first line\n42\n',
    output: ['to output', 'same line', 'first line 42 FALSE TRUE'],
  },
  {
    name: 'system-output-can-be-redirected-and-passed',
    source: `program T; var f: Text; s: string;
procedure Say(var target: Text; const t: string); begin WriteLn(target, '> ', t) end;
begin
  Say(Output, 'screen'); Flush(Output);
  Assign(Output, 'log.txt'); Rewrite(Output); WriteLn('into the log'); Say(Output, 'too'); Close(Output);
  Assign(Output, ''); Rewrite(Output);
  Assign(f, 'log.txt'); Reset(f);
  while not Eof(f) do begin ReadLn(f, s); WriteLn('log: ', s) end;
  Close(f)
end.`,
    output: ['> screen', 'log: into the log', 'log: > too'],
  },
  {
    name: 'system-names-can-be-qualified-with-the-unit',
    source: `program T; type R = record Length: Integer end;
var i: System.Integer; s: string; c: System.Char; System2: R;
begin
  i := System.MaxInt; s := 'abc'; System2.Length := System.Length(s);
  System.WriteLn(i, System.Length(s):3, ' ', System.Pi:5:2, ' ', System2.Length, ' ', System.Ord('A'));
  c := System.UpCase('q'); System.Write(c); System.WriteLn
end.`,
    output: ['32767  3  3.14 3 65', 'Q'],
  },
  {
    name: 'system-names-can-be-declared-again',
    source: `program T;
var Double: string[5];
procedure MaxInt; begin Write('proc ') end;
begin
  Double := 'abcdefg'; MaxInt;
  WriteLn(Double, ' ', System.MaxInt, ' ', SizeOf(System.Double))
end.`,
    output: ['proc abcde 32767 8'],
  },
  {
    name: 'dos-packtime-and-unpacktime',
    source: `program T; uses Dos;
var DT: DateTime; P: LongInt;
begin
  DT.Year := 1992; DT.Month := 10; DT.Day := 27; DT.Hour := 13; DT.Min := 45; DT.Sec := 31;
  PackTime(DT, P); WriteLn(P);
  UnpackTime(P + 1, DT); WriteLn(DT.Year, ' ', DT.Month, ' ', DT.Day, ' ', DT.Hour, ' ', DT.Min, ' ', DT.Sec)
end.`,
    output: ['425422255', '1992 10 27 13 45 32'],
  },
  {
    name: 'system-pchar-holds-text-and-is-indexed',
    source: `program T;
const Names: array[0..1] of PChar = ('one', 'two'); Greeting: PChar = 'hi';
var p: PChar; s: string; i: Integer;
begin
  p := 'abc'; WriteLn(p[0], p[1], p[2], ' ', Ord(p[3]));
  s := 'test'; p := @s[2]; WriteLn(p^, p[1], ' ', Greeting[0], Greeting[1]);
  for i := 0 to 1 do Write(Names[i][0], Names[i][2], ' '); WriteLn
end.`,
    output: ['abc 0', 'es hi', 'oe to '],
  },
  {
    name: 'strings-unit-works-on-null-terminated-text',
    source: `program T; uses Strings;
var buf: array[0..40] of Char; p, q: PChar; s: string;
function Shout(t: PChar): PChar; begin Shout := StrUpper(t) end;
begin
  StrPCopy(buf, 'hello'); StrCat(buf, ', world');
  WriteLn(StrPas(buf), ' ', StrLen(buf), ' ', StrPas(StrEnd(buf) - 5));
  p := StrPos(buf, 'wor'); WriteLn(StrPas(p), ' ', StrPas(StrScan(buf, 'l')), ' ', StrPas(StrRScan(buf, 'l')));
  WriteLn(StrComp('abc', 'abd') < 0, ' ', StrIComp('ABC', 'abc') = 0, ' ', StrLComp('abcx', 'abcy', 3) = 0);
  StrLCopy(buf, 'truncate me', 8); WriteLn(StrPas(Shout(buf)), ' ', StrPas(StrLower(buf)));
  q := StrNew('copy'); WriteLn(StrPas(q), ' ', StrNew('') = nil); StrDispose(q);
  s := StrPas(StrECopy(buf, 'ab') - 2); WriteLn(s)
end.`,
    output: ['hello, world 12 world', 'world llo, world ld', 'TRUE TRUE TRUE', 'TRUNCATE truncate', 'copy TRUE', 'ab'],
  },
  {
    name: 'system-exitcode-is-the-program-status',
    source: `program T; begin ExitCode := 7; WriteLn(ExitCode) end.`,
    output: ['7'],
    exitCode: 7,
  },
  {
    name: 'system-randseed-repeats-a-sequence',
    source: `program T; var a, b: Integer; x, y: Real;
begin
  RandSeed := 42; a := Random(1000); x := Random;
  RandSeed := 42; b := Random(1000); y := Random;
  WriteLn(a = b, ' ', x = y, ' ', (a >= 0) and (a < 1000))
end.`,
    output: ['TRUE TRUE TRUE'],
  },
  {
    name: 'system-seekeof-and-seekeoln-skip-blanks',
    source: `program T; var f: Text; n, sum: Integer;
begin
  Assign(f, 'numbers.txt'); Rewrite(f); WriteLn(f, ' 1 2 '); WriteLn(f, '3   '); WriteLn(f, '   '); Close(f);
  Reset(f); sum := 0; while not SeekEof(f) do begin Read(f, n); sum := sum + n end; Close(f);
  Reset(f); Read(f, n); Read(f, n); Write(sum, ' ', SeekEoln(f), ' '); Close(f);
  sum := 0; while not SeekEof do begin Read(n); sum := sum + n end; WriteLn(sum)
end.`,
    input: '4 5\n  6  \n\n',
    output: ['6 TRUE 15'],
  },
  {
    name: 'system-directories-hold-files',
    source: `program T; var f: Text; s: string;
begin
  MkDir('sub'); ChDir('sub');
  Assign(f, 'in.txt'); Rewrite(f); WriteLn(f, 'inside'); Close(f);
  ChDir('..'); Assign(f, 'sub/in.txt'); Reset(f); ReadLn(f, s); Close(f); WriteLn(s);
  Erase(f); RmDir('sub'); {$I-} ChDir('sub'); {$I+} WriteLn(IOResult <> 0)
end.`,
    output: ['inside', 'TRUE'],
  },
  {
    name: 'system-typeof-compares-object-types',
    source: `program T;
type Base = object constructor Init; procedure Show; virtual; end;
  Derived = object(Base) procedure Show; virtual; end;
constructor Base.Init; begin end;
procedure Base.Show; begin end;
procedure Derived.Show; begin end;
var a: Base; b: Derived;
begin a.Init; b.Init; WriteLn(TypeOf(a) = TypeOf(Base), ' ', TypeOf(a) = TypeOf(b), ' ', TypeOf(b) = TypeOf(Derived)) end.`,
    output: ['TRUE FALSE TRUE'],
  },
  {
    name: 'a-routine-may-be-named-forward',
    source: `program T;
procedure Forward; forward;
procedure Twice(const n: Integer); begin Forward; WriteLn(n * 2) end;
procedure Forward; begin Write('called ') end;
begin Twice(21) end.`,
    output: ['called 42'],
  },
  {
    name: 'system-runerror-stops-with-its-code',
    source: `program T; begin WriteLn('before'); RunError(204); WriteLn('after') end.`,
    output: ['before'],
    exitCode: 204,
  },
];
