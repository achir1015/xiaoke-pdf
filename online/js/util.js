// 介面與通用工具
export const $ = (s, r = document) => r.querySelector(s);

/** el('div.cls#id', {props}, children...) */
export function el(spec, props, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const n = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') n.classList.add(v); else n.id = v; });
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k in n && k !== 'list' && k !== 'type') { try { n[k] = v; } catch { n.setAttribute(k, v); } }
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- 偏好設定
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('xk.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('xk.' + k, JSON.stringify(v)); } catch {} },
};

// ---------------------------------------------------------------- 訊息
export function toast(msg, ms = 2200) {
  const t = el('div.toast', { text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

const layer = () => $('#layer');

/** 從下方滑出的面板。回傳 {root, body, header, close, done(promise)} */
export function sheet(title, opts = {}) {
  let resolveDone;
  const done = new Promise(r => resolveDone = r);
  const scrim = el('div.scrim' + (opts.center ? '.center' : ''));
  const head = el('div.hd', el('div.tt', { text: title }));
  const close = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey); resolveDone(v); opts.onClose && opts.onClose(v); };
  head.append(el('button.ib', { title: '關閉', text: '✕', onclick: () => close() }));
  const body = el('div.bd' + (opts.pad ? '.pad' : ''));
  const box = el('div.sheet', head, body);
  if (opts.height) box.style.height = opts.height;
  scrim.append(box);
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) scrim.dataset.down = '1'; });
  scrim.addEventListener('click', e => { if (e.target === scrim && scrim.dataset.down && !opts.modal) close(); delete scrim.dataset.down; });
  const onKey = e => { if (e.key === 'Escape' && !opts.modal) close(); };
  document.addEventListener('keydown', onKey);
  layer().append(scrim);
  return { scrim, box, head, body, close, done, footer(...btns) { const f = el('div.ft', btns); box.append(f); return f; } };
}

export function alertBox(title, msg) {
  const s = sheet(title, { pad: true, center: true });
  s.body.append(el('div.msgtext', { text: msg }));
  s.footer(el('button.btn', { text: '確定', onclick: () => s.close(true) }));
  return s.done;
}

export function confirmBox(title, msg, ok = '確定', danger = false) {
  const s = sheet(title, { pad: true, center: true });
  s.body.append(el('div.msgtext', { text: msg }));
  s.footer(el('button.btn', { text: '取消', onclick: () => s.close(false) }),
    el('button.btn' + (danger ? '.danger' : '.primary'), { text: ok, onclick: () => s.close(true) }));
  return s.done.then(v => !!v);
}

/** 多按鈕對話框，回傳按鈕索引（-1 取消） */
export function ask(title, msg, buttons) {
  const s = sheet(title, { pad: true, center: true, modal: true });
  s.body.append(el('div.msgtext', { text: msg }));
  s.footer(buttons.map((b, i) => el('button.btn' + (i === buttons.length - 1 ? '.primary' : ''), { text: b, onclick: () => s.close(i) })));
  return s.done.then(v => v == null ? -1 : v);
}

/**
 * 表單對話框。fields: [{key, label, type:'text'|'password'|'number'|'textarea'|'check'|'select', value, options, placeholder}]
 * 回傳物件或 null。
 */
export function form(title, fields, ok = '確定', note) {
  const s = sheet(title, { pad: true, center: true });
  const inputs = {};
  for (const f of fields) {
    if (f.type === 'check') {
      const c = el('input', { type: 'checkbox', checked: !!f.value });
      inputs[f.key] = c;
      s.body.append(el('label.check', c, el('span', { text: f.label })));
      continue;
    }
    if (f.type === 'note') { s.body.append(el('div.small', { text: f.label, style: { margin: '4px 0 10px' } })); continue; }
    let inp;
    if (f.type === 'textarea') inp = el('textarea', { rows: f.rows || 4, placeholder: f.placeholder || '' });
    else if (f.type === 'select') inp = el('select', f.options.map((o, i) => el('option', { value: i, text: o })));
    else inp = el('input', { type: f.type || 'text', placeholder: f.placeholder || '', autocomplete: 'off', inputMode: f.inputMode || undefined });
    if (f.value != null) inp.value = f.value;
    inputs[f.key] = inp;
    s.body.append(el('div.field', el('label', { text: f.label }), inp));
  }
  if (note) s.body.append(el('div.small', { text: note }));
  const submit = () => {
    const out = {};
    for (const f of fields) {
      const i = inputs[f.key];
      if (!i) continue;
      out[f.key] = f.type === 'check' ? i.checked : f.type === 'select' ? +i.value : f.type === 'number' ? parseFloat(i.value) : i.value;
    }
    s.close(out);
  };
  s.footer(el('button.btn', { text: '取消', onclick: () => s.close(null) }), el('button.btn.primary', { text: ok, onclick: submit }));
  s.body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit(); });
  setTimeout(() => { const first = s.body.querySelector('input:not([type=checkbox]),textarea'); if (first) { first.focus(); first.select && first.select(); } }, 60);
  return s.done.then(v => v || null);
}

export async function prompt(title, label, value = '', type = 'text') {
  const r = await form(title, [{ key: 'v', label, value, type }]);
  return r ? r.v : null;
}

/** 選單，回傳索引或 -1 */
export function choose(title, items, opts = {}) {
  const s = sheet(title, { center: true });
  items.forEach((it, i) => {
    const t = typeof it === 'string' ? { t: it } : it;
    const r = el('div.row', { onclick: () => { if (!t.disabled) s.close(i); } },
      el('div.tx', el('div.t1', { text: t.t }), t.s ? el('div.t2', { text: t.s }) : null), t.r ? el('div.r', { text: t.r }) : null);
    if (t.disabled) r.style.opacity = .45;
    s.body.append(r);
  });
  return s.done.then(v => v == null ? -1 : v);
}

let busyEl = null, busyCount = 0;
export function busy(msg) {
  busyCount++;
  if (!busyEl) { busyEl = el('div.busy', el('div.box', el('div.spin'), el('div.bm', { text: msg }))); layer().append(busyEl); }
  else busyEl.querySelector('.bm').textContent = msg;
  return () => { if (--busyCount <= 0) { busyCount = 0; busyEl && busyEl.remove(); busyEl = null; } };
}

/** 執行工作並顯示忙碌畫面，錯誤時跳出訊息 */
export async function run(msg, fn) {
  const done = msg ? busy(msg) : () => {};
  await sleep(30);
  try { return await fn(); }
  catch (e) { console.error(e); await alertBox('發生錯誤', errText(e)); throw e; }
  finally { done(); }
}

export function errText(e) {
  let m = e && (e.message || String(e)) || '未知錯誤';
  if (/Password/i.test(m) && /incorrect|wrong|invalid/i.test(m)) m = '密碼不正確';
  return m;
}

// ---------------------------------------------------------------- 檔案
export function pickFiles(accept = 'application/pdf', multiple = false) {
  return new Promise(resolve => {
    const i = el('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    i.addEventListener('change', () => { resolve([...i.files]); i.remove(); });
    i.addEventListener('cancel', () => { resolve([]); i.remove(); });
    document.body.append(i);
    i.click();
  });
}

export function download(data, name, mime = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = el('a', { href: URL.createObjectURL(blob), download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/** 分享檔案（手機）或下載 */
export async function shareOrDownload(bytes, name, mime = 'application/pdf') {
  const file = new File([bytes], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(bytes, name, mime);
}

export function size(b) {
  if (b == null || b < 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export const base = n => n.replace(/\.pdf$/i, '');
export const safeName = s => s.replace(/[\\/:*?"<>|]/g, '_');

/** 「1,3,5-8」→ 0 起算陣列 */
export function parsePages(spec, n) {
  const out = new Set();
  spec = String(spec || '').replace(/[，、]/g, ',').replace(/[～~]/g, '-').replace(/\s/g, '');
  for (const p of spec.split(',')) {
    if (!p) continue;
    const m = /^(\d+)-(\d*)$/.exec(p);
    if (m) { let a = +m[1], b = m[2] ? +m[2] : n; if (a > b) [a, b] = [b, a]; for (let i = Math.max(1, a); i <= Math.min(n, b); i++) out.add(i - 1); }
    else if (/^\d+$/.test(p)) { const a = +p; if (a >= 1 && a <= n) out.add(a - 1); }
  }
  return [...out].sort((a, b) => a - b);
}

export function specOf(p) {
  const s = []; for (let i = 0; i < p.length;) { let j = i; while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++; s.push(j > i ? `${p[i] + 1}-${p[j] + 1}` : `${p[i] + 1}`); i = j + 1; }
  return s.join(', ');
}

export const today = () => new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
export const now = () => today() + ' ' + new Date().toTimeString().slice(0, 5);

export function hex(c) { return '#' + ((1 << 24) | c).toString(16).slice(1); }
export function rgbOf(css) {
  const m = /^#?([0-9a-f]{6})$/i.exec(css); const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

// ---------------------------------------------------------------- IndexedDB
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('xiaoke-pdf', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['sessions', 'blobs', 'certs', 'sigs', 'recent', 'shared']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export const idb = {
  async get(store, key) { const d = await db(); return new Promise((res, rej) => { const r = d.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async set(store, key, val) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async del(store, key) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async keys(store) { const d = await db(); return new Promise((res, rej) => { const r = d.transaction(store).objectStore(store).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
};

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
