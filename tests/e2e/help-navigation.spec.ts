import { expect, test } from '@playwright/test';
import { Ide } from './ide';

async function clickText(ide: Ide, text: string): Promise<void> {
  const row = await ide.find(text);
  expect(row).toBeGreaterThanOrEqual(0);
  const col = (await ide.text(row)).indexOf(text);
  await ide.clickCell(col + 1, row);
}

test('Help contents mouse links distinguish both columns and preserve the previous topic', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.openMenu('H');
  await ide.chooseItem('c');
  await ide.waitForText('PASCAL HELP CONTENTS');
  await clickText(ide, 'Built-in Assembler');
  await ide.waitForText('destination-first operand order');
  await ide.press('Alt+F1');
  await clickText(ide, 'Reserved Words');
  await ide.waitForText('Reserved words have fixed meanings');
  await ide.press('End');
  await ide.waitForText('xor');
  await ide.press('Alt+F1');
  await ide.waitForText('PASCAL HELP CONTENTS');
});

test('Help keyboard links reach unit documentation and return to the selected topic', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.type('unit');
  await ide.press('Home');
  await ide.press('Control+F1');
  await ide.waitForText('User-defined units');
  await ide.press('End');
  await ide.waitForText('Unit initialization');
  await ide.press('Shift+Tab');
  await ide.press('Enter');
  await ide.waitForText('Procedures and functions');
  await ide.press('Alt+F1');
  await ide.waitForText('Unit initialization');
  await ide.press('Home');
  await ide.waitForText('User-defined units');
  const before = await ide.screenText();
  await ide.press('Enter');
  expect(await ide.screenText()).toEqual(before);
});

test('identifier Help reaches object constructors and an actual standard routine', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.typeSource('constructor\nwriteln\nobject');
  await ide.moveTo(1, 1);
  await ide.press('Control+F1');
  await ide.waitForText('Constructors');
  await ide.press('Escape');
  await ide.moveTo(2, 1);
  await ide.press('Control+F1');
  await ide.waitForText('WriteLn([F,]');
  await ide.press('Escape');
  await ide.moveTo(3, 1);
  await ide.press('Control+F1');
  await ide.waitForText('Objects and methods');
});

test('compiler context cross-reference opens directives and preserves the underlying dialog', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.openMenu('O');
  await ide.chooseItem('c');
  await ide.press('F1');
  await ide.waitForText('Help on the Compiler Options dialog box');
  await ide.press('Tab');
  await ide.press('Enter');
  await ide.waitForText('Compiler Directives');
  await ide.press('Alt+F1');
  await ide.waitForText('Help on the Compiler Options dialog box');
  await ide.press('Escape');
  await ide.waitForDialog('Compiler Options');
});

test('routine groups lead to routine details rather than reopening the directory', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await ide.openMenu('H');
  await ide.chooseItem('c');
  await clickText(ide, 'Functions and Procedures');
  await clickText(ide, 'Functions and Procedures U-Z');
  await clickText(ide, 'Writeln');
  await ide.waitForText('WriteLn([F,]');
});
