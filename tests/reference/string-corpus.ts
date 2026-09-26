import type { ReferenceCase } from './corpus';

/** Null-terminated and packed strings, control characters, address
 * expressions in typed constants, and variable references that start with a
 * pointer expression, as the Turbo Pascal 7 Language Guide describes them.
 * Free Pascal's TP mode differs on Val and Assign of a PChar and on Str into
 * a zero-based array, which it leaves without a null; the unit tests cover
 * those. */
export const stringCases: ReferenceCase[] = [
  {
    name: 'strings-null-terminated-under-extended-syntax',
    source: `{$X+}
program T;
uses Strings;
type TName = array[0..79] of Char;
const Buf: TName = 'TEST.PAS';
var a: array[0..15] of Char; p: PChar; f: Text; s: string;
begin
  WriteLn(Buf); p := Buf; WriteLn(p, ' ', StrLen(p), ' ', Ord(Buf[8]));
  StrPCopy(a, 'hello'); WriteLn(a, '|', p:10, '|');
  ReadLn(a); WriteLn('[', a, ']'); p := a;
  Assign(f, 'T.TXT'); Rewrite(f); WriteLn(f, p); Close(f); Reset(f); ReadLn(f, s); Close(f); Erase(f); WriteLn(s)
end.`,
    input: 'typed line\n',
    output: ['TEST.PAS', 'TEST.PAS 8 0', 'hello|  TEST.PAS|', '[typed line]', 'typed line'],
  },
  {
    name: 'strings-packed-types-are-strings',
    source: `program T;
type TCode = array[1..4] of Char;
var c, d: TCode; s: string;
begin
  c := 'ABCD'; d := 'ABCE'; s := c; WriteLn(s, ' ', Length(s));
  WriteLn(c = d, ' ', c < d, ' ', c = 'ABCD', ' ', s = c);
  s := '<' + c + '>'; WriteLn(s, c, c:6);
  WriteLn(Concat('one'), Concat(c, '!'), Pos('C', c))
end.`,
    output: ['ABCD 4', 'FALSE TRUE TRUE TRUE', '<ABCD>ABCD  ABCD', 'oneABCD!3'],
  },
  {
    name: 'strings-control-characters',
    source: `program T;
const Bell = ^G; Esc = ^[; Mixed = 'a'^]'b'#65^m;
var c: Char;
begin
  c := ^.;
  WriteLn(Ord(Bell), ' ', Ord(Esc), ' ', Ord(c), ' ', Length(Mixed), ' ', Ord(Mixed[2]), ' ', Ord(Mixed[5]))
end.`,
    output: ['7 27 110 5 29 13'],
  },
  {
    name: 'strings-address-expressions-in-typed-constants',
    source: `program T;
type TProc = procedure; PRec = ^TRec; TRec = record a, b: Word; c: array[1..3] of Byte end;
var x: array[0..3] of Word; hits: Integer;
procedure Hit; far; begin Inc(hits) end;
const PX: Pointer = @x[2]; PH: Pointer = @Hit; Q: TProc = Hit;
begin
  hits := 0; x[2] := 7; WriteLn(Word(PX^), ' ', PH = @Hit); Q;
  WriteLn(hits, ' ', Ofs(PRec(nil)^.b), ' ', Ofs(PRec(nil)^.c[2]))
end.`,
    output: ['7 TRUE', '1 2 5'],
  },
  {
    name: 'strings-pointer-expressions-take-qualifiers',
    source: `{$X+}
program T;
var i: Integer; a: array[0..5] of Char; p: PChar;
begin
  i := 5; Inc(Word((@i)^)); WriteLn(i);
  a := 'abcde'#0; p := a; WriteLn((p + 1)[2], (p + 4)^)
end.`,
    output: ['6', 'de'],
  },
];
