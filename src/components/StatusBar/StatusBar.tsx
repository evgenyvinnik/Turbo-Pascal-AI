import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { dosColors, dosFonts, dosSpacing, dosShadows } from '../../styles/tokens.stylex';
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
    borderTop: `1px solid ${dosColors.black}`,
    boxShadow: dosShadows.panel,
    padding: `0 ${dosSpacing.sm}`,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${dosSpacing.md}`,
    borderRight: `1px solid ${dosColors.black}`,
    boxShadow: dosShadows.panel,
    marginRight: '1px',
  },
  itemLast: {
    borderRight: 'none',
    marginRight: 0,
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
  ready: {
    color: dosColors.green,
  },
});

export function StatusBar() {
  const { t } = useTranslation();
  const insertMode = useEditorStore((state) => state.insertMode);
  const panes = useEditorStore((state) => state.panes);
  const files = useEditorStore((state) => state.files);
  const status = useCompilerStore((state) => state.status);

  // Get current file's cursor position
  const currentPane = panes[0];
  const currentFileId = currentPane?.activeFileId;
  const currentFile = currentFileId ? files.get(currentFileId) : null;
  const cursorPosition = currentFile?.cursorPosition ?? { line: 1, column: 1 };

  const getStatusColor = () => {
    switch (status) {
      case 'error':
        return styles.error;
      case 'success':
      case 'idle':
        return styles.ready;
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
        {t('status.line')}: {cursorPosition.line} {t('status.col')}: {cursorPosition.column}
      </div>
      <div {...stylex.props(styles.item)}>
        {insertMode ? 'INSERT' : 'OVERWRITE'}
      </div>
      <div {...stylex.props(styles.item, styles.itemLast, getStatusColor())}>
        {getStatusText()}
      </div>
    </div>
  );
}
