import type { ReferenceCase } from './corpus';

/** How programs end: Halt, run-time errors and the exit status they leave.
 * Exit codes stay within 0..255, where DOS and Free Pascal on Unix agree;
 * DOS keeps the low byte of larger values, while Free Pascal reports 255. */
export const exitCases: ReferenceCase[] = [
  {
    name: 'halt-ends-with-its-exit-code',
    source: `program T; begin WriteLn('before'); Halt(3); WriteLn('after') end.`,
    output: ['before'],
    exitCode: 3,
  },
  {
    name: 'halt-without-argument-exits-zero',
    source: `program T; begin WriteLn('x'); Halt; WriteLn('after') end.`,
    output: ['x'],
  },
  {
    name: 'halt-in-a-procedure-ends-the-program',
    source: `program T;
procedure P; begin WriteLn('in P'); Halt(4); WriteLn('not reached') end;
begin P; WriteLn('not reached') end.`,
    output: ['in P'],
    exitCode: 4,
  },
  {
    name: 'halt-keeps-an-unfinished-line',
    source: `program T; begin Write('partial'); Halt(2) end.`,
    output: ['partial'],
    exitCode: 2,
  },
  {
    name: 'halt-255-is-the-largest-exit-code',
    source: `program T; begin Halt(255) end.`,
    output: [],
    exitCode: 255,
  },
  {
    name: 'division-by-zero-exits-with-run-time-error-200',
    source: `program T; var a, b: Integer;
begin a := 1; b := 0; WriteLn('pre'); WriteLn(a div b) end.`,
    output: ['pre'],
    exitCode: 200,
  },
  {
    name: 'range-check-exits-with-run-time-error-201',
    source: `program T; {$R+} var a: array[1..3] of Integer; i: Integer;
begin i := 5; a[i] := 1; WriteLn('not reached') end.`,
    output: [],
    exitCode: 201,
  },
];
