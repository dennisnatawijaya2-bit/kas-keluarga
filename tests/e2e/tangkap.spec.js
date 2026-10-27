// Tangkapan layar untuk panduan (bukan uji). Jalankan: $env:TANGKAP=1; npx playwright test tests/e2e/tangkap.spec.js --project=iphone-webkit
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.resolve(AKAR, '..', '.env.uji'), quiet: true });
const KE = path.resolve(AKAR, '..', 'images');

test.skip(!process.env.TANGKAP, 'hanya saat TANGKAP=1');

test('tangkapan layar panduan', async ({ page }) => {
  const foto = (n) => page.screenshot({ path: path.join(KE, `261027_app_${n}.png`) });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Masuk' })).toBeVisible();
  await foto('01_masuk');
  await page.getByLabel('Nama pengguna').fill(process.env.UJI_A_EMAIL);
  await page.locator('#sandi').fill(process.env.UJI_A_PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.lencana')).toHaveText(/Tersimpan/, { timeout: 30_000 });
  await foto('02_beranda');
  await page.getByRole('link', { name: 'Catat transaksi' }).click();
  for (const d of '25000') await page.locator('.keypad').getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('radio', { name: /Makan/ }).click();
  await foto('03_catat');
  await page.goto('/#/ringkasan');
  await foto('04_ringkasan');
  await page.goto('/#/kelola');
  await foto('05_kelola');
});
