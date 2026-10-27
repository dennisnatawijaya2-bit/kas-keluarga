// Catat cepat: angka → kategori → Simpan. Juga dipakai untuk mengubah/menghapus catatan.
import { h, toast, konfirmasi } from '../dom.js';
import { S, simpanTransaksi, hapusTransaksi, kategoriSering, dompetAktif, dompetBawaan, tanggalHariIni, bisaTulis, namaAnggota } from '../../state.js';
import { ribuan, rp, BATAS } from '../../engine/uang.js';
import { sahIso, tglPanjang } from '../../engine/tanggal.js';

const JENIS = [['keluar', 'Keluar'], ['masuk', 'Masuk'], ['pindah', 'Pindah']];

export function catat({ arg }) {
  const lama = arg ? S.transaksi.find((t) => t.id === arg) : null;
  if (arg && !lama) return h('div', { class: 'halaman' }, h('p', { class: 'kosong' }, 'Catatan tidak ditemukan.'), h('a', { class: 'tombol kedua', href: '#/riwayat' }, 'Ke Riwayat'));
  if (lama?.jenis === 'penyesuaian' || !bisaTulis()) return lihatSaja(lama);

  const st = {
    jenis: lama?.jenis || 'keluar',
    angka: lama ? String(lama.jumlah) : '',
    kategori_id: lama?.kategori_id || null,
    dompet_id: lama?.dompet_id || null,
    dompet_tujuan_id: lama?.dompet_tujuan_id || null,
    tanggal: lama?.tanggal || tanggalHariIni(),
    catatan: lama?.catatan || '',
  };
  const wadah = h('form', { class: 'halaman catat', onsubmit: (e) => { e.preventDefault(); simpan(); } });

  const layar = h('output', { class: 'layar-angka', 'aria-live': 'polite', 'aria-label': 'Jumlah' });
  const jenisBtn = JENIS.map(([v, label]) => h('button', { type: 'button', role: 'tab', class: 'seg', dataset: { v },
    onclick: () => { st.jenis = v; st.kategori_id = null; gambar(); } }, label));
  const gridKat = h('div', { class: 'grid-kat', role: 'radiogroup', 'aria-label': 'Kategori' });
  const pilihDompet = h('select', { id: 'dompet', onchange: (e) => { st.dompet_id = e.target.value; } });
  const pilihTujuan = h('select', { id: 'tujuan', onchange: (e) => { st.dompet_tujuan_id = e.target.value; } });
  const inTanggal = h('input', { type: 'date', id: 'tgl', value: st.tanggal, required: true, onchange: (e) => { st.tanggal = e.target.value; } });
  const inCatatan = h('input', { id: 'cat', maxlength: 200, value: st.catatan, placeholder: 'boleh kosong', oninput: (e) => { st.catatan = e.target.value; } });
  const blokTujuan = h('div', {}, h('label', { for: 'tujuan' }, 'Ke dompet'), pilihTujuan);
  const tombolSimpan = h('button', { type: 'submit', class: 'tombol utama lebar besar' }, lama ? 'Simpan perubahan' : 'Simpan');

  const ketik = (k) => {
    if (k === 'hapus') st.angka = st.angka.slice(0, -1);
    else if (k === 'bersih') st.angka = '';
    else {
      const baru = (st.angka + k).replace(/^0+/, '');
      if (Number(baru) <= BATAS) st.angka = baru;
    }
    gambarAngka();
  };
  const tombol = (k, label = k, aria) => h('button', { type: 'button', class: 'kunci', 'aria-label': aria || label, onclick: () => ketik(k) }, label);
  const keypad = h('div', { class: 'keypad' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => tombol(k)),
    tombol('000'), tombol('0'), tombol('hapus', '⌫', 'Hapus satu angka'));
  // keyboard fisik / laptop
  wadah.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (/^\d$/.test(e.key)) { ketik(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { ketik('hapus'); e.preventDefault(); }
  });

  function gambarAngka() {
    layar.textContent = `Rp ${ribuan(Number(st.angka || 0))}`;
    layar.classList.toggle('nol', !st.angka);
  }

  function gambar() {
    jenisBtn.forEach((b) => { const on = b.dataset.v === st.jenis; b.classList.toggle('aktif', on); b.setAttribute('aria-selected', String(on)); });
    wadah.dataset.jenis = st.jenis;
    gridKat.replaceChildren(...(st.jenis === 'pindah' ? [] : kategoriSering(st.jenis).map((k) =>
      h('button', { type: 'button', role: 'radio', class: `kat ${st.kategori_id === k.id ? 'pilih' : ''}`, 'aria-checked': String(st.kategori_id === k.id),
        onclick: () => { st.kategori_id = k.id; gambar(); } },
      h('span', { 'aria-hidden': 'true' }, k.ikon), h('small', {}, k.nama)))));
    gridKat.hidden = st.jenis === 'pindah';
    blokTujuan.hidden = st.jenis !== 'pindah';
  }

  const opsiDompet = (sel, terpilih) => {
    const daftar = dompetAktif();
    if (terpilih && !daftar.some((d) => d.id === terpilih)) {
      const arsip = S.dompet.find((d) => d.id === terpilih);
      if (arsip) daftar.push(arsip);
    }
    sel.replaceChildren(...daftar.map((d) => h('option', { value: d.id, selected: d.id === terpilih }, d.nama)));
  };

  async function simpan() {
    const jumlah = Number(st.angka || 0);
    if (!jumlah) return toast('Isi jumlahnya dulu.', 'galat');
    if (st.jenis !== 'pindah' && !st.kategori_id) return toast('Pilih kategori.', 'galat');
    if (!st.dompet_id) return toast('Pilih dompet.', 'galat');
    if (st.jenis === 'pindah' && (!st.dompet_tujuan_id || st.dompet_tujuan_id === st.dompet_id)) return toast('Pilih dompet tujuan yang berbeda.', 'galat');
    if (!sahIso(st.tanggal)) return toast('Tanggal tidak sah.', 'galat');
    tombolSimpan.disabled = true;
    try {
      await simpanTransaksi({ ...(lama || {}), jenis: st.jenis, jumlah, kategori_id: st.kategori_id, dompet_id: st.dompet_id,
        dompet_tujuan_id: st.dompet_tujuan_id, tanggal: st.tanggal, catatan: st.catatan.trim() || null });
      toast(lama ? 'Perubahan tersimpan' : `Tersimpan: ${rp(jumlah)}`);
      location.hash = lama ? `#/riwayat/${st.tanggal.slice(0, 7)}` : '#/beranda';
    } catch (e) {
      tombolSimpan.disabled = false;
      toast(`Gagal menyimpan: ${e.message}`, 'galat');
    }
  }

  wadah.append(
    h('div', { class: 'segmen', role: 'tablist', 'aria-label': 'Jenis' }, jenisBtn),
    layar, keypad, gridKat,
    h('details', { class: 'detail', open: !!lama || undefined },
      h('summary', {}, 'Dompet, tanggal & catatan'),
      h('label', { for: 'dompet' }, 'Dompet'), pilihDompet, blokTujuan,
      h('label', { for: 'tgl' }, 'Tanggal'), inTanggal,
      h('label', { for: 'cat' }, 'Catatan'), inCatatan),
    tombolSimpan,
    lama ? h('button', { type: 'button', class: 'tombol bahaya lebar', onclick: async () => {
      if (!(await konfirmasi({ judul: 'Hapus catatan ini?', isi: `${rp(lama.jumlah)} — ${tglPanjang(lama.tanggal)}`, ok: 'Hapus', bahaya: true }))) return;
      await hapusTransaksi(lama.id);
      toast('Catatan dihapus');
      location.hash = `#/riwayat/${lama.tanggal.slice(0, 7)}`;
    } }, 'Hapus') : null,
    lama ? h('p', { class: 'redup kecil' }, `Dicatat oleh ${namaAnggota(lama.dicatat_oleh)}`) : null);

  gambarAngka();
  gambar();
  (async () => {
    st.dompet_id ||= await dompetBawaan();
    st.dompet_tujuan_id ||= dompetAktif().find((d) => d.id !== st.dompet_id)?.id || null;
    opsiDompet(pilihDompet, st.dompet_id);
    opsiDompet(pilihTujuan, st.dompet_tujuan_id);
  })();
  return wadah;
}

function lihatSaja(t) {
  if (!t) return h('div', { class: 'halaman' }, h('p', { class: 'kosong' }, 'Peranmu hanya bisa melihat. Minta pemilik bila perlu mencatat.'));
  const kat = S.kategori.find((k) => k.id === t.kategori_id);
  return h('div', { class: 'halaman' }, h('div', { class: 'kartu' },
    h('h2', {}, t.jenis === 'penyesuaian' ? 'Penyesuaian saldo' : kat?.nama || t.jenis),
    h('p', { class: 'besar' }, rp(t.jumlah)),
    h('p', {}, tglPanjang(t.tanggal)),
    t.catatan ? h('p', {}, t.catatan) : null,
    h('p', { class: 'redup' }, `Dicatat oleh ${namaAnggota(t.dicatat_oleh)}`)),
    bisaTulis() && t.jenis === 'penyesuaian' ? h('button', { class: 'tombol bahaya lebar', onclick: async () => {
      if (!(await konfirmasi({ judul: 'Hapus penyesuaian ini?', ok: 'Hapus', bahaya: true }))) return;
      await hapusTransaksi(t.id); location.hash = '#/beranda';
    } }, 'Hapus') : null);
}
