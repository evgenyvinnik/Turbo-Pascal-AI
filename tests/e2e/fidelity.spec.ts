import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { Ide } from './ide';
import { diffGrids, formatReport, ourGrid, refGrid } from './fidelity/grid';
import { STATES } from './fidelity/states';
import { REPORT_STATES } from './fidelity/report-states';
import { compareRaster, rasterReport, type RasterMask } from './fidelity/raster';

/**
 * Cell-attribute comparison against the Turbo Pascal 7.1 reference gallery.
 * Every cell is compared by colour and by whether it carries ink, providing
 * useful layout diagnostics alongside exact raster comparisons. Reports land in
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

/**
 * These gallery states have reproducible content. Compare rendered pixels,
 * with no colour tolerance and no allowance for changed font shapes. The
 * reference files are deliberately separate from updateable visual snapshots.
 */
test.describe('exact gallery pixels', () => {
  const names = ['main-view', 'menu-file', 'menu-edit', 'menu-search', 'menu-run',
    'menu-compile', 'menu-debug', 'menu-tools', 'menu-options', 'menu-window', 'menu-help'];
  for (const name of names) {
    const state = STATES.find((candidate) => candidate.name === name)!;
    test(name, async ({ page }, testInfo) => {
      const refFile = path.join(refDir, `${state.ref}.png`);
      test.skip(!fs.existsSync(refFile), `reference ${state.ref}.png missing; run bun run fidelity:fetch`);
      const ide = await Ide.open(page);
      await state.drive(ide);
      const masks: RasterMask[] = name === 'main-view' ? [{
        x: 32, y: 1, w: 16, h: 1,
        reason: 'The bundled square example is named SQUARE.PAS; the gallery calls this file HELLO.PAS.',
      }] : [];
      const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      const reference = fs.readFileSync(refFile);
      const diff = await compareRaster(page, actual, reference, masks);
      const report = rasterReport(name, diff, masks);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `${name}-pixels.txt`), report);
      if (diff.pixels) {
        await testInfo.attach('gallery-reference', { body: reference, contentType: 'image/png' });
        await testInfo.attach('rendered-screen', { body: actual, contentType: 'image/png' });
        await testInfo.attach('pixel-diff', { body: Buffer.from(diff.image, 'base64'), contentType: 'image/png' });
        await testInfo.attach('pixel-report', { body: report, contentType: 'text/plain' });
      }
      expect(diff.pixels, `see test-results/fidelity/${name}-pixels.txt`).toBe(0);
    });
  }

  test('integer scaling preserves pixels and mouse coordinates', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    const native = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect(page.getByTestId('tp-bitmap')).toHaveCSS('width', '1440px');
    const scaled = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    const diff = await compareRaster(page, scaled, native, [], 2);
    expect(diff.pixels, 'Every native pixel should become an identical 2×2 block').toBe(0);
    await ide.press('Escape');
    await ide.clickCell(3, 0);
    await expect(ide.row(24)).toContainText('Create a new file in a new Edit window');
    await ide.clickCell(4, 2);
    await expect(ide.row(1)).toContainText('NONAME01.PAS');
  });

  test('a single call frame has the original disabled scrollbar', async ({ page }, testInfo) => {
    const refFile = path.join(refDir, 'Call-stack-3.png');
    test.skip(!fs.existsSync(refFile), 'reference Call-stack-3.png missing; run bun run fidelity:fetch');
    const ide = await Ide.open(page);
    await ide.press('Alt+F3');
    await ide.openFile('HELLO.PAS');
    await ide.moveTo(2, 1);
    await ide.press('F4');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.press('Control+F3');
    await expect(ide.row(18)).toContainText('Hello');

    const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    const reference = fs.readFileSync(refFile);
    const diff = await compareRaster(page, actual, reference, []);
    if (diff.pixels) {
      await testInfo.attach('gallery-reference', { body: reference, contentType: 'image/png' });
      await testInfo.attach('rendered-screen', { body: actual, contentType: 'image/png' });
      await testInfo.attach('pixel-diff', { body: Buffer.from(diff.image, 'base64'), contentType: 'image/png' });
    }
    expect(diff.pixels, 'The complete single-frame Call Stack screen must match the original pixels').toBe(0);
  });

  for (const name of ['address-not-found', 'procedure-not-found']) {
    test(`${name} uses the original error dialog`, async ({ page }, testInfo) => {
      const state = REPORT_STATES.find((candidate) => candidate.name === name)!;
      const refFile = path.join(refDir, `${state.ref}.png`);
      test.skip(!fs.existsSync(refFile), `reference ${state.ref}.png missing; run bun run fidelity:fetch`);
      const ide = await Ide.open(page);
      await state.drive(ide);
      const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      const reference = fs.readFileSync(refFile);
      const diff = await compareRaster(page, actual, reference, []);
      if (diff.pixels) {
        await testInfo.attach('gallery-reference', { body: reference, contentType: 'image/png' });
        await testInfo.attach('rendered-screen', { body: actual, contentType: 'image/png' });
        await testInfo.attach('pixel-diff', { body: Buffer.from(diff.image, 'base64'), contentType: 'image/png' });
      }
      expect(diff.pixels, 'The complete error screen must match the original, including wording and punctuation').toBe(0);
    });
  }
});

test('editor Help continuation uses the full document scroll range', async ({ page }, testInfo) => {
  const referenceFile = path.join(refDir, 'Help-2.png');
  test.skip(!fs.existsSync(referenceFile), 'reference Help-2.png missing; run bun run fidelity:fetch');
  const ide = await Ide.open(page);
  await ide.press('F1'); await ide.press('PageDown');
  const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const reference = fs.readFileSync(referenceFile);
  const diff = await compareRaster(page, actual, reference, []);
  if (diff.pixels) {
    await testInfo.attach('gallery-reference', { body: reference, contentType: 'image/png' });
    await testInfo.attach('rendered-screen', { body: actual, contentType: 'image/png' });
    await testInfo.attach('pixel-diff', { body: Buffer.from(diff.image, 'base64'), contentType: 'image/png' });
  }
  expect(diff.pixels, 'The complete editor Help continuation must match the original without masks').toBe(0);
});
