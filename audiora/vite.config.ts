import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/*
 * A new id per build. It stamps the URLs of the unhashed runtime assets — the
 * workers, the worklet and the ffmpeg core — so that the first request after an
 * upgrade can never be answered from a cache entry stored under a different
 * cross-origin policy. See src/services/assetVersion.ts for why that matters.
 */
const ASSET_VERSION = Date.now().toString(36);

export default defineConfig({
  // Pinned so the dev server works when launched from a parent directory.
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  define: { __ASSET_VERSION__: JSON.stringify(ASSET_VERSION) },
  server: {
    port: 3190,
    strictPort: false,
    /*
     * Cross-origin isolation, matching what public/.htaccess sets in
     * production. This is what makes SharedArrayBuffer available, which is what
     * lets the separation engine run on more than one thread — 11 instead of 1
     * on a 12-core machine.
     *
     * "credentialless" does NOT work here: it failed to activate isolation in
     * Chrome 148 and Safari does not support it at all. "require-corp" does,
     * and both cross-origin dependencies already satisfy it — jsdelivr sends
     * CORP, and the huggingface model is CORS-clean.
     *
     * Keep these in step with the .htaccess block, or dev and production will
     * disagree about a policy that changes how workers load.
     */
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          encoder: ['@breezystack/lamejs'],
        },
      },
    },
  },
});
