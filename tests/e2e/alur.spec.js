// E2E: masuk → catat → riwayat → ringkasan → offline → sinkron tepat sekali. Memakai akun UJI (keluarga A).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.resolve(AKAR, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(AKAR, '..', '.env.uji'), quiet: true });
const KA = process.env.UJI_KELUARGA_A;

let sb;
test.beforeAll(async () => {
  sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: process.env.UJI_A_EMAIL, password: process.env.UJI_A_PASSWORD });
  expect(error).toBeNull();
});
test.afterAll(async () => { await sb.from('transaksi').delete().eq('keluarga_id', KA).like('catatan', 'e2e-%'); });

async function masuk(page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(process.env.UJI_A_EMAIL);
  await page.locator('#sandi').fill(process.env.UJI_A_PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.kepala .judul')).toHaveText('Keluarga Uji A');
  await expect(page.locator('.lencana')).toHaveText(/Tersimpan/, { timeout: 30_000 });
}

async function catat(page, angka, kategori, catatan) {
  await page.getByRole('link', { name: 'Catat transaksi' }).click();
  for (const d of angka) await page.locator('.keypad').getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('radio', { name: new RegExp(kategori) }).click();
  await page.locator('summary').click();
  await page.locator('#cat').fill(catatan);
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Tersimpan');
}

const jumlahDiServer = async (catatan) => (await sb.from('transaksi').select('id').eq('keluarga_id', KA).eq('catatan', catatan)).data.length;

test('masuk, catat, muncul di riwayat & ringkasan, terkirim ke server', async ({ page }, info) => {
  const tanda = `e2e-${info.project.name}-${Date.now()}`;
  await masuk(page);
  await catat(page, '25000', 'Makan', tanda);
  await expect(page.locator('.trx', { hasText: tanda })).toBeVisible();
  await page.getByRole('link', { name: /Riwayat/ }).click();
  await expect(page.locator('.trx', { hasText: tanda })).toContainText('Rp 25.000');
  await page.getByRole('link', { name: /Ringkasan/ }).click();
  await expect(page.locator('.kat-baris', { hasText: 'Makan & Dapur' })).toBeVisible();
  await expect.poll(() => jumlahDiServer(tanda), { timeout: 20_000 }).toBe(1);
});

test('offline: catat 3, aplikasi tetap terbuka saat dimuat ulang, lalu terkirim tepat sekali', async ({ page, context }, info) => {
  const tanda = `e2e-off-${info.project.name}-${Date.now()}`;
  await masuk(page);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true));
  await page.reload(); // pastikan halaman dikendalikan service worker
  await expect(page.locator('.lencana')).toHaveText(/Tersimpan/, { timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.kepala .judul')).toHaveText('Keluarga Uji A');
  await expect(page.locator('.lencana')).toHaveText(/Offline/);
  for (let i = 1; i <= 3; i++) await catat(page, `${i}000`, 'Bensin|Transportasi', `${tanda}-${i}`);
  await expect(page.locator('.lencana')).toHaveText(/3 belum terkirim/);
  expect(await jumlahDiServer(`${tanda}-1`)).toBe(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.lencana')).toHaveText(/Tersimpan/, { timeout: 30_000 });
  for (let i = 1; i <= 3; i++) expect(await jumlahDiServer(`${tanda}-${i}`)).toBe(1);
});

test('ubah lalu hapus catatan', async ({ page }, info) => {
  const tanda = `e2e-ubah-${info.project.name}-${Date.now()}`;
  await masuk(page);
  await catat(page, '5000', 'Makan', tanda);
  await page.locator('.trx', { hasText: tanda }).click();
  await page.locator('.keypad').getByRole('button', { name: '0', exact: true }).click(); // 50000
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.locator('.trx', { hasText: tanda })).toContainText('Rp 50.000');
  await page.locator('.trx', { hasText: tanda }).click();
  await page.getByRole('button', { name: 'Hapus', exact: true }).click();
  await page.locator('dialog').getByRole('button', { name: 'Hapus' }).click();
  await expect(page.locator('.trx', { hasText: tanda })).toHaveCount(0);
  await expect.poll(async () => (await sb.from('transaksi').select('jumlah, dihapus_at').eq('catatan', tanda).single()).data, { timeout: 20_000 })
    .toMatchObject({ jumlah: 50000, dihapus_at: expect.any(String) });
});

test('manifest PWA & ikon tersedia', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.display).toBe('standalone');
  expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect((await request.get('/apple-touch-icon-180.png')).ok()).toBeTruthy();
});
