// Tes RLS terhadap project Supabase asli memakai akun UJI (scripts/akun-uji.mjs).
// Keluarga A: A (pemilik), A2 (anggota), AL (lihat). Keluarga B: B (pemilik).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.resolve(AKAR, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(AKAR, '..', '.env.uji'), quiet: true });
const URL = process.env.VITE_SUPABASE_URL, KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KA = process.env.UJI_KELUARGA_A, KB = process.env.UJI_KELUARGA_B;

const baru = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sb = {};
const uid = {};

async function masuk(kode) {
  const c = baru();
  const { data, error } = await c.auth.signInWithPassword({
    email: process.env[`UJI_${kode}_EMAIL`], password: process.env[`UJI_${kode}_PASSWORD`] });
  assert.ifError(error);
  uid[kode] = data.user.id;
  return c;
}
const satu = async (c, tabel, keluarga) => (await c.from(tabel).select('id').eq('keluarga_id', keluarga).limit(1).single()).data;

let katA, dompetA, katB, dompetB, trxA;

before(async () => {
  assert.ok(URL && KEY && KA && KB, 'env uji belum lengkap — jalankan node scripts/akun-uji.mjs');
  for (const k of ['A', 'A2', 'AL', 'B']) sb[k] = await masuk(k);
  katA = (await sb.A.from('kategori').select('id').eq('keluarga_id', KA).eq('jenis', 'keluar').limit(1).single()).data.id;
  dompetA = (await satu(sb.A, 'dompet', KA)).id;
  katB = (await sb.B.from('kategori').select('id').eq('keluarga_id', KB).eq('jenis', 'keluar').limit(1).single()).data.id;
  dompetB = (await satu(sb.B, 'dompet', KB)).id;
  const r = await sb.A.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 15000, kategori_id: katA, dompet_id: dompetA, catatan: 'uji rls' }).select().single();
  assert.ifError(r.error);
  trxA = r.data;
});

after(async () => {
  // bersihkan transaksi uji (hapus permanen hanya pemilik)
  await sb.A?.from('transaksi').delete().eq('keluarga_id', KA);
  await sb.B?.from('transaksi').delete().eq('keluarga_id', KB);
});

test('1. pemilik A membaca transaksi keluarga A', async () => {
  const { data, error } = await sb.A.from('transaksi').select('id').eq('id', trxA.id);
  assert.ifError(error); assert.equal(data.length, 1);
});

test('2. B tidak bisa membaca apa pun milik keluarga A', async () => {
  for (const t of ['keluarga', 'anggota', 'kategori', 'dompet', 'transaksi', 'anggaran']) {
    const kol = t === 'keluarga' ? 'id' : 'keluarga_id';
    const { data, error } = await sb.B.from(t).select('*').eq(kol, KA);
    assert.ifError(error); assert.equal(data.length, 0, `bocor di ${t}`);
  }
});

test('3. B tidak bisa menyisipkan transaksi ke keluarga A', async () => {
  const { error } = await sb.B.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 1, kategori_id: katA, dompet_id: dompetA });
  assert.ok(error, 'seharusnya ditolak');
});

test('4. A tidak bisa memindahkan baris ke keluarga B (keluarga_id terkunci)', async () => {
  const { data, error } = await sb.A.from('transaksi').update({ keluarga_id: KB }).eq('id', trxA.id).select();
  assert.ok(error || data.length === 0, 'seharusnya ditolak');
  const cek = await sb.A.from('transaksi').select('keluarga_id').eq('id', trxA.id).single();
  assert.equal(cek.data.keluarga_id, KA);
});

test('5. peran lihat tidak bisa menulis, tetapi bisa membaca', async () => {
  const baca = await sb.AL.from('transaksi').select('id').eq('id', trxA.id);
  assert.equal(baca.data.length, 1);
  const ins = await sb.AL.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 1, kategori_id: katA, dompet_id: dompetA });
  assert.ok(ins.error, 'insert peran lihat seharusnya ditolak');
  const upd = await sb.AL.from('transaksi').update({ catatan: 'diubah' }).eq('id', trxA.id).select();
  assert.ok(upd.error || upd.data.length === 0, 'update peran lihat seharusnya ditolak');
  const kat = await sb.AL.from('kategori').insert({ keluarga_id: KA, nama: 'Iseng', jenis: 'keluar' });
  assert.ok(kat.error, 'kategori peran lihat seharusnya ditolak');
});

test('6. anggota yang dinonaktifkan langsung kehilangan akses', async () => {
  const off = await sb.A.from('anggota').update({ aktif: false }).eq('keluarga_id', KA).eq('user_id', uid.A2).select();
  assert.ifError(off.error); assert.equal(off.data.length, 1);
  try {
    const { data } = await sb.A2.from('transaksi').select('id').eq('keluarga_id', KA);
    assert.equal(data.length, 0);
  } finally {
    const on = await sb.A.from('anggota').update({ aktif: true }).eq('keluarga_id', KA).eq('user_id', uid.A2);
    assert.ifError(on.error);
  }
  const lagi = await sb.A2.from('transaksi').select('id').eq('keluarga_id', KA);
  assert.equal(lagi.data.length, 1);
});

test('7. tanpa login (hanya publishable key) tidak bisa membaca/menulis apa pun', async () => {
  const anon = baru();
  for (const t of ['keluarga', 'anggota', 'kategori', 'dompet', 'transaksi', 'anggaran']) {
    const { data, error } = await anon.from(t).select('*').limit(1);
    assert.ok(error || data.length === 0, `anon membaca ${t}`);
  }
  const ins = await anon.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 1, kategori_id: katA, dompet_id: dompetA });
  assert.ok(ins.error);
  const rpc = await anon.rpc('buat_keluarga', { p_nama: 'x', p_nama_tampilan: 'x' });
  assert.ok(rpc.error, 'anon tidak boleh memanggil buat_keluarga');
});

test('8. tidak bisa memakai kategori/dompet keluarga lain (FK komposit)', async () => {
  const r1 = await sb.A.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 1, kategori_id: katB, dompet_id: dompetA });
  assert.ok(r1.error, 'kategori B dipakai di A');
  const r2 = await sb.A.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 1, kategori_id: katA, dompet_id: dompetB });
  assert.ok(r2.error, 'dompet B dipakai di A');
  const r3 = await sb.A.from('anggaran').insert({ keluarga_id: KA, bulan: '2026-10-01', kategori_id: katB, jumlah: 1 });
  assert.ok(r3.error, 'anggaran memakai kategori B');
});

test('9. dicatat_oleh tidak bisa dipalsukan', async () => {
  const r = await sb.A2.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 2000, kategori_id: katA, dompet_id: dompetA, dicatat_oleh: uid.A }).select().single();
  assert.ifError(r.error);
  assert.equal(r.data.dicatat_oleh, uid.A2);
  const u = await sb.A2.from('transaksi').update({ dicatat_oleh: uid.A }).eq('id', r.data.id).select().single();
  assert.equal(u.data.dicatat_oleh, uid.A2);
});

test('10. hapus permanen hanya pemilik; anggota hanya hapus lunak', async () => {
  const r = await sb.A2.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 3000, kategori_id: katA, dompet_id: dompetA }).select().single();
  const del = await sb.A2.from('transaksi').delete().eq('id', r.data.id).select();
  assert.equal(del.data.length, 0, 'anggota tidak boleh hapus permanen');
  const lunak = await sb.A2.from('transaksi').update({ dihapus_at: new Date().toISOString() }).eq('id', r.data.id).select();
  assert.equal(lunak.data.length, 1);
  const delP = await sb.A.from('transaksi').delete().eq('id', r.data.id).select();
  assert.equal(delP.data.length, 1);
});

test('11. hanya pemilik yang menambah anggota / mengubah peran', async () => {
  const r = await sb.A2.rpc('tambah_anggota', { p_keluarga: KA, p_email: process.env.UJI_B_EMAIL,
    p_nama_tampilan: 'Penyusup', p_peran: 'pemilik' });
  assert.ok(r.error, 'anggota tidak boleh tambah anggota');
  const r2 = await sb.B.rpc('tambah_anggota', { p_keluarga: KA, p_email: process.env.UJI_B_EMAIL,
    p_nama_tampilan: 'Penyusup', p_peran: 'pemilik' });
  assert.ok(r2.error, 'orang luar tidak boleh menambah diri ke keluarga A');
  const naik = await sb.A2.from('anggota').update({ peran: 'pemilik' }).eq('keluarga_id', KA).eq('user_id', uid.A2).select();
  assert.ok(naik.error || naik.data.length === 0, 'anggota tidak boleh menaikkan perannya');
});

test('12. pemilik aktif terakhir tidak bisa dihapus/dinonaktifkan', async () => {
  const r = await sb.A.from('anggota').update({ aktif: false }).eq('keluarga_id', KA).eq('user_id', uid.A).select();
  assert.ok(r.error, 'pemilik terakhir seharusnya tidak bisa nonaktif');
  const d = await sb.A.from('anggota').delete().eq('keluarga_id', KA).eq('user_id', uid.A).select();
  assert.ok(d.error, 'pemilik terakhir seharusnya tidak bisa dihapus');
});

test('13. jenis kategori harus cocok dengan jenis transaksi', async () => {
  const katMasuk = (await sb.A.from('kategori').select('id').eq('keluarga_id', KA).eq('jenis', 'masuk').limit(1).single()).data.id;
  const r = await sb.A.from('transaksi').insert({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27',
    jumlah: 1, kategori_id: katMasuk, dompet_id: dompetA });
  assert.ok(r.error);
});

test('14. upsert dengan id dari HP idempoten (antrian offline)', async () => {
  const id = crypto.randomUUID();
  const baris = { id, keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-27', jumlah: 4000, kategori_id: katA, dompet_id: dompetA };
  for (let i = 0; i < 2; i++) {
    const r = await sb.A2.from('transaksi').upsert(baris, { onConflict: 'id' });
    assert.ifError(r.error);
  }
  const { data } = await sb.A2.from('transaksi').select('id').eq('id', id);
  assert.equal(data.length, 1);
});

test('15. B tidak bisa membuat keluarga atas nama orang lain / membaca kas_meta', async () => {
  const r = await sb.B.from('keluarga').insert({ nama: 'Liar', dibuat_oleh: uid.A });
  assert.ok(r.error, 'insert langsung ke keluarga harus ditolak');
  const m = await sb.B.schema('kas_meta').from('migrasi').select('*');
  assert.ok(m.error, 'kas_meta tidak boleh terjangkau');
});
