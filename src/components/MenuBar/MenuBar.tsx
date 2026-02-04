import { useState, useCallback, useEffect, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { dosColors, dosFonts, dosSpacing, dosShadows } from '../../styles/tokens.stylex';
import { useEditorStore } from '@stores/editorStore';
import { useCompilerStore } from '@stores/compilerStore';
import { useSettingsStore } from '@stores/settingsStore';
import { useUIStore } from '@stores/uiStore';

const styles = stylex.create({
  menuBar: {
    display: 'flex',
    backgroundColor: dosColors.menuBackground,
    color: dosColors.menuText,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    height: '20px',
    borderBottom: `1px solid ${dosColors.black}`,
    boxShadow: dosShadows.panel,
    position: 'relative',
    zIndex: 1000,
  },
  menuItem: {
    padding: `0 ${dosSpacing.md}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    userSelect: 'none',
    position: 'relative',
  },
  menuItemHover: {
    backgroundColor: dosColors.blue,
    color: dosColors.white,
  },
  menuItemActive: {
    backgroundColor: dosColors.blue,
    color: dosColors.white,
  },
  menuItemHighlight: {
    color: dosColors.lightRed,
  },
  menuItemHighlightActive: {
    color: dosColors.yellow,
  },
  spacer: {
    flex: 1,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    minWidth: '200px',
    backgroundColor: dosColors.menuBackground,
    boxShadow: dosShadows.window,
    border: `1px solid ${dosColors.black}`,
    zIndex: 1001,
  },
  dropdownItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${dosSpacing.xs} ${dosSpacing.md}`,
    cursor: 'pointer',
    userSelect: 'none',
  },
  dropdownItemHover: {
    backgroundColor: dosColors.blue,
    color: dosColors.white,
  },
  dropdownItemDisabled: {
    color: dosColors.darkGray,
    cursor: 'default',
  },
  dropdownSeparator: {
    height: '1px',
    backgroundColor: dosColors.black,
    margin: `${dosSpacing.xs} 0`,
  },
  shortcut: {
    marginLeft: dosSpacing.lg,
    color: dosColors.darkGray,
  },
  shortcutActive: {
    color: dosColors.lightGray,
  },
});

interface MenuItem {
  id: string;
  labelKey: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuData {
  id: string;
  labelKey: string;
  hotkey: string;
  items: MenuItem[];
}

export function MenuBar() {
  const { t } = useTranslation();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  // Store actions
  const openFile = useEditorStore((state) => state.openFile);
  const closeFile = useEditorStore((state) => state.closeFile);
  const saveFile = useEditorStore((state) => state.saveFile);
  const panes = useEditorStore((state) => state.panes);
  const compile = useCompilerStore((state) => state.compile);
  const setStatus = useCompilerStore((state) => state.setStatus);
  const updateUISettings = useSettingsStore((state) => state.updateUISettings);
  const ui = useSettingsStore((state) => state.ui);
  const setDialog = useUIStore((state) => state.setDialog);

  const currentPane = panes[0];
  const currentFileId = currentPane?.activeFileId;
  const hasOpenFile = !!currentFileId;

  // Menu definitions with actions
  const menus: MenuData[] = [
    {
      id: 'file',
      labelKey: 'menu.file',
      hotkey: 'F',
      items: [
        {
          id: 'new',
          labelKey: 'file.new',
          shortcut: 'Ctrl+N',
          action: () => {
            const name = `NONAME${Date.now() % 1000}.PAS`;
            openFile(`/new/${name}`, name, `program ${name.replace('.PAS', '')};\nbegin\n  \nend.\n`);
          },
        },
        {
          id: 'open',
          labelKey: 'file.open',
          shortcut: 'F3',
          action: () => {
            setDialog('file-open');
          },
        },
        { id: 'sep1', labelKey: '', separator: true },
        {
          id: 'save',
          labelKey: 'file.save',
          shortcut: 'F2',
          action: () => {
            if (currentFileId) saveFile(currentFileId);
          },
          disabled: !hasOpenFile,
        },
        {
          id: 'saveAs',
          labelKey: 'file.saveAs',
          shortcut: 'Ctrl+S',
          action: () => setDialog('file-save'),
          disabled: !hasOpenFile,
        },
        { id: 'sep2', labelKey: '', separator: true },
        {
          id: 'close',
          labelKey: 'file.close',
          shortcut: 'Ctrl+W',
          action: () => {
            if (currentFileId) closeFile(currentFileId);
          },
          disabled: !hasOpenFile,
        },
        { id: 'sep3', labelKey: '', separator: true },
        {
          id: 'exit',
          labelKey: 'file.exit',
          shortcut: 'Alt+X',
          action: () => window.close(),
        },
      ],
    },
    {
      id: 'edit',
      labelKey: 'menu.edit',
      hotkey: 'E',
      items: [
        { id: 'undo', labelKey: 'edit.undo', shortcut: 'Ctrl+Z', action: () => document.execCommand('undo') },
        { id: 'redo', labelKey: 'edit.redo', shortcut: 'Ctrl+Y', action: () => document.execCommand('redo') },
        { id: 'sep1', labelKey: '', separator: true },
        { id: 'cut', labelKey: 'edit.cut', shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
        { id: 'copy', labelKey: 'edit.copy', shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
        { id: 'paste', labelKey: 'edit.paste', shortcut: 'Ctrl+V', action: () => document.execCommand('paste') },
        { id: 'sep2', labelKey: '', separator: true },
        { id: 'selectAll', labelKey: 'edit.selectAll', shortcut: 'Ctrl+A', action: () => document.execCommand('selectAll') },
      ],
    },
    {
      id: 'search',
      labelKey: 'menu.search',
      hotkey: 'S',
      items: [
        { id: 'find', labelKey: 'search.find', shortcut: 'Ctrl+F', action: () => setDialog('find') },
        { id: 'replace', labelKey: 'search.replace', shortcut: 'Ctrl+H', action: () => setDialog('replace') },
        { id: 'sep1', labelKey: '', separator: true },
        { id: 'gotoLine', labelKey: 'search.gotoLine', shortcut: 'Ctrl+G', action: () => setDialog('gotoLine') },
      ],
    },
    {
      id: 'run',
      labelKey: 'menu.run',
      hotkey: 'R',
      items: [
        {
          id: 'run',
          labelKey: 'run.run',
          shortcut: 'Ctrl+F9',
          action: async () => {
            if (!currentFileId) return;
            const file = useEditorStore.getState().files.get(currentFileId);
            if (file) {
              setStatus('compiling');
              await compile(file.content, file.name);
              // TODO: Run the compiled code
            }
          },
          disabled: !hasOpenFile,
        },
        { id: 'sep1', labelKey: '', separator: true },
        { id: 'stepOver', labelKey: 'run.stepOver', shortcut: 'F8', action: () => console.log('Step Over'), disabled: true },
        { id: 'traceInto', labelKey: 'run.traceInto', shortcut: 'F7', action: () => console.log('Trace Into'), disabled: true },
      ],
    },
    {
      id: 'compile',
      labelKey: 'menu.compile',
      hotkey: 'C',
      items: [
        {
          id: 'compile',
          labelKey: 'compile.compile',
          shortcut: 'Alt+F9',
          action: async () => {
            if (!currentFileId) return;
            const file = useEditorStore.getState().files.get(currentFileId);
            if (file) {
              setStatus('compiling');
              await compile(file.content, file.name);
            }
          },
          disabled: !hasOpenFile,
        },
        {
          id: 'make',
          labelKey: 'compile.make',
          shortcut: 'F9',
          action: async () => {
            if (!currentFileId) return;
            const file = useEditorStore.getState().files.get(currentFileId);
            if (file) {
              setStatus('compiling');
              await compile(file.content, file.name);
            }
          },
          disabled: !hasOpenFile,
        },
        {
          id: 'build',
          labelKey: 'compile.build',
          action: async () => {
            if (!currentFileId) return;
            const file = useEditorStore.getState().files.get(currentFileId);
            if (file) {
              setStatus('compiling');
              await compile(file.content, file.name);
            }
          },
          disabled: !hasOpenFile,
        },
      ],
    },
    {
      id: 'debug',
      labelKey: 'menu.debug',
      hotkey: 'D',
      items: [
        { id: 'breakpoints', labelKey: 'debug.breakpoints', action: () => console.log('Breakpoints') },
        { id: 'watches', labelKey: 'debug.watches', action: () => updateUISettings({ showDebugPanel: !ui.showDebugPanel }) },
        { id: 'sep1', labelKey: '', separator: true },
        { id: 'toggleBreakpoint', labelKey: 'debug.toggleBreakpoint', shortcut: 'F2', action: () => console.log('Toggle Breakpoint') },
      ],
    },
    {
      id: 'options',
      labelKey: 'menu.options',
      hotkey: 'O',
      items: [
        { id: 'compiler', labelKey: 'options.compiler', action: () => setDialog('compilerOptions') },
        { id: 'editor', labelKey: 'options.editor', action: () => setDialog('editorOptions') },
        { id: 'sep1', labelKey: '', separator: true },
        { id: 'colors', labelKey: 'options.colors', action: () => setDialog('colors') },
      ],
    },
    {
      id: 'window',
      labelKey: 'menu.window',
      hotkey: 'W',
      items: [
        {
          id: 'fileExplorer',
          labelKey: 'File Explorer',
          action: () => updateUISettings({ showFileExplorer: !ui.showFileExplorer }),
        },
        {
          id: 'debugPanel',
          labelKey: 'Debug Panel',
          action: () => updateUISettings({ showDebugPanel: !ui.showDebugPanel }),
        },
      ],
    },
    {
      id: 'help',
      labelKey: 'menu.help',
      hotkey: 'H',
      items: [
        { id: 'about', labelKey: 'About', action: () => setDialog('about') },
      ],
    },
  ];

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcuts for Alt+letter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        const menu = menus.find((m) => m.hotkey.toLowerCase() === e.key.toLowerCase());
        if (menu) {
          e.preventDefault();
          setActiveMenu(activeMenu === menu.id ? null : menu.id);
        }
      }
      if (e.key === 'Escape') {
        setActiveMenu(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMenu, menus]);

  const handleMenuClick = (menuId: string) => {
    setActiveMenu(activeMenu === menuId ? null : menuId);
  };

  const handleMenuHover = (menuId: string) => {
    if (activeMenu) {
      setActiveMenu(menuId);
    }
  };

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.disabled || item.separator) return;
    if (item.action) {
      item.action();
    }
    setActiveMenu(null);
  }, []);

  const renderLabel = (label: string, hotkey: string, isActive: boolean) => {
    const index = label.toLowerCase().indexOf(hotkey.toLowerCase());
    if (index === -1) return label;
    return (
      <>
        {label.slice(0, index)}
        <span {...stylex.props(isActive ? styles.menuItemHighlightActive : styles.menuItemHighlight)}>
          {label[index]}
        </span>
        {label.slice(index + 1)}
      </>
    );
  };

  return (
    <div {...stylex.props(styles.menuBar)} ref={menuBarRef}>
      {menus.map((menu) => {
        const isActive = activeMenu === menu.id;
        return (
          <div
            key={menu.id}
            {...stylex.props(styles.menuItem, isActive && styles.menuItemActive)}
            onClick={() => handleMenuClick(menu.id)}
            onMouseEnter={() => handleMenuHover(menu.id)}
          >
            {renderLabel(t(menu.labelKey), menu.hotkey, isActive)}
            {isActive && (
              <div {...stylex.props(styles.dropdown)}>
                {menu.items.map((item) => {
                  if (item.separator) {
                    return <div key={item.id} {...stylex.props(styles.dropdownSeparator)} />;
                  }
                  const isHovered = hoveredItem === `${menu.id}-${item.id}`;
                  return (
                    <div
                      key={item.id}
                      {...stylex.props(
                        styles.dropdownItem,
                        isHovered && !item.disabled && styles.dropdownItemHover,
                        item.disabled && styles.dropdownItemDisabled
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(item);
                      }}
                      onMouseEnter={() => setHoveredItem(`${menu.id}-${item.id}`)}
                      onMouseLeave={() => setHoveredItem(null)}
                    >
                      <span>{t(item.labelKey)}</span>
                      {item.shortcut && (
                        <span {...stylex.props(styles.shortcut, isHovered && styles.shortcutActive)}>
                          {item.shortcut}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div {...stylex.props(styles.spacer)} />
    </div>
  );
}
