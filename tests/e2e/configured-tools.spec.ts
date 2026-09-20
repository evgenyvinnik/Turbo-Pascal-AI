import { expect, test } from '@playwright/test';
import { Ide } from './ide';

async function addTool(ide: Ide, title: string, program: string, params: string): Promise<void> {
  await ide.openMenu('O'); await ide.chooseItem('t');
  await ide.waitForDialog('Tools');
  await ide.press('Alt+n'); await ide.waitForDialog('New Tool');
  await ide.type(title); await ide.press('Tab');
  await ide.type(program); await ide.press('Tab');
  await ide.type(params); await ide.press('Enter');
  await ide.waitForDialog('Tools'); await ide.press('Alt+k');
}

test('a configured custom tool appears in the real menu and survives a browser reload', async ({ page }) => {
  const ide = await Ide.open(page);
  await addTool(ide, 'List sources', 'DIR', '*.PAS > LIST.TXT');
  await ide.openMenu('T'); await ide.waitForText('List sources');
  await expect(ide.row(24)).toContainText('Open the message window');
  await ide.press('Escape');
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-workspace-ready', 'true');
  await ide.openMenu('T'); await ide.waitForText('List sources');
  await ide.press('l');
  const dos = page.getByRole('region', { name: 'DOS workspace' });
  await expect(dos).toBeVisible();
  await expect(dos.getByRole('button', { name: 'Save files', exact: true })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByLabel('DOS output')).toContainText('C:\\', { timeout: 30_000 });
  await dos.getByRole('button', { name: 'Return to IDE', exact: true }).click();
  await expect(dos).not.toBeVisible({ timeout: 30_000 });
  await ide.openFile('LIST.TXT');
  await ide.waitForText('NONAME00');
  await ide.waitForText('File(s)');
});

test('deleting a configured default removes its menu item and reassigns the first shortcut', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.openMenu('O'); await ide.chooseItem('t');
  await ide.press('Alt+d'); await ide.press('Alt+k');
  await ide.openMenu('T');
  expect((await ide.screenText()).join('\n')).not.toContain('Grep');
  await ide.waitForText('Turbo Assembler');
  const row = await ide.find('Turbo Assembler');
  await expect(ide.row(row)).toContainText('Shift+F2');
});
