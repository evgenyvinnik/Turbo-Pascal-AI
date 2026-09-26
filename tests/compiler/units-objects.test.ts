import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { PascalError } from '../../src/compiler/errors';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { SourceDebugger } from '../../src/compiler/runtime/SourceDebugger';
import { compileProject } from '../../src/compiler/project';

function compile(source: string, units: Record<string, string> = {}) {
  return new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse(), {
    resolveUnit: (name) =>
      Object.entries(units).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1],
  });
}
function execute(source: string, units?: Record<string, string>) {
  const machine = new Machine(compile(source, units), { maxInstructions: 100_000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('unit and object boundary checks', () => {
  it('rejects interface dependency cycles with a Pascal diagnostic', () => {
    expect(() =>
      compile('program Corpus;uses A;begin end.', {
        A: 'unit A;interface uses B;implementation end.',
        B: 'unit B;interface uses A;implementation end.',
      })
    ).toThrow(/Circular unit interface dependency/);
  });
  it('checks requested unit names against source headers', () => {
    expect(() =>
      compile('program Corpus;uses A;begin end.', { A: 'unit B;interface implementation end.' })
    ).toThrow(/does not match/);
  });
  it('does not expose program globals to unit implementations', () => {
    expect(() =>
      compile('program Corpus;uses A;var secret:Integer;begin Run end.', {
        A: 'unit A;interface procedure Run;implementation procedure Run;begin secret:=1 end;end.',
      })
    ).toThrow(/Undeclared identifier/);
  });
  it('checks unit interface signatures against implementation headers', () => {
    expect(() =>
      compile('program Corpus;uses A;begin Run(1) end.', {
        A: 'unit A;interface procedure Run(n:Integer);implementation procedure Run(n:Char);begin end;end.',
      })
    ).toThrow(/parameter mismatch/);
  });
  it('isolates private fields and methods at the defining unit boundary', () => {
    const units = {
      Items: `unit Items;interface type TItem=object private n:Integer;procedure Hidden; public constructor Init;function Get:Integer;end;
      implementation procedure TItem.Hidden;begin n:=7 end;constructor TItem.Init;begin Hidden end;function TItem.Get:Integer;begin Get:=n end;end.`,
    };
    expect(
      execute(
        'program Corpus;uses Items;var item:TItem;begin item.Init;WriteLn(item.Get)end.',
        units
      )
    ).toEqual(['7']);
    expect(() =>
      compile('program Corpus;uses Items;var item:TItem;begin WriteLn(item.n)end.', units)
    ).toThrow(/Private object member/);
    expect(() =>
      compile('program Corpus;uses Items;var item:TItem;begin item.Hidden end.', units)
    ).toThrow(/Private object method/);
  });
  it('resolves methods as well as fields through WITH', () => {
    expect(
      execute(`program Corpus;type TItem=object n:Integer;procedure Bump;function Get:Integer;end;var item:TItem;
      procedure TItem.Bump;begin Inc(n)end;function TItem.Get:Integer;begin Get:=n end;
      begin with item do begin n:=3;Bump;WriteLn(Get)end end.`)
    ).toEqual(['4']);
  });
  it('requires constructor initialization before virtual calls', () => {
    expect(() =>
      execute(`program Corpus;type TItem=object procedure Run;virtual;end;var item:TItem;
      procedure TItem.Run;begin WriteLn('bad')end;begin item.Run end.`)
    ).toThrow(/Object not initialized/);
  });
  it('rejects constructor/destructor kind mismatches', () => {
    expect(() =>
      compile(`program Corpus;type TItem=object constructor Init;end;
      procedure TItem.Init;begin end;begin end.`)
    ).toThrow(/Routine kind/);
  });
  it('counts the VMT pointer only for virtual object byte sizes', () => {
    expect(
      execute(`program Corpus;type A=object x:Integer;end;B=object(A)y:Integer;end;
      C=object(A)procedure Run;virtual;end;
      procedure C.Run;begin end;
      begin WriteLn(SizeOf(A),',',SizeOf(B),',',SizeOf(C))end.`)
    ).toEqual(['2,4,4']);
  });
  it('keeps unit runtime diagnostics tied to the unit source file', () => {
    const source = 'program Corpus;uses Broken;begin Run end.';
    const { bytecode } = compileProject(source, 'MAIN.PAS', {
      sources: {
        'BROKEN.PAS':
          'unit Broken;\ninterface procedure Run;\nimplementation\nprocedure Run;\nvar zero:Integer;\nbegin zero:=0;WriteLn(1 div zero)end;\nend.',
      },
    });
    const machine = new Machine(bytecode);
    try {
      machine.run();
      expect.fail('Expected division failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PascalError);
      expect(error).toMatchObject({ sourceFile: 'BROKEN.PAS', lineNumber: 6 });
    }
    expect(Object.values(bytecode.sourceFiles)).toContain('MAIN.PAS');
    expect(Object.values(bytecode.sourceFiles)).toContain('BROKEN.PAS');
  });
  it('produces Pascal diagnostics for invalid unit syntax', () => {
    expect(() =>
      new Parser(
        new Lexer(new Stream('unit A;interface implementation begin end. junk'))
      ).parseUnit()
    ).toThrow(PascalError);
  });
  it('keeps assignment from initializing a virtual object, as required by the TP7 Language Guide', () => {
    expect(() =>
      execute(`program Corpus;type TItem=object constructor Init;procedure Run;virtual;end;var a,b:TItem;
      constructor TItem.Init;begin end;procedure TItem.Run;begin end;
      begin a.Init;b:=a;b.Run end.`)
    ).toThrow(/Object not initialized/);
  });
  it('preserves the destination VMT when assigning through an ancestor type', () => {
    expect(
      execute(`program Corpus;type TBase=object n:Integer;constructor Init;function Get:Integer;virtual;end;
      TChild=object(TBase)function Get:Integer;virtual;end;var a:TBase;b:TChild;
      constructor TBase.Init;begin n:=3 end;function TBase.Get:Integer;begin Get:=n end;
      function TChild.Get:Integer;begin Get:=n+10 end;
      begin a.Init;b.Init;a:=b;WriteLn(a.Get,',',b.Get)end.`)
    ).toEqual(['3,13']);
  });
  it('dispatches dynamic methods by inherited declarations and validates their indexes', () => {
    expect(
      execute(`program Corpus;type TBase=object constructor Init;function Get:Integer;virtual 100;end;
      TChild=object(TBase)function Get:Integer;virtual 100;end;PBase=^TBase;var item:TChild;p:PBase;
      constructor TBase.Init;begin end;function TBase.Get:Integer;begin Get:=3 end;
      function TChild.Get:Integer;begin Get:=inherited Get+4 end;
      begin item.Init;p:=@item;WriteLn(p^.Get)end.`)
    ).toEqual(['7']);
    expect(() =>
      compile(
        `program Corpus;type TItem=object procedure A;virtual 10;procedure B;virtual 10;end;begin end.`
      )
    ).toThrow(/Duplicate dynamic/);
  });
  it('rejects object field names redeclared by method parameters', () => {
    expect(() =>
      compile(`program Corpus;type TItem=object n:Integer;procedure SetValue(n:Integer);end;
      procedure TItem.SetValue(n:Integer);begin end;begin end.`)
    ).toThrow(/Duplicate object member/);
  });
  it('rejects near routine values and nil procedural calls', () => {
    expect(() =>
      compile(`program Corpus;type TProc=procedure;var callback:TProc;
      procedure Run;begin end;begin callback:=Run end.`)
    ).toThrow(/FAR/);
    expect(() =>
      execute(`program Corpus;type TProc=procedure;var callback:TProc;
      begin callback:=nil;callback end.`)
    ).toThrow(/Nil or invalid procedural/);
  });
  it('rejects Fail outside a constructor and preserves static failure results', () => {
    expect(() => compile('program Corpus;begin Fail end.')).toThrow(/constructor/);
    expect(
      execute(`program Corpus;type TItem=object constructor Init;end;var item:TItem;
      constructor TItem.Init;begin Fail;WriteLn('unreachable')end;
      begin WriteLn(item.Init);WriteLn('after')end.`)
    ).toEqual(['FALSE', 'after']);
  });
  it('compiles standalone unit interfaces and implementations without needing a main program', () => {
    const tree = new Parser(
      new Lexer(
        new Stream(
          `unit Values;interface function Get:Integer;implementation function Get;begin Get:=7 end;end.`
        )
      )
    ).parseUnit();
    const bytecode = new Compiler().compile(tree);
    expect(bytecode.debugScopes.some((scope) => scope.name === 'Values')).toBe(true);
    expect(() =>
      new Compiler().compile(
        new Parser(
          new Lexer(new Stream(`unit Values;interface procedure Missing;implementation end.`))
        ).parseUnit()
      )
    ).toThrow(/Unresolved forward/);
  });
  it('resolves private unit globals and constants while paused in an exported routine', () => {
    const { bytecode } = compileProject('program Corpus;uses Values;begin Run end.', 'MAIN.PAS', {
      sources: {
        'VALUES.PAS':
          'unit Values;\ninterface procedure Run;\nimplementation\nconst SecretConstant=9;\nvar Secret:Integer;\nprocedure Run;\nbegin\nWriteLn(Secret+SecretConstant)\nend;\nbegin Secret:=7 end.',
      },
    });
    const machine = new Machine(bytecode),
      debuggerSession = new SourceDebugger(machine, bytecode);
    debuggerSession.setBreakpoints(() => [{ file: 'VALUES.PAS', line: 8, enabled: true }]);
    debuggerSession.command('run');
    debuggerSession.runSlice();
    expect(debuggerSession.isPaused()).toBe(true);
    expect(debuggerSession.evaluate('Secret').value).toBe(7);
    expect(debuggerSession.evaluate('SecretConstant').value).toBe(9);
  });
  it('captures FAR mode at the routine header even when a later directive changes it', () => {
    expect(
      execute(`program Corpus;type TProc=procedure;var callback:TProc;{$F+}
      procedure Run;begin WriteLn('ok')end;{$F-}
      begin callback:=Run;callback end.`)
    ).toEqual(['ok']);
    expect(() =>
      compile(`program Corpus;type TProc=procedure;var callback:TProc;{$F-}
      procedure Run;{$F+}begin end;begin callback:=Run end.`)
    ).toThrow(/FAR/);
  });
  it('preserves nominal object identity through type aliases', () => {
    expect(
      execute(`program Corpus;type TItem=object n:Integer;constructor Init;function Get:Integer;virtual;end;
      TAlias=TItem;PItem=^TItem;var item:TAlias;p:PItem;
      constructor TItem.Init;begin n:=7 end;function TItem.Get:Integer;begin Get:=n end;
      begin item.Init;p:=@item;WriteLn(item.Get,',',p^.Get)end.`)
    ).toEqual(['7,7']);
  });
});
