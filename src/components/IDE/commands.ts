import { useDesktopStore, bufferText, type Buffer } from '@stores/desktopStore';
import { useDialogStore, type DialogValues } from '@stores/dialogStore';
import { useMenuStore } from '@stores/menuStore';
import { useCompilerStore } from '@stores/compilerStore';
import { useDebugStore } from '@stores/debugStore';
import { useIdeStore } from '@stores/ideStore';
import { createFile } from '@services/db/fileRepository';
import * as D from '@components/Dialogs/dialogDefs';
import { showHelp, showContextHelp, previousHelp, topicForIdentifier, getHelpLines } from './helpNavigation';
import { startProgram, stopProgram, resumeProgram, refreshDebug, evaluateProgram, toggleProgramScreen, virtualFiles, readVirtualFile, writeVirtualFile } from './runtimeSession';
import { formatDebugValue, type DebugAction } from '@compiler/runtime/SourceDebugger';
import { orderRange, type Pos } from '@stores/textBuffer';
import { printSource } from './printSource';
import { decodeDosText, encodeDosText } from '@compiler/encoding';
import { openLocalMenu } from './localMenu';
import { programArgumentsDialog } from './programArgumentsDialog';
import { parseGrepArguments, searchGrepFiles } from './grepSearch';
import { sourcePath } from '@compiler/project';
import { openDosSession } from '@services/dos/dosSession';
import { openNativePascalSession } from '@services/dos/nativePascal';

export const SAMPLE_FILES = ['FIBONACCI.PAS', 'HELLO.PAS', 'PRIMES.PAS', 'SQUARE.PAS'];

const desk = () => useDesktopStore.getState();
const dlg = () => useDialogStore.getState();
const ide = () => useIdeStore.getState();
let compileRequest = 0;
let grepArguments = '';
let grepConfiguration = '';

async function grepSources(argumentsText: string): Promise<void> {
  const query = parseGrepArguments(argumentsText);
  const sources: Record<string,string> = {};
  for (const name of [...new Set([...SAMPLE_FILES, ...virtualFiles()])]) sources[name] = await loadSample(name);
  // The current editor contents take precedence over their last saved versions.
  for (const buffer of Object.values(desk().buffers)) sources[buffer.name] = bufferText(buffer);
  const matches = searchGrepFiles(sources, query);
  useCompilerStore.getState().setMessages([
    `Grep: ${query.pattern}`,
    ...matches.map((match)=>`${match.file}(${String(match.line)}): ${match.text}`),
    ...(matches.length === 0 ? ['No matches found'] : matches.length === 5000 ? ['First 5000 matches shown'] : []),
  ]);
  desk().openTool('messages');
  const window = desk().windows.find((item)=>item.kind==='messages');
  if (window) desk().setToolSelection(window.id, matches.length ? 1 : 0);
}

function goToMessage(direction: -1 | 0 | 1): void {
  const messages=useCompilerStore.getState().messages;
  const window=desk().windows.find((item)=>item.kind==='messages');
  let index=window?.selected ?? 0;
  for(let attempt=0;attempt<messages.length;attempt++) {
    if(direction || attempt) index=(index+(direction || 1)+messages.length)%messages.length;
    const location=/^(.+)\((\d+)\):/.exec(messages[index] ?? '');
    if(!location) {
      if(direction === 0) return;
      continue;
    }
    if(window) desk().setToolSelection(window.id,index);
    const name=location[1] ?? '',line=Number(location[2]);
    const existing=Object.values(desk().buffers).find((buffer)=>buffer.name===name);
    const source=desk().windows.find((item)=>item.bufferId===existing?.id);
    if(source){desk().focusWindow(source.id);desk().gotoLine(line);}
    else void loadSample(name).then((text)=>{desk().openFile(name,name,text);desk().gotoLine(line);});
    return;
  }
}

const configuration = () => {
  const state = ide();
  return { version: 1, compilerOptions: state.compilerOptions, optionDialogs: state.optionDialogs,
    defines: state.defines, tools: state.tools, programParameters: state.programParameters,
    destination: state.destination, primaryFile: state.primaryFile, directory: state.directory };
};

function saveConfiguration(name: string): void {
  writeVirtualFile(name, JSON.stringify(configuration()));
  useIdeStore.setState({ optionsFile: name });
}

function loadConfiguration(name: string): void {
  const text = readVirtualFile(name);
  if (text === null) throw new Error('Options file not found');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid options file');
  const value = parsed as Partial<ReturnType<typeof configuration>>;
  if (value.version !== 1 || !value.compilerOptions || !value.optionDialogs || !Array.isArray(value.tools)
    || !['Memory', 'Disk'].includes(String(value.destination)) || ['defines', 'programParameters', 'primaryFile', 'directory'].some((key) => typeof value[key as keyof typeof value] !== 'string')) throw new Error('Invalid options file');
  const settings = value as ReturnType<typeof configuration>;
  useIdeStore.setState({ compilerOptions: settings.compilerOptions, optionDialogs: settings.optionDialogs,
    defines: settings.defines, tools: settings.tools, programParameters: settings.programParameters,
    destination: settings.destination, primaryFile: settings.primaryFile, directory: settings.directory });
  useIdeStore.setState({ optionsFile: name });
}

const message = (title: string, lines: string[]) => { dlg().open(D.messageDialog(title, lines)); };

/** Turbo Pascal seeds search dialogs from the identifier at the caret. */
const searchText = (): string => {
  if (ide().search.text) return ide().search.text;
  const buf = desk().activeBuffer();
  if (!buf) return '';
  const line = buf.lines[buf.cursor.line] ?? '';
  let start = Math.min(buf.cursor.col, line.length);
  let end = start;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1] ?? '')) start -= 1;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end] ?? '')) end += 1;
  return line.slice(start, end);
};

const fileListing = (): { files: string[]; info: string[] } => {
  const open = Object.values(desk().buffers).map((b) => b.name);
  const files = [...new Set([...SAMPLE_FILES, ...open, ...virtualFiles().filter((name) => /\.pas$/i.test(name))])].sort();
  return {
    files,
    info: [`${ide().directory}*.PAS`, `${String(files.length).padStart(19)}      0, 1980  12:00am`],
  };
};

interface TextMatch { start: number; end: number }
let searchScope: { bufferId: string; start: number; end: number } | null = null;
let lastSearch: { bufferId: string; match: TextMatch; source: string } | null = null;

function textOffset(buffer: Buffer, position: Pos): number {
  return buffer.lines.slice(0, position.line).reduce((length, line) => length + line.length + 1, 0) + position.col;
}

function textPosition(source: string, offset: number): Pos {
  const prefix = source.slice(0, Math.max(0, offset)).split('\n');
  return { line: prefix.length - 1, col: prefix.at(-1)?.length ?? 0 };
}

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Borland Programmer's Reference, appendix A, table A.5 (page 270).
 * Only ^ $ . * + [] ranges/negation and backslash are wildcards; JS-only
 * grouping, alternation, ? and brace repetition remain ordinary characters.
 */
function searchPattern(text: string, regular: boolean): string {
  if (!regular) return escapePattern(text);
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '\\') {
      const literal = text[++index];
      if (literal === undefined) throw new Error('Invalid regular expression');
      result += escapePattern(literal);
    } else if (char === '[') {
      let group = '[';
      if (text[index + 1] === '^') { group += '^\\r\\n'; index += 1; }
      let closed = false;
      while (++index < text.length) {
        const member = text[index] ?? '';
        if (member === ']') { closed = true; break; }
        if (member === '\\') {
          const literal = text[++index];
          if (literal === undefined) throw new Error('Invalid regular expression');
          group += `\\u${literal.charCodeAt(0).toString(16).padStart(4, '0')}`;
        } else group += member === '^' || member === '[' ? `\\${member}` : member;
      }
      if (!closed || group === '[' || group === '[^\\r\\n') throw new Error('Invalid regular expression');
      result += `${group}]`;
    } else if (char === '.' || char === '*' || char === '+' || (char === '^' && index === 0) || (char === '$' && index === text.length - 1)) {
      result += char;
    } else result += escapePattern(char);
  }
  return result;
}

function beginSearch(buffer: Buffer): void {
  lastSearch = null;
  searchScope = null;
  if (ide().search.selectedOnly) {
    const [start, end] = orderRange(buffer.anchor ?? buffer.cursor, buffer.cursor);
    searchScope = { bufferId: buffer.id, start: textOffset(buffer, start), end: textOffset(buffer, end) };
  }
}

function textMatches(buffer: Buffer): TextMatch[] {
  const settings = ide().search;
  if (!settings.text) return [];
  const source = buffer.lines.join('\n');
  const scope = settings.selectedOnly ? searchScope : null;
  if (settings.selectedOnly && scope?.bufferId !== buffer.id) return [];
  let expression: RegExp;
  try { expression = new RegExp(searchPattern(settings.text, settings.regularExpression), settings.caseSensitive ? 'gm' : 'gim'); }
  catch { throw new Error('Invalid regular expression'); }
  const matches: TextMatch[] = [];
  for (const match of source.matchAll(expression)) {
    const start = match.index, end = start + match[0].length;
    if (scope && (start < scope.start || end > scope.end)) continue;
    if (settings.wholeWords && (/[A-Za-z0-9_]/.test(source[start - 1] ?? '') || /[A-Za-z0-9_]/.test(source[end] ?? ''))) continue;
    matches.push({ start, end });
  }
  return matches;
}

function showSearchMatch(buffer: Buffer, match: TextMatch): void {
  const source = buffer.lines.join('\n');
  desk().moveCursor(textPosition(source, match.start), false);
  desk().moveCursor(textPosition(source, match.end), true);
  const window = desk().activeWindow();
  desk().ensureVisible(Math.max(1, (window?.rect.h ?? 23) - 2), Math.max(1, (window?.rect.w ?? 80) - 2));
  lastSearch = { bufferId: buffer.id, match, source };
}

function searchAgain(initial = false): void {
  const buffer = desk().activeBuffer();
  if (!buffer || !ide().search.text) return;
  try {
    const matches = textMatches(buffer);
    const settings = ide().search;
    const previous = !initial && lastSearch?.bufferId === buffer.id && lastSearch.source === buffer.lines.join('\n') && textOffset(buffer, buffer.cursor) === lastSearch.match.end && buffer.anchor !== null && textOffset(buffer, buffer.anchor) === lastSearch.match.start ? lastSearch.match : null;
    const cursor = textOffset(buffer, buffer.cursor);
    const from = initial && settings.entireScope ? (settings.backward ? Infinity : -1) : previous ? (settings.backward ? previous.start - 1 : Math.max(previous.end, previous.start + 1)) : cursor;
    const ordered = settings.backward ? [...matches].reverse() : matches;
    const match = ordered.find((candidate) => settings.backward ? candidate.start <= from : candidate.start >= from) ?? ordered[0];
    if (match) showSearchMatch(buffer, match);
    else message('Error', ['Search string not found.']);
  } catch (error) { message('Error', [error instanceof Error ? error.message : String(error)]); }
}

/** One replacement transaction retains a single meaningful Undo snapshot. */
function replaceMatches(bufferId: string, matches: TextMatch[], recordUndo = true): void {
  const buffer = desk().activeBuffer();
  if (!buffer || buffer.id !== bufferId || matches.length === 0) return;
  const settings = ide().search;
  const original = buffer.lines.join('\n');
  let text = original;
  for (const match of [...matches].sort((a, b) => b.start - a.start)) text = text.slice(0, match.start) + settings.replacement + text.slice(match.end);
  desk().edit((next) => {
    if (recordUndo) {
      next.undo.push({ lines: [...next.lines], cursor: { ...next.cursor } });
      if (next.undo.length > 200) next.undo.shift();
    }
    next.redo = [];
    next.lines = text.split('\n');
    next.cursor = textPosition(text, matches[0]?.start ?? 0);
    next.anchor = null;
    next.modified = true;
    next.error = null;
    next.highlight = null;
  });
  if (searchScope?.bufferId === bufferId) searchScope.end += text.length - original.length;
  lastSearch = null;
}

function replaceText(all: boolean): void {
  const buffer = desk().activeBuffer();
  if (!buffer || !ide().search.text) return;
  try {
    const settings = ide().search;
    const cursor = textOffset(buffer, buffer.cursor);
    let matches = textMatches(buffer).filter((match) => settings.entireScope || (settings.backward ? match.end <= cursor : match.start >= cursor));
    if (settings.backward) matches.reverse();
    if (!all) matches = matches.slice(0, 1);
    if (!matches.length) { message('Error', ['Search string not found.']); return; }
    const accepted: TextMatch[] = [];
    const complete = (): void => {
      message('Information', [`${String(accepted.length)} occurrence${accepted.length === 1 ? '' : 's'} replaced`]);
    };
    if (!settings.promptOnReplace) { accepted.push(...matches); replaceMatches(buffer.id, accepted); complete(); return; }
    let index = 0;
    let offset = 0;
    const prompt = (): void => {
      const match = matches[index++];
      if (!match) { complete(); return; }
      const adjusted = { start: match.start + offset, end: match.end + offset };
      const current = desk().activeBuffer();
      if (!current || current.id !== buffer.id) return;
      showSearchMatch(current, adjusted);
      dlg().open({
        id: 'replace-confirm', title: 'Replace', rect: { x: 16, y: 9, w: 48, h: 7 },
        controls: [
          { kind: 'static', x: 3, y: 2, text: 'Replace this occurrence?' },
          ...['Yes', 'No', 'Cancel'].map((label, button) => ({
            kind: 'button' as const, id: label.toLowerCase(), label: `~${label.charAt(0)}~${label.slice(1)}`,
            result: label.toLowerCase(), x: 6 + button * 13, y: 4, w: 9, hint: label === 'Cancel' ? 'Stop replacing text' : label === 'Yes' ? 'Replace this occurrence' : 'Skip this occurrence', default: button === 0,
          })),
        ],
      }, {}, (action) => {
        if (action === 'yes') {
          replaceMatches(buffer.id, [adjusted], accepted.length === 0);
          accepted.push(match);
          if (!settings.backward) offset += settings.replacement.length - (match.end - match.start);
        }
        if (action === 'cancel') complete();
        else prompt();
      });
    };
    prompt();
  } catch (error) { message('Error', [error instanceof Error ? error.message : String(error)]); }
}

async function loadSample(name: string): Promise<string> {
  const saved = readVirtualFile(name);
  if (saved !== null) return decodeDosText(saved);
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
  return result.errors.flatMap((e) => [
    `${e.file}(${String(e.line)}): Error${e.code === undefined ? '' : ` ${String(e.code)}`}: ${e.message}`,
    ...(e.detail && e.detail !== e.message ? [`  ${e.detail}`] : []),
  ]);
}

async function doCompile(thenRun: boolean, debugAction: DebugAction = 'run', targetLine = 0): Promise<void> {
  const request = ++compileRequest;
  stopProgram(false);
  const desktop = desk();
  const sourceWindow = [...desktop.windows].reverse().find((win) => win.kind === 'edit');
  let buf = (ide().primaryFile ? Object.values(desktop.buffers).find((buffer) => buffer.name === ide().primaryFile) : undefined)
    ?? desktop.activeBuffer() ?? (sourceWindow?.bufferId ? desktop.buffers[sourceWindow.bufferId] : null);
  if (ide().primaryFile && buf?.name !== ide().primaryFile) {
    const name = ide().primaryFile;
    const text = await loadSample(name);
    if (request !== compileRequest) return;
    desktop.openFile(name, name, text);
    buf = desk().activeBuffer();
  }
  if (!buf) {
    message('Error', ['No file is open']);
    return;
  }
  const sourceId = desktop.windows.find((win) => win.bufferId === buf.id)?.id;
  if (sourceId) desktop.focusWindow(sourceId);
  desk().clearError();
  const source = bufferText(buf);
  const sources: Record<string, string> = {};
  for (const file of virtualFiles()) sources[file] = decodeDosText(readVirtualFile(file) ?? '');
  for (const buffer of Object.values(desk().buffers)) {
    sources[buffer.path] = bufferText(buffer);
    sources[buffer.name] = bufferText(buffer);
  }
  const directories = ide().optionDialogs['options.directories'];
  const result = await useCompilerStore.getState().compile(source, buf.path, {
    ioChecking: ide().compilerOptions.runtime?.[2] ?? true,
    overflowChecking: ide().compilerOptions.runtime?.[3] ?? false,
    rangeChecking: ide().compilerOptions.runtime?.[0] ?? false,
    strictVarStrings: ide().compilerOptions.syntax?.[0] ?? true,
    completeBooleanEvaluation: ide().compilerOptions.syntax?.[1] ?? false,
    openStrings: ide().compilerOptions.syntax?.[4] ?? false,
    farCalls: ide().compilerOptions.codegen?.[0] ?? false,
    sources, defines: ide().defines.split(/[;,\s]+/).filter(Boolean),
    includeDirectories: String(directories?.include ?? '').split(';').filter(Boolean),
    unitDirectories: String(directories?.unit ?? '').split(';').filter(Boolean),
  });
  if (request !== compileRequest) return;
  const lines = buf.lines.length;
  if (result.nativeRequired) {
    await openNativePascalSession(thenRun && debugAction === 'run').catch((error: unknown) => { message('Native Pascal', [error instanceof Error ? error.message : String(error)]); });
    return;
  }

  if (result.errors.length > 0) {
    const err = result.errors[0];
    const errorBuffer = Object.values(desk().buffers).find(buffer => sourcePath(buffer.path) === sourcePath(err?.file ?? buf.name));
    const errorSource = Object.entries(sources).find(([name]) => sourcePath(name) === sourcePath(err?.file ?? ''))?.[1];
    if (!errorBuffer && err?.file && errorSource !== undefined) desk().openFile(err.file, err.file, errorSource);
    const window = desk().windows.find((win) => win.bufferId === (errorBuffer?.id ?? desk().activeBuffer()?.id ?? buf.id));
    if (window) desk().focusWindow(window.id);
    const text = `Error${err?.code === undefined ? '' : ` ${String(err.code)}`}: ${err?.message ?? 'Compile error'}`;
    desk().setError(Math.max(1, err?.line ?? 1), text);
    useCompilerStore.getState().setMessages([`Compiling ${buf.name}`, ...compileErrors()]);
    ide().setLastCompile({ file: buf.name, lines, ok: false, message: text });
    return;
  }

  ide().setLastCompile({ file: buf.name, lines, ok: true, message: 'Compile successful' });
  useCompilerStore.getState().setMessages([`Compiling ${buf.name}`, 'Compile successful']);
  dlg().open(
    D.compilingDialog(
      buf.name,
      ide().destination,
      lines,
      'Compile successful:',
      'Press any key',
    ),
    {},
    (action) => {
      if (thenRun && action === 'ok' && request === compileRequest && result.bytecode) {
        if (result.isUnit) message('Error', ['Cannot run a unit.', 'Open a program that uses this unit.']);
        else startProgram(result.bytecode, buf.path, buf.id, debugAction, targetLine);
      }
    },
  );
}

const asBools = (v: unknown): boolean[] => (Array.isArray(v) ? (v as boolean[]) : []);

const displayDebugValue = formatDebugValue;

function showEvaluation(values: DialogValues): void {
  dlg().open(D.evaluateDialog(), values, (action, updated) => {
    if (action !== 'evaluate' && action !== 'modify') return;
    try {
      const result = evaluateProgram(String(updated.expr ?? ''), action === 'modify' ? String(updated.value ?? '') : undefined);
      showEvaluation({ ...updated, result: displayDebugValue(result.value) });
    } catch (error) {
      showEvaluation({ ...updated, result: error instanceof Error ? error.message : String(error) });
    }
  });
}

function editBreakpoint(id?: string, after?: () => void): void {
  const existing = id ? useDebugStore.getState().breakpoints.get(id) : undefined;
  const buffer = desk().activeBuffer();
  const file = existing?.file ?? buffer?.name ?? useDebugStore.getState().currentFile ?? '';
  if (!file) { message('Breakpoint', ['Open a source file first']); return; }
  dlg().open({
    id: 'edit-breakpoint', title: existing ? 'Edit Breakpoint' : 'Add Breakpoint',
    rect: { x: 15, y: 5, w: 50, h: 15 },
    controls: [
      { kind: 'label', x: 3, y: 2, text: '~C~ondition', for: 'condition' },
      { kind: 'input', id: 'condition', x: 3, y: 3, w: 30, hint: 'Enter expression which must be TRUE for breakpoint to take effect' },
      { kind: 'label', x: 3, y: 5, text: '~P~ass count', for: 'passes' },
      { kind: 'input', id: 'passes', x: 3, y: 6, w: 30, history: false, hint: 'Number of matching passes to skip before pausing' },
      { kind: 'label', x: 3, y: 8, text: '~F~ile name', for: 'file' },
      { kind: 'input', id: 'file', x: 3, y: 9, w: 30, history: false, hint: 'Enter the source file containing this breakpoint' },
      { kind: 'label', x: 3, y: 11, text: '~L~ine number', for: 'line' },
      { kind: 'input', id: 'line', x: 3, y: 12, w: 30, history: false, hint: 'Enter the source line where execution should pause' },
      { kind: 'button', id: 'ok', x: 38, y: 3, w: 8, label: 'O~K~', result: 'ok', default: true, hint: 'Save the breakpoint' },
      { kind: 'button', id: 'cancel', x: 38, y: 6, w: 8, label: 'Cancel', result: 'cancel', hint: 'Close without changing the breakpoint' },
      { kind: 'button', id: 'help', x: 38, y: 9, w: 8, label: 'Help', result: 'help', hint: 'Show help about breakpoints' },
    ],
  }, { line: String(existing?.line ?? (buffer?.cursor.line ?? 0) + 1), condition: existing?.condition ?? '', passes: String(existing?.passCount ?? 0), file }, (action, values) => {
    if (action === 'ok') {
      const line = Number(values.line);
      if (!Number.isSafeInteger(line) || line < 1) { message('Breakpoint', ['Enter a positive line number']); return; }
      const debug = useDebugStore.getState();
      const passes = Number(values.passes);
      if (!Number.isSafeInteger(passes) || passes < 0) { message('Breakpoint', ['Enter a nonnegative pass count']); return; }
      const targetFile = String(values.file ?? file).trim().toUpperCase();
      if (existing) debug.removeBreakpoint(existing.id);
      debug.addBreakpoint(targetFile, line);
      debug.updateBreakpoint(`bp-${targetFile}-${String(line)}`, { condition: String(values.condition ?? ''), enabled: existing?.enabled ?? true, passCount: passes });
    }
    after?.();
  });
}

function showBreakpoints(): void {
  const entries = [...useDebugStore.getState().breakpoints.values()];
  dlg().open(D.breakpointsDialog(entries.map((point) => `${point.file.padEnd(24)}${String(point.line).padStart(6)} ${(point.enabled ? point.condition ?? '' : '[off]').padEnd(31)}${String(point.passCount ?? 0).padStart(4)}`)), {}, (action, values) => {
    const selected = entries[Number(values.list ?? 0)];
    if (action === 'delete' && selected) { useDebugStore.getState().removeBreakpoint(selected.id); showBreakpoints(); }
    if (action === 'clear') { for (const entry of entries) useDebugStore.getState().removeBreakpoint(entry.id); showBreakpoints(); }
    if (action === 'edit') editBreakpoint(selected?.id, showBreakpoints);
    if (action === 'view' && selected) {
      const source = desk().windows.find((win) => win.bufferId && desk().buffers[win.bufferId]?.name === selected.file);
      if (source) { desk().focusWindow(source.id); desk().gotoLine(selected.line); }
    }
  });
}

/** Runs the command behind a menu item, a shortcut or a status bar key. */
export function runCommand(id: string): void {
  const d = desk();
  const configuredTool = /^tools\.custom\.(\d+)$/.exec(id);
  if (configuredTool) {
    const tool = ide().tools[Number(configuredTool[1])];
    if (!tool) return;
    if (/(?:^|[\\/])GREP\.(?:COM|EXE)$/i.test(tool.program) || tool.title.toLowerCase() === 'grep') id = 'tools.grep';
    else {
      stopProgram(false);
      void openDosSession({ command: `${tool.program} ${tool.params}`.trim() }).catch((error: unknown) => { message(tool.title, [error instanceof Error ? error.message : String(error)]); });
      return;
    }
  }
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

    case 'file.openatcursor': {
      const buffer=d.activeBuffer();
      if (!buffer) return;
      const text=buffer.lines[buffer.cursor.line] ?? '';
      let start=buffer.cursor.col,end=start;
      while(start>0 && /[A-Za-z0-9_.:\\/-]/.test(text[start-1] ?? '')) start--;
      while(end<text.length && /[A-Za-z0-9_.:\\/-]/.test(text[end] ?? '')) end++;
      const name=text.slice(start,end).toUpperCase();
      if(name) openNamedFile(name,false);
      else message('Error',['No file name at cursor']);
      return;
    }

    case 'file.save': {
      const buf = d.activeBuffer();
      if (!buf) return;
      writeVirtualFile(buf.name, encodeDosText(bufferText(buf)));
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
        if (current) {
          writeVirtualFile(name, encodeDosText(bufferText(current)));
          void createFile(`/${name}`, name, bufferText(current));
        }
        desk().markSaved(name, name);
      });
      return;
    }

    case 'file.saveall':
      for (const buf of Object.values(d.buffers)) {
        writeVirtualFile(buf.name, encodeDosText(bufferText(buf)));
        void createFile(`/${buf.name}`, buf.name, bufferText(buf));
      }
      d.markSaved();
      return;

    case 'file.chdir':
      dlg().open(
        D.changeDirDialog(['..', 'BIN', 'SAMPLES', 'UNITS'], 0),
        { dir: ide().directory },
        (result, values) => {
          if (result === 'ok' || result === 'chdir') ide().setDirectory(String(values.dir ?? 'A:\\'));
        },
      );
      return;

    case 'file.print': {
      const buffer = d.activeBuffer();
      if (buffer) printSource(buffer.name, bufferText(buffer), ((ide().optionDialogs['file.printer']?.highlight ?? [true]) as boolean[])[0] ?? true);
      return;
    }

    case 'file.printer':
      dlg().open(D.printerSetupDialog(), ide().optionDialogs['file.printer'] ?? { filter: 'PRNFLTR', command: '$NOSWAP /EPSON', highlight: [true] }, (result, values) => {
        if (result === 'ok') ide().setOptionDialog('file.printer', values);
        if (result === 'help') message('Printer Setup', ['Configure source highlighting here.', 'File > Print opens the browser', 'print dialog. DOS filter settings', 'are preserved for compatibility.']);
      });
      return;

    case 'file.dos':
      stopProgram(false);
      void openDosSession().catch((error: unknown) => { message('DOS shell', [error instanceof Error ? error.message : String(error)]); });
      return;

    case 'file.exit':
      compileRequest += 1;
      stopProgram(false);
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
          text: searchText(),
          options: [ide().search.caseSensitive, ide().search.wholeWords, ide().search.regularExpression],
          direction: ide().search.backward ? 1 : 0,
          scope: ide().search.selectedOnly ? 1 : 0,
          origin: ide().search.entireScope ? 1 : 0,
        },
        (result, values) => {
          if (result !== 'ok') return;
          const opts = asBools(values.options);
          ide().setSearch({
            text: String(values.text ?? ''),
            caseSensitive: Boolean(opts[0]),
            wholeWords: Boolean(opts[1]),
            regularExpression: Boolean(opts[2]),
            backward: Number(values.direction ?? 0) === 1,
            selectedOnly: Number(values.scope ?? 0) === 1,
            entireScope: Number(values.origin ?? 0) === 1,
          });
          const buffer = desk().activeBuffer();
          if (buffer) beginSearch(buffer);
          searchAgain(true);
        },
      );
      return;

    case 'search.replace':
      dlg().open(
        D.replaceDialog(),
        {
          text: searchText(),
          replacement: ide().search.text ? ide().search.replacement : searchText(),
          options: [ide().search.caseSensitive, ide().search.wholeWords, ide().search.regularExpression, ide().search.promptOnReplace],
          direction: ide().search.backward ? 1 : 0,
          scope: ide().search.selectedOnly ? 1 : 0,
          origin: ide().search.entireScope ? 1 : 0,
        },
        (result, values) => {
          if (result !== 'ok' && result !== 'all') return;
          const opts = asBools(values.options);
          ide().setSearch({
            text: String(values.text ?? ''),
            replacement: String(values.replacement ?? ''),
            caseSensitive: Boolean(opts[0]),
            wholeWords: Boolean(opts[1]),
            regularExpression: Boolean(opts[2]),
            promptOnReplace: Boolean(opts[3]),
            backward: Number(values.direction ?? 0) === 1,
            selectedOnly: Number(values.scope ?? 0) === 1,
            entireScope: Number(values.origin ?? 0) === 1,
          });
          const buffer = desk().activeBuffer();
          if (buffer) beginSearch(buffer);
          replaceText(result === 'all');
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
      dlg().open(D.findErrorDialog(), { address: '0000:0000' }, (action, values) => {
        if (action !== 'ok') return;
        const address = String(values.address ?? '').trim().replace(/^\$/, '');
        const parts = address.split(':');
        const pc = parts.length === 2 ? parseInt(parts[0] ?? '', 16) * 16 + parseInt(parts[1] ?? '', 16) : parseInt(address, 16);
        const compiler = useCompilerStore.getState();
        const line = compiler.result?.bytecode?.sourceLines[pc];
        const source = desk().windows.find((win) => win.bufferId && desk().buffers[win.bufferId]?.name === compiler.currentFile);
        if (line && source) { desk().focusWindow(source.id); desk().gotoLine(line); }
        else message('Error', ['Error address not found.']);
      });
      return;

    case 'search.findproc':
      dlg().open(D.findProcedureDialog(), { name: searchText() }, (action, values) => {
        if (action !== 'ok') return;
        const name = String(values.name ?? '').trim();
        const declaration = new RegExp(`\\b(?:procedure|function)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        for (const buffer of Object.values(desk().buffers)) {
          const line = buffer.lines.findIndex((text) => declaration.test(text));
          const source = desk().windows.find((win) => win.bufferId === buffer.id);
          if (line >= 0 && source) { desk().focusWindow(source.id); desk().gotoLine(line + 1); return; }
        }
        message('Error', ['Procedure not found.']);
      });
      return;

    case 'run.run':
      if (resumeProgram('run', d.activeBuffer()?.id)) return;
      void doCompile(true);
      return;
    case 'run.reset':
      compileRequest += 1;
      stopProgram();
      if (dlg().top()?.def.id === 'compiling') dlg().close('cancel');
      d.setHighlight(null);
      return;
    case 'run.stepover':
    case 'run.trace': {
      const action = id === 'run.trace' ? 'into' : 'over';
      if (resumeProgram(action, d.activeBuffer()?.id)) return;
      void doCompile(true, 'entry');
      return;
    }
    case 'run.gotocursor': {
      const buf = d.activeBuffer();
      if (!buf) return;
      if (resumeProgram('cursor', buf.id, buf.cursor.line + 1)) return;
      void doCompile(true, 'cursor', buf.cursor.line + 1);
      return;
    }
    case 'run.params':
      dlg().open(D.programParametersDialog(), { params: ide().programParameters }, (result, values) => {
        if (result === 'ok') ide().setProgramParameters(String(values.params ?? ''));
      });
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
      dlg().open(D.primaryFileDialog(files, info), { name: ide().primaryFile || '*.PAS' }, (result, values) => {
        if (result === 'clear') ide().setPrimaryFile('');
        if (result === 'ok') {
          const typed = String(values.name ?? '').trim().toUpperCase();
          ide().setPrimaryFile(typed && !typed.includes('*') ? typed : files[Number(values.files ?? 0)] ?? '');
        }
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
          buf?.name ?? 'NONAME00.PAS',
          last?.lines ?? 0,
          last?.ok !== false,
        ),
      );
      return;
    }

    case 'debug.watch':
      d.toggleTool('watches');
      return;
    case 'debug.callstack':
      refreshDebug();
      d.toggleTool('callstack');
      return;
    case 'debug.output':
      d.toggleTool('output');
      return;
    case 'debug.userscreen':
      toggleProgramScreen();
      return;
    case 'tools.messages':
      d.toggleTool('messages');
      return;
    case 'tools.grep': {
      const configured = ide().tools.find((tool) => /(?:^|[\\/])GREP\.(?:COM|EXE)$/i.test(tool.program) || tool.title.toLowerCase() === 'grep')?.params ?? '';
      if (configured !== grepConfiguration) { grepConfiguration = configured; grepArguments = ''; }
      dlg().open(programArgumentsDialog(), {args:grepArguments || configured || `${searchText() || 'program'} *.pas`}, (result,values)=>{
        if(result!=='ok') return;
        grepArguments=String(values.args ?? '');
        void grepSources(grepArguments).catch((error:unknown)=>{ message('Grep',[error instanceof Error ? error.message : String(error)]); });
      });
      return;
    }
    case 'tools.next': goToMessage(1); return;
    case 'tools.prev': goToMessage(-1); return;
    case 'tools.tasm':
    case 'tools.tdebug':
    case 'tools.tprof': {
      const index = id === 'tools.tasm' ? 1 : id === 'tools.tdebug' ? 2 : 3;
      const tool = ide().tools[index];
      if (tool) {
        stopProgram(false);
        void openDosSession({ command: `${tool.program} ${tool.params}`.trim() }).catch((error: unknown) => { message(tool.title, [error instanceof Error ? error.message : String(error)]); });
      }
      return;
    }
    case 'tools.gotosource': goToMessage(0); return;
    case 'debug.register':
      refreshDebug();
      d.toggleTool('registers');
      return;
    case 'debug.breakpoints': {
      showBreakpoints();
      return;
    }
    case 'debug.addbreak':
      editBreakpoint();
      return;

    case 'debug.togglebreak': {
      const buffer = d.activeBuffer();
      if (!buffer) return;
      const line = buffer.cursor.line + 1;
      const existing = [...useDebugStore.getState().breakpoints.values()].find((point) => point.file === buffer.name && point.line === line);
      if (existing) useDebugStore.getState().removeBreakpoint(existing.id);
      else useDebugStore.getState().addBreakpoint(buffer.name, line);
      return;
    }

    case 'debug.addwatch':
      dlg().open(D.addWatchDialog(), {}, (result, values) => {
        if (result !== 'ok') return;
        const expr = String(values.expr ?? '').trim();
        if (!expr) return;
        useDebugStore.getState().addWatch(expr);
        refreshDebug();
        desk().openTool('watches');
      });
      return;

    case 'debug.evaluate':
      showEvaluation({ expr: searchText() });
      return;

    case 'debug.gotosource': {
      const selected = d.activeWindow()?.selected ?? 0;
      const frame = useDebugStore.getState().callStack[selected];
      const source = d.windows.find((win) => win.bufferId && d.buffers[win.bufferId]?.name === frame?.file);
      if (source && frame) { d.focusWindow(source.id); d.gotoLine(frame.line); }
      return;
    }

    case 'options.open':
    case 'options.saveas': {
      const files = ['..\\', ...virtualFiles().filter((name) => /\.tp$/i.test(name))];
      dlg().open(D.optionsFileDialog(id === 'options.saveas', files), { name: ide().optionsFile }, (result, values) => {
        if (result !== 'ok') return;
        const name = String(values.name ?? '').trim().toUpperCase();
        if (!name || /[*?]/.test(name)) return;
        try {
          if (id === 'options.saveas') saveConfiguration(name);
          else loadConfiguration(name);
        } catch (error) { message('Error', [error instanceof Error ? error.message : String(error)]); }
      });
      return;
    }
    case 'options.save':
      try { saveConfiguration(ide().optionsFile); }
      catch (error) { message('Error', [error instanceof Error ? error.message : String(error)]); }
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
    case 'options.linker':
    case 'options.debugger':
    case 'options.directories':
    case 'env.preferences':
    case 'env.editor':
    case 'env.mouse':
    case 'env.startup':
    case 'env.colors': {
      const definitions = {
        'options.memory': D.memorySizesDialog,
        'options.linker': D.linkerDialog,
        'options.debugger': D.debuggerDialog,
        'options.directories': D.directoriesDialog,
        'env.preferences': D.preferencesDialog,
        'env.editor': D.editorOptionsDialog,
        'env.mouse': D.mouseOptionsDialog,
        'env.startup': D.startupOptionsDialog,
        'env.colors': D.colorsDialog,
      };
      const values = { ...ide().optionDialogs[id] };
      const activeBuffer = d.activeBuffer();
      if (id === 'env.editor' && activeBuffer) {
        const editor = [...asBools(values.editor)];
        editor[1] = activeBuffer.insert;
        values.editor = editor;
      }
      dlg().open(definitions[id](), values, (result, next) => {
        if (result !== 'ok') return;
        ide().setOptionDialog(id, next);
        if (id === 'env.editor') {
          desk().edit((buffer) => {
            buffer.insert = asBools(next.editor)[1] ?? true;
          });
        }
      });
      return;
    }
    case 'options.tools': {
      const entries = ide().tools.map((tool) => ({ ...tool }));
      let selected = Number(ide().optionDialogs[id]?.list ?? 0);
      const showTools = (): void => {
        const definition = D.toolsDialog(entries.map((tool) => tool.title));
        for (const control of definition.controls) {
          if (control.kind === 'button' && (control.id === 'edit' || control.id === 'delete')) {
            control.disabled = entries.length === 0;
          }
        }
        selected = Math.max(0, Math.min(selected, entries.length - 1));
        dlg().open(definition, { list: selected }, (result, values) => {
          selected = Number(values.list ?? 0);
          if (result === 'ok') {
            ide().setTools(entries);
            ide().setOptionDialog(id, { list: selected });
          } else if (result === 'delete') {
            entries.splice(selected, 1);
            showTools();
          } else if (result === 'new' || result === 'edit') {
            const entry = result === 'edit' ? entries[selected] : undefined;
            dlg().open(
              {
                id: 'tool-edit',
                title: result === 'new' ? 'New Tool' : 'Edit Tool',
                rect: { x: 10, y: 5, w: 60, h: 15 },
                controls: [
                  { kind: 'label', x: 3, y: 2, text: '~T~itle', for: 'title' },
                  { kind: 'input', id: 'title', x: 3, y: 3, w: 51, hint: 'Enter the title displayed in the Tools menu' },
                  { kind: 'label', x: 3, y: 5, text: '~P~rogram path', for: 'program' },
                  { kind: 'input', id: 'program', x: 3, y: 6, w: 51, hint: 'Enter the path of the tool program' },
                  { kind: 'label', x: 3, y: 8, text: 'P~a~rameters', for: 'params' },
                  { kind: 'input', id: 'params', x: 3, y: 9, w: 51, hint: 'Enter command line parameters for the tool' },
                  { kind: 'button', id: 'ok', x: 25, y: 12, w: 8, label: 'O~K~', result: 'ok', default: true, hint: 'Accept the settings in this dialog box' },
                  { kind: 'button', id: 'cancel', x: 37, y: 12, w: 8, label: 'Cancel', result: 'cancel', hint: 'Close the dialog box without making any changes' },
                  { kind: 'button', id: 'help', x: 49, y: 12, w: 8, label: 'Help', result: 'help', hint: 'Show help about using this dialog box' },
                ],
              },
              entry ? { ...entry } : {},
              (editResult, edited) => {
                if (editResult === 'ok' && String(edited.title ?? '').trim()) {
                  const tool = {
                    title: String(edited.title).trim(),
                    program: String(edited.program ?? ''),
                    params: String(edited.params ?? ''),
                  };
                  if (entry) entries[selected] = tool;
                  else {
                    entries.push(tool);
                    selected = entries.length - 1;
                  }
                }
                showTools();
              },
            );
          }
        });
      };
      showTools();
      return;
    }

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
      const showWindows = (selection?: number): void => {
        const windows = [...desk().windows].sort((a, b) => a.title.localeCompare(b.title) || a.num - b.num);
        const active = windows.findIndex((win) => win.id === desk().activeId);
        const selected = Math.max(0, Math.min(windows.length - 1, selection ?? active));
        dlg().open(D.windowListDialog(windows.map((win) => win.title)), { windows: selected }, (result, values) => {
          const index = Number(values.windows ?? 0);
          const win = windows[index];
          if (result === 'ok' && win) desk().focusWindow(win.id);
          if (result === 'delete') {
            if (win) desk().closeWindow(win.id);
            showWindows(index);
          }
        });
      };
      showWindows();
      return;
    }

    case 'help.about':
      dlg().open(D.aboutDialog());
      return;

    case 'help.contents':
      showHelp('contents');
      return;
    case 'help.index':
      showHelp('index');
      return;
    case 'help.topic':
      {
        const buffer = d.activeBuffer();
        const line = buffer?.lines[buffer.cursor.line] ?? '';
        const col = buffer?.cursor.col ?? 0;
        const left = line.slice(0, col).match(/[A-Za-z0-9_]+$/)?.[0] ?? '';
        const right = line.slice(col).match(/^[A-Za-z0-9_]+/)?.[0] ?? '';
        showHelp(topicForIdentifier(left + right));
        return;
      }
    case 'help.previous':
      previousHelp();
      return;
    case 'help.context':
      {
        const context = dlg().top()?.def.id ?? (useMenuStore.getState().open ? 'menus' : d.activeWindow()?.kind ?? 'edit');
        useMenuStore.getState().close();
        showContextHelp(context);
      }
      return;
    case 'help.using':
      showHelp('using');
      return;
    case 'help.directives':
      showHelp('directives');
      return;
    case 'help.procedures':
      showHelp('procedures');
      return;
    case 'help.reserved':
      showHelp('reserved');
      return;
    case 'help.units':
      showHelp('units');
      return;
    case 'help.language':
      showHelp('language');
      return;
    case 'help.errors':
      showHelp('errors');
      return;
    case 'help.files':
      message('Help files', ['TURBO.TPH', 'TPHELP.TPH']);
      return;

    case 'menu.local':
      openLocalMenu();
      return;
    case 'menu.open':
      useMenuStore.getState().openMenu(0);
      return;

    default:
      message('Information', ['This command is not', 'implemented yet']);
  }
}

export const helpLines = (topic: string): string[] =>
  getHelpLines(topic);
