import { describe, expect, it } from 'vitest';
import { errorWith } from './matchers';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const machineFor = (source: string) => new Machine(
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()),
  { maxInstructions: 10_000 },
);

describe('runtime numeric boundaries', () => {
  it('distinguishes Random from Random(0) and returns integers below the bound', () => {
    const machine = machineFor(`program T; var i, n: Integer; r: Real;
      begin
        r := Random;
        WriteLn((r >= 0) and (r < 1), ',', Random(0));
        for i := 1 to 100 do begin
          n := Random(7);
          if (n < 0) or (n >= 7) or (Frac(n) <> 0) then WriteLn('invalid')
        end
      end.`);
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['TRUE,0']);
  });

  it('reports real arithmetic overflow at its source line', () => {
    const machine = machineFor('program T; var x: Real;\nbegin\n  x := 1e30;\n  WriteLn(x * x)\nend.');
    expect(() => { machine.run(); }).toThrowError(errorWith({
      message: 'Real overflow', lineNumber: 4,
    }));
    expect(machine.getState()).toBe(MachineState.ERROR);
    expect(machine.getOutput()).toEqual([]);
  });
});
