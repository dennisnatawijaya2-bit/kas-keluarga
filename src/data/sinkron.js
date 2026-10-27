// Antrian tulis offline + sinkron dua arah dengan Supabase.
// Prinsip: setiap perubahan ditulis dulu ke IndexedDB & antrian (tampil seketika),
// lalu dikirim sebagai UPSERT berdasarkan id (dikirim ulang tetap satu baris).
import { db, ambilMeta, setMeta } from './lokal.js';
import { sb } from './supabase.js';

// Kolom yang boleh dikirim per tabel (kolom lain diisi server: dicatat_oleh, dibuat_at, updated_at).
const KOLOM = {
  transaksi: ['id', 'keluarga_id', 'jenis', 'tanggal', 'jumlah', 'kategori_id', 'dompet_id', 'dompet_tujuan_id', 'catatan', 'wajar', 'dihapus_at'],
  kategori: ['id', 'keluarga_id', 'nama', 'jenis', 'ikon', 'warna', 'urutan', 'arsip'],
  dompet: ['id', 'keluarga_id', 'nama', 'jenis', 'saldo_awal', 'urutan', 'arsip'],
  anggaran: ['keluarga_id', 'bulan', 'kategori_id', 'jumlah'],
};
const KONFLIK = { anggaran: 'keluarga_id,bulan,kategori_id' };
const pilih = (tabel, baris) => Object.fromEntries(KOLOM[tabel].map((k) => [k, baris[k] ?? null]));

const pendengar = new Set();
export const status = { mengirim: false, menarik: false, terakhir: null, galat: null, antrian: 0, gagal: 0 };
export function dengarkan(fn) { pendengar.add(fn); return () => pendengar.delete(fn); }
const kabari = () => pendengar.forEach((fn) => { try { fn(status); } catch (e) { console.error(e); } });

export async function hitungAntrian() {
  const semua = await db.antrian.toArray();
  status.antrian = semua.length;
  status.gagal = semua.filter((a) => a.galat).length;
  status.tertua = semua.reduce((m, a) => (!m || a.dibuat_at < m ? a.dibuat_at : m), null);
  kabari();
  return semua;
}

/**
 * Simpan baris ke lokal + masukkan antrian. Antrian untuk baris yang sama digabung
 * (cukup kirim keadaan terakhir).
 */
export async function tulis(tabel, baris) {
  const sekarang = new Date().toISOString();
  const lokal = { ...baris, updated_at: sekarang };
  await db.transaction('rw', db[tabel], db.antrian, async () => {
    await db[tabel].put(lokal);
    const lama = await db.antrian.where({ tabel, id: baris.id }).first();
    const item = { tabel, id: baris.id, baris: pilih(tabel, lokal), dibuat_at: lama?.dibuat_at || sekarang, galat: null };
    if (lama) await db.antrian.update(lama.no, item);
    else await db.antrian.add(item);
  });
  await hitungAntrian();
  jadwalkan();
  return lokal;
}

/** Buang item antrian yang ditolak server (pengguna memutuskan); data lokal ditarik ulang. */
export async function buangAntrian(no) {
  await db.antrian.delete(no);
  await setMeta('tanda_transaksi', null);
  await hitungAntrian();
  jadwalkan(0);
}

const galatJaringan = (e) => !e?.code && (e?.name === 'TypeError' || /fetch|network|Failed to fetch|Load failed/i.test(String(e?.message)));

async function kirim() {
  const antrian = await db.antrian.orderBy('no').toArray();
  for (const a of antrian) {
    if (a.galat) continue; // menunggu keputusan pengguna
    const { error } = await sb.from(a.tabel).upsert(a.baris, KONFLIK[a.tabel] ? { onConflict: KONFLIK[a.tabel] } : undefined);
    if (!error) { await db.antrian.delete(a.no); continue; }
    if (galatJaringan(error) || error.status === 401 || /JWT/i.test(error.message)) throw error; // coba lagi nanti
    // ditolak server (aturan/izin) — tandai, jangan ulang terus
    await db.antrian.update(a.no, { galat: error.message || String(error.code) });
  }
}

async function semuaHalaman(qFn) {
  const hasil = [];
  for (let dari = 0; ; dari += 1000) {
    const { data, error } = await qFn().range(dari, dari + 999);
    if (error) throw error;
    hasil.push(...data);
    if (data.length < 1000) return hasil;
  }
}

/** Tarik data keluarga. Tabel kecil diganti penuh; transaksi bertahap berdasarkan updated_at. */
async function tarik(keluargaId) {
  const tertunda = new Set((await db.antrian.toArray()).map((a) => `${a.tabel}:${a.id}`));
  const [kel, ang, kat, dom, angg] = await Promise.all([
    semuaHalaman(() => sb.from('keluarga').select('*').eq('id', keluargaId).order('id')),
    semuaHalaman(() => sb.from('anggota').select('*').eq('keluarga_id', keluargaId).order('user_id')),
    semuaHalaman(() => sb.from('kategori').select('*').eq('keluarga_id', keluargaId).order('id')),
    semuaHalaman(() => sb.from('dompet').select('*').eq('keluarga_id', keluargaId).order('id')),
    semuaHalaman(() => sb.from('anggaran').select('*').eq('keluarga_id', keluargaId).order('id')),
  ]);
  const tanda = await ambilMeta('tanda_transaksi');
  // jendela tumpang 5 menit: transaksi DB yang commit sedikit terlambat tetap tertangkap
  const sejak = tanda ? new Date(Date.parse(tanda) - 5 * 60 * 1000).toISOString() : null;
  const trx = await semuaHalaman(() => {
    let q = sb.from('transaksi').select('*').eq('keluarga_id', keluargaId);
    if (sejak) q = q.gt('updated_at', sejak);
    return q.order('updated_at').order('id');
  });

  await db.transaction('rw', [db.keluarga, db.anggota, db.kategori, db.dompet, db.anggaran, db.transaksi, db.meta], async () => {
    // Ganti isi tabel kecil dengan versi server, kecuali baris lokal yang masih menunggu kirim.
    // kunciAlami: anggaran dikenali per (bulan, kategori) karena id lokal bisa beda dengan id server.
    const ganti = async (tabel, rows, kunciAlami = (r) => r.id) => {
      const lokalTertunda = (await db[tabel].where('keluarga_id').equals(keluargaId).toArray())
        .filter((r) => tertunda.has(`${tabel}:${r.id}`));
      const kunciTertunda = new Set(lokalTertunda.map(kunciAlami));
      const simpan = rows.filter((r) => !tertunda.has(`${tabel}:${r.id}`) && !kunciTertunda.has(kunciAlami(r)));
      await db[tabel].where('keluarga_id').equals(keluargaId).delete();
      await db[tabel].bulkPut([...simpan, ...lokalTertunda]);
    };
    await db.keluarga.clear();
    await db.keluarga.bulkPut(kel);
    await db.anggota.where('keluarga_id').equals(keluargaId).delete();
    await db.anggota.bulkPut(ang);
    await ganti('kategori', kat);
    await ganti('dompet', dom);
    await ganti('anggaran', angg, (r) => `${r.bulan}|${r.kategori_id}`);
    if (!sejak) await db.transaksi.where('keluarga_id').equals(keluargaId).filter((r) => !tertunda.has(`transaksi:${r.id}`)).delete();
    await db.transaksi.bulkPut(trx.filter((r) => !tertunda.has(`transaksi:${r.id}`)));
    const maks = trx.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), tanda || '');
    if (maks) await db.meta.put({ kunci: 'tanda_transaksi', nilai: maks });
  });
}

let berjalan = null;
let ulangi = false;

/** Kirim antrian lalu tarik perubahan. Aman dipanggil berkali-kali (digabung). */
export async function sinkron(keluargaId) {
  if (berjalan) { ulangi = true; return berjalan; }
  berjalan = (async () => {
    do {
      ulangi = false;
      if (!navigator.onLine) { status.galat = 'offline'; break; }
      try {
        status.mengirim = true; kabari();
        await kirim();
        status.mengirim = false; status.menarik = true; kabari();
        if (keluargaId) await tarik(keluargaId);
        status.terakhir = new Date().toISOString();
        status.galat = null;
      } catch (e) {
        status.galat = galatJaringan(e) ? 'offline' : (e.message || String(e));
        console.warn('[sinkron]', e);
      } finally {
        status.mengirim = false; status.menarik = false;
        await hitungAntrian();
      }
    } while (ulangi);
  })();
  try { await berjalan; } finally { berjalan = null; }
}

// ---- penjadwal: setelah tulis, saat online, saat aplikasi kembali ke depan, tiap 60 detik
let keluargaAktif = null;
let timer = null;
export function jadwalkan(tunda = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => { if (keluargaAktif) sinkron(keluargaAktif).then(() => onSelesai?.()); }, tunda);
}
let onSelesai = null;
let interval = null;
export function mulaiSinkronOtomatis(keluargaId, setelah) {
  keluargaAktif = keluargaId;
  onSelesai = setelah;
  if (interval) return;
  window.addEventListener('online', () => jadwalkan(0));
  window.addEventListener('offline', () => { status.galat = 'offline'; kabari(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') jadwalkan(0); });
  interval = setInterval(() => { if (document.visibilityState === 'visible') jadwalkan(0); }, 60_000);
  jadwalkan(0);
}
export function hentikanSinkron() {
  keluargaAktif = null; onSelesai = null;
  clearTimeout(timer);
}
