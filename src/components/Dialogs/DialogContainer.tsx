import { useUIStore } from '@stores/uiStore';
import { useEditorStore } from '@stores/editorStore';
import { AboutDialog } from './AboutDialog';
import { FindDialog } from './FindDialog';
import { ReplaceDialog } from './ReplaceDialog';
import { GotoLineDialog } from './GotoLineDialog';
import { CompilerOptionsDialog } from './CompilerOptionsDialog';
import { EditorOptionsDialog } from './EditorOptionsDialog';
import { ColorsDialog } from './ColorsDialog';
import { FileOpenDialog } from './FileOpenDialog';
import { FileSaveDialog } from './FileSaveDialog';

export function DialogContainer() {
  const activeDialog = useUIStore((state) => state.activeDialog);
  const closeDialog = useUIStore((state) => state.closeDialog);

  const panes = useEditorStore((state) => state.panes);
  const files = useEditorStore((state) => state.files);
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition);
  const updateContent = useEditorStore((state) => state.updateContent);
  const openFile = useEditorStore((state) => state.openFile);
  const saveFile = useEditorStore((state) => state.saveFile);

  const currentPane = panes[0];
  const currentFileId = currentPane?.activeFileId;
  const currentFile = currentFileId ? files.get(currentFileId) : null;

  const handleFind = (
    text: string,
    options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
  ) => {
    if (!currentFile || !currentFileId) return;

    const content = currentFile.content;
    let searchPattern: RegExp;

    try {
      if (options.regex) {
        searchPattern = new RegExp(
          text,
          options.caseSensitive ? 'g' : 'gi'
        );
      } else {
        let pattern = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (options.wholeWord) {
          pattern = `\\b${pattern}\\b`;
        }
        searchPattern = new RegExp(
          pattern,
          options.caseSensitive ? 'g' : 'gi'
        );
      }

      const match = searchPattern.exec(content);
      if (match) {
        const beforeMatch = content.slice(0, match.index);
        const lines = beforeMatch.split('\n');
        const line = lines.length;
        const column = (lines[lines.length - 1]?.length ?? 0) + 1;
        setCursorPosition(currentFileId, { line, column });
      }
    } catch (e) {
      console.error('Invalid search pattern:', e);
    }

    closeDialog();
  };

  const handleReplace = (
    findText: string,
    replaceText: string,
    options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
  ) => {
    if (!currentFile || !currentFileId) return;

    const content = currentFile.content;
    let searchPattern: RegExp;

    try {
      if (options.regex) {
        searchPattern = new RegExp(findText, options.caseSensitive ? '' : 'i');
      } else {
        let pattern = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (options.wholeWord) {
          pattern = `\\b${pattern}\\b`;
        }
        searchPattern = new RegExp(pattern, options.caseSensitive ? '' : 'i');
      }

      const newContent = content.replace(searchPattern, replaceText);
      if (newContent !== content) {
        updateContent(currentFileId, newContent);
      }
    } catch (e) {
      console.error('Invalid search pattern:', e);
    }
  };

  const handleReplaceAll = (
    findText: string,
    replaceText: string,
    options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
  ) => {
    if (!currentFile || !currentFileId) return;

    const content = currentFile.content;
    let searchPattern: RegExp;

    try {
      if (options.regex) {
        searchPattern = new RegExp(
          findText,
          options.caseSensitive ? 'g' : 'gi'
        );
      } else {
        let pattern = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (options.wholeWord) {
          pattern = `\\b${pattern}\\b`;
        }
        searchPattern = new RegExp(
          pattern,
          options.caseSensitive ? 'g' : 'gi'
        );
      }

      const newContent = content.replace(searchPattern, replaceText);
      if (newContent !== content) {
        updateContent(currentFileId, newContent);
      }
    } catch (e) {
      console.error('Invalid search pattern:', e);
    }

    closeDialog();
  };

  const handleGotoLine = (line: number) => {
    if (!currentFileId) return;
    setCursorPosition(currentFileId, { line, column: 1 });
  };

  const getMaxLine = () => {
    if (!currentFile) return 1;
    return currentFile.content.split('\n').length;
  };

  const getCurrentLine = () => {
    if (!currentFile) return 1;
    return currentFile.cursorPosition.line;
  };

  if (!activeDialog) {
    return null;
  }

  switch (activeDialog) {
    case 'about':
      return <AboutDialog onClose={closeDialog} />;
    case 'find':
      return <FindDialog onClose={closeDialog} onFind={handleFind} />;
    case 'replace':
      return (
        <ReplaceDialog
          onClose={closeDialog}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
        />
      );
    case 'gotoLine':
    case 'goto-line':
      return (
        <GotoLineDialog
          onClose={closeDialog}
          onGoto={handleGotoLine}
          maxLine={getMaxLine()}
          currentLine={getCurrentLine()}
        />
      );
    case 'compilerOptions':
      return <CompilerOptionsDialog onClose={closeDialog} />;
    case 'editorOptions':
      return <EditorOptionsDialog onClose={closeDialog} />;
    case 'colors':
      return <ColorsDialog onClose={closeDialog} />;
    case 'file-open':
      return (
        <FileOpenDialog
          onClose={closeDialog}
          onOpen={(path, name, content) => {
            openFile(path, name, content);
            closeDialog();
          }}
        />
      );
    case 'file-save':
      return (
        <FileSaveDialog
          onClose={closeDialog}
          onSave={(path, name) => {
            if (currentFileId) {
              saveFile(currentFileId);
            }
            closeDialog();
          }}
          currentFilename={currentFile?.name ?? ''}
        />
      );
    default:
      return null;
  }
}
