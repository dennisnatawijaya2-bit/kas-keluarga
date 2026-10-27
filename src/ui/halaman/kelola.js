import { h, toast, konfirmasi, bagikanBerkas } from '../dom.js';
import { S, muat, simpanKategori, simpanDompet, simpanTransaksi, pemilik, bisaTulis, dompetAktif, tanggalHariIni } from '../../state.js';
import { sb, SUPABASE_URL } from '../../data/supabase.js';
import { db, ambilMeta, setMeta } from '../../data/lokal.js';
import { sinkron, status, tulis } from '../../data/sinkron.js';
import { saldoDompet, aktif } from '../../engine/laporan.js';
import { buatCsv, kolomTransaksi } from '../../engine/csv.js';
import { bulanDari, geserBulan, namaBulan, akhirBulan } from '../../engine/tanggal.js';
import { rp, ribuan, bacaRupiah } from '../../engine/uang.js';
import { judulBagian, kosong } from '../komponen.js';
import { keEmail, keUserid } from '../../engine/akun.js';

const kembali = () => h('a', { class: 'tombol teks', href: '#/kelola' }, '‹ Kelola');
const menu = (href, ikon, judul, ket) => h('a', { class: 'menu', href },
  h('span', { 'aria-hidden': 'true' }, ikon), h('span', {}, h('strong', {}, judul), h('small', {}, ket)), h('span', { 'aria-hidden': 'true' }, '›'));

export function kelola({ keluar, versi }) {
  const saya = S.anggota.find((a) => a.user_id === S.user?.id);
  return h('div', { class: 'halaman' },
    h('div', { class: 'kartu' }, h('strong', {}, saya?.nama_tampilan || keUserid(S.user?.email)), h('br'),
      h('small', { class: 'redup' }, `${keUserid(S.user?.email)} · peran: ${S.peran || '—'}`)),
    h('nav', { class: 'kartu daftar', 'aria-label': 'Menu kelola' },
      menu(`#/anggaran/${bulanDari(tanggalHariIni())}`, '🎯', 'Anggaran', 'Batas pengeluaran per kategori per bulan'),
      menu('#/kelola/kategori', '🏷️', 'Kategori', 'Tambah, ubah, arsipkan'),
      menu('#/kelola/dompet', '👛', 'Dompet', 'Tunai, bank, e-wallet'),
      menu('#/kelola/saldo', '⚖️', 'Cocokkan saldo', 'Samakan saldo tercatat dengan uang nyata'),
      menu('#/kelola/anggota', '👨‍👩‍👧', 'Anggota keluarga', pemilik() ? 'Tambah & atur peran' : 'Lihat anggota'),
      menu('#/kelola/ekspor', '📄', 'Ekspor CSV', 'Untuk Excel / Google Sheets'),
      menu('#/kelola/cadangan', '💾', 'Cadangan', pemilik() ? 'Unduh & pulihkan data' : 'Hanya pemilik'),
      menu('#/kelola/akun', '🔑', 'Akun', 'Ganti kata sandi'),
      menu('#/kelola/uji', '🩺', 'Uji mandiri', 'Periksa koneksi & penyimpanan')),
    h('button', { class: 'tombol kedua lebar', onclick: keluar }, 'Keluar dari akun'),
    h('p', { class: 'redup kecil tengah-teks' }, `Kas Keluarga versi ${versi}`));
}

// ---------------------------------------------------------------- kategori
export function kelolaKategori() {
  const boleh = bisaTulis();
  const bagian = (jenis, judul) => {
    const daftar = S.kategori.filter((k) => k.jenis === jenis).sort((a, b) => a.arsip - b.arsip || a.urutan - b.urutan);
    return [judulBagian(judul), h('div', { class: 'kartu daftar' }, daftar.map((k) => barisKategori(k, boleh)))];
  };
  const nama = h('input', { id: 'kn', maxlength: 40, required: true, placeholder: 'Nama kategori' });
  const ikon = h('input', { id: 'ki', maxlength: 4, value: '•', class: 'ikon-input', 'aria-label': 'Ikon (emoji)' });
  const jenis = h('select', { 'aria-label': 'Jenis' }, h('option', { value: 'keluar' }, 'Pengeluaran'), h('option', { value: 'masuk' }, 'Pemasukan'));
  return h('div', { class: 'halaman' }, kembali(),
    boleh ? h('form', { class: 'kartu', onsubmit: async (e) => {
      e.preventDefault();
      if (S.kategori.some((k) => !k.arsip && k.jenis === jenis.value && k.nama.trim().toLowerCase() === nama.value.trim().toLowerCase())) return toast('Nama sudah ada', 'galat');
      await simpanKategori({ nama: nama.value.trim(), ikon: ikon.value.trim() || '•', jenis: jenis.value });
      toast('Kategori ditambah'); nama.value = '';
    } }, h('h2', {}, 'Tambah kategori'), h('div', { class: 'sebaris' }, ikon, nama), jenis,
    h('button', { class: 'tombol utama lebar' }, 'Tambah')) : null,
    ...bagian('keluar', 'Pengeluaran'), ...bagian('masuk', 'Pemasukan'));
}

function barisKategori(k, boleh) {
  return h('div', { class: `baris-antara ${k.arsip ? 'redup' : ''}` },
    h('span', {}, `${k.ikon} ${k.nama}${k.arsip ? ' (arsip)' : ''}`),
    boleh ? h('span', { class: 'aksi' },
      h('button', { class: 'tombol teks kecil', onclick: async () => {
        const baru = await tanya('Ubah nama kategori', k.nama, 40);
        if (baru && baru !== k.nama) { await simpanKategori({ ...k, nama: baru }); toast('Diubah'); }
      } }, 'Ubah'),
      h('button', { class: 'tombol teks kecil', onclick: async () => {
        if (k.arsip && S.kategori.some((x) => x.id !== k.id && !x.arsip && x.jenis === k.jenis && x.nama.trim().toLowerCase() === k.nama.trim().toLowerCase())) {
          return toast('Sudah ada kategori aktif dengan nama sama. Ubah namanya dulu.', 'galat');
        }
        await simpanKategori({ ...k, arsip: !k.arsip }); toast(k.arsip ? 'Dipakai lagi' : 'Diarsipkan (riwayat tetap ada)');
      } }, k.arsip ? 'Pakai lagi' : 'Arsipkan')) : null);
}

/** Dialog input sederhana (tanpa window.prompt). */
function tanya(judul, nilai = '', maks = 40, tipe = 'text') {
  return new Promise((selesai) => {
    const inp = h('input', { value: nilai, maxlength: maks, type: tipe, inputmode: tipe === 'text' ? undefined : 'numeric' });
    const tutup = (v) => { dlg.close(); dlg.remove(); selesai(v); };
    const dlg = h('dialog', { class: 'dialog' }, h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); tutup(inp.value.trim()); } },
      h('h2', {}, judul), inp,
      h('div', { class: 'baris-tombol' },
        h('button', { type: 'button', class: 'tombol kedua', onclick: () => tutup(null) }, 'Batal'),
        h('button', { type: 'submit', class: 'tombol utama' }, 'Simpan'))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); tutup(null); });
    document.body.append(dlg); dlg.showModal(); inp.focus();
  });
}

// ---------------------------------------------------------------- dompet
const JENIS_DOMPET = [['tunai', 'Tunai'], ['bank', 'Bank'], ['ewallet', 'E-wallet'], ['kartu_kredit', 'Kartu kredit'], ['lainnya', 'Lainnya']];
export function kelolaDompet() {
  const boleh = bisaTulis();
  const saldo = saldoDompet(S.transaksi, S.dompet);
  const nama = h('input', { maxlength: 40, required: true, placeholder: 'mis. Bank – Papa (tanpa nomor rekening)', 'aria-label': 'Nama dompet' });
  const jenis = h('select', { 'aria-label': 'Jenis dompet' }, JENIS_DOMPET.map(([v, t]) => h('option', { value: v }, t)));
  const awal = h('input', { inputmode: 'numeric', placeholder: 'Saldo awal (boleh 0)', 'aria-label': 'Saldo awal' });
  return h('div', { class: 'halaman' }, kembali(),
    h('p', { class: 'redup kecil' }, 'Cukup nama panggilan. Jangan menulis nomor rekening, nomor kartu, atau PIN.'),
    boleh ? h('form', { class: 'kartu', onsubmit: async (e) => {
      e.preventDefault();
      const n = awal.value.trim() ? bacaRupiah(awal.value) : 0;
      if (n == null) return toast('Saldo awal tidak sah', 'galat');
      if (S.dompet.some((d) => !d.arsip && d.nama.trim().toLowerCase() === nama.value.trim().toLowerCase())) return toast('Nama sudah ada', 'galat');
      await simpanDompet({ nama: nama.value.trim(), jenis: jenis.value, saldo_awal: n });
      toast('Dompet ditambah'); nama.value = ''; awal.value = '';
    } }, h('h2', {}, 'Tambah dompet'), nama, jenis, awal, h('button', { class: 'tombol utama lebar' }, 'Tambah')) : null,
    h('div', { class: 'kartu daftar' }, S.dompet.map((d) => h('div', { class: `baris-antara ${d.arsip ? 'redup' : ''}` },
      h('span', {}, h('strong', {}, d.nama), h('br'), h('small', {}, `Saldo ${rp(saldo.get(d.id) || 0)} · awal ${rp(d.saldo_awal)}${d.arsip ? ' · arsip' : ''}`)),
      boleh ? h('span', { class: 'aksi' },
        h('button', { class: 'tombol teks kecil', onclick: async () => {
          const baru = await tanya('Ubah nama dompet', d.nama, 40);
          if (baru && baru !== d.nama) { await simpanDompet({ ...d, nama: baru }); toast('Diubah'); }
        } }, 'Ubah'),
        h('button', { class: 'tombol teks kecil', onclick: async () => {
          const baru = await tanya('Saldo awal (Rp)', ribuan(d.saldo_awal), 20, 'text');
          if (baru == null) return;
          const n = bacaRupiah(baru || '0');
          if (n == null) return toast('Tidak sah', 'galat');
          await simpanDompet({ ...d, saldo_awal: n }); toast('Saldo awal diubah');
        } }, 'Saldo awal'),
        h('button', { class: 'tombol teks kecil', onclick: async () => {
          if (d.arsip && S.dompet.some((x) => x.id !== d.id && !x.arsip && x.nama.trim().toLowerCase() === d.nama.trim().toLowerCase())) {
            return toast('Sudah ada dompet aktif dengan nama sama. Ubah namanya dulu.', 'galat');
          }
          await simpanDompet({ ...d, arsip: !d.arsip }); toast(d.arsip ? 'Dipakai lagi' : 'Diarsipkan');
        } }, d.arsip ? 'Pakai lagi' : 'Arsipkan')) : null))));
}

// ---------------------------------------------------------------- cocokkan saldo
export function cocokkanSaldo() {
  const saldo = saldoDompet(S.transaksi, S.dompet);
  const pilih = h('select', { id: 'cs', 'aria-label': 'Dompet' }, dompetAktif().map((d) => h('option', { value: d.id }, d.nama)));
  const nyata = h('input', { id: 'cn', inputmode: 'numeric', required: true, placeholder: 'Uang/saldo nyata sekarang' });
  const info = h('p', { class: 'besar' });
  const tampil = () => { info.textContent = `Tercatat: ${rp(saldo.get(pilih.value) || 0)}`; };
  pilih.addEventListener('change', tampil);
  const form = h('form', { class: 'kartu', onsubmit: async (e) => {
    e.preventDefault();
    if (!bisaTulis()) return toast('Peranmu hanya bisa melihat', 'galat');
    const n = bacaRupiah(nyata.value);
    if (n == null) return toast('Jumlah tidak sah', 'galat');
    if (!pilih.value) return toast('Belum ada dompet aktif', 'galat');
    // dihitung saat ditekan: data bisa sudah berubah oleh sinkron sejak halaman dibuka
    const selisih = n - (saldoDompet(S.transaksi, S.dompet).get(pilih.value) || 0);
    if (!selisih) return toast('Sudah cocok, tidak ada penyesuaian');
    const nama = S.dompet.find((d) => d.id === pilih.value)?.nama;
    const ok = await konfirmasi({ judul: 'Buat penyesuaian?',
      isi: `${nama}: selisih ${rp(selisih)}. Penyesuaian mengubah saldo dompet, tetapi tidak dihitung sebagai pengeluaran/pemasukan.`, ok: 'Buat penyesuaian' });
    if (!ok) return;
    await simpanTransaksi({ jenis: 'penyesuaian', jumlah: selisih, dompet_id: pilih.value, tanggal: tanggalHariIni(), catatan: 'Cocokkan saldo' });
    toast('Penyesuaian dibuat');
    location.hash = '#/beranda';
  } }, h('label', { for: 'cs' }, 'Dompet'), pilih, info, h('label', { for: 'cn' }, 'Saldo nyata (Rp)'), nyata,
  h('button', { class: 'tombol utama lebar' }, 'Hitung selisih'));
  tampil();
  return h('div', { class: 'halaman' }, kembali(), h('h2', {}, 'Cocokkan saldo dompet'),
    h('p', { class: 'redup' }, 'Hitung uang tunai / lihat saldo aplikasi bank, lalu isi di sini. Selisihnya dicatat sebagai penyesuaian.'), form);
}

// ---------------------------------------------------------------- anggota
export function kelolaAnggota() {
  const daftar = h('div', { class: 'kartu daftar' }, S.anggota.sort((a, b) => a.bergabung_at.localeCompare(b.bergabung_at)).map((a) =>
    h('div', { class: `baris-antara ${a.aktif ? '' : 'redup'}` },
      h('span', {}, h('strong', {}, a.nama_tampilan), h('br'), h('small', {}, `${a.peran}${a.aktif ? '' : ' · nonaktif'}${a.user_id === S.user.id ? ' · kamu' : ''}`)),
      pemilik() ? h('span', { class: 'aksi' },
        h('select', { 'aria-label': `Peran ${a.nama_tampilan}`, onchange: async (e) => {
          const { error } = await sb.from('anggota').update({ peran: e.target.value }).eq('keluarga_id', a.keluarga_id).eq('user_id', a.user_id);
          if (error) { toast(error.message, 'galat'); e.target.value = a.peran; return; }
          toast('Peran diubah'); await sinkron(S.keluargaId); await muat();
        } }, ['pemilik', 'anggota', 'lihat'].map((p) => h('option', { value: p, selected: p === a.peran }, p))),
        h('button', { class: 'tombol teks kecil', onclick: async () => {
          if (a.aktif && !(await konfirmasi({ judul: `Nonaktifkan ${a.nama_tampilan}?`, isi: 'Akses ke data keluarga langsung terputus, walau HP-nya masih masuk. Bisa diaktifkan lagi.', ok: 'Nonaktifkan', bahaya: true }))) return;
          const { error } = await sb.from('anggota').update({ aktif: !a.aktif }).eq('keluarga_id', a.keluarga_id).eq('user_id', a.user_id);
          if (error) return toast(error.message, 'galat');
          toast(a.aktif ? 'Dinonaktifkan' : 'Diaktifkan'); await sinkron(S.keluargaId); await muat(); location.reload();
        } }, a.aktif ? 'Nonaktifkan' : 'Aktifkan')) : null)));

  const email = h('input', { type: 'text', required: true, placeholder: 'nama pengguna anggota', 'aria-label': 'Nama pengguna', autocapitalize: 'none', autocorrect: 'off', spellcheck: false });
  const nama = h('input', { required: true, maxlength: 40, placeholder: 'nama panggilan', 'aria-label': 'Nama panggilan' });
  const peran = h('select', { 'aria-label': 'Peran' }, h('option', { value: 'anggota' }, 'anggota (boleh mencatat)'), h('option', { value: 'lihat' }, 'lihat saja'), h('option', { value: 'pemilik' }, 'pemilik'));
  const form = pemilik() ? h('form', { class: 'kartu', onsubmit: async (e) => {
    e.preventDefault();
    if (!navigator.onLine) return toast('Butuh internet untuk menambah anggota', 'galat');
    const alamat = keEmail(email.value);
    if (!alamat) return toast('Nama pengguna tidak sah', 'galat');
    const { error } = await sb.rpc('tambah_anggota', { p_keluarga: S.keluargaId, p_email: alamat, p_nama_tampilan: nama.value, p_peran: peran.value });
    if (error) return toast(error.message, 'galat');
    toast('Anggota ditambah'); await sinkron(S.keluargaId); await muat(); location.reload();
  } }, h('h2', {}, 'Tambah anggota'),
  h('ol', { class: 'redup kecil' },
    h('li', {}, 'Buat akunnya dulu di dasbor Supabase: Authentication → Users → Add user → Create new user, email = <nama pengguna>@kas-keluarga.test, centang Auto Confirm User.'),
    h('li', {}, 'Isi nama penggunanya (tanpa @…) di bawah.'),
    h('li', {}, 'Berikan kata sandinya langsung ke orangnya (jangan lewat grup).')),
  email, nama, peran, h('button', { class: 'tombol utama lebar' }, 'Tambahkan')) : null;
  return h('div', { class: 'halaman' }, kembali(), judulBagian('Anggota keluarga'), daftar, form);
}

// ---------------------------------------------------------------- akun
export function kelolaAkun({ keluar }) {
  const baru = h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', placeholder: 'Kata sandi baru (min. 8)', 'aria-label': 'Kata sandi baru' });
  const ulang = h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', placeholder: 'Ulangi', 'aria-label': 'Ulangi kata sandi' });
  return h('div', { class: 'halaman' }, kembali(),
    h('form', { class: 'kartu', onsubmit: async (e) => {
      e.preventDefault();
      if (baru.value !== ulang.value) return toast('Kata sandi tidak sama', 'galat');
      const { error } = await sb.auth.updateUser({ password: baru.value });
      if (error) return toast(error.message, 'galat');
      baru.value = ulang.value = '';
      toast('Kata sandi diganti');
    } }, h('h2', {}, 'Ganti kata sandi'), baru, ulang, h('button', { class: 'tombol utama lebar' }, 'Simpan')),
    h('button', { class: 'tombol kedua lebar', onclick: keluar }, 'Keluar dari akun'));
}

// ---------------------------------------------------------------- ekspor CSV
export function kelolaEkspor() {
  const ini = bulanDari(tanggalHariIni());
  const opsi = Array.from({ length: 24 }, (_, i) => geserBulan(ini, -i));
  const dari = h('select', { 'aria-label': 'Dari bulan' }, opsi.map((b) => h('option', { value: b, selected: b === ini }, namaBulan(b))));
  const sampai = h('select', { 'aria-label': 'Sampai bulan' }, opsi.map((b) => h('option', { value: b, selected: b === ini }, namaBulan(b))));
  const sep = h('select', { 'aria-label': 'Pemisah kolom' }, h('option', { value: ';' }, 'Titik koma (Excel Indonesia)'), h('option', { value: ',' }, 'Koma (Google Sheets / Excel Inggris)'));
  return h('div', { class: 'halaman' }, kembali(), h('div', { class: 'kartu' }, h('h2', {}, 'Ekspor CSV'),
    h('label', {}, 'Dari'), dari, h('label', {}, 'Sampai'), sampai, h('label', {}, 'Pemisah'), sep,
    h('button', { class: 'tombol utama lebar', onclick: async () => {
      const [a, b] = [dari.value, sampai.value].sort();
      const rows = S.transaksi.filter((t) => aktif(t) && t.tanggal >= `${a}-01` && t.tanggal <= akhirBulan(b))
        .sort((x, y) => x.tanggal.localeCompare(y.tanggal) || String(x.dibuat_at).localeCompare(String(y.dibuat_at)));
      if (!rows.length) return toast('Tidak ada catatan di rentang itu', 'galat');
      const csv = buatCsv(rows, kolomTransaksi(S), sep.value);
      await bagikanBerkas(`kas-keluarga-${a}${a === b ? '' : `_${b}`}.csv`, csv, 'text/csv;charset=utf-8');
      toast(`${rows.length} baris diekspor`);
    } }, 'Unduh / bagikan CSV')));
}

// ---------------------------------------------------------------- cadangan
const TABEL_CADANGAN = ['kategori', 'dompet', 'anggaran', 'transaksi'];
export function kelolaCadangan() {
  if (!pemilik()) return h('div', { class: 'halaman' }, kembali(), kosong('Cadangan hanya untuk pemilik keluarga.'));
  const info = h('p', { class: 'redup kecil' });
  ambilMeta('cadangan_terakhir').then((t) => { info.textContent = t ? `Cadangan terakhir: ${new Date(t).toLocaleString('id-ID')}` : 'Belum pernah membuat cadangan.'; });
  const berkas = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Pilih berkas cadangan' });
  return h('div', { class: 'halaman' }, kembali(),
    h('div', { class: 'kartu' }, h('h2', {}, 'Unduh cadangan'),
      h('p', {}, 'Berisi semua kategori, dompet, anggaran, dan catatan keluarga. Simpan di tempat aman (mis. zip berpassword).'), info,
      h('button', { class: 'tombol utama lebar', onclick: async () => {
        if (navigator.onLine) await sinkron(S.keluargaId);
        await muat();
        const isi = { aplikasi: 'kas-keluarga', versi: 1, dibuat: new Date().toISOString(), keluarga: S.keluarga,
          anggota: S.anggota.map(({ user_id, nama_tampilan, peran, aktif: ak }) => ({ user_id, nama_tampilan, peran, aktif: ak })),
          kategori: S.kategori, dompet: S.dompet, anggaran: S.anggaran, transaksi: S.transaksi };
        const tgl = tanggalHariIni().replace(/-/g, '');
        await bagikanBerkas(`kas-keluarga-cadangan-${tgl}.json`, JSON.stringify(isi, null, 1), 'application/json');
        await setMeta('cadangan_terakhir', new Date().toISOString());
        toast('Cadangan dibuat');
      } }, 'Unduh cadangan')),
    h('div', { class: 'kartu' }, h('h2', {}, 'Pulihkan dari cadangan'),
      h('p', { class: 'redup' }, 'Digabung berdasarkan id: catatan yang sudah ada tidak menjadi dobel. Cadangan dari keluarga lain diberi id baru.'),
      berkas,
      h('button', { class: 'tombol kedua lebar', onclick: async () => {
        const f = berkas.files?.[0];
        if (!f) return toast('Pilih berkas dulu', 'galat');
        let data;
        try { data = JSON.parse(await f.text()); } catch { return toast('Berkas bukan JSON yang sah', 'galat'); }
        if (data?.aplikasi !== 'kas-keluarga' || !Array.isArray(data.transaksi)) return toast('Bukan berkas cadangan Kas Keluarga', 'galat');
        if (!(await konfirmasi({ judul: 'Pulihkan cadangan?', isi: `${data.transaksi.length} catatan dari ${data.keluarga?.nama || 'cadangan'} (${data.dibuat?.slice(0, 10)}).`, ok: 'Pulihkan' }))) return;
        const n = await pulihkan(data);
        toast(`${n} baris dipulihkan; dikirim saat online`);
        await muat();
      } }, 'Pulihkan')));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const sahBaris = {
  kategori: (k) => UUID.test(k.id) && typeof k.nama === 'string' && k.nama.trim() && ['keluar', 'masuk'].includes(k.jenis),
  dompet: (d) => UUID.test(d.id) && typeof d.nama === 'string' && d.nama.trim() && Number.isSafeInteger(d.saldo_awal ?? 0),
  anggaran: (a) => UUID.test(a.kategori_id) && ISO.test(a.bulan) && Number.isSafeInteger(a.jumlah) && a.jumlah >= 0,
  transaksi: (t) => UUID.test(t.id) && ISO.test(t.tanggal) && Number.isSafeInteger(t.jumlah) && t.jumlah !== 0
    && ['keluar', 'masuk', 'pindah', 'penyesuaian'].includes(t.jenis) && UUID.test(t.dompet_id),
};

/** id deterministik untuk cadangan dari keluarga lain: impor ulang berkas yang sama tidak membuat dobel. */
async function idTurunan(idLama, keluargaId) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${keluargaId}:${idLama}`))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * Gabungkan cadangan ke keluarga aktif.
 * - Keluarga sama: baris yang di HP lebih baru (updated_at) TIDAK ditimpa; yang hilang dipulihkan.
 * - Keluarga lain: id diturunkan secara deterministik; kategori/dompet bernama sama dipakai ulang.
 * Baris yang bentuknya tidak sah dilewati.
 */
export async function pulihkan(data) {
  const lain = data.keluarga?.id !== S.keluargaId;
  const peta = new Map();
  const id = async (lama) => (!lama || !lain ? lama : peta.get(lama) || (peta.set(lama, await idTurunan(lama, S.keluargaId)), peta.get(lama)));
  const lokal = (tabel, i) => S[tabel].find((r) => r.id === i);
  const lebihBaru = (tabel, r) => { const l = lokal(tabel, r.id); return l && String(l.updated_at || '') >= String(r.updated_at || ''); };
  const kunciKat = new Map(S.kategori.filter((k) => !k.arsip).map((k) => [`${k.jenis}|${k.nama.toLowerCase()}`, k.id]));
  const kunciDom = new Map(S.dompet.filter((d) => !d.arsip).map((d) => [d.nama.toLowerCase(), d.id]));
  let n = 0, lewat = 0;
  for (const k of data.kategori || []) {
    if (!sahBaris.kategori(k)) { lewat++; continue; }
    const ada = kunciKat.get(`${k.jenis}|${k.nama.trim().toLowerCase()}`);
    if (ada && (lain || ada !== k.id)) { peta.set(k.id, ada); continue; }
    if (!lain && lebihBaru('kategori', k)) continue;
    await tulis('kategori', { ...k, id: await id(k.id), keluarga_id: S.keluargaId }); n++;
  }
  for (const d of data.dompet || []) {
    if (!sahBaris.dompet(d)) { lewat++; continue; }
    const ada = kunciDom.get(d.nama.trim().toLowerCase());
    if (ada && (lain || ada !== d.id)) { peta.set(d.id, ada); continue; }
    if (!lain && lebihBaru('dompet', d)) continue;
    await tulis('dompet', { ...d, id: await id(d.id), keluarga_id: S.keluargaId }); n++;
  }
  const ref = (x) => (x ? peta.get(x) || x : x);
  for (const a of data.anggaran || []) {
    if (!sahBaris.anggaran(a)) { lewat++; continue; }
    const kat = ref(a.kategori_id);
    const sudah = S.anggaran.find((x) => x.bulan === a.bulan && x.kategori_id === kat);
    if (sudah && (lain || String(sudah.updated_at || '') >= String(a.updated_at || ''))) continue;
    await tulis('anggaran', { ...a, id: sudah?.id || crypto.randomUUID(), keluarga_id: S.keluargaId, kategori_id: kat }); n++;
  }
  for (const t of data.transaksi || []) {
    if (!sahBaris.transaksi(t)) { lewat++; continue; }
    if (!lain && lebihBaru('transaksi', t)) continue;
    const baru = { ...t, id: await id(t.id), keluarga_id: S.keluargaId, kategori_id: ref(t.kategori_id),
      dompet_id: ref(t.dompet_id), dompet_tujuan_id: ref(t.dompet_tujuan_id) };
    if (lain && lokal('transaksi', baru.id)) continue; // sudah pernah diimpor
    await tulis('transaksi', baru); n++;
  }
  if (lewat) toast(`${lewat} baris tidak sah dilewati`, 'galat');
  return n;
}

// ---------------------------------------------------------------- uji mandiri
export function ujiMandiri({ versi }) {
  const hasil = h('ul', { class: 'kartu daftar uji' });
  const baris = (ok, teks) => hasil.append(h('li', { class: ok ? 'lulus' : 'gagal' }, `${ok ? '✓' : '✗'} ${teks}`));
  (async () => {
    baris(true, `Versi aplikasi ${versi}`);
    baris(navigator.onLine, navigator.onLine ? 'Perangkat online' : 'Perangkat offline (pencatatan tetap jalan)');
    const t0 = performance.now();
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
      baris(r.ok, `Server Supabase ${r.ok ? 'terjangkau' : `menjawab ${r.status}`} (${Math.round(performance.now() - t0)} ms)`);
    } catch { baris(false, 'Server Supabase tidak terjangkau'); }
    const { data } = await sb.auth.getSession();
    baris(!!data.session, data.session ? `Sesi masuk berlaku s.d. ${new Date(data.session.expires_at * 1000).toLocaleString('id-ID')}` : 'Sesi tidak aktif (perlu online untuk diperbarui)');
    const persist = await navigator.storage?.persisted?.();
    baris(!!persist, persist ? 'Penyimpanan lokal dilindungi dari pembersihan otomatis' : 'Penyimpanan lokal belum dilindungi (pasang ke layar utama agar lebih awet)');
    const est = await navigator.storage?.estimate?.();
    if (est) baris(true, `Pemakaian penyimpanan ±${Math.round((est.usage || 0) / 1024)} KB`);
    const n = await db.transaksi.count();
    baris(true, `${n} catatan tersimpan di HP ini`);
    baris(!status.antrian, status.antrian ? `${status.antrian} catatan menunggu dikirim` : 'Tidak ada antrian');
    baris(!status.gagal, status.gagal ? `${status.gagal} catatan ditolak server (lihat Beranda)` : 'Tidak ada catatan ditolak');
    const sw = await navigator.serviceWorker?.getRegistration();
    baris(!!sw?.active, sw?.active ? 'Mode offline aktif' : 'Mode offline belum aktif');
    const pasang = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    baris(!!pasang, pasang ? 'Terpasang di layar utama' : 'Dibuka dari browser (belum dipasang)');
  })();
  return h('div', { class: 'halaman' }, kembali(), h('h2', {}, 'Uji mandiri'), hasil,
    h('button', { class: 'tombol kedua lebar', onclick: async () => {
      await setMeta('tanda_transaksi', null);
      await sinkron(S.keluargaId); await muat(); toast('Data dimuat ulang dari server');
    } }, 'Muat ulang semua data dari server'));
}
