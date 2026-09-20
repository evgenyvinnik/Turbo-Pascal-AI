import type { ToolSettings } from '../../stores/ideStore';
import type { MenuEntry, MenuNode } from './menuDefs';

/** Derive both presentation and command identity from the saved tool order. */
export function buildToolsMenuItems(settings: readonly ToolSettings[], defaults: readonly MenuNode[]): MenuNode[] {
  const fixed = defaults.slice(0, 4);
  const builtins = defaults.slice(4).filter((node): node is MenuEntry => !('separator' in node));
  const used = new Set(['m']);
  // Reserve the historic default accelerators before assigning custom ones.
  for (const setting of settings) {
    const builtin = builtins.find((entry) => entry.label.replaceAll('~', '') === setting.title);
    const hotkey = builtin && /~(.)~/.exec(builtin.label)?.[1]?.toLowerCase();
    if (hotkey) used.add(hotkey);
  }
  const items = settings.map((setting, index): MenuEntry => {
    const builtin = builtins.find((entry) => entry.label.replaceAll('~', '') === setting.title);
    let label = builtin?.label ?? setting.title.replaceAll('~', '');
    if (!builtin) {
      const explicit = /~([a-z0-9])~/i.exec(setting.title)?.[1];
      const hotkey = explicit && !used.has(explicit.toLowerCase()) ? explicit : label.match(/[a-z0-9]/gi)?.find((letter) => !used.has(letter.toLowerCase()));
      if (hotkey) {
        used.add(hotkey.toLowerCase());
        const at = label.toLowerCase().indexOf(hotkey.toLowerCase());
        label = `${label.slice(0, at)}~${label[at]!}~${label.slice(at + 1)}`;
      }
    }
    return {
      id: `tools.custom.${String(index)}`, label,
      ...(index < 4 ? { shortcut: `Shift+F${String(index + 2)}` } : {}),
      hint: builtin?.hint ?? `Run ${setting.title.replaceAll('~', '')}`,
    };
  });
  return items.length ? [...fixed, ...items] : fixed.filter((entry) => !('separator' in entry));
}

export function configuredToolShortcut(key: string, settings: readonly ToolSettings[]): string | undefined {
  const match = /^shift\+F([2-5])$/.exec(key);
  if (!match) return undefined;
  const index = Number(match[1]) - 2;
  return settings[index] ? `tools.custom.${String(index)}` : undefined;
}
