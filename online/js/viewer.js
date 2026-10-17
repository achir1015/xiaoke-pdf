// 頁面檢視：連續 / 單頁 / 雙頁、旋轉、縮放（雙指、Ctrl+滾輪、雙擊）、文字層、覆蓋物、工具繪製
import { el, clamp, prefs } from './util.js';
import { baseViewport, Viewport } from './core.js';

const pdfjsLib = window.pdfjsLib;
const MAX_PIXELS = 10e6;

export class Viewer {
  constructor(app) {
    this.app = app;
    this.doc = null;
    this.root = el('div.viewer');
    this.pagesEl = el('div.pages');
    this.root.append(this.pagesEl);
    this.badge = el('div.badge', { onclick: () => app.askPage() });
    this.measureEl = el('div.measure.hidden');
    this.selbar = el('div.selbar.hidden');
    this.frame = el('div', { style: { position: 'absolute', inset: 0 } }, this.root, this.badge, this.measureEl, this.selbar);
    this.slots = [];            // 每頁 {div, canvas, detail, tl, ov, svg, state}
    this.zoom = 1;
    this.mode = 'cont';
    this.vrot = 0;
    this.tool = null;           // {type:'rect'|'ellipse'|'line'|'ink'|'point', color, width, handlers}
    this.hits = new Map();      // page → [base rects]
    this.hitCur = null;
    this.showFields = false;
    this.night = prefs.get('night', false);
    this.sepia = prefs.get('sepia', false);
    this.ink = [];              // 進行中的手繪：[{page, pts:[[x,y]...]}]
    this.queue = [];
    this.rendering = 0;
    this.applyLook();

    this.io = new IntersectionObserver(es => {
      for (const e of es) {
        const s = e.target.__slot;
        if (!s) continue;
        s.visible = e.isIntersecting;
        if (e.isIntersecting) this.request(s);
      }
      this.trim();
    }, { root: this.root, rootMargin: '600px 0px' });

    this.root.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // 只有寬度改變才重新排版（手機鍵盤彈出只改高度，不要讓頁面跳動）
    this.lastW = 0;
    window.addEventListener('resize', () => { const w = this.root.clientWidth; if (this.doc && w && w !== this.lastW) { this.lastW = w; this.relayout(true); } });
    this.root.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    }, { passive: false });
    this.setupTouch();
    this.root.addEventListener('dblclick', e => {
      if (this.tool || e.target.closest('.tl span')) return;
      this.zoomAt(this.zoom < 1.6 ? 2.4 : 1, e.clientX, e.clientY);
    });
    this.root.addEventListener('click', e => this.onClick(e));
    document.addEventListener('selectionchange', () => { clearTimeout(this.selT); this.selT = setTimeout(() => this.onSelection(), 250); });
  }

  applyLook() {
    this.root.classList.toggle('night', this.night);
    this.root.classList.toggle('sepia', this.sepia && !this.night);
  }

  // ---------------------------------------------------------------- 版面

  setDoc(doc) {
    this.doc = doc;
    this.zoom = doc ? doc.view.zoom : 1;
    this.mode = doc ? doc.view.mode : 'cont';
    this.vrot = doc ? doc.view.vrot : 0;
    this.hits = new Map(); this.hitCur = null;
    this.cancelTool();
    this.relayout(false);
    if (doc) requestAnimationFrame(() => this.goTo(doc.view.page, null, true));
  }

  /** 文件內容改變（編輯、撤銷）後 */
  refresh() {
    const top = this.root.scrollTop, left = this.root.scrollLeft;
    this.relayout(false);
    this.root.scrollTop = top; this.root.scrollLeft = left;
  }

  rot(i) { return ((this.doc.pages[i].rotate + this.vrot * 90) % 360 + 360) % 360; }
  pw(i) { const p = this.doc.pages[i]; return this.vrot % 2 ? p.h : p.w; }
  ph(i) { const p = this.doc.pages[i]; return this.vrot % 2 ? p.w : p.h; }

  fitScale() {
    const W = this.root.clientWidth - 16, H = this.root.clientHeight - 24;
    const d = this.doc;
    if (this.mode === 'single') { const i = d.view.page; return Math.min(W / this.pw(i), H / this.ph(i)); }
    let maxW = 0;
    if (this.mode === 'two') for (let i = 0; i < d.n; i += 2) maxW = Math.max(maxW, this.pw(i) + (i + 1 < d.n ? this.pw(i + 1) + 10 : 0));
    else for (let i = 0; i < d.n; i++) maxW = Math.max(maxW, this.pw(i));
    return Math.min(W / maxW, 2.2);
  }
  get scale() { return this.base * this.zoom; }

  relayout(keepPage) {
    const page = this.doc ? this.doc.view.page : 0;
    for (const s of this.slots) { this.io.unobserve(s.div); if (s.task) try { s.task.cancel(); } catch {} }
    this.slots = [];
    this.pagesEl.innerHTML = '';
    this.pagesEl.className = 'pages' + (this.mode === 'two' ? ' two' : '');
    this.queue = [];
    if (!this.doc) return;
    const d = this.doc;
    this.base = this.fitScale();
    const make = i => {
      const s = { i, div: el('div.page'), gen: -1, visible: false };
      s.div.__slot = s;
      s.div.style.width = Math.round(this.pw(i) * this.scale) + 'px';
      s.div.style.height = Math.round(this.ph(i) * this.scale) + 'px';
      const lbl = d.label(i);
      s.div.dataset.page = i;
      if (this.mode !== 'single') s.div.append(el('div.label', { text: lbl ? `${lbl}（${i + 1}）` : '' }));
      this.slots[i] = s;
      this.io.observe(s.div);
      return s.div;
    };
    if (this.mode === 'single') this.pagesEl.append(make(page));
    else if (this.mode === 'two') for (let i = 0; i < d.n; i += 2) this.pagesEl.append(el('div.row2', make(i), i + 1 < d.n ? make(i + 1) : null));
    else for (let i = 0; i < d.n; i++) this.pagesEl.append(make(i));
    this.pagesEl.style.width = 'max-content';
    this.pagesEl.style.minWidth = '100%';
    this.updateBadge();
    this.lastW = this.root.clientWidth;
    if (keepPage) requestAnimationFrame(() => this.goTo(page, null, true));
    this.app.inline && this.app.inline.attach();
  }

  setMode(m) { const p = this.doc.view.page; this.mode = m; this.doc.view.mode = m; if (m === 'single') this.zoom = 1; this.relayout(false); this.goTo(p, null, true); }
  rotateView(d) { const p = this.doc.view.page; this.vrot = ((this.vrot + d) % 4 + 4) % 4; this.doc.view.vrot = this.vrot; this.relayout(false); this.goTo(p, null, true); }

  zoomAt(z, cx, cy) {
    if (!this.doc) return;
    z = clamp(z, this.mode === 'single' ? 1 : 0.4, 10);
    if (Math.abs(z - this.zoom) < 0.001) return;
    const r = this.root.getBoundingClientRect();
    const fx = (cx ?? r.left + r.width / 2) - r.left, fy = (cy ?? r.top + r.height / 2) - r.top;
    const k = z / this.zoom;
    const lx = this.root.scrollLeft + fx, ly = this.root.scrollTop + fy;
    this.zoom = z;
    this.doc.view.zoom = z;
    for (const s of this.slots) if (s) {
      s.div.style.width = Math.round(this.pw(s.i) * this.scale) + 'px';
      s.div.style.height = Math.round(this.ph(s.i) * this.scale) + 'px';
      s.gen = -1;
    }
    this.root.scrollLeft = lx * k - fx;
    this.root.scrollTop = ly * k - fy;
    this.redrawOverlays();
    this.app.inline && this.app.inline.attach();
    clearTimeout(this.zt);
    this.zt = setTimeout(() => { for (const s of this.slots) if (s && s.visible) this.request(s); }, 120);
  }

  setupTouch() {
    let pinch = null, lastTap = 0, swipe = null;
    this.root.addEventListener('touchstart', e => {
      if (e.touches.length === 2 && !this.toolActive) {
        const [a, b] = e.touches;
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: this.zoom, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
        this.cancelStroke();
      } else if (e.touches.length === 1) {
        swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
      }
    }, { passive: true });
    this.root.addEventListener('touchmove', e => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const k = d / pinch.d;
        this.pagesEl.style.transformOrigin = `${pinch.cx - this.root.getBoundingClientRect().left + this.root.scrollLeft}px ${pinch.cy - this.root.getBoundingClientRect().top + this.root.scrollTop}px`;
        this.pagesEl.style.transform = `scale(${clamp(pinch.z * k, 0.4, 10) / pinch.z})`;
        pinch.k = k;
      }
    }, { passive: false });
    this.root.addEventListener('touchend', e => {
      if (pinch && e.touches.length < 2) {
        this.pagesEl.style.transform = '';
        if (pinch.k) this.zoomAt(pinch.z * pinch.k, pinch.cx, pinch.cy);
        pinch = null;
        return;
      }
      if (swipe && e.changedTouches.length === 1 && !this.tool) {
        const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y, dt = Date.now() - swipe.t;
        if (this.mode === 'single' && this.zoom <= 1.05 && dt < 500 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          this.goTo(this.doc.view.page + (dx < 0 ? 1 : -1));
        } else if (dt < 250 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          const now = Date.now();
          if (now - lastTap < 300 && !e.target.closest('.tl span')) { this.zoomAt(this.zoom < 1.6 ? 2.4 : 1, t.clientX, t.clientY); lastTap = 0; }
          else lastTap = now;
        }
      }
      swipe = null;
    });
  }

  // ---------------------------------------------------------------- 繪製

  viewport(page, scale) { return page.getViewport({ scale, rotation: this.rot(page.pageNumber - 1) }); }

  request(s) {
    if (!this.doc || s.gen === this.doc.gen + ':' + this.scale) return;
    if (!this.queue.includes(s)) this.queue.push(s);
    this.pump();
  }

  async pump() {
    while (this.rendering < 2 && this.queue.length) {
      const s = this.queue.shift();
      if (!s.visible || !this.slots[s.i] || this.slots[s.i] !== s) continue;
      this.rendering++;
      this.renderSlot(s).catch(e => { if (e && e.name !== 'RenderingCancelledException') console.warn(e); })
        .finally(() => { this.rendering--; this.pump(); });
    }
  }

  async renderSlot(s) {
    const d = this.doc, key = d.gen + ':' + this.scale;
    const page = await d.pdf.getPage(s.i + 1);
    if (this.doc !== d) return;
    const vp = this.viewport(page, this.scale);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let k = dpr;
    if (vp.width * vp.height * k * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
    const canvas = el('canvas.base');
    canvas.width = Math.max(1, Math.floor(vp.width * k));
    canvas.height = Math.max(1, Math.floor(vp.height * k));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (s.task) try { s.task.cancel(); } catch {}
    s.task = page.render({ canvasContext: ctx, viewport: vp, transform: k !== 1 ? [k, 0, 0, k, 0, 0] : null,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, optionalContentConfigPromise: d.ocConfig ? Promise.resolve(d.ocConfig) : undefined });
    await s.task.promise;
    s.task = null;
    if (this.doc !== d || this.slots[s.i] !== s) return;
    // 換掉舊的畫布與文字層
    s.div.querySelectorAll('canvas,.tl,.ov,svg.draw,.tool-layer').forEach(x => x.remove());
    s.div.prepend(canvas);
    s.canvas = canvas;
    s.k = k;
    s.vp = vp;
    s.base = baseViewport(page);
    s.page = page;
    s.gen = key;
    s.ov = el('div.ov');
    s.div.append(s.ov);
    if (k < dpr * 0.98) this.scheduleDetail();
    // 文字層（可長按 / 拖曳選取、複製）
    const tl = el('div.tl');
    tl.style.setProperty('--scale-factor', vp.scale);
    s.div.append(tl);
    s.tl = tl;
    try {
      const tc = await page.getTextContent();
      if (this.slots[s.i] === s) await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
    } catch {}
    this.drawOverlay(s);
    if (this.tool) this.attachTool(s);
    if (this.app.inline && this.app.inline.active && this.app.inline.cur.page === s.i) this.app.inline.attach();
  }

  /** 放大後只把看得到的部分用完整解析度重畫 */
  scheduleDetail() { clearTimeout(this.dt); this.dt = setTimeout(() => this.renderDetail(), 200); }

  async renderDetail() {
    if (!this.doc) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const R = this.root.getBoundingClientRect();
    for (const s of this.slots) {
      if (!s || !s.visible || !s.vp || s.k >= dpr * 0.98) continue;
      const pr = s.div.getBoundingClientRect();
      const x1 = Math.max(pr.left, R.left), y1 = Math.max(pr.top, R.top), x2 = Math.min(pr.right, R.right), y2 = Math.min(pr.bottom, R.bottom);
      if (x2 <= x1 || y2 <= y1) continue;
      const cx = x1 - pr.left, cy = y1 - pr.top, cw = x2 - x1, ch = y2 - y1;
      const c = el('canvas.detail');
      c.width = Math.floor(cw * dpr); c.height = Math.floor(ch * dpr);
      c.style.cssText = `left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px`;
      const ctx = c.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      const gen = s.gen;
      try {
        await s.page.render({ canvasContext: ctx, viewport: s.vp, transform: [dpr, 0, 0, dpr, -cx * dpr, -cy * dpr],
          annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, optionalContentConfigPromise: this.doc.ocConfig ? Promise.resolve(this.doc.ocConfig) : undefined }).promise;
      } catch { continue; }
      if (s.gen !== gen) continue;
      s.div.querySelectorAll('canvas.detail').forEach(x => x.remove());
      s.canvas.after(c);
    }
  }

  /** 離畫面很遠的頁面釋放記憶體 */
  trim() {
    const visible = this.slots.filter(s => s && s.visible).map(s => s.i);
    if (!visible.length) return;
    const lo = Math.min(...visible) - 4, hi = Math.max(...visible) + 4;
    for (const s of this.slots) if (s && (s.i < lo || s.i > hi) && s.canvas) {
      s.div.querySelectorAll('canvas,.tl,.ov,svg.draw,.tool-layer').forEach(x => x.remove());
      s.canvas = null; s.gen = -1;
    }
  }

  onScroll() {
    clearTimeout(this.st);
    this.st = setTimeout(() => this.scheduleDetail(), 120);
    if (!this.doc || this.mode === 'single') return;
    const R = this.root.getBoundingClientRect(), cy = R.top + R.height / 2;
    let best = this.doc.view.page, bd = Infinity;
    for (const s of this.slots) {
      if (!s || !s.visible) continue;
      const r = s.div.getBoundingClientRect();
      const dd = r.top <= cy && r.bottom >= cy ? 0 : Math.min(Math.abs(r.top - cy), Math.abs(r.bottom - cy));
      if (dd < bd) { bd = dd; best = s.i; }
    }
    if (best !== this.doc.view.page) { this.doc.view.page = best; this.updateBadge(); }
  }

  updateBadge() {
    if (!this.doc) return;
    const i = this.doc.view.page, l = this.doc.label(i);
    this.badge.textContent = l ? `${l}（${i + 1} / ${this.doc.n}）` : `${i + 1} / ${this.doc.n}`;
  }

  goTo(i, rect, instant) {
    const d = this.doc;
    if (!d) return;
    i = clamp(i, 0, d.n - 1);
    d.view.page = i;
    if (this.mode === 'single') { this.relayout(false); this.root.scrollTop = 0; }
    const s = this.slots[i];
    if (!s) return;
    const top = s.div.offsetTop - 8;
    if (rect) {
      const r = this.toCss(i, rect);
      this.root.scrollTop = s.div.offsetTop + r.y + r.h / 2 - this.root.clientHeight / 2;
      this.root.scrollLeft = s.div.offsetLeft + r.x + r.w / 2 - this.root.clientWidth / 2;
      this.flash(i, rect);
    } else this.root.scrollTop = top;
    this.updateBadge();
  }

  // ---------------------------------------------------------------- 座標換算

  /** 頁面內的 CSS 座標 → 基準顯示座標（pt，左上原點，頁面原本的旋轉） */
  toBase(i, x, y) {
    const s = this.slots[i];
    const vp = s.vp || this.slotViewport(i);
    const p = vp.convertToPdfPoint(x, y);
    const b = (s.base || this.baseOf(i)).convertToViewportPoint(p[0], p[1]);
    return b;
  }

  /** 基準顯示矩形 → 頁面內的 CSS 矩形 */
  toCss(i, r) {
    const s = this.slots[i];
    const base = (s && s.base) || this.baseOf(i);
    const vp = (s && s.vp) || this.slotViewport(i);
    const a = base.convertToPdfPoint(r.x, r.y), b = base.convertToPdfPoint(r.x + r.w, r.y + r.h);
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle([a[0], a[1], b[0], b[1]]);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  /** 沒有繪製過的頁面：用頁面資訊建立 viewport */
  slotViewport(i) {
    const p = this.doc.pages[i];
    return new Viewport({ viewBox: p.view, scale: this.scale, rotation: this.rot(i), offsetX: 0, offsetY: 0 });
  }
  baseOf(i) {
    const p = this.doc.pages[i];
    return new Viewport({ viewBox: p.view, scale: 1, rotation: p.rotate, offsetX: 0, offsetY: 0 });
  }

  pageAt(clientX, clientY) {
    for (const s of this.slots) {
      if (!s) continue;
      const r = s.div.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return { i: s.i, x: clientX - r.left, y: clientY - r.top };
    }
    return null;
  }

  // ---------------------------------------------------------------- 覆蓋物

  redrawOverlays() { for (const s of this.slots) if (s && s.ov) this.drawOverlay(s); }

  drawOverlay(s) {
    if (!s.ov) return;
    s.ov.innerHTML = '';
    const add = (r, cls) => { const c = this.toCss(s.i, r); s.ov.append(el('div.' + cls, { style: { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' } })); };
    const hs = this.hits.get(s.i);
    if (hs) for (const r of hs) add(r, 'hit');
    if (this.hitCur && this.hitCur.page === s.i) for (const r of this.hitCur.rects) add(r, 'hit.cur');
    if (this.showFields && this.fieldRects) for (const f of this.fieldRects.filter(f => f.page === s.i)) add(f.r, 'fieldbox');
  }

  flash(i, r) {
    const s = this.slots[i];
    if (!s || !s.ov) return;
    const c = this.toCss(i, r);
    const f = el('div.flash', { style: { left: c.x - 3 + 'px', top: c.y - 3 + 'px', width: c.w + 6 + 'px', height: c.h + 6 + 'px' } });
    s.ov.append(f);
    setTimeout(() => f.remove(), 1700);
  }

  // ---------------------------------------------------------------- 點擊、選取

  async onClick(e) {
    if (!this.doc || this.tool) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const hit = this.pageAt(e.clientX, e.clientY);
    if (!hit) { this.app.onEmptyTap(); return; }
    if (this.mode === 'single' && this.zoom <= 1.05) {
      const w = this.root.clientWidth;
      if (e.clientX < w * 0.12) { this.goTo(this.doc.view.page - 1); return; }
      if (e.clientX > w * 0.88) { this.goTo(this.doc.view.page + 1); return; }
    }
    const b = this.toBase(hit.i, hit.x, hit.y);
    this.app.onPageTap(hit.i, b[0], b[1]);
  }

  /** 目前選取的文字（只在文字層內），回傳 {page, text, rects(基準顯示座標)} */
  selection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const pageDiv = node && node.closest && node.closest('.page');
    if (!pageDiv || !this.root.contains(pageDiv)) return null;
    const i = +pageDiv.dataset.page;
    const pr = pageDiv.getBoundingClientRect();
    const rects = [];
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const a = this.toBase(i, cr.left - pr.left, cr.top - pr.top), b = this.toBase(i, cr.right - pr.left, cr.bottom - pr.top);
      const r = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
      // 合併同一行
      const last = rects[rects.length - 1];
      if (last && Math.abs((last.y + last.h / 2) - (r.y + r.h / 2)) < Math.max(last.h, r.h) * 0.5 && r.x >= last.x - r.h) {
        const x1 = Math.min(last.x, r.x), y1 = Math.min(last.y, r.y), x2 = Math.max(last.x + last.w, r.x + r.w), y2 = Math.max(last.y + last.h, r.y + r.h);
        Object.assign(last, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      } else rects.push(r);
    }
    const text = sel.toString().replace(/\s+\n/g, '\n').trim();
    if (!text || !rects.length) return null;
    return { page: i, text, rects };
  }

  onSelection() {
    const s = this.selection();
    if (!s) { this.selbar.classList.add('hidden'); return; }
    this.app.onSelection(s);
  }

  // ---------------------------------------------------------------- 工具（框選、手繪、直線、點選）

  setTool(t) {
    this.cancelTool();
    this.tool = t;
    this.root.style.touchAction = t ? 'none' : '';
    for (const s of this.slots) if (s && s.ov) this.attachTool(s);
  }

  cancelTool() {
    this.tool = null;
    this.toolActive = false;
    this.ink = [];
    this.root.style.touchAction = '';
    for (const s of this.slots) if (s) s.div.querySelectorAll('.tool-layer,svg.draw').forEach(x => x.remove());
    this.setMeasure(null);
  }

  cancelStroke() {
    if (this.drawing) { this.drawing.svgEl && this.drawing.svgEl.remove(); this.drawing = null; this.toolActive = false; }
  }

  setMeasure(t) { this.measureEl.textContent = t || ''; this.measureEl.classList.toggle('hidden', !t); }

  attachTool(s) {
    s.div.querySelectorAll('.tool-layer,svg.draw').forEach(x => x.remove());
    if (!this.tool) return;
    const layer = el('div.tool-layer');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('draw');
    s.div.append(layer, svg);
    s.svg = svg;
    // 已畫好的手繪筆畫
    for (const st of this.ink.filter(x => x.page === s.i)) this.drawStroke(s, st.pts);
    const pt = e => { const r = s.div.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const color = () => this.tool.color || '#E53935';
    layer.addEventListener('pointerdown', e => {
      if (!e.isPrimary) return;
      if (this.tool.type === 'ink' && this.ink.length && this.ink[0].page !== s.i) return;
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      const p0 = pt(e);
      const t = this.tool.type;
      this.toolActive = true;
      const NS = 'http://www.w3.org/2000/svg';
      let shape;
      if (t === 'rect' || t === 'ellipse') { shape = document.createElementNS(NS, t === 'rect' ? 'rect' : 'ellipse'); }
      else if (t === 'line') { shape = document.createElementNS(NS, 'line'); }
      else if (t === 'ink') { shape = document.createElementNS(NS, 'polyline'); }
      if (shape) {
        shape.setAttribute('fill', t === 'ink' || t === 'line' ? 'none' : 'rgba(30,99,233,.06)');
        shape.setAttribute('stroke', color());
        shape.setAttribute('stroke-width', Math.max(1.5, (this.tool.width || 2) * this.scale));
        shape.setAttribute('stroke-linecap', 'round'); shape.setAttribute('stroke-linejoin', 'round');
        if (t === 'rect' || t === 'ellipse') shape.setAttribute('stroke-dasharray', '6 4');
        svg.append(shape);
      }
      this.drawing = { s, p0, pts: [p0], svgEl: shape, t };
    });
    layer.addEventListener('pointermove', e => {
      const d = this.drawing;
      if (!d || d.s !== s) return;
      const p = pt(e);
      if (d.t === 'rect') { const x = Math.min(p[0], d.p0[0]), y = Math.min(p[1], d.p0[1]); Object.entries({ x, y, width: Math.abs(p[0] - d.p0[0]), height: Math.abs(p[1] - d.p0[1]) }).forEach(([k, v]) => d.svgEl.setAttribute(k, v)); }
      else if (d.t === 'ellipse') { Object.entries({ cx: (p[0] + d.p0[0]) / 2, cy: (p[1] + d.p0[1]) / 2, rx: Math.abs(p[0] - d.p0[0]) / 2, ry: Math.abs(p[1] - d.p0[1]) / 2 }).forEach(([k, v]) => d.svgEl.setAttribute(k, v)); }
      else if (d.t === 'line') {
        Object.entries({ x1: d.p0[0], y1: d.p0[1], x2: p[0], y2: p[1] }).forEach(([k, v]) => d.svgEl.setAttribute(k, v));
        const a = this.toBase(s.i, ...d.p0), b = this.toBase(s.i, ...p);
        this.tool.onMove && this.tool.onMove(s.i, a, b);
      } else if (d.t === 'ink') {
        for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) d.pts.push(pt(ev));
        d.svgEl.setAttribute('points', d.pts.map(q => q.join(',')).join(' '));
      }
      d.last = p;
    });
    const up = e => {
      const d = this.drawing;
      if (!d || d.s !== s) return;
      this.drawing = null;
      this.toolActive = false;
      const p = d.last || d.p0;
      const a = this.toBase(s.i, ...d.p0), b = this.toBase(s.i, ...p);
      const rect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
      const moved = Math.hypot(p[0] - d.p0[0], p[1] - d.p0[1]) > 6;
      const h = this.tool;
      if (d.t === 'ink') {
        if (d.pts.length) this.ink.push({ page: s.i, pts: d.pts.map(q => this.toBase(s.i, q[0], q[1])), css: d.pts });
        h.onInk && h.onInk(this.ink);
        return;
      }
      d.svgEl && d.svgEl.remove();
      if (d.t === 'line') { if (moved) h.onLine && h.onLine(s.i, a, b); return; }
      if ((d.t === 'rect' || d.t === 'ellipse') && moved && rect.w > 3 && rect.h > 3) { h.onRect && h.onRect(s.i, rect); return; }
      h.onTap && h.onTap(s.i, a[0], a[1]);
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', () => this.cancelStroke());
  }

  drawStroke(s, basePts) {
    const NS = 'http://www.w3.org/2000/svg';
    const pl = document.createElementNS(NS, 'polyline');
    const css = basePts.map(p => { const r = this.toCss(s.i, { x: p[0], y: p[1], w: 0, h: 0 }); return [r.x, r.y]; });
    pl.setAttribute('points', css.map(q => q.join(',')).join(' '));
    pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', this.tool.color); pl.setAttribute('stroke-width', Math.max(1.5, (this.tool.width || 2) * this.scale));
    pl.setAttribute('stroke-linecap', 'round'); pl.setAttribute('stroke-linejoin', 'round');
    s.svg.append(pl);
  }

  undoInk() {
    this.ink.pop();
    for (const s of this.slots) if (s && s.ov) this.attachTool(s);
  }

  takeInk() { const r = this.ink; this.ink = []; for (const s of this.slots) if (s && s.svg) s.svg.innerHTML = ''; return r; }
}
