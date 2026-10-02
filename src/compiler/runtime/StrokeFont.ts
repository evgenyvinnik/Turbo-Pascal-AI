import { defined } from '../../utils/defined';
import { HERSHEY_FONTS, HERSHEY_GLYPHS } from './hersheyFonts';

/** Borland CHR binary structure: https://github.com/DosWorld/dwbgi/blob/master/DOCS/CHR.MD */
export interface Stroke {
  x: number;
  y: number;
  draw: boolean;
}
export interface StrokeGlyph {
  width: number;
  strokes: Stroke[];
}
export interface StrokeFont {
  ascent: number;
  descent: number;
  glyphs: Map<number, StrokeGlyph>;
}

export function parseStrokeFont(data: Uint8Array): StrokeFont {
  const invalid = () => {
    throw new Error('Invalid CHR font');
  };
  const word = (at: number): number => {
    if (at < 0 || at + 1 >= data.length) return invalid();
    return defined(data[at]) | (defined(data[at + 1]) << 8);
  };
  if (data[0] !== 0x50 || data[1] !== 0x4b || data[2] !== 8 || data[3] !== 8) invalid();
  const marker = data.indexOf(26, 4);
  if (marker < 0) invalid();
  const header = word(marker + 1),
    count = word(header + 1),
    first = data[header + 4] ?? 0;
  if (
    data[header] !== 43 ||
    count < 1 ||
    first + count > 256 ||
    header + 16 + count * 3 > data.length
  )
    invalid();
  const base = header + word(header + 5);
  const signed8 = (value: number) => (value >= 128 ? value - 256 : value);
  const signed7 = (value: number) => ((value & 127) >= 64 ? (value & 127) - 128 : value & 127);
  const font: StrokeFont = {
    ascent: signed8(data[header + 8] ?? 0),
    descent: signed8(data[header + 10] ?? 0),
    glyphs: new Map(),
  };
  for (let i = 0; i < count; i++) {
    const glyph: StrokeGlyph = { width: data[header + 16 + count * 2 + i] ?? 0, strokes: [] };
    let position = base + word(header + 16 + i * 2),
      ended = false;
    for (; position + 1 < data.length; position += 2) {
      const x = defined(data[position]),
        y = defined(data[position + 1]),
        operation = ((x >>> 7) << 1) | (y >>> 7);
      if (operation === 0) {
        ended = true;
        break;
      }
      if (operation >= 2)
        glyph.strokes.push({ x: signed7(x), y: signed7(y), draw: operation === 3 });
    }
    if (!ended) invalid();
    font.glyphs.set(first + i, glyph);
  }
  return font;
}

/** The Hershey font standing in for one of Borland's ten, by its file
 * (TRIP, LITT, SANS, ...), as Graph uses it when no .CHR file is found. Its
 * coordinates, counted from R with y downwards and the baseline at 9, are
 * scaled to Borland's size: caps of about 31 units, or for the small font,
 * Roman Simplex smaller, about 13. */
export function hersheyFont(file: string): StrokeFont | undefined {
  const numbers = HERSHEY_FONTS[file];
  if (!numbers) return undefined;
  const scale = file === 'LITT' ? 0.6 : 1.5;
  const at = (code: number) => (code - 82) * scale;
  const font: StrokeFont = {
    ascent: Math.round(21 * scale),
    descent: Math.round(-7 * scale),
    glyphs: new Map(),
  };
  numbers.forEach((number, index) => {
    const data = HERSHEY_GLYPHS[number] ?? '';
    const left = data.charCodeAt(0),
      right = data.charCodeAt(1);
    const glyph: StrokeGlyph = { width: Math.round(at(right) - at(left)), strokes: [] };
    let draw = false;
    for (let i = 2; i + 1 < data.length; i += 2) {
      // " R" lifts the pen: the next point is moved to.
      if (data[i] === ' ' && data[i + 1] === 'R') {
        draw = false;
        continue;
      }
      glyph.strokes.push({
        x: Math.round(at(data.charCodeAt(i)) - at(left)),
        y: Math.round(9 * scale - at(data.charCodeAt(i + 1))),
        draw,
      });
      draw = true;
    }
    font.glyphs.set(32 + index, glyph);
  });
  return font;
}
