import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Source aliases keep library edits live during development. Production demo
// builds resolve the package exports from dist, just like an installed consumer.
export default defineConfig(({ command }) => ({
  resolve: command === 'serve' ? {
    alias: [
      { find: /^liquid-chart$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      { find: 'liquid-chart/model', replacement: fileURLToPath(new URL('./src/model.ts', import.meta.url)) },
      { find: 'liquid-chart/history', replacement: fileURLToPath(new URL('./src/history.ts', import.meta.url)) },
      { find: 'liquid-chart/style.css', replacement: fileURLToPath(new URL('./src/chart.css', import.meta.url)) },
    ],
  } : undefined,
  build: { outDir: 'demo-dist' },
}));
