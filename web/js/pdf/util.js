// =====================================================================
// 共用小工具
// =====================================================================

/**
 * 解析頁碼範圍（使用者看到的頁碼從 1 開始），回傳 0 起算的索引陣列。
 * '' / 'all' / '全部' → 全部頁面；'1-3,5' → [0,1,2,4]；'3-' → 第 3 頁到最後；'奇數' / '偶數' 也可以
 */
export function parsePageRange(text, count) {
  const t = String(text || '').trim().replace(/，/g, ',').replace(/[～~—–]/g, '-').replace(/\s+/g, '');
  const all = [...Array(count).keys()];
  if (!t || /^(all|全部)$/i.test(t)) return all;
  if (/^(odd|奇數)$/i.test(t)) return all.filter(i => i % 2 === 0);
  if (/^(even|偶數)$/i.test(t)) return all.filter(i => i % 2 === 1);
  const set = new Set();
  for (const part of t.split(',')) {
    if (!part) continue;
    const m = part.match(/^(\d*)-(\d*)$/);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : count;
      for (let p = Math.max(1, Math.min(a, b)); p <= Math.min(count, Math.max(a, b)); p++) set.add(p - 1);
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part, 10);
      if (p >= 1 && p <= count) set.add(p - 1);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** '#rrggbb' → { red, green, blue }（0~1） */
export function hexToRgb(hex) {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 讓瀏覽器下載一個檔案 */
export function downloadBytes(bytes, fileName, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function fileToBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/** 圖片檔 → PDF 能嵌入的 PNG/JPG（其他格式如 WebP、GIF 先用畫布轉成 PNG） */
export async function normalizeImage(file) {
  const bytes = await fileToBytes(file);
  const mime = file.type || '';
  const size = await imageSize(bytes, mime);
  if (/png|jpe?g/i.test(mime)) return { bytes, mime: /png/i.test(mime) ? 'image/png' : 'image/jpeg', ...size };
  const img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: mime })));
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const png = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
  return { bytes: png, mime: 'image/png', width: c.width, height: c.height };
}

async function imageSize(bytes, mime) {
  const img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: mime })));
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = src;
  });
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 把「康熙部首」「部首補充」字元換成一般漢字（例如 ⼯→工、⽉→月）。
 * 有些 PDF（例如 Chrome 列印的）文字對照表會用到它們，看起來一樣但字碼不同，
 * 會造成搜尋比對失敗或新字型缺字。只轉換這兩個區段，全形標點不受影響。
 */
export function normalizeCjk(s) {
  return String(s).replace(/[⺀-⻿⼀-⿟]/g, ch => ch.normalize('NFKC'));
}
