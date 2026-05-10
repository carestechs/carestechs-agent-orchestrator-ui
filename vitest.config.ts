import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

// SPA-only suite. The BFF was retired in FEAT-003 T-032.
export default defineConfig({
  plugins: [angular()],
  test: {
    name: 'spa',
    globals: true,
    passWithNoTests: true,
    include: ['src/**/*.spec.ts'],
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
  },
});
