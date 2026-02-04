import * as stylex from '@stylexjs/stylex';
import { ReactNode, useEffect, useCallback } from 'react';
import {
  dosColors,
  dosFonts,
  dosSpacing,
  dosShadows,
} from '../../styles/tokens.stylex';

const styles = stylex.create({
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.gray,
    boxShadow: dosShadows.window,
    border: `2px solid ${dosColors.black}`,
    minWidth: '300px',
    maxWidth: '90vw',
    maxHeight: '90vh',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: dosColors.blue,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    padding: `${dosSpacing.xs} ${dosSpacing.sm}`,
    userSelect: 'none',
    borderBottom: `1px solid ${dosColors.black}`,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontWeight: 'normal',
    margin: 0,
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    backgroundColor: dosColors.gray,
    color: dosColors.black,
    fontFamily: dosFonts.mono,
    fontSize: '12px',
    border: `1px solid ${dosColors.black}`,
    cursor: 'pointer',
    boxShadow: dosShadows.raised,
    ':hover': {
      backgroundColor: dosColors.lightGray,
    },
    ':active': {
      boxShadow: dosShadows.pressed,
    },
  },
  closeButtonSpacer: {
    width: '16px',
  },
  content: {
    flex: 1,
    padding: dosSpacing.md,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    color: dosColors.black,
    overflow: 'auto',
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    gap: dosSpacing.md,
    padding: dosSpacing.md,
    borderTop: `1px solid ${dosColors.black}`,
  },
});

interface DialogProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  showCloseButton?: boolean;
}

export function Dialog({
  title,
  children,
  footer,
  onClose,
  showCloseButton = true,
}: DialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div {...stylex.props(styles.backdrop)} onClick={handleBackdropClick}>
      <div {...stylex.props(styles.dialog)}>
        <div {...stylex.props(styles.titleBar)}>
          <div {...stylex.props(styles.closeButtonSpacer)} />
          <h2 {...stylex.props(styles.title)}>{title}</h2>
          {showCloseButton ? (
            <button
              {...stylex.props(styles.closeButton)}
              onClick={onClose}
              aria-label="Close"
            >
              X
            </button>
          ) : (
            <div {...stylex.props(styles.closeButtonSpacer)} />
          )}
        </div>
        <div {...stylex.props(styles.content)}>{children}</div>
        {footer && <div {...stylex.props(styles.footer)}>{footer}</div>}
      </div>
    </div>
  );
}
