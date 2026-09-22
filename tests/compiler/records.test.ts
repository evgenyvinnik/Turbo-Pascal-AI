import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string): string[] {
  const machine = new Machine(compile(source), { maxInstructions: 100_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('Variant records', () => {
  it('packs fields as Turbo Pascal does, with each variant part as large as its largest case', () => {
    expect(
      execute(`program T;
      type Node = record
          Id: Integer;
          case Leaf: Boolean of
            True: (Value: LongInt);
            False: (case Wide: Boolean of True: (Left, Right: Integer); False: (Only: Integer))
        end;
        Untagged = record case Byte of 0: (B: Byte); 1: (S: string[5]) end;
      begin WriteLn(SizeOf(Node), ' ', SizeOf(Untagged)) end.`)
    ).toEqual(['8 6']);
  });

  it('starts every case at zero, as the first case sees it', () => {
    expect(
      execute(`program T; type PR = ^TR; TR = record case B: Boolean of True: (I: Integer); False: (S: string[3]) end;
      var p: PR; r: TR;
      begin New(p); WriteLn(p^.I, ' ', r.I, ' ', Ord(r.B)); Dispose(p) end.`)
    ).toEqual(['0 0 0']);
  });

  it('requires tags of an ordinal type and labels that fit them', () => {
    expect(() => compile('program T; type R = record case Real of 1: (A: Integer) end; begin end.')).toThrow(
      /Variant tag must have an ordinal type/
    );
    expect(() =>
      compile("program T; type R = record case Boolean of 'x': (A: Integer) end; begin end.")
    ).toThrow(/Type mismatch/);
  });

  it('lets a typed constant skip only the fields of other cases', () => {
    expect(() =>
      compile(`program T; type R = record X: Integer; case T: Boolean of True: (A: Integer); False: (B: Integer) end;
      const C: R = (X: 1; B: 2); begin end.`)
    ).toThrow(/Record field "t" expected/);
    expect(
      execute(`program T; type R = record X: Integer; case T: Boolean of True: (A: Integer); False: (B, D: Integer) end;
      const C: R = (X: 1; T: False; B: 2; D: 3); begin WriteLn(C.X, C.B, C.D) end.`)
    ).toEqual(['123']);
  });
});
