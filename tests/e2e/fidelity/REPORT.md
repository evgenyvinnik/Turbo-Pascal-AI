# Gallery comparison report

Run the app, fetch the original gallery images, and generate a fresh comparison:

```sh
bun run dev
bun run fidelity:fetch
bun run fidelity:report
```

Open `artifacts/fidelity-report/index.html` directly in a browser or through the
running Vite server at `/artifacts/fidelity-report/index.html`. The HTML, images,
cell reports, concise `coverage.md`, and full `coverage.json` stay outside
Playwright's disposable `test-results` directory. The generated files are ignored by Git; report code
and the verified gallery inventory are tracked.

The generator uses one headless Chromium instance and a fresh browser context
for each subject. It never reads `__screenshots__` visual baselines. The bundled
SQUARE example is saved as HELLO.PAS through the real Save As dialog to match
the reference filename. Modified-file flags and caret positions are matched to
the original screenshot through editor actions; source/debugger values always
come from the current app. Other driver actions are in `states.ts` and
`report-states.ts`.

`gallery.json` inventories all 117 full-size gallery images, verified from the
page's image anchors on 2026-09-12. The separate article hero repeats
`Call-stack-2`. Every gallery image appears in the report, including states
without a matching driver. Partial mappings (for example, live Pascal VM registers
compared with original x86 registers) are labeled separately from equivalent subjects.

The primary metric compares every RGBA pixel at 720×400 with zero tolerance.
The adjusted metric excludes only the rectangles listed alongside that subject;
raw counts always remain available. Unnecessary title exclusions are removed
because report fixtures match filenames. Other existing cell-test `text` exclusions become
full-rectangle exclusions in the adjusted raster comparison, and this broader
meaning is explicitly disclosed. Cell-attribute counts are secondary diagnostics
and do not prove text or glyph equality.

The overlay wipe, side-by-side view, raw/adjusted diff, mask outlines, source and
PNG hashes, capture times, and unmatched reasons are available without network
access. Run after source edits finish: source changes during a driver are capture
errors, and changes across subjects are flagged as a mixed-revision report.

Optional environment variables:

- `FIDELITY_BASE_URL`: app URL, default `http://127.0.0.1:3000`.
- `FIDELITY_REPORT_DIR`: output directory, default `artifacts/fidelity-report`.
- `FIDELITY_ONLY`: comma-separated driver names or gallery references for a
  targeted diagnostic run. Other entries are explicitly marked `filtered`.
  Use a separate output directory for diagnostics to preserve the full report.
- `FIDELITY_UPDATE=1` with `FIDELITY_ONLY`: refresh selected captures in a complete
  existing report, retaining the other captures and their individual driver hashes.
  This refuses to run if the app source or public assets changed. After any app
  source change, regenerate the full report instead.

The command returns nonzero for missing references or capture failures. Visual
mismatches and unmatched states are reported honestly without aborting capture.

Type-check the standalone report tools with
`bunx tsc --noEmit -p tests/e2e/fidelity/tsconfig.json`. The main app TypeScript
project includes only `src`, so the report has a separate test-tool configuration.
