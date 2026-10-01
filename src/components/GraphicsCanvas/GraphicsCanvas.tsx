import { useEffect, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { dosColors } from '../../styles/tokens.stylex';
import { useProgramScreenStore } from '@stores/programScreenStore';
import { EGA_PALETTE } from './graphicsApi';

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
  // Every mode fills a 4:3 monitor, so the CGA's 320x200 and 640x200
  // screens stretch as they did on one.
  canvas: {
    imageRendering: 'pixelated',
    backgroundColor: dosColors.black,
    width: 'min(100vw, calc(100vh * 4 / 3))',
    height: 'auto',
    aspectRatio: '4 / 3',
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
    const colors =
      graphics.colors ?? EGA_PALETTE.map((color) => Number.parseInt(color.slice(1), 16));
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
      <div {...stylex.props(styles.hint)}>
        {waiting ? `Input: ${input}  [Enter submits; Ctrl+F2 stops]` : 'Press Esc to return to IDE'}
      </div>
    </div>
  );
}
