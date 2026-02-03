import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { dosColors, dosFonts, dosSpacing } from '../../styles/tokens.stylex';
import { useEditorStore } from '@stores/editorStore';
import { useCompilerStore } from '@stores/compilerStore';

const styles = stylex.create({
  statusBar: {
    display: 'flex',
    backgroundColor: dosColors.menuBackground,
    color: dosColors.menuText,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    height: '20px',
    borderTop: `1px solid ${dosColors.darkGray}`,
    padding: `0 ${dosSpacing.sm}`,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${dosSpacing.md}`,
    borderRight: `1px solid ${dosColors.darkGray}`,
  },
  itemLast: {
    borderRight: 'none',
  },
  spacer: {
    flex: 1,
  },
  shortcut: {
    color: dosColors.blue,
    marginRight: dosSpacing.sm,
  },
  error: {
    color: dosColors.red,
  },
  success: {
    color: dosColors.green,
  },
});

export function StatusBar() {
  const { t } = useTranslation();
  const insertMode = useEditorStore((state) => state.insertMode);
  const status = useCompilerStore((state) => state.status);

  const getStatusColor = () => {
    switch (status) {
      case 'error':
        return styles.error;
      case 'success':
        return styles.success;
      default:
        return undefined;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'idle':
        return t('status.ready');
      case 'compiling':
      case 'lexing':
      case 'parsing':
        return t('status.compiling');
      case 'success':
        return t('status.ready');
      case 'error':
        return t('status.error');
      default:
        return t('status.ready');
    }
  };

  return (
    <div {...stylex.props(styles.statusBar)}>
      <div {...stylex.props(styles.item)}>
        <span {...stylex.props(styles.shortcut)}>F1</span>
        Help
      </div>
      <div {...stylex.props(styles.item)}>
        <span {...stylex.props(styles.shortcut)}>F2</span>
        Save
      </div>
      <div {...stylex.props(styles.item)}>
        <span {...stylex.props(styles.shortcut)}>F3</span>
        Open
      </div>
      <div {...stylex.props(styles.item)}>
        <span {...stylex.props(styles.shortcut)}>F9</span>
        Compile
      </div>
      <div {...stylex.props(styles.item)}>
        <span {...stylex.props(styles.shortcut)}>F10</span>
        Menu
      </div>
      <div {...stylex.props(styles.spacer)} />
      <div {...stylex.props(styles.item)}>
        {t('status.line')}: 1 {t('status.col')}: 1
      </div>
      <div {...stylex.props(styles.item)}>
        {insertMode ? t('status.insert') : t('status.overwrite')}
      </div>
      <div {...stylex.props(styles.item, styles.itemLast, getStatusColor())}>
        {getStatusText()}
      </div>
    </div>
  );
}
