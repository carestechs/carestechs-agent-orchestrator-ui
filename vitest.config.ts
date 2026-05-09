import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

// SPA suite uses Angular's compiler (templateUrl, decorators) via @analogjs/vite-plugin-angular.
// BFF suite is plain TS — no Angular plugin needed.
export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        plugins: [angular()],
        test: {
          name: 'spa',
          include: ['src/**/*.spec.ts'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
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
