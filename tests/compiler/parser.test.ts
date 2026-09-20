import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { PascalError } from '../../src/compiler/errors';

const parse = (source: string) => new Parser(new Lexer(new Stream(source))).parse();

describe('Pascal parser', () => {
  it.each(['HELLO', 'FIBONACCI', 'PRIMES', 'SQUARE'])('parses bundled %s.PAS', (name) => {
    const source = readFileSync(new URL(`../../public/samples/${name}.PAS`, import.meta.url), 'utf8');
    expect(parse(source).block.statements.length).toBeGreaterThan(0);
  });

  it('preserves write field width and real precision expressions', () => {
    const program = parse('program T; begin WriteLn(12:5, 3.14159:8:2) end.');
    expect(program.block.statements[0]).toMatchObject({
      type: 'call',
      arguments: [
        { type: 'formattedArgument', value: { value: 12 }, width: { value: 5 } },
        { type: 'formattedArgument', value: { value: 3.14159 }, width: { value: 8 }, precision: { value: 2 } },
      ],
    });
  });

  it('parses negative and character array bounds', () => {
    expect(parse("program T; var a: array[-2..2] of Integer; b: array['a'..'z'] of Integer; begin end.").block.declarations).toHaveLength(2);
  });

  it('parses forward procedures, with statements, xor, and case ranges', () => {
    const program = parse(`program T;
procedure P; forward;
procedure P; begin end;
var r: record x: Integer end;
begin
  with r do x := 1;
  if True xor False then P;
  case r.x of 1..3: P end
end.`);
    expect(program.block.statements).toHaveLength(3);
  });

  it.each([
    ['program T; begin end. unexpected', /after program/],
    ['program T(input output); begin end.', /Expected '\)'/],
    ['program T; begin WriteLn(1 < 2 < 3) end.', /Expected '\)'/],
    ['program T; begin P(1:2) end.', /Expected '\)'/],
  ])('rejects malformed syntax: %s', (source, message) => {
    expect(() => parse(source)).toThrow(message);
  });

  it('reports the source line for a missing expression', () => {
    try {
      parse('program T;\nbegin\n  WriteLn(1 + );\nend.');
      expect.fail('Expected a Pascal error');
    } catch (error) {
      expect(error).toBeInstanceOf(PascalError);
      expect(error).toMatchObject({ lineNumber: 3 });
    }
  });
});

describe('Pascal lexer', () => {
  it('keeps escaped quotes, comments, ranges, and source lines intact', () => {
    const lexer = new Lexer(new Stream("{first}\n(*second*)\n'Pascal''s' 1..3 2.5e-2"));
    const tokens = Array.from({ length: 7 }, () => lexer.next());
    expect(tokens.map(({ value }) => value)).toEqual(['first', 'second', "Pascal's", '1', '..', '3', '2.5e-2']);
    expect(tokens.map(({ lineNumber }) => lineNumber)).toEqual([1, 2, 3, 3, 3, 3, 3]);
  });

  it.each([
    ["'unclosed\nnext line'", 'Unterminated string'],
    ['{unclosed', 'Unterminated comment'],
    ['(*unclosed', 'Unterminated comment'],
    ['1.5e+', 'missing exponent digits'],
  ])('rejects malformed token %s', (source, message) => {
    expect(() => new Lexer(new Stream(source)).next()).toThrow(message);
  });
});
