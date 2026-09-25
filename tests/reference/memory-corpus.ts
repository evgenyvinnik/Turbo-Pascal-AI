import type { ReferenceCase } from './corpus';

/** Memory as bytes, where Free Pascal lays it out as Turbo Pascal does: a
 * string's characters, heap blocks, and what an untyped pointer points at.
 * The data segment's and the stack's layouts differ in 32-bit code, so the
 * unit tests cover those. */
export const memoryCases: ReferenceCase[] = [
  {
    name: 'memory-string-characters-are-bytes',
    source: `program T;
type PWord = ^Word;
var s: string[20]; buf: array[1..10] of Char; i: Integer; f: file;
begin
  s := 'hello'; FillChar(buf, SizeOf(buf), '.'); Move(s[1], buf, Length(s));
  for i := 1 to 10 do Write(buf[i]); WriteLn;
  Move(buf[3], s[1], 4); WriteLn(s);
  FillChar(s[1], 3, 'x'); WriteLn(s);
  s := 'AB'; WriteLn(PWord(@s[1])^); PWord(@s[1])^ := $4443; WriteLn(s);
  Assign(f, 'S.DAT'); Rewrite(f, 1); s := 'abcdef'; BlockWrite(f, s[1], 6); Close(f);
  s := ''; Reset(f, 1); BlockRead(f, s[1], 6); s[0] := #6; Close(f); Erase(f); WriteLn(s);
  s := 'abcdef'; s := 'xy'; s[0] := #5; WriteLn(s);
  FillChar(s, SizeOf(s), ' '); s[0] := #3; WriteLn('[', s, ']')
end.`,
    output: ['hello.....', 'llo.o', 'xxx.o', '16961', 'CD', 'abcdef', 'xycde', '[   ]'],
  },
  {
    name: 'memory-heap-blocks-are-bytes',
    source: `program T;
type TBytes = array[0..65519] of Byte; PBytes = ^TBytes; PWord = ^Word; PLong = ^LongInt;
  PStr = ^string; TPair = packed record a, b: Word end; PPair = ^TPair;
var b, q: PBytes; w: PWord; l: PLong; s: PStr; r: PPair; i: Integer;
begin
  GetMem(b, 100); for i := 0 to 99 do b^[i] := i; w := Pointer(b); WriteLn(w^);
  New(l); l^ := $12345678; w := Pointer(l); WriteLn(w^); q := Pointer(l); WriteLn(q^[3]);
  r := Pointer(l); WriteLn(r^.b); r^.a := 1; WriteLn(l^);
  GetMem(s, 6); s^ := 'hello'; WriteLn(s^, ' ', Length(s^)); q := Pointer(s); WriteLn(q^[0], ' ', Chr(q^[1]));
  FreeMem(s, 6); Dispose(l); FreeMem(b, 100)
end.`,
    output: ['256', '22136', '18', '4660', '305397761', 'hello 5', '5 h'],
  },
  {
    name: 'memory-untyped-pointer-targets',
    source: `program T;
type TPair = packed record a, b: Word end;
var p: Pointer; x: array[0..3] of Byte; f: file;
procedure Fill(var v; n: Word); begin FillChar(v, n, 2) end;
begin
  GetMem(p, 4); FillChar(p^, 4, 7); Move(p^, x, 4); WriteLn(x[3]);
  Fill(p^, 2); WriteLn(TPair(p^).a, ' ', TPair(p^).b); TPair(p^).b := 5;
  Assign(f, 'P.DAT'); Rewrite(f, 1); BlockWrite(f, p^, 4); Close(f);
  Reset(f, 1); BlockRead(f, x, 4); Close(f); Erase(f); WriteLn(x[0], x[1], x[2], x[3]);
  FreeMem(p, 4)
end.`,
    output: ['7', '514 1799', '2250'],
  },
];
