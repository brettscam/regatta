import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE_FILE=1 inlines everything into one HTML file, for sharing a play-test build as a single page.
const single = process.env.SINGLE_FILE === '1';

export default defineConfig({
  plugins: single ? [viteSingleFile()] : [],
  // Lets the code know which build it is in, so the single file can load every course up front.
  define: { __SINGLE__: JSON.stringify(single) },
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    outDir: single ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
