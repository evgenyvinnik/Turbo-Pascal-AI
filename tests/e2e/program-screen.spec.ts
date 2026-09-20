import { expect, test } from '@playwright/test';
import { Ide } from './ide';

test('CRT video memory renders colors, cursor positions and interactive input', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program ConsoleDemo;
uses Crt;
var n: Integer;
begin
  ClrScr;
  TextColor(Yellow);
  GotoXY(5, 3);
  Write('Number: ');
  ReadLn(n);
  WriteLn(n * 2);
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(page.getByTestId('program-text-screen')).toBeVisible();
  await expect(ide.row(2)).toContainText('Number:');
  await ide.type('6');
  await ide.press('Enter');
  await expect(ide.row(3)).toContainText('12');
  await ide.press('Escape');
  await expect(page.getByTestId('program-text-screen')).toHaveCount(0);
});

test('Graph draws actual palette pixels and accepts input before CloseGraph', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program GraphicsDemo;
uses Graph;
var gd, gm: Integer;
begin
  gd := Detect;
  InitGraph(gd, gm, '');
  SetColor(Red);
  Rectangle(10, 10, 50, 50);
  ReadLn;
  CloseGraph;
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  const canvas = page.getByTestId('program-graphics-screen').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => Array.from(element.getContext('2d')!.getImageData(10, 10, 1, 1).data))).toEqual([170, 0, 0, 255]);
  await ide.press('Enter');
  await expect(canvas).toHaveCount(0);
});

test('the Pascal virtual disk persists text files across a page reload', async ({ page }) => {
  let ide = await Ide.open(page);
  await ide.typeSource(`program SaveData;
var f: Text;
begin
  Assign(f, 'saved.txt');
  Rewrite(f);
  WriteLn(f, 'Saved by Pascal');
  Close(f);
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('turbo-pascal.virtual-disk.v1'))).toContain('Saved by Pascal');
  ide = await Ide.open(page);
  await ide.openMenu('F');
  await ide.chooseItem('n');
  await ide.typeSource(`program LoadData;
var f: Text; line: String;
begin
  Assign(f, 'saved.txt');
  Reset(f);
  ReadLn(f, line);
  Close(f);
  WriteLn(line);
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('Saved by Pascal');
});

test('Delay yields to the browser and Ctrl+F2 cancels the pending wakeup', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program PauseDemo;
uses Crt;
begin
  WriteLn('Before delay');
  Delay(1000);
  WriteLn('After delay');
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('Before delay');
  await ide.press('Control+F2');
  await ide.waitForText('[Program stopped]');
  await page.waitForTimeout(1100);
  expect((await ide.screenText()).slice(18, 23).join('\n')).not.toContain('After delay');
});

test('KeyPressed polling receives live typing and ReadKey receives Escape and DOS arrow codes', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program KeyboardDemo;
uses Crt;
var key: Char;
begin
  ClrScr;
  WriteLn('Polling keyboard');
  repeat Delay(10) until KeyPressed;
  WriteLn('Typed=', Ord(ReadKey));
  WriteLn('Press Escape');
  key := ReadKey;
  WriteLn('Escape=', Ord(key));
  WriteLn('Press Up');
  key := ReadKey;
  WriteLn('Prefix=', Ord(key));
  WriteLn('Scan=', Ord(ReadKey));
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(page.getByTestId('program-text-screen')).toBeVisible();
  await ide.waitForText('Polling keyboard');
  await ide.press('a');
  await ide.waitForText('Typed=97');
  await ide.waitForText('Press Escape');
  await ide.press('Escape');
  await ide.waitForText('Escape=27');
  await expect(page.getByTestId('program-text-screen')).toBeVisible();
  await ide.waitForText('Press Up');
  await ide.press('ArrowUp');
  await ide.waitForText('Prefix=0');
  await ide.waitForText('Scan=72');
});
