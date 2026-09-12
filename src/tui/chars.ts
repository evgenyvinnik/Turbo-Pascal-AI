/** CP437 glyphs used by the Turbo Vision look. */

export interface BoxChars {
  tl: string;
  t: string;
  tr: string;
  l: string;
  r: string;
  bl: string;
  b: string;
  br: string;
}

/** Single line frame - used by inactive windows and by menu boxes. */
export const SINGLE: BoxChars = {
  tl: '┌',
  t: '─',
  tr: '┐',
  l: '│',
  r: '│',
  bl: '└',
  b: '─',
  br: '┘',
};

/** Double line frame - used by the active window and by dialog boxes. */
export const DOUBLE: BoxChars = {
  tl: '╔',
  t: '═',
  tr: '╗',
  l: '║',
  r: '║',
  bl: '╚',
  b: '═',
  br: '╝',
};

export const SHADE_LIGHT = '░'; // 176
export const SHADE_MEDIUM = '▒'; // 177 - desktop + scrollbar track
export const SHADE_DARK = '▓'; // 178
export const BLOCK_FULL = '█'; // 219
export const BLOCK_SMALL = '■'; // 254 - close box / scrollbar thumb

export const ARROW_UP = '↑';
export const ARROW_DOWN = '↓';
export const ARROW_UP_DOWN = '↕';
export const ARROW_RIGHT = '→';
export const ARROW_LEFT = '←';

export const TRI_UP = '▲';
export const TRI_DOWN = '▼';
export const TRI_LEFT = '◄';
export const TRI_RIGHT = '►';

export const SUBMENU_MARK = '►';
export const RADIO_ON = '•'; // bullet inside ( )
export const VLINE_LIGHT = '│';
export const HLINE_LIGHT = '─';
export const TEE_LEFT = '┤';
export const TEE_RIGHT = '├';
