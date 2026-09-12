import { Screen, type Rect } from '@/tui/Screen';
import { BLOCK_SMALL, RADIO_ON, VLINE_LIGHT } from '@/tui/chars';
import { C, type Attr } from '@/tui/palette';
import { TP } from '@styles/tpTheme';
import { dialogFocusables, type OpenDialog } from '@stores/dialogStore';
import { clusterRows } from './types';

export interface DialogHit {
  rect: Rect;
  /** Index into the dialog's focusable controls. */
  focusIndex: number;
  /** Item inside a cluster, list or colour picker. */
  row?: number;
  activate?: boolean;
}

export interface DialogPaintResult {
  hits: DialogHit[];
  cursor: { col: number; row: number } | null;
  closeBox: Rect;
}

/** THistory's icon: right half block, arrow, left half block. */
const HISTORY = ['▐', '↓', '▌'] as const;

/** Paints a Turbo Vision dialog box and reports the regions the mouse can hit. */
export function paintDialog(scr: Screen, d: OpenDialog): DialogPaintResult {
  const r = d.def.rect;
  scr.fill(r, ' ', TP.dlgFrame);
  scr.frame(r, TP.dlgFrame, true);
  scr.centerTitle(r, d.def.title, TP.dlgFrame);
  if (!d.def.noClose) {
    scr.write(r.x + 2, r.y, '[', TP.dlgFrame);
    scr.put(r.x + 3, r.y, BLOCK_SMALL, TP.dlgIcon);
    scr.write(r.x + 4, r.y, ']', TP.dlgFrame);
  }
  scr.shadow(r);

  const focusList = dialogFocusables(d.def);
  const focused = focusList[d.focus] ?? null;
  const focusId = focused && 'id' in focused ? focused.id : null;
  const focusOnButton = focused?.kind === 'button';
  const hits: DialogHit[] = [];
  let cursor: DialogPaintResult['cursor'] = null;

  for (const c of d.def.controls) {
    const px = r.x + c.x;
    const py = r.y + c.y;
    const fi = focusList.indexOf(c);
    const isFocused = fi >= 0 && fi === d.focus;

    switch (c.kind) {
      case 'static':
        scr.write(px, py, c.text, TP.dlgStatic);
        break;

      case 'label': {
        const lit = focusId === c.for;
        scr.writeHot(px, py, c.text, lit ? TP.dlgLabelFocus : TP.dlgLabel, TP.dlgLabelHot);
        const target = focusList.findIndex((f) => 'id' in f && f.id === c.for);
        if (target >= 0) {
          hits.push({ rect: { x: px, y: py, w: Screen.plainLength(c.text), h: 1 }, focusIndex: target });
        }
        break;
      }

      case 'input': {
        const value = String(d.values[c.id] ?? '');
        const room = Math.max(1, c.w - 2);
        const start = Math.max(0, Math.min(value.length - room, isFocused ? d.caret - room : 0));
        const shown = value.slice(start, start + room);
        scr.fill({ x: px, y: py, w: c.w, h: 1 }, ' ', TP.dlgInput);
        scr.write(px + 1, py, shown, isFocused && d.selectAll ? TP.dlgInputSel : TP.dlgInput);
        if (c.history !== false && c.readOnly !== true) {
          scr.put(px + c.w, py, HISTORY[0], TP.dlgHistorySide);
          scr.put(px + c.w + 1, py, HISTORY[1], TP.dlgHistoryArrow);
          scr.put(px + c.w + 2, py, HISTORY[2], TP.dlgHistorySide);
        }
        if (isFocused) cursor = { col: px + 1 + Math.max(0, Math.min(room, d.caret - start)), row: py };
        if (fi >= 0) hits.push({ rect: { x: px, y: py, w: c.w, h: 1 }, focusIndex: fi });
        break;
      }

      case 'checks':
      case 'radios': {
        const rows = clusterRows(c);
        const colWidth = c.colWidth ?? c.w;
        scr.fill({ x: px, y: py, w: c.w, h: rows }, ' ', TP.dlgCluster);
        c.items.forEach((item, i) => {
          const cx = px + Math.floor(i / rows) * colWidth;
          const cy = py + (i % rows);
          const on =
            c.kind === 'checks'
              ? Boolean((d.values[c.id] as boolean[] | undefined)?.[i])
              : Number(d.values[c.id] ?? 0) === i;
          const mark = c.kind === 'checks' ? `[${on ? 'X' : ' '}]` : `(${on ? RADIO_ON : ' '})`;
          const base = isFocused && i === d.clusterRow ? TP.dlgClusterFocus : TP.dlgCluster;
          scr.write(cx + 1, cy, mark, base);
          scr.writeHot(cx + 5, cy, item.label, base, TP.dlgClusterHot);
          hits.push({ rect: { x: cx, y: cy, w: colWidth, h: 1 }, focusIndex: fi, row: i, activate: true });
        });
        break;
      }

      case 'list': {
        const scroll = c.scroll ?? 'v';
        const body: Rect = {
          x: px,
          y: py,
          w: scroll === 'v' ? c.w - 1 : c.w,
          h: scroll === 'h' ? c.h - 1 : c.h,
        };
        scr.fill(body, ' ', TP.dlgList);
        if (c.divider) scr.vLine(px + c.divider, py, body.h, VLINE_LIGHT, TP.dlgListDivider);
        const selected = Number(d.values[c.id] ?? 0);
        const top = Math.max(0, Math.min(selected - body.h + 1, Math.max(0, c.items.length - body.h)));
        for (let i = 0; i < body.h; i += 1) {
          const index = top + i;
          const isSel = index === selected;
          if (isSel && isFocused) {
            scr.fill({ x: body.x, y: body.y + i, w: body.w, h: 1 }, ' ', TP.dlgListFocus);
          }
          const item = c.items[index];
          if (item === undefined) continue;
          const a = isSel ? (isFocused ? TP.dlgListFocus : TP.dlgListSelected) : TP.dlgList;
          scr.write(body.x + 1, body.y + i, item.slice(0, Math.max(0, body.w - 2)), a);
          hits.push({
            rect: { x: body.x, y: body.y + i, w: body.w, h: 1 },
            focusIndex: fi,
            row: index,
            activate: true,
          });
        }
        if (scroll === 'v') {
          scr.scrollBar(px + c.w - 1, py, c.h, true, selected, Math.max(1, c.items.length - 1), TP.dlgListScroll);
        } else if (scroll === 'h') {
          scr.scrollBar(px, py + c.h - 1, c.w, false, 0, 1, TP.dlgListScroll);
        }
        break;
      }

      case 'button': {
        let base: Attr = TP.dlgButton;
        let hot: number = TP.dlgButtonHot;
        if (c.disabled) {
          base = TP.dlgButtonDisabled;
          hot = TP.dlgButtonDisabled.fg;
        } else if (isFocused) {
          base = TP.dlgButtonFocus;
        } else if (c.default === true && !focusOnButton) {
          // Turbo Vision keeps the default button lit while focus sits elsewhere.
          base = TP.dlgButtonDefault;
        }
        const len = Screen.plainLength(c.label);
        scr.fill({ x: px, y: py, w: c.w, h: 1 }, ' ', base);
        scr.writeHot(px + Math.max(0, Math.floor((c.w - len) / 2)), py, c.label, base, hot);
        scr.buttonShadow({ x: px, y: py, w: c.w, h: 1 });
        if (fi >= 0) hits.push({ rect: { x: px, y: py, w: c.w, h: 1 }, focusIndex: fi, activate: true });
        break;
      }

      case 'info':
        scr.fill({ x: px, y: py, w: c.w, h: c.h }, ' ', TP.dlgInfo);
        c.lines.forEach((line, i) => scr.write(px + 1, py + i, line.slice(0, c.w - 2), TP.dlgInfo));
        break;

      case 'bar': {
        scr.fill({ x: px, y: py, w: c.w, h: 1 }, ' ', TP.dlgBar);
        const total = c.text.length + (c.accent ? c.accent.length + 1 : 0);
        const start = px + Math.max(0, Math.floor((c.w - total) / 2));
        let x = scr.write(start, py, c.text, TP.dlgBar);
        if (c.accent) {
          x += 1;
          scr.write(x, py, c.accent, TP.dlgBarAccent);
        }
        break;
      }

      case 'slider':
        scr.scrollBar(px, py, c.w, false, c.pos, c.max, TP.dlgListScroll);
        break;

      case 'swatches': {
        const rows = Math.ceil(c.colors.length / c.cols);
        scr.frame({ x: px, y: py, w: c.cols * 3 + 2, h: rows + 2 }, TP.dlgFrame, false);
        scr.put(px + 1, py, ' ', TP.dlgFrame);
        const end = scr.writeHot(px + 2, py, c.label, isFocused ? TP.dlgLabelFocus : TP.dlgLabel, TP.dlgLabelHot);
        scr.put(end, py, ' ', TP.dlgFrame);
        const selected = Number(d.values[c.id] ?? 0);
        c.colors.forEach((color, i) => {
          const sx = px + 1 + (i % c.cols) * 3;
          const sy = py + 1 + Math.floor(i / c.cols);
          scr.fill({ x: sx, y: sy, w: 3, h: 1 }, ' ', { fg: C.Black, bg: color });
          if (i === selected) {
            scr.put(sx + 1, sy, '•', { fg: color === C.Black ? C.White : C.Black, bg: color });
          }
          hits.push({ rect: { x: sx, y: sy, w: 3, h: 1 }, focusIndex: fi, row: i, activate: true });
        });
        break;
      }

      case 'sample':
        scr.fill({ x: px, y: py, w: c.w, h: c.h }, ' ', c.attr);
        for (let i = 0; i < c.h; i += 1) {
          scr.write(px + Math.max(0, Math.floor((c.w - c.text.length) / 2)), py + i, c.text, c.attr);
        }
        break;
    }
  }

  return { hits, cursor, closeBox: { x: r.x + 2, y: r.y, w: 3, h: 1 } };
}
