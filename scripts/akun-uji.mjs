// Membuat/menyegarkan 4 akun UJI (bukan akun keluarga) langsung di auth.users, untuk tes RLS & E2E.
// Password acak ditulis ke ../.env.uji (di luar repo). Domain .test → tidak pernah ada email terkirim.
//   node scripts/akun-uji.mjs        -> buat/segarkan akun + keluarga uji
//   node scripts/akun-uji.mjs hapus  -> hapus akun & keluarga uji
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AKAR, sambungPg } from './pg.mjs';

export const AKUN_UJI = {
  A: 'uji.a@kas-keluarga.test',      // pemilik keluarga uji A
  A2: 'uji.a2@kas-keluarga.test',    // anggota keluarga A
  AL: 'uji.alihat@kas-keluarga.test',// peran 'lihat' di keluarga A
  B: 'uji.b@kas-keluarga.test',      // pemilik keluarga uji B
};

const c = await sambungPg();
const hapus = process.argv[2] === 'hapus';
try {
  await c.query('begin');
  const emails = Object.values(AKUN_UJI);
  await c.query(`delete from public.keluarga where dibuat_oleh in (select id from auth.users where email = any($1))`, [emails]);
  if (hapus) {
    await c.query(`delete from auth.users where email = any($1)`, [emails]);
    await c.query('commit');
    console.log('akun & keluarga uji dihapus');
    process.exit(0);
  }
  const env = [];
  const id = {};
  for (const [kode, email] of Object.entries(AKUN_UJI)) {
    const pw = crypto.randomBytes(18).toString('base64url');
    const ada = await c.query('select id from auth.users where email = $1', [email]);
    if (ada.rowCount) {
      id[kode] = ada.rows[0].id;
      await c.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()), banned_until = null, updated_at = now() where id = $1`, [id[kode], pw]);
    } else {
      const r = await c.query(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change,
          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
        values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
          extensions.crypt($2, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
          '{"uji":true}', now(), now(), '', '', '', '', '', '', '', '')
        returning id`, [email, pw]);
      id[kode] = r.rows[0].id;
      await c.query(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), $1::uuid, $1::text, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
          'email', now(), now(), now())`, [id[kode], email]);
    }
    env.push(`UJI_${kode}_EMAIL=${email}`, `UJI_${kode}_PASSWORD=${pw}`);
  }
  // Keluarga uji dibuat lewat RPC yang sama dengan aplikasi (sebagai pengguna tsb).
  const buat = async (uid, nama, tampil) => {
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const r = await c.query('select public.buat_keluarga($1, $2) as id', [nama, tampil]);
    await c.query(`select set_config('role', 'postgres', true)`);
    await c.query('reset role');
    return r.rows[0].id;
  };
  const kA = await buat(id.A, 'Keluarga Uji A', 'Uji A');
  const kB = await buat(id.B, 'Keluarga Uji B', 'Uji B');
  await c.query(`insert into public.anggota (keluarga_id, user_id, nama_tampilan, peran) values
    ($1, $2, 'Uji A2', 'anggota'), ($1, $3, 'Uji A Lihat', 'lihat')`, [kA, id.A2, id.AL]);
  env.push(`UJI_KELUARGA_A=${kA}`, `UJI_KELUARGA_B=${kB}`);
  await c.query('commit');
  fs.writeFileSync(path.resolve(AKAR, '..', '.env.uji'), env.join('\n') + '\n');
  console.log(`akun uji siap: ${Object.keys(AKUN_UJI).join(', ')}; keluarga A & B dibuat; kredensial di ../.env.uji`);
} catch (e) {
  await c.query('rollback');
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
