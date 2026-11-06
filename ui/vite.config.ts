import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Built once into ui/dist and served by bezels' own HTTP server — no Vite/Next runtime at use time.
// `npm run dev:ui` proxies to a running `bezels serve` for UI development.
const target = 'http://127.0.0.1:4477';
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 600 },
  server: { port: 5173, proxy: { '/rpc': target, '/shots': target, '/snap': target, '/health': target, '/ws': { target: 'ws://127.0.0.1:4477', ws: true } } },
});
