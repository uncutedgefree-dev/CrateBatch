import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Critical for Electron to find assets in production
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});