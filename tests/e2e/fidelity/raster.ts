import type { Page } from '@playwright/test';
import type { Rect } from './grid';

export interface RasterMask extends Rect {
  /** Why these particular character cells cannot be compared with the gallery. */
  reason: string;
}

export interface RasterDiff {
  pixels: number;
  compared: number;
  cells: { x: number; y: number; pixels: number }[];
  map: string[];
  image: string;
}

/**
 * Compare the actual browser screenshot with the gallery PNG, byte for byte.
 * Unlike cell-attribute tests, this catches incorrect glyph shapes, misplaced
 * text, antialiasing, and gaps between line-drawing characters. Decoding in the
 * browser avoids a separate PNG library and does not involve the app renderer.
 */
export async function compareRaster(
  page: Page,
  actual: Buffer,
  reference: Buffer,
  masks: RasterMask[] = [],
  scale = 1,
): Promise<RasterDiff> {
  return page.evaluate(async ({ actualUrl, referenceUrl, masks, scale }) => {
    const width = 720 * scale;
    const height = 400 * scale;
    const decode = async (url: string, width: number, height: number) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth !== width || image.naturalHeight !== height) {
        throw new Error(`Expected ${String(width)}×${String(height)} image, got ${String(image.naturalWidth)}×${String(image.naturalHeight)}`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not decode PNG');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, width, height);
    };
    const [actual, reference] = await Promise.all([decode(actualUrl, width, height), decode(referenceUrl, 720, 400)]);
    const image = new ImageData(width, height);
    const counts = Array<number>(80 * 25).fill(0);
    let pixels = 0;
    let compared = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const referenceOffset = (Math.floor(y / scale) * 720 + Math.floor(x / scale)) * 4;
        const col = Math.floor(x / (9 * scale));
        const row = Math.floor(y / (16 * scale));
        const masked = masks.some((r) => col >= r.x && col < r.x + r.w && row >= r.y && row < r.y + r.h);
        const different = !masked && [0, 1, 2, 3].some((channel) => actual.data[offset + channel] !== reference.data[referenceOffset + channel]);
        if (!masked) compared += 1;
        if (different) {
          pixels += 1;
          counts[row * 80 + col]! += 1;
        }
        image.data[offset] = different ? 255 : reference.data[referenceOffset]! / 3;
        image.data[offset + 1] = different ? 48 : reference.data[referenceOffset + 1]! / 3;
        image.data[offset + 2] = different ? 96 : reference.data[referenceOffset + 2]! / 3;
        image.data[offset + 3] = 255;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not paint pixel diff');
    context.putImageData(image, 0, 0);
    return {
      pixels,
      compared,
      cells: counts.flatMap((pixels, i) => pixels ? [{ x: i % 80, y: Math.floor(i / 80), pixels }] : [])
        .sort((a, b) => b.pixels - a.pixels),
      map: Array.from({ length: 25 }, (_, y) => counts.slice(y * 80, (y + 1) * 80).map((n) => n ? '#' : '.').join('')),
      image: canvas.toDataURL('image/png').split(',')[1]!,
    };
  }, {
    actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
    referenceUrl: `data:image/png;base64,${reference.toString('base64')}`,
    masks,
    scale,
  });
}

export function rasterReport(name: string, diff: RasterDiff, masks: RasterMask[]): string {
  return [
    `${name}: ${String(diff.pixels)} mismatched pixels / ${String(diff.compared)} compared pixels`,
    ...masks.map((mask) => `Mask x${String(mask.x)} y${String(mask.y)} ${String(mask.w)}×${String(mask.h)}: ${mask.reason}`),
    '',
    'Mismatched cells (#):',
    ...diff.map.map((row, y) => `${String(y).padStart(2)}  ${row}`),
    '',
    'Cells by mismatched pixel count:',
    ...diff.cells.map((cell) => `  x${String(cell.x)} y${String(cell.y)}: ${String(cell.pixels)}`),
    '',
  ].join('\n');
}
