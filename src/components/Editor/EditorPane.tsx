import * as stylex from '@stylexjs/stylex';
import { dosColors } from '../../styles/tokens.stylex';
import { useEditorStore } from '@stores/editorStore';
import { Editor } from './Editor';
import { TabBar } from './TabBar';

const styles = stylex.create({
  pane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.editorBackground,
    overflow: 'hidden',
  },
  noFile: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: dosColors.gray,
  },
});

interface EditorPaneProps {
  paneId: string;
}

export function EditorPane({ paneId }: EditorPaneProps) {
  const pane = useEditorStore((state) => state.panes.find((p) => p.id === paneId));
  const activeFileId = pane?.activeFileId;

  return (
    <div {...stylex.props(styles.pane)}>
      <TabBar paneId={paneId} />
      {activeFileId ? (
        <Editor fileId={activeFileId} />
      ) : (
        <div {...stylex.props(styles.noFile)}>No file open</div>
      )}
    </div>
  );
}
