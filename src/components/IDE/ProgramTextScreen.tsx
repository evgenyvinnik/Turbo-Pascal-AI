import { useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Screen } from '@/tui/Screen';
import { TextScreen, type CellEvent } from '@/tui/TextScreen';
import { programMouse, useProgramScreenStore } from '@stores/programScreenStore';

const styles = stylex.create({ root: { position: 'absolute', inset: 0 } });

/** The program's CRT video memory rendered using the same VGA font as the IDE. */
export function ProgramTextScreen() {
  const console = useProgramScreenStore((state) => state.console);
  const input = useProgramScreenStore((state) => state.input);
  const mouse = useProgramScreenStore((state) => state.mouse);
  const screen = useMemo(() => {
    if (!console) return new Screen();
    const result = new Screen(console.cols, console.rows);
    // The mouse driver's text cursor: the cell under it in its colors XORed
    // with 77h.
    const under = mouse ? mouse.y * console.cols + mouse.x : -1;
    for (let index = 0; index < console.chars.length; index += 1) {
      const attr = (console.attributes[index] ?? 7) ^ (index === under ? 0x77 : 0);
      result.put(
        index % console.cols,
        Math.floor(index / console.cols),
        console.chars[index] ?? ' ',
        { fg: attr & 15, bg: (attr >> 4) & 7 }
      );
    }
    result.write(console.x, console.y, input, {
      fg: console.attribute & 15,
      bg: (console.attribute >> 4) & 7,
    });
    return result;
  }, [console, input, mouse]);
  const cols = console?.cols ?? 80,
    rows = console?.rows ?? 25;
  const pointer = (kind: 'down' | 'move' | 'up') => (event: CellEvent) => {
    programMouse((event.col + 0.5) / cols, (event.row + 0.5) / rows, kind, event.button);
  };
  return (
    <div {...stylex.props(styles.root)} data-testid="program-text-screen">
      <TextScreen
        screen={screen}
        onCellDown={pointer('down')}
        onCellMove={pointer('move')}
        onCellUp={pointer('up')}
        cursor={
          console?.cursorVisible
            ? {
                col: Math.min(console.cols - 1, console.x + input.length),
                row: console.y,
                visible: true,
              }
            : null
        }
      />
    </div>
  );
}
