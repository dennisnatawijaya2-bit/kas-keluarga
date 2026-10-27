// Keluar & ganti akun di HP yang sama: sesi dan data keluarga lama tidak boleh tersisa.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.resolve(AKAR, '..', '.env.uji'), quiet: true });

async function masuk(page, k) {
  await page.goto('/');
  await page.getByLabel('Email').fill(process.env[`UJI_${k}_EMAIL`]);
  await page.locator('#sandi').fill(process.env[`UJI_${k}_PASSWORD`]);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.lencana')).toHaveText(/Tersimpan/, { timeout: 30_000 });
}
const sisa = (page) => page.evaluate(async () => {
  const sesi = localStorage.getItem('kas-keluarga-sesi');
  const n = await new Promise((ok) => {
    const r = indexedDB.open('kas_keluarga');
    r.onsuccess = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('transaksi')) return ok(0);
      const c = d.transaction('kategori').objectStore('kategori').count();
      c.onsuccess = () => ok(c.result);
    };
    r.onerror = () => ok(-1);
  });
  return { sesi: !!sesi, kategori: n };
});

test('keluar saat OFFLINE tetap menghapus sesi & data lokal', async ({ page, context }) => {
  await masuk(page, 'A');
  expect((await sisa(page)).kategori).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.goto('/#/kelola');
  await page.getByRole('button', { name: 'Keluar dari akun' }).click();
  await expect(page.getByRole('button', { name: 'Masuk' })).toBeVisible();
  expect(await sisa(page)).toEqual({ sesi: false, kategori: 0 });
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Masuk' })).toBeVisible(); // tidak masuk otomatis
});

test('ganti akun: data keluarga A tidak terbawa ke B', async ({ page }) => {
  await masuk(page, 'A');
  await expect(page.locator('.kepala .judul')).toHaveText('Keluarga Uji A');
  // sesi A berakhir tanpa tombol Keluar (mis. token dicabut) → data lokal A masih ada
  await page.evaluate(() => localStorage.removeItem('kas-keluarga-sesi'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Masuk' })).toBeVisible();
  await masuk(page, 'B');
  await expect(page.locator('.kepala .judul')).toHaveText('Keluarga Uji B');
  const namaKeluargaLokal = await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('kas_keluarga');
    r.onsuccess = () => { const q = r.result.transaction('keluarga').objectStore('keluarga').getAll(); q.onsuccess = () => ok(q.result.map((x) => x.nama)); };
  }));
  expect(namaKeluargaLokal).toEqual(['Keluarga Uji B']);
});
