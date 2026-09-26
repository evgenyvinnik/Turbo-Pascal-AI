import { describe, expect, it } from 'vitest';
import { errorWith } from './matchers';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { roundReal48, realOperation, formatReal } from '../../src/compiler/codegen/numeric';
import {
  Float80,
  compReal,
  decodeExtended,
  encodeExtended,
  extendedOperation,
  parseReal,
  sqrtReal,
} from '../../src/compiler/codegen/float80';

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
    expect(() => {
      machine.run();
    }).toThrowError(errorWith({ message: 'Arithmetic overflow', lineNumber: 2 }));
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

  it('holds Extended in 64 significant bits and Comp as a 64-bit integer', () => {
    expect(
      execute(`{$N+} program T;var a,b,c:Comp;e:Extended;d:Double;i:Integer;
      begin a:=0;b:=1;for i:=1 to 90 do begin c:=a+b;a:=b;b:=c end;WriteLn(a:0:0,' ',a);
        c:=9007199254740993.0;c:=c+1;WriteLn(c:0:0,' ',SizeOf(c));
        e:=9007199254740992.0;e:=e+1;d:=e;WriteLn(e:0:0,' ',d:0:0,' ',SizeOf(e));
        e:=1e4000;WriteLn(e)
      end.`)
    ).toEqual([
      '2880067194370816120  2.88006719437082E+0018',
      '9007199254740994 8',
      '9007199254740993 9007199254740992 10',
      ' 1.00000000000000E+4000',
    ]);
    expect(() => execute('{$N+} program T;var c:Comp;e:Extended;begin e:=1e19;c:=e end.')).toThrow(
      /Invalid numeric result/
    );
  });

  it('keeps Extended results exact and rounds them only where they are stored in a Double', () => {
    expect(
      execute(`{$N+} program T;const K=1/3;var e:Extended;d:Double;a,b:Integer;
      procedure P(v:Double);begin Write(v:0:18,' ') end;
      begin a:=1;b:=3;e:=a/b;d:=a/b;WriteLn(e:0:18,' ',d:0:18,' ',a/b:0:18);
        d:=K;P(K);e:=K;WriteLn(d:0:18,' ',e:0:18,' ',e*3=1);
        d:=0.1;e:=0.1;WriteLn(d=0.1,' ',e=0.1,' ',d:0:18,' ',e:0:18);
        e:=Pi;d:=Pi;WriteLn(Pi:0:18,' ',d:0:18,' ',e=Pi,' ',d=Pi);
        e:=Sqrt(2.0);d:=Sqrt(2);WriteLn(e:0:18,' ',Sqrt(d*d)=d)
      end.`)
    ).toEqual([
      '0.333333333333333333 0.333333333333333315 0.333333333333333333',
      '0.333333333333333315 0.333333333333333315 0.333333333333333333 TRUE',
      'FALSE TRUE 0.100000000000000006 0.100000000000000000',
      '3.141592653589793240 3.141592653589793120 TRUE FALSE',
      '1.414213562373095050 TRUE',
    ]);
  });

  it('reads, converts and stores Extended and Comp without passing through a double', () => {
    expect(
      execute(
        `{$N+} program T;var e,g:Extended;c,h:Comp;code:Integer;f:file of Extended;fc:file of Comp;
          x:array[0..9]of Byte;i:Integer;
        begin Val('123456789012345678',c,code);WriteLn(c-123456789012345600.0:0:0,' ',code);
          ReadLn(c);WriteLn(c-9223372036854775800.0:0:0);ReadLn(e);WriteLn(e=0.1);
          e:=1;e:=e/3;Assign(f,'E.DAT');Rewrite(f);Write(f,e);Close(f);Reset(f);Read(f,g);Close(f);Erase(f);
          c:=1234567890123456789.0;Assign(fc,'C.DAT');Rewrite(fc);Write(fc,c);Close(fc);
          Reset(fc);Read(fc,h);Close(fc);Erase(fc);WriteLn(g=e,' ',h-c:0:0);
          e:=1;Move(e,x,10);for i:=0 to 9 do Write(x[i],' ');WriteLn
        end.`,
        ['9223372036854775807', '0.1']
      )
    ).toEqual(['78 0', '7', 'TRUE', 'TRUE 0', '0 0 0 0 0 0 0 128 255 63 ']);
  });

  it('rounds the 8087 operations and conversions once, the nearest and a half to even', () => {
    const third = extendedOperation('/', 1, 3) as Float80;
    expect(third.significand).toBe(0xaaaaaaaaaaaaaaabn);
    expect(third.exponent).toBe(-65);
    expect(extendedOperation('*', third, 3)).toBe(1);
    expect(extendedOperation('+', 2 ** 63, 1)).toBeInstanceOf(Float80);
    expect(extendedOperation('+', 2 ** 64, 1)).toBe(2 ** 64);
    expect((extendedOperation('+', 2 ** 64, 3) as Float80).significand).toBe(2n ** 63n + 2n);
    expect((sqrtReal(2) as Float80).significand).toBe(0xb504f333f9de6484n);
    expect([compReal(2.5), compReal(3.5), compReal(-2.5)]).toEqual([2, 4, -2]);
    expect(Array.from(encodeExtended(parseReal('0.1') ?? 0))).toEqual([
      0xcd, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xfb, 0x3f,
    ]);
    expect(decodeExtended(encodeExtended(third))).toEqual(third);
    expect(() => parseReal('1e5000')).toThrow(/Real overflow/);
  });
});
