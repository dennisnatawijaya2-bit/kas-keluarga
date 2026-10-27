// Cadangan tingkat database (semua keluarga) ke ../cadangan/kas-db-YYYYMMDD-HHMM.json — di luar repo.
// Pelengkap tombol "Unduh cadangan" di aplikasi. Jalankan: node scripts/cadangan-db.mjs
import fs from 'node:fs';
import path from 'node:path';
import { AKAR, sambungPg } from './pg.mjs';

const TABEL = ['keluarga', 'anggota', 'kategori', 'dompet', 'anggaran', 'transaksi'];
const c = await sambungPg();
try {
  await c.query('begin isolation level repeatable read read only'); // satu potret konsisten
  const isi = { aplikasi: 'kas-keluarga-db', versi: 1, dibuat: new Date().toISOString(), tabel: {} };
  for (const t of TABEL) isi.tabel[t] = (await c.query(`select * from public.${t} order by 1`)).rows;
  await c.query('commit');
  const dir = path.resolve(AKAR, '..', 'cadangan');
  fs.mkdirSync(dir, { recursive: true });
  const cap = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const f = path.join(dir, `kas-db-${cap}.json`);
  fs.writeFileSync(f, JSON.stringify(isi));
  console.log(`cadangan: ${f}`);
  for (const t of TABEL) console.log(`  ${t}: ${isi.tabel[t].length} baris`);
} catch (e) {
  try { await c.query('rollback'); } catch {}
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
