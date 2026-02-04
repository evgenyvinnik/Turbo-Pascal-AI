import * as stylex from '@stylexjs/stylex';

/**
 * DOS Color Palette
 * Authentic EGA 16-color palette for Turbo Pascal V7
 * Standard colors (0-7) and light/bright colors (8-15)
 */
export const dosColors = stylex.defineVars({
  // Primary DOS Blue theme
  blue: '#0000AA',
  lightBlue: '#5555FF',
  darkBlue: '#000055',

  // Grays for menus and borders
  darkGray: '#555555',
  gray: '#AAAAAA',
  lightGray: '#AAAAAA', // Authentic DOS light gray

  // Text colors
  white: '#FFFFFF',
  yellow: '#FFFF55',
  black: '#000000',

  // Standard DOS colors (darker)
  cyan: '#00AAAA',
  green: '#00AA00',
  red: '#AA0000',
  magenta: '#AA00AA',
  brown: '#AA5500',

  // Light/bright DOS colors
  lightRed: '#FF5555',
  lightGreen: '#55FF55',
  lightCyan: '#55FFFF',
  lightMagenta: '#FF55FF',

  // Semantic colors
  background: '#000055',
  menuBackground: '#AAAAAA',
  menuText: '#000000',
  editorBackground: '#00AAAA', // Cyan background like authentic TP7
  terminalBackground: '#000000',
  selectionBackground: '#5555FF',
  cursorColor: '#FFFF55',
  errorColor: '#AA0000', // Standard red for errors
  warningColor: '#FFFF55',
  successColor: '#00AA00', // Standard green for success
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
  // Authentic DOS 3D effects with stronger contrast
  inset:
    'inset 1px 1px 0 #000000, inset -1px -1px 0 #FFFFFF',
  raised:
    'inset 1px 1px 0 #FFFFFF, inset -1px -1px 0 #555555, 1px 1px 0 #000000',
  pressed:
    'inset 1px 1px 0 #555555, inset -1px -1px 0 #FFFFFF',
  window:
    'inset 2px 2px 0 #FFFFFF, inset -2px -2px 0 #555555, 2px 2px 0 #000000',
  panel:
    'inset 1px 1px 0 #FFFFFF, inset -1px -1px 0 #555555',
});

export const dosBorders = stylex.defineVars({
  thin: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
});
