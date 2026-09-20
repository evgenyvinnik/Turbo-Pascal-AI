import type { Ide } from '../ide';
import { STATES, type FidelityState } from './states';

export interface ReportState extends FidelityState {
  /** A related current screen is useful evidence, but is not equivalent coverage. */
  equivalence?: 'equivalent' | 'partial';
  note?: string;
}

/** Visible modified-file markers transcribed from the original 80×25 screens. */
export const MODIFIED_REFERENCES = new Set([
  'Breakpoints-list-empty',
  'Compiling',
  'Error-10-Unexpected-end-of-file',
  'Error-Address-not-found',
  'Error-Procedure-not-found',
  'Error-Search-string-not-found',
  'Error-could-not-find-printer-filter-PRINFLTR',
  'Error',
  'Evaluate-and-Modify-empty',
  'Evaluate-and-Modify',
  'Find-Error-by-address',
  'Find-Procedure',
  'Find',
  'Go-to-Line-Number',
  'Information',
  'Normal-VIew-2',
  'Normal-View-line-highlight-2',
  'Normal-View-line-highlight-3',
  'Normal-View-line-highlight',
  'Normal-view-3',
  'Normal-view-4',
  'Normal-view',
  'Primary-File',
  'Program-Parameters',
  'Replace',
  'Turbo-Help-Evaluate-and-Modify',
  'Turbo-Help-Find-Error',
  'Turbo-Help-Find-Procedure',
  'Turbo-Help-Go-to-Line',
  'Turbo-Help-Primary-File',
  'Turbo-Help-Program-Parameters',
  'Turbo-Help-Replace',
  'Two-panes-one-file',
  'Two-panes-two-files',
]);

/** Some later screenshots use an uppercase spelling of the output variable. */
export const UPPERCASE_RESULT_REFERENCES = new Set([
  'Watches',
  'Watches-2',
  'Watches-3',
  'Watches-4',
  'Watches-5-Unknown-identifier',
  'Debugger',
  'Context-menu-Options-2',
  'Tools',
  'Messages-Empty',
  'Messages',
  'Memory-Sizes',
  'Context-menu-Options-Environment',
  'Linker',
]);
const menu = async (ide: Ide, letter: string, ...items: string[]) => {
  await ide.openMenu(letter);
  for (const key of items) await ide.press(key);
};
const square = async (ide: Ide) => {
  await ide.press('Alt+F3');
  await ide.openFile('SQUARE.PAS');
  await ide.markModified();
};
const hello = async (ide: Ide) => {
  await ide.press('Alt+F3');
  await ide.openFile('HELLO.PAS');
  await ide.markModified();
};
const pauseAt = async (ide: Ide, line: number, finishReadLn = false) => {
  await ide.moveTo(line, 1);
  await ide.press('F4');
  await ide.waitForDialog('Compiling');
  await ide.press('Enter');
  if (finishReadLn) {
    await ide.waitForDialog('Program input');
    await ide.press('Enter');
  }
  await ide.page.waitForTimeout(150);
};
const addResWatch = async (ide: Ide) => {
  await menu(ide, 'D', 'a');
  await ide.type('Res');
  await ide.press('Enter');
  await ide.clickCell(2, 19);
};
const shortHello = "program Hello;\nbegin\n     writeln('Hello, world!')\nend.";

/** Additional reachable gallery subjects beyond the original fidelity suite. */
export const REPORT_STATES: ReportState[] = [
  ...STATES.map(
    (state): ReportState =>
      state.name === 'goto-line'
        ? {
            ...state,
            note: 'The reference input value is entered and reselected through the dialog while the underlying editor stays on line 4.',
            drive: async (ide) => {
              await state.drive(ide);
              await ide.type('1');
              await ide.press('Tab');
              await ide.press('Shift+Tab');
            },
          }
        : state.name === 'messages-window'
          ? {
              ...state,
              note: 'Grep runs the reference query against the current virtual filesystem. Its real command summary and matching files are shown; the full-image metric retains these data differences.',
            }
          : state.name === 'tools'
            ? {
                ...state,
                drive: async (ide) => {
                  await state.drive(ide);
                  await ide.waitForDialog('Tools');
                },
              }
            : state
  ),
  {
    name: 'printer-setup',
    ref: 'Printer-setup',
    drive: (ide) => menu(ide, 'F', 'r'),
  },
  {
    name: 'save-as-history',
    ref: 'Save-File-As-modal',
    note: 'The filename-history popup is opened through the real Save As input. The virtual filesystem listing remains visible and unmasked.',
    drive: async (ide) => {
      await menu(ide, 'F', 'a');
      await ide.press('ArrowDown');
    },
  },
  {
    name: 'editor-context-menu',
    ref: 'Context-menu',
    drive: (ide) => ide.press('Alt+F10'),
  },
  {
    name: 'grep-arguments',
    ref: 'Program-Arguments',
    note: 'The Grep argument form is backed by searching Pascal files in the current virtual filesystem.',
    drive: async (ide) => {
      await square(ide);
      await ide.press('Shift+F2');
    },
  },
  {
    name: 'primary-file',
    ref: 'Primary-File',
    drive: async (ide) => {
      await hello(ide);
      await ide.moveTo(5, 1);
      await menu(ide, 'C', 'p');
    },
  },
  {
    name: 'find-error',
    ref: 'Find-Error-by-address',
    drive: async (ide) => {
      await hello(ide);
      await ide.moveTo(4, 12);
      await menu(ide, 'S', 'e');
    },
  },
  {
    name: 'evaluate-empty',
    ref: 'Evaluate-and-Modify-empty',
    drive: async (ide) => {
      await square(ide);
      await pauseAt(ide, 16, true);
      await ide.moveTo(13, 1);
      await ide.press('Control+F4');
    },
  },
  {
    name: 'add-breakpoint',
    ref: 'Add-Breakpoint',
    drive: async (ide) => {
      await square(ide);
      await ide.moveTo(15, 13);
      await menu(ide, 'D', 'p');
    },
  },
  {
    name: 'open-options',
    ref: 'Open-Options',
    note: 'The current configuration-load dialog is compared with its original form.',
    drive: async (ide) => {
      await square(ide);
      await menu(ide, 'O', 'o');
    },
  },
  {
    name: 'save-options-as',
    ref: 'Save-Options-As',
    note: 'The current configuration-save dialog is compared with its original form.',
    drive: async (ide) => {
      await square(ide);
      await menu(ide, 'O', 'a');
    },
  },
  {
    name: 'help-index',
    ref: 'Help-index',
    note: 'The reachable help index is compared, including visible topic text and scroll position.',
    drive: async (ide) => {
      await square(ide);
      await ide.press('Shift+F1');
    },
  },
  ...(
    [
      ['help-directives', 'Help-Compiler-Directives', 'd'],
      ['help-procedures', 'Help-List-of-Borland-Pascal-Functions-and-Procedures', 'o'],
      ['help-reserved', 'Help-Reserved-Words', 'r'],
      ['help-units', 'Help-Standard-Units', 'u'],
      ['help-language', 'Help-Language-Elements', 'l'],
      ['help-errors', 'Help-Error-messages', 'e'],
    ] as const
  ).map(
    ([name, ref, key]): ReportState => ({
      name,
      ref,
      note: 'The current help topic is compared, including text, layout, and scroll position.',
      drive: async (ide) => {
        await square(ide);
        await menu(ide, 'H', key);
      },
    })
  ),
  {
    name: 'two-empty-panes',
    ref: 'Two-panes-two-empty-files',
    drive: async (ide) => {
      await menu(ide, 'F', 'n');
      await menu(ide, 'W', 't');
    },
  },
  {
    name: 'window-list-populated',
    ref: 'Windows-List-2',
    drive: async (ide) => {
      await menu(ide, 'F', 'n');
      await ide.press('F6');
      await menu(ide, 'W', 'l');
      await ide.press('ArrowDown');
    },
  },
  {
    name: 'menu-options-source',
    ref: 'Context-menu-Options-2',
    drive: async (ide) => {
      await square(ide);
      await ide.openMenu('O');
      for (let i = 0; i < 6; i += 1) await ide.press('ArrowDown');
    },
  },
  {
    name: 'messages-empty',
    ref: 'Messages-Empty',
    drive: async (ide) => {
      await square(ide);
      await menu(ide, 'T', 'm');
    },
  },
  {
    name: 'normal-hello',
    ref: 'Normal-view-3',
    drive: async (ide) => {
      await hello(ide);
      await ide.moveTo(3, 31);
    },
  },
  {
    name: 'normal-unsaved',
    ref: 'Normal-view-4',
    drive: async (ide) => {
      await ide.typeSource(shortHello.slice(0, -1));
      await ide.moveTo(4, 4);
    },
  },
  {
    name: 'register-window',
    ref: 'CPU-watch',
    equivalence: 'partial',
    note: 'Current Register action compared with the original CPU window; native x86 register contents are not interchangeable with VM registers.',
    drive: async (ide) => {
      await square(ide);
      await pauseAt(ide, 16, true);
      await ide.press('Control+F3');
      await addResWatch(ide);
      await menu(ide, 'D', 'r');
      await ide.clickCell(2, 19);
    },
  },
  {
    name: 'register-active',
    ref: 'CPU-watch-3',
    equivalence: 'partial',
    note: 'The current register window shows live Pascal VM state, not the original x86 registers or DOS memory addresses. The window arrangement is compared without masking those differences.',
    drive: async (ide) => {
      await square(ide);
      await pauseAt(ide, 16, true);
      await ide.press('Control+F3');
      await menu(ide, 'D', 'r');
      await ide.clickCell(2, 19);
      await ide.press('Alt+F3');
      await ide.clickCell(63, 3);
    },
  },
  {
    name: 'register-with-empty-watches',
    ref: 'CPU-watch-2',
    equivalence: 'partial',
    note: 'The current register window shows live Pascal VM state instead of native x86 state. The original CPU values remain unmasked in the comparison.',
    drive: async (ide) => {
      await square(ide);
      await pauseAt(ide, 16, true);
      await ide.press('Control+F3');
      await menu(ide, 'D', 'r');
      await menu(ide, 'D', 'w');
    },
  },
  {
    name: 'compile-success',
    ref: 'Compiling',
    drive: async (ide) => {
      await ide.typeSource(shortHello);
      await ide.press('Alt+F9');
      await ide.waitForDialog('Compiling');
    },
  },
  {
    name: 'compile-unexpected-eof',
    ref: 'Error-10-Unexpected-end-of-file',
    equivalence: 'partial',
    note: 'The same incomplete program is compiled. Known compiler failures now use Borland diagnostic codes, but this incomplete-program parse location and inline diagnostic presentation remain different from the original captured Error 10 state.',
    drive: async (ide) => {
      await ide.typeSource(shortHello.slice(0, -1));
      await ide.press('Alt+F9');
      await ide.waitForText('Error');
    },
  },
  {
    name: 'runtime-numeric-error',
    ref: 'Error',
    equivalence: 'partial',
    note: 'The original integer input program is run with invalid numeric input. The runtime now reports Borland error 106 and the actual source location; the explanatory detail and dialog presentation remain different from the captured original.',
    drive: async (ide) => {
      await ide.typeSource(
        'program Hello;\nvar\n   Num1, Num2 : Integer;\nbegin\n     readln(Num1);\n     writeln(Num1 * 2);\nend.'
      );
      await menu(ide, 'F', 'a');
      await ide.type('HELLO.PAS');
      await ide.press('Enter');
      await ide.markModified();
      await ide.press('Control+F9');
      await ide.waitForDialog('Compiling');
      await ide.press('Enter');
      await ide.waitForDialog('Program input');
      await ide.type('invalid');
      await ide.press('Enter');
      await ide.waitForDialog('Runtime error');
      await ide.press('Enter');
      await ide.press('Alt+F3');
    },
  },
  {
    name: 'evaluate-result',
    ref: 'Evaluate-and-Modify',
    drive: async (ide) => {
      await square(ide);
      await pauseAt(ide, 16, true);
      await ide.moveTo(13, 1);
      await ide.press('Control+F4');
      await ide.type('Res');
      await ide.press('Enter');
      await ide.press('Tab');
      await ide.type('49');
      await ide.clickCell(56, 11);
    },
  },
  {
    name: 'find-procedure',
    ref: 'Find-Procedure',
    drive: async (ide) => {
      await hello(ide);
      await ide.press('Alt+F9');
      await ide.waitForDialog('Compiling');
      await ide.press('Enter');
      await ide.moveTo(4, 12);
      await menu(ide, 'S', 'p');
      await ide.waitForDialog('Find Procedure');
    },
  },
  {
    name: 'procedure-not-found',
    ref: 'Error-Procedure-not-found',
    drive: async (ide) => {
      await hello(ide);
      await ide.press('Alt+F9');
      await ide.waitForDialog('Compiling');
      await ide.press('Enter');
      await ide.moveTo(4, 12);
      await menu(ide, 'S', 'p');
      await ide.waitForDialog('Find Procedure');
      await ide.press('Enter');
    },
  },
  {
    name: 'address-not-found',
    ref: 'Error-Address-not-found',
    drive: async (ide) => {
      await hello(ide);
      await ide.moveTo(4, 12);
      await menu(ide, 'S', 'e');
      await ide.waitForDialog('Find Error');
      await ide.press('Enter');
    },
  },
  {
    name: 'help-program-layout',
    ref: 'Help-general-layout',
    note: 'Context lookup for the program keyword is compared with the original language help topic, including its text and wrapping.',
    drive: async (ide) => {
      await square(ide);
      await ide.press('Control+F1');
    },
  },
  {
    name: 'help-welcome',
    ref: 'Help-welcome-screen',
    note: 'The Using Help topic is compared with the original welcome page; original documentation text is not masked.',
    drive: async (ide) => {
      await square(ide);
      await menu(ide, 'H', 'h');
    },
  },
  {
    name: 'help-edit-window',
    ref: 'Help-Edit-Window',
    note: 'Editor context help is compared with the original Edit Window topic; original documentation text is not masked.',
    drive: async (ide) => {
      await ide.press('F1');
    },
  },
  {
    name: 'help-edit-more',
    ref: 'Help-2',
    note: 'The supplied two editor Help pages are followed by authored navigation guidance. The scrollbar uses document length minus viewport height; this state is verified against the complete reference with no masks or pixel tolerance.',
    drive: async (ide) => {
      await ide.press('F1');
      await ide.press('PageDown');
    },
  },
  ...(
    [
      ['debug-hello-writeln', 'Normal-View-line-highlight-2', 3],
      ['debug-hello-readln', 'Normal-View-line-highlight', 4],
      ['debug-hello-begin', 'Normal-View-line-highlight-3', 2],
    ] as const
  ).map(
    ([name, ref, line]): ReportState => ({
      name,
      ref,
      drive: async (ide) => {
        await hello(ide);
        await pauseAt(ide, line);
      },
    })
  ),
  {
    name: 'debug-hello-end',
    ref: 'Normal-VIew-2',
    drive: async (ide) => {
      await hello(ide);
      await pauseAt(ide, 5, true);
    },
  },
  {
    name: 'call-stack-before-square',
    ref: 'Call-stack-2',
    drive: async (ide) => {
      await square(ide);
      await pauseAt(ide, 4);
      await ide.press('Control+F3');
    },
  },
  {
    name: 'call-stack-hello',
    ref: 'Call-stack-3',
    drive: async (ide) => {
      await hello(ide);
      await pauseAt(ide, 2);
      await ide.press('Control+F3');
    },
  },
  {
    name: 'call-stack-empty',
    ref: 'Call-stack-4',
    drive: async (ide) => {
      await hello(ide);
      await ide.press('Control+F3');
    },
  },
  ...(
    [
      ['watches-before-call', 'Watches-2', 13],
      ['watches-before-write', 'Watches-3', 12],
      ['watches-before-main', 'Watches-4', 11],
    ] as const
  ).map(
    ([name, ref, line]): ReportState => ({
      name,
      ref,
      drive: async (ide) => {
        await square(ide);
        await pauseAt(ide, line);
        await addResWatch(ide);
      },
    })
  ),
  {
    name: 'watches-uncompiled',
    ref: 'Watches-5-Unknown-identifier',
    drive: async (ide) => {
      await square(ide);
      await addResWatch(ide);
    },
  },
  {
    name: 'windows-cascaded',
    ref: 'Two-tabs-one-visible',
    drive: async (ide) => {
      await menu(ide, 'F', 'n');
      await menu(ide, 'W', 'a');
    },
  },
  {
    name: 'single-half-pane',
    ref: 'Two-panes-one-file',
    drive: async (ide) => {
      await hello(ide);
      await ide.moveTo(3, 31);
      await menu(ide, 'F', 'n');
      await menu(ide, 'W', 't');
      await ide.press('Alt+F3');
    },
  },
  ...(
    [
      ['colors-editor', 'Colors-2', 4],
      ['colors-desktop', 'Colors-3', 2],
      ['colors-compiler', 'Colors-4', 1],
    ] as const
  ).map(
    ([name, ref, group]): ReportState => ({
      name,
      ref,
      note:
        group === 4
          ? 'The corresponding color group, item list, palette values, and preview appearance are compared.'
          : `The reference is internally inconsistent: its ${group === 2 ? 'Desktop' : 'Compiler'} item list and palette are visible, while the preceding ${group === 2 ? 'Compiler' : 'Call stack'} group row is highlighted. The current capture keeps selection and displayed settings synchronized; the reference anomaly remains unmasked.`,
      drive: async (ide) => {
        await square(ide);
        await menu(ide, 'O', 'e', 'c');
        await ide.clickCell(16, 6 + group);
      },
    })
  ),
];

/** Context help is reached from the real modal so its underlying screen remains visible. */
REPORT_STATES.push(
  ...(
    [
      ['help-goto', 'Turbo-Help-Go-to-Line', 'goto-line'],
      ['help-replace', 'Turbo-Help-Replace', 'replace'],
      ['help-find-error', 'Turbo-Help-Find-Error', 'find-error'],
      ['help-find-procedure', 'Turbo-Help-Find-Procedure', 'find-procedure'],
      ['help-primary-file', 'Turbo-Help-Primary-File', 'primary-file'],
      ['help-parameters', 'Turbo-Help-Program-Parameters', 'program-parameters'],
      ['help-evaluate', 'Turbo-Help-Evaluate-and-Modify', 'evaluate-empty'],
      ['help-add-breakpoint', 'Turbo-Help-Add-Breakpoints', 'add-breakpoint'],
      ['help-compiler-options', 'Turbo-Help-Compiler-Options', 'compiler-options'],
      ['help-memory-sizes', 'Turbo-Help-Memory-Sizes', 'memory-sizes'],
      ['help-linker', 'Turbo-Help-Linker', 'linker'],
      ['help-debugger', 'Turbo-Help-Debugger', 'debugger'],
      ['help-directories', 'Turbo-Help-Directories', 'directories'],
      ['help-tools', 'Turbo-Help-Tools', 'tools'],
      ['help-preferences', 'Help-Preferences', 'preferences'],
      ['help-editor-options', 'Help-Editor-options', 'editor-options'],
      ['help-mouse-options', 'Help-Mouse-Options', 'mouse-options'],
      ['help-startup-options', 'Turbo-help-startup-options', 'startup-options'],
      ['help-colors', 'Turbo-help-colors-dialog-box', 'colors'],
      ['help-open-options', 'Turbo-Help', 'open-options'],
    ] as const
  ).map(
    ([name, ref, source]): ReportState => ({
      name,
      ref,
      note: 'The current context-help topic is opened from the corresponding dialog. Original documentation text and its wrapping are compared without exclusions.',
      drive: async (ide) => {
        const base = REPORT_STATES.find((state) => state.name === source)!;
        await base.drive(ide);
        await ide.press('F1');
        await ide.waitForDialog('Turbo Help');
      },
    })
  )
);

export function unmatchedReason(ref: string): string {
  const known: Record<string, string> = {
    Run: 'The original image includes a specific DOS shell journal and licensed Borland Turbo Pascal startup banner. A real DOS workspace is now available, but that executable and historical session are not bundled; no fabricated startup history is compared.',
    'Error-could-not-find-printer-filter-PRINFLTR':
      'Printing uses the browser print flow and has no DOS PRNFLTR dependency. The original missing-printer-filter error has no equivalent failure state.',
  };
  if (known[ref]) return known[ref];
  if (/CPU-watch/.test(ref))
    return 'Original x86 CPU/register window variant has no equivalent deterministic capture.';
  if (/Help|help/.test(ref))
    return 'This original help page/context is not yet mapped to an equivalent reachable page.';
  if (/Call-stack|Watches|line-highlight|Evaluate|Breakpoint/.test(ref))
    return 'This debugger state requires the matching execution position, expressions, and window geometry; no equivalent driver is registered yet.';
  if (/Error|Compiling|Run/.test(ref))
    return 'The original compiler/runtime or DOS error context has no equivalent deterministic capture yet.';
  if (/Colors/.test(ref))
    return 'This alternate Colors selection/preview state has no deterministic driver yet.';
  if (/panes|tabs|Normal/.test(ref))
    return 'This editor content/window arrangement has no equivalent deterministic driver yet.';
  return 'No equivalent current-state driver is registered; this reference remains explicitly unmatched.';
}
