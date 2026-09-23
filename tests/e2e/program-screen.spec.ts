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
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(10, 10, 1, 1).data))).toEqual([170, 0, 0, 255]);
  await ide.press('Enter');
  await expect(canvas).toHaveCount(0);
});

test('asm runs in the P-machine and waits for a BIOS key there, not in DOS', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program AsmDemo;
uses Crt;
var value: Word; k: Byte;
begin
  asm mov ax, $1234; add ax, 2; mov value, ax end;
  WriteLn('ASM: ', value);
  asm mov ah, 0; int 16h; mov k, al end;
  WriteLn('KEY: ', Chr(k));
  ReadLn;
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(page.getByTestId('program-text-screen')).toBeVisible();
  await expect(ide.row(0)).toContainText('ASM: 4662');
  await ide.type('q');
  await expect(ide.row(1)).toContainText('KEY: q');
  await expect(page.getByRole('region', { name: 'DOS workspace' })).toHaveCount(0);
  await ide.press('Enter');
});

test('Graph3 shows the CGA screen in its palette colors until TextMode', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program Turtle;
uses Crt, Graph3;
begin
  GraphColorMode;
  Palette(2);
  Plot(0, 0, 3);
  SetPenColor(2);
  SetHeading(East);
  Forwd(100);
  ReadLn;
  TextMode(C80);
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  const canvas = page.getByTestId('program-graphics-screen').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('width', '320');
  await expect(canvas).toHaveAttribute('height', '200');
  const pixel = (x: number, y: number) => canvas.evaluate((element: HTMLCanvasElement, [px, py]) => Array.from(element.getContext('2d')!.getImageData(px!, py!, 1, 1).data), [x, y]);
  // Palette 2: color 3 is yellow and color 2 light red; the turtle walks east from the middle.
  await expect.poll(() => pixel(0, 0)).toEqual([255, 255, 85, 255]);
  await expect.poll(() => pixel(200, 100)).toEqual([255, 85, 85, 255]);
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
