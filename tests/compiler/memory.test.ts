import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
const run = (source: string, fileSystem = new VirtualFileSystem()) => {
  const machine = new Machine(compile(source), { maxInstructions: 2_000_000, fileSystem });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine;
};
const output = (source: string) => run(source).getOutput();

describe('The data segment', () => {
  it('holds the globals at DSeg, one after another and word aligned under $A+', () => {
    expect(
      output(`program T; var b: Byte; w: Word; c: Char; l: LongInt; s: string[3]; d: Byte;
      begin WriteLn(Seg(b) = DSeg, ' ', Seg(l) = DSeg, ' ', DSeg <> SSeg, ' ', DSeg <> CSeg);
        WriteLn(Ofs(w) - Ofs(b), ' ', Ofs(c) - Ofs(w), ' ', Ofs(l) - Ofs(c), ' ', Ofs(s) - Ofs(l), ' ', Ofs(d) - Ofs(s)) end.`)
    ).toEqual(['TRUE TRUE TRUE TRUE', '2 2 2 4 4']);
  });

  it('packs them under $A-, and puts typed constants before the variables', () => {
    expect(
      output(`program T;
      {$A-} var b: Byte; w: Word; c: Char; l: LongInt;
      const k: Word = 7; var v: Word; const m: Byte = 1;
      begin WriteLn(Ofs(w) - Ofs(b), ' ', Ofs(c) - Ofs(w), ' ', Ofs(l) - Ofs(c));
        WriteLn(Ofs(m) - Ofs(k), ' ', Ofs(k) < Ofs(b), ' ', Ofs(m) < Ofs(b), ' ', Ofs(v) > Ofs(l)) end.`)
    ).toEqual(['1 2 1', '2 TRUE TRUE TRUE']);
  });

  it('lets FillChar, Move and BlockWrite run on past a variable into the next ones', () => {
    const disk = new VirtualFileSystem();
    const machine = run(`program T; var a: Word; b: Word; c: LongInt; x, y: array[0..1] of Word; f: file;
      begin a := 1; b := 2; c := 3; FillChar(a, 8, 0); WriteLn(a, b, c);
        x[0] := 5; x[1] := 6; y[0] := 7; y[1] := 8; Move(x, y[1], 2); Move(x[1], y[0], 4); WriteLn(y[0], ' ', y[1]);
        FillChar(a, 2, 1); b := $0302; Assign(f, 'A.DAT'); Rewrite(f, 1); BlockWrite(f, a, 4); Close(f);
        c := 0; Reset(f, 1); BlockRead(f, b, 4); Close(f); WriteLn(b, ' ', c) end.`, disk);
    expect(machine.getOutput()).toEqual(['000', '6 7', '257 770']);
    expect(Array.from(disk.read('A.DAT'), (char) => char.charCodeAt(0))).toEqual([1, 1, 2, 3]);
  });

  it('reads past a variable through a pointer, into what follows it', () => {
    expect(
      output(`program T; type PLong = ^LongInt; TWords = array[0..1] of Word;
      var a: array[0..1] of Byte; b: Word; p: ^TWords;
      begin a[0] := 1; a[1] := 2; b := $0403; WriteLn(PLong(@a)^); p := @a; WriteLn(p^[1]); p^[1] := 9; WriteLn(b) end.`)
    ).toEqual(['67305985', '1027', '9']);
  });

  it('gives Ptr(Seg(X), Ofs(X)) the bytes of X, as any pointer type sees them', () => {
    expect(
      output(`program T; type PWord = ^Word; PByte = ^Byte;
      var l: LongInt; p: Pointer; q: PWord;
      begin l := $00050006; p := Ptr(Seg(l), Ofs(l)); WriteLn(p = @l, ' ', PWord(p)^);
        q := Ptr(Seg(l), Ofs(l) + 2); WriteLn(q^); q^ := 1; WriteLn(l); PByte(Ptr(DSeg, Ofs(l) + 1))^ := 1; WriteLn(l) end.`)
    ).toEqual(['TRUE 6', '5', '65542', '65798']);
  });
});

describe('Stack frames', () => {
  it('put the locals at SSeg, the last declared lowest, as the stack grows down', () => {
    expect(
      output(`program T; var g: Word;
      procedure P(x: Word); var l: LongInt; w: Word;
      begin l := $11223344; w := 5;
        WriteLn(Seg(l) = SSeg, ' ', Seg(x) = SSeg, ' ', Ofs(w) < Ofs(l), ' ', Ofs(l) < Ofs(x), ' ', Ofs(l) < SPtr + 20);
        WriteLn(Mem[SSeg:Ofs(l)], ' ', MemW[Seg(l):Ofs(l) + 2], ' ', MemW[SSeg:Ofs(l) - 2]) end;
      begin P(1) end.`)
    ).toEqual(['TRUE TRUE TRUE TRUE TRUE', '68 4386 5']);
  });

  it('give each call a frame of its own', () => {
    expect(
      output(`program T; var depth: array[1..2] of Word;
      procedure R(n: Integer); var x: Word; begin x := n; depth[n] := Ofs(x); if n < 2 then R(n + 1) end;
      begin R(1); WriteLn(depth[2] < depth[1]) end.`)
    ).toEqual(['TRUE']);
  });
});

describe('The heap', () => {
  it('counts bytes, eight at a time, from HeapOrg up', () => {
    expect(
      output(`program T; type TBytes = array[0..65519] of Byte; PBytes = ^TBytes;
      var a, b: PBytes; free: LongInt; top: Pointer;
      begin free := MemAvail; GetMem(a, 100); WriteLn(free - MemAvail); Mark(top); GetMem(b, 20);
        WriteLn(Seg(a^) = Seg(HeapOrg^), ' ', Ofs(a^), ' ', Ofs(b^), ' ', Seg(b^) - Seg(a^), ' ', Seg(HeapEnd^) > Seg(HeapPtr^));
        Release(top); WriteLn(free - MemAvail, ' ', HeapPtr = top); FreeMem(a, 100); WriteLn(MemAvail = free) end.`)
    ).toEqual(['104', 'TRUE 0 8 6 TRUE', '104 TRUE', 'TRUE']);
  });

  it('holds only the bytes GetMem asks for, whatever the pointer type', () => {
    expect(
      output(`program T; type TBytes = array[0..65519] of Byte; PBytes = ^TBytes; PStr = ^string;
      var p: PBytes; q: PBytes; s: PStr; i: Integer;
      begin GetMem(p, 60000); GetMem(q, 60000); for i := 0 to 59999 do p^[i] := i mod 7; WriteLn(p^[59999], ' ', q^[0]);
        GetMem(s, 6); s^ := 'hello'; WriteLn(s^, ' ', Length(s^)); q := Pointer(s); WriteLn(q^[0], ' ', Chr(q^[1])) end.`)
    ).toEqual(['2 0', 'hello 5', '5 h']);
  });

  it("lets a pointer of another type see a block's bytes", () => {
    expect(
      output(`program T; type PWord = ^Word; PLong = ^LongInt; TPair = record a, b: Word end; PPair = ^TPair;
      var l: PLong; w: PWord; r: PPair; p: Pointer;
      begin New(l); l^ := $12345678; w := Pointer(l); WriteLn(w^); p := l; r := p; WriteLn(r^.b);
        r^.a := 1; WriteLn(l^); w := Ptr(Seg(l^), Ofs(l^) + 2); WriteLn(w^); Dispose(l) end.`)
    ).toEqual(['22136', '4660', '305397761', '4660']);
  });
});

describe("Strings' characters", () => {
  it('are bytes that Move, FillChar, BlockRead and BlockWrite reach from S[1]', () => {
    expect(
      output(`program T; var s: string[20]; buf: array[1..10] of Char; i: Integer; f: file;
      begin s := 'hello'; FillChar(buf, SizeOf(buf), '.'); Move(s[1], buf, Length(s)); for i := 1 to 10 do Write(buf[i]); WriteLn;
        Move(buf[3], s[1], 4); WriteLn(s); FillChar(s[1], 3, 'x'); WriteLn(s);
        Assign(f, 'S.DAT'); Rewrite(f, 1); s := 'abcdef'; BlockWrite(f, s[1], 6); Close(f);
        s := ''; Reset(f, 1); BlockRead(f, s[1], 6); s[0] := #6; Close(f); WriteLn(s) end.`)
    ).toEqual(['hello.....', 'llo.o', 'xxx.o', 'abcdef']);
  });

  it('are seen as another type through a pointer to one', () => {
    expect(
      output(`program T; type PWord = ^Word; var s: string; p: PChar; w: PWord;
      begin s := 'AB'; WriteLn(PWord(@s[1])^); PWord(@s[1])^ := $4443; WriteLn(s); s := 'abc'#0; p := @s[1];
        w := Pointer(p); WriteLn(w^, ' ', p[1]); p := p + 1; w := Pointer(p); WriteLn(w^) end.`)
    ).toEqual(['16961', 'CD', '25185 b', '25442']);
  });

  it('keep what lies past the length, as Turbo Pascal leaves it', () => {
    expect(
      output(`program T; var s: string[10]; t: array[0..3] of Char;
      begin s := 'abcdef'; s := 'xy'; s[0] := #5; WriteLn(s); FillChar(s, SizeOf(s), ' '); s[0] := #3; WriteLn('[', s, ']');
        s := 'wxyz'; Move(s, t, 4); s := ''; Move(t, s, 4); WriteLn(s) end.`)
    ).toEqual(['xycde', '[   ]', 'wxyz']);
  });
});

describe('Pointers as bytes', () => {
  it('hold a segment and offset, which PtrRec and LongInt see', () => {
    expect(
      output(`program T; type PtrRec = record Ofs, Seg: Word end; PByte = ^Byte;
      var b: array[0..3] of Byte; p: PByte; l: LongInt;
      begin b[0] := 10; b[1] := 11; b[2] := 12; p := @b;
        WriteLn(PtrRec(p).Seg = DSeg, ' ', PtrRec(p).Ofs = Ofs(b), ' ', LongInt(p) = LongInt(DSeg) shl 16 + Ofs(b));
        Inc(PtrRec(p).Ofs, 2); WriteLn(p^); l := LongInt(p); Dec(l); p := Pointer(l); WriteLn(p^) end.`)
    ).toEqual(['TRUE TRUE TRUE', '12', '11']);
  });

  it('come back as the same pointer from a file', () => {
    const disk = new VirtualFileSystem();
    const machine = run(`program T; type PNode = ^TNode; TNode = record n: Integer; next: PNode end;
      var a, b, c: PNode; f: file of PNode;
      begin New(a); New(b); a^.n := 1; b^.n := 2; a^.next := b; b^.next := nil;
        Assign(f, 'P.DAT'); Rewrite(f); Write(f, a); Reset(f); Read(f, c); Close(f);
        WriteLn(c = a, ' ', c^.n, ' ', c^.next^.n, ' ', c^.next^.next = nil) end.`, disk);
    expect(machine.getOutput()).toEqual(['TRUE 1 2 TRUE']);
    expect(disk.read('P.DAT')).toHaveLength(4);
  });
});

describe('Memory by address', () => {
  it('reaches the globals with Mem, MemW and MemL', () => {
    expect(
      output(`program T; var w: Word; l: LongInt;
      begin w := $1234; WriteLn(Mem[Seg(w):Ofs(w)], ' ', Mem[DSeg:Ofs(w) + 1], ' ', MemW[Seg(w):Ofs(w)]);
        Mem[Seg(w):Ofs(w)] := $FF; WriteLn(w); MemL[DSeg:Ofs(l)] := 100000; WriteLn(l) end.`)
    ).toEqual(['52 18 4660', '4863', '100000']);
  });

  it('shows the screen at $B800, and a variable declared absolute there', () => {
    const machine = run(`program T; type TCell = record Ch: Char; Attr: Byte end;
      var Screen: array[1..25, 1..80] of TCell absolute $B800:0; p: ^Word;
      begin Screen[1, 1].Ch := 'H'; Screen[1, 1].Attr := $1E; Mem[$B800:2] := Ord('i'); MemW[$B800:4] := $4F21;
        p := Ptr($B800, 160); p^ := $0741 end.`);
    const screen = machine.getConsole();
    expect(screen.chars.slice(0, 3).join('')).toBe('Hi!');
    expect(Array.from(screen.attributes.slice(0, 3))).toEqual([0x1e, 7, 0x4f]);
    expect(screen.chars[80]).toBe('A');
  });

  it("shows the BIOS's variables at $40, and its ports through Port", () => {
    expect(
      output(`program T; var Ticks: LongInt absolute $40:$6C; Cols: Word absolute $40:$4A;
      begin WriteLn(Ticks >= 0, ' ', Cols, ' ', Mem[$40:$49], ' ', MemW[$40:$1A] = MemW[$40:$1C]);
        WriteLn(Port[$3DA] and 8, ' ', Port[$3DA] and 8); Port[$61] := 0; WriteLn(Port[$61]) end.`)
    ).toEqual(['TRUE 80 3 TRUE', '8 0', '0']);
  });

  it('lets assembly reach memory by segment register and offset', () => {
    expect(
      output(`program T; var w: Word; o: Word; b: Byte; s: array[0..3] of Char;
      begin w := $1234; o := Ofs(w);
        asm
          mov ax, $B800; mov es, ax; xor di, di; mov ax, $1E41; mov es:[di], ax
          mov bx, o; mov al, [bx]; mov b, al; mov byte ptr [bx+1], $56
        end;
        o := Ofs(s);
        asm push ds; pop es; mov di, o; mov al, 'x'; mov cx, 4; cld; rep stosb end;
        WriteLn(b, ' ', w, ' ', Mem[$B800:0], ' ', Mem[$B800:1], ' ', s[0], s[3]) end.`)
    ).toEqual(['52 22068 65 30 xx']);
  });
});
