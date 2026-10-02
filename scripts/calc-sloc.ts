/**
 * Counts source lines of code: the non-empty lines of each kind of source
 * file, by extension.
 *
 * Usage: bun scripts/calc-sloc.ts [--write] [root]
 *
 * It prints the counts as a Markdown table. With --write it also puts the
 * table in README.md, between the <!-- sloc:start --> and <!-- sloc:end -->
 * markers.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const INCLUDED = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.md',
  '.pas',
  '.asm',
]);
/** Dependencies, build output, caches and test artifacts, none of them ours. */
const IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.idea',
  '.vite',
  '.vscode',
  'artifacts',
  'build',
  'coverage',
  'dev-dist',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const IGNORED_FILES = new Set(['bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock']);

/** The non-empty lines of a text file; a binary one counts none. */
function lines(path: string): number {
  const buffer = readFileSync(path);
  if (buffer.includes(0)) return 0;
  return buffer
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '').length;
}

function walk(directory: string, counts: Map<string, number>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path, counts);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (IGNORED_FILES.has(entry.name) || !INCLUDED.has(extension)) continue;
    counts.set(extension, (counts.get(extension) ?? 0) + lines(path));
  }
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const root = resolve(args.find((arg) => arg !== '--write') ?? join(import.meta.dirname, '..'));
const counts = new Map<string, number>();
walk(root, counts);

const number = (value: number) => value.toLocaleString('en-US');
const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
const table = [
  '| Extension | Lines |',
  '|-----------|------:|',
  ...[...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([extension, count]) => `| ${extension} | ${number(count)} |`),
  `| **Total** | **${number(total)}** |`,
].join('\n');
console.log(table);

if (write) {
  const readme = join(root, 'README.md');
  const text = readFileSync(readme, 'utf8');
  const marked = /(<!-- sloc:start -->)[\s\S]*?(<!-- sloc:end -->)/;
  if (!marked.test(text)) throw new Error('README.md has no sloc:start and sloc:end markers');
  writeFileSync(readme, text.replace(marked, `$1\n${table}\n$2`));
  console.log('\nREADME.md updated.');
}
