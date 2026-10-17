// 書籤、縮圖、註解、表單、圖層、附件、文件屬性
import { el, sheet, choose, prompt, form, confirmBox, alertBox, toast, run, size, download, pickFiles, base } from './util.js';
import { loadLib, L } from './core.js';
import * as ops from './ops.js';
import { K_EDIT, K_ANNOT, K_FORM, PF } from './doc.js';
import { PALETTE } from './style.js';

const pdfjsLib = window.pdfjsLib;

function need(app) { if (!app.doc) { toast('請先開啟文件'); return false; } return true; }
const pad = t => el('div.small', { text: t, style: { padding: '16px 18px' } });

/** 非同步縮圖 */
const thumbCache = new Map();
export async function thumb(doc, i, w) {
  const key = doc.id + ':' + doc.gen + ':' + i + ':' + w;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const p = (async () => {
    const page = await doc.pdf.getPage(i + 1);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: w / vp0.width * Math.min(2, window.devicePixelRatio || 1) });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const url = c.toDataURL('image/jpeg', 0.8);
    c.width = c.height = 0;
    return url;
  })();
  thumbCache.set(key, p);
  if (thumbCache.size > 400) thumbCache.delete(thumbCache.keys().next().value);
  return p;
}

export function thumbGrid(app, doc, { selected, onTap, onLong, width = 120 }) {
  const grid = el('div.thumbs');
  const io = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) {
      const img = e.target.querySelector('img');
      if (!img.src) thumb(doc, +e.target.dataset.i, width).then(u => img.src = u);
      io.unobserve(e.target);
    }
  });
  for (let i = 0; i < doc.n; i++) {
    const l = doc.label(i);
    const t = el('div.thumb' + (selected && selected.has(i) ? '.sel' : '') + (!selected && i === doc.view.page ? '.cur' : ''), { 'data-i': i },
      el('img', { alt: '' }), el('div.ck', { text: '✓' }), el('div', { text: (l ? `${l}（${i + 1}）` : String(i + 1)) + (doc.pages[i].rotate ? `  ⟳${doc.pages[i].rotate}°` : '') }));
    const img = t.querySelector('img');
    img.style.aspectRatio = `${doc.pages[i].w} / ${doc.pages[i].h}`;
    let lt = null;
    t.addEventListener('pointerdown', () => { lt = setTimeout(() => { lt = 'long'; onLong && onLong(i, t); }, 550); });
    t.addEventListener('pointerup', () => { if (lt === 'long') return; clearTimeout(lt); lt = null; onTap(i, t); });
    t.addEventListener('pointerleave', () => { if (lt !== 'long') clearTimeout(lt); });
    t.addEventListener('contextmenu', e => e.preventDefault());
    grid.append(t);
    io.observe(t);
  }
  return grid;
}

export function thumbnails(app) {
  if (!need(app)) return;
  const d = app.doc;
  const s = sheet(`頁面縮圖（${d.n} 頁）`, { height: '82vh' });
  s.head.insertBefore(el('button.btn', { text: '整理頁面…', onclick: () => { s.close(); app.tools.organize(); } }), s.head.lastChild);
  const g = thumbGrid(app, d, { onTap: i => { s.close(); app.viewer.goTo(i); } });
  s.body.append(g);
  setTimeout(() => { const c = g.children[d.view.page]; c && c.scrollIntoView({ block: 'center' }); }, 50);
}

// ================================================================ 書籤

export async function bookmarks(app) {
  if (!need(app)) return;
  const d = app.doc;
  const tree = await run(null, async () => ops.readOutline(await loadLib(d.current)));
  const s = sheet('書籤', { height: '82vh' });
  s.head.insertBefore(el('button.ib', { text: '＋', title: '為目前頁面加入書籤', onclick: async () => {
    const p = d.view.page;
    const t = await prompt(`新增書籤（第 ${p + 1} 頁）`, '標題', `第 ${p + 1} 頁`);
    if (!t) return;
    tree.push({ title: t, page: p, kids: [], open: false });
    s.close(); await app.edit('新增書籤', K_EDIT, lib => ops.writeOutline(lib, tree)); bookmarks(app);
  } }), s.head.lastChild);
  const q = el('input', { placeholder: '搜尋書籤標題', type: 'search' });
  s.body.append(el('div', { style: { display: 'flex', gap: '6px', padding: '10px 14px' } }, q, el('button.btn', { text: '清除', onclick: () => { q.value = ''; draw(); } })));
  const box = el('div.tree');
  s.body.append(box);
  const open = new Set();
  const init = (items, path) => items.forEach((b, k) => { const p = [...path, k].join('.'); if (b.open) open.add(p); init(b.kids, [...path, k]); });
  init(tree, []);
  const match = (b, f) => !f || b.title.toLowerCase().includes(f) || b.kids.some(k => match(k, f));
  const save = async (label) => { s.close(); await app.edit(label, K_EDIT, lib => ops.writeOutline(lib, tree)); bookmarks(app); };
  function draw() {
    box.innerHTML = '';
    const f = q.value.trim().toLowerCase();
    let count = 0;
    if (!tree.length) box.append(pad('這份文件沒有書籤。按右上角「＋」可以為目前頁面加入書籤。'));
    const walk = (items, depth, path, parentList) => items.forEach((b, k) => {
      if (!match(b, f)) return;
      const p = [...path, k].join('.');
      const self = f && b.title.toLowerCase().includes(f);
      if (self) count++;
      const expanded = !!f || open.has(p);
      const lbl = b.page >= 0 ? (d.label(b.page) || String(b.page + 1)) : '';
      const node = el('div.node', { style: { paddingLeft: 8 + depth * 18 + 'px' } },
        el('span.tw', { text: b.kids.length ? (expanded ? '▾' : '▸') : '', onclick: e => { e.stopPropagation(); open.has(p) ? open.delete(p) : open.add(p); draw(); } }),
        el('span.nt', { text: b.title, style: { fontWeight: self ? 700 : 400, color: f && !self ? 'var(--sub)' : '' } }), el('span.pg', { text: lbl }));
      node.addEventListener('click', () => { if (b.page >= 0) { s.close(); app.viewer.goTo(b.page); } });
      const menu = async e => {
        e.preventDefault();
        const cp = d.view.page;
        const i = await choose(b.title, ['重新命名', '改為指向目前頁面', '新增子書籤（目前頁面）', '往上移', '往下移', '刪除']);
        if (i === 0) { const t = await prompt('重新命名', '標題', b.title); if (t) { b.title = t; save('重新命名書籤'); } }
        else if (i === 1) { b.page = cp; save('變更書籤目標'); }
        else if (i === 2) { const t = await prompt('新增子書籤', '標題', `第 ${cp + 1} 頁`); if (t) { b.kids.push({ title: t, page: cp, kids: [], open: false }); b.open = true; save('新增書籤'); } }
        else if (i === 3 && k > 0) { [parentList[k - 1], parentList[k]] = [parentList[k], parentList[k - 1]]; save('移動書籤'); }
        else if (i === 4 && k < parentList.length - 1) { [parentList[k + 1], parentList[k]] = [parentList[k], parentList[k + 1]]; save('移動書籤'); }
        else if (i === 5 && await confirmBox('刪除書籤', `刪除「${b.title}」及其子書籤？`, '刪除', true)) { parentList.splice(k, 1); save('刪除書籤'); }
      };
      node.addEventListener('contextmenu', menu);
      let lt; node.addEventListener('touchstart', e => { lt = setTimeout(() => menu(e), 550); }, { passive: true });
      node.addEventListener('touchend', () => clearTimeout(lt)); node.addEventListener('touchmove', () => clearTimeout(lt));
      box.append(node);
      if (expanded) walk(b.kids, depth + 1, [...path, k], b.kids);
    });
    walk(tree, 0, [], tree);
    if (f && !count) box.append(pad('沒有符合的書籤'));
    if (tree.length) box.append(pad('長按（或按右鍵）書籤可以重新命名、移動、刪除或新增子書籤。'));
  }
  q.addEventListener('input', draw);
  draw();
}

// ================================================================ 註解

export const SUB = { Text: '便利貼', Highlight: '螢光標示', Underline: '底線', StrikeOut: '刪除線', Squiggly: '波浪底線', FreeText: '文字框', Square: '矩形', Circle: '橢圓',
  Line: '直線', Ink: '手繪', Stamp: '印章', Polygon: '多邊形', PolyLine: '折線', FileAttachment: '附件', Redact: '塗銷標記', Caret: '插入符號', Sound: '聲音' };
const STATE = { Accepted: '已接受', Rejected: '已拒絕', Cancelled: '已取消', Completed: '已完成', None: '無' };
const sub = s => SUB[s] || s;

export async function comments(app) {
  if (!need(app)) return;
  const d = app.doc;
  const list = await run(null, async () => ops.comments(await loadLib(d.current)));
  const s = sheet(`註解（${list.length}）`, { height: '82vh' });
  s.head.insertBefore(el('button.btn', { text: '註解工具', onclick: () => { s.close(); app.commentMode(); } }), s.head.lastChild);
  if (!list.length) s.body.append(pad('還沒有註解。按「註解工具」，或長按選取文字後加上螢光標示。'));
  let last = -1;
  for (const c of list) {
    if (c.page !== last) { s.body.append(el('div.sec', { text: `第 ${d.label(c.page) || c.page + 1} 頁` })); last = c.page; }
    const card = el('div.cm',
      el('div.h', el('span', { text: '●', style: { color: c.color } }), el('b', { text: sub(c.sub) }), el('span', { text: `${c.author}  ${c.date}`, style: { flex: 1 } }),
        c.cur ? el('span', { text: STATE[c.cur] || c.cur, style: { color: 'var(--accent)' } }) : null),
      c.text ? el('div.q', { text: `「${c.text}」` }) : null,
      c.contents && c.sub !== 'Stamp' ? el('div', { text: c.contents }) : null,
      ...c.replies.map(r => el('div.rp', el('div.small', { text: `↳ ${r.author}  ${r.date}` }), el('div', { text: r.contents }))),
      el('div.acts',
        el('button', { text: '回覆', onclick: async e => { e.stopPropagation(); const t = await prompt('回覆', '你的回覆'); if (t) { s.close(); await app.edit('回覆註解', K_ANNOT, lib => ops.reply(lib, c.page, c.index, t)); comments(app); } } }),
        el('button', { text: '編輯', onclick: async e => { e.stopPropagation(); const t = await prompt('編輯註解內容', '內容', c.contents); if (t != null) { s.close(); await app.edit('編輯註解', K_ANNOT, lib => ops.setContents(lib, c.page, c.index, t)); comments(app); } } }),
        el('button', { text: '更多…', onclick: e => { e.stopPropagation(); actions(app, c, s); } })));
    card.addEventListener('click', () => { s.close(); c.r ? app.viewer.goTo(c.page, c.r) : app.viewer.goTo(c.page); });
    s.body.append(card);
  }
}

async function actions(app, c, s) {
  const i = await choose(sub(c.sub), ['設定審閱狀態', '變更顏色', '變更不透明度', '刪除']);
  const back = () => s && comments(app);
  if (i < 0) return;
  s && s.close();
  if (i === 0) {
    const keys = Object.keys(STATE);
    const k = await choose('審閱狀態', Object.values(STATE));
    if (k >= 0) { await app.edit('設定狀態', K_ANNOT, lib => ops.setState(lib, c.page, c.index, keys[k])); back(); }
  } else if (i === 1) {
    const names = ['黃', '橙', '紅', '粉紅', '紫', '藍', '青', '綠', '黑', '灰'];
    const k = await choose('顏色', names.map((n, j) => ({ t: '● ' + n, r: PALETTE[j] })));
    if (k >= 0) { await app.edit('變更註解樣式', K_ANNOT, lib => ops.restyle(lib, c.page, c.index, { color: PALETTE[k] })); back(); }
  } else if (i === 2) {
    const v = [1, 0.75, 0.5, 0.25];
    const k = await choose('不透明度', ['100%', '75%', '50%', '25%']);
    if (k >= 0) { await app.edit('變更註解樣式', K_ANNOT, lib => ops.restyle(lib, c.page, c.index, { opacity: v[k] })); back(); }
  } else if (i === 3 && await confirmBox('刪除註解', `刪除這個${sub(c.sub)}（連同回覆）？`, '刪除', true)) {
    await app.edit('刪除註解', K_ANNOT, lib => ops.deleteAnnot(lib, c.page, c.index)); back();
  }
}

/** 點到頁面上的註解 */
export async function commentAt(app, page, refStr) {
  const d = app.doc;
  const list = await run(null, async () => ops.comments(await loadLib(d.current)));
  const c = list.find(x => x.page === page && x.ref === refStr);
  if (!c) return false;
  let msg = (c.text ? `「${c.text}」\n\n` : '') + (c.contents || '（沒有內容）');
  for (const r of c.replies) msg += `\n\n↳ ${r.author}：${r.contents}`;
  if (c.cur) msg += `\n\n狀態：${STATE[c.cur] || c.cur}`;
  const sh = sheet(`${sub(c.sub)} · ${c.author} · ${c.date}`, { pad: true, center: true });
  sh.body.append(el('div.msgtext', { text: msg }));
  sh.footer(
    el('button.btn', { text: '更多…', onclick: () => { sh.close(); actions(app, c, null); } }),
    el('button.btn', { text: '編輯', onclick: async () => { sh.close(); const t = await prompt('編輯註解內容', '內容', c.contents); if (t != null) app.edit('編輯註解', K_ANNOT, lib => ops.setContents(lib, page, c.index, t)); } }),
    el('button.btn.primary', { text: '回覆', onclick: async () => { sh.close(); const t = await prompt('回覆', '你的回覆'); if (t) app.edit('回覆註解', K_ANNOT, lib => ops.reply(lib, page, c.index, t)); } }));
  return true;
}

// ================================================================ 表單

const FT = { text: '文字', check: '核取方塊', radio: '選項按鈕', combo: '下拉選單', list: '清單', sign: '簽名', button: '按鈕' };

export async function loadFields(app) {
  const f = await run(null, async () => ops.fields(await loadLib(app.doc.current)));
  app.viewer.fieldRects = f.filter(x => x.r).map(x => ({ page: x.page, r: x.r }));
  return f;
}

export async function fields(app) {
  if (!need(app)) return;
  const list = await loadFields(app);
  const s = sheet(`表單欄位（${list.length}）`, { height: '82vh' });
  const acts = el('div', { style: { display: 'flex', overflowX: 'auto', padding: '4px 8px', gap: '2px' } },
    el('button.btn', { text: app.viewer.showFields ? '隱藏欄位標示' : '標示欄位', onclick: () => { app.viewer.showFields = !app.viewer.showFields; app.viewer.redrawOverlays(); s.close(); } }),
    el('button.btn', { text: '新增欄位', onclick: () => { s.close(); app.tools.prepareForm(); } }),
    list.length ? el('button.btn', { text: '清除表單', onclick: async () => { if (await confirmBox('清除表單', '清除所有欄位的值？', '清除')) { s.close(); app.edit('清除表單', K_FORM, ops.clearForm); } } }) : null,
    list.length ? el('button.btn', { text: '平面化', onclick: async () => { if (await confirmBox('平面化表單', '把欄位的目前內容直接印在頁面上，欄位將不能再編輯。', '平面化')) { s.close(); app.edit('平面化表單', K_EDIT, ops.flatten); } } }) : null);
  s.body.append(acts);
  if (!list.length) s.body.append(pad('這份文件沒有互動式表單欄位。可以用「新增欄位」自己建立表單。'));
  let last = -2;
  for (const f of list) {
    if (f.page !== last) { s.body.append(el('div.sec', { text: f.page >= 0 ? `第 ${f.page + 1} 頁` : '未放在頁面上' })); last = f.page; }
    const row = el('div.row', { onclick: () => { s.close(); if (f.page >= 0 && f.r) app.viewer.goTo(f.page, f.r); editField(app, f.name); } },
      el('div.tx', el('div.t1', { text: f.name }), el('div.t2', { text: (FT[f.type] || f.type) + (f.readOnly ? ' · 唯讀' : '') + (f.required ? ' · 必填' : '') })), el('div.r', { text: f.value }));
    row.addEventListener('contextmenu', async e => { e.preventDefault(); if (await confirmBox('刪除欄位', `刪除欄位「${f.name}」？`, '刪除', true)) { s.close(); app.edit('刪除欄位', K_EDIT, lib => ops.deleteField(lib, f.name)); } });
    s.body.append(row);
  }
}

export async function editField(app, fname) {
  const list = await loadFields(app);
  const f = list.find(x => x.name === fname);
  if (!f) return;
  if (f.readOnly) { alertBox(f.name, `這個欄位是唯讀的。\n目前的值：${f.value}`); return; }
  const L1 = '填寫欄位';
  if (f.type === 'check') return app.edit(L1, K_FORM, lib => ops.setField(lib, f.name, f.value !== '是'));
  if (f.type === 'radio' || (f.type === 'combo' && !f.editable) || (f.type === 'list' && !f.multi)) {
    const k = await choose(f.name, f.options);
    if (k >= 0) app.edit(L1, K_FORM, lib => ops.setField(lib, f.name, f.options[k]));
    return;
  }
  if (f.type === 'combo') {
    const k = await choose(f.name, [...f.options, '自行輸入…']);
    if (k === f.options.length) { const t = await prompt(f.name, '值', f.value); if (t != null) app.edit(L1, K_FORM, lib => ops.setField(lib, f.name, t)); }
    else if (k >= 0) app.edit(L1, K_FORM, lib => ops.setField(lib, f.name, f.options[k]));
    return;
  }
  if (f.type === 'list') {
    const cur = new Set(f.value.split(', '));
    const r = await form(f.name, f.options.map((o, j) => ({ key: 'o' + j, label: o, type: 'check', value: cur.has(o) })));
    if (r) app.edit(L1, K_FORM, lib => ops.setField(lib, f.name, f.options.filter((o, j) => r['o' + j])));
    return;
  }
  if (f.type === 'sign') {
    const k = await choose('簽名欄位：' + f.name, ['數位簽署', '手寫簽名']);
    if (k === 0) app.tools.certSign(f.page, f.r); else if (k === 1) app.tools.signInRect(f.page, f.r);
    return;
  }
  if (f.type === 'text') {
    const r = await form(f.name, [{ key: 'v', label: '值', value: f.value, type: f.multi ? 'textarea' : 'text' }]);
    if (r) app.edit(L1, K_FORM, lib => ops.setField(lib, f.name, r.v));
    return;
  }
  alertBox(f.name, `這種欄位（${FT[f.type] || f.type}）無法在這裡編輯。`);
}

// ================================================================ 圖層

export async function layers(app) {
  if (!need(app)) return;
  const d = app.doc;
  const cfg = d.ocConfig;
  const groups = [];
  if (cfg) for (const [id, g] of cfg) groups.push({ id, name: g.name || id, on: cfg.isVisible(id) });
  const s = sheet(`圖層（${groups.length}）`, { pad: true, center: true });
  if (!groups.length) s.body.append(el('div.small', { text: '這份文件沒有圖層（選用內容）。' }));
  for (const g of groups) {
    const c = el('input', { type: 'checkbox', checked: g.on });
    c.addEventListener('change', () => { cfg.setVisibility(g.id, c.checked); app.viewer.refresh(); });
    s.body.append(el('label.check', c, el('span', { text: g.name })));
  }
  if (groups.length) s.body.append(el('div.small', { text: '切換只影響檢視，不會改變文件。要把浮水印圖層從檔案中移除，請用「移除浮水印」。' }));
}

// ================================================================ 附件

export async function attachments(app) {
  if (!need(app)) return;
  const d = app.doc;
  const list = await run(null, async () => (await loadLib(d.current)).getAttachments());
  const s = sheet(`附件（${list.length}）`, { height: '70vh' });
  s.head.insertBefore(el('button.ib', { text: '＋', title: '加入附件', onclick: async () => {
    const [file] = await pickFiles('*/*');
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    s.close();
    await app.edit('加入附件', K_EDIT, lib => lib.attach(bytes, file.name, { mimeType: file.type || 'application/octet-stream', creationDate: new Date(), modificationDate: new Date() }));
    attachments(app);
  } }), s.head.lastChild);
  if (!list.length) s.body.append(pad('沒有附件。按「＋」可以把任何檔案附加到這份 PDF。'));
  for (const a of list) {
    s.body.append(el('div.row', { onclick: async () => {
      const k = await choose(a.name, ['開啟', '下載', '移除']);
      const blob = new Blob([a.data], { type: a.mimeType || 'application/octet-stream' });
      if (k === 0) { const u = URL.createObjectURL(blob); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
      else if (k === 1) download(blob, a.name);
      else if (k === 2 && await confirmBox('移除附件', `從文件中移除「${a.name}」？`, '移除', true)) { s.close(); await app.edit('移除附件', K_EDIT, lib => lib.detach(a.name)); attachments(app); }
    } }, el('div.tx', el('div.t1', { text: '📎 ' + a.name }), el('div.t2', { text: [size(a.data.length), a.description].filter(Boolean).join(' · ') }))));
  }
}

// ================================================================ 文件屬性

const PERM_NAMES = [[PF.PRINT, '列印'], [PF.PRINT_HIGH_QUALITY, '高品質列印'], [PF.MODIFY_CONTENTS, '修改文件'], [PF.COPY, '複製文字與圖片'],
  [PF.MODIFY_ANNOTATIONS, '新增 / 修改註解'], [PF.FILL_INTERACTIVE_FORMS, '填寫表單'], [PF.COPY_FOR_ACCESSIBILITY, '無障礙擷取'], [PF.ASSEMBLE, '組合文件（頁面）']];

export function paper(w, h) {
  const mm = `${Math.round(w * 25.4 / 72)} × ${Math.round(h * 25.4 / 72)} mm`;
  const a = Math.min(w, h), b = Math.max(w, h);
  for (const [n, x, y] of [['A3', 842, 1191], ['A4', 595, 842], ['A5', 420, 595], ['B5', 499, 709], ['Letter', 612, 792], ['Legal', 612, 1008]])
    if (Math.abs(a - x) < 4 && Math.abs(b - y) < 4) return `${n}${w > h ? ' 橫向' : ''}（${mm}）`;
  return mm;
}

export async function properties(app) {
  if (!need(app)) return;
  const d = app.doc;
  const m = await run('讀取文件屬性…', async () => {
    const lib = await loadLib(d.current);
    const outline = ops.readOutline(lib);
    let sigs = 0;
    try { sigs = lib.getForm().getFields().filter(f => f instanceof L.PDFSignature).length; } catch {}
    const cat = lib.catalog;
    const mark = cat.lookup(L.PDFName.of('MarkInfo'));
    let tagged = false; try { tagged = mark && mark.lookup(L.PDFName.of('Marked')).asBoolean(); } catch {}
    let lang = ''; try { lang = cat.lookup(L.PDFName.of('Lang')).decodeText(); } catch {}
    return { info: ops.info(lib), fonts: ops.fonts(lib), fields: ops.fields(lib).length, attachments: lib.getAttachments().length, bookmarks: outline.length,
      version: lib.getVersion ? lib.getVersion() : '', sigs, tagged, lang, layers: d.ocConfig ? [...d.ocConfig].length : 0 };
  });
  const s = sheet('文件屬性', { height: '86vh' });
  const b = s.body;
  b.append(el('div.sec', { text: '描述（可編輯）' }));
  const inputs = {};
  const descBox = el('div', { style: { padding: '0 18px' } });
  for (const [k, l] of [['title', '標題'], ['author', '作者'], ['subject', '主旨'], ['keywords', '關鍵字']]) {
    inputs[k] = el('input', { value: Array.isArray(m.info[k]) ? m.info[k].join(', ') : m.info[k] || '' });
    descBox.append(el('div.field', el('label', { text: l }), inputs[k]));
  }
  descBox.append(el('button.btn.primary', { text: '儲存描述', onclick: () => {
    const o = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value]));
    s.close(); app.edit('編輯文件資訊', K_EDIT, lib => ops.setInfo(lib, o));
  } }));
  b.append(descBox);
  const row = (t, r, sub2, onclick) => el('div.row', { onclick }, el('div.tx', el('div.t1', { text: t }), sub2 ? el('div.t2', { text: sub2 }) : null), r != null ? el('div.r', { text: String(r) }) : null);
  b.append(el('div.sec', { text: '文件' }));
  const pg = d.pages[0];
  const mixed = d.pages.some(p => Math.abs(p.w - pg.w) > 1 || Math.abs(p.h - pg.h) > 1);
  const dt = x => x ? x.toLocaleString('zh-TW') : '';
  b.append(row('檔案名稱', d.name), row('檔案大小', size(d.current.length)), row('頁數', d.n),
    row('頁面大小', paper(pg.w, pg.h), mixed ? '各頁大小不同（顯示第 1 頁）' : null),
    row('頁面標籤', d.labels ? `有（例如 ${d.labels[0]}）` : '無', null, () => { s.close(); app.tools.labels(); }),
    row('書籤', `${m.bookmarks} 個（第一層）`), row('表單欄位', m.fields), row('圖層', m.layers), row('附件', m.attachments), row('數位簽章', m.sigs),
    row('標記（Tagged PDF）', m.tagged ? '是' : '否'), row('語言', m.lang || '未設定'),
    row('建立者 / 製作程式', m.info.producer, m.info.creator), row('建立 / 修改日期', dt(m.info.modified), dt(m.info.created)));
  b.append(el('div.sec', { text: `字型（${m.fonts.size}）` }));
  if (!m.fonts.size) b.append(row('沒有使用字型'));
  for (const [n, v] of m.fonts) b.append(row(n, null, v));
  b.append(el('div.sec', { text: '安全性' }));
  if (!d.encrypted) b.append(row('未加密', null, '任何人都可以開啟'));
  else {
    b.append(row('加密', '是'), row('開啟時使用', d.owner ? '擁有者密碼（完整權限）' : (d.openPwd ? '使用者密碼' : '不需密碼（使用者）')));
    if (d.perms) for (const [f, n] of PERM_NAMES) b.append(row(n, d.owner || d.perms.includes(f) ? '允許' : '不允許'));
    if (!d.owner) b.append(row('🔒 輸入擁有者密碼以解除限制', null, null, () => { s.close(); unlock(app); }));
    if (d.encOut) b.append(row('儲存時', null, '以 AES-256 重新加密，保留相同密碼'));
  }
  b.append(row('變更保護設定…', null, null, () => { s.close(); app.tools.run('protect'); }));
}

export async function unlock(app) {
  const d = app.doc;
  const pw = await prompt('解除限制', '擁有者密碼', '', 'password');
  if (!pw) return;
  await run('驗證中…', async () => {
    const orig = d.originalBytes;
    await loadLib(orig || d.current, pw);
    if (pw === d.openPwd && d.perms) throw new Error('這是開啟密碼，不是擁有者密碼');
    d.owner = true;
    d.encOut = { ...(d.encOut || {}), owner: pw };
  });
  toast('已解除限制，可以編輯了');
  app.refreshBars();
}
