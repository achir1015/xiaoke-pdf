// =====================================================================
// 表格撐高（RowGrow）——把頁面上某個區域裡的內容整個搬移
//
// 用途：表格儲存格裡的文字變長時，把那一列撐高（下框線、下面的列、文字、圖片一起往下）；
//       插入新的一列（往下移）、插入新的一欄（表格範圍內、右邊的內容往右移）、插入表格（往下移）。
// 做法：沿著內容串流追蹤座標轉換（CTM）與文字矩陣，
//   • 路徑（框線、底色）：落在搬移區的點跟著移；跨過邊界的線會被拉長（列變高、表格變寬）
//   • 文字：起筆點在搬移區的那幾行，改用移動過的文字矩陣
//   • 圖片、表單物件（Do）、內嵌圖片：整個在搬移區裡就跟著移
// 這個檔案不依賴其他模組（網頁版與線上版共用）。
// =====================================================================

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

function tokenize(s) {
  let i = 0;
  const n = s.length;
  const skip = () => {
    for (;;) {
      while (i < n && WS.has(s.charCodeAt(i))) i++;
      if (s[i] === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      break;
    }
  };
  const obj = () => {
    skip();
    if (i >= n) return null;
    const st = i, c = s[i];
    if (c === '(') {
      let depth = 0;
      for (; i < n; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      }
      return { k: 'str', raw: s.slice(st, i) };
    }
    if (c === '<' && s[i + 1] === '<') {
      i += 2;
      for (;;) { skip(); if (s[i] === '>' && s[i + 1] === '>') { i += 2; break; } if (i >= n) break; if (!obj()) break; }
      return { k: 'dict', raw: s.slice(st, i) };
    }
    if (c === '<') { const e = s.indexOf('>', i); i = (e < 0 ? n : e) + 1; return { k: 'hex', raw: s.slice(st, i) }; }
    if (c === '[') {
      i++;
      for (;;) { skip(); if (s[i] === ']') { i++; break; } if (i >= n) break; if (!obj()) break; }
      return { k: 'arr', raw: s.slice(st, i) };
    }
    if (c === '/') { i++; while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++; return { k: 'name', raw: s.slice(st, i) }; }
    while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
    if (i === st) { i++; return { k: 'kw', raw: s[st] }; }
    const w = s.slice(st, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { k: 'num', raw: w, v: parseFloat(w) };
    return { k: 'op', raw: w, v: w };
  };
  const out = [];
  for (;;) {
    const t = obj();
    if (!t) break;
    out.push(t);
    if (t.k === 'op' && t.v === 'ID') {
      const st = i + 1;
      let e = st;
      for (;;) {
        e = s.indexOf('EI', e);
        if (e < 0) { e = n; break; }
        if (WS.has(s.charCodeAt(e - 1)) && (e + 2 >= n || WS.has(s.charCodeAt(e + 2)))) break;
        e += 2;
      }
      out.push({ k: 'data', raw: s.slice(st, e) });
      i = e;
    }
  }
  return out;
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const inv = m => {
  const d = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
};
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** 使用者空間的位移向量 → 某個座標系（m 為該座標系到使用者空間）裡的位移 */
const vecIn = (m, ux, uy) => { const k = inv(m); return [k[0] * ux + k[2] * uy, k[1] * ux + k[3] * uy]; };
const f = v => (Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000);
const I = [1, 0, 0, 1, 0, 0];
const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);

/**
 * 把搬移區裡的內容移動 (ux, uy)。
 * @param {string} src 內容串流（latin1 字串，已解碼）
 * @param {object} o
 *   o.moves(x, y)：PDF 使用者座標的點是否在搬移區裡（呼叫端用顯示座標判斷）
 *   o.ux, o.uy：位移向量（PDF 使用者座標；沒旋轉的頁面往下移 dy 是 [0, -dy]）
 * @returns {string|null} 新的內容串流；沒有任何東西需要移動時回傳 null
 */
export function shiftContent(src, o) {
  const toks = tokenize(src);
  const out = [];
  let ops = [];
  let ctm = I;
  const stack = [];
  let tm = I, tlm = I, tl = 0, fs = 10, applied = false;
  let path = [];                  // 目前路徑：[{ops, op, pts:[[x,y]...], kind}]
  let changed = false;
  let bi = -1;                    // 內嵌圖片 BI 在 out 裡的位置

  const isBelow = (x, y) => { const p = apply(ctm, x, y); return o.moves(p[0], p[1]); };
  const moved = (x, y) => { const d = vecIn(ctm, o.ux, o.uy); return [x + d[0], y + d[1]]; };
  // 讓「目前 CTM 之後」再往下移的 cm：M = CTM·T·CTM⁻¹
  const shiftCm = () => {
    const T = [1, 0, 0, 1, o.ux, o.uy];
    const M = mul(mul(ctm, T), inv(ctm));
    return { k: 'op', raw: `${M.map(f).join(' ')} cm` };
  };
  const num = k => (ops[k] && ops[k].k === 'num' ? ops[k].v : 0);

  const flushPath = (paintTok) => {
    // 決定每個點要不要往下移，必要時改寫路徑
    for (const seg of path) {
      const flags = seg.pts.map(p => isBelow(p[0], p[1]));
      if (!flags.some(Boolean)) { out.push(...seg.ops, seg.op); continue; }
      changed = true;
      const pts = seg.pts.map((p, k) => (flags[k] ? moved(p[0], p[1]) : p));
      if (seg.kind === 're') {
        // 矩形：四個角分開移動，改成 m l l l h
        out.push({ k: 'op', raw: `${f(pts[0][0])} ${f(pts[0][1])} m ${f(pts[1][0])} ${f(pts[1][1])} l ${f(pts[2][0])} ${f(pts[2][1])} l ${f(pts[3][0])} ${f(pts[3][1])} l h` });
      } else {
        out.push({ k: 'op', raw: `${pts.map(p => `${f(p[0])} ${f(p[1])}`).join(' ')} ${seg.op.raw}` });
      }
    }
    path = [];
    if (paintTok) out.push(paintTok);
  };

  for (const t of toks) {
    if (t.k !== 'op') { ops.push(t); continue; }
    const name = t.v;
    // 路徑建構
    if (name === 'm' || name === 'l') { path.push({ ops, op: t, pts: [[num(ops.length - 2), num(ops.length - 1)]], kind: name }); ops = []; continue; }
    if (name === 'c') { path.push({ ops, op: t, pts: [[num(0), num(1)], [num(2), num(3)], [num(4), num(5)]], kind: 'c' }); ops = []; continue; }
    if (name === 'v' || name === 'y') { path.push({ ops, op: t, pts: [[num(0), num(1)], [num(2), num(3)]], kind: name }); ops = []; continue; }
    if (name === 're') {
      const x = num(0), y = num(1), w = num(2), h = num(3);
      path.push({ ops, op: t, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], kind: 're' });
      ops = []; continue;
    }
    if (name === 'h') { path.push({ ops, op: t, pts: [], kind: 'h' }); ops = []; continue; }
    if (name === 'W' || name === 'W*') { path.push({ ops, op: t, pts: [], kind: 'W' }); ops = []; continue; }
    if (PAINT.has(name)) { flushPath(null); out.push(...ops, t); ops = []; continue; }
    if (path.length) flushPath(null);   // 不完整的路徑（不應該發生）

    switch (name) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() || I; break;
      case 'cm': if (ops.length >= 6) ctm = mul([0, 1, 2, 3, 4, 5].map(k => num(ops.length - 6 + k)), ctm); break;
      case 'BT': tm = tlm = I; applied = false; break;
      case 'Tf': if (ops.length >= 2) fs = Math.abs(num(ops.length - 1)) || fs; break;
      case 'TL': tl = num(ops.length - 1); break;
      case 'Td': tlm = mul([1, 0, 0, 1, num(ops.length - 2), num(ops.length - 1)], tlm); tm = tlm; break;
      case 'TD': tl = -num(ops.length - 1); tlm = mul([1, 0, 0, 1, num(ops.length - 2), num(ops.length - 1)], tlm); tm = tlm; break;
      case 'Tm': tlm = tm = [0, 1, 2, 3, 4, 5].map(k => num(ops.length - 6 + k)); applied = false; break;
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; break;
      case 'Tj': case 'TJ': case "'": case '"': {
        let pre = [];
        let showOps = ops, showTok = t;
        if (name === "'" || name === '"') {
          // 先換行再寫字：拆成 (Tw Tc) T* + Tj，才能在中間插入新的文字矩陣
          if (name === '"' && ops.length >= 3) pre.push(ops[0], { k: 'op', raw: 'Tw' }, ops[1], { k: 'op', raw: 'Tc' });
          pre.push({ k: 'op', raw: 'T*' });
          tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm;
          showOps = [ops[ops.length - 1]];
          showTok = { k: 'op', raw: 'Tj' };
        }
        const p = apply(tm, 0, fs * 0.3);
        const need = isBelow(p[0], p[1]);
        if (need !== applied) {
          // 改用（往下移的）文字矩陣；之後的 Td 都相對於它，所以同一段後面的字也會跟著移
          const lin = vecIn(ctm, o.ux, o.uy);   // Tm 的平移在 CTM 之前套用，所以位移要換算到 CTM 之前的座標
          const m = need ? [tm[0], tm[1], tm[2], tm[3], tm[4] + lin[0], tm[5] + lin[1]] : tm;
          out.push(...pre);
          pre = [];
          out.push({ k: 'op', raw: `${m.map(f).join(' ')} Tm` });
          applied = need;
          changed = true;
        }
        out.push(...pre, ...showOps, showTok);
        ops = [];
        continue;
      }
      case 'Do': case 'sh': {
        // 圖片或表單物件：用單位正方形的四個角判斷是否整個在分隔線以下
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
        if (corners.every(c => isBelow(c[0], c[1]))) {
          out.push({ k: 'op', raw: 'q' }, shiftCm(), ...ops, t, { k: 'op', raw: 'Q' });
          changed = true; ops = []; continue;
        }
        break;
      }
      case 'BI': bi = out.length + ops.length; break;
      case 'EI': {
        out.push(...ops, t); ops = [];
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
        if (bi >= 0 && corners.every(c => isBelow(c[0], c[1]))) {
          out.splice(bi, 0, { k: 'op', raw: 'q' }, shiftCm());
          out.push({ k: 'op', raw: 'Q' });
          changed = true;
        }
        bi = -1;
        continue;
      }
    }
    out.push(...ops, t);
    ops = [];
  }
  if (path.length) flushPath(null);
  out.push(...ops);
  if (!changed) return null;
  let s = '';
  for (const t of out) {
    if (t.k === 'data') { s += '\n' + t.raw; continue; }
    s += t.raw + (t.k === 'op' ? '\n' : ' ');
  }
  return s;
}

/** latin1 字串 ⇄ 位元組 */
export function toLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
}
export function fromLatin1(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

/**
 * 合併儲存格：把穿過合併區「內部」的框線剪掉（外框保留）。
 * 支援直線（m l）、外框矩形（re 描邊）、細長的實心矩形（當作線畫的框線）。
 * @param {string} src 內容串流（latin1 字串）
 * @param {object} o
 *   o.toDisp(x, y)：PDF 使用者座標 → 顯示座標 [X, Y]
 *   o.box：合併區內部（顯示座標）{ x1, y1, x2, y2 }，呼叫端已經往內縮一點
 * @returns {string|null}
 */
export function cutContent(src, o) {
  const toks = tokenize(src);
  const out = [];
  let ops = [];
  let ctm = I;
  const stack = [];
  let path = [];
  let changed = false;
  const { box } = o;
  const num = k => (ops[k] && ops[k].k === 'num' ? ops[k].v : 0);
  const D = (p) => { const u = apply(ctm, p[0], p[1]); return o.toDisp(u[0], u[1]); };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const P = p => `${f(p[0])} ${f(p[1])}`;

  /** 線段 a→b 被合併區內部蓋住的參數範圍 [t1, t2]；沒有就回傳 null（只處理水平、垂直線） */
  const cutRange = (a, b) => {
    const A = D(a), B = D(b);
    const vert = Math.abs(A[0] - B[0]) < 0.8, hori = Math.abs(A[1] - B[1]) < 0.8;
    if (!vert && !hori) return null;
    let fixed, va, vb, lo, hi;
    if (vert) { fixed = (A[0] + B[0]) / 2; if (fixed <= box.x1 || fixed >= box.x2) return null; va = A[1]; vb = B[1]; lo = box.y1; hi = box.y2; }
    else { fixed = (A[1] + B[1]) / 2; if (fixed <= box.y1 || fixed >= box.y2) return null; va = A[0]; vb = B[0]; lo = box.x1; hi = box.x2; }
    if (Math.abs(vb - va) < 1e-6) return null;
    let t1 = (lo - va) / (vb - va), t2 = (hi - va) / (vb - va);
    if (t1 > t2) [t1, t2] = [t2, t1];
    t1 = Math.max(0, t1); t2 = Math.min(1, t2);
    return t2 - t1 > 1e-4 ? [t1, t2] : null;
  };

  /** 線段 a→b（目前筆尖在 a）剪掉中間後的指令 */
  const cutLine = (a, b) => {
    const r = cutRange(a, b);
    if (!r) return null;
    let s = '';
    if (r[0] > 1e-4) s += `${P(lerp(a, b, r[0]))} l `;
    if (r[1] < 1 - 1e-4) s += `${P(lerp(a, b, r[1]))} m ${P(b)} l `;
    else s += `${P(b)} m `;
    return s;
  };

  const flushPath = (paint) => {
    const stroke = /^[SsBb]/.test(paint);
    let cur = null, start = null;
    const before = out.length;
    for (const seg of path) {
      if (seg.kind === 'm') { cur = start = seg.pts[0]; out.push(...seg.ops, seg.op); continue; }
      if (seg.kind === 'l' || seg.kind === 'h') {
        const b = seg.kind === 'h' ? start : seg.pts[0];
        const s = cur && b ? cutLine(cur, b) : null;
        if (s != null) { out.push({ k: 'op', raw: s.trim() }); changed = true; }
        else out.push(...seg.ops, seg.op);
        cur = b;
        continue;
      }
      if (seg.kind === 're') {
        const [p0, p1, p2, p3] = seg.pts;
        const d0 = D(p0), d2 = D(p2);
        const w = Math.abs(d2[0] - d0[0]), h = Math.abs(d2[1] - d0[1]);
        if (Math.min(w, h) < 3) {
          // 細長矩形＝一條框線：沿著長邊剪成兩段
          const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const long = w >= h ? [mid(p0, p3), mid(p1, p2)] : [mid(p0, p1), mid(p3, p2)];
          const r = cutRange(long[0], long[1]);
          if (r) {
            changed = true;
            const half = w >= h ? [(p3[0] - p0[0]) / 2, (p3[1] - p0[1]) / 2] : [(p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2];
            const piece = (t1, t2) => {
              const a = lerp(long[0], long[1], t1), b = lerp(long[0], long[1], t2);
              return `${P([a[0] - half[0], a[1] - half[1]])} m ${P([b[0] - half[0], b[1] - half[1]])} l ${P([b[0] + half[0], b[1] + half[1]])} l ${P([a[0] + half[0], a[1] + half[1]])} l h `;
            };
            let s = '';
            if (r[0] > 1e-4) s += piece(0, r[0]);
            if (r[1] < 1 - 1e-4) s += piece(r[1], 1);
            if (s) out.push({ k: 'op', raw: s.trim() });
            cur = start = p0;
            continue;
          }
        } else if (stroke) {
          // 描邊的矩形（每格一個框）：拆成四條邊再剪
          const edges = [[p0, p1], [p1, p2], [p2, p3], [p3, p0]];
          if (edges.some(([a, b]) => cutRange(a, b))) {
            changed = true;
            let s = `${P(p0)} m `;
            for (const [a, b] of edges) s += cutLine(a, b) ?? `${P(b)} l `;
            out.push({ k: 'op', raw: s.trim() });
            cur = start = p0;
            continue;
          }
        }
        out.push(...seg.ops, seg.op);
        cur = start = p0;
        continue;
      }
      out.push(...seg.ops, seg.op);
      if (seg.pts.length) cur = seg.pts[seg.pts.length - 1];
    }
    path = [];
    return out.length > before;   // 整個路徑都被剪掉時，繪製指令也要拿掉
  };

  for (const t of toks) {
    if (t.k !== 'op') { ops.push(t); continue; }
    const name = t.v;
    if (name === 'm' || name === 'l') { path.push({ ops, op: t, pts: [[num(ops.length - 2), num(ops.length - 1)]], kind: name }); ops = []; continue; }
    if (name === 'c') { path.push({ ops, op: t, pts: [[num(4), num(5)]], kind: 'c' }); ops = []; continue; }
    if (name === 'v' || name === 'y') { path.push({ ops, op: t, pts: [[num(2), num(3)]], kind: name }); ops = []; continue; }
    if (name === 're') {
      const x = num(0), y = num(1), w = num(2), h = num(3);
      path.push({ ops, op: t, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], kind: 're' });
      ops = []; continue;
    }
    if (name === 'h') { path.push({ ops, op: t, pts: [], kind: 'h' }); ops = []; continue; }
    if (name === 'W' || name === 'W*') { path.push({ ops, op: t, pts: [], kind: 'W' }); ops = []; continue; }
    if (PAINT.has(name)) {
      // 裁切路徑（W n）不要剪
      if (path.some(s => s.kind === 'W') || name === 'n') { for (const s of path) out.push(...s.ops, s.op); path = []; }
      else if (!flushPath(name)) { out.push(...ops); ops = []; continue; }
      out.push(...ops, t); ops = []; continue;
    }
    if (path.length) { for (const s of path) out.push(...s.ops, s.op); path = []; }
    if (name === 'q') stack.push(ctm);
    else if (name === 'Q') ctm = stack.pop() || I;
    else if (name === 'cm' && ops.length >= 6) ctm = mul([0, 1, 2, 3, 4, 5].map(k => num(ops.length - 6 + k)), ctm);
    out.push(...ops, t);
    ops = [];
  }
  for (const s of path) out.push(...s.ops, s.op);
  out.push(...ops);
  if (!changed) return null;
  let s = '';
  for (const t of out) {
    if (t.k === 'data') { s += '\n' + t.raw; continue; }
    s += t.raw + (t.k === 'op' ? '\n' : ' ');
  }
  return s;
}
