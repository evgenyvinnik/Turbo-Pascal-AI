import * as stylex from '@stylexjs/stylex';
import { InputHTMLAttributes } from 'react';
import { dosColors, dosFonts, dosSpacing } from '@styles/tokens.stylex';

const styles = stylex.create({
  container: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: dosSpacing.sm,
    cursor: 'pointer',
    userSelect: 'none',
  },
  containerDisabled: {
    cursor: 'not-allowed',
    opacity: 0.6,
  },
  checkbox: {
    display: 'none',
  },
  box: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    backgroundColor: dosColors.black,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: dosFonts.size,
    lineHeight: '16px',
    border: `1px solid ${dosColors.white}`,
  },
  boxChecked: {
    color: dosColors.yellow,
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
});

interface DOSCheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hotkey?: string;
  checked?: boolean;
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

export function DOSCheckbox({
  label,
  hotkey,
  checked = false,
  disabled = false,
  onChange,
  ...props
}: DOSCheckboxProps) {
  const handleClick = () => {
    if (disabled || !onChange) return;
    const syntheticEvent = {
      target: { checked: !checked },
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(syntheticEvent);
  };

  return (
    <div
      {...stylex.props(
        styles.container,
        disabled && styles.containerDisabled
      )}
      onClick={handleClick}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        {...stylex.props(styles.checkbox)}
        {...props}
      />
      <span
        {...stylex.props(styles.box, checked && styles.boxChecked)}
      >
        {checked ? 'X' : ' '}
      </span>
      {label && (
        <span {...stylex.props(styles.label)}>
          {renderLabelWithHotkey(label, hotkey)}
        </span>
      )}
    </div>
  );
}
