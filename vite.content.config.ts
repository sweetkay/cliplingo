import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/assets',
    emptyOutDir: false,
    lib: {
      entry: resolve(root, 'src/content.ts'),
      name: 'ClipLingoContent',
      formats: ['iife'],
      fileName: () => 'content.js'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
