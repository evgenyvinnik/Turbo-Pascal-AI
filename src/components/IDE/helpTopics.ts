import { COMPILER_ERROR_MESSAGES, RUNTIME_ERROR_MESSAGES } from '../../compiler/errors/diagnostics';

export interface HelpLink {
  row: number;
  col: number;
  length: number;
  target: string;
}
export interface HelpTopic {
  title: string;
  lines: string[];
  links: HelpLink[];
}

/** Authored reference text. Link markup belongs to data, never to the screen. */
export function helpTopic(title: string, paragraphs: string[]): HelpTopic {
  const lines: string[] = [];
  const links: HelpLink[] = [];
  for (const paragraph of paragraphs) {
    const markup = /^\[\[([^|]+)\|([^\]]+)\]\]$/.exec(paragraph);
    if (markup) {
      links.push({ row: lines.length, col: 1, length: markup[1]!.length, target: markup[2]! });
      lines.push(` ${markup[1]!}`);
    } else if (!paragraph || /^ /.test(paragraph)) lines.push(paragraph);
    else {
      let remaining = paragraph;
      while (remaining.length > 46) {
        const split = remaining.lastIndexOf(' ', 46);
        const at = split > 0 ? split : 46;
        lines.push(remaining.slice(0, at));
        remaining = remaining.slice(at).trimStart();
      }
      lines.push(remaining);
    }
  }
  return { title, lines, links };
}
const topic = (title: string, body: string[], links: string[] = []): HelpTopic =>
  helpTopic(title, [title, '═'.repeat(Math.min(title.length, 46)), '', ...body, '', ...links]);
const link = (label: string, target = label.toLowerCase()) => `[[${label}|${target}]]`;

export const HELP_TOPICS: Record<string, HelpTopic> = {
  contents: topic(
    'Pascal Help',
    [],
    [
      link('Language elements', 'language'),
      link('User-defined units', 'unit'),
      link('Objects', 'object'),
      link('Built-in Assembler', 'asm'),
      link('Compiler directives', 'directives'),
      link('Debugging'),
      link('DOS tools', 'tools'),
    ]
  ),
  unit: topic(
    'User-defined units',
    [
      'A unit shares declarations between source files. Put public constants, types, variables and routine headings in INTERFACE. Put private declarations and routine bodies in IMPLEMENTATION.',
      '',
      '  unit Counter;',
      '  interface',
      '  var Total: Integer;',
      '  procedure Add(Value: Integer);',
      '  implementation',
      '  procedure Add(Value: Integer);',
      '  begin',
      '    Total := Total + Value;',
      '  end;',
      '  begin',
      '    Total := 0;',
      '  end.',
      '',
      'Save this as COUNTER.PAS, then use it from a program:',
      '  program Demo;',
      '  uses Counter;',
      '  begin Add(7); WriteLn(Total) end.',
      '',
      'The optional final BEGIN section initializes the unit before the program starts. A unit initializes once, after the units on which it depends.',
      'Unit.Identifier qualifies a public name. Implementation-only declarations remain private. Interface dependencies must not form a cycle; moving a dependency to IMPLEMENTATION can remove that cycle.',
    ],
    [
      link('Uses clauses', 'uses'),
      link('Unit initialization', 'initialization'),
      link('Procedures and functions', 'routines'),
      link('Compiler errors', 'compiler-errors'),
    ]
  ),
  uses: topic(
    'USES clauses',
    [
      'USES imports declarations from named units. Unit names are case insensitive. The System unit is available implicitly.',
      '  uses Crt, Counter;',
      '  Counter.Add(1);',
      '',
      'Keep required source units on the workspace disk or in the configured unit directories. A unit must declare the same name as the one requested by USES.',
      'The interface USES clause supplies names needed by the public declarations. An implementation USES clause supplies names needed only by private code.',
      'When imported names collide, qualify the reference with its unit name. Local declarations can hide imported identifiers.',
    ],
    [
      link('User-defined units', 'unit'),
      link('Standard units', 'units'),
      link('Directories', 'directories'),
    ]
  ),
  initialization: topic(
    'Unit initialization',
    [
      'The statement part at the end of a unit runs before the main program. Use it to set shared state or prepare resources.',
      'Dependencies initialize before the unit that imports them. Repeated use of a unit does not repeat its initialization.',
      'Turbo Pascal units end with END. They do not use the Delphi FINALIZATION section.',
    ],
    [link('User-defined units', 'unit')]
  ),
  object: topic(
    'Objects and methods',
    [
      'An OBJECT combines fields and methods. Every object variable has its own field values. A method runs with an implicit Self referring to that instance.',
      '',
      '  type TCounter = object',
      '    Value: Integer;',
      '    constructor Init(Start: Integer);',
      '    procedure Add(Amount: Integer);',
      '  end;',
      '',
      '  constructor TCounter.Init(Start: Integer);',
      '  begin Value := Start end;',
      '  procedure TCounter.Add(Amount: Integer);',
      '  begin Value := Value + Amount end;',
      '',
      '  var C: TCounter;',
      '  begin C.Init(2); C.Add(3); WriteLn(C.Value) end.',
      '',
      'Define method bodies outside the object declaration, using TypeName.MethodName. A constructor prepares an instance; a destructor releases resources owned by it.',
      'An object can inherit fields and methods from one ancestor. Virtual methods let an ancestor reference call the descendant implementation.',
    ],
    [
      link('Inheritance', 'inherited'),
      link('Constructors', 'constructor'),
      link('Destructors', 'destructor'),
      link('Pointers', 'pointer'),
      link('Records', 'record'),
    ]
  ),
  inherited: topic(
    'Inheritance and virtual methods',
    [
      'Declare a descendant as OBJECT(Ancestor). Its data includes the ancestor fields, followed by its own fields.',
      '  type TChild = object(TParent)',
      '    procedure Draw; virtual;',
      '  end;',
      '',
      'A virtual call chooses the method using the instance initialized by its constructor. Initialize the object before calling virtual methods.',
      'Inside an overriding method, INHERITED invokes the corresponding ancestor operation. A nonvirtual method is selected from the declared type.',
    ],
    [link('Objects', 'object'), link('Constructors', 'constructor')]
  ),
  constructor: topic(
    'Constructors',
    [
      'A constructor is a method declared with CONSTRUCTOR. Call it on a variable, or pass it to NEW when allocating an object through a pointer.',
      '  var P: ^TCounter;',
      '  New(P, Init(10));',
      '',
      'A constructor establishes the virtual method information for the instance. Assign initial field values and acquire any resources here.',
      'A descendant constructor can call an inherited constructor before initializing its additional fields.',
    ],
    [link('Objects', 'object'), link('New', 'new'), link('Destructors', 'destructor')]
  ),
  destructor: topic(
    'Destructors',
    [
      'A destructor is a method declared with DESTRUCTOR. Use it to release resources owned by an object. Calling a destructor directly does not by itself free an object variable.',
      '  Dispose(P, Done);',
      '',
      'DISPOSE with a destructor calls that destructor and releases the object storage. Do not use the pointer afterward.',
    ],
    [link('Objects', 'object'), link('Dispose', 'dispose')]
  ),
  asm: topic(
    'Built-in Assembler',
    [
      'ASM introduces assembly statements and END closes the block. Instructions use Intel destination-first operand order.',
      '  asm',
      '    mov ax, 7',
      '    add ax, 2',
      '  end;',
      '',
      'The 16-bit registers AX, BX, CX and DX have byte halves AH/AL, BH/BL, CH/CL and DH/DL. SI, DI, BP and SP address or index storage. Arithmetic updates condition flags used by conditional jumps.',
      'MOV copies a value. ADD and SUB change it. CMP updates flags without storing a result. JMP transfers control; conditional jumps test flags. Labels identify jump targets.',
      'Pascal variables can be referenced by name from assembly. Preserve the calling convention when writing routines, especially the stack and frame registers.',
      'To compile assembly-bearing Pascal, open File DOS shell and choose Run Pascal. This uses Free Pascal in Turbo Pascal mode to build and run a native 32-bit DOS executable. It is separate from the source-step interpreter.',
    ],
    [
      link('CPU window', 'cpu'),
      link('DOS tools', 'tools'),
      link('Compiler directives', 'directives'),
    ]
  ),
  cpu: topic(
    'CPU window',
    [
      'The CPU window shows the current execution address, instructions, register state and memory. It is useful when one source statement expands to several operations.',
      'Compile a program and pause it with Trace Into before inspecting execution. Step operations update the current instruction and register values.',
      'Debug Register displays the source interpreter state. Search Find Error maps its compiled addresses to source statements. For x86 machine code, open File DOS shell and choose CPU debugger.',
      'The DOS debugger operates on real emulated x86 registers and memory. R displays registers, U disassembles, D dumps memory, A assembles, T traces, P steps over, G runs and Q exits the debugger. Source watches and Call Stack belong to the source interpreter.',
    ],
    [link('Debugging'), link('Watches', 'watches'), link('Find Error', 'finderror')]
  ),
  debugging: topic(
    'Debugging programs',
    [
      'Compile with debug information to relate execution to source lines. F7 (Trace Into) enters called routines. F8 (Step Over) runs a routine call as one source step.',
      'Ctrl+F9 runs or resumes the program. F4 runs to the cursor. Ctrl+F2 resets execution so the next run starts again.',
      'Set a breakpoint with Ctrl+F8. Execution pauses before its source statement. Conditions and pass counts can make a breakpoint stop only on selected visits.',
      'Watches are reevaluated while paused. Evaluate/Modify inspects an expression and can change an assignable variable. Call Stack shows nested procedure and function activations.',
      'Alt+F5 displays the program screen; return to the IDE to continue debugging.',
    ],
    [
      link('Watches', 'watches'),
      link('Breakpoints', 'breakpoints'),
      link('Evaluate and Modify', 'evaluate'),
      link('CPU window', 'cpu'),
      link('Run-time errors', 'runtime-errors'),
    ]
  ),
  watches: topic(
    'Watches and expressions',
    [
      'Use Debug Add Watch to keep an expression visible. Simple variables, arithmetic, array indices, fields and dereferenced pointers can be inspected in the paused scope.',
      'A watch cannot execute arbitrary program code. An unavailable local variable is out of scope when its routine is not active.',
      'Modify a variable through Evaluate/Modify when you want to test another state without restarting the program.',
    ],
    [link('Evaluate and Modify', 'evaluate'), link('Debugging')]
  ),
  breakpoints: topic(
    'Breakpoints',
    [
      'Ctrl+F8 toggles a breakpoint on the current source line. Choose a line that contains an executable statement.',
      'Use Debug Breakpoints to inspect, enable, disable or edit breakpoints. A condition must evaluate to true before execution stops. A pass count delays stopping until the configured visit.',
      'Reset starts a fresh execution; retained breakpoint locations still apply to the compiled source.',
    ],
    [link('Debugging'), link('Watches', 'watches')]
  ),
  evaluate: topic(
    'Evaluate and Modify',
    [
      'Pause execution, then enter a Pascal expression to inspect its value. Expressions use the active lexical scope, including parameters and local variables.',
      'To change state, evaluate an assignable variable and enter a new value in the modification field. Constants and temporary expression results cannot be changed.',
    ],
    [link('Watches', 'watches'), link('Debugging')]
  ),
  finderror: topic(
    'Find Error',
    [
      'Enter a segment:offset address from the current compiled program. The IDE locates the source line associated with that address.',
      'Use the same source and compiler options that produced the address. Recompiling changed source may move instruction addresses.',
      'An unmapped address produces an error instead of selecting an unrelated line.',
    ],
    [link('CPU window', 'cpu'), link('Compiler errors', 'compiler-errors')]
  ),
  tools: topic(
    'DOS tools and external programs',
    [
      'The Tools menu configures program names, command lines and shortcuts. Grep searches source text and sends navigable matches to the Messages window.',
      'The DOS Shell works with the workspace disk. File names and directories belong to that disk, not to the host operating system.',
      'The bundled DOS emulator runs .COM and .EXE programs on an emulated x86 CPU. Import files or a ZIP to install tools. The bundled DEBUG tool provides machine-code assembly and debugging. Borland TASM, TD and TPROF must be supplied separately.',
      'The DOS workspace imports your browser disk and edited source buffers. Save files or Return to IDE synchronizes changed files. EXIT or Ctrl+Alt+Esc also returns. Use Export ZIP to download DOS results.',
    ],
    [
      link('Grep', 'grep'),
      link('Command Line', 'commandline'),
      link('Directories', 'directories'),
      link('Built-in Assembler', 'asm'),
    ]
  ),
  grep: topic(
    'Grep source search',
    [
      'Grep searches files rather than only the active editor. Enter a pattern and file mask; configured tool parameters are offered as the initial command line.',
      'Select a result in Messages to open its file at the matching line. Save an editor buffer before searching its on-disk contents.',
      'Editor Find/Replace uses the editor search options. Grep has its own command-line options.',
    ],
    [link('Find text', 'find'), link('DOS tools', 'tools')]
  ),
  commandline: topic(
    'Command Line',
    [
      'The workspace DOS shell accepts commands against its virtual disk. DIR lists files, TYPE displays a text file, COPY copies files and CD changes directories. Use command help for the available switches.',
      'A command line consists of a program or command name followed by arguments. Quote paths or patterns containing spaces.',
      'Program parameters in Run Parameters are passed to ParamCount and ParamStr when running Pascal code. ParamStr(0) identifies the program.',
    ],
    [link('DOS tools', 'tools'), link('ParamStr', 'paramstr')]
  ),
  directories: topic(
    'Directories',
    [
      'Configure unit and include search paths in Options Directories. Separate directory entries with semicolons.',
      'Paths refer to files stored in the workspace. Save or import required source units and include files before compiling.',
    ],
    [link('User-defined units', 'unit'), link('Include files', '$include')]
  ),
  routines: topic(
    'Procedures and functions',
    [
      'A procedure performs an action. A function also returns a value, assigned to the function name inside its body. Routine declarations precede the statements that call them.',
      'Value parameters receive copies. VAR parameters alias the caller variable; modifying them changes the caller. Matching types are required for VAR parameters.',
      'A nested routine can access declarations in its enclosing scope. Recursion creates a new set of local variables for each call.',
      'FORWARD declares a routine header before its body is available. The later definition must agree with that declaration.',
    ],
    [
      link('VAR parameters', 'var'),
      link('Functions', 'function'),
      link('Standard routines', 'procedures'),
    ]
  ),
  var: topic(
    'VAR declarations and parameters',
    [
      'VAR introduces variable declarations. Variables have a declared type and storage for a value.',
      '  var Count: Integer;',
      '      Name: String[20];',
      '',
      'A VAR parameter refers to the caller storage. Pass an assignable variable, array element or record field. A constant or computed expression cannot be passed by reference.',
      'With strict string checking, a VAR short-string argument must have the declared capacity of the parameter. $V controls this rule.',
    ],
    [link('Procedures and functions', 'routines'), link('String type', 'string'), link('$V', '$v')]
  ),
  function: topic(
    'FUNCTION declarations',
    [
      'A function declares a result type and assigns its result through its name. It can have value, const and VAR parameters.',
      '  function Twice(X: Integer): Integer;',
      '  begin Twice := X * 2 end;',
      '',
      'Use the result in an expression, for example WriteLn(Twice(3)). The function result and local variables belong to that invocation.',
    ],
    [link('Procedures and functions', 'routines')]
  ),
  record: topic(
    'Records',
    [
      'A RECORD groups named fields. Access a field with a period. A field has the type declared in the record definition.',
      '  type TPoint = record X, Y: Integer end;',
      '  var P: TPoint;',
      '  P.X := 4;',
      '',
      'Record assignment copies the fields. WITH makes the selected record fields available without repeating the variable name.',
    ],
    [link('Arrays', 'array'), link('Objects', 'object'), link('VAR parameters', 'var')]
  ),
  array: topic(
    'Arrays',
    [
      'An ARRAY stores elements of a common type indexed by an ordinal type or subrange. Pascal array bounds need not begin at zero.',
      '  var A: array[1..10] of Integer;',
      '  A[1] := 42;',
      '',
      'An enum can be an index type. Distinct enum declarations are distinct types. Nested arrays can be indexed one dimension at a time or with comma-separated indices.',
      'With $R+ an out-of-range index stops execution. Keep loops within the declared bounds.',
    ],
    [link('Ordinal types', 'ordinal'), link('$R', '$r')]
  ),
  ordinal: topic(
    'Ordinal types',
    [
      'Integers, Boolean, Char, enumerations and subranges are ordinal types. Each value has an ordered position; Ord returns its ordinal number.',
      '  type TColor = (Red, Green, Blue);',
      '       TSmall = 1..9;',
      '',
      'Succ and Pred move to the adjacent ordinal value. Sets and array indices use ordinal types. A FOR control variable must also be ordinal.',
      'Separate enumeration declarations remain distinct even when they have the same number of members.',
    ],
    [link('Sets', 'set'), link('Arrays', 'array'), link('Integer', 'integer')]
  ),
  set: topic(
    'Sets',
    [
      'A SET records membership of ordinal values. Its base range fits within 0..255. Empty brackets denote an empty set; ranges use two dots.',
      '  var S: set of 0..15;',
      '  S := [1, 3..5];',
      "  if 4 in S then WriteLn('yes');",
      '',
      '+ is union, * is intersection and - is difference. <= and >= compare inclusion. IN tests one element for membership.',
    ],
    [link('Ordinal types', 'ordinal'), link('Expressions', 'expressions')]
  ),
  pointer: topic(
    'Pointers and dynamic storage',
    [
      'A typed pointer identifies storage of its declared target type. NIL denotes no allocated target. A caret dereferences a pointer.',
      '  type PInt = ^Integer;',
      '  var P: PInt;',
      '  New(P); P^ := 7; Dispose(P);',
      '',
      'After Dispose, the pointer no longer identifies usable storage. Allocate before dereferencing and release each allocation only once.',
    ],
    [link('New', 'new'), link('Dispose', 'dispose'), link('Objects', 'object')]
  ),
  expressions: topic(
    'Expressions and operators',
    [
      'Parentheses group operations. Multiplication, real division /, integer DIV and MOD bind more tightly than addition and subtraction. Relational operations produce Boolean values.',
      'Integer DIV truncates the quotient toward zero; MOD has the sign of the left operand. / produces a real result.',
      'AND, OR, XOR and NOT work on Booleans or compatible integer operands. SHL and SHR shift integer bits. $B controls complete or short-circuit Boolean evaluation.',
      'Use compatible operand types; an enum is not an integer for arithmetic merely because Ord can return its position.',
    ],
    [link('$B', '$b'), link('Ordinal types', 'ordinal'), link('Sets', 'set')]
  ),
  string: topic(
    'String type',
    [
      'String[capacity] stores up to 255 characters. String without a capacity means String[255]. Characters begin at index 1. S[0] is the character containing the current length.',
      '  var S: String[20];',
      "  S := 'Pascal';",
      '  WriteLn(Length(S), S[1]);',
      '',
      'Assignment to a shorter destination truncates to its capacity. Concatenation uses + or Concat. Copy extracts a substring, Pos finds one, Insert and Delete modify a variable.',
      'VAR string parameters alias the caller storage. The $V switch controls strict capacity matching; $P controls open string parameters.',
    ],
    [
      link('Length', 'length'),
      link('Copy', 'copy'),
      link('Pos', 'pos'),
      link('$V', '$v'),
      link('$P', '$p'),
    ]
  ),
  integer: topic(
    'Integer type',
    [
      'Integer is signed 16-bit: -32768..32767. Byte is 0..255, Word is 0..65535, Shortint is -128..127, and Longint is signed 32-bit.',
      'Integer arithmetic can overflow. $Q enables checking of arithmetic results; $R checks assignment and index ranges.',
      'Use a sufficiently wide type for intermediate calculations as well as the destination.',
    ],
    [link('$Q', '$q'), link('$R', '$r'), link('Ordinal types', 'ordinal')]
  ),
  find: topic(
    'Find text',
    [
      'Find searches the active editor. Case sensitive and whole-word options restrict matches. Choose forward or backward direction, global or selected-text scope, and cursor or entire-scope origin.',
      'Regular expressions support ^, $, ., *, +, character classes and backslash escapes. Parentheses, braces, ? and | have their literal meaning in this search syntax.',
      'Search Again repeats the accepted settings. Cancelling the Find dialog preserves the previous search.',
    ],
    [link('Replace text', 'replace'), link('Grep', 'grep')]
  ),
  replace: topic(
    'Replace text',
    [
      'Replace uses the same direction, scope, origin and matching options as Find. OK replaces one match; Change All continues through the chosen scope.',
      'With Prompt on Replace, Yes changes the current match, No skips it and Cancel stops. Accepted replacements remain applied and can be undone together.',
      'The replacement is literal text. Dollar signs do not expand special JavaScript replacement patterns.',
    ],
    [link('Find text', 'find'), link('Editor commands', 'editor-commands')]
  ),
  'editor-commands': topic(
    'Editor commands',
    [
      'Arrow keys move the caret. Home and End move within the line; Ctrl+Home and Ctrl+End move to document boundaries. Hold Shift to select text.',
      'Undo restores an edit or a grouped replacement. Ctrl+Y deletes the current line and can be undone.',
      'Use File Save to write the active source, Save As for another name, and File Open to select saved workspace files. Browser workspace storage preserves progress across reloads.',
    ],
    [link('Find text', 'find'), link('Replace text', 'replace'), link('Using windows', 'windows')]
  ),
  windows: topic(
    'Using windows',
    [
      'F6 selects the next window. F5 zooms or restores the active window. Alt+F3 closes it. Drag a title bar to move a window, or its lower-right corner to resize it.',
      'The Window menu also tiles, cascades and lists open windows. Help, Watches, Output and Messages share the desktop with source editors.',
    ],
    [link('Editor commands', 'editor-commands'), link('Debugging')]
  ),
  menus: topic(
    'Menus and hot keys',
    [
      'F10 activates the menu bar. Alt plus the highlighted letter opens a menu. Arrow keys move through its items; Enter chooses one; Escape closes the menu.',
      'F1 opens context help. Shift+F1 opens the index, Ctrl+F1 looks up the editor word, and Alt+F1 returns to the previous topic.',
      'In Help, Tab moves to the next link and Shift+Tab to the previous one. Enter follows it. Arrow Left/Right selects another link on a row. Page Up/Down scroll the text.',
    ],
    [link('Using windows', 'windows'), link('Editor commands', 'editor-commands')]
  ),
  samples: topic(
    'Sample programs',
    [
      'Open HELLO.PAS for text input and output, or SQUARE.PAS for procedures and stepping. Compile with F9, dismiss the compilation result and run with Ctrl+F9.',
      'The examples in the Units and Objects topics are small enough to type into new source files. Save a unit with the same name as its UNIT heading.',
    ],
    [link('User-defined units', 'unit'), link('Objects', 'object'), link('Debugging')]
  ),
  glossary: topic(
    'Glossary',
    [
      'Scope: the region where an identifier is visible.',
      'Ordinal: a type whose values have an ordered position.',
      'Lvalue: a reference to assignable storage.',
      'Unit: a source module with public and private sections.',
      'Object: fields and methods combined in one type.',
      'Breakpoint: a place where execution can pause.',
      'Watch: an expression reevaluated while debugging.',
    ],
    [link('Language elements', 'language')]
  ),
};

const routines: [string, string, string[], string[]][] = [
  [
    'writeln',
    'WriteLn([F,] Value[:Width[:Decimals]], ...);',
    [
      'Writes values to a text file or the screen, then starts a new line. With no values it writes only the newline.',
    ],
    ['write', 'readln'],
  ],
  [
    'write',
    'Write([F,] Value[:Width[:Decimals]], ...);',
    [
      'Writes values without starting a new line. Width is a minimum field width; real values can specify a decimal count.',
    ],
    ['writeln'],
  ],
  [
    'readln',
    'ReadLn([F,] Variable, ...);',
    [
      'Reads values and advances to the next line. With no variables it consumes the rest of the input line. On the interactive screen it waits for Enter.',
    ],
    ['read', '$i'],
  ],
  [
    'read',
    'Read([F,] Variable, ...);',
    [
      'Reads into variables. Numeric input skips leading whitespace. Read does not discard the remaining line after reading its arguments.',
    ],
    ['readln', '$i'],
  ],
  [
    'clrscr',
    'ClrScr;  { Crt }',
    ['Clears the current text window and moves its cursor to the upper-left corner.'],
    ['crt'],
  ],
  [
    'length',
    'Length(S)',
    [
      'Returns the current number of characters in a short string. The declared capacity can be larger.',
    ],
    ['string'],
  ],
  [
    'copy',
    'Copy(S, Index, Count)',
    [
      'Returns up to Count characters starting at the one-based Index. Reading beyond the available characters shortens the result.',
    ],
    ['string', 'pos'],
  ],
  [
    'pos',
    'Pos(SubString, S)',
    ['Returns the one-based position of the first match, or zero if there is no match.'],
    ['string', 'copy'],
  ],
  [
    'insert',
    'Insert(Source, Destination, Index);',
    [
      'Inserts Source into a string variable at the one-based Index. The result fits the capacity of Destination.',
    ],
    ['string', 'delete'],
  ],
  [
    'delete',
    'Delete(S, Index, Count);',
    ['Removes up to Count characters from string variable S starting at Index.'],
    ['string', 'insert'],
  ],
  [
    'new',
    'New(P);',
    [
      'Allocates storage for the target type of pointer P. Object allocations may also specify a constructor call.',
    ],
    ['pointer', 'constructor', 'dispose'],
  ],
  [
    'dispose',
    'Dispose(P);',
    [
      'Releases storage allocated with New. Object disposal may specify a destructor. Do not dereference or release that allocation again.',
    ],
    ['pointer', 'destructor', 'new'],
  ],
  [
    'ioresult',
    'IOResult',
    [
      'Returns and clears the pending I/O status. Zero means success. With $I-, check it immediately after a file operation; a pending error can prevent later I/O operations.',
    ],
    ['$i', 'runtime-errors'],
  ],
  [
    'paramstr',
    'ParamStr(Index)',
    [
      'Returns a command-line argument. Index zero is the program name; indices 1..ParamCount address user arguments. Set the command line with Run Parameters.',
    ],
    ['commandline'],
  ],
  [
    'assign',
    'Assign(F, Name);',
    [
      'Associates a file variable with a filename. It does not open the file. Follow with Reset, Rewrite or Append.',
    ],
    ['reset', 'rewrite', 'file'],
  ],
  [
    'reset',
    'Reset(F[, RecordSize]);',
    [
      'Opens an existing file. Text files open for input. Typed or untyped files use FileMode to choose access.',
    ],
    ['assign', 'rewrite', '$i'],
  ],
  [
    'rewrite',
    'Rewrite(F[, RecordSize]);',
    ['Creates or truncates a file. For text, subsequent Write and WriteLn operations write to it.'],
    ['assign', 'close', '$i'],
  ],
  [
    'close',
    'Close(F);',
    [
      'Closes an open file and completes pending output. Check IOResult when I/O checking is disabled.',
    ],
    ['file', '$i'],
  ],
];
for (const [name, syntax, body, related] of routines)
  HELP_TOPICS[name] = topic(
    `${name[0]!.toUpperCase()}${name.slice(1)} routine`,
    [syntax, '', ...body],
    related.map((name) => link(name, name))
  );

const switches: Record<string, [string, string[]]> = {
  b: [
    'Boolean evaluation',
    [
      'With $B- Boolean AND and OR can skip the right operand once the result is known. $B+ evaluates both operands. This matters when the right operand calls a function or might cause an error.',
    ],
  ],
  i: [
    'I/O checking',
    [
      'With $I+ a failed file or input operation stops execution with a run-time error. With $I- inspect IOResult to handle failures yourself. Calling IOResult also clears the status.',
    ],
  ],
  q: [
    'Overflow checking',
    [
      'With $Q+ an arithmetic result outside the operation type raises run-time error 215. $Q- allows the unchecked integer result. This differs from checking an assignment or array index.',
    ],
  ],
  r: [
    'Range checking',
    [
      'With $R+ assignments to subranges and array indices are checked against the target bounds. A failure raises run-time error 201. $R- disables those language checks.',
    ],
  ],
  s: [
    'Stack checking',
    [
      '$S controls the original compiler stack-overflow checks on routine entry. The browser runtime retains execution limits to prevent unbounded recursion from exhausting the host.',
    ],
  ],
  v: [
    'Strict VAR strings',
    [
      '$V+ requires a VAR string argument to match the parameter capacity. $V- allows differing string capacities. In both cases the argument aliases the caller storage.',
    ],
  ],
  p: [
    'Open string parameters',
    [
      '$P+ makes an unqualified String parameter an open string parameter, accepting differing capacities. $P- treats it as the ordinary declared string type.',
    ],
  ],
  x: [
    'Extended syntax',
    [
      '$X enables extended expression syntax, including calls to functions whose results are not used. It also controls the original extended character-pointer handling.',
    ],
  ],
  n: [
    'Numeric coprocessor',
    [
      '$N selects the original numeric coprocessor mode and the availability of coprocessor numeric types. A browser numeric representation does not reproduce physical 80x87 hardware.',
    ],
  ],
  d: [
    'Debug information',
    [
      '$D controls generation of information relating executable operations to source statements. Debugging and Find Error use source locations.',
    ],
  ],
  l: [
    'Local symbol information',
    [
      '$L controls local symbol information in the original compiler. The form $L filename requests linkage of an object file; it is different from the $L+/- switch.',
    ],
  ],
  g: [
    '80286 instructions',
    [
      '$G+ permits 286/287 instructions in the original compiler. This changes machine requirements for a DOS executable.',
    ],
  ],
  a: [
    'Data alignment',
    [
      '$A controls word alignment of fields and variables in the original 16-bit memory model. Packed data and external binary interfaces require careful layout.',
    ],
  ],
  f: [
    'Far calls',
    [
      '$F controls the default distance of routine calls in the original segmented executable. Browser execution does not use real-mode segment addresses.',
    ],
  ],
};
for (const [letter, [label, body]] of Object.entries(switches))
  HELP_TOPICS[`$${letter}`] = topic(
    `$${letter.toUpperCase()} - ${label}`,
    [
      `{$${letter.toUpperCase()}+} enables; {$${letter.toUpperCase()}-} disables.`,
      '',
      ...body,
      'Source directives take effect where they occur. Initial settings come from Compiler Options.',
    ],
    [link('Compiler directives', 'directives')]
  );
HELP_TOPICS['$include'] = topic(
  'Include files',
  [
    '{$I filename} or {$INCLUDE filename} inserts another source file into compilation. This is different from the $I+/- I/O switch.',
    'Keep included files in the workspace or configured include directories. Include files are source text, not separately initialized modules.',
  ],
  [link('User-defined units', 'unit'), link('Directories', 'directories')]
);
HELP_TOPICS['$define'] = topic(
  'Conditional compilation',
  [
    '{$DEFINE Name} defines a conditional symbol; {$UNDEF Name} removes it. {$IFDEF Name} and {$IFNDEF Name} select text through an optional {$ELSE} and a matching {$ENDIF}.',
    '{$IFOPT R+} tests a compiler switch. Excluded text does not participate in compilation. Nest conditions carefully and close every active conditional block.',
  ],
  [link('Compiler directives', 'directives')]
);
HELP_TOPICS['compiler-errors'] = topic(
  'Compiler error messages',
  [
    'A compiler error prevents execution. The IDE reports the source file and line. Fix the first error before interpreting later problems.',
    'Numbered messages use known Turbo Pascal diagnostic codes. Additional detail identifies the actual name or type involved. Browser implementation limits remain explicit rather than borrowing an unrelated error number.',
    '',
    ...Object.entries(COMPILER_ERROR_MESSAGES).map(([code, text]) => `${code.padStart(3)} ${text}`),
  ],
  [link('Run-time errors', 'runtime-errors'), link('Language elements', 'language')]
);
HELP_TOPICS['runtime-errors'] = topic(
  'Run-time error messages',
  [
    'A run-time error occurs after successful compilation. Examine the reported source position and input values. Fix the cause or, for I/O errors, use $I- and IOResult to handle the failure.',
    '',
    ...Object.entries(RUNTIME_ERROR_MESSAGES).map(([code, text]) => `${code.padStart(3)} ${text}`),
  ],
  [link('$I', '$i'), link('Compiler errors', 'compiler-errors'), link('Debugging')]
);
HELP_TOPICS.file = topic(
  'Files',
  [
    'A Text file reads and writes characters and lines. File of T stores typed records; an untyped File uses BlockRead and BlockWrite.',
    'Assign selects the filename; Reset opens existing data, Rewrite creates or truncates it, and Close finishes access. Use Eof and Eoln to test input boundaries.',
    'Files live on the workspace disk. Use $I- with IOResult when an expected failure should not stop execution.',
  ],
  [
    link('Assign', 'assign'),
    link('Reset', 'reset'),
    link('Rewrite', 'rewrite'),
    link('Close', 'close'),
    link('$I', '$i'),
  ]
);
const unitDescriptions: Record<string, string> = {
  system:
    'System supplies fundamental types, arithmetic, strings, allocation and standard input/output. It is available without a USES clause.',
  crt: 'Crt supplies text-screen control and interactive keyboard routines: ClrScr, GotoXY, TextColor, TextBackground, ReadKey and KeyPressed.',
  dos: 'Dos supplies operating-system services such as directories, environment values and file searches. In the browser these services use the workspace runtime.',
  graph:
    'Graph supplies BGI-style graphics. Initialize graphics before drawing and use CloseGraph to return to text mode. Coordinates refer to the graphics screen.',
  printer:
    'Printer provides the Lst text file in Turbo Pascal. A browser has no direct DOS printer port; printing requires the supported browser output path.',
  strings:
    'Strings supplies null-terminated character-array routines such as StrLen and StrCopy. These differ from Pascal length-prefixed short strings.',
  objects:
    'The Objects unit is the original reusable object library for collections and streams. It is distinct from the OBJECT language construct.',
};
for (const [name, body] of Object.entries(unitDescriptions))
  HELP_TOPICS[name] = topic(
    `${name[0]!.toUpperCase()}${name.slice(1)} unit`,
    [body],
    [
      link('Standard units', 'units'),
      link('User-defined units', 'unit'),
      link('Objects and methods', 'object'),
    ]
  );
