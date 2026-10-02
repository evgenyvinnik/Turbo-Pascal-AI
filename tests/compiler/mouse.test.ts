import { describe, expect, it, vi } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { MouseDriver, type MouseScreen } from '../../src/compiler/runtime/MouseDriver';

const TEXT: MouseScreen = { width: 640, height: 200, text: true };

/** INT 33h with these registers, and what it gives back. */
function call(mouse: MouseDriver, ax: number, bx = 0, cx = 0, dx = 0) {
  const registers = { ax, bx, cx, dx };
  return { known: mouse.service(registers), ...registers };
}

describe('the mouse driver', () => {
  it('is installed with two buttons, its cursor hidden in the middle of the screen', () => {
    const mouse = new MouseDriver(() => TEXT);
    expect(call(mouse, 0)).toMatchObject({ known: true, ax: 0xffff, bx: 2 });
    expect(call(mouse, 3)).toMatchObject({ bx: 0, cx: 320, dx: 96 });
    expect(mouse.cursor()).toBe(null);
    call(mouse, 1);
    expect(mouse.cursor()).toEqual({ x: 40, y: 12 });
    // Hidden twice, it takes two shows to come back.
    call(mouse, 2);
    call(mouse, 2);
    call(mouse, 1);
    expect(mouse.cursor()).toBe(null);
    call(mouse, 1);
    call(mouse, 1);
    expect(mouse.cursor()).toEqual({ x: 40, y: 12 });
  });

  it('counts in eight to a character cell in text mode, and in dots in graphics', () => {
    const text = new MouseDriver(() => TEXT);
    text.move(10.5 / 80, 3.5 / 25);
    expect(call(text, 3)).toMatchObject({ cx: 80, dx: 24 });
    const vga = new MouseDriver(() => ({ width: 640, height: 480, text: false }));
    vga.move(0.5, 0.25);
    expect(call(vga, 3)).toMatchObject({ cx: 320, dx: 120 });
    // The 320-wide modes count x in twos.
    const mcga = new MouseDriver(() => ({ width: 320, height: 200, text: false }));
    mcga.move(0.5, 0.5);
    call(mcga, 1);
    expect(call(mcga, 3)).toMatchObject({ cx: 320, dx: 100 });
    expect(mcga.cursor()).toEqual({ x: 160, y: 100 });
  });

  it('reports the buttons, and counts their presses and releases with where they were', () => {
    const vga = new MouseDriver(() => ({ width: 640, height: 480, text: false }));
    vga.move(0.25, 0.25, 1);
    vga.move(0.5, 0.5, 3);
    expect(call(vga, 3)).toMatchObject({ bx: 3 });
    vga.move(0.75, 0.75, 0);
    expect(call(vga, 5, 0)).toMatchObject({ ax: 0, bx: 1, cx: 160, dx: 120 });
    expect(call(vga, 5, 0)).toMatchObject({ bx: 0 });
    expect(call(vga, 6, 1)).toMatchObject({ bx: 1, cx: 480, dx: 360 });
  });

  it('keeps the mouse in the ranges set, goes where it is put, and counts mickeys', () => {
    const vga = new MouseDriver(() => ({ width: 640, height: 480, text: false }));
    call(vga, 7, 0, 100, 200);
    call(vga, 8, 0, 50, 60);
    vga.move(0, 0.99);
    expect(call(vga, 3)).toMatchObject({ cx: 100, dx: 60 });
    call(vga, 4, 0, 150, 55);
    expect(call(vga, 3)).toMatchObject({ cx: 150, dx: 55 });
    call(vga, 0x0b);
    call(vga, 7, 0, 0, 639);
    call(vga, 8, 0, 0, 479);
    vga.move(160 / 640, 65 / 480);
    // Eight mickeys to eight dots across, sixteen to eight down.
    expect(call(vga, 0x0b)).toMatchObject({ cx: 10, dx: 20 });
    expect(call(vga, 0x0b)).toMatchObject({ cx: 0, dx: 0 });
  });

  it('leaves the registers of a function it does not have', () => {
    expect(call(new MouseDriver(() => TEXT), 0x0c, 7, 8, 9)).toEqual({
      known: false,
      ax: 0x0c,
      bx: 7,
      cx: 8,
      dx: 9,
    });
  });
});

describe('INT 33h from a program', () => {
  it('answers Intr and asm alike, with the mouse the IDE moves', () => {
    vi.useFakeTimers();
    try {
      const machine = new Machine(
        new Compiler().compile(
          new Parser(
            new Lexer(
              new Stream(`program T; uses Crt, Dos; var R: Registers; X, Y, B: Word;
              begin R.AX := 0; Intr($33, R); WriteLn(R.AX = $FFFF, ' ', R.BX);
                Delay(10);
                R.AX := 3; Intr($33, R); WriteLn(R.CX, ',', R.DX, ' ', R.BX);
                asm mov ax, 3; int 33h; mov X, cx; mov Y, dx; mov B, bx end;
                WriteLn(X, ',', Y, ' ', B) end.`)
            )
          ).parse()
        )
      );
      machine.run();
      expect(machine.getState()).toBe(MachineState.SLEEPING);
      machine.getMouse().move(20.5 / 80, 5.5 / 25, 2);
      vi.setSystemTime(machine.getWakeTime());
      machine.wake();
      machine.run();
      expect(machine.getOutput()).toEqual(['TRUE 2', '160,40 2', '160,40 2']);
    } finally {
      vi.useRealTimers();
    }
  });
});
