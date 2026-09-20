import { expect, test } from '@playwright/test';
import { Ide } from './ide';

test('file picker displays both columns, scrolls by columns, and opens the clicked file', async ({ page }) => {
  const ide = await Ide.open(page);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    for (let index = 0; index < 21; index += 1) {
      const name = `A${String(index).padStart(2, '0')}`;
      transfer.items.add(new File([`program ${name};\nbegin WriteLn(${index}) end.`], `${name}.PAS`));
    }
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(ide.row(1)).toContainText('A20.PAS');
  await ide.press('F3');
  await ide.waitForDialog('Open a File');
  await expect(ide.row(9)).toContainText('A00.PAS');
  await expect(ide.row(9)).toContainText('A08.PAS');
  await expect(ide.row(16)).toContainText('A07.PAS');
  await expect(ide.row(16)).toContainText('A15.PAS');

  await ide.clickCell(37, 9);
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('A08.PAS');
  await expect(ide.row(3)).toContainText('WriteLn(8)');

  await ide.press('F3');
  await ide.press('Tab');
  await ide.press('ArrowRight');
  await ide.press('ArrowRight');
  await expect(ide.row(9)).toContainText('A08.PAS');
  await expect(ide.row(9)).toContainText('A16.PAS');
  // A selection in either column must preserve the dividing line.
  expect((await ide.text(9))[33]).toBe('│');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('A16.PAS');
  await expect(ide.row(3)).toContainText('WriteLn(16)');

  await ide.press('F3');
  await ide.press('Tab');
  await ide.press('PageDown');
  await expect(ide.row(9)).toContainText('A08.PAS');
  await expect(ide.row(9)).toContainText('A16.PAS');
  await ide.press('PageUp');
  await expect(ide.row(9)).toContainText('A00.PAS');
  await ide.press('End');
  await expect(ide.row(9)).toContainText('A16.PAS');
  await ide.press('Home');
  await expect(ide.row(9)).toContainText('A00.PAS');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('A00.PAS');
  await expect(ide.row(3)).toContainText('WriteLn(0)');
});
