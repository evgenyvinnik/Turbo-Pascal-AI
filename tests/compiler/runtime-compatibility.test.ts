import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { parseStrokeFont } from '../../src/compiler/runtime/StrokeFont';

function machineFor(source: string, disk = new VirtualFileSystem()) {
  return new Machine(new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()), {
    fileSystem: disk,
    maxInstructions: 10000,
  });
}

// A deliberately small CHR fixture: one triangle glyph A, width8, ascent7.
// The original Borland fonts are not needed to test the documented binary format.
function triangleFont() {
  const bytes = new Uint8Array(61);
  bytes.set([0x50, 0x4b, 8, 8, 26, 32, 0]);
  bytes.set([43, 1, 0, 0, 65, 19, 0, 0, 7, 0, 0], 32);
  bytes.set([0, 0, 8], 48);
  bytes.set([128, 0, 131, 135, 134, 128, 128, 128, 0], 51);
  return bytes;
}

describe('Turbo Pascal runtime compatibility', () => {
  it('renders raw DOS character codes and preserves their ordinal values', () => {
    const machine = machineFor(`program Characters; uses Crt;
      begin ClrScr; WriteLn(#201#205#187); WriteLn(Ord('é'),',',UpCase('a'),',',Ord(UpCase(#223))) end.`);
    machine.run();
    expect(machine.getConsole().chars.slice(0, 3).join('')).toBe('╔═╗');
    expect(machine.getOutput()).toEqual(['╔═╗', '130,A,223']);
  });
  it('shares actual binary bytes between typed and untyped files and permits Reset updates', () => {
    const disk = new VirtualFileSystem();
    const machine = machineFor(
      `program BinaryFiles;
      var f: file of Integer; raw: file; n: Integer; b: array[1..4] of Byte;
      begin
        Assign(f,'values.dat'); Rewrite(f); n:=4660; Write(f,n); n:=-2; Write(f,n); Close(f);
        Reset(f); Seek(f,1); n:=-3; Write(f,n); Seek(f,0); Read(f,n); WriteLn(n,',',FileSize(f)); Close(f);
        Assign(raw,'values.dat'); Reset(raw,1); BlockRead(raw,b,4); Close(raw);
        WriteLn(b[1],',',b[2],',',b[3],',',b[4])
      end.`,
      disk
    );
    machine.run();
    expect(machine.getOutput()).toEqual(['4660,2', '52,18,253,255']);
    expect(Array.from(disk.read('values.dat'), (char) => char.charCodeAt(0))).toEqual([
      0x34, 0x12, 0xfd, 0xff,
    ]);
  });

  it('recovers from invalid console input through IOResult and preserves the destination', () => {
    const machine = machineFor(`program InputErrors; var n: Integer;
      begin n:=7; {$I-} ReadLn(n); WriteLn('skipped while an I/O error is pending'); WriteLn(IOResult,',',n); ReadLn(n); {$I+} WriteLn(IOResult,',',n) end.`);
    machine.setInput(['wrong', '42']);
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['106,7', '0,42']);
  });

  it('reports Real48 conversion failures through Val instead of storing invalid numbers', () => {
    const machine = machineFor(`program Conversion; var value: Real; code: Integer;
      begin value:=2.5; Val('1e100',value,code); WriteLn(code>0,',',value:0:1);
        Val('0.1',value,code); WriteLn(code,',',value:0:2) end.`);
    machine.run();
    expect(machine.getOutput()).toEqual(['TRUE,2.5', '0,0.10']);
  });

  it('loads CHR strokes from InitGraph path and supports custom scaling', () => {
    const bytes = triangleFont();
    expect(parseStrokeFont(bytes).glyphs.get(65)?.width).toBe(8);
    expect(() => parseStrokeFont(bytes.subarray(0, 55))).toThrow(/Invalid CHR/);
    const disk = new VirtualFileSystem({
      'FONTS/TRIP.CHR': Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''),
    });
    const machine = machineFor(
      `program Fonts; uses Graph; var driver,mode: Integer;
      begin driver:=Detect; InitGraph(driver,mode,'FONTS');
        SetTextStyle(TriplexFont,HorizDir,4); OutTextXY(10,10,'A');
        WriteLn(GraphResult,',',TextWidth('AA'),',',TextHeight('A'),',',GetPixel(10,17));
        SetTextStyle(TriplexFont,HorizDir,0); SetUserCharSize(2,1,3,1);
        WriteLn(TextWidth('A'),',',TextHeight('A'))
      end.`,
      disk
    );
    machine.run();
    expect(machine.getOutput()).toEqual(['0,16,8,15', '16,24']);
    expect(machine.getGraphics().pixels[10 * 640 + 13]).toBe(15);
  });

  it('returns a GraphResult error when a requested font file is absent', () => {
    const machine = machineFor(`program MissingFont; uses Graph; var driver,mode: Integer;
      begin driver:=Detect; InitGraph(driver,mode,''); SetTextStyle(TriplexFont,HorizDir,4);
        WriteLn(GraphResult,',',GraphResult,',',TextWidth('A')) end.`);
    machine.run();
    expect(machine.getOutput()).toEqual(['-8,0,8']);
  });
});
