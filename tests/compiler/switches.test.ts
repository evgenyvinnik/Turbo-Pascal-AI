import { expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser, type ParserOptions } from '../../src/compiler/parser';
import { Machine } from '../../src/compiler/runtime/Machine';

function run(source: string, options?: ParserOptions) {
  const machine = new Machine(new Compiler().compile(new Parser(new Lexer(new Stream(source)), options).parse()));
  machine.run();
  return machine.getOutput();
}
it('enables ordinal range checks from IDE defaults and honors source override', () => {
  const source = 'program P;var n:Integer;b:Byte;begin n:=256;b:=n;WriteLn(b)end.';
  expect(() => run(source, { rangeChecking: true })).toThrow('Range check error');
  expect(run('{$R-}' + source, { rangeChecking: true })).toEqual(['0']);
});
it('enables array bounds checks independently of ordinal storage wrapping', () => {
  expect(() => run('{$R+}program P;var a:array[1..2]of Integer;i:Integer;begin i:=3;WriteLn(a[i])end.')).toThrow('out of bounds');
});
it('uses the switch at the operator even if a following comment changes it before the semicolon', () => {
  expect(run('{$B+}program P;var n:Integer;b:Boolean;function Touch:Boolean;begin Inc(n);Touch:=True end;begin n:=0;b:=False and Touch {$B-};WriteLn(n)end.')).toEqual(['1']);
});
it('short circuits invalid dereferences without skipping compile-time type checking', () => {
  expect(run('program P;type PInteger=^Integer;var p:PInteger;begin p:=nil;WriteLn((p<>nil)and(p^=1))end.')).toEqual(['FALSE']);
  expect(() => run('program P;var b:Boolean;begin b:=False and 123 end.')).toThrow();
});
