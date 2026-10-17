// =====================================================================
// OCR 文字辨識（Tesseract）
//
// 比喻：有些 PDF 的字其實是「畫」上去的——掃描檔是照片，
// WPS／某些印表機匯出時會把字轉成「外框線條」。這種頁面裡沒有文字，
// 所以要請一位「抄寫員」看著頁面把字抄下來，告訴我們每一行在哪裡、寫了什麼。
//
// 抄寫員（Tesseract）第一次使用時才從網路下載（程式約 4 MB、中文資料約 1.6 MB），
// 辨識全程在瀏覽器裡進行，頁面不會上傳。
// 辨識難免有錯字，所以辨識出的文字會放進編輯框，讓使用者修正後再存。
// =====================================================================

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js';
const WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
const CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2';
const LANG_DATA = {
  vertical: { lang: 'chi_tra_vert', path: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra_vert@1.0.0/4.0.0_best_int' },
  horizontal: { lang: 'chi_tra', path: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra@1.0.0/4.0.0_best_int' },
};

/** 每 pt 幾個像素：約 216 dpi，中文筆畫才看得清楚 */
export const OCR_SCALE = 3;

const workers = {};

async function workerFor(direction, onProgress) {
  if (!workers[direction]) {
    workers[direction] = (async () => {
      const mod = await import(TESSERACT);
      const { createWorker } = mod.default || mod;      // 這個套件只有 default 匯出
      const { lang, path } = LANG_DATA[direction];
      const w = await createWorker(lang, 1 /* LSTM */, {
        workerPath: WORKER, corePath: CORE, langPath: path,
        logger: (m) => onProgress?.(m),
      });
      // 直書用「一整欄直書文字」模式，橫書用「自動分段」
      await w.setParameters({ tessedit_pageseg_mode: direction === 'vertical' ? '5' : '3', preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => { delete workers[direction]; throw e; });
  }
  return workers[direction];
}

/**
 * 猜這一頁是直書還是橫書：看墨跡在「直的方向」還是「橫的方向」比較常斷開。
 * 直書：每一直行之間有空白縫 → 左右方向的投影常斷開。
 */
export function guessDirection(canvas) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const d = g.getImageData(0, 0, W, H).data;
  const colInk = new Uint32Array(W), rowInk = new Uint32Array(H);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const k = (y * W + x) * 4;
    if (d[k] + d[k + 1] + d[k + 2] < 384) { colInk[x]++; rowInk[y]++; }
  }
  // 計算「有字 → 空白 → 有字」的縫有幾條（空白縫寬度至少 3 像素）
  const gaps = (arr) => {
    let n = 0, blank = 0, seen = false;
    for (let i = 0; i < arr.length; i += 2) {
      if (arr[i] === 0) blank++;
      else { if (seen && blank >= 2) n++; seen = true; blank = 0; }
    }
    return n;
  };
  const vGaps = gaps(colInk) / W, hGaps = gaps(rowInk) / H;    // 每像素的縫數
  return vGaps > hGaps * 1.15 ? 'vertical' : 'horizontal';
}

/**
 * 辨識一張畫好的頁面，回傳和 renderer.textLines 一樣格式的文字行（顯示座標，pt）
 * @param {HTMLCanvasElement} canvas 以 OCR_SCALE 畫好的頁面
 * @param {'vertical'|'horizontal'} direction
 */
export async function recognize(canvas, direction, onProgress) {
  const w = await workerFor(direction, onProgress);
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
  const k = OCR_SCALE;
  const out = [];
  for (const block of data.blocks || []) for (const para of block.paragraphs || []) for (const line of para.lines || []) {
    const text = cleanText(line.text);
    if (!text || line.confidence < 20) continue;
    const { x0, y0, x1, y1 } = line.bbox;
    const x = x0 / k, y = y0 / k, wd = (x1 - x0) / k, ht = (y1 - y0) / k;
    if (direction === 'vertical' && ht > wd * 0.8) {
      // 直行：字身寬度約等於一個字的寬（墨跡比字框窄一點）
      const size = Math.max(6, wd / 0.92);
      out.push({ vertical: true, ocr: true, x, y, w: wd, h: ht, size, cx: x + wd / 2, baseline: y, text, parts: [{ x, w: wd, text }] });
    } else {
      const size = Math.max(6, ht / 0.95);
      out.push({ ocr: true, x, y, w: wd, h: ht, size, baseline: y + ht * 0.88, text, parts: [{ x, w: wd, text }] });
    }
  }
  if (direction === 'vertical') out.sort((a, b) => b.x - a.x || a.y - b.y);
  return out;
}

const FULLWIDTH = { ',': '，', ':': '：', ';': '；', '!': '！', '?': '？', '(': '（', ')': '）' };

/** 整理辨識結果：中文字之間的空白拿掉；中文旁邊的半形標點換成全形 */
export function cleanText(t) {
  return String(t || '').replace(/\s+/g, ' ').trim()
    .replace(/(?<=[⺀-鿿＀-￯　-〿]) (?=[⺀-鿿＀-￯　-〿])/g, '')
    .replace(/(?<=[⺀-鿿＀-￯　-〿])[,:;!?()]|[,:;!?()](?=[⺀-鿿＀-￯　-〿])/g, (c) => FULLWIDTH[c])
    .replace(/(?<=[⺀-鿿])\.(?=[⺀-鿿]|$)/g, '。');
}
