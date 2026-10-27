// Perhitungan laporan dari data lokal (jalan offline). Tanpa DOM.
// Transaksi: { id, jenis: keluar|masuk|pindah|penyesuaian, tanggal, jumlah, kategori_id, dompet_id,
//              dompet_tujuan_id, catatan, wajar, dicatat_oleh, dibuat_at, dihapus_at }
import { bulanDari, geserBulan, namaBulan, awalBulan } from './tanggal.js';
import { rp } from './uang.js';

export const aktif = (t) => !t.dihapus_at;

/** Transaksi aktif di bulan 'YYYY-MM'. */
export const diBulan = (transaksi, bln) => transaksi.filter((t) => aktif(t) && bulanDari(t.tanggal) === bln);

/** Ringkasan satu bulan: total keluar/masuk + per kategori vs anggaran. */
export function ringkasBulan({ transaksi, kategori, anggaran = [], bulan }) {
  const isi = diBulan(transaksi, bulan);
  const pakai = new Map();
  let keluar = 0, masuk = 0;
  for (const t of isi) {
    if (t.jenis === 'keluar') keluar += t.jumlah;
    else if (t.jenis === 'masuk') masuk += t.jumlah;
    else continue;
    pakai.set(t.kategori_id, (pakai.get(t.kategori_id) || 0) + t.jumlah);
  }
  const ang = new Map(anggaran.filter((a) => a.bulan === awalBulan(bulan)).map((a) => [a.kategori_id, a.jumlah]));
  const perKategori = kategori
    .filter((k) => pakai.has(k.id) || ang.has(k.id))
    .map((k) => {
      const terpakai = pakai.get(k.id) || 0;
      const batas = ang.has(k.id) ? ang.get(k.id) : null;
      const persen = batas ? Math.round((terpakai / batas) * 100) : null;
      const status = batas == null ? 'tanpa' : terpakai > batas ? 'lewat' : persen >= 80 ? 'hampir' : 'aman';
      return { kategori: k, terpakai, anggaran: batas, persen, status };
    })
    .sort((a, b) => b.terpakai - a.terpakai || (a.kategori.urutan ?? 0) - (b.kategori.urutan ?? 0));
  const keluarKat = perKategori.filter((x) => x.kategori.jenis === 'keluar');
  const totalAnggaran = keluarKat.reduce((s, x) => s + (x.anggaran || 0), 0);
  const terpakaiBeranggaran = keluarKat.reduce((s, x) => s + (x.anggaran != null ? x.terpakai : 0), 0);
  return {
    bulan, keluar, masuk, selisih: masuk - keluar, jumlahTransaksi: isi.length,
    perKategori, totalAnggaran, sisaAnggaran: totalAnggaran - terpakaiBeranggaran,
  };
}

/** Kelompok per hari (terbaru dulu) dengan subtotal keluar/masuk. */
export function perHari(transaksi, bln) {
  const peta = new Map();
  for (const t of diBulan(transaksi, bln)) {
    if (!peta.has(t.tanggal)) peta.set(t.tanggal, { tanggal: t.tanggal, keluar: 0, masuk: 0, isi: [] });
    const h = peta.get(t.tanggal);
    h.isi.push(t);
    if (t.jenis === 'keluar') h.keluar += t.jumlah;
    if (t.jenis === 'masuk') h.masuk += t.jumlah;
  }
  const hasil = [...peta.values()].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  for (const h of hasil) h.isi.sort((a, b) => String(b.dibuat_at || '').localeCompare(String(a.dibuat_at || '')));
  return hasil;
}

/** Saldo tiap dompet = saldo_awal + masuk − keluar ± pindah + penyesuaian (semua tanggal sampai `sampai`). */
export function saldoDompet(transaksi, dompet, sampai = '9999-12-31') {
  const s = new Map(dompet.map((d) => [d.id, d.saldo_awal || 0]));
  const tambah = (id, n) => { if (s.has(id)) s.set(id, s.get(id) + n); };
  for (const t of transaksi) {
    if (!aktif(t) || t.tanggal > sampai) continue;
    if (t.jenis === 'masuk' || t.jenis === 'penyesuaian') tambah(t.dompet_id, t.jumlah);
    else if (t.jenis === 'keluar') tambah(t.dompet_id, -t.jumlah);
    else if (t.jenis === 'pindah') { tambah(t.dompet_id, -t.jumlah); tambah(t.dompet_tujuan_id, t.jumlah); }
  }
  return s;
}

/** Tren n bulan berakhir di `bulanAkhir` (lama → baru). */
export function tren(transaksi, bulanAkhir, n = 6) {
  const daftar = Array.from({ length: n }, (_, i) => geserBulan(bulanAkhir, i - n + 1));
  const peta = new Map(daftar.map((b) => [b, { bulan: b, keluar: 0, masuk: 0 }]));
  for (const t of transaksi) {
    if (!aktif(t)) continue;
    const x = peta.get(bulanDari(t.tanggal));
    if (!x) continue;
    if (t.jenis === 'keluar') x.keluar += t.jumlah;
    if (t.jenis === 'masuk') x.masuk += t.jumlah;
  }
  return daftar.map((b) => peta.get(b));
}

/** Ringkasan satu tahun (Jan s.d. bulan terakhir yang diberikan). */
export function ringkasTahun(transaksi, tahun) {
  let keluar = 0, masuk = 0;
  for (const t of transaksi) {
    if (!aktif(t) || !t.tanggal.startsWith(`${tahun}-`)) continue;
    if (t.jenis === 'keluar') keluar += t.jumlah;
    if (t.jenis === 'masuk') masuk += t.jumlah;
  }
  return { tahun, keluar, masuk, selisih: masuk - keluar };
}

const median = (xs) => {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Peringatan untuk bulan berjalan (dihitung ulang tiap kali, tidak disimpan).
 * kode: ANG_HAMPIR, ANG_LEWAT, DOBEL, TAK_WAJAR, ANTRIAN_LAMA.
 */
export function peringatan({ transaksi, kategori, anggaran = [], bulan, antrian = [], sekarang = Date.now() }) {
  const out = [];
  const r = ringkasBulan({ transaksi, kategori, anggaran, bulan });
  for (const x of r.perKategori) {
    if (x.kategori.jenis !== 'keluar' || x.anggaran == null) continue;
    if (x.status === 'lewat') out.push({ kode: 'ANG_LEWAT', tingkat: 'tinggi', kategori_id: x.kategori.id,
      pesan: `${x.kategori.nama}: ${rp(x.terpakai)} melewati anggaran ${rp(x.anggaran)} (${x.persen}%).` });
    else if (x.status === 'hampir') out.push({ kode: 'ANG_HAMPIR', tingkat: 'sedang', kategori_id: x.kategori.id,
      pesan: `${x.kategori.nama}: sudah ${x.persen}% dari anggaran ${rp(x.anggaran)}.` });
  }

  const isi = diBulan(transaksi, bulan).filter((t) => t.jenis === 'keluar' || t.jenis === 'masuk');
  const namaKat = new Map(kategori.map((k) => [k.id, k.nama]));

  // kemungkinan dobel: jenis+kategori+tanggal+jumlah sama, dibuat dalam 10 menit
  const grup = new Map();
  for (const t of isi) {
    const k = `${t.jenis}|${t.kategori_id}|${t.tanggal}|${t.jumlah}`;
    if (!grup.has(k)) grup.set(k, []);
    grup.get(k).push(t);
  }
  for (const g of grup.values()) {
    if (g.length < 2 || g.every((t) => t.wajar)) continue;
    const waktu = g.map((t) => Date.parse(t.dibuat_at || 0)).sort((a, b) => a - b);
    const dekat = waktu.some((w, i) => i > 0 && w - waktu[i - 1] <= 10 * 60 * 1000);
    if (dekat) out.push({ kode: 'DOBEL', tingkat: 'sedang', trx_id: g.filter((t) => !t.wajar).map((t) => t.id),
      pesan: `Kemungkinan dobel: ${g.length}× ${rp(g[0].jumlah)} (${namaKat.get(g[0].kategori_id) || 'kategori'}) tanggal ${g[0].tanggal}.` });
  }

  // nominal tak wajar: > 3× median kategori (90 hari terakhir, minimal 5 data pembanding)
  const batasTgl = new Date(sekarang - 90 * 864e5).toISOString().slice(0, 10);
  const riwayat = new Map();
  for (const t of transaksi) {
    if (!aktif(t) || t.jenis !== 'keluar' || t.tanggal < batasTgl) continue;
    if (!riwayat.has(t.kategori_id)) riwayat.set(t.kategori_id, []);
    riwayat.get(t.kategori_id).push(t);
  }
  for (const t of isi) {
    if (t.jenis !== 'keluar' || t.wajar) continue;
    const pembanding = (riwayat.get(t.kategori_id) || []).filter((x) => x.id !== t.id).map((x) => x.jumlah);
    if (pembanding.length < 5) continue;
    const med = median(pembanding);
    if (med > 0 && t.jumlah > 3 * med) out.push({ kode: 'TAK_WAJAR', tingkat: 'rendah', trx_id: [t.id],
      pesan: `${rp(t.jumlah)} di ${namaKat.get(t.kategori_id) || 'kategori'} (${t.tanggal}) jauh di atas biasanya (±${rp(med)}).` });
  }

  const tertua = antrian.reduce((m, a) => Math.min(m, Date.parse(a.dibuat_at)), Infinity);
  if (antrian.length && sekarang - tertua > 24 * 3600 * 1000) out.push({ kode: 'ANTRIAN_LAMA', tingkat: 'tinggi',
    pesan: `${antrian.length} catatan belum terkirim lebih dari 24 jam. Buka aplikasi saat ada sinyal.` });

  const urut = { tinggi: 0, sedang: 1, rendah: 2 };
  return out.sort((a, b) => urut[a.tingkat] - urut[b.tingkat]);
}

/** Teks ringkasan bahasa baku untuk dibagikan ke WhatsApp. */
export function teksRingkasan({ namaKeluarga, transaksi, kategori, anggaran, bulan }) {
  const r = ringkasBulan({ transaksi, kategori, anggaran, bulan });
  const baris = [
    `*Ringkasan Kas ${namaKeluarga} — ${namaBulan(bulan)}*`,
    `Pemasukan: ${rp(r.masuk)}`,
    `Pengeluaran: ${rp(r.keluar)}`,
    `Selisih: ${rp(r.selisih)}`,
  ];
  const keluar = r.perKategori.filter((x) => x.kategori.jenis === 'keluar' && x.terpakai > 0);
  if (keluar.length) {
    baris.push('', 'Pengeluaran per kategori:');
    for (const x of keluar) {
      const ang = x.anggaran != null ? ` dari ${rp(x.anggaran)} (${x.persen}%)` : '';
      baris.push(`• ${x.kategori.nama}: ${rp(x.terpakai)}${ang}`);
    }
  }
  if (r.totalAnggaran) baris.push('', `Sisa anggaran: ${rp(r.sisaAnggaran)}`);
  return baris.join('\n');
}
