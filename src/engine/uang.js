// Uang = bilangan bulat rupiah. Tanpa DOM, dipakai di HP & tes Node.

const RIBUAN = /\B(?=(\d{3})+(?!\d))/g;

/** 1250000 -> "1.250.000"; -5000 -> "-5.000" */
export function ribuan(n) {
  const x = Math.trunc(Number(n) || 0);
  const s = String(Math.abs(x)).replace(RIBUAN, '.');
  return x < 0 ? `-${s}` : s;
}

/** 1250000 -> "Rp 1.250.000"; -5000 -> "-Rp 5.000" */
export function rp(n) {
  const x = Math.trunc(Number(n) || 0);
  return x < 0 ? `-Rp ${ribuan(-x)}` : `Rp ${ribuan(x)}`;
}

/** Ringkas untuk grafik: 1250000 -> "1,3 jt"; 15000 -> "15 rb" */
export function rpPendek(n) {
  const x = Math.abs(Math.trunc(Number(n) || 0));
  const tanda = n < 0 ? '-' : '';
  if (x >= 1e9) return `${tanda}${(x / 1e9).toFixed(1).replace('.', ',').replace(',0', '')} M`;
  if (x >= 1e6) return `${tanda}${(x / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} jt`;
  if (x >= 1e3) return `${tanda}${Math.round(x / 1e3)} rb`;
  return `${tanda}${x}`;
}

export const BATAS = 999_999_999_999_999; // < 1e15, sama dengan CHECK di database

/**
 * Teks ketikan -> bilangan bulat rupiah, atau null bila tidak sah.
 * Menerima "1.250.000", "1250000", "Rp 1.250.000", "15rb", "1,5jt", "2 juta".
 */
export function bacaRupiah(teks) {
  if (teks == null) return null;
  let s = String(teks).trim().toLowerCase().replace(/^rp\.?\s*/, '').replace(/\s+/g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  let kali = 1;
  const m = s.match(/^(.*?)(rb|ribu|k|jt|juta|m|miliar)$/);
  if (m) {
    s = m[1];
    kali = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6, m: 1e9, miliar: 1e9 }[m[2]];
    // dengan satuan, koma/titik = desimal ("1,5jt")
    if (!/^\d+([.,]\d+)?$/.test(s)) return null;
    s = s.replace(',', '.');
  } else {
    // tanpa satuan, titik = pemisah ribuan; koma desimal (",00") dibuang bila nol
    s = s.replace(/,0+$/, '');
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(s)) return null;
    s = s.replace(/\./g, '');
  }
  const n = Math.round(Number(s) * kali);
  if (!Number.isSafeInteger(n) || n > BATAS) return null;
  return neg ? -n : n;
}
