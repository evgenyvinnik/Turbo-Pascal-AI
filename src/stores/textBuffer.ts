export interface Pos {
  line: number;
  col: number;
}

export const clampPos = (lines: string[], p: Pos): Pos => {
  const line = Math.max(0, Math.min(lines.length - 1, p.line));
  const col = Math.max(0, Math.min((lines[line] ?? '').length, p.col));
  return { line, col };
};

export const comparePos = (a: Pos, b: Pos): number =>
  a.line !== b.line ? a.line - b.line : a.col - b.col;

export const orderRange = (a: Pos, b: Pos): [Pos, Pos] =>
  comparePos(a, b) <= 0 ? [a, b] : [b, a];

export const getRange = (lines: string[], a: Pos, b: Pos): string => {
  const [s, e] = orderRange(a, b);
  if (s.line === e.line) return (lines[s.line] ?? '').slice(s.col, e.col);
  const out: string[] = [(lines[s.line] ?? '').slice(s.col)];
  for (let i = s.line + 1; i < e.line; i += 1) out.push(lines[i] ?? '');
  out.push((lines[e.line] ?? '').slice(0, e.col));
  return out.join('\n');
};

export const deleteRange = (lines: string[], a: Pos, b: Pos): Pos => {
  const [s, e] = orderRange(a, b);
  const head = (lines[s.line] ?? '').slice(0, s.col);
  const tail = (lines[e.line] ?? '').slice(e.col);
  lines.splice(s.line, e.line - s.line + 1, head + tail);
  return { ...s };
};

export const insertText = (lines: string[], at: Pos, text: string): Pos => {
  const parts = text.split('\n');
  const cur = lines[at.line] ?? '';
  const head = cur.slice(0, at.col);
  const tail = cur.slice(at.col);
  if (parts.length === 1) {
    const only = parts[0] ?? '';
    lines[at.line] = head + only + tail;
    return { line: at.line, col: at.col + only.length };
  }
  const inserted = parts.map((p, i) => {
    if (i === 0) return head + p;
    if (i === parts.length - 1) return p + tail;
    return p;
  });
  lines.splice(at.line, 1, ...inserted);
  const last = parts[parts.length - 1] ?? '';
  return { line: at.line + parts.length - 1, col: last.length };
};

/** Splits source text into editor lines, normalising DOS line endings. */
export const toLines = (text: string): string[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.length > 0 ? lines : [''];
};

export const fromLines = (lines: string[]): string => lines.join('\r\n');

const WORD = /[A-Za-z0-9_]/;

export const wordStart = (line: string, col: number): number => {
  let i = col;
  while (i > 0 && !WORD.test(line[i - 1] ?? '')) i -= 1;
  while (i > 0 && WORD.test(line[i - 1] ?? '')) i -= 1;
  return i;
};

export const wordEnd = (line: string, col: number): number => {
  let i = col;
  while (i < line.length && WORD.test(line[i] ?? '')) i += 1;
  while (i < line.length && !WORD.test(line[i] ?? '')) i += 1;
  return i;
};
