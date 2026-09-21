/**
 * Reads a Free Pascal test's `{ %NAME=value }` header the way FPC's own runner
 * does (GetConfig in tests/utils/testu.pp): lines are scanned from the top,
 * blank lines and ordinary `{ ... }` comments are passed over, a `{%` line is
 * a directive, and scanning stops at the first line not starting with `{`.
 * Names are uppercased; a directive without `=` has the value ''.
 */
export function readHeader(source: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trimStart();
    if (!line) continue;
    if (!line.startsWith('{')) break;
    const body = line.slice(1).trimStart();
    if (!body.startsWith('%')) continue;
    const match = /^%([A-Za-z]+)\s*(?:=([^}]*))?/.exec(body);
    if (match) directives.set(match[1]!.toUpperCase(), (match[2] ?? '').trim());
  }
  return directives;
}

/** What a test expects of the compiler and the program it builds. */
export interface Expectation {
  /** The compiler must reject the program. */
  failsToCompile: boolean;
  /** Compile only; the program is not run. */
  compileOnly: boolean;
  /** Expected exit code when run. */
  exitCode: number;
}

export function expectation(header: ReadonlyMap<string, string>): Expectation {
  const result = Number.parseInt(header.get('RESULT') ?? '0', 10);
  return {
    failsToCompile: header.has('FAIL'),
    compileOnly: header.has('NORUN'),
    exitCode: Number.isNaN(result) ? 0 : result,
  };
}
