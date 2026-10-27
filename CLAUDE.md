# CLAUDE.md — Kas Keluarga (app)

PWA pencatat pengeluaran/pemasukan keluarga. Rencana & pelacak progres: `../plan.md` (satu-satunya pelacak — centang di sana).

## Struktur
- `index.html`, `src/` — front-end Vite + JS modul vanila. `src/engine/` = logika murni tanpa DOM (diuji `tests/unit/`).
- `supabase/migrations/*.sql` — skema + RLS. Dipasang dengan `npm run db:push` (runner sendiri `scripts/db.mjs`, koneksi langsung lewat pooler, TLS diverifikasi dengan `supabase-ca.crt`). Tidak memakai Supabase CLI/Docker.
- `tests/unit/` (node:test), `tests/rls/` (2 keluarga uji vs Supabase asli), `tests/e2e/` (Playwright).

## Rahasia
- Konfigurasi di `../.env` (di luar repo). **Jangan** membaca/menampilkan isinya; cek hanya nama variabel.
- Front-end hanya boleh memakai `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`. Tidak ada secret/service_role key di mana pun.

## Perintah
```
npm test            # unit
npm run test:rls    # RLS terhadap project asli (pakai akun uji)
npm run test:e2e    # Playwright
npm run db:status / db:push
npm run build
```

## Aturan
- Uang = bigint rupiah. Antarmuka Bahasa Indonesia baku.
- Setiap tabel `public` wajib RLS + kebijakan berbasis `public.anggota_dari(keluarga_id)`.
- Tidak menyalin data dari Kas Barus / Kas Kolam.
- Gaya komunikasi: ikuti `~/.claude/CLAUDE.md` (gua ultra, aku/kamu).
