// =====================================================================
// 文件畫面（DocumentView）
//
// 比喻：一張「工作桌」。桌上攤開每一頁底稿（pdf.js 畫的畫布），
// 上面疊著幾層透明片：
//   patches  ─ 編輯原文字時蓋掉原字的色塊
//   hits     ─ 「改原文字」工具：滑過會亮起的原始文字行
//   elements ─ 使用者的貼紙
//   preview  ─ 浮水印預覽
// 這個類別負責：畫頁面、縮放、以及所有滑鼠 / 觸控操作（點、拖、拉大小、框選）。
// 它不直接改資料，而是透過 session 與 app 提供的方法。
// =====================================================================
import { createNode, updateNode, patchNode, toggleMedia, readEditableText } from './elementView.js';
import { clamp } from '../pdf/util.js';
import { FONT_CSS } from '../pdf/fonts.js';

const DRAG_TOOLS = new Set(['cover', 'link', 'media', 'image']);

export class DocumentView {
  /**
   * @param {HTMLElement} scroller 可捲動的外框
   * @param {import('./app.js').App} app
   */
  constructor(scroller, app) {
    this.scroller = scroller;
    this.app = app;
    this.session = app.session;
    this.renderer = app.renderer;
    this.zoom = 1;
    this.fitMode = 'width';       // width | none
    this.pagesEl = document.createElement('div');
    this.pagesEl.className = 'pages';
    scroller.appendChild(this.pagesEl);
    this.shells = [];             // 每頁的 DOM：{ root, canvas, patches, hits, elements, preview, rendered, nodes: Map }
    this.selectedId = null;
    this.editingId = null;
    this.justCreatedId = null;
    this.wmSpec = null;
    this._renderQueue = new Set();
    this._renderTimer = null;

    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = +e.target.dataset.index;
        this.shells[i].visible = e.isIntersecting;
        if (e.isIntersecting) this._queueRender(i);
      }
    }, { root: scroller, rootMargin: '800px 0px' });

    this._bindPointer();
    scroller.addEventListener('scroll', () => this._updateCurrentPage(), { passive: true });
    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || !this.shells.length) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX, y: e.clientY });
    }, { passive: false });
    new ResizeObserver(() => { if (this.fitMode === 'width') this.fitWidth(); }).observe(scroller);
    document.fonts.addEventListener?.('loadingdone', () => this.syncElements());
  }

  // ================================================================ 建立頁面

  /** 底稿換了：重建每頁的外框並重新繪製 */
  async rebuild() {
    const keepScroll = this.scroller.scrollTop / Math.max(1, this.scroller.scrollHeight);
    const sameCount = this.shells.length === this.session.pages.length;
    this.observer.disconnect();
    this.pagesEl.innerHTML = '';
    this.shells = this.session.pages.map((g, i) => this._makeShell(g, i));
    if (this.fitMode === 'width') this.fitWidth(true); else this._layout();
    if (sameCount) this.scroller.scrollTop = keepScroll * this.scroller.scrollHeight;
    this.shells.forEach(s => this.observer.observe(s.root));
    this.syncElements();
    this._updateCurrentPage();
  }

  _makeShell(g, i) {
    const root = document.createElement('div');
    root.className = 'page';
    root.dataset.index = i;
    root.innerHTML = `<canvas class="page-canvas"></canvas><div class="layer patches"></div><div class="layer hits"></div><div class="layer elements"></div><div class="layer preview"></div><div class="page-num">${i + 1} / ${this.session.pages.length}</div>`;
    this.pagesEl.appendChild(root);
    return {
      root, g, index: i,
      canvas: root.querySelector('canvas'),
      patches: root.querySelector('.patches'),
      hits: root.querySelector('.hits'),
      elements: root.querySelector('.elements'),
      preview: root.querySelector('.preview'),
      nodes: new Map(),
      renderedScale: 0,
      visible: false,
    };
  }

  _layout() {
    const z = this.zoom;
    for (const s of this.shells) {
      s.root.style.width = s.g.width * z + 'px';
      s.root.style.height = s.g.height * z + 'px';
    }
  }

  // ================================================================ 縮放

  setZoom(z, anchor) {
    z = clamp(z, 0.25, 5);
    if (Math.abs(z - this.zoom) < 1e-3) return;
    // 以游標（或畫面中心）為基準縮放，看的地方不會跑掉
    const rect = this.scroller.getBoundingClientRect();
    const ax = anchor ? anchor.x - rect.left : rect.width / 2;
    const ay = anchor ? anchor.y - rect.top : rect.height / 2;
    const docX = (this.scroller.scrollLeft + ax) / this.zoom, docY = (this.scroller.scrollTop + ay) / this.zoom;
    this.zoom = z;
    this.fitMode = 'none';
    this._layout();
    this.scroller.scrollLeft = docX * z - ax;
    this.scroller.scrollTop = docY * z - ay;
    this._afterZoom();
  }

  fitWidth(silent) {
    if (!this.shells.length) return;
    const maxW = Math.max(...this.shells.map(s => s.g.width));
    const avail = this.scroller.clientWidth - (window.innerWidth < 760 ? 16 : 56);
    const z = clamp(avail / maxW, 0.25, 2.5);
    this.fitMode = 'width';
    if (Math.abs(z - this.zoom) < 1e-3 && !silent) return;
    this.zoom = z;
    this._layout();
    this._afterZoom();
  }

  _afterZoom() {
    this.syncElements();
    this.refreshHits();
    this.renderPreview();
    this.shells.forEach(s => { if (s.visible) this._queueRender(s.index); });
    this.app.onZoom?.(this.zoom);
  }

  // ================================================================ 繪製頁面（只畫看得到的頁）

  _queueRender(i) {
    this._renderQueue.add(i);
    clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => this._drainRender(), 60);
  }

  async _drainRender() {
    const list = [...this._renderQueue].filter(i => this.shells[i]?.visible);
    this._renderQueue.clear();
    for (const i of list) {
      const s = this.shells[i];
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      let scale = this.zoom * dpr;
      const maxPx = 14e6;                       // 避免超大畫布讓手機當掉
      if (s.g.width * s.g.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (s.g.width * s.g.height));
      if (Math.abs(s.renderedScale - scale) < 0.01) continue;
      try {
        s.canvas._task?.cancel();
        const off = document.createElement('canvas');
        await this.renderer.render(i, off, scale);
        if (!this.shells[i] || this.shells[i] !== s) return;   // 這段時間底稿換了
        s.canvas.width = off.width; s.canvas.height = off.height;
        s.canvas.getContext('2d', { willReadFrequently: true }).drawImage(off, 0, 0);
        s.renderedScale = scale;
        s.root.classList.add('rendered');
        if (this.hitsOn) this.refreshHits();       // 畫好後才能找表格框線，重新拆行
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') console.warn('繪製失敗', i, e);
      }
    }
  }

  // ================================================================ 貼紙同步

  syncElements() {
    const z = this.zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const s of this.shells) {
      const els = this.session.elementsOn(s.index);
      const alive = new Set(els.map(e => e.id));
      for (const [id, node] of s.nodes) if (!alive.has(id)) { node.remove(); s.nodes.delete(id); }
      s.patches.innerHTML = '';
      els.forEach((el, order) => {
        let node = s.nodes.get(el.id);
        if (!node) { node = createNode(el); s.nodes.set(el.id, node); }
        if (s.elements.children[order] !== node) s.elements.insertBefore(node, s.elements.children[order] || null);
        updateNode(node, el, { z, dpr, selected: el.id === this.selectedId, editing: el.id === this.editingId });
        if (el.patch) s.patches.appendChild(patchNode(el, z));
      });
    }
    this.refreshHits();
  }

  nodeOf(id) {
    for (const s of this.shells) if (s.nodes.has(id)) return s.nodes.get(id);
    return null;
  }

  select(id) {
    if (this.editingId && this.editingId !== id) this.endEdit();
    this.selectedId = id;
    this.syncElements();
    this.app.onSelect?.(id);
  }

  // ================================================================ 文字編輯

  beginEdit(id, { selectAll = false } = {}) {
    const el = this.session.get(id);
    if (!el || !(el.kind === 'text' || (el.kind === 'link' && !el.isArea))) return;
    this.selectedId = id;
    this.editingId = id;
    this.syncElements();
    const node = this.nodeOf(id);
    const c = node.querySelector('.el-content');
    c.focus();
    const r = document.createRange();
    r.selectNodeContents(c);
    if (!selectAll) r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    c.oninput = () => {
      const text = readEditableText(node);
      this.session.update(id, { text }, { label: '輸入文字', coalesce: 'type:' + id });
    };
    c.onblur = () => setTimeout(() => { if (this.editingId === id && document.activeElement !== c) this.endEdit(); }, 0);
    c.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); c.blur(); } };
    this.app.onSelect?.(id);
  }

  endEdit() {
    const id = this.editingId;
    if (!id) return;
    this.editingId = null;
    const el = this.session.get(id);
    if (el && !String(el.text).trim() && !(el.kind === 'link')) {
      // 空白文字：剛建立的就當作沒發生，否則刪除
      if (this.justCreatedId === id) this.session.cancelAdd(id); else this.session.remove(id);
      if (this.selectedId === id) this.selectedId = null;
    }
    this.justCreatedId = null;
    this.syncElements();
    this.app.onSelect?.(this.selectedId);
  }

  // ================================================================ 「改原文字」的偵測層

  async setHitsEnabled(on) {
    this.hitsOn = on;
    this.pagesEl.classList.toggle('hits-on', on);
    if (on) for (const s of this.shells) s.lines = await this.renderer.textLines(s.index);
    this.refreshHits();
  }

  refreshHits() {
    for (const s of this.shells) {
      s.hits.innerHTML = '';
      if (!this.hitsOn || !s.lines) continue;
      if (!s.lines.split && s.renderedScale) s.lines = this.splitAtRules(s.index, s.lines);
      const patches = this.session.elementsOn(s.index).filter(e => e.patch).map(e => e.patch);
      const z = this.zoom;
      s.lines.forEach((l, k) => {
        const covered = patches.some(p => overlap(p, l) > 0.6);
        if (covered) return;
        const d = document.createElement('div');
        d.className = 'hit';
        d.dataset.line = k;
        d.title = '點一下修改這行文字';
        d.style.cssText = `left:${l.x * z - 2}px;top:${l.y * z - 1}px;width:${l.w * z + 4}px;height:${l.h * z + 2}px`;
        s.hits.appendChild(d);
      });
    }
  }

  // ================================================================ 浮水印預覽

  setWatermarkPreview(spec) { this.wmSpec = spec; this.renderPreview(); }

  renderPreview() {
    for (const s of this.shells) s.preview.innerHTML = '';
    const spec = this.wmSpec;
    if (!spec) return;
    const pages = new Set(spec.pageIndexes);
    const z = this.zoom;
    for (const s of this.shells) {
      if (!pages.has(s.index)) continue;
      for (const st of spec.placements(s.g)) {
        const d = document.createElement('div');
        d.className = 'wm-stamp';
        d.style.left = st.cx * z + 'px';
        d.style.top = st.cy * z + 'px';
        d.style.transform = `translate(-50%,-50%) rotate(${-spec.angle}deg)`;
        d.style.opacity = spec.opacity;
        if (spec.kind === 'text') {
          d.textContent = spec.text;
          d.style.fontFamily = FONT_CSS[spec.font] || FONT_CSS.huninn;
          d.style.fontSize = spec.size * z + 'px';
          d.style.color = spec.color;
          d.style.lineHeight = '1.2';
          if (spec.bold) d.style.webkitTextStroke = `${spec.size * 0.035 * z}px ${spec.color}`;
        } else if (spec.imageUrl) {
          d.innerHTML = `<img src="${spec.imageUrl}" alt="" style="width:${st.w * z}px;height:${st.h * z}px">`;
        }
        s.preview.appendChild(d);
      }
    }
  }

  // ================================================================ 目前頁碼

  _updateCurrentPage() {
    const mid = this.scroller.getBoundingClientRect().top + this.scroller.clientHeight * 0.4;
    let cur = 0;
    for (const s of this.shells) {
      const r = s.root.getBoundingClientRect();
      if (r.top <= mid) cur = s.index; else break;
    }
    if (cur !== this.currentPage) { this.currentPage = cur; this.app.onPageChange?.(cur); }
  }

  scrollToPage(i) {
    const s = this.shells[i];
    if (s) this.scroller.scrollTo({ top: s.root.offsetTop - 12, behavior: 'smooth' });
  }

  /** 取得某頁畫布上一塊區域的像素（顏色取樣用），座標為顯示座標 */
  samplePixels(i, rect) {
    const s = this.shells[i];
    if (!s || !s.renderedScale) return null;
    const k = s.canvas.width / s.g.width;
    const x = Math.max(0, Math.floor(rect.x * k)), y = Math.max(0, Math.floor(rect.y * k));
    const w = Math.max(1, Math.min(s.canvas.width - x, Math.ceil(rect.w * k))), h = Math.max(1, Math.min(s.canvas.height - y, Math.ceil(rect.h * k)));
    try { return s.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h); } catch (e) { return null; }
  }

  /**
   * 文字所在的表格儲存格（顯示座標）：從畫好的頁面找左右的直框線、上下的橫框線。
   * 不在表格裡（找不到四邊框線）回傳 null。
   */
  /** 讀出已繪製頁面的像素，提供找框線用的函式 */
  _pix(i) {
    const s = this.shells[i];
    if (!s || !s.renderedScale) return null;
    const g = s.g, k = s.canvas.width / g.width;
    const img = this.samplePixels(i, { x: 0, y: 0, w: g.width, h: g.height });
    if (!img) return null;
    const { data, width: W, height: H } = img;
    const lum = (x, y) => {
      const px = Math.round(x * k), py = Math.round(y * k);
      if (px < 0 || py < 0 || px >= W || py >= H) return 765;
      const o = (py * W + px) * 4;
      return data[o] + data[o + 1] + data[o + 2];
    };
    const ink = (x, y) => lum(x, y) < 600;
    // 細線：本身是深色，旁邊 3pt 有一側明顯比較亮
    const thinV = (x, y) => ink(x, y) && (lum(x - 3, y) - lum(x, y) > 90 || lum(x + 3, y) - lum(x, y) > 90);
    const thinH = (x, y) => ink(x, y) && (lum(x, y - 3) - lum(x, y) > 90 || lum(x, y + 3) - lum(x, y) > 90);
    const step = Math.min(0.5, 1 / k);
    // x 處有一條穿過這行文字上下的直線
    const vRule = (line, x) => [0, 0.25, 0.5, 0.75, 1].map(f => line.y - line.h * 0.15 + f * line.h * 1.3)
      .every(y => thinV(x, y) || thinV(x - step, y) || thinV(x + step, y));
    return { g, thinH, step, vRule };
  }

  /** 同一行裡被表格直框線隔開的片段拆成不同行（例如「6」和隔壁格的文字） */
  splitAtRules(i, lines) {
    const P = this._pix(i);
    if (!P) return lines;
    const out = [];
    for (const l of lines) {
      if (!l.parts || l.parts.length < 2) { out.push(l); continue; }
      const groups = [[l.parts[0]]];
      for (let j = 1; j < l.parts.length; j++) {
        const a = l.parts[j - 1], b = l.parts[j];
        let cut = false;
        for (let x = a.x + a.w; x <= b.x && !cut; x += P.step) cut = P.vRule(l, x);
        if (cut) groups.push([b]); else groups[groups.length - 1].push(b);
      }
      if (groups.length === 1) { out.push(l); continue; }
      for (const gp of groups) {
        const x = gp[0].x, x2 = Math.max(...gp.map(q => q.x + q.w));
        let text = '';
        gp.forEach((q, j) => {
          if (j && q.x - (gp[j - 1].x + gp[j - 1].w) > l.size * 0.2 && !/\s$/.test(text) && !/^\s/.test(q.text)) text += ' ';
          text += q.text;
        });
        text = text.trim();
        if (text) out.push({ ...l, x, w: x2 - x, text, parts: gp });
      }
    }
    out.split = true;
    return out;
  }

  cellAt(i, line) {
    const P = this._pix(i);
    if (!P) return null;
    const { g, thinH, step } = P;
    const vRule = x => P.vRule(line, x);
    let x1 = null, x2 = null;
    for (let x = line.x - 0.5; x > 0; x -= step) if (vRule(x)) { x1 = x; break; }
    // 從字的中間往右找（原本的字可能已經超出格子）
    for (let x = line.x + Math.min(line.w, line.size) + 0.5; x < g.width; x += step) if (vRule(x)) { x2 = x; break; }
    if (x1 == null || x2 == null || x2 - x1 < line.size) return null;
    const xs = Array.from({ length: 9 }, (_, j) => x1 + 3 + (x2 - x1 - 6) * j / 8);
    const hRule = y => xs.every(x => thinH(x, y) || thinH(x, y - step) || thinH(x, y + step));
    let y1 = null, y2 = null;
    const lim = line.size * 25;
    for (let y = line.y - 0.5; y > Math.max(0, line.y - lim); y -= step) if (hRule(y)) { y1 = y; break; }
    for (let y = line.y + line.h + 0.5; y < Math.min(g.height, line.y + lim); y += step) if (hRule(y)) { y2 = y; break; }
    if (y1 == null || y2 == null) return null;
    return { x1, x2, y1, y2 };
  }

  // ================================================================ 指標操作（滑鼠、觸控筆、手指）

  _bindPointer() {
    this.pagesEl.addEventListener('pointerdown', (e) => this._onDown(e));
    this.pagesEl.addEventListener('dblclick', (e) => {
      const node = e.target.closest('.el');
      if (node) this.beginEdit(node.dataset.id, { selectAll: false });
    });
    this.pagesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.media-play');
      if (!btn) return;
      const node = btn.closest('.el');
      toggleMedia(node, this.session.get(node.dataset.id));
    });
  }

  _pagePoint(shell, e) {
    const r = shell.root.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }

  _onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const shell = this.shells[+pageEl.dataset.index];
    const tool = this.app.tool;
    if (e.target.closest('.media-play, .media-player')) return;

    // 1) 拉控制點改大小
    const handle = e.target.closest('.handle');
    if (handle) { e.preventDefault(); this._startResize(e, shell, handle.closest('.el').dataset.id, handle.dataset.h); return; }

    // 2) 點到貼紙：選取並拖曳
    const node = e.target.closest('.el');
    if (node) {
      const id = node.dataset.id;
      if (this.editingId === id) return;           // 編輯中：讓游標正常運作
      e.preventDefault();
      if (this.selectedId !== id) this.select(id);
      this._startMove(e, shell, id);
      return;
    }

    // 3) 「改原文字」：點到原始文字行
    const hit = e.target.closest('.hit');
    if (hit && tool === 'edittext') {
      e.preventDefault();
      this.app.replaceLine(shell.index, shell.lines[+hit.dataset.line]);
      return;
    }

    // 4) 點在空白處
    if (this.editingId) { this.endEdit(); }
    const p = this._pagePoint(shell, e);
    if (tool === 'text') { e.preventDefault(); this.app.createText(shell.index, p); return; }
    if (DRAG_TOOLS.has(tool)) { e.preventDefault(); this._startRubber(e, shell, p, tool); return; }
    if (this.selectedId) this.select(null);
  }

  _startMove(e, shell, id) {
    const el = this.session.get(id);
    const node = shell.nodes.get(id);
    const start = this._pagePoint(shell, e);
    const z = this.zoom;
    let dx = 0, dy = 0, moved = false;
    const move = (ev) => {
      const p = this._pagePoint(shell, ev);
      dx = p.x - start.x; dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * z < 3) return;
      moved = true;
      const nx = clamp(el.x + dx, -el.w + 10, shell.g.width - 10), ny = clamp(el.y + dy, -el.h + 10, shell.g.height - 10);
      node.style.left = nx * z + 'px'; node.style.top = ny * z + 'px';
      dx = nx - el.x; dy = ny - el.y;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (moved) this.session.update(id, { x: el.x + dx, y: el.y + dy }, { label: '移動' + el.label });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  _startResize(e, shell, id, h) {
    const el = this.session.get(id);
    const node = shell.nodes.get(id);
    const start = this._pagePoint(shell, e);
    const z = this.zoom;
    const keepRatio = el.kind === 'image';
    const ratio = el.w / el.h;
    let box = { x: el.x, y: el.y, w: el.w, h: el.h };
    const move = (ev) => {
      const p = this._pagePoint(shell, ev);
      const dx = p.x - start.x, dy = p.y - start.y;
      let { x, y, w, h: hh } = { x: el.x, y: el.y, w: el.w, h: el.h };
      if (h.includes('e')) w = el.w + dx;
      if (h.includes('s')) hh = el.h + dy;
      if (h.includes('w')) { w = el.w - dx; x = el.x + dx; }
      if (h.includes('n')) { hh = el.h - dy; y = el.y + dy; }
      if (keepRatio && !ev.shiftKey) {
        if (h === 'n' || h === 's') w = hh * ratio; else hh = w / ratio;
        if (h.includes('w')) x = el.x + el.w - w;
        if (h.includes('n')) y = el.y + el.h - hh;
      }
      const min = 8;
      if (w < min) { if (h.includes('w')) x -= min - w; w = min; }
      if (hh < min) { if (h.includes('n')) y -= min - hh; hh = min; }
      box = { x, y, w, h: hh };
      Object.assign(node.style, { left: x * z + 'px', top: y * z + 'px', width: w * z + 'px', height: hh * z + 'px' });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (box.w !== el.w || box.h !== el.h || box.x !== el.x || box.y !== el.y) this.session.update(id, box, { label: '調整' + el.label + '大小' });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  /** 框選一塊區域來建立遮蓋 / 連結 / 影音 / 圖片；只點一下就用預設大小 */
  _startRubber(e, shell, start, tool) {
    const z = this.zoom;
    const band = document.createElement('div');
    band.className = 'rubber';
    shell.elements.appendChild(band);
    let rect = { x: start.x, y: start.y, w: 0, h: 0 };
    const move = (ev) => {
      const p = this._pagePoint(shell, ev);
      const x1 = clamp(Math.min(start.x, p.x), 0, shell.g.width), y1 = clamp(Math.min(start.y, p.y), 0, shell.g.height);
      const x2 = clamp(Math.max(start.x, p.x), 0, shell.g.width), y2 = clamp(Math.max(start.y, p.y), 0, shell.g.height);
      rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      Object.assign(band.style, { left: x1 * z + 'px', top: y1 * z + 'px', width: rect.w * z + 'px', height: rect.h * z + 'px' });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      band.remove();
      const dragged = rect.w * z > 6 && rect.h * z > 6;
      this.app.createByRect(tool, shell.index, dragged ? rect : null, start);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
}

/** 兩個矩形的重疊比例（相對於 b 的面積） */
function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.max(1, b.w * b.h);
}
