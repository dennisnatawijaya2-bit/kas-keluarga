// Login pakai nama pengguna (userid). Supabase Auth butuh format email, jadi userid dipetakan
// ke alamat tetap yang tidak pernah dikirimi email. Masukan yang sudah berisi '@' dipakai apa adanya.
export const DOMAIN_AKUN = 'kas-keluarga.test';

/** 'Budi1990 ' -> 'budi1990@kas-keluarga.test'; null bila tidak sah. */
export function keEmail(masukan) {
  const s = String(masukan || '').trim().toLowerCase();
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(s) ? `${s}@${DOMAIN_AKUN}` : null;
}

/** 'budi1990@kas-keluarga.test' -> 'budi1990'; email lain ditampilkan utuh. */
export function keUserid(email) {
  const s = String(email || '');
  return s.endsWith(`@${DOMAIN_AKUN}`) ? s.slice(0, -DOMAIN_AKUN.length - 1) : s;
}
