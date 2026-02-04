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
  fileListContainer: {
    display: 'flex',
    gap: dosSpacing.md,
  },
  fileList: {
    flex: 1,
    height: '200px',
    backgroundColor: dosColors.black,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    boxShadow: dosShadows.inset,
    overflow: 'auto',
  },
  directoryList: {
    width: '150px',
    height: '200px',
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
  filterRow: {
    display: 'flex',
    gap: dosSpacing.md,
  },
  filterSelect: {
    backgroundColor: dosColors.black,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    padding: dosSpacing.sm,
    border: 'none',
    boxShadow: dosShadows.inset,
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: dosSpacing.sm,
    marginTop: dosSpacing.md,
  },
});

// Sample files for demo - in production would come from IndexedDB
const sampleFiles = [
  { name: 'HELLO.PAS', path: '/samples/HELLO.PAS', content: `program Hello;\nbegin\n  WriteLn('Hello, World!');\nend.\n` },
  { name: 'FIBONACCI.PAS', path: '/samples/FIBONACCI.PAS', content: `program Fibonacci;\nvar\n  i, n, a, b, temp: Integer;\nbegin\n  Write('Enter number of terms: ');\n  ReadLn(n);\n  a := 0;\n  b := 1;\n  for i := 1 to n do\n  begin\n    Write(a, ' ');\n    temp := a + b;\n    a := b;\n    b := temp;\n  end;\n  WriteLn;\nend.\n` },
  { name: 'PRIMES.PAS', path: '/samples/PRIMES.PAS', content: `program Primes;\nvar\n  n, i, j: Integer;\n  isPrime: Boolean;\nbegin\n  Write('Enter max number: ');\n  ReadLn(n);\n  for i := 2 to n do\n  begin\n    isPrime := True;\n    for j := 2 to i - 1 do\n      if i mod j = 0 then\n        isPrime := False;\n    if isPrime then\n      Write(i, ' ');\n  end;\n  WriteLn;\nend.\n` },
  { name: 'CALC.PAS', path: '/samples/CALC.PAS', content: `program Calculator;\nvar\n  a, b: Real;\n  op: Char;\nbegin\n  Write('Enter first number: ');\n  ReadLn(a);\n  Write('Enter operator (+,-,*,/): ');\n  ReadLn(op);\n  Write('Enter second number: ');\n  ReadLn(b);\n  case op of\n    '+': WriteLn('Result: ', a + b:0:2);\n    '-': WriteLn('Result: ', a - b:0:2);\n    '*': WriteLn('Result: ', a * b:0:2);\n    '/': if b <> 0 then\n           WriteLn('Result: ', a / b:0:2)\n         else\n           WriteLn('Error: Division by zero');\n  else\n    WriteLn('Invalid operator');\n  end;\nend.\n` },
];

const sampleDirectories = [
  { name: '..', path: '/' },
  { name: 'SAMPLES', path: '/samples' },
  { name: 'PROJECTS', path: '/projects' },
  { name: 'BACKUP', path: '/backup' },
];

interface FileOpenDialogProps {
  onClose: () => void;
  onOpen: (path: string, name: string, content: string) => void;
}

export function FileOpenDialog({ onClose, onOpen }: FileOpenDialogProps) {
  const [filename, setFilename] = useState('*.PAS');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filter, setFilter] = useState('*.PAS');
  const [currentPath, setCurrentPath] = useState('/samples');

  const filteredFiles = sampleFiles.filter((file) => {
    if (filter === '*.*') return true;
    const ext = filter.replace('*.', '.').toUpperCase();
    return file.name.toUpperCase().endsWith(ext);
  });

  const handleOpen = useCallback(() => {
    const file = sampleFiles.find((f) => f.name === selectedFile);
    if (file) {
      onOpen(file.path, file.name, file.content);
      onClose();
    }
  }, [selectedFile, onOpen, onClose]);

  const handleFileClick = useCallback((name: string) => {
    setSelectedFile(name);
    setFilename(name);
  }, []);

  const handleFileDoubleClick = useCallback((name: string) => {
    const file = sampleFiles.find((f) => f.name === name);
    if (file) {
      onOpen(file.path, file.name, file.content);
      onClose();
    }
  }, [onOpen, onClose]);

  const handleDirectoryClick = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && selectedFile) {
        handleOpen();
      }
    },
    [selectedFile, handleOpen]
  );

  useEffect(() => {
    // Auto-focus
    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    input?.focus();
  }, []);

  return (
    <Dialog title="Open a File" onClose={onClose}>
      <div {...stylex.props(styles.content)} onKeyDown={handleKeyDown}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>Name:</span>
          <div {...stylex.props(styles.input)}>
            <DOSInput
              value={filename}
              onChange={setFilename}
              placeholder="*.PAS"
            />
          </div>
        </div>

        <div {...stylex.props(styles.fileListContainer)}>
          <div style={{ flex: 1 }}>
            <div {...stylex.props(styles.listHeader)}>Files</div>
            <div {...stylex.props(styles.fileList)}>
              {filteredFiles.map((file) => (
                <div
                  key={file.name}
                  {...stylex.props(
                    styles.listItem,
                    selectedFile === file.name && styles.listItemSelected
                  )}
                  onClick={() => handleFileClick(file.name)}
                  onDoubleClick={() => handleFileDoubleClick(file.name)}
                >
                  {file.name}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div {...stylex.props(styles.listHeader)}>Directories</div>
            <div {...stylex.props(styles.directoryList)}>
              {sampleDirectories.map((dir) => (
                <div
                  key={dir.path}
                  {...stylex.props(styles.listItem)}
                  onClick={() => handleDirectoryClick(dir.path)}
                  onDoubleClick={() => handleDirectoryClick(dir.path)}
                >
                  [{dir.name}]
                </div>
              ))}
            </div>
          </div>
        </div>

        <div {...stylex.props(styles.filterRow)}>
          <span {...stylex.props(styles.label)}>Filter:</span>
          <select
            {...stylex.props(styles.filterSelect)}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="*.PAS">Pascal files (*.PAS)</option>
            <option value="*.INC">Include files (*.INC)</option>
            <option value="*.TPU">Unit files (*.TPU)</option>
            <option value="*.*">All files (*.*)</option>
          </select>
          <span style={{ flex: 1 }} />
          <span>Path: {currentPath}</span>
        </div>

        <div {...stylex.props(styles.buttons)}>
          <DOSButton onClick={handleOpen} hotkey="O" disabled={!selectedFile}>
            Open
          </DOSButton>
          <DOSButton onClick={onClose} hotkey="C">
            Cancel
          </DOSButton>
        </div>
      </div>
    </Dialog>
  );
}
