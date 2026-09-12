/**
 * Authentic VGA text-mode palette as sampled from the Turbo Pascal 7.1
 * reference screenshots (ui.codexpanse.com/turbo-pascal-71.html).
 *
 * The IBM VGA hardware palette uses 0xA8 / 0x57 rather than the 0xAA / 0x55
 * approximation, which is why the values below differ slightly from the
 * "web safe" DOS palettes found elsewhere.
 */
export const VGA_PALETTE = [
  '#000000', // 0  black
  '#0000A8', // 1  blue
  '#00A800', // 2  green
  '#00A8A8', // 3  cyan
  '#A80000', // 4  red
  '#A800A8', // 5  magenta
  '#A85700', // 6  brown
  '#A8A8A8', // 7  light gray
  '#545454', // 8  dark gray
  '#5757FF', // 9  light blue
  '#57FF57', // 10 light green
  '#57FFFF', // 11 light cyan
  '#FF5757', // 12 light red
  '#FF57FF', // 13 light magenta
  '#FFFF57', // 14 yellow
  '#FFFFFF', // 15 white
] as const;

export const C = {
  Black: 0,
  Blue: 1,
  Green: 2,
  Cyan: 3,
  Red: 4,
  Magenta: 5,
  Brown: 6,
  LightGray: 7,
  DarkGray: 8,
  LightBlue: 9,
  LightGreen: 10,
  LightCyan: 11,
  LightRed: 12,
  LightMagenta: 13,
  Yellow: 14,
  White: 15,
} as const;

export type ColorIndex = (typeof C)[keyof typeof C];

export interface Attr {
  fg: number;
  bg: number;
}

export const attr = (fg: number, bg: number): Attr => ({ fg, bg });
