// Komponen tampilan bersama.
import { h } from './dom.js';
import { S, namaAnggota } from '../state.js';
import { rp } from '../engine/uang.js';
import { tglPendek, geserBulan, namaBulan } from '../engine/tanggal.js';

export function barisTransaksi(t) {
  const kat = S.kategori.find((k) => k.id === t.kategori_id);
  const dom = S.dompet.find((d) => d.id === t.dompet_id);
  const tuj = S.dompet.find((d) => d.id === t.dompet_tujuan_id);
  let ikon = kat?.ikon || '•', judul = kat?.nama || '—', kelas = t.jenis;
  if (t.jenis === 'pindah') { ikon = '⇄'; judul = `Pindah ke ${tuj?.nama || '—'}`; }
  if (t.jenis === 'penyesuaian') { ikon = '⚖'; judul = 'Penyesuaian saldo'; }
  const tanda = t.jenis === 'keluar' ? '−' : t.jenis === 'masuk' ? '+' : '';
  const nilai = t.jenis === 'penyesuaian' ? rp(t.jumlah) : `${tanda}${rp(t.jumlah)}`;
  return h('a', { class: `trx ${kelas}`, href: `#/catat/${t.id}` },
    h('span', { class: 'ikon', 'aria-hidden': 'true' }, ikon),
    h('span', { class: 'teks' },
      h('strong', {}, judul),
      h('small', {}, [t.catatan, dom?.nama, namaAnggota(t.dicatat_oleh)].filter(Boolean).join(' · '))),
    h('span', { class: 'nilai' }, nilai));
}

export function pemilihBulan(bulan, keHash) {
  return h('div', { class: 'pilih-bulan' },
    h('a', { class: 'tombol kedua kecil', href: keHash(geserBulan(bulan, -1)), 'aria-label': 'Bulan sebelumnya' }, '‹'),
    h('strong', {}, namaBulan(bulan)),
    h('a', { class: 'tombol kedua kecil', href: keHash(geserBulan(bulan, 1)), 'aria-label': 'Bulan berikutnya' }, '›'));
}

/** Bar kemajuan anggaran. */
export function barAnggaran(terpakai, batas) {
  const persen = batas ? Math.min(100, Math.round((terpakai / batas) * 100)) : 0;
  const kelas = !batas ? '' : terpakai > batas ? 'lewat' : persen >= 80 ? 'hampir' : 'aman';
  return h('div', { class: `bar ${kelas}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': persen },
    h('span', { style: { width: `${persen}%` } }));
}

export const kosong = (pesan) => h('p', { class: 'kosong' }, pesan);
export const judulBagian = (teks, ...kanan) => h('div', { class: 'judul-bagian' }, h('h2', {}, teks), ...kanan);
export { tglPendek };
