// =====================================================================
// pdf-lib 低階物件的小工具：讀字典、解壓串流、改寫串流
// =====================================================================
import { PDFLib } from './libs.js';
import { bytesToLatin1 } from './contentStream.js';

const { PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFStream, PDFString, PDFHexString, PDFContentStream, decodePDFRawStream } = PDFLib;

export const N = (s) => PDFName.of(s);

/** 取出字典的值並解開參照 */
export function get(dict, key, ctx) {
  if (!dict || !(dict instanceof PDFDict)) return undefined;
  const v = dict.get(N(key));
  return v instanceof PDFRef ? ctx.lookup(v) : v;
}

/** 名稱物件 → 純字串（不含斜線） */
export function nameOf(v) {
  if (!v) return null;
  if (v instanceof PDFName) return v.decodeText();
  return null;
}

/** 文字物件（PDFString / PDFHexString）→ JS 字串 */
export function textOf(v) {
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return null;
}

/** 解壓串流內容 → Uint8Array */
export function streamBytes(stream) {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (stream instanceof PDFContentStream) return stream.getUnencodedContents();
  if (stream instanceof PDFStream && stream.getContents) return stream.getContents();
  return new Uint8Array(0);
}

export function streamText(stream) { return bytesToLatin1(streamBytes(stream)); }

/** 頁面的內容串流（可能是一個或多個）合併成一段文字 */
export function pageContentText(page) {
  const ctx = page.doc.context;
  const contents = page.node.get(N('Contents'));
  const resolved = contents instanceof PDFRef ? ctx.lookup(contents) : contents;
  if (!resolved) return '';
  if (resolved instanceof PDFArray) {
    const parts = [];
    for (let i = 0; i < resolved.size(); i++) {
      const s = resolved.lookup(i);
      if (s instanceof PDFStream) parts.push(streamText(s));
    }
    return parts.join('\n');
  }
  return resolved instanceof PDFStream ? streamText(resolved) : '';
}

/** 用新的內容取代頁面全部內容串流 */
export function setPageContent(page, bytes) {
  const ctx = page.doc.context;
  const ref = ctx.register(ctx.flateStream(bytes));
  page.node.set(N('Contents'), ref);
}

/** 用新的內容改寫一個表單 XObject（保留它的字典設定） */
export function rewriteStream(ctx, ref, oldStream, bytes) {
  const dict = {};
  for (const [k, v] of oldStream.dict.entries()) {
    const key = k.decodeText();
    if (key === 'Length' || key === 'Filter' || key === 'DecodeParms') continue;
    dict[key] = v;
  }
  ctx.assign(ref, ctx.flateStream(bytes, dict));
}

export { PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream };
