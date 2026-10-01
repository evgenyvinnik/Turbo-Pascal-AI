import { useIdeStore } from '../../stores/ideStore';
import { MENUS, type MenuDef } from './menuDefs';
import { buildToolsMenuItems } from './toolMenus';

/** The same menu tree is used for drawing, accelerators, hints and clicks. */
/** The menu bar, its Tools menu from the configured tools: the store's
 * unless the caller passes the ones it depends on. */
export function currentMenus(tools = useIdeStore.getState().tools): MenuDef[] {
  return MENUS.map((menu) =>
    menu.id === 'tools' ? { ...menu, items: buildToolsMenuItems(tools, menu.items) } : menu
  );
}
