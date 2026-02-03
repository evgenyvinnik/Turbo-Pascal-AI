import * as stylex from '@stylexjs/stylex';

/**
 * DOS Color Palette
 * Authentic Turbo Pascal V7 colors
 */
export const dosColors = stylex.defineVars({
  // Primary DOS Blue theme
  blue: '#0000AA',
  lightBlue: '#5555FF',
  darkBlue: '#000055',

  // Grays for menus and borders
  darkGray: '#555555',
  gray: '#AAAAAA',
  lightGray: '#CCCCCC',

  // Text colors
  white: '#FFFFFF',
  yellow: '#FFFF55',
  black: '#000000',

  // Accent colors
  cyan: '#55FFFF',
  green: '#55FF55',
  red: '#FF5555',
  magenta: '#FF55FF',
  brown: '#AA5500',
  lightRed: '#FF5555',
  lightGreen: '#55FF55',
  lightCyan: '#55FFFF',
  lightMagenta: '#FF55FF',

  // Semantic colors
  background: '#000055',
  menuBackground: '#AAAAAA',
  menuText: '#000000',
  editorBackground: '#0000AA',
  terminalBackground: '#000000',
  selectionBackground: '#5555FF',
  cursorColor: '#FFFF55',
  errorColor: '#FF5555',
  warningColor: '#FFFF55',
  successColor: '#55FF55',
});

export const dosSpacing = stylex.defineVars({
  none: '0',
  xxs: '1px',
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
});

export const dosFonts = stylex.defineVars({
  mono: '"Nouveau IBM", "Courier New", "Lucida Console", monospace',
  size: '14px',
  lineHeight: '16px',
  letterSpacing: '0px',
});

export const dosShadows = stylex.defineVars({
  inset:
    'inset 2px 2px 0 rgba(0,0,0,0.5), inset -2px -2px 0 rgba(255,255,255,0.3)',
  raised:
    '2px 2px 0 rgba(0,0,0,0.5), -1px -1px 0 rgba(255,255,255,0.3)',
  pressed: 'inset 1px 1px 0 rgba(0,0,0,0.5)',
  window: '4px 4px 0 rgba(0,0,0,0.8)',
});

export const dosBorders = stylex.defineVars({
  thin: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
});
