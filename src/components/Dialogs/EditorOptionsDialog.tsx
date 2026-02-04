import * as stylex from '@stylexjs/stylex';
import { Dialog } from './Dialog';
import { DOSButton, DOSCheckbox, DOSInput } from '@components/common';
import { dosSpacing } from '../../styles/tokens.stylex';
import { useSettingsStore } from '@stores/settingsStore';

const styles = stylex.create({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: dosSpacing.md,
    minWidth: '350px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: dosSpacing.sm,
    padding: dosSpacing.sm,
    border: '1px solid #555',
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginBottom: dosSpacing.xs,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: dosSpacing.sm,
  },
  label: {
    width: '120px',
  },
  input: {
    width: '80px',
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: dosSpacing.sm,
    marginTop: dosSpacing.md,
  },
});

interface EditorOptionsDialogProps {
  onClose: () => void;
}

export function EditorOptionsDialog({ onClose }: EditorOptionsDialogProps) {
  const editor = useSettingsStore((state) => state.editor);
  const updateEditorSettings = useSettingsStore(
    (state) => state.updateEditorSettings
  );

  const handleSave = () => {
    onClose();
  };

  return (
    <Dialog title="Editor Options" onClose={onClose}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>Display</div>
          <DOSCheckbox
            label="Line numbers"
            checked={editor.showLineNumbers}
            onChange={(checked) =>
              updateEditorSettings({ showLineNumbers: checked })
            }
          />
          <DOSCheckbox
            label="Highlight current line"
            checked={editor.highlightCurrentLine}
            onChange={(checked) =>
              updateEditorSettings({ highlightCurrentLine: checked })
            }
          />
          <DOSCheckbox
            label="Syntax highlighting"
            checked={editor.syntaxHighlighting}
            onChange={(checked) =>
              updateEditorSettings({ syntaxHighlighting: checked })
            }
          />
          <DOSCheckbox
            label="Show whitespace"
            checked={editor.showWhitespace}
            onChange={(checked) =>
              updateEditorSettings({ showWhitespace: checked })
            }
          />
        </div>
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>Editing</div>
          <DOSCheckbox
            label="Auto indent"
            checked={editor.autoIndent}
            onChange={(checked) =>
              updateEditorSettings({ autoIndent: checked })
            }
          />
          <DOSCheckbox
            label="Insert mode"
            checked={editor.insertMode}
            onChange={(checked) =>
              updateEditorSettings({ insertMode: checked })
            }
          />
          <div {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.label)}>Tab size:</span>
            <div {...stylex.props(styles.input)}>
              <DOSInput
                value={String(editor.tabSize)}
                onChange={(value) => {
                  const size = parseInt(value, 10);
                  if (!isNaN(size) && size >= 1 && size <= 8) {
                    updateEditorSettings({ tabSize: size });
                  }
                }}
              />
            </div>
          </div>
        </div>
        <div {...stylex.props(styles.buttons)}>
          <DOSButton onClick={handleSave} hotkey="O">
            OK
          </DOSButton>
          <DOSButton onClick={onClose} hotkey="C">
            Cancel
          </DOSButton>
        </div>
      </div>
    </Dialog>
  );
}
