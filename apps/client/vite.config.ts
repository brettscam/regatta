import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE_FILE=1 inlines everything into one HTML file, for sharing a play-test build as a single page.
const single = process.env.SINGLE_FILE === '1';

export default defineConfig({
  plugins: single ? [viteSingleFile()] : [],
  // The website brings its own backend (src/net/web, Supabase). The single-file build is the claude.ai artifact,
  // where the page's host supplies all of that and outside hosts are blocked: there the flag is off, and the
  // bundler drops the backend and its library from the file. See src/net/platform.ts.
  define: { 'import.meta.env.VITE_BACKEND': JSON.stringify(single ? 'none' : 'supabase') },
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    outDir: single ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
