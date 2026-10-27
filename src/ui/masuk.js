import { sb } from '../data/supabase.js';
import { setMeta } from '../data/lokal.js';
import { h, toast } from './dom.js';

const PESAN = {
  'Invalid login credentials': 'Email atau kata sandi salah.',
  'Email not confirmed': 'Akun belum dikonfirmasi. Minta pemilik keluarga memeriksa akunmu.',
  'Signups not allowed for this instance': 'Pendaftaran dibatasi. Minta pemilik keluarga membuatkan akun.',
};
const terjemah = (e) => PESAN[e?.message] || (/fetch|network/i.test(e?.message) ? 'Tidak ada koneksi internet.' : e?.message || 'Gagal.');

export function halamanMasuk({ setelahMasuk }) {
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', required: true, inputmode: 'email', autocapitalize: 'none' });
  const sandi = h('input', { type: 'password', id: 'sandi', autocomplete: 'current-password', required: true, minlength: 6 });
  const galat = h('p', { class: 'galat', role: 'alert' });
  const tombol = h('button', { type: 'submit', class: 'tombol utama lebar' }, 'Masuk');
  const lihat = h('button', { type: 'button', class: 'tombol teks', 'aria-pressed': 'false', onclick: () => {
    const tampak = sandi.type === 'password';
    sandi.type = tampak ? 'text' : 'password';
    lihat.textContent = tampak ? 'Sembunyikan' : 'Tampilkan';
    lihat.setAttribute('aria-pressed', String(tampak));
  } }, 'Tampilkan');

  const form = h('form', { class: 'kartu masuk', onsubmit: async (e) => {
    e.preventDefault();
    galat.textContent = '';
    tombol.disabled = true; tombol.textContent = 'Memeriksa…';
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: sandi.value });
    tombol.disabled = false; tombol.textContent = 'Masuk';
    if (error) { galat.textContent = terjemah(error); return; }
    await setMeta('user', { id: data.user.id, email: data.user.email });
    setelahMasuk();
  } },
  h('div', { class: 'logo', 'aria-hidden': 'true' }, '💰'),
  h('h1', {}, 'Kas Keluarga'),
  h('p', { class: 'redup' }, 'Masuk dengan akun yang dibuatkan pemilik keluarga.'),
  h('label', { for: 'email' }, 'Email'), email,
  h('label', { for: 'sandi' }, 'Kata sandi'), h('div', { class: 'sandi' }, sandi, lihat),
  galat, tombol);
  return h('div', { class: 'tengah' }, form);
}

export function halamanTanpaKeluarga({ keluar, setelahBuat, offline }) {
  if (offline) {
    return h('div', { class: 'tengah' }, h('div', { class: 'kartu' },
      h('h2', {}, 'Butuh koneksi internet'),
      h('p', {}, 'Untuk pertama kali, aplikasi perlu tersambung ke internet untuk memuat data keluarga.'),
      h('button', { class: 'tombol utama lebar', onclick: () => location.reload() }, 'Coba lagi')));
  }
  const nama = h('input', { id: 'nk', required: true, maxlength: 60, placeholder: 'mis. Keluarga Budi' });
  const tampil = h('input', { id: 'nt', required: true, maxlength: 40, placeholder: 'mis. Papa' });
  const tombol = h('button', { type: 'submit', class: 'tombol utama lebar' }, 'Buat keluarga');
  return h('div', { class: 'tengah' },
    h('div', { class: 'kartu' },
      h('h2', {}, 'Belum terdaftar di keluarga mana pun'),
      h('p', {}, 'Bila kamu anggota keluarga, minta pemilik menambahkan email kamu lewat menu Kelola → Anggota, lalu buka ulang aplikasi.'),
      h('button', { class: 'tombol kedua lebar', onclick: () => location.reload() }, 'Periksa lagi')),
    h('form', { class: 'kartu', onsubmit: async (e) => {
      e.preventDefault();
      tombol.disabled = true;
      const { data, error } = await sb.rpc('buat_keluarga', { p_nama: nama.value, p_nama_tampilan: tampil.value });
      tombol.disabled = false;
      if (error) return toast(terjemah(error), 'galat');
      await setMeta('keluarga_aktif', data);
      await setMeta('tanda_transaksi', null);
      setelahBuat();
    } },
    h('h2', {}, 'Atau buat keluarga baru'),
    h('p', { class: 'redup' }, 'Kamu akan menjadi pemilik. Kategori dan dompet awal dibuat otomatis dan bisa diubah.'),
    h('label', { for: 'nk' }, 'Nama keluarga'), nama,
    h('label', { for: 'nt' }, 'Nama panggilan kamu'), tampil,
    tombol),
    h('button', { class: 'tombol teks', onclick: keluar }, 'Keluar dari akun'));
}
