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
        SetViewPort(200, 100, 250, 150, True); Line(0, 0, 100, 0);
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
});
