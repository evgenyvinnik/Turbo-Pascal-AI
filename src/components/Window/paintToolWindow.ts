import { Screen } from '@/tui/Screen';
import type { Attr } from '@/tui/palette';
import { TP } from '@styles/tpTheme';
import { paintFrame, clientRect } from './paintWindow';
import type { TPWindow } from '@stores/desktopStore';

export interface ToolRow {
  text: string;
  attr?: Attr;
}

export interface ToolPalette {
  frame: Attr;
  frameInactive: Attr;
  icon: Attr;
  text: Attr;
  selected: Attr;
  scroll: Attr;
  grip: Attr;
}

export const CYAN_TOOL: ToolPalette = {
  frame: TP.toolFrame,
  frameInactive: TP.toolFrameInactive,
  icon: TP.toolIcon,
  text: TP.toolText,
  selected: TP.toolSelected,
  scroll: TP.toolScroll,
  grip: TP.toolGrip,
};

export const BLACK_TOOL: ToolPalette = {
  frame: TP.outFrame,
  frameInactive: TP.outFrameInactive,
  icon: TP.outIcon,
  text: TP.outText,
  selected: TP.toolSelected,
  scroll: TP.outScroll,
  grip: TP.outGrip,
};

/** Watches / Call stack / Messages / Output all share this list presentation. */
export function paintToolWindow(
  scr: Screen,
  win: TPWindow,
  rows: ToolRow[],
  active: boolean,
  pal: ToolPalette,
  options: { selectable?: boolean; scrollbars?: boolean; indent?: number } = {},
): void {
  const { selectable = false, scrollbars = true, indent = 1 } = options;
  const client = clientRect(win.rect);
  paintFrame(scr, {
    rect: win.rect,
    title: win.title,
    number: win.num,
    active,
    frame: active ? pal.frame : pal.frameInactive,
    icon: pal.icon,
    scroll: pal.scroll,
    grip: pal.grip,
    ...(scrollbars
      ? {
          vScroll: {
            pos: selectable ? win.selected : win.scroll,
            // Watches has an extra insertion row; a one-frame call stack has
            // no second item to select and therefore no scrollbar thumb.
            max: Math.max(0, rows.length - (win.kind === 'watches' ? 0 : 1)),
          },
          hScroll: { pos: 0, max: 80 },
        }
      : {}),
  });

  scr.fill(client, ' ', pal.text);
  for (let i = 0; i < client.h; i += 1) {
    const index = win.scroll + i;
    // Watches keeps an insertion row; other lists only select actual entries.
    const isSel = selectable && active && index === win.selected && (rows[index] !== undefined || win.kind === 'watches');
    if (isSel) scr.fill({ x: client.x, y: client.y + i, w: client.w, h: 1 }, ' ', pal.selected);
    const row = rows[index];
    if (!row) continue;
    const attr = isSel ? pal.selected : (row.attr ?? pal.text);
    scr.write(client.x + indent, client.y + i, row.text.slice(0, client.w - indent - 1), attr);
  }
}
