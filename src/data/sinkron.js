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
export const status = { mengirim: false, menarik: false, terakhir: null, galat: null, antrian: 0, gagal: 0, tertua: null };
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
 * (cukup kirim keadaan terakhir); `versi` naik tiap tulis supaya ubahan yang terjadi
 * saat kiriman sebelumnya masih berjalan tidak ikut terhapus.
 */
export async function tulis(tabel, baris) {
  const sekarang = new Date().toISOString();
  const lokal = { ...baris, updated_at: sekarang };
  await db.transaction('rw', db[tabel], db.antrian, async () => {
    await db[tabel].put(lokal);
    const lama = await db.antrian.where({ tabel, id: baris.id }).first();
    const item = { tabel, id: baris.id, baris: pilih(tabel, lokal), dibuat_at: lama?.dibuat_at || sekarang,
      galat: null, versi: (lama?.versi || 0) + 1 };
    if (lama) await db.antrian.update(lama.no, item);
    else await db.antrian.add(item);
  });
  await hitungAntrian();
  jadwalkan();
  return lokal;
}

/** Ringkasan isi item antrian untuk ditampilkan sebelum pengguna memutuskan. */
export async function daftarDitolak() {
  return db.antrian.filter((a) => !!a.galat).toArray();
}

/** Coba kirim ulang item yang ditolak (mis. setelah masalah diperbaiki). */
export async function kirimUlang(no) {
  await db.antrian.update(no, { galat: null });
  await hitungAntrian();
  jadwalkan(0);
}

/** Buang item antrian yang ditolak server (pengguna memutuskan); data lokal ditarik ulang. */
export async function buangAntrian(no) {
  await db.antrian.delete(no);
  await setMeta('tanda_transaksi', null);
  await hitungAntrian();
  jadwalkan(0);
}

const galatJaringan = (e) => !e?.code && (e?.name === 'TypeError' || e?.name === 'AbortError'
  || /fetch|network|Load failed|timed? ?out/i.test(String(e?.message)));

/**
 * Hanya penolakan karena isi data yang permanen (pelanggaran aturan/izin saat sesi sah).
 * Selain itu (5xx, 429, proyek dijeda, sesi habis, jaringan) → dicoba ulang nanti.
 */
async function ditolakPermanen(error) {
  const kode = String(error?.code || '');
  if (/^(22|23|P0001|P0002)/.test(kode)) return true;
  if (kode === '42501' || kode === '42P01' || kode === 'PGRST204') {
    const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
    return !!data?.session && Date.now() < data.session.expires_at * 1000;
  }
  return false;
}

class GalatSementara extends Error {}

async function kirim(gen) {
  const antrian = await db.antrian.orderBy('no').toArray();
  for (const a of antrian) {
    // keluar/ganti akun terjadi selama kiriman → berhenti, jangan kirim dengan sesi akun lain
    if (gen !== generasi) throw new GalatSementara('dihentikan');
    if (a.galat) continue; // menunggu keputusan pengguna
    if (!(await db.antrian.get(a.no))) continue; // sudah dibuang/dikosongkan
    const { error } = await sb.from(a.tabel).upsert(a.baris, KONFLIK[a.tabel] ? { onConflict: KONFLIK[a.tabel] } : undefined);
    if (!error) {
      // hapus hanya bila belum diubah lagi selama kiriman berjalan
      await db.transaction('rw', db.antrian, async () => {
        const kini = await db.antrian.get(a.no);
        if (kini && (kini.versi || 0) === (a.versi || 0)) await db.antrian.delete(a.no);
      });
      continue;
    }
    if (galatJaringan(error)) throw new GalatSementara('offline');
    if (!(await ditolakPermanen(error))) {
      const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
      throw new GalatSementara(data?.session ? 'server' : 'sesi');
    }
    await db.antrian.update(a.no, { galat: `${error.message}${error.code ? ` (${error.code})` : ''}` });
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

const sidik = (rows) => JSON.stringify(rows.map((r) => [r.id ?? r.user_id, r.updated_at]).sort());

/**
 * Tarik data keluarga. Tabel kecil diganti penuh; transaksi bertahap berdasarkan updated_at.
 * Mengembalikan true bila ada yang berubah (agar layar tidak digambar ulang percuma).
 */
async function tarik(keluargaId, gen) {
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
  if (gen !== generasi) return false; // keluar/ganti akun saat menarik → jangan tulis apa pun

  let berubah = !sejak;
  await db.transaction('rw', [db.keluarga, db.anggota, db.kategori, db.dompet, db.anggaran, db.transaksi, db.meta, db.antrian], async () => {
    // dihitung di dalam transaksi: tulisan lokal yang terjadi selama fetch tetap terlindungi
    const tertunda = new Set((await db.antrian.toArray()).map((a) => `${a.tabel}:${a.id}`));
    const sidikLama = await ambilMeta('sidik_kecil');
    const sidikBaru = sidik([...kel, ...ang, ...kat, ...dom, ...angg]);
    if (sidikLama !== sidikBaru) berubah = true;

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
    const masuk = trx.filter((r) => !tertunda.has(`transaksi:${r.id}`));
    if (!berubah && masuk.length) {
      const lama = await db.transaksi.bulkGet(masuk.map((r) => r.id));
      berubah = masuk.some((r, i) => lama[i]?.updated_at !== r.updated_at);
    }
    await db.transaksi.bulkPut(masuk);
    const maks = trx.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), tanda || '');
    if (maks) await db.meta.put({ kunci: 'tanda_transaksi', nilai: maks });
    await db.meta.put({ kunci: 'sidik_kecil', nilai: sidikBaru });
  });
  return berubah;
}

let berjalan = null;
let berjalanGen = -1;
let ulangi = false;
let generasi = 0;

/** Kirim antrian lalu tarik perubahan. Aman dipanggil berkali-kali (digabung). Mengembalikan true bila data berubah. */
export async function sinkron(keluargaId) {
  // run milik generasi lama (sudah dihentikan) tidak boleh dipakai ulang
  if (berjalan && berjalanGen === generasi) { ulangi = true; return berjalan; }
  const gen = generasi;
  berjalan = (async () => {
    let berubah = false;
    const antrianAwal = status.antrian;
    do {
      ulangi = false;
      if (!navigator.onLine) { status.galat = 'offline'; break; }
      try {
        status.mengirim = true; kabari();
        await kirim(gen);
        status.mengirim = false; status.menarik = true; kabari();
        if (keluargaId && gen === generasi) berubah = (await tarik(keluargaId, gen)) || berubah;
        status.terakhir = new Date().toISOString();
        status.galat = null;
      } catch (e) {
        status.galat = e instanceof GalatSementara ? e.message : galatJaringan(e) ? 'offline' : (e.message || String(e));
        console.warn('[sinkron]', e);
      } finally {
        status.mengirim = false; status.menarik = false;
        await hitungAntrian();
      }
    } while (ulangi && gen === generasi);
    return berubah || status.antrian !== antrianAwal;
  })();
  const milik = berjalan;
  berjalanGen = gen;
  try { return await milik; } finally { if (berjalan === milik) berjalan = null; }
}

// ---- penjadwal: setelah tulis, saat online, saat aplikasi kembali ke depan, tiap 60 detik
let keluargaAktif = null;
let timer = null;
let onSelesai = null;
let interval = null;
export function jadwalkan(tunda = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (keluargaAktif) sinkron(keluargaAktif).then((berubah) => { if (berubah) onSelesai?.(); });
  }, tunda);
}
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

/**
 * Hentikan sinkron. Menunggu yang sedang berjalan paling lama 3 detik (fetch bisa menggantung di
 * Wi-Fi tanpa internet); aman karena `generasi` mencegah hasil tarik ditulis setelahnya.
 */
export async function hentikanSinkron() {
  generasi++;
  keluargaAktif = null; onSelesai = null;
  clearTimeout(timer);
  if (berjalan) await Promise.race([berjalan.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
}
