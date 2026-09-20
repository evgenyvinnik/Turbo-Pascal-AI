import { describe, expect, it } from 'vitest';
import { parseGrepArguments, searchGrepFiles } from '../../src/components/IDE/grepSearch';

describe('local Grep tool', () => {
  it('parses quoted patterns, switches and DOS file masks without a shell', () => {
    expect(parseGrepArguments('-in "two words" *.pas C:\\SRC\\*.inc')).toEqual({
      pattern: 'two words',
      masks: ['*.pas', 'C:\\SRC\\*.inc'],
      ignoreCase: true,
      invert: false,
    });
  });
  it('matches file masks and returns exact source locations', () => {
    expect(
      searchGrepFiles(
        {
          'MAIN.PAS': 'program T;\n  NeedleToken;\nend.',
          'SRC/IMPORT.INC': 'needletoken',
          'DATA.TXT': 'NeedleToken',
        },
        parseGrepArguments('-i needle(token)? *.pas C:\\SRC\\*.inc')
      )
    ).toEqual([
      { file: 'MAIN.PAS', line: 2, column: 3, text: '  NeedleToken;' },
      { file: 'SRC/IMPORT.INC', line: 1, column: 1, text: 'needletoken' },
    ]);
  });
  it('supports inverted matching and bounds captured messages', () => {
    expect(
      searchGrepFiles({ 'A.PAS': 'keep\nskip\nkeep' }, parseGrepArguments('-v skip'))
    ).toHaveLength(2);
    expect(
      searchGrepFiles({ 'A.PAS': 'match\n'.repeat(6000) }, parseGrepArguments('match'))
    ).toHaveLength(5000);
  });
  it('reports invalid options, quotes and patterns instead of executing anything', () => {
    expect(() => parseGrepArguments('-x program')).toThrow(/Unsupported Grep option/);
    expect(() => parseGrepArguments('"unclosed')).toThrow(/Unclosed quote/);
    expect(() => searchGrepFiles({}, parseGrepArguments('['))).toThrow(
      /Invalid Grep regular expression/
    );
  });
});
