import { h, toast, bagikanTeks } from '../dom.js';
import { S, tanggalHariIni } from '../../state.js';
import { ringkasBulan, tren, ringkasTahun, teksRingkasan } from '../../engine/laporan.js';
import { bulanDari } from '../../engine/tanggal.js';
import { rp } from '../../engine/uang.js';
import { pemilihBulan, barAnggaran, kosong, judulBagian } from '../komponen.js';
import { donat, batangTren } from '../grafik.js';

export function ringkasan({ arg }) {
  const bulan = /^\d{4}-\d{2}$/.test(arg || '') ? arg : bulanDari(tanggalHariIni());
  const r = ringkasBulan({ transaksi: S.transaksi, kategori: S.kategori, anggaran: S.anggaran, bulan });
  const keluar = r.perKategori.filter((x) => x.kategori.jenis === 'keluar');
  const masuk = r.perKategori.filter((x) => x.kategori.jenis === 'masuk' && x.terpakai);
  const th = ringkasTahun(S.transaksi, bulan.slice(0, 4));

  return h('div', { class: 'halaman' },
    pemilihBulan(bulan, (b) => `#/ringkasan/${b}`),
    h('section', { class: 'kartu tiga' },
      h('div', {}, h('small', {}, 'Pengeluaran'), h('strong', { class: 'keluar' }, rp(r.keluar))),
      h('div', {}, h('small', {}, 'Pemasukan'), h('strong', { class: 'masuk' }, rp(r.masuk))),
      h('div', {}, h('small', {}, 'Selisih'), h('strong', {}, rp(r.selisih)))),
    h('button', { class: 'tombol utama lebar', onclick: async () => {
      const teks = teksRingkasan({ namaKeluarga: S.keluarga?.nama || 'Keluarga', transaksi: S.transaksi, kategori: S.kategori, anggaran: S.anggaran, bulan });
      try {
        const hasil = await bagikanTeks(teks);
        if (hasil === 'disalin') toast('Ringkasan disalin — tempel di WhatsApp');
      } catch { toast('Tidak bisa membagikan di perangkat ini', 'galat'); }
    } }, 'Bagikan ringkasan'),

    judulBagian('Pengeluaran per kategori', h('a', { class: 'tombol teks', href: `#/anggaran/${bulan}` }, 'Anggaran')),
    keluar.length ? h('div', { class: 'kartu daftar' }, keluar.map((x) => h('div', { class: 'kat-baris' },
      h('div', { class: 'baris-antara' },
        h('span', {}, `${x.kategori.ikon} ${x.kategori.nama}`),
        h('span', {}, h('strong', {}, rp(x.terpakai)), x.anggaran != null ? h('small', { class: `status ${x.status}` }, ` / ${rp(x.anggaran)} (${x.persen}%)`) : null)),
      x.anggaran != null ? barAnggaran(x.terpakai, x.anggaran) : null))) : kosong('Belum ada pengeluaran.'),

    r.keluar ? donat(keluar.filter((x) => x.terpakai).map((x) => ({ label: x.kategori.nama, nilai: x.terpakai })), 'Porsi pengeluaran per kategori') : null,

    masuk.length ? judulBagian('Pemasukan per kategori') : null,
    masuk.length ? h('div', { class: 'kartu daftar' }, masuk.map((x) => h('div', { class: 'baris-antara' },
      h('span', {}, `${x.kategori.ikon} ${x.kategori.nama}`), h('strong', {}, rp(x.terpakai))))) : null,

    judulBagian('Tren 6 bulan'),
    h('div', { class: 'kartu' }, batangTren(tren(S.transaksi, bulan, 6))),

    judulBagian(`Tahun ${th.tahun}`),
    h('section', { class: 'kartu tiga' },
      h('div', {}, h('small', {}, 'Pengeluaran'), h('strong', { class: 'keluar' }, rp(th.keluar))),
      h('div', {}, h('small', {}, 'Pemasukan'), h('strong', { class: 'masuk' }, rp(th.masuk))),
      h('div', {}, h('small', {}, 'Selisih'), h('strong', {}, rp(th.selisih)))));
}
