import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { VGA_PALETTE } from './palette';
import type { Screen } from './Screen';

/** Nominal VGA text mode cell, 720x400 for the full 80x25 screen. */
export const CELL_W = 9;
export const CELL_H = 16;

export const MONO_STACK =
  '"Px437 IBM VGA 8x16", "Perfect DOS VGA 437", "IBM Plex Mono", "DejaVu Sans Mono", Consolas, Menlo, "Courier New", monospace';

export interface CellEvent {
  col: number;
  row: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface CursorState {
  col: number;
  row: number;
  visible: boolean;
  /** Overwrite mode shows the fat half-height block. */
  fat?: boolean;
}

export interface TextScreenProps {
  screen: Screen;
  cursor?: CursorState | null;
  onCellDown?: (e: CellEvent) => void;
  onCellMove?: (e: CellEvent) => void;
  onCellUp?: (e: CellEvent) => void;
  onCellDoubleClick?: (e: CellEvent) => void;
  onWheel?: (e: CellEvent & { deltaY: number }) => void;
}

const styles = stylex.create({
  viewport: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#000000',
    userSelect: 'none',
    cursor: 'default',
  },
  screen: {
    position: 'relative',
    fontVariantLigatures: 'none',
    fontKerning: 'none',
    whiteSpace: 'pre',
    textRendering: 'geometricPrecision',
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  run: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    whiteSpace: 'pre',
  },
  cursor: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    mixBlendMode: 'difference',
    pointerEvents: 'none',
    animationName: 'tpBlink',
    animationDuration: '1s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'steps(1, end)',
  },
});

/** Advance width of the resolved monospace font, in em. */
function measureAdvanceRatio(): number {
  if (typeof document === 'undefined') return 0.6;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0.6;
  ctx.font = `100px ${MONO_STACK}`;
  const w = ctx.measureText('M'.repeat(50)).width / 50;
  return w > 0 ? w / 100 : 0.6;
}

export function TextScreen({
  screen,
  cursor,
  onCellDown,
  onCellMove,
  onCellUp,
  onCellDoubleClick,
  onWheel,
}: TextScreenProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const ratioRef = useRef<number>(0.6);

  useLayoutEffect(() => {
    ratioRef.current = measureAdvanceRatio();
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const update = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const next = Math.min(width / (screen.cols * CELL_W), height / (screen.rows * CELL_H));
      setScale(next > 0 ? next : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => { ro.disconnect(); };
  }, [screen.cols, screen.rows]);

  const cellW = CELL_W * scale;
  const cellH = CELL_H * scale;
  const fontSize = cellW / ratioRef.current;

  const toCell = useCallback(
    (clientX: number, clientY: number) => {
      const host = hostRef.current;
      if (!host) return { col: 0, row: 0 };
      const rect = host.getBoundingClientRect();
      const originX = rect.left + (rect.width - screen.cols * cellW) / 2;
      const originY = rect.top + (rect.height - screen.rows * cellH) / 2;
      const col = Math.floor((clientX - originX) / cellW);
      const row = Math.floor((clientY - originY) / cellH);
      return {
        col: Math.max(0, Math.min(screen.cols - 1, col)),
        row: Math.max(0, Math.min(screen.rows - 1, row)),
      };
    },
    [cellW, cellH, screen.cols, screen.rows],
  );

  const wrap = useCallback(
    (handler?: (e: CellEvent) => void) => (ev: React.MouseEvent) => {
      if (!handler) return;
      ev.preventDefault();
      const { col, row } = toCell(ev.clientX, ev.clientY);
      handler({
        col,
        row,
        button: ev.button,
        shift: ev.shiftKey,
        ctrl: ev.ctrlKey || ev.metaKey,
        alt: ev.altKey,
      });
    },
    [toCell],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const id = 'tp-blink-keyframes';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = '@keyframes tpBlink{0%,50%{opacity:1}50.01%,100%{opacity:0}}';
      document.head.appendChild(style);
    }
    return undefined;
  }, []);

  const runs = useMemo(() => screen.toRuns(), [screen]);

  return (
    <div
      {...stylex.props(styles.viewport)}
      ref={hostRef}
      onMouseDown={wrap(onCellDown)}
      onMouseMove={wrap(onCellMove)}
      onMouseUp={wrap(onCellUp)}
      onDoubleClick={wrap(onCellDoubleClick)}
      onWheel={(ev) => {
        if (!onWheel) return;
        const { col, row } = toCell(ev.clientX, ev.clientY);
        onWheel({
          col,
          row,
          button: 0,
          shift: ev.shiftKey,
          ctrl: ev.ctrlKey || ev.metaKey,
          alt: ev.altKey,
          deltaY: ev.deltaY,
        });
      }}
      data-testid="tp-screen"
    >
      <div
        {...stylex.props(styles.screen)}
        style={{
          width: screen.cols * cellW,
          height: screen.rows * cellH,
          fontFamily: MONO_STACK,
          fontSize: `${String(fontSize)}px`,
          lineHeight: `${String(cellH)}px`,
        }}
      >
        {runs.map((row, y) => {
          const top = Math.round(y * cellH);
          return (
            <div
              key={y}
              {...stylex.props(styles.row)}
              data-row={y}
              style={{ top, height: Math.round((y + 1) * cellH) - top }}
            >
              {row.map((run) => {
                const left = Math.round(run.x * cellW);
                return (
                  <span
                    key={run.x}
                    {...stylex.props(styles.run)}
                    style={{
                      left,
                      width: Math.round((run.x + run.text.length) * cellW) - left,
                      color: VGA_PALETTE[run.fg],
                      backgroundColor: VGA_PALETTE[run.bg],
                    }}
                  >
                    {run.text}
                  </span>
                );
              })}
            </div>
          );
        })}
        {cursor?.visible && (
          <div
            {...stylex.props(styles.cursor)}
            style={{
              left: cursor.col * cellW,
              top: cursor.row * cellH + (cursor.fat ? cellH * 0.5 : cellH * 0.8),
              width: cellW,
              height: cursor.fat ? cellH * 0.5 : cellH * 0.2,
            }}
          />
        )}
      </div>
    </div>
  );
}
