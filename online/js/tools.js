// 工具目錄、指令面板，以及每個工具的流程
import { el, sheet, choose, prompt, form, confirmBox, alertBox, ask, toast, run, busy, size, download, shareOrDownload, pickFiles,
  parsePages, specOf, base, safeName, prefs, today, now, idb } from './util.js';
import { loadLib, L, openPdfjs, huninn, latin1 } from './core.js';
import * as ops from './ops.js';
import { recognize, guessDirection, OCR_SCALE } from './ocr.js';
import { removeWatermarks, layerNames } from './watermark.js';
import * as sig from './sign.js';
import { K_EDIT, K_ANNOT, K_FORM } from './doc.js';
import { textDialog, loadStyle, saveStyle, textPng, stampPng, signPad, sigLook, dataUrlPng, PALETTE } from './style.js';
import { thumbGrid, fields as fieldsPanel, bookmarks, properties, attachments, layers, comments, paper } from './panels.js';

export const TOOLS = [
  ['export', '匯出 PDF', '轉成圖片・純文字・Word', '⇪', '#1E88E5', null, 'export png jpg image text word docx 圖片 文字 轉檔'],
  ['fillsign', '填寫與簽署', '填表單・手寫簽名・日期・勾選', '✍', '#8E24AA', null, 'fill sign signature 簽名 表單 日期'],
  ['edit', '編輯 PDF', '編輯文字・新增文字・圖片・連結・浮水印・頁碼・裁切', '✎', '#D81B60', null, 'edit text image link watermark 編輯文字 修改文字 頁碼 浮水印 頁首 頁尾 裁切'],
  ['create', '建立 PDF', '圖片轉 PDF・空白文件・文字・相機', '＋', '#E53935', null, 'create new image photo blank camera 新增 圖片 空白 相機'],
  ['combine', '合併檔案', '多個 PDF 合成一份，每份一個書籤', '⧉', '#1E63E9', null, 'merge combine 合併'],
  ['organize', '整理頁面', '頁面格狀・旋轉・刪除・插入・移動', '▦', '#43A047', null, 'organize pages rotate delete insert move 旋轉 刪除 插入 移動 頁面'],
  ['split', '分割與擷取', '擷取頁面・每 N 頁分割・指定頁前分割', '✂', '#00897B', null, 'split extract 分割 擷取'],
  ['comment', '新增註解', '便利貼・螢光標示・底線・圖形・手繪', '💬', '#FB8C00', null, 'comment annotate highlight note 註解 螢光 便利貼 手繪'],
  ['scan', '掃描與 OCR', '用相機掃描文件成 PDF', '⌗', '#43A047', 'OCR 文字辨識：找出掃描檔、外框文字的字再修改', 'scan camera ocr 掃描 相機 辨識'],
  ['protect', '保護 PDF', '密碼保護・權限・移除隱藏資訊', '🛡', '#1E63E9', null, 'protect password encrypt security 密碼 加密 權限 安全'],
  ['redact', '塗銷 PDF', '框選或搜尋後永久移除內容', '▬', '#E53935', null, 'redact 塗銷 遮蔽 隱私'],
  ['compress', '壓縮 PDF', '縮小圖片，讓檔案變小', '⇲', '#E53935', null, 'compress reduce size 壓縮 縮小'],
  ['form', '準備表單', '新增文字欄位・核取方塊・下拉選單・簽名欄位', '☐', '#8E24AA', null, 'form field 表單 欄位'],
  ['stamp', '加上印章', '核准・機密・草稿…或自訂文字、圖片', '⎔', '#8E24AA', null, 'stamp 印章 核准'],
  ['cert', '使用憑證', '數位簽署・驗證簽章・自簽憑證', '✔', '#00897B', null, 'certificate digital signature verify 憑證 數位簽章 驗證'],
  ['print', '印刷製作', '列印・頁面方塊・灰階・點陣化', '⎙', '#1E63E9', null, 'print 列印 灰階'],
  ['measure', '測量物件', '距離・面積・比例尺', '📏', '#D81B60', null, 'measure distance area 測量 距離 面積'],
  ['compare', '比較檔案', '逐頁找出兩份文件的文字差異', '⇄', '#8E24AA', null, 'compare diff 比較 差異'],
  ['guided', '引導式動作', '一鍵完成發佈前清理、封存等多個步驟', '☰', '#1E63E9', null, 'guided action wizard 引導 批次'],
  ['access', '無障礙準備', '檢查並修正標題、語言等設定', '♿', '#8E24AA', null, 'accessibility 無障礙'],
  ['unwatermark', '移除浮水印', '移除標準浮水印、指定文字或浮水印圖層', '⌫', '#E53935', null, 'remove watermark 移除 去除 浮水印'],
  ['properties', '文件屬性', '標題・作者・字型・頁面大小・安全性', 'ⓘ', '#6B7078', null, 'properties info metadata 屬性 資訊 字型'],
  ['bookmarks', '書籤', '瀏覽、搜尋、新增與編輯書籤', '🔖', '#FB8C00', null, 'bookmark outline 書籤 目錄'],
  ['labels', '頁面標籤', 'i、ii、1、2… 自訂頁碼樣式', '#', '#00897B', null, 'page labels 頁碼 標籤'],
  ['attachments', '附件', '開啟、下載、加入、移除附件', '📎', '#6B7078', null, 'attachment 附件'],
  ['layers', '圖層', '切換選用內容的顯示', '◫', '#6B7078', null, 'layers ocg 圖層'],
].map(([id, name, desc, icon, color, status, keys]) => ({ id, name, desc, icon, color, status, keys }));
export const byId = id => TOOLS.find(t => t.id === id);

export class Tools {
  constructor(app) { this.app = app; }
  get d() { return this.app.doc; }
  need() {
    if (this.d) return true;
    ask('需要文件', '這個工具要先開啟一份 PDF。', ['取消', '開啟檔案']).then(i => { if (i === 1) this.app.pickPdf(); });
    return false;
  }

  run(id) {
    const noDoc = { create: 1, combine: 1, cert: 1, scan: 1 };
    if (!noDoc[id] && !this.need()) return;
    const f = {
      export: () => this.export(), fillsign: () => this.fillSign(), edit: () => this.app.editMode(), create: () => this.create(), combine: () => this.combine(),
      organize: () => this.organize(), split: () => this.split(), comment: () => this.app.commentMode(), scan: () => this.scan(), protect: () => this.protect(),
      redact: () => this.redact(), compress: () => this.compress(), form: () => this.prepareForm(), stamp: () => this.stamp(), cert: () => this.cert(),
      print: () => this.printTool(), measure: () => this.measure(), compare: () => this.compare(), guided: () => this.guided(), access: () => this.access(),
      unwatermark: () => this.removeWatermark(), properties: () => properties(this.app), bookmarks: () => bookmarks(this.app), labels: () => this.labels(),
      attachments: () => attachments(this.app), layers: () => layers(this.app),
    }[id];
    f && f();
  }

  catalog() {
    const s = sheet('所有工具', { height: '86vh' });
    s.body.append(el('button.search-tools', { text: '⌕  尋找工具與指令（Ctrl+K）', style: { margin: '12px 16px 6px', width: 'calc(100% - 32px)' }, onclick: () => { s.close(); this.palette(); } }));
    for (const t of TOOLS) s.body.append(el('div.row', { onclick: () => { s.close(); this.run(t.id); } },
      el('span', { text: t.icon, style: { color: t.color, width: '28px', textAlign: 'center', fontSize: '19px' } }),
      el('div.tx', el('div.t1', { text: t.name }), el('div.t2', { text: t.status ? `${t.desc}｜${t.status}` : t.desc }))));
  }

  palette() {
    const a = this.app, v = a.viewer;
    const cmds = TOOLS.map(t => ({ n: `${t.icon}  ${t.name}`, k: t.desc + ' ' + t.keys, f: () => this.run(t.id) }));
    const ex = [
      ['開啟檔案', 'open 開啟', 0, () => a.pickPdf()], ['儲存', 'save 儲存 下載', 1, () => a.save()], ['另存新檔', 'save as 另存', 1, () => a.saveAs()],
      ['搜尋文件', 'find search 搜尋 尋找', 1, () => a.openSearch()], ['復原', 'undo 復原 撤銷', 1, () => a.undo()], ['重做', 'redo 重做', 1, () => a.redo()],
      ['前往頁面', 'go to page 前往 跳頁', 1, () => a.askPage()], ['檢視：連續捲動', 'continuous 連續', 1, () => v.setMode('cont')],
      ['檢視：單頁', 'single 單頁', 1, () => v.setMode('single')], ['檢視：雙頁', 'two page 雙頁', 1, () => v.setMode('two')],
      ['檢視：向右旋轉', 'rotate view 旋轉檢視', 1, () => v.rotateView(1)], ['檢視：向左旋轉', 'rotate view 旋轉檢視', 1, () => v.rotateView(-1)],
      ['全螢幕閱讀', 'fullscreen 全螢幕 無干擾', 1, () => a.fullscreen(true)], ['夜間頁面（反白）', 'night invert 夜間', 1, () => a.toggleLook('night')],
      ['護眼色', 'sepia 護眼', 1, () => a.toggleLook('sepia')], ['主題：深色', 'dark 深色 主題', 0, () => a.setTheme('dark')],
      ['主題：淺色', 'light 淺色 主題', 0, () => a.setTheme('light')], ['主題：跟隨系統', 'system 主題', 0, () => a.setTheme('system')],
      ['頁面縮圖', 'thumbnails 縮圖', 1, () => a.panel('thumbs')], ['註解清單', 'comments 註解', 1, () => comments(a)], ['表單欄位清單', 'fields 表單 欄位', 1, () => fieldsPanel(a)],
      ['分享', 'share 分享', 1, () => a.share()], ['列印', 'print 列印', 1, () => this.print()], ['關閉分頁', 'close tab 關閉', 1, () => a.closeTab(a.cur)],
      ['重新開啟上次關閉的分頁', 'reopen 重新開啟', 0, () => a.reopenClosed()], ['設定', 'settings 設定 作者', 0, () => this.settings()],
      ['檢查更新', 'update 更新 新版 版本', 0, () => a.updater.check(true)], ['安裝到主畫面 / 建立捷徑', 'install shortcut 捷徑 安裝 主畫面', 0, () => a.installApp()],
    ];
    for (const [n, k, needDoc, f] of ex) cmds.push({ n, k, needDoc, f });
    const s = sheet('尋找工具與指令', { height: '86vh' });
    const q = el('input', { placeholder: '輸入關鍵字，例如：旋轉、簽名、壓縮', type: 'search' });
    s.body.append(el('div', { style: { padding: '10px 14px' } }, q));
    const list = el('div');
    s.body.append(list);
    const draw = () => {
      list.innerHTML = '';
      const f = q.value.trim().toLowerCase();
      for (const c of cmds) {
        if (f && !c.n.toLowerCase().includes(f) && !c.k.toLowerCase().includes(f)) continue;
        const off = c.needDoc && !a.doc;
        const r = el('div.row', { onclick: () => { if (off) return toast('請先開啟文件'); s.close(); c.f(); } }, el('div.tx', el('div.t1', { text: c.n }), off ? el('div.t2', { text: '需要先開啟文件' }) : null));
        if (off) r.style.opacity = .5;
        list.append(r);
      }
    };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') list.firstChild && list.firstChild.click(); });
    draw();
    setTimeout(() => q.focus(), 60);
  }

  // ================================================================ 放置（框選或點一下）

  place(hint, aspect, defW, sticky, cb) {
    const a = this.app, d = this.d;
    const done = (page, r) => {
      const p = d.pages[page];
      r.x = Math.max(0, Math.min(r.x, p.w - r.w)); r.y = Math.max(0, Math.min(r.y, p.h - r.h));
      if (!sticky) a.exitModes();
      cb(page, r);
    };
    const fit = r => { let w = r.w, h = r.h; if (w / h > aspect) w = h * aspect; else h = w / aspect; return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }; };
    a.setMode({ hint, tool: { type: 'rect', color: '#1E63E9',
      onRect: (page, r) => done(page, aspect > 0 ? fit(r) : r),
      onTap: (page, x, y) => { const w = defW, h = aspect > 0 ? defW / aspect : defW * 0.35; done(page, { x: x - w / 2, y: y - h / 2, w, h }); } } });
  }

  // ================================================================ 匯出

  async export() {
    const d = this.d;
    if (!d.canCopy()) return alertBox('無法匯出', '作者不允許擷取這份文件的內容。');
    const i = await choose('匯出 PDF', ['圖片（PNG，打包成 ZIP）', '圖片（JPG，打包成 ZIP）', '純文字（.txt）', 'Word 文件（.docx，文字內容）', 'PDF 副本']);
    if (i < 0) return;
    if (i <= 1) {
      const k = await choose('解析度', ['72 DPI（螢幕）', '150 DPI（一般）', '300 DPI（印刷）']);
      if (k < 0) return;
      const spec = await prompt('要匯出哪些頁？', '例如 1,3,5-8；留白＝全部', '');
      if (spec == null) return;
      const pages = spec.trim() ? parsePages(spec, d.n) : [...Array(d.n).keys()];
      const dpi = [72, 150, 300][k], png = i === 0;
      await run('匯出圖片…', async () => {
        const zip = new window.JSZip();
        for (const p of pages) {
          const page = await d.pdf.getPage(p + 1);
          const vp = page.getViewport({ scale: dpi / 72 });
          const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.92));
          zip.file(`${base(d.name)}_第${String(p + 1).padStart(3, '0')}頁.${png ? 'png' : 'jpg'}`, blob);
          c.width = c.height = 0;
        }
        download(await zip.generateAsync({ type: 'blob' }), `${base(d.name)}_圖片.zip`, 'application/zip');
      });
    } else if (i === 2 || i === 3) {
      await run('擷取文字…', async () => {
        const pages = [];
        for (let p = 0; p < d.n; p++) pages.push(await pageText(d, p));
        if (i === 2) download(new Blob([pages.join('\n\f\n')], { type: 'text/plain;charset=utf-8' }), base(d.name) + '.txt');
        else download(await docx(pages), base(d.name) + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      });
    } else {
      const bytes = await run('準備檔案…', () => d.output());
      download(bytes, base(d.name) + '_副本.pdf');
    }
  }

  // ================================================================ 填寫與簽署

  async fillSign() {
    const a = this.app, d = this.d;
    const i = await choose('填寫與簽署', ['填寫表單欄位', '手寫簽名', '使用已存的簽名', '加入文字', '加入今天日期', '打勾 ✓', '打叉 ✗', '畫圓點 ●', '加入姓名縮寫']);
    if (i === 0) { a.viewer.showFields = true; await fieldsPanel(a); }
    else if (i === 1) { const r = await signPad(); if (r) this.placeSignature(r); }
    else if (i === 2) this.savedSignatures();
    else if (i === 3) this.place('拖曳出文字的位置（或點一下）', 0, 160, false, (p, r) => this.freeText(p, r));
    else if (i === 4) this.placeText(today(), 11);
    else if (i === 5) this.placeText('✓', 18);
    else if (i === 6) this.placeText('✗', 18);
    else if (i === 7) this.placeText('●', 12);
    else if (i === 8) { const t = await prompt('姓名縮寫', '例如 K.W.', prefs.get('initials', '')); if (t) { prefs.set('initials', t); this.placeText(t, 14); } }
  }

  async placeText(text, size) {
    const st = { size, color: '#10204A' };
    const img = await textPng(text, st);
    this.place(`點一下要放「${text}」的位置`, img.w / img.h, img.w, true, (p, r) =>
      this.app.edit('加入文字', K_FORM, lib => ops.addFreeText(lib, p, r, text, st, img.png)));
  }

  placeSignature(img) {
    this.place('拖曳出簽名的位置與大小（或點一下）', img.w / img.h, 140, false, (p, r) =>
      this.app.edit('加入簽名', K_FORM, lib => ops.addStamp(lib, p, r, img.png, 'Signature', '簽名')));
  }

  async savedSignatures() {
    const list = prefs.get('signatures', []);
    if (!list.length) { toast('還沒有儲存的簽名'); const r = await signPad(); if (r) this.placeSignature(r); return; }
    const s = sheet('我的簽名', { height: '60vh' });
    list.forEach((u, k) => {
      const img = el('img', { src: u, style: { maxWidth: '100%', maxHeight: '100px', background: '#fff', border: '1px solid var(--line)', borderRadius: '8px', padding: '8px', display: 'block', margin: '10px 16px', cursor: 'pointer' } });
      img.addEventListener('click', async () => { s.close(); this.placeSignature(await dataUrlPng(u)); });
      img.addEventListener('contextmenu', async e => { e.preventDefault(); if (await confirmBox('刪除簽名', '刪除這個已儲存的簽名？', '刪除', true)) { list.splice(k, 1); prefs.set('signatures', list); s.close(); this.savedSignatures(); } });
      s.body.append(img);
    });
    s.body.append(el('button.btn', { text: '＋ 新增簽名', style: { margin: '6px 10px' }, onclick: async () => { s.close(); const r = await signPad(); if (r) this.placeSignature(r); } }));
  }

  async signInRect(page, r) {
    const img = await signPad();
    if (!img) return;
    if (page < 0 || !r) return this.placeSignature(img);
    const k = img.w / img.h;
    let w = r.w, h = r.h; if (w / h > k) w = h * k; else h = w / k;
    const rr = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
    this.app.edit('加入簽名', K_FORM, lib => ops.addStamp(lib, page, rr, img.png, 'Signature', '簽名'));
  }

  async freeText(page, r) {
    const res = await textDialog('文字框', { style: loadStyle('ft') });
    if (!res || !res.text.trim()) return;
    saveStyle('ft', res.style);
    const img = await textPng(res.text, res.style, r.w);
    const rr = { x: r.x, y: r.y, w: Math.max(r.w, img.w), h: Math.max(r.h, img.h) };
    const full = await padPng(img, rr);
    this.app.edit('新增文字框', K_ANNOT, lib => ops.addFreeText(lib, page, rr, res.text, res.style, full));
  }

  // ================================================================ 編輯

  async addTextAt(page, r) {
    const res = await textDialog('新增文字', { style: loadStyle('add') });
    if (!res || !res.text.trim()) return;
    saveStyle('add', res.style);
    this.app.edit('新增文字', K_EDIT, lib => ops.addText(lib, page, r, res.text, res.style));
  }

  /** 點一下頁面上的文字 → 修改那一行 */
  async editLineAt(page, x, y) {
    const items = await this.d.text(page);
    let best = null, bd = 14 * 14;
    for (const it of items) {
      const cx = Math.max(it.x, Math.min(x, it.x + it.w)), cy = Math.max(it.y, Math.min(y, it.y + it.h));
      const dd = (cx - x) ** 2 + (cy - y) ** 2;
      if (dd < bd) { bd = dd; best = it; if (dd === 0) break; }
    }
    if (!best) return toast('這裡沒有可編輯的文字（掃描的影像無法編輯文字）');
    // 同一行的所有片段
    const line = items.filter(it => !it.vertical && Math.abs((it.y + it.h / 2) - (best.y + best.h / 2)) < best.h * 0.5);
    line.sort((a, b) => a.x - b.x);
    const area = line.reduce((u, it) => ({ x: Math.min(u.x, it.x), y: Math.min(u.y, it.y), r: Math.max(u.r, it.x + it.w), b: Math.max(u.b, it.y + it.h) }), { x: 1e9, y: 1e9, r: -1e9, b: -1e9 });
    let text = '';
    line.forEach((it, k) => { if (k && it.x - (line[k - 1].x + line[k - 1].w) > it.size * 0.25 && !/\s$/.test(text)) text += ' '; text += it.str; });
    this.editRange(page, { x: area.x, y: area.y, w: area.r - area.x, h: area.b - area.y }, text.trim(), Math.max(...line.map(i => i.size)));
  }

  async editRange(page, area, old, sizePt) {
    const b = this.d.block(K_EDIT);
    if (b) return this.app.blocked(b);
    this.app.viewer.flash(page, area);
    const st = loadStyle('edit'); st.size = Math.round(sizePt * 10) / 10 || 12; st.bg = null;
    const res = await textDialog('編輯文字', { original: old, text: old, style: st });
    if (!res) return;
    saveStyle('edit', res.style);
    const bg = await this.sampleBg(page, area);
    this.app.edit('編輯文字', K_EDIT, lib => ops.replaceText(lib, page, area, res.text, res.style, bg));
  }

  /** 取樣文字周圍的背景色（讀畫面上已繪製的頁面，不重新繪製） */
  async sampleBg(page, r) { return this.app.inline.sampleColors(page, r).bg; }

  async addImage() {
    const [f] = await pickFiles('image/*');
    if (!f) return;
    const png = await imageToPng(f, 2000);
    this.place('拖曳出圖片的位置與大小（或點一下）', png.w / png.h, 200, false, (p, r) => this.app.edit('新增圖片', K_EDIT, lib => ops.addImage(lib, p, r, png.png)));
  }

  addLink() {
    this.place('框選要變成連結的區域', 0, 120, false, async (p, r) => {
      const k = await choose('連結到', ['網址', '文件中的頁面']);
      if (k === 0) { const u = await prompt('網址', 'https://', 'https://'); if (u) this.app.edit('新增連結', K_EDIT, lib => ops.addLink(lib, p, r, u, -1)); }
      else if (k === 1) { const t = await prompt('連到第幾頁', `1–${this.d.n}`, '1'); const n = parseInt(t); if (n) this.app.edit('新增連結', K_EDIT, lib => ops.addLink(lib, p, r, null, Math.max(0, Math.min(this.d.n - 1, n - 1)))); }
    });
  }

  async watermark() {
    const d = this.d;
    const r = await form('加入浮水印', [{ key: 't', label: '浮水印文字', value: '機密' }, { key: 's', label: '字級（pt）', value: 60, type: 'number' },
      { key: 'o', label: '不透明度（%）', value: 20, type: 'number' }, { key: 'p', label: '頁面（留白＝全部）', value: '' }], '加入');
    if (!r || !r.t) return;
    const pages = r.p.trim() ? parsePages(r.p, d.n) : [...Array(d.n).keys()];
    this.app.edit('加入浮水印', K_EDIT, lib => ops.stampText(lib, pages, r.t, 6, r.s || 60, '#888888', Math.max(0.05, Math.min(1, (r.o || 20) / 100)), d.labels, d.name));
  }

  async headerFooter() {
    const d = this.d;
    const r = await form('頁首、頁尾與頁碼', [{ key: 't', label: '內容（{n} 頁碼、{N} 總頁數、{label} 頁面標籤、{date} 日期、{file} 檔名）', value: '第 {n} 頁，共 {N} 頁' },
      { key: 'pos', label: '位置', type: 'select', options: ['左上', '中上', '右上', '左下', '中下', '右下'], value: 4 },
      { key: 's', label: '字級（pt）', value: 10, type: 'number' }, { key: 'p', label: '頁面（留白＝全部）', value: '' }], '加入');
    if (!r || !r.t) return;
    const pages = r.p.trim() ? parsePages(r.p, d.n) : [...Array(d.n).keys()];
    this.app.edit('加入頁首頁尾', K_EDIT, lib => ops.stampText(lib, pages, r.t, r.pos, r.s || 10, '#333333', 1, d.labels, d.name));
  }

  async crop(pages) {
    const d = this.d;
    const r = await form('裁切頁面（從各邊裁掉的公釐）', [{ key: 't', label: '上', value: 10, type: 'number' }, { key: 'b', label: '下', value: 10, type: 'number' },
      { key: 'l', label: '左', value: 10, type: 'number' }, { key: 'r', label: '右', value: 10, type: 'number' },
      { key: 'p', label: '頁面（留白＝目前頁面）', value: pages ? specOf(pages) : '' }], '裁切');
    if (!r) return;
    const ps = r.p.trim() ? parsePages(r.p, d.n) : [d.view.page];
    const k = 72 / 25.4;
    this.app.edit('裁切頁面', K_EDIT, lib => ops.crop(lib, ps, (r.l || 0) * k, (r.t || 0) * k, (r.r || 0) * k, (r.b || 0) * k));
  }

  async labels() {
    if (!this.need()) return;
    const d = this.d;
    const r = await form('頁面標籤', [{ key: 'start', label: '從第幾頁開始（實際頁碼）', value: d.view.page + 1, type: 'number' },
      { key: 'style', label: '樣式', type: 'select', options: ['1, 2, 3', 'i, ii, iii', 'I, II, III', 'a, b, c', 'A, B, C', '無（只有前綴）'], value: 0 },
      { key: 'prefix', label: '前綴（例如「附錄-」）', value: '' }, { key: 'first', label: '起始數字', value: 1, type: 'number' },
      { key: 'clear', label: '改為移除所有頁面標籤', type: 'check', value: false }],
      '套用', `目前：${d.labels ? `第 1 頁標為「${d.labels[0]}」` : '沒有頁面標籤'}`);
    if (!r) return;
    if (r.clear) return this.app.edit('移除頁面標籤', K_EDIT, ops.clearLabels);
    const sp = (r.start || 1) - 1;
    if (sp < 0 || sp >= d.n) return toast('頁碼超出範圍');
    this.app.edit('設定頁面標籤', K_EDIT, lib => ops.setLabel(lib, sp, ['D', 'r', 'R', 'a', 'A', null][r.style], r.prefix, r.first || 1));
  }

  async removeWatermark() {
    const d = this.d;
    const b = d.block(K_EDIT);
    if (b) return this.app.blocked(b);
    const names = await run(null, async () => layerNames(await loadLib(d.current)));
    const fields = [{ key: 'std', label: '標準浮水印（Acrobat 或本 App 加入、標記為浮水印的內容與浮水印註解）', type: 'check', value: true },
      { key: 'text', label: '依文字移除：輸入浮水印上的文字（可留白）', value: '' }];
    if (names.length) { fields.push({ type: 'note', label: '依圖層移除（連同圖層上的內容）：' }); names.forEach((n, k) => fields.push({ key: 'L' + k, label: n, type: 'check', value: /watermark|浮水印/i.test(n) })); }
    const r = await form('移除浮水印', fields, '移除', '只用在你有權修改的文件上。若浮水印與頁面內容合成在同一張圖片裡（例如掃描檔），無法移除。可以用「復原」還原。');
    if (!r) return;
    const o = { standard: r.std, text: r.text.trim(), layers: new Set(names.filter((n, k) => r['L' + k])) };
    if (!o.standard && !o.text && !o.layers.size) return toast('請至少選一種移除方式');
    const rep = await this.app.edit('移除浮水印', K_EDIT, lib => removeWatermarks(lib, o));
    if (!rep) return;
    if (rep.blocks + rep.annots === 0 && !o.layers.size) alertBox('找不到浮水印', '沒有找到符合條件的浮水印（可以按復原）。\n\n如果浮水印是文字，試試在「依文字移除」輸入浮水印上的字。');
    else alertBox('已移除浮水印', `在 ${rep.pages} 頁移除了 ${rep.blocks} 段內容${rep.annots ? `、${rep.annots} 個浮水印註解` : ''}${o.layers.size ? `，並移除 ${o.layers.size} 個圖層` : ''}。\n可以按「復原」還原。`);
  }

  // ================================================================ 整理頁面

  organize() {
    if (!this.need()) return;
    const a = this.app;
    const sel = new Set();
    let anchor = -1;
    const box = el('div.fullsheet');
    const title = el('div.title', { style: { flex: 1, fontWeight: 700, fontSize: '17px' } });
    const close = () => { box.remove(); a.onOrganizerClose = null; };
    const top = el('div.toolbar', el('button.ib', { text: '✕', title: '關閉', onclick: close }), title,
      el('button.ib', { text: '↶', title: '復原', onclick: () => a.undo() }), el('button.ib', { text: '↷', title: '重做', onclick: () => a.redo() }),
      el('button.ib', { text: '💾', title: '儲存', onclick: () => a.save() }));
    const body = el('div.bd');
    const withSel = f => () => { if (!sel.size) return toast('先點選要處理的頁面'); f([...sel].sort((x, y) => x - y)); };
    const ed = (label, fn, after) => a.edit(label, K_EDIT, fn).then(r => { after && after(r); });
    const tb = (t, f) => el('button', { text: t, onclick: f });
    const tools = el('div.org-tools',
      tb('全選', () => { if (sel.size === a.doc.n) sel.clear(); else for (let i = 0; i < a.doc.n; i++) sel.add(i); draw(); }),
      tb('↺ 左轉', withSel(s => ed('旋轉頁面', lib => ops.rotate(lib, s, -90)))), tb('↻ 右轉', withSel(s => ed('旋轉頁面', lib => ops.rotate(lib, s, 90)))),
      tb('刪除', withSel(async s => { if (await confirmBox('刪除頁面', `刪除選取的 ${s.length} 頁？（可以復原）`, '刪除', true)) { sel.clear(); ed('刪除頁面', lib => ops.removePages(lib, s)); } })),
      tb('插入空白頁', async () => {
        const at = sel.size ? Math.max(...sel) + 1 : a.doc.n;
        const k = await choose(`插入空白頁（第 ${at} 頁之後）`, ['與相鄰頁面相同', 'A4 直向', 'A4 橫向', 'Letter', 'A5']);
        if (k < 0) return;
        const ref = a.doc.pages[Math.max(0, Math.min(at - 1, a.doc.n - 1))];
        const sz = [[ref.w, ref.h], [595.28, 841.89], [841.89, 595.28], [612, 792], [419.53, 595.28]][k];
        ed('插入空白頁', lib => ops.insertBlank(lib, at, sz[0], sz[1]));
      }),
      tb('從檔案插入', async () => {
        const [f] = await pickFiles('application/pdf');
        if (!f) return;
        const at = sel.size ? Math.max(...sel) + 1 : a.doc.n;
        const bytes = new Uint8Array(await f.arrayBuffer());
        const spec = await prompt(`要插入「${f.name}」的哪些頁？`, '例如 1,3,5-8；留白＝全部', '');
        if (spec == null) return;
        let pw;
        for (let tries = 0; tries < 3; tries++) {
          try { await loadLib(bytes, pw); break; } catch (e) { pw = await prompt(`「${f.name}」需要密碼`, '密碼', '', 'password'); if (pw == null) return; }
        }
        const pick = spec.trim() ? parsePages(spec, 100000) : null;
        ed('從檔案插入頁面', lib => ops.insertFrom(lib, at, bytes, pw, pick));
      }),
      tb('◀ 往前', withSel(s => ed('往前移動頁面', lib => ops.move(lib, s, -1), ns => { sel.clear(); ns.forEach(x => sel.add(x)); draw(); }))),
      tb('往後 ▶', withSel(s => ed('往後移動頁面', lib => ops.move(lib, s, 1), ns => { sel.clear(); ns.forEach(x => sel.add(x)); draw(); }))),
      tb('移到…', withSel(async s => { const t = await prompt('移到第幾頁之前', `1–${a.doc.n + 1}`, '1'); const n = parseInt(t); if (n) { sel.clear(); ed('移動頁面', lib => ops.moveTo(lib, s, n - 1)); } })),
      tb('反轉順序', withSel(s => ed('反轉頁面順序', lib => ops.reverse(lib, s)))),
      tb('擷取成新檔', withSel(s => this.extract(s))), tb('分割…', () => this.split()), tb('裁切', withSel(s => this.crop(s))),
      tb('前往', withSel(s => { close(); a.viewer.goTo(s[0]); })));
    const hint = el('div.small', { text: '點一下選取頁面，長按可連續選取一個範圍。', style: { padding: '8px 14px', background: 'var(--surface)' } });
    box.append(top, tools, body, hint);
    const draw = () => {
      const d = a.doc;
      [...sel].forEach(x => { if (x >= d.n) sel.delete(x); });
      title.textContent = sel.size ? `已選取 ${sel.size} / ${d.n} 頁` : `整理頁面（${d.n} 頁）`;
      const st = body.scrollTop;
      body.innerHTML = '';
      body.append(thumbGrid(a, d, { selected: sel, width: 140,
        onTap: (i, t) => { sel.has(i) ? sel.delete(i) : sel.add(i); anchor = i; t.classList.toggle('sel', sel.has(i)); title.textContent = sel.size ? `已選取 ${sel.size} / ${d.n} 頁` : `整理頁面（${d.n} 頁）`; },
        onLong: i => { const f = anchor < 0 ? i : anchor; for (let k = Math.min(f, i); k <= Math.max(f, i); k++) sel.add(k); anchor = i; draw(); } }));
      body.scrollTop = st;
    };
    a.onOrganizerClose = close;
    a.onDocChanged = draw;
    document.getElementById('layer').append(box);
    draw();
  }

  async extract(pages) {
    const d = this.d;
    const k = await choose(`擷取 ${pages.length} 頁（${specOf(pages)}）`, ['在新分頁開啟', '下載檔案']);
    if (k < 0) return;
    const bytes = await run('擷取中…', () => ops.keepPages(d.current, pages));
    if (k === 0) this.app.openBytes(bytes, base(d.name) + '_擷取.pdf', true); else download(bytes, base(d.name) + '_擷取.pdf');
  }

  async split() {
    if (!this.need()) return;
    const d = this.d;
    const i = await choose('分割與擷取', ['擷取頁面成新檔', '每 N 頁分割', '在指定頁面之前分割', '每頁一個檔案']);
    if (i < 0) return;
    if (i === 0) { const s = await prompt('擷取哪些頁？', '例如 1,3,5-8', `1-${d.n}`); if (s) { const p = parsePages(s, d.n); p.length ? this.extract(p) : toast('沒有有效的頁碼'); } return; }
    let ranges = [];
    const every = k => { const r = []; for (let s = 0; s < d.n; s += k) r.push([s, Math.min(d.n, s + k) - 1]); return r; };
    if (i === 3) ranges = every(1);
    else if (i === 1) { const t = await prompt('每幾頁分割一次', '例如 10', '10'); const k = parseInt(t); if (!k) return; ranges = every(k); }
    else {
      const t = await prompt('在這些頁之前分割', '例如 5,12', ''); if (!t) return;
      let start = 0;
      for (const c of parsePages(t, d.n)) if (c > start) { ranges.push([start, c - 1]); start = c; }
      ranges.push([start, d.n - 1]);
    }
    if (!await confirmBox('分割文件', `會產生 ${ranges.length} 個檔案，打包成一個 ZIP 下載。`, '分割')) return;
    await run('分割中…', async () => {
      const zip = new window.JSZip();
      let k = 1;
      for (const [a, b] of ranges) {
        const keep = []; for (let x = a; x <= b; x++) keep.push(x);
        zip.file(`${base(d.name)}_${String(k++).padStart(2, '0')}（第${a + 1}-${b + 1}頁）.pdf`, await ops.keepPages(d.current, keep));
      }
      download(await zip.generateAsync({ type: 'blob' }), base(d.name) + '_分割.zip', 'application/zip');
    });
  }

  // ================================================================ 建立、合併、掃描

  async create() {
    const i = await choose('建立 PDF', ['從圖片建立', '空白文件', '從文字建立', '用相機掃描']);
    if (i === 0) { const fs = await pickFiles('image/*', true); if (fs.length) { const k = await choose('頁面大小', ['依圖片大小', 'A4（圖片置中）']); if (k >= 0) this.imagesToPdf(fs, k === 1, false, '圖片轉 PDF.pdf'); } }
    else if (i === 1) {
      const r = await form('空白文件', [{ key: 'n', label: '頁數', value: 1, type: 'number' }, { key: 's', label: '大小', type: 'select', options: ['A4 直向', 'A4 橫向', 'Letter', 'A5', 'A3'], value: 0 }], '建立');
      if (!r) return;
      const sz = [[595.28, 841.89], [841.89, 595.28], [612, 792], [419.53, 595.28], [841.89, 1190.55]][r.s];
      const bytes = await run('建立中…', async () => { const d = await L.PDFDocument.create(); for (let k = 0; k < Math.max(1, Math.min(500, r.n || 1)); k++) d.addPage(sz); return d.save(); });
      this.app.openBytes(bytes, '新文件.pdf', true);
    } else if (i === 2) this.textToPdf();
    else if (i === 3) this.scanLoop([]);
  }

  async imagesToPdf(files, a4, enhance, name) {
    const bytes = await run('建立 PDF…', async () => {
      const d = await L.PDFDocument.create();
      for (const f of files) {
        const { jpg, w, h } = await imageToJpeg(f, 2400, enhance);
        const img = await d.embedJpg(jpg);
        const iw = w * 72 / 150, ih = h * 72 / 150;
        const size = a4 ? (iw > ih ? [841.89, 595.28] : [595.28, 841.89]) : [iw, ih];
        const page = d.addPage(size);
        const s = a4 ? Math.min(size[0] / iw, size[1] / ih) * 0.94 : 1;
        page.drawImage(img, { x: (size[0] - iw * s) / 2, y: (size[1] - ih * s) / 2, width: iw * s, height: ih * s });
      }
      return d.save();
    });
    this.app.openBytes(bytes, name, true);
  }

  async textToPdf() {
    const r = await form('從文字建立 PDF', [{ key: 't', label: '標題（可留白）', value: '' }, { key: 'b', label: '內容', type: 'textarea', rows: 8 }, { key: 's', label: '字級（pt）', value: 12, type: 'number' }], '建立');
    if (!r) return;
    const bytes = await run('建立中…', async () => {
      const d = await L.PDFDocument.create();
      d.registerFontkit(window.fontkit);
      const font = await d.embedFont(await huninn(), { subset: true });
      const size = Math.max(6, Math.min(48, r.s || 12)), W = 595.28, H = 841.89, M = 56, lh = size * 1.45;
      const lines = ops.wrap(font, (r.t ? r.t + '\n\n' : '') + r.b, size, W - 2 * M);
      let page = null, y = 0;
      for (const ln of lines) {
        if (!page || y < M) { page = d.addPage([W, H]); y = H - M - size; }
        page.drawText(ln, { x: M, y, size, font });
        y -= lh;
      }
      if (!page) d.addPage([W, H]);
      return d.save();
    });
    this.app.openBytes(bytes, (r.t ? safeName(r.t) : '文字文件') + '.pdf', true);
  }

  async scan() {
    const i = await choose('掃描與 OCR', ['用相機掃描成 PDF', '從相簿圖片建立（文件增強）', { t: 'OCR 文字辨識', s: '找出掃描檔、或字被轉成外框圖形的頁面上的字，之後就能點選修改' }]);
    if (i === 0) this.scanLoop([]);
    else if (i === 1) { const fs = await pickFiles('image/*', true); if (fs.length) this.imagesToPdf(fs, true, true, '掃描文件.pdf'); }
    else if (i === 2) this.ocr();
  }

  /**
   * OCR 文字辨識：請 Tesseract 把頁面上「畫出來的字」抄下來（全程在瀏覽器裡，頁面不上傳）。
   * 辨識結果併進文件的文字資料：之後可以搜尋、選取，在「編輯文字」裡點一下就能修改（直書維持直書）。
   */
  async ocr(pages) {
    const d = this.d;
    if (!d) return toast('請先開啟文件');
    const cur = d.view.page || 0;
    if (!pages) {
      const k = await choose('OCR 文字辨識', [{ t: `辨識第 ${cur + 1} 頁` }, { t: `辨識全部 ${d.n} 頁`, s: '每頁約 10～30 秒' }]);
      if (k < 0) return;
      pages = k === 0 ? [cur] : [...Array(d.n).keys()];
    }
    const k2 = await choose('文字方向', [{ t: '自動判斷' }, { t: '直書', s: '由上往下、由右往左' }, { t: '橫書' }]);
    if (k2 < 0) return;
    const direction = ['auto', 'vertical', 'horizontal'][k2];
    const done = busy('準備文字辨識…');
    const say = m => { const e = document.querySelector('.busy .bm'); if (e) e.textContent = m; };
    let found = 0;
    try {
      for (const [n, i] of pages.entries()) {
        const head = pages.length > 1 ? `第 ${i + 1} 頁（${n + 1}/${pages.length}）` : `第 ${i + 1} 頁`;
        say(`${head}：準備頁面…`);
        const page = await d.pdf.getPage(i + 1);
        const vp = page.getViewport({ scale: OCR_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        const dir = direction === 'auto' ? guessDirection(canvas) : direction;
        const lines = await recognize(canvas, dir, m => {
          if (m.status === 'recognizing text') say(`${head}：辨識${dir === 'vertical' ? '直書' : '橫書'}文字 ${Math.round(m.progress * 100)}%`);
          else if (/load|initializ/.test(m.status)) say('第一次使用，正在下載文字辨識程式（約 6 MB）…');
        });
        d.ocr.set(i, lines);
        d.textCache.delete(i);
        found += lines.length;
      }
    } catch (e) {
      console.error(e);
      done();
      return alertBox('文字辨識失敗', (e && e.message) || String(e));
    }
    done();
    if (!found) return toast('沒有辨識出文字');
    this.app.editMode(0);
    toast(`辨識出 ${found} 行文字。點一下就能修改；辨識可能有錯字，請確認。`, 5000);
  }

  async scanLoop(shots) {
    const [f] = await pickFiles('image/*;capture=camera');
    if (!f) { if (shots.length) this.imagesToPdf(shots, true, true, '掃描文件.pdf'); return; }
    shots.push(f);
    const k = await ask(`已掃描 ${shots.length} 頁`, '繼續掃描下一頁，或完成並建立 PDF。', ['取消', '下一頁', '完成']);
    if (k === 1) this.scanLoop(shots); else if (k === 2) this.imagesToPdf(shots, true, true, '掃描文件.pdf');
  }

  async combine() {
    const a = this.app, cur = a.doc;
    const items = [];
    if (cur) items.push({ title: base(cur.name), bytes: cur.current, label: '［目前文件］' + cur.name });
    const show = () => {
      const s = sheet(`合併檔案（${items.length}）`, { height: '75vh' });
      items.forEach((it, k) => s.body.append(el('div.row',
        el('div.tx', el('div.t1', { text: `${k + 1}.  ${it.label}` })),
        el('button.ib', { text: '▲', onclick: () => { if (k > 0) { [items[k - 1], items[k]] = [items[k], items[k - 1]]; s.close(); show(); } } }),
        el('button.ib', { text: '▼', onclick: () => { if (k < items.length - 1) { [items[k + 1], items[k]] = [items[k], items[k + 1]]; s.close(); show(); } } }),
        el('button.ib', { text: '✕', onclick: () => { items.splice(k, 1); s.close(); show(); } }))));
      s.body.append(el('button.btn', { text: '＋ 加入檔案…', style: { margin: '8px 10px' }, onclick: async () => {
        const fs = await pickFiles('application/pdf', true);
        for (const f of fs) items.push({ title: base(f.name), bytes: new Uint8Array(await f.arrayBuffer()), label: f.name });
        s.close(); show();
      } }));
      if (items.length >= 2) s.body.append(el('button.btn.primary.block', { text: `合併 ${items.length} 個檔案`, style: { margin: '10px 16px', width: 'calc(100% - 32px)' }, onclick: async () => {
        s.close();
        for (const it of items) {
          for (let t = 0; t < 4; t++) {
            try { await loadLib(it.bytes, it.password); break; }
            catch { const p = await prompt(`「${it.label}」需要密碼`, '密碼', '', 'password'); if (p == null) return; it.password = p; }
          }
        }
        const bytes = await run('合併中…', () => ops.merge(items));
        a.openBytes(bytes, '合併文件.pdf', true);
      } }));
      s.body.append(el('div.small', { text: '每個檔案會變成一個書籤，原本的書籤放在它底下；表單和附件都會保留。', style: { padding: '12px 18px' } }));
    };
    if (!cur) { const fs = await pickFiles('application/pdf', true); for (const f of fs) items.push({ title: base(f.name), bytes: new Uint8Array(await f.arrayBuffer()), label: f.name }); if (!items.length) return; }
    show();
  }

  // ================================================================ 保護、塗銷、壓縮

  async protect() {
    const d = this.d;
    const i = await choose('保護 PDF', ['設定密碼保護', '移除密碼保護', '移除隱藏資訊', '目前的安全性']);
    if (i < 0) return;
    if (i === 3) return properties(this.app);
    if (d.encrypted && !d.owner) return this.app.blocked('需要擁有者密碼才能變更安全性設定。');
    if (i === 0) {
      const names = ['列印', '高品質列印', '修改文件', '複製文字與圖片', '新增 / 修改註解', '填寫表單', '組合文件（插入、刪除、旋轉頁面）', '無障礙擷取'];
      const r = await form('密碼保護（AES-256）', [{ key: 'u', label: '開啟密碼（開啟文件時需要；可留白）', type: 'text' }, { key: 'o', label: '權限密碼（擁有者密碼，用來變更限制）', type: 'text' },
        { type: 'note', label: '允許：' }, ...names.map((n, k) => ({ key: 'p' + k, label: n, type: 'check', value: true }))], '套用');
      if (!r) return;
      if (!r.u && !r.o) return toast('至少要設定一個密碼');
      const PF = window.pdfjsLib.PermissionFlag;
      const flags = [PF.PRINT, PF.PRINT_HIGH_QUALITY, PF.MODIFY_CONTENTS, PF.COPY, PF.MODIFY_ANNOTATIONS, PF.FILL_INTERACTIVE_FORMS, PF.ASSEMBLE, PF.COPY_FOR_ACCESSIBILITY];
      d.encOut = { user: r.u, owner: r.o || r.u, perms: flags.filter((f, k) => r['p' + k]) };
      d.encrypted = true; d.owner = true;
      await this.app.edit('設定密碼保護', K_EDIT, () => {});
      if (await confirmBox('已設定密碼保護', '儲存後生效。要現在儲存嗎？', '儲存')) this.app.save();
    } else if (i === 1) {
      if (!d.encrypted && !d.encOut) return toast('這份文件沒有加密');
      if (!await confirmBox('移除密碼保護', '儲存後任何人都可以開啟與編輯這份文件。', '移除')) return;
      d.encOut = null; d.encrypted = false; d.perms = null;
      await this.app.edit('移除密碼保護', K_EDIT, () => {});
      this.app.save();
    } else {
      const r = await form('移除隱藏資訊', [{ key: 'meta', label: '文件資訊與中繼資料（作者、建立程式…）', type: 'check', value: true },
        { key: 'js', label: 'JavaScript 與自動執行的動作', type: 'check', value: true }, { key: 'attach', label: '附件', type: 'check' },
        { key: 'comments', label: '所有註解', type: 'check' }, { key: 'forms', label: '表單平面化', type: 'check' }], '移除');
      if (!r) return;
      const rep = await this.app.edit('移除隱藏資訊', K_EDIT, lib => ops.sanitize(lib, r));
      alertBox('完成', rep || '沒有需要移除的內容。');
    }
  }

  redact() {
    const a = this.app, d = this.d;
    a.setMode({ hint: '框選要塗銷的區域（紅框＝標記）', tool: { type: 'rect', color: '#E53935', onRect: (p, r) => a.edit('標記塗銷', K_EDIT, lib => ops.addRedact(lib, p, r)) },
      buttons: [['搜尋', async () => {
        const q = await prompt('搜尋並標記塗銷', '要塗銷的文字（逗號分隔多個）', '');
        if (!q) return;
        const hits = await run('搜尋中…', () => a.search.findAll(q));
        if (!hits.length) return toast('找不到');
        if (await confirmBox('標記塗銷', `找到 ${hits.length} 處，全部標記為塗銷？`, '標記')) a.edit('搜尋並標記塗銷', K_EDIT, lib => { for (const h of hits) for (const r of h.rects) ops.addRedact(lib, h.page, r); });
      }], ['套用', async () => {
        if (!await confirmBox('套用塗銷', '有塗銷標記的頁面會轉成影像並把標記處塗黑，底下的文字與圖片會被永久移除（仍可在儲存前復原）。', '套用')) return;
        const b = d.block(K_EDIT); if (b) return a.blocked(b);
        const bytes = await run('套用塗銷…', () => ops.applyRedactions(d.current));
        await a.applyBytes('套用塗銷', bytes);
        a.exitModes(); toast('已套用塗銷');
      }]] });
  }

  async compress() {
    const d = this.d, before = d.current.length;
    const i = await choose(`壓縮 PDF（目前 ${size(before)}）`, ['高品質（輕度壓縮）', '平衡', '最小檔案', '整份轉成影像（文字將無法選取）']);
    if (i < 0) return;
    if (i === 3) { const b = await run('轉換中…', () => ops.rasterize(d.current, 110, false)); await this.app.applyBytes('點陣化壓縮', b); return alertBox('完成', `${size(before)} → ${size(d.current.length)}`); }
    const [max, q] = [[2400, 0.85], [1600, 0.7], [1100, 0.5]][i];
    const n = await this.app.edit('壓縮 PDF', K_EDIT, lib => ops.compressImages(lib, max, q));
    const after = d.current.length;
    alertBox('壓縮完成', `重新壓縮了 ${n || 0} 張圖片。\n${size(before)} → ${size(after)}${after < before ? `（減少 ${Math.round(100 - after * 100 / before)}%）` : '（沒有變小，可以按復原）'}`);
  }

  // ================================================================ 表單、印章

  async prepareForm(type = -1) {
    if (!this.need()) return;
    const a = this.app;
    const types = ['文字欄位', '多行文字', '核取方塊', '下拉選單', '清單', '簽名欄位'], codes = ['text', 'multiline', 'check', 'combo', 'list', 'sign'];
    if (type < 0) { const k = await choose('要新增哪種欄位？', types); if (k >= 0) this.prepareForm(k); return; }
    a.viewer.showFields = true;
    const add = async (page, r) => {
      const def = codes[type] + '_' + (Date.now() % 10000);
      if (codes[type] === 'combo' || codes[type] === 'list') {
        const f = await form(types[type], [{ key: 'n', label: '欄位名稱', value: def }, { key: 'o', label: '選項（用逗號分隔）', value: '選項一,選項二,選項三' }], '新增');
        if (f) a.edit('新增欄位', K_EDIT, lib => ops.addField(lib, page, r, codes[type], f.n.trim(), f.o.split(/[,，]/).map(s => s.trim()).filter(Boolean))).then(() => fieldsRefresh(a));
      } else {
        const n = await prompt(types[type] + '名稱', '欄位名稱', def);
        if (n) a.edit('新增欄位', K_EDIT, lib => ops.addField(lib, page, r, codes[type], n.trim())).then(() => fieldsRefresh(a));
      }
    };
    const [dw, dh] = { check: [14, 14], sign: [180, 50], multiline: [160, 60], list: [160, 60] }[codes[type]] || [160, 22];
    a.setMode({ hint: `拖曳出「${types[type]}」的位置（可連續新增）`, tool: { type: 'rect', color: '#2B6CF0', onRect: add, onTap: (p, x, y) => add(p, { x, y: y - dh / 2, w: dw, h: dh }) },
      buttons: [['換類型', () => this.prepareForm()], ['欄位清單', () => fieldsPanel(a)]] });
    fieldsRefresh(a);
  }

  async stamp() {
    if (!this.need()) return;
    const names = ['核准', '已審閱', '機密', '草稿', '最終版', '作廢', '急件', '僅供內部使用', '已收到', '自訂文字…', '圖片…'];
    const cols = ['#2E7D32', '#1E63E9', '#C62828', '#6B7078', '#2E7D32', '#C62828', '#C62828', '#8E24AA', '#1E63E9'];
    const i = await choose('選擇印章', names);
    if (i < 0) return;
    if (i === names.length - 1) {
      const [f] = await pickFiles('image/*'); if (!f) return;
      const img = await imageToPng(f, 1200);
      this.place('拖曳出印章的位置（或點一下）', img.w / img.h, 120, false, (p, r) => this.app.edit('加上印章', K_ANNOT, lib => ops.addStamp(lib, p, r, img.png, 'Image', '圖片印章')));
      return;
    }
    let title = names[i], color = cols[i];
    if (i === names.length - 2) { title = await prompt('印章文字', '', ''); if (!title) return; color = '#C62828'; }
    const img = await stampPng(title, `${ops.author()} · ${now()}`, color);
    this.place('拖曳出印章的位置與大小（或點一下）', img.w / img.h, 130, true, (p, r) => this.app.edit('加上印章', K_ANNOT, lib => ops.addStamp(lib, p, r, img.png, title, title)));
  }

  // ================================================================ 憑證

  async cert() {
    const i = await choose('使用憑證', ['數位簽署文件', '驗證簽章', '建立自簽憑證', '匯入憑證（.p12 / .pfx）', '管理憑證']);
    if (i === 0 && this.need()) this.certSign(-1, null);
    else if (i === 1 && this.need()) this.verify();
    else if (i === 2) this.createCert();
    else if (i === 3) this.importCert();
    else if (i === 4) this.manageCerts();
  }

  async certSign(page, rect) {
    const a = this.app, d = this.d;
    const b = d.block(K_EDIT);
    if (b && d.block(K_FORM)) return a.blocked(b);
    const certs = await sig.listCerts();
    if (!certs.length) {
      const k = await ask('沒有憑證', '數位簽署需要一個含私鑰的憑證（.p12 / .pfx）。可以匯入現有的憑證，或建立一個自簽憑證。', ['取消', '匯入', '建立自簽憑證']);
      if (k === 1) await this.importCert(); else if (k === 2) await this.createCert();
      if ((await sig.listCerts()).length) this.certSign(page, rect);
      return;
    }
    const ci = await choose('選擇憑證', certs);
    if (ci < 0) return;
    const p12 = await sig.getCert(certs[ci]);
    const r = await form('數位簽署', [{ key: 'pw', label: '憑證密碼', type: 'password' }, { key: 'reason', label: '簽署原因', value: '我同意此文件內容' },
      { key: 'loc', label: '地點', value: '台灣' }, ...(page < 0 ? [{ key: 'vis', label: '在頁面上顯示簽章', type: 'check', value: true }] : [])], '簽署');
    if (!r) return;
    let who;
    try { who = (sig.describe(p12, r.pw).split('\n')[0].match(/CN=([^,]+)/) || [])[1] || '簽署者'; } catch (e) { return alertBox('無法簽署', e.message); }
    const go = async (pg, rr) => {
      const visible = rr ? { page: pg, rect: rr, png: await sigLook(who, r.reason, rr.w, rr.h) } : null;
      const bytes = await run('簽署中…', () => sig.sign(d.current, p12, r.pw, { reason: r.reason, location: r.loc, visible }));
      await a.applyBytes('數位簽章', bytes);
      if (await confirmBox('已簽署', '數位簽章已加入（以增量方式寫入，簽署前的內容一個位元組也沒變）。\n\n之後若再編輯，簽章會顯示為「簽署後已修改」。建議現在儲存。', '儲存')) a.save();
    };
    if (page >= 0 && rect) go(page, rect);
    else if (r.vis) this.place('拖曳出簽章外觀的位置（或點一下）', 2.6, 180, false, go);
    else go(0, null);
  }

  async verify() {
    const list = await run('驗證簽章…', () => sig.verify(this.d.current));
    const s = sheet(`數位簽章（${list.length}）`, { height: '60vh', pad: true });
    if (!list.length) s.body.append(el('div.small', { text: '這份文件沒有數位簽章。' }));
    for (const r of list) s.body.append(el('div', { style: { marginBottom: '16px' } },
      el('div', { text: (r.valid ? '✔ ' : '✖ ') + (r.name || '簽章'), style: { fontWeight: 700, color: r.valid ? 'var(--ok)' : 'var(--danger)' } }),
      el('div', { text: r.status }), r.signer ? el('div.small', { text: '憑證：' + r.signer }) : null,
      el('div.small', { text: [r.date && '時間：' + r.date, r.reason && '原因：' + r.reason, r.location && '地點：' + r.location].filter(Boolean).join('\n'), style: { whiteSpace: 'pre-wrap' } }),
      el('div.small', { text: '※ 只驗證文件完整性；自簽憑證的身分無法由第三方確認。' })));
  }

  async createCert() {
    const r = await form('建立自簽憑證', [{ key: 'n', label: '姓名（會顯示在簽章上）', value: ops.author() }, { key: 'e', label: '電子郵件（可留白）', value: '' },
      { key: 'p1', label: '憑證密碼', type: 'password' }, { key: 'p2', label: '再輸入一次', type: 'password' }], '建立');
    if (!r) return;
    if ((r.p1 || '').length < 4) return toast('密碼至少 4 個字');
    if (r.p1 !== r.p2) return toast('兩次密碼不一樣');
    const bytes = await run('產生金鑰（約需幾秒）…', () => sig.createSelfSigned(r.n.trim(), r.e.trim(), r.p1));
    const name = safeName(r.n.trim() || '我的憑證') + '.p12';
    await sig.saveCert(name, bytes);
    alertBox('已建立', `憑證「${name}」已存在這個瀏覽器中（RSA 2048，有效十年）。\n可以在「管理憑證」下載備份。`);
  }

  async importCert() {
    const [f] = await pickFiles('.p12,.pfx,application/x-pkcs12');
    if (!f) return;
    await sig.saveCert(f.name, new Uint8Array(await f.arrayBuffer()));
    toast('已匯入 ' + f.name);
  }

  async manageCerts() {
    const certs = await sig.listCerts();
    const s = sheet(`我的憑證（${certs.length}）`, { height: '60vh' });
    if (!certs.length) s.body.append(el('div.small', { text: '還沒有憑證。', style: { padding: '16px' } }));
    for (const n of certs) s.body.append(el('div.row', { onclick: async () => {
      const k = await choose(n, ['檢視資訊', '下載備份', '刪除']);
      if (k === 0) { const pw = await prompt('憑證密碼', '', '', 'password'); if (pw != null) try { alertBox(n, sig.describe(await sig.getCert(n), pw)); } catch (e) { alertBox('錯誤', e.message); } }
      else if (k === 1) download(await sig.getCert(n), n, 'application/x-pkcs12');
      else if (k === 2 && await confirmBox('刪除憑證', `刪除「${n}」？沒有備份的話無法復原。`, '刪除', true)) { await sig.deleteCert(n); s.close(); this.manageCerts(); }
    } }, el('div.tx', el('div.t1', { text: '🔑 ' + n }))));
    s.body.append(el('button.btn', { text: '＋ 建立自簽憑證', style: { margin: '6px 10px' }, onclick: () => { s.close(); this.createCert(); } }),
      el('button.btn', { text: '＋ 匯入憑證', style: { margin: '6px 10px' }, onclick: () => { s.close(); this.importCert(); } }));
  }

  // ================================================================ 列印

  async printTool() {
    const d = this.d;
    const i = await choose('印刷製作', ['列印', '頁面方塊資訊', '轉換為灰階（影像）', '點陣化（轉成影像）']);
    if (i === 0) this.print();
    else if (i === 1) {
      const txt = await run(null, async () => {
        const lib = await loadLib(d.current), p = lib.getPage(d.view.page);
        const bx = [['媒體框 MediaBox', p.getMediaBox()], ['裁切框 CropBox', p.getCropBox()], ['出血框 BleedBox', p.getBleedBox()], ['成品框 TrimBox', p.getTrimBox()], ['作品框 ArtBox', p.getArtBox()]];
        return bx.map(([n, r]) => `${n}\n  ${(r.width * 25.4 / 72).toFixed(1)} × ${(r.height * 25.4 / 72).toFixed(1)} mm（原點 ${r.x.toFixed(1)}, ${r.y.toFixed(1)} pt）`).join('\n')
          + `\n旋轉：${p.getRotation().angle}°\n紙張：${paper(d.pages[d.view.page].w, d.pages[d.view.page].h)}`;
      });
      alertBox(`第 ${d.view.page + 1} 頁的頁面方塊`, txt);
    } else if (i >= 2 && await confirmBox(i === 2 ? '轉換為灰階' : '點陣化', '每一頁都會轉成 200 DPI 影像，文字將無法再選取或搜尋（可以復原）。', '轉換')) {
      const b = await run('轉換中…', () => ops.rasterize(d.current, 200, i === 2));
      await this.app.applyBytes(i === 2 ? '轉換為灰階' : '點陣化', b);
    }
  }

  async print() {
    const d = this.d;
    if (!d) return;
    if (!d.canPrint()) return alertBox('無法列印', '作者不允許列印這份文件。');
    const url = URL.createObjectURL(new Blob([d.current], { type: 'application/pdf' }));
    const f = el('iframe', { src: url, style: { position: 'fixed', right: 0, bottom: 0, width: '1px', height: '1px', border: 0, opacity: 0 } });
    document.body.append(f);
    f.onload = () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch { window.open(url, '_blank'); }
      setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000);
    };
    // 手機瀏覽器的 iframe 多半不能列印：改開新分頁
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) { f.remove(); window.open(url, '_blank'); toast('在新分頁用瀏覽器的「分享 → 列印」'); }
  }

  // ================================================================ 測量

  get scale() { return prefs.get('mscale', 1); }
  get unit() { return prefs.get('munit', 'mm'); }
  fmtLen(pt) { const mm = pt * 25.4 / 72 * this.scale, u = this.unit; const v = u === 'cm' ? mm / 10 : u === 'm' ? mm / 1000 : u === 'in' ? mm / 25.4 : mm; return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ${u}`; }
  fmtArea(w, h) { const k = 25.4 / 72 * this.scale, mm2 = w * k * h * k, u = this.unit; const v = u === 'cm' ? mm2 / 100 : u === 'm' ? mm2 / 1e6 : u === 'in' ? mm2 / 645.16 : mm2; return `${v < 10 ? v.toFixed(3) : v.toFixed(1)} ${u}²`; }

  measure(kind = 'line') {
    const a = this.app;
    const btn = [['距離', () => this.measure('line')], ['面積', () => this.measure('rect')], ['比例尺', () => this.setScale()]];
    if (kind === 'line') a.setMode({ hint: `拖曳量測距離（比例 1:${this.scale}，單位 ${this.unit}）`, buttons: btn, tool: { type: 'line', color: '#D81B60', width: 1,
      onMove: (p, x, y) => a.viewer.setMeasure('距離 ' + this.fmtLen(Math.hypot(y[0] - x[0], y[1] - x[1]))),
      onLine: async (p, x, y) => {
        const s = this.fmtLen(Math.hypot(y[0] - x[0], y[1] - x[1]));
        a.viewer.setMeasure('距離 ' + s);
        if (await ask('距離：' + s, `比例尺 1 : ${this.scale}`, ['關閉', '加入為註解']) === 1) a.edit('加入測量', K_ANNOT, lib => ops.addLine(lib, p, x, y, false, '#D81B60', 1, s));
      } } });
    else a.setMode({ hint: '拖曳框出要量測面積的範圍', buttons: btn, tool: { type: 'rect', color: '#D81B60', onRect: async (p, r) => {
      const s = `${this.fmtLen(r.w)} × ${this.fmtLen(r.h)} ＝ ${this.fmtArea(r.w, r.h)}`;
      a.viewer.setMeasure(s);
      if (await ask('面積', `${s}\n周長：${this.fmtLen(2 * (r.w + r.h))}`, ['關閉', '加入為註解']) === 1) a.edit('加入測量', K_ANNOT, lib => ops.addShape(lib, p, r, false, '#D81B60', 1, s));
    } } });
  }

  async setScale() {
    const units = ['mm', 'cm', 'm', 'in'];
    const r = await form('比例尺', [{ key: 's', label: '比例尺 1 : ？（圖面 1 單位＝實際幾單位）', value: this.scale, type: 'number' },
      { key: 'u', label: '單位', type: 'select', options: units, value: Math.max(0, units.indexOf(this.unit)) }]);
    if (!r) return;
    prefs.set('mscale', Math.max(0.0001, r.s || 1)); prefs.set('munit', units[r.u]);
    this.measure();
  }

  // ================================================================ 比較

  async compare() {
    const d = this.d;
    const [f] = await pickFiles('application/pdf');
    if (!f) return;
    let bytes = new Uint8Array(await f.arrayBuffer()), pw;
    let other;
    for (let t = 0; t < 4; t++) {
      try { other = await openPdfjs(bytes, pw); break; }
      catch (e) { if (!e.needPassword) throw e; pw = await prompt(`「${f.name}」需要密碼`, '密碼', '', 'password'); if (pw == null) return; }
    }
    const result = await run('比較中…', async () => {
      const A = [], B = [];
      for (let i = 0; i < d.n; i++) A.push(await pageText(d, i));
      for (let i = 0; i < other.numPages; i++) B.push(await pageTextOf(other, i));
      await other.destroy();
      return diff(A, B, d.name, f.name);
    });
    const s = sheet('比較結果', { height: '86vh' });
    s.body.append(result);
  }

  // ================================================================ 引導式動作、無障礙

  async guided() {
    const a = this.app, d = this.d;
    const i = await choose('引導式動作', ['發佈前清理：移除中繼資料與 JavaScript，再壓縮', '寄送前準備：壓縮後加上密碼', '封存：表單平面化並移除 JavaScript', '審閱彙整：匯出所有註解成文字檔']);
    if (i === 0) { await a.edit('移除隱藏資訊', K_EDIT, lib => ops.sanitize(lib, { meta: true, js: true })); await a.edit('壓縮 PDF', K_EDIT, lib => ops.compressImages(lib, 1600, 0.7)); alertBox('完成', '已完成 2 個步驟：移除隱藏資訊、壓縮。\n每個步驟都可以個別復原。'); }
    else if (i === 1) { await a.edit('壓縮 PDF', K_EDIT, lib => ops.compressImages(lib, 1600, 0.7)); this.protect(); }
    else if (i === 2) { await a.edit('封存', K_EDIT, lib => { try { if (lib.getForm().getFields().length) lib.getForm().flatten(); } catch {} ops.sanitize(lib, { js: true }); }); alertBox('完成', '表單已平面化、JavaScript 已移除。'); }
    else if (i === 3) {
      const list = await run(null, async () => ops.comments(await loadLib(d.current)));
      let t = `「${d.name}」的註解\n\n`;
      for (const c of list) {
        t += `第 ${c.page + 1} 頁 · ${c.sub} · ${c.author} · ${c.date}\n`;
        if (c.text) t += `  「${c.text}」\n`;
        if (c.contents) t += `  ${c.contents}\n`;
        for (const r of c.replies) t += `    ↳ ${r.author}：${r.contents}\n`;
        t += '\n';
      }
      download(new Blob([t], { type: 'text/plain;charset=utf-8' }), base(d.name) + '_註解.txt');
    }
  }

  async access() {
    const a = this.app, d = this.d;
    const rows = await run('檢查中…', async () => {
      const lib = await loadLib(d.current), cat = lib.catalog, P = L.PDFName.of;
      const title = lib.getTitle() || '';
      let lang = ''; try { lang = cat.lookup(P('Lang')).decodeText(); } catch {}
      let show = false; try { show = lib.catalog.getViewerPreferences ? !!lib.catalog.getViewerPreferences()?.getDisplayDocTitle() : false; } catch {}
      let tagged = false; try { tagged = cat.lookup(P('MarkInfo')).lookup(P('Marked')).asBoolean(); } catch {}
      let textPages = 0; const check = Math.min(d.n, 5);
      for (let k = 0; k < check; k++) if ((await pageText(d, k)).trim().length > 10) textPages++;
      const bm = ops.readOutline(lib).length > 0;
      const fonts = ops.fonts(lib); const notEmb = [...fonts.values()].filter(v => v.includes('未嵌入')).length;
      return [[title ? '✔' : '✖', '文件標題', title || '未設定'], [lang ? '✔' : '✖', '文件語言', lang || '未設定'], [show ? '✔' : '✖', '視窗顯示文件標題', show ? '是' : '否'],
        [tagged ? '✔' : '!', '標記（Tagged PDF）', tagged ? '是' : '否（需要專業工具加上結構標記）'],
        [textPages ? '✔' : '✖', '可擷取文字', `${textPages}/${check} 頁有文字${textPages ? '' : '（可能是掃描影像，需要 OCR）'}`],
        [bm || d.n <= 20 ? '✔' : '!', '書籤（長文件導覽）', bm ? '有' : d.n <= 20 ? '文件不長，可不需要' : '建議加入'],
        [notEmb ? '!' : '✔', '字型已嵌入', notEmb ? `${notEmb} 個字型未嵌入` : '全部']];
    });
    const s = sheet('無障礙檢查', { height: '70vh' });
    for (const [m, t, v] of rows) s.body.append(el('div.row', el('div.tx', el('div.t1', { text: `${m}  ${t}` }), el('div.t2', { text: v }))));
    s.body.append(el('button.btn.primary.block', { text: '自動修正標題、語言與顯示設定', style: { margin: '14px 16px', width: 'calc(100% - 32px)' }, onclick: async () => {
      s.close();
      const t = await prompt('文件標題', '', base(d.name));
      if (t == null) return;
      await a.edit('無障礙修正', K_EDIT, lib => {
        if (t.trim()) lib.setTitle(t.trim(), { showInWindowTitleBar: true });
        if (!lib.catalog.lookup(L.PDFName.of('Lang'))) lib.setLanguage('zh-TW');
      });
      this.access();
    } }));
  }

  // ================================================================ 設定

  async settings() {
    const a = this.app;
    const i = await choose('設定', [`署名（註解作者）：${ops.author()}`, '主題：跟隨系統', '主題：淺色', '主題：深色', '測量比例尺', '檢查更新', '安裝到主畫面 / 建立捷徑', '關於小柯文件PDF線上版']);
    if (i === 0) { const s = await prompt('署名', '註解和印章上顯示的名字', ops.author()); if (s != null) prefs.set('author', s.trim() || '小柯'); }
    else if (i >= 1 && i <= 3) a.setTheme(['system', 'light', 'dark'][i - 1]);
    else if (i === 4) this.setScale();
    else if (i === 5) a.updater.check(true);
    else if (i === 6) a.installApp();
    else if (i === 7) alertBox('小柯文件PDF線上版 ' + a.updater.version, '在瀏覽器裡閱讀、編輯 PDF，功能與 Android 版「小柯文件PDF助手」相同，參考 PdfCraft 的功能設計。\n\n'
      + '・繪製：pdf.js（Apache 2.0）\n・編輯：@cantoo/pdf-lib（MIT）、fontkit（MIT）\n・數位簽章：node-forge（BSD / GPL 雙授權，使用 BSD）\n・ZIP / Word：JSZip（MIT）\n'
      + '・中文字型：jf open 粉圓 2.1（justfont，SIL Open Font License 1.1；漢字部分源自 Kosugi Maru，Apache-2.0）\n\n'
      + '隱私至上：文件絕對不會離開你的裝置，全部在瀏覽器裡處理，不需要帳號、不收集使用資料。只有檢查更新時會讀取本網站的版本資訊與 GitHub 的版本資訊。');
  }
}

// ================================================================ 輔助

async function fieldsRefresh(a) { try { const { loadFields } = await import('./panels.js'); await loadFields(a); a.viewer.redrawOverlays(); } catch {} }

export async function pageText(d, i) {
  const items = await d.text(i);
  let t = '', last = null;
  for (const it of items) {
    if (last && (Math.abs(it.y - last.y) > last.h * 0.5)) t += '\n';
    else if (last && it.x - (last.x + last.w) > it.size * 0.25 && !/\s$/.test(t)) t += ' ';
    t += it.str;
    last = it;
  }
  return t;
}

async function pageTextOf(pdf, i) {
  const p = await pdf.getPage(i + 1);
  const tc = await p.getTextContent();
  return tc.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('');
}

function diff(A, B, nameA, nameB) {
  const box = el('div.diff');
  const lines = s => s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  let changed = 0, added = 0, removed = 0;
  box.append(el('b', { text: `「${nameA}」（${A.length} 頁） ↔ 「${nameB}」（${B.length} 頁）\n\n` }));
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const la = i < A.length ? lines(A[i]) : [], lb = i < B.length ? lines(B[i]) : [];
    if (la.join('\n') === lb.join('\n')) continue;
    changed++;
    box.append(el('b', { text: `第 ${i + 1} 頁${i >= A.length ? '（只在新文件）' : i >= B.length ? '（只在原文件）' : ''}\n` }));
    const Lm = Array.from({ length: la.length + 1 }, () => new Int32Array(lb.length + 1));
    for (let x = la.length - 1; x >= 0; x--) for (let y = lb.length - 1; y >= 0; y--) Lm[x][y] = la[x] === lb[y] ? Lm[x + 1][y + 1] + 1 : Math.max(Lm[x + 1][y], Lm[x][y + 1]);
    let x = 0, y = 0, ctx = 0;
    while (x < la.length || y < lb.length) {
      if (x < la.length && y < lb.length && la[x] === lb[y]) { if (ctx++ < 1) box.append(el('span.ctx', { text: '  ' + la[x] })); x++; y++; }
      else if (y < lb.length && (x >= la.length || Lm[x][y + 1] >= Lm[x + 1][y])) { box.append(el('span.add', { text: '＋ ' + lb[y] })); added++; y++; ctx = 0; }
      else { box.append(el('span.del', { text: '－ ' + la[x] })); removed++; x++; ctx = 0; }
    }
    box.append('\n');
  }
  box.prepend(el('div', { text: changed ? `共 ${changed} 頁有差異：新增 ${added} 行、刪除 ${removed} 行。\n` : '兩份文件的文字內容完全相同。', style: { fontWeight: 700, marginBottom: '8px' } }));
  return box;
}

async function docx(pages) {
  const zip = new window.JSZip();
  const x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  let body = '';
  pages.forEach((p, i) => {
    for (const l of p.split(/\r?\n/)) body += `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei"/></w:rPr><w:t xml:space="preserve">${x(l)}</w:t></w:r></w:p>`;
    if (i < pages.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  });
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function loadBitmap(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export async function imageToPng(file, max) {
  const c = await loadBitmap(file, max);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return { png: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height };
}

async function imageToJpeg(file, max, enhance) {
  const c = await loadBitmap(file, max);
  const ctx = c.getContext('2d');
  if (enhance) {
    const id = ctx.getImageData(0, 0, c.width, c.height), p = id.data;
    for (let k = 0; k < p.length; k += 4) for (let j = 0; j < 3; j++) p[k + j] = Math.max(0, Math.min(255, p[k + j] * 1.35 - 40));
    ctx.putImageData(id, 0, 0);
  }
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  return { jpg: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height };
}

/** 文字框：把文字圖放進指定大小的透明底圖 */
async function padPng(img, r) {
  const c = document.createElement('canvas');
  c.width = Math.round(r.w * 4); c.height = Math.round(r.h * 4);
  const bmp = await createImageBitmap(new Blob([img.png], { type: 'image/png' }));
  c.getContext('2d').drawImage(bmp, 0, 0);
  const b = await new Promise(res => c.toBlob(res, 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}
