// 就地編輯（像 Word 一樣）：在頁面上原本文字的位置直接出現編輯框，游標在點到的地方，
// 上方是格式列（字型、大小、粗體、底線、刪除線、文字顏色、背景色）。
import { el, prefs, toast, choose } from './util.js';
import { loadHuninnFace } from './core.js';
import * as ops from './ops.js';
import { K_EDIT } from './doc.js';
import { loadStyle, saveStyle, FAMILIES } from './style.js';

const FG = ['#000000', '#555555', '#FFFFFF', '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E63E9', '#8E24AA', '#D81B60'];
const BG = [null, '#FFFFFF', '#FFF59D', '#FFCC80', '#C8E6C9', '#BBDEFB', '#F8BBD0', '#E0E0E0', '#000000'];
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;
const hasCjk = s => /[^\x00-\x7E]/.test(s);

export class Inline {
  constructor(app) { this.app = app; this.cur = null; }
  get active() { return !!this.cur; }
  get v() { return this.app.viewer; }

  // ---------------------------------------------------------------- 找段落

  /** 把頁面文字分成行：[{items, x1, x2, top, bottom, size, base}] */
  async lines(page, cell) {
    let items = (await this.app.doc.text(page)).filter(i => !i.vertical && i.str.length);
    // 在表格裡：只看同一格的字（中心點在格子內）
    if (cell) items = items.filter(i => i.x + i.w / 2 > cell.x1 && i.x + i.w / 2 < cell.x2 && i.y + i.h / 2 > cell.y1 && i.y + i.h / 2 < cell.y2);
    items.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const base = it.y + it.size * 1.15;
      const l = lines.find(L => Math.abs(L.base - base) < Math.max(L.size, it.size) * 0.45 && it.x < L.x2 + it.size * 6 && it.x + it.w > L.x1 - it.size * 6);
      if (l) { l.items.push(it); l.x1 = Math.min(l.x1, it.x); l.x2 = Math.max(l.x2, it.x + it.w); l.size = Math.max(l.size, it.size); l.top = Math.min(l.top, it.y); l.bottom = Math.max(l.bottom, it.y + it.h); }
      else lines.push({ items: [it], x1: it.x, x2: it.x + it.w, top: it.y, bottom: it.y + it.h, size: it.size, base });
    }
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);
    lines.sort((a, b) => a.base - b.base || a.x1 - b.x1);
    return lines;
  }

  lineText(l) {
    let t = '';
    const map = [];   // 每個字元對應的 {item, k}
    l.items.forEach((it, j) => {
      if (j && it.x - (l.items[j - 1].x + l.items[j - 1].w) > it.size * 0.25 && !/\s$/.test(t) && !/^\s/.test(it.str)) { t += ' '; map.push(null); }
      for (let k = 0; k < it.str.length; k++) { t += it.str[k]; map.push({ it, k }); }
    });
    return { t, map };
  }

  /** 點到的段落（連續、字級相同、行距一致、左右對齊相近的行） */
  /** 點到的位置所在的表格儲存格（左右上下都有框線才算）；不在表格裡回傳 null */
  async cellAt(page, x, y) {
    const { v, h } = await this.app.doc.rules(page);
    const tol = 1.5;
    let x1 = -Infinity, x2 = Infinity, y1 = -Infinity, y2 = Infinity;
    for (const l of v) if (y >= l.y1 - tol && y <= l.y2 + tol) { if (l.x <= x && l.x > x1) x1 = l.x; if (l.x >= x && l.x < x2) x2 = l.x; }
    if (!isFinite(x1) || !isFinite(x2)) return null;
    const mx = (x1 + x2) / 2;
    for (const l of h) if (l.x1 <= Math.min(x, mx) + tol && l.x2 >= Math.max(x, mx) - tol) { if (l.y <= y && l.y > y1) y1 = l.y; if (l.y >= y && l.y < y2) y2 = l.y; }
    if (!isFinite(y1) || !isFinite(y2)) return null;
    return { x1, x2, y1, y2 };
  }

  async findBlock(page, x, y) {
    const cell = await this.cellAt(page, x, y);
    const lines = await this.lines(page, cell);
    let idx = lines.findIndex(l => y >= l.top - 2 && y <= l.bottom + 2 && x >= l.x1 - 4 && x <= l.x2 + 4);
    if (idx < 0) return null;
    const ok = (a, b, pitch) => Math.abs(a.size - b.size) <= a.size * 0.15
      && Math.abs(b.base - a.base) <= a.size * 1.9 && (!pitch || Math.abs(Math.abs(b.base - a.base) - pitch) <= pitch * 0.25)
      && b.x1 < a.x2 && b.x2 > a.x1 - a.size * 2 && Math.abs(b.x1 - a.x1) < Math.max(a.size * 3, (a.x2 - a.x1) * 0.5);
    let s = idx, e = idx, pitch = 0;
    while (e + 1 < lines.length && ok(lines[e], lines[e + 1], pitch)) { pitch = pitch || lines[e + 1].base - lines[e].base; e++; }
    while (s > 0 && ok(lines[s], lines[s - 1], pitch)) { pitch = pitch || lines[s].base - lines[s - 1].base; s--; }
    const blk = lines.slice(s, e + 1);
    let text = '', caret = 0;
    blk.forEach((l, j) => {
      const { t, map } = this.lineText(l);
      if (j) {
        const prev = text.slice(-1), next = t[0] || '';
        if (!(CJK.test(prev) || CJK.test(next) || /\s$/.test(text))) text += ' ';
      }
      if (j === idx - s) {
        // 游標放在點到的字
        let best = t.length, bd = Infinity;
        map.forEach((m, k) => {
          if (!m) return;
          const cw = m.it.w / m.it.str.length, cx = m.it.x + cw * m.k;
          const dd = x < cx + cw / 2 ? Math.abs(x - cx) : Math.abs(x - (cx + cw));
          if (dd < bd) { bd = dd; best = x < cx + cw / 2 ? k : k + 1; }
        });
        caret = text.length + best;
      }
      text += t;
    });
    const size = Math.max(...blk.map(l => l.size));
    const area = { x: Math.min(...blk.map(l => l.x1)), y: Math.min(...blk.map(l => l.top)), w: 0, h: 0 };
    area.w = Math.max(...blk.map(l => l.x2)) - area.x;
    area.h = Math.max(...blk.map(l => l.bottom)) - area.y;
    // 像 Word 一樣：換行寬度用整個文字欄（頁面上最右邊的文字），不是原本這行字的寬度
    // 在表格裡：換行寬度＝儲存格寬（扣掉內距），文字不會超出格子
    const right = cell ? cell.x2 - Math.max(2, area.x - cell.x1) : Math.min(Math.max(...lines.map(l => l.x2), area.x + area.w), this.app.doc.pages[page].w - 18);
    const wrapW = cell ? Math.max(size * 2, right - area.x) : Math.max(area.w, right - area.x);
    return { page, area, wrapW, cell, text, caret, size, base: blk[0].base, lineHeight: blk.length > 1 ? (blk[blk.length - 1].base - blk[0].base) / (blk.length - 1) : size * 1.25 };
  }

  // ---------------------------------------------------------------- 取色（直接讀畫面上已繪製的頁面）

  pixels(page, r) {
    const s = this.v.slots[page];
    if (!s || !s.canvas) return null;
    const c = this.v.toCss(page, r), k = s.k || 1;
    const x = Math.max(0, Math.floor(c.x * k)), y = Math.max(0, Math.floor(c.y * k));
    const w = Math.max(1, Math.min(s.canvas.width - x, Math.ceil(c.w * k))), h = Math.max(1, Math.min(s.canvas.height - y, Math.ceil(c.h * k)));
    try { return s.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h); } catch { return null; }
  }

  sampleColors(page, area) {
    const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    const pad = 3;
    const ring = this.pixels(page, { x: area.x - pad, y: area.y - pad, w: area.w + pad * 2, h: area.h + pad * 2 });
    if (!ring) return { bg: '#ffffff', fg: '#000000' };
    const d = ring.data, W = ring.width, H = ring.height;
    // 背景：外框一圈最常見的顏色
    const counts = new Map();
    const add = (x, y) => { const o = (y * W + x) * 4; const key = (d[o] >> 3) << 10 | (d[o + 1] >> 3) << 5 | (d[o + 2] >> 3); const e = counts.get(key); if (e) e.n++; else counts.set(key, { n: 1, c: [d[o], d[o + 1], d[o + 2]] }); };
    for (let x = 0; x < W; x++) { add(x, 0); add(x, H - 1); }
    for (let y = 0; y < H; y++) { add(0, y); add(W - 1, y); }
    let bg = [255, 255, 255], bn = 0;
    for (const e of counts.values()) if (e.n > bn) { bn = e.n; bg = e.c; }
    // 文字顏色：和背景差最多的像素
    let fg = [0, 0, 0], fd = 0;
    for (let o = 0; o < d.length; o += 16) {
      const dd = Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]);
      if (dd > fd) { fd = dd; fg = [d[o], d[o + 1], d[o + 2]]; }
    }
    if (fd < 120) fg = [0, 0, 0];
    // 深色字一律當黑色（反鋸齒會讓顏色偏淡）
    if (fg[0] + fg[1] + fg[2] < 200 && Math.max(...fg) - Math.min(...fg) < 40) fg = [0, 0, 0];
    return { bg: hex(...bg), fg: hex(...fg) };
  }

  // ---------------------------------------------------------------- 開始編輯

  async editAt(page, x, y) {
    if (this.active) { await this.commit(); return; }
    const blk = await this.findBlock(page, x, y);
    if (!blk) return this.addAt(page, x, y);
    const col = this.sampleColors(page, blk.area);
    const st = { family: loadStyle('edit').family, size: Math.round(blk.size * 10) / 10, color: col.fg, bg: null, bold: false, underline: false, strike: false };
    this.open({ mode: 'edit', page, area: blk.area, wrapW: blk.wrapW, cell: blk.cell, text: blk.text, caret: blk.caret, base: blk.base, lineHeight: blk.lineHeight, st, mask: col.bg });
  }

  async addAt(page, x, y) {
    if (this.active) { await this.commit(); return; }
    const st = loadStyle('add');
    const p = this.app.doc.pages[page];
    const w = Math.max(80, p.w - x - 24);
    const base = y + st.size * 0.35;
    this.open({ mode: 'add', page, wrapW: w, area: { x, y: base - st.size * 1.15, w, h: st.size * 1.3 }, text: '', caret: 0, base, lineHeight: st.size * 1.25, st, mask: null });
  }

  /** 從選取的文字開始編輯（選取列的「改文字」） */
  async editSelection(sel) {
    const r = sel.rects[0];
    await this.editAt(sel.page, r.x + 1, r.y + r.h / 2);
  }

  async open(c) {
    await loadHuninnFace();
    const v = this.v;
    if (v.vrot) v.rotateView(-v.vrot);
    const s = v.slots[c.page];
    if (!s) return;
    this.cur = { ...c, orig: c.text, origSt: JSON.stringify(c.st) };
    const mask = el('div.inline-mask');
    const ta = el('textarea.inline-ed', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off' });
    ta.value = c.text;
    this.cur.ta = ta; this.cur.maskEl = mask;
    ta.addEventListener('input', () => this.layout());
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); }
      e.stopPropagation();
    });
    this.attach();
    this.bar();
    this.layout();
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(c.caret, c.caret);
    // 讓編輯框在畫面中
    setTimeout(() => ta.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 50);
  }

  /** 頁面重新排版（縮放、重繪）後把編輯框放回去 */
  attach() {
    const c = this.cur;
    if (!c) return;
    const s = this.v.slots[c.page];
    if (!s) return;
    if (c.ta.parentElement !== s.div) { s.div.append(c.maskEl, c.ta); }
    this.layout();
  }

  layout() {
    const c = this.cur;
    if (!c) return;
    const v = this.v, sc = v.scale, st = c.st;
    const size = st.size, lh = c.mode === 'edit' ? c.lineHeight : size * 1.25;
    const top = c.base - size * 1.15 + (lh - size * 1.3) / 2;
    const r = v.toCss(c.page, { x: c.area.x, y: top, w: c.wrapW || c.area.w, h: lh });
    const ta = c.ta;
    const text = ta.value || ' ';
    const fam = hasCjk(text) ? '"XiaoKeHuninn", sans-serif' : st.family === 1 ? '"Times New Roman", Times, serif' : st.family === 2 ? '"Courier New", monospace' : 'Helvetica, Arial, sans-serif';
    Object.assign(ta.style, {
      left: r.x + 'px', top: r.y + 'px', width: Math.max(r.w, size * sc * 2) + 'px',
      font: `${st.bold ? 700 : 400} ${size * sc}px/${lh * sc}px ${fam}`, color: st.color,
      background: st.bg || c.mask || 'rgba(255,255,255,0.92)',
      textDecoration: [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
    });
    ta.style.height = '0px';
    ta.style.height = Math.max(ta.scrollHeight, lh * sc) + 'px';
    // 在表格裡：文字超出儲存格下緣時用紅框提醒（可以縮小字級或刪短文字）
    const over = !!c.cell && r.y + ta.offsetHeight > v.toCss(c.page, { x: c.cell.x1, y: c.cell.y2, w: 1, h: 1 }).y + 2;
    ta.classList.toggle('over', over);
    ta.title = over ? '文字超出表格儲存格，請縮小字級或刪短文字' : '';
    // 遮住原本的文字
    if (c.mode === 'edit') {
      const m = v.toCss(c.page, { x: c.area.x - 1.5, y: c.area.y - 1.5, w: c.area.w + 3, h: c.area.h + 3 });
      Object.assign(c.maskEl.style, { left: m.x + 'px', top: m.y + 'px', width: m.w + 'px', height: m.h + 'px', background: c.mask || '#fff', display: 'block' });
    } else c.maskEl.style.display = 'none';
  }

  // ---------------------------------------------------------------- 格式列

  bar() {
    const h = document.getElementById('hint');
    const c = this.cur, st = c.st;
    h.innerHTML = '';
    h.classList.add('fmt');
    const keep = e => e.preventDefault();   // 按格式按鈕時不要讓編輯框失去焦點
    const btn = (t, title, f, on) => { const b = el('button.fb' + (on ? '.on' : ''), { text: t, title, onpointerdown: keep, onclick: () => { f(); this.bar(); this.layout(); c.ta.focus({ preventScroll: true }); } }); return b; };
    const fam = el('select.fsel', { title: '字型', onchange: () => { st.family = +fam.value; this.layout(); c.ta.focus({ preventScroll: true }); } }, FAMILIES.map((f, i) => el('option', { value: i, text: f.replace(/（.*）/, '') })));
    fam.value = st.family;
    const size = el('span.fsize', { text: String(st.size) });
    const sw = (color, title, list, onpick) => el('button.fb.fcolor', { title, onpointerdown: keep, onclick: () => this.swatches(title, list, color, x => { onpick(x); this.bar(); this.layout(); }) },
      el('span', { text: title === '文字顏色' ? 'A' : '▧', style: { borderBottom: `4px solid ${color || '#ccc'}`, fontWeight: 700, padding: '0 2px' } }));
    h.append(
      el('span.fhint', { text: c.mode === 'edit' ? '就地編輯' : '新增文字' }),
      fam,
      btn('－', '縮小', () => { st.size = Math.max(4, Math.round((st.size - 1) * 2) / 2); }),
      size,
      btn('＋', '放大', () => { st.size = Math.min(144, Math.round((st.size + 1) * 2) / 2); }),
      btn('B', '粗體', () => { st.bold = !st.bold; }, st.bold),
      btn('U', '底線', () => { st.underline = !st.underline; }, st.underline),
      btn('S', '刪除線', () => { st.strike = !st.strike; }, st.strike),
      sw(st.color, '文字顏色', FG, x => st.color = x),
      sw(st.bg, '背景顏色', BG, x => st.bg = x),
      el('span.spacer'),
      el('button.btn', { text: '取消', onpointerdown: keep, onclick: () => this.cancel() }),
      el('button.btn.primary', { text: '完成', onpointerdown: keep, onclick: () => this.commit() }));
    h.querySelector('.fb[title=粗體]').style.fontWeight = 700;
    h.querySelector('.fb[title=底線]').style.textDecoration = 'underline';
    h.querySelector('.fb[title=刪除線]').style.textDecoration = 'line-through';
    h.classList.remove('hidden');
  }

  /** 格式列下方的一排色票 */
  swatches(title, list, cur, pick) {
    const old = document.getElementById('fswatch');
    if (old) { const same = old.dataset.t === title; old.remove(); if (same) return; }
    const row = el('div#fswatch.fswatch', { 'data-t': title },
      el('span.small', { text: title + '：' }),
      list.map(c => el('button.swatch' + (c === cur ? '.sel' : ''), { title: c || '無', text: c ? '' : '無', style: { background: c || '#fff' },
        onpointerdown: e => e.preventDefault(),
        onclick: () => { row.remove(); pick(c); this.cur && this.cur.ta.focus({ preventScroll: true }); } })));
    document.getElementById('hint').after(row);
  }

  // ---------------------------------------------------------------- 完成 / 取消

  close() {
    const c = this.cur;
    if (!c) return;
    c.ta.remove(); c.maskEl.remove();
    document.getElementById('fswatch')?.remove();
    this.cur = null;
    const h = document.getElementById('hint');
    h.classList.remove('fmt');
    const m = this.app.mode;
    if (m) this.app.hint(m.hint, m.buttons || [], true); else h.classList.add('hidden');
  }

  cancel() { this.close(); }

  async commit() {
    const c = this.cur;
    if (!c) return;
    const text = c.ta.value.replace(/\s+$/, '');
    const st = { ...c.st };
    const changed = text !== c.orig || JSON.stringify(c.st) !== c.origSt;
    this.close();
    if (!changed) return;
    if (c.mode === 'add' && !text.trim()) return;
    saveStyle(c.mode === 'edit' ? 'edit' : 'add', { family: st.family, size: st.size, color: st.color, bg: st.bg, bold: st.bold, underline: st.underline, strike: st.strike });
    const out = { ...st, wrapW: c.wrapW || c.area.w, lineHeight: c.mode === 'edit' ? Math.max(c.lineHeight, st.size * 1.05) : st.size * 1.25, baseline: c.base };
    if (c.mode === 'edit') {
      await this.app.edit(text ? '編輯文字' : '刪除文字', K_EDIT, lib => ops.replaceBlock(lib, c.page, c.area, text, out, c.mask || '#ffffff'));
    } else {
      await this.app.edit('新增文字', K_EDIT, lib => ops.addText(lib, c.page, { x: c.area.x, y: c.area.y, w: out.wrapW }, text, out));
    }
  }
}
