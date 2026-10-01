import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { testDriver } from '../fixtures/x86/testDriver';

function start(source: string, disk = new VirtualFileSystem()) {
  const machine = new Machine(
    new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()),
    { fileSystem: disk, maxInstructions: 3_000_000 }
  );
  machine.run();
  return machine;
}
const run = (source: string) => start(source).getOutput();
/** A program in VGAHi with these declarations and statements. */
const vga = (declarations: string, statements: string) => `program T; uses Graph;
  ${declarations}
  var Driver, Mode: Integer;
  begin Driver := VGA; Mode := VGAHi; InitGraph(Driver, Mode, ''); ${statements} end.`;

describe("Graph's settings records", () => {
  it('read back the viewport, fill, line and text settings', () => {
    expect(
      run(
        vga(
          'var v: ViewPortType; f: FillSettingsType; l: LineSettingsType; t: TextSettingsType;',
          `SetViewPort(10, 20, 300, 200, ClipOff); GetViewSettings(v);
          WriteLn(v.x1, ' ', v.y1, ' ', v.x2, ' ', v.y2, ' ', v.Clip);
          SetFillStyle(HatchFill, Red); GetFillSettings(f); WriteLn(f.Pattern, ' ', f.Color);
          SetLineStyle(UserBitLn, $F0F0, ThickWidth); GetLineSettings(l);
          WriteLn(l.LineStyle, ' ', l.Pattern, ' ', l.Thickness);
          SetTextStyle(DefaultFont, VertDir, 2); SetTextJustify(CenterText, TopText); GetTextSettings(t);
          WriteLn(t.Font, ' ', t.Direction, ' ', t.CharSize, ' ', t.Horiz, ' ', t.Vert)`
        )
      )
    ).toEqual(['10 20 300 200 FALSE', '7 4', '4 61680 3', '0 1 2 1 2']);
  });

  it('give the center and ends of the last arc', () => {
    expect(
      run(
        vga(
          'var a: ArcCoordsType;',
          `Arc(100, 100, 0, 90, 50); GetArcCoords(a);
          WriteLn(a.X, ' ', a.Y, ' ', a.Xstart, ' ', a.Ystart, ' ', a.Xend, ' ', a.Yend)`
        )
      )
    ).toEqual(['100 100 150 100 100 50']);
  });

  it('declare the TP7 constants that go with them', () => {
    expect(
      run(
        vga(
          '',
          `WriteLn(MaxColors, ' ', CopyPut, XORPut, OrPut, AndPut, NotPut, NormalPut, ' ', EGABrown, ' ', EGAWhite, ' ',
            BoldFont, ' ', UserCharSize, ' ', CurrentDriver, ' ', EGAHi, ' ', grInvalidVersion)`
        )
      )
    ).toEqual(['15 012340 20 63 10 0 -128 1 -18']);
  });
});

describe("Graph's palette", () => {
  it('starts as the EGA colors, and SetPalette and SetAllPalette change registers', () => {
    const machine = start(
      vga(
        'const Pal: PaletteType = (Size: 16; Colors: (-1, -1, 63, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1));\n  var p: PaletteType; i: Integer;',
        `GetPalette(p); Write(p.Size, ':'); for i := 0 to 15 do Write(' ', p.Colors[i]); WriteLn;
        SetPalette(1, EGALightRed); SetAllPalette(Pal); GetPalette(p);
        WriteLn(p.Colors[1], ' ', p.Colors[2], ' ', p.Colors[3], ' ', GetPaletteSize);
        GetDefaultPalette(p); Write(p.Colors[1], ' '); SetPalette(16, 1); WriteLn(GraphResult);
        PutPixel(0, 0, 1); PutPixel(1, 0, 2)`
      )
    );
    expect(machine.getOutput()).toEqual([
      '16: 0 1 2 3 4 5 20 7 56 57 58 59 60 61 62 63',
      '60 63 3 16',
      '1 -11',
    ]);
    // The screen keeps color numbers; the palette shows them.
    const colors = machine.getGraphics().colors() ?? [];
    expect([colors[1], colors[2], colors[6]]).toEqual([0xff5555, 0xffffff, 0xaa5500]);
  });

  it("sets a DAC entry's red, green and blue, keeping six bits of each", () => {
    const machine = start(
      vga('var p: PaletteType;', `GetPalette(p); SetRGBPalette(p.Colors[Red], 255, 128, 0)`)
    );
    expect(machine.getGraphics().colors()?.[4]).toBe(0xff8200);
  });

  it('comes back with GraphDefaults', () => {
    expect(
      run(
        vga(
          'var p: PaletteType;',
          'SetPalette(1, 9); GraphDefaults; GetPalette(p); WriteLn(p.Colors[1])'
        )
      )
    ).toEqual(['1']);
  });
});

describe('polygons, fill patterns and write modes', () => {
  it('fill and draw polygons given as arrays of PointType', () => {
    expect(
      run(
        vga(
          'const Tri: array[1..4] of PointType = ((X: 10; Y: 10), (X: 50; Y: 10), (X: 30; Y: 40), (X: 10; Y: 10));',
          `SetColor(White); SetFillStyle(SolidFill, Blue); FillPoly(3, Tri);
          WriteLn(GetPixel(30, 20), ' ', GetPixel(10, 10), ' ', GetPixel(30, 40), ' ', GetPixel(5, 5));
          SetColor(Yellow); DrawPoly(2, Tri); WriteLn(GetPixel(30, 10), ' ', GetPixel(40, 25))`
        )
      )
    ).toEqual(['1 15 15 0', '14 15']);
  });

  it('fill with a user pattern of eight rows of eight dots', () => {
    expect(
      run(
        vga(
          'const Checks: FillPatternType = ($AA, $55, $AA, $55, $AA, $55, $AA, $55);\n  var f: FillSettingsType; q: FillPatternType;',
          `SetFillPattern(Checks, Yellow); GetFillSettings(f); GetFillPattern(q);
          WriteLn(f.Pattern, ' ', f.Color, ' ', q[1], ' ', q[2]);
          Bar(0, 0, 7, 7); WriteLn(GetPixel(0, 0), ' ', GetPixel(1, 0), ' ', GetPixel(0, 1), ' ', GetPixel(1, 1))`
        )
      )
    ).toEqual(['12 14 170 85', '14 0 0 14']);
  });

  it('XOR lines and rectangles in XORPut, but not circles', () => {
    expect(
      run(
        vga(
          '',
          `SetWriteMode(XORPut); Line(0, 0, 20, 0); Line(0, 0, 10, 0); Rectangle(30, 0, 40, 10);
          Rectangle(30, 0, 40, 10); Circle(100, 100, 10); Circle(100, 100, 10);
          WriteLn(GetPixel(5, 0), ' ', GetPixel(15, 0), ' ', GetPixel(30, 5), ' ', GetPixel(110, 100));
          SetWriteMode(CopyPut); Line(0, 0, 20, 0); Line(0, 0, 10, 0); WriteLn(GetPixel(5, 0))`
        )
      )
    ).toEqual(['0 15 0 15', '15']);
  });
});

describe('images', () => {
  it('measure, save and put a rectangle in each of the five ways', () => {
    expect(
      run(
        vga(
          'var Image: Pointer; Size: Word; i: Integer;',
          `SetFillStyle(SolidFill, Blue); Bar(10, 10, 50, 40); PutPixel(10, 10, Red);
          Size := ImageSize(10, 10, 50, 40); GetMem(Image, Size); GetImage(10, 10, 50, 40, Image^);
          WriteLn(Size, ' ', ImageSize(0, 0, 639, 479), ' ', GraphResult);
          SetFillStyle(SolidFill, Green); Bar(200, 200, 260, 260);
          for i := 0 to 4 do PutImage(200 + i * 0, 200, Image^, i);
          { Green, then Blue copied, Blue XOR Blue, OR Blue, AND Blue, NOT Blue. }
          WriteLn(GetPixel(220, 210), ' ', GetPixel(200, 200));
          PutImage(300, 300, Image^, NormalPut); PutImage(300, 300, Image^, XORPut); WriteLn(GetPixel(320, 310));
          PutImage(300, 300, Image^, NotPut); WriteLn(GetPixel(320, 310), ' ', GetPixel(300, 300))`
        )
      )
    ).toEqual(['750 0 -11', '14 11', '0', '14 11']);
  });
});

describe('pages and the aspect ratio', () => {
  it('draw on one page of VGALo while showing another', () => {
    const machine = start(`program T; uses Graph; var Driver, Mode: Integer;
      begin Driver := VGA; Mode := VGALo; InitGraph(Driver, Mode, '');
        SetActivePage(1); PutPixel(1, 1, Red); Write(GetPixel(1, 1), ' ');
        SetActivePage(0); Write(GetPixel(1, 1), ' '); SetVisualPage(1); SetActivePage(9); WriteLn(GetPixel(1, 1)) end.`);
    expect(machine.getOutput()).toEqual(['4 0 0']);
    expect(machine.getGraphics().display()[640 + 1]).toBe(4);
  });

  it('report a 4:3 screen, and draw circles in the ratio set', () => {
    expect(
      run(`program T; uses Graph; var Driver, Mode, x, y: Integer;
        begin Driver := VGA; Mode := VGALo; InitGraph(Driver, Mode, ''); GetAspectRatio(x, y); Write(x, ' ', y, ' ');
          SetGraphMode(VGAHi); GetAspectRatio(x, y); Write(x, ' ', y, ' ');
          SetAspectRatio(5000, 10000); Circle(100, 100, 20);
          WriteLn(GetPixel(120, 100), ' ', GetPixel(100, 90), ' ', GetPixel(100, 80)) end.`)
    ).toEqual(['4167 10000 10000 10000 15 15 0']);
  });

  it("take a loaded driver's aspect ratio and 256 colors", () => {
    const disk = new VirtualFileSystem({
      'TESTBGI.BGI': Array.from(testDriver(), (byte) => String.fromCharCode(byte)).join(''),
    });
    const machine = start(
      `program T; uses Graph; var Driver, Mode, x, y: Integer;
      begin Driver := InstallUserDriver('TESTBGI', nil); Mode := 0; InitGraph(Driver, Mode, '');
        GetAspectRatio(x, y); WriteLn(x, ' ', y, ' ', GetPaletteSize); SetRGBPalette(200, 255, 0, 0) end.`,
      disk
    );
    expect(machine.getOutput()).toEqual(['8333 10000 256']);
    expect(machine.getGraphics().colors()?.[200]).toBe(0xff0000);
  });
});
