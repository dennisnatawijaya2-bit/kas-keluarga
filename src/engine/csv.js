// Ekspor CSV (UTF-8 + BOM agar Excel membaca huruf dengan benar). Tanpa DOM.

const BAHAYA = /^[=+\-@\t\r]/; // cegah CSV/formula injection di Excel/Sheets

function sel(v, sep) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (BAHAYA.test(s)) s = `'${s}`;
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** kolom: [{ judul, ambil(row) }]; sep default ';' (Excel berbahasa Indonesia). */
export function buatCsv(baris, kolom, sep = ';') {
  const isi = [kolom.map((k) => sel(k.judul, sep)).join(sep)];
  for (const r of baris) isi.push(kolom.map((k) => sel(k.ambil(r), sep)).join(sep));
  return '﻿' + isi.join('\r\n') + '\r\n';
}

/** Kolom standar ekspor transaksi. */
export function kolomTransaksi({ kategori, dompet, anggota }) {
  const nk = new Map(kategori.map((k) => [k.id, k.nama]));
  const nd = new Map(dompet.map((d) => [d.id, d.nama]));
  const na = new Map(anggota.map((a) => [a.user_id, a.nama_tampilan]));
  return [
    { judul: 'tanggal', ambil: (t) => t.tanggal },
    { judul: 'jenis', ambil: (t) => t.jenis },
    { judul: 'kategori', ambil: (t) => nk.get(t.kategori_id) || '' },
    { judul: 'dompet', ambil: (t) => nd.get(t.dompet_id) || '' },
    { judul: 'dompet_tujuan', ambil: (t) => nd.get(t.dompet_tujuan_id) || '' },
    { judul: 'jumlah', ambil: (t) => t.jumlah },
    { judul: 'catatan', ambil: (t) => t.catatan || '' },
    { judul: 'dicatat_oleh', ambil: (t) => na.get(t.dicatat_oleh) || '' },
  ];
}
