import { expect, test, type Page } from '@playwright/test';
import { Ide } from './ide';

async function dropFiles(
  page: Page,
  files: { name: string; text?: string; bytes?: number[]; size?: number }[]
) {
  await page.evaluate((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const content =
        item.size === undefined
          ? item.bytes === undefined
            ? (item.text ?? '')
            : new Uint8Array(item.bytes)
          : new Uint8Array(item.size);
      transfer.items.add(new File([content], item.name));
    }
    document.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );
  }, files);
}

test('drops UTF-8 Pascal source and raw data, runs ReadLn, and keeps imported bytes after reload', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  const source = `program Imported;
var f:Text;n:Integer;line:String;
begin
  Assign(f,'numbers.txt');Reset(f);
  ReadLn(f,n);ReadLn(f,line);Close(f);
  WriteLn(n*2, ':', line, ':', Ord('é'));
end.`;
  await dropFiles(page, [
    { name: 'numbers.txt', text: '24\r\nFrom an imported file\r\n' },
    { name: 'trip.chr', bytes: [0, 128, 219, 255] },
    { name: 'imported.pas', text: source },
  ]);
  await expect(ide.row(1)).toContainText('IMPORTED.PAS');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const disk = JSON.parse(
          localStorage.getItem('turbo-pascal.virtual-disk.v1') ?? '{}'
        ) as Record<string, string>;
        return Array.from(disk['TRIP.CHR'] ?? '', (char) => char.charCodeAt(0));
      })
    )
    .toEqual([0, 128, 219, 255]);
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('48:From an imported file:130');

  const reloaded = await Ide.open(page);
  await dropFiles(page, [{ name: 'reload.pas', text: source }]);
  await expect(reloaded.row(1)).toContainText('RELOAD.PAS');
  await reloaded.press('Control+F9');
  await reloaded.waitForDialog('Compiling');
  await reloaded.press('Enter');
  await expect(reloaded.row(18)).toContainText('48:From an imported file:130');
});

test('rejects an oversized drop as one batch without replacing existing files or opening source', async ({
  page,
}) => {
  const ide = await Ide.open(page);
  await dropFiles(page, [{ name: 'kept.txt', text: 'keep this file' }]);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('turbo-pascal.virtual-disk.v1')))
    .toContain('keep this file');
  await dropFiles(page, [
    { name: 'small.txt', text: 'must not be partially imported' },
    { name: 'new.pas', text: 'program T;begin end.' },
    { name: 'large.bin', size: 8 * 1024 * 1024 + 1 },
  ]);
  await ide.waitForDialog('File import');
  await ide.waitForText('MiB import limit');
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('turbo-pascal.virtual-disk.v1') ?? '{}') as Record<
          string,
          string
        >
    )
  ).toEqual({ 'KEPT.TXT': 'keep this file' });
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('NONAME00.PAS');
});

test('rejects a conflicting filename without importing the rest of the drop', async ({ page }) => {
  const ide = await Ide.open(page);
  await dropFiles(page, [{ name: 'kept.txt', text: 'original data' }]);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('turbo-pascal.virtual-disk.v1')))
    .toContain('original data');
  await dropFiles(page, [
    { name: 'new.txt', text: 'new data' },
    { name: 'KEPT.TXT', text: 'replacement data' },
  ]);
  await ide.waitForDialog('File import');
  await ide.waitForText('already exists');
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('turbo-pascal.virtual-disk.v1') ?? '{}') as Record<
          string,
          string
        >
    )
  ).toEqual({ 'KEPT.TXT': 'original data' });
});
