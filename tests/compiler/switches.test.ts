import { expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser, type ParserOptions } from '../../src/compiler/parser';
import { Machine } from '../../src/compiler/runtime/Machine';

function run(source: string, options?: ParserOptions) {
  const machine = new Machine(
    new Compiler().compile(new Parser(new Lexer(new Stream(source)), options).parse())
  );
  machine.run();
  return machine.getOutput();
}
it('enables ordinal range checks from IDE defaults and honors source override', () => {
  const source = 'program P;var n:Integer;b:Byte;begin n:=256;b:=n;WriteLn(b)end.';
  expect(() => run(source, { rangeChecking: true })).toThrow('Range check error');
  expect(run('{$R-}' + source, { rangeChecking: true })).toEqual(['0']);
});
it('enables array bounds checks independently of ordinal storage wrapping', () => {
  expect(() =>
    run('{$R+}program P;var a:array[1..2]of Integer;i:Integer;begin i:=3;WriteLn(a[i])end.')
  ).toThrow('out of bounds');
});
it('uses the switch at the operator even if a following comment changes it before the semicolon', () => {
  expect(
    run(
      '{$B+}program P;var n:Integer;b:Boolean;function Touch:Boolean;begin Inc(n);Touch:=True end;begin n:=0;b:=False and Touch {$B-};WriteLn(n)end.'
    )
  ).toEqual(['1']);
});
it('short circuits invalid dereferences without skipping compile-time type checking', () => {
  expect(
    run(
      'program P;type PInteger=^Integer;var p:PInteger;begin p:=nil;WriteLn((p<>nil)and(p^=1))end.'
    )
  ).toEqual(['FALSE']);
  expect(() => run('program P;var b:Boolean;begin b:=False and 123 end.')).toThrow();
});

function outcome(source: string, options?: ParserOptions) {
  const bytecode = new Compiler().compile(
    new Parser(new Lexer(new Stream(source)), options).parse()
  );
  const machine = new Machine(bytecode);
  let error: (Error & { lineNumber?: number }) | undefined;
  try {
    machine.run();
  } catch (caught) {
    error = caught as Error;
  }
  return { output: machine.getOutput(), exitCode: machine.getExitCode(), error, bytecode };
}
const recursion = (switches: string, depth: number) =>
  `${switches} program R; var Depth: Integer;
  procedure Down(n: Integer); var pad: array[1..100] of Byte;
  begin Depth := n; pad[1] := 0; if n < ${String(depth)} then Down(n + 1) end;
  begin Down(1); WriteLn('reached ', Depth) end.`;

it('checks under {$S+} that each routine fits the stack {$M} gives, with error 202', () => {
  // About 110 bytes a call: 100 fit the default 16384 bytes, 1000 do not.
  expect(outcome(recursion('', 100)).output).toEqual(['reached 100']);
  expect(outcome(recursion('', 1000))).toMatchObject({ exitCode: 202, output: [] });
  expect(outcome(recursion('{$M 1024,0,655360}', 100)).exitCode).toBe(202);
  expect(outcome(recursion('{$S-}', 1000)).output).toEqual(['reached 1000']);
  expect(outcome(recursion('', 1000), { stackChecking: false }).output).toEqual(['reached 1000']);
});

it('starts SP at the top of the {$M} stack and bounds the heap by its high limit', () => {
  expect(
    outcome(`{$M 8192,0,100000} program M; begin WriteLn(SPtr <= 8192, ' ', MemAvail) end.`).output
  ).toEqual(['TRUE 100000']);
  expect(
    outcome('program M; begin WriteLn(SPtr <= 16384, SPtr > 16000) end.', {
      memorySizes: { stack: 32768, heapMin: 0, heapMax: 655360 },
    }).output
    // The IDE's 32768 bytes: SP starts past 16384.
  ).toEqual(['FALSETRUE']);
  expect(() => outcome('{$M 100,0,655360} program M; begin end.')).toThrow(
    'Invalid compiler directive'
  );
});

it('keeps no line numbers under {$D-}, so a run-time error is found by address alone', () => {
  const source = 'program D; var z: Integer;\nbegin\n  z := 0;\n  WriteLn(1 div z)\nend.';
  expect(outcome(source).error?.lineNumber).toBe(4);
  const lineless = outcome('{$D-}' + source);
  expect(lineless).toMatchObject({ exitCode: 200 });
  expect(lineless.error?.lineNumber).toBe(-1);
  expect(Object.keys(lineless.bytecode.sourceLines)).toEqual([]);
  expect(outcome(source, { debugInfo: false }).error?.lineNumber).toBe(-1);
});

it("keeps no names for routines' locals under {$L-}", () => {
  const names = (source: string) =>
    outcome(source)
      .bytecode.debugScopes.filter((scope) => scope.name === 'P')
      .map((scope) => scope.variables.map((variable) => variable.name));
  const source =
    'program L; var Global: Integer; procedure P; var Secret: Integer; begin Secret := 1 end; begin P end.';
  expect(names(source)).toEqual([['Secret']]);
  expect(names('{$L-}' + source)).toEqual([[]]);
});
