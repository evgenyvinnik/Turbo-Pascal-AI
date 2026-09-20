import { describe, expect, it } from 'vitest';
import { compileProject } from '../../src/compiler/project';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { SourceDebugger } from '../../src/compiler/runtime/SourceDebugger';

describe('workspace compilation', () => {
  it('compiles a standalone unit with dependencies and retains source diagnostics', () => {
    const source = 'unit Values; interface uses Base; const Value=Base.Number; implementation end.';
    const { tree, bytecode } = compileProject(source, 'LIB/VALUES.PAS', {
      sources: { 'LIB/BASE.PAS': 'unit Base; interface const Number=42; implementation end.' },
    });
    expect(tree.type).toBe('unit');
    expect(bytecode.sources['LIB/BASE.PAS']).toContain('Number=42');
    expect(() => compileProject('unit Broken; interface var n:Missing; implementation end.', 'BROKEN.PAS'))
      .toThrow(expect.objectContaining({ sourceFile: 'BROKEN.PAS' }));
  });
  it('resolves configured unit/include directories and conditional defines from an immutable source snapshot', () => {
    const { bytecode } = compileProject('program Main; uses Values; begin WriteLn(Value); end.', 'MAIN.PAS', {
      sources: {
        'LIB/VALUES.PAS': 'unit Values; interface {$I value.inc} implementation end.',
        'INC/VALUE.INC': '{$IFDEF CUSTOM}const Value=42;{$ELSE}const Value=0;{$ENDIF}',
      }, unitDirectories: ['LIB'], includeDirectories: ['INC'], defines: ['CUSTOM'],
    });
    const machine = new Machine(bytecode);
    machine.run();
    expect(machine.getOutput()).toEqual(['42']);
    expect(Object.keys(bytecode.sources).sort()).toEqual(['INC/VALUE.INC', 'LIB/VALUES.PAS', 'MAIN.PAS']);
  });
  it('reports parsing errors in included files using original filenames and lines', () => {
    expect(() => compileProject('program Main;\n{$I invalid.inc}\nbegin end.', 'MAIN.PAS', {
      sources: { 'INVALID.INC': '\nvar X Integer;' },
    })).toThrow(expect.objectContaining({ lineNumber: 2, sourceFile: 'INVALID.INC' }));
  });
  it('reports runtime errors in a unit rather than attributing them to the main file', () => {
    const { bytecode } = compileProject('program Main; uses Broken; begin Run; end.', 'MAIN.PAS', {
      sources: { 'BROKEN.PAS': 'unit Broken;\ninterface\nprocedure Run;\nimplementation\nprocedure Run;\nvar x:Integer;\nbegin\nx:=0;\nx:=10 div x;\nend;\nend.' },
    });
    expect(() => new Machine(bytecode).run()).toThrow(expect.objectContaining({ lineNumber: 9, sourceFile: 'BROKEN.PAS' }));
  });
  it('distinguishes same-line breakpoints in different units and exposes the actual frame file', () => {
    const { bytecode } = compileProject('program Main;\nuses One,Two;\nbegin One.Run;Two.Run;end.', 'MAIN.PAS', {
      sources: Object.fromEntries(['One', 'Two'].map(name => [name + '.pas', `unit ${name};\ninterface procedure Run;\nimplementation procedure Run;\nbegin WriteLn('${name}');end;\nend.`])),
    });
    const machine = new Machine(bytecode);
    machine.reset();
    const debuggerSession = new SourceDebugger(machine, bytecode);
    debuggerSession.setBreakpoints(() => [{ file: 'C:\\TWO.PAS', line: 4, enabled: true }]);
    debuggerSession.command('run');
    debuggerSession.runSlice();
    expect(debuggerSession.isPaused()).toBe(true);
    expect(machine.getOutput()).toEqual(['One']);
    expect(debuggerSession.getFile()).toBe('TWO.PAS');
    expect(debuggerSession.frames()[0]?.file).toBe('TWO.PAS');
    debuggerSession.setBreakpoints(() => []);
    debuggerSession.command('run');
    debuggerSession.runSlice();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['One', 'Two']);
  });
});
