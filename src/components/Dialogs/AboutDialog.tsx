import * as stylex from '@stylexjs/stylex';
import { Dialog } from './Dialog';
import { DOSButton } from '@components/common';
import { dosColors, dosFonts, dosSpacing } from '@styles/tokens.stylex';

const styles = stylex.create({
  content: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: dosSpacing.md,
    minWidth: '250px',
  },
  title: {
    color: dosColors.blue,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    fontWeight: 'bold',
    margin: 0,
  },
  version: {
    color: dosColors.black,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    margin: 0,
  },
  copyright: {
    color: dosColors.darkGray,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    margin: 0,
  },
  divider: {
    width: '100%',
    height: '1px',
    backgroundColor: dosColors.darkGray,
    margin: `${dosSpacing.sm} 0`,
  },
});

interface AboutDialogProps {
  onClose: () => void;
  appTitle?: string;
  version?: string;
  copyright?: string;
}

export function AboutDialog({
  onClose,
  appTitle = 'Turbo Pascal IDE',
  version = 'Version 7.0',
  copyright = 'Copyright (c) 1983-1992 Borland International',
}: AboutDialogProps) {
  return (
    <Dialog
      title="About"
      onClose={onClose}
      footer={<DOSButton onClick={onClose} hotkey="O">OK</DOSButton>}
    >
      <div {...stylex.props(styles.content)}>
        <p {...stylex.props(styles.title)}>{appTitle}</p>
        <p {...stylex.props(styles.version)}>{version}</p>
        <div {...stylex.props(styles.divider)} />
        <p {...stylex.props(styles.copyright)}>{copyright}</p>
      </div>
    </Dialog>
  );
}
