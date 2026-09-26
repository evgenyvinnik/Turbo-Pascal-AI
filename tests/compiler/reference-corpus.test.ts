import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { PascalError } from '../../src/compiler/errors';
import { generatedCases, referenceCases } from '../reference/corpus';

describe('independent Pascal reference corpus', () => {
  it.each(referenceCases)('$name', ({ source, input, output, exitCode, reject, units }) => {
    const compile = () =>
      new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse(), {
        resolveUnit: (name) =>
          Object.entries(units ?? {}).find(
            ([key]) => key.toLowerCase() === name.toLowerCase()
          )?.[1],
      });
    if (reject) {
      expect(compile).toThrow(PascalError);
      return;
    }
    const machine = new Machine(compile(), { maxInstructions: 100_000 });
    machine.setInput(input ? input.replace(/\n$/, '').split('\n') : []);
    let failed = false;
    try {
      machine.run();
    } catch (error) {
      // Only a case expecting a nonzero exit may end in a run-time error.
      if (!exitCode) throw error;
      failed = true;
    }
    if (!failed) expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(output);
    expect(machine.getExitCode()).toBe(exitCode ?? 0);
  });

  it('keeps generated set coverage diverse, including overlapping and disjoint inputs', () => {
    const cardinalities = generatedCases().map((subject) => subject.output![2]!);
    const intersections = cardinalities.map((line) => Number(line.split(',')[1]));
    expect(new Set(cardinalities).size).toBeGreaterThan(8);
    expect(intersections.some((count) => count === 0)).toBe(true);
    expect(intersections.some((count) => count > 0)).toBe(true);
  });
});
