import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // This picks up variables from .env files AND the system environment (like GitHub Secrets)
  const env = loadEnv(mode, process.cwd(), '');
  
  // Combine process.env (CI secrets) with .env file variables
  const GEMINI_API_KEY = env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';

  return {
    plugins: [react()],
    base: './', 
    define: {
      // Injects the API key into the frontend build
      // This ensures import.meta.env.VITE_GEMINI_API_KEY is replaced correctly
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(GEMINI_API_KEY)
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    }
  };
});
