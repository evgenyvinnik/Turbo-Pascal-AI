import { describe, expect, it } from 'vitest';
import { expectation, readHeader } from '../fpc-suite/header';
import { firstError, samePlace } from '../fpc-suite/fpc-output';

describe('Free Pascal test headers', () => {
  it('reads directives with and without values, uppercasing names', () => {
    const header = readHeader('{ %fail }\n{ %OPT=-Cr -O2 }\n{%result=201}\nprogram t;');
    expect(Object.fromEntries(header)).toEqual({ FAIL: '', OPT: '-Cr -O2', RESULT: '201' });
  });

  it('passes over blank lines and ordinary comments, as FPC does', () => {
    expect(Object.fromEntries(readHeader('\n{ Bug report 1234 }\n\n  { %NORUN }\nprogram t;'))).toEqual({ NORUN: '' });
  });

  it('stops at the first line that does not start with a brace', () => {
    expect(readHeader('program t;\n{ %FAIL }\nbegin end.').size).toBe(0);
  });

  it('ignores a byte-order mark before the first directive', () => {
    expect(readHeader('\uFEFF{ %CPU=i386 }').get('CPU')).toBe('i386');
  });

  it('turns directives into what the test expects', () => {
    expect(expectation(readHeader('{ %FAIL }'))).toEqual({ failsToCompile: true, compileOnly: false, exitCode: 0 });
    expect(expectation(readHeader('{ %NORUN }\n{ %RESULT=3 }'))).toEqual({ failsToCompile: false, compileOnly: true, exitCode: 3 });
  });
});

describe('Free Pascal compiler output', () => {
  // Verbatim from fpc -Mtp 3.2.2: the error, then summaries.
  const output = [
    'bad.pas(4,8) Error: Identifier not found "undefinedname"',
    'bad.pas(6) Fatal: There were 1 errors compiling module, stopping',
    'Fatal: Compilation aborted',
  ].join('\n');

  it('takes the first error and where it is, not the summaries after it', () => {
    expect(firstError(output)).toEqual({ message: 'Identifier not found "undefinedname"', site: { file: 'bad.pas', line: 4 } });
  });

  it('reads a location without a column, and keeps a message with no location', () => {
    expect(firstError('/tmp/x/t.pp(12) Fatal: Syntax error').site).toEqual({ file: 't.pp', line: 12 });
    expect(firstError('Fatal: Compilation aborted')).toEqual({ message: 'Compilation aborted' });
  });

  it('matches rejections at the same place, give or take a line, in the same file', () => {
    expect(samePlace({ file: 'TB0001.PP', line: 5 }, { file: 'tb0001.pp', line: 6 })).toBe(true);
    expect(samePlace({ file: 'TB0001.PP', line: 5 }, { file: 'tb0001.pp', line: 7 })).toBe(false);
    expect(samePlace({ file: 'UNIT.PP', line: 5 }, { file: 'tb0001.pp', line: 5 })).toBe(false);
  });
});
