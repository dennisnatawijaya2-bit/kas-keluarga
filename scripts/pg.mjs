// Koneksi Postgres bersama untuk skrip lokal (akun uji, cadangan). Membaca ../.env; tidak mencetak rahasia.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

export const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(AKAR, '..', '.env'), quiet: true });

export async function sambungPg() {
  const REF = process.env.SUPABASE_PROJECT_REF, PW = process.env.SUPABASE_DB_PASSWORD;
  if (!REF || !PW) throw new Error('SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD kosong di ../.env');
  const fHost = path.join(AKAR, '.db-host');
  if (!fs.existsSync(fHost)) throw new Error('Jalankan dulu: node scripts/db.mjs probe');
  const c = new pg.Client({
    host: fs.readFileSync(fHost, 'utf8').trim(), port: 5432, user: `postgres.${REF}`, password: PW,
    database: 'postgres', ssl: { ca: fs.readFileSync(path.join(AKAR, 'supabase-ca.crt'), 'utf8') },
    connectionTimeoutMillis: 15000,
  });
  await c.connect();
  return c;
}
