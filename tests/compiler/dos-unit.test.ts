import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { dosMatch } from '../../src/compiler/runtime/DosUnit';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function run(source: string, fileSystem = new VirtualFileSystem()): Machine {
  const machine = new Machine(compile(source), { maxInstructions: 1_000_000, fileSystem });
  machine.run();
  return machine;
}
const output = (source: string) => {
  const machine = run(source);
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
};

describe('The Dos unit', () => {
  it('overlays Registers byte by byte and calls interrupts with them', () => {
    expect(
      output(`program T; uses Dos; var R: Registers; n: Byte;
      begin R.AX := $1234; Write(R.AL, ' ', R.AH, ' ', SizeOf(R), ' ');
        R.AH := 2; R.DL := Ord('Q'); MsDos(R); WriteLn;
        R.AH := $30; Intr($21, R); Write(R.AL, '.', R.AH, ' ');
        n := $33; R.AX := 0; Intr(n, R); WriteLn(R.AX, ' ', R.Flags and FZero <> 0) end.`)
    ).toEqual(['52 18 20 Q', '6.22 0 FALSE']);
  });

  it('waits for a key through Intr, and reaches interrupt procedures', () => {
    const keyboard = run(
      'program T; uses Dos; var R: Registers; begin R.AH := 0; Intr($16, R); WriteLn(Chr(R.AL), R.AH) end.'
    );
    expect(keyboard.getState()).toBe(MachineState.WAITING);
    keyboard.provideKey('a');
    keyboard.run();
    expect(keyboard.getOutput()).toEqual(['a30']);
    expect(
      output(`program T; uses Dos; var R: Registers;
      procedure Double(Flags, CS, IP, AX, BX, CX, DX, SI, DI, DS, ES, BP: Word); interrupt; begin AX := AX * 2 end;
      begin SetIntVec($60, @Double); R.AX := 21; Intr($60, R); WriteLn(R.AX) end.`)
    ).toEqual(['42']);
  });

  it('finds files as DOS does, in the order they were made', () => {
    expect(
      output(`program T; uses Dos; var f: Text; S: SearchRec;
      procedure Make(const name: string; const text: string); begin Assign(f, name); Rewrite(f); Write(f, text); Close(f) end;
      procedure List(const path: string; attr: Word);
      begin FindFirst(path, attr, S); while DosError = 0 do begin Write(S.Name, ':', S.Attr, ':', S.Size, ' '); FindNext(S) end; WriteLn(DosError) end;
      begin MkDir('SUB'); Make('ONE.PAS', 'abc'); Make('TWO.TXT', ''); Make('README', 'x'); Make('SUB\\THREE.PAS', '');
        List('*.*', AnyFile); List('*.PAS', Archive); List('*', Archive); List('SUB\\*.*', Directory); List('T?O.*', 0);
        FindFirst('NOPE\\*.*', AnyFile, S); WriteLn(DosError) end.`)
    ).toEqual([
      'SUB:16:0 ONE.PAS:32:3 TWO.TXT:32:0 README:32:1 18',
      'ONE.PAS:32:3 18',
      'README:32:1 18',
      '.:16:0 ..:16:0 THREE.PAS:32:0 18',
      'TWO.TXT:32:0 18',
      '3',
    ]);
    expect([
      dosMatch('A.PAS', '*.*'),
      dosMatch('README', '*'),
      dosMatch('A.PAS', '*'),
      dosMatch('AB.P', '??.P?'),
    ]).toEqual([true, true, false, true]);
  });

  it("reads and sets a file's attributes and time", () => {
    const disk = new VirtualFileSystem({ 'DATA.TXT': 'data' });
    const machine = run(
      `program T; uses Dos; var f: Text; A: Word; Tm: LongInt;
      begin Assign(f, 'DATA.TXT'); GetFAttr(f, A); Write(A, ' ', DosError, ' ');
        SetFAttr(f, ReadOnly); GetFAttr(f, A); Write(A, ' ');
        {$I-} Rewrite(f); Write(IOResult, ' '); Erase(f); Write(IOResult, ' '); {$I+}
        SetFAttr(f, Directory); Write(DosError, ' '); SetFAttr(f, Archive);
        GetFTime(f, Tm); Write(DosError, ' '); Reset(f); SetFTime(f, 12345); GetFTime(f, Tm); WriteLn(Tm, ' ', DosError);
        Assign(f, 'NONE.TXT'); GetFAttr(f, A); WriteLn(DosError) end.`,
      disk
    );
    expect(machine.getOutput()).toEqual(['32 0 1 5 5 5 6 12345 0', '2']);
  });

  it('packs times and splits, expands and searches names', () => {
    expect(
      output(`program T; uses Dos; var D: DirStr; N: NameStr; E: ExtStr; DT: DateTime; P: LongInt; f: Text;
      begin DT.Year := 1992; DT.Month := 10; DT.Day := 27; DT.Hour := 13; DT.Min := 45; DT.Sec := 31;
        PackTime(DT, P); UnpackTime(P, DT); WriteLn(P, ' ', DT.Year, '-', DT.Month, '-', DT.Day, ' ', DT.Hour, ':', DT.Min, ':', DT.Sec);
        FSplit('C:\\TP\\BIN\\TURBO.EXE', D, N, E); Write(D, '|', N, '|', E, ' '); FSplit('README', D, N, E); WriteLn(D, '|', N, '|', E);
        MkDir('SUB'); ChDir('SUB'); WriteLn(FExpand('x.pas'), ' ', FExpand('..\\y'), ' ', FExpand('\\a\\b'), ' ', FExpand('')); ChDir('\\');
        Assign(f, 'SUB\\THREE.PAS'); Rewrite(f); Close(f);
        WriteLn(FSearch('THREE.PAS', 'C:\\;C:\\SUB'), ' [', FSearch('NONE', 'SUB'), ']') end.`)
    ).toEqual([
      '425422255 1992-10-27 13:45:30',
      'C:\\TP\\BIN\\|TURBO|.EXE |README|',
      'C:\\SUB\\X.PAS C:\\Y C:\\A\\B C:\\SUB',
      'C:\\SUB\\THREE.PAS []',
    ]);
  });

  it('keeps DOS settings and its environment, and cannot Exec', () => {
    expect(
      output(`program T; uses Dos; var b: Boolean; i: Integer;
      begin GetCBreak(b); Write(b, ' '); SetCBreak(True); GetCBreak(b); Write(b, ' ');
        GetVerify(b); Write(b, ' '); SetVerify(True); GetVerify(b); WriteLn(b);
        for i := 1 to EnvCount do Write(EnvStr(i), ' '); WriteLn('[', EnvStr(4), ']');
        SwapVectors; Exec(GetEnv('COMSPEC'), '/C DIR'); SwapVectors; Write(DosError, ' ', DosExitCode, ' ');
        Exec('NOTHERE.EXE', ''); WriteLn(DosError) end.`)
    ).toEqual([
      'FALSE TRUE FALSE TRUE',
      'COMSPEC=C:\\COMMAND.COM PATH=C:\\ TEMP=C:\\TEMP []',
      '8 0 2',
    ]);
    const keep = run(
      "program T; uses Dos; begin WriteLn('resident'); Keep(3); WriteLn('not here') end."
    );
    expect([keep.getOutput(), keep.getExitCode()]).toEqual([['resident'], 3]);
  });

  it("checks the unit's own types, which a program may declare again", () => {
    expect(() =>
      compile("program T; uses Dos; var S: string; begin FindFirst('*.*', 0, S) end.")
    ).toThrow(/SearchRec expected|Type mismatch/);
    expect(() => compile('program T; uses Dos; var R: Integer; begin MsDos(R) end.')).toThrow(
      /Registers expected|Type mismatch/
    );
    expect(
      output(
        'program T; uses Dos; type Registers = Integer; var R: Registers; D: Dos.DateTime; begin R := 5; D.Year := 1; WriteLn(R, D.Year) end.'
      )
    ).toEqual(['51']);
    expect(() => compile('program T; var R: Registers; begin end.')).toThrow(
      /Unknown type|Undeclared/
    );
  });
});
