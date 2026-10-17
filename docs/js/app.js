// 小柯文件PDF線上版：外殼（分頁、首頁、工具列、搜尋、選取、工具模式、儲存、復原、安裝、更新通知）
import { $, el, sheet, choose, prompt, form, confirmBox, alertBox, ask, toast, run, busy, size, download, shareOrDownload, pickFiles, prefs, idb, base, sleep, errText } from './util.js';
import { Doc, K_EDIT, K_ANNOT, K_FORM } from './doc.js';
import { Viewer } from './viewer.js';
import { Tools, TOOLS, byId, pageText } from './tools.js';
import * as panels from './panels.js';
import * as ops from './ops.js';
import { PALETTE, textPng } from './style.js';
import { loadLib } from './core.js';
import { Inline } from './inline.js';

export const VERSION = '1.1.0';
const REPO = 'achir1015/xiaoke-pdf';

// ================================================================ 搜尋

class Search {
  constructor(app) { this.app = app; this.gen = 0; this.results = []; this.idx = -1; }

  /** 一頁的文字（含每個字元的位置） */
  async pageChars(d, i) {
    const items = await d.text(i);
    let s = '';
    const pos = [];
    let last = null;
    for (const it of items) {
      if (last) {
        if (Math.abs(it.y - last.y) > last.h * 0.5) { s += '\n'; pos.push(null); }
        else if (it.x - (last.x + last.w) > it.size * 0.25 && !/\s$/.test(s)) { s += ' '; pos.push(null); }
      }
      const n = it.str.length || 1;
      for (let k = 0; k < it.str.length; k++) {
        s += it.str[k];
        pos.push(it.vertical ? { x: it.x, y: it.y + it.h * k / n, w: it.w, h: it.h / n } : { x: it.x + it.w * k / n, y: it.y, w: it.w / n, h: it.h });
      }
      last = it;
    }
    return { s, pos };
  }

  rectsOf(pos, a, b) {
    const out = [];
    for (let k = a; k < b; k++) {
      const p = pos[k];
      if (!p) continue;
      const l = out[out.length - 1];
      if (l && Math.abs((l.y + l.h / 2) - (p.y + p.h / 2)) < Math.max(l.h, p.h) * 0.5) { const x2 = Math.max(l.x + l.w, p.x + p.w); l.x = Math.min(l.x, p.x); l.w = x2 - l.x; }
      else out.push({ ...p });
    }
    return out;
  }

  terms(q) { return q.replace(/，/g, ',').split(',').map(t => t.trim()).filter(Boolean); }

  async findAll(q, onPage) {
    const d = this.app.doc, terms = this.terms(q).map(t => t.toLowerCase());
    const out = [];
    for (let i = 0; i < d.n; i++) {
      const { s, pos } = await this.pageChars(d, i);
      const low = s.toLowerCase().replace(/\n/g, ' ');
      const found = [];
      for (const t of terms) { let k = 0; while ((k = low.indexOf(t, k)) >= 0) { found.push({ page: i, at: k, rects: this.rectsOf(pos, k, k + t.length) }); k += Math.max(1, t.length); } }
      found.sort((a, b) => a.at - b.at);
      out.push(...found.filter(f => f.rects.length));
      if (onPage && onPage(i, found) === false) return out;
    }
    return out;
  }

  async run(q) {
    const a = this.app, v = a.viewer, g = ++this.gen;
    this.results = []; this.idx = -1; v.hits = new Map(); v.hitCur = null; v.redrawOverlays();
    const count = $('#searchbar .count');
    if (!this.terms(q).length) { count.textContent = ''; return; }
    count.textContent = '搜尋中…';
    const start = a.doc.view.page;
    await this.findAll(q, (i, found) => {
      if (g !== this.gen) return false;
      if (found.length) { v.hits.set(i, found.flatMap(f => f.rects)); this.results.push(...found); }
      if (this.idx < 0 && this.results.length && i >= start) { this.idx = this.results.length - found.length; this.show(); }
      count.textContent = this.results.length ? `符合 ${this.idx + 1}/${this.results.length}${i + 1 < a.doc.n ? `（${i + 1}/${a.doc.n} 頁）` : ''}` : (i + 1 < a.doc.n ? `搜尋中（${i + 1}/${a.doc.n}）` : '找不到');
      if (v.slots[i] && v.slots[i].ov) v.drawOverlay(v.slots[i]);
    });
    if (g !== this.gen) return;
    if (this.idx < 0 && this.results.length) { this.idx = 0; this.show(); }
    count.textContent = this.results.length ? `符合 ${this.idx + 1}/${this.results.length}` : '找不到';
  }

  step(dir) {
    if (!this.results.length) return;
    this.idx = (this.idx + dir + this.results.length) % this.results.length;
    this.show();
    $('#searchbar .count').textContent = `符合 ${this.idx + 1}/${this.results.length}`;
  }

  show() {
    const r = this.results[this.idx], v = this.app.viewer;
    const u = r.rects.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.x + b.w), b: Math.max(a.b, b.y + b.h) }), { x: 1e9, y: 1e9, r: -1e9, b: -1e9 });
    v.hitCur = { page: r.page, rects: r.rects };
    v.goTo(r.page, { x: u.x, y: u.y, w: u.r - u.x, h: u.b - u.y });
    v.redrawOverlays();
  }
}

// ================================================================ 更新通知

class Updater {
  constructor(app) { this.app = app; this.version = VERSION; this.reg = null; }

  async init() {
    const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !new URLSearchParams(location.search).has('sw');
    if ('serviceWorker' in navigator && location.protocol !== 'file:' && !dev) {
      try {
        this.reg = await navigator.serviceWorker.register('sw.js');
        this.reg.addEventListener('updatefound', () => {
          const w = this.reg.installing;
          w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) this.banner('小柯文件PDF線上版有新版本，已下載完成。', null); });
        });
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && this.applying) { reloading = true; location.reload(); } });
      } catch (e) { console.warn('sw', e); }
    }
    setTimeout(() => this.check(false), 3000);
    setInterval(() => this.check(false), 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.check(false); });
  }

  newer(a, b) {
    const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
    return false;
  }

  async check(manual) {
    let info = null, android = null;
    try { info = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json(); } catch {}
    if (manual) { try { const r = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)).json(); android = r.tag_name; } catch {} }
    const latest = info && info.version;
    if (latest && this.newer(latest, VERSION)) {
      if (this.reg) try { await this.reg.update(); } catch {}
      this.banner(`小柯文件PDF線上版有新版 v${latest}${info.notes ? `：${info.notes}` : ''}`, latest);
      if (manual) toast('有新版 v' + latest);
      return;
    }
    if (manual) {
      alertBox('已是最新版', `線上版目前版本 v${VERSION}${latest ? `\n網站最新版 v${latest}` : '\n（目前無法連線檢查）'}`
        + (android ? `\n\nAndroid App「小柯文件PDF助手」最新版 ${android}\nhttps://github.com/${REPO}/releases/latest` : ''));
    }
  }

  banner(msg, ver) {
    const u = $('#update');
    u.innerHTML = '';
    u.append(el('span', { text: '🔔' }), el('div.msg', { text: msg }),
      el('button.pill', { text: '立即更新', onclick: () => this.apply() }), el('button.ib', { text: '✕', title: '稍後', onclick: () => u.classList.add('hidden') }));
    u.classList.remove('hidden');
  }

  async apply() {
    const dirty = this.app.docs.filter(d => d.dirty);
    if (dirty.length) await Promise.all(dirty.map(d => d.persist()));
    this.applying = true;
    const w = this.reg && (this.reg.waiting || this.reg.installing);
    if (w) { w.postMessage('SKIP_WAITING'); setTimeout(() => location.reload(), 1500); }
    else {
      if (this.reg) try { await this.reg.update(); } catch {}
      const ww = this.reg && this.reg.waiting;
      if (ww) { ww.postMessage('SKIP_WAITING'); setTimeout(() => location.reload(), 1500); }
      else location.reload();
    }
  }
}

// ================================================================ 主程式

class App {
  constructor() {
    this.docs = [];
    this.cur = -1;
    this.closed = [];
    this.mode = null;
    this.viewer = new Viewer(this);
    this.tools = new Tools(this);
    this.search = new Search(this);
    this.updater = new Updater(this);
    this.inline = new Inline(this);
    this.installEvt = null;
    this.applyTheme();
    this.home = null;
  }

  get doc() { return this.docs[this.cur] || null; }

  async start() {
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); this.installEvt = e; });
    window.addEventListener('beforeunload', e => { if (this.docs.some(d => d.dirty)) { this.docs.forEach(d => d.persist()); } });
    document.addEventListener('keydown', e => this.onKey(e));
    this.setupDrop();
    this.updater.init();
    setInterval(() => this.docs.forEach(d => d.dirty && d.persist()), 60000);
    this.select(-1);
    await this.recover();
    await this.handleLaunch();
  }

  // ---------------------------------------------------------------- 主題

  applyTheme() {
    const t = prefs.get('theme', 'system');
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  }
  setTheme(t) { prefs.set('theme', t); this.applyTheme(); this.refreshBars(); }
  get dark() { const t = prefs.get('theme', 'system'); return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); }
  toggleLook(k) {
    const v = this.viewer;
    if (k === 'night') { v.night = !v.night; v.sepia = false; } else { v.sepia = !v.sepia; v.night = false; }
    prefs.set('night', v.night); prefs.set('sepia', v.sepia); v.applyLook();
  }

  // ---------------------------------------------------------------- 分頁

  refreshTabs() {
    const t = $('#tabs');
    t.innerHTML = '';
    t.append(el('div.tab.tab-home' + (this.cur < 0 ? '.sel' : ''), { text: '⌂', title: '首頁', onclick: () => this.select(-1) }));
    this.docs.forEach((d, i) => {
      const tab = el('div.tab' + (i === this.cur ? '.sel' : ''), { title: d.name },
        d.dirty ? el('span.dot', { text: '●' }) : null, el('span.name', { text: d.name }),
        el('button.x', { text: '✕', title: '關閉', onclick: e => { e.stopPropagation(); this.closeTab(this.docs.indexOf(d)); } }));
      tab.addEventListener('click', () => this.select(this.docs.indexOf(d)));
      tab.addEventListener('contextmenu', e => { e.preventDefault(); this.tabMenu(this.docs.indexOf(d)); });
      let lt; tab.addEventListener('touchstart', () => { lt = setTimeout(() => this.tabMenu(this.docs.indexOf(d)), 550); }, { passive: true });
      tab.addEventListener('touchend', () => clearTimeout(lt)); tab.addEventListener('touchmove', () => clearTimeout(lt));
      t.append(tab);
    });
    t.append(el('div.tab.open', { text: '＋ 開啟', onclick: () => this.pickPdf() }));
    const sel = t.children[this.cur + 1];
    sel && sel.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    document.title = this.doc ? `${this.doc.dirty ? '● ' : ''}${this.doc.name} – 小柯文件PDF線上版` : '小柯文件PDF線上版';
  }

  async tabMenu(i) {
    const d = this.docs[i];
    const k = await choose(d.name, ['關閉', '關閉其他分頁', { t: '重新開啟上次關閉的分頁', disabled: !this.closed.length }, '顯示檔案資訊', '分享']);
    if (k === 0) this.closeTab(i);
    else if (k === 1) for (const x of [...this.docs]) if (x !== d) { if (x.dirty) { toast(`「${x.name}」有未儲存的變更，已保留`); continue; } this.closeTab(this.docs.indexOf(x), true); }
    else if (k === 2) this.reopenClosed();
    else if (k === 3) alertBox('檔案', `名稱：${d.name}\n頁數：${d.n}\n大小：${size(d.current.length)}\n可直接寫回原檔：${d.handle ? '是' : '否（儲存時會下載新檔）'}\n編輯步驟：${d.steps.length - 1}`);
    else if (k === 4) { this.select(i); this.share(); }
  }

  select(i) {
    this.exitModes();
    this.cur = Math.min(i, this.docs.length - 1);
    const main = $('#main');
    main.innerHTML = '';
    if (!this.doc) { main.append(this.buildHome()); this.viewer.setDoc(null); }
    else {
      main.append(this.viewer.frame);
      this.viewer.setDoc(this.doc);
      const d = this.doc;
      if (d.repaired) { d.repaired = false; toast('這份文件有損壞，已自動修復'); }
      if (d.broken) toast('文件結構損壞，以唯讀模式開啟');
      else if (d.encrypted && !d.owner && d.block(K_EDIT)) this.hint('🔒 作者限制了這份文件的部分權限。', [['解除限制', () => panels.unlock(this)]]);
    }
    this.refreshTabs();
    this.refreshBars();
    this.docs.forEach((d, k) => d.order = k);
  }

  // ---------------------------------------------------------------- 工具列

  refreshBars() {
    const tb = $('#toolbar'), nav = $('#nav'), d = this.doc;
    tb.innerHTML = '';
    tb.append(el('button.ib', { text: '☰', title: '所有工具', onclick: () => this.tools.catalog() }));
    if (!d) {
      tb.append(el('div.title', el('img', { src: 'icons/icon.svg', alt: '' }), el('span', { text: '小柯文件PDF線上版' })),
        el('button.ib', { text: '⌕', title: '尋找工具與指令（Ctrl+K）', onclick: () => this.tools.palette() }),
        el('button.ib', { text: this.dark ? '☀' : '☾', title: '切換深色 / 淺色主題', onclick: () => this.setTheme(this.dark ? 'light' : 'dark') }));
      nav.classList.add('hidden');
      return;
    }
    tb.append(
      el('button.ib', { text: '↶', title: d.undoLabel() ? '復原：' + d.undoLabel() : '復原', disabled: !d.undoLabel(), onclick: () => this.undo() }),
      el('button.ib', { text: '↷', title: d.redoLabel() ? '重做：' + d.redoLabel() : '重做', disabled: !d.redoLabel(), onclick: () => this.redo() }),
      el('div.spacer'),
      el('button.ib', { text: '⌕', title: '搜尋文件（逗號分隔可同時找多個詞）', onclick: () => this.openSearch() }),
      el('button.pill', { text: '編輯', title: '編輯文字、新增文字…', onclick: () => this.editMode() }),
      el('button.ib', { text: '💬', title: '註解工具', onclick: () => this.commentMode() }),
      el('button.ib' + (d.dirty ? '.on' : ''), { text: '💾', title: d.dirty ? '儲存（有未儲存的變更）' : '儲存', onclick: () => this.save() }),
      el('button.ib', { text: '⋮', title: '更多', onclick: () => this.more() }));
    nav.innerHTML = '';
    for (const [ic, t, f] of [['🔖', '書籤', () => panels.bookmarks(this)], ['▦', '縮圖', () => panels.thumbnails(this)], ['💬', '註解', () => panels.comments(this)],
      ['☐', '表單', () => panels.fields(this)], ['◫', '圖層', () => panels.layers(this)], ['📎', '附件', () => panels.attachments(this)]])
      nav.append(el('button', { onclick: f }, el('b', { text: ic }), el('span', { text: t })));
    nav.classList.toggle('hidden', !!this.full);
  }

  panel(k) { if (k === 'thumbs') panels.thumbnails(this); }

  async more() {
    const v = this.viewer, d = this.doc;
    const items = ['連續捲動', '單頁', '雙頁', '向右旋轉檢視', '全螢幕閱讀', v.night ? '關閉夜間頁面' : '夜間頁面（反白）', v.sepia ? '關閉護眼色' : '護眼色', '前往頁面…',
      '整理頁面', '文件屬性', '另存新檔…', '分享', '列印', '關閉分頁', { t: '重新開啟上次關閉的分頁', disabled: !this.closed.length }, '設定'];
    const k = await choose(d.name, items);
    [() => v.setMode('cont'), () => v.setMode('single'), () => v.setMode('two'), () => v.rotateView(1), () => this.fullscreen(true), () => this.toggleLook('night'),
      () => this.toggleLook('sepia'), () => this.askPage(), () => this.tools.organize(), () => panels.properties(this), () => this.saveAs(), () => this.share(),
      () => this.tools.print(), () => this.closeTab(this.cur), () => this.reopenClosed(), () => this.tools.settings()][k]?.();
  }

  fullscreen(on) {
    this.full = on;
    for (const id of ['#tabs', '#toolbar']) $(id).classList.toggle('hidden', on);
    $('#nav').classList.toggle('hidden', on || !this.doc);
    if (on) { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); toast('無干擾閱讀：點一下空白處或按 Esc 離開'); }
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  askPage() {
    const d = this.doc;
    if (!d) return;
    prompt('前往頁面', `頁碼（1–${d.n}）或頁面標籤`, '').then(s => {
      if (!s) return;
      s = s.trim();
      if (d.labels) { const k = d.labels.findIndex(l => l && l.toLowerCase() === s.toLowerCase()); if (k >= 0) return this.viewer.goTo(k); }
      const n = parseInt(s); n ? this.viewer.goTo(n - 1) : toast('找不到這一頁');
    });
  }

  // ---------------------------------------------------------------- 首頁

  buildHome() {
    const h = el('div.home'), w = el('div.wrap');
    h.append(w);
    w.append(el('div.hero', el('img', { src: 'icons/icon.svg', alt: '' }),
      el('div', el('h1', { text: '歡迎使用小柯文件PDF線上版' }), el('p', { text: '在瀏覽器裡閱讀、註解、填寫、簽署與整理 PDF — 檔案不會上傳，全部在你的裝置上處理。' }))));
    w.append(el('button.search-tools', { text: '⌕  尋找工具與指令', onclick: () => this.tools.palette() }));
    w.append(el('h2', { text: '推薦工具' }));
    const cards = el('div.cards');
    for (const id of ['organize', 'comment', 'form', 'edit', 'protect', 'combine', 'fillsign', 'unwatermark']) {
      const t = byId(id);
      cards.append(el('div.card', { onclick: () => this.tools.run(t.id) }, el('div.t', el('span', { text: t.icon + ' ', style: { color: t.color } }), t.name), el('div.d', { text: t.desc }), el('div.u', { text: '立即使用' })));
    }
    w.append(cards);
    const drop = el('div.drop', { onclick: () => this.pickPdf() }, el('div.big', { text: '📂' }), el('b', { text: '開啟檔案' }), el('div.small', { text: '點這裡選擇 PDF，或把檔案拖曳到這裡' }));
    w.append(drop);
    const recent = el('div');
    w.append(recent);
    this.drawRecent(recent);
    w.append(el('h2', { text: '所有工具' }));
    const g = el('div.grid');
    for (const t of TOOLS) g.append(el('div.tool', { onclick: () => this.tools.run(t.id) }, el('span.ic', { text: t.icon, style: { color: t.color } }),
      el('div', el('div', { text: t.name }), t.status ? el('div.st', { text: t.status }) : null)));
    w.append(g);
    w.append(el('h2', { text: '安裝與更新' }));
    w.append(el('div.list',
      el('div.row', { onclick: () => this.installApp() }, el('div.tx', el('div.t1', { text: '📲 安裝到主畫面 / 建立捷徑' }), el('div.t2', { text: '像 App 一樣從主畫面開啟，離線也能用' }))),
      el('div.row', { onclick: () => this.updater.check(true) }, el('div.tx', el('div.t1', { text: '🔔 檢查更新' }), el('div.t2', { text: `目前版本 v${VERSION}；有新版時畫面上方會自動通知` }))),
      el('a.row', { href: `https://github.com/${REPO}/releases/latest`, target: '_blank', rel: 'noopener', style: { color: 'inherit', textDecoration: 'none' } },
        el('div.tx', el('div.t1', { text: '🤖 下載 Android App「小柯文件PDF助手」' }), el('div.t2', { text: 'GitHub Releases' })))));
    w.append(el('h2', { text: '隱私' }));
    w.append(el('div.small', { text: '文件絕對不會離開你的裝置。所有處理都在瀏覽器裡完成，不需要帳號、不收集使用資料、沒有雲端處理。'
      + '編輯會先存在瀏覽器的快照中，可以隨時撤銷；每分鐘自動保存，瀏覽器意外關閉後再開啟時會詢問是否恢復。' }));
    this.home = h;
    return h;
  }

  async drawRecent(box) {
    let list = [];
    try { list = (await idb.get('recent', 'list')) || []; } catch {}
    if (!list.length) return;
    box.append(el('h2', { text: '最近開啟' }));
    const l = el('div.list');
    for (const r of list) {
      const row = el('div.row', { onclick: () => this.openRecent(r) },
        el('div.tx', el('div.t1', { text: '📄 ' + r.name }), el('div.t2', { text: `${r.pages} 頁 · ${size(r.size)} · ${new Date(r.time).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` })));
      row.addEventListener('contextmenu', async e => { e.preventDefault(); if (await confirmBox('從清單移除', r.name, '移除')) { await this.forgetRecent(r.key); this.select(-1); } });
      l.append(row);
    }
    box.append(l);
  }

  async remember(d, bytes, handle) {
    try {
      const key = d.name + ':' + bytes.length;
      let list = (await idb.get('recent', 'list')) || [];
      list = list.filter(x => x.key !== key);
      list.unshift({ key, name: d.name, pages: d.n, size: bytes.length, time: Date.now(), handle: !!handle });
      for (const old of list.slice(10)) await idb.del('recent', 'f:' + old.key);
      list = list.slice(0, 10);
      await idb.set('recent', 'list', list);
      await idb.set('recent', 'f:' + key, handle || (bytes.length < 25e6 ? bytes : null));
    } catch {}
  }
  async forgetRecent(key) { let list = (await idb.get('recent', 'list')) || []; await idb.set('recent', 'list', list.filter(x => x.key !== key)); await idb.del('recent', 'f:' + key); }

  async openRecent(r) {
    const v = await idb.get('recent', 'f:' + r.key);
    if (!v) return alertBox('無法開啟', '這個檔案沒有保留在瀏覽器裡（檔案太大）。請重新選擇檔案。');
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) return this.openBytes(new Uint8Array(v), r.name);
    try {
      if ((await v.queryPermission({ mode: 'readwrite' })) !== 'granted') await v.requestPermission({ mode: 'readwrite' });
      const f = await v.getFile();
      this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, false, v);
    } catch (e) { alertBox('無法開啟', '找不到這個檔案，可能已被移動或刪除。'); }
  }

  // ---------------------------------------------------------------- 開啟

  async pickPdf() {
    if (window.showOpenFilePicker) {
      try {
        const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
        for (const h of hs) { const f = await h.getFile(); await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, false, h); }
        return;
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    const fs = await pickFiles('application/pdf,.pdf', true);
    for (const f of fs) await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  }

  /** isNew：不是從原檔開啟的新文件（合併、建立…） */
  async openBytes(bytes, name, isNew = false, handle = null, password) {
    let d;
    const done = busy('正在開啟…');
    try {
      d = isNew ? await Doc.fromBytes(bytes, name) : await Doc.open(bytes, name, { password, handle });
      d.originalBytes = d.encrypted ? bytes : null;
    } catch (e) {
      done();
      if (e && e.needPassword) {
        const p = await prompt(e.wrong ? '密碼不正確，請再試一次' : '這份文件受密碼保護', '輸入開啟密碼或擁有者密碼', '', 'password');
        if (p != null) return this.openBytes(bytes, name, isNew, handle, p);
        return;
      }
      console.error(e);
      return alertBox('無法開啟', '檔案損壞或不是 PDF。\n' + errText(e));
    }
    done();
    this.docs.push(d);
    this.select(this.docs.length - 1);
    if (!isNew) this.remember(d, bytes, handle);
  }

  setupDrop() {
    const main = document.body;
    main.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.querySelector('.drop')?.classList.add('over'); } });
    main.addEventListener('dragleave', () => document.querySelector('.drop')?.classList.remove('over'));
    main.addEventListener('drop', async e => {
      e.preventDefault();
      document.querySelector('.drop')?.classList.remove('over');
      for (const item of e.dataTransfer.items) {
        let handle = null;
        if (item.getAsFileSystemHandle) try { handle = await item.getAsFileSystemHandle(); } catch {}
        const f = item.getAsFile();
        if (f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, false, handle && handle.kind === 'file' ? handle : null);
      }
    });
  }

  async handleLaunch() {
    // 「開啟方式」（安裝成 App 後）
    if ('launchQueue' in window) window.launchQueue.setConsumer(async p => { for (const h of p.files || []) { const f = await h.getFile(); await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, false, h); } });
    const q = new URLSearchParams(location.search);
    // 從其他 App「分享」過來（Service Worker 先存在快取裡）
    if (q.has('shared')) {
      try {
        const c = await caches.open('xk-share');
        const r = await c.match('shared.pdf');
        if (r) { const name = decodeURIComponent(r.headers.get('X-Name') || 'shared.pdf'); await this.openBytes(new Uint8Array(await r.arrayBuffer()), name); await c.delete('shared.pdf'); }
      } catch {}
    }
    const act = q.get('action');
    if (act === 'open') this.pickPdf(); else if (act === 'combine') this.tools.run('combine');
    if (q.toString()) history.replaceState(null, '', location.pathname);
  }

  async recover() {
    let list = [];
    try { list = await Doc.recover(); } catch {}
    if (!list.length) return;
    const dirty = list.filter(d => d.dirty), clean = list.filter(d => !d.dirty);
    this.docs.push(...clean);
    if (clean.length) this.select(Math.min(prefs.get('cur', 0), this.docs.length - 1));
    if (dirty.length) {
      const names = dirty.map(d => `・${d.name}${d.savedPos < 0 && d.steps.length === 1 ? '（尚未儲存的新文件）' : `（${d.steps.length - 1} 個編輯步驟）`}`).join('\n');
      const k = await ask('恢復未儲存的工作？', `上次沒有正常關閉，以下文件還有未儲存的變更：\n\n${names}\n\n恢復後可以繼續編輯或撤銷。`, ['捨棄', '恢復']);
      if (k === 1) { this.docs.push(...dirty); this.docs.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)); this.select(Math.min(prefs.get('cur', 0), this.docs.length - 1)); }
      else for (const d of dirty) await d.discard();
    }
  }

  // ---------------------------------------------------------------- 編輯

  blocked(msg) {
    const d = this.doc;
    ask('無法編輯', msg, d && d.encrypted && !d.owner ? ['確定', '輸入擁有者密碼'] : ['確定']).then(k => { if (k === 1) panels.unlock(this); });
  }

  /** 套用一個編輯並更新畫面，回傳 fn 的結果 */
  async edit(label, kind, fn) {
    const d = this.doc;
    if (!d) return toast('請先開啟文件');
    const b = d.block(kind);
    if (b) { this.blocked(b); return; }
    let r;
    try { r = await run(label + '…', () => d.apply(label, kind, fn)); } catch { return; }
    this.changed(d);
    return r;
  }

  async applyBytes(label, bytes) {
    const d = this.doc;
    await run(label + '…', () => d.applyBytes(label, bytes));
    this.changed(d);
  }

  changed(d) {
    if (d !== this.doc) { this.refreshTabs(); return; }
    this.viewer.refresh();
    if (!$('#searchbar').classList.contains('hidden')) this.search.run($('#searchbar input').value);
    this.refreshTabs(); this.refreshBars();
    this.onDocChanged && this.onDocChanged();
  }

  async undo() { const d = this.doc; if (!d || !d.undoLabel()) return; const l = d.undoLabel(); await run(null, () => d.undo()); this.changed(d); toast('已復原：' + l); }
  async redo() { const d = this.doc; if (!d || !d.redoLabel()) return; const l = d.redoLabel(); await run(null, () => d.redo()); this.changed(d); toast('已重做：' + l); }

  // ---------------------------------------------------------------- 儲存

  async ensureEnc(d) {
    if (!d.encrypted || (d.encOut && d.encOut.user != null && d.encOut.owner != null)) return true;
    const r = await form('保持加密', [{ type: 'note', label: '這份文件原本有加密。儲存時會用 AES-256 重新加密，請確認密碼：' },
      { key: 'u', label: '開啟密碼（留白＝不需密碼即可開啟）', value: d.encOut?.user || '' }, { key: 'o', label: '擁有者密碼（變更權限用）', value: d.encOut?.owner || '' },
      ...(d.owner ? [{ key: 'plain', label: '改為不加密儲存', type: 'check' }] : [])], '確定');
    if (!r) return false;
    if (r.plain) { d.encOut = null; d.encrypted = false; return true; }
    d.encOut = { user: r.u, owner: r.o || r.u || Math.random().toString(36).slice(2), perms: d.perms };
    return true;
  }

  async save() {
    const d = this.doc;
    if (!d) return;
    if (d.broken) return alertBox('無法儲存', '這份文件以唯讀模式開啟。可以用「另存新檔」存一份副本。');
    if (!await this.ensureEnc(d)) return;
    const bytes = await run('正在儲存…', () => d.output());
    if (d.handle) {
      try {
        if ((await d.handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await d.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('沒有寫入權限');
        const w = await d.handle.createWritable();
        await w.write(bytes); await w.close();
        d.savedPos = d.pos; await d.persist();
        toast('已儲存'); this.refreshTabs(); this.refreshBars();
        return;
      } catch (e) { if (e.name === 'AbortError') return; toast('無法直接寫回原檔，改為下載'); }
    }
    return this.saveAs(bytes);
  }

  async saveAs(pre) {
    const d = this.doc;
    if (!d) return;
    if (!pre && !await this.ensureEnc(d)) return;
    const bytes = pre || await run('正在儲存…', () => d.output());
    const name = /\.pdf$/i.test(d.name) ? d.name : d.name + '.pdf';
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
        const w = await h.createWritable(); await w.write(bytes); await w.close();
        d.handle = h; d.name = h.name; d.savedPos = d.pos; await d.persist();
        toast(`已儲存為「${d.name}」`); this.refreshTabs(); this.refreshBars();
        this.remember(d, bytes, h);
        return;
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    download(bytes, name);
    d.savedPos = d.pos; await d.persist();
    toast('已下載「' + name + '」'); this.refreshTabs(); this.refreshBars();
  }

  async share() {
    const d = this.doc;
    if (!d || !await this.ensureEnc(d)) return;
    const bytes = await run('準備分享…', () => d.output());
    shareOrDownload(bytes, /\.pdf$/i.test(d.name) ? d.name : d.name + '.pdf');
  }

  async closeTab(i, silent) {
    const d = this.docs[i];
    if (!d) return;
    const close = async () => {
      const k = this.docs.indexOf(d);
      if (k < 0) return;
      this.docs.splice(k, 1);
      this.closed.push({ name: d.name, bytes: d.current, handle: d.handle });
      if (this.closed.length > 10) this.closed.shift();
      d.discard();
      this.select(k < this.cur ? this.cur - 1 : k === this.cur ? Math.min(k, this.docs.length - 1) : this.cur);
    };
    if (!d.dirty || silent) return close();
    const k = await ask(`要儲存「${d.name}」的變更嗎？`, '如果不儲存，這些變更會遺失。', ['取消', '不儲存', '儲存']);
    if (k === 1) close();
    else if (k === 2) { this.select(i); await this.save(); if (!d.dirty) close(); }
  }

  async reopenClosed() {
    const c = this.closed.pop();
    if (!c) return toast('沒有最近關閉的分頁');
    if (c.handle) { try { const f = await c.handle.getFile(); return this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, false, c.handle); } catch {} }
    this.openBytes(c.bytes, c.name);
  }

  // ---------------------------------------------------------------- 安裝

  async installApp() {
    if (this.installEvt) { this.installEvt.prompt(); const r = await this.installEvt.userChoice; if (r.outcome === 'accepted') toast('已安裝到主畫面'); this.installEvt = null; return; }
    if (matchMedia('(display-mode: standalone)').matches) return alertBox('已經安裝', '你正在使用安裝好的小柯PDF。');
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    alertBox('安裝到主畫面 / 建立捷徑', ios
      ? '在 Safari：\n1. 按下方的「分享」按鈕（方框加向上箭頭）\n2. 選「加入主畫面」\n3. 按「加入」\n\n主畫面會出現小柯機器人圖示，點它就能像 App 一樣開啟，離線也能用。'
      : 'Android Chrome：按右上角「⋮」→「加到主畫面」或「安裝應用程式」。\n電腦版 Chrome / Edge：按網址列右側的「安裝」圖示（或選單 →「投放、儲存及分享」→「安裝網頁應用程式」/「建立捷徑」）。\n\n安裝後會有小柯機器人圖示，離線也能用，也可以把 PDF「分享」或「開啟方式」交給它。');
  }

  // ---------------------------------------------------------------- 點擊、選取

  onEmptyTap() { if (this.full) this.fullscreen(false); }

  async onPageTap(i, x, y) {
    const d = this.doc;
    const anns = await d.annots(i);
    const vp = this.viewer.baseOf(i);
    for (let k = anns.length - 1; k >= 0; k--) {
      const a = anns[k];
      if (!a.rect || (a.annotationFlags & 2)) continue;
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      if (x < Math.min(x1, x2) - 3 || x > Math.max(x1, x2) + 3 || y < Math.min(y1, y2) - 3 || y > Math.max(y1, y2) + 3) continue;
      if (a.subtype === 'Link') {
        if (a.url || a.unsafeUrl) { const u = a.url || a.unsafeUrl; if (await confirmBox('開啟連結', u, '開啟')) window.open(u, '_blank', 'noopener'); return; }
        if (a.dest) {
          try {
            let dest = a.dest;
            if (typeof dest === 'string') dest = await d.pdf.getDestination(dest);
            const p = typeof dest[0] === 'object' ? await d.pdf.getPageIndex(dest[0]) : dest[0];
            this.viewer.goTo(p);
          } catch {}
        }
        return;
      }
      if (a.subtype === 'Widget' && a.fieldName) { panels.editField(this, a.fieldName); return; }
      if (a.subtype === 'Popup') continue;
      const m = /^(\d+)R$/.exec(a.id || '');
      if (m && await panels.commentAt(this, i, `${m[1]} 0 R`)) return;
    }
    if (this.full) this.fullscreen(false);
  }

  onSelection(sel) {
    if (this.mode && this.mode.onSelection && this.mode.onSelection(sel)) return;
    const bar = this.viewer.selbar, d = this.doc;
    bar.innerHTML = '';
    const b = (t, f) => bar.append(el('button', { text: t, onmousedown: e => e.preventDefault(), onclick: f }));
    const clear = () => { window.getSelection().removeAllRanges(); bar.classList.add('hidden'); };
    b('複製', async () => { if (!d.canCopy()) return alertBox('無法複製', '作者不允許複製這份文件的內容。'); try { await navigator.clipboard.writeText(sel.text); toast('已複製'); } catch { document.execCommand('copy'); } clear(); });
    const mk = (sub, label, key, def, note) => async () => {
      let contents = null;
      if (note) { contents = await prompt('註解', '寫下你的意見'); if (contents == null) return; }
      clear();
      this.edit(label, K_ANNOT, lib => ops.addMarkup(lib, sel.page, sel.rects, sub, prefs.get('color.' + key, def), sel.text, contents));
    };
    b('螢光', mk('Highlight', '螢光標示', 'hl', '#FFD400'));
    b('底線', mk('Underline', '加底線', 'ul', '#1E63E9'));
    b('刪除線', mk('StrikeOut', '加刪除線', 'so', '#E53935'));
    b('加註解', mk('Highlight', '螢光標示', 'hl', '#FFD400', true));
    b('改文字', () => { clear(); this.inline.editSelection(sel); });
    b('塗銷', () => { clear(); this.edit('標記塗銷', K_EDIT, lib => { for (const r of sel.rects) ops.addRedact(lib, sel.page, r); }); });
    b('搜尋', () => { const t = sel.text; clear(); this.openSearch(t); });
    if (navigator.share) b('分享', () => { if (!d.canCopy()) return; navigator.share({ text: sel.text }).catch(() => {}); });
    b('✕', clear);
    bar.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- 搜尋

  openSearch(initial = '') {
    if (!this.doc) return;
    this.exitModes();
    const sb = $('#searchbar');
    sb.innerHTML = '';
    const inp = el('input', { type: 'search', placeholder: '搜尋（逗號分隔多個詞）', value: initial, enterKeyHint: 'search' });
    let t;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search.run(inp.value), 300); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.search.step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') this.closeSearch(); });
    sb.append(inp, el('span.count'), el('button.ib', { text: '▲', title: '上一個', onclick: () => this.search.step(-1) }),
      el('button.ib', { text: '▼', title: '下一個', onclick: () => this.search.step(1) }), el('button.ib', { text: '✕', title: '關閉搜尋', onclick: () => this.closeSearch() }));
    $('#toolbar').classList.add('hidden');
    sb.classList.remove('hidden');
    inp.focus();
    if (initial) this.search.run(initial);
  }

  closeSearch() {
    this.search.gen++;
    $('#searchbar').classList.add('hidden');
    if (!this.full) $('#toolbar').classList.remove('hidden');
    const v = this.viewer; v.hits = new Map(); v.hitCur = null; v.redrawOverlays();
  }

  // ---------------------------------------------------------------- 工具模式

  hint(msg, buttons = [], showDone = false) {
    const h = $('#hint');
    h.innerHTML = '';
    h.append(el('div.msg', { text: msg }), ...buttons.map(([t, f]) => el('button.btn', { text: t, onclick: f })),
      el('button.btn', { text: showDone ? '完成' : '✕', onclick: () => showDone ? this.exitModes() : h.classList.add('hidden') }));
    h.classList.remove('hidden');
  }
  setHint(t) { const m = $('#hint .msg'); if (m) m.textContent = t; }

  /** mode: {hint, buttons, tool:{type,...}, onSelection, exit, keepStrip} */
  setMode(m) {
    const strip = !$('#toolstrip').classList.contains('hidden') && m.keepStrip;
    this.exitModes(strip);
    if (!this.doc) return;
    this.mode = m;
    this.viewer.setTool(m.tool || null);
    this.hint(m.hint, m.buttons || [], true);
  }

  exitModes(keepStrip) {
    if (this.inline && this.inline.active) this.inline.commit();
    const had = !!this.mode;
    if (this.mode) { const m = this.mode; this.mode = null; m.exit && m.exit(); }
    this.viewer.cancelTool();
    this.viewer.selbar.classList.add('hidden');
    $('#hint').classList.add('hidden');
    if (!keepStrip) $('#toolstrip').classList.add('hidden');
    if (!$('#searchbar').classList.contains('hidden')) this.closeSearch();
    return had;
  }

  strip(items, selected) {
    const s = $('#toolstrip');
    s.innerHTML = '';
    items.forEach(([t, f, cls], k) => s.append(el('button' + (k === selected ? '.sel' : '') + (cls ? '.' + cls : ''), { text: t, onclick: () => f(k) })));
    s.classList.remove('hidden');
  }

  editMode(sel = 0) {
    const d = this.doc;
    if (!d) return toast('請先開啟文件');
    const b = d.block(K_EDIT);
    if (b) return this.blocked(b);
    const T = this.tools;
    const items = [
      ['編輯文字', () => { this.setMode({ keepStrip: true, hint: '點一下文字就能直接修改（像 Word 一樣）；點空白處可以新增文字', tool: { type: 'point', color: '#1E63E9', onTap: (p, x, y) => this.inline.editAt(p, x, y) } }); mark(0); }],
      ['新增文字', () => { this.setMode({ keepStrip: true, hint: '點一下要加文字的位置，直接打字', tool: { type: 'point', color: '#1E63E9', onTap: (p, x, y) => this.inline.addAt(p, x, y) } }); mark(1); }],
      ['插入表格', () => this.inline.insertTableMode()],
      ['新增圖片', () => T.addImage()], ['新增連結', () => T.addLink()], ['浮水印', () => T.watermark()], ['移除浮水印', () => T.removeWatermark()],
      ['頁首頁尾頁碼', () => T.headerFooter()], ['裁切', () => T.crop()], ['整理頁面', () => { this.exitModes(); T.organize(); }], ['完成', () => this.exitModes()],
    ];
    const mark = k => this.strip(items, k);
    mark(sel);
    items[sel][1]();
  }

  commentMode(sel = 2) {
    const d = this.doc;
    if (!d) return toast('請先開啟文件');
    const b = d.block(K_ANNOT);
    if (b) return this.blocked(b);
    const width = () => prefs.get('width', 2);
    const color = (key, def) => prefs.get('color.' + key, def);
    const keys = ['sel', 'note', 'hl', 'ul', 'so', 'sq', 'ft', 'rect', 'oval', 'line', 'arrow', 'ink', 'stamp'];
    const defs = [null, '#FFC107', '#FFD400', '#1E63E9', '#E53935', '#8E24AA', '#1D1F23', '#E53935', '#1E88E5', '#E53935', '#E53935', '#1E63E9', '#E53935'];
    let cur = sel;
    const markup = (sub, label) => async (p, r) => {
      const items = await d.text(p);
      const hits = [];
      for (const it of items) {
        if (it.y + it.h < r.y || it.y > r.y + r.h || it.x + it.w < r.x || it.x > r.x + r.w) continue;
        const n = it.str.length || 1;
        let a = -1, z = -1;
        for (let k = 0; k < it.str.length; k++) { const cx = it.x + it.w * (k + 0.5) / n; if (cx >= r.x && cx <= r.x + r.w) { if (a < 0) a = k; z = k; } }
        if (a < 0) continue;
        hits.push({ x: it.x + it.w * a / n, y: it.y, w: it.w * (z - a + 1) / n, h: it.h, s: it.str.slice(a, z + 1) });
      }
      if (!hits.length) return toast('框選範圍內沒有文字');
      this.edit(label, K_ANNOT, lib => ops.addMarkup(lib, p, mergeLines(hits), sub, color(keys[cur], defs[cur]), hits.map(h => h.s).join(''), null));
    };
    const choose2 = k => {
      cur = k;
      const c = color(keys[k], defs[k]);
      const mode = (hint, tool) => this.setMode({ keepStrip: true, hint, tool: tool ? { color: c, width: width(), ...tool } : null });
      switch (keys[k]) {
        case 'sel': mode('長按（或拖曳）文字選取，再選擇螢光、底線等動作。點註解可以檢視或回覆。', null); break;
        case 'note': mode('點一下頁面放置便利貼', { type: 'point', onTap: async (p, x, y) => { const t = await prompt('便利貼', '寫下你的意見'); if (t != null) this.edit('新增便利貼', K_ANNOT, lib => ops.addNote(lib, p, x, y, t, c)); } }); break;
        case 'hl': case 'ul': case 'so': case 'sq': {
          const sub = { hl: 'Highlight', ul: 'Underline', so: 'StrikeOut', sq: 'Squiggly' }[keys[k]];
          const label = { hl: '螢光標示', ul: '加底線', so: '加刪除線', sq: '波浪底線' }[keys[k]];
          mode(`拖曳框住要${label.replace('加', '').replace('標示', '')}的文字`, { type: 'rect', onRect: markup(sub, label) });
          break;
        }
        case 'ft': mode('拖曳出文字框的位置（或點一下）', { type: 'rect', onRect: (p, r) => this.tools.freeText(p, r), onTap: (p, x, y) => this.tools.freeText(p, { x, y, w: Math.min(d.pages[p].w - x, 180), h: 30 }) }); break;
        case 'rect': case 'oval': mode('拖曳畫出' + (keys[k] === 'rect' ? '矩形' : '橢圓'), { type: keys[k] === 'rect' ? 'rect' : 'ellipse', onRect: (p, r) => this.edit(keys[k] === 'rect' ? '新增矩形' : '新增橢圓', K_ANNOT, lib => ops.addShape(lib, p, r, keys[k] === 'oval', c, width())) }); break;
        case 'line': case 'arrow': mode('拖曳畫出' + (keys[k] === 'line' ? '直線' : '箭頭'), { type: 'line', onLine: (p, a, b2) => this.edit(keys[k] === 'line' ? '新增直線' : '新增箭頭', K_ANNOT, lib => ops.addLine(lib, p, a, b2, keys[k] === 'arrow', c, width(), null)) }); break;
        case 'ink': {
          const commit = () => {
            const ink = this.viewer.takeInk();
            if (!ink.length) return;
            const page = ink[0].page;
            this.edit('手繪', K_ANNOT, lib => ops.addInk(lib, page, ink, c, width()));
            this.setHint('用手指在同一頁上手繪');
          };
          this.setMode({ keepStrip: true, hint: '用手指在同一頁上手繪', buttons: [['復原筆畫', () => this.viewer.undoInk()], ['儲存', commit]],
            tool: { type: 'ink', color: c, width: width(), onInk: ink => this.setHint(`已畫 ${ink.length} 筆。可繼續畫，或按「儲存」。`) }, exit: commit });
          break;
        }
        case 'stamp': this.tools.stamp(); break;
      }
      draw();
    };
    const names = ['選取', '便利貼', '螢光筆', '底線', '刪除線', '波浪線', '文字框', '矩形', '橢圓', '直線', '箭頭', '手繪', '印章'];
    const draw = () => {
      const items = names.map((n, k) => [n, () => choose2(k)]);
      items.push([`● 顏色`, async () => { const j = await choose('顏色', PALETTE.map(p => ({ t: '●  ' + p, r: '' }))); if (j >= 0) { prefs.set('color.' + keys[cur], PALETTE[j]); choose2(cur); } }]);
      items.push(['線寬', async () => { const j = await choose('線寬', ['細 1 pt', '2 pt', '3 pt', '粗 5 pt', '特粗 8 pt']); if (j >= 0) { prefs.set('width', [1, 2, 3, 5, 8][j]); choose2(cur); } }]);
      items.push(['完成', () => this.exitModes()]);
      this.strip(items, cur);
      const sw = $('#toolstrip').children[names.length];
      if (sw) sw.style.color = color(keys[cur], defs[cur]) || 'inherit';
    };
    choose2(sel);
  }

  // ---------------------------------------------------------------- 快速鍵

  onKey(e) {
    if (e.key === 'Escape') { if (this.full) return this.fullscreen(false); if (this.exitModes()) return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const map = { z: () => e.shiftKey ? this.redo() : this.undo(), y: () => this.redo(), f: () => this.openSearch(), k: () => this.tools.palette(), s: () => this.save(),
      o: () => this.pickPdf(), g: () => this.search.step(e.shiftKey ? -1 : 1), p: () => this.tools.print() };
    if (map[k] && (this.doc || k === 'k' || k === 'o')) { e.preventDefault(); map[k](); }
  }
}

function mergeLines(hits) {
  const out = [];
  for (const h of hits) {
    const l = out[out.length - 1];
    if (l && Math.abs((l.y + l.h / 2) - (h.y + h.h / 2)) < Math.max(l.h, h.h) * 0.5) { const r = Math.max(l.x + l.w, h.x + h.w); l.x = Math.min(l.x, h.x); l.w = r - l.x; l.y = Math.min(l.y, h.y); l.h = Math.max(l.h, h.h); }
    else out.push({ x: h.x, y: h.y, w: h.w, h: h.h });
  }
  return out;
}

const app = new App();
window.xkApp = app;
window.addEventListener('pagehide', () => { prefs.set('cur', app.cur); app.docs.forEach(d => d.persist()); });
app.start().catch(e => { console.error(e); alertBox('啟動失敗', errText(e)); });
