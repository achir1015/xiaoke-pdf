// 建立 DOM 的小幫手：h('div', { class: 'x', onclick }, '文字', 子元素...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || (k in el && typeof v !== 'string')) el[k] = v;   // textarea 的內容要用屬性設定
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 一個有標題的欄位 */
export const field = (label, control, hint) =>
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);

/** 分段按鈕（像 iOS 的 segmented control） */
export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const btns = options.map(([v, label]) => {
    const b = h('button', { type: 'button', role: 'radio', class: 'seg-btn', onclick: () => { set(v); onChange(v); } }, label);
    b.dataset.v = v;
    return b;
  });
  const set = (v) => btns.forEach(b => { const on = b.dataset.v === String(v); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  set(value);
  wrap.append(...btns);
  wrap.set = set;
  return wrap;
}

/** 顏色選擇：色票 + 自訂 */
export function colorPicker(value, onChange, swatches = ['#1d1f23', '#d93025', '#1e63e9', '#188038', '#e37400', '#ffffff']) {
  const input = h('input', { type: 'color', value, class: 'color-input', oninput: () => { onChange(input.value); mark(input.value); } });
  const sw = swatches.map(c => {
    const b = h('button', { type: 'button', class: 'swatch', title: c, style: { background: c }, onclick: () => { input.value = c; onChange(c); mark(c); } });
    b.dataset.c = c;
    return b;
  });
  const mark = (v) => sw.forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === String(v).toLowerCase()));
  mark(value);
  const wrap = h('div', { class: 'colors' }, ...sw, input);
  wrap.set = (v) => { if (document.activeElement !== input) input.value = v; mark(v); };
  return wrap;
}

/** 開關按鈕（粗體、底線…） */
export function toggle(label, value, onChange, title) {
  const b = h('button', { type: 'button', class: 'tog', title: title || '', 'aria-pressed': String(!!value), onclick: () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); onChange(v); } });
  b.innerHTML = label;
  b.set = (v) => b.setAttribute('aria-pressed', String(!!v));
  return b;
}

/** 滑桿 + 數值 */
export function slider(min, max, step, value, onChange, fmt = (v) => v) {
  const out = h('output', {}, fmt(value));
  const r = h('input', { type: 'range', min, max, step, value, oninput: () => { out.textContent = fmt(+r.value); onChange(+r.value); } });
  const wrap = h('div', { class: 'slider' }, r, out);
  wrap.set = (v) => { if (document.activeElement !== r) r.value = v; out.textContent = fmt(v); };
  return wrap;
}

/** 讓使用者選一個檔案 */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
