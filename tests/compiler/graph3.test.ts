import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { BGI_FONT } from '../../src/tui/bgiFont';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function start(source: string): Machine {
  const machine = new Machine(compile(source), { maxInstructions: 2_000_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine;
}
const output = (source: string) => start(source).getOutput();

describe('Graph3: Turbo Pascal 3 graphics', () => {
  it('opens the CGA screens, whose palettes recolor what is drawn', () => {
    const machine = start(
      `program T; uses Graph3; begin GraphColorMode; Plot(0, 0, 1); Plot(1, 0, 3); Palette(0); GraphBackground(1) end.`
    );
    const graphics = machine.getGraphics();
    expect([graphics.width, graphics.height, graphics.initialized]).toEqual([320, 200, true]);
    // The screen keeps color numbers; the palette shows them.
    expect([graphics.pixels[0], graphics.pixels[1]]).toEqual([1, 3]);
    expect(Array.from(graphics.display().subarray(0, 3))).toEqual([2, 6, 1]);
    const hires = start(
      `program T; uses Graph3; begin HiRes; HiResColor(14); Plot(639, 199, 3) end.`
    ).getGraphics();
    expect([hires.width, hires.height, hires.pixels[199 * 640 + 639]]).toEqual([640, 200, 1]);
    expect(hires.display()[199 * 640 + 639]).toBe(14);
    // GraphMode's black and white palettes, as an RGB monitor shows them.
    const mono = start(
      `program T; uses Graph3; begin GraphMode; Palette(0); Plot(0, 0, 1); Plot(1, 0, 2); Plot(2, 0, 3) end.`
    ).getGraphics();
    expect(Array.from(mono.display().subarray(0, 3))).toEqual([1, 4, 7]);
  });

  it('draws dots, lines, circles and arcs, clipped to the window', () => {
    expect(
      output(`program T; uses Graph3;
      begin GraphColorMode; Plot(1, 1, 2); Draw(0, 5, 20, 5, 3); Circle(40, 20, 10, 1); Arc(100, 10, 90, 8, 2);
        WriteLn(GetDotColor(1, 1), GetDotColor(10, 5), GetDotColor(50, 20), GetDotColor(40, 10), GetDotColor(400, 1));
        { The arc starts at its circle's top and turns clockwise. }
        WriteLn(GetDotColor(100, 10), GetDotColor(108, 18), GetDotColor(92, 18), GetDotColor(100, 26));
        GraphWindow(2, 2, 60, 30); Draw(0, 8, 100, 8, 1);
        WriteLn(GetDotColor(1, 1), ' ', GetDotColor(10, 8), ' ', GetDotColor(70, 8)) end.`)
    ).toEqual(['2311-1', '2200', '-1 1 -1']);
  });

  it('translates colors through the color table', () => {
    expect(
      output(`program T; uses Graph3;
      begin GraphColorMode; Plot(0, 0, 1); ColorTable(3, 2, 1, 0); FillScreen(-1);
        Write(GetDotColor(0, 0), GetDotColor(5, 5), ' '); Plot(5, 5, -1); WriteLn(GetDotColor(5, 5)) end.`)
    ).toEqual(['23 0']);
  });

  it('fills shapes and patterns', () => {
    expect(
      output(`program T; uses Graph3; const Lines: array[0..7] of Byte = ($44, $88, $11, $22, $44, $88, $11, $22);
      begin GraphColorMode; Pattern(Lines); FillPattern(20, 0, 27, 7, 3);
        WriteLn(GetDotColor(21, 0), GetDotColor(20, 0), GetDotColor(20, 1));
        Draw(30, 10, 40, 10, 1); Draw(30, 20, 40, 20, 1); Draw(30, 10, 30, 20, 1); Draw(40, 10, 40, 20, 1);
        FillShape(35, 15, 2, 1); WriteLn(GetDotColor(35, 15), GetDotColor(30, 15), GetDotColor(45, 15)) end.`)
    ).toEqual(['303', '210']);
  });

  it('copies pictures in Turbo Pascal 3 layout', () => {
    expect(
      output(`program T; uses Graph3; var buf: array[1..40] of Byte; i: Integer; small: Integer;
      begin GraphColorMode; Draw(0, 0, 5, 0, 1); Plot(1, 1, 2); Plot(2, 1, 3);
        GetPic(buf, 0, 0, 5, 1); for i := 1 to 10 do Write(buf[i], ' '); WriteLn;
        { PutPic places the picture's lower left corner. }
        PutPic(buf, 10, 5); WriteLn(GetDotColor(10, 4), GetDotColor(11, 5), GetDotColor(12, 5), GetDotColor(15, 4));
        ColorTable(0, 3, 3, 3); PutPic(buf, 10, 5); WriteLn(GetDotColor(10, 4), GetDotColor(10, 5));
        HiRes; Plot(0, 0, 1); GetPic(small, 0, 0, 7, 7); WriteLn(small) end.`)
    ).toEqual(['2 0 6 0 2 0 85 80 44 0 ', '1231', '30', '1']);
  });

  it('walks the turtle in turtle coordinates', () => {
    expect(
      output(`program T; uses Graph3;
      begin GraphColorMode; WriteLn(Xcor, ' ', Ycor, ' ', Heading, ' ', TurtleThere);
        TurtleWindow(20, 15, 30, 20); Forwd(5); TurnRight(90); Forwd(8); WriteLn(Xcor, ' ', Ycor, ' ', Heading);
        SetHeading(West); PenUp; Back(3); PenDown; WriteLn(Xcor, ' ', Heading);
        SetHeading(-90); Write(Heading, ' '); TurnLeft(450); WriteLn(Heading);
        Home; Forwd(100); Write(Ycor, ' '); Wrap; Home; Forwd(15); WriteLn(Ycor);
        ShowTurtle; Write(TurtleThere, ' '); HideTurtle; WriteLn(TurtleThere) end.`)
    ).toEqual(['0 0 0 FALSE', '8 5 90', '11 270', '270 180', '10 -5', 'TRUE FALSE']);
    // Home is the middle of the window: X -159..160 and Y -99..100 across a
    // 320x200 screen. The pen draws as the turtle goes.
    expect(
      output(`program T; uses Graph3;
      begin GraphColorMode; SetPenColor(2); SetHeading(East); Forwd(160); SetPosition(-159, 100);
        WriteLn(GetDotColor(159, 100), GetDotColor(319, 100), GetDotColor(158, 100), ' ', Xcor, ' ', Ycor) end.`)
    ).toEqual(['220 -159 100']);
  });

  it('shows the turtle over the screen rather than in it', () => {
    const graphics = start(
      `program T; uses Graph3; begin GraphColorMode; ShowTurtle end.`
    ).getGraphics();
    expect(graphics.decoration.length).toBeGreaterThan(0);
    expect(graphics.pixels.every((dot) => dot === 0)).toBe(true);
    expect(graphics.display().some((dot) => dot !== 0)).toBe(true);
  });

  it('writes text on the graphics screen in the BIOS 8 by 8 characters', () => {
    const glyph = (graphics: ReturnType<Machine['getGraphics']>, x: number, y: number) =>
      Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => graphics.pixels[(y + row) * graphics.width + x + col])
      );
    const expected = (char: string, color: number) =>
      Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) =>
          (BGI_FONT[char.charCodeAt(0) * 8 + row] ?? 0) & (128 >>> col) ? color : 0
        )
      );
    const color =
      start(`program T; uses Crt, Graph3; begin GraphColorMode; Plot(3, 3, 1); TextColor(2); Write('A'); GotoXY(39, 25); Write('Z');
      TextColor(3); GotoXY(1, 2); Write('b') end.`).getGraphics();
    // The cell's other dots are the background's, over what was drawn there.
    expect(glyph(color, 0, 0)).toEqual(expected('A', 2));
    expect(glyph(color, 304, 192)).toEqual(expected('Z', 2));
    expect(glyph(color, 0, 8)).toEqual(expected('b', 3));
    const hires = start(
      `program T; uses Crt, Graph3; begin HiRes; GotoXY(80, 1); Write('B') end.`
    ).getGraphics();
    expect(glyph(hires, 632, 0)).toEqual(expected('B', 1));
    // Scrolling moves the dots up a row of characters; ClrScr clears them.
    const scrolled = start(`program T; uses Crt, Graph3; var a, b, c: Integer;
      begin GraphColorMode; Plot(100, 100, 3); GotoXY(1, 25); WriteLn; a := GetDotColor(100, 92); b := GetDotColor(100, 100);
        ClrScr; c := GetDotColor(100, 92); TextMode(C80); Write(a, b, c) end.`);
    // After TextMode, text goes to the text screen again.
    expect(scrolled.getOutput()).toEqual(['300']);
    expect(scrolled.getConsole().chars.slice(0, 3).join('')).toBe('300');
  });

  it('leaves graphics on TextMode, and needs a graphics mode to draw', () => {
    const machine = start(
      `program T; uses Crt, Graph3; begin HiRes; TextMode(C80); WriteLn('text') end.`
    );
    expect(machine.getGraphics().initialized).toBe(false);
    expect(machine.getOutput()).toEqual(['text']);
    const text = new Machine(compile('program T; uses Graph3; begin Plot(1, 1, 1) end.'));
    expect(() => {
      text.run();
    }).toThrow(/Graphics not initialized/);
    expect(() => compile('program T; begin GraphColorMode end.')).toThrow(
      /Undeclared procedure or function/
    );
  });

  it('pauses after each turtle move for TurtleDelay', () => {
    const machine = new Machine(
      compile(
        'program T; uses Graph3; begin GraphColorMode; TurtleDelay(50); Forwd(10); WriteLn(Ycor) end.'
      )
    );
    machine.run();
    expect(machine.getState()).toBe(MachineState.SLEEPING);
  });
});
