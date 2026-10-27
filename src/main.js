import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { sb } from './data/supabase.js';
import { db, ambilMeta, setMeta, kosongkanLokal, mintaPersisten } from './data/lokal.js';
import { sinkron, mulaiSinkronOtomatis, hentikanSinkron, dengarkan, status, hitungAntrian } from './data/sinkron.js';
import { S, muat, dengarkanState } from './state.js';
import { h, toast } from './ui/dom.js';
import { halamanMasuk, halamanTanpaKeluarga } from './ui/masuk.js';
import { RUTE, ruteSekarang } from './ui/rute.js';

const akar = document.getElementById('app');
export const VERSI = __VERSI__;

// ---------------------------------------------------------------- service worker & pembaruan versi
const perbarui = registerSW({
  onNeedRefresh() {
    const sp = h('div', { class: 'spanduk', role: 'alert' },
      h('span', {}, 'Versi baru tersedia.'),
      h('button', { class: 'tombol utama kecil', onclick: () => perbarui(true) }, 'Muat ulang'));
    document.body.append(sp);
  },
  onOfflineReady() { toast('Aplikasi siap dipakai tanpa sinyal.'); },
});

// ---------------------------------------------------------------- awal
async function mulai() {
  const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
  const sesi = data?.session;
  const userLokal = await ambilMeta('user');
  if (sesi) {
    if (userLokal && userLokal.id !== sesi.user.id) await kosongkanLokal(); // HP dipakai akun lain
    S.user = { id: sesi.user.id, email: sesi.user.email };
    await setMeta('user', S.user);
  } else if (userLokal && !navigator.onLine) {
    S.user = userLokal; // offline: tetap bisa membaca & mencatat ke antrian
  } else {
    return tampilkanMasuk();
  }
  await pilihKeluarga();
}

function tampilkanMasuk() {
  hentikanSinkron();
  akar.replaceChildren(halamanMasuk({ setelahMasuk: () => mulai() }));
}

async function pilihKeluarga() {
  let kid = await ambilMeta('keluarga_aktif');
  if (navigator.onLine) {
    const { data, error } = await sb.from('anggota').select('keluarga_id, peran, aktif, bergabung_at')
      .eq('user_id', S.user.id).eq('aktif', true).order('bergabung_at');
    if (!error) {
      if (!data.length) {
        await setMeta('keluarga_aktif', null);
        return akar.replaceChildren(halamanTanpaKeluarga({ keluar, setelahBuat: () => pilihKeluarga() }));
      }
      if (!data.some((d) => d.keluarga_id === kid)) {
        kid = data[0].keluarga_id;
        await setMeta('keluarga_aktif', kid);
        await setMeta('tanda_transaksi', null);
      }
    }
  }
  if (!kid) return akar.replaceChildren(halamanTanpaKeluarga({ keluar, setelahBuat: () => pilihKeluarga(), offline: true }));
  await muat();
  tampilkanAplikasi();
  mintaPersisten();
  if (navigator.onLine) { await sinkron(kid); await muat(); }
  mulaiSinkronOtomatis(kid, () => muat());
}

export async function keluar() {
  const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
  const antrian = await db.antrian.count();
  if (antrian && !confirmKeluar(antrian)) return;
  hentikanSinkron();
  if (data?.session) await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  await kosongkanLokal();
  S.user = null; S.keluargaId = null;
  tampilkanMasuk();
}
// Peringatan sinkron: dipanggil hanya saat ada catatan belum terkirim
function confirmKeluar(n) {
  return window.confirm(`${n} catatan belum terkirim dan akan HILANG bila keluar sekarang. Tetap keluar?`);
}

sb.auth.onAuthStateChange((ev) => {
  if (ev === 'SIGNED_OUT' && S.user) { S.user = null; tampilkanMasuk(); }
});

// ---------------------------------------------------------------- tata letak & router
let isi, lencana, judulKeluarga;

function tampilkanAplikasi() {
  judulKeluarga = h('span', { class: 'judul' }, S.keluarga?.nama || 'Kas Keluarga');
  lencana = h('button', { class: 'lencana', type: 'button', onclick: () => sinkron(S.keluargaId).then(muat), 'aria-label': 'Status sinkron' });
  isi = h('main', { id: 'isi', tabindex: '-1' });
  const nav = h('nav', { class: 'navbawah', 'aria-label': 'Menu utama' },
    tautanNav('#/beranda', '🏠', 'Beranda'),
    tautanNav('#/riwayat', '📋', 'Riwayat'),
    h('a', { href: '#/catat', class: 'tambah', 'aria-label': 'Catat transaksi' }, '+'),
    tautanNav('#/ringkasan', '📊', 'Ringkasan'),
    tautanNav('#/kelola', '⚙️', 'Kelola'));
  akar.replaceChildren(h('header', { class: 'kepala' }, judulKeluarga, lencana), isi, nav);
  perbaruiLencana();
  render();
}

function tautanNav(href, ikon, label) {
  return h('a', { href, class: 'nav', dataset: { rute: href.slice(2) } }, h('span', { 'aria-hidden': 'true' }, ikon), h('small', {}, label));
}

let ruteAktif = null;
function render() {
  if (!isi) return;
  const { nama, arg } = ruteSekarang();
  const def = RUTE[nama] || RUTE.beranda;
  ruteAktif = { nama, def };
  document.querySelectorAll('.navbawah .nav').forEach((a) => a.classList.toggle('aktif', a.dataset.rute === nama));
  isi.replaceChildren(def.render({ arg, keluar, versi: VERSI }));
  judulKeluarga.textContent = S.keluarga?.nama || 'Kas Keluarga';
}

window.addEventListener('hashchange', () => { render(); isi?.focus({ preventScroll: true }); window.scrollTo(0, 0); });

// Data berubah (hasil sinkron/aksi) → gambar ulang halaman yang bukan formulir.
let tundaRender;
dengarkanState(() => {
  if (!isi || !ruteAktif || ruteAktif.def.formulir) return;
  clearTimeout(tundaRender);
  tundaRender = setTimeout(() => {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }, 50);
});

function perbaruiLencana() {
  if (!lencana) return;
  let teks, kelas;
  if (status.gagal) { teks = `⚠ ${status.gagal} ditolak`; kelas = 'merah'; }
  else if (status.antrian) { teks = `⏳ ${status.antrian} belum terkirim`; kelas = 'kuning'; }
  else if (status.galat === 'offline' || !navigator.onLine) { teks = '○ Offline'; kelas = 'abu'; }
  else if (status.mengirim || status.menarik) { teks = '⟳ Sinkron…'; kelas = 'abu'; }
  else if (status.galat) { teks = '⚠ Gagal sinkron'; kelas = 'merah'; }
  else { teks = '✓ Tersimpan'; kelas = 'hijau'; }
  lencana.textContent = teks;
  lencana.className = `lencana ${kelas}`;
}
dengarkan(perbaruiLencana);
window.addEventListener('online', perbaruiLencana);
window.addEventListener('offline', perbaruiLencana);

hitungAntrian();
mulai().catch((e) => {
  console.error(e);
  akar.replaceChildren(h('div', { class: 'kartu' }, h('h2', {}, 'Gagal memulai aplikasi'), h('p', {}, String(e.message || e)),
    h('button', { class: 'tombol utama', onclick: () => location.reload() }, 'Coba lagi')));
});
