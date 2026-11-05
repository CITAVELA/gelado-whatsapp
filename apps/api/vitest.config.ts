import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: { alias: { '@gelado/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    // Una sola BD de pruebas: los ficheros van en serie para no pisarse
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
