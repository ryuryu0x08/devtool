/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Unit tests live next to the code; e2e/ is Playwright's.
  test: { include: ['src/**/*.test.ts'] },
});
