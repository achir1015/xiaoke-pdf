// =====================================================================
// PDF 繪製器（PdfRenderer）——用 pdf.js 把頁面畫到畫布上，並讀出頁面上的文字位置
//
// 比喻：pdf.js 是「印表機」，負責把底稿印到螢幕上；
// 它也是「掃描器」，告訴我們每一行字在頁面的哪裡（「編輯原文字」要用）。
// =====================================================================
import { pdfjs } from './libs.js';
import { PageGeometry } from '../domain/page.js';
import { normalizeCjk } from './util.js';

const PDFJS_BASE = import.meta.resolve('pdfjs-dist/');

export class PdfRenderer {
  constructor() {
    this.doc = null;
    this._pages = new Map();
    this._text = new Map();
  }

  get pageCount() { return this.doc ? this.doc.numPages : 0; }

  /** 開啟一份 PDF（pdf.js 會把傳進去的緩衝區轉移走，所以傳副本） */
  async open(bytes, password) {
    await this.close();
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      password,
      cMapUrl: PDFJS_BASE + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDFJS_BASE + 'standard_fonts/',
      wasmUrl: PDFJS_BASE + 'wasm/',
      iccUrl: PDFJS_BASE + 'iccs/',
      isEvalSupported: false,
    });
    this.task = task;
    this.doc = await task.promise;
    return this.doc;
  }

  async close() {
    this._pages.clear();
    this._text.clear();
    // pdf.js 新版只有「載入工作」能 destroy（舊版文件物件本身也有）
    const task = this.task, doc = this.doc;
    this.task = null; this.doc = null;
    try {
      if (task?.destroy) await task.destroy();
      else if (doc?.destroy) await doc.destroy();
    } catch (e) { /* 關閉失敗不影響開新檔 */ }
  }

  async page(i) {
    if (!this._pages.has(i)) this._pages.set(i, this.doc.getPage(i + 1));
    return this._pages.get(i);
  }

  /** 所有頁面的幾何資訊（顯示尺寸、旋轉、座標轉換） */
  async geometries() {
    const out = [];
    for (let i = 0; i < this.pageCount; i++) {
      const p = await this.page(i);
      out.push(PageGeometry.fromViewport(i, p.getViewport({ scale: 1 })));
    }
    return out;
  }

  /** 畫一頁到畫布。scale＝每 pt 幾個畫面像素 */
  async render(i, canvas, scale) {
    const p = await this.page(i);
    const vp = p.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const task = p.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE });
    canvas._task = task;
    await task.promise;
  }

  /**
   * 頁面上的文字「行」（顯示座標）：
   *   橫書：{ x, y, w, h, size, baseline, text, parts }
   *   直書：{ vertical: true, x, y, w, h, size, cx, baseline(=上緣), text, parts }
   *
   * 比喻：把散落的「字片段」拼回一行一行（或一直行一直行）。
   * 直書的 PDF 常見三種寫法，pdf.js 讀出來長得都不一樣：
   *   ① 直書字型（Identity-V）：一整段由上往下（dir = 'ttb'）
   *   ② Word 的旋轉寫法：整段文字順時針轉 90 度
   *   ③ 瀏覽器列印：每個中文字各自一段「水平」的小片段，上下疊起來
   * ③ 要靠「離上下鄰居比較近、還是離左右鄰居比較近」來判斷。
   */
  async textLines(i) {
    if (this._text.has(i)) return this._text.get(i);
    const p = await this.page(i);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    const hItems = [];    // 橫向片段
    const vRuns = [];     // 直向片段：{ cx, top, bottom, thick, size, text }
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = pdfjs.Util.transform(vp.transform, it.transform);
      const size = Math.hypot(tx[2], tx[3]);
      if (size < 1) continue;
      const st = tc.styles[it.fontName] || {};
      const asc = st.ascent || 0.85, desc = st.descent || -0.2;
      const ax = tx[0] / Math.hypot(tx[0], tx[1]), ay = tx[1] / Math.hypot(tx[0], tx[1]);   // 文字前進方向
      const text = it.str;
      if (st.vertical || it.dir === 'ttb') {
        // ① 直書字型：起點是第一個字的「上緣中央」，字往下排
        if (Math.abs(ay) > 0.05) continue;
        const len = it.height || size * [...text].length;
        vRuns.push({ cx: tx[4], top: tx[5], bottom: tx[5] + len, thick: size, size, text });
      } else if (Math.abs(ay) < 0.02 && ax > 0) {
        hItems.push({ x: tx[4], baseline: tx[5], w: it.width || 0, size, asc, desc, text });
      } else if (Math.abs(ax) < 0.02 && ay > 0) {
        // ② 旋轉 90 度的文字：基線是一條直線，字身往「字的上方」那一側長
        const e1 = tx[4] + tx[2] * asc, e2 = tx[4] + tx[2] * desc;
        vRuns.push({ cx: (e1 + e2) / 2, top: tx[5], bottom: tx[5] + (it.width || 0), thick: Math.abs(e1 - e2), size, text });
      }
      // 其他角度（斜放的浮水印等）不處理
    }

    // ③ 一個字一段的水平片段：上下鄰居比左右鄰居近 → 其實是直書
    const isCjk = (t) => /^[⺀-鿿豈-﫿︐-﹏＀-￯　-〿]$/.test(t);
    const box = (q) => ({ cx: q.x + q.w / 2, top: q.baseline - q.size * q.asc, bottom: q.baseline - q.size * q.desc });
    const singles = hItems.filter(q => isCjk(q.text.trim()));
    if (singles.length >= 2) {
      const boxes = new Map(hItems.map(q => [q, box(q)]));
      const toVertical = new Set();
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
        for (const r of vRuns) {       // 旁邊有旋轉的英數字片段（瀏覽器列印的數字）
          if (Math.abs(r.cx - b.cx) < c.size * 0.4) {
            const gap = r.top >= b.top ? r.top - b.bottom : b.top - r.bottom;
            if (gap > -c.size * 0.5) gapV = Math.min(gapV, Math.max(0, gap));
          }
        }
        if (gapV < c.size * 0.6 && gapV + c.size * 0.1 < gapH) toVertical.add(c);
      }
      for (const c of toVertical) {
        const b = boxes.get(c);
        vRuns.push({ cx: b.cx, top: b.top, bottom: b.bottom, thick: b.bottom - b.top, size: c.size, text: c.text });
      }
      if (toVertical.size) for (let k = hItems.length - 1; k >= 0; k--) if (toVertical.has(hItems[k])) hItems.splice(k, 1);
    }

    // 橫向片段 → 橫行
    hItems.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
    const lines = [];
    for (const it of hItems) {
      const last = lines[lines.length - 1];
      const sameLine = last && Math.abs(last.baseline - it.baseline) < it.size * 0.3 && Math.abs(last.size - it.size) < it.size * 0.4
        && it.x - (last.x + last.w) < it.size * 1.2 && it.x > last.x - 1;
      if (sameLine) {
        const gap = it.x - (last.x + last.w);
        if (gap > it.size * 0.2 && !/\s$/.test(last.text) && !/^\s/.test(it.text)) last.text += ' ';
        last.text += it.text;
        last.parts.push({ x: it.x, w: it.w, text: it.text });
        last.w = Math.max(last.w, it.x + it.w - last.x);
        last.asc = Math.max(last.asc, it.asc); last.desc = Math.min(last.desc, it.desc);
      } else {
        lines.push({ ...it, parts: [{ x: it.x, w: it.w, text: it.text }] });
      }
    }
    const out = lines.map(l => ({
      x: l.x, y: l.baseline - l.size * l.asc, w: l.w, h: l.size * (l.asc - l.desc),
      size: l.size, baseline: l.baseline, text: normalizeCjk(l.text).replace(/\s+$/, ''),
      // 組成這行的片段（表格裡跨格的片段之後會依框線拆開）
      parts: l.parts.map(q => ({ ...q, text: normalizeCjk(q.text) })),
    }));

    // 直向片段 → 直行（由上往下接起來）
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
        const latinJoin = /[A-Za-z0-9]$/.test(best.text) || /^[A-Za-z0-9]/.test(r.text);
        if (bestGap > r.size * 0.25 && latinJoin && !/\s$/.test(best.text)) best.text += ' ';
        best.text += r.text;
        best.bottom = Math.max(best.bottom, r.bottom);
        if (r.thick > best.thick && isCjk(r.text.trim().slice(0, 1))) { best.cx = r.cx; best.thick = r.thick; }
      } else cols.push({ ...r });
    }
    cols.sort((a, b) => b.cx - a.cx || a.top - b.top);     // 直書由右往左
    for (const c of cols) {
      const text = normalizeCjk(c.text).trim();
      if (!text) continue;
      out.push({
        vertical: true, x: c.cx - c.thick / 2, y: c.top, w: c.thick, h: c.bottom - c.top,
        size: c.size, cx: c.cx, baseline: c.top, text, parts: [{ x: c.cx - c.thick / 2, w: c.thick, text }],
      });
    }
    this._text.set(i, out);
    return out;
  }

  /** 猜浮水印文字：每頁重複出現、或是斜放的字 */
  async watermarkTextCandidates() {
    const n = this.pageCount;
    const pageHits = new Map();
    const rotated = new Map();
    for (let i = 0; i < Math.min(n, 60); i++) {
      const p = await this.page(i);
      const tc = await p.getTextContent();
      const seen = new Set();
      for (const it of tc.items) {
        const s = normalizeCjk(it.str || '').trim();
        if (s.length < 2 || s.length > 40) continue;
        const [a, b] = it.transform;
        const ang = Math.abs((Math.atan2(b, a) * 180) / Math.PI) % 90;
        if (ang > 8 && ang < 82) rotated.set(s, (rotated.get(s) || 0) + 1);
        if (!seen.has(s)) { seen.add(s); pageHits.set(s, (pageHits.get(s) || 0) + 1); }
      }
    }
    const scanned = Math.min(n, 60);
    const out = [];
    for (const [s, c] of rotated) out.push({ text: s, reason: '斜放的文字', score: 100 + c });
    if (scanned >= 2) {
      for (const [s, c] of pageHits) {
        // 每頁都出現的「短」文字才像浮水印（長句子多半是頁首頁尾）
        if (c >= Math.max(2, Math.ceil(scanned * 0.6)) && s.length <= 16 && !/^\d+$/.test(s) && !rotated.has(s)) out.push({ text: s, reason: `${c} 頁都出現`, score: c });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6);
  }
}
