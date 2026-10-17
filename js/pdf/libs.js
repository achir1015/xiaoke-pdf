// =====================================================================
// 第三方函式庫的單一入口
// 網址集中在 index.html 的 importmap，這裡只負責匯入與基本設定。
// =====================================================================
import * as pdfjs from 'pdfjs-dist';
import * as PDFLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';

// pdf.js 的背景執行緒（解析 PDF 用），和主程式同一個版本
pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/worker');

export { pdfjs, PDFLib, fontkit, qrcode };

/** HarfBuzz 字型子集化 wasm 的位置（也放在 importmap 裡統一管理） */
export const HARFBUZZ_SUBSET_WASM = import.meta.resolve('harfbuzz-subset.wasm');
