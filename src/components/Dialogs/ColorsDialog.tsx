import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Dialog } from './Dialog';
import { DOSButton } from '@components/common';
import { dosSpacing } from '../../styles/tokens.stylex';

const DOS_COLORS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Blue', hex: '#0000AA' },
  { name: 'Green', hex: '#00AA00' },
  { name: 'Cyan', hex: '#00AAAA' },
  { name: 'Red', hex: '#AA0000' },
  { name: 'Magenta', hex: '#AA00AA' },
  { name: 'Brown', hex: '#AA5500' },
  { name: 'Light Gray', hex: '#AAAAAA' },
  { name: 'Dark Gray', hex: '#555555' },
  { name: 'Light Blue', hex: '#5555FF' },
  { name: 'Light Green', hex: '#55FF55' },
  { name: 'Light Cyan', hex: '#55FFFF' },
  { name: 'Light Red', hex: '#FF5555' },
  { name: 'Light Magenta', hex: '#FF55FF' },
  { name: 'Yellow', hex: '#FFFF55' },
  { name: 'White', hex: '#FFFFFF' },
];

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
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginBottom: dosSpacing.xs,
  },
  colorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: '4px',
  },
  colorSwatch: {
    width: '32px',
    height: '24px',
    border: '2px solid transparent',
    cursor: 'pointer',
    ':hover': {
      border: '2px solid #FFF',
    },
  },
  colorSwatchSelected: {
    border: '2px solid #FFFF55',
  },
  preview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60px',
    padding: dosSpacing.md,
    marginTop: dosSpacing.sm,
    fontSize: '14px',
    fontFamily: 'monospace',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: dosSpacing.md,
  },
  label: {
    width: '100px',
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: dosSpacing.sm,
    marginTop: dosSpacing.md,
  },
});

interface ColorsDialogProps {
  onClose: () => void;
  onApply?: (foreground: string, background: string) => void;
}

export function ColorsDialog({ onClose, onApply }: ColorsDialogProps) {
  const [foreground, setForeground] = useState('#FFFFFF');
  const [background, setBackground] = useState('#0000AA');

  const handleApply = () => {
    if (onApply) {
      onApply(foreground, background);
    }
    onClose();
  };

  return (
    <Dialog title="Colors" onClose={onClose}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>Foreground</div>
          <div {...stylex.props(styles.colorGrid)}>
            {DOS_COLORS.map((color) => (
              <div
                key={color.hex + 'fg'}
                {...stylex.props(
                  styles.colorSwatch,
                  foreground === color.hex && styles.colorSwatchSelected
                )}
                style={{ backgroundColor: color.hex }}
                onClick={() => setForeground(color.hex)}
                title={color.name}
              />
            ))}
          </div>
        </div>
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>Background</div>
          <div {...stylex.props(styles.colorGrid)}>
            {DOS_COLORS.map((color) => (
              <div
                key={color.hex + 'bg'}
                {...stylex.props(
                  styles.colorSwatch,
                  background === color.hex && styles.colorSwatchSelected
                )}
                style={{ backgroundColor: color.hex }}
                onClick={() => setBackground(color.hex)}
                title={color.name}
              />
            ))}
          </div>
        </div>
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>Preview</div>
          <div
            {...stylex.props(styles.preview)}
            style={{ backgroundColor: background, color: foreground }}
          >
            Sample Text - ABCDEFGHIJ 0123456789
          </div>
        </div>
        <div {...stylex.props(styles.buttons)}>
          <DOSButton onClick={handleApply} hotkey="O">
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
