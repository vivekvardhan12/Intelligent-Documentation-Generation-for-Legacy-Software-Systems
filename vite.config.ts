/**
 * Vite build and dev-server configuration.
 *
 * WHAT CHANGED
 * `manualChunks` now splits the vendor code. Recharts is by far the largest
 * dependency in the bundle and is only needed once a run has completed, while
 * React itself is needed immediately. Emitting them as separate chunks means:
 *
 *  - the initial page load does not wait on the charting library;
 *  - the React chunk's content hash stays stable across app changes, so
 *    returning users keep it cached.
 *
 * The dashboard and comparison views are additionally lazy-loaded at their
 * import sites (see App.tsx and EvaluationDashboard.tsx), so Recharts is only
 * fetched when a chart is actually about to render.
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    build: {
      // Source maps make a production stack trace actionable. They are emitted
      // as separate .map files, so they cost nothing at runtime unless a
      // developer opens them.
      sourcemap: true,
      rollupOptions: {
        output: {
          /**
           * Splits vendor code by module path.
           *
           * The object form (`{ 'react-vendor': ['react', ...] }`) produced an
           * EMPTY react-vendor chunk: React reaches the graph through
           * `react/jsx-runtime` rather than a bare `react` import, so the
           * listed entry points matched nothing and React stayed in the main
           * bundle. Matching on the resolved module id works regardless of how
           * a package is reached.
           */
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;

            // Recharts and its d3 dependency tree — the largest single cost,
            // and not needed until a chart renders.
            if (
              /node_modules[\\/](recharts|d3-[a-z]+|victory-vendor|internmap|delaunator|robust-predicates|decimal\.js-light|fast-equals|eventemitter3)/.test(
                id
              )
            ) {
              return 'chart-vendor';
            }

            // Needed for first paint, but changes rarely — a stable hash here
            // means returning users keep it cached across app deploys.
            if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return 'react-vendor';
            }

            return undefined;
          },
        },
      },
    },

    server: {
      // HMR is disabled in AI Studio via the DISABLE_HMR env var.
      // File watching is disabled alongside it to prevent flickering during
      // agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
