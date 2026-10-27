// Runner migrasi tanpa Supabase CLI: tersambung langsung ke Postgres lewat pooler
// memakai ../.env (SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD). Tidak pernah mencetak rahasia.
//   node scripts/db.mjs probe   -> cari host pooler yang cocok, simpan ke .db-host
//   node scripts/db.mjs status  -> daftar migrasi terpasang vs berkas
//   node scripts/db.mjs push    -> pasang migrasi baru (masing-masing dalam satu transaksi)
//   node scripts/db.mjs sql <berkas.sql> -> jalankan berkas SQL (seed/uji), satu transaksi
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(AKAR, '..', '.env'), quiet: true });
const REF = process.env.SUPABASE_PROJECT_REF;
const PW = process.env.SUPABASE_DB_PASSWORD;
if (!REF || !PW) { console.error('SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD kosong di ../.env'); process.exit(2); }

const BERKAS_HOST = path.join(AKAR, '.db-host');
const DIR_MIGRASI = path.join(AKAR, 'supabase', 'migrations');
const KANDIDAT = ['aws-0-ap-southeast-1', 'aws-1-ap-southeast-1', 'aws-0-ap-southeast-2', 'aws-1-ap-southeast-2',
  'aws-0-ap-northeast-1', 'aws-1-ap-northeast-1', 'aws-0-ap-south-1', 'aws-0-us-east-1', 'aws-1-us-east-1',
  'aws-0-eu-central-1', 'aws-1-eu-central-1'].map(r => `${r}.pooler.supabase.com`);

// TLS selalu diverifikasi. Bila sertifikat pooler ditandatangani CA Supabase sendiri,
// simpan CA-nya (Dashboard > Project Settings > Database > SSL Configuration > Download certificate)
// sebagai supabase-ca.crt di folder ini.
const BERKAS_CA = path.join(AKAR, 'supabase-ca.crt');
const SSL = fs.existsSync(BERKAS_CA) ? { ca: fs.readFileSync(BERKAS_CA, 'utf8') } : { rejectUnauthorized: true };

function klien(host) {
  return new pg.Client({ host, port: 5432, user: `postgres.${REF}`, password: PW, database: 'postgres',
    ssl: SSL, connectionTimeoutMillis: 15000 });
}

async function probe() {
  for (const h of KANDIDAT) {
    const c = klien(h);
    try {
      await c.connect();
      const r = await c.query('select current_user, version()');
      await c.end();
      fs.writeFileSync(BERKAS_HOST, h);
      console.log(`OK ${h} (${r.rows[0].current_user})`);
      return h;
    } catch (e) {
      try { await c.end(); } catch {}
      const m = String(e.message);
      if (/password authentication failed/i.test(m)) { console.error(`Host ${h} cocok, tetapi PASSWORD SALAH.`); process.exit(3); }
      console.log(`-- ${h}: ${m.slice(0, 80)}`);
    }
  }
  console.error('Tidak ada host pooler yang cocok.'); process.exit(4);
}

async function sambung() {
  const host = fs.existsSync(BERKAS_HOST) ? fs.readFileSync(BERKAS_HOST, 'utf8').trim() : await probe();
  const c = klien(host);
  await c.connect();
  await c.query(`create schema if not exists kas_meta;
    create table if not exists kas_meta.migrasi (nama text primary key, dipasang_at timestamptz not null default now())`);
  return c;
}

const berkasMigrasi = () => fs.existsSync(DIR_MIGRASI) ? fs.readdirSync(DIR_MIGRASI).filter(f => f.endsWith('.sql')).sort() : [];

async function status() {
  const c = await sambung();
  const ada = new Set((await c.query('select nama from kas_meta.migrasi')).rows.map(r => r.nama));
  for (const f of berkasMigrasi()) console.log(`${ada.has(f) ? '[x]' : '[ ]'} ${f}`);
  await c.end();
}

async function push() {
  const c = await sambung();
  const ada = new Set((await c.query('select nama from kas_meta.migrasi')).rows.map(r => r.nama));
  const baru = berkasMigrasi().filter(f => !ada.has(f));
  if (!baru.length) console.log('Tidak ada migrasi baru.');
  for (const f of baru) {
    const sql = fs.readFileSync(path.join(DIR_MIGRASI, f), 'utf8');
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('insert into kas_meta.migrasi(nama) values ($1)', [f]);
      await c.query('commit');
      console.log(`dipasang: ${f}`);
    } catch (e) {
      await c.query('rollback');
      console.error(`GAGAL ${f}: ${e.message}`);
      await c.end(); process.exit(1);
    }
  }
  await c.end();
}

async function jalankanSql(berkas) {
  const c = await sambung();
  const sql = fs.readFileSync(path.resolve(berkas), 'utf8');
  try {
    await c.query('begin'); const r = await c.query(sql); await c.query('commit');
    const akhir = Array.isArray(r) ? r[r.length - 1] : r;
    if (akhir?.rows?.length) console.table(akhir.rows);
    console.log('selesai');
  } catch (e) { await c.query('rollback'); console.error(`GAGAL: ${e.message}`); process.exitCode = 1; }
  await c.end();
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'probe') await probe();
else if (cmd === 'status') await status();
else if (cmd === 'push') await push();
else if (cmd === 'sql' && arg) await jalankanSql(arg);
else { console.error('pakai: probe | status | push | sql <berkas>'); process.exit(2); }
