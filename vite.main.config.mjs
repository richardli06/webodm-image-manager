// vite.main.config.mjs
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.js',
      formats: ['cjs'],
      fileName: () => 'main.js'
    },
    outDir: '.vite/build',
    rollupOptions: {
      external: [
        'electron',
        'node:fs',
        'node:path',
        'node:url',
        // ...other built-ins
      ]
    }
  }
});
