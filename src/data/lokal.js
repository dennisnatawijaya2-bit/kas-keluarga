// Penyimpanan lokal di HP (IndexedDB via Dexie): salinan data keluarga + antrian tulis offline.
import Dexie from 'dexie';

export const db = new Dexie('kas_keluarga');
db.version(1).stores({
  keluarga: 'id',
  anggota: '[keluarga_id+user_id], keluarga_id',
  kategori: 'id, keluarga_id',
  dompet: 'id, keluarga_id',
  anggaran: 'id, keluarga_id',
  transaksi: 'id, keluarga_id, tanggal',
  antrian: '++no, [tabel+id]',
  meta: 'kunci',
});

export const TABEL_DATA = ['keluarga', 'anggota', 'kategori', 'dompet', 'anggaran', 'transaksi'];

export async function ambilMeta(kunci, bawaan = null) {
  const r = await db.meta.get(kunci);
  return r ? r.nilai : bawaan;
}
export const setMeta = (kunci, nilai) => db.meta.put({ kunci, nilai });

/** Hapus semua data lokal (saat keluar akun — HP bisa dipakai orang lain). */
export async function kosongkanLokal() {
  await db.transaction('rw', [...TABEL_DATA.map((t) => db[t]), db.antrian, db.meta], async () => {
    for (const t of [...TABEL_DATA, 'antrian', 'meta']) await db[t].clear();
  });
}

/** Minta browser tidak menghapus data otomatis (penting di iPhone). */
export async function mintaPersisten() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
