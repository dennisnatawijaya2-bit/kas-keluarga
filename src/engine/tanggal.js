// Tanggal kalender keluarga (Asia/Jakarta), format ISO 'YYYY-MM-DD'. Tanpa DOM.

export const ZONA = 'Asia/Jakarta';
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Tanggal hari ini di zona keluarga. */
export function hariIni(sekarang = new Date(), zona = ZONA) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(sekarang);
}

/** '2026-10-27' -> '2026-10' */
export const bulanDari = (iso) => iso.slice(0, 7);
/** '2026-10' -> '2026-10-01' (kolom anggaran.bulan) */
export const awalBulan = (bln) => `${bln}-01`;

/** Geser bulan: ('2026-01', -1) -> '2025-12' */
export function geserBulan(bln, n) {
  const [y, m] = bln.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Hari terakhir bulan: '2026-02' -> '2026-02-28' */
export function akhirBulan(bln) {
  const [y, m] = bln.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${bln}-${String(d).padStart(2, '0')}`;
}

export const jumlahHari = (bln) => Number(akhirBulan(bln).slice(8));

/** '2026-10' -> 'Oktober 2026' */
export function namaBulan(bln) {
  const [y, m] = bln.split('-').map(Number);
  return `${BULAN[m - 1]} ${y}`;
}

/** '2026-10-27' -> 'Selasa, 27 Oktober 2026' */
export function tglPanjang(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const hari = HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${hari}, ${d} ${BULAN[m - 1]} ${y}`;
}

/** '2026-10-27' -> '27 Okt' */
export function tglPendek(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${BULAN[m - 1].slice(0, 3)}`;
}

export const sahIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
