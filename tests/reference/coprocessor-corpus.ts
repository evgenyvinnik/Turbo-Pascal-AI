import type { ReferenceCase } from './corpus';

/** 8087 arithmetic. Turbo Pascal computes Single, Double and Extended, and
 * every real expression under {$N+}, at full precision; each case prints a
 * value that 48-bit Real arithmetic would get visibly wrong. */
export const coprocessorCases: ReferenceCase[] = [
  {
    name: 'double-literals-keep-full-precision',
    source: `program T; var d: Double;
begin d := 0.1; WriteLn(d = 0.1, ' ', d:0:15);
  d := d * 3; WriteLn(d = 0.3, ' ', d > 0.3, ' ', d:0:15) end.`,
    output: ['TRUE 0.100000000000000', 'FALSE TRUE 0.300000000000000'],
  },
  {
    name: 'double-division-of-integers',
    source: `program T; var d: Double; i, j: Integer;
begin i := 2; j := 3; d := i / j; WriteLn(d:0:15); WriteLn(1 / 3 * 3 = 1) end.`,
    output: ['0.666666666666667', 'TRUE'],
  },
  {
    name: 'double-accumulates-without-real48-rounding',
    source: `program T; var s: Double; i: Integer;
begin s := 0; for i := 1 to 1000 do s := s + 0.001; WriteLn(s:0:13) end.`,
    output: ['1.0000000000000'],
  },
  {
    name: 'double-constants-and-pi',
    source: `program T; const Third = 1 / 3; Tenth = -0.1; var d: Double;
begin d := Third; WriteLn(d:0:15, ' ', Tenth:0:15); WriteLn(Pi:0:15) end.`,
    output: ['0.333333333333333 -0.100000000000000', '3.141592653589793'],
  },
  {
    name: 'double-math-functions-and-sqr',
    source: `program T; var d: Double;
begin d := Sqrt(2); WriteLn(d:0:15, ' ', Sqr(d) > 2, ' ', Sqrt(d * d) = d);
  WriteLn(Sqr(0.1 + d - d):0:17, ' ', Abs(-d):0:15) end.`,
    output: ['1.414213562373095 TRUE TRUE', '0.01000000000000002 1.414213562373095'],
  },
  {
    name: 'single-rounds-when-stored',
    source: `program T; var s: Single;
begin s := 0.1; WriteLn(s = 0.1, ' ', s:0:10); s := s * 3; WriteLn(s:0:10) end.`,
    output: ['FALSE 0.1000000015', '0.3000000119'],
  },
  {
    name: 'n-plus-computes-real-expressions-in-extended',
    source: `{$N+} program T; var r: Real;
begin r := 1; WriteLn(r / 3:0:15, ' ', 0.1 * 3:0:15) end.`,
    output: ['0.333333333333333 0.300000000000000'],
  },
];
