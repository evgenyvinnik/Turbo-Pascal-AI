import * as stylex from '@stylexjs/stylex';
import { dosColors, dosFonts } from '../../styles/tokens.stylex';
import { useEditorStore } from '@stores/editorStore';

const styles = stylex.create({
  tabBar: {
    display: 'flex',
    backgroundColor: dosColors.darkBlue,
    borderBottom: `1px solid ${dosColors.blue}`,
    height: '20px',
    overflow: 'hidden',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    backgroundColor: dosColors.darkBlue,
    color: dosColors.gray,
    fontFamily: dosFonts.mono,
    fontSize: '12px',
    cursor: 'pointer',
    borderRight: `1px solid ${dosColors.blue}`,
    userSelect: 'none',
    maxWidth: '150px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    ':hover': {
      backgroundColor: dosColors.blue,
      color: dosColors.white,
    },
  },
  tabActive: {
    backgroundColor: dosColors.editorBackground,
    color: dosColors.white,
  },
  tabDirty: {
    fontStyle: 'italic',
  },
  tabClose: {
    marginLeft: '8px',
    color: dosColors.gray,
    ':hover': {
      color: dosColors.red,
    },
  },
  tabName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
});

interface TabBarProps {
  paneId: string;
}

export function TabBar({ paneId }: TabBarProps) {
  const pane = useEditorStore((state) => state.panes.find((p) => p.id === paneId));
  const files = useEditorStore((state) => state.files);
  const setActiveFile = useEditorStore((state) => state.setActiveFile);
  const closeFile = useEditorStore((state) => state.closeFile);

  if (!pane) return null;

  const handleTabClick = (fileId: string) => {
    setActiveFile(paneId, fileId);
  };

  const handleCloseClick = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    closeFile(fileId);
  };

  return (
    <div {...stylex.props(styles.tabBar)}>
      {pane.openFileIds.map((fileId) => {
        const file = files.get(fileId);
        if (!file) return null;
        const isActive = pane.activeFileId === fileId;
        return (
          <div
            key={fileId}
            {...stylex.props(
              styles.tab,
              isActive && styles.tabActive,
              file.isDirty && styles.tabDirty
            )}
            onClick={() => handleTabClick(fileId)}
          >
            <span {...stylex.props(styles.tabName)}>
              {file.isDirty ? '*' : ''}
              {file.name}
            </span>
            <span
              {...stylex.props(styles.tabClose)}
              onClick={(e) => handleCloseClick(e, fileId)}
            >
              x
            </span>
          </div>
        );
      })}
    </div>
  );
}
