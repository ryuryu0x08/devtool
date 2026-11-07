/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Built into the repository's dist/, where it was before the move to apps/toolbox (what serves
  // the toolbox takes it from there).
  build: { outDir: '../../dist', emptyOutDir: true },
  // Unit tests live next to the code; e2e/ is Playwright's.
  test: { include: ['src/**/*.test.ts'] },
});
