import { expect, test } from '@playwright/test';
import { Ide } from './ide';

async function find(ide: Ide, text: string, options: string[] = []) {
  await ide.openMenu('s');
  await ide.chooseItem('f');
  await ide.type(text);
  for (const option of options) await ide.press(`Alt+${option}`);
  await ide.press('Enter');
}
async function again(ide: Ide) { await ide.openMenu('s'); await ide.chooseItem('s'); }
async function replace(ide: Ide, text: string, replacement: string, options: string[] = [], all = true) {
  await ide.openMenu('s');
  await ide.chooseItem('r');
  await ide.type(text);
  await ide.press('Alt+n');
  await ide.type(replacement);
  for (const option of options) await ide.press(`Alt+${option}`);
  await ide.press(all ? 'Alt+a' : 'Enter');
}
async function edit(ide: Ide, command: string) { await ide.openMenu('e'); await ide.chooseItem(command); }

// These assertions inspect the rendered editor and execute real commands; they
// do not modify app stores or compare the implementation against itself.
test('whole-word search excludes identifier substrings and wraps in both directions', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('scatter cat catfish cat');
  await ide.press('Home');
  await find(ide, 'cat', ['w']);
  await expect(ide.row(23)).toContainText('1:12');
  await again(ide);
  await expect(ide.row(23)).toContainText('1:24');
  await again(ide);
  await expect(ide.row(23)).toContainText('1:12');
  await find(ide, 'cat', ['b', 'e']);
  await expect(ide.row(23)).toContainText('1:24');
  await again(ide);
  await expect(ide.row(23)).toContainText('1:12');
  await again(ide);
  await expect(ide.row(23)).toContainText('1:24');
});

test('Search Again includes adjacent matches and scrolls distant results into view', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(['catcat', ...Array.from({ length: 30 }, () => 'filler'), 'lastcat'].join('\n'));
  await ide.moveTo(1, 1);
  await find(ide, 'cat');
  await expect(ide.row(23)).toContainText('1:4');
  await again(ide);
  await expect(ide.row(23)).toContainText('1:7');
  await again(ide);
  await expect(ide.row(23)).toContainText('32:8');
  await ide.waitForText('lastcat');
});

test('selected search scope remains bounded after highlighting each result', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('cat dog cat');
  await ide.press('Home');
  for (let index = 0; index < 7; index += 1) await ide.press('Shift+ArrowRight');
  await find(ide, 'cat', ['s', 'e']);
  await expect(ide.row(23)).toContainText('1:4');
  await again(ide);
  await expect(ide.row(23)).toContainText('1:4');
});

test('Change All respects selected text and is one Undo/Redo operation', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('cat cat outside cat');
  await ide.press('Home');
  for (let index = 0; index < 7; index += 1) await ide.press('Shift+ArrowRight');
  await replace(ide, 'cat', 'X', ['s', 'e', 'p']);
  await ide.waitForText('2 occurrences replaced');
  await ide.press('Enter');
  await expect(ide.row(2)).toContainText('X X outside cat');
  await ide.press('Alt+Backspace');
  await expect(ide.row(2)).toContainText('cat cat outside cat');
  await edit(ide, 'r');
  await expect(ide.row(2)).toContainText('X X outside cat');
});

test('replacement from cursor excludes earlier text and treats replacement dollars literally', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('cat cat cat');
  await ide.press('Home');
  for (let index = 0; index < 4; index += 1) await ide.press('ArrowRight');
  await replace(ide, 'cat', '$&', ['p']);
  await ide.waitForText('2 occurrences replaced');
  await ide.press('Enter');
  await expect(ide.row(2)).toContainText('cat $& $&');
});

test('Prompt on replace applies Yes immediately, skips No and stops on Cancel', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('cat cat cat');
  await ide.press('Home');
  await replace(ide, 'cat', 'DOG');
  await ide.waitForText('Replace this occurrence?');
  await ide.press('Alt+y');
  await expect(ide.row(2)).toContainText('DOG cat cat');
  await ide.press('Alt+n');
  await expect(ide.row(23)).toContainText('1:12');
  await ide.press('Alt+c');
  await ide.waitForText('1 occurrence replaced');
  await ide.press('Enter');
  await expect(ide.row(2)).toContainText('DOG cat cat');
  await edit(ide, 'u');
  await expect(ide.row(2)).toContainText('cat cat cat');
});

test('Replace OK changes one occurrence and cancelling a later dialog preserves settings', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('cat cat');
  await ide.press('Home');
  await replace(ide, 'cat', 'dog', ['p'], false);
  await ide.waitForText('1 occurrence replaced');
  await ide.press('Enter');
  await expect(ide.row(2)).toContainText('dog cat');
  await ide.openMenu('s');
  await ide.chooseItem('r');
  await ide.type('should not persist');
  await ide.press('Alt+n');
  await ide.type('bad');
  await ide.press('Alt+c');
  await ide.press('Escape');
  await ide.openMenu('s');
  await ide.chooseItem('r');
  await expect(ide.row(5)).toContainText('cat');
  await expect(ide.row(7)).toContainText('dog');
  await expect(ide.row(10)).toContainText('[ ] Case sensitive');
});

test('Borland regular expressions support classes and repetition without JS-only operators', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource('bee\nbot\nb\nboo\n(b|o)?');
  await ide.moveTo(1, 1);
  await find(ide, '^bo+$', ['r', 'e']);
  await expect(ide.row(23)).toContainText('4:4');
  await find(ide, '(b|o)?');
  await expect(ide.row(23)).toContainText('5:7');
  await find(ide, '[^e]+', ['b']);
  await expect(ide.row(23)).toContainText('5:7');
  await find(ide, '[');
  await ide.waitForText('Invalid regular expression');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('NONAME00.PAS');
});

test('dialog accelerators focus inputs, toggle clusters and Delete clears selected input text', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.openMenu('o');
  await ide.chooseItem('e');
  await ide.chooseItem('e');
  await ide.press('Alt+t');
  await ide.press('Delete');
  await ide.type('4');
  await expect(ide.row(14)).toContainText('Tab size  4');
  await ide.press('Enter');
  await ide.openMenu('s');
  await ide.chooseItem('f');
  await ide.press('Alt+w');
  await expect(ide.row(10)).toContainText('[X] Whole words only');
  await ide.press('Alt+b');
  await expect(ide.row(10)).toContainText('(•) Backward');
  await ide.press('Alt+t');
  await ide.type('value');
  await expect(ide.row(6)).toContainText('value');
});

test('clipboard shortcuts and Undo recover cleared text without replacing the clipboard', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('copied');
  await ide.press('Home');
  await ide.press('Shift+End');
  await ide.press('Control+Insert');
  await ide.press('End');
  await ide.press('Shift+Insert');
  await expect(ide.row(2)).toContainText('copiedcopied');
  await ide.press('Alt+Backspace');
  await expect(ide.row(2)).not.toContainText('copiedcopied');
  await ide.press('Home');
  await ide.press('Shift+End');
  await ide.press('Control+Delete');
  await expect(ide.row(2)).not.toContainText('copied');
  await ide.press('Shift+Insert');
  await expect(ide.row(2)).toContainText('copied');
  await ide.press('Enter');
  await ide.type('second line');
  await ide.press('Control+y');
  await expect(ide.row(3)).not.toContainText('second line');
  await ide.press('Alt+Backspace');
  await expect(ide.row(3)).toContainText('second line');
});

test('Grep handles quoted patterns, file masks, case flags and invalid arguments', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource('NEEDLE TOKEN\nother line');
  await ide.press('Shift+F2');
  await ide.type('-i "needle token" NONAME*.PAS');
  await ide.press('Enter');
  await ide.waitForText('NONAME00.PAS(1): NEEDLE TOKEN');
  await ide.press('Shift+F2');
  await ide.type('-v "TOKEN" NONAME*.PAS');
  await ide.press('Enter');
  await ide.waitForText('NONAME00.PAS(2): other line');
  await ide.press('Shift+F2');
  await ide.type('"unterminated');
  await ide.press('Enter');
  await ide.waitForText('Unclosed quote in program arguments');
  await ide.press('Enter');
  await ide.press('Shift+F2');
  await ide.type('[ *.pas');
  await ide.press('Enter');
  await ide.waitForText('Invalid Grep regular expression');
});

test('clearing Primary File makes the next compile use the active unsaved buffer', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.openFile('HELLO.PAS');
  await ide.openMenu('c');
  await ide.chooseItem('p');
  await ide.type('HELLO.PAS');
  await ide.press('Enter');
  await ide.openMenu('f');
  await ide.chooseItem('n');
  await ide.type('this cannot compile');
  await ide.openMenu('c');
  await ide.chooseItem('l');
  await ide.press('F9');
  await ide.waitForText('Error');
  await expect(ide.row(1)).toContainText('NONAME01.PAS');
});

test('Compiler Options overflow checking affects execution and explicit source directives override it', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource('program Overflow;\nvar a,b:Integer;\nbegin\n a:=30000;b:=10000;WriteLn(a+b);\nend.');
  await ide.openMenu('o');
  await ide.chooseItem('c');
  await ide.press('Alt+c');
  await ide.press('Enter');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await ide.waitForText('overflow');
  await ide.press('Enter');
  await ide.press('F6');
  await ide.moveTo(1, 1);
  await ide.type('{$Q-}');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('-25536');
});

test('invalid Evaluate/Modify expressions preserve live variables and allow a subsequent valid edit', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource('program Inspect;\nvar total:Integer;\nbegin\n total:=5;\n WriteLn(total);\nend.');
  await ide.moveTo(5, 1);
  await ide.press('Control+F8');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await ide.press('Control+F4');
  await ide.type('total');
  await ide.press('Enter');
  await expect(ide.row(11)).toContainText('5');
  await ide.press('Alt+n');
  await ide.type('missingIdentifier');
  await ide.press('Alt+m');
  await ide.waitForText('Unknown identifier');
  await ide.press('Alt+e');
  await expect(ide.row(11)).toContainText('5');
  await ide.press('Alt+n');
  await ide.type('7');
  await ide.press('Alt+m');
  await expect(ide.row(11)).toContainText('7');
  await ide.press('Escape');
  await ide.press('Control+F9');
  await expect(ide.row(18)).toContainText('7');
});

test('Options Save keeps the custom configuration filename after a workspace reload', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.openMenu('o');
  await ide.chooseItem('m');
  await ide.type('12345');
  await ide.press('Enter');
  await ide.openMenu('o');
  await ide.chooseItem('a');
  await ide.type('CUSTOM.TP');
  await ide.press('Enter');
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-status', 'saved');
  const restored = await Ide.open(page);
  await restored.openMenu('o');
  await restored.chooseItem('m');
  await restored.type('54321');
  await restored.press('Enter');
  await restored.openMenu('o');
  await restored.chooseItem('s');
  const disk = await page.evaluate(() => JSON.parse(localStorage.getItem('turbo-pascal.virtual-disk.v1') ?? '{}') as Record<string, string>);
  expect(JSON.parse(disk['CUSTOM.TP'] ?? '{}')).toMatchObject({ optionDialogs: { 'options.memory': { stack: '54321' } } });
  expect(disk['TURBO.TP']).toBeUndefined();
});

test('configured Grep arguments are editable defaults, execute correctly and survive Cancel', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('CONFIGURED_TOKEN');
  await ide.openMenu('o');
  await ide.chooseItem('t');
  await ide.press('Alt+e');
  await ide.waitForDialog('Edit Tool');
  await ide.press('Alt+a');
  await ide.type('-i configured_token NONAME*.PAS');
  await ide.press('Enter');
  await ide.waitForDialog('Tools');
  await ide.press('Alt+k');
  await ide.press('Shift+F2');
  await expect(ide.row(11)).toContainText('-i configured_token NONAME*.PAS');
  await ide.type('must not become the default');
  await ide.press('Escape');
  await ide.press('Shift+F2');
  await expect(ide.row(11)).toContainText('-i configured_token NONAME*.PAS');
  await ide.press('Enter');
  await ide.waitForText('NONAME00.PAS(1): CONFIGURED_TOKEN');
});

test('Compiler Options I/O checking controls missing-file errors and source directives override it', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program IOOption;
var f:Text;
begin
  Assign(f,'missing.dat');
  Reset(f);
  WriteLn(IOResult);
end.`);
  await ide.openMenu('o');
  await ide.chooseItem('c');
  await ide.press('Alt+i');
  await expect(ide.row(10)).toContainText('[ ] I/O checking');
  await ide.press('Enter');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('2');
  await expect(ide.row(18)).not.toContainText('error');
  await ide.press('F6');
  await ide.moveTo(1, 1);
  // Keep every source line number unchanged while overriding the IDE default.
  await ide.type('{$I+}');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await ide.waitForDialog('Runtime error');
  await ide.waitForText('NONAME00.PAS, line 5');
  await ide.waitForText('File not found: MISSING.DAT');
  await ide.press('Enter');
  await ide.openMenu('o');
  await ide.chooseItem('c');
  await expect(ide.row(10)).toContainText('[ ] I/O checking');
});
