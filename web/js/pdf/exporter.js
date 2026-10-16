// =====================================================================
// 匯出器（Exporter）——把所有貼紙真正印到底稿上，產生新的 PDF
//
// 順序：先決定每段文字要用哪個字型 → 粉圓只切一次子集 → 依貼紙的上下順序逐一印上。
// 所有座標都透過 PageGeometry 從「顯示座標」翻譯成 PDF 座標，所以旋轉過的頁面也正確。
// =====================================================================
import { PDFLib, fontkit } from './libs.js';
import { fonts } from './fonts.js';
import { hexToRgb } from './util.js';
import { mediaCardPng, safeUrl } from './media.js';
import { eraseTextInRects } from './textEraser.js';

const { PDFDocument, StandardFonts, PDFOperator, PDFString, PDFHexString, rgb, degrees } = PDFLib;

/**
 * @param {import('../domain/session.js').EditSession} session
 * @returns {Promise<Uint8Array>}
 */
export async function exportPdf(session, report = {}) {
  const doc = await PDFDocument.load(session.baseBytes, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  doc.setProducer('小柯文件PDF助手（網頁版）');
  doc.setModificationDate(new Date());
  const pages = doc.getPages();
  const els = session.elements.filter(e => e.pageIndex < pages.length);

  // 「改原文字」：先把原本那一行的文字指令真正刪掉（不只是蓋住），搜尋或複製都不會再出現舊字
  const patchesByPage = new Map();
  for (const el of els) if (el.kind === 'text' && el.patch) {
    const r = session.pages[el.pageIndex].rectToPdf(el.patch);
    if (!patchesByPage.has(el.pageIndex)) patchesByPage.set(el.pageIndex, []);
    patchesByPage.get(el.pageIndex).push(r);
  }
  for (const [i, rects] of patchesByPage) eraseTextInRects(pages[i], rects);

  const missing = new Set();
  const fontFor = await prepareFonts(doc, els, missing);
  report.missing = [...missing];
  const imageCache = new Map();

  for (const el of els) {
    const page = pages[el.pageIndex];
    const g = session.pages[el.pageIndex];
    switch (el.kind) {
      case 'cover': drawBox(page, g, el, el.color); break;
      case 'text': drawTextElement(doc, page, g, el, fontFor(el)); break;
      case 'link': await drawLink(doc, page, g, el, fontFor(el)); break;
      case 'image': await drawImageElement(doc, page, g, el, imageCache); break;
      case 'media': await drawMedia(doc, page, g, el); break;
    }
  }
  return doc.save({ useObjectStreams: false });
}

// ------------------------------------------------------------------ 字型

/** 判斷每段文字該用的字型；需要粉圓的字全部收集起來，只切一次子集 */
async function prepareFonts(doc, els, missingOut) {
  const textEls = els.filter(e => (e.kind === 'text' || e.kind === 'link') && e.text);
  const std = new Map();
  const needHuninn = new Set();
  const safeText = new Map();
  let huninnText = '';
  for (const el of textEls) {
    const key = el.font || 'huninn';             // 連結文字一律用粉圓（常常是中文）
    if (key !== 'huninn') {
      if (!std.has(key)) std.set(key, await doc.embedFont(StandardFonts[key] || StandardFonts.Helvetica));
      try { std.get(key).encodeText(el.text.replace(/\n/g, '')); continue; } catch (e) { /* 標準字型印不出來，改用粉圓 */ }
    }
    needHuninn.add(el.id);
    // 粉圓沒有的字（emoji、罕用字）先拿掉，否則 PDF 裡會變成空白方塊
    const { text, missing } = await fonts.filterSupported(el.text);
    missing.forEach(c => missingOut.add(c));
    safeText.set(el.id, text);
    huninnText += text;
  }
  let huninn = null;
  if (needHuninn.size) huninn = await doc.embedFont(await fonts.subsetHuninn(huninnText), { subset: false });
  return (el) => (needHuninn.has(el.id)
    ? { font: huninn, key: 'huninn', text: safeText.get(el.id) }
    : { font: std.get(el.font), key: el.font, text: el.text });
}

// ------------------------------------------------------------------ 各種貼紙

function drawBox(page, g, box, hex) {
  const [x1, y1, x2, y2] = g.rectToPdf(box);
  const c = hexToRgb(hex);
  page.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, color: rgb(c.red, c.green, c.blue), borderWidth: 0 });
}

/**
 * 印出多行文字，位置與網頁預覽一致。
 * @param {object} opt { text, size, lineHeight, color, bold, underline, strike, align, width }
 */
function drawLines(doc, page, g, x, y, opt, fontInfo) {
  const { font, key } = fontInfo;
  const lh = opt.size * opt.lineHeight;
  const base = fonts.baselineRatio(key, opt.lineHeight) * opt.size;
  const c = hexToRgb(opt.color);
  const color = rgb(c.red, c.green, c.blue);
  if (opt.bold) {
    page.pushOperators(
      PDFOperator.of('Tr', [doc.context.obj(2)]),
      PDFOperator.of('w', [doc.context.obj(opt.size * 0.03)]),
      PDFOperator.of('RG', [c.red, c.green, c.blue].map(v => doc.context.obj(v))));
  }
  String(opt.text).split('\n').forEach((line, i) => {
    const lw = font.widthOfTextAtSize(line, opt.size);
    const dx = opt.align === 'center' ? (opt.width - lw) / 2 : opt.align === 'right' ? opt.width - lw : 0;
    const by = y + base + i * lh;            // 這一行基線的顯示座標
    if (line) {
      const a = g.anchor(x + dx, by);
      page.drawText(line, { x: a.x, y: a.y, size: opt.size, font, color, rotate: degrees(a.rotate) });
    }
    const thick = Math.max(0.5, opt.size * 0.06);
    const deco = (offset) => {
      const p1 = g.toPdf(x + dx, by + offset), p2 = g.toPdf(x + dx + lw, by + offset);
      page.drawLine({ start: { x: p1[0], y: p1[1] }, end: { x: p2[0], y: p2[1] }, thickness: thick, color });
    };
    if (opt.underline && line) deco(opt.size * 0.12);
    if (opt.strike && line) deco(-opt.size * 0.3);
  });
  if (opt.bold) page.pushOperators(PDFOperator.of('Tr', [doc.context.obj(0)]));
}

function drawTextElement(doc, page, g, el, fontInfo) {
  if (el.patch) drawBox(page, g, el.patch, el.patch.color || '#ffffff');   // 先蓋掉原本那行字
  if (el.bgColor) drawBox(page, g, el, el.bgColor);
  if (!el.text) return;
  drawLines(doc, page, g, el.x, el.y, {
    text: fontInfo.text, size: el.size, lineHeight: el.lineHeight, color: el.color, bold: el.bold,
    underline: el.underline, strike: el.strike, align: el.align, width: el.w,
  }, fontInfo);
}

async function drawLink(doc, page, g, el, fontInfo) {
  if (!el.url) return;
  if (el.text) {
    drawLines(doc, page, g, el.x, el.y, {
      text: fontInfo.text, size: el.size, lineHeight: 1.3, color: el.color, underline: el.underline, align: 'left', width: el.w,
    }, fontInfo);
  }
  addLinkAnnot(doc, page, g.rectToPdf(el), el.url);
}

export function addLinkAnnot(doc, page, rect, url) {
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4,
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(safeUrl(url)) },
  });
  page.node.addAnnot(ctx.register(annot));
}

async function drawImageElement(doc, page, g, el, cache) {
  if (!el.image) return;
  let img = cache.get(el.image);
  if (!img) {
    img = /png/i.test(el.image.mime) ? await doc.embedPng(el.image.bytes) : await doc.embedJpg(el.image.bytes);
    cache.set(el.image, img);
  }
  placeImage(page, g, el, img, el.opacity);
}

/** 圖片的錨點是「顯示上的左下角」，再依頁面旋轉轉正 */
function placeImage(page, g, el, img, opacity = 1) {
  const a = g.anchor(el.x, el.y + el.h);
  page.drawImage(img, { x: a.x, y: a.y, width: el.w, height: el.h, rotate: degrees(a.rotate), opacity });
}

async function drawMedia(doc, page, g, el) {
  const png = await doc.embedPng(await mediaCardPng(el));
  placeImage(page, g, el, png);
  if (el.source === 'url' && el.url) {
    addLinkAnnot(doc, page, g.rectToPdf(el), el.url);
  } else if (el.source === 'file' && el.file) {
    // 把影音檔嵌入成附件，並在卡片右上角放一個附件圖示（PDF 閱讀器點它就能播放 / 存檔）
    await doc.attach(el.file.bytes, el.file.name, { mimeType: el.file.mime || 'application/octet-stream', description: el.displayTitle });
    const fsRef = doc.embeddedFiles[doc.embeddedFiles.length - 1].ref;
    const s = Math.min(22, el.h * 0.25);
    const rect = g.rectToPdf({ x: el.x + el.w - s - 4, y: el.y + 4, w: s, h: s });
    const ctx = doc.context;
    page.node.addAnnot(ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'FileAttachment', Rect: rect, FS: fsRef, Name: 'Paperclip', F: 4,
      C: [0.118, 0.388, 0.914], Contents: PDFHexString.fromText(`${el.displayTitle}（點兩下開啟附件）`),
    })));
  }
}
