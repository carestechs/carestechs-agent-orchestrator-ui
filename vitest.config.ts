import { defineConfig } from 'vitest/config';

// Single Vitest config covering both SPA and BFF specs.
// Per-spec environment selection is done via `// @vitest-environment` directives
// or, for files that need jsdom, by importing from `vitest/jsdom`. Default is node.
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'bff/src/**/*.spec.ts'],
    environment: 'node',
    passWithNoTests: true,
    environmentMatchGlobs: [
      ['src/**/*.spec.ts', 'jsdom'],
      ['bff/src/**/*.spec.ts', 'node'],
    ],
  },
});
