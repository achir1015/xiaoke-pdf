// =====================================================================
// PDF 內容串流解析器
//
// 比喻：PDF 頁面其實是一份「繪圖食譜」，例如：
//     /F1 12 Tf  100 700 Td  (Hello) Tj
// 意思是「用 F1 字型 12 號 → 移到 (100,700) → 寫出 Hello」。
// 這裡把食譜拆成一道道「步驟」(op)，每個步驟記得自己在原文的起訖位置，
// 移除浮水印時只要把不要的步驟剪掉，其他部分原封不動地接回去。
//
// 全程用 latin1 字串處理（一個字元＝一個位元組），二進位資料不會被破壞。
// =====================================================================

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map(c => c.charCodeAt(0)));

export function bytesToLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
}

export function latin1ToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * 解析內容串流，回傳步驟清單。
 * 每個步驟：{ op: 'Tj', args: [值...], start, end }
 * 值的形式：{ t: 'num'|'name'|'str'|'arr'|'dict'|'kw', v }
 */
export function parseContent(src) {
  const ops = [];
  let i = 0;
  const n = src.length;
  let args = [];
  let argStart = -1;

  const skipWs = () => {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (WS.has(c)) i++;
      else if (c === 37 /* % 註解 */) { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; }
      else break;
    }
  };

  const readValue = () => {
    skipWs();
    const c = src[i];
    if (c === '(') return readLiteral();
    if (c === '<') {
      if (src[i + 1] === '<') return readDict();
      return readHex();
    }
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (src[i] === ']') { i++; break; }
        const v = readValue();
        if (v === null) { i++; continue; }        // 異常字元，跳過避免無窮迴圈
        arr.push(v);
      }
      return { t: 'arr', v: arr };
    }
    if (c === '/') {
      i++;
      const s = i;
      while (i < n && !WS.has(src.charCodeAt(i)) && !DELIM.has(src.charCodeAt(i))) i++;
      return { t: 'name', v: decodeName(src.slice(s, i)) };
    }
    if (c === '{' || c === '}' || c === ')' || c === '>' || c === ']') { i++; return { t: 'kw', v: c }; }
    // 數字或關鍵字
    const s = i;
    while (i < n && !WS.has(src.charCodeAt(i)) && !DELIM.has(src.charCodeAt(i))) i++;
    if (i === s) return null;
    const word = src.slice(s, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word) };
    return { t: 'kw', v: word };
  };

  const readLiteral = () => {
    i++; // (
    let depth = 1, out = '';
    while (i < n) {
      const c = src[i++];
      if (c === '\\') {
        const e = src[i++];
        if (e === 'n') out += '\n'; else if (e === 'r') out += '\r'; else if (e === 't') out += '\t';
        else if (e === 'b') out += '\b'; else if (e === 'f') out += '\f';
        else if (e === '\r') { if (src[i] === '\n') i++; }
        else if (e === '\n') { /* 續行 */ }
        else if (e >= '0' && e <= '7') {
          let oct = e;
          while (oct.length < 3 && src[i] >= '0' && src[i] <= '7') oct += src[i++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else out += e;
      } else if (c === '(') { depth++; out += c; }
      else if (c === ')') { if (--depth === 0) break; out += c; }
      else out += c;
    }
    return { t: 'str', v: out };
  };

  const readHex = () => {
    i++; // <
    let hex = '';
    while (i < n && src[i] !== '>') { if (/[0-9a-fA-F]/.test(src[i])) hex += src[i]; i++; }
    i++; // >
    if (hex.length % 2) hex += '0';
    let out = '';
    for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
    return { t: 'str', v: out };
  };

  const readDict = () => {
    i += 2; // <<
    const dict = {};
    for (;;) {
      skipWs();
      if (i >= n) break;
      if (src[i] === '>' && src[i + 1] === '>') { i += 2; break; }
      const k = readValue();
      if (!k) { i++; continue; }
      if (k.t !== 'name') continue;
      dict[k.v] = readValue();
    }
    return { t: 'dict', v: dict };
  };

  while (i < n) {
    skipWs();
    if (i >= n) break;
    const tokStart = i;
    const v = readValue();
    if (v === null) { i++; continue; }
    if (v.t === 'kw' && !['true', 'false', 'null', '{', '}', ')', '>', ']'].includes(v.v)) {
      const op = v.v;
      const start = argStart >= 0 ? argStart : tokStart;
      if (op === 'BI') {
        // 內嵌圖片：BI <參數> ID <二進位資料> EI
        const idx = findInlineImageEnd(src, i);
        i = idx;
        ops.push({ op: 'BI', args: [], start, end: i });
      } else {
        ops.push({ op, args, start, end: i });
      }
      args = []; argStart = -1;
    } else {
      if (argStart < 0) argStart = tokStart;
      args.push(v);
    }
  }
  return ops;
}

function findInlineImageEnd(src, from) {
  const id = src.indexOf('ID', from);
  if (id < 0) return src.length;
  let k = id + 3;
  const re = /[\s]EI(?=[\s]|$)/g;
  re.lastIndex = k;
  const m = re.exec(src);
  return m ? m.index + 3 : src.length;
}

function decodeName(s) {
  return s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** 把保留下來的步驟接回一份內容串流 */
export function joinOps(src, ops) {
  return ops.map(o => src.slice(o.start, o.end)).join('\n') + '\n';
}
