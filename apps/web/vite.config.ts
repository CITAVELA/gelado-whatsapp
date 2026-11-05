import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const api = process.env.VITE_API_URL || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@gelado/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') } },
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/storage': api,
      '/privacidad': api,
      '/health': api,
      '/ws': { target: api, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
