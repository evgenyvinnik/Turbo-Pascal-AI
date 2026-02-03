import { useEffect, useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { dosColors, dosFonts } from '@styles/tokens.stylex';
import { MenuBar } from '@components/MenuBar';
import { StatusBar } from '@components/StatusBar';
import { EditorPane } from '@components/Editor';
import { FileExplorer } from '@components/FileExplorer';
import { Terminal } from '@components/Terminal';
import { DebugPanel } from '@components/DebugPanel';
import { GraphicsCanvas } from '@components/GraphicsCanvas';
import { useEditorStore } from '@stores/editorStore';
import { useSettingsStore } from '@stores/settingsStore';

const styles = stylex.create({
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.background,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  centerArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  editorArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.editorBackground,
    color: dosColors.white,
    overflow: 'hidden',
  },
  welcomeMessage: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '16px',
    color: dosColors.yellow,
  },
  welcomeTitle: {
    marginBottom: '24px',
    color: dosColors.lightCyan,
    fontSize: '18px',
  },
  welcomeText: {
    marginBottom: '8px',
    color: dosColors.gray,
  },
  welcomeShortcut: {
    color: dosColors.white,
    marginLeft: '8px',
  },
  splitHorizontal: {
    flexDirection: 'row',
  },
  splitVertical: {
    flexDirection: 'column',
  },
});

export function IDE() {
  const { t } = useTranslation();
  const panes = useEditorStore((state) => state.panes);
  const _files = useEditorStore((state) => state.files);
  const layout = useEditorStore((state) => state.layout);
  const openFile = useEditorStore((state) => state.openFile);
  const showFileExplorer = useSettingsStore((state) => state.ui.showFileExplorer);
  const showDebugPanel = useSettingsStore((state) => state.ui.showDebugPanel);

  const hasOpenFiles = panes.some((pane) => pane.openFileIds.length > 0);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // F3 - Open file
      if (e.key === 'F3') {
        e.preventDefault();
        // TODO: Open file dialog
        // For now, open a sample file
        openFile('/samples/HELLO.PAS', 'HELLO.PAS', `program Hello;
begin
  WriteLn('Hello, World!');
end.
`);
      }

      // F9 - Compile
      if (e.key === 'F9') {
        e.preventDefault();
        // TODO: Compile current file
        console.log('Compile');
      }

      // Ctrl+F9 - Run
      if (e.ctrlKey && e.key === 'F9') {
        e.preventDefault();
        // TODO: Run current file
        console.log('Run');
      }
    },
    [openFile]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div {...stylex.props(styles.container)}>
      <MenuBar />
      <div {...stylex.props(styles.main)}>
        {showFileExplorer && <FileExplorer />}
        <div {...stylex.props(styles.centerArea)}>
          <div
            {...stylex.props(
              styles.editorArea,
              layout === 'split-horizontal' && styles.splitHorizontal,
              layout === 'split-vertical' && styles.splitVertical
            )}
          >
            {hasOpenFiles ? (
              panes.map((pane) => (
                <EditorPane key={pane.id} paneId={pane.id} />
              ))
            ) : (
              <div {...stylex.props(styles.welcomeMessage)}>
                <h1 {...stylex.props(styles.welcomeTitle)}>
                  {t('app.title')}
                </h1>
                <p {...stylex.props(styles.welcomeText)}>
                  Welcome to Turbo Pascal IDE
                </p>
                <p {...stylex.props(styles.welcomeText)}>
                  Press
                  <span {...stylex.props(styles.welcomeShortcut)}>F3</span>
                  {' '}to open a file
                </p>
                <p {...stylex.props(styles.welcomeText)}>
                  Press
                  <span {...stylex.props(styles.welcomeShortcut)}>Alt+F</span>
                  {' '}to access the File menu
                </p>
                <p {...stylex.props(styles.welcomeText)}>
                  Press
                  <span {...stylex.props(styles.welcomeShortcut)}>F9</span>
                  {' '}to compile
                </p>
                <p {...stylex.props(styles.welcomeText)}>
                  Press
                  <span {...stylex.props(styles.welcomeShortcut)}>Ctrl+F9</span>
                  {' '}to run
                </p>
              </div>
            )}
          </div>
          <Terminal />
        </div>
        {showDebugPanel && <DebugPanel />}
      </div>
      <StatusBar />
      <GraphicsCanvas />
    </div>
  );
}
