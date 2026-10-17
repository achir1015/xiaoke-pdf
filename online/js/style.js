// 文字格式對話框、文字 / 印章點陣圖、手寫簽名板
import { el, sheet, prefs, now } from './util.js';
import { loadHuninnFace } from './core.js';

export const FAMILIES = ['黑體（無襯線）', '明體（襯線）', '等寬'];
const FG = ['#000000', '#555555', '#FFFFFF', '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E63E9', '#8E24AA', '#D81B60'];
const BG = [null, '#FFFFFF', '#FFF59D', '#FFCC80', '#C8E6C9', '#BBDEFB', '#F8BBD0', '#E0E0E0', '#000000'];
export const PALETTE = ['#FFD400', '#FF9800', '#E53935', '#E91E63', '#8E24AA', '#1E63E9', '#00ACC1', '#43A047', '#1D1F23', '#9E9E9E'];

export function loadStyle(key) {
  return { family: 0, size: 12, color: '#000000', bg: null, bold: false, underline: false, strike: false, ...prefs.get('style.' + key, {}) };
}
export function saveStyle(key, st) { prefs.set('style.' + key, st); }

const hasCjk = s => /[^\x00-\x7E]/.test(s);
export function cssFont(st, text, px) {
  const fam = hasCjk(text) ? '"XiaoKeHuninn", sans-serif' : st.family === 1 ? '"Times New Roman", Times, serif' : st.family === 2 ? '"Courier New", monospace' : 'Helvetica, Arial, sans-serif';
  return `${st.bold ? '700 ' : ''}${px}px ${fam}`;
}

/** 文字格式對話框。回傳 {text, style} 或 null */
export async function textDialog(title, { original = null, text = '', style }) {
  await loadHuninnFace();
  const st = { ...style };
  const s = sheet(title, { pad: true, center: true });
  if (original != null) s.body.append(el('div.field', el('label', { text: '原文字' }), el('div.small', { text: original })));
  const ta = el('textarea', { rows: 2, placeholder: '輸入文字' });
  ta.value = text;
  s.body.append(el('div.field', el('label', { text: original != null ? '改成（留白＝刪除）' : '文字' }), ta));
  const pv = el('div.preview');
  s.body.append(pv);
  const famSel = el('select', FAMILIES.map((f, i) => el('option', { value: i, text: f })));
  famSel.value = st.family;
  s.body.append(el('div.field', el('label', { text: '字型' }), famSel));
  const size = el('input', { type: 'number', min: 4, max: 144, step: 0.5, value: st.size, inputMode: 'decimal' });
  s.body.append(el('div.field', el('label', { text: '大小（pt）' }), el('div.stepper',
    el('button.ib', { text: '－', onclick: () => { size.value = Math.max(4, +size.value - 1); upd(); } }), size,
    el('button.ib', { text: '＋', onclick: () => { size.value = Math.min(144, +size.value + 1); upd(); } }))));
  const tg = (label, key, styleCss) => { const b = el('button', { html: label, title: { bold: '粗體', underline: '底線', strike: '刪除線' }[key], onclick: () => { st[key] = !st[key]; upd(); } }); if (styleCss) Object.assign(b.style, styleCss); b.dataset.k = key; return b; };
  const toggles = el('div.toggles', tg('B', 'bold', { fontWeight: 700 }), tg('U', 'underline', { textDecoration: 'underline' }), tg('S', 'strike', { textDecoration: 'line-through' }));
  s.body.append(el('div.field', el('label', { text: '樣式' }), toggles));
  const fgRow = el('div.swatches'), bgRow = el('div.swatches');
  s.body.append(el('div.field', el('label', { text: '文字顏色' }), fgRow), el('div.field', el('label', { text: '背景顏色' }), bgRow));
  s.body.append(el('div.small', { text: original != null ? '會用背景色蓋住原本的字，再在同一位置寫上新字。'
    : '英數字使用 PDF 標準字型（黑體 / 明體 / 等寬）；中文使用內建的 jf open 粉圓字型，寫入後可以搜尋與複製。' }));
  const sw = (row, list, key) => {
    row.innerHTML = '';
    for (const c of list) row.append(el('button.swatch' + (st[key] === c ? '.sel' : ''), { style: { background: c || '#fff' }, text: c ? '' : '無', title: c || '無', onclick: () => { st[key] = c; upd(); } }));
  };
  function upd() {
    st.family = +famSel.value; st.size = Math.max(4, Math.min(144, parseFloat(size.value) || 12));
    const t = ta.value || '預覽 Preview 永';
    pv.textContent = t;
    pv.style.font = cssFont(st, t, Math.max(13, Math.min(34, st.size * 1.35)));
    pv.style.color = st.color;
    pv.style.background = st.bg || '#fff';
    pv.style.textDecoration = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
    for (const b of toggles.children) b.classList.toggle('on', !!st[b.dataset.k]);
    sw(fgRow, FG, 'color'); sw(bgRow, BG, 'bg');
  }
  ta.addEventListener('input', upd); size.addEventListener('input', upd); famSel.addEventListener('change', upd);
  upd();
  s.footer(el('button.btn', { text: '取消', onclick: () => s.close(null) }),
    el('button.btn.primary', { text: original != null ? '套用' : '新增', onclick: () => s.close({ text: ta.value, style: { ...st } }) }));
  setTimeout(() => ta.focus(), 60);
  return s.done.then(v => v || null);
}

export const PX = 4;   // 點陣圖每 pt 的像素

/** 文字畫成 PNG：{png, w, h}（w/h 單位 pt） */
export async function textPng(text, st, maxW = 0) {
  await loadHuninnFace();
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  const size = (st.size || 12) * PX;
  ctx.font = cssFont(st, text, size);
  const lines = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const ch of para) {
      if (maxW > 0 && cur && ctx.measureText(cur + ch).width > maxW * PX) { lines.push(cur); cur = ch; } else cur += ch;
    }
    lines.push(cur);
  }
  const lh = size * 1.25;
  const w = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width), 1)) + 4;
  c.width = maxW > 0 ? Math.max(w, Math.round(maxW * PX)) : w;
  c.height = Math.ceil(lines.length * lh + size * 0.15);
  if (st.bg) { ctx.fillStyle = st.bg; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.font = cssFont(st, text, size);
  ctx.fillStyle = st.color || '#000';
  ctx.strokeStyle = st.color || '#000';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, k) => {
    const y = k * lh + size;
    ctx.fillText(l, 2, y);
    const lw = ctx.measureText(l).width;
    ctx.lineWidth = Math.max(1, size * 0.06);
    if (st.underline) { ctx.beginPath(); ctx.moveTo(2, y + size * 0.12); ctx.lineTo(2 + lw, y + size * 0.12); ctx.stroke(); }
    if (st.strike) { ctx.beginPath(); ctx.moveTo(2, y - size * 0.3); ctx.lineTo(2 + lw, y - size * 0.3); ctx.stroke(); }
  });
  return { png: await canvasPng(c), w: c.width / PX, h: c.height / PX };
}

export async function canvasPng(c) {
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}

/** 印章圖：圓角外框 + 標題 + 小字 */
export async function stampPng(title, sub, color) {
  await loadHuninnFace();
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  const big = `700 ${22 * PX}px "XiaoKeHuninn", sans-serif`, small = `${9 * PX}px "XiaoKeHuninn", sans-serif`;
  ctx.font = big; const tw = ctx.measureText(title).width;
  ctx.font = small; const sw = sub ? ctx.measureText(sub).width : 0;
  const pad = 10 * PX;
  c.width = Math.ceil(Math.max(tw, sw) + pad * 2); c.height = (sub ? 46 : 34) * PX;
  const r = 6 * PX, inset = 2 * PX;
  ctx.beginPath(); ctx.roundRect(inset, inset, c.width - 2 * inset, c.height - 2 * inset, r);
  ctx.fillStyle = color + '18'; ctx.fill();
  ctx.lineWidth = 2.5 * PX; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = big; ctx.fillText(title, (c.width - tw) / 2, 27 * PX);
  if (sub) { ctx.font = small; ctx.fillText(sub, (c.width - sw) / 2, 39 * PX); }
  return { png: await canvasPng(c), w: c.width / PX, h: c.height / PX };
}

/** 數位簽章外觀 */
export async function sigLook(who, reason, w, h) {
  await loadHuninnFace();
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  c.width = Math.round(w * PX); c.height = Math.round(h * PX);
  ctx.fillStyle = '#E8F5F2'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#00897B'; ctx.lineWidth = PX; ctx.strokeRect(PX / 2, PX / 2, c.width - PX, c.height - PX);
  const lines = [`數位簽署者：${who}`, `日期：${now()}`, reason ? `原因：${reason}` : null].filter(Boolean);
  const fs = Math.min(9 * PX, (c.height - 6 * PX) / lines.length / 1.25);
  ctx.font = `${fs}px "XiaoKeHuninn", sans-serif`; ctx.fillStyle = '#10204A';
  lines.forEach((l, k) => ctx.fillText(l, 3 * PX, (c.height - lines.length * fs * 1.25) / 2 + fs * (k + 1) * 1.25 - fs * 0.2, c.width - 6 * PX));
  return await canvasPng(c);
}

/** 手寫簽名板。回傳 {png, w, h} 或 null */
export function signPad() {
  const s = sheet('在框內簽名', { pad: true, center: true });
  const cv = el('canvas.signpad');
  s.body.append(cv);
  let color = '#10204A';
  const colors = el('div.swatches', ['#10204A', '#000000', '#1E63E9', '#C62828'].map(c => el('button.swatch', { style: { background: c }, onclick: () => { color = c; } })));
  const keep = el('input', { type: 'checkbox', checked: true });
  s.body.append(colors, el('label.check', keep, el('span', { text: '儲存這個簽名供下次使用' })));
  let ctx, drawing = false, empty = true, strokes = [];
  requestAnimationFrame(() => {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    guide();
  });
  const guide = () => { ctx.save(); ctx.strokeStyle = '#ccc'; ctx.beginPath(); const h = cv.clientHeight * 0.75; ctx.moveTo(16, h); ctx.lineTo(cv.clientWidth - 16, h); ctx.stroke(); ctx.restore(); };
  const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drawing = true; empty = false; const p = pt(e); strokes.push({ color, pts: [p] }); ctx.beginPath(); ctx.moveTo(...p); });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return;
    const st = strokes[strokes.length - 1];
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) { const p = pt(ev); st.pts.push(p); ctx.lineTo(...p); }
    ctx.strokeStyle = st.color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  });
  cv.addEventListener('pointerup', () => drawing = false);
  const clear = () => { strokes = []; empty = true; ctx.clearRect(0, 0, cv.width, cv.height); guide(); };
  s.footer(el('button.btn', { text: '清除', onclick: clear }), el('button.btn', { text: '取消', onclick: () => s.close(null) }),
    el('button.btn.primary', { text: '使用', onclick: async () => {
      if (empty) return;
      const r = await strokesPng(strokes);
      if (keep.checked) { const list = prefs.get('signatures', []); list.unshift(r.dataUrl); prefs.set('signatures', list.slice(0, 8)); }
      s.close(r);
    } }));
  return s.done.then(v => v || null);
}

/** 筆畫 → 裁好邊的透明 PNG */
async function strokesPng(strokes) {
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const s of strokes) for (const [x, y] of s.pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  const k = 3, m = 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x2 - x1 + 2 * m) * k); c.height = Math.ceil((y2 - y1 + 2 * m) * k);
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 3 * k;
  for (const s of strokes) {
    ctx.strokeStyle = s.color; ctx.beginPath();
    s.pts.forEach(([x, y], i) => { const X = (x - x1 + m) * k, Y = (y - y1 + m) * k; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    if (s.pts.length === 1) ctx.lineTo((s.pts[0][0] - x1 + m) * k + 0.1, (s.pts[0][1] - y1 + m) * k);
    ctx.stroke();
  }
  return { png: await canvasPng(c), w: c.width, h: c.height, dataUrl: c.toDataURL('image/png') };
}

export async function dataUrlPng(url) {
  const b = await (await fetch(url)).arrayBuffer();
  const img = new Image(); img.src = url; await img.decode();
  return { png: new Uint8Array(b), w: img.width, h: img.height };
}
