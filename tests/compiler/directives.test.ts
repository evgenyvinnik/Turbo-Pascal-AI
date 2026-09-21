import { describe, expect, it } from 'vitest';
import { applyCompilerSwitches, DEFAULT_SWITCHES, preprocessPascal, restoreSourceLocations } from '../../src/compiler/directives';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { PascalError } from '../../src/compiler/errors';

describe('Turbo Pascal source directives', () => {
  it('applies comma-separated switches and distinguishes include names from I/O checking', () => {
    const switches = { ...DEFAULT_SWITCHES };
    expect(applyCompilerSwitches('$B+,R+,V-,P+,I-,Q+', switches)).toBe(true);
    expect(switches).toEqual({ completeBooleanEvaluation: true, rangeChecking: true, strictVarStrings: false,
      openStrings: true, ioChecking: false, overflowChecking: true, farCalls: false });
    expect(applyCompilerSwitches('$I settings.inc', switches)).toBe(false);
  });
  it('does not tokenize excluded source and preserves original line numbers', () => {
    const source = `program P;\n{$IFDEF OTHER}\n@ invalid ?? # garbage\n{$ELSE}\nbegin WriteLn('ok'); end.\n{$ENDIF}`;
    const result = preprocessPascal(source);
    const node = new Parser(new Lexer(new Stream(result.source))).parse();
    expect(node.block.statements[0]?.lineNumber).toBe(5);
    expect(result.source.split('\n')).toHaveLength(source.split('\n').length);
  });
  it('tracks nested inactive conditions without executing their define or switch directives', () => {
    const result = preprocessPascal(`{$IFDEF NO}{$DEFINE HIDDEN}{$R+}{$IFNDEF INNER}bad{$ELSE}bad{$ENDIF}{$ENDIF}
{$IFDEF HIDDEN}bad{$ENDIF}{$IFOPT R+}bad{$ELSE}program P;begin end.{$ENDIF}`);
    expect(result.source).not.toContain('bad');
    expect(() => new Parser(new Lexer(new Stream(result.source))).parse()).not.toThrow();
  });
  it('supports case-insensitive defines, undefines, IFNDEF, IFOPT and parenthesis comments', () => {
    const result = preprocessPascal(`(*$DEFINE foo*){$UNDEF FOO}{$IFNDEF Foo}{$I-}{$IFOPT I-}program P;begin end.{$ENDIF}{$ENDIF}`);
    expect(() => new Parser(new Lexer(new Stream(result.source))).parse()).not.toThrow();
  });
  it('leaves strings containing directive-looking text unchanged', () => {
    const source = `program P;begin WriteLn('{$IFDEF X}can''t{$ENDIF}');end.`;
    expect(preprocessPascal(source).source).toBe(source);
  });
  it('resolves nested includes relative to their source and shares definitions', () => {
    const calls: string[] = [];
    const result = preprocessPascal('program P;\n{$I inc/first.inc}\nbegin X:=7;end.', {
      filename: 'P.PAS', resolveInclude: (name, from) => {
        calls.push(`${from}:${name}`);
        return name === 'inc/first.inc'
          ? { filename: 'inc/first.inc', source: '{$DEFINE DECLARED}\n{$I second.inc}' }
          : { filename: 'inc/second.inc', source: '{$IFDEF DECLARED}\nvar X:Integer;\n{$ENDIF}' };
      },
    });
    const ast = new Parser(new Lexer(new Stream(result.source))).parse();
    restoreSourceLocations(ast, result);
    expect(calls).toEqual(['P.PAS:inc/first.inc', 'inc/first.inc:second.inc']);
    expect(ast.block.declarations[0]).toMatchObject({ sourceFile: 'inc/second.inc', lineNumber: 2 });
    expect(ast.block.statements[0]).toMatchObject({ sourceFile: 'P.PAS', lineNumber: 3 });
  });
  it.each(['{$ELSE}', '{$ENDIF}', '{$IFDEF A}', '{$IFDEF A}{$ELSE}{$ELSE}{$ENDIF}', '{$IFOPT ?}'])('rejects malformed conditional structure %s', source => {
    expect(() => preprocessPascal(source)).toThrow(PascalError);
  });
  it('rejects missing and recursive includes with source coordinates', () => {
    expect(() => preprocessPascal('\n{$I missing.inc}', { filename: 'MAIN.PAS' })).toThrow('Include file not found');
    try { preprocessPascal('\n{$I missing.inc}', { filename: 'MAIN.PAS' }); }
    catch (error) { expect(error).toMatchObject({ sourceFile: 'MAIN.PAS', lineNumber: 2 }); }
    expect(() => preprocessPascal('{$I loop.inc}', { filename: 'loop.inc', resolveInclude: () => ({
      filename: 'loop.inc', source: '{$I loop.inc}',
    }) })).toThrow('Circular include file');
  });
  it('does not permit an include to close its caller conditional', () => {
    expect(() => preprocessPascal('{$IFDEF VER70}{$I bad.inc}{$ENDIF}', {
      resolveInclude: () => ({ filename: 'bad.inc', source: '{$ENDIF}' }),
    })).toThrow('Unexpected ENDIF');
  });
});
