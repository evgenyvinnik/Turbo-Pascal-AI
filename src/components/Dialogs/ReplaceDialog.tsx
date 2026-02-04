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
    minWidth: '400px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: dosSpacing.sm,
  },
  label: {
    width: '100px',
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

interface ReplaceDialogProps {
  onClose: () => void;
  onReplace?: (
    findText: string,
    replaceText: string,
    options: ReplaceOptions
  ) => void;
  onReplaceAll?: (
    findText: string,
    replaceText: string,
    options: ReplaceOptions
  ) => void;
}

export interface ReplaceOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export function ReplaceDialog({
  onClose,
  onReplace,
  onReplaceAll,
}: ReplaceDialogProps) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);

  const options: ReplaceOptions = { caseSensitive, wholeWord, regex };

  const handleReplace = useCallback(() => {
    if (findText && onReplace) {
      onReplace(findText, replaceText, options);
    }
  }, [findText, replaceText, options, onReplace]);

  const handleReplaceAll = useCallback(() => {
    if (findText && onReplaceAll) {
      onReplaceAll(findText, replaceText, options);
    }
  }, [findText, replaceText, options, onReplaceAll]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const input = document.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;
      input?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog title="Replace" onClose={onClose}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>Find:</span>
          <div {...stylex.props(styles.input)}>
            <DOSInput
              value={findText}
              onChange={setFindText}
              placeholder="Search text..."
            />
          </div>
        </div>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>Replace with:</span>
          <div {...stylex.props(styles.input)}>
            <DOSInput
              value={replaceText}
              onChange={setReplaceText}
              placeholder="Replacement text..."
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
          <DOSButton onClick={handleReplace} hotkey="R">
            Replace
          </DOSButton>
          <DOSButton onClick={handleReplaceAll} hotkey="A">
            Replace All
          </DOSButton>
          <DOSButton onClick={onClose} hotkey="C">
            Cancel
          </DOSButton>
        </div>
      </div>
    </Dialog>
  );
}
