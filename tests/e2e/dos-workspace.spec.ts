import { expect, test } from '@playwright/test';
import { Ide } from './ide';

test('DOS runs real COM instructions, DEBUG assembles and traces actual x86 registers, and files persist', async ({ page }) => {
  test.setTimeout(120_000);
  const ide = await Ide.open(page);
  await ide.openMenu('f');
  await ide.chooseItem('d');
  const workspace = page.getByRole('region', { name: 'DOS workspace' });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Examples', exact: true })).toBeEnabled({ timeout: 30_000 });
  await workspace.getByRole('button', { name: 'Examples', exact: true }).click();
  await expect(workspace.getByRole('status')).toContainText('Try HELLO', { timeout: 20_000 });
  const canvas = page.getByLabel('DOS screen');
  await canvas.click();
  await page.keyboard.type('hello', { delay: 60 });
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('DOS output')).toContainText('Hello from real x86 DOS code!', { timeout: 20_000 });
  await page.keyboard.type('debug < x86test.scr > x86test.txt', { delay: 60 });
  await page.keyboard.press('Enter');
  // Saving uses the real worker filesystem. Assert the resulting machine-code
  // bytes and the debugger's register/disassembly output after reloading the IDE.
  await page.keyboard.type('type x86test.txt', { delay: 60 });
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('DOS output')).toContainText('AX=1236', { timeout: 20_000 });
  await workspace.getByRole('button', { name: 'Return to IDE', exact: true }).click();
  await expect(workspace).toBeHidden({ timeout: 20_000 });
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('turbo-pascal.virtual-disk.v1') ?? '{}') as Record<string, string>);
  expect(Array.from(persisted['REGTEST.COM']!, (c) => c.charCodeAt(0))).toEqual([0xb8, 0x34, 0x12, 0xbb, 2, 0, 0x01, 0xd8, 0x50, 0x5a, 0xb8, 0, 0x4c, 0xcd, 0x21]);
  expect(persisted['X86TEST.TXT']).toContain('AX=1236');
  expect(persisted['X86TEST.TXT']).toContain('DX=1236');
  expect(persisted['X86TEST.TXT']).toContain('MOV');
  await page.reload();
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-workspace-ready', 'true');
  await ide.openMenu('f'); await ide.chooseItem('d');
  await expect(workspace.getByRole('button', { name: 'Save files', exact: true })).toBeEnabled({ timeout: 30_000 });
  await canvas.click();
  await page.keyboard.type('type x86test.txt', { delay: 60 });
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('DOS output')).toContainText('DX=1236');
  // EXIT must save like Return to IDE does, not just close the workspace.
  await page.keyboard.type('echo saved by exit> exit.txt', { delay: 60 }); await page.keyboard.press('Enter');
  await expect(page.getByLabel('DOS output')).toContainText('exit.txt');
  await page.keyboard.type('exit', { delay: 60 }); await page.keyboard.press('Enter');
  await expect(workspace).toBeHidden({ timeout: 20_000 });
  const afterExit = await page.evaluate(() => JSON.parse(localStorage.getItem('turbo-pascal.virtual-disk.v1') ?? '{}') as Record<string, string>);
  expect(afterExit['EXIT.TXT']).toBe('saved by exit\r\n');
});

test('native DOS Pascal compiles and executes inline x86 assembly and refuses to run stale binaries after an error', async ({ page }) => {
  test.setTimeout(180_000);
  const ide = await Ide.open(page);
  await ide.typeSource("program Native; var value: Word; begin asm mov ax,$1234; add ax,2; mov value,ax; end; writeln('NATIVE ASM: ',value); writeln('INTEGER BYTES: ',SizeOf(Integer)); end.");
  await ide.openMenu('f'); await ide.chooseItem('d');
  const workspace = page.getByRole('region', { name: 'DOS workspace' });
  await expect(workspace.getByRole('button', { name: 'Run Pascal', exact: true })).toBeEnabled({ timeout: 30_000 });
  await workspace.getByRole('button', { name: 'Run Pascal', exact: true }).click();
  await expect(page.getByLabel('DOS output')).toContainText('NATIVE ASM: 4662', { timeout: 100_000 });
  await expect(page.getByLabel('DOS output')).toContainText('INTEGER BYTES: 2');
  await workspace.getByRole('button', { name: 'Return to IDE', exact: true }).click();
  await expect(workspace).toBeHidden({ timeout: 20_000 });
  const firstDisk = await page.evaluate(() => JSON.parse(localStorage.getItem('turbo-pascal.virtual-disk.v1') ?? '{}') as Record<string, string>);
  const executable = Object.keys(firstDisk).find((name) => /\.EXE$/i.test(name));
  expect(executable).toBeTruthy();
  expect(firstDisk[executable!]!.slice(0, 2)).toBe('MZ');
  expect(Object.keys(firstDisk).some((name) => /PPC386|SYSTEM.PPU|DEBUGX/.test(name))).toBe(false);
  await ide.press('Control+Home');
  await ide.type('this is not Pascal;');
  await ide.openMenu('f'); await ide.chooseItem('d');
  await expect(workspace.getByRole('button', { name: 'Run Pascal', exact: true })).toBeEnabled({ timeout: 30_000 });
  await workspace.getByRole('button', { name: 'Run Pascal', exact: true }).click();
  await expect(page.getByLabel('DOS output')).toContainText('Compilation failed. The program was not run.', { timeout: 100_000 });
  await expect(page.getByLabel('DOS output')).not.toContainText('NATIVE ASM: 4662');
  await workspace.getByRole('button', { name: 'Return to IDE', exact: true }).click();
  await expect(workspace).toBeHidden({ timeout: 20_000 });
});
