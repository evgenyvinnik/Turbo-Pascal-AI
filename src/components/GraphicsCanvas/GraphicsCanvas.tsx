import { useEffect, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { dosColors } from '../../styles/tokens.stylex';
import { useProgramScreenStore } from '@stores/programScreenStore';

// EGA 16-color palette
const EGA_PALETTE = [
  '#000000', // 0: Black
  '#0000AA', // 1: Blue
  '#00AA00', // 2: Green
  '#00AAAA', // 3: Cyan
  '#AA0000', // 4: Red
  '#AA00AA', // 5: Magenta
  '#AA5500', // 6: Brown
  '#AAAAAA', // 7: Light Gray
  '#555555', // 8: Dark Gray
  '#5555FF', // 9: Light Blue
  '#55FF55', // 10: Light Green
  '#55FFFF', // 11: Light Cyan
  '#FF5555', // 12: Light Red
  '#FF55FF', // 13: Light Magenta
  '#FFFF55', // 14: Yellow
  '#FFFFFF', // 15: White
];

const styles = stylex.create({
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: dosColors.black,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    imageRendering: 'pixelated',
    backgroundColor: dosColors.black,
    maxWidth: '100vw',
    maxHeight: '100vh',
    objectFit: 'contain',
  },
  hint: {
    position: 'absolute',
    bottom: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: dosColors.gray,
    fontSize: '12px',
    fontFamily: 'monospace',
  },
});

interface GraphicsCanvasProps {
  width?: number;
  height?: number;
}

export function GraphicsCanvas({ width = 640, height = 480 }: GraphicsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isVisible = useProgramScreenStore((state) => state.visible && state.kind === 'graphics');
  const graphics = useProgramScreenStore((state) => state.graphics);
  const waiting = useProgramScreenStore((state) => state.waiting);
  const input = useProgramScreenStore((state) => state.input);

  // Initialize canvas with black background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!graphics) return;
    const pixels = ctx.createImageData(graphics.width, graphics.height);
    const colors = EGA_PALETTE.map((color) => Number.parseInt(color.slice(1), 16));
    for (let index = 0; index < graphics.pixels.length; index += 1) {
      const color = colors[graphics.pixels[index] ?? 0] ?? 0;
      pixels.data[index * 4] = color >> 16;
      pixels.data[index * 4 + 1] = (color >> 8) & 255;
      pixels.data[index * 4 + 2] = color & 255;
      pixels.data[index * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  }, [graphics, isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <div {...stylex.props(styles.overlay)} data-testid="program-graphics-screen">
      <canvas
        ref={canvasRef}
        {...stylex.props(styles.canvas)}
        width={graphics?.width ?? width}
        height={graphics?.height ?? height}
      />
      <div {...stylex.props(styles.hint)}>{waiting ? `Input: ${input}  [Enter submits; Ctrl+F2 stops]` : 'Press Esc to return to IDE'}</div>
    </div>
  );
}

// Graphics API for use by the Pascal runtime
export interface GraphicsAPI {
  setPixel: (x: number, y: number, color: number) => void;
  getPixel: (x: number, y: number) => number;
  line: (x1: number, y1: number, x2: number, y2: number, color: number) => void;
  rectangle: (x1: number, y1: number, x2: number, y2: number, color: number) => void;
  fillRectangle: (x1: number, y1: number, x2: number, y2: number, color: number) => void;
  circle: (x: number, y: number, radius: number, color: number) => void;
  fillCircle: (x: number, y: number, radius: number, color: number) => void;
  clear: (color?: number) => void;
  setColor: (color: number) => void;
  setBgColor: (color: number) => void;
}

export function createGraphicsAPI(canvas: HTMLCanvasElement): GraphicsAPI {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context');
  }

  let _currentColor = 15; // White
  let bgColor = 0; // Black

  const getColorHex = (color: number): string => {
    return EGA_PALETTE[color % 16] ?? EGA_PALETTE[0]!;
  };

  return {
    setPixel(x, y, color) {
      ctx.fillStyle = getColorHex(color);
      ctx.fillRect(x, y, 1, 1);
    },

    getPixel(x, y) {
      const data = ctx.getImageData(x, y, 1, 1).data;
      // Find closest EGA color
      const r = data[0] ?? 0;
      const g = data[1] ?? 0;
      const b = data[2] ?? 0;
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
      return EGA_PALETTE.indexOf(hex);
    },

    line(x1, y1, x2, y2, color) {
      ctx.strokeStyle = getColorHex(color);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },

    rectangle(x1, y1, x2, y2, color) {
      ctx.strokeStyle = getColorHex(color);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    },

    fillRectangle(x1, y1, x2, y2, color) {
      ctx.fillStyle = getColorHex(color);
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    },

    circle(x, y, radius, color) {
      ctx.strokeStyle = getColorHex(color);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
    },

    fillCircle(x, y, radius, color) {
      ctx.fillStyle = getColorHex(color);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    },

    clear(color = bgColor) {
      ctx.fillStyle = getColorHex(color);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    },

    setColor(color) {
      _currentColor = color;
    },

    setBgColor(color) {
      bgColor = color;
    },
  };
}

export { EGA_PALETTE };
