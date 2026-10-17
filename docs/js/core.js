// PDF 核心：pdf.js（繪製、文字）、pdf-lib（編輯）、字型、座標、內容串流解析
const pdfjsLib = window.pdfjsLib;
export const L = window.PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';

export const PDFJS_OPTS = {
  cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,
  standardFontDataUrl: 'vendor/pdfjs/standard_fonts/', isEvalSupported: false,
};

/** 用 pdf.js 開啟（password 可為 undefined）。密碼錯誤時丟出 {needPassword, wrong}。 */
export async function openPdfjs(bytes, password) {
  const task = pdfjsLib.getDocument({ ...PDFJS_OPTS, data: bytes.slice(0), password });
  try { return await task.promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw { needPassword: true, wrong: e.code === 2 };
    throw e;
  }
}

export async function loadLib(bytes, password) {
  const opts = { updateMetadata: false, throwOnInvalidObject: false };
  if (password != null) opts.password = password;
  const d = await L.PDFDocument.load(bytes, opts);
  d.registerFontkit(window.fontkit);
  return d;
}

// ---------------------------------------------------------------- 字型

let huninnBytes = null;
export async function huninn() {
  if (!huninnBytes) huninnBytes = await (await fetch('fonts/jf-openhuninn-2.1.ttf')).arrayBuffer();
  return huninnBytes;
}

let huninnFace = null;
/** 預覽用的網頁字型 */
export async function loadHuninnFace() {
  if (huninnFace) return huninnFace;
  try {
    huninnFace = new FontFace('XiaoKeHuninn', `url(fonts/jf-openhuninn-2.1.ttf)`);
    await huninnFace.load();
    document.fonts.add(huninnFace);
  } catch { huninnFace = { failed: true }; }
  return huninnFace;
}

// 標準字型（WinAnsi）能寫的字元
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const isStandard = font => !!(font && font.embedder && font.embedder.font && font.embedder.font.FontName) || /^(Helvetica|Times|Courier|Symbol|ZapfDingbats)/.test(font && font.name || '');

export function canEncode(font, text) {
  const t = text.replace(/\n/g, '');
  if (isStandard(font)) {
    for (const ch of t) { const c = ch.codePointAt(0); if (!(c >= 0x20 && c <= 0x7E) && !(c >= 0xA0 && c <= 0xFF) && !WINANSI_EXTRA.includes(ch)) return false; }
    return true;
  }
  try { font.encodeText(t); font.widthOfTextAtSize(t, 10); return true; } catch { return false; }
}

const STD = {
  0: [L.StandardFonts.Helvetica, L.StandardFonts.HelveticaBold],
  1: [L.StandardFonts.TimesRoman, L.StandardFonts.TimesRomanBold],
  2: [L.StandardFonts.Courier, L.StandardFonts.CourierBold],
};

/** 依文字挑字型：英數字用標準字型（有真粗體），含中文用內建粉圓（嵌入子集，可搜尋）。 */
export async function fontFor(pdfDoc, text, family = 0, bold = false) {
  const cache = pdfDoc.__xkFonts || (pdfDoc.__xkFonts = {});
  const key = family + ':' + (bold ? 1 : 0);
  if (!cache[key]) cache[key] = await pdfDoc.embedFont(STD[family][bold ? 1 : 0]);
  if (canEncode(cache[key], text)) return { font: cache[key], nativeBold: bold };
  if (!cache.cjk) cache.cjk = await pdfDoc.embedFont(await huninn(), { subset: true });
  return { font: cache.cjk, nativeBold: false };
}

// ---------------------------------------------------------------- 座標

/** 頁面的基準檢視（比例 1、只套用頁面自己的 /Rotate）：「顯示座標」，左上原點，單位 pt。 */
export function baseViewport(page) { return page.getViewport({ scale: 1 }); }

/** 顯示座標的矩形（左上原點）→ 方框座標（左下原點、向上）到 PDF 使用者座標的矩陣 [a,b,c,d,e,f]。 */
export function boxMatrix(vp, r, off = [0, 0]) {
  const o = vp.convertToPdfPoint(r.x, r.y + r.h);
  const ax = vp.convertToPdfPoint(r.x + 1, r.y + r.h);
  const ay = vp.convertToPdfPoint(r.x, r.y + r.h - 1);
  return [ax[0] - o[0], ax[1] - o[1], ay[0] - o[0], ay[1] - o[1], o[0] - off[0], o[1] - off[1]];
}

/** 顯示座標的矩形 → PDF 矩形 [x1,y1,x2,y2]（正規化）。 */
export function pdfRect(vp, r) {
  const a = vp.convertToPdfPoint(r.x, r.y), b = vp.convertToPdfPoint(r.x + r.w, r.y + r.h);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** PDF 矩形 → 顯示座標矩形 */
export function dispRect(vp, rect) {
  const [x1, y1, x2, y2] = vp.convertToViewportRectangle(rect);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export const rgb = c => L.rgb(c[0], c[1], c[2]);

// ---------------------------------------------------------------- 內容串流解析（移除浮水印用）

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/** 把內容串流切成 token：{k:'op'|'num'|'name'|'str'|'hex'|'arr'|'dict'|'kw', raw, v} */
export function tokenize(bytes) {
  const s = typeof bytes === 'string' ? bytes : latin1(bytes);
  let i = 0;
  const n = s.length;
  function skip() {
    for (;;) {
      while (i < n && WS.has(s.charCodeAt(i))) i++;
      if (s[i] === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      break;
    }
  }
  function obj() {
    skip();
    if (i >= n) return null;
    const st = i, c = s[i];
    if (c === '(') {
      let depth = 0;
      for (; i < n; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      }
      const raw = s.slice(st, i);
      return { k: 'str', raw, v: unescapeLiteral(raw.slice(1, -1)) };
    }
    if (c === '<' && s[i + 1] === '<') {
      i += 2;
      const d = {};
      for (;;) {
        skip();
        if (s[i] === '>' && s[i + 1] === '>') { i += 2; break; }
        if (i >= n) break;
        const key = obj(); const val = obj();
        if (!key) break;
        d[key.v] = val;
      }
      return { k: 'dict', raw: s.slice(st, i), v: d };
    }
    if (c === '<') {
      const e = s.indexOf('>', i);
      const h = s.slice(i + 1, e).replace(/\s/g, '');
      i = e + 1;
      const b = [];
      for (let j = 0; j < h.length; j += 2) b.push(parseInt((h[j] + (h[j + 1] || '0')), 16));
      return { k: 'hex', raw: s.slice(st, i), v: String.fromCharCode(...b) };
    }
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) { skip(); if (s[i] === ']') { i++; break; } if (i >= n) break; const o = obj(); if (!o) break; arr.push(o); }
      return { k: 'arr', raw: s.slice(st, i), v: arr };
    }
    if (c === '/') {
      i++;
      while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
      return { k: 'name', raw: s.slice(st, i), v: s.slice(st + 1, i).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
    if (i === st) { i++; return { k: 'kw', raw: s[st], v: s[st] }; }
    const w = s.slice(st, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { k: 'num', raw: w, v: parseFloat(w) };
    return { k: 'op', raw: w, v: w };
  }
  const out = [];
  for (;;) {
    const t = obj();
    if (!t) break;
    out.push(t);
    if (t.k === 'op' && t.v === 'ID') {
      // 內嵌影像：資料到 EI 為止
      const st = i + 1;
      let e = st;
      for (;;) {
        e = s.indexOf('EI', e);
        if (e < 0) { e = n; break; }
        if (WS.has(s.charCodeAt(e - 1)) && (e + 2 >= n || WS.has(s.charCodeAt(e + 2)))) break;
        e += 2;
      }
      out.push({ k: 'data', raw: s.slice(st, e), v: null });
      i = e;
    }
  }
  return out;
}

export function serialize(tokens) {
  let s = '';
  for (const t of tokens) {
    if (t.k === 'data') { s += '\n' + t.raw; continue; }
    s += t.raw + (t.k === 'op' ? '\n' : ' ');
  }
  return fromLatin1(s);
}

function unescapeLiteral(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { o += c; continue; }
    const d = s[++i];
    if (d === 'n') o += '\n'; else if (d === 'r') o += '\r'; else if (d === 't') o += '\t'; else if (d === 'b') o += '\b'; else if (d === 'f') o += '\f';
    else if (d === '\r' || d === '\n') { if (d === '\r' && s[i + 1] === '\n') i++; }
    else if (/[0-7]/.test(d)) { let oct = d; while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i]; o += String.fromCharCode(parseInt(oct, 8) & 255); }
    else o += d;
  }
  return o;
}

export function latin1(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return s;
}
export function fromLatin1(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

// ---------------------------------------------------------------- ToUnicode（含最後一個位元組進位）

export function parseToUnicode(text) {
  const map = new Map();
  let twoByte = false;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (cs && /<[0-9a-f]{4}>/i.test(cs[1])) twoByte = true;
  const toStr = h => {
    let o = '';
    for (let j = 0; j + 4 <= h.length; j += 4) o += String.fromCharCode(parseInt(h.substr(j, 4), 16));
    if (h.length === 2) o = String.fromCharCode(parseInt(h, 16));
    return o;
  };
  for (const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of b[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) { map.set(parseInt(m[1], 16), toStr(m[2])); if (m[1].length >= 4) twoByte = true; }
  for (const b of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of b[1].matchAll(/<([0-9a-f]+)>[ \t]*<([0-9a-f]+)>[ \t]*(<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
      const a = parseInt(m[1], 16), z = parseInt(m[2], 16);
      if (m[1].length >= 4) twoByte = true;
      if (z < a || z - a > 65535) continue;
      if (m[4] != null) {
        const base = m[4];
        if (base.length <= 4) { const v = parseInt(base, 16); for (let c = a; c <= z; c++) map.set(c, String.fromCharCode(v + c - a)); }
        else { const v = parseInt(base.slice(-4), 16), pre = toStr(base.slice(0, -4)); for (let c = a; c <= z; c++) map.set(c, pre + String.fromCharCode(v + c - a)); }
      } else {
        const items = [...m[5].matchAll(/<([0-9a-f]*)>/gi)].map(x => toStr(x[1]));
        for (let c = a; c <= z && c - a < items.length; c++) map.set(c, items[c - a]);
      }
    }
  }
  return { map, twoByte };
}

/** 從 pdf-lib 的字型字典建立解碼器：bytes(latin1 字串) → 文字 */
export function fontDecoder(ctx, fontDict) {
  let map = null, two = false;
  try {
    const sub = fontDict.get(L.PDFName.of('Subtype'));
    two = sub && sub.asString() === '/Type0';
    const tu = fontDict.lookup(L.PDFName.of('ToUnicode'));
    if (tu) {
      const bytes = streamBytes(tu);
      const r = parseToUnicode(latin1(bytes));
      map = r.map;
      if (!two) two = r.twoByte && !(sub && sub.asString() !== '/Type0');
    }
  } catch {}
  return s => {
    let o = '';
    if (two) for (let i = 0; i + 1 < s.length; i += 2) { const c = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1); o += map && map.has(c) ? map.get(c) : ''; }
    else for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o += map && map.has(c) ? map.get(c) : s[i]; }
    return o;
  };
}

export function streamBytes(stream) {
  try { return L.decodePDFRawStream(stream).decode(); }
  catch { return stream.getContents ? stream.getContents() : new Uint8Array(); }
}

/** 頁面的內容串流（可能是陣列）合併成一個 bytes */
export function pageContent(page) {
  const c = page.node.Contents();
  if (!c) return new Uint8Array();
  const parts = [];
  if (c instanceof L.PDFArray) { for (let i = 0; i < c.size(); i++) { const s = c.lookup(i); if (s) parts.push(streamBytes(s)); } }
  else parts.push(streamBytes(c));
  const len = parts.reduce((a, b) => a + b.length + 1, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

export function setPageContent(pdfDoc, page, bytes) {
  const stream = pdfDoc.context.flateStream(bytes);
  page.node.set(L.PDFName.of('Contents'), pdfDoc.context.register(stream));
}

export const N = s => L.PDFName.of(s);
export const T = s => L.PDFHexString.fromText(s);
export const D = d => L.PDFString.fromDate(d || new Date());

/** 與 pdf.js PageViewport 相同的座標轉換（pdf.js 3.x 沒有公開這個類別） */
export class Viewport {
  constructor({ viewBox, scale = 1, rotation = 0, offsetX = 0, offsetY = 0, dontFlip = false }) {
    this.viewBox = viewBox; this.scale = scale;
    rotation %= 360; if (rotation < 0) rotation += 360;
    this.rotation = rotation;
    const cx = (viewBox[2] + viewBox[0]) / 2, cy = (viewBox[3] + viewBox[1]) / 2;
    let a, b, c, d;
    switch (rotation) {
      case 180: a = -1; b = 0; c = 0; d = 1; break;
      case 90: a = 0; b = 1; c = 1; d = 0; break;
      case 270: a = 0; b = -1; c = -1; d = 0; break;
      default: a = 1; b = 0; c = 0; d = -1;
    }
    if (dontFlip) { c = -c; d = -d; }
    let ox, oy, w, h;
    if (a === 0) { ox = Math.abs(cy - viewBox[1]) * scale + offsetX; oy = Math.abs(cx - viewBox[0]) * scale + offsetY; w = (viewBox[3] - viewBox[1]) * scale; h = (viewBox[2] - viewBox[0]) * scale; }
    else { ox = Math.abs(cx - viewBox[0]) * scale + offsetX; oy = Math.abs(cy - viewBox[1]) * scale + offsetY; w = (viewBox[2] - viewBox[0]) * scale; h = (viewBox[3] - viewBox[1]) * scale; }
    this.transform = [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
    this.width = w; this.height = h;
  }
  convertToViewportPoint(x, y) { const m = this.transform; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  convertToViewportRectangle(r) { const p = this.convertToViewportPoint(r[0], r[1]), q = this.convertToViewportPoint(r[2], r[3]); return [p[0], p[1], q[0], q[1]]; }
  convertToPdfPoint(x, y) {
    const m = this.transform, d = m[0] * m[3] - m[1] * m[2];
    return [(x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / d, (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / d];
  }
}
