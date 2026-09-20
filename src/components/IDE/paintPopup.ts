import { Screen } from '@/tui/Screen';
import { TP } from '@styles/tpTheme';
import type { Popup } from '@stores/popupStore';
import type { MenuContext } from '@components/MenuBar/menuDefs';
import { paintMenuPopup } from '@components/MenuBar/paintMenuBar';
import { EDITOR_LOCAL_MENU } from './localMenu';

/** Original Turbo Vision local menu and THistory window, in character cells. */
export function paintActivePopup(
  screen: Screen,
  popup: Popup | null | undefined,
  context?: MenuContext
): void {
  if (!popup) return;
  if (popup.kind === 'local') {
    paintMenuPopup(screen, EDITOR_LOCAL_MENU, popup.rect, popup.selected, context);
    return;
  }
  const r = popup.rect;
  screen.fill(r, ' ', TP.editText);
  screen.frame(r, TP.editFrame, true);
  screen.write(r.x + 2, r.y, '[', TP.editFrame);
  screen.put(r.x + 3, r.y, '■', TP.editIcon);
  screen.put(r.x + 4, r.y, ']', TP.editFrame);
  const rows = r.h - 2;
  const top = Math.max(0, popup.selected - rows + 1);
  for (let index = top; index < Math.min(top + rows, popup.entries.length); index++) {
    const y = r.y + 1 + index - top;
    const attr = index === popup.selected ? TP.dlgListFocus : TP.editText;
    if (index === popup.selected) screen.fill({ x: r.x + 1, y, w: r.w - 2, h: 1 }, ' ', attr);
    screen.write(
      r.x + 2,
      y,
      (popup.entries[index] ?? '').slice(popup.horizontal, popup.horizontal + r.w - 4),
      attr
    );
  }
  screen.scrollBar(
    r.x + r.w - 1,
    r.y + 1,
    r.h - 2,
    true,
    popup.selected,
    Math.max(0, popup.entries.length - 1),
    TP.editScroll
  );
  screen.scrollBar(
    r.x + 2,
    r.y + r.h - 1,
    r.w - 4,
    false,
    popup.horizontal,
    Math.max(0, ...popup.entries.map((value) => value.length - (r.w - 4))),
    TP.editScroll
  );
  screen.shadow(r);
}
