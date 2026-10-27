import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { sb } from './data/supabase.js';
import { db, ambilMeta, setMeta, kosongkanLokal, mintaPersisten, TABEL_DATA } from './data/lokal.js';
import { sinkron, mulaiSinkronOtomatis, hentikanSinkron, dengarkan, status, hitungAntrian } from './data/sinkron.js';
import { S, muat, dengarkanState } from './state.js';
import { h, toast, konfirmasi } from './ui/dom.js';
import { halamanMasuk, halamanTanpaKeluarga } from './ui/masuk.js';
import { RUTE, ruteSekarang } from './ui/rute.js';

const akar = document.getElementById('app');
export const VERSI = __VERSI__;
const KUNCI_SESI = 'kas-keluarga-sesi';

// ---------------------------------------------------------------- service worker & pembaruan versi
let spanduk = null;
const perbarui = registerSW({
  onNeedRefresh() {
    if (spanduk) return;
    spanduk = h('div', { class: 'spanduk', role: 'alert' },
      h('span', {}, 'Versi baru tersedia.'),
      h('button', { class: 'tombol utama kecil', onclick: () => perbarui(true) }, 'Muat ulang'));
    document.body.append(spanduk);
  },
  onOfflineReady() { toast('Aplikasi siap dipakai tanpa sinyal.'); },
  onRegisteredSW(_url, reg) {
    // PWA iOS bisa terbuka berhari-hari → cek versi baru tiap kembali ke depan
    if (reg) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {}); });
  },
});

// ---------------------------------------------------------------- awal
async function mulai() {
  const { data, error } = await sb.auth.getSession().catch((e) => ({ data: {}, error: e }));
  const sesi = data?.session;
  const userLokal = await ambilMeta('user');
  if (sesi) {
    if (userLokal && userLokal.id !== sesi.user.id && !(await bolehGantiAkun(userLokal))) {
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      return tampilkanMasuk();
    }
    S.user = { id: sesi.user.id, email: sesi.user.email };
    await setMeta('user', S.user);
  } else if (userLokal && (!navigator.onLine || error?.name === 'AuthRetryableFetchError' || galatJaringan(error))) {
    S.user = userLokal; // offline / Wi-Fi tanpa internet: tetap bisa membaca & mencatat ke antrian
  } else {
    return tampilkanMasuk();
  }
  await pilihKeluarga();
}
const galatJaringan = (e) => !!e && /fetch|network|Load failed/i.test(String(e.message));

/** HP sebelumnya dipakai akun lain: hapus datanya (beri tahu bila ada catatan yang belum terkirim). */
async function bolehGantiAkun(userLama) {
  const n = await db.antrian.count();
  if (n && !(await konfirmasi({ judul: 'Ganti akun?', bahaya: true, ok: 'Hapus & lanjut',
    isi: `HP ini masih menyimpan ${n} catatan milik ${userLama.email} yang belum terkirim. Bila lanjut, catatan itu HILANG. Pilih Batal lalu masuk lagi sebagai ${userLama.email} untuk mengirimnya dulu.` }))) return false;
  await hentikanSinkron();
  await kosongkanLokal();
  return true;
}

function tampilkanMasuk() {
  hentikanSinkron();
  isi = null;
  akar.replaceChildren(halamanMasuk({ setelahMasuk: () => mulai() }));
}

/** Hapus salinan lokal satu keluarga (keanggotaan dicabut / pindah keluarga). */
async function hapusKeluargaLokal(kid) {
  await db.transaction('rw', [...TABEL_DATA.map((t) => db[t]), db.antrian, db.meta], async () => {
    for (const t of TABEL_DATA) await db[t].where(t === 'keluarga' ? 'id' : 'keluarga_id').equals(kid).delete();
    await db.antrian.filter((a) => a.baris?.keluarga_id === kid).delete();
    await db.meta.bulkDelete(['tanda_transaksi', 'sidik_kecil']);
  });
}

async function pilihKeluarga() {
  let kid = await ambilMeta('keluarga_aktif');
  if (navigator.onLine) {
    const { data, error } = await sb.from('anggota').select('keluarga_id, peran, aktif, bergabung_at')
      .eq('user_id', S.user.id).eq('aktif', true).order('bergabung_at');
    if (!error) {
      if (!data.length) {
        if (kid) await hapusKeluargaLokal(kid);
        await setMeta('keluarga_aktif', null);
        return akar.replaceChildren(halamanTanpaKeluarga({ keluar, setelahBuat: () => pilihKeluarga() }));
      }
      if (!data.some((d) => d.keluarga_id === kid)) {
        if (kid) await hapusKeluargaLokal(kid);
        kid = data[0].keluarga_id;
        await setMeta('keluarga_aktif', kid);
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
  const antrian = await db.antrian.count();
  if (antrian && !(await konfirmasi({ judul: 'Keluar dari akun?', bahaya: true, ok: 'Tetap keluar',
    isi: `${antrian} catatan belum terkirim dan akan HILANG bila keluar sekarang. Sebaiknya tunggu sampai ada sinyal.` }))) return;
  await hentikanSinkron();
  // selalu hapus sesi lokal, termasuk saat offline / token kedaluwarsa (signOut bisa melewatkan penghapusan)
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  try { localStorage.removeItem(KUNCI_SESI); } catch {}
  await kosongkanLokal();
  S.user = null; S.keluargaId = null;
  tampilkanMasuk();
}

sb.auth.onAuthStateChange((ev) => {
  // sesi berakhir: data lokal & antrian tetap disimpan agar pengguna yang sama bisa masuk lagi dan mengirimnya
  if (ev === 'SIGNED_OUT' && S.user) { S.user = null; tampilkanMasuk(); }
});

// ---------------------------------------------------------------- tata letak & router
let isi, lencana, judulKeluarga;

function tampilkanAplikasi() {
  judulKeluarga = h('span', { class: 'judul' }, S.keluarga?.nama || 'Kas Keluarga');
  lencana = h('button', { class: 'lencana', type: 'button', title: 'Status sinkron — ketuk untuk sinkron sekarang',
    onclick: () => (status.galat === 'sesi' ? keluarSesiHabis() : sinkron(S.keluargaId).then(muat)) });
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

/** Sesi habis: masuk lagi dengan akun yang sama — data & antrian lokal TIDAK dihapus. */
async function keluarSesiHabis() {
  await hentikanSinkron();
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  try { localStorage.removeItem(KUNCI_SESI); } catch {}
  S.user = null;
  tampilkanMasuk();
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
  document.querySelectorAll('.navbawah .nav').forEach((a) => a.classList.toggle('aktif', a.dataset.rute === nama.split('/')[0]));
  isi.replaceChildren(def.render({ arg, keluar, versi: VERSI }));
  judulKeluarga.textContent = S.keluarga?.nama || 'Kas Keluarga';
}

window.addEventListener('hashchange', () => { render(); isi?.focus({ preventScroll: true }); window.scrollTo(0, 0); });

// Data berubah (hasil sinkron/aksi) → gambar ulang halaman yang bukan formulir,
// kecuali pengguna sedang mengetik/memilih di halaman itu (keyboard HP tidak tertutup).
let tundaRender;
dengarkanState(() => {
  if (!isi || !ruteAktif || ruteAktif.def.formulir) return;
  clearTimeout(tundaRender);
  tundaRender = setTimeout(function coba() {
    const aktif = document.activeElement;
    if (aktif && isi.contains(aktif) && /^(INPUT|SELECT|TEXTAREA)$/.test(aktif.tagName)) {
      tundaRender = setTimeout(coba, 1500);
      return;
    }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }, 50);
});

function perbaruiLencana() {
  if (!lencana) return;
  let teks, kelas;
  if (status.galat === 'sesi') { teks = '⚠ Masuk ulang'; kelas = 'merah'; }
  else if (status.gagal) { teks = `⚠ ${status.gagal} ditolak`; kelas = 'merah'; }
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
