import * as stylex from '@stylexjs/stylex';
import { InputHTMLAttributes, forwardRef } from 'react';
import {
  dosColors,
  dosFonts,
  dosSpacing,
  dosShadows,
} from '../../styles/tokens.stylex';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: dosSpacing.xs,
  },
  label: {
    color: dosColors.black,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
  },
  hotkey: {
    color: dosColors.red,
    textDecoration: 'underline',
  },
  input: {
    backgroundColor: dosColors.black,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    lineHeight: dosFonts.lineHeight,
    padding: dosSpacing.sm,
    border: 'none',
    boxShadow: dosShadows.inset,
    outline: 'none',
    ':focus': {
      boxShadow: `inset 2px 2px 0 rgba(0,0,0,0.5), inset -2px -2px 0 rgba(255,255,255,0.3), 0 0 0 2px ${dosColors.yellow}`,
    },
    '::placeholder': {
      color: dosColors.darkGray,
    },
  },
  disabled: {
    backgroundColor: dosColors.darkGray,
    color: dosColors.gray,
    cursor: 'not-allowed',
  },
});

interface DOSInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hotkey?: string;
}

/**
 * Renders a label with hotkey character highlighted and underlined
 */
function renderLabelWithHotkey(label: string, hotkey?: string) {
  if (!hotkey) {
    return label;
  }

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

export const DOSInput = forwardRef<HTMLInputElement, DOSInputProps>(
  function DOSInput({ label, hotkey, disabled = false, ...props }, ref) {
    return (
      <div {...stylex.props(styles.container)}>
        {label && (
          <label {...stylex.props(styles.label)}>
            {renderLabelWithHotkey(label, hotkey)}
          </label>
        )}
        <input
          ref={ref}
          {...stylex.props(styles.input, disabled && styles.disabled)}
          disabled={disabled}
          {...props}
        />
      </div>
    );
  }
);
