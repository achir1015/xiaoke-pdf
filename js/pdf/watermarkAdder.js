// =====================================================================
// 加入浮水印（WatermarkAdder）
//
// 比喻：在每一頁蓋一個「半透明印章」，而且印章外面套一個標籤
//   /Artifact <</Type /Pagination /Subtype /Watermark>>
// 這是 PDF 規範的浮水印標記，Acrobat 和小柯 App 都認得，
// 之後想拿掉時，「去除浮水印 → 標準浮水印」就能乾淨移除，不傷到正文。
// =====================================================================
import { PDFLib, fontkit } from './libs.js';
import { fonts } from './fonts.js';
import { N } from './pdfObjects.js';
import { parsePageRange, hexToRgb } from './util.js';

const { PDFDocument, PDFOperator, StandardFonts, rgb, degrees, PDFArray } = PDFLib;

/**
 * @typedef {object} WatermarkSpec
 * @property {'text'|'image'} kind
 * @property {string} text
 * @property {string} font        huninn | Helvetica | Times | Courier
 * @property {number} size        字級（pt）
 * @property {string} color       #rrggbb
 * @property {boolean} bold
 * @property {number} opacity     0~1
 * @property {number} angle       顯示上的角度（逆時針，度）
 * @property {'center'|'tile'|'top'|'bottom'} layout
 * @property {string} pages       '' 或 'all' 代表全部，或 '1-3,5'
 * @property {'over'|'under'} layer  蓋在內容上方，或墊在下方
 * @property {{bytes:Uint8Array,mime:string}} image
 * @property {number} imageScale  圖片寬度佔頁寬比例 0~1
 */

export const DEFAULT_WATERMARK = {
  kind: 'text', text: '機密文件', font: 'huninn', size: 60, color: '#d93025', bold: false,
  opacity: 0.18, angle: 45, layout: 'center', pages: '', layer: 'over', image: null, imageScale: 0.45,
};

/**
 * @param {Uint8Array} bytes 目前的底稿
 * @param {import('../domain/page.js').PageGeometry[]} geoms 每頁的幾何資訊
 * @param {WatermarkSpec} spec
 */
export async function addWatermark(bytes, geoms, spec) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const targets = parsePageRange(spec.pages, pages.length);
  if (!targets.length) throw new Error('頁碼範圍沒有對應到任何頁面');

  // 準備「印章」：文字字型或圖片
  let font = null, image = null;
  if (spec.kind === 'text') {
    if (!spec.text.trim()) throw new Error('請輸入浮水印文字');
    if (spec.font === 'huninn' || !isWinAnsi(spec.text)) spec = { ...spec, text: (await fonts.filterSupported(spec.text)).text };
    if (!spec.text.trim()) throw new Error('浮水印文字的字元字型都不支援');
    font = await embedFontFor(doc, spec.font, spec.text);
  } else {
    if (!spec.image) throw new Error('請先選擇浮水印圖片');
    image = /png/i.test(spec.image.mime) ? await doc.embedPng(spec.image.bytes) : await doc.embedJpg(spec.image.bytes);
  }

  const color = hexToRgb(spec.color);
  for (const i of targets) {
    const page = pages[i];
    const g = geoms[i];
    const stamp = makeStamp(spec, font, image, g);
    const centers = layoutCenters(spec.layout, g, stamp, spec.angle);

    // 浮水印單獨放在一個新的內容串流裡（方便「墊在下方」時移到最前面）
    page.getContentStream(false);
    page.pushOperators(PDFOperator.of('BDC', [N('Artifact'), doc.context.obj({ Type: 'Pagination', Subtype: 'Watermark' })]));
    for (const [cx, cy] of centers) {
      const [px, py] = g.toPdf(cx, cy);
      const phi = ((g.rotation + spec.angle) * Math.PI) / 180;   // PDF 座標中的實際角度
      // 讓印章的「中心」落在 (cx, cy)：從中心往回推到左下角錨點
      const ox = px - (Math.cos(phi) * stamp.w) / 2 + (Math.sin(phi) * stamp.hc);
      const oy = py - (Math.sin(phi) * stamp.w) / 2 - (Math.cos(phi) * stamp.hc);
      const rot = degrees(g.rotation + spec.angle);
      if (font) {
        if (spec.bold) {
          // 粗體＝填色加描邊。drawText 的 opacity 只管填色，描邊的透明度要自己設定
          const gs = page.node.newExtGState('XKWm', doc.context.obj({ Type: 'ExtGState', CA: spec.opacity, ca: spec.opacity }));
          page.pushOperators(
            PDFOperator.of('gs', [gs]),
            PDFOperator.of('Tr', [doc.context.obj(2)]),
            PDFOperator.of('w', [doc.context.obj(spec.size * 0.035)]),
            PDFOperator.of('RG', [color.red, color.green, color.blue].map(v => doc.context.obj(v))));
        }
        page.drawText(spec.text, { x: ox, y: oy, size: spec.size, font, color: rgb(color.red, color.green, color.blue), opacity: spec.opacity, rotate: rot, lineHeight: spec.size * 1.2 });
        if (spec.bold) page.pushOperators(PDFOperator.of('Tr', [doc.context.obj(0)]));
      } else {
        page.drawImage(image, { x: ox, y: oy, width: stamp.w, height: stamp.h, opacity: spec.opacity, rotate: rot });
      }
    }
    page.pushOperators(PDFOperator.of('EMC', []));

    if (spec.layer === 'under') moveLastContentToFront(page);
  }
  return doc.save({ useObjectStreams: false });
}

/** 印章的尺寸。hc＝從底邊到「視覺中心」的高度（文字用字身的一半，圖片用高度的一半） */
function makeStamp(spec, font, image, g) {
  if (font) {
    const lines = spec.text.split('\n');
    const w = Math.max(...lines.map(l => font.widthOfTextAtSize(l, spec.size)));
    const h = spec.size * (1 + 1.2 * (lines.length - 1));
    // drawText 的錨點是第一行基線；多行時往下長，所以中心要往上移
    const hc = spec.size * 0.35 - (spec.size * 1.2 * (lines.length - 1)) / 2;
    return { w, h, hc };
  }
  const w = g.width * spec.imageScale;
  const h = (w * image.height) / image.width;
  return { w, h, hc: h / 2 };
}

/** 依版面計算每個印章的中心點（顯示座標）。畫面預覽也用這支，所以預覽和成品位置一致 */
export function layoutCenters(layout, g, stamp, angle) {
  const W = g.width, H = g.height;
  if (layout === 'top') return [[W / 2, Math.max(stamp.h, 40)]];
  if (layout === 'bottom') return [[W / 2, H - Math.max(stamp.h, 40)]];
  if (layout !== 'tile') return [[W / 2, H / 2]];
  const a = (Math.abs(angle) * Math.PI) / 180;
  const bw = Math.abs(Math.cos(a)) * stamp.w + Math.abs(Math.sin(a)) * stamp.h;
  const bh = Math.abs(Math.sin(a)) * stamp.w + Math.abs(Math.cos(a)) * stamp.h;
  const gap = Math.max(stamp.h * 1.5, 36);
  const sx = bw + gap, sy = bh + gap;
  const out = [];
  let row = 0;
  for (let y = sy / 2; y < H + sy / 2; y += sy, row++) {
    for (let x = (row % 2 ? sx : sx / 2); x < W + sx / 2; x += sx) out.push([x, y]);
  }
  return out;
}

/** 墊在下方：把剛剛畫的內容串流移到最前面，讓原本的內容蓋在它上面 */
function moveLastContentToFront(page) {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray) || contents.size() < 2) return;
  const last = contents.get(contents.size() - 1);
  contents.remove(contents.size() - 1);
  contents.insert(0, last);
}

const isWinAnsi = (t) => /^[\x20-\x7e\xa0-\xff\n]*$/.test(t);

/** 嵌入字型：標準字型不支援的字（例如中文）自動改用粉圓 */
export async function embedFontFor(doc, fontKey, text) {
  if (fontKey !== 'huninn') {
    const std = await doc.embedFont(StandardFonts[fontKey] || StandardFonts.Helvetica);
    try { std.encodeText(text.replace(/\n/g, '')); return std; } catch (e) { /* 有標準字型印不出的字 */ }
  }
  doc.registerFontkit(fontkit);
  const sub = await fonts.subsetHuninn(text);
  return doc.embedFont(sub, { subset: false });
}
