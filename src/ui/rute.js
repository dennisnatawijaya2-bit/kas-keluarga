import { beranda } from './halaman/beranda.js';
import { catat } from './halaman/catat.js';
import { riwayat } from './halaman/riwayat.js';
import { ringkasan } from './halaman/ringkasan.js';
import { anggaran } from './halaman/anggaran.js';
import { kelola, kelolaKategori, kelolaDompet, kelolaAnggota, kelolaAkun, kelolaEkspor, kelolaCadangan, cocokkanSaldo, ujiMandiri } from './halaman/kelola.js';

// formulir: true → tidak digambar ulang otomatis saat data tersinkron (agar ketikan tidak hilang)
export const RUTE = {
  beranda: { render: beranda },
  catat: { render: catat, formulir: true },
  riwayat: { render: riwayat },
  ringkasan: { render: ringkasan },
  anggaran: { render: anggaran, formulir: true },
  kelola: { render: kelola },
  'kelola/kategori': { render: kelolaKategori },
  'kelola/dompet': { render: kelolaDompet },
  'kelola/anggota': { render: kelolaAnggota, formulir: true },
  'kelola/akun': { render: kelolaAkun, formulir: true },
  'kelola/ekspor': { render: kelolaEkspor, formulir: true },
  'kelola/cadangan': { render: kelolaCadangan, formulir: true },
  'kelola/saldo': { render: cocokkanSaldo, formulir: true },
  'kelola/uji': { render: ujiMandiri, formulir: true },
};

/** '#/riwayat/2026-10' → { nama: 'riwayat', arg: '2026-10' }; '#/kelola/kategori' → nama 'kelola/kategori'. */
export function ruteSekarang() {
  const bagian = (location.hash.replace(/^#\/?/, '') || 'beranda').split('/');
  const dua = `${bagian[0]}/${bagian[1]}`;
  if (RUTE[dua]) return { nama: dua, arg: bagian.slice(2).join('/') || null };
  return { nama: bagian[0], arg: bagian.slice(1).join('/') || null };
}
