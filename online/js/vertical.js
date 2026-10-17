// 直書文字：找出頁面上的直行（含 OCR 辨識出的直行），把修改後的文字以直書寫回 PDF。
//
// 比喻：直書就像把稿紙轉個方向——中文字「站著」由上往下排，英數字「躺著」排，
// 一行寫滿再往左開新的一行。規則和網頁版（web/js/pdf/vertical.js）、Android 版（Vertical.java）相同。
//
// 直書 PDF 常見三種寫法，pdf.js 讀出來長得都不一樣：
//   ① 直書字型（Identity-V）：一整段由上往下（dir = 'ttb'）
//   ② Word 的旋轉寫法：整段文字順時針轉 90 度
//   ③ 瀏覽器列印：每個中文字各自一段「水平」的小片段，上下疊起來
// ③ 要靠「離上下鄰居比較近、還是離左右鄰居比較近」來判斷。
import { L, boxMatrix, fontFor, pdfRect, rgb } from './core.js';
import { vpOf, removeTextIn } from './ops.js';
import { rgbOf } from './util.js';

const cache = new WeakMap();   // doc → { gen, pages: Map(頁 → 直行) }

/** 一頁的直行：[{ x, y, w, h, cx, size, text }]（顯示座標，左上原點） */
export async function columns(doc, i) {
  let c = cache.get(doc);
  if (!c || c.gen !== doc.gen) { c = { gen: doc.gen, pages: new Map() }; cache.set(doc, c); }
  if (!c.pages.has(i)) c.pages.set(i, await detect(doc, i));
  const ocr = (doc.ocr && doc.ocr.get(i) || []).filter(l => l.vertical);
  return [...c.pages.get(i), ...ocr];
}

/** 點到的位置所在的直行；沒有回傳 null */
export async function columnAt(doc, i, x, y) {
  const cols = await columns(doc, i);
  return cols.find(c => x >= c.x - 3 && x <= c.x + c.w + 3 && y >= c.y - 3 && y <= c.y + c.h + 3) || null;
}

async function detect(doc, i) {
  const page = await doc.pdf.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const U = window.pdfjsLib.Util;
  const hItems = [], vRuns = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = U.transform(vp.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 1) continue;
    const st = tc.styles[it.fontName] || {};
    const asc = st.ascent || 0.85, desc = st.descent || -0.2;
    const n = Math.hypot(tx[0], tx[1]), ax = tx[0] / n, ay = tx[1] / n;
    if (st.vertical || it.dir === 'ttb') {
      if (Math.abs(ay) > 0.05) continue;
      const len = it.height || size * [...it.str].length;
      vRuns.push({ cx: tx[4], top: tx[5], bottom: tx[5] + len, thick: size, size, text: it.str });
    } else if (Math.abs(ay) < 0.02 && ax > 0) {
      hItems.push({ x: tx[4], baseline: tx[5], w: it.width || 0, size, asc, desc, text: it.str });
    } else if (Math.abs(ax) < 0.02 && ay > 0) {
      const e1 = tx[4] + tx[2] * asc, e2 = tx[4] + tx[2] * desc;
      vRuns.push({ cx: (e1 + e2) / 2, top: tx[5], bottom: tx[5] + (it.width || 0), thick: Math.abs(e1 - e2), size, text: it.str });
    }
  }
  // ③ 一個字一段的水平片段：上下鄰居比左右鄰居近 → 其實是直書
  const isCjk = t => /^[⺀-鿿豈-﫿︐-﹏＀-￯　-〿]$/.test(t);
  const box = q => ({ cx: q.x + q.w / 2, top: q.baseline - q.size * q.asc, bottom: q.baseline - q.size * q.desc });
  const singles = hItems.filter(q => isCjk(q.text.trim()));
  if (singles.length >= 2) {
    const boxes = new Map(hItems.map(q => [q, box(q)]));
    for (const c of singles) {
      const b = boxes.get(c);
      let gapV = Infinity, gapH = Infinity;
      for (const q of hItems) {
        if (q === c || Math.abs(q.size - c.size) > c.size * 0.3) continue;
        const qb = boxes.get(q);
        if (Math.abs(qb.cx - b.cx) < c.size * 0.35 && q.w < c.size * 1.6) {
          const gap = qb.top >= b.top ? qb.top - b.bottom : b.top - qb.bottom;
          if (gap > -c.size * 0.5) gapV = Math.min(gapV, Math.max(0, gap));
        }
        if (Math.abs(q.baseline - c.baseline) < c.size * 0.3) {
          const gap = q.x >= c.x ? q.x - (c.x + c.w) : c.x - (q.x + q.w);
          if (gap > -c.size * 0.5) gapH = Math.min(gapH, Math.max(0, gap));
        }
      }
      for (const r of vRuns) if (Math.abs(r.cx - b.cx) < c.size * 0.4) {
        const gap = r.top >= b.top ? r.top - b.bottom : b.top - r.bottom;
        if (gap > -c.size * 0.5) gapV = Math.min(gapV, Math.max(0, gap));
      }
      if (gapV < c.size * 0.6 && gapV + c.size * 0.1 < gapH) vRuns.push({ cx: b.cx, top: b.top, bottom: b.bottom, thick: b.bottom - b.top, size: c.size, text: c.text });
    }
  }
  // 直向片段由上往下接成直行
  vRuns.sort((a, b) => a.top - b.top);
  const cols = [];
  for (const r of vRuns) {
    let best = null, bestGap = Infinity;
    for (const c of cols) {
      if (Math.abs(c.cx - r.cx) > r.size * 0.4 || Math.abs(c.size - r.size) > r.size * 0.3) continue;
      const gap = r.top - c.bottom;
      if (gap < -r.size * 0.3 || gap > r.size * 1.2) continue;
      if (gap < bestGap) { best = c; bestGap = gap; }
    }
    if (best) {
      if (bestGap > r.size * 0.25 && (/[A-Za-z0-9]$/.test(best.text) || /^[A-Za-z0-9]/.test(r.text)) && !/\s$/.test(best.text)) best.text += ' ';
      best.text += r.text;
      best.bottom = Math.max(best.bottom, r.bottom);
      best.n++;
    } else cols.push({ ...r, n: 1 });
  }
  return cols.filter(c => c.n >= 2 || [...c.text.trim()].length >= 2).map(c => ({
    x: c.cx - c.thick / 2, y: c.top, w: c.thick, h: c.bottom - c.top, cx: c.cx, size: Math.round(c.size * 10) / 10, text: normalize(c.text).trim(),
  })).filter(c => c.text);
}

/** 康熙部首、部首補充這類「長得一樣但字碼不同」的字換回一般漢字 */
const RADICALS = { '⺟': '母', '⺠': '民', '⻁': '虎', '⻄': '西', '⻑': '長', '⻘': '青', '⻝': '食', '⻣': '骨', '⻤': '鬼' };
export const normalize = s => String(s).replace(/[⺀-⻿⼀-⿟]/g, ch => RADICALS[ch] || ch.normalize('NFKC'));

// ---------------------------------------------------------------- 寫回 PDF

const ASC = 871 / 1024, DESC = 153 / 1024;   // 粉圓字型的字身：基線以上 / 以下
const UPRIGHT = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︐-︟︰-﹏！-｠￠-￦①-⓿■-➿]|[\uD840-\uD87F][\uDC00-\uDFFF]/;
const FORMS = { '（': '︵', '）': '︶', '｛': '︷', '｝': '︸', '〔': '︹', '〕': '︺', '【': '︻', '】': '︼', '《': '︽', '》': '︾', '〈': '︿', '〉': '﹀', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄', '［': '﹇', '］': '﹈' };
/** 粉圓字型有沒有這些字（pdf-lib 遇到缺字不會報錯，只會畫成空白方塊，所以直接問字型） */
const canEncode = (f, s) => {
  const fk = f && f.embedder && f.embedder.font;
  if (fk && fk.hasGlyphForCodePoint) return [...s].every(ch => fk.hasGlyphForCodePoint(ch.codePointAt(0)));
  try { f.encodeText(s); return true; } catch { return false; }
};

/**
 * 修改一個直行：先刪掉原本的字（刪不到就用背景色蓋住），再從原位置往下寫新的直書文字。
 * 換行＝往左開新的一行；太長會在頁面下緣自動換到左邊一行。st: {size, color, bold}
 */
export async function replaceVertical(d, i, col, text, st, bg) {
  const page = d.getPage(i), vp = vpOf(page);
  const cover = { x: col.x - 1.5, y: col.y - 1.5, w: col.w + 3, h: col.h + 3 };
  const removed = removeTextIn(d, i, pdfRect(vp, cover));
  if (!removed || col.ocr) {
    page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...boxMatrix(vp, cover)));
    page.drawRectangle({ x: 0, y: 0, width: cover.w, height: cover.h, color: rgb(rgbOf(bg || '#ffffff')) });
    page.pushOperators(L.popGraphicsState());
  }
  if (!text.trim()) return;
  await writeVertical(d, i, col.cx, col.y, Math.max(col.h, vp.height - 18 - col.y), text, st);
}

/** 從 (cx, top)（第一個字的中心線與上緣，顯示座標）開始寫直書文字 */
export async function writeVertical(d, i, cx, top, maxH, text, st) {
  const page = d.getPage(i), vp = vpOf(page);
  const { font } = await fontFor(d, '中文', 0, false);    // 直書一律用粉圓字型
  const size = st.size || 12, pitch = size * 1.3, H = vp.height;
  const color = rgb(rgbOf(st.color || '#000000'));
  page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...boxMatrix(vp, { x: 0, y: 0, w: vp.width, h: H })));
  if (st.bold) page.pushOperators(L.setTextRenderingMode(L.TextRenderingMode.FillAndOutline), L.setLineWidth(size * 0.035), L.setStrokingRgbColor(...rgbOf(st.color || '#000000')));
  let x = cx, y = top, run = '';
  const flush = () => {
    if (!run) return;
    const r = [...run].filter(ch => canEncode(font, ch)).join('');
    run = '';
    if (!r) return;
    const len = font.widthOfTextAtSize(r, size);
    if (y + len > top + maxH && y > top) { x -= pitch; y = top; }
    // 順時針轉 90 度：字的前進方向朝下、字頭朝右；字身置中在中心線上
    page.drawText(r, { x: x - size * (ASC - DESC) / 2, y: H - y, size, font, color, rotate: L.degrees(-90) });
    y += len;
  };
  for (const ch of text) {
    if (ch === '\n') { flush(); x -= pitch; y = top; continue; }
    if (!UPRIGHT.test(ch) || (FORMS[ch] && !canEncode(font, FORMS[ch])) || /[ー〜～－＝｜]/.test(ch)) { if (ch !== ' ' || run) run += ch; continue; }
    flush();
    if (y + size > top + maxH && y > top) { x -= pitch; y = top; }
    const g = FORMS[ch] && canEncode(font, FORMS[ch]) ? FORMS[ch] : ch;
    if (canEncode(font, g)) {
      const adv = font.widthOfTextAtSize(g, size);
      page.drawText(g, { x: x - adv / 2, y: H - (y + size * ASC), size, font, color });
    }
    y += size;
  }
  flush();
  if (st.bold) page.pushOperators(L.setTextRenderingMode(L.TextRenderingMode.Fill));
  page.pushOperators(L.popGraphicsState());
}
