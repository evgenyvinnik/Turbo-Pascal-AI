import { HELP_TOPICS, helpTopic, type HelpLink, type HelpTopic } from './helpTopics';
import { REFERENCE_CONTEXT_HELP, REFERENCE_HELP } from './referenceHelp';

export const REFERENCE_TOPICS: Record<string, string> = {
  index: 'Help-index', directives: 'Help-Compiler-Directives', procedures: 'Help-List-of-Borland-Pascal-Functions-and-Procedures',
  reserved: 'Help-Reserved-Words', units: 'Help-Standard-Units', language: 'Help-Language-Elements', errors: 'Help-Error-messages',
  edit: 'Help-Edit-Window', preferences: 'Help-Preferences', editor: 'Help-Editor-options', mouse: 'Help-Mouse-Options',
  program: 'Help-general-layout', using: 'Help-welcome-screen', welcome: 'Help-welcome-screen',
};
const l = (label: string, target: string) => `[[${label}|${target}]]`;
const aliases: Record<string, string> = {
  goto: 'labels', label: 'labels', inline: 'asm', procedure: 'routines', const: 'types', type: 'types', packed: 'types', char: 'ordinal', boolean: 'ordinal', byte: 'integer', word: 'integer', shortint: 'integer', longint: 'integer',
  begin: 'statements', end: 'statements', if: 'statements', then: 'statements', else: 'statements', case: 'statements', for: 'statements', while: 'statements', repeat: 'statements', until: 'statements', do: 'statements', to: 'statements', downto: 'statements', with: 'record',
  and: 'expressions', or: 'expressions', xor: 'expressions', not: 'expressions', div: 'expressions', mod: 'expressions', shl: 'expressions', shr: 'expressions', in: 'set', of: 'types', nil: 'pointer',
  interface: 'unit', implementation: 'unit', method: 'object', methods: 'object', virtual: 'inherited', self: 'object', forward: 'routines',
  abs: 'numeric-routines', sqr: 'numeric-routines', sqrt: 'numeric-routines', sin: 'numeric-routines', cos: 'numeric-routines', arctan: 'numeric-routines', exp: 'numeric-routines', ln: 'numeric-routines', round: 'numeric-routines', trunc: 'numeric-routines', int: 'numeric-routines', frac: 'numeric-routines', ord: 'numeric-routines', chr: 'numeric-routines', succ: 'numeric-routines', pred: 'numeric-routines', inc: 'numeric-routines', dec: 'numeric-routines',
  '$i': '$i', '$include': '$include', '$ifdef': '$define', '$ifndef': '$define', '$ifopt': '$define', '$undef': '$define', '$else': '$define', '$endif': '$define',
};

const continuations: Record<string, string[]> = {
  edit: [
    ' Use a highlighted topic above for details.', ' Tab selects the next link; Enter opens it.', ' Shift+Tab selects the previous link.', ' Left and Right select links on the same row.',
    ' Page Up and Page Down scroll by a page.', ' Home and End move to the first or last line.', ' Alt+F1 returns to the previous topic.', ' Shift+F1 opens the alphabetical index.',
    ' Esc closes Help and returns to your editor.', ' Your source is preserved while reading Help.',
  ],
  program: ['    end.', '', 'The final period completes the program.', 'Declarations precede the main statements. USES imports other source modules.', '', l('User-defined units', 'unit'), l('Procedures and functions', 'routines'), l('Variables and parameters', 'var'), l('Sample programs', 'samples')],
  directives: [
    '    $S                   (Stack Checking)', '    $V                   (Strict VAR Strings)', '    $X                   (Extended Syntax)', '',
    ' Source switches use {$letter+} or {$letter-}.', ' They override the initial Compiler Options.', ' A directive affects the following source.', '',
    l('Include files', '$include'), l('Conditional compilation', '$define'),
    ...Object.keys(HELP_TOPICS).filter((name) => /^\$[a-z]$/.test(name)).map((name) => l(`${name.toUpperCase()} - ${HELP_TOPICS[name]!.title.split(' - ')[1]!}`, name)),
  ],
  errors: [' reports the first problem and its location.', ' Fix it and compile again before running.', '', l('Compiler error messages', 'compiler-errors'), l('Run-time error messages', 'runtime-errors'), l('Debugging', 'debugging')],
  reserved: [
    ...['array', 'begin', 'case', 'const', 'constructor', 'destructor', 'div', 'do', 'downto', 'else', 'end', 'file', 'for', 'function', 'goto', 'if', 'implementation', 'in', 'inherited', 'inline', 'interface', 'label', 'mod', 'nil', 'not', 'object', 'of', 'or', 'packed', 'procedure', 'program', 'record', 'repeat', 'set', 'shl', 'shr', 'string', 'then', 'to', 'type', 'unit', 'until', 'uses', 'var', 'while', 'with', 'xor'].map((name) => l(name, identifierTopic(name))),
  ],
  units: ['  Dos', '  Objects', '', ' Choose a unit topic for its purpose.', l('System', 'system'), l('Crt', 'crt'), l('Dos', 'dos'), l('Graph', 'graph'), l('Printer', 'printer'), l('Strings', 'strings'), l('Objects', 'objects'), l('Write your own unit', 'unit')],
  language: [l('Records', 'record'), l('Sets', 'set'), l('Statements', 'statements'), l('Types', 'types'), l('Units', 'unit'), l('Variables', 'var'), l('Objects', 'object'), l('Pointers', 'pointer')],
  procedures: ['', ' Select a group above, then choose a routine.', l('Declaring your own routines', 'routines')],
  using: ['', ' Tab moves to the next highlighted link.', ' Shift+Tab moves to the previous link.', ' Click a highlighted item to open its topic.', ' Page Up/Down scroll long topics.', ' Alt+F1 returns to the previous topic.', ' Shift+F1 opens the index.', ' Ctrl+F1 looks up the word in your source.', ' Esc returns to the window or dialog.', '', l('Menus and hot keys', 'menus'), l('Editor commands', 'editor-commands'), l('Language elements', 'language')],
};

HELP_TOPICS.statements = helpTopic('Statements', ['Statements', '══════════', '', 'BEGIN and END group statements. IF chooses between alternatives; CASE selects an ordinal value. WHILE tests before each iteration; REPEAT tests afterward. FOR steps through ordinal values.', '', 'A semicolon separates statements. Do not place a semicolon before the ELSE belonging to IF.', '', l('Expressions', 'expressions'), l('Ordinal types', 'ordinal'), l('Procedures and functions', 'routines')]);
HELP_TOPICS.types = helpTopic('Types and declarations', ['Types and declarations', '══════════════════════', '', 'TYPE gives a name to a type definition. CONST declares a compile-time value. VAR allocates mutable storage of a declared type.', '', l('Ordinal types', 'ordinal'), l('Arrays', 'array'), l('Records', 'record'), l('Strings', 'string'), l('Sets', 'set'), l('Pointers', 'pointer'), l('Objects', 'object')]);
const groups = ['A-B', 'C-D', 'E-F', 'G', 'H', 'I-L', 'M-P', 'Q-R', 'S-SS', 'ST-T', 'U-Z'];
const routineNames = ['assign', 'clrscr', 'close', 'copy', 'delete', 'dispose', 'insert', 'ioresult', 'length', 'new', 'paramstr', 'pos', 'read', 'readln', 'reset', 'rewrite', 'write', 'writeln'];
const groupFor = (name: string): string => name[0]! <= 'b' ? 'A-B' : name[0]! <= 'd' ? 'C-D' : name[0]! <= 'f' ? 'E-F' : name[0] === 'g' ? 'G' : name[0] === 'h' ? 'H' : name[0]! <= 'l' ? 'I-L' : name[0]! <= 'p' ? 'M-P' : name[0]! <= 'r' ? 'Q-R' : name[0]! <= 's' ? 'S-SS' : name[0] === 't' ? 'ST-T' : 'U-Z';
for (const group of groups) {
  const entries = routineNames.filter((name) => groupFor(name) === group);
  HELP_TOPICS[`routines-${group.toLowerCase()}`] = helpTopic(`Routines ${group}`, [`Functions and Procedures ${group}`, '', ...entries.map((name) => l(HELP_TOPICS[name]!.title.replace(' routine', ''), name)), ...(entries.length ? [] : ['Consult the function categories below.']), '', l('Numeric and ordinal routines', 'numeric-routines'), l('String routines', 'string'), l('File routines', 'file'), l('All routine groups', 'procedures')]);
}
HELP_TOPICS['numeric-routines'] = helpTopic('Numeric and ordinal routines', ['Numeric and ordinal routines', '', 'Abs gives magnitude; Sqr squares a value.', 'Sqrt gives a nonnegative square root. Sin, Cos, ArcTan, Exp and Ln operate on real values.', 'Round rounds to an integer; Trunc removes the fractional part. Int returns an integral real value; Frac returns the fractional part.', 'Ord returns an ordinal number. Chr converts a character code. Succ and Pred select adjacent ordinal values. Inc and Dec update an ordinal variable.', '', l('Expressions', 'expressions'), l('Ordinal types', 'ordinal'), l('Run-time errors', 'runtime-errors')]);

export function identifierTopic(identifier: string): string {
  const key = identifier.trim().toLowerCase();
  // This function is also used while constructing the static reserved-word page.
  return Object.hasOwn(aliases, key) ? aliases[key]! : Object.hasOwn(HELP_TOPICS, key) || Object.hasOwn(REFERENCE_TOPICS, key) ? key : 'language';
}

const referenceLabels: Record<string, [string, string][]> = {
  contents: [['How to Use Help', 'using'], ['Menus and Hot Keys', 'menus'], ['Editor Commands', 'editor-commands'], ['Functions and Procedures', 'procedures'], ['Built-in Assembler', 'asm'], ['Command Line', 'commandline'], ['Debugging', 'debugging'], ['Directives', 'directives'], ['Error Messages', 'errors'], ['ObjectBrowser', 'object'], ['ObjectWindows', 'objects'], ['Reserved Words', 'reserved'], ['Sample Programs', 'samples'], ['Start-Up Options', 'commandline'], ['Turbo Vision', 'objects'], ['Units', 'units'], ['Glossary', 'glossary'], ['Windows API', 'tools']],
  edit: [['Using Turbo Pascal windows', 'windows'], ['Using the editor', 'editor-commands'], ['Find dialog box (text search)', 'find'], ['Replace dialog box', 'replace'], ['Edit menu', 'editor-commands'], ['File│Save command', 'editor-commands'], ['File│Save As command', 'editor-commands'], ['"Block read" (^KR) dialog box', 'editor-commands'], ['"Block write" (^KW) dialog box', 'editor-commands']],
  language: [['Character strings', 'string'], ['Comments', 'comments'], ['Constant declarations', 'types'], ['Directives', 'directives'], ['Expressions', 'expressions'], ['Function', 'function'], ['Functions', 'routines'], ['Identifiers', 'identifiers'], ['Labels', 'labels'], ['Methods', 'object'], ['Numbers', 'integer'], ['Operators', 'expressions'], ['Procedures', 'routines']],
  directives: Object.keys(HELP_TOPICS).filter((name) => /^\$[a-z]$/.test(name)).map((name) => [name.toUpperCase(), name]),
  errors: [['Run-time error messages', 'runtime-errors'], ['Compiler error messages 1--99', 'compiler-errors'], ['Compiler error messages 100--162', 'compiler-errors']],
  units: [['Crt', 'crt'], ['Graph', 'graph'], ['Graph3', 'graph'], ['Overlay', 'tools'], ['Printer', 'printer'], ['Strings', 'strings'], ['System', 'system'], ['Turbo3', 'tools']],
  procedures: groups.map((group) => [`Functions and Procedures ${group}`, `routines-${group.toLowerCase()}`]),
  reserved: [['and', 'expressions'], ['asm', 'asm']],
  index: Object.keys(HELP_TOPICS).filter((name) => name.startsWith('$')).map((name) => [name.toUpperCase(), name]),
};
HELP_TOPICS.comments = helpTopic('Comments', ['Comments', '', 'Use { ... } or (* ... *) to include explanatory text. A comment beginning with $ can be a compiler directive.', 'Close comments before the end of the source file. A quote inside a string is written twice.', '', l('Compiler directives', 'directives'), l('Strings', 'string')]);
HELP_TOPICS.identifiers = helpTopic('Identifiers', ['Identifiers', '', 'An identifier names a declaration. Pascal ignores letter case: Count and COUNT refer to the same name. Reserved words cannot be redefined.', 'Declare names before use. Inner declarations hide outer declarations. Qualify a unit member with UnitName.Identifier.', '', l('Reserved words', 'reserved'), l('User-defined units', 'unit')]);
HELP_TOPICS.labels = helpTopic('Labels and GOTO', ['Labels and GOTO', '', 'Declare labels in the LABEL section, then prefix a statement with its label and a colon. GOTO transfers control to a declared label.', 'Every referenced label must identify a statement. Prefer structured loops and conditionals when they express the same control flow clearly.', '', l('Statements', 'statements')]);

function append(prefix: string[], extra: string[]): HelpTopic {
  const document = helpTopic('', extra);
  return { title: '', lines: [...prefix, ...document.lines], links: document.links.map((entry) => ({ ...entry, row: entry.row + prefix.length })) };
}
const contextTargets: Record<string, string> = {
  'Turbo-Help-Compiler-Options': 'directives', 'Turbo-Help-Add-Breakpoints': 'breakpoints', 'Turbo-Help-Debugger': 'debugging',
  'Turbo-Help-Evaluate-and-Modify': 'evaluate', 'Turbo-Help-Directories': 'directories', 'Turbo-Help-Tools': 'tools',
  'Turbo-Help-Find-Error': 'finderror', 'Turbo-Help-Find-Procedure': 'routines', 'Turbo-Help-Replace': 'replace',
  'Help-Editor-options': 'editor-commands', 'Help-Preferences': 'windows', 'Help-Mouse-Options': 'windows',
};
const documentCache = new Map<string, HelpTopic>();
export function getHelpDocument(topic: string): HelpTopic {
  const cached = documentCache.get(topic);
  if (cached) return cached;
  let document: HelpTopic;
  if (topic === 'contents') document = { title: 'Help', lines: REFERENCE_HELP['Help-contents']!, links: [] };
  else if (topic.startsWith('context:')) {
    const name = topic.slice(8);
    const prefix = REFERENCE_CONTEXT_HELP[name] ?? REFERENCE_HELP[name];
    const target = contextTargets[name] ?? 'menus';
    const detail = HELP_TOPICS[target];
    document = prefix ? append(prefix, ['', l('Related topic', target), '', ...(detail?.lines ?? [])]) : { title: 'Help', lines: [], links: [] };
  } else if (Object.hasOwn(REFERENCE_TOPICS, topic)) {
    const reference = REFERENCE_TOPICS[topic]!;
    const prefix = [...(REFERENCE_HELP[reference] ?? REFERENCE_CONTEXT_HELP[reference] ?? []), ...(topic === 'edit' ? REFERENCE_HELP['Help-2'] ?? [] : [])];
    document = append(prefix, topic === 'index' ? ['', ' Alphabetical topic index', ...Object.keys(HELP_TOPICS).filter((name) => name !== 'contents' && !name.startsWith('routines-')).sort((a, b) => a.localeCompare(b)).map((name) => l(HELP_TOPICS[name]!.title, name))] : continuations[topic === 'welcome' ? 'using' : topic] ?? []);
  } else document = Object.hasOwn(HELP_TOPICS, topic) ? HELP_TOPICS[topic]! : HELP_TOPICS.glossary!;
  const links = [...document.links];
  for (const [label, target] of Object.hasOwn(referenceLabels, topic) ? referenceLabels[topic]! : []) {
    document.lines.forEach((line, row) => {
      // Exact table entries: do not turn a prose occurrence into a link.
      const col = line.indexOf(label);
      if (col < 0 || links.some((entry) => entry.row === row && entry.col <= col && entry.col + entry.length > col)) return;
      const after = line.slice(col + label.length, col + label.length + 1);
      if (after && !/[\s│║]/.test(after)) return;
      links.push({ row, col, length: label.length, target });
    });
  }
  const resolved = { ...document, links: links.sort((a, b) => a.row - b.row || a.col - b.col) };
  documentCache.set(topic, resolved);
  return resolved;
}
export function helpLinkAt(topic: string, row: number, col?: number): HelpLink | undefined {
  return getHelpDocument(topic).links.find((entry) => entry.row === row && (col === undefined || col >= entry.col && col < entry.col + entry.length));
}
