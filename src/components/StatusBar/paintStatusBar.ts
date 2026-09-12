import { Screen } from '@/tui/Screen';
import { VLINE_LIGHT } from '@/tui/chars';
import { TP } from '@styles/tpTheme';

export interface StatusKey {
  key: string;
  label: string;
  disabled?: boolean;
  /** Command dispatched when the entry is clicked. */
  command?: string;
}

export interface StatusHit {
  from: number;
  to: number;
  command: string;
}

/** Key/label pairs, laid out from column 1 with two spaces between entries. */
export function paintStatusKeys(scr: Screen, keys: StatusKey[]): StatusHit[] {
  scr.fill({ x: 0, y: scr.rows - 1, w: scr.cols, h: 1 }, ' ', TP.status);
  const y = scr.rows - 1;
  const hits: StatusHit[] = [];
  let x = 1;
  for (const entry of keys) {
    const base = entry.disabled ? TP.statusDisabled : TP.status;
    const keyFg = entry.disabled ? TP.statusDisabledKey : TP.statusKey;
    const start = x;
    scr.write(x, y, entry.key, { fg: keyFg, bg: base.bg });
    x += entry.key.length + 1;
    scr.write(x, y, entry.label, base);
    x += entry.label.length;
    if (entry.command && !entry.disabled) hits.push({ from: start, to: x - 1, command: entry.command });
    x += 2;
  }
  return hits;
}

/** `F1 Help | <hint>` - what the status line shows while a menu is dropped. */
export function paintStatusHint(scr: Screen, hint: string): void {
  const y = scr.rows - 1;
  scr.fill({ x: 0, y, w: scr.cols, h: 1 }, ' ', TP.status);
  scr.write(1, y, 'F1', { fg: TP.statusKey, bg: TP.status.bg });
  scr.write(4, y, 'Help', TP.status);
  scr.put(9, y, VLINE_LIGHT, TP.status);
  scr.write(11, y, hint.slice(0, scr.cols - 12), TP.status);
}
