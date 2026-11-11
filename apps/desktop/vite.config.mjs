import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const path = value => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
  root: path('.'),
  base: './',
  publicDir: path('../../public'),
  resolve: { alias: { '@': path('../../src'), 'next/link': path('./workspace/link.tsx'), 'next/navigation': path('./workspace/navigation.ts') } },
  define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': 'undefined', 'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': 'undefined' },
  css: { postcss: path('../..') },
  worker: { format: 'es' },
  build: {
    outDir: path('../../.companion-build/renderer'), emptyOutDir: true, sourcemap: false,
    rolldownOptions: { input: { ribbon: path('./index.html'), workspace: path('./workspace.html') } },
  },
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
});
