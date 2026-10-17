// 所有用 pdf-lib 改文件的動作。座標參數用「基準顯示座標」（pt，左上原點，頁面本身的旋轉）
import { L, N, T, D, boxMatrix, pdfRect, fontFor, rgb, huninn, loadLib, openPdfjs, latin1, Viewport, tokenize, serialize, pageContent, setPageContent } from './core.js';
import { rgbOf, prefs, today, base as baseName } from './util.js';

const pdfjsLib = window.pdfjsLib;
const { PDFName, PDFArray, PDFNumber, PDFDict, PDFRef, PDFHexString, PDFString, PDFOperator, degrees } = L;
const op = (name, ...args) => PDFOperator.of(name, args.map(a => typeof a === 'number' ? PDFNumber.of(a) : a));

export const author = () => prefs.get('author', '小柯');

/** pdf-lib 頁面的基準 viewport（與 pdf.js 一致） */
export function vpOf(page) {
  const c = page.getCropBox(), m = page.getMediaBox();
  const x1 = Math.max(c.x, m.x), y1 = Math.max(c.y, m.y), x2 = Math.min(c.x + c.width, m.x + m.width), y2 = Math.min(c.y + c.height, m.y + m.height);
  const view = x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : [m.x, m.y, m.x + m.width, m.y + m.height];
  return new Viewport({ viewBox: view, scale: 1, rotation: ((page.getRotation().angle % 360) + 360) % 360, offsetX: 0, offsetY: 0 });
}

const box = (page, r) => boxMatrix(vpOf(page), r);
function inBox(page, r, draw) {
  page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...box(page, r)));
  draw();
  page.pushOperators(L.popGraphicsState());
}

// ================================================================ 頁面

export function rotate(d, sel, deg) { for (const i of sel) { const p = d.getPage(i); p.setRotation(degrees(((p.getRotation().angle + deg) % 360 + 360) % 360)); } }

export function removePages(d, sel) {
  if (sel.length >= d.getPageCount()) throw new Error('不能刪除全部頁面');
  for (const i of [...sel].sort((a, b) => b - a)) d.removePage(i);
}

/** 用新的順序重建頁面樹（扁平）。先把從父節點繼承的屬性寫進每一頁，重排後才不會遺失。 */
export function reorder(d, order) {
  const pages = d.getPages();
  const rootRef = d.catalog.get(N('Pages'));
  const root = d.context.lookup(rootRef);
  for (const p of pages) {
    for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      if (p.node.get(N(k))) continue;
      const v = p.node.getInheritableAttribute ? p.node.getInheritableAttribute(N(k)) : null;
      if (v) p.node.set(N(k), v);
    }
  }
  const kids = d.context.obj(order.map(k => pages[k].ref));
  for (const k of order) pages[k].node.set(N('Parent'), rootRef);
  root.set(N('Kids'), kids);
  root.set(N('Count'), PDFNumber.of(order.length));
  for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) root.delete(N(k));
  // pdf-lib 的頁面快取要重建
  try { d.pageCache && d.pageCache.invalidate && d.pageCache.invalidate(); } catch {}
}

export function move(d, sel, delta) {
  const n = d.getPageCount();
  const idx = [...Array(n).keys()];
  const s = new Set(sel);
  if (delta < 0) { for (let i = 1; i < n; i++) if (s.has(idx[i]) && !s.has(idx[i - 1])) [idx[i - 1], idx[i]] = [idx[i], idx[i - 1]]; }
  else for (let i = n - 2; i >= 0; i--) if (s.has(idx[i]) && !s.has(idx[i + 1])) [idx[i + 1], idx[i]] = [idx[i], idx[i + 1]];
  reorder(d, idx);
  return idx.map((k, j) => s.has(k) ? j : -1).filter(j => j >= 0);
}

export function moveTo(d, sel, at) {
  const n = d.getPageCount(), s = new Set(sel);
  const rest = [...Array(n).keys()].filter(i => !s.has(i));
  const before = sel.filter(i => i < at).length;
  const pos = Math.max(0, Math.min(at - before, rest.length));
  rest.splice(pos, 0, ...sel);
  reorder(d, rest);
}

export function reverse(d, sel) {
  const n = d.getPageCount(), idx = [...Array(n).keys()];
  const vals = sel.map(i => idx[i]).reverse();
  sel.forEach((i, k) => idx[i] = vals[k]);
  reorder(d, idx);
}

export function insertBlank(d, at, w, h, count = 1) { for (let k = 0; k < count; k++) d.insertPage(at + k, [w, h]); }

export async function insertFrom(d, at, bytes, password, pick) {
  const src = await loadLib(bytes, password);
  const idx = pick && pick.length ? pick : src.getPageIndices();
  const pages = await d.copyPages(src, idx);
  pages.forEach((p, k) => d.insertPage(at + k, p));
  return pages.length;
}

export function crop(d, sel, l, t, r, b) {
  for (const i of sel) {
    const p = d.getPage(i), vp = vpOf(p);
    const disp = { x: l, y: t, w: vp.width - l - r, h: vp.height - t - b };
    if (disp.w < 20 || disp.h < 20) throw new Error('裁切範圍太小');
    const [x1, y1, x2, y2] = pdfRect(vp, disp);
    p.setCropBox(x1, y1, x2 - x1, y2 - y1);
  }
}

/** 只留下這些頁面（另存新檔用），保留書籤中仍指向留下頁面的項目 */
export async function keepPages(bytes, keep) {
  const d = await loadLib(bytes);
  const tree = readOutline(d);
  const refs = d.getPages().map(p => p.ref);
  const k = new Set(keep);
  for (let i = d.getPageCount() - 1; i >= 0; i--) if (!k.has(i)) d.removePage(i);
  const map = new Map(); keep.forEach((o, j) => map.set(o, j));
  const prune = items => items.map(it => ({ ...it, page: map.has(it.page) ? map.get(it.page) : -1, kids: prune(it.kids) }))
    .filter(it => it.page >= 0 || it.kids.length);
  writeOutline(d, prune(tree));
  void refs;
  return await d.save();
}

/** 合併：每個檔案一個書籤，原本的書籤放在它底下 */
export async function merge(files) {
  const out = await L.PDFDocument.create();
  out.registerFontkit(window.fontkit);
  const tree = [];
  let offset = 0;
  for (const f of files) {
    const src = await loadLib(f.bytes, f.password);
    const t = readOutline(src);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
    const shift = items => items.map(it => ({ ...it, page: it.page >= 0 ? it.page + offset : -1, kids: shift(it.kids) }));
    tree.push({ title: f.title, page: offset, open: true, kids: shift(t) });
    offset += pages.length;
  }
  writeOutline(out, tree);
  return await out.save();
}

// ================================================================ 文字、圖片（寫入頁面內容）

export function wrap(font, text, size, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const ch of para) {
      const nx = cur + ch;
      if (maxW > 0 && cur && font.widthOfTextAtSize(nx, size) > maxW) {
        const sp = cur.lastIndexOf(' ');
        if (sp > 0 && !/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(ch)) { out.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; }
        else { out.push(cur); cur = ch; }
      } else cur = nx;
    }
    out.push(cur);
  }
  return out;
}

/**
 * 寫字（向量文字，可搜尋）。style: {family 0黑體/1明體/2等寬, size, color '#rrggbb', bg '#rrggbb'|null, bold, underline, strike}
 * r：基準顯示座標的方框（只用左上角與寬度）。回傳實際佔用的方框。
 */
export async function addText(d, i, r, text, st) {
  const page = d.getPage(i);
  const { font, nativeBold } = await fontFor(d, text, st.family || 0, !!st.bold);
  const size = st.size || 12;
  const maxW = r.w > 20 ? Math.max(r.w, size * 2) : 0;
  const lines = wrap(font, text, size, maxW);
  const lh = st.lineHeight || size * 1.25, H = lines.length * lh;
  const widths = lines.map(l => font.widthOfTextAtSize(l, size));
  const W = Math.max(...widths, 1);
  const b = { x: r.x, y: st.baseline != null ? st.baseline - size * 0.88 : r.y, w: W + 2, h: H };
  const fg = rgbOf(st.color || '#000000');
  inBox(page, b, () => {
    if (st.bg) page.drawRectangle({ x: -1, y: -size * 0.05, width: W + 4, height: H + size * 0.05, color: rgb(rgbOf(st.bg)) });
    if (st.bold && !nativeBold) page.pushOperators(L.setTextRenderingMode(L.TextRenderingMode.FillAndOutline), L.setLineWidth(size * 0.035), L.setStrokingRgbColor(...fg));
    lines.forEach((ln, k) => page.drawText(ln, { x: 1, y: H - size - k * lh + size * 0.12, size, font, color: rgb(fg) }));
    if (st.bold && !nativeBold) page.pushOperators(L.setTextRenderingMode(L.TextRenderingMode.Fill));
    lines.forEach((ln, k) => {
      const base = H - size - k * lh + size * 0.12, w = widths[k], th = Math.max(0.5, size * 0.06);
      if (st.underline) page.drawLine({ start: { x: 1, y: base - size * 0.12 }, end: { x: 1 + w, y: base - size * 0.12 }, thickness: th, color: rgb(fg) });
      if (st.strike) page.drawLine({ start: { x: 1, y: base + size * 0.3 }, end: { x: 1 + w, y: base + size * 0.3 }, thickness: th, color: rgb(fg) });
    });
  });
  return b;
}

/** 修改既有文字：用背景色蓋掉原字，再在同一位置寫新字 */
export async function replaceText(d, i, area, text, st, bg) {
  const page = d.getPage(i);
  const cover = { x: area.x - 1.2, y: area.y - 1.2, w: area.w + 2.4, h: area.h + 2.4 };
  inBox(page, cover, () => page.drawRectangle({ x: 0, y: 0, width: cover.w, height: cover.h, color: rgb(rgbOf(bg)) }));
  if (!text) return;
  const vp = vpOf(page);
  const top = area.y + area.h - st.size * 1.2;
  await addText(d, i, { x: area.x, y: Math.max(0, top), w: Math.min(vp.width - area.x - 6, 10000), h: area.h }, text, st);
}

export async function addImage(d, i, r, pngBytes, opacity = 1) {
  const page = d.getPage(i);
  const img = await d.embedPng(pngBytes);
  inBox(page, r, () => page.drawImage(img, { x: 0, y: 0, width: r.w, height: r.h, opacity }));
}

function markedArtifact(page, watermark, draw) {
  const props = page.doc.context.obj({ Type: 'Pagination', Subtype: watermark ? 'Watermark' : 'Header' });
  page.pushOperators(op('BDC', N('Artifact'), props));
  draw();
  page.pushOperators(op('EMC'));
}

/** 頁碼 / 頁首頁尾 / 浮水印。pos：0 左上 1 中上 2 右上 3 左下 4 中下 5 右下 6 中央斜放。內容以 Artifact 標記，之後可以移除。 */
export async function stampText(d, sel, fmt, pos, size, color, opacity, labels, fileName) {
  const total = d.getPageCount();
  for (const i of sel) {
    const page = d.getPage(i), vp = vpOf(page);
    const lbl = (labels && labels[i]) || String(i + 1);
    const t = fmt.replace(/\{n\}/g, i + 1).replace(/\{N\}/g, total).replace(/\{label\}/g, lbl).replace(/\{date\}/g, today()).replace(/\{file\}/g, baseName(fileName || ''));
    const { font } = await fontFor(d, t, 0, pos === 6);
    const tw = font.widthOfTextAtSize(t, size), dw = vp.width, dh = vp.height, m = 28;
    markedArtifact(page, pos === 6, () => inBox(page, { x: 0, y: 0, w: dw, h: dh }, () => {
      if (pos === 6) {
        const a = Math.atan2(dh, dw);
        page.pushOperators(L.concatTransformationMatrix(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), dw / 2, dh / 2));
        page.drawText(t, { x: -tw / 2, y: -size / 3, size, font, color: rgb(rgbOf(color)), opacity });
      } else {
        const x = pos % 3 === 0 ? m : pos % 3 === 1 ? (dw - tw) / 2 : dw - m - tw;
        const y = pos < 3 ? dh - m - size : m;
        page.drawText(t, { x, y, size, font, color: rgb(rgbOf(color)), opacity });
      }
    }));
  }
}

// ================================================================ 註解

const now = () => D(new Date());

function addAnnot(d, i, dict) {
  const page = d.getPage(i);
  dict.set(N('P'), page.ref);
  const ref = d.context.register(dict);
  page.node.addAnnot(ref);
  return ref;
}

function base(subtype, rect, color, contents, extra = {}) {
  return {
    Type: 'Annot', Subtype: subtype, Rect: rect, C: color, F: 4, T: T(author()), M: now(), CreationDate: now(),
    ...(contents != null ? { Contents: T(contents) } : {}), ...extra,
  };
}

/** 外觀串流（BBox 為 Rect 的寬高） */
function ap(d, rect, ops, res = {}) {
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  const s = d.context.formXObject(ops, { BBox: [0, 0, w, h], Resources: res });
  return d.context.register(s);
}

const mv = (x, y) => op('m', x, y), ln = (x, y) => op('l', x, y);
const cRgb = c => op('RG', ...c), fRgb = c => op('rg', ...c);

export function addNote(d, i, x, y, text, color) {
  const vp = vpOf(d.getPage(i));
  const [px, py] = vp.convertToPdfPoint(x, y);
  const rect = [px - 10, py - 10, px + 10, py + 10];
  const c = rgbOf(color);
  const apRef = ap(d, rect, [fRgb(c), cRgb([0.35, 0.3, 0.1]), op('w', 0.8),
    mv(1, 1), ln(19, 1), ln(19, 13), ln(13, 19), ln(1, 19), op('h'), op('B'),
    mv(4, 14), ln(14, 14), mv(4, 10), ln(16, 10), mv(4, 6), ln(16, 6), op('S')]);
  addAnnot(d, i, d.context.obj(base('Text', rect, c, text, { Name: 'Comment', AP: { N: apRef } })));
}

/** 螢光 / 底線 / 刪除線 / 波浪線。rects：基準顯示座標的每行範圍 */
export function addMarkup(d, i, rects, sub, color, quoted, contents) {
  const vp = vpOf(d.getPage(i));
  const q = [];
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const r of rects) {
    const ul = vp.convertToPdfPoint(r.x, r.y), ur = vp.convertToPdfPoint(r.x + r.w, r.y), ll = vp.convertToPdfPoint(r.x, r.y + r.h), lr = vp.convertToPdfPoint(r.x + r.w, r.y + r.h);
    q.push(...ul, ...ur, ...ll, ...lr);
    for (const p of [ul, ur, ll, lr]) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
  }
  const rect = [x1 - 2, y1 - 2, x2 + 2, y2 + 2];
  const c = rgbOf(color);
  const ops = [];
  const res = {};
  const P = (k) => [q[k] - rect[0], q[k + 1] - rect[1]];
  for (let k = 0; k < q.length; k += 8) {
    const [a, b, cc, dd] = [P(k), P(k + 2), P(k + 4), P(k + 6)];   // 左上 右上 左下 右下
    if (sub === 'Highlight') ops.push(mv(...cc), ln(...dd), ln(...b), ln(...a), op('h'));
    else {
      const t = sub === 'StrikeOut' ? 0.5 : 0.1;
      const s1 = [cc[0] + (a[0] - cc[0]) * t, cc[1] + (a[1] - cc[1]) * t], s2 = [dd[0] + (b[0] - dd[0]) * t, dd[1] + (b[1] - dd[1]) * t];
      const hh = Math.hypot(a[0] - cc[0], a[1] - cc[1]);
      ops.push(op('w', Math.max(0.8, hh * 0.07)));
      if (sub === 'Squiggly') {
        const len = Math.hypot(s2[0] - s1[0], s2[1] - s1[1]), step = Math.max(2, hh * 0.18), nx = (s2[0] - s1[0]) / len, ny = (s2[1] - s1[1]) / len;
        ops.push(mv(...s1));
        for (let u = step, up = 1; u < len; u += step, up = -up) ops.push(ln(s1[0] + nx * u - ny * up * step * 0.5, s1[1] + ny * u + nx * up * step * 0.5));
      } else ops.push(mv(...s1), ln(...s2));
    }
  }
  if (sub === 'Highlight') {
    res.ExtGState = { GS0: d.context.obj({ Type: 'ExtGState', ca: 0.45, BM: 'Multiply' }) };
    ops.unshift(op('gs', N('GS0')), fRgb(c));
    ops.push(op('f'));
  } else { ops.unshift(cRgb(c)); ops.push(op('S')); }
  const apRef = ap(d, rect, ops, res);
  addAnnot(d, i, d.context.obj(base(sub, rect, c, contents ?? null, { QuadPoints: q, AP: { N: apRef }, ...(sub === 'Highlight' ? { CA: 0.45 } : {}),
    ...(quoted ? { XiaoKeText: T(quoted) } : {}) })));
}

function ellipseOps(x, y, w, h) {
  const k = 0.5523, rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  return [mv(cx + rx, cy), op('c', cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry), op('c', cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy),
    op('c', cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry), op('c', cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy), op('h')];
}

export function addShape(d, i, r, ellipse, color, width, contents) {
  const vp = vpOf(d.getPage(i));
  const [x1, y1, x2, y2] = pdfRect(vp, r);
  const rect = [x1 - width, y1 - width, x2 + width, y2 + width];
  const c = rgbOf(color), w = x2 - x1, h = y2 - y1;
  const ops = [cRgb(c), op('w', width), ...(ellipse ? ellipseOps(width, width, w, h) : [op('re', width, width, w, h)]), op('S')];
  addAnnot(d, i, d.context.obj(base(ellipse ? 'Circle' : 'Square', rect, c, contents ?? null, { BS: { W: width }, AP: { N: ap(d, rect, ops) } })));
}

export function addInk(d, i, strokes, color, width) {
  const vp = vpOf(d.getPage(i));
  const list = strokes.map(s => s.pts.map(p => vp.convertToPdfPoint(p[0], p[1])));
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const s of list) for (const [x, y] of s) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  const rect = [x1 - width, y1 - width, x2 + width, y2 + width];
  const c = rgbOf(color);
  const ops = [cRgb(c), op('w', width), op('J', 1), op('j', 1)];
  for (const s of list) {
    ops.push(mv(s[0][0] - rect[0], s[0][1] - rect[1]));
    if (s.length === 1) ops.push(ln(s[0][0] - rect[0] + 0.1, s[0][1] - rect[1]));
    for (let k = 1; k < s.length; k++) ops.push(ln(s[k][0] - rect[0], s[k][1] - rect[1]));
  }
  ops.push(op('S'));
  const inkList = d.context.obj(list.map(s => s.flat()));
  addAnnot(d, i, d.context.obj(base('Ink', rect, c, null, { InkList: inkList, BS: { W: width }, AP: { N: ap(d, rect, ops) } })));
}

export async function addLine(d, i, a, b, arrow, color, width, caption) {
  const vp = vpOf(d.getPage(i));
  const p = vp.convertToPdfPoint(a[0], a[1]), q = vp.convertToPdfPoint(b[0], b[1]);
  const pad = 14 + width;
  const rect = [Math.min(p[0], q[0]) - pad, Math.min(p[1], q[1]) - pad, Math.max(p[0], q[0]) + pad, Math.max(p[1], q[1]) + pad];
  const c = rgbOf(color);
  const P = [p[0] - rect[0], p[1] - rect[1]], Q = [q[0] - rect[0], q[1] - rect[1]];
  const ops = [cRgb(c), op('w', width), op('J', 1), mv(...P), ln(...Q), op('S')];
  if (arrow) {
    const ang = Math.atan2(Q[1] - P[1], Q[0] - P[0]), L1 = 8 + width * 2;
    ops.push(mv(Q[0] - L1 * Math.cos(ang - 0.45), Q[1] - L1 * Math.sin(ang - 0.45)), ln(...Q), ln(Q[0] - L1 * Math.cos(ang + 0.45), Q[1] - L1 * Math.sin(ang + 0.45)), op('S'));
  }
  const res = {};
  if (caption) {
    const f = await d.embedFont(L.StandardFonts.Helvetica);
    res.Font = { F1: f.ref };
    const tw = f.widthOfTextAtSize(caption, 9);
    ops.push(fRgb(c), op('BT'), op('Tf', N('F1'), 9), op('Td', (P[0] + Q[0]) / 2 - tw / 2, (P[1] + Q[1]) / 2 + 3), op('Tj', f.encodeText(caption)), op('ET'));
  }
  addAnnot(d, i, d.context.obj(base('Line', rect, c, caption ?? null, {
    L: [p[0], p[1], q[0], q[1]], BS: { W: width }, ...(arrow ? { LE: [N('None'), N('OpenArrow')] } : {}), ...(caption ? { Cap: true } : {}),
    AP: { N: ap(d, rect, ops, res) },
  })));
}

/** 用一張 PNG 當外觀（自動處理頁面旋轉） */
async function imageAP(d, i, r, png) {
  const page = d.getPage(i), vp = vpOf(page);
  const rect = pdfRect(vp, r);
  const img = await d.embedPng(png);
  const m = boxMatrix(vp, r, [rect[0], rect[1]]);
  const ops = [op('q'), op('cm', ...m), op('cm', r.w, 0, 0, r.h, 0, 0), op('Do', N('Im0')), op('Q')];
  return { rect, apRef: ap(d, rect, ops, { XObject: { Im0: img.ref } }) };
}

export async function addStamp(d, i, r, png, name, contents) {
  const { rect, apRef } = await imageAP(d, i, r, png);
  addAnnot(d, i, d.context.obj(base('Stamp', rect, [0.9, 0.1, 0.1], contents, { Name: N(name.replace(/\s/g, '')), AP: { N: apRef } })));
}

export async function addFreeText(d, i, r, text, st, png) {
  const { rect, apRef } = await imageAP(d, i, r, png);
  const c = rgbOf(st.color || '#000000');
  addAnnot(d, i, d.context.obj(base('FreeText', rect, c, text, {
    DA: PDFString.of(`/Helv ${st.size || 12} Tf ${c.map(v => v.toFixed(3)).join(' ')} rg`), BS: { W: 0 }, AP: { N: apRef },
  })));
}

export function addLink(d, i, r, uri, dest) {
  const page = d.getPage(i), vp = vpOf(page);
  const rect = pdfRect(vp, r);
  const extra = uri ? { A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) } } : { Dest: [d.getPage(dest).ref, N('Fit')] };
  const dict = d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4, ...extra });
  addAnnot(d, i, dict);
}

export function addRedact(d, i, r) {
  const vp = vpOf(d.getPage(i));
  const rect = pdfRect(vp, r);
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  const ops = [cRgb([0.9, 0.1, 0.1]), op('w', 1.5), op('d', d.context.obj([4, 2]), 0), op('re', 0.75, 0.75, w - 1.5, h - 1.5), op('S')];
  addAnnot(d, i, d.context.obj({ Type: 'Annot', Subtype: 'Redact', Rect: rect, C: [0.9, 0.1, 0.1], T: T(author()), M: now(), AP: { N: ap(d, rect, ops) } }));
}

// ---------------- 註解清單與編輯

const SKIP = new Set(['Link', 'Widget', 'Popup']);
const str = o => { if (!o) return ''; try { return o.decodeText ? o.decodeText() : o.asString ? o.asString() : String(o); } catch { return ''; } };
const name = o => o && o.asString ? o.asString().replace(/^\//, '') : '';

function annotList(page) {
  const a = page.node.Annots();
  if (!a) return [];
  const out = [];
  for (let k = 0; k < a.size(); k++) {
    const ref = a.get(k), dict = a.lookup(k);
    if (dict instanceof PDFDict) out.push({ ref, dict, index: k });
  }
  return out;
}

export function pdfDate(s) {
  if (!s) return '';
  s = s.replace(/^D:/, '');
  return s.length >= 12 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

export function comments(d) {
  const all = [], byRef = new Map();
  d.getPages().forEach((page, pi) => {
    const vp = vpOf(page);
    for (const { ref, dict, index } of annotList(page)) {
      const sub = name(dict.get(N('Subtype')));
      if (!sub || SKIP.has(sub)) continue;
      const rect = dict.lookup(N('Rect'));
      const C = dict.lookup(N('C'));
      let color = '#9E9E9E';
      try { if (C && C.size() >= 3) color = '#' + [0, 1, 2].map(j => Math.round(C.lookup(j).asNumber() * 255).toString(16).padStart(2, '0')).join(''); } catch {}
      let r = null;
      try { const v = rect.asArray().map(x => x.asNumber()); const [x1, y1, x2, y2] = vp.convertToViewportRectangle(v); r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }; } catch {}
      const c = {
        page: pi, index, ref: ref instanceof PDFRef ? ref.toString() : null, sub, color, r,
        contents: str(dict.lookup(N('Contents'))), author: str(dict.lookup(N('T'))),
        date: pdfDate(str(dict.lookup(N('M'))) || str(dict.lookup(N('CreationDate')))),
        text: str(dict.lookup(N('XiaoKeText'))), irt: dict.get(N('IRT')), model: str(dict.lookup(N('StateModel'))), state: str(dict.lookup(N('State'))),
        replies: [], cur: null,
      };
      if (ref instanceof PDFRef) byRef.set(ref.toString(), c);
      all.push(c);
    }
  });
  const top = [];
  for (const c of all) {
    const par = c.irt instanceof PDFRef ? byRef.get(c.irt.toString()) : null;
    if (par) { if (c.model) { par.cur = c.state; continue; } par.replies.push(c); }
    else top.push(c);
  }
  return top;
}

function annotAt(d, page, index) {
  const a = d.getPage(page).node.Annots();
  if (!a || index >= a.size()) throw new Error('找不到這個註解');
  return { ref: a.get(index), dict: a.lookup(index), arr: a };
}

export function deleteAnnot(d, page, index) {
  const { ref, dict, arr } = annotAt(d, page, index);
  const popup = dict.get(N('Popup'));
  const keep = [];
  for (let k = 0; k < arr.size(); k++) {
    const r = arr.get(k), o = arr.lookup(k);
    if (k === index || (popup && r.toString() === popup.toString())) continue;
    const irt = o instanceof PDFDict ? o.get(N('IRT')) : null;
    if (irt && ref && irt.toString() === ref.toString()) continue;
    keep.push(r);
  }
  d.getPage(page).node.set(N('Annots'), d.context.obj(keep));
}

export function setContents(d, page, index, text) {
  const { dict } = annotAt(d, page, index);
  dict.set(N('Contents'), T(text)); dict.set(N('M'), now());
}

export function reply(d, page, index, text) {
  const { ref, dict } = annotAt(d, page, index);
  addAnnot(d, page, d.context.obj({ ...base('Text', dict.lookup(N('Rect')), [0.6, 0.6, 0.6], text, { IRT: ref, RT: 'R' }), F: 32 }));
}

export function setState(d, page, index, state) {
  const { ref, dict, arr } = annotAt(d, page, index);
  const keep = [];
  for (let k = 0; k < arr.size(); k++) {
    const o = arr.lookup(k);
    const irt = o instanceof PDFDict ? o.get(N('IRT')) : null;
    if (irt && irt.toString() === ref.toString() && o.get(N('StateModel'))) continue;
    keep.push(arr.get(k));
  }
  d.getPage(page).node.set(N('Annots'), d.context.obj(keep));
  addAnnot(d, page, d.context.obj({ ...base('Text', dict.lookup(N('Rect')), [0.6, 0.6, 0.6], `${author()} 將狀態設為 ${state}`, { IRT: ref, StateModel: PDFString.of('Review'), State: PDFString.of(state) }), F: 32 }));
}

export function restyle(d, page, index, { color, opacity }) {
  const { dict } = annotAt(d, page, index);
  if (color) {
    const c = rgbOf(color);
    dict.set(N('C'), d.context.obj(c));
    // 重新上色外觀串流：把 RG / rg 換成新顏色
    try {
      const apN = dict.lookup(N('AP')).lookup(N('N'));
      if (apN && apN.getContents) {
        const src = latin1(L.decodePDFRawStream(apN).decode());
        const re = src.replace(/[\d.]+\s+[\d.]+\s+[\d.]+\s+(RG|rg)/g, (_, k) => `${c.map(v => v.toFixed(3)).join(' ')} ${k}`);
        const ns = d.context.flateStream(re, { BBox: apN.dict.lookup(N('BBox')), Resources: apN.dict.lookup(N('Resources')) || d.context.obj({}), Subtype: 'Form', Type: 'XObject' });
        dict.set(N('AP'), d.context.obj({ N: d.context.register(ns) }));
      }
    } catch {}
  }
  if (opacity != null) dict.set(N('CA'), PDFNumber.of(opacity));
  dict.set(N('M'), now());
}

// ================================================================ 表單

const ftype = f => {
  const n = f.constructor.name;
  if (f instanceof L.PDFTextField) return 'text';
  if (f instanceof L.PDFCheckBox) return 'check';
  if (f instanceof L.PDFRadioGroup) return 'radio';
  if (f instanceof L.PDFDropdown) return 'combo';
  if (f instanceof L.PDFOptionList) return 'list';
  if (f instanceof L.PDFButton) return 'button';
  if (f instanceof L.PDFSignature) return 'sign';
  return n;
};

export function fields(d) {
  let form;
  try { form = d.getForm(); } catch { return []; }
  const refs = d.getPages().map(p => p.ref.toString());
  const out = [];
  for (const f of form.getFields()) {
    const x = { name: f.getName(), type: ftype(f), value: '', options: [], readOnly: f.isReadOnly(), required: f.isRequired ? f.isRequired() : false, page: -1, r: null, multi: false };
    try {
      if (x.type === 'text') { x.value = f.getText() || ''; x.multi = f.isMultiline(); }
      else if (x.type === 'check') x.value = f.isChecked() ? '是' : '否';
      else if (x.type === 'radio') { x.value = f.getSelected() || ''; x.options = f.getOptions(); }
      else if (x.type === 'combo') { x.value = (f.getSelected() || []).join(', '); x.options = f.getOptions(); x.editable = f.isEditable(); }
      else if (x.type === 'list') { x.value = (f.getSelected() || []).join(', '); x.options = f.getOptions(); x.multi = f.isMultiselect(); }
      else if (x.type === 'sign') x.value = f.acroField.dict.get(N('V')) ? '已簽署' : '未簽署';
    } catch {}
    try {
      const w = f.acroField.getWidgets()[0];
      if (w) {
        const p = w.P();
        let pi = p ? refs.indexOf(p.toString()) : -1;
        if (pi < 0) d.getPages().forEach((pg, k) => { const a = pg.node.Annots(); if (a) for (let j = 0; j < a.size(); j++) if (a.lookup(j) === w.dict) pi = k; });
        x.page = pi;
        if (pi >= 0) {
          const r = w.getRectangle(), vp = vpOf(d.getPage(pi));
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle([r.x, r.y, r.x + r.width, r.y + r.height]);
          x.r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        }
      }
    } catch {}
    out.push(x);
  }
  return out;
}

export async function setField(d, nameStr, value) {
  const form = d.getForm();
  const f = form.getField(nameStr);
  const t = ftype(f);
  if (t === 'check') { value === true || value === 'true' ? f.check() : f.uncheck(); return; }
  if (t === 'radio') { f.select(value); return; }
  if (t === 'combo') { f.select(value); }
  else if (t === 'list') { f.select(Array.isArray(value) ? value : [value]); }
  else if (t === 'text') f.setText(value);
  // 中文：用內建字型重畫外觀
  if (typeof value === 'string' && /[^\x00-\x7E]/.test(value) || Array.isArray(value)) {
    const font = await d.embedFont(await huninn(), { subset: true });
    try { f.updateAppearances(font); } catch {}
  }
}

export function clearForm(d) {
  const form = d.getForm();
  for (const f of form.getFields()) {
    try {
      const t = ftype(f);
      if (t === 'text') f.setText(''); else if (t === 'check') f.uncheck(); else if (t === 'radio') f.clear(); else if (t === 'combo' || t === 'list') f.clear();
    } catch {}
  }
}

export async function flatten(d) {
  const form = d.getForm();
  if (!form.getFields().length) throw new Error('這份文件沒有表單');
  try { form.updateFieldAppearances(await d.embedFont(await huninn(), { subset: true })); } catch {}
  form.flatten();
}

export function addField(d, i, r, type, nm, options = []) {
  const form = d.getForm();
  if (form.getFieldMaybe(nm)) throw new Error(`已經有叫「${nm}」的欄位`);
  const page = d.getPage(i), vp = vpOf(page);
  const [x1, y1, x2, y2] = pdfRect(vp, r);
  const o = { x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderColor: L.rgb(0.45, 0.5, 0.6), borderWidth: 1 };
  if (type === 'text' || type === 'multiline') { const f = form.createTextField(nm); if (type === 'multiline') f.enableMultiline(); f.addToPage(page, o); }
  else if (type === 'check') form.createCheckBox(nm).addToPage(page, o);
  else if (type === 'combo') { const f = form.createDropdown(nm); f.addOptions(options); if (options[0]) f.select(options[0]); f.addToPage(page, o); }
  else if (type === 'list') { const f = form.createOptionList(nm); f.addOptions(options); f.addToPage(page, o); }
  else if (type === 'sign') {
    const acro = d.catalog.getOrCreateAcroForm();
    const rect = [x1, y1, x2, y2];
    const apRef = ap(d, rect, [cRgb([0.45, 0.5, 0.6]), op('re', 0.5, 0.5, x2 - x1 - 1, y2 - y1 - 1), op('S')]);
    const w = d.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: rect, T: T(nm), F: 4, P: page.ref, AP: { N: apRef } });
    const ref = d.context.register(w);
    page.node.addAnnot(ref);
    acro.addField(ref);
  }
}

export function deleteField(d, nm) { const form = d.getForm(); form.removeField(form.getField(nm)); }

// ================================================================ 書籤、頁面標籤

/** 讀取書籤樹：[{title, page, open, kids}] */
export function readOutline(d) {
  const outlines = d.catalog.lookup(N('Outlines'));
  if (!(outlines instanceof PDFDict)) return [];
  const refs = d.getPages().map(p => p.ref.toString());
  const named = namedDests(d);
  const pageOf = dest => {
    try {
      if (!dest) return -1;
      if (dest instanceof PDFString || dest instanceof PDFHexString) dest = named.get(dest.decodeText());
      else if (dest instanceof PDFName) dest = named.get(dest.decodeText ? dest.decodeText() : dest.asString().slice(1));
      if (dest instanceof PDFDict) dest = dest.lookup(N('D'));
      if (dest instanceof PDFArray) { const p = dest.get(0); if (p instanceof PDFRef) return refs.indexOf(p.toString()); if (p instanceof PDFNumber) return p.asNumber(); }
    } catch {}
    return -1;
  };
  const seen = new Set();
  const walk = (first, depth) => {
    const out = [];
    let cur = first;
    while (cur instanceof PDFDict && !seen.has(cur) && depth < 30) {
      seen.add(cur);
      let dest = cur.lookup(N('Dest'));
      const A = cur.lookup(N('A'));
      if (!dest && A instanceof PDFDict && name(A.get(N('S'))) === 'GoTo') dest = A.lookup(N('D'));
      const count = cur.lookup(N('Count'));
      out.push({ title: str(cur.lookup(N('Title'))) || '（無標題）', page: pageOf(dest), open: count ? count.asNumber() > 0 : false, kids: walk(cur.lookup(N('First')), depth + 1) });
      cur = cur.lookup(N('Next'));
    }
    return out;
  };
  return walk(outlines.lookup(N('First')), 0);
}

function namedDests(d) {
  const m = new Map();
  try {
    const old = d.catalog.lookup(N('Dests'));
    if (old instanceof PDFDict) for (const [k, v] of old.entries()) m.set(k.decodeText ? k.decodeText() : k.asString().slice(1), d.context.lookup(v));
    const names = d.catalog.lookup(N('Names'));
    const tree = names instanceof PDFDict ? names.lookup(N('Dests')) : null;
    const walk = (node, depth) => {
      if (!(node instanceof PDFDict) || depth > 20) return;
      const nm = node.lookup(N('Names'));
      if (nm instanceof PDFArray) for (let k = 0; k + 1 < nm.size(); k += 2) m.set(str(nm.lookup(k)), nm.lookup(k + 1));
      const kids = node.lookup(N('Kids'));
      if (kids instanceof PDFArray) for (let k = 0; k < kids.size(); k++) walk(kids.lookup(k), depth + 1);
    };
    walk(tree, 0);
  } catch {}
  return m;
}

/** 用新的書籤樹整個重寫 */
export function writeOutline(d, tree) {
  if (!tree.length) { d.catalog.delete(N('Outlines')); return; }
  const ctx = d.context;
  const pages = d.getPages();
  const rootRef = ctx.nextRef();
  const build = (items, parentRef) => {
    const refs = items.map(() => ctx.nextRef());
    let total = 0;
    items.forEach((it, k) => {
      const dict = ctx.obj({ Title: T(it.title), Parent: parentRef });
      if (it.page >= 0 && it.page < pages.length) dict.set(N('Dest'), ctx.obj([pages[it.page].ref, N('Fit')]));
      if (k > 0) dict.set(N('Prev'), refs[k - 1]);
      if (k < items.length - 1) dict.set(N('Next'), refs[k + 1]);
      if (it.kids && it.kids.length) {
        const r = build(it.kids, refs[k]);
        dict.set(N('First'), r.refs[0]); dict.set(N('Last'), r.refs[r.refs.length - 1]);
        dict.set(N('Count'), PDFNumber.of(it.open ? r.total : -r.total));
        if (it.open) total += r.total;
      }
      ctx.assign(refs[k], dict);
      total++;
    });
    return { refs, total };
  };
  const r = build(tree, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: r.refs[0], Last: r.refs[r.refs.length - 1], Count: r.total }));
  d.catalog.set(N('Outlines'), rootRef);
}

/** style：D r R a A 或 null */
export function setLabel(d, start, style, prefix, first) {
  const pl = d.catalog.lookup(N('PageLabels'));
  const ranges = new Map();
  if (pl instanceof PDFDict) {
    const nums = pl.lookup(N('Nums'));
    if (nums instanceof PDFArray) for (let k = 0; k + 1 < nums.size(); k += 2) ranges.set(nums.lookup(k).asNumber(), nums.get(k + 1));
  } else ranges.set(0, d.context.obj({ S: 'D' }));
  const o = {};
  if (style) o.S = style;
  if (prefix) o.P = T(prefix);
  if (first && first !== 1) o.St = first;
  ranges.set(start, d.context.obj(o));
  const arr = [];
  for (const k of [...ranges.keys()].sort((a, b) => a - b)) arr.push(PDFNumber.of(k), ranges.get(k));
  d.catalog.set(N('PageLabels'), d.context.obj({ Nums: arr }));
}
export function clearLabels(d) { d.catalog.delete(N('PageLabels')); }

// ================================================================ 文件資訊、附件、清理

export function info(d) {
  return { title: d.getTitle() || '', author: d.getAuthor() || '', subject: d.getSubject() || '', keywords: d.getKeywords() || '',
    creator: d.getCreator() || '', producer: d.getProducer() || '', created: d.getCreationDate(), modified: d.getModificationDate() };
}

export function setInfo(d, o) {
  d.setTitle(o.title || ''); d.setAuthor(o.author || ''); d.setSubject(o.subject || '');
  d.setKeywords(o.keywords ? o.keywords.split(/[,，]\s*/) : []); d.setModificationDate(new Date());
}

export function fonts(d) {
  const out = new Map(), seen = new Set();
  const scan = (res, depth) => {
    if (!(res instanceof PDFDict) || depth > 5 || seen.has(res)) return;
    seen.add(res);
    const F = res.lookup(N('Font'));
    if (F instanceof PDFDict) for (const [, v] of F.entries()) {
      const f = d.context.lookup(v);
      if (!(f instanceof PDFDict)) continue;
      let nm = name(f.get(N('BaseFont'))) || '（未命名）';
      const sub = name(f.get(N('Subtype')));
      let fd = f.lookup(N('FontDescriptor'));
      const desc = f.lookup(N('DescendantFonts'));
      if (!fd && desc instanceof PDFArray) { const df = desc.lookup(0); if (df instanceof PDFDict) fd = df.lookup(N('FontDescriptor')); }
      const emb = fd instanceof PDFDict && (fd.get(N('FontFile')) || fd.get(N('FontFile2')) || fd.get(N('FontFile3')));
      const subset = /^[A-Z]{6}\+/.test(nm);
      if (subset) nm = nm.slice(7);
      out.set(nm, `${sub} · ${emb ? (subset ? '已嵌入子集' : '已嵌入') : '未嵌入'}`);
    }
    const X = res.lookup(N('XObject'));
    if (X instanceof PDFDict) for (const [, v] of X.entries()) {
      const x = d.context.lookup(v);
      if (x && x.dict && name(x.dict.get(N('Subtype'))) === 'Form') scan(x.dict.lookup(N('Resources')), depth + 1);
    }
  };
  for (const p of d.getPages()) scan(p.node.Resources(), 0);
  return out;
}

export function sanitize(d, o) {
  const r = [];
  const cat = d.catalog;
  if (o.meta) {
    for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) try { d.getInfoDict().delete(N(k)); } catch {}
    cat.delete(N('Metadata'));
    r.push('・已移除文件資訊與 XMP 中繼資料');
  }
  if (o.js) {
    cat.delete(N('OpenAction')); cat.delete(N('AA'));
    const names = cat.lookup(N('Names'));
    if (names instanceof PDFDict) names.delete(N('JavaScript'));
    for (const p of d.getPages()) {
      p.node.delete(N('AA'));
      for (const { dict } of annotList(p)) {
        dict.delete(N('AA'));
        const A = dict.lookup(N('A'));
        if (A instanceof PDFDict && name(A.get(N('S'))) === 'JavaScript') dict.delete(N('A'));
      }
    }
    r.push('・已移除 JavaScript 與自動動作');
  }
  if (o.attach) {
    const names = cat.lookup(N('Names'));
    if (names instanceof PDFDict) names.delete(N('EmbeddedFiles'));
    for (const p of d.getPages()) { const keep = annotList(p).filter(a => name(a.dict.get(N('Subtype'))) !== 'FileAttachment').map(a => a.ref); p.node.set(N('Annots'), d.context.obj(keep)); }
    r.push('・已移除附件');
  }
  if (o.comments) {
    for (const p of d.getPages()) { const keep = annotList(p).filter(a => ['Widget', 'Link'].includes(name(a.dict.get(N('Subtype'))))).map(a => a.ref); p.node.set(N('Annots'), d.context.obj(keep)); }
    r.push('・已移除所有註解');
  }
  if (o.forms) { try { d.getForm().flatten(); r.push('・已將表單平面化'); } catch {} }
  return r.join('\n');
}

/** 重新壓縮 JPEG 圖片。回傳處理張數 */
export async function compressImages(d, maxDim, quality) {
  let count = 0;
  for (const [ref, obj] of d.context.enumerateIndirectObjects()) {
    if (!(obj instanceof L.PDFRawStream)) continue;
    const dict = obj.dict;
    if (name(dict.get(N('Subtype'))) !== 'Image') continue;
    const filter = dict.lookup(N('Filter'));
    const f = filter instanceof PDFArray ? (filter.size() === 1 ? name(filter.get(0)) : '') : name(filter);
    if (f !== 'DCTDecode' || dict.get(N('SMask')) || dict.get(N('Mask'))) continue;
    const cs = name(dict.get(N('ColorSpace')));
    if (cs && cs !== 'DeviceRGB' && cs !== 'DeviceGray') continue;
    try {
      const bytes = obj.getContents();
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
      const nb = new Uint8Array(await blob.arrayBuffer());
      if (nb.length >= bytes.length && s >= 1) continue;
      const ns = d.context.stream(nb, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
      d.context.assign(ref, ns);
      count++;
    } catch {}
  }
  return count;
}

// ================================================================ 需要繪製的動作（塗銷、點陣化）

async function renderJpeg(pdfjsDoc, i, dpi, black, gray) {
  const page = await pdfjsDoc.getPage(i + 1);
  let vp = page.getViewport({ scale: dpi / 72 });
  while (vp.width * vp.height > 30e6) vp = page.getViewport({ scale: vp.scale * 0.8 });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print', annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE }).promise;
  if (black) { ctx.fillStyle = '#000'; for (const r of black) { const [x1, y1, x2, y2] = vp.convertToViewportRectangle(r); ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); } }
  if (gray) { const id = ctx.getImageData(0, 0, c.width, c.height), p = id.data; for (let k = 0; k < p.length; k += 4) { const g = p[k] * 0.299 + p[k + 1] * 0.587 + p[k + 2] * 0.114; p[k] = p[k + 1] = p[k + 2] = g; } ctx.putImageData(id, 0, 0); }
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  c.width = c.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

function replaceWithImage(d, i, jpg) {
  const page = d.getPage(i), vp = vpOf(page);
  page.node.set(N('Resources'), d.context.obj({}));
  page.node.delete(N('Annots'));
  page.node.set(N('Contents'), d.context.register(d.context.flateStream('')));
  inBox(page, { x: 0, y: 0, w: vp.width, h: vp.height }, () => page.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height }));
}

/** 套用塗銷：有標記的頁面轉成影像並塗黑 */
export async function applyRedactions(bytes) {
  const d = await loadLib(bytes);
  const marks = new Map();
  d.getPages().forEach((p, i) => {
    const keep = [];
    for (const a of annotList(p)) {
      if (name(a.dict.get(N('Subtype'))) === 'Redact') {
        const r = a.dict.lookup(N('Rect')).asArray().map(x => x.asNumber());
        (marks.get(i) || marks.set(i, []).get(i)).push(r);
      } else keep.push(a.ref);
    }
    p.node.set(N('Annots'), d.context.obj(keep));
  });
  if (!marks.size) throw new Error('還沒有任何塗銷標記。先在頁面上框選要塗銷的區域。');
  const mid = await d.save();
  const pj = await openPdfjs(mid);
  const out = await loadLib(mid);
  for (const [i, rects] of marks) replaceWithImage(out, i, await out.embedJpg(await renderJpeg(pj, i, 200, rects, false)));
  await pj.destroy();
  return await out.save();
}

export async function rasterize(bytes, dpi, gray) {
  const pj = await openPdfjs(bytes);
  const out = await loadLib(bytes);
  for (let i = 0; i < out.getPageCount(); i++) replaceWithImage(out, i, await out.embedJpg(await renderJpeg(pj, i, dpi, null, gray)));
  try { out.catalog.delete(N('AcroForm')); } catch {}
  await pj.destroy();
  return await out.save();
}

export { renderJpeg };

/** 就地編輯一整段：蓋掉原本範圍，用原本的基線、行距、寬度重新排版寫入 */
export async function replaceBlock(d, i, area, text, st, bg) {
  const page = d.getPage(i);
  const cover = { x: area.x - 1.5, y: area.y - 1.5, w: area.w + 3, h: area.h + 3 };
  // 真正刪除原本的文字（不是只用白色蓋住）；刪不掉（例如文字在表單物件裡）才用背景色蓋住
  const removed = removeTextIn(d, i, pdfRect(vpOf(page), cover));
  if (!removed) inBox(page, cover, () => page.drawRectangle({ x: 0, y: 0, width: cover.w, height: cover.h, color: rgb(rgbOf(bg)) }));
  if (!text.trim()) return;
  await addText(d, i, { x: area.x, y: area.y, w: st.wrapW || area.w }, text, st);
}

const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];

/**
 * 刪除頁面內容串流中，起點落在 rect（PDF 座標 [x1,y1,x2,y2]）裡的文字繪製指令（Tj / TJ / ' / "）。
 * 追蹤 cm、q/Q 與文字矩陣（Tm、Td、TD、T*、TL），算出每段文字真正的位置。回傳刪除的段數。
 */
export function removeTextIn(d, i, rect) {
  const page = d.getPage(i);
  let tokens;
  try { tokens = tokenize(pageContent(page)); } catch { return 0; }
  const [x1, y1, x2, y2] = rect;
  const inside = (m, size) => {
    // 文字起點稍微往上一點（基線上方 0.3 個字高），避免剛好壓在邊界
    const x = m[4] + m[2] * size * 0.3, y = m[5] + m[3] * size * 0.3;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  };
  const out = [];
  let ops = [], ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], tl = 0, size = 10, removed = 0;
  const num = k => ops[k] && ops[k].k === 'num' ? ops[k].v : 0;
  const td = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm.slice(); };
  for (const t of tokens) {
    if (t.k !== 'op') { ops.push(t); continue; }
    const name = t.v;
    let drop = false;
    switch (name) {
      case 'q': stack.push(ctm.slice()); break;
      case 'Q': if (stack.length) ctm = stack.pop(); break;
      case 'cm': if (ops.length >= 6) ctm = mul([0, 1, 2, 3, 4, 5].map(k => num(ops.length - 6 + k)), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': if (ops.length >= 2) size = Math.abs(num(ops.length - 1)) || size; break;
      case 'TL': tl = num(ops.length - 1); break;
      case 'Td': td(num(ops.length - 2), num(ops.length - 1)); break;
      case 'TD': tl = -num(ops.length - 1); td(num(ops.length - 2), num(ops.length - 1)); break;
      case 'Tm': tlm = [0, 1, 2, 3, 4, 5].map(k => num(ops.length - 6 + k)); tm = tlm.slice(); break;
      case 'T*': td(0, -tl); break;
      case "'": case '"': td(0, -tl); // 換行後再畫
      // falls through
      case 'Tj': case 'TJ': {
        const m = mul(tm, ctm);
        const sz = size * Math.hypot(m[2], m[3]) || size;
        if (inside(m, sz / Math.max(1e-6, Math.hypot(m[2], m[3])))) drop = true;
        break;
      }
    }
    if (drop) { removed++; if (name === '"' && ops.length >= 3) out.push(ops[0], { k: 'op', raw: 'Tw', v: 'Tw' }, ops[1], { k: 'op', raw: 'Tc', v: 'Tc' }); ops = []; continue; }
    out.push(...ops, t);
    ops = [];
  }
  out.push(...ops);
  if (removed) setPageContent(d, page, serialize(out));
  return removed;
}
