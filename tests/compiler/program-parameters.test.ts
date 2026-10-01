import { describe, expect, it } from 'vitest';
import { compileProject } from '../../src/compiler/project';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { parseProgramParameters } from '../../src/components/IDE/programParameters';

describe('Program parameters', () => {
  it('groups quoted text and empty arguments while retaining DOS paths', () => {
    expect(parseProgramParameters('  alpha\t"two words" "" C:\\DATA\\A.PAS x" y"  ')).toEqual([
      'alpha',
      'two words',
      '',
      'C:\\DATA\\A.PAS',
      'x y',
    ]);
    expect(parseProgramParameters(' \t ')).toEqual([]);
    expect(parseProgramParameters('one "remaining text')).toEqual(['one', 'remaining text']);
  });

  it('exposes an immutable argument snapshot, the program name, and missing entries across resets', () => {
    const programArguments = ['alpha', 'two words', '', 'C:\\DATA\\A.PAS'];
    const machine = new Machine(
      compileProject(
        `program Demo; var I:Integer;
      begin WriteLn(ParamStr(0)); WriteLn(ParamCount);
        for I:=1 to ParamCount do WriteLn('[',ParamStr(I),']');
        WriteLn('[',ParamStr(-1),'] [',ParamStr(ParamCount+1),']') end.`,
        'DEMO.PAS'
      ).bytecode,
      { programArguments }
    );
    programArguments[0] = 'changed';
    programArguments.push('later');
    const expected = [
      'C:\\DEMO.EXE',
      '4',
      '[alpha]',
      '[two words]',
      '[]',
      '[C:\\DATA\\A.PAS]',
      '[] []',
    ];
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(expected);
    machine.reset();
    machine.run();
    expect(machine.getOutput()).toEqual(expected);
  });

  it('converts browser characters to Pascal CP437 bytes at the argument boundary', () => {
    const machine = new Machine(
      compileProject(
        `program Demo; var S:String;
      begin S:=ParamStr(1);WriteLn(S,',',Length(S),',',Ord(S[4])) end.`,
        'DEMO.PAS'
      ).bytecode,
      { programArguments: ['café'] }
    );
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['café,4,130']);
  });
});
