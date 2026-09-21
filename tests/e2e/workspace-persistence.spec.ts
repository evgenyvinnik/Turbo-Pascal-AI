import { expect, test, type Page } from '@playwright/test';
import { Ide } from './ide';

interface SavedWorkspace {
  id: string;
  schemaVersion: number;
  revision: number;
  updatedAt: number;
  payload: unknown;
}

/** Read the committed record, not the application's in-memory Zustand state. */
async function readWorkspace(page: Page): Promise<SavedWorkspace | null> {
  return page.evaluate(async () => {
    const request = indexedDB.open('TurboPascalIDE');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('workspaces')) return null;
      const read = database.transaction('workspaces').objectStore('workspaces').get('active');
      return await new Promise<SavedWorkspace | null>((resolve, reject) => {
        read.onsuccess = () => resolve((read.result as SavedWorkspace | undefined) ?? null);
        read.onerror = () => reject(read.error);
      });
    } finally {
      database.close();
    }
  });
}

async function recoveryWorkspaces(page: Page): Promise<SavedWorkspace[]> {
  return page.evaluate(async () => {
    const request = indexedDB.open('TurboPascalIDE');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = database.transaction('workspaces').objectStore('workspaces').getAll();
      return await new Promise<SavedWorkspace[]>((resolve, reject) => {
        read.onsuccess = () => resolve((read.result as SavedWorkspace[]).filter((record) => record.id.startsWith('recovery:')));
        read.onerror = () => reject(read.error);
      });
    } finally {
      database.close();
    }
  });
}

async function fixturePage(page: Page): Promise<void> {
  await page.route('**/__persistence_test_host__', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Persistence fixture</title>',
  }));
  await page.goto('./__persistence_test_host__');
}

async function replaceStoredWorkspace(page: Page, record: SavedWorkspace): Promise<void> {
  await page.evaluate(async (value) => {
    const request = indexedDB.open('TurboPascalIDE');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction('workspaces', 'readwrite');
      transaction.objectStore('workspaces').put(value);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, record);
}

async function savedWorkspace(page: Page, text?: string): Promise<SavedWorkspace> {
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-status', 'saved');
  await expect.poll(async () => {
    const saved = await readWorkspace(page);
    return saved !== null && (text === undefined || JSON.stringify(saved.payload).includes(text));
  }).toBe(true);
  const saved = await readWorkspace(page);
  if (!saved) throw new Error('No committed workspace');
  return saved;
}

async function reloadIde(page: Page): Promise<Ide> {
  await page.reload();
  await expect(page.locator('[data-testid="tp-screen"] [data-row="0"]')).toContainText('File');
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-workspace-ready', 'true');
  await page.addStyleTag({ content: '*{animation:none !important}' });
  return new Ide(page);
}

async function editorOptions(ide: Ide): Promise<void> {
  await ide.openMenu('o');
  await ide.chooseItem('e');
  await ide.chooseItem('e');
  await ide.waitForDialog('Editor Options');
}

async function editCommand(ide: Ide, accelerator: string): Promise<void> {
  await ide.openMenu('e');
  await ide.chooseItem(accelerator);
}

test('adding workspace persistence preserves files, settings and sessions in an older database', async ({ page }) => {
  await page.route('**/__persistence_test_host__', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Persistence fixture</title>',
  }));
  await page.goto('./__persistence_test_host__');
  await page.evaluate(async () => {
    // Dexie represents version 1 as native IndexedDB version 10.
    const request = indexedDB.open('TurboPascalIDE', 10);
    request.onupgradeneeded = () => {
      const database = request.result;
      const tables = [
        ['files', 'path', ['parentPath', 'modifiedAt', 'name']],
        ['directories', 'path', ['parentPath', 'name']],
        ['settings', 'category', []],
        ['sessions', 'id', ['name', 'updatedAt']],
        ['recentFiles', 'path', ['accessedAt']],
        ['breakpoints', 'id', ['filePath']],
      ] as const;
      for (const [name, keyPath, indexes] of tables) {
        const table = database.createObjectStore(name, { keyPath, autoIncrement: name === 'sessions' });
        for (const index of indexes) table.createIndex(index, index);
      }
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['files', 'settings', 'sessions'], 'readwrite');
    transaction.objectStore('files').put({ path: '/KEPT.PAS', name: 'KEPT.PAS', content: 'program Kept;begin end.' });
    transaction.objectStore('settings').put({ category: 'editor', data: { tabSize: 6 }, updatedAt: 123 });
    transaction.objectStore('sessions').put({ id: 1, name: 'Existing session', openFiles: ['/KEPT.PAS'], updatedAt: 123 });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });

  const ide = await Ide.open(page);
  await ide.type('New workspace');
  await savedWorkspace(page, 'New workspace');
  const preserved = await page.evaluate(async () => {
    const request = indexedDB.open('TurboPascalIDE');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['files', 'settings', 'sessions']);
      const read = (table: string, key: IDBValidKey): Promise<unknown> => {
        const entry = transaction.objectStore(table).get(key);
        return new Promise((resolve, reject) => {
          entry.onsuccess = () => resolve(entry.result as unknown);
          entry.onerror = () => reject(entry.error);
        });
      };
      return await Promise.all([read('files', '/KEPT.PAS'), read('settings', 'editor'), read('sessions', 1)]);
    } finally {
      database.close();
    }
  });
  expect(preserved).toEqual([
    { path: '/KEPT.PAS', name: 'KEPT.PAS', content: 'program Kept;begin end.' },
    { category: 'editor', data: { tabSize: 6 }, updatedAt: 123 },
    { id: 1, name: 'Existing session', openFiles: ['/KEPT.PAS'], updatedAt: 123 },
  ]);
});

test('reload restores unsaved files, tiled layout, selection, scroll, undo and IDE options', async ({ page }) => {
  // Typing 32 lines through real keyboard events and checking the full roundtrip
  // can exhaust the normal setup budget in WebKit under concurrent browser load.
  test.slow();
  const ide = await Ide.open(page);
  await ide.typeSource(Array.from({ length: 32 }, (_, index) => `Source line ${index + 1}`).join('\n'));
  await ide.openMenu('f');
  await ide.chooseItem('n');
  await ide.type('SECOND!');
  await editCommand(ide, 'u');
  await expect(ide.row(2)).toContainText('SECOND');
  await expect(ide.row(2)).not.toContainText('SECOND!');

  await editorOptions(ide);
  await ide.press('Tab');
  await ide.type('4');
  await expect(ide.row(14)).toContainText('4');
  await ide.press('Enter');
  await ide.openMenu('s');
  await ide.chooseItem('f');
  await ide.type('SECOND');
  await ide.press('Tab');
  await ide.press('Space');
  await expect(ide.row(9)).toContainText('[X] Case sensitive');
  await ide.press('Enter');
  await ide.waitForText('SECOND');
  await ide.openMenu('w');
  await ide.chooseItem('t');
  await expect(ide.row(1)).toContainText('NONAME00.PAS');
  await expect(ide.row(12)).toContainText('NONAME01.PAS');
  await ide.clickCell(30, 1);
  await ide.press('Home');
  for (let index = 0; index < 6; index += 1) await ide.press('Shift+ArrowRight');
  await expect(ide.row(11)).toContainText('32:7');
  await savedWorkspace(page, 'Source line 32');
  const before = await ide.screenText();

  const restored = await reloadIde(page);
  await expect.poll(() => restored.screenText()).toEqual(before);
  // Replacing the selection proves its endpoints and the active editor survived.
  await restored.type('Restored');
  await restored.waitForText('Restored line 32');
  await restored.press('F6');
  await editCommand(restored, 'r');
  await expect(restored.row(13)).toContainText('SECOND!');
  await editCommand(restored, 'u');
  await expect(restored.row(13)).toContainText('SECOND');
  await expect(restored.row(13)).not.toContainText('SECOND!');
  await editorOptions(restored);
  await expect(restored.row(14)).toContainText('4');
  await restored.press('Escape');
  await restored.openMenu('s');
  await restored.chooseItem('f');
  await expect(restored.row(6)).toContainText('SECOND');
  await expect(restored.row(9)).toContainText('[X] Case sensitive');
});

test('accepted filenames remain available in input history after reload', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('saved source');
  await ide.openMenu('f');
  await ide.chooseItem('a');
  await ide.type('FIRST.PAS');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('FIRST.PAS');
  await ide.openMenu('f');
  await ide.chooseItem('a');
  await ide.type('SECOND.PAS');
  await ide.press('Enter');
  await expect(ide.row(1)).toContainText('SECOND.PAS');
  await savedWorkspace(page, 'FIRST.PAS');

  const restored = await reloadIde(page);
  await expect(restored.row(1)).toContainText('SECOND.PAS');
  await restored.openMenu('f');
  await restored.chooseItem('a');
  await restored.press('ArrowDown');
  await expect(restored.row(6)).toContainText('SECOND.PAS');
  await expect(restored.row(7)).toContainText('FIRST.PAS');
  await restored.press('ArrowDown');
  await restored.press('Enter');
  await restored.waitForDialog('Save File As');
  await expect(restored.row(6)).toContainText('FIRST.PAS');
  await restored.press('Escape');
  await expect(restored.row(1)).toContainText('SECOND.PAS');
});

test('closing the final window preserves an empty desktop across reload', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.press('Alt+F3');
  await expect(ide.row(1)).not.toContainText('NONAME');
  await savedWorkspace(page);
  const before = await ide.screenText();
  const restored = await reloadIde(page);
  await expect.poll(() => restored.screenText()).toEqual(before);
  await restored.openMenu('f');
  await restored.chooseItem('n');
  await expect(restored.row(1)).toContainText('NONAME01.PAS');
});

test('reload keeps breakpoints and watch expressions but stops a paused program', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.typeSource(`program PersistDebug;
var total: Integer;
begin
  total := 5;
  total := total + 1;
  WriteLn(total);
end.`);
  await ide.moveTo(5, 1);
  await ide.press('Control+F8');
  await ide.press('Control+F9');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  await expect(ide.row(23)).toContainText('5:1');
  await ide.press('Control+F7');
  await ide.type('total');
  await ide.press('Enter');
  await expect(ide.row(18)).toContainText('total: 5');
  await savedWorkspace(page, 'total');

  const restored = await reloadIde(page);
  await expect(restored.row(18)).toContainText('total: Unknown identifier');
  await restored.openMenu('d');
  await restored.chooseItem('b');
  await restored.waitForDialog('Breakpoints');
  await expect(restored.row(8)).toContainText('NONAME00.PAS');
  await expect(restored.row(8)).toContainText(/\s5\s/);
  await restored.press('Escape');
  await restored.openMenu('d');
  await restored.chooseItem('r');
  await expect(restored.row(2)).toContainText('PC 0000');
  await expect(restored.row(3)).toContainText('SP 0000');
  await restored.press('Alt+F3');
  await restored.press('F6');
  await restored.press('Control+F9');
  await restored.waitForDialog('Compiling');
  await restored.press('Enter');
  await expect(restored.row(23)).toContainText('5:1');
  await restored.openMenu('d');
  await restored.chooseItem('w');
  await expect(restored.row(18)).toContainText('total: 5');
});

test('malformed saved data cannot crash the editor', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('before corruption');
  await savedWorkspace(page, 'before corruption');
  // A plain page at the same origin prevents the live IDE from overwriting the fixture.
  await page.route('**/__persistence_test_host__', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Persistence fixture</title>',
  }));
  await page.goto('./__persistence_test_host__');
  await page.evaluate(async () => {
    const request = indexedDB.open('TurboPascalIDE');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('workspaces', 'readwrite');
    transaction.objectStore('workspaces').put({
      id: 'active', schemaVersion: 1, revision: 100, updatedAt: Date.now(),
      payload: { desktop: { windows: [{ kind: 'edit', bufferId: 'missing' }] } },
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const recovered = await Ide.open(page);
  await recovered.type('Recovered source');
  await expect(recovered.row(2)).toContainText('Recovered source');
  expect(errors).toEqual([]);
  const recoveryCopies = await recoveryWorkspaces(page);
  expect(recoveryCopies).toHaveLength(1);
  expect(recoveryCopies[0]).toMatchObject({
    schemaVersion: 1,
    revision: 100,
    payload: { desktop: { windows: [{ kind: 'edit', bufferId: 'missing' }] } },
  });
});

test('failed IndexedDB save keeps editing intact and a later save recovers', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('Durable');
  const durable = await savedWorkspace(page, 'Durable');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'workspaces') throw new DOMException('Injected disk quota failure', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    Reflect.set(window, '__restorePersistencePut', () => { IDBObjectStore.prototype.put = original; });
  });
  await ide.type(' work still here');
  await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-status', 'error');
  await expect(ide.row(2)).toContainText('Durable work still here');
  expect(await readWorkspace(page)).toEqual(durable);
  await page.evaluate(() => {
    const restore: unknown = Reflect.get(window, '__restorePersistencePut');
    if (typeof restore === 'function') restore();
    Reflect.deleteProperty(window, '__restorePersistencePut');
  });
  await ide.type('!');
  const recovered = await savedWorkspace(page, 'Durable work still here!');
  expect(recovered.revision).toBeGreaterThan(durable.revision);
  const restored = await reloadIde(page);
  await expect(restored.row(2)).toContainText('Durable work still here!');
});

for (const futurePart of ['envelope', 'payload'] as const) {
  test(`a future ${futurePart} version is preserved and cannot be overwritten by an older editor`, async ({ page }) => {
    const ide = await Ide.open(page);
    await ide.type('Future workspace content');
    const current = await savedWorkspace(page, 'Future workspace content');
    const future: SavedWorkspace = futurePart === 'envelope'
      ? { ...current, schemaVersion: 2 }
      : { ...current, payload: { ...(current.payload as Record<string, unknown>), version: 2 } };
    await fixturePage(page);
    await replaceStoredWorkspace(page, future);
    await page.goto('./');
    const state = page.getByTestId('workspace-status');
    await expect(state).toHaveAttribute('data-status', 'error');
    await expect(state).toHaveAttribute('data-workspace-ready', 'false');
    await page.keyboard.type('Must not overwrite future data');
    await page.keyboard.press('Control+Shift+s');
    await expect(state).toHaveAttribute('data-status', 'error');
    await expect(state).toHaveAttribute('data-workspace-ready', 'false');
    expect((await new Ide(page).screenText()).join('\n')).not.toContain('Must not overwrite');
    expect(await readWorkspace(page)).toEqual(future);
    expect(await recoveryWorkspaces(page)).toEqual([]);
  });
}

test('a failed initial read blocks editing until retry restores the durable workspace', async ({ page }) => {
  const ide = await Ide.open(page);
  await ide.type('Read retry preserves source');
  const durable = await savedWorkspace(page, 'Read retry preserves source');
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'workspaces') throw new DOMException('Injected temporary read failure', 'UnknownError');
      return original.call(this, key);
    };
    Reflect.set(window, '__restorePersistenceGet', () => { IDBObjectStore.prototype.get = original; });
  });
  await page.reload();
  const state = page.getByTestId('workspace-status');
  await expect(state).toHaveAttribute('data-status', 'error');
  await expect(state).toHaveAttribute('data-workspace-ready', 'false');
  await page.keyboard.type('Discarded while loading');
  expect((await new Ide(page).screenText()).join('\n')).not.toContain('Discarded while loading');
  await page.evaluate(() => {
    const restore: unknown = Reflect.get(window, '__restorePersistenceGet');
    if (typeof restore === 'function') restore();
    Reflect.deleteProperty(window, '__restorePersistenceGet');
  });
  expect(await readWorkspace(page)).toEqual(durable);
  await page.keyboard.press('Control+Shift+s');
  await expect(state).toHaveAttribute('data-workspace-ready', 'true');
  await expect(new Ide(page).row(2)).toContainText('Read retry preserves source');
  expect(await savedWorkspace(page, 'Read retry preserves source')).toEqual(durable);
});

test('two tabs preserve both versions when the older tab explicitly resolves a save conflict', async ({ page, context }) => {
  const first = await Ide.open(page);
  await first.type('Shared source');
  const initial = await savedWorkspace(page, 'Shared source');
  const otherPage = await context.newPage();
  const second = await Ide.open(otherPage);
  await expect(second.row(2)).toContainText('Shared source');
  expect(await savedWorkspace(otherPage, 'Shared source')).toEqual(initial);

  await first.type(' from first tab');
  const firstVersion = await savedWorkspace(page, 'Shared source from first tab');
  await second.type(' from second tab');
  await expect(otherPage.getByTestId('workspace-status')).toHaveAttribute('data-status', 'error');
  await expect(second.row(2)).toContainText('Shared source from second tab');
  expect(await readWorkspace(otherPage)).toEqual(firstVersion);
  await second.type('!');
  await expect(otherPage.getByTestId('workspace-status')).toHaveAttribute('data-status', 'error');
  expect(await readWorkspace(otherPage)).toEqual(firstVersion);

  await second.press('Control+Shift+s');
  const secondVersion = await savedWorkspace(otherPage, 'Shared source from second tab!');
  expect(secondVersion.revision).toBeGreaterThan(firstVersion.revision);
  const archives = await recoveryWorkspaces(otherPage);
  expect(archives).toHaveLength(1);
  expect(archives[0]?.payload).toEqual(firstVersion.payload);
  expect(archives[0]?.revision).toBe(firstVersion.revision);
  const restored = await reloadIde(otherPage);
  await expect(restored.row(2)).toContainText('Shared source from second tab!');
  await otherPage.close();
});
