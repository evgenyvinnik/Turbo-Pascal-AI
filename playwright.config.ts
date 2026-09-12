import { defineConfig, devices } from '@playwright/test';

/**
 * The IDE renders an 80x25 character grid of 9x16 pixel cells, so a 720x400
 * viewport makes every cell exactly one VGA text-mode cell. Visual snapshots
 * run at that size in Chromium only, because glyph rasterisation differs
 * between engines; the behavioural specs run everywhere.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 720, height: 400 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'fidelity',
      testMatch: /fidelity\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 720, height: 400 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'chromium',
      testIgnore: /(visual|fidelity)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /(visual|fidelity)\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /(visual|fidelity)\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
