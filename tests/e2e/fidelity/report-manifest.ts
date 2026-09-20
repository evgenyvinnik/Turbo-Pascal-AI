import type { ReportData } from './report';

/** Compact, human-readable inventory alongside the machine-readable manifest. */
export function coverageMarkdown(data: ReportData): string {
  const captured = data.entries.filter((entry) => entry.status === 'captured');
  const exact = captured.filter((entry) => entry.raw?.pixels === 0);
  const adjustedExact = captured.filter((entry) => entry.adjusted?.pixels === 0);
  const masked = captured.filter((entry) => (entry.maskedPixels ?? 0) > 0);
  const partial = captured.filter((entry) => entry.equivalence === 'partial');
  const missing = data.entries.filter((entry) => entry.status !== 'captured');
  const cell = (text: string | number | undefined) =>
    String(text ?? '—')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  const rows = data.entries.map((entry) => {
    const status =
      entry.status === 'captured'
        ? entry.equivalence === 'partial'
          ? 'Partial subject'
          : entry.raw?.pixels === 0
            ? 'Pixel exact'
            : 'Compared'
        : entry.status;
    return `| ${entry.order} | [${entry.ref}](${entry.url}) | ${status} | ${cell(entry.raw?.pixels)} | ${cell(entry.adjusted?.pixels)} | ${cell(entry.maskedPixels)} |`;
  });
  return [
    '# Turbo Pascal screenshot coverage',
    '',
    `[Open interactive comparison](index.html) · [Original gallery](${data.gallery}) · [Full JSON evidence](coverage.json)`,
    '',
    `${data.entries.length} gallery screenshots; ${captured.length} fresh captures; ${exact.length} unmasked pixel-exact matches; ${partial.length} partial subject mappings; ${missing.length} uncaptured.`,
    '',
    `${adjustedExact.length} zero-difference adjusted results; ${masked.length} subjects use the explicitly disclosed rectangular exclusions. Adjusted results do not establish full-image equality.`,
    '',
    `Captured ${data.generatedAt} through ${data.finishedAt ?? 'in progress'} with ${data.browser}, 720×400 at device scale 1.`,
    '',
    data.sourceChangedDuringCapture
      ? '**Source changed during this run. Regenerate after edits finish for a comparison of one source revision.**'
      : `Source and public asset SHA-256: \`${data.sourceHashEnd ?? data.sourceHashStart}\`.`,
    '',
    'Every full-image metric compares all 288,000 pixels with zero tolerance. “Outside masks” excludes the explicitly listed rectangles in the interactive report; it is not an exact-match claim. Partial mappings compare a related current subject and retain all differences in the full-image metric.',
    '',
    '| # | Gallery screenshot | Coverage | Full changed pixels | Outside masks | Excluded pixels |',
    '| ---: | --- | --- | ---: | ---: | ---: |',
    ...rows,
    '',
    '## Reference anomalies',
    '',
    ...data.entries
      .filter((entry) => entry.note?.includes('reference is internally inconsistent'))
      .map((entry) => `- **${entry.ref}**: ${entry.note}`),
    '',
    '## Uncaptured and partial subjects',
    '',
    ...data.entries
      .filter((entry) => entry.status !== 'captured' || entry.equivalence === 'partial')
      .map(
        (entry) =>
          `- **${entry.ref}** (${entry.status}${entry.equivalence === 'partial' ? ', partial' : ''}): ${entry.error ?? entry.note ?? 'No equivalent driver is registered.'}`
      ),
    '',
    'Regenerate with `bun run fidelity:fetch` and `bun run fidelity:report` while the dev server is running. Each driver uses a fresh browser context and real keyboard/mouse actions; stored visual baselines are never used as current captures.',
    '',
  ].join('\n');
}
