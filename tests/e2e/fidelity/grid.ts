import type { Page } from '@playwright/test';

export const COLS = 80;
export const ROWS = 25;
const CELL_W = 9;
const CELL_H = 16;

/** VGA palette as the reference PNGs store it. */
export const PALETTE = [
  '000000', '0000a8', '00a800', '00a8a8', 'a80000', 'a800a8', 'a85700', 'a8a8a8',
  '575757', '5757ff', '57ff57', '57ffff', 'ff5757', 'ff57ff', 'ffff57', 'ffffff',
];

/** One letter per palette entry, for compact reports. */
export const NAMES = 'KBGCRMNWDbgcrmYF';

export interface Grid {
  fg: number[];
  bg: number[];
  blank: boolean[];
  ch: string[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * `all` skips a region entirely; `text` still checks the background colour but
 * ignores which glyphs are there (file names, typed values, program output).
 */
export interface Ignore extends Rect {
  mode?: 'all' | 'text';
}

/** Reads the painted cell grid straight from the rendered DOM. */
export async function ourGrid(page: Page): Promise<Grid> {
  return page.evaluate(
    ({ palette, cols, rows }) => {
      const rgb = palette.map((h) => [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ]);
      const nearest = (css: string): number => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
        if (!m) return 0;
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        let best = 0;
        let dist = Infinity;
        rgb.forEach(([pr, pg, pb], i) => {
          const d = (pr! - r) ** 2 + (pg! - g) ** 2 + (pb! - b) ** 2;
          if (d < dist) {
            dist = d;
            best = i;
          }
        });
        return best;
      };
      const n = cols * rows;
      const grid = {
        fg: new Array<number>(n).fill(0),
        bg: new Array<number>(n).fill(0),
        blank: new Array<boolean>(n).fill(true),
        ch: new Array<string>(n).fill(' '),
      };
      const screen = document.querySelector<HTMLElement>('[data-testid="tp-screen"] > div');
      if (!screen) throw new Error('screen not rendered');
      const cw = screen.getBoundingClientRect().width / cols;
      for (const row of Array.from(screen.querySelectorAll<HTMLElement>('[data-row]'))) {
        const y = Number(row.dataset.row);
        for (const span of Array.from(row.querySelectorAll<HTMLElement>('span'))) {
          const cs = getComputedStyle(span);
          const fg = nearest(cs.color);
          const bg = nearest(cs.backgroundColor);
          const x0 = Math.round(parseFloat(span.style.left) / cw);
          Array.from(span.textContent).forEach((c, i) => {
            const idx = y * cols + x0 + i;
            grid.fg[idx] = fg;
            grid.bg[idx] = bg;
            grid.ch[idx] = c;
            grid.blank[idx] = c === ' ' || c === ' ' || fg === bg;
          });
        }
      }
      // The caret is painted over the bitmap, outside the semantic text rows.
      // Count its ink too: gallery captures can show it on an otherwise blank cell.
      const caret = screen.querySelector<HTMLElement>('[data-testid="tp-cursor"]');
      if (caret && getComputedStyle(caret).opacity !== '0') {
        const bounds = screen.getBoundingClientRect();
        const cursor = caret.getBoundingClientRect();
        const x = Math.floor((cursor.x - bounds.x) / cw);
        const y = Math.floor((cursor.y - bounds.y) / (bounds.height / rows));
        if (cursor.width > 0 && cursor.height > 0 && x >= 0 && x < cols && y >= 0 && y < rows) {
          const idx = y * cols + x;
          grid.fg[idx] = nearest(getComputedStyle(caret).backgroundColor);
          grid.blank[idx] = grid.fg[idx] === grid.bg[idx];
          if (grid.ch[idx] === ' ') grid.ch[idx] = '▁';
        }
      }
      return grid;
    },
    { palette: PALETTE, cols: COLS, rows: ROWS },
  );
}

/**
 * Decodes a 720x400 reference screenshot into cells: the dominant colour is the
 * background, the runner-up (if it covers a few pixels) the foreground.
 */
export async function refGrid(page: Page, png: Buffer): Promise<Grid> {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  return page.evaluate(
    async ({ dataUrl, palette, cols, rows, cw, ch }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      if (img.naturalWidth !== cols * cw || img.naturalHeight !== rows * ch) {
        throw new Error(`reference is ${String(img.naturalWidth)}x${String(img.naturalHeight)}`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = palette.map((h) => [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ]);
      const cache = new Map<number, number>();
      const nearest = (r: number, g: number, b: number): number => {
        const key = (r << 16) | (g << 8) | b;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        let best = 0;
        let dist = Infinity;
        rgb.forEach(([pr, pg, pb], i) => {
          const d = (pr! - r) ** 2 + (pg! - g) ** 2 + (pb! - b) ** 2;
          if (d < dist) {
            dist = d;
            best = i;
          }
        });
        cache.set(key, best);
        return best;
      };
      const n = cols * rows;
      const grid = {
        fg: new Array<number>(n).fill(0),
        bg: new Array<number>(n).fill(0),
        blank: new Array<boolean>(n).fill(true),
        ch: new Array<string>(n).fill(' '),
      };
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const counts = new Array<number>(16).fill(0);
          for (let py = 0; py < ch; py += 1) {
            for (let px = 0; px < cw; px += 1) {
              const i = ((y * ch + py) * canvas.width + x * cw + px) * 4;
              counts[nearest(data[i]!, data[i + 1]!, data[i + 2]!)]! += 1;
            }
          }
          const order = counts
            .map((c, i) => [c, i] as const)
            .filter(([c]) => c > 0)
            .sort((a, b) => b[0] - a[0]);
          const idx = y * cols + x;
          grid.bg[idx] = order[0]![1];
          const second = order[1];
          if (second && second[0] >= 3) {
            grid.fg[idx] = second[1];
            grid.blank[idx] = false;
          } else {
            grid.fg[idx] = order[0]![1];
          }
        }
      }
      return grid;
    },
    { dataUrl, palette: PALETTE, cols: COLS, rows: ROWS, cw: CELL_W, ch: CELL_H },
  );
}

export interface DiffGroup {
  kind: 'presence' | 'background' | 'colour';
  ours: string;
  ref: string;
  count: number;
  box: Rect;
  cells: [number, number][];
}

export interface DiffResult {
  count: number;
  map: string[];
  groups: DiffGroup[];
}

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

const pair = (fg: number, bg: number) => `${String(NAMES[fg])}/${String(NAMES[bg])}`;
const set = (fg: number, bg: number) => [fg, bg].sort((a, b) => a - b).join(',');

/**
 * Compares cell attributes. Glyph shapes differ between the CP437 bitmap font
 * and the browser font, so for inked cells only the unordered colour pair is
 * compared; that stays robust for shade and block characters whose coverage
 * flips which colour dominates.
 */
export function diffGrids(ours: Grid, ref: Grid, ignore: Ignore[] = []): DiffResult {
  const map: string[] = [];
  const groups = new Map<string, DiffGroup>();
  let count = 0;

  const note = (kind: DiffGroup['kind'], x: number, y: number, o: string, r: string) => {
    const key = `${kind}|${o}|${r}`;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.cells.push([x, y]);
      const x2 = Math.max(g.box.x + g.box.w, x + 1);
      const y2 = Math.max(g.box.y + g.box.h, y + 1);
      g.box.x = Math.min(g.box.x, x);
      g.box.y = Math.min(g.box.y, y);
      g.box.w = x2 - g.box.x;
      g.box.h = y2 - g.box.y;
    } else {
      groups.set(key, { kind, ours: o, ref: r, count: 1, box: { x, y, w: 1, h: 1 }, cells: [[x, y]] });
    }
    count += 1;
  };

  for (let y = 0; y < ROWS; y += 1) {
    let line = '';
    for (let x = 0; x < COLS; x += 1) {
      const i = y * COLS + x;
      const rule = ignore.find((r) => inside(r, x, y));
      if (rule && (rule.mode ?? 'all') === 'all') {
        line += ' ';
        continue;
      }
      const textOnly = rule?.mode === 'text';
      const o = { fg: ours.fg[i]!, bg: ours.bg[i]!, blank: ours.blank[i]! };
      const r = { fg: ref.fg[i]!, bg: ref.bg[i]!, blank: ref.blank[i]! };

      if (textOnly) {
        const oBg = o.blank ? o.bg : o.bg;
        if (oBg !== r.bg && !(!r.blank && (r.fg === oBg))) {
          note('background', x, y, pair(o.fg, o.bg), pair(r.fg, r.bg));
          line += 'B';
        } else line += '.';
        continue;
      }

      if (o.blank !== r.blank) {
        note('presence', x, y, o.blank ? `blank ${String(NAMES[o.bg])}` : `'${String(ours.ch[i])}' ${pair(o.fg, o.bg)}`, r.blank ? `blank ${String(NAMES[r.bg])}` : `ink ${pair(r.fg, r.bg)}`);
        line += 'P';
      } else if (o.blank) {
        if (o.bg !== r.bg) {
          note('background', x, y, NAMES[o.bg]!, NAMES[r.bg]!);
          line += 'B';
        } else line += '.';
      } else if (set(o.fg, o.bg) !== set(r.fg, r.bg)) {
        note('colour', x, y, `'${String(ours.ch[i])}' ${pair(o.fg, o.bg)}`, pair(r.fg, r.bg));
        line += 'C';
      } else line += '.';
    }
    map.push(line);
  }

  return {
    count,
    map,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
  };
}

export function formatReport(name: string, ours: Grid, ref: Grid, diff: DiffResult): string {
  const text: string[] = [];
  const refInk: string[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    text.push(ours.ch.slice(y * COLS, (y + 1) * COLS).join(''));
    let line = '';
    for (let x = 0; x < COLS; x += 1) {
      const i = y * COLS + x;
      line += ref.blank[i] ? NAMES[ref.bg[i]!]!.toLowerCase() === NAMES[ref.bg[i]!] ? ' ' : ' ' : '#';
    }
    refInk.push(line);
  }
  const pad = (n: number) => String(n).padStart(2);
  const out = [`${name}: ${String(diff.count)} mismatched cells`, ''];
  out.push('    ours'.padEnd(84) + 'diff (P presence, B background, C colour)');
  for (let y = 0; y < ROWS; y += 1) out.push(`${pad(y)}  ${String(text[y])}  ${String(diff.map[y])}`);
  out.push('', '    reference ink');
  for (let y = 0; y < ROWS; y += 1) out.push(`${pad(y)}  ${String(refInk[y])}`);
  out.push('', 'groups:');
  for (const g of diff.groups.slice(0, 40)) {
    out.push(
      `  ${String(g.count).padStart(4)} ${g.kind.padEnd(10)} ours ${g.ours.padEnd(16)} ref ${g.ref.padEnd(10)} at x${String(g.box.x)}..${String(g.box.x + g.box.w - 1)} y${String(g.box.y)}..${String(g.box.y + g.box.h - 1)}`,
    );
  }
  return out.join('\n');
}
