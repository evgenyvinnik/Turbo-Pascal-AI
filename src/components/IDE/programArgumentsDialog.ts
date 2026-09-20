import type { DialogDef } from '@components/Dialogs/types';

/** Grep's original Program Arguments prompt. */
export const programArgumentsDialog = (): DialogDef => ({
  id: 'program-arguments',
  title: 'Program Arguments',
  rect: { x: 10, y: 8, w: 60, h: 8 },
  controls: [
    { kind: 'label', x: 3, y: 2, text: '~E~nter program argument', for: 'args' },
    {
      kind: 'input',
      id: 'args',
      x: 3,
      y: 3,
      w: 51,
      hint: 'Enter pattern and file masks; -i ignores case, -v inverts matches',
    },
    {
      kind: 'button',
      id: 'ok',
      x: 25,
      y: 5,
      w: 8,
      label: 'O~K~',
      result: 'ok',
      default: true,
      hint: 'Search open, imported and bundled source files',
    },
    {
      kind: 'button',
      id: 'cancel',
      x: 37,
      y: 5,
      w: 8,
      label: 'Cancel',
      result: 'cancel',
      hint: 'Close without searching',
    },
    {
      kind: 'button',
      id: 'help',
      x: 49,
      y: 5,
      w: 8,
      label: 'Help',
      result: 'help',
      hint: 'Show help for Grep arguments',
    },
  ],
});
