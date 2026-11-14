import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE_FILE=1 inlines everything into one HTML file, for sharing a play-test build as a single page.
const single = process.env.SINGLE_FILE === '1';

export default defineConfig({
  plugins: single ? [viteSingleFile()] : [],
  // Two things the code needs to know about which build it is in. The single-file build is the claude.ai artifact:
  // it loads every course up front, and it leaves out the website's backend (src/net/web, Supabase), because there the
  // page's host supplies all of that and outside hosts are blocked. See src/world/loadCourse.ts and src/net/platform.ts.
  define: { __SINGLE__: JSON.stringify(single), 'import.meta.env.VITE_BACKEND': JSON.stringify(single ? 'none' : 'supabase') },
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    outDir: single ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
