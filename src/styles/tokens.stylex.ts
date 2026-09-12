import * as stylex from '@stylexjs/stylex';

/**
 * DOS Color Palette
 * Authentic EGA 16-color palette for Turbo Pascal V7
 * Standard colors (0-7) and light/bright colors (8-15)
 */
export const dosColors = stylex.defineVars({
  // Primary DOS Blue theme
  blue: '#0000A8',
  lightBlue: '#5757FF',
  darkBlue: '#000000',

  // Grays for menus and borders
  darkGray: '#545454',
  gray: '#A8A8A8',
  lightGray: '#A8A8A8', // Authentic DOS light gray

  // Text colors
  white: '#FFFFFF',
  yellow: '#FFFF57',
  black: '#000000',

  // Standard DOS colors (darker)
  cyan: '#00A8A8',
  green: '#00A800',
  red: '#A80000',
  magenta: '#A800A8',
  brown: '#A85700',

  // Light/bright DOS colors
  lightRed: '#FF5757',
  lightGreen: '#57FF57',
  lightCyan: '#57FFFF',
  lightMagenta: '#FF57FF',

  // Semantic colors
  background: '#000000',
  menuBackground: '#A8A8A8',
  menuText: '#000000',
  editorBackground: '#00A8A8', // Cyan background like authentic TP7
  terminalBackground: '#000000',
  selectionBackground: '#5757FF',
  cursorColor: '#FFFF57',
  errorColor: '#A80000', // Standard red for errors
  warningColor: '#FFFF57',
  successColor: '#00A800', // Standard green for success
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
  mono: '"Px437 IBM VGA 8x16", "Perfect DOS VGA 437", "DejaVu Sans Mono", Consolas, Menlo, "Courier New", monospace',
  size: '15px',
  lineHeight: '16px',
  letterSpacing: '0px',
});

export const dosShadows = stylex.defineVars({
  // Authentic DOS 3D effects with stronger contrast
  inset:
    'inset 1px 1px 0 #000000, inset -1px -1px 0 #FFFFFF',
  raised:
    'inset 1px 1px 0 #FFFFFF, inset -1px -1px 0 #545454, 1px 1px 0 #000000',
  pressed:
    'inset 1px 1px 0 #545454, inset -1px -1px 0 #FFFFFF',
  window:
    'inset 2px 2px 0 #FFFFFF, inset -2px -2px 0 #545454, 2px 2px 0 #000000',
  panel:
    'inset 1px 1px 0 #FFFFFF, inset -1px -1px 0 #545454',
});

export const dosBorders = stylex.defineVars({
  thin: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
});
