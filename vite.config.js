import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const API_PORT = process.env.API_PORT || 3001;

// Hosts the dev server will answer for. Localhost always works; a hosted dev
// environment adds its own hostname through PREVIEW_HOST (comma separated).
const allowedHosts = ['localhost', '127.0.0.1', ...(process.env.PREVIEW_HOST || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: false,
    allowedHosts,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
