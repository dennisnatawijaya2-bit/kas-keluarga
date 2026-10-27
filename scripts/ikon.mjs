// Membuat ikon PNG dari public/favicon.svg. Jalankan: node scripts/ikon.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = fs.readFileSync(new URL('../public/favicon.svg', import.meta.url));
const keluar = (n) => fileURLToPath(new URL(`../public/${n}`, import.meta.url));

await sharp(svg, { density: 300 }).resize(192, 192).png().toFile(keluar('ikon-192.png'));
await sharp(svg, { density: 300 }).resize(512, 512).png().toFile(keluar('ikon-512.png'));
// iOS tidak memakai transparansi & memberi sudut sendiri → latar penuh
const penuh = (n) => sharp({ create: { width: n, height: n, channels: 4, background: '#0f766e' } });
const isi = async (n, skala) => sharp(svg, { density: 300 }).resize(Math.round(n * skala), Math.round(n * skala)).png().toBuffer();
await penuh(180).composite([{ input: await isi(180, 1), gravity: 'center' }]).png().toFile(keluar('apple-touch-icon-180.png'));
// maskable: konten di zona aman 80%
await penuh(512).composite([{ input: await isi(512, 0.8), gravity: 'center' }]).png().toFile(keluar('ikon-maskable-512.png'));
console.log('ikon dibuat');
