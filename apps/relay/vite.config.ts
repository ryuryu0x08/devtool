import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The window's page: served by Vite while developing (tauri dev), built into dist/ for the app.
export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
