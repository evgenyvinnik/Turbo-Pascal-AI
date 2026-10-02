/**
 * Draws the pictures the site shows outside itself: the preview a link to it
 * gets when shared, the favicon, and the PWA's icons.
 *
 * Usage: start the dev server (bun run dev), then
 *   bun scripts/build-social-images.ts [url]
 *
 * The preview is the IDE itself, photographed with a sample open; the icon is
 * "TP" in the editor's colors, drawn as pixels so it stays sharp at any size.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:3000/';
const publicDir = join(import.meta.dirname, '..', 'public');

/** Five by seven letters, as the PC's character generator drew them. */
const LETTERS = {
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
};

/** A blue Turbo Vision window with a white double frame and yellow "TP". */
function iconSvg(): string {
  const scale = 2;
  const rects: string[] = [];
  ['T', 'P'].forEach((letter, index) => {
    LETTERS[letter as keyof typeof LETTERS].forEach((row, y) => {
      Array.from(row).forEach((bit, x) => {
        if (bit === '#')
          rects.push(
            `<rect x="${String(5 + (index * 6 + x) * scale)}" y="${String(9 + y * scale)}" width="${String(scale)}" height="${String(scale)}"/>`
          );
      });
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">
  <rect width="32" height="32" fill="#0000AA"/>
  <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="#FFFFFF"/>
  <rect x="3.5" y="3.5" width="25" height="25" fill="none" stroke="#FFFFFF"/>
  <g fill="#FFFF55">${rects.join('')}</g>
</svg>
`;
}

/** The IDE with FIBONACCI.PAS open and the Window menu down, at twice size. */
async function photographIde(page: Page): Promise<Buffer> {
  await page.setViewportSize({ width: 720, height: 400 });
  await page.goto(url);
  await page.waitForSelector('[data-testid="tp-screen"] [data-row="0"]');
  await page.waitForSelector('[data-workspace-ready="true"]');
  await page.addStyleTag({ content: '*{animation:none !important}' });
  const press = async (key: string) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  };
  // The fresh desktop's empty window goes, so the sample is the only one.
  await press('Alt+F3');
  await press('F3');
  await page.keyboard.type('FIBONACCI.PAS');
  await press('Enter');
  await page.waitForTimeout(500);
  await press('Alt+W');
  return page.screenshot();
}

/** The photograph on a 1200 by 630 card, the size link previews use. */
async function previewCard(page: Page, screen: Buffer): Promise<Buffer> {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html>
<style>
  html, body { margin: 0; width: 1200px; height: 630px; background: #000; }
  body { display: flex; align-items: center; justify-content: center; }
  img { height: 630px; }
</style>
<img src="data:image/png;base64,${screen.toString('base64')}">`);
  await page.waitForFunction(() => document.images.item(0)?.complete);
  return page.screenshot();
}

async function iconPng(page: Page, svg: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html>
<style>html, body { margin: 0; } img { display: block; width: ${String(size)}px; height: ${String(size)}px; }</style>
<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
  await page.waitForFunction(() => document.images.item(0)?.complete);
  return page.screenshot();
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const screen = await photographIde(page);
  const iconPage = await browser.newPage({ deviceScaleFactor: 1 });
  writeFileSync(join(publicDir, 'social-preview.png'), await previewCard(iconPage, screen));
  const svg = iconSvg();
  writeFileSync(join(publicDir, 'favicon.svg'), svg);
  mkdirSync(join(publicDir, 'icons'), { recursive: true });
  for (const size of [180, 192, 512])
    writeFileSync(
      join(publicDir, 'icons', `icon-${String(size)}.png`),
      await iconPng(iconPage, svg, size)
    );
  console.log('Wrote social-preview.png, favicon.svg and icons/icon-{180,192,512}.png in public/.');
} finally {
  await browser.close();
}
