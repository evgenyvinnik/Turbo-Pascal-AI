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

The IDE recreates the classic Turbo Pascal look and feel:
- Blue background with gray menus
- Block cursor editor
- DOS-style dialogs and buttons

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

| Shortcut | Action |
|----------|--------|
| F9 | Compile |
| Ctrl+F9 | Run |
| F2 | Save |
| F3 | Open |
| Ctrl+N | New File |
| Ctrl+W | Close File |
| F1 | Help |
| F5 | Debug |
| F7 | Step Into |
| F8 | Step Over |
| Ctrl+F | Find |
| Ctrl+H | Replace |

## Project Structure

```
src/
├── compiler/          # Pascal compiler
│   ├── lexer/         # Tokenizer
│   ├── parser/        # AST parser
│   ├── codegen/       # Bytecode generator
│   ├── runtime/       # P-machine VM
│   └── stdlib/        # Standard library (CRT, Graph)
├── components/        # React UI components
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
