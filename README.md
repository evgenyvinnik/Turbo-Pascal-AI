# Turbo Pascal IDE

A web-based recreation of the classic Turbo Pascal V7 IDE, bringing the authentic DOS development experience to modern browsers.

![Turbo Pascal](https://img.shields.io/badge/Turbo%20Pascal-V7-blue)
![React](https://img.shields.io/badge/React-19-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Authentic DOS UI**: Pixel-perfect recreation of the Turbo Pascal V7 interface
- **Full Pascal Compiler**: Complete Pascal compiler ported to TypeScript
- **P-Machine VM**: Execute Pascal programs in the browser
- **Graphics Support**: EGA 16-color graphics with Graph unit
- **CRT Unit**: Console I/O with colors and keyboard input
- **Offline Support**: PWA with full offline functionality
- **Multi-language**: English, German, and Russian translations

## Screenshots

The interface is transcribed from the screenshot gallery at
[Museum of UI](https://ui.codexpanse.com/turbo-pascal-71.html): menu items,
shortcuts, hint lines, dialog layouts and the VGA colour attributes all come
from those images, sampled cell by cell.

Everything is painted into a single 80x25 character grid of 9x16 pixel cells,
the way the original wrote into VGA text memory, so the whole IDE is 720x400
and scales to fit the window.

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

1. Create a new file with File → New (Ctrl+N)
2. Write your Pascal program
3. Compile with Compile → Build (F9)
4. Run with Run → Run (Ctrl+F9)

### Example Program

```pascal
program HelloWorld;
begin
  WriteLn('Hello, World!');
end.
```

### Graphics Example

```pascal
program GraphicsDemo;
uses Graph;
var
  gd, gm: Integer;
begin
  gd := Detect;
  InitGraph(gd, gm, '');
  SetColor(Yellow);
  Circle(320, 240, 100);
  ReadLn;
  CloseGraph;
end.
```

## Keyboard Shortcuts

The original Turbo Pascal key assignments:

| Shortcut | Action |
|----------|--------|
| F1 | Help contents |
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
| Alt+F3 | Close window |
| Alt+F5 | User screen |
| Ctrl+F3 | Call stack |
| Ctrl+F7 | Add watch |
| Alt+0 | Window list |
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

## Compiler Details

The Pascal compiler is a TypeScript port of [lkesteloot/turbopascal](https://github.com/lkesteloot/turbopascal), featuring:

- Complete Turbo Pascal 7 syntax support
- P-machine bytecode generation
- Stack-based virtual machine
- Support for standard units (System, CRT, Graph)

### Known gap

Code generation does not run yet. The parser emits nodes carrying a string
`type` field, while `codegen/Compiler.ts` switches on a numeric `nodeType` and
expects semantic annotations (`symbolLookup`, `expressionType`, `symbolTable`)
that no pass produces. Every compile therefore fails with
`can't compile unknown node undefined`, and the IDE shows that message in its
red error banner. Lexing and parsing work, so syntax errors are reported
correctly. Three Playwright tests covering the success path are marked
`test.fixme` until the two halves agree on one AST.

## Testing

```bash
bun run test          # Vitest unit tests
bun run test:e2e      # Playwright behaviour + visual suites
bun run test:visual   # Only the pixel snapshots
bun run test:e2e:update  # Refresh the snapshot baselines
```

Visual snapshots run in Chromium at a 720x400 viewport so one CSS pixel is one
VGA pixel, which makes the baselines directly comparable to the reference
gallery.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `bun run test`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [lkesteloot/turbopascal](https://github.com/lkesteloot/turbopascal) - Original JavaScript Pascal compiler
- Borland International - Original Turbo Pascal IDE
- The Turbo Pascal community for preserving computing history

## Related Projects

- [Free Pascal](https://www.freepascal.org/) - Open source Pascal compiler
- [Lazarus](https://www.lazarus-ide.org/) - Free Pascal IDE
- [DOSBox](https://www.dosbox.com/) - DOS emulator
