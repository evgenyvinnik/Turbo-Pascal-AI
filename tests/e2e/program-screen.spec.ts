import { expect, test } from '@playwright/test';
import { Ide, storedDisk } from './ide';
import { testDriver } from '../fixtures/x86/testDriver';

test('CRT video memory renders colors, cursor positions and interactive input', async ({
  page,
}) => {
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
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) =>
        Array.from(element.getContext('2d')?.getImageData(10, 10, 1, 1).data ?? [])
      )
    )
    .toEqual([170, 0, 0, 255]);
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
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (element: HTMLCanvasElement, [px, py]) =>
        Array.from(element.getContext('2d')?.getImageData(px ?? 0, py ?? 0, 1, 1).data ?? []),
      [x, y]
    );
  // Palette 2: color 3 is yellow and color 2 light red; the turtle walks east from the middle.
  await expect.poll(() => pixel(0, 0)).toEqual([255, 255, 85, 255]);
  await expect.poll(() => pixel(200, 100)).toEqual([255, 85, 85, 255]);
  await ide.press('Enter');
  await expect(canvas).toHaveCount(0);
});

test('BIOS mode 13h shows $A000 in the VGA palette the program sets', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program Vga;
uses Dos;
var r: Registers; x: Integer;
begin
  r.AX := $13; Intr($10, r);
  for x := 0 to 9 do Mem[$A000:x] := 4;
  Port[$3C8] := 200; Port[$3C9] := 63; Port[$3C9] := 32; Port[$3C9] := 0;
  Mem[$A000:320] := 200;
  ReadLn;
  r.AX := 3; Intr($10, r);
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  const canvas = page.getByTestId('program-graphics-screen').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('width', '320');
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (element: HTMLCanvasElement, [px, py]) =>
        Array.from(element.getContext('2d')?.getImageData(px ?? 0, py ?? 0, 1, 1).data ?? []),
      [x, y]
    );
  // Color 4 of the default palette is the EGA's red; 200 is what the program set.
  await expect.poll(() => pixel(9, 0)).toEqual([170, 0, 0, 255]);
  await expect.poll(() => pixel(0, 1)).toEqual([255, 130, 0, 255]);
  await ide.press('Enter');
  await expect(canvas).toHaveCount(0);
});

test('the timer interrupt ticks while ReadKey waits for a key', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program Ticks;
uses Dos, Crt;
var n: Word; old: Pointer; c: Char;
procedure Tick; interrupt; begin Inc(n) end;
begin
  GetIntVec($1C, old); SetIntVec($1C, @Tick);
  ClrScr; Write('Press'); n := 0;
  c := ReadKey;
  WriteLn(' ', n > 5);
  SetIntVec($1C, old);
  ReadLn;
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(0)).toContainText('Press');
  // Half a second is about nine ticks of 18.2 a second.
  await page.waitForTimeout(500);
  await ide.type('x');
  await expect(ide.row(0)).toContainText('Press TRUE');
  await ide.press('Enter');
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
  await expect.poll(async () => (await storedDisk(page))['SAVED.TXT']).toContain('Saved by Pascal');
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

test('KeyPressed polling receives live typing and ReadKey receives Escape and DOS arrow codes', async ({
  page,
}) => {
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

test("a dropped third-party BGI driver's own code draws the screen", async ({ page }) => {
  const ide = await Ide.open(page);
  const source = `program Driver;
uses Graph;
var d, m: Integer;
begin
  d := InstallUserDriver('TESTBGI', nil); m := 0; InitGraph(d, m, '');
  SetColor(4); Line(0, 0, 99, 0);
  SetFillStyle(SolidFill, 14); Bar(10, 10, 20, 20);
  ReadLn;
  CloseGraph;
end.`;
  await page.evaluate(
    (items) => {
      const transfer = new DataTransfer();
      for (const item of items)
        transfer.items.add(new File([new Uint8Array(item.bytes)], item.name));
      document.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
    },
    [
      { name: 'testbgi.bgi', bytes: Array.from(testDriver()) },
      { name: 'driver.pas', bytes: Array.from(source, (char) => char.charCodeAt(0)) },
    ]
  );
  await expect(ide.row(1)).toContainText('DRIVER.PAS');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  const canvas = page.getByTestId('program-graphics-screen').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('width', '320');
  await expect(canvas).toHaveAttribute('height', '200');
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (element: HTMLCanvasElement, [px, py]) =>
        Array.from(element.getContext('2d')?.getImageData(px ?? 0, py ?? 0, 1, 1).data ?? []),
      [x, y]
    );
  // Colours 4 and 14 of the VGA's default palette: red and yellow.
  await expect.poll(() => pixel(50, 0)).toEqual([170, 0, 0, 255]);
  await expect.poll(() => pixel(15, 15)).toEqual([255, 255, 85, 255]);
  await expect.poll(() => pixel(50, 50)).toEqual([0, 0, 0, 255]);
  await ide.press('Enter');
  await expect(canvas).toHaveCount(0);
});

test('SetPalette and SetRGBPalette recolor what Graph has drawn', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program Pal;
uses Graph;
var d, m: Integer;
begin
  d := VGA; m := VGAHi; InitGraph(d, m, '');
  SetFillStyle(SolidFill, 1); Bar(0, 0, 9, 9);
  SetFillStyle(SolidFill, 2); Bar(10, 0, 19, 9);
  SetPalette(1, EGAYellow);
  SetRGBPalette(2, 255, 0, 255);
  ReadLn;
  CloseGraph;
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  const canvas = page.getByTestId('program-graphics-screen').locator('canvas');
  await expect(canvas).toBeVisible();
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (element: HTMLCanvasElement, [px, py]) =>
        Array.from(element.getContext('2d')?.getImageData(px ?? 0, py ?? 0, 1, 1).data ?? []),
      [x, y]
    );
  // Register 1 now holds the EGA's yellow; register 2's DAC entry is magenta.
  await expect.poll(() => pixel(5, 5)).toEqual([255, 255, 85, 255]);
  await expect.poll(() => pixel(15, 5)).toEqual([255, 0, 255, 255]);
  await ide.press('Enter');
  await expect(canvas).toHaveCount(0);
});

test('the bundled BGIDEMO.PAS tours Graph from the Open dialog to its last screen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ide = await Ide.open(page);
  await ide.openFile('BGIDEMO.PAS');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  const canvas = page.getByTestId('program-graphics-screen').locator('canvas');
  await expect(canvas).toBeVisible();
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (element: HTMLCanvasElement, [px, py]) =>
        Array.from(element.getContext('2d')?.getImageData(px ?? 0, py ?? 0, 1, 1).data ?? []),
      [x, y]
    );
  // Every screen has the blue title bar and the light gray hint line.
  for (let screen = 1; screen <= 12; screen++) {
    await expect.poll(() => pixel(5, 5), { timeout: 15_000 }).toEqual([0, 0, 170, 255]);
    await expect.poll(() => pixel(5, 470)).toEqual([170, 170, 170, 255]);
    // The sixth screen's flood fill is green; the seventh's star is red.
    if (screen === 6) await expect.poll(() => pixel(451, 291)).toEqual([0, 170, 0, 255]);
    if (screen === 7) await expect.poll(() => pixel(181, 211)).toEqual([170, 0, 0, 255]);
    await page.keyboard.press('Space');
  }
  // The keys wait in the buffer while the animations finish.
  await expect(canvas).toHaveCount(0, { timeout: 30_000 });
});

test('the bundled CRTDEMO.PAS tours Crt to its last screen', async ({ page }) => {
  test.setTimeout(120_000);
  const ide = await Ide.open(page);
  await ide.openFile('CRTDEMO.PAS');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(0)).toContainText('Turbo Pascal Crt unit');
  await expect(ide.row(7)).toContainText('C R T   D E M O');
  for (const title of [
    'TextColor and TextBackground',
    'Window, and text scrolling in it',
    'InsLine and DelLine',
    'GotoXY, WhereX and WhereY',
    'ReadKey',
  ]) {
    await page.keyboard.press('Space');
    await expect(ide.row(0)).toContainText(title, { timeout: 15_000 });
  }
  // The keyboard screen names the keys it reads; Enter ends it.
  await page.keyboard.press('a');
  await expect(ide.row(4)).toContainText("Key 'a', character 97");
  await page.keyboard.press('ArrowUp');
  await expect(ide.row(5)).toContainText('Extended key, scan code 72');
  await page.keyboard.press('Enter');
  await expect(ide.row(0)).toContainText('Sound and NoSound', { timeout: 15_000 });
  await page.keyboard.press('Space');
  await expect(ide.row(0)).toContainText('KeyPressed', { timeout: 15_000 });
  // A key stops the ball, and another goes on.
  await page.keyboard.press('Space');
  await expect(ide.row(11)).toContainText('Stopped after');
  await page.keyboard.press('Space');
  await expect(ide.row(0)).toContainText('The end', { timeout: 15_000 });
  await page.keyboard.press('Space');
  // The program has ended with the screen cleared; Escape goes back to the IDE.
  await expect(ide.row(0)).not.toContainText('The end');
  await ide.press('Escape');
  await expect(page.getByTestId('program-text-screen')).toHaveCount(0);
});

test('MOUSE.PAS paints with the browser mouse, through INT 33h', async ({ page }) => {
  test.setTimeout(60_000);
  const ide = await Ide.open(page);
  await ide.openFile('MOUSE.PAS');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  const canvas = page.getByTestId('program-graphics-screen').locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  /** A dot of the 640 by 480 screen, on the page. */
  const at = (x: number, y: number) => ({
    x: box.x + ((x + 0.5) * box.width) / 640,
    y: box.y + ((y + 0.5) * box.height) / 480,
  });
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (element: HTMLCanvasElement, [px, py]) =>
        Array.from(element.getContext('2d')?.getImageData(px ?? 0, py ?? 0, 1, 1).data ?? []),
      [x, y]
    );
  // Red from the toolbar, then a line dragged with the left button.
  const red = at(136, 15);
  await page.mouse.click(red.x, red.y);
  const start = at(100, 100),
    end = at(200, 100);
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect.poll(() => pixel(150, 100)).toEqual([170, 0, 0, 255]);
  // The driver's arrow is drawn where the mouse is: white inside, black edge.
  await expect.poll(() => pixel(201, 102)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(200, 102)).toEqual([0, 0, 0, 255]);
  const quit = at(599, 15);
  await page.mouse.click(quit.x, quit.y);
  await expect(canvas).toHaveCount(0, { timeout: 10_000 });
});

test('a text-mode program reads the mouse by character cell', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program Clicks;
uses Crt, Dos;
var R: Registers;
begin
  ClrScr;
  R.AX := 0; Intr($33, R);
  R.AX := 1; Intr($33, R);
  WriteLn('Click somewhere');
  repeat
    R.AX := 5; R.BX := 0; Intr($33, R);
    Delay(10);
  until R.BX > 0;
  WriteLn('Clicked at column ', R.CX div 8 + 1, ', row ', R.DX div 8 + 1);
  ReadLn;
end.`);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(0)).toContainText('Click somewhere');
  const { x, y } = await ide.cellPoint(30, 10);
  await page.mouse.click(x, y);
  await expect(ide.row(1)).toContainText('Clicked at column 31, row 11');
  await ide.press('Enter');
});
