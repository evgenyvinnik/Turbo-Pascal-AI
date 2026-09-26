import type { Screen } from './Screen';
import { VGA_PALETTE } from './palette';
import { glyphCode, VGA_FONT } from './vgaFont';

export const CELL_W = 9;
export const CELL_H = 16;

const COLORS = VGA_PALETTE.map(
  (hex) =>
    [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ] as const
);
const BLACK = [0, 0, 0] as const;

/** Paint the character ROM directly: no font loading, antialiasing or fallback. */
export function rasterize(screen: Screen, image: ImageData): void {
  const width = screen.cols * CELL_W;
  for (let cell = 0; cell < screen.ch.length; cell += 1) {
    const code = glyphCode(screen.ch[cell] ?? ' ');
    const fg = COLORS[screen.fg[cell] ?? 0] ?? BLACK;
    const bg = COLORS[screen.bg[cell] ?? 0] ?? BLACK;
    const x = (cell % screen.cols) * CELL_W;
    const y = Math.floor(cell / screen.cols) * CELL_H;
    for (let row = 0; row < CELL_H; row += 1) {
      const bits = VGA_FONT[code * CELL_H + row] ?? 0;
      for (let col = 0; col < CELL_W; col += 1) {
        // VGA repeats bit 0 into column nine only for line-graphics characters.
        const ink =
          col < 8 ? (bits & (0x80 >> col)) !== 0 : code >= 0xb0 && code <= 0xdf && (bits & 1) !== 0;
        const color = ink ? fg : bg;
        const offset = ((y + row) * width + x + col) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
    }
  }
}
