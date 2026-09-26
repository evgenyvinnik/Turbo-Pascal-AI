import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string, input: string[] = []) {
  const machine = new Machine(compile(source), { maxInstructions: 100000 });
  machine.setInput(input);
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('null-terminated strings under {$X+}', () => {
  it('writes and reads PChars and zero-based arrays of Char up to their null', () => {
    expect(
      execute(
        `{$X+} program T; uses Strings;
        var a: array[0..3] of Char; b: array[0..9] of Char; p: PChar; f: Text;
        begin
          StrPCopy(b, 'hi'); p := b; WriteLn(p, '|', b, '|', p:4, '|', (p + 1)^);
          ReadLn(a); ReadLn(b); WriteLn(a, '|', b, '|', Ord(a[3]), ' ', StrLen(b));
          Assign(f, 'T.TXT'); Rewrite(f); Write(f, a, p); Close(f);
          Reset(f); Read(f, b); Close(f); WriteLn(b)
        end.`,
        ['abcdefg', 'hello world']
      )
    ).toEqual(['hi|hi|  hi|i', 'abc|hello wor|0 9', 'abchello ']);
  });

  it('converts to and from zero-based arrays with Str and Val', () => {
    expect(
      execute(`{$X+} program T; uses Strings;
      var a: array[0..5] of Char; i, code: Integer; r: Real;
      begin
        StrPCopy(a, 'hello'); Str(12, a); WriteLn(a, ' ', StrLen(a));
        Str(3.14159:0:2, a); WriteLn(a); Str(123456789, a); WriteLn(a);
        StrPCopy(a, '42'); Val(a, i, code); WriteLn(i + 1, ' ', code);
        StrPCopy(a, '4x'); Val(a, i, code); WriteLn(code);
        StrPCopy(a, '2.5'); Val(PChar(@a), r, code); WriteLn(r:0:1)
      end.`)
    ).toEqual(['12 2', '3.14', '12345', '43 0', '2', '2.5']);
  });

  it('names files with a PChar or a zero-based array of Char', () => {
    expect(
      execute(`{$X+} program T; uses Strings;
      var f: Text; a: array[0..12] of Char; p: PChar; s: string;
      begin
        StrPCopy(a, 'ONE.TXT'); Assign(f, a); Rewrite(f); WriteLn(f, 'x'); Close(f);
        p := 'TWO.TXT'; Rename(f, p); Assign(f, 'TWO.TXT'); Reset(f); ReadLn(f, s); Close(f); Erase(f); WriteLn(s)
      end.`)
    ).toEqual(['x']);
  });

  it('pads a zero-based typed constant with nulls, which {$X-} does not allow', () => {
    expect(
      execute(`{$X+} program T; const Name: array[0..7] of Char = 'AB'; P: PChar = Name;
      begin WriteLn(P, ' ', Ord(Name[2]), Ord(Name[7])) end.`)
    ).toEqual(['AB 00']);
    expect(() =>
      compile(`{$X-} program T; const Name: array[0..7] of Char = 'AB'; begin end.`)
    ).toThrow(/String constant of length 8 expected/);
    expect(() =>
      compile(`{$X+} program T; const Name: array[1..8] of Char = 'AB'; begin end.`)
    ).toThrow(/String constant of length 8 expected/);
  });

  it('keeps PChars out of Write and Val under {$X-}', () => {
    expect(() => compile(`{$X-} program T; var p: PChar; begin WriteLn(p) end.`)).toThrow(
      /Write requires a scalar or string value/
    );
    expect(() =>
      compile(`{$X-} program T; var p: PChar; i, c: Integer; begin Val(p, i, c) end.`)
    ).toThrow(/Type mismatch/);
  });
});

describe('zero-based arrays of Char as PChars', () => {
  it('take part in PChar arithmetic and comparisons under {$X+}', () => {
    expect(
      execute(`{$X+} program T; var ca: array[0..9] of Char; p, q: PChar;
      begin ca := 'abcdefghi'#0; p := ca; q := ca + 3;
        WriteLn(q^, ' ', q - ca, ' ', ca - p, ' ', (2 + p)^, ' ', p = ca, ' ', q > ca, ' ', (ca + 1)[1]);
        Inc(p); Inc(p, 2); Dec(q); WriteLn(p^, q^) end.`)
    ).toEqual(['d 3 0 c TRUE TRUE c', 'dc']);
    expect(() => compile(`{$X-} program T; var p: PChar; begin Inc(p) end.`)).toThrow(
      /Inc and Dec require an ordinal variable/
    );
  });
});

describe('packed string types', () => {
  it('are strings of all their characters in Write, comparisons and string values', () => {
    expect(
      execute(`{$X-} program T; type TR = record n: array[1..4] of Char end;
      var r: TR; p: ^TR; z: array[0..3] of Char; s: string;
      begin
        r.n := 'abcd'; p := @r; s := r.n + p^.n; WriteLn(s, ' ', p^.n = 'abcd');
        z := 'hi'#0'!'; s := z; WriteLn(Length(s), ' ', Ord(s[3]), ' ', Length(z))
      end.`)
    ).toEqual(['abcdabcd TRUE', '4 0 4']);
  });

  it('compare only with packed strings of the same length, and take no string variable', () => {
    expect(() =>
      compile(
        `program T; var a: array[1..3] of Char; b: array[1..4] of Char; begin WriteLn(a = b) end.`
      )
    ).toThrow(/Type mismatch/);
    expect(() =>
      compile(`program T; var a: array[1..3] of Char; s: string; begin s := 'abc'; a := s end.`)
    ).toThrow(/Type mismatch/);
  });
});

describe('address expressions in typed constants', () => {
  it('take Ofs and Seg of a global, @ of a routine, and a zero-based array for a PChar', () => {
    expect(
      execute(`{$X+} program T;
      var x: array[0..3] of Word; buf: array[0..9] of Char;
      procedure A; far; begin end;
      const XO: Word = Ofs(x[2]); XS: Word = Seg(x); PA: Pointer = @A; PB: PChar = buf;
      begin WriteLn(XO - Ofs(x), ' ', XS = DSeg, ' ', PA = @A, ' ', PB = @buf) end.`)
    ).toEqual(['4 TRUE TRUE TRUE']);
    expect(() =>
      compile(`program T; procedure P; var l: Word; const X: Word = Ofs(l); begin end; begin end.`)
    ).toThrow(/Address of a global variable expected/);
  });

  it('take the address of a character of a global string or string typed constant', () => {
    expect(
      execute(`program T; const s: string = 'test'; pc: PChar = @s[1]; pd: PChar = PChar(@s[3]);
      var g: string[10]; const pg: ^Char = @g[2];
      begin g := 'hello'; WriteLn(pc[0], pc[1], ' ', pd^, ' ', pg^); s[1] := 'b'; WriteLn(pc^) end.`)
    ).toEqual(['te s e', 'b']);
    expect(() =>
      compile(`program T; const s: string[4] = 'test'; pc: PChar = @s[9]; begin end.`)
    ).toThrow(/Constant out of range/);
  });
});

describe('variable references from pointer expressions', () => {
  it('dereference a parenthesized pointer, T(nil)^ for an offset, and a pointer as LongInt', () => {
    expect(
      execute(`{$X+} program T; uses Dos;
      type PRec = ^TRec; TRec = record a: LongInt; b: array[1..3] of Word end;
      var i: Integer; f: Text; p: Pointer;
      begin
        i := 5; Inc(Word((@i)^)); Assign(f, 'F.TXT'); Rewrite(f);
        WriteLn(i, ' ', TextRec((@f)^).Mode = fmOutput, ' ', FileRec((@f)^).Name[0] = 'F'); Close(f); Erase(f);
        WriteLn(Ofs(PRec(nil)^.b[2]), ' ', Seg(PRec(nil)^.a), ' ', LongInt(@PRec(nil)^.b), ' ', LongInt(nil));
        p := Ptr($B800, $10); WriteLn(LongInt(p) = LongInt($B8000010), ' ', LongInt(p) = LongInt(Ptr($B800, $10)))
      end.`)
    ).toEqual(['6 TRUE TRUE', '6 0 4 0', 'TRUE TRUE']);
  });
});

describe('control characters', () => {
  it('reads ^X as Chr(Ord(X) xor 64) where a value is expected, and ^ elsewhere as a pointer', () => {
    expect(
      execute(`program T; type PT = ^T; T = Integer; const S = ^M^J'x'^i; var c: Char; q: PT;
      begin c := ^@; New(q); q^ := 3; WriteLn(Ord(S[1]), Ord(S[2]), S[3], Ord(S[4]), ' ', Ord(c), ' ', q^, ' ', Concat(S[3])) end.`)
    ).toEqual(['1310x9 0 3 x']);
    expect(() => compile(`program T; var c: Char; begin c := ^ ; end.`)).toThrow(
      /Unexpected token in expression: '\^'/
    );
  });
});
