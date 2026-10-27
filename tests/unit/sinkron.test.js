// Uji antrian & sinkron dengan IndexedDB palsu dan Supabase tiruan (tanpa jaringan).
import 'fake-indexeddb/auto';
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---- Supabase tiruan: tabel di memori, upsert bisa ditahan untuk mensimulasikan sinyal lemah
const server = { transaksi: new Map(), kategori: new Map(), dompet: new Map(), anggaran: new Map(), anggota: new Map(), keluarga: new Map() };
let tahanUpsert = null;          // Promise yang ditunggu sebelum upsert selesai
let saatFetchTransaksi = null;   // callback dipanggil di tengah tarik
const jam = () => new Date(Date.now() + Math.random()).toISOString();

function query(tabel) {
  const q = {
    _filter: [], _gt: null,
    select() { return q; }, order() { return q; },
    eq(k, v) { q._filter.push([k, v]); return q; },
    gt(k, v) { q._gt = [k, v]; return q; },
    async range() {
      if (tabel === 'transaksi' && saatFetchTransaksi) { const f = saatFetchTransaksi; saatFetchTransaksi = null; await f(); }
      let rows = [...server[tabel].values()].filter((r) => q._filter.every(([k, v]) => r[k] === v));
      if (q._gt) rows = rows.filter((r) => r[q._gt[0]] > q._gt[1]);
      return { data: structuredClone(rows), error: null };
    },
    async upsert(baris) {
      if (tahanUpsert) await tahanUpsert;
      const lama = server[tabel].get(baris.id) || {};
      server[tabel].set(baris.id, { ...lama, ...baris, updated_at: jam() });
      return { error: null };
    },
  };
  return q;
}
mock.module('../../src/data/supabase.js', {
  namedExports: { sb: { from: query, auth: { getSession: async () => ({ data: { session: { expires_at: Date.now() / 1000 + 3600 } } }) } }, SUPABASE_URL: 'x' },
});
globalThis.navigator ??= {};
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const { db } = await import('../../src/data/lokal.js');
const { tulis, sinkron, hentikanSinkron } = await import('../../src/data/sinkron.js');

const K = 'kel-1';
const trx = (id, jumlah, extra = {}) => ({ id, keluarga_id: K, jenis: 'keluar', tanggal: '2026-10-27', jumlah, kategori_id: 'k', dompet_id: 'd', dompet_tujuan_id: null, catatan: null, wajar: false, dihapus_at: null, ...extra });

beforeEach(async () => {
  for (const m of Object.values(server)) m.clear();
  tahanUpsert = null; saatFetchTransaksi = null;
  await Promise.all(['transaksi', 'antrian', 'meta', 'kategori', 'dompet', 'anggaran', 'anggota', 'keluarga'].map((t) => db[t].clear()));
});

test('ubahan saat kiriman sebelumnya masih berjalan tidak hilang (versi antrian)', async () => {
  let lepas;
  tahanUpsert = new Promise((r) => { lepas = r; });
  await tulis('transaksi', trx('t1', 5000));
  const jalan = sinkron(K);                       // upsert 5000 tertahan
  await new Promise((r) => setTimeout(r, 20));
  await tulis('transaksi', trx('t1', 50000));    // pengguna mengubah selama kiriman berjalan
  lepas(); tahanUpsert = null;
  await jalan;
  await sinkron(K);                               // putaran berikut mengirim ubahan
  assert.equal(server.transaksi.get('t1').jumlah, 50000);
  assert.equal(await db.antrian.count(), 0);
  assert.equal((await db.transaksi.get('t1')).jumlah, 50000);
});

test('catatan yang dibuat selama tarik berjalan tidak terhapus dari layar', async () => {
  saatFetchTransaksi = async () => { await tulis('transaksi', trx('baru', 7000)); };
  await sinkron(K);                               // tarik penuh pertama (tanpa tanda)
  assert.ok(await db.transaksi.get('baru'), 'baris lokal baru harus tetap ada');
});

test('kiriman ulang tetap satu baris; hapus lunak ikut terkirim', async () => {
  await tulis('transaksi', trx('t2', 1000));
  await sinkron(K);
  await tulis('transaksi', trx('t2', 1000, { dihapus_at: '2026-10-27T10:00:00Z' }));
  await sinkron(K);
  assert.equal(server.transaksi.size, 1);
  assert.ok(server.transaksi.get('t2').dihapus_at);
});

test('setelah dihentikan (keluar/ganti akun), run lama tidak mengirim item berikutnya', async () => {
  let lepas;
  tahanUpsert = new Promise((r) => { lepas = r; });
  await tulis('transaksi', trx('a1', 1000));
  await tulis('transaksi', trx('a2', 2000));
  const jalan = sinkron(K);                     // upsert a1 tertahan
  await new Promise((r) => setTimeout(r, 20));
  const henti = hentikanSinkron();               // keluar: generasi naik
  await db.antrian.clear();                      // kosongkanLokal
  lepas(); tahanUpsert = null;
  await henti; await jalan;
  assert.ok(!server.transaksi.has('a2'), 'a2 tidak boleh terkirim setelah keluar');
});
