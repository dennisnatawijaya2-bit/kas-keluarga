// Pembuat elemen kecil. Teks selalu lewat text node → aman dari XSS (tanpa innerHTML untuk data).

export function h(tag, attrs = {}, ...anak) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  tambah(el, anak);
  return el;
}

function tambah(el, anak) {
  for (const a of anak.flat(Infinity)) {
    if (a == null || a === false) continue;
    el.append(a instanceof Node ? a : document.createTextNode(String(a)));
  }
}

const NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...anak) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const a of anak.flat(Infinity)) {
    if (a == null || a === false) continue;
    el.append(a instanceof Node ? a : document.createTextNode(String(a)));
  }
  return el;
}

let timerToast;
export function toast(pesan, jenis = 'info') {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = pesan;
  t.className = `toast tampil ${jenis}`;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.className = 'toast'; }, 2600);
}

/** Dialog konfirmasi tanpa window.confirm (aman di PWA iOS). */
export function konfirmasi({ judul, isi, ok = 'Ya', batal = 'Batal', bahaya = false }) {
  return new Promise((selesai) => {
    const tutup = (hasil) => { dlg.close(); dlg.remove(); selesai(hasil); };
    const dlg = h('dialog', { class: 'dialog' },
      h('h2', {}, judul),
      isi ? h('p', {}, isi) : null,
      h('div', { class: 'baris-tombol' },
        h('button', { type: 'button', class: 'tombol kedua', onclick: () => tutup(false) }, batal),
        h('button', { type: 'button', class: `tombol ${bahaya ? 'bahaya' : 'utama'}`, onclick: () => tutup(true) }, ok)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); tutup(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Unduh teks sebagai berkas; bila bisa, buka menu bagikan HP. */
export async function bagikanBerkas(nama, isi, tipe) {
  const blob = new Blob([isi], { type: tipe });
  const berkas = new File([blob], nama, { type: tipe });
  if (navigator.canShare?.({ files: [berkas] })) {
    try { await navigator.share({ files: [berkas], title: nama }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nama });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function bagikanTeks(teks) {
  if (navigator.share) {
    try { await navigator.share({ text: teks }); return 'dibagikan'; } catch (e) { if (e.name === 'AbortError') return 'batal'; }
  }
  await navigator.clipboard.writeText(teks);
  return 'disalin';
}
