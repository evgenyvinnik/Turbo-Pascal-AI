import { describe, expect, test } from 'vitest';
import { buildToolsMenuItems, configuredToolShortcut } from '../../src/components/MenuBar/toolMenus';
import type { MenuEntry, MenuNode } from '../../src/components/MenuBar/menuDefs';
const defaults: MenuNode[] = [
  { id: 'tools.messages', label: '~M~essages', hint: 'messages' },
  { id: 'tools.next', label: 'Go to next', hint: 'next' },
  { id: 'tools.prev', label: 'Go to previous', hint: 'previous' },
  { separator: true },
  { id: 'tools.grep', label: '~G~rep', shortcut: 'Shift+F2', hint: 'Search files for a text pattern' },
  { id: 'tools.tasm', label: 'Turbo ~A~ssembler', shortcut: 'Shift+F3', hint: 'Run Turbo Assembler' },
  { id: 'tools.tdebug', label: 'Turbo ~D~ebugger', shortcut: 'Shift+F4', hint: 'Run Turbo Debugger' },
  { id: 'tools.tprof', label: 'Turbo P~r~ofiler', shortcut: 'Shift+F5', hint: 'Run Turbo Profiler' },
];
const tools = ['Grep', 'Turbo Assembler', 'Turbo Debugger', 'Turbo Profiler'].map((title) => ({ title, program: '', params: '' }));

describe('configured Tools menu', () => {
  test('preserves default visual labels and hints while resolving saved indices', () => {
    const items = buildToolsMenuItems(tools, defaults).slice(4) as MenuEntry[];
    expect(items.map(({ label, shortcut, hint }) => ({ label, shortcut, hint }))).toEqual(defaults.slice(4).map((item) => {
      const { label, shortcut, hint } = item as MenuEntry; return { label, shortcut, hint };
    }));
    expect(items.map((item) => item.id)).toEqual(['tools.custom.0', 'tools.custom.1', 'tools.custom.2', 'tools.custom.3']);
  });
  test('renaming and appending a tool changes the actual menu and avoids accelerator collisions', () => {
    const changed = [{ ...tools[0]!, title: 'Messages scan' }, ...tools.slice(1), { title: 'Disk listing', program: 'DIR', params: '*.PAS' }];
    const items = buildToolsMenuItems(changed, defaults).filter((item): item is MenuEntry => !('separator' in item));
    expect(items.at(-1)?.id).toBe('tools.custom.4');
    expect(items.at(-1)?.label.replaceAll('~', '')).toBe('Disk listing');
    expect(items.map((item) => /~(.)~/.exec(item.label)?.[1]?.toLowerCase()).filter(Boolean).length).toBe(new Set(items.map((item) => /~(.)~/.exec(item.label)?.[1]?.toLowerCase()).filter(Boolean)).size);
    expect(items.find((item) => item.id === 'tools.custom.0')?.label.replaceAll('~', '')).toBe('Messages scan');
  });
  test('deletion removes the old menu command and shortcut instead of executing the deleted default', () => {
    expect(configuredToolShortcut('shift+F2', [tools[1]!])).toBe('tools.custom.0');
    expect(configuredToolShortcut('shift+F3', [tools[1]!])).toBeUndefined();
    expect(buildToolsMenuItems([], defaults).map((item) => (item as MenuEntry).id)).toEqual(['tools.messages', 'tools.next', 'tools.prev']);
  });
});
