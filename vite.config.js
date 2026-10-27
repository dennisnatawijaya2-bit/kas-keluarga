import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => {
  // Lokal: ../.env (di luar repo). CI: variabel lingkungan GitHub Actions.
  const env = { ...loadEnv(mode, '..', 'VITE_'), ...process.env };
  process.env.VITE_SUPABASE_WSS = (env.VITE_SUPABASE_URL || '').replace(/^https:/, 'wss:');
  const base = env.BASE_PATH || '/';
  return {
    base,
    envDir: '..',
    define: { __VERSI__: JSON.stringify(`${pkg.version}${env.GITHUB_SHA ? `+${env.GITHUB_SHA.slice(0, 7)}` : ''}`) },
    build: { target: 'es2020', sourcemap: false },
    plugins: [
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
        manifest: {
          name: 'Kas Keluarga',
          short_name: 'Kas',
          description: 'Pencatat pengeluaran & pemasukan keluarga',
          lang: 'id',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#ffffff',
          theme_color: '#0f766e',
          icons: [
            { src: 'ikon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'ikon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'ikon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: `${base}index.html`,
          cleanupOutdatedCaches: true,
          // Data Supabase TIDAK di-cache service worker (dikelola IndexedDB).
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
      }),
    ],
  };
});
