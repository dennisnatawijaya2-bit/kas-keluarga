import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rp, ribuan, rpPendek, bacaRupiah } from '../../src/engine/uang.js';
import { hariIni, geserBulan, akhirBulan, namaBulan, tglPanjang, sahIso } from '../../src/engine/tanggal.js';
import { ringkasBulan, perHari, saldoDompet, tren, peringatan, teksRingkasan } from '../../src/engine/laporan.js';
import { buatCsv, kolomTransaksi } from '../../src/engine/csv.js';

test('format rupiah', () => {
  assert.equal(rp(1250000), 'Rp 1.250.000');
  assert.equal(rp(0), 'Rp 0');
  assert.equal(rp(-5000), '-Rp 5.000');
  assert.equal(ribuan(999), '999');
  assert.equal(rpPendek(1250000), '1,3 jt');
  assert.equal(rpPendek(2000000), '2 jt');
  assert.equal(rpPendek(15000), '15 rb');
});

test('baca ketikan rupiah', () => {
  assert.equal(bacaRupiah('1.250.000'), 1250000);
  assert.equal(bacaRupiah('Rp 1.250.000'), 1250000);
  assert.equal(bacaRupiah('1250000'), 1250000);
  assert.equal(bacaRupiah('15rb'), 15000);
  assert.equal(bacaRupiah('1,5jt'), 1500000);
  assert.equal(bacaRupiah('2 juta'), 2000000);
  assert.equal(bacaRupiah('25.000,00'), 25000);
  assert.equal(bacaRupiah('-50.000'), -50000);
  assert.equal(bacaRupiah(''), null);
  assert.equal(bacaRupiah('abc'), null);
  assert.equal(bacaRupiah('1.25.000'), null);
  assert.equal(bacaRupiah('1e20'), null);
  assert.equal(bacaRupiah('9999999999999999'), null);
});

test('tanggal', () => {
  assert.equal(hariIni(new Date('2026-10-27T18:30:00Z')), '2026-10-28'); // 01:30 WIB
  assert.equal(geserBulan('2026-01', -1), '2025-12');
  assert.equal(geserBulan('2026-12', 1), '2027-01');
  assert.equal(geserBulan('2026-10', -5), '2026-05');
  assert.equal(akhirBulan('2028-02'), '2028-02-29');
  assert.equal(namaBulan('2026-10'), 'Oktober 2026');
  assert.equal(tglPanjang('2026-10-27'), 'Selasa, 27 Oktober 2026');
  assert.ok(sahIso('2026-02-28'));
  assert.ok(!sahIso('2026-02-30'));
});

const K = [
  { id: 'k1', nama: 'Makan', jenis: 'keluar', urutan: 1 },
  { id: 'k2', nama: 'Bensin', jenis: 'keluar', urutan: 2 },
  { id: 'k3', nama: 'Gaji', jenis: 'masuk', urutan: 1 },
];
const D = [{ id: 'd1', nama: 'Tunai', saldo_awal: 100000 }, { id: 'd2', nama: 'Bank', saldo_awal: 0 }];
const T = [
  { id: 't1', jenis: 'masuk', tanggal: '2026-10-01', jumlah: 5000000, kategori_id: 'k3', dompet_id: 'd2', dibuat_at: '2026-10-01T01:00:00Z' },
  { id: 't2', jenis: 'keluar', tanggal: '2026-10-02', jumlah: 50000, kategori_id: 'k1', dompet_id: 'd1', dibuat_at: '2026-10-02T01:00:00Z' },
  { id: 't3', jenis: 'keluar', tanggal: '2026-10-02', jumlah: 900000, kategori_id: 'k1', dompet_id: 'd2', dibuat_at: '2026-10-02T02:00:00Z' },
  { id: 't4', jenis: 'pindah', tanggal: '2026-10-03', jumlah: 200000, dompet_id: 'd2', dompet_tujuan_id: 'd1', dibuat_at: '2026-10-03T01:00:00Z' },
  { id: 't5', jenis: 'penyesuaian', tanggal: '2026-10-04', jumlah: -10000, dompet_id: 'd1', dibuat_at: '2026-10-04T01:00:00Z' },
  { id: 't6', jenis: 'keluar', tanggal: '2026-10-05', jumlah: 70000, kategori_id: 'k2', dompet_id: 'd1', dihapus_at: '2026-10-06T00:00:00Z' },
  { id: 't7', jenis: 'keluar', tanggal: '2026-09-30', jumlah: 30000, kategori_id: 'k2', dompet_id: 'd1', dibuat_at: '2026-09-30T01:00:00Z' },
];
const A = [{ kategori_id: 'k1', bulan: '2026-10-01', jumlah: 1000000 }, { kategori_id: 'k2', bulan: '2026-10-01', jumlah: 300000 }];

test('ringkasan bulan: pindah/penyesuaian/terhapus tidak masuk laporan', () => {
  const r = ringkasBulan({ transaksi: T, kategori: K, anggaran: A, bulan: '2026-10' });
  assert.equal(r.keluar, 950000);
  assert.equal(r.masuk, 5000000);
  assert.equal(r.selisih, 4050000);
  const makan = r.perKategori.find((x) => x.kategori.id === 'k1');
  assert.deepEqual([makan.terpakai, makan.anggaran, makan.persen, makan.status], [950000, 1000000, 95, 'hampir']);
  const bensin = r.perKategori.find((x) => x.kategori.id === 'k2');
  assert.equal(bensin.terpakai, 0);
  assert.equal(r.totalAnggaran, 1300000);
  assert.equal(r.sisaAnggaran, 350000);
});

test('saldo dompet', () => {
  const s = saldoDompet(T, D);
  // d1: 100000 -50000 +200000 -10000 -30000 = 210000 (t6 terhapus)
  assert.equal(s.get('d1'), 210000);
  // d2: 5000000 -900000 -200000 = 3900000
  assert.equal(s.get('d2'), 3900000);
});

test('per hari & tren', () => {
  const h = perHari(T, '2026-10');
  assert.equal(h[0].tanggal, '2026-10-04');
  const d2 = h.find((x) => x.tanggal === '2026-10-02');
  assert.equal(d2.keluar, 950000);
  assert.equal(d2.isi[0].id, 't3');
  const tr = tren(T, '2026-10', 3);
  assert.deepEqual(tr.map((x) => x.bulan), ['2026-08', '2026-09', '2026-10']);
  assert.equal(tr[1].keluar, 30000);
});

test('peringatan: anggaran, dobel, tak wajar, antrian', () => {
  const dobel = [...T,
    { id: 'x1', jenis: 'keluar', tanggal: '2026-10-07', jumlah: 25000, kategori_id: 'k2', dompet_id: 'd1', dibuat_at: '2026-10-07T01:00:00Z' },
    { id: 'x2', jenis: 'keluar', tanggal: '2026-10-07', jumlah: 25000, kategori_id: 'k2', dompet_id: 'd1', dibuat_at: '2026-10-07T01:05:00Z' },
  ];
  const p = peringatan({ transaksi: dobel, kategori: K, anggaran: A, bulan: '2026-10',
    antrian: [{ dibuat_at: '2026-10-01T00:00:00Z' }], sekarang: Date.parse('2026-10-08T00:00:00Z') });
  const kode = p.map((x) => x.kode);
  assert.ok(kode.includes('ANG_HAMPIR'));
  assert.ok(kode.includes('DOBEL'));
  assert.ok(kode.includes('ANTRIAN_LAMA'));
  assert.equal(p[0].tingkat, 'tinggi');
  // ditandai wajar -> tidak muncul lagi
  const wajar = dobel.map((t) => (t.id.startsWith('x') ? { ...t, wajar: true } : t));
  assert.ok(!peringatan({ transaksi: wajar, kategori: K, anggaran: A, bulan: '2026-10' }).some((x) => x.kode === 'DOBEL'));

  const biasa = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, jenis: 'keluar', tanggal: `2026-10-1${i}`,
    jumlah: 20000, kategori_id: 'k2', dompet_id: 'd1', dibuat_at: `2026-10-1${i}T01:00:00Z` }));
  const besar = { id: 'big', jenis: 'keluar', tanggal: '2026-10-20', jumlah: 500000, kategori_id: 'k2', dompet_id: 'd1', dibuat_at: '2026-10-20T01:00:00Z' };
  const p2 = peringatan({ transaksi: [...biasa, besar], kategori: K, bulan: '2026-10', sekarang: Date.parse('2026-10-21T00:00:00Z') });
  assert.deepEqual(p2.find((x) => x.kode === 'TAK_WAJAR').trx_id, ['big']);
});

test('teks ringkasan untuk WhatsApp', () => {
  const s = teksRingkasan({ namaKeluarga: 'Uji', transaksi: T, kategori: K, anggaran: A, bulan: '2026-10' });
  assert.match(s, /Ringkasan Kas Uji — Oktober 2026/);
  assert.match(s, /Makan: Rp 950\.000 dari Rp 1\.000\.000 \(95%\)/);
  assert.match(s, /Sisa anggaran: Rp 350\.000/);
});

test('CSV: BOM, pemisah, kutip, cegah formula', () => {
  const kol = kolomTransaksi({ kategori: K, dompet: D, anggota: [{ user_id: 'u1', nama_tampilan: 'Dennis' }] });
  const csv = buatCsv([{ tanggal: '2026-10-02', jenis: 'keluar', kategori_id: 'k1', dompet_id: 'd1', jumlah: 50000,
    catatan: '=HYPERLINK("x");"a"', dicatat_oleh: 'u1' }], kol, ';');
  assert.ok(csv.startsWith('﻿tanggal;jenis;kategori'));
  assert.match(csv, /2026-10-02;keluar;Makan;Tunai;;50000;"'=HYPERLINK\(""x""\);""a""";Dennis/);
});
