import { Screen } from '@/tui/Screen';
import { SHADE_LIGHT } from '@/tui/chars';
import { TP } from '@styles/tpTheme';
import { paintMenuBar, type MenuPaintState } from '@components/MenuBar/paintMenuBar';
import {
  paintStatusHint,
  paintStatusKeys,
  type StatusHit,
  type StatusKey,
} from '@components/StatusBar/paintStatusBar';
import { paintEditWindow } from '@components/Editor/paintEditor';
import { paintHelpWindow } from '@components/Help/paintHelp';
import {
  BLACK_TOOL,
  CYAN_TOOL,
  paintToolWindow,
  type ToolRow,
} from '@components/Window/paintToolWindow';
import { paintDialog, type DialogHit } from '@components/Dialogs/paintDialog';
import { DESKTOP, type Buffer, type TPWindow } from '@stores/desktopStore';
import type { OpenDialog } from '@stores/dialogStore';
import { C } from '@/tui/palette';
import { isFullSize } from '@components/Window/paintWindow';
import type { Popup } from '@stores/popupStore';
import { paintActivePopup } from './paintPopup';

export interface ToolContent {
  output: string[];
  watches: string[];
  callstack: string[];
  messages: string[];
  help: string[];
  helpTopic?: string;
  registers?: string[];
}

export interface PaintInput {
  windows: TPWindow[];
  buffers: Record<string, Buffer>;
  activeId: string | null;
  menu: MenuPaintState;
  dialogs: OpenDialog[];
  tools: ToolContent;
  hint: string | null;
  clipboard?: string;
  runtimeActive?: boolean;
  hasBytecode?: boolean;
  breakpoints?: { file: string; line: number }[];
  popup?: Popup | null;
}

export interface PaintOutput {
  screen: Screen;
  cursor: { col: number; row: number; fat: boolean } | null;
  statusHits: StatusHit[];
  dialogHits: DialogHit[];
}

const EDIT_KEYS: StatusKey[] = [
  { key: 'F1', label: 'Help', command: 'help.contents' },
  { key: 'F2', label: 'Save', command: 'file.save' },
  { key: 'F3', label: 'Open', command: 'file.open' },
  { key: 'Alt+F9', label: 'Compile', command: 'compile.compile' },
  { key: 'F9', label: 'Make', command: 'compile.make' },
  { key: 'Alt+F10', label: 'Local menu', command: 'menu.local' },
];

const WATCH_KEYS: StatusKey[] = [
  { key: 'F1', label: 'Help', command: 'help.contents' },
  { key: 'F7', label: 'Trace', command: 'run.trace' },
  { key: 'F8', label: 'Step', command: 'run.stepover' },
  { key: '◄─┘', label: 'Edit', disabled: true },
  { key: 'Ins', label: 'Add', command: 'debug.addwatch' },
  { key: 'Del', label: 'Delete', disabled: true },
  { key: 'Alt+F10', label: 'Local menu', command: 'menu.local' },
];

const DEBUG_KEYS: StatusKey[] = [
  { key: 'F1', label: 'Help', command: 'help.contents' },
  { key: 'F7', label: 'Trace', command: 'run.trace' },
  { key: 'F8', label: 'Step', command: 'run.stepover' },
  { key: 'F9', label: 'Make', command: 'compile.make' },
  { key: 'Alt+F10', label: 'Local menu', command: 'menu.local' },
];

const CALLSTACK_KEYS: StatusKey[] = [
  { key: 'F1', label: 'Help', command: 'help.contents' },
  { key: '◄─┘', label: 'Go to source', command: 'debug.gotosource' },
  { key: 'F7', label: 'Trace', command: 'run.trace' },
  { key: 'F8', label: 'Step', command: 'run.stepover' },
  { key: 'F10', label: 'Menu', command: 'menu.open' },
];

const OUTPUT_KEYS: StatusKey[] = [
  { key: 'F1', label: 'Help', command: 'help.contents' },
  { key: '↑↓→←', label: 'Scroll' },
  { key: 'F10', label: 'Menu', command: 'menu.open' },
];

const MESSAGE_KEYS: StatusKey[] = [
  { key: 'F1', label: 'Help', command: 'help.contents' },
  { key: '◄─┘', label: 'Go to source', disabled: true },
  { key: 'Space', label: 'Track source', disabled: true },
  { key: 'Alt+F10', label: 'Local menu', command: 'menu.local' },
];

const HELP_KEYS: StatusKey[] = [
  { key: 'F1', label: 'Help on help', command: 'help.using' },
  { key: 'Alt+F1', label: 'Previous topic', command: 'help.previous' },
  { key: 'Shift+F1', label: 'Help index', command: 'help.index' },
  { key: 'Esc', label: 'Close help', command: 'window.close' },
];

const statusFor = (kind: string | undefined): StatusKey[] => {
  switch (kind) {
    case 'watches':
      return WATCH_KEYS;
    case 'callstack':
      return CALLSTACK_KEYS;
    case 'output':
      return OUTPUT_KEYS;
    case 'messages':
      return MESSAGE_KEYS;
    case 'help':
      return HELP_KEYS;
    default:
      return EDIT_KEYS;
  }
};

const toRows = (lines: string[]): ToolRow[] => lines.map((text) => ({ text }));

/** Paints one complete 80x25 frame of the IDE. */
export function paintScreen(input: PaintInput): PaintOutput {
  const scr = new Screen(80, 25);
  scr.clear(TP.desktop, ' ');
  scr.fill(DESKTOP, SHADE_LIGHT, TP.desktop);

  let cursor: PaintOutput['cursor'] = null;

  for (const win of input.windows) {
    const active = win.id === input.activeId;
    if (win.kind === 'edit') {
      const buf = win.bufferId ? input.buffers[win.bufferId] : undefined;
      if (!buf) continue;
      const c = paintEditWindow(
        scr,
        win,
        buf,
        active,
        input.breakpoints?.filter((point) => point.file === buf.name).map((point) => point.line)
      );
      if (!isFullSize(win.rect)) scr.shadow(win.rect);
      if (c && input.dialogs.length === 0 && !input.menu.open) cursor = c;
      continue;
    }
    if (win.kind === 'output') {
      paintToolWindow(scr, win, toRows(input.tools.output), active, BLACK_TOOL);
      continue;
    }
    if (win.kind === 'help') {
      const c = paintHelpWindow(
        scr,
        win,
        active,
        input.tools.helpTopic ?? 'contents',
        input.tools.help
      );
      if (c && input.dialogs.length === 0 && !input.menu.open) cursor = c;
      continue;
    }
    if (win.kind === 'registers') {
      scr.fill(win.rect, ' ', TP.toolText);
      scr.frame(win.rect, TP.toolText, false);
      scr.write(win.rect.x + 8, win.rect.y, ' CPU ', TP.toolText);
      scr.write(win.rect.x + win.rect.w - 3, win.rect.y, String(win.num), TP.toolText);
      for (const [index, line] of (input.tools.registers ?? []).entries())
        scr.write(
          win.rect.x + 2,
          win.rect.y + index + 1,
          line.slice(0, win.rect.w - 3),
          TP.toolText
        );
      scr.shadow(win.rect);
      continue;
    }
    const lines =
      win.kind === 'watches'
        ? input.tools.watches
        : win.kind === 'callstack'
          ? input.tools.callstack
          : input.tools.messages;
    const rows = toRows(lines);
    if (win.kind === 'messages' && rows[0]) {
      rows[0] = { text: rows[0].text, attr: { fg: C.White, bg: C.Green } };
    }
    paintToolWindow(scr, win, rows, active, CYAN_TOOL, { selectable: true });
  }

  let dialogHits: DialogHit[] = [];
  for (const dlg of input.dialogs) {
    const res = paintDialog(scr, dlg);
    dialogHits = res.hits;
    if (res.cursor) cursor = { ...res.cursor, fat: false };
  }

  const activeWindow = input.windows.find((w) => w.id === input.activeId);
  const menuContext = {
    runtimeActive: input.runtimeActive ?? false,
    hasBytecode: input.hasBytecode ?? false,
    hasMessages: input.tools.messages.some((message) => /\(\d+\):/.test(message)),
    buffer: activeWindow?.bufferId ? (input.buffers[activeWindow.bufferId] ?? null) : null,
    clipboard: input.clipboard ?? '',
  };
  paintMenuBar(scr, input.menu, menuContext);
  paintActivePopup(scr, input.popup, menuContext);
  if (input.popup) cursor = null;

  let statusHits: StatusHit[] = [];
  if (input.dialogs.at(-1)?.def.id === 'context-help') {
    statusHits = paintStatusKeys(scr, HELP_KEYS);
  } else if (input.hint !== null) {
    paintStatusHint(scr, input.hint);
  } else {
    const active = input.windows.find((w) => w.id === input.activeId);
    const keys =
      active?.kind === 'edit' && input.runtimeActive
        ? DEBUG_KEYS
        : active?.kind === 'callstack' && !input.tools.callstack.length
          ? CALLSTACK_KEYS.map((item) =>
              item.command === 'debug.gotosource' ? { ...item, disabled: true } : item
            )
          : active?.kind === 'messages' &&
              /^(.+)\(\d+\):/.test(input.tools.messages[active.selected] ?? '')
            ? MESSAGE_KEYS.map((item) =>
                item.label === 'Go to source'
                  ? { ...item, disabled: false, command: 'tools.gotosource' }
                  : item
              )
            : statusFor(active?.kind);
    statusHits = paintStatusKeys(scr, keys);
  }

  return { screen: scr, cursor, statusHits, dialogHits };
}
