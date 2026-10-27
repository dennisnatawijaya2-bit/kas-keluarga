import { h } from '../dom.js';
import { S, tanggalHariIni } from '../../state.js';
import { perHari } from '../../engine/laporan.js';
import { bulanDari, tglPanjang } from '../../engine/tanggal.js';
import { rp } from '../../engine/uang.js';
import { barisTransaksi, pemilihBulan, kosong } from '../komponen.js';

// Saringan bertahan selama aplikasi terbuka (tidak hilang saat data tersinkron).
const saring = { kategori: '', dompet: '', anggota: '', cari: '' };

export function riwayat({ arg }) {
  const bulan = /^\d{4}-\d{2}$/.test(arg || '') ? arg : bulanDari(tanggalHariIni());
  const wadah = h('div', { class: 'halaman' });
  const daftar = h('div');

  const pilih = (kunci, label, opsi) => h('select', { 'aria-label': label, onchange: (e) => { saring[kunci] = e.target.value; isi(); } },
    h('option', { value: '' }, label), opsi.map(([v, t]) => h('option', { value: v, selected: saring[kunci] === v }, t)));

  const cari = h('input', { type: 'search', placeholder: 'Cari catatan…', value: saring.cari, 'aria-label': 'Cari catatan',
    oninput: (e) => { saring.cari = e.target.value; isi(); } });

  function isi() {
    const q = saring.cari.trim().toLowerCase();
    const cocok = S.transaksi.filter((t) =>
      (!saring.kategori || t.kategori_id === saring.kategori) &&
      (!saring.dompet || t.dompet_id === saring.dompet || t.dompet_tujuan_id === saring.dompet) &&
      (!saring.anggota || t.dicatat_oleh === saring.anggota) &&
      (!q || (t.catatan || '').toLowerCase().includes(q) || (S.kategori.find((k) => k.id === t.kategori_id)?.nama || '').toLowerCase().includes(q)));
    const hari = perHari(cocok, bulan);
    const totalK = hari.reduce((s, x) => s + x.keluar, 0), totalM = hari.reduce((s, x) => s + x.masuk, 0);
    daftar.replaceChildren(
      h('p', { class: 'redup kecil' }, `Keluar ${rp(totalK)} · Masuk ${rp(totalM)}`),
      ...(hari.length ? hari.map((x) => h('section', { class: 'hari' },
        h('div', { class: 'baris-antara judul-hari' }, h('strong', {}, tglPanjang(x.tanggal)),
          h('small', {}, [x.keluar ? `−${rp(x.keluar)}` : '', x.masuk ? `+${rp(x.masuk)}` : ''].filter(Boolean).join(' '))),
        h('div', { class: 'kartu daftar' }, x.isi.map(barisTransaksi)))) : [kosong('Tidak ada catatan di bulan ini.')]));
  }

  wadah.append(
    pemilihBulan(bulan, (b) => `#/riwayat/${b}`),
    h('div', { class: 'saringan' }, cari,
      pilih('kategori', 'Semua kategori', S.kategori.map((k) => [k.id, `${k.ikon} ${k.nama}${k.arsip ? ' (arsip)' : ''}`])),
      pilih('dompet', 'Semua dompet', S.dompet.map((d) => [d.id, d.nama])),
      pilih('anggota', 'Semua anggota', S.anggota.map((a) => [a.user_id, a.nama_tampilan]))),
    daftar);
  isi();
  return wadah;
}
