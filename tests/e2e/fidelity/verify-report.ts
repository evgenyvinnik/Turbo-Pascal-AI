import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const target = path.resolve(process.env.FIDELITY_REPORT_DIR ?? 'artifacts/fidelity-report');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(target, 'index.html')).href);
  await expect(page.locator('.state')).toHaveCount(117);
  await expect(page.locator('#title')).toHaveText('Normal-view');
  await page.getByRole('button', { name: 'Overlay wipe', exact: true }).click();
  await page.locator('#wipe').fill('25');
  await expect(page.locator('#current')).toHaveCSS('clip-path', 'inset(0px 75% 0px 0px)');
  await page.getByRole('button', { name: 'Side by side', exact: true }).click();
  await expect(page.locator('#side')).toBeVisible();
  await page.getByRole('button', { name: 'Pixel diff', exact: true }).click();
  await expect(page.locator('#base')).toHaveAttribute('src', /-diff\.png$/);
  await page.locator('#adjusted').check();
  await expect(page.locator('#base')).toHaveAttribute('src', /-masked-diff\.png$/);
  await page.locator('#search').fill('Open-a-File');
  await page.locator('.state').click();
  await page.locator('#show-masks').check();
  expect(await page.locator('.mask').count()).toBeGreaterThan(0);
  await page.locator('#show-masks').uncheck();
  await expect(page.locator('.mask')).toHaveCount(0);
  await page.locator('#search').fill('');
  await page.locator('#filter').selectOption('unmatched');
  await expect(page.locator('.state').first()).toBeVisible();
  await page.locator('.state').first().click();
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('#filter').selectOption('all');
  await page.locator('#search').fill('Context-menu-File');
  await expect(page.locator('.state')).toHaveCount(1);
  await page.locator('.state').click();
  await page.getByRole('button', { name: 'Overlay wipe', exact: true }).click();
  await page.locator('#search').fill('');
  const brokenImages = await page
    .locator('img:visible')
    .evaluateAll(
      (images) =>
        images.filter(
          (image) =>
            !(image as HTMLImageElement).complete || !(image as HTMLImageElement).naturalWidth
        ).length
    );
  expect(brokenImages).toBe(0);
  expect(errors).toEqual([]);
  await expect(page.locator('#total')).toHaveText('117');
  await page.screenshot({ path: path.join(target, 'report-preview.png'), fullPage: true });
  console.log(
    'Report verified: 117 entries, overlay/side/diff views, masks, filters, local images, and no browser errors.'
  );
} finally {
  await browser.close();
}
