import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { compValue } from '../../src/compiler/codegen/numeric';
import { errorWith } from './matchers';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string): string[] {
  const machine = new Machine(compile(source), { maxInstructions: 100_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('System unit additions', () => {
  it('treats Comp as an 8087 real that stores whole numbers', () => {
    expect(
      execute(`program T; var c: Comp;
      begin c := 1234; WriteLn(c); c := c / 3; WriteLn(c:0:1, ' ', SizeOf(c)); c := 2.5; WriteLn(c:0:0) end.`)
    ).toEqual([' 1.23400000000000E+0003', '411.0 8', '2']);
    // The 8087 rounds halves to even, and faults outside 64 bits.
    expect([compValue(2.5), compValue(3.5), compValue(-2.5), compValue(-0.4)]).toEqual([2, 4, -2, 0]);
    expect(() => compValue(2 ** 63)).toThrow(/Invalid numeric result/);
  });

  it('reports heap space that GetMem takes and FreeMem returns', () => {
    expect(
      execute(`program T; type Big = array[1..500] of Integer; PBig = ^Big; var p: PBig; before: LongInt;
      begin before := MemAvail; GetMem(p, SizeOf(Big)); p^[500] := 3;
        WriteLn(before - MemAvail >= 500, ' ', p^[500], ' ', p^[1]); FreeMem(p, SizeOf(Big)); WriteLn(MemAvail = before, ' ', MaxAvail <= MemAvail) end.`)
    ).toEqual(['TRUE 3 0', 'TRUE TRUE']);
  });

  it('names the program in ParamStr(0) and has no parameters', () => {
    expect(execute(`program Demo; begin WriteLn(ParamStr(0), ' ', ParamCount, ' [', ParamStr(1), ']') end.`)).toEqual([
      'C:\\DEMO.EXE 0 []',
    ]);
  });

  it('rejects what these routines cannot do', () => {
    expect(() => compile('program T; procedure P(x: array of Byte); begin FillChar(x, 2, 0) end; begin end.')).toThrow(
      /FillChar needs a variable whose type is known here/
    );
    expect(() => compile('program T; var w: Word absolute 1 + 2; begin end.')).toThrow(/Variable identifier expected/);
    expect(() => compile('program T; const C = 1; var w: Integer absolute C; begin end.')).toThrow(
      /Variable expected: "C"/
    );
    expect(() => compile('program T; const C = Chr(300); begin end.')).toThrow(/Constant out of range/);
    expect(() => compile("program T; const C = Length(5); begin end.")).toThrow(/String constant expected/);
    expect(() => compile('program T; var x: Integer; const C = Ord(x); begin end.')).toThrow(
      /Constant expected/
    );
  });

  it('keeps the low bytes in a constant typecast, as a value typecast does', () => {
    expect(
      execute(`program T; type Color = (Red, Green, Blue);
      const B = Byte(300); S = ShortInt(200); W = Word(-1); C = Color(2); X = Boolean(0);
      begin WriteLn(B, ' ', S, ' ', W, ' ', Ord(C), ' ', X) end.`)
    ).toEqual(['44 -56 65535 2 FALSE']);
  });

  it('rejects constants that cannot fit, whatever range checking says', () => {
    // Turbo Pascal reports these while compiling even under {$R-}; Free
    // Pascal only does so with range checks on.
    for (const source of [
      'program T; var b: Byte; begin b := 256 end.',
      'program T; type Small = 1..9; var s: Small; begin s := 0 end.',
      'program T; var a: array[1..3] of Integer; begin a[4] := 1 end.',
      "program T; var s: string; c: Char; begin c := s[256] end.",
      'program T; type Color = (Red, Green); var c: Color; begin c := Pred(Red) end.',
    ])
      expect(() => compile(source), source).toThrow(/Constant out of range/);
    // A value that is not constant is still checked when it runs.
    expect(() => compile('program T; var b: Byte; i: Integer; begin i := 256; b := i end.')).not.toThrow();
  });

  it('reports a constant a standard function cannot return, where it is written', () => {
    expect(() => compile('program T; begin WriteLn(Chr(300)) end.')).toThrow(
      errorWith({ message: 'Constant out of range', lineNumber: 1 })
    );
    expect(() =>
      compile(`program T; label done;
      begin
        goto done
      end.`)
    ).toThrow(errorWith({ message: 'Undefined label', lineNumber: 3 }));
    expect(() =>
      compile('program T; type Thing = object F: LongInt; procedure P; G: LongInt end; begin end.')
    ).toThrow(/Object fields must precede its methods/);
  });

  it('puts the globals in the data segment, which Seg, Ofs and Ptr agree on', () => {
    expect(
      execute(`program T; var i: Integer; p: Pointer;
      begin p := Ptr(Seg(i), Ofs(i));
        WriteLn(p = @i, ' ', Seg(i) = DSeg, ' ', CSeg, ' ', DSeg, ' ', SSeg, ' ', SPtr > 0) end.`)
    ).toEqual(['TRUE TRUE 4096 8192 12288 TRUE']);
  });

  it('treats Input and Output as text files on the console, which a program may redirect', () => {
    const disk = new VirtualFileSystem();
    const machine = new Machine(
      compile(`program T; var s: string;
      procedure Say(var f: Text; const t: string); begin WriteLn(f, '> ', t) end;
      begin
        Say(Output, 'screen'); ReadLn(Input, s); WriteLn(s, ' ', Eof(Input));
        Assign(Output, 'LOG.TXT'); Rewrite(Output); WriteLn('logged'); Close(Output);
        Assign(Output, ''); Rewrite(Output); WriteLn('back');
        {$I-} WriteLn(Input, 'x'); WriteLn(IOResult)
      end.`),
      { fileSystem: disk }
    );
    machine.setInput(['typed']);
    machine.run();
    expect(machine.getOutput()).toEqual(['> screen', 'typed TRUE', 'back', '105']);
    expect(disk.snapshot()).toEqual({ 'LOG.TXT': 'logged\r\n' });
  });

  it('waits for console input read through a text file variable', () => {
    const machine = new Machine(
      compile('program T; var f: Text; n: Integer; begin Assign(f, \'\'); Reset(f); ReadLn(f, n); WriteLn(n + 1) end.')
    );
    machine.run();
    expect(machine.getState()).toBe(MachineState.WAITING);
    machine.provideInput('41');
    machine.run();
    expect(machine.getOutput()).toEqual(['42']);
  });

  it('starts the System variables again when the machine is reset', () => {
    const machine = new Machine(compile('program T; begin WriteLn(FileMode, Test8087); FileMode := 0 end.'));
    machine.run();
    machine.reset();
    machine.run();
    expect(machine.getOutput()).toEqual(['23']);
  });

  it('holds text in a PChar only under extended syntax', () => {
    expect(
      execute(`program T; var p: PChar; q: PChar;
      begin p := 'ab'; q := p; WriteLn(q[0], q[1], Ord(q[2]), ' ', p = q) end.`)
    ).toEqual(['ab0 TRUE']);
    // Each text ends with a #0 character, even where another follows it.
    expect(
      execute(`program T; var p, q: PChar;
      begin p := 'ab'; q := 'cd'; WriteLn(p[2] = #0, q[2] = #0, ' ', p[0], q[0]) end.`)
    ).toEqual(['TRUETRUE ac']);
    expect(() => compile("program T; {$X-} var p: PChar; begin p := 'ab' end.")).toThrow(
      /Type mismatch/
    );
    expect(() => compile('program T; {$X-} var p: PChar; c: Char; begin c := p[0] end.')).toThrow(
      /Array or string expected/
    );
  });

  it('starts the System unit variables with their values and ends on ExitCode', () => {
    expect(
      execute('program T; begin WriteLn(ExitCode, RandSeed, FileMode, Test8087, Test8086) end.')
    ).toEqual(['00233']);
    const machine = new Machine(compile('program T; begin ExitCode := 3; Halt(9) end.'));
    machine.run();
    expect(machine.getExitCode()).toBe(9);
    // Borland's generator: RandSeed := RandSeed * 134775813 + 1.
    expect(execute('program T; begin RandSeed := 1; WriteLn(Random(1000), RandSeed) end.')).toEqual([
      '31134775814',
    ]);
  });

  it('keeps HeapOrg, HeapPtr and HeapEnd on the heap, which grows down', () => {
    expect(
      execute(`program T; type PInt = ^Integer; var p, q: PInt; before: LongInt; top: Pointer;
      begin before := MemAvail; Mark(top); Write(top = HeapPtr, ' ', HeapOrg = HeapPtr, ' ');
        New(p); New(q); Write(HeapPtr <> HeapOrg, ' ');
        Release(HeapOrg); WriteLn(MemAvail = before, ' ', HeapPtr = HeapOrg, ' ', HeapEnd <> nil) end.`)
    ).toEqual(['TRUE TRUE TRUE TRUE TRUE TRUE']);
  });

  it('releases every heap block above a mark', () => {
    expect(
      execute(`program T; type PInt = ^Integer; var top: Pointer; p, q: PInt; before: LongInt;
      begin before := MemAvail; Mark(top); New(p); New(q); Release(top); WriteLn(MemAvail = before) end.`)
    ).toEqual(['TRUE']);
  });

  it('gives directories the DOS I/O errors and names the current one', () => {
    const disk = new VirtualFileSystem();
    const machine = new Machine(
      compile(`program T; var s: string; f: Text;
      begin MkDir('SUB'); ChDir('SUB'); GetDir(0, s); WriteLn(s);
        Assign(f, 'A.TXT'); Rewrite(f); Close(f); ChDir('\\');
        {$I-} RmDir('SUB'); WriteLn(IOResult); ChDir('NONE'); WriteLn(IOResult);
        MkDir('X\\Y'); WriteLn(IOResult) end.`),
      { fileSystem: disk }
    );
    machine.run();
    expect(machine.getOutput()).toEqual(['C:\\SUB', '5', '3', '3']);
    expect(Object.keys(disk.snapshot())).toEqual(['SUB/A.TXT']);
  });

  it('writes Lst to LPT1 on the drive, and only with the Printer unit', () => {
    const disk = new VirtualFileSystem();
    const machine = new Machine(compile(`program T; uses Printer; begin WriteLn(Lst, 'page'); Write(Lst, 'end') end.`), {
      fileSystem: disk,
    });
    machine.run();
    expect(disk.snapshot()).toEqual({ LPT1: 'page\r\nend' });
    expect(() => compile("program T; begin WriteLn(Lst, 'x') end.")).toThrow(/Undeclared identifier "Lst"/);
  });

  it('moves a PChar and passes a zero-based Char array as one', () => {
    expect(
      execute(`program T; var buf: array[0..9] of Char; p, q: PChar;
      begin buf[0] := 'a'; buf[1] := 'b'; buf[2] := #0; p := buf; q := p + 1;
        Write(q^, ' ', q - p, ' '); q := p + 2; WriteLn(q^ = #0) end.`)
    ).toEqual(['b 1 TRUE']);
  });

  it('sets an object constant method table, so its virtual methods work', () => {
    expect(
      execute(`program T; type Shape = object Sides: Integer; function Name: string; virtual; constructor Init; end;
      constructor Shape.Init; begin end; function Shape.Name: string; begin Name := 'shape' end;
      const Square: Shape = (Sides: 4);
      begin WriteLn(Square.Name, Square.Sides) end.`)
    ).toEqual(['shape4']);
    expect(() =>
      compile('program T; type P = procedure; procedure Q; begin end; const R: P = Q; begin end.')
    ).toThrow(/FAR procedure or function/);
    expect(() =>
      compile('program T; type Plain = object end; var p: Pointer; begin p := TypeOf(Plain) end.')
    ).toThrow(/TypeOf needs an object type with virtual methods/);
  });

  it('parses subrange bounds that start with a name', () => {
    expect(
      execute(`program T; const N = 3; type Small = N - 1..N + 1; Bytes = array[Low(Byte)..High(Byte) div 64] of Byte;
      begin WriteLn(Low(Small), ' ', High(Small), ' ', SizeOf(Bytes)) end.`)
    ).toEqual(['2 4 4']);
  });
});

describe('Standard units beyond System', () => {
  it('keeps HeapPtr on the heap top when a routine allocates', () => {
    expect(
      execute(`program T; type PInt = ^Integer; var before, after: Pointer;
      procedure Grab; var q: PInt; begin New(q); after := HeapPtr end;
      begin before := HeapPtr; Grab; WriteLn(before <> after, ' ', HeapPtr = after) end.`)
    ).toEqual(['TRUE TRUE']);
  });

  it('lets Overlay programs run, with every unit resident', () => {
    expect(
      execute(`{$O+,F+} program T; uses Overlay, Dos; {$O Dos}
      begin OvrInit('T.OVR'); WriteLn(OvrResult = ovrOk, ' ', OvrGetBuf); OvrInitEMS;
        OvrSetBuf(8192); OvrSetRetry(100); WriteLn(OvrGetBuf, ' ', OvrGetRetry, ' ', OvrTrapCount, OvrLoadCount, OvrFileMode);
        OvrResult := ovrError; OvrClearBuf; WriteLn(OvrResult) end.`)
    ).toEqual(['TRUE 0', '8192 100 000', '0']);
    expect(() => compile('program T; begin OvrInit(\'T.OVR\') end.')).toThrow(/Undeclared procedure or function "OvrInit"/);
    expect(() => compile('program T; begin OvrResult := 0 end.')).toThrow(/Undeclared identifier "OvrResult"/);
  });

  it('reads Turbo3 Kbd a key at a time, without echo', () => {
    const machine = new Machine(
      compile(`program T; uses Turbo3; var c, d: Char; f: Text;
      begin Read(Kbd, c, d); WriteLn(Ord(c), d); AssignKbd(f); Reset(f); Read(f, c); WriteLn(c, CBreak) end.`)
    );
    machine.run();
    expect(machine.getState()).toBe(MachineState.WAITING);
    expect(machine.getInputMode()).toBe('key');
    machine.provideKey('x');
    machine.run();
    // One key is not yet enough for two characters.
    expect(machine.getState()).toBe(MachineState.WAITING);
    machine.provideKey('y');
    machine.provideKey('q');
    machine.run();
    expect(machine.getOutput()).toEqual(['120y', 'qTRUE']);
    expect(() => compile('program T; uses Turbo3; var n: Integer; begin Read(Kbd, n) end.')).not.toThrow();
    const numbers = new Machine(compile('program T; uses Turbo3; var n: Integer; begin Read(Kbd, n) end.'));
    numbers.provideKey('1');
    expect(() => {
      numbers.run();
    }).toThrow(/Only characters can be read from the keyboard/);
  });

  it('gives Turbo3 its paragraph heap sizes, real file sizes and video', () => {
    const disk = new VirtualFileSystem();
    const machine = new Machine(
      compile(`program T; uses Crt, Turbo3; var f: file of Integer; i: Integer;
      begin WriteLn(MemAvail > 0, ' ', MemAvail < System.MemAvail div 8, ' ', MaxAvail <= MemAvail);
        Assign(f, 'X.DAT'); Rewrite(f); for i := 1 to 5 do Write(f, i);
        WriteLn(LongFileSize(f):0:1, ' ', LongFilePos(f):0:0); LongSeek(f, 2.0); Read(f, i); WriteLn(i); Close(f);
        LowVideo; Write(TextAttr, ' '); HighVideo; Write(TextAttr, ' '); NormVideo; WriteLn(TextAttr) end.`),
      { fileSystem: disk }
    );
    machine.run();
    expect(machine.getOutput()).toEqual(['TRUE TRUE TRUE', '5.0 5', '3', '7 14 14']);
  });

  it('keeps the Crt variables in step with the screen', () => {
    const machine = new Machine(
      compile(`program T; uses Crt;
      begin WriteLn(TextAttr, ' ', WindMin, ' ', WindMax, ' ', LastMode, ' ', CheckBreak, CheckEOF, DirectVideo);
        TextColor(Yellow); TextBackground(Blue); WriteLn(TextAttr);
        TextAttr := $4F; Write('x'); WriteLn(TextAttr);
        Window(2, 3, 40, 10); WriteLn(WindMin, ' ', WindMax);
        WindMin := 0; WindMax := $184F; GotoXY(1, 20); Write('y');
        TextMode(CO40); WriteLn(LastMode, ' ', WindMax) end.`)
    );
    machine.run();
    expect(machine.getOutput()).toEqual(['7 0 6223 3 TRUEFALSETRUE', '30', 'x79', '513 2343', 'y1 6183']);
    expect(() => compile('program T; begin TextAttr := 7 end.')).toThrow(/Undeclared identifier "TextAttr"/);
  });

  it('qualifies names with the standard unit that declares them', () => {
    expect(
      execute(`program T; uses Crt, Turbo3; var i: System.Integer;
      begin i := System.MaxInt; Crt.TextColor(Crt.Red); System.WriteLn(i, ' ', Crt.TextAttr, System.Length('abc'):3, System.Pi:5:2);
        WriteLn(MemAvail < System.MemAvail div 8, ' ', System.ExitCode, ' ', Turbo3.CBreak) end.`)
    ).toEqual(['32767 4  3 3.14', 'TRUE 0 TRUE']);
    // A unit not in use names nothing, and a variable may take a unit's name.
    expect(() => compile('program T; begin WriteLn(Crt.Yellow) end.')).toThrow(/Undeclared identifier "Crt"/);
    expect(() => compile('program T; begin WriteLn(System.Nothing) end.')).toThrow(/Undeclared identifier "System.Nothing"/);
    expect(
      execute('program T; type R = record MemAvail: Integer end; var System: R; begin System.MemAvail := 4; WriteLn(System.MemAvail) end.')
    ).toEqual(['4']);
    // A program may declare a System name again, as Turbo Pascal lets it.
    expect(
      execute(`program T; var Double: string[5]; procedure MaxInt; begin Write('proc ') end;
      begin Double := 'abcdefg'; MaxInt; WriteLn(Double, ' ', System.MaxInt, ' ', SizeOf(System.Double)) end.`)
    ).toEqual(['proc abcde 32767 8']);
    expect(() => compile('program T; var x: Integer; x: Integer; begin end.')).toThrow(/Duplicate identifier "x"/);
    // A variable's type cannot name the variable, even where a System type
    // has that name, as Free Pascal's tbf0345 checks.
    expect(() => compile('program T; var Word: array[1..2] of Word; begin end.')).toThrow(/Error in type definition/);
  });
});
