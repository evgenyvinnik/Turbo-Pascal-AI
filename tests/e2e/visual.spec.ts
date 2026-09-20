import { expect, test } from '@playwright/test';
import { Ide } from './ide';

/**
 * Pixel snapshots of the states shown in the Turbo Pascal 7.1 reference
 * gallery. The viewport is 720x400 so one screen cell is one 9x16 VGA cell.
 */
test.describe('Turbo Pascal 7.1 screens', () => {
  test('start up screen', async ({ page }) => {
    await Ide.open(page);
    await expect(page).toHaveScreenshot('startup.png');
  });

  const menus = [
    ['file', 'F'],
    ['edit', 'E'],
    ['search', 'S'],
    ['run', 'R'],
    ['compile', 'C'],
    ['debug', 'D'],
    ['tools', 'T'],
    ['options', 'O'],
    ['window', 'W'],
    ['help', 'H'],
  ] as const;

  for (const [name, key] of menus) {
    test(`${name} menu`, async ({ page }) => {
      const ide = await Ide.open(page);
      await ide.openMenu(key);
      await expect(page).toHaveScreenshot(`menu-${name}.png`);
    });
  }

  test('environment submenu', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('O');
    for (let i = 0; i < 6; i += 1) await ide.press('ArrowDown');
    await ide.press('ArrowRight');
    await expect(page).toHaveScreenshot('menu-options-environment.png');
  });

  test('about box', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('H');
    await ide.chooseItem('a');
    await expect(page).toHaveScreenshot('dialog-about.png');
  });

  test('open a file', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.press('F3');
    await expect(page).toHaveScreenshot('dialog-open.png');
  });

  test('find', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('S');
    await ide.chooseItem('f');
    await expect(page).toHaveScreenshot('dialog-find.png');
  });

  test('replace', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('S');
    await ide.chooseItem('r');
    await expect(page).toHaveScreenshot('dialog-replace.png');
  });

  test('go to line number', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('S');
    await ide.chooseItem('g');
    await expect(page).toHaveScreenshot('dialog-goto-line.png');
  });

  test('compiler options', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('O');
    await ide.chooseItem('c');
    await expect(page).toHaveScreenshot('dialog-compiler-options.png');
  });

  test('add watch', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('D');
    await ide.chooseItem('a');
    await expect(page).toHaveScreenshot('dialog-add-watch.png');
  });

  test('window list', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('W');
    await ide.chooseItem('l');
    await expect(page).toHaveScreenshot('dialog-window-list.png');
  });

  test('syntax highlighted source', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openFile('SQUARE.PAS');
    await expect(page).toHaveScreenshot('editor-source.png');
  });

  test('successful compile', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openFile('HELLO.PAS');
    await ide.press('Alt+F9');
    await ide.waitForDialog('Compiling');
    await expect(page).toHaveScreenshot('dialog-compiling.png');
  });

  test('compiler error banner', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.typeSource('program Broken;\nbegin\n  missing := 1;\nend.');
    await ide.press('Alt+F9');
    await ide.waitForText('Error');
    await expect(page).toHaveScreenshot('editor-error.png');
  });

  test('program input', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openFile('HELLO.PAS');
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForDialog('Program input');
    await expect(page).toHaveScreenshot('dialog-program-input.png');
  });

  test('output window', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('D');
    await ide.chooseItem('o');
    await expect(page).toHaveScreenshot('window-output.png');
  });

  test('watches window', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('D');
    await ide.chooseItem('w');
    await expect(page).toHaveScreenshot('window-watches.png');
  });

  test('two tiled windows', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    await ide.chooseItem('n');
    await ide.openMenu('W');
    await ide.chooseItem('t');
    await expect(page).toHaveScreenshot('windows-tiled.png');
  });

  test('bare desktop', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.press('Alt+F3');
    await expect(page).toHaveScreenshot('desktop-empty.png');
  });
});
