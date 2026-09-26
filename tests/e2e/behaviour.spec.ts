import { expect, test } from '@playwright/test';
import { Ide } from './ide';

test.describe('menus', () => {
  test('the menu bar carries the original ten titles', async ({ page }) => {
    const ide = await Ide.open(page);
    expect(await ide.text(0)).toBe(
      '  File  Edit  Search  Run  Compile  Debug  Tools  Options  Window  Help'
    );
  });

  test('the File menu lists the original items and shortcuts', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    const screen = await ide.screenText();
    const menu = screen.slice(2, 13).map((l) => l.trim());
    expect(menu[0]).toContain('New');
    expect(menu[1]).toContain('Open...');
    expect(menu[1]).toContain('F3');
    expect(menu[2]).toContain('Save');
    expect(menu[2]).toContain('F2');
    expect(menu.join('\n')).toContain('Change dir...');
    expect(menu.join('\n')).toContain('DOS shell');
    expect(menu[menu.length - 1]).toContain('Alt+X');
  });

  test('the status line shows the hint of the highlighted item', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    expect(await ide.text(24)).toContain('Create a new file in a new Edit window');
    await ide.press('ArrowDown');
    expect(await ide.text(24)).toContain('Load a file from disk');
  });

  test('Escape closes the menu and restores the key list', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    await ide.press('Escape');
    expect(await ide.text(24)).toContain('F1 Help');
    expect(await ide.text(24)).toContain('Alt+F10 Local menu');
  });

  test('arrow keys walk between menus', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    await ide.press('ArrowRight');
    expect(await ide.text(24)).toContain('Undo the previous editor operation');
  });

  test('clicking a menu title opens it', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.clickCell(29, 0);
    expect(await ide.text(24)).toContain('Compile source file');
  });
});

test.describe('editor', () => {
  test('opens on an empty NONAME00.PAS window', async ({ page }) => {
    const ide = await Ide.open(page);
    expect(await ide.text(1)).toContain('NONAME00.PAS');
    expect(await ide.text(23)).toContain('1:1');
  });

  test('typing moves the position indicator', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('program Test;');
    expect(await ide.text(2)).toContain('program Test;');
    expect(await ide.text(23)).toContain('1:14');
    await ide.press('Enter');
    expect(await ide.text(23)).toContain('2:1');
  });

  test('Backspace deletes and Home moves to the start of the line', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('begin');
    await ide.press('Backspace');
    expect(await ide.text(2)).toContain('begi');
    await ide.press('Home');
    expect(await ide.text(23)).toContain('1:1');
  });

  test('Go to line number moves the cursor', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('one\ntwo\nthree\nfour');
    await ide.openMenu('S');
    await ide.chooseItem('g');
    await ide.type('2');
    await ide.press('Enter');
    expect(await ide.text(23)).toContain('2:1');
  });

  test('clicking in the text places the cursor', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('program Test;\nbegin\nend.');
    await ide.clickCell(3, 3);
    expect(await ide.text(23)).toContain('2:3');
  });
});

test.describe('windows', () => {
  test('File > New adds a second numbered window', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    await ide.chooseItem('n');
    expect(await ide.text(1)).toContain('NONAME01.PAS');
    expect(await ide.text(1)).toContain('2═[');
  });

  test('Window > Tile splits the desktop', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    await ide.chooseItem('n');
    await ide.openMenu('W');
    await ide.chooseItem('t');
    const screen = await ide.screenText();
    expect(screen[1]).toContain('NONAME00.PAS');
    expect(screen[12]).toContain('NONAME01.PAS');
  });

  test('the Output window uses its own key list', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('D');
    await ide.chooseItem('o');
    expect(await ide.text(17)).toContain('Output');
    expect(await ide.text(24)).toContain('Scroll');
  });

  test('the Watches window uses its own key list', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('D');
    await ide.chooseItem('w');
    expect(await ide.text(17)).toContain('Watches');
    expect(await ide.text(24)).toContain('F7 Trace');
    expect(await ide.text(24)).toContain('Ins Add');
  });

  test('Alt+F3 closes the active window', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('F');
    await ide.chooseItem('n');
    await ide.press('Alt+F3');
    expect(await ide.text(1)).toContain('NONAME00.PAS');
  });
});

test.describe('dialogs', () => {
  test('the Find dialog carries the original controls', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('S');
    await ide.chooseItem('f');
    const screen = (await ide.screenText()).join('\n');
    expect(screen).toContain('Find');
    expect(screen).toContain('Text to find');
    expect(screen).toContain('Case sensitive');
    expect(screen).toContain('Whole words only');
    expect(screen).toContain('Regular expression');
    expect(screen).toContain('Forward');
    expect(screen).toContain('Backward');
    expect(screen).toContain('Global');
    expect(screen).toContain('Entire scope');
  });

  test('Escape cancels a dialog', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.press('F3');
    expect(await ide.find('Open a File')).toBeGreaterThan(-1);
    await ide.press('Escape');
    expect(await ide.find('Open a File')).toBe(-1);
  });

  test('Tab walks the focusable controls', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('S');
    await ide.chooseItem('f');
    expect(await ide.text(24)).toContain('Enter literal text');
    await ide.press('Tab');
    expect(await ide.text(24)).toContain('Set the options that control the search');
  });

  test('Find reports a string that is not there', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('program Test;');
    await ide.openMenu('S');
    await ide.chooseItem('f');
    await ide.type('nothing');
    await ide.press('Enter');
    expect(await ide.find('Search string not found')).toBeGreaterThan(-1);
  });

  test('Find selects the match', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('program Test;\nbegin\n  writeln;\nend.');
    await ide.openMenu('S');
    await ide.chooseItem('f');
    await ide.type('writeln');
    await ide.press('Enter');
    expect(await ide.text(23)).toContain('3:10');
  });

  test('the About box shows the version', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openMenu('H');
    await ide.chooseItem('a');
    const screen = (await ide.screenText()).join('\n');
    expect(screen).toContain('Turbo Pascal');
    expect(screen).toContain('Version 7.1');
    expect(screen).toContain('Borland International, Inc.');
  });
});

test.describe('compiler', () => {
  test('a good program reports success', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openFile('HELLO.PAS');
    await ide.press('Alt+F9');
    await ide.waitForDialog('Compiling');
    const screen = (await ide.screenText()).join('\n');
    expect(screen).toContain('Main file: HELLO.PAS');
    expect(screen).toContain('Compile successful');
    expect(screen).toContain('Press any key');
  });

  test('an undeclared variable reaches the error banner', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.typeSource('program Broken;\nbegin\n  missing := 1;\nend.');
    await ide.press('Alt+F9');
    await ide.waitForText('Error');
    // Turbo Pascal names the error, not the identifier: the banner carries
    // Borland's wording and the cursor moves to the offending line instead.
    expect(await ide.text(2)).toContain('Error 3: Unknown identifier');
    expect(await ide.text(23)).toMatch(/ 3:\d+ /);
  });

  test('a broken program shows the red error banner', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('program Broken;');
    await ide.press('Enter');
    await ide.type('begin');
    await ide.press('Alt+F9');
    await ide.waitForText('Error');
    expect(await ide.text(2)).toMatch(/Error/);
  });

  test('running a program writes real output and waits for ReadLn', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openFile('HELLO.PAS');
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForDialog('Program input');
    await expect(ide.row(18)).toContainText('Hello, world!');
    await ide.press('Enter');
    expect(await ide.text(17)).toContain('Output');
    expect(await ide.find('Program input')).toBe(-1);
    // Program input must never be inserted into the source editor.
    await ide.press('Alt+F3');
    expect(await ide.text(4)).toContain("writeln('Hello, world!');");
  });

  test('Fibonacci accepts a number, calculates its sequence and resumes after input', async ({
    page,
  }) => {
    const ide = await Ide.open(page);
    await ide.openFile('FIBONACCI.PAS');
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForDialog('Program input');
    await ide.waitForText('Enter how many Fibonacci numbers to display:');
    await ide.type('10');
    await ide.press('Enter');
    await ide.waitForText('Press any key to exit...');
    await ide.press('Enter');
    await ide.press('F5');
    await ide.press('Home');
    const output = (await ide.screenText()).join('\n');
    expect(output).toContain('Enter how many Fibonacci numbers to display: 10');
    expect(output).toContain('F(1) = 0');
    expect(output).toContain('F(7) = 8');
    expect(output).toContain('F(10) = 34');
    expect(output).not.toContain('Runtime error');
  });

  test('a procedure writes its var parameter back to the caller', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openFile('SQUARE.PAS');
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForDialog('Program input');
    expect(await ide.text(18)).toContain('----- SQUARE OF 7 -----');
    expect(await ide.text(19)).toContain('49');
    await ide.press('Enter');
  });

  test('division by zero reports a runtime error with its source line', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.typeSource(
      'program Divide; var divisor: Integer;\nbegin\n  divisor := 0; WriteLn(1 div divisor);\nend.'
    );
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForDialog('Runtime error');
    const screen = (await ide.screenText()).join('\n');
    expect(screen).toContain('NONAME00.PAS, line 3');
    expect(screen).toMatch(/division by zero/i);
  });

  test('an infinite loop yields to the UI and can be reset', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.typeSource(
      "program Forever;\nbegin\n  WriteLn('Started');\n  while True do begin end;\nend."
    );
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForText('Started');
    await ide.openMenu('R');
    await ide.chooseItem('p');
    await ide.waitForText('[Program stopped]');
    expect(await ide.find('Runtime error')).toBe(-1);
    await ide.press('Alt+F3');
    await ide.openMenu('F');
    await ide.chooseItem('n');
    await ide.typeSource("program AfterReset;\nbegin\n  WriteLn('Still working');\nend.");
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForText('Still working');
    expect(await ide.find('[Program stopped]')).toBe(-1);
  });

  test('Ctrl+F2 cancels pending input without changing the source', async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.openFile('HELLO.PAS');
    await ide.press('Control+F9');
    await ide.waitForDialog('Compiling');
    await ide.press('Enter');
    await ide.waitForDialog('Program input');
    await ide.type('must not enter source');
    await ide.press('Control+F2');
    await ide.waitForText('[Program stopped]');
    expect(await ide.find('Program input')).toBe(-1);
    await ide.press('Alt+F3');
    expect((await ide.screenText()).join('\n')).not.toContain('must not enter source');
  });
});
