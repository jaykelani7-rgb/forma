import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.',import.meta.url)),
  base: './',
  build: { outDir: fileURLToPath(new URL('../../.companion-build/renderer',import.meta.url)), emptyOutDir: false, sourcemap: false },
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
});
