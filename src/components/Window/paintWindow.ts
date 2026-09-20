import { Screen, type Rect } from '@/tui/Screen';
import type { Attr } from '@/tui/palette';
import { ARROW_UP, ARROW_UP_DOWN, BLOCK_SMALL, DOUBLE, SINGLE } from '@/tui/chars';
import { DESKTOP } from '@stores/desktopStore';

export interface ScrollInfo {
  pos: number;
  max: number;
}

export interface FramePaint {
  rect: Rect;
  title: string;
  number: number;
  active: boolean;
  frame: Attr;
  icon: Attr;
  scroll: Attr;
  grip: Attr;
  /** `line:col` shown in the bottom border of Edit windows. */
  indicator?: string;
  /** The ☼ that marks an edited file. */
  modified?: boolean;
  vScroll?: ScrollInfo;
  hScroll?: ScrollInfo;
}

export const isFullSize = (r: Rect): boolean =>
  r.x === DESKTOP.x && r.y === DESKTOP.y && r.w === DESKTOP.w && r.h === DESKTOP.h;

/**
 * Draws a Turbo Vision window frame. Only the active window carries its close
 * box, zoom box, position indicator and scrollbars; the others keep a plain
 * single line frame with their number.
 */
export function paintFrame(scr: Screen, p: FramePaint): void {
  const { rect: r, frame, active } = p;
  scr.frame(r, frame, active);
  scr.centerTitle(r, p.title, frame);

  if (!active) {
    scr.write(r.x + r.w - 7, r.y, String(p.number), frame);
    return;
  }

  scr.write(r.x + 2, r.y, '[', frame);
  scr.put(r.x + 3, r.y, BLOCK_SMALL, p.icon);
  scr.write(r.x + 4, r.y, ']', frame);

  const tag = `${String(p.number)}${DOUBLE.t}[`;
  const tx = r.x + r.w - 7;
  scr.write(tx, r.y, tag, frame);
  scr.put(tx + tag.length, r.y, isFullSize(r) ? ARROW_UP_DOWN : ARROW_UP, p.icon);
  scr.write(tx + tag.length + 1, r.y, ']', frame);

  if (p.vScroll && r.h > 4) {
    scr.scrollBar(r.x + r.w - 1, r.y + 1, r.h - 2, true, p.vScroll.pos, p.vScroll.max, p.scroll);
  }

  const by = r.y + r.h - 1;
  if (p.modified) scr.put(r.x + 2, by, '☼', frame);
  if (p.indicator) {
    // TIndicator keeps the colon of `line:col` in a fixed column.
    const text = ` ${p.indicator} `;
    scr.write(r.x + 10 - text.indexOf(':'), by, text, frame);
  }

  if (p.hScroll && r.w > 12) {
    const from = r.x + (p.indicator ? 18 : 2);
    const to = r.x + r.w - 3;
    if (to - from >= 2) {
      scr.scrollBar(from, by, to - from + 1, false, p.hScroll.pos, p.hScroll.max, p.scroll);
    }
  }

  if (r.w > 6) {
    scr.put(r.x + r.w - 2, by, SINGLE.b, p.grip);
    scr.put(r.x + r.w - 1, by, SINGLE.br, p.grip);
  }
}

/** Interior of a window frame. */
export const clientRect = (r: Rect): Rect => ({
  x: r.x + 1,
  y: r.y + 1,
  w: Math.max(0, r.w - 2),
  h: Math.max(0, r.h - 2),
});
