import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { PascalError } from '../../src/compiler/errors';
import { referenceCases, type ReferenceCase } from './corpus';

const execute = promisify(execFile);
const compiler = process.env.FPC_BIN ?? 'fpc';
const reportPath = path.resolve(process.env.PASCAL_REFERENCE_REPORT ?? 'artifacts/verification/pascal-reference.json');
const startedAt = new Date().toISOString();
const selectedCases = process.env.PASCAL_REFERENCE_FILTER
  ? referenceCases.filter(subject => subject.name.includes(process.env.PASCAL_REFERENCE_FILTER!))
  : referenceCases;
await mkdir(path.dirname(reportPath), { recursive: true });
// An interrupted or unavailable reference run must not leave an old success
// report looking like the result of this attempt.
await writeFile(reportPath, `${JSON.stringify({ status: 'running', startedAt, compiler }, null, 2)}\n`);
const temporary = await mkdtemp(path.join(tmpdir(), 'turbo-pascal-reference-'));
let compilerFlags: string[] = [];
const normalize = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function fingerprint(): Promise<string> {
  const hash = createHash('sha256');
  async function walk(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else { hash.update(full); hash.update(await readFile(full)); }
    }
  }
  await walk('src/compiler');
  await walk('tests/reference');
  return hash.digest('hex');
}

function localResult(subject: ReferenceCase) {
  let bytecode;
  try {
    bytecode = new Compiler().compile(new Parser(new Lexer(new Stream(subject.source))).parse(), {
      resolveUnit: name => Object.entries(subject.units ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1],
    });
  } catch (error) {
    return { compiled: false, output: null, error: String(error), diagnostic: error instanceof PascalError };
  }
  try {
    const machine = new Machine(bytecode, { maxInstructions: 100_000 });
    machine.setInput(subject.input ? subject.input.replace(/\n$/, '').split('\n') : []);
    machine.run();
    if (machine.getState() !== MachineState.STOPPED) throw new Error(`Unexpected VM state: ${String(machine.getState())}`);
    return { compiled: true, output: machine.getOutput(), error: null, diagnostic: false };
  } catch (error) {
    return { compiled: true, output: null, error: String(error), diagnostic: false };
  }
}

async function compare(subject: ReferenceCase) {
  const directory = path.join(temporary, subject.name);
  await mkdir(directory);
  const sourcePath = path.join(directory, 'program.pas');
  const executable = path.join(directory, process.platform === 'win32' ? 'program.exe' : 'program');
  await writeFile(sourcePath, subject.source);
  for (const [name, source] of Object.entries(subject.units ?? {})) await writeFile(path.join(directory, `${name.toLowerCase()}.pas`), source);
  const local = localResult(subject);
  let reference;
  try {
    await execute(compiler, [...compilerFlags, `-o${executable}`, sourcePath], {
      cwd: directory, timeout: 60_000, maxBuffer: 1024 * 1024,
    });
    reference = { compiled: true, output: null as string[] | null, error: null as string | null };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string; killed?: boolean };
    if (typeof failure.code !== 'number' || failure.killed) throw error;
    reference = { compiled: false, output: null, error: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
  if (reference.compiled) {
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = execFile(executable, [], { cwd: directory, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
          if (error) reject(error); else resolve(stdout);
        });
        child.stdin?.end(subject.input ?? '');
      });
      reference.output = normalize(output);
    } catch (error) { reference.error = String(error); }
  }
  const referenceMatchesExpectation = subject.reject
    ? !reference.compiled : reference.compiled && reference.error === null && equal(reference.output, subject.output);
  const enginesAgree = subject.reject
    ? !local.compiled && local.diagnostic && !reference.compiled
    : local.compiled && reference.compiled && local.error === null && reference.error === null && equal(local.output, reference.output);
  return {
    name: subject.name, passed: referenceMatchesExpectation && enginesAgree,
    referenceMatchesExpectation, enginesAgree,
    sourceHash: createHash('sha256').update(subject.source).update(JSON.stringify(subject.units ?? {})).digest('hex'),
    expected: subject.reject ? 'compile rejection' : subject.output,
    local, reference,
  };
}

try {
  if (!selectedCases.length) throw new Error('No reference cases matched PASCAL_REFERENCE_FILTER');
  const flags: unknown = JSON.parse(process.env.FPC_FLAGS_JSON ?? '[]');
  if (!Array.isArray(flags) || !flags.every(value => typeof value === 'string')) {
    throw new Error('FPC_FLAGS_JSON must be a JSON array of separate compiler arguments.');
  }
  compilerFlags = ['-Mtp', ...flags as string[]];
  // Fail explicitly if the independent compiler is absent; never report a skip
  // as a successful differential run. Every ordinary Vitest run remains local.
  const version = (await execute(compiler, ['-iV'], { timeout: 15_000 })).stdout.trim();
  const sourceHashStart = await fingerprint();
  const results: Awaited<ReturnType<typeof compare>>[] = [];
  // Bound native compilation/linking concurrency independently of Vitest.
  for (let index = 0; index < selectedCases.length; index += 2) {
    const batch = await Promise.all(selectedCases.slice(index, index + 2).map(compare));
    results.push(...batch);
    for (const result of batch) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  }
  const sourceHashEnd = await fingerprint();
  const report = {
    status: results.every(result => result.passed) && sourceHashStart === sourceHashEnd ? 'passed' : 'failed',
    startedAt, finishedAt: new Date().toISOString(), compiler, version, flags: compilerFlags,
    mode: 'Turbo Pascal compatibility', selectedCases: selectedCases.length, filter: process.env.PASCAL_REFERENCE_FILTER ?? null, generatedSeed: '0x5eed1234',
    sourceHashStart, sourceHashEnd, sourceChangedDuringRun: sourceHashStart !== sourceHashEnd,
    scope: 'Portable language semantics, typed input and text files; compares output lines with normalized line endings. Excludes DOS/hardware, Real48 ABI and unsupported dialect extensions.',
    passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length,
    results,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.passed}/${results.length} agree with Free Pascal ${version}; report: ${reportPath}`);
  if (report.failed || report.sourceChangedDuringRun) process.exitCode = 1;
} catch (error) {
  await writeFile(reportPath, `${JSON.stringify({
    status: 'failed', startedAt, finishedAt: new Date().toISOString(), compiler,
    infrastructureError: String(error),
  }, null, 2)}\n`);
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
