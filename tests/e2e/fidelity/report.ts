/** Fresh, serial Chromium captures against every entry in the audited gallery. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { Ide } from '../ide';
import gallery from './gallery.json';
import {
  MODIFIED_REFERENCES,
  REPORT_STATES,
  UPPERCASE_RESULT_REFERENCES,
  unmatchedReason,
} from './report-states';
import { compareRaster, type RasterMask } from './raster';
import { ourGrid, refGrid, diffGrids, formatReport } from './grid';
import { renderReport } from './report-template';
import { coverageMarkdown } from './report-manifest';

/** Match the gallery's example filename through Save As, using only real UI actions. */
class GalleryIde extends Ide {
  reference = '';

  override async markModified(): Promise<void> {
    if (MODIFIED_REFERENCES.has(this.reference)) await super.markModified();
  }

  override async openFile(name: string): Promise<void> {
    await super.openFile(name);
    if (name !== 'SQUARE.PAS') return;
    if (UPPERCASE_RESULT_REFERENCES.has(this.reference)) {
      await this.moveTo(14, 1);
      await this.press('Shift+End');
      await this.type('     writeln(RES);');
      await this.moveTo(1, 1);
    }
    await this.openMenu('F');
    await this.press('a');
    await this.type('HELLO.PAS');
    await this.press('Enter');
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const references = path.join(root, 'tests/e2e/fidelity/reference');
const output = path.resolve(root, process.env.FIDELITY_REPORT_DIR ?? 'artifacts/fidelity-report');
const baseURL = process.env.FIDELITY_BASE_URL ?? 'http://127.0.0.1:3000';
const filter = new Set((process.env.FIDELITY_ONLY ?? '').split(',').filter(Boolean));
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, 'images'), { recursive: true });

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const fingerprint = () => {
  const digest = createHash('sha256');
  const walk = (dir: string) => {
    for (const item of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else {
        digest.update(path.relative(root, full));
        digest.update(fs.readFileSync(full));
      }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'public'));
  return digest.digest('hex');
};

export interface ReportEntry {
  order: number;
  ref: string;
  url: string;
  state?: string;
  status: 'captured' | 'unmatched' | 'capture-error' | 'missing-reference' | 'filtered';
  equivalence: 'equivalent' | 'partial' | 'unmatched';
  note?: string;
  error?: string;
  capturedAt?: string;
  captureDriverHash?: string;
  sourceHash?: string;
  referenceHash?: string;
  actualHash?: string;
  masks?: RasterMask[];
  maskedPixels?: number;
  raw?: { pixels: number; compared: number; cells: { x: number; y: number; pixels: number }[] };
  adjusted?: {
    pixels: number;
    compared: number;
    cells: { x: number; y: number; pixels: number }[];
  };
  cellMismatches?: number;
  images?: { reference?: string; actual?: string; rawDiff?: string; maskedDiff?: string };
}
export interface ReportData {
  gallery: string;
  galleryVerifiedOn: string;
  generatedAt: string;
  finishedAt?: string;
  baseURL: string;
  browser: string;
  sourceHashStart: string;
  sourceHashEnd?: string;
  sourceChangedDuringCapture?: boolean;
  driverHash: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  entries: ReportEntry[];
}

const masksFor = (state: (typeof REPORT_STATES)[number]): RasterMask[] =>
  // Report fixtures match the original filenames, so legacy title masks are unnecessary.
  (state.ignore ?? [])
    .filter((rect) => !(rect.x === 20 && rect.w === 40 && rect.h === 1))
    .map((rect) => ({
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      reason:
        rect.y === 24
          ? 'The gallery status hint contains a machine-specific startup message. This rectangle is excluded only from the adjusted metric.'
          : `Variable file listings, DOS paths, typed values, or program output in the existing ${state.name} cell-test exclusion. The adjusted raster metric excludes the entire rectangle; the separate cell metric still checks its background when mode=text.`,
    }));

const prior: ReportData | undefined =
  process.env.FIDELITY_UPDATE === '1'
    ? (JSON.parse(fs.readFileSync(path.join(output, 'coverage.json'), 'utf8')) as ReportData)
    : undefined;
if (
  prior &&
  (!filter.size ||
    !prior.finishedAt ||
    prior.entries.length !== gallery.screenshots.length ||
    prior.entries.some((entry) => entry.status !== 'captured' && entry.status !== 'unmatched') ||
    prior.sourceChangedDuringCapture ||
    prior.sourceHashEnd !== fingerprint())
) {
  throw new Error(
    'FIDELITY_UPDATE requires selected states and a complete prior report for the unchanged source. Run a full capture after source changes.'
  );
}
for (const selected of filter) {
  if (!REPORT_STATES.some((state) => state.ref === selected || state.name === selected)) {
    throw new Error(`Unknown fidelity state: ${selected}`);
  }
}
const browser = await chromium.launch({ headless: true });
const data: ReportData = {
  gallery: gallery.gallery,
  galleryVerifiedOn: gallery.verifiedOn,
  generatedAt: prior?.generatedAt ?? new Date().toISOString(),
  baseURL,
  browser: `Chromium ${browser.version()}`,
  sourceHashStart: fingerprint(),
  driverHash: hash(
    Buffer.concat(
      ['./report.ts', './report-states.ts', './states.ts', '../ide.ts'].map((file) =>
        fs.readFileSync(fileURLToPath(new URL(file, import.meta.url)))
      )
    )
  ),
  viewport: { width: 720, height: 400, deviceScaleFactor: 1 },
  entries: [],
};

const saveManifest = () =>
  fs.writeFileSync(path.join(output, 'coverage.json'), JSON.stringify(data, null, 2) + '\n');
try {
  for (const item of gallery.screenshots) {
    const state = REPORT_STATES.find((candidate) => candidate.ref === item.ref);
    if (prior && !filter.has(item.ref) && !filter.has(state?.name ?? '')) {
      const retained = prior.entries.find((entry) => entry.ref === item.ref)!;
      data.entries.push({
        ...retained,
        captureDriverHash: retained.captureDriverHash ?? prior.driverHash,
      });
      continue;
    }
    const entry: ReportEntry = {
      order: item.order,
      ref: item.ref,
      url: item.url,
      status: state ? 'capture-error' : 'unmatched',
      equivalence: state ? (state.equivalence ?? 'equivalent') : 'unmatched',
      ...(state
        ? {
            state: state.name,
            ...(state.note ? { note: state.note } : {}),
            masks: masksFor(state),
          }
        : { note: unmatchedReason(item.ref) }),
    };
    data.entries.push(entry);
    const refFile = path.join(references, `${item.ref}.png`);
    if (!fs.existsSync(refFile)) {
      entry.status = 'missing-reference';
      entry.error = 'Run bun run fidelity:fetch';
      saveManifest();
      continue;
    }
    const reference = fs.readFileSync(refFile);
    entry.referenceHash = hash(reference);
    entry.images = { reference: `images/${item.ref}-reference.png` };
    fs.writeFileSync(path.join(output, entry.images.reference!), reference);
    if (!state) {
      saveManifest();
      continue;
    }
    if (filter.size && !filter.has(state.name) && !filter.has(item.ref)) {
      entry.status = 'filtered';
      saveManifest();
      continue;
    }

    const context = await browser.newContext({
      viewport: { width: 720, height: 400 },
      deviceScaleFactor: 1,
      baseURL,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    try {
      const sourceBeforeDrive = fingerprint();
      await Ide.open(page);
      const ide = new GalleryIde(page);
      ide.reference = item.ref;
      await state.drive(ide);
      await page.waitForTimeout(150);
      const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      entry.capturedAt = new Date().toISOString();
      entry.captureDriverHash = data.driverHash;
      entry.sourceHash = fingerprint();
      if (sourceBeforeDrive !== entry.sourceHash) {
        throw new Error(
          'Source files changed during this state driver. A hot reload may reset the UI; regenerate after edits finish.'
        );
      }
      entry.actualHash = hash(actual);
      entry.images.actual = `images/${state.name}-current.png`;
      fs.writeFileSync(path.join(output, entry.images.actual), actual);
      const raw = await compareRaster(page, actual, reference);
      const adjusted = entry.masks?.length
        ? await compareRaster(page, actual, reference, entry.masks)
        : raw;
      entry.raw = { pixels: raw.pixels, compared: raw.compared, cells: raw.cells };
      entry.adjusted = {
        pixels: adjusted.pixels,
        compared: adjusted.compared,
        cells: adjusted.cells,
      };
      entry.maskedPixels = raw.compared - adjusted.compared;
      const ours = await ourGrid(page),
        theirs = await refGrid(page, reference);
      const cells = diffGrids(ours, theirs, state.ignore);
      entry.cellMismatches = cells.count;
      fs.writeFileSync(
        path.join(output, `${state.name}-cells.txt`),
        formatReport(state.name, ours, theirs, cells)
      );
      entry.images.rawDiff = `images/${state.name}-diff.png`;
      entry.images.maskedDiff = `images/${state.name}-masked-diff.png`;
      fs.writeFileSync(path.join(output, entry.images.rawDiff), Buffer.from(raw.image, 'base64'));
      fs.writeFileSync(
        path.join(output, entry.images.maskedDiff),
        Buffer.from(adjusted.image, 'base64')
      );
      entry.status = 'captured';
      console.log(
        `${state.name.padEnd(28)} raw ${String(raw.pixels).padStart(6)} / adjusted ${String(adjusted.pixels).padStart(6)} pixels / ${cells.count} cells${entry.equivalence === 'partial' ? ' (partial subject)' : ''}`
      );
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      entry.status = 'capture-error';
      console.error(`${state.name}: ${entry.error}`);
    } finally {
      await context.close();
      saveManifest();
    }
  }
} finally {
  await browser.close();
}

data.finishedAt = new Date().toISOString();
data.sourceHashEnd = fingerprint();
data.sourceChangedDuringCapture =
  data.sourceHashStart !== data.sourceHashEnd ||
  data.entries.some(
    (entry) => entry.status === 'captured' && entry.sourceHash !== data.sourceHashStart
  );
saveManifest();
fs.writeFileSync(path.join(output, 'index.html'), renderReport(data));
fs.writeFileSync(path.join(output, 'coverage.md'), coverageMarkdown(data));
const captured = data.entries.filter((entry) => entry.status === 'captured');
const exact = captured.filter((entry) => entry.raw?.pixels === 0);
console.log(
  `\nReport: ${path.join(output, 'index.html')}\n${captured.length}/${data.entries.length} gallery subjects captured; ${exact.length} unmasked exact matches.`
);
if (data.sourceChangedDuringCapture)
  console.warn(
    'Source changed during capture. Regenerate after edits finish for a single-revision report.'
  );
if (
  data.sourceChangedDuringCapture ||
  data.entries.some((entry) => ['capture-error', 'missing-reference'].includes(entry.status))
)
  process.exitCode = 1;
