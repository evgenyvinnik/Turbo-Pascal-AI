import { C } from '@/tui/palette';

const RESERVED = new Set(
  (
    'absolute and array asm begin case const constructor destructor div do downto else end ' +
    'export exports external far file for forward function goto if implementation in inherited ' +
    'initialization inline interface interrupt label library mod near nil not object of or ' +
    'packed private procedure program public record repeat set shl shr string then to type unit ' +
    'until uses var virtual while with xor finalization'
  ).split(' '),
);

export const isReserved = (word: string): boolean => RESERVED.has(word.toLowerCase());

const IDENT_START = /[A-Za-z_]/;
const IDENT = /[A-Za-z0-9_]/;

/**
 * Turbo Pascal 7 paints reserved words white, comments gray and everything
 * else - identifiers, numbers, strings and punctuation - yellow.
 */
function colourLine(line: string, inComment: 0 | 1 | 2): { colours: number[]; next: 0 | 1 | 2 } {
  const out = new Array<number>(line.length).fill(C.Yellow);
  let i = 0;
  let state = inComment;

  while (i < line.length) {
    if (state === 1) {
      out[i] = C.LightGray;
      if (line[i] === '}') state = 0;
      i += 1;
      continue;
    }
    if (state === 2) {
      out[i] = C.LightGray;
      if (line[i] === '*' && line[i + 1] === ')') {
        out[i + 1] = C.LightGray;
        i += 2;
        state = 0;
        continue;
      }
      i += 1;
      continue;
    }
    const ch = line[i] ?? '';
    if (ch === '{') {
      state = 1;
      out[i] = C.LightGray;
      i += 1;
      continue;
    }
    if (ch === '(' && line[i + 1] === '*') {
      state = 2;
      out[i] = C.LightGray;
      out[i + 1] = C.LightGray;
      i += 2;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      for (let k = i; k < line.length; k += 1) out[k] = C.LightGray;
      return { colours: out, next: 0 };
    }
    if (ch === "'") {
      out[i] = C.Yellow;
      i += 1;
      while (i < line.length) {
        out[i] = C.Yellow;
        if (line[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (IDENT_START.test(ch)) {
      const start = i;
      while (i < line.length && IDENT.test(line[i] ?? '')) i += 1;
      if (isReserved(line.slice(start, i))) {
        for (let k = start; k < i; k += 1) out[k] = C.White;
      }
      continue;
    }
    i += 1;
  }
  return { colours: out, next: state };
}

const cache = new WeakMap<string[], number[][]>();

/** Per-character colour index for every line, memoised per buffer revision. */
export function highlight(lines: string[]): number[][] {
  const hit = cache.get(lines);
  if (hit) return hit;
  const out: number[][] = [];
  let state: 0 | 1 | 2 = 0;
  for (const line of lines) {
    const r = colourLine(line, state);
    state = r.next;
    out.push(r.colours);
  }
  cache.set(lines, out);
  return out;
}
