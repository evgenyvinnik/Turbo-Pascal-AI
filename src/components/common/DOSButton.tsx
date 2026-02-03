import * as stylex from '@stylexjs/stylex';
import { ButtonHTMLAttributes, ReactNode } from 'react';
import {
  dosColors,
  dosFonts,
  dosSpacing,
  dosShadows,
} from '@styles/tokens.stylex';

const styles = stylex.create({
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: dosColors.gray,
    color: dosColors.black,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    lineHeight: dosFonts.lineHeight,
    padding: `${dosSpacing.xs} ${dosSpacing.md}`,
    border: 'none',
    cursor: 'pointer',
    userSelect: 'none',
    minWidth: '80px',
    boxShadow: dosShadows.raised,
    ':hover': {
      backgroundColor: dosColors.lightGray,
    },
    ':active': {
      boxShadow: dosShadows.pressed,
      transform: 'translate(1px, 1px)',
    },
  },
  pressed: {
    boxShadow: dosShadows.pressed,
    transform: 'translate(1px, 1px)',
  },
  disabled: {
    backgroundColor: dosColors.gray,
    color: dosColors.darkGray,
    cursor: 'not-allowed',
    boxShadow: dosShadows.raised,
    ':hover': {
      backgroundColor: dosColors.gray,
    },
    ':active': {
      boxShadow: dosShadows.raised,
      transform: 'none',
    },
  },
  hotkey: {
    color: dosColors.red,
    textDecoration: 'underline',
  },
});

interface DOSButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  hotkey?: string;
  pressed?: boolean;
}

/**
 * Renders a label with hotkey character highlighted and underlined
 */
function renderLabelWithHotkey(
  children: ReactNode,
  hotkey?: string
): ReactNode {
  if (!hotkey || typeof children !== 'string') {
    return children;
  }

  const label = children;
  const index = label.toLowerCase().indexOf(hotkey.toLowerCase());

  if (index === -1) {
    return label;
  }

  return (
    <>
      {label.slice(0, index)}
      <span {...stylex.props(styles.hotkey)}>{label[index]}</span>
      {label.slice(index + 1)}
    </>
  );
}

export function DOSButton({
  children,
  hotkey,
  pressed = false,
  disabled = false,
  ...props
}: DOSButtonProps) {
  return (
    <button
      {...stylex.props(
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled
      )}
      disabled={disabled}
      {...props}
    >
      {renderLabelWithHotkey(children, hotkey)}
    </button>
  );
}
