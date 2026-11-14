import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createAccountPlugin } from './server/createAccountPlugin';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), createAccountPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
