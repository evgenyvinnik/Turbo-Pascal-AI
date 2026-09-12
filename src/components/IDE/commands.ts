import { Machine } from '@compiler/runtime';
import { useDesktopStore, bufferText, type Buffer } from '@stores/desktopStore';
import { useDialogStore, type DialogValues } from '@stores/dialogStore';
import { useMenuStore } from '@stores/menuStore';
import { useCompilerStore } from '@stores/compilerStore';
import { useDebugStore } from '@stores/debugStore';
import { useIdeStore } from '@stores/ideStore';
import { createFile } from '@services/db/fileRepository';
import * as D from '@components/Dialogs/dialogDefs';
import { HELP_TOPICS } from './helpTopics';
import type { Pos } from '@stores/textBuffer';

export const SAMPLE_FILES = ['FIBONACCI.PAS', 'HELLO.PAS', 'PRIMES.PAS', 'SQUARE.PAS'];

const desk = () => useDesktopStore.getState();
const dlg = () => useDialogStore.getState();
const ide = () => useIdeStore.getState();

const message = (title: string, lines: string[]) => { dlg().open(D.messageDialog(title, lines)); };

const fileListing = (): { files: string[]; info: string[] } => {
  const open = Object.values(desk().buffers).map((b) => b.name);
  const files = [...new Set([...SAMPLE_FILES, ...open])].sort();
  return {
    files,
    info: [`${ide().directory}*.PAS`, `${String(files.length).padStart(19)}      0, 1980  12:00am`],
  };
};

/** Case aware substring search across the buffer. */
function findInBuffer(buf: Buffer, needle: string, from: Pos, backward: boolean, caseSensitive: boolean): Pos | null {
  if (!needle) return null;
  const cmp = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const target = cmp(needle);
  const lines = buf.lines;
  if (!backward) {
    for (let line = from.line; line < lines.length; line += 1) {
      const start = line === from.line ? from.col : 0;
      const idx = cmp(lines[line] ?? '').indexOf(target, start);
      if (idx >= 0) return { line, col: idx };
    }
    for (let line = 0; line <= from.line; line += 1) {
      const idx = cmp(lines[line] ?? '').indexOf(target);
      if (idx >= 0) return { line, col: idx };
    }
    return null;
  }
  for (let line = from.line; line >= 0; line -= 1) {
    const text = cmp(lines[line] ?? '');
    const end = line === from.line ? Math.max(0, from.col - 1) : text.length;
    const idx = text.lastIndexOf(target, end);
    if (idx >= 0) return { line, col: idx };
  }
  return null;
}

function searchAgain(): void {
  const buf = desk().activeBuffer();
  const s = ide().search;
  if (!buf || !s.text) return;
  const start = s.backward
    ? buf.cursor
    : { line: buf.cursor.line, col: buf.cursor.col + (buf.anchor ? 1 : 0) };
  const hit = findInBuffer(buf, s.text, start, s.backward, s.caseSensitive);
  if (!hit) {
    message('Error', ['Search string not found']);
    return;
  }
  desk().moveCursor(hit, false);
  desk().moveCursor({ line: hit.line, col: hit.col + s.text.length }, true);
}

function replaceAll(): void {
  const s = ide().search;
  if (!s.text) return;
  let count = 0;
  desk().edit((b) => {
    const flags = s.caseSensitive ? 'g' : 'gi';
    const re = new RegExp(s.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    b.lines = b.lines.map((line) => {
      const next = line.replace(re, () => {
        count += 1;
        return s.replacement;
      });
      return next;
    });
    if (count > 0) b.modified = true;
  });
  message('Information', [`${String(count)} occurrence${count === 1 ? '' : 's'} replaced`]);
}

async function loadSample(name: string): Promise<string> {
  try {
    const res = await fetch(`/samples/${name}`);
    if (res.ok) return await res.text();
  } catch {
    /* offline: fall through to an empty buffer */
  }
  return '';
}

function openNamedFile(name: string, replaceActive: boolean): void {
  const existing = Object.values(desk().buffers).find((b) => b.name === name);
  if (existing) {
    const win = desk().windows.find((w) => w.bufferId === existing.id);
    if (win) {
      desk().focusWindow(win.id);
      return;
    }
  }
  void loadSample(name).then((text) => {
    if (replaceActive) desk().closeWindow();
    desk().openFile(name, name, text);
  });
}

function compileErrors(): string[] {
  const result = useCompilerStore.getState().result;
  if (!result) return [];
  return result.errors.map((e) => `${e.file}(${String(e.line)}): ${e.message}`);
}

async function doCompile(thenRun: boolean): Promise<void> {
  const buf = desk().activeBuffer();
  if (!buf) {
    message('Error', ['No file is open']);
    return;
  }
  desk().clearError();
  const source = bufferText(buf);
  const result = await useCompilerStore.getState().compile(source, buf.name);
  const lines = buf.lines.length;

  if (result.errors.length > 0) {
    const err = result.errors[0];
    const text = `Error ${String(err?.line ?? 0)}: ${err?.message ?? 'Compile error'}`;
    desk().setError(Math.max(1, err?.line ?? 1), text);
    useCompilerStore.getState().setMessages([`Compiling ${buf.name}`, ...compileErrors()]);
    ide().setLastCompile({ file: buf.name, lines, ok: false, message: text });
    return;
  }

  ide().setLastCompile({ file: buf.name, lines, ok: true, message: 'Compile successful' });
  useCompilerStore.getState().setMessages([`Compiling ${buf.name}`, 'Compile successful']);
  dlg().open(
    D.compilingDialog(
      [
        `Main file: ${buf.name}`,
        'Done.',
        '',
        `Destination: ${ide().destination}     Line number:  ${String(lines).padStart(6)}`,
        `Free memory:   276K     Total lines:  ${String(lines).padStart(6)}`,
      ],
      'Compile successful:',
      'Press any key',
    ),
    {},
    () => {
      if (thenRun) runProgram();
    },
  );
}

function runProgram(): void {
  const result = useCompilerStore.getState().result;
  if (!result?.bytecode) return;
  try {
    const machine = new Machine(result.bytecode, { maxInstructions: 5_000_000 });
    machine.reset();
    machine.run();
    useCompilerStore.getState().setProgramOutput(machine.getOutput());
    desk().openTool('output');
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    useCompilerStore.getState().setProgramOutput([text]);
    desk().openTool('output');
    message('Error', [text.slice(0, 60)]);
  }
}

const asBools = (v: unknown): boolean[] => (Array.isArray(v) ? (v as boolean[]) : []);

/** Runs the command behind a menu item, a shortcut or a status bar key. */
export function runCommand(id: string): void {
  const d = desk();
  switch (id) {
    case 'file.new':
      d.newFile();
      return;

    case 'file.open': {
      const { files, info } = fileListing();
      dlg().open(D.openFileDialog(files, info), { name: '*.PAS' }, (result, values) => {
        if (result !== 'open' && result !== 'replace') return;
        const typed = String(values.name ?? '').trim().toUpperCase();
        const chosen = typed && !typed.includes('*') ? typed : (files[Number(values.files ?? 0)] ?? '');
        if (chosen) openNamedFile(chosen, result === 'replace');
      });
      return;
    }

    case 'file.save': {
      const buf = d.activeBuffer();
      if (!buf) return;
      void createFile(`/${buf.name}`, buf.name, bufferText(buf));
      d.markSaved();
      return;
    }

    case 'file.saveas': {
      const { files, info } = fileListing();
      const buf = d.activeBuffer();
      dlg().open(D.saveAsDialog(files, info), { name: buf?.name ?? '' }, (result, values) => {
        if (result !== 'ok') return;
        const name = String(values.name ?? '').toUpperCase();
        if (!name) return;
        const current = desk().activeBuffer();
        if (current) void createFile(`/${name}`, name, bufferText(current));
        desk().markSaved(name, name);
      });
      return;
    }

    case 'file.saveall':
      for (const buf of Object.values(d.buffers)) {
        void createFile(`/${buf.name}`, buf.name, bufferText(buf));
      }
      d.markSaved();
      return;

    case 'file.chdir':
      dlg().open(
        D.changeDirDialog(['..', 'BIN', 'SAMPLES', 'UNITS'], ide().directory),
        { dir: ide().directory },
        (result, values) => {
          if (result === 'ok' || result === 'chdir') ide().setDirectory(String(values.dir ?? 'A:\\'));
        },
      );
      return;

    case 'file.print':
      message('Print', ['Printer is not available', 'in the browser']);
      return;

    case 'file.printer':
      message('Printer setup', ['Could not find printer', 'filter PRNFLTR.']);
      return;

    case 'file.dos':
      message('DOS shell', ['Type EXIT to return', 'to Turbo Pascal']);
      return;

    case 'file.exit':
      d.closeAll();
      return;

    case 'edit.undo':
      d.undo();
      return;
    case 'edit.redo':
      d.redo();
      return;
    case 'edit.cut':
      d.cut();
      return;
    case 'edit.copy':
      d.copy();
      return;
    case 'edit.paste':
      d.paste();
      return;
    case 'edit.clear':
      d.clearSelection();
      return;
    case 'edit.clipboard':
      message('Clipboard', [d.clipboard ? d.clipboard.slice(0, 50) : '(empty)']);
      return;

    case 'search.find':
      dlg().open(
        D.findDialog(),
        {
          text: ide().search.text,
          options: [ide().search.caseSensitive, ide().search.wholeWords, false],
          direction: ide().search.backward ? 1 : 0,
        },
        (result, values) => {
          if (result !== 'ok') return;
          const opts = asBools(values.options);
          ide().setSearch({
            text: String(values.text ?? ''),
            caseSensitive: Boolean(opts[0]),
            wholeWords: Boolean(opts[1]),
            backward: Number(values.direction ?? 0) === 1,
          });
          searchAgain();
        },
      );
      return;

    case 'search.replace':
      dlg().open(
        D.replaceDialog(),
        { text: ide().search.text, replacement: ide().search.replacement },
        (result, values) => {
          const opts = asBools(values.options);
          ide().setSearch({
            text: String(values.text ?? ''),
            replacement: String(values.replacement ?? ''),
            caseSensitive: Boolean(opts[0]),
            wholeWords: Boolean(opts[1]),
            promptOnReplace: Boolean(opts[3]),
            backward: Number(values.direction ?? 0) === 1,
          });
          if (result === 'ok') searchAgain();
          if (result === 'all') replaceAll();
        },
      );
      return;

    case 'search.again':
      searchAgain();
      return;

    case 'search.goto': {
      const buf = d.activeBuffer();
      dlg().open(D.gotoLineDialog(), { line: String((buf?.cursor.line ?? 0) + 1) }, (result, values) => {
        if (result !== 'ok') return;
        const n = parseInt(String(values.line ?? '1'), 10);
        if (Number.isFinite(n)) desk().gotoLine(n);
      });
      return;
    }

    case 'search.finderror':
      message('Find error', ['Address not found']);
      return;

    case 'run.run':
      void doCompile(true);
      return;
    case 'run.stepover':
    case 'run.trace': {
      const buf = d.activeBuffer();
      if (!buf) return;
      const next = Math.min(buf.lines.length, (buf.highlight ?? buf.cursor.line) + 1);
      d.setHighlight(next);
      return;
    }
    case 'run.gotocursor': {
      const buf = d.activeBuffer();
      if (buf) d.setHighlight(buf.cursor.line + 1);
      return;
    }
    case 'run.params':
      dlg().open(D.messageDialog('Program Parameters', ['No parameters are set']));
      return;

    case 'compile.compile':
    case 'compile.make':
    case 'compile.build':
      void doCompile(false);
      return;

    case 'compile.destination':
      ide().toggleDestination();
      return;

    case 'compile.primary': {
      const { files, info } = fileListing();
      dlg().open(D.openFileDialog(files, info), { name: '*.PAS' }, (result, values) => {
        if (result === 'open') ide().setPrimaryFile(files[Number(values.files ?? 0)] ?? '');
      });
      return;
    }

    case 'compile.clearprimary':
      ide().setPrimaryFile('');
      return;

    case 'compile.info': {
      const last = ide().lastCompile;
      const buf = d.activeBuffer();
      dlg().open(
        D.informationDialog(
          [
            [
              `Source compiled: ${String(last?.lines ?? 0).padStart(7)} lines`,
              `Code size:      ${String(22848).padStart(8)} bytes`,
              `Data size:      ${String(704).padStart(8)} bytes`,
              `Stack size:     ${String(16384).padStart(8)} bytes`,
              `Minimum heap size: ${String(0).padStart(5)} bytes`,
              `Maximum heap size: ${String(655360).padStart(5)} bytes`,
            ],
            ['DOS:      55K', 'IDE:     307K', 'Symbols:   1K', 'Program:   0K', 'Free:    276K'],
            ['IDE:       0K', 'Other:     0K', 'Free:      0K'],
          ],
          [
            `Status: ${buf?.name ?? 'NONAME00.PAS'} ${last?.ok === false ? 'failed' : 'terminated'},`,
            'exit code 0.',
          ],
        ),
      );
      return;
    }

    case 'debug.watch':
      d.toggleTool('watches');
      return;
    case 'debug.callstack':
      d.toggleTool('callstack');
      return;
    case 'debug.output':
    case 'debug.userscreen':
      d.toggleTool('output');
      return;
    case 'tools.messages':
      d.toggleTool('messages');
      return;
    case 'debug.register':
      message('Register', ['The CPU window is not', 'available in this build']);
      return;
    case 'debug.breakpoints':
      message('Breakpoints', ['No breakpoints are set']);
      return;
    case 'debug.addbreak':
      message('Add breakpoint', ['Breakpoints are not', 'available in this build']);
      return;

    case 'debug.addwatch':
      dlg().open(D.addWatchDialog(), {}, (result, values) => {
        if (result !== 'ok') return;
        const expr = String(values.expr ?? '').trim();
        if (!expr) return;
        useDebugStore.getState().addWatch(expr);
        desk().openTool('watches');
      });
      return;

    case 'debug.evaluate':
      dlg().open(D.addWatchDialog(), {}, () => undefined);
      return;

    case 'options.compiler':
      dlg().open(
        D.compilerOptionsDialog(),
        { ...ide().compilerOptions, defines: ide().defines },
        (result, values) => {
          if (result !== 'ok') return;
          const { defines, ...rest } = values as DialogValues & { defines?: string };
          const opts: Record<string, boolean[]> = {};
          for (const [k, v] of Object.entries(rest)) opts[k] = asBools(v);
          ide().setCompilerOptions(opts, defines ?? '');
        },
      );
      return;

    case 'options.memory':
      message('Memory sizes', ['Stack size    16384', 'Low heap limit    0', 'High heap limit 655360']);
      return;
    case 'options.linker':
      message('Linker', ['Link buffer: Memory', 'Map file: Off']);
      return;
    case 'options.debugger':
      message('Debugger', ['Integrated debugging: On', 'Display swapping: Smart']);
      return;
    case 'options.directories':
      message('Directories', ['EXE & TPU directory:', ide().directory]);
      return;
    case 'options.tools':
      message('Tools', ['Grep', 'Turbo Assembler', 'Turbo Debugger', 'Turbo Profiler']);
      return;
    case 'env.preferences':
      message('Preferences', ['Screen size: 80x25', 'Auto save: Editor files']);
      return;
    case 'env.editor':
      message('Editor options', ['Insert mode: On', 'Auto indent mode: On', 'Tab size: 8']);
      return;
    case 'env.mouse':
      message('Mouse options', ['Right mouse button:', 'Topic search']);
      return;
    case 'env.startup':
      message('Startup options', ['Use expanded memory', 'Load TURBO.TPL']);
      return;
    case 'env.colors':
      message('Colors', ['Color customisation is', 'not available yet']);
      return;

    case 'window.tile':
      d.tile();
      return;
    case 'window.cascade':
      d.cascade();
      return;
    case 'window.closeall':
      d.closeAll();
      return;
    case 'window.refresh':
      return;
    case 'window.zoom':
      d.zoomActive();
      return;
    case 'window.next':
      d.cycleWindow(1);
      return;
    case 'window.previous':
      d.cycleWindow(-1);
      return;
    case 'window.close':
      d.closeWindow();
      return;
    case 'window.sizemove':
      message('Size/Move', ['Drag the title bar to move', 'the window with the mouse']);
      return;
    case 'window.list': {
      const titles = d.windows.map((w) => `${String(w.num)}. ${w.title}`);
      dlg().open(D.windowListDialog(titles), {}, (result, values) => {
        if (result !== 'ok') return;
        const win = desk().windows[Number(values.windows ?? 0)];
        if (win) desk().focusWindow(win.id);
      });
      return;
    }

    case 'help.about':
      dlg().open(D.aboutDialog());
      return;

    case 'help.contents':
    case 'help.index':
    case 'help.topic':
    case 'help.previous':
      ide().setHelpTopic('contents');
      d.openTool('help');
      return;
    case 'help.using':
      ide().setHelpTopic('using');
      d.openTool('help');
      return;
    case 'help.directives':
      ide().setHelpTopic('directives');
      d.openTool('help');
      return;
    case 'help.procedures':
      ide().setHelpTopic('procedures');
      d.openTool('help');
      return;
    case 'help.reserved':
      ide().setHelpTopic('reserved');
      d.openTool('help');
      return;
    case 'help.units':
      ide().setHelpTopic('units');
      d.openTool('help');
      return;
    case 'help.language':
      ide().setHelpTopic('language');
      d.openTool('help');
      return;
    case 'help.errors':
      ide().setHelpTopic('errors');
      d.openTool('help');
      return;
    case 'help.files':
      message('Help files', ['TURBO.TPH', 'TPHELP.TPH']);
      return;

    case 'menu.open':
    case 'menu.local':
      useMenuStore.getState().openMenu(0);
      return;

    default:
      message('Information', ['This command is not', 'implemented yet']);
  }
}

export const helpLines = (topic: string): string[] =>
  HELP_TOPICS[topic]?.lines ?? HELP_TOPICS.contents?.lines ?? [];
