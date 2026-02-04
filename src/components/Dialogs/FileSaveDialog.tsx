import { useState, useCallback, useEffect } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Dialog } from './Dialog';
import { DOSButton, DOSInput } from '@components/common';
import { dosColors, dosFonts, dosSpacing, dosShadows } from '../../styles/tokens.stylex';

const styles = stylex.create({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: dosSpacing.md,
    minWidth: '400px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: dosSpacing.sm,
  },
  label: {
    width: '80px',
    textAlign: 'right',
  },
  input: {
    flex: 1,
  },
  directoryListContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: dosSpacing.xs,
  },
  directoryList: {
    height: '150px',
    backgroundColor: dosColors.black,
    color: dosColors.yellow,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    boxShadow: dosShadows.inset,
    overflow: 'auto',
  },
  listHeader: {
    backgroundColor: dosColors.blue,
    color: dosColors.white,
    padding: `${dosSpacing.xs} ${dosSpacing.sm}`,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
  },
  listItem: {
    padding: `${dosSpacing.xs} ${dosSpacing.sm}`,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: dosColors.blue,
      color: dosColors.white,
    },
  },
  listItemSelected: {
    backgroundColor: dosColors.lightBlue,
    color: dosColors.white,
  },
  filterSelect: {
    backgroundColor: dosColors.black,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    padding: dosSpacing.sm,
    border: 'none',
    boxShadow: dosShadows.inset,
    flex: 1,
  },
  pathDisplay: {
    color: dosColors.black,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    marginTop: dosSpacing.sm,
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: dosSpacing.sm,
    marginTop: dosSpacing.md,
  },
});

const sampleDirectories = [
  { name: '..', path: '/' },
  { name: 'SAMPLES', path: '/samples' },
  { name: 'PROJECTS', path: '/projects' },
  { name: 'BACKUP', path: '/backup' },
];

interface FileSaveDialogProps {
  onClose: () => void;
  onSave: (path: string, name: string) => void;
  currentFilename?: string;
}

export function FileSaveDialog({ onClose, onSave, currentFilename = '' }: FileSaveDialogProps) {
  const [filename, setFilename] = useState(currentFilename);
  const [selectedDir, setSelectedDir] = useState('/samples');
  const [fileType, setFileType] = useState('.PAS');

  const getFullPath = () => {
    let name = filename;
    if (!name.toUpperCase().endsWith(fileType.toUpperCase())) {
      name = name + fileType;
    }
    return `${selectedDir}/${name}`;
  };

  const handleSave = useCallback(() => {
    if (!filename.trim()) return;

    let name = filename.trim().toUpperCase();
    if (!name.endsWith(fileType.toUpperCase())) {
      name = name + fileType.toUpperCase();
    }

    const path = `${selectedDir}/${name}`;
    onSave(path, name);
    onClose();
  }, [filename, fileType, selectedDir, onSave, onClose]);

  const handleDirectoryClick = useCallback((path: string) => {
    setSelectedDir(path);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && filename.trim()) {
        handleSave();
      }
    },
    [filename, handleSave]
  );

  useEffect(() => {
    // Auto-focus and select filename
    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  return (
    <Dialog title="Save File As" onClose={onClose}>
      <div {...stylex.props(styles.content)} onKeyDown={handleKeyDown}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>Save as:</span>
          <div {...stylex.props(styles.input)}>
            <DOSInput
              value={filename}
              onChange={setFilename}
              placeholder="FILENAME"
            />
          </div>
        </div>

        <div {...stylex.props(styles.directoryListContainer)}>
          <div {...stylex.props(styles.listHeader)}>Directories</div>
          <div {...stylex.props(styles.directoryList)}>
            {sampleDirectories.map((dir) => (
              <div
                key={dir.path}
                {...stylex.props(
                  styles.listItem,
                  selectedDir === dir.path && styles.listItemSelected
                )}
                onClick={() => handleDirectoryClick(dir.path)}
                onDoubleClick={() => handleDirectoryClick(dir.path)}
              >
                [{dir.name}]
              </div>
            ))}
          </div>
        </div>

        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>Type:</span>
          <select
            {...stylex.props(styles.filterSelect)}
            value={fileType}
            onChange={(e) => setFileType(e.target.value)}
          >
            <option value=".PAS">Pascal source (*.PAS)</option>
            <option value=".INC">Include file (*.INC)</option>
            <option value=".TXT">Text file (*.TXT)</option>
          </select>
        </div>

        <div {...stylex.props(styles.pathDisplay)}>
          Full path: {getFullPath()}
        </div>

        <div {...stylex.props(styles.buttons)}>
          <DOSButton onClick={handleSave} hotkey="S" disabled={!filename.trim()}>
            Save
          </DOSButton>
          <DOSButton onClick={onClose} hotkey="C">
            Cancel
          </DOSButton>
        </div>
      </div>
    </Dialog>
  );
}
