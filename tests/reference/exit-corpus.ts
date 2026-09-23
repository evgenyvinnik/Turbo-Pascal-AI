import type { ReferenceCase } from './corpus';

/** How programs end: Halt, run-time errors and the exit status they leave.
 * Exit codes stay within 0..255, where DOS and Free Pascal on Unix agree;
 * DOS keeps the low byte of larger values, while Free Pascal reports 255. */
const exitProcedures = `program T; var SaveExit, Save2: Pointer; a, b: Integer;
{$F+} procedure First; begin ExitProc := SaveExit; WriteLn('first ', ExitCode, ' ', ErrorAddr = nil) end;
procedure Second; begin ExitProc := Save2; WriteLn('second') end;
procedure Quiet; begin ExitProc := SaveExit; ErrorAddr := nil; WriteLn('quiet ', ExitCode) end; {$F-}
procedure Stop; begin Halt(3) end;`;

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
  {
    name: 'exit-procedures-run-last-installed-first',
    source: `${exitProcedures}
begin SaveExit := ExitProc; ExitProc := @First; Save2 := ExitProc; ExitProc := @Second; WriteLn('main') end.`,
    output: ['main', 'second', 'first 0 TRUE'],
  },
  {
    name: 'halt-runs-the-exit-procedures',
    source: `${exitProcedures}
begin SaveExit := ExitProc; ExitProc := @First; Stop; WriteLn('not reached') end.`,
    output: ['first 3 TRUE'],
    exitCode: 3,
  },
  {
    name: 'run-time-error-runs-the-exit-procedures-with-error-addr-set',
    source: `${exitProcedures}
begin SaveExit := ExitProc; ExitProc := @First; a := 1; b := 0; WriteLn(a div b) end.`,
    output: ['first 200 FALSE'],
    exitCode: 200,
  },
  {
    name: 'exit-procedure-can-clear-error-addr',
    source: `${exitProcedures}
begin SaveExit := ExitProc; ExitProc := @Quiet; a := 1; b := 0; WriteLn(a div b) end.`,
    output: ['quiet 200'],
    exitCode: 200,
  },
];
