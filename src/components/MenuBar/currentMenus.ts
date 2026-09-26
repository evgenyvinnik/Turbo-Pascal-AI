import { useIdeStore } from '../../stores/ideStore';
import { MENUS, type MenuDef } from './menuDefs';
import { buildToolsMenuItems } from './toolMenus';

/** The same menu tree is used for drawing, accelerators, hints and clicks. */
export function currentMenus(): MenuDef[] {
  const tools = useIdeStore.getState().tools;
  return MENUS.map((menu) =>
    menu.id === 'tools' ? { ...menu, items: buildToolsMenuItems(tools, menu.items) } : menu
  );
}
