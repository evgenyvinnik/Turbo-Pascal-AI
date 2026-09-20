import { useDesktopStore } from '@stores/desktopStore';
import { useDialogStore } from '@stores/dialogStore';
import { useIdeStore } from '@stores/ideStore';
import { type HelpLink } from './helpTopics';
import { getHelpDocument, helpLinkAt, identifierTopic, REFERENCE_TOPICS } from './helpDocuments';
import { REFERENCE_HELP_EMPHASIS } from './referenceHelp';
import type { DialogDef } from '@components/Dialogs/types';

const TOPICS = REFERENCE_TOPICS;
const CONTEXTS: Record<string, string> = {
  open: 'Open-File', saveas: 'Save-File', primary: 'Turbo-Help-Primary-File',
  'open-options': 'Turbo-Help', 'save-options': 'Save-Options',
  find: 'Find-Text', replace: 'Turbo-Help-Replace', goto: 'Turbo-Help-Go-to-Line',
  findproc: 'Turbo-Help-Find-Procedure', finderror: 'Turbo-Help-Find-Error',
  compileropts: 'Turbo-Help-Compiler-Options', memory: 'Turbo-Help-Memory-Sizes', linker: 'Turbo-Help-Linker',
  debugger: 'Turbo-Help-Debugger', directories: 'Turbo-Help-Directories', params: 'Turbo-Help-Program-Parameters',
  evaluate: 'Turbo-Help-Evaluate-and-Modify', 'edit-breakpoint': 'Turbo-Help-Add-Breakpoints', breakpoints: 'Turbo-Help-Add-Breakpoints',
  startup: 'Turbo-help-startup-options', colors: 'Turbo-help-colors-dialog-box',
  tools: 'Turbo-Help-Tools', preferences: 'Help-Preferences', editoropts: 'Help-Editor-options', mouse: 'Help-Mouse-Options',
};
const LOCAL_CONTEXTS: Record<string, string[]> = {
  'Find-Text': ['─', '  ▄ Help on the Find dialog box', '  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄', '',
    ' Enter the text to find in the active editor.', '',
    ' Case sensitive matches upper and lower case.', ' Choose the direction, scope and origin.',
    ' OK moves to the next matching text.', ' Search Again repeats the previous search.'],
  'Open-File': ['─', '  ▄ Help on the Open a File dialog box', '',
    ' Enter a Pascal filename or select a file.', ' Open creates an Edit window for that file.',
    ' Replace closes the active window first.', ' Imported .PAS files are listed here.'],
  'Save-File': ['─', '  ▄ Help on the Save File As dialog box', '',
    ' Enter a name for the active source file.', ' OK saves the source to the virtual disk.',
    ' File Open can retrieve it after a reload.'],
  'Save-Options': ['─', '  ▄ Help on the Save Options As dialog box', '',
    ' Enter a .TP filename for this configuration.', ' OK saves the current environment settings.',
    ' Open Options restores a saved configuration.'],
};
const history: { topic: string; modal: boolean; selected: number; scroll: number; col: number }[] = [];
let selectedCol = 0;

export function isReferenceHelp(topic: string): boolean { return Object.hasOwn(TOPICS, topic) || topic === 'contents'; }
export function getHelpLines(topic: string): string[] {
  const document = getHelpDocument(topic);
  return document.lines.length ? document.lines : LOCAL_CONTEXTS[topic.slice(8)] ?? [];
}

export function helpEmphasis(topic: string): [number, number, number, number][] {
  const reference = topic === 'edit'
    ? [...(REFERENCE_HELP_EMPHASIS['Help-Edit-Window'] ?? []), ...(REFERENCE_HELP_EMPHASIS['Help-2'] ?? []).map(([row, col, length, color]): [number, number, number, number] => [row + 16, col, length, color])]
    : REFERENCE_HELP_EMPHASIS[topic.startsWith('context:') ? topic.slice(8) : TOPICS[topic] ?? ''] ?? [];
  const prefixLength = topic === 'edit' ? 32 : topic.startsWith('context:') || Object.hasOwn(TOPICS, topic) ? 16 : 0;
  return [...reference, ...getHelpDocument(topic).links.filter((entry) => entry.row >= prefixLength).map(({ row, col, length }): [number, number, number, number] => [row, col, length, 14])];
}

export function helpCaretColumn(topic: string, row: number): number {
  const links = getHelpDocument(topic).links.filter((entry) => entry.row === row);
  return links.find((entry) => entry.col === selectedCol)?.col ?? links[0]?.col ?? 0;
}

/** Scroll a document and independently select links, including two-column pages. */
export function navigateHelp(key: string, pageSize: number): boolean {
  const desktop = useDesktopStore.getState();
  const help = desktop.activeWindow();
  if (help?.kind !== 'help') return false;
  const document = getHelpDocument(useIdeStore.getState().helpTopic);
  const last = Math.max(0, document.lines.length - 1);
  let cursor = help.selected;
  let scroll = help.scroll;
  if (key === 'Tab' || key === 'Shift+Tab') {
    const links = document.links;
    if (!links.length) return true;
    const position = links.findIndex((entry) => entry.row === cursor && entry.col === selectedCol);
    const entry = key === 'Tab'
      ? links[position >= 0 ? (position + 1) % links.length : Math.max(0, links.findIndex((entry) => entry.row >= cursor))]
      : links[position >= 0 ? (position + links.length - 1) % links.length : Math.max(0, links.filter((entry) => entry.row < cursor).length - 1)];
    cursor = entry!.row; selectedCol = entry!.col;
  } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const links = document.links.filter((entry) => entry.row === cursor);
    const current = Math.max(0, links.findIndex((entry) => entry.col === selectedCol));
    const entry = links[(current + (key === 'ArrowRight' ? 1 : links.length - 1)) % links.length];
    if (entry) selectedCol = entry.col;
  } else if (key === 'ArrowDown') { cursor = Math.min(last, cursor + 1); selectedCol = 0; }
  else if (key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); selectedCol = 0; }
  else if (key === 'PageDown') { scroll = Math.min(Math.max(0, document.lines.length - pageSize), scroll + pageSize); cursor = Math.min(last, scroll + pageSize - 1); selectedCol = 0; }
  else if (key === 'PageUp') { scroll = Math.max(0, scroll - pageSize); cursor = scroll; selectedCol = 0; }
  else if (key === 'Home') { cursor = 0; scroll = 0; selectedCol = 0; }
  else if (key === 'End') { cursor = last; scroll = Math.max(0, document.lines.length - pageSize); selectedCol = 0; }
  else return false;
  scroll = Math.max(0, Math.min(scroll, cursor));
  if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;
  desktop.setToolSelection(help.id, cursor);
  desktop.scrollTool(help.id, scroll - help.scroll);
  return true;
}

const hasCrossReferences = (topic: string): boolean => topic !== 'context:Turbo-Help-Add-Breakpoints';

function contextDialog(lines: string[], topic: string): DialogDef {
  const button = (id: string, label: string, y: number) => ({ kind: 'button' as const, id, label: label + ' '.repeat(Math.max(0, 9 - label.replaceAll('~', '').length)), x: 54, y, w: 11, result: id, default: id === 'cross', disabled: id === 'cross' && !hasCrossReferences(topic), hint: 'Navigate the Help system' });
  return {
    id: 'context-help', title: 'Turbo Help', rect: { x: 6, y: 3, w: 68, h: 19 },
    controls: [
      { kind: 'help', id: 'page', x: 1, y: 1, w: 50, h: 17, lines, topic, hint: 'Read help for the current context' },
      button('cross', 'Cross ~r~ef', 3), button('previous', '~P~revious', 6), button('contents', '~C~ontents', 8),
      button('index', '~I~ndex', 10), button('cancel', 'Cancel', 14),
    ],
  };
}

export function showHelp(topic: string, modal = useDialogStore.getState().stack.length > 0, remember = true): void {
  if (remember && history.at(-1)?.topic !== topic) {
    const active = useDesktopStore.getState().activeWindow();
    const previous = history.at(-1);
    if (previous && active?.kind === 'help') { previous.selected = active.selected; previous.scroll = active.scroll; previous.col = selectedCol; }
    history.push({ topic, modal, selected: 0, scroll: 0, col: 0 });
  }
  selectedCol = 0;
  useIdeStore.getState().setHelpTopic(topic);
  if (modal) {
    const dialogs = useDialogStore.getState();
    if (dialogs.top()?.def.id === 'context-help') dialogs.close('navigate');
    dialogs.open(contextDialog(getHelpLines(topic), topic), { page: 0 }, (action, values) => {
      if (action === 'previous') previousHelp();
      else if (action === 'contents' || action === 'index') showHelp(action, true);
      else if (action === 'cross') {
        const links = getHelpDocument(topic).links;
        const target = links.find((entry) => entry.row >= Number(values.page ?? 0)) ?? links[0];
        showHelp(target?.target ?? topic, true);
      }
    });
  } else {
    const desktop = useDesktopStore.getState();
    desktop.openTool('help');
    const help = useDesktopStore.getState().activeWindow();
    if (help) { desktop.scrollTool(help.id, -help.scroll); desktop.setToolSelection(help.id, 0); }
  }
}

export function showContextHelp(context: string): void {
  const topic = CONTEXTS[context];
  showHelp(topic ? `context:${topic}` : context === 'edit' ? 'edit' : 'using', useDialogStore.getState().stack.length > 0);
}

export function previousHelp(): void {
  if (history.length > 1) history.pop();
  const previous = history.at(-1) ?? { topic: 'contents', modal: useDialogStore.getState().stack.length > 0, selected: 0, scroll: 0, col: 0 };
  showHelp(previous.topic, previous.modal, false);
  selectedCol = previous.col;
  const help = useDesktopStore.getState().activeWindow();
  if (!previous.modal && help?.kind === 'help') {
    useDesktopStore.getState().setToolSelection(help.id, previous.selected);
    useDesktopStore.getState().scrollTool(help.id, previous.scroll - help.scroll);
  }
}

export function topicForIdentifier(identifier: string): string {
  return identifierTopic(identifier);
}

/** Only explicit cross references navigate; ordinary prose remains selectable. */
export function followHelpLine(line: string, row?: number, col?: number, modal = false): boolean {
  const topic = useIdeStore.getState().helpTopic;
  const document = getHelpDocument(topic);
  const selected = row ?? document.lines.indexOf(line);
  const entry: HelpLink | undefined = col === undefined
    ? helpLinkAt(topic, selected, helpCaretColumn(topic, selected))
    : helpLinkAt(topic, selected, col);
  if (!entry) return false;
  showHelp(entry.target, modal);
  return true;
}

export function followModalHelp(): boolean {
  const top = useDialogStore.getState().top();
  const control = top?.def.controls[top.focus];
  if (control?.kind !== 'help') return false;
  const row = Number(top?.values[control.id] ?? 0);
  return followHelpLine(control.lines[row] ?? '', row, undefined, true);
}
