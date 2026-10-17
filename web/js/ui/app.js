// =====================================================================
// App 主控制器
//
// 比喻：「工作室的店長」。它不親自畫圖或解析 PDF，而是把工作分派給：
//   EditSession（工作日誌）、PdfRenderer（印表機）、DocumentView（工作桌）、
//   Inspector（調色盤）、Exporter / WatermarkAdder / WatermarkRemover（加工師傅）。
// 使用者的每個動作（開檔、選工具、新增貼紙、下載）都先到這裡，再交給對的人。
// =====================================================================
import { EditSession } from '../domain/session.js';
import { TextElement, CoverElement, LinkElement, MediaElement, ImageElement } from '../domain/elements.js';
import { PdfRenderer } from '../pdf/renderer.js';
import { fonts } from '../pdf/fonts.js';
import { exportPdf } from '../pdf/exporter.js';
import { addWatermark } from '../pdf/watermarkAdder.js';
import { removeWatermarks } from '../pdf/watermarkRemover.js';
import { growBelow, insertRow, insertColumn, splitColumn, mergeCells, addTable } from '../pdf/tableEditor.js';
import { fetchYoutubePoster } from '../pdf/media.js';
import { PDFLib } from '../pdf/libs.js';
import { downloadBytes, fileToBytes, normalizeImage } from '../pdf/util.js';
import { DocumentView } from './documentView.js';
import { Inspector, TOOL_INFO } from './inspector.js';
import { ICONS, LOGO } from './icons.js';
import { toast, busy } from './toast.js';
import { pickFile } from './dom.js';

const TOOL_ORDER = ['select', 'edittext', 'text', 'table', 'cover', 'link', 'media', 'image', '|', 'watermark', 'unwatermark'];

export class App {
  constructor() {
    this.session = new EditSession();
    this.renderer = new PdfRenderer();
    this.tool = 'select';
    this.textDefaults = { font: 'huninn', size: 16, color: '#1d1f23' };
    this.tableDefaults = { rows: 3, cols: 3 };
    this.$ = (sel) => document.querySelector(sel);

    this._buildChrome();
    this.view = new DocumentView(this.$('#viewport'), this);
    this.inspector = new Inspector(this.$('#inspector'), this);

    this.session.addEventListener('base', () => this._reloadBase());
    this.session.addEventListener('elements', () => { this.view.syncElements(); this._updateTitle(); });
    this.session.addEventListener('history', () => this._updateHistory());
    this._bindKeys();
    this._bindFileDrop();
    window.addEventListener('beforeunload', (e) => { if (this.session.isOpen && this.session.dirty) { e.preventDefault(); e.returnValue = ''; } });
    this.inspector.render();
    this._updateHistory();
  }

  // ================================================================ 外框（標題列、工具列、狀態列）

  _buildChrome() {
    this.$('#brand').innerHTML = `${LOGO}<div><b>小柯文件PDF助手</b><small>網頁版 · 檔案不上傳</small></div>`;
    const tb = this.$('#tools');
    for (const t of TOOL_ORDER) {
      if (t === '|') { tb.appendChild(Object.assign(document.createElement('hr'), {})); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.tool = t;
      b.title = `${TOOL_INFO[t].name}（${TOOL_INFO[t].key}）`;
      b.innerHTML = `${ICONS[t]}<span>${TOOL_INFO[t].name}</span>`;
      b.addEventListener('click', () => this.setTool(t));
      tb.appendChild(b);
    }
    const bind = (id, icon, fn) => { const b = this.$(id); b.insertAdjacentHTML('afterbegin', ICONS[icon]); b.addEventListener('click', fn); };
    bind('#btn-undo', 'undo', () => this.session.undo());
    bind('#btn-redo', 'redo', () => this.session.redo());
    bind('#btn-open', 'open', () => this.openPicker());
    bind('#btn-download', 'download', () => this.download());
    bind('#zoom-out', 'zoomOut', () => this.view.setZoom(this.view.zoom / 1.2));
    bind('#zoom-in', 'zoomIn', () => this.view.setZoom(this.view.zoom * 1.2));
    bind('#zoom-fit', 'fit', () => this.view.fitWidth());
    this.$('#empty-open').addEventListener('click', () => this.openPicker());
    this.$('#sheet-close').innerHTML = ICONS.close;
    this.$('#sheet-close').addEventListener('click', () => { if (this.tool === 'watermark' || this.tool === 'unwatermark') this.setTool('select'); else this.view.select(null); document.body.classList.remove('sheet-open'); });
    this.$('#page-input').addEventListener('change', (e) => this.view.scrollToPage(Math.max(0, (+e.target.value || 1) - 1)));
    this._markTool();
  }

  setTool(t) {
    if (!this.session.isOpen && t !== 'select') { toast('請先開啟一份 PDF', 'warn'); return; }
    const prev = this.tool;
    this.tool = t;
    if (this.view.editingId) this.view.endEdit();
    if (t !== 'select' && this.view.selectedId && (t === 'watermark' || t === 'unwatermark')) this.view.select(null);
    this.view.pagesEl.dataset.tool = t;
    if ((t === 'edittext') !== (prev === 'edittext')) {
      this.view.setHitsEnabled(t === 'edittext').then(() => this.inspector.render(true));
    }
    this._markTool();
    this.inspector.render(true);
  }

  _markTool() {
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === this.tool));
  }

  // ================================================================ 開檔 / 下載

  async openPicker() {
    const f = await pickFile('application/pdf,.pdf');
    if (f) this.openFile(f);
  }

  async openFile(file) {
    if (this.session.isOpen && this.session.dirty && !confirm('目前的修改還沒下載，確定要開啟新檔案嗎？')) return;
    const bytes = await fileToBytes(file);
    if (String.fromCharCode(...bytes.subarray(0, 1024)).indexOf('%PDF') < 0) { toast('這不是 PDF 檔案', 'error'); return; }
    // 加密的 PDF：pdf-lib 無法安全地修改
    try { await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test(e.message || '')) toast('這份 PDF 有加密保護，網頁版無法修改。請先用小柯 App 的「移除保護」後再開啟。', 'error', 8000);
      else toast('PDF 檔案可能已損壞：' + e.message, 'error', 6000);
      return;
    }
    this.$('#empty').hidden = true;
    fonts.loadHuninn().catch(() => toast('中文字型下載失敗，請檢查網路後重新整理', 'warn', 6000));
    this.session.open(file.name, bytes);
    this.setTool('select');
  }

  async _reloadBase() {
    const s = this.session;
    try {
      await this.renderer.open(s.baseBytes);
    } catch (e) {
      if (e?.name === 'PasswordException') {
        const pw = prompt('這份 PDF 需要密碼才能開啟：');
        if (pw !== null) { try { await this.renderer.open(s.baseBytes, pw); } catch (e2) { toast('密碼錯誤', 'error'); return; } }
        else return;
      } else { toast('無法顯示 PDF：' + e.message, 'error', 6000); return; }
    }
    s.setPages(await this.renderer.geometries());
    document.body.classList.add('has-doc');
    this.$('#page-total').textContent = s.pages.length;
    this.$('#page-input').max = s.pages.length;
    await this.view.rebuild();
    if (this.view.hitsOn) await this.view.setHitsEnabled(true);
    this._updateTitle();
  }

  async download() {
    const s = this.session;
    if (!s.isOpen) { this.openPicker(); return; }
    if (this.view.editingId) this.view.endEdit();
    const missing = s.elements.filter(e => (e.kind === 'link' && !e.url) || (e.kind === 'media' && ((e.source === 'url' && !e.url) || (e.source === 'file' && !e.file))));
    if (missing.length) {
      this.view.select(missing[0].id);
      this.view.scrollToPage(missing[0].pageIndex);
      toast(`有 ${missing.length} 個連結或影音還沒設定網址／檔案`, 'warn');
      return;
    }
    try {
      const report = {};
      const bytes = await busy('正在產生 PDF…', async () => {
        if (s.elements.some(e => (e.kind === 'text' || e.kind === 'link') && e.text)) await fonts.loadHuninn();
        return exportPdf(s, report);
      });
      if (report.missing?.length) toast(`這些字元字型沒有，已略過：${report.missing.join(' ')}`, 'warn', 7000);
      const base = s.fileName.replace(/\.pdf$/i, '');
      downloadBytes(bytes, `${base}_小柯編輯.pdf`);
      s.markSaved();
      toast('已下載新的 PDF ✔', 'ok');
    } catch (e) {
      console.error(e);
      toast('產生 PDF 失敗：' + e.message, 'error', 8000);
    }
  }

  // ================================================================ 建立貼紙

  createText(pageIndex, p) {
    const d = this.textDefaults;
    const el = new TextElement({ pageIndex, x: p.x, y: p.y - d.size * 0.65, text: '', font: d.font, size: d.size, color: d.color });
    this.session.add(el);
    this.view.justCreatedId = el.id;
    this.view.beginEdit(el.id);
  }

  /**
   * 「改原文字」：點到一行原始文字 → 蓋掉原字 + 放一段可編輯的新文字。
   * 在表格裡：同一格的幾行一起編輯，新文字在格子寬度內自動換行，不會跨到隔壁格。
   */
  replaceLine(pageIndex, line) {
    const cell = this.view.cellAt(pageIndex, line);
    let lines = [line];
    if (cell) {
      const all = this.view.shells[pageIndex].lines || [line];
      lines = all.filter(l => {
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
        return cx > cell.x1 && cx < cell.x2 && cy > cell.y1 && cy < cell.y2 && Math.abs(l.size - line.size) <= line.size * 0.2;
      }).sort((a, b) => a.baseline - b.baseline || a.x - b.x);
      if (!lines.includes(line)) lines = [line];
    }
    const first = lines[0];
    const x1 = Math.min(...lines.map(l => l.x)), y1 = Math.min(...lines.map(l => l.y));
    const area = { x: x1, y: y1, w: Math.max(...lines.map(l => l.x + l.w)) - x1, h: Math.max(...lines.map(l => l.y + l.h)) - y1 };
    const sampled = this.sampleColor(pageIndex, area);
    const size = Math.round(Math.max(...lines.map(l => l.size)) * 10) / 10;
    // 多行時沿用原本的行距（基線間距），否則 1.3 倍
    const lineHeight = lines.length > 1
      ? Math.max(1.05, Math.round((lines[lines.length - 1].baseline - first.baseline) / (lines.length - 1) / size * 100) / 100)
      : 1.3;
    const ratio = fonts.baselineRatio('huninn', lineHeight);
    const pad = Math.max(1, size * 0.08);
    // 段落文字：中文之間直接相接，英文之間補空白
    let text = '';
    for (const l of lines) {
      if (text && !/[⺀-￿]$/.test(text) && !/^[⺀-￿]/.test(l.text)) text += ' ';
      text += l.text;
    }
    const maxW = cell ? Math.max(size * 2, cell.x2 - Math.max(2, x1 - cell.x1) - x1) : null;
    const el = new TextElement({
      pageIndex, x: x1, y: first.baseline - ratio * size, text, font: 'huninn', size, lineHeight, maxW,
      color: sampled?.ink || '#1d1f23',
      patch: { x: area.x - pad, y: area.y - pad, w: area.w + pad * 2, h: area.h + pad * 2, color: sampled?.bg || '#ffffff' },
    });
    if (cell) el.inCell = true;
    this.session.add(el, '修改原文字');
    this.view.beginEdit(el.id);
    if (cell) {
      // 編輯框量好高度之後，記住它到下框線的距離（之後字變長才撐高）
      const e = this.session.get(el.id);
      e.cellPad = Math.max(1, cell.y2 - (e.y + e.h));
    }
  }

  /** 框選（或點一下）建立遮蓋、連結、影音、圖片 */
  async createByRect(tool, pageIndex, rect, point) {
    const g = this.session.pages[pageIndex];
    const at = (w, h) => rect || { x: Math.min(Math.max(0, point.x - w / 2), g.width - w), y: Math.min(Math.max(0, point.y - h / 2), g.height - h), w, h };
    let el;
    if (tool === 'cover') {
      const r = at(140, 28);
      el = new CoverElement({ pageIndex, ...r });
      const c = this.sampleColor(pageIndex, r, true);
      if (c && rect) el.color = c.bg;
    } else if (tool === 'link') {
      if (rect) el = new LinkElement({ pageIndex, ...rect, text: '' });
      else el = new LinkElement({ pageIndex, x: point.x, y: point.y - 10, text: '點此開啟連結', w: 100, h: 20 });
    } else if (tool === 'media') {
      el = new MediaElement({ pageIndex, ...at(Math.min(320, g.width * 0.7), Math.min(180, g.width * 0.7 * 9 / 16)) });
    } else if (tool === 'image') {
      const f = await pickFile('image/*');
      if (!f) return;
      let img;
      try { img = await normalizeImage(f); } catch (e) { toast('無法讀取這張圖片', 'error'); return; }
      const url = URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
      let r;
      if (rect) {
        const s = Math.min(rect.w / img.width, rect.h / img.height);
        r = { x: rect.x, y: rect.y, w: img.width * s, h: img.height * s };
      } else {
        const w = Math.min(220, g.width * 0.5, img.width * 0.75);
        r = at(w, (w * img.height) / img.width);
      }
      el = new ImageElement({ pageIndex, ...r, image: { ...img, url } });
    }
    if (!el) return;
    this.session.add(el);
    // 連結、影音、圖片通常一次放一個：放好就切回「選取」，方便馬上調整位置
    if (tool !== 'cover') { this.tool = 'select'; this.view.pagesEl.dataset.tool = 'select'; this._markTool(); }
    this.view.select(el.id);
  }

  duplicate(id) {
    const el = this.session.get(id);
    if (!el) return;
    const c = el.clone();
    c.id = undefined;
    const copy = new el.constructor({ ...c, x: el.x + 12, y: el.y + 12, id: undefined });
    this.session.add(copy, '複製' + el.label);
    this.view.select(copy.id);
  }

  reorder(id, where) { this.session.reorder(id, where); }

  deleteSelected() {
    const id = this.view.selectedId;
    if (!id) return;
    if (this.view.editingId === id) this.view.editingId = null;
    this.view.selectedId = null;
    this.session.remove(id);
    this.inspector.render();
  }

  async fetchPoster(id) {
    const el = this.session.get(id);
    if (!el || el.poster || !el.youtubeId) return;
    const poster = await fetchYoutubePoster(el.youtubeId);
    const now = this.session.get(id);
    if (poster && now && now.youtubeId === el.youtubeId) this.session.update(id, { poster }, { label: '影片封面', coalesce: 'murl:' + id });
  }

  // ================================================================ 表格

  /** 文字貼紙所在的儲存格（從目前畫面重新偵測，因為表格可能已經變動） */
  _cellOf(el) {
    return this.view.cellAtPoint(el.pageIndex, { x: el.x + 2, y: el.y + el.size * 0.7 });
  }

  /** 表格範圍：沿著儲存格的下框線、右框線往兩端找到底 */
  _tableOf(i, cell) {
    const xs = this.view.ruleExtent(i, (cell.x1 + cell.x2) / 2, cell.y2, true) || [cell.x1, cell.x2];
    const ys = this.view.ruleExtent(i, cell.x2, (cell.y1 + cell.y2) / 2, false) || [cell.y1, cell.y2];
    return { x1: Math.min(xs[0], cell.x1), x2: Math.max(xs[1], cell.x2), y1: Math.min(ys[0], cell.y1), y2: Math.max(ys[1], cell.y2) };
  }

  /** 換一份底稿，並把搬移區裡的貼紙一起移（同一個復原步驟） */
  _replaceBaseMoving(bytes, label, i, area, dx, dy, exceptId) {
    const s = this.session;
    s.replaceBase(bytes, label);
    if (!dx && !dy) return;
    s.elements = s.elements.map(e => (e.pageIndex === i && e.id !== exceptId && area(e.x, e.y)
      ? e.with({ x: e.x + dx, y: e.y + dy, patch: e.patch ? { ...e.patch, x: e.patch.x + dx, y: e.patch.y + dy } : null })
      : e));
    s._emit('elements');
  }

  /** 等表格撐高做完、頁面重新畫好（偵測框線要用畫好的頁面） */
  async _settle(i) {
    for (let k = 0; k < 100 && this._fitting; k++) await new Promise(r => setTimeout(r, 50));
    for (let k = 0; k < 100 && !this.view.shells[i]?.renderedScale; k++) await new Promise(r => setTimeout(r, 50));
  }

  /** 編輯完表格裡的文字：字變長就撐高那一列（下面的內容一起往下移），頁面放不下才縮小字級 */
  async onEndEdit(id) {
    const el = this.session.get(id);
    if (!el || el.kind !== 'text' || !el.inCell || !el.maxW || this._fitting) return;
    const cell = this._cellOf(el);
    if (!cell) return;
    const pad = el.cellPad ?? 4;
    const need = el.y + el.h + pad - cell.y2;
    if (need <= 0.5) return;
    const i = el.pageIndex, g = this.session.pages[i];
    const split = cell.y2 - 1.5;
    this._fitting = true;
    try {
      if (this.view.lowestInk(i, split) + need <= g.height - 18) {
        const bytes = await busy('撐高表格列…', () => growBelow(this.session.baseBytes, g, i, split, need));
        this._replaceBaseMoving(bytes, '撐高表格列', i, (x, y) => y > split, 0, need, id);
        toast('文字變長了，已自動把這一列撐高（可以按「復原」）', 'ok');
      } else {
        let size = el.size;
        while (size > 5) {
          size -= 0.5;
          this.session.update(id, { size }, { label: '縮小字級', coalesce: 'fit:' + id });
          this.view.syncElements();
          const e2 = this.session.get(id);
          if (e2.y + e2.h + pad <= cell.y2 + 0.5) break;
        }
        toast(`頁面下方放不下，已把字級縮小到 ${size} pt`, 'warn');
      }
    } catch (e) {
      console.error(e);
      toast('撐高表格列失敗：' + e.message, 'error');
    } finally { this._fitting = false; }
  }

  /** 「改原文字」時點到表格的空白處：有字就改那一格的字，空白格就在格子裡新增文字 */
  tapBlank(i, p) {
    const cell = this.view.cellAtPoint(i, p);
    if (!cell) return false;
    const lines = (this.view.shells[i].lines || []).filter(l => {
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      return cx > cell.x1 && cx < cell.x2 && cy > cell.y1 && cy < cell.y2;
    });
    if (lines.length) {
      const covered = this.session.elementsOn(i).some(e => e.patch && e.patch.x <= lines[0].x + 1 && e.patch.y <= lines[0].y + 1 && e.patch.x + e.patch.w >= lines[0].x + lines[0].w - 1);
      if (!covered) this.replaceLine(i, lines[0]);
      return true;
    }
    const d = this.textDefaults;
    const el = new TextElement({ pageIndex: i, x: cell.x1 + 4, y: cell.y1 + 3, text: '', font: d.font, size: d.size, color: d.color, maxW: Math.max(d.size * 2, cell.x2 - cell.x1 - 8) });
    el.inCell = true;
    el.cellPad = 3;
    this.session.add(el);
    this.view.justCreatedId = el.id;
    this.view.beginEdit(el.id);
    return true;
  }

  async _cellFor(id) {
    if (this.view.editingId) this.view.endEdit();
    const el0 = this.session.get(id);
    if (!el0) return null;
    await this._settle(el0.pageIndex);
    const el = this.session.get(id);
    const cell = el && this._cellOf(el);
    if (!cell) { toast('找不到這個儲存格', 'warn'); return null; }
    return { el, cell, i: el.pageIndex, g: this.session.pages[el.pageIndex] };
  }

  /** 在這一格下方插入一列 */
  async insertRowFor(id) {
    const r = await this._cellFor(id);
    if (!r) return;
    const { cell, i, g } = r;
    const table = this._tableOf(i, cell), h = cell.y2 - cell.y1, split = cell.y2 - 1.5;
    if (this.view.lowestInk(i, split) + h > g.height - 18) { toast('頁面下方的空間不夠，無法插入新的一列', 'warn'); return; }
    const bytes = await busy('插入表格列…', () => insertRow(this.session.baseBytes, g, i, cell, table, h));
    this._replaceBaseMoving(bytes, '插入表格列', i, (x, y) => y > split, 0, h);
  }

  /** 在這一格右邊插入一欄；右邊沒空間時，從這一欄沒用到的右半邊切出新的一欄 */
  async insertColumnFor(id) {
    const r = await this._cellFor(id);
    if (!r) return;
    const { cell, i, g } = r;
    const table = this._tableOf(i, cell);
    const w = Math.min(cell.x2 - cell.x1, 120), split = cell.x2 - 1.5;
    if (table.x2 + w <= g.width - 18) {
      const bytes = await busy('插入表格欄…', () => insertColumn(this.session.baseBytes, g, i, cell, table, w));
      this._replaceBaseMoving(bytes, '插入表格欄', i, (x, y) => x > split && y >= table.y1 - 2 && y <= table.y2 + 2, w, 0);
      return;
    }
    let right = cell.x1 + 4;
    for (const l of this.view.shells[i].lines || []) {
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      if (cx > cell.x1 && cx < cell.x2 && cy > table.y1 && cy < table.y2) right = Math.max(right, l.x + l.w);
    }
    for (const e of this.session.elementsOn(i)) if (e.kind === 'text' && e.x > cell.x1 - 1 && e.x < cell.x2 && e.y > table.y1 && e.y < table.y2) right = Math.max(right, e.x + e.w);
    const avail = cell.x2 - right - 6;
    if (avail < 30) { toast('這一欄的字已經填滿，右邊也沒有空間，無法插入新的一欄', 'warn'); return; }
    const x = cell.x2 - Math.min(avail, (cell.x2 - cell.x1) / 2);
    const bytes = await busy('插入表格欄…', () => splitColumn(this.session.baseBytes, g, i, x, table));
    this.session.replaceBase(bytes, '插入表格欄');
  }

  /** 合併儲存格：先記住這一格，再點要一起合併的格子 */
  async mergeStart(id) {
    const r = await this._cellFor(id);
    if (!r) return;
    this.mergeFrom = { i: r.i, cell: r.cell };
    this.setTool('edittext');
    toast('點一下要和它合併的儲存格（中間的格子也會一起合併）', 'info', 5000);
  }

  async finishMerge(i, p) {
    const from = this.mergeFrom;
    this.mergeFrom = null;
    const other = this.view.cellAtPoint(i, p);
    if (!from || from.i !== i || !other) { toast('請點同一頁表格裡的儲存格', 'warn'); return; }
    const box = { x1: Math.min(from.cell.x1, other.x1), y1: Math.min(from.cell.y1, other.y1), x2: Math.max(from.cell.x2, other.x2), y2: Math.max(from.cell.y2, other.y2) };
    const bytes = await busy('合併儲存格…', () => mergeCells(this.session.baseBytes, this.session.pages[i], i, box));
    if (!bytes) { toast('這兩格之間沒有可以拿掉的框線', 'warn'); return; }
    this.session.replaceBase(bytes, '合併儲存格');
    toast('已合併儲存格', 'ok');
  }

  /** 插入表格：在點的位置放 rows × cols 的表格，下面的內容往下移 */
  async insertTable(i, p0) {
    const { rows, cols } = this.tableDefaults;
    const g = this.session.pages[i];
    // 點在既有的表格裡：改放到那個表格下面（否則會把舊表格的直線一起拉長）
    const p = { ...p0 };
    for (let k = 0; k < 10; k++) {
      const cell = this.view.cellAtPoint(i, { x: p.x, y: p.y + 6 });
      if (!cell) break;
      const ys = this.view.ruleExtent(i, cell.x1, (cell.y1 + cell.y2) / 2, false);
      if (!ys) break;
      p.y = ys[1] + 8;
    }
    const x0 = Math.max(18, Math.min(p.x, g.width - 18 - 60 * cols));
    const w = g.width - 18 - x0, rowH = 24, H = rows * rowH;
    const low = this.view.lowestInk(i, p.y - 2);
    const push = low > p.y - 2 && low + H + 6 <= g.height - 18;
    const bytes = await busy('插入表格…', () => addTable(this.session.baseBytes, g, i, x0, p.y, w, rows, cols, rowH, push));
    this._replaceBaseMoving(bytes, '插入表格', i, (x, y) => y > p.y - 2, 0, push ? H + 6 : 0);
    if (!push && low > p.y - 2) toast('下方空間不夠，所以沒有把內容往下移', 'warn');
    this.setTool('edittext');
    toast('點表格的格子就可以直接打字', 'ok');
  }

  // ================================================================ 浮水印

  async applyWatermark(spec) {
    try {
      const bytes = await busy('正在加上浮水印…', async () => {
        if (spec.kind === 'text') await fonts.loadHuninn();
        return addWatermark(this.session.baseBytes, this.session.pages, spec);
      });
      this.session.replaceBase(bytes, '加浮水印');
      toast('浮水印已加上，可以按「復原」取消', 'ok');
      this.setTool('select');
    } catch (e) {
      console.error(e);
      toast(e.message, 'error', 6000);
    }
  }

  async removeWatermark(opts) {
    try {
      const { bytes, report } = await busy('正在移除浮水印…', () => removeWatermarks(this.session.baseBytes, opts));
      const n = report.blocks + report.annots + report.images;
      if (!n) { toast('沒有找到符合條件的浮水印', 'warn'); return; }
      this.session.replaceBase(bytes, '去浮水印');
      toast(`已移除 ${n} 處浮水印（${report.pages} 頁）。不滿意可以按「復原」。`, 'ok', 5000);
    } catch (e) {
      console.error(e);
      toast('移除失敗：' + e.message, 'error', 6000);
    }
  }

  // ================================================================ 顏色取樣

  /**
   * 從畫好的頁面取樣顏色。
   * @param {boolean} around true＝取框外一圈（遮蓋用），false＝框內（文字行）
   * @returns {{bg:string, ink:string}|null}
   */
  sampleColor(pageIndex, rect, around = false) {
    const m = around ? 4 : 0;
    const img = this.view.samplePixels(pageIndex, { x: rect.x - m, y: rect.y - m, w: rect.w + m * 2, h: rect.h + m * 2 });
    if (!img) return null;
    const { data, width, height } = img;
    // 背景色＝邊框上最常見的顏色（先分組再取該組平均，白色不會被量化成灰色）
    const buckets = new Map();
    const add = (x, y) => {
      const k = (y * width + x) * 4;
      const key = (data[k] >> 3) + ',' + (data[k + 1] >> 3) + ',' + (data[k + 2] >> 3);
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[k]; b.g += data[k + 1]; b.b += data[k + 2];
      buckets.set(key, b);
    };
    for (let x = 0; x < width; x++) for (const y of new Set([0, 1, height - 2, height - 1])) if (y >= 0 && y < height) add(x, y);
    for (let y = 0; y < height; y++) for (const x of new Set([0, width - 1])) add(x, y);
    let top = null;
    for (const b of buckets.values()) if (!top || b.n > top.n) top = b;
    const bg = top ? [top.r / top.n, top.g / top.n, top.b / top.n].map(Math.round) : [255, 255, 255];
    let ink = [29, 31, 35], far = 0;
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (d > far) { far = d; ink = [data[i], data[i + 1], data[i + 2]]; }
    }
    const hex = (c) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    return { bg: hex(bg), ink: far > 120 ? hex(ink) : '#1d1f23' };
  }

  // ================================================================ 狀態更新（給 view / inspector 呼叫）

  onSelect() { this.inspector.render(); }
  onZoom(z) { this.$('#zoom-label').textContent = Math.round(z * 100) + '%'; }
  onPageChange(i) { const inp = this.$('#page-input'); if (document.activeElement !== inp) inp.value = i + 1; }

  _updateHistory() {
    const s = this.session;
    const u = this.$('#btn-undo'), r = this.$('#btn-redo');
    u.disabled = !s.canUndo; r.disabled = !s.canRedo;
    u.title = s.canUndo ? `復原：${s.undoStack[s.undoStack.length - 1].label}（Ctrl+Z）` : '復原（Ctrl+Z）';
    r.title = s.canRedo ? `重做：${s.redoStack[s.redoStack.length - 1].label}（Ctrl+Y）` : '重做（Ctrl+Y）';
    this.$('#btn-download').disabled = !s.isOpen;
    this._updateTitle();
  }

  _updateTitle() {
    const s = this.session;
    const name = this.$('#doc-name');
    if (!s.isOpen) { name.textContent = ''; document.title = '小柯文件PDF助手'; return; }
    name.textContent = s.fileName;
    name.classList.toggle('dirty', s.dirty);
    name.title = s.dirty ? '有尚未下載的修改' : '';
    document.title = (s.dirty ? '● ' : '') + s.fileName + ' – 小柯文件PDF助手';
  }

  // ================================================================ 鍵盤與拖放

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); this.download(); return; }
      if (mod && k === 'o') { e.preventDefault(); this.openPicker(); return; }
      if (typing) {
        // 在右側欄位裡按 Esc：先離開欄位，接下來的快捷鍵才不會打進欄位
        if (e.key === 'Escape' && e.target.closest('.sidebar')) e.target.blur();
        return;
      }
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.session.redo() : this.session.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); this.session.redo(); return; }
      if (mod && k === 'd') { e.preventDefault(); if (this.view.selectedId) this.duplicate(this.view.selectedId); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); this.view.setZoom(this.view.zoom * 1.2); return; }
      if (mod && k === '-') { e.preventDefault(); this.view.setZoom(this.view.zoom / 1.2); return; }
      if (mod && k === '0') { e.preventDefault(); this.view.fitWidth(); return; }
      if (mod || e.altKey) return;
      const id = this.view.selectedId;
      if ((e.key === 'Delete' || e.key === 'Backspace') && id) { e.preventDefault(); this.deleteSelected(); return; }
      if (e.key === 'Enter' && id) { e.preventDefault(); this.view.beginEdit(id, { selectAll: true }); return; }
      if (e.key === 'Escape') { if (id) this.view.select(null); else this.setTool('select'); return; }
      if (id && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const el = this.session.get(id);
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        this.session.update(id, { x: el.x + d[0], y: el.y + d[1] }, { label: '移動' + el.label, coalesce: 'nudge:' + id });
        return;
      }
      for (const [t, info] of Object.entries(TOOL_INFO)) if (info.key.toLowerCase() === k) { this.setTool(t); return; }
    });
  }

  _bindFileDrop() {
    let depth = 0;
    const hasFile = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFile(e)) return; e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', (e) => { if (!hasFile(e)) return; if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', (e) => { if (hasFile(e)) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth = 0; document.body.classList.remove('dragging');
      const f = [...e.dataTransfer.files][0];
      if (!f) return;
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) { this.openFile(f); return; }
      // 拖進圖片 → 放到目前頁面中央
      if (/^image\//.test(f.type) && this.session.isOpen) {
        const img = await normalizeImage(f);
        const g = this.session.pages[this.view.currentPage || 0];
        const w = Math.min(220, g.width * 0.5);
        const h = (w * img.height) / img.width;
        const el = new ImageElement({ pageIndex: g.index, x: (g.width - w) / 2, y: (g.height - h) / 2, w, h, image: { ...img, url: URL.createObjectURL(new Blob([img.bytes], { type: img.mime })) } });
        this.session.add(el);
        this.view.select(el.id);
        return;
      }
      toast('請拖入 PDF 檔案', 'warn');
    });
  }
}
