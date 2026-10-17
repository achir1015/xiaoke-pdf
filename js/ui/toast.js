// 提示訊息與「處理中」遮罩
let host;
function ensureHost() {
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
  return host;
}

/** 右下角跳出一則提示。kind：info | ok | warn | error */
export function toast(message, kind = 'info', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  ensureHost().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

/** 執行一段比較久的工作，期間顯示遮罩，結束（或出錯）自動收起 */
export async function busy(message, fn) {
  const mask = document.createElement('div');
  mask.className = 'busy';
  mask.innerHTML = `<div class="busy-card"><span class="spinner"></span><span></span></div>`;
  mask.querySelector('span:last-child').textContent = message;
  document.body.appendChild(mask);
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));   // 先讓遮罩畫出來
  const label = mask.querySelector('span:last-child');
  try { return await fn((m) => { label.textContent = m; }); } finally { mask.remove(); }
}
