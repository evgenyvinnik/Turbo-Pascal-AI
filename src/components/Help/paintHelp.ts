import { Screen } from '@/tui/Screen';
import { DOUBLE } from '@/tui/chars';
import { TP } from '@styles/tpTheme';
import { paintFrame, clientRect } from '@components/Window/paintWindow';
import type { TPWindow } from '@stores/desktopStore';
import { helpEmphasis, isReferenceHelp, helpCaretColumn } from '@components/IDE/helpNavigation';
import { C } from '@/tui/palette';

const LEFT = [
  'Built-in Assembler',
  'Command Line',
  'Debugging',
  'Directives',
  'Error Messages',
  'ObjectBrowser',
  'ObjectWindows',
];
const RIGHT = [
  'Reserved Words',
  'Sample Programs',
  'Start-Up Options',
  'Turbo Vision',
  'Units',
  'Glossary',
  'Windows API',
];

/**
 * The "PASCAL HELP CONTENTS" page: a framed index with a shadow, drawn at the
 * offsets the reference screenshot uses inside the Help window.
 */
function paintContents(scr: Screen, cx: number, cy: number): void {
  const line = TP.helpLine;
  const left = cx + 2;
  const right = cx + 45;
  const bottom = cy + 14;

  scr.put(left, cy, DOUBLE.tl, line);
  scr.hLine(left + 1, cy, right - left - 1, DOUBLE.t, line);
  scr.put(right, cy, DOUBLE.tr, line);
  scr.put(left, bottom, DOUBLE.bl, line);
  scr.hLine(left + 1, bottom, right - left - 1, DOUBLE.b, line);
  scr.put(right, bottom, DOUBLE.br, line);
  scr.vLine(left, cy + 1, bottom - cy - 1, DOUBLE.l, line);
  scr.vLine(right, cy + 1, bottom - cy - 1, DOUBLE.r, line);

  scr.write(cx + 13, cy, ' PASCAL HELP CONTENTS ', line);
  scr.put(cx + 12, cy, '▌', line);
  scr.put(cx + 35, cy, '▐', line);

  for (const y of [cy + 4, cy + 6]) {
    scr.put(left, y, '╟', line);
    scr.hLine(left + 1, y, right - left - 1, '─', line);
    scr.put(right, y, '╢', line);
  }
  const divider = cx + 23;
  scr.put(divider, cy + 6, '┬', line);
  scr.vLine(divider, cy + 7, 7, '│', line);
  scr.put(divider, bottom, '╧', line);

  scr.vLine(right + 1, cy + 1, bottom - cy, ' ', TP.helpShadow);
  scr.hLine(left + 1, bottom + 1, right - left + 1, '▀', {
    fg: TP.helpShadow.fg,
    bg: TP.helpText.bg,
  });

  const text = TP.helpText;
  scr.write(cx + 4, cy + 1, 'How to Use Help', text);
  scr.write(cx + 4, cy + 2, 'Menus and Hot Keys', text);
  scr.write(cx + 4, cy + 3, 'Editor Commands', text);
  scr.write(cx + 4, cy + 5, 'Functions and Procedures', text);
  LEFT.forEach((t, i) => scr.write(cx + 4, cy + 7 + i, t, text));
  RIGHT.forEach((t, i) => scr.write(cx + 25, cy + 7 + i, t, text));
}

export function paintHelpWindow(
  scr: Screen,
  win: TPWindow,
  active: boolean,
  topic: string,
  lines: string[]
): { col: number; row: number; fat: false } | null {
  paintFrame(scr, {
    rect: win.rect,
    title: 'Help',
    number: win.num,
    active,
    frame: active ? TP.toolFrame : TP.toolFrameInactive,
    icon: TP.toolIcon,
    scroll: TP.toolScroll,
    grip: TP.toolGrip,
    vScroll: { pos: win.scroll, max: Math.max(1, lines.length - (win.rect.h - 2)) },
    hScroll: { pos: 0, max: 1 },
  });
  const client = clientRect(win.rect);
  scr.fill(client, ' ', { fg: C.Black, bg: C.Cyan });
  scr.shadow(win.rect);
  if (topic === 'contents') {
    paintContents(scr, client.x, client.y);
  } else {
    const inset = isReferenceHelp(topic) ? 0 : 1;
    paintHelpText(
      scr,
      client.x + inset,
      client.y,
      client.w - inset,
      client.h,
      lines,
      topic,
      win.scroll
    );
  }
  return active
    ? {
        col: client.x + (isReferenceHelp(topic) ? 0 : 1) + helpCaretColumn(topic, win.selected),
        row: client.y + Math.max(0, Math.min(client.h - 1, win.selected - win.scroll)),
        fat: false,
      }
    : null;
}

/** Ordinary prose is black; yellow and white spans identify Help keywords. */
export function paintHelpText(
  scr: Screen,
  x: number,
  y: number,
  width: number,
  height: number,
  lines: string[],
  topic: string,
  scroll: number
): void {
  const body = { fg: C.Black, bg: C.Cyan };
  scr.fill({ x, y, w: width, h: height }, ' ', body);
  lines
    .slice(scroll, scroll + height)
    .forEach((line, row) => scr.write(x, y + row, line.slice(0, width), body));
  for (const [row, col, length, color] of helpEmphasis(topic)) {
    if (row < scroll || row >= scroll + height || col >= width) continue;
    scr.write(
      x + col,
      y + row - scroll,
      (lines[row] ?? '').slice(col, Math.min(width, col + length)),
      { fg: color, bg: C.Cyan }
    );
  }
}
