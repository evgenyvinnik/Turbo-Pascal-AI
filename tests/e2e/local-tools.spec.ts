import { expect, test } from '@playwright/test';
import { Ide } from './ide';

test('Save As history restores an earlier filename without accepting the parent dialog', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.type('saved source');
  await ide.openMenu('f');
  await ide.chooseItem('a');
  await ide.waitForDialog('Save File As');
  await ide.type('ALPHA.PAS');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('ALPHA.PAS');
  await ide.openMenu('f');
  await ide.chooseItem('a');
  await ide.press('ArrowDown');
  await expect(ide.row(6)).toContainText('ALPHA.PAS');
  await expect(ide.row(7)).toContainText('*.PAS');
  await ide.press('ArrowDown');
  await ide.press('Enter');
  await ide.waitForDialog('Save File As');
  await expect(ide.row(6)).toContainText('*.PAS');
  // Mouse history button works too; Escape closes only the history window.
  await ide.clickCell(47, 6);
  await expect(ide.row(7)).toContainText('*.PAS');
  await ide.press('Escape');
  await ide.waitForDialog('Save File As');
  await ide.press('Escape');
  await expect(ide.row(1)).toContainText('ALPHA.PAS');
});

test('Alt+F10 and right-click open the editor local menu with working edit commands', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.type('copyme');
  await ide.press('Home');
  await ide.press('Shift+End');
  await ide.press('Alt+F10');
  await expect(ide.row(8)).toContainText('Open file at cursor');
  await ide.press('c');
  await ide.press('End');
  await ide.press('Alt+F10');
  await ide.press('p');
  await expect(ide.row(2)).toContainText('copymecopyme');
  const point = await ide.cellPoint(20, 5);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await ide.waitForText('Open file at cursor');
  await ide.press('o');
  await ide.waitForDialog('Editor');
});

test('Grep searches unsaved and imported source and navigates its real matches', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.type('{ NeedleToken unsaved }');
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['program Other;\n{ NeedleToken imported }\nbegin end.'], 'OTHER.PAS')
    );
    document.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );
  });
  await expect(ide.row(1)).toContainText('OTHER.PAS');
  await ide.press('Shift+F2');
  await ide.waitForDialog('Program Arguments');
  await ide.type('NeedleToken *.pas');
  await ide.press('Enter');
  await ide.waitForText('Grep: NeedleToken');
  await ide.waitForText('NONAME00.PAS(1):');
  await ide.waitForText('OTHER.PAS(2):');
  await ide.press('ArrowUp');
  await ide.press('Enter');
  await expect(ide.row(17)).toContainText('Messages');
  await ide.press('ArrowDown');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('NONAME00.PAS');
  await ide.press('Alt+F8');
  await expect(ide.row(1)).toContainText('OTHER.PAS');
  await expect(ide.row(3)).toContainText('NeedleToken imported');
});
