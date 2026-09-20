import type { Ide } from '../ide';
import type { Ignore } from './grid';

/**
 * Each state drives the IDE into the situation one reference screenshot of
 * ui.codexpanse.com/turbo-pascal-71.html shows. `ignore` masks what is content
 * rather than chrome: file lists, typed values, program output.
 */
export interface FidelityState {
  name: string;
  ref: string;
  drive: (ide: Ide) => Promise<void>;
  ignore?: Ignore[];
  /** Mismatched cells tolerated, for known and explained differences. */
  budget?: number;
}

const squareView = async (ide: Ide) => {
  await ide.press('Alt+F3');
  await ide.openFile('SQUARE.PAS');
  await ide.markModified();
};

const helloView = async (ide: Ide, line = 4, col = 12) => {
  await ide.press('Alt+F3');
  await ide.openFile('HELLO.PAS');
  await ide.markModified();
  await ide.moveTo(line, col);
};

const menuPath = async (ide: Ide, menu: string, ...items: string[]) => {
  await ide.openMenu(menu);
  for (const item of items) await ide.press(item);
};

/** File names in titles differ from the references; only their colour matters. */
const TITLE: Ignore = { x: 20, y: 1, w: 40, h: 1, mode: 'text' };

export const STATES: FidelityState[] = [
  {
    name: 'main-view',
    ref: 'Normal-view',
    drive: async (ide) => {
      await squareView(ide);
      await ide.moveTo(12, 32);
    },
    ignore: [TITLE],
  },
  ...(
    [
      ['file', 'F'],
      ['edit', 'E'],
      ['search', 'S'],
      ['run', 'R'],
      ['compile', 'C'],
      ['debug', 'D'],
      ['tools', 'T'],
      ['options', 'O'],
      ['window', 'W'],
      ['help', 'H'],
    ] as const
  ).map(
    ([name, key]): FidelityState => ({
      name: `menu-${name}`,
      ref: `Context-menu-${name[0]!.toUpperCase()}${name.slice(1)}`,
      drive: (ide) => ide.openMenu(key),
      ignore: [TITLE],
    })
  ),
  {
    name: 'menu-options-environment',
    ref: 'Context-menu-Options-Environment',
    drive: async (ide) => {
      await squareView(ide);
      await ide.openMenu('O');
      for (let i = 0; i < 6; i += 1) await ide.press('ArrowDown');
      await ide.press('ArrowRight');
    },
    ignore: [TITLE],
  },
  {
    name: 'about',
    ref: 'About',
    drive: (ide) => menuPath(ide, 'H', 'a'),
    // The gallery's status hint contains a machine-specific "CD Not Found"
    // startup error. Keep checking the bar colour without reproducing it.
    ignore: [TITLE, { x: 11, y: 24, w: 68, h: 1, mode: 'text' }],
  },
  {
    name: 'open-file',
    ref: 'Open-a-File',
    drive: (ide) => ide.press('F3'),
    ignore: [
      TITLE,
      { x: 18, y: 9, w: 31, h: 8, mode: 'text' },
      { x: 16, y: 19, w: 47, h: 2, mode: 'text' },
    ],
  },
  {
    name: 'save-as',
    ref: 'Save-File-As',
    drive: async (ide) => {
      await menuPath(ide, 'F', 'a');
      // The gallery has a blank filename field rather than the selected default.
      await ide.press('Backspace');
    },
    ignore: [
      TITLE,
      { x: 18, y: 9, w: 31, h: 8, mode: 'text' },
      { x: 16, y: 19, w: 47, h: 2, mode: 'text' },
    ],
  },
  {
    name: 'change-dir',
    ref: 'Change-Directory',
    drive: (ide) => menuPath(ide, 'F', 'c'),
    // Tree entries describe the original DOS drive, rather than this virtual disk.
    ignore: [TITLE, { x: 19, y: 10, w: 29, h: 9, mode: 'text' }],
  },
  {
    name: 'find',
    ref: 'Find',
    drive: async (ide) => {
      await helloView(ide);
      await menuPath(ide, 'S', 'f');
    },
    ignore: [TITLE],
  },
  {
    name: 'replace',
    ref: 'Replace',
    drive: async (ide) => {
      await helloView(ide);
      await menuPath(ide, 'S', 'r');
    },
    ignore: [TITLE],
  },
  {
    name: 'goto-line',
    ref: 'Go-to-Line-Number',
    drive: async (ide) => {
      await helloView(ide);
      await menuPath(ide, 'S', 'g');
    },
    ignore: [TITLE],
  },
  {
    name: 'search-not-found',
    ref: 'Error-Search-string-not-found',
    drive: async (ide) => {
      await helloView(ide);
      await menuPath(ide, 'S', 'f');
      await ide.type('zzz');
      await ide.press('Enter');
    },
    ignore: [TITLE],
  },
  {
    name: 'program-parameters',
    ref: 'Program-Parameters',
    drive: async (ide) => {
      await helloView(ide, 2, 1);
      await menuPath(ide, 'R', 'a');
    },
    ignore: [TITLE],
  },
  {
    name: 'information',
    ref: 'Information',
    drive: async (ide) => {
      await helloView(ide, 2, 1);
      await menuPath(ide, 'C', 'i');
    },
    ignore: [TITLE, { x: 15, y: 7, w: 50, h: 11, mode: 'text' }],
  },
  {
    name: 'breakpoints',
    ref: 'Breakpoints-list-empty',
    drive: async (ide) => {
      await helloView(ide, 2, 2);
      await menuPath(ide, 'D', 'b');
    },
    ignore: [TITLE],
  },
  {
    name: 'compiler-options',
    ref: 'Compiler-Options',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'c');
    },
    ignore: [TITLE],
  },
  {
    name: 'memory-sizes',
    ref: 'Memory-Sizes',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'm');
    },
    ignore: [TITLE],
  },
  {
    name: 'linker',
    ref: 'Linker',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'l');
    },
    ignore: [TITLE],
  },
  {
    name: 'debugger',
    ref: 'Debugger',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'b');
    },
    ignore: [TITLE],
  },
  {
    name: 'directories',
    ref: 'Directories',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'd');
    },
    ignore: [TITLE],
  },
  {
    name: 'tools',
    ref: 'Tools',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 't');
    },
    ignore: [TITLE],
  },
  {
    name: 'preferences',
    ref: 'Preferences',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'e', 'p');
    },
    ignore: [TITLE],
  },
  {
    name: 'editor-options',
    ref: 'Editor-options',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'e', 'e');
    },
    ignore: [TITLE],
  },
  {
    name: 'mouse-options',
    ref: 'Mouse-options',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'e', 'm');
    },
    ignore: [TITLE],
  },
  {
    name: 'startup-options',
    ref: 'Startup-options',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'e', 's');
    },
    ignore: [TITLE],
  },
  {
    name: 'colors',
    ref: 'Colors',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'O', 'e', 'c');
    },
    ignore: [TITLE],
  },
  {
    name: 'add-watch',
    ref: 'Add-Watch',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'D', 'a');
      await ide.type('Res');
    },
    ignore: [TITLE],
  },
  {
    name: 'window-list',
    ref: 'Windows-List',
    drive: async (ide) => {
      await ide.press('Alt+F3');
      await menuPath(ide, 'W', 'l');
    },
  },
  {
    name: 'help-contents',
    ref: 'Help-contents',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'H', 'c');
    },
    ignore: [TITLE],
  },
  {
    name: 'output-window',
    ref: 'Output',
    drive: async (ide) => {
      await squareView(ide);
      await menuPath(ide, 'D', 'o');
    },
    ignore: [TITLE, { x: 1, y: 18, w: 78, h: 5, mode: 'text' }],
  },
  {
    name: 'watches-window',
    ref: 'Watches',
    drive: async (ide) => {
      await squareView(ide);
      // Reach a real paused VM state at the caller's WriteLn after Square returns.
      await ide.moveTo(14, 1);
      await ide.press('F4');
      await ide.waitForDialog('Compiling');
      await ide.press('Enter');
      await ide.page.waitForTimeout(150);
      await menuPath(ide, 'D', 'a');
      await ide.type('Res');
      await ide.press('Enter');
      await ide.clickCell(2, 19);
    },
    ignore: [TITLE, { x: 1, y: 18, w: 78, h: 5, mode: 'text' }],
  },
  {
    name: 'call-stack-window',
    ref: 'Call-stack',
    drive: async (ide) => {
      await squareView(ide);
      // Pause inside Square so the stack is backed by real procedure frames.
      await ide.moveTo(6, 1);
      await ide.press('F4');
      await ide.waitForDialog('Compiling');
      await ide.press('Enter');
      await ide.page.waitForTimeout(150);
      await ide.press('Control+F3');
    },
    ignore: [TITLE, { x: 1, y: 18, w: 78, h: 5, mode: 'text' }],
  },
  {
    name: 'messages-window',
    ref: 'Messages',
    drive: async (ide) => {
      await squareView(ide);
      // Populate the list through the real Grep action shown in the gallery.
      await ide.press('Shift+F2');
      await ide.waitForDialog('Program Arguments');
      await ide.press('Enter');
      await ide.waitForText('Grep: program');
      await ide.clickCell(2, 18);
    },
    ignore: [TITLE, { x: 1, y: 18, w: 78, h: 5, mode: 'text' }],
  },
  {
    name: 'two-panes',
    ref: 'Two-panes-two-files',
    drive: async (ide) => {
      await ide.press('Alt+F3');
      await ide.openFile('HELLO.PAS');
      await menuPath(ide, 'F', 'n');
      await ide.type('program Another;');
      await ide.press('Enter');
      await menuPath(ide, 'W', 't');
    },
    ignore: [TITLE, { x: 20, y: 12, w: 40, h: 1, mode: 'text' }],
  },
];
