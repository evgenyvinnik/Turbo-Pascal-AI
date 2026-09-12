import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { Ide } from './ide';
import { diffGrids, formatReport, ourGrid, refGrid } from './fidelity/grid';
import { STATES } from './fidelity/states';

/**
 * Cell-attribute comparison against the Turbo Pascal 7.1 reference gallery.
 * Glyph shapes differ between the CP437 font and the browser font, so every
 * cell is compared by colour and by whether it carries ink. Reports land in
 * test-results/fidelity/<state>.txt. Fetch references first with
 * `bun run fidelity:fetch`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const refDir = path.join(here, 'fidelity', 'reference');
const outDir = path.join(here, '..', '..', 'test-results', 'fidelity');

for (const state of STATES) {
  test(state.name, async ({ page }) => {
    const refFile = path.join(refDir, `${state.ref}.png`);
    test.skip(!fs.existsSync(refFile), `reference ${state.ref}.png missing; run bun run fidelity:fetch`);

    const ide = await Ide.open(page);
    await state.drive(ide);
    await page.waitForTimeout(150);

    const ours = await ourGrid(page);
    const ref = await refGrid(page, fs.readFileSync(refFile));
    const diff = diffGrids(ours, ref, state.ignore);

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${state.name}.txt`), formatReport(state.name, ours, ref, diff));
    console.log(`${state.name.padEnd(28)} ${String(diff.count).padStart(5)} cells`);

    expect(diff.count, `see test-results/fidelity/${state.name}.txt`).toBeLessThanOrEqual(
      state.budget ?? 0,
    );
  });
}
