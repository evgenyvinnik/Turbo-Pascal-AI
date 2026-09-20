# Turbo Pascal IDE

A web-based recreation of the classic Turbo Pascal V7 IDE, bringing the authentic DOS development experience to modern browsers.

![Turbo Pascal](https://img.shields.io/badge/Turbo%20Pascal-V7-blue)
![React](https://img.shields.io/badge/React-19-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Authentic DOS UI**: IBM VGA bitmap rendering, with direct comparisons to the original screenshot gallery
- **Pascal Compiler**: Type-checked Pascal compiled to executable P-machine bytecode
- **P-Machine VM**: Execute Pascal programs in the browser
- **Program runtime**: Console input, CRT video memory, VGA graphics, sound, delays, and persistent virtual files
- **Source debugger**: Trace, step over, go to cursor, conditional breakpoints, watches, call stack, and evaluate/modify
- **Native DOS tools**: Real x86 execution, DEBUG/DEBUGX, and a browser-hosted Free Pascal compiler for assembly programs
- **Help**: Linked language, library, IDE, and diagnostic topics with keyboard navigation
- **Offline Support**: PWA caching for the IDE; the DOS runtime and compiler load on demand
- **Multi-language**: English, German, and Russian translations

## Screenshots

The interface is transcribed from the screenshot gallery at
[Museum of UI](https://ui.codexpanse.com/turbo-pascal-71.html): menu items,
shortcuts, hint lines, dialog layouts and the VGA colour attributes all come
from those images, sampled cell by cell.

Everything is painted into a single 80x25 character grid of 9x16 pixel cells,
the way the original wrote into VGA text memory. A bundled IBM VGA bitmap
character set renders the 720x400 screen directly to canvas, including the
ninth pixel column that joins borders and shade patterns. Nearest-neighbor
scaling keeps the pixels sharp as the screen fits the window. It does not
depend on installed fonts, web fonts, or browser text rasterization; the text
is also retained in the DOM for accessibility and interaction tests.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/turbo-pascal-ide.git
cd turbo-pascal-ide

# Install dependencies
bun install

# Start development server
bun run dev
```

Open http://localhost:3000 in your browser.

### Building for Production

```bash
bun run build
bun run preview
```

## Usage

### Writing Pascal Code

1. Create a new file with File → New
2. Write your Pascal program
3. Compile with Alt+F9, or Make with F9
4. Run with Run → Run (Ctrl+F9)

Dismiss the successful compile box to start execution. Output appears in the
Output window. When the program calls `Read` or `ReadLn`, the Program input
dialog accepts a line; press Enter to submit it. A bare `ReadLn` also waits
for Enter. Use Escape in that dialog or Ctrl+F2 to stop execution. Running
programs yield to the browser between instruction batches, including loops.
Use F5 to enlarge the Output window, and Home/End, arrow keys, or Page Up/Down
to review its contents. CRT and Graph programs use a separate program screen;
Alt+F5 switches between that screen and the IDE. Input works on the program
screen, including single-key `ReadKey`. `Delay` yields without freezing the IDE.

F7 traces into source routines, F8 steps over them, and F4 runs to the cursor.
The Debug menu toggles source breakpoints and opens live watches, stack frames,
and Evaluate/Modify. Breakpoints can have conditions and pass counts. The CPU
window displays the P-machine instruction stream and registers. The DOS workspace
has a separate CPU debugger for actual x86 code. Editing source
invalidates its paused session so subsequent runs compile the current buffer.

Alt+F10 or a right-click opens the editor's local menu. In an input with a
history arrow, press Down or click the arrow to recall previous entries.
Shift+F2 opens Grep's argument dialog: enter a regular expression and filename
mask, such as `writeln *.pas`, to search open buffers, virtual files, and bundled
samples. Select a result in Messages and press Enter to visit its source;
Alt+F7 and Alt+F8 move between results.

### Example Program

```pascal
program HelloWorld;
begin
  WriteLn('Hello, World!');
end.
```

## Keyboard Shortcuts

The original Turbo Pascal key assignments:

| Shortcut | Action |
|----------|--------|
| F1 | Context help |
| Ctrl+F1 | Help for the identifier at the cursor |
| Shift+F1 | Help index |
| Alt+F1 | Previous help topic |
| F2 | Save |
| F3 | Open |
| F4 | Go to cursor |
| F5 | Zoom window |
| F6 | Next window |
| F7 | Trace into |
| F8 | Step over |
| F9 | Make |
| F10 | Menu bar |
| Alt+F9 | Compile |
| Ctrl+F9 | Run |
| Ctrl+F2 | Stop/reset the running program |
| Alt+F3 | Close window |
| Alt+F5 | User screen |
| Ctrl+F3 | Call stack |
| Ctrl+F7 | Add watch |
| Alt+0 | Window list |
| Alt+F10 | Editor local menu |
| Shift+F2 | Search source files with Grep |
| Alt+X | Exit |
| Alt+*letter* | Open that menu |

## Project Structure

```
src/
├── tui/               # Text-mode engine: palette, CP437 glyphs, cell buffer
├── compiler/          # Pascal compiler
│   ├── lexer/         # Tokenizer
│   ├── parser/        # AST parser
│   ├── codegen/       # Bytecode generator
│   ├── runtime/       # P-machine VM
│   └── stdlib/        # Standard library (CRT, Graph)
├── components/        # Painters that draw into the cell buffer
├── stores/            # Zustand state management
├── services/          # IndexedDB persistence
└── i18n/              # Internationalization
```

## Technology Stack

- **Frontend**: React 19 with React Compiler
- **Styling**: StyleX for CSS-in-JS
- **State**: Zustand with Immer
- **Storage**: IndexedDB via Dexie
- **Routing**: TanStack Router
- **Build**: Vite + Bun
- **Testing**: Vitest + Playwright

## Browser Workspace

Zustand holds the live IDE state. Changes automatically save a versioned,
transactional workspace snapshot to IndexedDB (`TurboPascalIDE`, `workspaces`,
`active`). Reloading restores open files, unsaved text, undo/redo, selection,
cursor and scroll positions, window layout, clipboard, IDE options, search and
input histories, breakpoint definitions, watch expressions, and text output.
Closing every window also persists an empty desktop. The editor waits for
restoration before accepting input or file drops.

Programs reopen stopped: the VM, compiled bytecode, call stack, registers,
execution highlight and watch values are recreated when you run again. Autosave
does not clear a file's modified marker; F2 still saves the source file to the
virtual drive, which retains its existing localStorage storage.

A failed workspace write preserves the last committed snapshot and current
editor contents. The status line reports the failure; another edit,
Ctrl+Shift+S, or clicking that status line retries. A failed initial read keeps
the editor gated until Ctrl+Shift+S can restore it. Malformed snapshots are
retained under a `recovery:<uuid>` key before starting a fresh workspace;
future schema versions are never overwritten. The database upgrade preserves
the existing file, settings, session and breakpoint tables.

Storage belongs to this browser profile and origin (including the port), with
one shared workspace per origin. If another tab saves newer changes, autosave
stops with a conflict message. Ctrl+Shift+S explicitly keeps the current tab's
workspace and atomically preserves the other version under a `recovery:<uuid>`
key before replacing it. Ordinary edits never overwrite that conflict.
Clearing site data clears the workspace, and private browsing may remove it
when the session ends. Keep downloaded copies of files you need outside this
browser.

## Compiler Details

The compiler and stack-based virtual machine are based on
[lkesteloot/turbopascal](https://github.com/lkesteloot/turbopascal). Parsed Pascal
source is checked and compiled to P-machine bytecode, which executes locally
in the browser. Compile errors identify the source line; runtime errors such
as division by zero and invalid numeric input retain their source location.

The bundled HELLO, FIBONACCI, PRIMES, and SQUARE programs exercise console
output, typed input, arithmetic, loops, conditions, and procedures with `var`
parameters. Browser execution has a five-million-instruction limit and a
bounded output buffer to keep runaway programs recoverable.

Supported constructs include scalar values, constants, aliases, enums,
subranges, fixed arrays, records, nested and recursive routines, value and
`var` parameters, `for`/`while`/`repeat`, `if`/`case`, `Break`/`Continue`/`Exit`,
formatted output, and the registered math, ordinal, and string functions.
The former unsupported categories now execute:

- **Units:** source units with interface/implementation sections, private declarations, qualified names, dependencies, and ordered initialization. Compilation resolves unsaved buffers and the virtual drive, including configured unit/include directories. Units can compile independently; run a program that uses them to execute initialization. Source errors, breakpoints, and watches retain the originating unit/include file.
- **Objects:** fields, inheritance, virtual methods, constructors/destructors, `Self`, `inherited`, private members, constructor `Fail`, `New`/`Dispose`, and object value assignment. FAR procedural variables support callbacks, signature checks, and nil/`Assigned`.
- **Sets and records:** set constructors, ranges, membership, union/intersection/difference, comparisons, and `with` scopes.
- **Pointers and control flow:** typed pointers, recursive records, address-of, `New`/`Dispose`, nil checks, labels, and local/nonlocal `goto`.
- **Strings and sizes:** short-string capacities, length byte `s[0]`, `Delete`, `Insert`, `Str`, `Val`, and Pascal byte sizes from `SizeOf`.
- **Files:** text, typed, and untyped files; `Assign`, `Reset`, `Rewrite`, `Append`, `Close`, `Seek`, `FilePos`, `FileSize`, `Eof`/`Eoln`, `Truncate`, `Erase`, `Rename`, and `BlockRead`/`BlockWrite`. Typed and untyped files share little-endian binary encoding, including six-byte Real values. `{$I-}` and `IOResult` support recoverable file and console-input errors.
- **CRT:** cursor positioning, windows, colors, clearing, line insertion/deletion, scrolling, text modes, keyboard input, sound, and nonblocking delays.
- **Graph:** a palette-index VGA framebuffer with pixels, lines, rectangles, bars, arcs/ellipses, sectors, flood fills, viewports, line/fill styles, and bitmap/stroke text. The default font is the IBM 8×8 bitmap. Non-default fonts load `.CHR` files from the virtual drive using the path supplied to `InitGraph`; original Borland font files are not bundled. `SetUserCharSize` supports custom stroke scaling.
- **DOS:** date/time getters and setters use a virtual clock; environment values and disk-capacity queries refer to the virtual DOS environment.

`Byte`, `ShortInt`, `Word`, `Integer`, and `LongInt` retain their Pascal widths.
Integer expression promotion and overflow follow those widths, including
`{$Q+}` arithmetic checks. Default `Real` uses six-byte Real48 precision and
range; arithmetic rounds before later operations, and math/input results are
quantized to Real48. Pascal strings contain CP437 bytes; browser input and
source literals convert at the boundary, preserving numeric character codes.

The virtual drive is local to this browser, case-insensitive, and limited to
8 MiB. It persists between runs and reloads. Drop files onto the IDE to import
them: UTF-8 `.pas` files open in the editor, while data and `.CHR` font files
retain their original bytes under their filenames. Use `Assign(f, 'data.txt')`
for imported data or an empty `InitGraph` path for fonts imported at the root.
Imports are atomic and subject to browser storage capacity; rename conflicting
filenames to keep both copies. A failed batch preserves existing files.
Pascal programs cannot access the
host filesystem or change the host clock. Source printing uses the browser's
print dialog; the original DOS printer-filter settings are retained as UI
preferences. Graph emulates VGA modes 640×200, 640×350, and 640×480; unsupported
drivers report a graphics error.

### Compiler switches and includes

The P-machine implements `$B`, `$R`, `$V`, `$P`, `$I`, `$Q`, and `$F`, with
Turbo Pascal defaults (`B- R- V+ P- I+ Q- F-`). The Compiler Options dialog
sets their initial values; source directives override them at the relevant
expression, call, or declaration. `$B-` short-circuits Boolean expressions;
integer bit operations remain eager. `$R+` checks ordinal stores and array
bounds; unchecked stores retain the destination integer width. `$V-` relaxes
VAR string capacity matching. `$P+` makes bare VAR String parameters open,
with the caller's capacity available through `High` and `SizeOf`.

`{$I filename}`/`{$INCLUDE filename}`, `DEFINE`, `UNDEF`, `IFDEF`, `IFNDEF`,
`IFOPT`, `ELSE`, and `ENDIF` are processed before parsing. Includes preserve
original diagnostic filenames and line numbers. Conditional defines and
unit/include search paths also come from the saved IDE options.

### Native DOS and assembly

File → DOS shell opens a local DOS emulator. Import `.COM`, `.EXE`, data files,
or ZIP archives; commands run real x86 instructions. The Examples button adds
an original Hello program and a DEBUG script that assembles, traces, and saves
a COM executable. CPU debugger opens DEBUG (or DEBUGX for DPMI programs): use
`R` for registers, `U` for disassembly, `D` for memory, `A` to assemble, `T` to
step, `P` to step over, and `Q` to quit. Save files, Return to IDE, `EXIT`, or
Ctrl+Alt+Esc reconcile DOS file changes with the browser drive. Export ZIP
provides a downloadable copy. Concurrent edits retain both versions.

Programs containing assembly automatically open native compilation when
compiled or run from the IDE. Run Pascal in the DOS workspace can also compile
an ordinary Pascal program. The bundled Free Pascal 3.2.2 compiler runs under
DOSBox-X with a Pentium profile and emits real **32-bit GO32v2/DPMI executables**
in Turbo Pascal language mode. IDE I/O, range, overflow, Boolean, string, define,
and search-path options are forwarded; source directives can override defaults.
A failed compile never runs an older executable. Native compiler/tool files
live on a separate drive and do not consume the user drive's 8 MiB allowance.

Options → Tools controls menu labels, command lines, and the first four
Shift+F2–F5 shortcuts. Grep runs the browser source search; other configured
commands run in DOS. Import any separately licensed tools you want to invoke.
Original Borland TASM, Turbo Debugger, Turbo Profiler, compiler, and Help binaries
are not bundled. The open-source assembler, debugger, and compiler have their
own interfaces and licenses; see [DOS distribution notices](public/dos/licenses/README.txt).

### Compatibility boundaries

This is not binary-identical Turbo Pascal 7. P-machine addresses, object VMTs,
procedural pointers, and debugger registers are its own representation. Native
Free Pascal output is 32-bit, not Borland's 16-bit EXE/TPU format; original
16-bit assembly, raw `Inline` bytes, memory layouts, and hardware-dependent
programs may need porting or an imported original toolchain. The native DOS
emulator can execute imported 16-bit programs, but does not make the two Pascal
compilers ABI-compatible.

The P-machine does not implement arbitrary pointer reinterpret casts, typed
procedural constants, original overlay/linker formats, `.BGI` loading, or all
compiler switches. In particular `$T`, `$X`, alignment, overlay, 8087, and code
generation options are retained as IDE preferences without full VM semantics.
The VM always enforces its memory/instruction limits. Extended/Comp arithmetic
is not emulated; transcendental math uses JavaScript functions with Real48
rounding. Debugger expressions inspect data, operators, and selected pure
built-ins; they do not execute user routines. Help is newly authored, and
recognized diagnostics use Borland numbers while preserving explanatory detail;
implementation-specific errors remain explicitly unnumbered.

## Testing

```bash
bun run test          # Vitest unit tests
bun run test:reference # Independent Free Pascal comparison (requires fpc)
bun run test:e2e      # Playwright behaviour + visual suites
bun run test:visual   # Only the pixel snapshots
bun run test:e2e:update  # Refresh the snapshot baselines
bun run fidelity:fetch  # Download the Museum of UI reference screenshots
bun run test:fidelity   # Compare cell layouts and exact rendered gallery pixels
bun run fidelity:report # Generate the complete 117-image comparison report
```

The Pascal suite includes a deterministic reference corpus shared by Vitest and
`test:reference`: curated programs, invalid programs that must produce a Pascal
diagnostic, and 32 seeded programs combining sorting, overlapping sets, and
signed arithmetic. The reference runner compiles and executes the same sources
with Free Pascal in [Turbo Pascal compatibility mode](https://www.freepascal.org/docs-html/user/userse33.html)
and the browser VM, comparing output lines and compile acceptance. It also checks
independently specified expected results, so agreement between two wrong results
cannot pass. It normalizes line endings; it does not assert binary stdout equality
or complete compatibility with the original Borland compiler. Native word-size,
Real48 ABI, hardware and unsupported dialect features are outside this corpus.

Install [Free Pascal](https://www.freepascal.org/download.html) separately for the
reference command. `FPC_BIN` selects a compiler executable; `FPC_FLAGS_JSON` accepts
a JSON array of additional arguments (for example, unit and SDK paths for an
isolated compiler installation). Missing compilers, compilation failures, runtime
timeouts, output mismatches, and source changes fail the run. Evidence is written
to `artifacts/verification/pascal-reference.json`, or `PASCAL_REFERENCE_REPORT`.
Use `PASCAL_REFERENCE_FILTER` for a focused case-name substring.
An interrupted or failed attempt invalidates the prior result. Ordinary Vitest
runs execute the same corpus without requiring an installed native compiler.

IDE browser regressions exercise whole-word/backward/wrapped/scoped search,
the documented Borland regular-expression syntax, replacement prompts and
Undo/Redo, clipboard and line deletion, file-picker columns and paging,
Grep arguments and results, primary files, saved option filenames, compiler
I/O/overflow settings, and debugger evaluation errors. Compiler source directives
override the initial IDE I/O and overflow settings without changing source lines.
Grep uses configured arguments as editable defaults; configured external tools
run inside the browser DOS workspace. Additional regressions cover units, objects,
compiler switches, Help navigation, actual COM instructions, DEBUG register
results, native inline assembly, and stale-executable protection.

Visual snapshots run in Chromium at a 720x400 viewport so one CSS pixel is one
VGA pixel, which makes the baselines directly comparable to the reference
gallery. The fidelity suite compares against those original reference images,
separately from the updateable regression snapshots. Exact RGB comparisons
catch wrong glyphs, antialiasing, and broken border joins that cell-color
checks alone cannot detect. Any content excluded from a pixel comparison is
documented in that test's mask; screenshots and pixel diffs are attached on
failure. For a static build, start `bun run preview -- --port 4194` and set
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:4194` when running browser tests. Use
`--reporter=line` to avoid report writes triggering dev-server reloads.

The [gallery report workflow](tests/e2e/fidelity/REPORT.md) generates
`artifacts/fidelity-report/index.html`, with side-by-side images, an overlay
wipe, raw pixel diffs, explicit masks and coverage for all 117 gallery images.
Missing or partial subjects remain visible and labeled. Captures record source
hashes, so edits during capture invalidate that evidence rather than silently
mixing revisions. The report can be opened through the dev server at
`/artifacts/fidelity-report/index.html`.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `bun run test`
5. Submit a pull request

## License

Application source: MIT License — see [LICENSE](LICENSE). Bundled DOS runtimes
and tools have separate GPL, modified LGPL, MIT, and other notices described in
[the DOS distribution manifest](public/dos/licenses/README.txt).

## Acknowledgments

- [lkesteloot/turbopascal](https://github.com/lkesteloot/turbopascal) - Original JavaScript Pascal compiler
- Borland International - Original Turbo Pascal IDE
- [VileR's VGA font archive](https://github.com/viler-int10h/vga-text-mode-fonts) - Preserved IBM VGA character bitmap; see [font provenance](src/tui/FONT-NOTICE.md)
- The Turbo Pascal community for preserving computing history

## Related Projects

- [Free Pascal](https://www.freepascal.org/) - Open source Pascal compiler
- [Lazarus](https://www.lazarus-ide.org/) - Free Pascal IDE
- [DOSBox](https://www.dosbox.com/) - DOS emulator
