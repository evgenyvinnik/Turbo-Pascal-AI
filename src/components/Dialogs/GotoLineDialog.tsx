import { useState, useCallback, useEffect, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Dialog } from './Dialog';
import { DOSButton, DOSInput } from '@components/common';
import { dosSpacing } from '../../styles/tokens.stylex';

const styles = stylex.create({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: dosSpacing.md,
    minWidth: '250px',
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
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: dosSpacing.sm,
    marginTop: dosSpacing.md,
  },
  info: {
    fontSize: '12px',
    color: '#555',
    textAlign: 'center',
  },
});

interface GotoLineDialogProps {
  onClose: () => void;
  onGoto?: (line: number) => void;
  maxLine?: number;
  currentLine?: number;
}

export function GotoLineDialog({
  onClose,
  onGoto,
  maxLine = 1,
  currentLine = 1,
}: GotoLineDialogProps) {
  const [lineNumber, setLineNumber] = useState(String(currentLine));
  const inputRef = useRef<HTMLInputElement>(null);

  const handleGoto = useCallback(() => {
    const line = parseInt(lineNumber, 10);
    if (!isNaN(line) && line >= 1 && line <= maxLine && onGoto) {
      onGoto(line);
      onClose();
    }
  }, [lineNumber, maxLine, onGoto, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleGoto();
      }
    },
    [handleGoto]
  );

  const handleChange = useCallback((value: string) => {
    // Only allow numeric input
    const numericValue = value.replace(/[^0-9]/g, '');
    setLineNumber(numericValue);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog title="Go to Line" onClose={onClose}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>Line:</span>
          <div {...stylex.props(styles.input)}>
            <DOSInput
              ref={inputRef}
              value={lineNumber}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={`1 - ${maxLine}`}
            />
          </div>
        </div>
        <div {...stylex.props(styles.info)}>
          Enter a line number (1 - {maxLine})
        </div>
        <div {...stylex.props(styles.buttons)}>
          <DOSButton onClick={handleGoto} hotkey="G">
            Go
          </DOSButton>
          <DOSButton onClick={onClose} hotkey="C">
            Cancel
          </DOSButton>
        </div>
      </div>
    </Dialog>
  );
}
