import { expect, test } from '@playwright/test';
import { Ide } from './ide';

const source = `program DebugDemo;
var total: Integer;
procedure Add(value: Integer);
begin
  total := total + value;
end;
begin
  total := 1;
  Add(4);
  total := total * 2;
  WriteLn(total);
end.`;

test('source stepping, live watches, call stack and evaluate/modify use the same VM', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(source);
  await ide.press('F7');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(23)).toContainText('7:1');
  await ide.press('F7');
  await expect(ide.row(23)).toContainText('8:1');
  await ide.press('F7');
  await expect(ide.row(23)).toContainText('9:1');
  await ide.press('Control+F7');
  await ide.type('total');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('total: 1');
  await ide.press('F7');
  await ide.press('F7');
  await ide.press('Control+F3');
  await expect(ide.row(18)).toContainText('Add(4)');
  await expect(ide.row(19)).toContainText('DebugDemo');
  await ide.press('Control+F4');
  await ide.type('total');
  await ide.press('Enter');
  await expect(ide.row(11)).toContainText('1');
  await ide.press('Tab');
  await ide.type('7');
  await ide.clickCell(56, 11);
  await expect(ide.row(11)).toContainText('7');
  await ide.press('Escape');
  await ide.press('F8');
  await ide.press('Control+F9');
  await expect(ide.row(18)).toContainText('22');
});

test('go to cursor pauses before execution and a source breakpoint can be removed', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(source);
  await ide.moveTo(10, 1);
  await ide.press('Control+F8');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(23)).toContainText('10:1');
  await ide.press('Control+F7');
  await ide.type('total');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('total: 5');
  await ide.press('Alt+F3');
  await ide.press('Control+F8');
  await ide.moveTo(11, 1);
  await ide.press('F4');
  await expect(ide.row(23)).toContainText('11:1');
  await ide.press('Control+F9');
  await expect(ide.row(18)).toContainText('10');
});

test('the CPU window displays live P-machine registers in the gallery layout', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(source);
  await ide.press('F7');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await ide.openMenu('D');
  await ide.chooseItem('r');
  await expect(ide.row(1)).toContainText('CPU');
  await expect(ide.row(2)).toContainText(/PC [0-9A-F]{4}/);
  await expect(ide.row(3)).toContainText(/SP [0-9A-F]{4}/);
  await expect(ide.row(8)).toContainText('P-machine');
});
