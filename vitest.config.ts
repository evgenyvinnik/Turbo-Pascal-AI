import { defineConfig } from 'vitest/config';

// Compiler tests run in Node without loading the browser app or PWA plugins.
export default defineConfig({
  test: {
    include: ['tests/compiler/**/*.test.ts'],
    environment: 'node',
  },
});
