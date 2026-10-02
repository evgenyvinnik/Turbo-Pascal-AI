import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { testDriver } from '../fixtures/x86/testDriver';

const text = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

function start(
  source: string,
  files: Record<string, Uint8Array> = { 'TESTBGI.BGI': testDriver() }
) {
  const disk = new VirtualFileSystem(
    Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, text(bytes)]))
  );
  const machine = new Machine(
    new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()),
    { fileSystem: disk, maxInstructions: 2_000_000 }
  );
  machine.run();
  return machine;
}
const run = (source: string, files?: Record<string, Uint8Array>) =>
  start(source, files).getOutput();

const open = `d := InstallUserDriver('TESTBGI', nil); m := 0; InitGraph(d, m, '');`;

describe("a third-party BGI driver's code", () => {
  it('installs, describes its mode and switches to graphics', () => {
    expect(
      run(`program T; uses Graph; var d, m: Integer;
      begin ${open}
        WriteLn(GraphResult, ' ', d, ' ', GetDriverName, ' ', GetModeName(0), ' ', GetMaxMode, ' ',
          GetMaxX, 'x', GetMaxY, ' ', GetMaxColor);
        CloseGraph; WriteLn(GraphResult) end.`)
    ).toEqual(['0 11 TESTBGI TEST 320x200x256 0 319x199 255', '0']);
  });

  it('refuses a mode it does not have, and a file with no driver code', () => {
    const source = `program T; uses Graph; var d, m: Integer;
      begin d := InstallUserDriver('TESTBGI', nil); m := 3; InitGraph(d, m, ''); WriteLn(GraphResult) end.`;
    expect(run(source)).toEqual(['-10']);
    const broken = testDriver();
    broken.fill(0x90, 0xa0, 0xb0);
    expect(run(source, { 'TESTBGI.BGI': broken })).toEqual(['-4']);
  });

  it('draws lines, bars and dots with its own code', () => {
    const machine = start(`program T; uses Graph; var d, m: Integer;
      begin ${open}
        SetColor(200); Line(0, 0, 99, 99); SetFillStyle(SolidFill, 100); Bar(150, 10, 160, 20);
        PutPixel(300, 150, 77);
        WriteLn(GetPixel(50, 50), ' ', GetPixel(51, 50), ' ', GetPixel(155, 15), ' ', GetPixel(300, 150));
        SetViewPort(200, 100, 250, 150, ClipOn); Line(0, 0, 100, 0);
        WriteLn(GetPixel(0, 0), ' ', GetPixel(50, 0)) end.`);
    expect(machine.getOutput()).toEqual(['200 0 100 77', '200 200']);
    // The screen shown is the driver's video memory.
    const screen = machine.getGraphics().display();
    expect(screen.length).toBe(320 * 200);
    expect(screen[10 * 320 + 10]).toBe(200);
    expect(screen[150 * 320 + 300]).toBe(77);
    // The driver clipped the line to the viewport.
    expect(screen[100 * 320 + 251]).toBe(0);
  });

  it('leaves flood fills, circles and text to the kernel when the driver does', () => {
    expect(
      run(`program T; uses Graph; var d, m: Integer;
      begin ${open}
        SetColor(15); Rectangle(10, 10, 60, 40); SetFillStyle(SolidFill, 4); FloodFill(30, 30, 15);
        WriteLn(GetPixel(11, 11), ' ', GetPixel(59, 39), ' ', GetPixel(10, 10), ' ', GetPixel(61, 41));
        SetFillStyle(SolidFill, 9); PieSlice(160, 100, 0, 90, 30);
        WriteLn(GetPixel(170, 90), ' ', GetPixel(150, 110));
        SetColor(14); OutTextXY(100, 150, 'I'); Write(GetPixel(103, 150), ' ', GetPixel(103, 152), ' ');
        SetTextStyle(DefaultFont, HorizDir, 2); OutTextXY(200, 150, 'I'); WriteLn(GetPixel(207, 155)) end.`)
    ).toEqual(['4 4 15 0', '9 0', '14 14 14']);
  });

  it('XORs lines with its own write mode, and copies what is drawn after', () => {
    expect(
      run(`program T; uses Graph; var d, m: Integer;
      begin ${open}
        SetColor(12); SetWriteMode(XORPut); Line(0, 0, 20, 0); Line(0, 0, 10, 0); Rectangle(30, 0, 40, 10);
        Rectangle(30, 0, 40, 10); PutPixel(50, 50, 3); PutPixel(50, 50, 3);
        WriteLn(GetPixel(5, 0), ' ', GetPixel(15, 0), ' ', GetPixel(30, 5), ' ', GetPixel(50, 50));
        SetWriteMode(CopyPut); Line(0, 0, 20, 0); Line(0, 0, 10, 0); WriteLn(GetPixel(5, 0)) end.`)
    ).toEqual(['0 12 0 3', '12']);
  });

  it('saves and puts images with its own SAVEBITMAP and RESTOREBITMAP', () => {
    expect(
      run(`program T; uses Graph; var d, m, i: Integer; Image: Pointer; Size: Word;
      begin ${open}
        SetFillStyle(SolidFill, 100); Bar(10, 10, 19, 14); PutPixel(10, 10, 200);
        Size := ImageSize(10, 10, 19, 14); GetMem(Image, Size); GetImage(10, 10, 19, 14, Image^);
        WriteLn(Size, ' ', ImageSize(0, 0, 319, 199), ' ', GraphResult);
        SetFillStyle(SolidFill, 7); Bar(100, 100, 120, 120);
        for i := 0 to 4 do PutImage(100, 100, Image^, i);
        { 7, then 100 copied, 100 XOR 100, OR 100, AND 100, NOT 100. }
        WriteLn(GetPixel(105, 102), ' ', GetPixel(100, 100));
        PutImage(200, 100, Image^, NormalPut); PutImage(200, 100, Image^, XORPut); WriteLn(GetPixel(205, 102)) end.`)
    ).toEqual(['56 64006 0', '155 55', '0']);
  });
});
