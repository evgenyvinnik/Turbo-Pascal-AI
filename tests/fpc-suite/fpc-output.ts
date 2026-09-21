import path from 'node:path';

/** Where a compiler reports an error. */
export interface ErrorSite { file: string; line: number }

/** The first error in Free Pascal's output, and where it is reported:
 * `file(line,col) Error: message`, where the column is sometimes absent. */
export function firstError(output: string): { message: string; site?: ErrorSite } {
  const located = /^(.+?)\((\d+)(?:,\d+)?\) (?:Error|Fatal): (.*)$/m.exec(output);
  if (located) return { message: located[3]!.trim(), site: { file: path.basename(located[1]!), line: Number(located[2]) } };
  return { message: (/(?:Error|Fatal): (.*)/.exec(output)?.[1] ?? output.trim().split('\n').at(-1) ?? '').trim() };
}

/** A must-fail test tests one error, so a rejection counts when it is at the
 * same place, give or take a line, since compilers differ on which token
 * reports it. A rejection for another reason close by still matches; the
 * report keeps both messages so such cases can be reviewed. */
export const samePlace = (a: ErrorSite, b: ErrorSite) =>
  a.file.toUpperCase() === b.file.toUpperCase() && Math.abs(a.line - b.line) <= 1;
