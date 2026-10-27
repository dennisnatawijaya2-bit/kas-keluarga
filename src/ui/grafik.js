// Grafik SVG ringan. Warna lewat variabel CSS (ikut mode gelap). Selalu ada teks pendamping untuk pembaca layar.
import { s, h } from './dom.js';
import { rpPendek, rp } from '../engine/uang.js';
import { namaBulan } from '../engine/tanggal.js';

const WARNA = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)', 'var(--g5)', 'var(--g6)'];

/** Donat porsi kategori (maks 5 + "Lainnya"). data: [{label, nilai}] */
export function donat(data, judul) {
  const total = data.reduce((a, d) => a + d.nilai, 0);
  if (!total) return null;
  const urut = [...data].sort((a, b) => b.nilai - a.nilai);
  const atas = urut.slice(0, 5);
  const sisa = urut.slice(5).reduce((a, d) => a + d.nilai, 0);
  if (sisa) atas.push({ label: 'Lainnya', nilai: sisa });
  const R = 15.915; // keliling = 100
  let geser = 25;
  const busur = atas.map((d, i) => {
    const p = (d.nilai / total) * 100;
    const el = s('circle', { cx: 21, cy: 21, r: R, fill: 'none', stroke: WARNA[i % WARNA.length], 'stroke-width': 7,
      'stroke-dasharray': `${p} ${100 - p}`, 'stroke-dashoffset': geser });
    geser -= p;
    return el;
  });
  return h('figure', { class: 'donat' },
    s('svg', { viewBox: '0 0 42 42', role: 'img', 'aria-label': judul }, s('title', {}, judul), ...busur),
    h('figcaption', {}, h('ul', { class: 'legenda' }, atas.map((d, i) => h('li', {},
      h('span', { class: 'titik', style: { background: WARNA[i % WARNA.length] } }),
      `${d.label} — ${Math.round((d.nilai / total) * 100)}%`)))));
}

/** Batang tren per bulan: keluar & masuk berdampingan. data: [{bulan, keluar, masuk}] */
export function batangTren(data) {
  if (!data.some((d) => d.keluar || d.masuk)) return null;
  const maks = Math.max(1, ...data.flatMap((d) => [d.keluar, d.masuk]));
  const L = 300, T = 140, pad = 18, lebarGrup = (L - pad) / data.length, lb = Math.min(16, lebarGrup / 2 - 3);
  const el = [];
  data.forEach((d, i) => {
    const x = pad + i * lebarGrup + lebarGrup / 2;
    const hk = (d.keluar / maks) * (T - 30), hm = (d.masuk / maks) * (T - 30);
    el.push(s('rect', { x: x - lb - 1, y: T - 18 - hk, width: lb, height: hk, rx: 2, fill: 'var(--merah)' }, s('title', {}, `${namaBulan(d.bulan)} keluar ${rp(d.keluar)}`)));
    el.push(s('rect', { x: x + 1, y: T - 18 - hm, width: lb, height: hm, rx: 2, fill: 'var(--hijau)' }, s('title', {}, `${namaBulan(d.bulan)} masuk ${rp(d.masuk)}`)));
    el.push(s('text', { x, y: T - 4, 'text-anchor': 'middle', class: 'sumbu' }, namaBulan(d.bulan).slice(0, 3)));
  });
  el.push(s('text', { x: 2, y: 10, class: 'sumbu' }, rpPendek(maks)));
  const ringkas = data.map((d) => `${namaBulan(d.bulan)}: keluar ${rp(d.keluar)}, masuk ${rp(d.masuk)}`).join('; ');
  return h('figure', { class: 'tren' },
    s('svg', { viewBox: `0 0 ${L} ${T}`, role: 'img', 'aria-label': `Tren 6 bulan. ${ringkas}` }, ...el),
    h('figcaption', { class: 'legenda' },
      h('span', {}, h('span', { class: 'titik', style: { background: 'var(--merah)' } }), 'Keluar'),
      h('span', {}, h('span', { class: 'titik', style: { background: 'var(--hijau)' } }), 'Masuk')));
}
