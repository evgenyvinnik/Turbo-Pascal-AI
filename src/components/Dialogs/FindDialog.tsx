import { useState, useCallback, useEffect } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Dialog } from './Dialog';
import { DOSButton, DOSCheckbox, DOSInput } from '@components/common';
import { dosSpacing } from '../../styles/tokens.stylex';

const styles = stylex.create({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: dosSpacing.md,
    minWidth: '350px',
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
  options: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: dosSpacing.md,
    marginTop: dosSpacing.sm,
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: dosSpacing.sm,
    marginTop: dosSpacing.md,
  },
});

interface FindDialogProps {
  onClose: () => void;
  onFind?: (text: string, options: FindOptions) => void;
}

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export function FindDialog({ onClose, onFind }: FindDialogProps) {
  const [searchText, setSearchText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);

  const handleFind = useCallback(() => {
    if (searchText && onFind) {
      onFind(searchText, { caseSensitive, wholeWord, regex });
    }
  }, [searchText, caseSensitive, wholeWord, regex, onFind]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleFind();
      }
    },
    [handleFind]
  );

  useEffect(() => {
    // Auto-focus search input
    const timer = setTimeout(() => {
      const input = document.querySelector('input[type="text"]') as HTMLInputElement;
      input?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog title="Find" onClose={onClose}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>Find:</span>
          <div {...stylex.props(styles.input)}>
            <DOSInput
              value={searchText}
              onChange={setSearchText}
              onKeyDown={handleKeyDown}
              placeholder="Search text..."
            />
          </div>
        </div>
        <div {...stylex.props(styles.options)}>
          <DOSCheckbox
            label="Case sensitive"
            checked={caseSensitive}
            onChange={setCaseSensitive}
          />
          <DOSCheckbox
            label="Whole word"
            checked={wholeWord}
            onChange={setWholeWord}
          />
          <DOSCheckbox
            label="Regular expression"
            checked={regex}
            onChange={setRegex}
          />
        </div>
        <div {...stylex.props(styles.buttons)}>
          <DOSButton onClick={handleFind} hotkey="F">
            Find
          </DOSButton>
          <DOSButton onClick={onClose} hotkey="C">
            Cancel
          </DOSButton>
        </div>
      </div>
    </Dialog>
  );
}
