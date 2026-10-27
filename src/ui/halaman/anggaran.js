import { h, toast } from '../dom.js';
import { S, simpanAnggaran, kategoriAktif, tanggalHariIni, bisaTulis } from '../../state.js';
import { ringkasBulan } from '../../engine/laporan.js';
import { bulanDari, awalBulan, geserBulan, namaBulan } from '../../engine/tanggal.js';
import { rp, ribuan, bacaRupiah } from '../../engine/uang.js';
import { pemilihBulan, barAnggaran } from '../komponen.js';

export function anggaran({ arg }) {
  const bulan = /^\d{4}-\d{2}$/.test(arg || '') ? arg : bulanDari(tanggalHariIni());
  const iso = awalBulan(bulan);
  const r = ringkasBulan({ transaksi: S.transaksi, kategori: S.kategori, anggaran: S.anggaran, bulan });
  const pakai = new Map(r.perKategori.map((x) => [x.kategori.id, x.terpakai]));
  const nilai = (kid) => S.anggaran.find((a) => a.bulan === iso && a.kategori_id === kid)?.jumlah;
  const boleh = bisaTulis();
  const total = h('strong');
  const hitungTotal = () => { total.textContent = rp(S.anggaran.filter((a) => a.bulan === iso).reduce((s, a) => s + a.jumlah, 0)); };

  const baris = kategoriAktif('keluar').map((k) => {
    const n = nilai(k.id);
    const masukan = h('input', { inputmode: 'numeric', 'aria-label': `Anggaran ${k.nama}`, value: n ? ribuan(n) : '',
      placeholder: '—', disabled: !boleh, class: 'angka',
      onchange: async (e) => {
        const v = e.target.value.trim() === '' ? 0 : bacaRupiah(e.target.value);
        if (v == null || v < 0) { toast('Jumlah tidak sah', 'galat'); e.target.value = n ? ribuan(n) : ''; return; }
        await simpanAnggaran(iso, k.id, v);
        e.target.value = v ? ribuan(v) : '';
        hitungTotal();
        toast(`Anggaran ${k.nama} disimpan`);
      } });
    return h('div', { class: 'kat-baris' },
      h('div', { class: 'baris-antara' }, h('label', {}, `${k.ikon} ${k.nama}`), masukan),
      h('small', { class: 'redup' }, `Terpakai ${rp(pakai.get(k.id) || 0)}`),
      n ? barAnggaran(pakai.get(k.id) || 0, n) : null);
  });

  const lalu = geserBulan(bulan, -1);
  const adaLalu = S.anggaran.some((a) => a.bulan === awalBulan(lalu) && a.jumlah > 0);
  const wadah = h('div', { class: 'halaman' },
    pemilihBulan(bulan, (b) => `#/anggaran/${b}`),
    h('div', { class: 'kartu baris-antara' }, h('span', {}, 'Total anggaran'), total),
    boleh && adaLalu ? h('button', { class: 'tombol kedua lebar', onclick: async (e) => {
      e.target.disabled = true;
      let n = 0;
      for (const a of S.anggaran.filter((x) => x.bulan === awalBulan(lalu) && x.jumlah > 0)) {
        if (!nilai(a.kategori_id)) { await simpanAnggaran(iso, a.kategori_id, a.jumlah); n++; }
      }
      toast(n ? `${n} anggaran disalin dari ${namaBulan(lalu)}` : 'Semua kategori sudah punya anggaran');
      location.reload();
    } }, `Salin dari ${namaBulan(lalu)}`) : null,
    h('p', { class: 'redup kecil' }, 'Ketik jumlah lalu pindah kolom untuk menyimpan. Kosongkan = tanpa anggaran. Boleh "1,5jt" atau "500rb".'),
    h('div', { class: 'kartu daftar' }, baris));
  hitungTotal();
  return wadah;
}
