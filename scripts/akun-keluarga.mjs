// Membuat akun keluarga SUNGGUHAN + keluarganya. Kata sandi awal acak ditulis ke ../akun-keluarga.txt
// (di luar repo, tidak dicetak ke layar). Aman dijalankan ulang: akun yang sudah ada tidak diubah.
//   node scripts/akun-keluarga.mjs "Keluarga Budi" budi1990=Ayah ani1990=Ibu
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AKAR, sambungPg } from './pg.mjs';
import { keEmail } from '../src/engine/akun.js';

const [namaKeluarga, ...pasangan] = process.argv.slice(2);
const akun = pasangan.map((p) => { const [u, n] = p.split('='); return { userid: u.trim().toLowerCase(), nama: (n || u).trim(), email: keEmail(u) }; });
if (!namaKeluarga || !akun.length || akun.some((a) => !a.email)) {
  console.error('pakai: node scripts/akun-keluarga.mjs "Nama Keluarga" userid1=Panggilan1 userid2=Panggilan2');
  process.exit(2);
}

// kata sandi mudah diketik: tanpa huruf/angka yang mirip (0/O, 1/l/I)
const ABJAD = 'abcdefghjkmnpqrstuvwxyz23456789';
const sandiAcak = () => Array.from(crypto.randomBytes(12), (b) => ABJAD[b % ABJAD.length]).join('').replace(/(.{4})(?=.)/g, '$1-');

const c = await sambungPg();
const catatan = [];
try {
  await c.query('begin');
  for (const a of akun) {
    const ada = await c.query('select id from auth.users where email = $1', [a.email]);
    if (ada.rowCount) { a.id = ada.rows[0].id; catatan.push(`${a.userid}\t(akun sudah ada — kata sandi TIDAK diubah)`); continue; }
    const pw = sandiAcak();
    const r = await c.query(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
        extensions.crypt($2, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
        jsonb_build_object('userid', $3::text), now(), now(), '', '', '', '', '', '', '', '')
      returning id`, [a.email, pw, a.userid]);
    a.id = r.rows[0].id;
    await c.query(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), $1::uuid, $1::text, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
        'email', now(), now(), now())`, [a.id, a.email]);
    catatan.push(`${a.userid}\t${pw}`);
  }
  // keluarga dibuat lewat RPC aplikasi sebagai akun pertama (pemilik); akun lain ikut sebagai pemilik
  let kid = (await c.query(`select k.id from public.keluarga k join public.anggota a on a.keluarga_id = k.id
    where a.user_id = $1 and a.peran = 'pemilik' limit 1`, [akun[0].id])).rows[0]?.id;
  if (!kid) {
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
      [JSON.stringify({ sub: akun[0].id, role: 'authenticated' })]);
    kid = (await c.query('select public.buat_keluarga($1, $2) as id', [namaKeluarga, akun[0].nama])).rows[0].id;
    await c.query('reset role');
  }
  for (const a of akun.slice(1)) {
    await c.query(`insert into public.anggota (keluarga_id, user_id, nama_tampilan, peran) values ($1, $2, $3, 'pemilik')
      on conflict (keluarga_id, user_id) do update set peran = 'pemilik', aktif = true`, [kid, a.id, a.nama]);
  }
  await c.query('commit');
  const f = path.resolve(AKAR, '..', 'akun-keluarga.txt');
  fs.writeFileSync(f, [`Akun Kas Keluarga — dibuat ${new Date().toISOString().slice(0, 10)}`, `Keluarga: ${namaKeluarga}`, '',
    'nama pengguna\tkata sandi awal (ganti setelah masuk: Kelola → Akun)', ...catatan, '',
    'Berikan kata sandi langsung ke orangnya. Hapus berkas ini setelah semua kata sandi diganti.', ''].join('\n'));
  console.log(`selesai: ${akun.map((a) => a.userid).join(', ')} → "${namaKeluarga}" (semua pemilik). Kata sandi awal di ${f}`);
} catch (e) {
  try { await c.query('rollback'); } catch {}
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
