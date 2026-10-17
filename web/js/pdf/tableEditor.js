// =====================================================================
// 表格編輯（TableEditor）——直接改底稿：撐高列、插入列／欄、合併儲存格、插入表格
//
// PDF 裡沒有「表格」這種東西，只有一條條框線和擺在固定位置的字。
// 所以「插入一列」其實是：把那條線以下的東西全部往下搬（rowGrow.js），再補上一條新框線；
// 「合併儲存格」是把合併範圍裡面的框線剪掉。
// 所有座標參數都是顯示座標（左上原點、y 往下），由 PageGeometry 翻譯成 PDF 座標。
// =====================================================================
import { PDFLib } from './libs.js';
import { pageContentText, setPageContent, N } from './pdfObjects.js';
import { shiftContent, cutContent, fromLatin1 } from './rowGrow.js';

const { PDFDocument, PDFArray, PDFDict, rgb } = PDFLib;

async function load(bytes) { return PDFDocument.load(bytes, { updateMetadata: false }); }
async function save(doc) { return doc.save({ useObjectStreams: false }); }

/** 搬移頁面上 area(X, Y) 範圍內的內容（含註解），位移 (dx, dy) 為顯示座標 */
function moveRegion(doc, g, i, area, dx, dy) {
  const page = doc.getPage(i);
  const a = g.toPdf(0, 0), b = g.toPdf(dx, dy);
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const moves = (x, y) => { const p = g.toDisplay(x, y); return area(p[0], p[1]); };
  const out = shiftContent(pageContentText(page), { moves, ux, uy });
  if (out) setPageContent(page, fromLatin1(out));
  const annots = page.node.lookup(N('Annots'));
  if (annots instanceof PDFArray) {
    for (let k = 0; k < annots.size(); k++) {
      const an = annots.lookup(k);
      const r = an instanceof PDFDict ? an.lookup(N('Rect')) : null;
      if (!(r instanceof PDFArray) || r.size() < 4) continue;
      const v = [0, 1, 2, 3].map(j => r.lookup(j).asNumber());
      const p1 = g.toDisplay(v[0], v[1]), p2 = g.toDisplay(v[2], v[3]);
      if (!area(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])) || !area(Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1]))) continue;
      an.set(N('Rect'), doc.context.obj([v[0] + ux, v[1] + uy, v[2] + ux, v[3] + uy]));
    }
  }
}

function line(doc, g, i, X1, Y1, X2, Y2, width = 0.75) {
  const a = g.toPdf(X1, Y1), b = g.toPdf(X2, Y2);
  doc.getPage(i).drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: width, color: rgb(0, 0, 0) });
}

/** 分隔線 split 以下全部往下移 dy（撐高表格列） */
export async function growBelow(bytes, g, i, split, dy) {
  const doc = await load(bytes);
  moveRegion(doc, g, i, (x, y) => y > split, 0, dy);
  return save(doc);
}

/** 在儲存格下方插入一列 */
export async function insertRow(bytes, g, i, cell, table, h) {
  const doc = await load(bytes);
  moveRegion(doc, g, i, (x, y) => y > cell.y2 - 1.5, 0, h);
  line(doc, g, i, table.x1, cell.y2, table.x2, cell.y2);
  return save(doc);
}

/** 在儲存格右邊插入一欄（表格範圍內、右邊的內容往右移） */
export async function insertColumn(bytes, g, i, cell, table, w) {
  const doc = await load(bytes);
  moveRegion(doc, g, i, (x, y) => x > cell.x2 - 1.5 && y >= table.y1 - 2 && y <= table.y2 + 2, w, 0);
  line(doc, g, i, cell.x2, table.y1, cell.x2, table.y2);
  return save(doc);
}

/** 把一欄切成兩欄：在 x 畫一條直框線 */
export async function splitColumn(bytes, g, i, x, table) {
  const doc = await load(bytes);
  line(doc, g, i, x, table.y1, x, table.y2);
  return save(doc);
}

/** 合併儲存格：剪掉 box 內部的框線 */
export async function mergeCells(bytes, g, i, box) {
  const doc = await load(bytes);
  const page = doc.getPage(i);
  const inner = { x1: box.x1 + 0.75, y1: box.y1 + 0.75, x2: box.x2 - 0.75, y2: box.y2 - 0.75 };
  const out = cutContent(pageContentText(page), { toDisp: (x, y) => g.toDisplay(x, y), box: inner });
  if (!out) return null;
  setPageContent(page, fromLatin1(out));
  return save(doc);
}

/** 插入表格；push＝把下面的內容往下移 */
export async function addTable(bytes, g, i, x, y, w, rows, cols, rowH, push) {
  const doc = await load(bytes);
  const H = rows * rowH;
  if (push) moveRegion(doc, g, i, (X, Y) => Y > y - 2, 0, H + 6);
  for (let r = 0; r <= rows; r++) line(doc, g, i, x, y + r * rowH, x + w, y + r * rowH);
  for (let c = 0; c <= cols; c++) line(doc, g, i, x + c * w / cols, y, x + c * w / cols, y + H);
  return save(doc);
}
