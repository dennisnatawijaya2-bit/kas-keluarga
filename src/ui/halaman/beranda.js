import { h, toast } from '../dom.js';
import { S, tandaiWajar, tanggalHariIni, dompetAktif, bisaTulis } from '../../state.js';
import { ringkasBulan, peringatan, saldoDompet, aktif } from '../../engine/laporan.js';
import { bulanDari, namaBulan } from '../../engine/tanggal.js';
import { rp } from '../../engine/uang.js';
import { status, buangAntrian } from '../../data/sinkron.js';
import { db } from '../../data/lokal.js';
import { barisTransaksi, barAnggaran, kosong, judulBagian } from '../komponen.js';

export function beranda() {
  const bulan = bulanDari(tanggalHariIni());
  const r = ringkasBulan({ transaksi: S.transaksi, kategori: S.kategori, anggaran: S.anggaran, bulan });
  const wadah = h('div', { class: 'halaman' });

  wadah.append(h('section', { class: 'kartu ringkas' },
    h('p', { class: 'redup' }, namaBulan(bulan)),
    h('div', { class: 'tiga' },
      h('div', {}, h('small', {}, 'Pengeluaran'), h('strong', { class: 'keluar' }, rp(r.keluar))),
      h('div', {}, h('small', {}, 'Pemasukan'), h('strong', { class: 'masuk' }, rp(r.masuk))),
      h('div', {}, h('small', {}, 'Selisih'), h('strong', {}, rp(r.selisih)))),
    r.totalAnggaran ? h('div', { class: 'sisa' },
      h('div', { class: 'baris-antara' }, h('span', {}, 'Sisa anggaran'), h('strong', {}, rp(r.sisaAnggaran))),
      barAnggaran(r.totalAnggaran - r.sisaAnggaran, r.totalAnggaran)) :
      h('a', { class: 'tombol teks', href: `#/anggaran/${bulan}` }, 'Atur anggaran bulan ini →')));

  // catatan yang ditolak server
  if (status.gagal) {
    const kotak = h('section', { class: 'kartu peringatan tinggi' }, h('h2', {}, 'Catatan ditolak server'));
    db.antrian.filter((a) => !!a.galat).toArray().then((rows) => {
      for (const a of rows) kotak.append(h('div', { class: 'baris-antara' },
        h('small', {}, `${a.tabel}: ${a.galat}`),
        h('button', { class: 'tombol kedua kecil', onclick: async () => { await buangAntrian(a.no); toast('Catatan dibuang'); } }, 'Buang')));
    });
    wadah.append(kotak);
  }

  const p = peringatan({ transaksi: S.transaksi, kategori: S.kategori, anggaran: S.anggaran, bulan,
    antrian: status.antrian ? [{ dibuat_at: status.tertua || new Date().toISOString() }] : [] });
  if (p.length) {
    wadah.append(judulBagian('Peringatan'));
    for (const x of p) {
      wadah.append(h('div', { class: `kartu peringatan ${x.tingkat}` }, h('p', {}, x.pesan),
        x.trx_id && bisaTulis() ? h('button', { class: 'tombol kedua kecil', onclick: async () => {
          await tandaiWajar(x.trx_id); toast('Ditandai wajar');
        } }, 'Tandai wajar') : null,
        x.kategori_id ? h('a', { class: 'tombol teks', href: `#/anggaran/${bulan}` }, 'Lihat anggaran') : null));
    }
  }

  const saldo = saldoDompet(S.transaksi, S.dompet);
  wadah.append(judulBagian('Saldo dompet', h('a', { class: 'tombol teks', href: '#/kelola/saldo' }, 'Cocokkan')));
  wadah.append(h('div', { class: 'kartu daftar' }, dompetAktif().map((d) =>
    h('div', { class: 'baris-antara' }, h('span', {}, d.nama), h('strong', {}, rp(saldo.get(d.id) || 0))))));

  const terakhir = S.transaksi.filter(aktif).sort((a, b) => String(b.dibuat_at).localeCompare(String(a.dibuat_at))).slice(0, 5);
  wadah.append(judulBagian('Catatan terakhir', h('a', { class: 'tombol teks', href: '#/riwayat' }, 'Semua →')));
  wadah.append(terakhir.length ? h('div', { class: 'kartu daftar' }, terakhir.map(barisTransaksi))
    : kosong(bisaTulis() ? 'Belum ada catatan. Tekan tombol + di bawah untuk mulai mencatat.' : 'Belum ada catatan.'));
  return wadah;
}
