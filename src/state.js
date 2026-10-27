// Keadaan aplikasi: sesi, keluarga aktif, salinan data dari IndexedDB.
import { db, ambilMeta, setMeta } from './data/lokal.js';
import { tulis } from './data/sinkron.js';
import { hariIni } from './engine/tanggal.js';

export const S = {
  user: null,           // { id, email }
  keluargaId: null,
  keluarga: null,
  peran: null,          // pemilik | anggota | lihat
  anggota: [], kategori: [], dompet: [], anggaran: [], transaksi: [],
};

const pendengar = new Set();
export const dengarkanState = (fn) => { pendengar.add(fn); return () => pendengar.delete(fn); };
const kabari = () => pendengar.forEach((fn) => fn(S));

/** Muat ulang S dari IndexedDB. */
export async function muat() {
  S.keluargaId = await ambilMeta('keluarga_aktif');
  if (!S.keluargaId) return kabari();
  const k = S.keluargaId;
  const [kel, ang, kat, dom, angg, trx] = await Promise.all([
    db.keluarga.get(k),
    db.anggota.where('keluarga_id').equals(k).toArray(),
    db.kategori.where('keluarga_id').equals(k).toArray(),
    db.dompet.where('keluarga_id').equals(k).toArray(),
    db.anggaran.where('keluarga_id').equals(k).toArray(),
    db.transaksi.where('keluarga_id').equals(k).toArray(),
  ]);
  S.keluarga = kel || null;
  S.anggota = ang;
  S.kategori = kat.sort((a, b) => (a.urutan - b.urutan) || a.nama.localeCompare(b.nama, 'id'));
  S.dompet = dom.sort((a, b) => (a.urutan - b.urutan) || a.nama.localeCompare(b.nama, 'id'));
  S.anggaran = angg;
  S.transaksi = trx;
  const saya = ang.find((a) => a.user_id === S.user?.id);
  S.peran = saya?.aktif ? saya.peran : null;
  kabari();
}

export const bisaTulis = () => S.peran === 'pemilik' || S.peran === 'anggota';
export const pemilik = () => S.peran === 'pemilik';
export const kategoriAktif = (jenis) => S.kategori.filter((k) => !k.arsip && (!jenis || k.jenis === jenis));
export const dompetAktif = () => S.dompet.filter((d) => !d.arsip);
export const namaAnggota = (uid) => S.anggota.find((a) => a.user_id === uid)?.nama_tampilan || '—';

/** Kategori yang paling sering dipakai 60 hari terakhir tampil lebih dulu di layar Catat. */
export function kategoriSering(jenis) {
  const batas = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const hitung = new Map();
  for (const t of S.transaksi) if (!t.dihapus_at && t.jenis === jenis && t.tanggal >= batas) hitung.set(t.kategori_id, (hitung.get(t.kategori_id) || 0) + 1);
  return kategoriAktif(jenis).sort((a, b) => (hitung.get(b.id) || 0) - (hitung.get(a.id) || 0) || a.urutan - b.urutan);
}

// ---------------------------------------------------------------- aksi tulis (lewat antrian offline)
export async function simpanTransaksi(t) {
  const baru = !t.id;
  const baris = {
    ...t,
    id: t.id || crypto.randomUUID(),
    keluarga_id: S.keluargaId,
    dicatat_oleh: t.dicatat_oleh || S.user.id,
    dibuat_at: t.dibuat_at || new Date().toISOString(),
    wajar: t.wajar ?? false,
    dihapus_at: t.dihapus_at ?? null,
  };
  if (baris.jenis !== 'pindah') baris.dompet_tujuan_id = null;
  if (baris.jenis === 'pindah' || baris.jenis === 'penyesuaian') baris.kategori_id = null;
  await tulis('transaksi', baris);
  if (baru && baris.dompet_id) await setMeta('dompet_terakhir', baris.dompet_id);
  await muat();
  return baris;
}

export async function hapusTransaksi(id) {
  const t = S.transaksi.find((x) => x.id === id);
  if (t) await simpanTransaksi({ ...t, dihapus_at: new Date().toISOString() });
}

export async function tandaiWajar(ids) {
  for (const id of ids) {
    const t = S.transaksi.find((x) => x.id === id);
    if (t) await tulis('transaksi', { ...t, wajar: true });
  }
  await muat();
}

export async function simpanKategori(k) {
  await tulis('kategori', { arsip: false, ikon: '•', warna: null, urutan: 50, ...k, id: k.id || crypto.randomUUID(), keluarga_id: S.keluargaId });
  await muat();
}

export async function simpanDompet(d) {
  await tulis('dompet', { arsip: false, saldo_awal: 0, urutan: 50, jenis: 'tunai', ...d, id: d.id || crypto.randomUUID(), keluarga_id: S.keluargaId });
  await muat();
}

export async function simpanAnggaran(bulanIso, kategoriId, jumlah) {
  const ada = S.anggaran.find((a) => a.bulan === bulanIso && a.kategori_id === kategoriId);
  await tulis('anggaran', { id: ada?.id || crypto.randomUUID(), keluarga_id: S.keluargaId, bulan: bulanIso, kategori_id: kategoriId, jumlah });
  await muat();
}

export async function dompetBawaan() {
  const terakhir = await ambilMeta('dompet_terakhir');
  return dompetAktif().find((d) => d.id === terakhir)?.id || dompetAktif()[0]?.id || null;
}

export const tanggalHariIni = () => hariIni(new Date(), S.keluarga?.zona_waktu || 'Asia/Jakarta');
