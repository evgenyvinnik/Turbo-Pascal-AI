import { expect, type Locator, type Page } from '@playwright/test';

export const CELL_W = 9;
export const CELL_H = 16;

/** Helpers for driving the character grid the IDE paints itself into. */
export class Ide {
  constructor(readonly page: Page) {}

  static async open(page: Page): Promise<Ide> {
    const ide = new Ide(page);
    await page.goto('/');
    await page.waitForSelector('[data-testid="tp-screen"] [data-row="0"]');
    await expect(ide.row(0)).toContainText('File');
    // Restored workspaces can have several windows, or an intentionally empty desktop.
    await expect(page.getByTestId('workspace-status')).toHaveAttribute('data-workspace-ready', 'true');
    // The editor blinks its caret; freeze it so snapshots are stable.
    await page.addStyleTag({ content: '*{animation:none !important}' });
    return ide;
  }

  row(y: number): Locator {
    return this.page.locator(`[data-row="${y}"]`);
  }

  /** Plain text of one screen row, trailing blanks trimmed. */
  async text(y: number): Promise<string> {
    const value = await this.row(y).evaluate((el) => el.textContent ?? '');
    return value.replace(/\s+$/, '');
  }

  /** The whole 80x25 screen as 25 lines of text. */
  async screenText(): Promise<string[]> {
    return this.page.$$eval('[data-row]', (rows) =>
      rows.map((r) => (r.textContent ?? '').replace(/\s+$/, '')),
    );
  }

  async find(needle: string): Promise<number> {
    const lines = await this.screenText();
    return lines.findIndex((l) => l.includes(needle));
  }

  /** Screen coordinates of a cell, for mouse interaction. */
  async cellPoint(col: number, row: number): Promise<{ x: number; y: number }> {
    const box = await this.page.locator('[data-testid="tp-screen"]').boundingBox();
    if (!box) throw new Error('screen not visible');
    const screen = await this.page.locator('[data-testid="tp-screen"] > div').boundingBox();
    if (!screen) throw new Error('grid not visible');
    const cw = screen.width / 80;
    const ch = screen.height / 25;
    return { x: screen.x + (col + 0.5) * cw, y: screen.y + (row + 0.5) * ch };
  }

  async clickCell(col: number, row: number): Promise<void> {
    const { x, y } = await this.cellPoint(col, row);
    await this.page.mouse.click(x, y);
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    await this.page.waitForTimeout(30);
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text);
    await this.page.waitForTimeout(50);
  }

  /** Opens one of the bundled sample programs through the Open a File box. */
  async openFile(name: string): Promise<void> {
    await this.press('F3');
    await expect(this.row(3)).toContainText('Open a File');
    await this.type(name);
    await this.press('Enter');
    await expect(this.row(1)).toContainText(name);
  }

  /** Types source text line by line, undoing the editor's auto-indent. */
  async typeSource(text: string): Promise<void> {
    const lines = text.split('\n');
    let indent = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (i > 0) {
        await this.page.keyboard.press('Enter');
        for (let k = 0; k < indent; k += 1) await this.page.keyboard.press('Backspace');
      }
      await this.page.keyboard.type(line);
      indent = /^ */.exec(line)?.[0].length ?? 0;
    }
    await this.page.waitForTimeout(50);
  }

  /** Moves the caret with Search > Go to line number and the arrow keys. */
  async moveTo(line: number, col: number): Promise<void> {
    await this.openMenu('S');
    await this.chooseItem('g');
    await this.waitForDialog('Go to Line Number');
    await this.page.keyboard.type(String(line));
    await this.press('Enter');
    for (let i = 1; i < col; i += 1) await this.page.keyboard.press('ArrowRight');
    await this.page.waitForTimeout(50);
  }

  /** Makes a harmless edit so the frame shows the modified marker. */
  async markModified(): Promise<void> {
    await this.page.keyboard.type(' ');
    await this.page.keyboard.press('Backspace');
    await this.page.waitForTimeout(30);
  }

  /** Opens a top level menu by its accelerator, e.g. `F` for File. */
  async openMenu(letter: string): Promise<void> {
    await this.press(`Alt+${letter}`);
    // While a menu is dropped the status line switches to `F1 Help | <hint>`.
    await expect(this.row(24)).toContainText('\u2502');
  }

  /** Chooses an item of the open menu by its accelerator letter. */
  async chooseItem(letter: string): Promise<void> {
    await expect(this.row(24)).toContainText('\u2502');
    await this.press(letter);
  }

  /** Waits for a modal dialog with this title to be on screen. */
  async waitForDialog(title: string): Promise<void> {
    await expect
      .poll(async () => (await this.screenText()).some((l) => l.includes(title)), {
        timeout: 10_000,
      })
      .toBe(true);
  }

  async waitForText(text: string): Promise<void> {
    await expect
      .poll(async () => (await this.screenText()).some((l) => l.includes(text)), {
        timeout: 15_000,
      })
      .toBe(true);
  }
}
