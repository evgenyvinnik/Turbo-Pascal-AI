/**
 * Prints a reference screenshot as colour runs per row, so dialog geometry can
 * be read off exactly:  bun tests/e2e/fidelity/dump.ts Linker Debugger
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { COLS, NAMES, ROWS, refGrid } from './grid';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference');
const names = process.argv.slice(2);
const rowsArg = process.env.ROWS?.split('-').map(Number);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

for (const name of names) {
  const file = path.join(dir, name.endsWith('.png') ? name : `${name}.png`);
  const g = await refGrid(page, fs.readFileSync(file));
  console.log(`== ${name}`);
  const from = rowsArg?.[0] ?? 0;
  const to = rowsArg?.[1] ?? ROWS - 1;
  for (let y = from; y <= to; y += 1) {
    const runs: string[] = [];
    let start = 0;
    let key = '';
    for (let x = 0; x <= COLS; x += 1) {
      const i = y * COLS + x;
      const k =
        x === COLS ? '' : g.blank[i] ? `_${String(NAMES[g.bg[i]!])}` : `${String(NAMES[g.fg[i]!])}${String(NAMES[g.bg[i]!])}`;
      if (x === 0) key = k;
      if (k !== key) {
        runs.push(`${String(start)}-${String(x - 1)}:${key}`);
        start = x;
        key = k;
      }
    }
    console.log(`${String(y).padStart(2)} ${runs.join(' ')}`);
  }
}
await browser.close();
