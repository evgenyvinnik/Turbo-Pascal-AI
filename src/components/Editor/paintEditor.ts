import { Screen } from '@/tui/Screen';
import { TP } from '@styles/tpTheme';
import { paintFrame, clientRect } from '@components/Window/paintWindow';
import { selectionRange, type Buffer, type TPWindow } from '@stores/desktopStore';
import { comparePos } from '@stores/textBuffer';
import { highlight } from './highlight';

export interface EditorCursor {
  col: number;
  row: number;
  fat: boolean;
}

/**
 * Paints one Edit window: frame, syntax coloured text, selection, the debug
 * highlight line and the compiler error banner.
 */
export function paintEditWindow(
  scr: Screen,
  win: TPWindow,
  buf: Buffer,
  active: boolean,
): EditorCursor | null {
  const client = clientRect(win.rect);
  paintFrame(scr, {
    rect: win.rect,
    title: buf.name,
    number: win.num,
    active,
    frame: active ? TP.editFrame : TP.editFrameInactive,
    icon: TP.editIcon,
    scroll: TP.editScroll,
    grip: TP.editGrip,
    indicator: `${String(buf.cursor.line + 1)}:${String(buf.cursor.col + 1)}`,
    modified: buf.modified,
    vScroll: { pos: buf.scroll.line, max: Math.max(1, buf.lines.length - 1) },
    hScroll: { pos: buf.scroll.col, max: 80 },
  });

  scr.fill(client, ' ', TP.editText);

  const colours = highlight(buf.lines);
  const sel = selectionRange(buf);

  for (let row = 0; row < client.h; row += 1) {
    const lineNo = buf.scroll.line + row;
    const text = buf.lines[lineNo];
    if (text === undefined) break;
    const lineColours = colours[lineNo] ?? [];
    const inHighlight = buf.highlight !== null && buf.highlight - 1 === lineNo;
    if (inHighlight) {
      scr.fill({ x: client.x, y: client.y + row, w: client.w, h: 1 }, ' ', TP.editHighlight);
    }
    for (let i = 0; i < client.w; i += 1) {
      const col = buf.scroll.col + i;
      const ch = text[col];
      if (ch === undefined) break;
      const selected =
        sel !== null &&
        comparePos({ line: lineNo, col }, sel[0]) >= 0 &&
        comparePos({ line: lineNo, col }, sel[1]) < 0;
      const a =
        selected || inHighlight
          ? TP.editHighlight
          : { fg: lineColours[col] ?? TP.editText.fg, bg: TP.editText.bg };
      scr.put(client.x + i, client.y + row, ch, a);
    }
  }

  if (buf.error) {
    scr.fill({ x: client.x, y: client.y, w: client.w, h: 1 }, ' ', TP.editError);
    scr.write(client.x + 1, client.y, buf.error.message.slice(0, client.w - 2), TP.editError);
  }

  if (!active) return null;
  const cx = client.x + (buf.cursor.col - buf.scroll.col);
  const cy = client.y + (buf.cursor.line - buf.scroll.line);
  if (cx < client.x || cx >= client.x + client.w) return null;
  if (cy < client.y || cy >= client.y + client.h) return null;
  return { col: cx, row: cy, fat: !buf.insert };
}
