import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { roundReal48, realOperation } from '../../src/compiler/codegen/numeric';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string, input: string[] = []) {
  const machine = new Machine(compile(source));
  machine.setInput(input);
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('Turbo Pascal numeric representation', () => {
  it('selects the smallest literal type and folds integer constants before selecting their result type', () => {
    expect(
      execute(`program T; const C=30000+30000;
      begin WriteLn(SizeOf(127), ',', SizeOf(128), ',', SizeOf(255), ',', SizeOf(256), ',',
        SizeOf(32768), ',', SizeOf(65536), ',', SizeOf(-128), ',', SizeOf(-129), ',',
        SizeOf(-32768), ',', SizeOf(-32769));
        WriteLn(C, ',', 30000+30000, ',', -2147483648)
      end.`)
    ).toEqual(['1,1,1,2,2,4,1,2,2,4', '60000,60000,-2147483648']);
    expect(() => compile('program T;begin WriteLn(2147483648)end.')).toThrow(
      /Integer constant out of range/
    );
    expect(() => compile('program T;const C=2147483647+1;begin end.')).toThrow(
      /Arithmetic overflow/
    );
    expect(() => compile('program T;begin WriteLn(1 div 0)end.')).toThrow(/Division by zero/);
  });

  it('keeps subrange declarations valid when their bounds select different literal types', () => {
    expect(
      execute(`program T;type Small=1..200;Signed=-10..200;Wide=1..40000;
      var a:array[1..200]of Byte;
      begin a[200]:=9;WriteLn(SizeOf(Small), ',', SizeOf(Signed), ',', SizeOf(Wide), ',', a[200]);
        WriteLn($FFFFFFFF, ',', $80000000, ',', $FFFF)
      end.`)
    ).toEqual(['1,2,2,9', '-1,-2147483648,65535']);
  });

  it('promotes byte arithmetic and combines the full operand ranges before choosing Integer or LongInt', () => {
    expect(
      execute(`program T;var i:Integer; w:Word; b:Byte; s:ShortInt; result:LongInt;
      begin i:=30000;w:=40000;b:=200;s:=-100;result:=i+i;
        WriteLn(result, ',', LongInt(i)+i, ',', i+w, ',', b+b, ',', s+s);
        WriteLn(SizeOf(i+w), ',', SizeOf(i+b), ',', SizeOf(b+b))
      end.`)
    ).toEqual(['-5536,60000,70000,400,-200', '4,2,2']);
  });

  it('preserves exact low multiplication bits and wraps unchecked LongInt and Word results', () => {
    expect(
      execute(`program T;var l:LongInt;w:Word;
      begin l:=2147483647;w:=40000;
        WriteLn(l*l, ',', l+1, ',', w+w, ',', Integer(w), ',', Word(-1))
      end.`)
    ).toEqual(['1,-2147483648,14464,-25536,65535']);
  });

  it('uses operand widths for NOT, logical SHR and bitwise combinations', () => {
    expect(
      execute(`program T;var i:Integer;b:Byte;l:LongInt;
      begin i:=-1;b:=15;l:=-1;WriteLn(not b, ',', i shr 1, ',', l shr 1, ',', i shl 1)
      end.`)
    ).toEqual(['240,32767,2147483647,-2']);
  });

  it('honors same-line Q switches and reports checked arithmetic at the expression line', () => {
    const machine = new Machine(
      compile(`program T;var i:Integer;
      begin i:=32767; {$Q-} WriteLn(i+1); {$Q+} WriteLn(i+1)
      end.`)
    );
    expect(() => machine.run()).toThrowError(
      expect.objectContaining({ message: 'Arithmetic overflow', lineNumber: 2 })
    );
    expect(machine.getOutput()).toEqual(['-32768']);
    expect(
      execute(`program T;var i:Integer;
      begin i:=32767; {$Q+} WriteLn(LongInt(i)+1); {$Q-} WriteLn(i+1)end.`)
    ).toEqual(['32768', '-32768']);
    expect(() => execute('{$R+}program T;var b:Byte;begin b:=256 end.')).toThrow(/Range check/);
  });

  it('applies integer expression width to math intrinsics and LongInt results to Trunc and Round', () => {
    expect(
      execute(`program T;var i:Integer;l:LongInt;
      begin i:=30000;l:=2147483647;WriteLn(Sqr(i), ',', Sqr(l), ',', Trunc(40000.9), ',', SizeOf(Trunc(1.0)))
      end.`)
    ).toEqual(['-5888,1,40000,4']);
    expect(() =>
      execute('program T;var i:Integer;begin i:=30000;{$Q+}WriteLn(Sqr(i))end.')
    ).toThrow(/Arithmetic overflow/);
  });

  it('rounds every Real operation before later cancellation and rounds native function results', () => {
    expect(
      execute(`program T;var r:Real;
      begin r:=1; WriteLn((r + 1.0/2199023255552.0)-r = 0);
        WriteLn((r + 1.0/1099511627776.0)-r = 1.0/549755813888.0);
        WriteLn(Sqrt(2)=1.4142135623730951)
      end.`)
    ).toEqual(['TRUE', 'TRUE', 'TRUE']);
  });

  it('quantizes Real literals and input while preserving six-byte storage size', () => {
    expect(
      execute(
        `program T;var r:Real;
      begin ReadLn(r);WriteLn(r=1, ',', SizeOf(r), ',', 1.0000000000001=1)
      end.`,
        ['1.0000000000001']
      )
    ).toEqual(['TRUE,6,TRUE']);
  });

  it('rounds products once from the exact significands at a double-rounding boundary', () => {
    const a = 1079555828497 / 2 ** 39;
    const b = 1062178900779 / 2 ** 39;
    const correct = 1042900679060 / 2 ** 38;
    expect(realOperation('*', a, b)).toBe(correct);
    expect(roundReal48(a * b)).not.toBe(correct);
  });

  it('uses the Real48 exponent limits, underflow and mantissa rounding', () => {
    expect(roundReal48(2 ** -128)).toBe(2 ** -128);
    expect(roundReal48(2 ** -129)).toBe(0);
    expect(roundReal48(-(2 ** -129))).toBe(0);
    expect(roundReal48(1 + 2 ** -41)).toBe(1);
    expect(roundReal48(1 + 2 ** -40)).toBe(1 + 2 ** -39);
    expect(roundReal48(-(1 + 2 ** -40))).toBe(-(1 + 2 ** -39));
    const maximum = (2 - 2 ** -39) * 2 ** 126;
    expect(roundReal48(maximum)).toBe(maximum);
    expect(() => roundReal48(2 ** 127)).toThrow(/Real overflow/);
    expect(() => compile('program T;var r:Real;begin r:=1e40 end.')).toThrow(/Real overflow/);
    expect(execute('program T;var r:Real;begin r:=1e-30;WriteLn(r*r=0)end.')).toEqual(['TRUE']);
  });
});
