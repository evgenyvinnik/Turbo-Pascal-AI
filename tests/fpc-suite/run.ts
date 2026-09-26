/**
 * Runs Free Pascal's own test suite against the browser compiler and VM.
 * Real Free Pascal in Turbo Pascal mode is both filter and reference: a test
 * counts only when `fpc -Mtp` builds and runs it the way the test expects.
 * The browser compiler must then accept it (or reject it, for a must-fail
 * test) and the program must exit with the same code. The tests check
 * themselves, so the exit code is the verdict; differing output is recorded
 * but does not fail a test.
 *
 * The tests that passed before are listed, by name only, in baseline.json. A
 * run fails when one of them is judged and no longer passes. One that is not
 * judged here, which Free Pascal on another platform can cause, is reported
 * but does not fail the run. FPC_SUITE_UPDATE=1 (bun run
 * test:fpc-suite:update) writes this run's passes into the list, keeping the
 * listed tests it did not judge.
 *
 * Usage: bun run fpc-suite:fetch && bun run test:fpc-suite
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { compileProject, NativePascalRequired } from '../../src/compiler/project';
import type { CompilerSwitches } from '../../src/compiler/directives';
import { PascalError } from '../../src/compiler/errors';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { describePascalDiagnostic } from '../../src/compiler/errors/diagnostics';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { expectation, readHeader, type Expectation } from './header';
import { firstError, samePlace, type ErrorSite } from './fpc-output';
import pin from './pin.json';

const execute = promisify(execFile);
const compiler = process.env.FPC_BIN ?? 'fpc';
const suite = path.resolve('.cache/fpc-source/tests');
const directories = (process.env.FPC_SUITE_DIRS ?? 'tbs,tbf').split(',').filter(Boolean);
const filter = process.env.FPC_SUITE_FILTER;
const jobs = Math.max(1, Number(process.env.FPC_SUITE_JOBS ?? 4));
const reportPath = path.resolve(process.env.FPC_SUITE_REPORT ?? 'artifacts/verification/fpc-suite.json');
// Some numeric tests need about 200 million instructions in the VM.
const maxInstructions = 300_000_000;

/** Directives this harness cannot honour, with the reason a test is skipped. */
const UNSUPPORTED: Record<string, string> = {
  TARGET: 'restricted to particular operating systems',
  CPU: 'restricted to particular CPUs',
  GRAPH: 'needs a graphics display',
  INTERACTIVE: 'needs a person at the keyboard',
  NEEDLIBRARY: 'builds or loads a shared library',
  NEEDEDAFTER: 'a support file for a later test',
  FILES: 'needs extra files',
  CONFIGFILE: 'needs a configuration file',
  RECOMPILE: 'recompiles with other options',
  WPOPARAS: 'uses whole-program optimisation',
  WPOPASSES: 'uses whole-program optimisation',
  KNOWNRUNERROR: 'documents a known Free Pascal bug',
  KNOWNCOMPILEERROR: 'documents a known Free Pascal bug',
  EXPECTMSGS: "checks the compiler's messages",
};
/** Options that do not change what a program does; Free Pascal still gets them. */
const NEUTRAL_OPTION = /^-(?:[vOga]\S*|Cg-?|Un|Xs|Xi|Xe|Sg)$/;
/** In-source directives that make Free Pascal compile something other than
 * Turbo Pascal. They override -Mtp, so such a test says nothing about TP. */
const DIALECT_DIRECTIVE = /\{\$(?:mode\s+(?!tp\b)\w+|modeswitch\b|h\+|longstrings\s+on|macro\s+on|coperators\s+on|inline\s+on|z[+\-\d]|minenumsize\b|j[+-]|writeableconst\b|asmmode\b|setpe(?:opt)?flags\b)/i;
/** Types Free Pascal declares in every mode, TP mode included, that Turbo
 * Pascal 7 never had. A test using one is FPC code, whatever its mode. Comp,
 * WordBool and PChar are real TP7 types, so they are not listed. */
const FPC_ONLY_TYPE = /\b(?:cardinal|smallint|shortint64|int64|qword|longword|dword|codepointer|ansistring|widestring|unicodestring|textfile|sizeint|sizeuint|ptrint|ptruint|nativeint|nativeuint)\b/i;
/** Syntax only Free Pascal and Delphi accept, found in program text without
 * brace comments or strings: a distinct type alias (`T = type Integer`;
 * in Turbo Pascal `type` only starts a type section), a `//` comment, or a
 * calling convention or directive Turbo Pascal lacks. */
const FPC_ONLY_SYNTAX: readonly (readonly [RegExp, string])[] = [
  [/=\s*type\s+[a-z_]/i, 'declares a distinct type alias (T = type X)'],
  [/\/\//, 'uses // comments'],
  [/;\s*(?:cdecl|stdcall|safecall|cppdecl|mwpascal|softfloat|local)\s*;/i, 'uses a Free Pascal procedure directive'],
  // Turbo Pascal's assembler takes Intel syntax. Free Pascal reads AT&T only
  // on x86, so such a test fails in different places on other CPUs.
  [/\basm\b[\s\S]*?%[a-z]{2,3}\b/i, 'uses AT&T assembler syntax'],
];
/** Program text without strings or brace comments, keeping `//`. */
const withoutBraces = (source: string) =>
  source.replace(/'[^'\n]*'/g, "''").replace(/\{[^}]*\}|\(\*[\s\S]*?\*\)/g, ' ');
/** Program text without comments, so a comment mentioning a type does not count. */
const withoutComments = (source: string) => source.replace(/\{[^}]*\}|\(\*[\s\S]*?\*\)|\/\/[^\n]*/g, ' ');
/** Run-time check options, which map onto the browser compiler's switches. */
const SWITCH_OPTION: Record<string, keyof CompilerSwitches> = { '-Cr': 'rangeChecking', '-Co': 'overflowChecking', '-Ci': 'ioChecking' };

type Verdict =
  | { category: 'skipped'; reason: string }
  | { category: 'excluded'; reason: string }
  | { category: 'pass'; reason: string }
  | { category: 'fail'; reason: string }
  | { category: 'error'; reason: string };

/** What a test requires: a run, only a compile, or a rejection. They carry
 * different weight, so the report never blends them into one rate. */
type Kind = 'run' | 'compile' | 'reject';

interface Outcome {
  test: string;
  kind?: Kind;
  directives: Record<string, string>;
  verdict: Verdict;
  /** `line` is where a compiler reported its first error. */
  fpc?: { built: boolean; exitCode?: number; message?: string; line?: number };
  vm?: { built: boolean; exitCode?: number; message?: string; line?: number; outputMatches?: boolean };
}

/** Sources are read byte for byte; a UTF-8 byte-order mark is file metadata, not program text. */
const readSource = async (file: string) => (await readFile(file, 'latin1')).replace(/^\xEF\xBB\xBF/, '');
const normalize = (text: string) => text === '' ? [] : text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
const versionParts = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0);
function compareVersions(a: string, b: string): number {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

function skipReason(header: ReadonlyMap<string, string>, fpcVersion: string): string | undefined {
  for (const [directive, reason] of Object.entries(UNSUPPORTED)) if (header.has(directive)) return reason;
  const minimum = header.get('VERSION'), maximum = header.get('MAXVERSION');
  if (minimum && compareVersions(fpcVersion, minimum) < 0) return `needs Free Pascal ${minimum}`;
  if (maximum && compareVersions(fpcVersion, maximum) > 0) return `needs Free Pascal ${maximum} or earlier`;
  return undefined;
}

function translateOptions(value: string): { fpc: string[]; switches: Partial<CompilerSwitches> } | string {
  const fpc: string[] = [], switches: Partial<CompilerSwitches> = {};
  for (const option of value.split(/\s+/).filter(Boolean)) {
    const target = SWITCH_OPTION[option];
    if (target) switches[target] = true;
    else if (!NEUTRAL_OPTION.test(option)) return `uses the compiler option ${option}`;
    fpc.push(option);
  }
  return { fpc, switches };
}

interface FpcBuild { built: boolean; executable: string; message?: string; site?: ErrorSite }

async function buildWithFpc(file: string, work: string, options: string[]): Promise<FpcBuild> {
  const executable = path.join(work, 'program');
  try {
    await execute(compiler, ['-Mtp', ...options, `-Fu${path.join(suite, 'tstunits')}`, `-Fu${path.dirname(file)}`, `-Fi${path.dirname(file)}`, `-FU${work}`, `-FE${work}`, `-o${executable}`, file],
      { cwd: work, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    return { built: true, executable };
  } catch (error) {
    const failure = error as { code?: unknown; killed?: boolean; stdout?: string };
    if (typeof failure.code !== 'number' || failure.killed) throw error;
    const reported = firstError(failure.stdout ?? '');
    return { built: false, executable, message: reported.message, ...(reported.site ? { site: reported.site } : {}) };
  }
}

function runWithFpc(executable: string, work: string): Promise<{ exitCode: number; output: string[] } | { failure: string }> {
  return new Promise((resolve) => {
    const child = execFile(executable, [], { cwd: work, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (!error) resolve({ exitCode: 0, output: normalize(stdout) });
      else if (typeof error.code === 'number' && !error.killed) resolve({ exitCode: error.code, output: normalize(stdout) });
      else resolve({ failure: error.killed ? 'timed out' : error.message });
    });
    child.stdin?.end();
  });
}

type VmResult =
  | { kind: 'asm' }
  | { kind: 'rejected'; message: string; site: ErrorSite }
  | { kind: 'crashed'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'built' }
  | { kind: 'ran'; exitCode: number; output: string[] };

function runInBrowserEngine(source: string, filename: string, sources: Record<string, string>, switches: Partial<CompilerSwitches>, expected: Expectation, unit?: string): VmResult {
  let bytecode;
  try {
    // A unit is checked through a program that uses it, so it compiles in
    // full rather than only parsing. Its directory holds it under NAME.PAS.
    const [file, text] = unit === undefined ? [filename, source] : [`${path.dirname(filename)}/FPCSUITE.PAS`, `program FpcSuite; uses ${unit}; begin end.`];
    bytecode = compileProject(text, file, { sources, unitDirectories: ['UNITS'], ...switches }).bytecode;
  } catch (error) {
    if (error instanceof NativePascalRequired) return { kind: 'asm' };
    if (error instanceof PascalError) {
      const file = 'sourceFile' in error && typeof error.sourceFile === 'string' ? error.sourceFile : filename;
      return { kind: 'rejected', message: error.message, site: { file: path.basename(file), line: error.lineNumber } };
    }
    return { kind: 'crashed', message: String(error) };
  }
  if (expected.failsToCompile || expected.compileOnly) return { kind: 'built' };
  const machine = new Machine(bytecode, { maxInstructions, fileSystem: new VirtualFileSystem() });
  machine.setInput([]);
  try {
    machine.run();
  } catch (error) {
    // A run-time error with a Borland number is a result; anything else is not.
    if (machine.getState() !== MachineState.ERROR || describePascalDiagnostic(error, 'runtime').code === undefined) {
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (machine.getState() === MachineState.WAITING) return { kind: 'error', message: 'waits for input' };
  return { kind: 'ran', exitCode: machine.getExitCode(), output: machine.getOutput() };
}

/** Every file of a directory, keyed as the browser compiler names sources.
 * Turbo Pascal units are NAME.PAS while Free Pascal's are .pp, so each .pp
 * file is also offered under its .PAS name. */
async function snapshot(directory: string, prefix: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of await readdir(directory)) {
    if (!/\.(pp|pas|inc)$/i.test(name)) continue;
    const text = await readSource(path.join(directory, name));
    files[`${prefix}/${name.toUpperCase()}`] = text;
    if (/\.pp$/i.test(name)) files[`${prefix}/${name.slice(0, -3).toUpperCase()}.PAS`] = text;
  }
  return files;
}

async function judge(file: string, relative: string, sources: Record<string, string>, fpcVersion: string): Promise<Outcome> {
  const source = await readSource(file);
  const header = readHeader(source);
  const outcome: Outcome = { test: relative, directives: Object.fromEntries(header), verdict: { category: 'skipped', reason: '' } };
  const skip = skipReason(header, fpcVersion);
  if (skip) return { ...outcome, verdict: { category: 'skipped', reason: skip } };
  const options = translateOptions(header.get('OPT') ?? '');
  if (typeof options === 'string') return { ...outcome, verdict: { category: 'skipped', reason: options } };
  // Free Pascal builds a unit without a program to run, so units are compile-only.
  let isUnit = false;
  try {
    const lexer = new Lexer(new Stream(source));
    let first = lexer.next();
    while (first.isComment()) first = lexer.next();
    isUnit = first.isReservedWord('unit');
  } catch {
    // The compile step reports sources the lexer cannot read.
  }
  const expected = { ...expectation(header), ...(isUnit ? { compileOnly: true } : {}) };
  outcome.kind = expected.failsToCompile ? 'reject' : expected.compileOnly ? 'compile' : 'run';
  const dialect = DIALECT_DIRECTIVE.exec(source);
  if (dialect) return { ...outcome, verdict: { category: 'excluded', reason: `not Turbo Pascal: the source sets ${dialect[0].toLowerCase()}}` } };
  const fpcType = FPC_ONLY_TYPE.exec(withoutComments(source));
  if (fpcType) return { ...outcome, verdict: { category: 'excluded', reason: `not Turbo Pascal 7: uses the Free Pascal type ${fpcType[0].toLowerCase()}` } };
  const syntax = FPC_ONLY_SYNTAX.find(([pattern]) => pattern.test(withoutBraces(source)));
  if (syntax) return { ...outcome, verdict: { category: 'excluded', reason: `not Turbo Pascal 7: ${syntax[1]}` } };

  const work = await mkdtemp(path.join(tmpdir(), 'fpc-suite-'));
  try {
    const build = await buildWithFpc(file, work, options.fpc);
    outcome.fpc = {
      built: build.built,
      ...(build.message ? { message: build.message } : {}),
      ...(build.site ? { line: build.site.line } : {}),
    };
    if (expected.failsToCompile && build.built) return { ...outcome, verdict: { category: 'excluded', reason: 'Free Pascal accepts it in TP mode' } };
    if (!expected.failsToCompile && !build.built) return { ...outcome, verdict: { category: 'excluded', reason: 'not Turbo Pascal: Free Pascal rejects it in TP mode' } };
    let reference: { exitCode: number; output: string[] } | undefined;
    if (!expected.failsToCompile && !expected.compileOnly) {
      const run = await runWithFpc(build.executable, work);
      if ('failure' in run) return { ...outcome, verdict: { category: 'excluded', reason: `Free Pascal's program ${run.failure}` } };
      outcome.fpc.exitCode = run.exitCode;
      if (run.exitCode !== expected.exitCode) return { ...outcome, verdict: { category: 'excluded', reason: `Free Pascal's program exits ${String(run.exitCode)}, the test expects ${String(expected.exitCode)}` } };
      reference = run;
    }

    const vm = runInBrowserEngine(source, relative.toUpperCase(), sources, options.switches, expected, isUnit ? path.basename(file).replace(/\.\w+$/, '') : undefined);
    if (vm.kind === 'asm') return { ...outcome, verdict: { category: 'excluded', reason: 'uses inline assembly, which only the native DOS compiler runs' } };
    if (vm.kind === 'crashed') return { ...outcome, vm: { built: false, message: vm.message }, verdict: { category: 'fail', reason: 'the browser compiler crashed' } };
    if (vm.kind === 'rejected') {
      outcome.vm = { built: false, message: vm.message, line: vm.site.line };
      if (!expected.failsToCompile) return { ...outcome, verdict: { category: 'fail', reason: 'the browser compiler rejects it' } };
      if (!build.site) return { ...outcome, verdict: { category: 'pass', reason: 'rejected, as the test requires (Free Pascal gives no location)' } };
      return samePlace(vm.site, build.site)
        ? { ...outcome, verdict: { category: 'pass', reason: 'rejected where Free Pascal rejects it' } }
        : { ...outcome, verdict: { category: 'fail', reason: 'rejected, but not where Free Pascal rejects it' } };
    }
    if (expected.failsToCompile) return { ...outcome, vm: { built: true }, verdict: { category: 'fail', reason: 'the browser compiler accepts a program that must not compile' } };
    if (vm.kind === 'built') return { ...outcome, vm: { built: true }, verdict: { category: 'pass', reason: 'compiles' } };
    if (vm.kind === 'error') return { ...outcome, vm: { built: true, message: vm.message }, verdict: { category: 'fail', reason: `the program does not finish: ${vm.message}` } };
    const outputMatches = JSON.stringify(vm.output) === JSON.stringify(reference?.output ?? []);
    outcome.vm = { built: true, exitCode: vm.exitCode, outputMatches };
    return vm.exitCode === expected.exitCode
      ? { ...outcome, verdict: { category: 'pass', reason: 'exits as expected' } }
      : { ...outcome, verdict: { category: 'fail', reason: `exits ${String(vm.exitCode)}, Free Pascal exits ${String(expected.exitCode)}` } };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const fpcVersion = (await execute(compiler, ['-iV'])).stdout.trim();
// In the 3.2.2 release the tests' helper units, such as erroru, live in tstunits.
const units = await snapshot(path.join(suite, 'tstunits'), 'UNITS');
const outcomes: Outcome[] = [];
for (const directory of directories) {
  const folder = path.join(suite, directory);
  const sources = { ...units, ...(await snapshot(folder, directory.toUpperCase())) };
  const tests = (await readdir(folder)).filter((name) => /^t.*\.(pp|pas)$/i.test(name) && (!filter || name.includes(filter))).sort();
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let index = next++; index < tests.length; index = next++) {
      const name = tests[index]!;
      try {
        outcomes.push(await judge(path.join(folder, name), `${directory}/${name}`, sources, fpcVersion));
      } catch (error) {
        // A problem in the harness itself; reported apart from the verdicts.
        outcomes.push({ test: `${directory}/${name}`, directives: {}, verdict: { category: 'error', reason: error instanceof Error ? error.message : String(error) } });
      }
    }
  }));
}
outcomes.sort((a, b) => a.test.localeCompare(b.test));

const count = (category: Verdict['category']) => outcomes.filter((outcome) => outcome.verdict.category === category).length;
const judged = count('pass') + count('fail');
const tally = (category: Verdict['category'], key: (outcome: Outcome) => string) => {
  const totals = new Map<string, number>();
  for (const outcome of outcomes.filter((o) => o.verdict.category === category)) totals.set(key(outcome), (totals.get(key(outcome)) ?? 0) + 1);
  return [...totals].sort((a, b) => b[1] - a[1]);
};
/** Compiler messages with identifiers and numbers masked, so similar failures group. */
const shape = (message = '') => message.replace(/"[^"]*"|'[^']*'/g, '…').replace(/\d+/g, 'N');

const KINDS: [Kind, string][] = [['run', 'Must run and exit as expected'], ['compile', 'Must compile'], ['reject', 'Must be rejected where Free Pascal rejects it']];
const byKind = Object.fromEntries(KINDS.map(([kind]) => {
  const judgedOfKind = outcomes.filter((o) => o.kind === kind && (o.verdict.category === 'pass' || o.verdict.category === 'fail'));
  return [kind, { judged: judgedOfKind.length, passed: judgedOfKind.filter((o) => o.verdict.category === 'pass').length }];
})) as Record<Kind, { judged: number; passed: number }>;
const summary = {
  suite: `${pin.repository} ${pin.tag} (${pin.commit.slice(0, 12)})`, directories, freePascal: fpcVersion,
  programs: outcomes.length, skipped: count('skipped'), excluded: count('excluded'), judged, passed: count('pass'), failed: count('fail'), harnessErrors: count('error'), byKind,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ ...summary, generatedAt: new Date().toISOString(), outcomes }, null, 2) + '\n');

console.log(`Free Pascal ${fpcVersion} tests, ${pin.tag}: ${directories.join(', ')}`);
console.log(`${String(outcomes.length)} programs: ${String(summary.skipped)} skipped, ${String(summary.excluded)} excluded by Free Pascal, ${String(judged)} judged`);
console.log(`${String(summary.passed)}/${String(judged)} pass in the browser compiler and VM:`);
for (const [kind, title] of KINDS) console.log(`  ${String(byKind[kind].passed).padStart(4)}/${String(byKind[kind].judged).padEnd(4)} ${title}`);
console.log('');
for (const [title, category] of [['Skipped', 'skipped'], ['Excluded', 'excluded'], ['Failed', 'fail'], ['Harness errors', 'error']] as const) {
  const reasons = tally(category, (o) => o.verdict.reason);
  if (!reasons.length) continue;
  console.log(`${title}:`);
  for (const [reason, n] of reasons.slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${reason}`);
}
console.log('\nMost common browser-compiler rejections:');
for (const [message, n] of tally('fail', (o) => o.verdict.reason === 'the browser compiler rejects it' ? shape(o.vm?.message) : '').filter(([m]) => m).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${message}`);
console.log(`\nReport: ${reportPath}`);

// The tests that passed before must still pass.
const baselinePath = path.resolve('tests/fpc-suite/baseline.json');
const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as { passing: string[] };
const verdicts = new Map(outcomes.map((outcome) => [outcome.test, outcome.verdict]));
const listed = new Set(baseline.passing);
const regressions = baseline.passing.filter((test) => ['fail', 'error'].includes(verdicts.get(test)?.category ?? ''));
const unjudged = baseline.passing.filter((test) => !['pass', 'fail', 'error'].includes(verdicts.get(test)?.category ?? ''));
const newPasses = outcomes.filter((outcome) => outcome.verdict.category === 'pass' && !listed.has(outcome.test)).map((outcome) => outcome.test);
console.log(`\nBaseline: ${String(baseline.passing.length - unjudged.length)} of ${String(baseline.passing.length)} listed passes judged here`);
if (newPasses.length) console.log(`  ${String(newPasses.length)} newly passing: ${newPasses.join(', ')}`);
if (process.env.FPC_SUITE_UPDATE) {
  const passing = [...new Set([...unjudged, ...outcomes.filter((o) => o.verdict.category === 'pass').map((o) => o.test)])].sort();
  await writeFile(baselinePath, JSON.stringify({ ...baseline, passing }, null, 2) + '\n');
  console.log(`  Wrote ${String(passing.length)} passing tests to ${path.relative(process.cwd(), baselinePath)}`);
} else if (regressions.length) {
  console.log(`  ${String(regressions.length)} no longer pass:`);
  for (const test of regressions) console.log(`    ${test}: ${verdicts.get(test)?.reason ?? ''}`);
  process.exitCode = 1;
} else if (newPasses.length) console.log('  Run bun run test:fpc-suite:update to add them.');
