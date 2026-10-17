// =====================================================================
// 字型服務（FontLibrary）
//
// 比喻：一間「活字印刷行」。
//   - 粉圓字型（jf open 粉圓，約 5MB）是整套鉛字，第一次需要時才去搬回來。
//   - 印 PDF 時不會把整套鉛字都塞進去，只挑「這次用到的字」（HarfBuzz 子集化），
//     所以加幾個中文字，PDF 只會多十幾 KB。
//   - 畫面預覽也用同一套字型，所以看到的和印出來的一樣。
//
// 為什麼不用 pdf-lib 內建的子集化？它處理這套 CJK 字型會掉字，
// 所以先用 HarfBuzz 切好，再請 pdf-lib 完整嵌入切好的小字型。
// =====================================================================
import { HARFBUZZ_SUBSET_WASM, fontkit } from './libs.js';

const HUNINN_SOURCES = [
  'fonts/jf-openhuninn-2.1.ttf',                                                                   // GitHub Pages 上的同站檔案
  'https://cdn.jsdelivr.net/gh/achir1015/xiaoke-pdf@main/assets/fonts/jf-openhuninn-2.1.ttf',       // 備援：直接讀倉庫裡的字型
];

/** 網頁預覽用的 CSS 字型堆疊（標準字型缺字時退回粉圓，與匯出時的行為一致） */
export const FONT_CSS = {
  huninn: "'XKHuninn', 'PingFang TC', 'Microsoft JhengHei', sans-serif",
  Helvetica: "Helvetica, Arial, 'XKHuninn', sans-serif",
  Times: "'Times New Roman', Times, 'XKHuninn', serif",
  Courier: "'Courier New', Courier, 'XKHuninn', monospace",
};

export const FONT_NAMES = {
  huninn: '粉圓體（中文）',
  Helvetica: 'Helvetica（無襯線）',
  Times: 'Times（有襯線）',
  Courier: 'Courier（等寬）',
};

export class FontLibrary {
  constructor() {
    this.huninnBytes = null;
    this._huninnPromise = null;
    this._hb = null;
    this._baselineCache = new Map();
  }

  get huninnReady() { return !!this.huninnBytes; }

  /** 載入粉圓字型（只會載一次）。同時註冊成網頁字型給預覽用。 */
  loadHuninn() {
    if (!this._huninnPromise) {
      this._huninnPromise = (async () => {
        let lastErr;
        for (const url of HUNINN_SOURCES) {
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(res.status + ' ' + url);
            this.huninnBytes = new Uint8Array(await res.arrayBuffer());
            break;
          } catch (e) { lastErr = e; }
        }
        if (!this.huninnBytes) { this._huninnPromise = null; throw lastErr || new Error('字型下載失敗'); }
        try {
          const face = new FontFace('XKHuninn', this.huninnBytes.slice().buffer);
          await face.load();
          document.fonts.add(face);
        } catch (e) { console.warn('預覽字型註冊失敗', e); }
        this._baselineCache.clear();
        return this.huninnBytes;
      })();
    }
    return this._huninnPromise;
  }

  /**
   * 檢查粉圓字型缺哪些字（例如 emoji、罕用字）。
   * 回傳 { text: 去掉缺字後的文字, missing: 缺的字元陣列 }
   */
  async filterSupported(text) {
    await this.loadHuninn();
    if (!this._fk) this._fk = fontkit.create(this.huninnBytes);
    const missing = new Set();
    let out = '';
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      if (ch === '\n' || cp === 0xFE0F || cp === 0x200D || this._fk.hasGlyphForCodePoint(cp)) { if (cp !== 0xFE0F && cp !== 0x200D) out += ch; }
      else missing.add(ch);
    }
    return { text: out, missing: [...missing] };
  }

  /** 粉圓字型有沒有這個字（字型還沒載入時當作沒有） */
  hasGlyph(ch) {
    if (!this.huninnBytes) return false;
    if (!this._fk) this._fk = fontkit.create(this.huninnBytes);
    return this._fk.hasGlyphForCodePoint(ch.codePointAt(0));
  }

  /** 只保留 text 用到的字，回傳一個小小的 TrueType 字型 */
  async subsetHuninn(text) {
    const full = await this.loadHuninn();
    const hb = await this._harfbuzz();
    const chars = new Set([...String(text)]);
    chars.add(' '); chars.add('?');
    const ptr = hb.malloc(full.length);
    new Uint8Array(hb.memory.buffer).set(full, ptr);
    const blob = hb.hb_blob_create(ptr, full.length, 2 /* 可寫入模式 */, 0, 0);
    const face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    const input = hb.hb_subset_input_create_or_fail();
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const ch of chars) hb.hb_set_add(unicodes, ch.codePointAt(0));
    const sub = hb.hb_subset_or_fail(face, input);
    hb.hb_subset_input_destroy(input);
    if (!sub) { hb.free(ptr); throw new Error('字型子集化失敗'); }
    const resBlob = hb.hb_face_reference_blob(sub);
    const off = hb.hb_blob_get_data(resBlob, 0), len = hb.hb_blob_get_length(resBlob);
    const out = new Uint8Array(hb.memory.buffer).slice(off, off + len);   // 記憶體可能變大，所以每次重新取 buffer
    hb.hb_blob_destroy(resBlob);
    hb.free(ptr);
    return out;
  }

  async _harfbuzz() {
    if (!this._hb) {
      const res = await fetch(HARFBUZZ_SUBSET_WASM);
      const { instance } = await WebAssembly.instantiate(await res.arrayBuffer());
      this._hb = instance.exports;
    }
    return this._hb;
  }

  /**
   * 量測「基線」離行頂端的距離（佔字級的比例）。
   * 匯出時用它把 PDF 文字放在和網頁預覽一模一樣的位置。
   */
  baselineRatio(font, lineHeight) {
    const key = font + '|' + lineHeight + '|' + (this.huninnReady ? 1 : 0);
    if (this._baselineCache.has(key)) return this._baselineCache.get(key);
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:-9999px;top:0;padding:0;margin:0;white-space:pre;font-family:${FONT_CSS[font] || FONT_CSS.huninn};font-size:100px;line-height:${lineHeight}`;
    box.innerHTML = 'Hg國<span style="display:inline-block;width:1px;height:0;vertical-align:baseline"></span>';
    document.body.appendChild(box);
    const ratio = box.lastChild.offsetTop / 100;
    box.remove();
    this._baselineCache.set(key, ratio);
    return ratio;
  }
}

export const fonts = new FontLibrary();
