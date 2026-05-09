import { defineConfig } from 'vitest/config';

// Single Vitest config covering both SPA and BFF specs.
// SPA specs run in jsdom; BFF specs in node — selected per-suite via test.projects.
export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'spa',
          include: ['src/**/*.spec.ts'],
          environment: 'jsdom',
          globals: true,
        },
      },
      {
        test: {
          name: 'bff',
          include: ['bff/src/**/*.spec.ts'],
          environment: 'node',
          globals: true,
        },
      },
    ],
  },
});
