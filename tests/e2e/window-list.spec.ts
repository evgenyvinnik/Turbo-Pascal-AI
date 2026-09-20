import { expect, test } from '@playwright/test';
import { Ide } from './ide';

test('Window List selects and deletes the chosen window after sorting titles', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('first buffer');
  await ide.openMenu('F');
  await ide.chooseItem('n');
  await ide.type('second buffer');
  await ide.press('Alt+0');
  await ide.waitForDialog('Window List');
  await expect(ide.row(8)).toContainText('NONAME00.PAS');
  await expect(ide.row(9)).toContainText('NONAME01.PAS');
  await ide.press('ArrowUp');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('NONAME00.PAS');
  await expect(ide.row(2)).toContainText('first buffer');

  await ide.press('Alt+0');
  await ide.press('ArrowDown');
  await ide.press('Alt+d');
  await ide.waitForDialog('Window List');
  await expect(ide.row(8)).toContainText('NONAME00.PAS');
  await expect(ide.row(9)).not.toContainText('NONAME01.PAS');
  await ide.press('Escape');
  await expect(ide.row(1)).toContainText('NONAME00.PAS');
  await expect(ide.row(2)).toContainText('first buffer');
});
