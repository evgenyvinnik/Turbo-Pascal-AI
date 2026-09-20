import { expect, test } from '@playwright/test';
import { Ide } from './ide';

/** Import actual browser Files through the same drop event as a user. */
async function importProject(ide: Ide, files: Record<string, string>, main: string): Promise<void> {
  const entries = [...Object.entries(files).filter(([name]) => name !== main), [main, files[main]!]];
  await ide.page.evaluate((sources) => {
    const transfer = new DataTransfer();
    for (const [name, source] of sources) transfer.items.add(new File([source!], name!));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, entries);
  await expect(ide.row(1)).toContainText(main);
}

async function runCompiled(ide: Ide): Promise<void> {
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.waitForText('Compile successful');
  await ide.press('Enter');
}

async function primaryFile(ide: Ide, name: string): Promise<void> {
  await ide.openMenu('C'); await ide.chooseItem('p');
  await ide.waitForDialog('Primary File');
  await ide.type(name); await ide.press('Enter');
}

const valuesUnit = `unit Values;
interface
function Get:Integer;
implementation
function Get:Integer;
begin
  Get:=7;
end;
end.`;

test('imported units, include constants, initialization and virtual object dispatch execute together', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'BASEUNIT.PAS': `unit BaseUnit;
interface
var BootMarker:Integer;
type TBase=object
  Value:Integer;
  constructor Init(Start:Integer);
  function Get:Integer;virtual;
end;
implementation
constructor TBase.Init(Start:Integer);
begin Value:=Start end;
function TBase.Get:Integer;
begin Get:=Value end;
begin BootMarker:=10 end.`,
    'EXTRA.INC': '{$IFDEF BONUS}\nconst Extra=50;\n{$ELSE}\nconst Extra=5;\n{$ENDIF}',
    'CHILDUNT.PAS': `unit ChildUnt;
interface
uses BaseUnit;
type TChild=object(TBase)
  function Get:Integer;virtual;
end;
implementation
{$I EXTRA.INC}
function TChild.Get:Integer;
begin Get:=inherited Get+Extra end;
begin BaseUnit.BootMarker:=BaseUnit.BootMarker+1 end.`,
    'MAINPROJ.PAS': `program MainProj;
uses BaseUnit,ChildUnt;
var Item:TChild; Base:^TBase;
begin
  Item.Init(7);
  Base:=@Item;
  WriteLn('PROJECT=',Base^.Get,',',BaseUnit.BootMarker);
end.`,
  }, 'MAINPROJ.PAS');
  await runCompiled(ide);
  await ide.waitForText('PROJECT=12,11');
  // The browser source interpreter handles these constructs directly.
  await expect(page.getByRole('region', { name: 'DOS workspace' })).not.toBeVisible();
});

test('recompilation uses an unsaved unit buffer instead of its imported disk copy', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'VALUES.PAS': valuesUnit,
    'MAINPROJ.PAS': "program MainProj;uses Values;begin WriteLn('VALUE=',Get)end.",
  }, 'MAINPROJ.PAS');
  await runCompiled(ide); await ide.waitForText('VALUE=7');
  await ide.press('Alt+F3');
  await ide.openFile('VALUES.PAS');
  await ide.moveTo(7, 8); await ide.press('Delete'); await ide.type('9');
  await ide.waitForText('Get:=9;');
  await ide.openFile('MAINPROJ.PAS');
  await runCompiled(ide); await ide.waitForText('VALUE=9');
  await ide.press('Alt+F3'); await ide.openFile('VALUES.PAS');
  await expect(ide.row(23)).toContainText('☼');
});

test('a syntax error in an include opens the included source at its original line', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'BAD.INC': '{ declaration imported from a separate file }\nvar Count Integer;',
    'MAINPROJ.PAS': 'program MainProj;\n{$I BAD.INC}\nbegin end.',
  }, 'MAINPROJ.PAS');
  await ide.press('F9');
  await expect(ide.row(1)).toContainText('BAD.INC');
  await ide.waitForText('Error 86: ":" expected');
  await expect(ide.row(23)).toContainText('2:1');
  await ide.waitForText('var Count Integer;');
});

test('a semantic error in a used unit focuses that unit rather than the main program', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'BROKEN.PAS': `unit Broken;
interface
procedure Run;
implementation
procedure Run;
var Count:Integer;
begin
  Count:=True;
end;
end.`,
    'MAINPROJ.PAS': 'program MainProj;\nuses Broken;\nbegin Run end.',
  }, 'MAINPROJ.PAS');
  await ide.press('F9');
  await expect(ide.row(1)).toContainText('BROKEN.PAS');
  await ide.waitForText('Error 26: Type mismatch');
  await expect(ide.row(23)).toContainText('8:1');
});

test('run-time errors preserve a used unit filename and line in the dialog and source editor', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'BROKEN.PAS': `unit Broken;
interface
procedure Run;
implementation
procedure Run;
var Zero,Result:Integer;
begin
  Zero:=0;
  Result:=10 div Zero;
end;
end.`,
    'MAINPROJ.PAS': 'program MainProj;\nuses Broken;\nbegin Run end.',
  }, 'MAINPROJ.PAS');
  await runCompiled(ide);
  await ide.waitForDialog('Runtime error');
  await ide.waitForText('BROKEN.PAS, line 9');
  await ide.waitForText('Run-time error 200');
  await ide.waitForText('Division by zero');
  await ide.press('Enter'); await ide.press('Alt+F3');
  await expect(ide.row(1)).toContainText('BROKEN.PAS');
  await expect(ide.row(23)).toContainText('9:1');
});

test('run-time errors inside included statements map back to the include rather than its expanded line', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'CALC.INC': '{ original include line one }\nN:=10 div Z;',
    'MAINPROJ.PAS': 'program MainProj;\nvar N,Z:Integer;\nbegin\nZ:=0;\n{$I CALC.INC}\nend.',
  }, 'MAINPROJ.PAS');
  await runCompiled(ide);
  await ide.waitForDialog('Runtime error');
  await ide.waitForText('CALC.INC, line 2');
  await ide.waitForText('Run-time error 200');
  await ide.press('Enter'); await ide.press('Alt+F3');
  await expect(ide.row(1)).toContainText('CALC.INC');
  await expect(ide.row(23)).toContainText('2:1');
});

test('a breakpoint is qualified by unit file and watches resolve that unit private scope', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'ONE.PAS': `unit One;
interface
procedure Run;
implementation
const SecretConstant=100;
var Secret:Integer;
procedure Run;
begin
  WriteLn('FIRST UNIT');
end;
begin Secret:=100 end.`,
    'TWO.PAS': `unit Two;
interface
procedure Run;
implementation
const SecretConstant=9;
var Secret:Integer;
procedure Run;
begin
  WriteLn('SECOND=',Secret+SecretConstant);
end;
begin Secret:=7 end.`,
    'MAINPROJ.PAS': 'program MainProj;\nuses One,Two;\nbegin One.Run;Two.Run end.',
  }, 'MAINPROJ.PAS');
  await primaryFile(ide, 'MAINPROJ.PAS');
  await ide.openFile('TWO.PAS');
  await ide.moveTo(9, 1); await ide.press('Control+F8');
  await runCompiled(ide);
  await expect(ide.row(1)).toContainText('TWO.PAS');
  await expect(ide.row(23)).toContainText('9:1');
  await ide.press('Control+F7'); await ide.type('Secret'); await ide.press('Enter');
  await ide.waitForText('Secret: 7');
  await ide.press('Control+F7'); await ide.type('SecretConstant'); await ide.press('Enter');
  await ide.waitForText('SecretConstant: 9');
  await ide.press('Alt+F3');
  await ide.press('Control+F9'); await ide.waitForText('SECOND=16');
  await ide.waitForText('FIRST UNIT');
});

test('a standalone unit compiles, but Run does not execute its initialization as a main program', async ({ page }) => {
  const ide = await Ide.open(page);
  await importProject(ide, {
    'VALUES.PAS': valuesUnit.replace('end.','begin WriteLn(\'INITIALIZED\') end.'),
  }, 'VALUES.PAS');
  await ide.press('F9'); await ide.waitForDialog('Compiling');
  await ide.waitForText('Compile successful'); await ide.press('Enter');
  await ide.press('Control+F9'); await ide.waitForDialog('Compiling');
  await ide.press('Enter'); await ide.waitForDialog('Error');
  await ide.waitForText('Cannot run a unit.');
  await ide.waitForText('Open a program that uses this unit.');
});

test('Boolean and range Compiler Options persist and source switches override execution without changing saved settings', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program Switches;
var Calls,N:Integer; B:Boolean; Small:Byte;
function Touch:Boolean;
begin Inc(Calls);Touch:=True end;
begin
  Calls:=0;B:=False and Touch;
  WriteLn('CALLS=',Calls);
  N:=256;Small:=N;
  WriteLn('BYTE=',Small);
end.`);
  await ide.openMenu('O'); await ide.chooseItem('c');
  await ide.press('Alt+b'); await ide.press('Alt+r');
  await ide.waitForText('[X] Complete boolean eval');
  await ide.waitForText('[X] Range checking');
  await ide.press('Enter');
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-workspace-ready', 'true');
  await ide.openMenu('O'); await ide.chooseItem('c');
  await ide.waitForText('[X] Complete boolean eval');
  await ide.waitForText('[X] Range checking');
  await ide.press('Enter');
  await runCompiled(ide);
  await ide.waitForDialog('Runtime error');
  await ide.waitForText('Run-time error 201');
  await ide.press('Enter'); await ide.waitForText('CALLS=1');
  await ide.press('Alt+F3'); await ide.moveTo(1, 1);
  await ide.type('{$B-}{$R-}');
  await runCompiled(ide);
  await ide.waitForText('CALLS=0'); await ide.waitForText('BYTE=0');
  await ide.openMenu('O'); await ide.chooseItem('c');
  await ide.waitForText('[X] Complete boolean eval');
  await ide.waitForText('[X] Range checking');
});

test('strict VAR string Compiler Option persists and a source override rejects a mismatched argument', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program StringOption;
type Short=String[3];
var S:String[5];
procedure Change(var Value:Short);
begin Value:='OK' end;
begin S:='x';Change(S);WriteLn('STRING=',S)end.`);
  await ide.press('F9'); await ide.waitForText('Error 26: Type mismatch');
  await ide.openMenu('O'); await ide.chooseItem('c'); await ide.press('Alt+v');
  await ide.waitForText('[ ] Strict var-strings'); await ide.press('Enter');
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-workspace-ready', 'true');
  await runCompiled(ide); await ide.waitForText('STRING=OK');
  await ide.press('Alt+F3'); await ide.moveTo(1, 1); await ide.type('{$V+}');
  await ide.press('F9'); await ide.waitForText('Error 26: Type mismatch');
  await ide.openMenu('O'); await ide.chooseItem('c');
  await ide.waitForText('[ ] Strict var-strings');
});
