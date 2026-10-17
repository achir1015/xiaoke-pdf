// =====================================================================
// 文字橡皮擦（TextEraser）
//
// 「改原文字」時，光把舊字蓋住還不夠：舊字仍在檔案裡，可以被搜尋、複製出來。
// 這裡沿著繪圖食譜追蹤「筆尖位置」（文字矩陣 Tm 與座標轉換 CTM），
// 凡是起筆點落在被取代區域裡的寫字指令（Tj、TJ、'、"），就把它刪掉。
//
// 比喻：拿著頁面座標圖，把「從這個框框裡開始寫的那幾筆」擦掉，框外的一筆都不動。
// =====================================================================
import { parseContent, latin1ToBytes } from './contentStream.js';
import { pageContentText, setPageContent } from './pdfObjects.js';

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const I = [1, 0, 0, 1, 0, 0];

/**
 * 刪除頁面上起筆點落在 rects 內的文字指令
 * @param {PDFPage} page pdf-lib 頁面
 * @param {number[][]} rects PDF 座標的 [x1, y1, x2, y2]
 * @returns {number} 刪掉幾個寫字指令
 */
export function eraseTextInRects(page, rects) {
  if (!rects.length) return 0;
  let src;
  try { src = pageContentText(page); } catch (e) { return 0; }
  const ops = parseContent(src);
  const inside = (x, y) => rects.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);

  let ctm = I, stack = [];
  let tm = I, tlm = I, leading = 0;
  let removed = 0;
  const out = [];
  const num = (o, k) => (o.args[k]?.t === 'num' ? o.args[k].v : 0);
  const nextLine = () => { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; };
  const startInside = () => { const m = mul(tm, ctm); return inside(m[4], m[5]); };

  for (const o of ops) {
    switch (o.op) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() || I; break;
      case 'cm': ctm = mul([0, 1, 2, 3, 4, 5].map(k => num(o, k)), ctm); break;
      case 'BT': tm = tlm = I; break;
      case 'TL': leading = num(o, 0); break;
      case 'Td': tlm = mul([1, 0, 0, 1, num(o, 0), num(o, 1)], tlm); tm = tlm; break;
      case 'TD': leading = -num(o, 1); tlm = mul([1, 0, 0, 1, num(o, 0), num(o, 1)], tlm); tm = tlm; break;
      case 'Tm': tlm = tm = [0, 1, 2, 3, 4, 5].map(k => num(o, k)); break;
      case 'T*': nextLine(); break;
      case 'Tj': case 'TJ':
        if (startInside()) { removed++; continue; }
        break;
      case "'": case '"':
        nextLine();
        if (startInside()) {
          removed++;
          // 保留「換行」的效果，只拿掉文字
          out.push({ start: -1, end: -1, raw: o.op === '"' ? `${num(o, 0)} Tw ${num(o, 1)} Tc T*` : 'T*' });
          continue;
        }
        break;
    }
    out.push(o);
  }
  if (removed) {
    const text = out.map(o => (o.raw !== undefined ? o.raw : src.slice(o.start, o.end))).join('\n') + '\n';
    setPageContent(page, latin1ToBytes(text));
  }
  return removed;
}
