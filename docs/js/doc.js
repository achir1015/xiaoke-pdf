// 一份開啟中的文件：快照式歷程（撤銷 / 重做）、繪製用的 pdf.js 文件、自動保存
import { openPdfjs, loadLib, L, baseViewport } from './core.js';
import { idb, uid } from './util.js';

export const K_EDIT = 0, K_ANNOT = 1, K_FORM = 2;
const PF = window.pdfjsLib.PermissionFlag;

export class Doc {
  constructor() {
    this.id = uid();
    this.name = '文件.pdf';
    this.handle = null;          // File System Access API 的檔案代碼（可直接寫回）
    this.steps = [];             // {label, bytes}
    this.pos = 0;
    this.savedPos = 0;
    this.encrypted = false;
    this.openPwd = '';
    this.perms = null;           // pdf.js 權限陣列；null = 沒有限制
    this.owner = true;
    this.encOut = null;          // 儲存時要套用的加密 {user, owner, perms}
    this.broken = false;
    this.repaired = false;
    this.pdf = null;             // pdf.js 文件（目前快照）
    this.pages = [];             // {w, h, rotate, view}
    this.labels = null;
    this.textCache = new Map();
    this.annotCache = new Map();
    this.ocConfig = null;
    this.gen = 0;
    this.view = { page: 0, zoom: 1, mode: 'cont', vrot: 0 };
  }

  static async open(bytes, name, { password, handle } = {}) {
    const d = new Doc();
    d.name = name || '文件.pdf';
    d.handle = handle || null;
    let probe = null;
    try { probe = await L.PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false }); } catch {}
    const pdf = await openPdfjs(bytes, password);       // 密碼錯誤會丟出 needPassword
    let first = bytes;
    if (probe && probe.isEncrypted) {
      d.encrypted = true;
      d.openPwd = password || '';
      d.perms = await pdf.getPermissions();
      const lib = await loadLib(bytes, d.openPwd);
      first = await lib.save();
      d.owner = !d.perms;
      d.encOut = { user: d.owner ? null : d.openPwd, owner: d.owner ? d.openPwd : null, perms: d.perms };
    } else if (!probe) {
      d.broken = true;
    } else {
      // 能開但結構有問題時，用 pdf-lib 重新寫一份（自動修復）
      try { await loadLib(bytes); } catch { d.broken = true; }
    }
    await pdf.destroy();
    d.steps = [{ label: '開啟', bytes: first }];
    d.pos = 0; d.savedPos = handle ? 0 : 0;
    await d.load();
    await d.persist(true);
    return d;
  }

  static async fromBytes(bytes, name) {
    const d = await Doc.open(bytes, name);
    d.savedPos = -1;   // 新文件，還沒存過
    await d.persist(true);
    return d;
  }

  get current() { return this.steps[this.pos].bytes; }
  get dirty() { return this.pos !== this.savedPos; }
  get n() { return this.pages.length; }
  undoLabel() { return this.pos > 0 ? this.steps[this.pos].label : null; }
  redoLabel() { return this.pos + 1 < this.steps.length ? this.steps[this.pos + 1].label : null; }

  /** 重新開啟目前快照給 pdf.js 繪製 */
  async load() {
    if (this.pdf) { try { await this.pdf.destroy(); } catch {} }
    this.pdf = await openPdfjs(this.current);
    this.gen++;
    this.textCache.clear();
    this.annotCache.clear();
    const n = this.pdf.numPages;
    const pages = new Array(n);
    const B = 16;
    for (let i = 0; i < n; i += B) {
      await Promise.all(Array.from({ length: Math.min(B, n - i) }, async (_, k) => {
        const p = await this.pdf.getPage(i + k + 1);
        const vp = baseViewport(p);
        pages[i + k] = { w: vp.width, h: vp.height, rotate: p.rotate, view: p.view };
      }));
    }
    this.pages = pages;
    try { this.labels = await this.pdf.getPageLabels(); } catch { this.labels = null; }
    try { this.ocConfig = await this.pdf.getOptionalContentConfig(); } catch { this.ocConfig = null; }
    if (this.view.page >= n) this.view.page = Math.max(0, n - 1);
  }

  label(i) {
    const l = this.labels && this.labels[i];
    return l && l !== String(i + 1) ? l : null;
  }

  block(kind) {
    if (this.broken) return '這份文件的結構損壞，只能閱讀，無法編輯。';
    if (this.encrypted && !this.owner && this.perms) {
      const p = this.perms;
      const ok = kind === K_ANNOT ? p.includes(PF.MODIFY_ANNOTATIONS) || p.includes(PF.MODIFY_CONTENTS)
        : kind === K_FORM ? p.includes(PF.FILL_INTERACTIVE_FORMS) || p.includes(PF.MODIFY_CONTENTS)
          : p.includes(PF.MODIFY_CONTENTS);
      if (!ok) return '作者限制了這份文件的修改權限。輸入擁有者密碼即可解除限制（文件屬性 → 安全性）。';
    }
    return null;
  }
  canCopy() { return !this.perms || this.owner || this.perms.includes(PF.COPY); }
  canPrint() { return !this.perms || this.owner || this.perms.includes(PF.PRINT); }

  /** 套用一個編輯：fn(pdfLibDocument) */
  async apply(label, kind, fn) {
    const b = this.block(kind);
    if (b) throw new Error(b);
    const lib = await loadLib(this.current);
    const r = await fn(lib);
    const bytes = await lib.save();
    await this.push(label, bytes);
    return r;
  }

  async applyBytes(label, bytes) { await this.push(label, bytes); }

  async push(label, bytes) {
    this.steps.splice(this.pos + 1);
    if (this.savedPos > this.pos) this.savedPos = -1;
    this.steps.push({ label, bytes });
    this.pos = this.steps.length - 1;
    await this.load();
    await this.persist();
  }

  async undo() { if (this.pos === 0) return false; this.pos--; await this.load(); await this.persist(); return true; }
  async redo() { if (this.pos + 1 >= this.steps.length) return false; this.pos++; await this.load(); await this.persist(); return true; }

  /** 顯示座標的文字：[{str, x, y, w, h, size, chars:[{c,x,w}]}]，按閱讀順序 */
  async text(i) {
    if (this.textCache.has(i)) return this.textCache.get(i);
    const page = await this.pdf.getPage(i + 1);
    const vp = baseViewport(page);
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str) { if (it.hasEOL && items.length) items[items.length - 1].eol = true; continue; }
      const tx = window.pdfjsLib.Util.transform(vp.transform, it.transform);
      const size = Math.hypot(tx[2], tx[3]);
      const angle = Math.atan2(tx[1], tx[0]);
      const w = it.width * vp.scale, h = Math.max(size, it.height || 0);
      const vertical = Math.abs(angle) > 0.7;
      const x = tx[4], y = tx[5] - size;
      items.push({ str: it.str, x, y: y - size * 0.15, w: vertical ? size : w, h: vertical ? w : size * 1.3, size, eol: it.hasEOL, font: it.fontName, vertical });
    }
    this.textCache.set(i, items);
    return items;
  }

  async annots(i) {
    if (this.annotCache.has(i)) return this.annotCache.get(i);
    const page = await this.pdf.getPage(i + 1);
    let a = [];
    try { a = await page.getAnnotations({ intent: 'display' }); } catch {}
    this.annotCache.set(i, a);
    return a;
  }

  /** 產生要寫出的 bytes（必要時加密） */
  async output() {
    if (!this.encOut || this.broken) return this.current;
    const lib = await loadLib(this.current);
    const o = this.encOut;
    const permissions = permsToLib(o.perms);
    lib.encrypt({ userPassword: o.user || '', ownerPassword: o.owner || o.user || '', permissions });
    return await lib.save();
  }

  // ---------------------------------------------------------------- 自動保存（IndexedDB）

  async persist(all = false) {
    try {
      const meta = { id: this.id, name: this.name, pos: this.pos, savedPos: this.savedPos, count: this.steps.length,
        labels: this.steps.map(s => s.label), encrypted: this.encrypted, broken: this.broken, page: this.view.page,
        time: Date.now(), order: this.order ?? 999 };
      for (let i = 0; i < this.steps.length; i++) {
        if (all || !this.steps[i].stored) { await idb.set('blobs', this.id + ':' + i, this.steps[i].bytes); this.steps[i].stored = true; }
      }
      await idb.set('sessions', this.id, meta);
    } catch (e) { console.warn('autosave', e); }
  }

  static async recover() {
    const out = [];
    for (const id of await idb.keys('sessions')) {
      try {
        const m = await idb.get('sessions', id);
        const d = new Doc();
        d.id = id; d.name = m.name; d.pos = m.pos; d.savedPos = m.savedPos; d.encrypted = m.encrypted; d.broken = m.broken;
        d.order = m.order; d.view.page = m.page || 0;
        for (let i = 0; i < m.count; i++) {
          const b = await idb.get('blobs', id + ':' + i);
          if (!b) break;
          d.steps.push({ label: m.labels[i], bytes: b, stored: true });
        }
        if (!d.steps.length) throw new Error('empty');
        d.pos = Math.min(d.pos, d.steps.length - 1);
        await d.load();
        out.push(d);
      } catch (e) { console.warn('recover', e); await Doc.forget(id); }
    }
    return out.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  static async forget(id) {
    const m = await idb.get('sessions', id).catch(() => null);
    await idb.del('sessions', id);
    for (let i = 0; i < ((m && m.count) || 200); i++) await idb.del('blobs', id + ':' + i);
  }

  async discard() {
    try { if (this.pdf) await this.pdf.destroy(); } catch {}
    await Doc.forget(this.id);
  }
}

/** pdf.js 權限陣列 → pdf-lib encrypt 的 permissions */
export function permsToLib(p) {
  if (!p) return { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true };
  return {
    printing: p.includes(PF.PRINT_HIGH_QUALITY) ? 'highResolution' : p.includes(PF.PRINT) ? 'lowResolution' : false,
    modifying: p.includes(PF.MODIFY_CONTENTS), copying: p.includes(PF.COPY), annotating: p.includes(PF.MODIFY_ANNOTATIONS),
    fillingForms: p.includes(PF.FILL_INTERACTIVE_FORMS), contentAccessibility: p.includes(PF.COPY_FOR_ACCESSIBILITY),
    documentAssembly: p.includes(PF.ASSEMBLE),
  };
}
export { PF };
