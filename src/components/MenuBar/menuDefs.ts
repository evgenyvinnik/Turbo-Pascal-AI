/**
 * The Turbo Pascal 7.1 menu tree, transcribed from the reference screenshots.
 * `~` brackets the accelerator letter, the same notation Turbo Vision used.
 */
export interface MenuEntry {
  id: string;
  label: string;
  shortcut?: string;
  hint: string;
  /** Item is painted in dark gray and cannot be chosen. */
  disabled?: boolean;
  submenu?: MenuEntry[];
}

export interface MenuSeparator {
  separator: true;
}

export type MenuNode = MenuEntry | MenuSeparator;

export const isSeparator = (n: MenuNode): n is MenuSeparator =>
  (n as MenuSeparator).separator;

export interface MenuDef {
  id: string;
  label: string;
  items: MenuNode[];
}

const SEP: MenuSeparator = { separator: true };

export const MENUS: MenuDef[] = [
  {
    id: 'file',
    label: '~F~ile',
    items: [
      { id: 'file.new', label: '~N~ew', hint: 'Create a new file in a new Edit window' },
      {
        id: 'file.open',
        label: '~O~pen...',
        shortcut: 'F3',
        hint: 'Load a file from disk into a new Edit window',
      },
      { id: 'file.save', label: '~S~ave', shortcut: 'F2', hint: 'Save the file in the active Edit window' },
      { id: 'file.saveas', label: 'Save ~a~s...', hint: 'Save the active file under a new name' },
      { id: 'file.saveall', label: 'Save a~l~l', hint: 'Save all modified files' },
      SEP,
      { id: 'file.chdir', label: '~C~hange dir...', hint: 'Change the current drive and directory' },
      { id: 'file.print', label: '~P~rint', hint: 'Print the contents of the active window' },
      { id: 'file.printer', label: 'P~r~inter setup...', hint: 'Set up your printer filter program' },
      { id: 'file.dos', label: '~D~OS shell', hint: 'Temporarily exit to DOS' },
      { id: 'file.exit', label: 'E~x~it', shortcut: 'Alt+X', hint: 'Exit Turbo Pascal' },
    ],
  },
  {
    id: 'edit',
    label: '~E~dit',
    items: [
      { id: 'edit.undo', label: '~U~ndo', shortcut: 'Alt+BkSp', hint: 'Undo the previous editor operation' },
      { id: 'edit.redo', label: '~R~edo', hint: 'Restore the last undone editor operation' },
      SEP,
      { id: 'edit.cut', label: 'Cu~t~', shortcut: 'Shift+Del', hint: 'Remove the selected text and put it in the clipboard' },
      { id: 'edit.copy', label: '~C~opy', shortcut: 'Ctrl+Ins', hint: 'Copy the selected text to the clipboard' },
      { id: 'edit.paste', label: '~P~aste', shortcut: 'Shift+Ins', hint: 'Insert the clipboard contents at the cursor' },
      { id: 'edit.clear', label: 'C~l~ear', shortcut: 'Ctrl+Del', hint: 'Delete the selected text without copying it' },
      SEP,
      { id: 'edit.clipboard', label: '~S~how clipboard', hint: 'Open the clipboard window' },
    ],
  },
  {
    id: 'search',
    label: '~S~earch',
    items: [
      { id: 'search.find', label: '~F~ind...', hint: 'Search for text' },
      { id: 'search.replace', label: '~R~eplace...', hint: 'Search for text and replace it' },
      { id: 'search.again', label: '~S~earch again', hint: 'Repeat the last search or replace' },
      SEP,
      { id: 'search.goto', label: 'G~o~ to line number...', hint: 'Move cursor to specified line number in file' },
      { id: 'search.lasterror', label: 'Show last compiler error', hint: 'Show the position of the last compiler error', disabled: true },
      { id: 'search.finderror', label: 'Find ~e~rror...', hint: 'Find the source position of a runtime error' },
      { id: 'search.findproc', label: 'Find procedure...', hint: 'Find a procedure while debugging', disabled: true },
    ],
  },
  {
    id: 'run',
    label: '~R~un',
    items: [
      { id: 'run.run', label: '~R~un', shortcut: 'Ctrl+F9', hint: 'Run the current program' },
      { id: 'run.stepover', label: '~S~tep over', shortcut: 'F8', hint: 'Execute the next source line, skipping calls' },
      { id: 'run.trace', label: '~T~race into', shortcut: 'F7', hint: 'Execute the next source line, entering calls' },
      { id: 'run.gotocursor', label: '~G~o to cursor', shortcut: 'F4', hint: 'Run the program up to the cursor position' },
      { id: 'run.reset', label: '~P~rogram reset', shortcut: 'Ctrl+F2', hint: 'Stop the debugging session', disabled: true },
      { id: 'run.params', label: 'P~a~rameters...', hint: 'Set the command line parameters of the program' },
    ],
  },
  {
    id: 'compile',
    label: '~C~ompile',
    items: [
      { id: 'compile.compile', label: '~C~ompile', shortcut: 'Alt+F9', hint: 'Compile source file' },
      { id: 'compile.make', label: '~M~ake', shortcut: 'F9', hint: 'Rebuild the parts of the program that changed' },
      { id: 'compile.build', label: '~B~uild', hint: 'Rebuild all the parts of the program' },
      SEP,
      { id: 'compile.destination', label: '~D~estination', shortcut: 'Memory', hint: 'Toggle the compiler destination between Memory and Disk' },
      { id: 'compile.primary', label: '~P~rimary file...', hint: 'Set the file that Make and Build compile' },
      { id: 'compile.clearprimary', label: 'C~l~ear primary file', hint: 'Clear the primary file setting' },
      SEP,
      { id: 'compile.info', label: '~I~nformation...', hint: 'Display information about the current program' },
    ],
  },
  {
    id: 'debug',
    label: '~D~ebug',
    items: [
      { id: 'debug.breakpoints', label: '~B~reakpoints', hint: 'Set conditional breakpoints, view and edit breakpoints' },
      { id: 'debug.callstack', label: '~C~all stack', shortcut: 'Ctrl+F3', hint: 'Display the sequence of active procedure calls' },
      { id: 'debug.register', label: '~R~egister', hint: 'Open the CPU register window' },
      { id: 'debug.watch', label: '~W~atch', hint: 'Open the Watches window' },
      { id: 'debug.output', label: '~O~utput', hint: 'Open the program output window' },
      { id: 'debug.userscreen', label: '~U~ser screen', shortcut: 'Alt+F5', hint: 'Display the full program output screen' },
      SEP,
      { id: 'debug.evaluate', label: '~E~valuate/modify...', shortcut: 'Ctrl+F4', hint: 'Evaluate an expression or change a variable' },
      { id: 'debug.addwatch', label: '~A~dd watch...', shortcut: 'Ctrl+F7', hint: 'Enter expression to add as watch' },
      { id: 'debug.addbreak', label: 'Add break~p~oint...', hint: 'Add a breakpoint at the cursor position' },
    ],
  },
  {
    id: 'tools',
    label: '~T~ools',
    items: [
      { id: 'tools.messages', label: '~M~essages', hint: 'Open the message window' },
      { id: 'tools.next', label: 'Go to next', shortcut: 'Alt+F8', hint: 'Go to the next message', disabled: true },
      { id: 'tools.prev', label: 'Go to previous', shortcut: 'Alt+F7', hint: 'Go to the previous message', disabled: true },
      SEP,
      { id: 'tools.grep', label: '~G~rep', shortcut: 'Shift+F2', hint: 'Search files for a text pattern' },
      { id: 'tools.tasm', label: 'Turbo ~A~ssembler', shortcut: 'Shift+F3', hint: 'Run Turbo Assembler' },
      { id: 'tools.tdebug', label: 'Turbo ~D~ebugger', shortcut: 'Shift+F4', hint: 'Run Turbo Debugger' },
      { id: 'tools.tprof', label: 'Turbo ~P~rofiler', shortcut: 'Shift+F5', hint: 'Run Turbo Profiler' },
    ],
  },
  {
    id: 'options',
    label: '~O~ptions',
    items: [
      { id: 'options.compiler', label: '~C~ompiler...', hint: 'Set default compiler directives and conditional defines' },
      { id: 'options.memory', label: '~M~emory sizes...', hint: 'Set the stack size and the heap limits' },
      { id: 'options.linker', label: '~L~inker...', hint: 'Set the link buffer and map file options' },
      { id: 'options.debugger', label: 'De~b~ugger...', hint: 'Set the integrated debugging options' },
      { id: 'options.directories', label: '~D~irectories...', hint: 'Set the directories the compiler searches' },
      { id: 'options.tools', label: '~T~ools...', hint: 'Add, edit and delete entries in the Tools menu' },
      SEP,
      {
        id: 'options.environment',
        label: '~E~nvironment',
        hint: 'Set the environment options',
        submenu: [
          { id: 'env.preferences', label: '~P~references...', hint: 'Specify desktop settings' },
          { id: 'env.editor', label: '~E~ditor...', hint: 'Set the editor options' },
          { id: 'env.mouse', label: '~M~ouse...', hint: 'Set the mouse options' },
          { id: 'env.startup', label: '~S~tartup...', hint: 'Set the options used at startup' },
          { id: 'env.colors', label: '~C~olors...', hint: 'Customize the screen colors' },
        ],
      },
      SEP,
      { id: 'options.open', label: '~O~pen...', hint: 'Load an options configuration file' },
      { id: 'options.save', label: '~S~ave', hint: 'Save the current options' },
      { id: 'options.saveas', label: 'Save ~a~s...', hint: 'Save the current options under a new name' },
    ],
  },
  {
    id: 'window',
    label: '~W~indow',
    items: [
      { id: 'window.tile', label: '~T~ile', hint: 'Arrange windows on desktop by tiling' },
      { id: 'window.cascade', label: '~C~ascade', hint: 'Arrange windows on desktop by cascading' },
      { id: 'window.closeall', label: 'C~l~ose all', hint: 'Close all the windows on the desktop' },
      { id: 'window.refresh', label: '~R~efresh display', hint: 'Redraw the whole screen' },
      SEP,
      { id: 'window.sizemove', label: '~S~ize/Move', shortcut: 'Ctrl+F5', hint: 'Change the size or position of the active window' },
      { id: 'window.zoom', label: '~Z~oom', shortcut: 'F5', hint: 'Enlarge or restore the active window' },
      { id: 'window.next', label: '~N~ext', shortcut: 'F6', hint: 'Make the next window active' },
      { id: 'window.previous', label: '~P~revious', shortcut: 'Shift+F6', hint: 'Make the previous window active' },
      { id: 'window.close', label: '~C~lose', shortcut: 'Alt+F3', hint: 'Close the active window' },
      SEP,
      { id: 'window.list', label: '~L~ist...', shortcut: 'Alt+0', hint: 'Display a list of all open windows' },
    ],
  },
  {
    id: 'help',
    label: '~H~elp',
    items: [
      { id: 'help.contents', label: '~C~ontents', hint: 'Show table of contents for online Help' },
      { id: 'help.index', label: '~I~ndex', shortcut: 'Shift+F1', hint: 'Show the index of Help topics' },
      { id: 'help.topic', label: '~T~opic search', shortcut: 'Ctrl+F1', hint: 'Show Help for the word at the cursor' },
      { id: 'help.previous', label: '~P~revious topic', shortcut: 'Alt+F1', hint: 'Show the previous Help topic' },
      { id: 'help.using', label: 'Using ~h~elp', hint: 'How to use the online Help system' },
      { id: 'help.files', label: '~F~iles...', hint: 'Choose the Help files to use' },
      SEP,
      { id: 'help.directives', label: 'Compiler ~d~irectives', hint: 'Show Help on compiler directives' },
      { id: 'help.procedures', label: '~P~rocedures and functions', hint: 'Show Help on the standard procedures and functions' },
      { id: 'help.reserved', label: '~R~eserved words', hint: 'Show Help on the reserved words' },
      { id: 'help.units', label: 'Standard ~u~nits', hint: 'Show Help on the standard units' },
      { id: 'help.language', label: 'Turbo Pascal ~L~anguage', hint: 'Show Help on the Turbo Pascal language' },
      { id: 'help.errors', label: '~E~rror messages', hint: 'Show Help on the compiler and runtime errors' },
      SEP,
      { id: 'help.about', label: '~A~bout...', hint: 'Show version and copyright information' },
    ],
  },
];

/** Column of each menu bar title: two leading spaces, two between titles. */
export const menuBarPositions = (): number[] => {
  const xs: number[] = [];
  let x = 2;
  for (const m of MENUS) {
    xs.push(x);
    x += m.label.replace(/~/g, '').length + 2;
  }
  return xs;
};
