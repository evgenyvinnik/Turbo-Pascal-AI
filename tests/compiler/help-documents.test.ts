import { describe, expect, test } from 'vitest';
import { HELP_TOPICS } from '../../src/components/IDE/helpTopics';
import {
  getHelpDocument,
  helpLinkAt,
  identifierTopic,
  REFERENCE_TOPICS,
} from '../../src/components/IDE/helpDocuments';
import { REFERENCE_HELP } from '../../src/components/IDE/referenceHelp';

describe('Help documents and cross references', () => {
  const names = [...Object.keys(HELP_TOPICS), ...Object.keys(REFERENCE_TOPICS)];
  test.each(names)('%s has valid, explicit links to substantive documents', (name) => {
    const document = getHelpDocument(name);
    expect(document.lines.length).toBeGreaterThan(3);
    for (const link of document.links) {
      expect(names, `${name} -> ${link.target}`).toContain(link.target);
      expect(getHelpDocument(link.target).lines.length).toBeGreaterThan(3);
      expect(document.lines[link.row]!.slice(link.col, link.col + link.length).trim()).not.toBe('');
      expect(helpLinkAt(name, link.row, link.col)?.target).toBe(link.target);
    }
  });

  test('the two contents columns lead to independent subjects', () => {
    const document = getHelpDocument('contents');
    const row = document.lines.findIndex((line) => line.includes('Built-in Assembler'));
    const left = document.lines[row]!.indexOf('Built-in Assembler');
    const right = document.lines[row]!.indexOf('Reserved Words');
    expect(helpLinkAt('contents', row, left)?.target).toBe('asm');
    expect(helpLinkAt('contents', row, right)?.target).toBe('reserved');
    expect(helpLinkAt('contents', row, left - 1)).toBeUndefined();
  });

  test('retains the supplied visible editor pages and adds useful continuation', () => {
    expect(getHelpDocument('edit').lines.slice(0, 32)).toEqual([
      ...REFERENCE_HELP['Help-Edit-Window']!,
      ...REFERENCE_HELP['Help-2']!,
    ]);
    expect(getHelpDocument('edit').lines.slice(32).join('\n')).toContain(
      'Shift+Tab selects the previous link'
    );
  });

  test('routine directory links lead to groups and then individual help', () => {
    const document = getHelpDocument('procedures');
    const group = document.links.find((entry) => entry.target === 'routines-u-z')!;
    expect(group).toBeDefined();
    expect(getHelpDocument(group.target).links.map((entry) => entry.target)).toContain('writeln');
    expect(getHelpDocument('writeln').lines.join('\n')).toContain('WriteLn([F,]');
  });

  test.each([
    ['CONSTRUCTOR', 'constructor'],
    ['OBJECT', 'object'],
    ['USES', 'uses'],
    ['INTERFACE', 'unit'],
    ['$IFDEF', '$define'],
    ['ORD', 'numeric-routines'],
    ['WriteLn', 'writeln'],
  ])('looks up %s', (identifier, expected) => {
    expect(identifierTopic(identifier)).toBe(expected);
  });

  test('the index contains all authored topics, including late-added language sections', () => {
    const index = getHelpDocument('index').links.map((entry) => entry.target);
    expect(index).toEqual(
      expect.arrayContaining([
        'unit',
        'object',
        'asm',
        'statements',
        'labels',
        'comments',
        'compiler-errors',
        'runtime-errors',
      ])
    );
  });

  test('prose is not a link and context links stay on the actual subject', () => {
    expect(helpLinkAt('unit', 3, 0)).toBeUndefined();
    expect(getHelpDocument('context:Turbo-Help-Compiler-Options').links[0]?.target).toBe(
      'directives'
    );
    expect(getHelpDocument('context:Turbo-Help-Evaluate-and-Modify').links[0]?.target).toBe(
      'evaluate'
    );
  });
});
