// =====================================================================
// 字型解碼器（FontDecoder）
//
// 比喻：PDF 裡的文字常常不是直接存「機密」，而是存「字碼 0x1A2B 0x0F31」，
// 就像密碼本一樣。每個字型會附一本對照表（ToUnicode CMap），
// 這裡負責查表把字碼翻回真正的文字，好讓我們判斷「這段是不是浮水印字樣」。
// =====================================================================
import { get, nameOf, streamText, PDFDict, PDFArray } from './pdfObjects.js';

export class FontDecoder {
  constructor(fontDict, ctx) {
    this.composite = nameOf(get(fontDict, 'Subtype', ctx)) === 'Type0';
    this.codespace = [];         // [{ len, lo, hi }]
    this.map = new Map();        // 'len:code' → 文字
    this.diff = new Map();       // 單位元組字型的 Differences 編碼
    const tu = get(fontDict, 'ToUnicode', ctx);
    if (tu && tu.dict) {
      try { this._parseCMap(streamText(tu)); } catch (e) { /* 對照表壞掉就放棄 */ }
    }
    if (!this.composite) this._parseDifferences(get(fontDict, 'Encoding', ctx), ctx);
    if (!this.codespace.length) {
      this.codespace = this.composite ? [{ len: 2, lo: 0, hi: 0xffff }] : [{ len: 1, lo: 0, hi: 0xff }];
    }
    this.codespace.sort((a, b) => a.len - b.len);
  }

  /** 把字串（latin1，一字元一位元組）解碼成文字 */
  decode(bytes) {
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      let matched = false;
      for (const cs of this.codespace) {
        if (i + cs.len > bytes.length) continue;
        let code = 0;
        for (let k = 0; k < cs.len; k++) code = code * 256 + bytes.charCodeAt(i + k);
        if (code < cs.lo || code > cs.hi) continue;
        out += this._lookup(cs.len, code);
        i += cs.len;
        matched = true;
        break;
      }
      if (!matched) { out += this._lookup(1, bytes.charCodeAt(i)); i++; }
    }
    return out;
  }

  _lookup(len, code) {
    const u = this.map.get(len + ':' + code);
    if (u !== undefined) return u;
    if (!this.composite && len === 1) {
      if (this.diff.has(code)) return this.diff.get(code);
      return String.fromCharCode(code);  // 近似 WinAnsi，英數字足夠
    }
    return '';
  }

  _parseCMap(txt) {
    const hexToInt = (h) => parseInt(h, 16);
    const utf16 = (h) => {
      let s = '';
      for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.substr(k, 4), 16));
      if (h.length === 2) s = String.fromCharCode(parseInt(h, 16));
      return s;
    };
    for (const block of txt.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
      for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        this.codespace.push({ len: Math.ceil(m[1].length / 2), lo: hexToInt(m[1]), hi: hexToInt(m[2]) });
      }
    }
    for (const block of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
        this.map.set(Math.ceil(m[1].length / 2) + ':' + hexToInt(m[1]), utf16(m[2]));
      }
    }
    for (const block of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
      for (const m of block[1].matchAll(re)) {
        const len = Math.ceil(m[1].length / 2);
        const lo = hexToInt(m[1]), hi = hexToInt(m[2]);
        if (hi < lo || hi - lo > 65535) continue;
        if (m[3] !== undefined) {
          // 連續範圍：最後一個 UTF-16 單位遞增
          const base = m[3];
          const head = base.slice(0, -4), last = parseInt(base.slice(-4) || '0', 16);
          for (let c = lo; c <= hi; c++) {
            const v = (last + (c - lo)).toString(16).padStart(4, '0');
            this.map.set(len + ':' + c, utf16(head + v));
          }
        } else {
          const items = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].map(x => x[1]);
          items.forEach((h, k) => { if (lo + k <= hi) this.map.set(len + ':' + (lo + k), utf16(h)); });
        }
      }
    }
  }

  _parseDifferences(enc, ctx) {
    if (!(enc instanceof PDFDict)) return;
    const diffs = get(enc, 'Differences', ctx);
    if (!(diffs instanceof PDFArray)) return;
    let code = 0;
    for (let k = 0; k < diffs.size(); k++) {
      const v = diffs.lookup(k);
      if (typeof v.asNumber === 'function') { code = v.asNumber(); continue; }
      const nm = nameOf(v);
      if (nm) {
        const u = glyphNameToChar(nm);
        if (u) this.diff.set(code, u);
        code++;
      }
    }
  }
}

function glyphNameToChar(name) {
  if (name.length === 1) return name;
  let m = name.match(/^uni([0-9A-Fa-f]{4})$/);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = name.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  const common = { space: ' ', period: '.', comma: ',', hyphen: '-', colon: ':', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  return common[name] || '';
}
