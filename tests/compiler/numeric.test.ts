import { describe, expect, it } from 'vitest';
import { errorWith } from './matchers';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { roundReal48, realOperation, formatReal } from '../../src/compiler/codegen/numeric';

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
    expect(() => { machine.run(); }).toThrowError(
      errorWith({ message: 'Arithmetic overflow', lineNumber: 2 })
    );
    expect(machine.getOutput()).toEqual(['-32768']);
    expect(
      execute(`program T;var i:Integer;
      begin i:=32767; {$Q+} WriteLn(LongInt(i)+1); {$Q-} WriteLn(i+1)end.`)
    ).toEqual(['32768', '-32768']);
    expect(() => execute('{$R+}program T;var b:Byte;begin b:=256 end.')).toThrow(
      /Constant out of range/
    );
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

  it('computes every real expression in Extended under {$N+}, rounding only stores to Real', () => {
    // 2^-45 is a quarter of a Real48 unit at 0.1: lost by 48-bit arithmetic
    // and by a store to Real, but kept by the 8087.
    const program = `program T;var r,s:Real;
      begin r:=0.1; s:=r+1.0/35184372088832.0;
        WriteLn(r=0.1, ',', s=r, ',', r+1.0/35184372088832.0=r)
      end.`;
    expect(execute(program)).toEqual(['TRUE,TRUE,TRUE']);
    expect(execute(`{$N+} ${program}`)).toEqual(['FALSE,TRUE,FALSE']);
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

  it('writes reals in Turbo Pascal floating-point and fixed-point forms', () => {
    expect(
      execute(`program T;var s:string;
      begin WriteLn(1.5); WriteLn(-1.5); WriteLn(0.0); WriteLn(Pi); WriteLn(0.1);
        WriteLn(1.5:20, '|', 1.5:10, '|', 1.5:1, '|', 1.5:12:-1);
        WriteLn(123.456:0:2, '|', -0.5:0:0, '|', 0.4:0:0, '|', 2.5:0:0, '|', 9.99:6:1);
        WriteLn(0.1:0:15, '|', 1e15:0:1, '|', -0.001:0:2, '|', 0.00123:0:5);
        Str(1.5, s); WriteLn('[', s, ']'); Str(-2.5:0:1, s); WriteLn('[', s, ']')
      end.`)
    ).toEqual([
      ' 1.5000000000E+00',
      '-1.5000000000E+00',
      ' 0.0000000000E+00',
      ' 3.1415926536E+00',
      ' 1.0000000000E-01',
      '    1.5000000000E+00| 1.500E+00| 1.5E+00| 1.50000E+00',
      '123.46|-1|0|3|  10.0',
      '0.10000000000|1000000000000000.0|-0.00|0.00123',
      '[ 1.5000000000E+00]',
      '[-2.5]',
    ]);
  });

  it('writes 8087 reals with a four-digit exponent and up to eighteen digits', () => {
    expect(
      execute(`program T;var d:Double; r:Real;
      begin d:=1.5; WriteLn(d); d:=-2.25e-5; WriteLn(d, '|', d:12);
        d:=0.1; WriteLn(d:0:20, '|', d:30); r:=1.5; WriteLn(r)
      end.`)
    ).toEqual([
      ' 1.50000000000000E+0000',
      '-2.25000000000000E-0005|-2.250E-0005',
      '0.100000000000000006|     1.00000000000000006E-0001',
      ' 1.50000000000000E+0000',
    ]);
    // Twelve digits are taken from a Real and eleven kept, so the rounding
    // digit comes from the value itself; the 8087 rounds eighteen digits first.
    expect(formatReal(roundReal48(9.99999999999), 17, -1, false)).toBe(' 1.0000000000E+01');
    expect(formatReal(1e300, 23, -1, true)).toBe(' 1.00000000000000E+0300');
    expect(formatReal(0.006, 0, 2, false)).toBe('0.01');
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
