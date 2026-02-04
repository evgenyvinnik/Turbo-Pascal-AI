import * as stylex from '@stylexjs/stylex';
import { Dialog } from './Dialog';
import { DOSButton, DOSCheckbox } from '@components/common';
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
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: dosSpacing.sm,
    marginTop: dosSpacing.md,
  },
});

interface CompilerOptionsDialogProps {
  onClose: () => void;
}

export function CompilerOptionsDialog({ onClose }: CompilerOptionsDialogProps) {
  const compiler = useSettingsStore((state) => state.compiler);
  const updateCompilerSettings = useSettingsStore(
    (state) => state.updateCompilerSettings
  );

  const handleSave = () => {
    onClose();
  };

  return (
    <Dialog title="Compiler Options" onClose={onClose}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>Code Generation</div>
          <DOSCheckbox
            label="Range checking"
            checked={compiler.rangeChecking}
            onChange={(checked) =>
              updateCompilerSettings({ rangeChecking: checked })
            }
          />
          <DOSCheckbox
            label="Stack checking"
            checked={compiler.stackChecking}
            onChange={(checked) =>
              updateCompilerSettings({ stackChecking: checked })
            }
          />
          <DOSCheckbox
            label="I/O checking"
            checked={compiler.ioChecking}
            onChange={(checked) =>
              updateCompilerSettings({ ioChecking: checked })
            }
          />
          <DOSCheckbox
            label="Overflow checking"
            checked={compiler.overflowChecking}
            onChange={(checked) =>
              updateCompilerSettings({ overflowChecking: checked })
            }
          />
        </div>
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>Debug</div>
          <DOSCheckbox
            label="Debug information"
            checked={compiler.debugInfo}
            onChange={(checked) =>
              updateCompilerSettings({ debugInfo: checked })
            }
          />
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
