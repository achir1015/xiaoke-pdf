// =====================================================================
// 影音卡片（MediaCard）
//
// PDF 本身沒有一個「所有閱讀器都能播放影片」的通用方法，所以我們做一張「播放卡片」：
//   - 卡片上有播放鍵、標題、來源；線上影音還附 QR Code，紙本也能用手機掃。
//   - 在 PDF 裡：線上影音整張卡片是超連結；本機檔案則嵌入成附件。
// 同一支程式同時畫「編輯畫面的預覽」與「匯出 PDF 的圖片」，所以兩邊長得一樣。
// =====================================================================
import { qrcode } from './libs.js';
import { loadImage, formatBytes } from './util.js';

const NAVY = '#16213A', BLUE = '#1E63E9', CYAN = '#5CE1E6';

/**
 * 把卡片畫到畫布上
 * @param {import('../domain/elements.js').MediaElement} el
 * @param {number} scale 每 pt 幾個像素
 */
export async function drawMediaCard(canvas, el, scale) {
  const W = el.w, H = el.h;
  canvas.width = Math.max(2, Math.round(W * scale));
  canvas.height = Math.max(2, Math.round(H * scale));
  const g = canvas.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  const r = Math.min(W, H) * 0.06;

  // 背景（有封面圖就鋪封面，再蓋一層深色讓字看得清楚）
  g.save();
  roundRect(g, 0, 0, W, H, r); g.clip();
  g.fillStyle = NAVY; g.fillRect(0, 0, W, H);
  if (el.poster) {
    try {
      const img = await loadImage(el.poster);
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      g.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(22,33,58,0.25)'); grad.addColorStop(1, 'rgba(22,33,58,0.85)');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
    } catch (e) { /* 封面載不到就用純色 */ }
  } else {
    // 品牌色波浪（呼應 App 圖示）
    g.fillStyle = 'rgba(30,99,233,0.35)';
    g.beginPath(); g.moveTo(0, H * 0.62);
    g.bezierCurveTo(W * 0.3, H * 0.48, W * 0.65, H * 0.82, W, H * 0.58);
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
  }

  // QR Code（線上影音才有）
  const pad = Math.max(6, Math.min(W, H) * 0.07);
  let right = W;
  const qrText = el.source === 'url' && el.showQr ? safeUrl(el.url) : '';
  if (qrText && H >= 56 && W >= 140) {
    const q = Math.min(H - pad * 2, W * 0.34);
    const qx = W - pad - q, qy = (H - q) / 2;
    drawQr(g, qrText, qx, qy, q);
    right = qx - pad * 0.6;
  }

  // 播放鍵
  const areaW = right;
  const pr = Math.max(8, Math.min(areaW, H) * 0.17);
  const pcx = areaW / 2, pcy = H * 0.4;
  g.fillStyle = BLUE;
  g.beginPath(); g.arc(pcx, pcy, pr, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(1, pr * 0.08); g.stroke();
  g.fillStyle = '#fff';
  if (el.mediaType === 'audio') {
    // 音符
    const u = pr / 10;
    g.fillRect(pcx + u * 1.2, pcy - u * 5, u * 1.2, u * 8);
    g.beginPath(); g.ellipse(pcx - u * 0.6, pcy + u * 3, u * 2.4, u * 1.8, -0.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(pcx + u * 2.4, pcy - u * 5); g.quadraticCurveTo(pcx + u * 6, pcy - u * 3.5, pcx + u * 4.5, pcy - u * 0.5);
    g.lineWidth = u * 1.1; g.strokeStyle = '#fff'; g.stroke();
  } else {
    g.beginPath();
    g.moveTo(pcx - pr * 0.32, pcy - pr * 0.45); g.lineTo(pcx + pr * 0.52, pcy); g.lineTo(pcx - pr * 0.32, pcy + pr * 0.45);
    g.closePath(); g.fill();
  }

  // 標題與來源
  const fam = "'XKHuninn', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
  const ts = Math.max(7, Math.min(20, H * 0.1, areaW * 0.075));
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.font = `bold ${ts}px ${fam}`;
  fillFit(g, el.displayTitle, pcx, pcy + pr + ts * 1.5, areaW - pad * 2);
  g.fillStyle = CYAN;
  g.font = `${ts * 0.72}px ${fam}`;
  fillFit(g, subtitle(el), pcx, pcy + pr + ts * 2.75, areaW - pad * 2);
  g.restore();
  return canvas;
}

/** 卡片 → PNG 位元組（匯出用，3 倍解析度） */
export async function mediaCardPng(el, scale = 3) {
  const c = await drawMediaCard(document.createElement('canvas'), el, scale);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function subtitle(el) {
  if (el.source === 'file') return el.file ? `附件 ${formatBytes(el.file.bytes.length)} · 點右上角迴紋針播放` : '尚未選擇檔案';
  if (!el.url) return '尚未設定網址';
  if (el.youtubeId) return el.showQr ? 'YouTube · 點擊或掃描觀看' : 'YouTube · 點擊觀看';
  try { return new URL(el.url).host + ' · 點擊開啟'; } catch (e) { return el.url; }
}

function drawQr(g, text, x, y, size) {
  let qr;
  try { qr = qrcode(0, 'M'); qr.addData(text); qr.make(); } catch (e) { return; }
  const n = qr.getModuleCount();
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  g.fillStyle = '#fff';
  roundRect(g, x, y, size, size, cell * 1.5); g.fill();
  g.fillStyle = NAVY;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) g.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.02, cell + 0.02);
  }
}

function fillFit(g, text, cx, y, maxW) {
  let t = String(text || '');
  if (g.measureText(t).width > maxW) {
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  g.fillText(t, cx, y);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** QR 與 PDF 連結只能放 ASCII，中文網址轉成 %XX */
export function safeUrl(u) {
  try { return new URL(u).href; } catch (e) { return encodeURI(String(u || '')); }
}

/** 嘗試抓 YouTube 縮圖當封面（需要對方允許跨網域讀取，失敗就算了） */
export async function fetchYoutubePoster(id) {
  for (const name of ['maxresdefault', 'hqdefault']) {
    try {
      const img = await loadImage(`https://i.ytimg.com/vi/${id}/${name}.jpg`, 'anonymous');
      if (img.naturalWidth < 200) continue;          // 沒有高解析縮圖時會回傳 120px 的灰圖
      const c = document.createElement('canvas');
      c.width = Math.min(960, img.naturalWidth); c.height = Math.round(c.width * img.naturalHeight / img.naturalWidth);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);           // 跨網域不允許的話這裡會丟錯
    } catch (e) { /* 換下一個 */ }
  }
  return null;
}
