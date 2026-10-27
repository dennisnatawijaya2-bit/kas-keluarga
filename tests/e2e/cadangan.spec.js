// Uji pulih (Fase 11): cadangan keluarga A diunduh dari aplikasi, lalu dipulihkan ke keluarga B.
// Jumlah & total transaksi aktif di B (bertanda) harus sama dengan sumber.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.resolve(AKAR, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(AKAR, '..', '.env.uji'), quiet: true });
const KA = process.env.UJI_KELUARGA_A, KB = process.env.UJI_KELUARGA_B;
const klien = async (k) => {
  const c = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: process.env[`UJI_${k}_EMAIL`], password: process.env[`UJI_${k}_PASSWORD`] });
  return c;
};

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'cukup sekali (unduh berkas di Chromium)');

test('unduh cadangan A lalu pulihkan ke B: jumlah & total sama', async ({ browser }) => {
  const A = await klien('A'), B = await klien('B');
  const tanda = `e2e-cad-${Date.now()}`;
  const kat = (await A.from('kategori').select('id').eq('keluarga_id', KA).eq('jenis', 'keluar').limit(1).single()).data.id;
  const dom = (await A.from('dompet').select('id').eq('keluarga_id', KA).limit(1).single()).data.id;
  const sumber = [12000, 34500, 7000].map((j, i) => ({ keluarga_id: KA, jenis: 'keluar', tanggal: '2026-10-2' + i, jumlah: j,
    kategori_id: kat, dompet_id: dom, catatan: `${tanda}-${i}` }));
  await A.from('transaksi').insert(sumber);

  const masuk = async (page, k) => {
    await page.goto('/');
    await page.getByLabel('Nama pengguna').fill(process.env[`UJI_${k}_EMAIL`]);
    await page.locator('#sandi').fill(process.env[`UJI_${k}_PASSWORD`]);
    await page.getByRole('button', { name: 'Masuk' }).click();
    await expect(page.locator('.lencana')).toHaveText(/Tersimpan/, { timeout: 30_000 });
  };

  const ctxA = await browser.newContext({ acceptDownloads: true });
  const pA = await ctxA.newPage();
  await masuk(pA, 'A');
  await pA.goto('/#/kelola/cadangan');
  const [unduh] = await Promise.all([pA.waitForEvent('download'), pA.getByRole('button', { name: 'Unduh cadangan' }).click()]);
  const berkas = path.join(test.info().outputDir, 'cadangan.json');
  await unduh.saveAs(berkas);
  const data = JSON.parse(fs.readFileSync(berkas, 'utf8'));
  const dariA = data.transaksi.filter((t) => t.catatan?.startsWith(tanda));
  expect(dariA).toHaveLength(3);
  await ctxA.close();

  const ctxB = await browser.newContext();
  const pB = await ctxB.newPage();
  await masuk(pB, 'B');
  await pB.goto('/#/kelola/cadangan');
  await pB.locator('input[type=file]').setInputFiles(berkas);
  await pB.getByRole('button', { name: 'Pulihkan', exact: true }).click();
  await pB.locator('dialog').getByRole('button', { name: 'Pulihkan' }).click();
  await expect(pB.locator('.lencana')).toHaveText(/Tersimpan/, { timeout: 60_000 });

  await expect.poll(async () => {
    const { data: rows } = await B.from('transaksi').select('jumlah, catatan').eq('keluarga_id', KB).like('catatan', `${tanda}%`).is('dihapus_at', null);
    return { n: rows.length, total: rows.reduce((s, r) => s + r.jumlah, 0) };
  }, { timeout: 30_000 }).toEqual({ n: 3, total: 53500 });
  // id baru (keluarga lain) → sumber di A tetap utuh
  const { data: masihA } = await A.from('transaksi').select('id').eq('keluarga_id', KA).like('catatan', `${tanda}%`);
  expect(masihA).toHaveLength(3);
  await ctxB.close();

  // bersihkan seluruh hasil pulih di B & sumber di A
  await B.from('transaksi').delete().eq('keluarga_id', KB);
  await B.from('anggaran').delete().eq('keluarga_id', KB);
  await A.from('transaksi').delete().eq('keluarga_id', KA).like('catatan', 'e2e-%');
});
