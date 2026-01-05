import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // This picks up variables from .env files AND the system environment (like GitHub Secrets)
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    base: './', 
    define: {
      // Injects the API key into the frontend build
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '')
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    }
  };
});
