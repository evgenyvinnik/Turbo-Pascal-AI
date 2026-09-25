import { describe, expect, test } from 'vitest';
import { PascalError } from '../../src/compiler/errors/PascalError';
import { describePascalDiagnostic, formatPascalDiagnostic } from '../../src/compiler/errors/diagnostics';
import { Parser } from '../../src/compiler/parser/Parser';
import { Lexer } from '../../src/compiler/lexer/Lexer';
import { Stream } from '../../src/compiler/lexer/Stream';
import { Compiler } from '../../src/compiler/codegen/Compiler';

function errorFor(source: string): PascalError {
  try { new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()); }
  catch (error) { expect(error).toBeInstanceOf(PascalError); return error as PascalError; }
  throw new Error('Expected compilation to fail');
}

describe('Borland diagnostic presentation', () => {
  test.each([
    ['program ; begin end.', 2, 'Identifier expected'],
    ['program Demo;\nbegin Missing := 1 end.', 3, 'Unknown identifier'],
    ['program Demo; var N: Integer; N: Integer; begin end.', 4, 'Duplicate identifier'],
    ["program Demo; begin WriteLn('broken) end.", 8, 'String constant exceeds line'],
    ['program Demo;\nvar N: Integer;\nbegin N := true end.', 26, 'Type mismatch'],
    ['program Demo begin end.', 85, '";" expected'],
    ['program Demo; begin if true WriteLn(1) end.', 57, 'THEN expected'],
    ['program Demo; begin while true WriteLn(1) end.', 50, 'DO expected'],
    ['program Demo; const N = 1 div 0; begin end.', 62, 'Division by zero'],
    ['program Demo; begin end', 10, 'Unexpected end of file'],
    ['program Demo; begin Break end.', 109, 'No enclosing FOR, WHILE, or REPEAT statement'],
    ['program Demo; begin asm pusha end end.', 159, '286/287 instructions are not enabled'],
    ['program Demo; var a: array[0..65519] of Byte; begin end.', 49, 'Data segment too large'],
  ])('classifies an actual compiler failure: %s', (source, code, message) => {
    const error = errorFor(source);
    const diagnostic = describePascalDiagnostic(error, 'compiler');
    expect(diagnostic).toMatchObject({ code, message, detail: error.message, lineNumber: error.lineNumber, columnNumber: error.columnNumber });
    expect(formatPascalDiagnostic(diagnostic)).toBe(`Error ${String(code)}: ${message}`);
    expect(error.message).toBe(diagnostic.detail);
  });

  test.each([
    ['Division by zero', 200], ['Range check error (1..3)', 201], ['Array index 3 out of bounds (1..2)', 201],
    ['Stack overflow', 202], ['Heap overflow', 203], ['Invalid or disposed pointer', 204],
    ['Real overflow', 205], ['Arithmetic overflow', 215],
    ['File not found: DATA.TXT', 2], ['I/O error 103', 103],
    ['Invalid integer input: letters', 106], ['Run-time error 211', 211],
  ])('classifies a runtime failure without changing its source: %s', (message, code) => {
    const error = new PascalError(message, 19, 7);
    const diagnostic = describePascalDiagnostic(error, 'runtime');
    expect(diagnostic).toMatchObject({ code, detail: message, lineNumber: 19, columnNumber: 7 });
    expect(formatPascalDiagnostic(diagnostic)).toMatch(new RegExp(`^Run-time error ${String(code)}: `));
  });

  test('keeps compiler and runtime number spaces separate', () => {
    const error = new PascalError('Division by zero', 4);
    expect(describePascalDiagnostic(error, 'compiler').code).toBe(62);
    expect(describePascalDiagnostic(error, 'runtime').code).toBe(200);
  });

  test('does not relabel implementation limits or arbitrary JavaScript failures as Borland errors', () => {
    for (const error of [new PascalError('Maximum instruction count exceeded', 8), new Error('Division by zero'), new PascalError('Unsupported statement: custom')]) {
      expect(describePascalDiagnostic(error, 'runtime').code).toBeUndefined();
      expect(describePascalDiagnostic(error, 'compiler').code).toBeUndefined();
    }
  });

  test('retains the originating unit or include source file', () => {
    const error = new PascalError('Type mismatch: expected integer, found boolean', 12, 4);
    Object.assign(error, { sourceFile: 'LIB/COUNTER.PAS' });
    expect(describePascalDiagnostic(error, 'compiler')).toMatchObject({ code: 26, sourceFile: 'LIB/COUNTER.PAS', lineNumber: 12, columnNumber: 4 });
  });
});
