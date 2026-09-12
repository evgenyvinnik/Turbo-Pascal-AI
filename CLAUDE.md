# CLAUDE.md - Project Instructions for Claude Code

## Project Overview

This is a web-based Turbo Pascal V7 IDE clone that recreates the authentic DOS experience in a modern browser. The project ports the Pascal compiler from https://github.com/lkesteloot/turbopascal and builds a custom DOS-style UI.

## Tech Stack

| Category | Technology |
|----------|------------|
| Build | Vite + Bun |
| UI | React 19 + React Compiler |
| Styling | StyleX |
| State | Zustand with Immer |
| Storage | IndexedDB (via Dexie) |
| Language | TypeScript (strict mode) |
| PWA | vite-plugin-pwa |
| i18n | i18next |
| Testing | Playwright + Vitest |
| Linting | ESLint + Prettier |
| Data/Routing | TanStack Query + Router |

## Commands

```bash
# Install dependencies (use bun, not npm)
bun install

# Start development server
bun run dev

# Type check
bun run typecheck

# Run tests
bun run test

# Run E2E tests
bun run test:e2e

# Run only the pixel snapshot suite
bun run test:visual

# Refresh the pixel snapshot baselines
bun run test:e2e:update

# Lint
bun run lint

# Format code
bun run format

# Build for production
bun run build
```

## Project Structure

```
src/
├── tui/                   # Text-mode engine (80x25 character grid)
│   ├── palette.ts         # Authentic VGA 16-colour table
│   ├── chars.ts           # CP437 box drawing, shades, arrows
│   ├── Screen.ts          # Cell buffer + frame/shadow/scrollbar primitives
│   └── TextScreen.tsx     # React renderer, scales the grid to the viewport
├── compiler/              # Pascal compiler (TypeScript port)
│   ├── types/             # Type definitions, opcodes
│   ├── lexer/             # Token, Stream, Lexer
│   ├── parser/            # Node, Parser (AST)
│   ├── symbols/           # Symbol, SymbolTable
│   ├── codegen/           # Bytecode, Compiler
│   ├── runtime/           # Machine (VM), Native, Control
│   ├── stdlib/            # builtin, crt, graph
│   └── errors/            # PascalError
├── components/            # Painters, not widgets: each draws into the Screen
│   ├── IDE/               # Screen composition, keyboard and mouse routing
│   ├── MenuBar/           # Menu tree definition + menu painter
│   ├── Editor/            # Edit window painter + Pascal syntax colouring
│   ├── Window/            # Turbo Vision frames and tool windows
│   ├── Dialogs/           # Declarative dialog model + dialog painter
│   ├── StatusBar/         # Context sensitive key list and hint line
│   ├── Terminal/          # Output window (re-exports the tool painter)
│   ├── DebugPanel/        # Watches / Call stack (re-exports the tool painter)
│   └── GraphicsCanvas/    # Fullscreen graphics overlay
├── routes/                # TanStack Router
├── stores/                # Zustand stores (desktop, menu, dialog, ide, ...)
├── services/db/           # IndexedDB via Dexie
├── hooks/                 # Custom React hooks
├── styles/                # StyleX theme tokens + the TP attribute table
└── i18n/                  # Translations (en, de, ru)
```

## Key Design Decisions

### Everything Is Painted Into One 80x25 Character Grid
The whole IDE - desktop, windows, menus, dialogs, status line - is drawn cell
by cell into a single `Screen` buffer each frame, the way the original DOS
program wrote into VGA text memory. React only renders the resulting runs of
same-coloured cells, so there are no HTML widgets to keep in sync with the
Turbo Vision look.

- One cell is 9x16 px, so the full screen is 720x400 and scales to the viewport
- Colours come from `src/styles/tpTheme.ts`, sampled from the reference shots
- Block cursor, insert/overwrite modes, keyboard-driven navigation
- Custom Pascal syntax highlighting: reserved words white, comments gray,
  everything else yellow, exactly as Turbo Pascal 7 shows it

### Graphics Output
- Fullscreen canvas overlay (press ESC to return to IDE)
- EGA 16-color palette support
- Pure TS + CSS implementation

### Compiler Architecture
- Lexer → Parser → AST → Compiler → Bytecode → VM
- P-machine compatible with UCSD Pascal p-code

## DOS Theme Colors

```typescript
dosColors = {
  blue: '#0000AA',        // Primary background
  lightBlue: '#5555FF',
  gray: '#AAAAAA',        // Menu background
  white: '#FFFFFF',       // Text
  yellow: '#FFFF55',      // Highlights
  cyan: '#55FFFF',        // Keywords
  black: '#000000',       // Terminal
}
```

## Code Style

- Use StyleX for all component styling
- Follow DOS/Turbo Pascal visual aesthetics
- Use path aliases (@compiler/*, @components/*, etc.)
- Prefer functional components with hooks
- Use Zustand for global state, TanStack Query for async data

## Reference

The UI follows the screenshot gallery at
https://ui.codexpanse.com/turbo-pascal-71.html. Menu items, shortcuts, hint
lines, dialog layouts and colours are transcribed from those images.

## Testing

- Unit tests: Vitest for compiler modules
- E2E tests: Playwright for UI interactions (`tests/e2e/behaviour.spec.ts`)
- Visual tests: Playwright pixel snapshots in `tests/e2e/visual.spec.ts`, run by
  the `visual` project at a 720x400 viewport so one CSS pixel is one VGA pixel.
  Update baselines with `bun run test:e2e:update`.
- Test sample Pascal programs: HELLO.PAS, FIBONACCI.PAS, PRIMES.PAS, SQUARE.PAS
