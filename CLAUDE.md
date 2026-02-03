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
├── compiler/              # Pascal compiler (TypeScript port)
│   ├── types/             # Type definitions, opcodes
│   ├── lexer/             # Token, Stream, Lexer
│   ├── parser/            # Node, Parser (AST)
│   ├── symbols/           # Symbol, SymbolTable
│   ├── codegen/           # Bytecode, Compiler
│   ├── runtime/           # Machine (VM), Native, Control
│   ├── stdlib/            # builtin, crt, graph
│   └── errors/            # PascalError
├── components/            # React components
│   ├── IDE/               # Main container
│   ├── MenuBar/           # Top menu
│   ├── Editor/            # Code editor with tabs
│   ├── Terminal/          # Console output
│   ├── DebugPanel/        # Watches, CallStack
│   ├── GraphicsCanvas/    # Graphics output overlay
│   ├── FileExplorer/      # File browser
│   ├── StatusBar/         # Bottom status bar
│   ├── Dialogs/           # Modal dialogs
│   └── common/            # DOS-style UI primitives
├── routes/                # TanStack Router
├── stores/                # Zustand stores
├── services/db/           # IndexedDB via Dexie
├── hooks/                 # Custom React hooks
├── styles/                # StyleX theme tokens
└── i18n/                  # Translations (en, de, ru)
```

## Key Design Decisions

### Custom DOS-Style Editor (No Monaco/CodeMirror)
- Character-grid based rendering (80x25 or 80x50 modes)
- Block cursor, insert/overwrite modes
- Keyboard-driven navigation
- Custom Pascal syntax highlighting

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

## Testing

- Unit tests: Vitest for compiler modules
- E2E tests: Playwright for UI interactions
- Test sample Pascal programs: HELLO.PAS, FIBONACCI.PAS, PRIMES.PAS
