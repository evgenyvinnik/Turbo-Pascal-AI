import { Screen } from '@/tui/Screen';
import { DOUBLE } from '@/tui/chars';
import { TP } from '@styles/tpTheme';
import { paintFrame, clientRect } from '@components/Window/paintWindow';
import type { TPWindow } from '@stores/desktopStore';

const LEFT = ['Built-in Assembler', 'Command Line', 'Debugging', 'Directives', 'Error Messages', 'ObjectBrowser', 'ObjectWindows'];
const RIGHT = ['Reserved Words', 'Sample Programs', 'Start-Up Options', 'Turbo Vision', 'Units', 'Glossary', 'Windows API'];

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
  scr.hLine(left + 1, bottom + 1, right - left + 1, '▀', { fg: TP.helpShadow.fg, bg: TP.helpText.bg });

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
  lines: string[],
): void {
  paintFrame(scr, {
    rect: win.rect,
    title: 'Help',
    number: win.num,
    active,
    frame: active ? TP.toolFrame : TP.toolFrameInactive,
    icon: TP.toolIcon,
    scroll: TP.toolScroll,
    grip: TP.toolGrip,
    vScroll: { pos: win.scroll, max: Math.max(1, lines.length - 1) },
    hScroll: { pos: 0, max: 1 },
  });
  const client = clientRect(win.rect);
  scr.fill(client, ' ', TP.helpText);
  if (topic === 'contents') {
    paintContents(scr, client.x, client.y);
    return;
  }
  lines.slice(win.scroll, win.scroll + client.h).forEach((l, i) => {
    scr.write(client.x + 1, client.y + i, l.slice(0, client.w - 2), TP.helpText);
  });
}
