import { C } from '@/tui/palette';
import type { ButtonControl, ClusterItem, Control, DialogDef } from './types';

/**
 * Dialog layouts transcribed cell by cell from the Turbo Pascal 7.1 reference
 * screenshots. Coordinates are relative to the dialog frame; button `x`/`w`
 * describe the green face.
 */

const btn = (
  id: string,
  x: number,
  y: number,
  w: number,
  label: string,
  hint: string,
  opts: { result?: string; default?: boolean; disabled?: boolean } = {},
): ButtonControl => ({
  kind: 'button',
  id,
  x,
  y,
  w,
  label,
  result: opts.result ?? id,
  hint,
  ...(opts.default ? { default: true } : {}),
  ...(opts.disabled ? { disabled: true } : {}),
});

const label = (x: number, y: number, text: string, target: string): Control => ({
  kind: 'label',
  x,
  y,
  text,
  for: target,
});

const text = (x: number, y: number, value: string): Control => ({ kind: 'static', x, y, text: value });

const items = (...labels: string[]): ClusterItem[] => labels.map((l) => ({ label: l }));

const OK_HINT = 'Accept the settings in this dialog box';
const CANCEL_HINT = 'Close the dialog box without making any changes';
const HELP_HINT = 'Show help about using this dialog box';

export const printerSetupDialog = (): DialogDef => ({
  id: 'printer-setup', title: 'Printer Setup', rect: { x: 18, y: 6, w: 43, h: 13 },
  controls: [
    label(3, 2, '~F~ilter path', 'filter'),
    { kind: 'input', id: 'filter', x: 3, y: 3, w: 37, history: false, hint: 'Enter path and filename of printer filter/driver' },
    label(3, 5, '~C~ommand line', 'command'),
    { kind: 'input', id: 'command', x: 3, y: 6, w: 37, history: false, hint: 'Enter command line for printer filter/driver' },
    { kind: 'checks', id: 'highlight', x: 3, y: 8, w: 37, items: items('~S~end highlighting escape codes'), hint: 'Print source text with highlighting' },
    btn('ok', 7, 10, 8, '~O~K', OK_HINT, { default: true }),
    btn('cancel', 19, 10, 8, 'Cancel', CANCEL_HINT),
    btn('help', 31, 10, 8, 'Help', HELP_HINT),
  ],
});

/** OK, Cancel and Help in one row, eight cells wide and `gap` apart. */
const okCancelHelp = (x: number, y: number, step: number, okLabel = 'O~K~'): Control[] => [
  btn('ok', x, y, 8, okLabel, OK_HINT, { default: true }),
  btn('cancel', x + step, y, 8, 'Cancel', CANCEL_HINT),
  btn('help', x + step * 2, y, 8, 'Help', HELP_HINT),
];

export const findDialog = (): DialogDef => ({
  id: 'find',
  title: 'Find',
  rect: { x: 12, y: 4, w: 55, h: 16 },
  controls: [
    label(3, 2, '~T~ext to find', 'text'),
    { kind: 'input', id: 'text', x: 16, y: 2, w: 33, hint: 'Enter literal text or regular expression to search for' },
    label(3, 4, 'Options', 'options'),
    {
      kind: 'checks',
      id: 'options',
      x: 3,
      y: 5,
      w: 24,
      hint: 'Set the options that control the search',
      items: items('~C~ase sensitive', '~W~hole words only', '~R~egular expression'),
    },
    label(30, 4, 'Direction', 'direction'),
    {
      kind: 'radios',
      id: 'direction',
      x: 30,
      y: 5,
      w: 22,
      hint: 'Choose the direction of the search',
      items: items('Forwar~d~', '~B~ackward'),
    },
    label(3, 9, 'Scope', 'scope'),
    { kind: 'radios', id: 'scope', x: 3, y: 10, w: 24, hint: 'Choose the part of the file to search', items: items('~G~lobal', '~S~elected text') },
    label(30, 9, 'Origin', 'origin'),
    { kind: 'radios', id: 'origin', x: 30, y: 10, w: 22, hint: 'Choose where the search starts', items: items('~F~rom cursor', '~E~ntire scope') },
    ...okCancelHelp(19, 13, 12),
  ],
});

export const replaceDialog = (): DialogDef => ({
  id: 'replace',
  title: 'Replace',
  rect: { x: 12, y: 3, w: 55, h: 19 },
  controls: [
    label(3, 2, '~T~ext to find', 'text'),
    { kind: 'input', id: 'text', x: 16, y: 2, w: 33, hint: 'Enter literal text or regular expression to search for' },
    label(7, 4, '~N~ew text', 'replacement'),
    { kind: 'input', id: 'replacement', x: 16, y: 4, w: 33, hint: 'Enter the text to replace the search string with' },
    label(3, 6, 'Options', 'options'),
    {
      kind: 'checks',
      id: 'options',
      x: 3,
      y: 7,
      w: 24,
      hint: 'Set the options that control the search',
      items: items('~C~ase sensitive', '~W~hole words only', '~R~egular expression', '~P~rompt on replace'),
    },
    label(30, 6, 'Direction', 'direction'),
    { kind: 'radios', id: 'direction', x: 30, y: 7, w: 22, hint: 'Choose the direction of the search', items: items('Forwar~d~', '~B~ackward') },
    label(3, 12, 'Scope', 'scope'),
    { kind: 'radios', id: 'scope', x: 3, y: 13, w: 24, hint: 'Choose the part of the file to search', items: items('~G~lobal', '~S~elected text') },
    label(30, 12, 'Origin', 'origin'),
    { kind: 'radios', id: 'origin', x: 30, y: 13, w: 22, hint: 'Choose where the search starts', items: items('~F~rom cursor', '~E~ntire scope') },
    btn('ok', 3, 16, 8, 'O~K~', OK_HINT, { default: true }),
    btn('all', 15, 16, 12, 'Change ~a~ll', 'Replace every occurrence of the search string'),
    btn('cancel', 31, 16, 8, 'Cancel', CANCEL_HINT),
    btn('help', 43, 16, 8, 'Help', HELP_HINT),
  ],
});

export const gotoLineDialog = (): DialogDef => ({
  id: 'goto',
  title: 'Go to Line Number',
  rect: { x: 20, y: 9, w: 39, h: 7 },
  controls: [
    label(3, 2, '~E~nter new line number', 'line'),
    { kind: 'input', id: 'line', x: 25, y: 2, w: 8, hint: 'Move cursor to specified line number in file' },
    ...okCancelHelp(3, 4, 12),
  ],
});

export const addWatchDialog = (): DialogDef => ({
  id: 'addwatch',
  title: 'Add Watch',
  rect: { x: 11, y: 8, w: 57, h: 9 },
  controls: [
    label(3, 2, '~W~atch expression', 'expr'),
    { kind: 'input', id: 'expr', x: 3, y: 3, w: 47, hint: 'Enter expression to add as watch' },
    ...okCancelHelp(23, 5, 11),
  ],
});

export const aboutDialog = (): DialogDef => ({
  id: 'about',
  title: 'About',
  rect: { x: 21, y: 6, w: 37, h: 13 },
  controls: [
    text(12, 2, 'Turbo Pascal'),
    text(12, 4, 'Version 7.1'),
    text(6, 6, 'Copyright (c) 1983,97 by'),
    text(5, 8, 'Borland International, Inc.'),
    btn('ok', 14, 10, 8, 'O~K~', OK_HINT, { default: true }),
  ],
});

const fileList = (id: string, items: string[], hint: string): Control => ({
  kind: 'list',
  id,
  x: 3,
  y: 6,
  w: 31,
  h: 9,
  items,
  hint,
  scroll: 'h',
  divider: 15,
});

export const openFileDialog = (files: string[], info: string[]): DialogDef => ({
  id: 'open',
  title: 'Open a File',
  rect: { x: 15, y: 3, w: 49, h: 19 },
  controls: [
    label(3, 2, '~N~ame', 'name'),
    { kind: 'input', id: 'name', x: 3, y: 3, w: 28, hint: 'Enter directory path and file mask' },
    label(3, 5, '~F~iles', 'files'),
    fileList('files', files, 'Select a file to open'),
    btn('open', 36, 3, 9, '~O~pen', 'Open the selected file in a new Edit window', { default: true }),
    btn('replace', 36, 6, 9, '~R~eplace', 'Replace the file in the active Edit window'),
    btn('cancel', 36, 11, 9, 'Cancel', CANCEL_HINT),
    btn('help', 36, 14, 9, 'Help', HELP_HINT),
    { kind: 'info', x: 1, y: 16, w: 47, h: 2, lines: info },
  ],
});

export const primaryFileDialog = (files: string[], info: string[]): DialogDef => ({
  ...openFileDialog(files, info), id: 'primary', title: 'Primary File',
  controls: [
    label(3, 2, '~P~rimary program file', 'name'),
    { kind: 'input', id: 'name', x: 3, y: 3, w: 28, hint: 'Enter directory path and file mask' },
    label(3, 5, '~F~iles', 'files'), fileList('files', files, 'Select the primary program file'),
    btn('ok', 36, 3, 9, 'O~K~', OK_HINT, { default: true }),
    btn('clear', 36, 6, 9, 'C~l~ear', 'Clear the primary program file'),
    btn('cancel', 36, 11, 9, 'Cancel', CANCEL_HINT), btn('help', 36, 14, 9, 'Help', HELP_HINT),
    { kind: 'info', x: 1, y: 16, w: 47, h: 2, lines: info },
  ],
});

export const findProcedureDialog = (): DialogDef => ({
  id: 'findproc', title: 'Find Procedure', rect: { x: 22, y: 8, w: 36, h: 8 },
  controls: [label(3, 2, '~P~rocedure name', 'name'),
    { kind: 'input', id: 'name', x: 3, y: 3, w: 27, hint: 'Enter name of procedure or function to locate' },
    ...okCancelHelp(3, 5, 11)],
});

export const findErrorDialog = (): DialogDef => ({
  id: 'finderror', title: 'Find Error', rect: { x: 22, y: 9, w: 36, h: 7 },
  controls: [label(3, 2, '~E~rror address', 'address'),
    { kind: 'input', id: 'address', x: 17, y: 2, w: 13, hint: 'Find source location corresponding to error address' },
    ...okCancelHelp(3, 4, 11)],
});

export const saveAsDialog = (files: string[], info: string[]): DialogDef => ({
  id: 'saveas',
  title: 'Save File As',
  rect: { x: 15, y: 3, w: 49, h: 19 },
  controls: [
    label(3, 2, '~S~ave file as', 'name'),
    { kind: 'input', id: 'name', x: 3, y: 3, w: 28, hint: 'Enter directory path and file mask' },
    label(3, 5, '~F~iles', 'files'),
    fileList('files', files, 'Files in the current directory'),
    btn('ok', 36, 3, 9, 'O~K~', OK_HINT, { default: true }),
    btn('cancel', 36, 11, 9, 'Cancel', CANCEL_HINT),
    btn('help', 36, 14, 9, 'Help', HELP_HINT),
    { kind: 'info', x: 1, y: 16, w: 47, h: 2, lines: info },
  ],
});

export const optionsFileDialog = (save: boolean, files: string[]): DialogDef => ({
  ...saveAsDialog(files, ['C:\\TPASCAL\\*.TP', '..           Directory Aug  1, 2017   6:23pm']),
  id: save ? 'save-options' : 'open-options', title: save ? 'Save Options As' : 'Open Options',
  controls: [
    label(3, 2, '~O~ptions file name', 'name'),
    { kind: 'input', id: 'name', x: 3, y: 3, w: 28, hint: `Specify disk file name for ${save ? 'saving' : 'loading'} configuration options` },
    label(3, 5, '~F~iles', 'files'), fileList('files', files, 'Select an options configuration file'),
    btn('ok', 36, 3, 9, 'O~K~', OK_HINT, { default: true }),
    btn('cancel', 36, 11, 9, 'Cancel', CANCEL_HINT), btn('help', 36, 14, 9, 'Help', HELP_HINT),
    { kind: 'info', x: 1, y: 16, w: 47, h: 2, lines: ['C:\\TPASCAL\\*.TP', '..           Directory Aug  1, 2017   6:23pm'], attr: { fg: C.Cyan, bg: C.Blue } },
  ],
});

export const changeDirDialog = (tree: string[], selected: number): DialogDef => ({
  id: 'chdir',
  title: 'Change Directory',
  rect: { x: 16, y: 4, w: 48, h: 17 },
  controls: [
    label(3, 2, 'Directory ~n~ame', 'dir'),
    { kind: 'input', id: 'dir', x: 3, y: 3, w: 27, hint: 'Enter drive and/or directory path' },
    label(3, 5, 'Directory ~t~ree', 'tree'),
    { kind: 'list', id: 'tree', x: 3, y: 6, w: 30, h: 9, items: tree, hint: 'Use cursor keys to navigate the directory tree', scroll: 'v' },
    btn('ok', 36, 5, 8, 'O~K~', OK_HINT, { default: true }),
    btn('chdir', 36, 8, 8, '~C~hdir', 'Change to the selected directory'),
    btn('revert', 36, 11, 8, '~R~evert', 'Return to the directory that was current'),
    btn('help', 36, 14, 8, '~H~elp', HELP_HINT),
  ],
  ...(selected >= 0 ? {} : {}),
});

export const windowListDialog = (windows: string[]): DialogDef => ({
  id: 'windowlist',
  title: 'Window List',
  focus: windows.length ? 'windows' : 'delete',
  rect: { x: 14, y: 5, w: 52, h: 15 },
  controls: [
    label(3, 2, '~W~indows', 'windows'),
    { kind: 'list', id: 'windows', x: 3, y: 3, w: 37, h: 10, items: windows, hint: 'Use cursor keys to examine windows in window list', scroll: 'v' },
    btn('ok', 41, 3, 8, 'O~K~', 'Make the selected window active', { default: true }),
    btn('delete', 41, 6, 8, '~D~elete', 'Remove the selected entry from the window list'),
    btn('cancel', 41, 9, 8, 'Cancel', CANCEL_HINT),
    btn('help', 41, 12, 8, 'Help', HELP_HINT),
  ],
});

export const compilerOptionsDialog = (): DialogDef => ({
  id: 'compileropts',
  title: 'Compiler Options',
  rect: { x: 10, y: 1, w: 60, h: 23 },
  controls: [
    label(3, 2, 'Code generation', 'codegen'),
    {
      kind: 'checks',
      id: 'codegen',
      x: 3,
      y: 3,
      w: 54,
      columns: 2,
      colWidth: 27,
      hint: 'Set code generation options',
      items: [
        { label: '~F~orce far calls', hint: 'Force all procedures and functions to use far call model' },
        { label: '~O~verlays allowed', hint: 'Generate code that can be overlaid' },
        { label: 'Word ~a~lign data', hint: 'Align data on word boundaries' },
        { label: '~2~86 instructions', hint: 'Generate 80286 instructions' },
      ],
    },
    label(3, 6, 'Runtime errors', 'runtime'),
    {
      kind: 'checks',
      id: 'runtime',
      x: 3,
      y: 7,
      w: 24,
      hint: 'Generate code that checks for runtime errors',
      items: items('~R~ange checking', '~S~tack checking', '~I~/O checking', 'Overflow ~c~hecking'),
    },
    label(30, 6, 'Syntax options', 'syntax'),
    {
      kind: 'checks',
      id: 'syntax',
      x: 30,
      y: 7,
      w: 27,
      hint: 'Set the syntax the compiler accepts',
      items: items('Strict ~v~ar-strings', 'Complete ~b~oolean eval', 'E~x~tended syntax', '~T~yped @ operator', 'Open ~p~arameters'),
    },
    label(3, 12, 'Debugging', 'debugging'),
    { kind: 'checks', id: 'debugging', x: 3, y: 13, w: 24, hint: 'Generate information for the debugger', items: items('~D~ebug information', '~L~ocal symbols') },
    label(30, 13, 'Numeric processing', 'numeric'),
    { kind: 'checks', id: 'numeric', x: 30, y: 14, w: 27, hint: 'Set floating point code generation', items: items('~8~087/80287', '~E~mulation') },
    label(3, 17, 'Conditio~n~al defines', 'defines'),
    { kind: 'input', id: 'defines', x: 3, y: 18, w: 51, hint: 'Enter conditional defines separated by semicolons' },
    ...okCancelHelp(25, 20, 12, 'OK'),
  ],
});

/** Right-aligns `value` so that it ends in column `end`. */
const value = (end: number, y: number, v: string): Control => text(end - v.length + 1, y, v);

export const informationDialog = (file: string, lines: number, ok: boolean): DialogDef => ({
  id: 'information',
  title: 'Information',
  rect: { x: 12, y: 4, w: 56, h: 16 },
  controls: [
    text(3, 2, '─'.repeat(11) + ' Program ' + '─'.repeat(12)),
    text(38, 2, '─'.repeat(3) + ' Memory ' + '─'.repeat(4)),
    ...(
      [
        ['Source compiled:', String(lines), 'lines'],
        ['Code size:', '22848', 'bytes'],
        ['Data size:', '704', 'bytes'],
        ['Stack size:', '16384', 'bytes'],
        ['Minimum heap size:', '0', 'bytes'],
        ['Maximum heap size:', '655360', 'bytes'],
      ] as const
    ).flatMap(([name, v, unit], i) => [text(3, 3 + i, name), value(28, 3 + i, v), text(30, 3 + i, unit)]),
    ...(
      [
        ['DOS:', '55K'],
        ['IDE:', '307K'],
        ['Symbols:', '1K'],
        ['Program:', '0K'],
        ['Free:', '276K'],
      ] as const
    ).flatMap(([name, v], i) => [text(38, 3 + i, name), value(52, 3 + i, v)]),
    text(38, 8, '─'.repeat(5) + ' EMS ' + '─'.repeat(5)),
    ...(
      [
        ['IDE:', '0K'],
        ['Other:', '0K'],
        ['Free:', '0K'],
      ] as const
    ).flatMap(([name, v], i) => [text(38, 9 + i, name), value(52, 9 + i, v)]),
    text(3, 10, `Status: ${file} ${ok ? 'terminated' : 'failed'},`),
    text(3, 11, 'exit code 0.'),
    btn('ok', 24, 13, 8, 'O~K~', 'Close this dialog box', { default: true }),
  ],
});

export const compilingDialog = (file: string, destination: string, lines: number, banner: string, accent: string): DialogDef => ({
  id: 'compiling',
  title: 'Compiling',
  rect: { x: 16, y: 7, w: 48, h: 11 },
  noClose: true,
  anyKey: true,
  controls: [
    text(3, 2, `Main file: ${file}`),
    text(3, 3, 'Done.'),
    text(3, 5, 'Destination:'),
    value(21, 5, destination),
    text(26, 5, 'Line number:'),
    value(44, 5, '0'),
    text(3, 6, 'Free memory:'),
    value(21, 6, '276K'),
    text(26, 6, 'Total lines:'),
    value(44, 6, String(lines)),
    { kind: 'bar', x: 1, y: 9, w: 46, text: banner, accent },
  ],
});

/** Turbo Vision's MessageBox: a 40x9 box with left aligned text. */
export const messageDialog = (title: string, message: string[]): DialogDef => {
  const h = Math.max(9, message.length + 6);
  return {
    id: 'message',
    title,
    rect: { x: 20, y: Math.floor((25 - h) / 2), w: 40, h },
    controls: [
      ...message.map((line, i) => text(3, 2 + i, line)),
      btn('ok', 16, h - 3, 8, 'O~K~', OK_HINT, { default: true }),
    ],
  };
};

export const memorySizesDialog = (): DialogDef => ({
  id: 'memory',
  title: 'Memory sizes',
  rect: { x: 22, y: 7, w: 36, h: 11 },
  controls: [
    label(3, 2, '~S~tack size', 'stack'),
    { kind: 'input', id: 'stack', x: 24, y: 2, w: 9, history: false, hint: "Size of your program's stack segment (between 1024 and 65520)" },
    label(3, 4, '~L~ow heap limit', 'low'),
    { kind: 'input', id: 'low', x: 24, y: 4, w: 9, history: false, hint: 'Minimum amount of heap memory your program needs' },
    label(3, 6, '~H~igh heap limit', 'high'),
    { kind: 'input', id: 'high', x: 24, y: 6, w: 9, history: false, hint: 'Maximum amount of heap memory your program may use' },
    ...okCancelHelp(3, 8, 11),
  ],
});

export const linkerDialog = (): DialogDef => ({
  id: 'linker',
  title: 'Linker',
  rect: { x: 22, y: 7, w: 36, h: 11 },
  controls: [
    label(3, 2, 'Map file', 'map'),
    {
      kind: 'radios',
      id: 'map',
      x: 3,
      y: 3,
      w: 14,
      hint: 'Choose the kind of .MAP file to generate',
      items: [
        { label: '~O~ff', hint: 'Do not generate a .MAP file' },
        { label: '~S~egments', hint: 'Generate a .MAP file listing segments' },
        { label: '~P~ublic', hint: 'Generate a .MAP file listing public symbols' },
        { label: '~D~etailed', hint: 'Generate a detailed .MAP file' },
      ],
    },
    label(21, 2, 'Link buffer', 'buffer'),
    { kind: 'radios', id: 'buffer', x: 21, y: 3, w: 12, hint: 'Choose where the linker keeps its buffer', items: items('~M~emory', 'D~i~sk') },
    ...okCancelHelp(3, 8, 11),
  ],
});

export const debuggerDialog = (): DialogDef => ({
  id: 'debugger',
  title: 'Debugger',
  rect: { x: 20, y: 7, w: 40, h: 10 },
  controls: [
    label(3, 2, 'Debugging', 'debugging'),
    {
      kind: 'checks',
      id: 'debugging',
      x: 3,
      y: 3,
      w: 16,
      hint: 'Choose the debuggers to generate information for',
      items: [
        { label: '~I~ntegrated', hint: 'Include debug info for the integrated debugger' },
        { label: '~S~tandalone', hint: 'Include debug info for Turbo Debugger' },
      ],
    },
    label(21, 2, 'Display swapping', 'swapping'),
    { kind: 'radios', id: 'swapping', x: 21, y: 3, w: 16, hint: 'Choose when to swap to the user screen', items: items('~N~one', 'S~m~art', '~A~lways') },
    ...okCancelHelp(7, 7, 11),
  ],
});

export const directoriesDialog = (): DialogDef => ({
  id: 'directories',
  title: 'Directories',
  rect: { x: 10, y: 6, w: 60, h: 13 },
  controls: [
    label(3, 2, '~E~XE & TPU directory', 'exe'),
    { kind: 'input', id: 'exe', x: 23, y: 2, w: 31, hint: 'The directory that stores your .EXE, .TPU and .MAP files' },
    label(3, 4, '~I~nclude directories', 'include'),
    { kind: 'input', id: 'include', x: 23, y: 4, w: 31, hint: 'Directories searched for include files' },
    label(3, 6, '~U~nit directories', 'unit'),
    { kind: 'input', id: 'unit', x: 23, y: 6, w: 31, hint: 'Directories searched for units' },
    label(3, 8, '~O~bject directories', 'object'),
    { kind: 'input', id: 'object', x: 23, y: 8, w: 31, hint: 'Directories searched for .OBJ files' },
    ...okCancelHelp(25, 10, 12),
  ],
});

export const programParametersDialog = (): DialogDef => ({
  id: 'params',
  title: 'Program Parameters',
  rect: { x: 12, y: 9, w: 56, h: 7 },
  controls: [
    label(3, 2, '~P~arameter', 'params'),
    { kind: 'input', id: 'params', x: 14, y: 2, w: 35, hint: 'Enter command line parameters to be passed to your program' },
    ...okCancelHelp(22, 4, 11),
  ],
});

export const evaluateDialog = (): DialogDef => ({
  id: 'evaluate',
  title: 'Evaluate and Modify',
  rect: { x: 10, y: 5, w: 59, h: 15 },
  controls: [
    label(3, 2, 'E~x~pression', 'expr'),
    { kind: 'input', id: 'expr', x: 3, y: 3, w: 35, hint: 'Enter expression to evaluate' },
    label(3, 5, '~R~esult', 'result'),
    { kind: 'input', id: 'result', x: 3, y: 6, w: 35, readOnly: true, hint: 'The value of the expression' },
    label(3, 8, '~N~ew value', 'value'),
    { kind: 'input', id: 'value', x: 3, y: 9, w: 35, hint: 'Enter a new value for the expression' },
    btn('evaluate', 44, 3, 11, '~E~valuate', 'Evaluate the expression', { default: true }),
    btn('modify', 44, 6, 11, '~M~odify', 'Assign the new value to the expression'),
    btn('cancel', 44, 9, 11, 'Cancel', CANCEL_HINT),
    btn('help', 44, 12, 11, 'Help', HELP_HINT),
  ],
});

export const breakpointsDialog = (entries: string[]): DialogDef => ({
  id: 'breakpoints',
  title: 'Breakpoints',
  rect: { x: 3, y: 5, w: 73, h: 15 },
  controls: [
    label(3, 2, '~B~reakpoint list', 'list'),
    label(27, 2, 'Line # Condition', 'list'),
    label(65, 2, 'Pass', 'list'),
    { kind: 'list', id: 'list', x: 2, y: 3, w: 69, h: 8, items: entries, hint: 'Use cursor keys to examine list of breakpoints', scroll: 'v' },
    btn('ok', 3, 12, 8, 'O~K~', OK_HINT, { default: true }),
    btn('edit', 14, 12, 8, '~E~dit', 'Edit the selected breakpoint'),
    btn('delete', 25, 12, 8, 'Delete', 'Delete the selected breakpoint', { disabled: entries.length === 0 }),
    btn('view', 36, 12, 8, 'View', 'View the source of the selected breakpoint', { disabled: entries.length === 0 }),
    btn('clear', 47, 12, 11, 'Clear all', 'Delete all breakpoints', { disabled: entries.length === 0 }),
    btn('help', 61, 12, 8, 'Help', HELP_HINT),
  ],
});

export const toolsDialog = (tools: string[]): DialogDef => ({
  id: 'tools',
  title: 'Tools',
  rect: { x: 19, y: 4, w: 42, h: 16 },
  controls: [
    label(3, 2, '~P~rogram titles', 'list'),
    { kind: 'list', id: 'list', x: 3, y: 3, w: 24, h: 11, items: tools, hint: 'Use cursor keys to examine the list of Tools', scroll: 'v' },
    btn('ok', 30, 3, 8, 'O~K~', OK_HINT),
    btn('edit', 30, 5, 8, '~E~dit', 'Edit the selected tool', { default: true }),
    btn('new', 30, 7, 8, '~N~ew', 'Add a new tool'),
    btn('delete', 30, 9, 8, '~D~elete', 'Delete the selected tool'),
    btn('cancel', 30, 11, 8, 'Cancel', CANCEL_HINT),
    btn('help', 30, 13, 8, 'Help', HELP_HINT),
  ],
});

export const preferencesDialog = (): DialogDef => ({
  id: 'preferences',
  title: 'Preferences',
  rect: { x: 12, y: 3, w: 56, h: 18 },
  controls: [
    label(3, 2, 'Screen sizes', 'screen'),
    {
      kind: 'radios',
      id: 'screen',
      x: 3,
      y: 3,
      w: 21,
      hint: 'Choose the screen size',
      items: [
        { label: '~2~5 lines', hint: 'Use a display of 25 lines by 80 columns' },
        { label: '~4~3/50 lines', hint: 'Use a display of 43 or 50 lines by 80 columns' },
      ],
    },
    label(26, 2, 'Source tracking', 'tracking'),
    { kind: 'radios', id: 'tracking', x: 26, y: 3, w: 27, hint: 'Choose where tracked source is displayed', items: items('~N~ew window', '~C~urrent window') },
    label(3, 6, 'Auto save', 'autosave'),
    { kind: 'checks', id: 'autosave', x: 3, y: 7, w: 21, hint: 'Choose what is saved automatically', items: items('Editor ~f~iles', '~E~nvironment', '~D~esktop') },
    label(26, 6, 'Options', 'options'),
    {
      kind: 'checks',
      id: 'options',
      x: 26,
      y: 7,
      w: 27,
      hint: 'Set desktop options',
      items: items('~A~uto track source', 'C~l~ose on go to source', 'C~h~ange dir on open'),
    },
    label(3, 11, 'Desktop file', 'desktop'),
    { kind: 'radios', id: 'desktop', x: 3, y: 12, w: 50, hint: 'Choose where the desktop file is kept', items: items('C~u~rrent directory', 'Conf~i~g file directory') },
    ...okCancelHelp(20, 15, 12),
  ],
});

export const editorOptionsDialog = (): DialogDef => ({
  id: 'editoropts',
  title: 'Editor Options',
  rect: { x: 12, y: 3, w: 56, h: 19 },
  controls: [
    label(3, 2, 'Editor options', 'editor'),
    {
      kind: 'checks',
      id: 'editor',
      x: 3,
      y: 3,
      w: 50,
      columns: 2,
      colWidth: 25,
      hint: 'Set editor options',
      items: [
        { label: 'Create backup ~f~iles', hint: 'Create a backup (.BAK) file whenever you save' },
        { label: '~I~nsert mode' },
        { label: '~A~uto indent mode' },
        { label: '~U~se tab characters' },
        { label: '~O~ptimal fill' },
        { label: '~B~ackspace unindents' },
        { label: '~C~ursor through tabs' },
        { label: '~G~roup Undo' },
        { label: '~P~ersistent blocks' },
        { label: 'O~v~erwrite blocks' },
        { label: '~S~yntax highlight' },
        { label: 'B~l~ock insert cursor' },
        { label: 'Find te~x~t at cursor' },
      ],
    },
    label(3, 11, '~T~ab size', 'tab'),
    { kind: 'input', id: 'tab', x: 12, y: 11, w: 4, history: false, hint: 'Number of columns a tab advances' },
    label(3, 13, '~H~ighlight extensions', 'ext'),
    { kind: 'input', id: 'ext', x: 3, y: 14, w: 47, hint: 'File extensions that get syntax highlighting' },
    ...okCancelHelp(20, 16, 12),
  ],
});

export const mouseOptionsDialog = (): DialogDef => ({
  id: 'mouse',
  title: 'Mouse options',
  rect: { x: 11, y: 6, w: 58, h: 13 },
  controls: [
    label(3, 2, 'Ctrl+Right mouse button', 'right'),
    {
      kind: 'radios',
      id: 'right',
      x: 3,
      y: 3,
      w: 23,
      hint: 'Choose what Ctrl+Right mouse button does',
      items: [
        { label: '~N~othing', hint: 'Ctrl+Right mouse button does nothing' },
        { label: '~T~opic search', hint: 'Selects topic search for indicated word in editor or help window' },
        { label: '~G~o to cursor' },
        { label: '~B~reakpoint' },
        { label: '~E~valuate' },
        { label: '~A~dd watch' },
      ],
    },
    label(28, 2, '~M~ouse double click', 'speed'),
    text(28, 3, 'Fast'),
    text(38, 3, 'Medium'),
    text(50, 3, 'Slow'),
    { kind: 'slider', x: 28, y: 4, w: 26, pos: 8, max: 23 },
    { kind: 'checks', id: 'reverse', x: 28, y: 7, w: 27, hint: 'Swap the left and right mouse buttons', items: items('~R~everse mouse buttons') },
    ...okCancelHelp(22, 10, 12),
  ],
});

export const startupOptionsDialog = (): DialogDef => ({
  id: 'startup',
  title: 'Startup options',
  rect: { x: 10, y: 4, w: 59, h: 16 },
  controls: [
    {
      kind: 'checks',
      id: 'startup',
      x: 3,
      y: 2,
      w: 26,
      hint: 'Set startup options',
      items: [
        { label: '~D~ual monitor support', hint: 'Use dual monitors to run IDE and user program on separate displays' },
        { label: '~G~raphics screen save' },
        { label: 'EGA/VGA ~p~alette save' },
        { label: 'CGA s~n~ow checking' },
        { label: '~L~CD color set' },
        { label: 'Load ~T~URBO.TPL' },
        { label: 'Use e~x~panded memory' },
        { label: '~R~eturn to last dir' },
      ],
    },
    label(32, 3, '~W~indow heap size', 'window'),
    { kind: 'input', id: 'window', x: 50, y: 3, w: 6, history: false, hint: 'Kilobytes of memory for the window heap' },
    label(32, 5, '~E~ditor heap size', 'editorheap'),
    { kind: 'input', id: 'editorheap', x: 50, y: 5, w: 6, history: false, hint: 'Kilobytes of memory for the editor heap' },
    label(32, 7, '~O~verlay heap size', 'overlay'),
    { kind: 'input', id: 'overlay', x: 50, y: 7, w: 6, history: false, hint: 'Kilobytes of memory for the overlay heap' },
    label(3, 11, '~S~wap file directory', 'swap'),
    { kind: 'input', id: 'swap', x: 23, y: 11, w: 33, history: false, hint: 'Directory for the IDE swap file' },
    ...okCancelHelp(23, 13, 12),
  ],
});

export const COLOR_GROUPS = [
  'Call stack',
  'Compiler',
  'Desktop',
  'Dialogs',
  'Editor',
  'Help',
  'Menus',
  'Messages',
  'Output',
  'Register',
  'Syntax',
  'Watches',
];

export const COLOR_ITEMS = [
  'Frame passive',
  'Frame active',
  'Frame icons',
  'Scroll bar page',
  'Scroll bar icons',
  'Normal text',
  'Selected text',
  'Error message',
  'Breakpoint',
  'Source position',
];

export const colorsDialog = (): DialogDef => ({
  id: 'colors',
  title: 'Colors',
  rect: { x: 9, y: 3, w: 61, h: 18 },
  focus: 'item',
  controls: [
    label(3, 2, '~G~roup', 'group'),
    { kind: 'list', id: 'group', x: 3, y: 3, w: 16, h: 11, items: COLOR_GROUPS, hint: 'Use cursor keys to select an IDE group and customize its colors', scroll: 'v' },
    label(21, 2, '~I~tem', 'item'),
    { kind: 'list', id: 'item', x: 21, y: 3, w: 21, h: 11, items: COLOR_ITEMS, hint: 'Use cursor keys to select an item and customize its colors', scroll: 'v' },
    {
      kind: 'swatches',
      id: 'foreground',
      x: 44,
      y: 2,
      label: '~F~oreground',
      cols: 4,
      colors: Array.from({ length: 16 }, (_, i) => i),
      hint: 'Use cursor keys to select a foreground color',
    },
    {
      kind: 'swatches',
      id: 'background',
      x: 44,
      y: 8,
      label: '~B~ackground',
      cols: 4,
      colors: Array.from({ length: 8 }, (_, i) => i),
      hint: 'Use cursor keys to select a background color',
    },
    { kind: 'sample', x: 44, y: 12, w: 14, h: 2, text: 'Text Text Text', attr: { fg: C.Yellow, bg: C.Red } },
    ...okCancelHelp(25, 15, 12),
  ],
});
