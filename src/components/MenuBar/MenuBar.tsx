import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { dosColors, dosFonts, dosSpacing } from '@styles/tokens.stylex';
import { useUIStore } from '@stores/uiStore';

const styles = stylex.create({
  menuBar: {
    display: 'flex',
    backgroundColor: dosColors.menuBackground,
    color: dosColors.menuText,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    height: '20px',
    borderBottom: `1px solid ${dosColors.darkGray}`,
  },
  menuItem: {
    padding: `0 ${dosSpacing.md}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    userSelect: 'none',
    ':hover': {
      backgroundColor: dosColors.blue,
      color: dosColors.white,
    },
  },
  menuItemActive: {
    backgroundColor: dosColors.blue,
    color: dosColors.white,
  },
  menuItemHighlight: {
    color: dosColors.red,
  },
  spacer: {
    flex: 1,
  },
});

interface MenuItemData {
  id: string;
  labelKey: string;
  hotkey: string;
}

const menuItems: MenuItemData[] = [
  { id: 'file', labelKey: 'menu.file', hotkey: 'F' },
  { id: 'edit', labelKey: 'menu.edit', hotkey: 'E' },
  { id: 'search', labelKey: 'menu.search', hotkey: 'S' },
  { id: 'run', labelKey: 'menu.run', hotkey: 'R' },
  { id: 'compile', labelKey: 'menu.compile', hotkey: 'C' },
  { id: 'debug', labelKey: 'menu.debug', hotkey: 'D' },
  { id: 'tools', labelKey: 'menu.tools', hotkey: 'T' },
  { id: 'options', labelKey: 'menu.options', hotkey: 'O' },
  { id: 'window', labelKey: 'menu.window', hotkey: 'W' },
  { id: 'help', labelKey: 'menu.help', hotkey: 'H' },
];

export function MenuBar() {
  const { t } = useTranslation();
  const menuOpen = useUIStore((state) => state.menuOpen);
  const setMenuOpen = useUIStore((state) => state.setMenuOpen);

  const handleMenuClick = (menuId: string) => {
    setMenuOpen(menuOpen === menuId ? null : menuId);
  };

  const renderLabel = (label: string, hotkey: string) => {
    const index = label.toLowerCase().indexOf(hotkey.toLowerCase());
    if (index === -1) {
      return label;
    }
    return (
      <>
        {label.slice(0, index)}
        <span {...stylex.props(styles.menuItemHighlight)}>
          {label[index]}
        </span>
        {label.slice(index + 1)}
      </>
    );
  };

  return (
    <div {...stylex.props(styles.menuBar)}>
      {menuItems.map((item) => (
        <div
          key={item.id}
          {...stylex.props(
            styles.menuItem,
            menuOpen === item.id && styles.menuItemActive
          )}
          onClick={() => handleMenuClick(item.id)}
        >
          {renderLabel(t(item.labelKey), item.hotkey)}
        </div>
      ))}
      <div {...stylex.props(styles.spacer)} />
    </div>
  );
}
