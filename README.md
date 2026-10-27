# Kas Keluarga

PWA pencatat pengeluaran & pemasukan keluarga. Dibuka lewat link, dipasang ke layar utama
(Android: Chrome → *Install app*; iPhone: Safari → Bagikan → *Add to Home Screen*), tetap bisa
mencatat tanpa sinyal lalu sinkron otomatis.

- Front-end: Vite + JavaScript vanila, IndexedDB (Dexie), service worker (vite-plugin-pwa).
- Backend: Supabase (Postgres + Auth + Row Level Security). Tidak ada server sendiri.
- Hosting: GitHub Pages lewat `.github/workflows/deploy.yml`.

## Menjalankan lokal

1. Isi `../.env` (lihat `.env.example`; berkas berada **di luar** repo).
2. `npm install`
3. `npm run dev` → http://localhost:5173

## Perintah

| Perintah | Gunanya |
|---|---|
| `npm test` | uji unit logika (uang, tanggal, laporan, CSV) |
| `npm run db:status` / `npm run db:push` | status / pasang migrasi `supabase/migrations` |
| `node scripts/akun-uji.mjs` | buat/segarkan 4 akun uji + 2 keluarga uji (`hapus` untuk membuang) |
| `npm run test:rls` | uji RLS terhadap project asli |
| `npx playwright test` | uji E2E (profil Android Chromium & iPhone WebKit) |
| `node scripts/cadangan-db.mjs` | cadangan seluruh database ke `../cadangan/` |
| `node scripts/ikon.mjs` | buat ulang ikon PNG dari `public/favicon.svg` |

## Keamanan

- Front-end hanya memakai **publishable key**; semua akses data dibatasi RLS per keluarga.
- Tidak ada secret/service_role key di repo, CI, atau aplikasi. CI menolak build bila menemukannya.
- Pendaftaran publik dimatikan; akun dibuat pemilik di dasbor Supabase.
