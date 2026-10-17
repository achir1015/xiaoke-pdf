// =====================================================================
// 屬性面板（Inspector）
//
// 比喻：工作桌旁邊的「調色盤與說明卡」。
//   - 選到一張貼紙 → 顯示它的設定（字級、顏色、網址…）
//   - 選了工具但沒選貼紙 → 顯示這個工具怎麼用
//   - 加浮水印 / 去浮水印 → 顯示完整的設定表單
// 每個控制項都有 set()，資料變了只更新數值，不重建表單（打字時游標不會跳掉）。
// =====================================================================
import { h, field, segmented, colorPicker, toggle, slider, pickFile } from './dom.js';
import { ICONS } from './icons.js';
import { FONT_NAMES } from '../pdf/fonts.js';
import { normalizeUrl, youtubeIdOf } from '../domain/elements.js';
import { formatBytes, parsePageRange, normalizeImage } from '../pdf/util.js';
import { DEFAULT_WATERMARK, layoutCenters } from '../pdf/watermarkAdder.js';
import { detectWatermarks, previewTextRemoval } from '../pdf/watermarkRemover.js';
import { FONT_CSS } from '../pdf/fonts.js';
import { toast } from './toast.js';

export const TOOL_INFO = {
  select: { name: '選取', key: 'V', hint: '點一下貼紙可以選取、拖曳移動；選取後拉四周的控制點可以改變大小。雙擊文字可以直接修改內容。' },
  edittext: { name: '改原文字', key: 'E', hint: '頁面上原本的文字會用藍框標出，點一下那一行就能直接修改。原本的字會被同色的色塊蓋掉，再印上新的文字。' },
  text: { name: '新增文字', key: 'T', hint: '在頁面上點一下就能開始打字。中文會使用內建的粉圓字型，存檔後是可以搜尋、複製的真正文字。' },
  cover: { name: '遮蓋', key: 'R', hint: '像修正帶一樣，拖曳框出要蓋掉的區域（例如浮水印殘影、錯字、個資）。可以從頁面取樣背景色。注意：這是「蓋住」，下面的內容仍在檔案裡；要真正刪除浮水印請用「去浮水印」。' },
  link: { name: '網址連結', key: 'L', hint: '點一下：插入一段可點擊的文字連結。拖曳框選：在原本的字上加一塊透明的點擊區。' },
  media: { name: '影音', key: 'M', hint: '點一下或拖曳出位置，放一張播放卡片：可以是 YouTube／影片網址（附 QR Code，紙本也能掃），或把本機的影片、音訊檔直接嵌入 PDF。' },
  table: { name: '表格', key: 'B', hint: '設定列數、欄數後，在頁面上點一下表格的左上角就會插入表格，下面的內容會自動往下移。插入後點格子就能直接打字。在表格裡改字時，右邊的面板可以「插入列」「插入欄」「合併儲存格」；字太長時那一列會自動撐高。' },
  image: { name: '圖片', key: 'I', hint: '點一下或拖曳出位置，再選擇圖片（PNG、JPG、WebP…）。拉角落改大小時會保持比例，按住 Shift 可自由變形。' },
  watermark: { name: '加浮水印', key: 'W', hint: '' },
  unwatermark: { name: '去浮水印', key: 'U', hint: '' },
};

export class Inspector {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.session = app.session;
    this.current = null;        // { key, sync(el) }
    this.wm = { ...DEFAULT_WATERMARK };
    this.session.addEventListener('elements', () => this.refresh());
    this.session.addEventListener('base', () => { if (this.current?.key === 'unwatermark') this.render(true); });
  }

  /** 依目前狀態決定要顯示哪個面板 */
  render(force = false) {
    const app = this.app;
    let key;
    if (!this.session.isOpen) key = 'welcome';
    else if (app.tool === 'watermark') key = 'watermark';
    else if (app.tool === 'unwatermark') key = 'unwatermark';
    else if (app.view.selectedId && this.session.get(app.view.selectedId)) key = 'el:' + app.view.selectedId;
    else key = 'tool:' + app.tool;
    if (!force && this.current && this.current.key === key) { this.refresh(); return; }

    if (this.current?.key === 'watermark' && key !== 'watermark') app.view.setWatermarkPreview(null);
    this.root.innerHTML = '';
    let panel;
    if (key === 'welcome') panel = this._welcome();
    else if (key === 'watermark') panel = this._watermarkPanel();
    else if (key === 'unwatermark') panel = this._unwatermarkPanel();
    else if (key.startsWith('el:')) panel = this._elementPanel(this.session.get(app.view.selectedId));
    else panel = this._toolPanel(app.tool);
    this.current = { key, sync: panel.sync || null };
    this.root.appendChild(panel.node);
    this.root.scrollTop = 0;
    document.body.classList.toggle('sheet-open', key !== 'welcome' && !key.startsWith('tool:select'));
  }

  /** 資料變了：只更新數值 */
  refresh() {
    if (!this.current) return;
    if (this.current.key.startsWith('el:')) {
      const el = this.session.get(this.current.key.slice(3));
      if (!el) { this.render(); return; }
      this.current.sync?.(el);
    }
  }

  // ================================================================ 歡迎 / 工具說明

  _welcome() {
    return { node: h('div', { class: 'panel' },
      h('h2', {}, '小柯文件PDF助手'),
      h('p', { class: 'muted' }, '開啟 PDF 後，可以修改文字、插入網址與影音、加上或去除浮水印，最後下載新的 PDF。'),
      h('div', { class: 'privacy' }, h('span', { html: ICONS.shield }), h('span', {}, '全部在你的瀏覽器裡處理，檔案不會上傳到任何伺服器。'))) };
  }

  _toolPanel(tool) {
    const info = TOOL_INFO[tool] || TOOL_INFO.select;
    const node = h('div', { class: 'panel' },
      h('h2', {}, info.name, h('kbd', {}, info.key)),
      h('p', { class: 'muted' }, info.hint));
    if (tool === 'text') {
      const d = this.app.textDefaults;
      node.append(h('h3', {}, '新文字的預設樣式'),
        field('方向', segmented([['h', '橫書'], ['v', '直書']], d.vertical ? 'v' : 'h', v => (d.vertical = v === 'v')), '直書：由上往下、由右往左，使用粉圓字型。'),
        field('字型', this._fontSelect(d.font, v => (d.font = v))),
        field('字級', slider(6, 96, 1, d.size, v => (d.size = v), v => v + ' pt')),
        field('顏色', colorPicker(d.color, v => (d.color = v))));
    }
    if (tool === 'table') {
      const d = this.app.tableDefaults;
      const num = (v, min, max, set) => h('input', { type: 'number', min, max, value: v, inputmode: 'numeric', onchange: (e) => set(Math.max(min, Math.min(max, Math.round(+e.target.value) || v))) });
      node.append(field('列數', num(d.rows, 1, 50, v => (d.rows = v))), field('欄數', num(d.cols, 1, 20, v => (d.cols = v))));
    }
    if (tool === 'edittext' && this.app.view.hitsOn) node.append(this._ocrSection());
    return { node };
  }

  /** 改原文字面板裡的 OCR 區塊：頁面沒有文字時特別提醒 */
  _ocrSection() {
    const app = this.app, view = app.view;
    const cur = view.currentPage || 0;
    const native = (s) => (s.lines || []).filter(l => !l.ocr).length;
    const noTextAnywhere = !view.shells.some(s => native(s));
    const curNoText = !native(view.shells[cur] || {});
    const done = app.renderer.ocr.has(cur);
    let dir = 'auto';
    const wrap = h('section', { class: 'wm-sec' },
      h('b', {}, '文字辨識（OCR）'),
      curNoText
        ? h('p', { class: 'muted small' }, noTextAnywhere
          ? '這份文件讀不到文字：字可能是掃描的圖片，或匯出時被轉成了「外框圖形」（WPS 常見）。用文字辨識把字找出來，就能點選修改。'
          : `第 ${cur + 1} 頁讀不到文字，可以用文字辨識把字找出來。`)
        : h('p', { class: 'muted small' }, '頁面上有些字沒有藍框？可能是圖片裡的字，可以用文字辨識找出來。'),
      field('文字方向', segmented([['auto', '自動判斷'], ['vertical', '直書'], ['horizontal', '橫書']], dir, v => (dir = v))),
      h('button', { type: 'button', class: 'btn primary block', onclick: () => app.ocrPages([view.currentPage || 0], dir) }, done ? `重新辨識第 ${cur + 1} 頁` : `辨識第 ${cur + 1} 頁`),
      view.shells.length > 1 ? h('button', { type: 'button', class: 'btn block', onclick: () => app.ocrPages(view.shells.map(s => s.index), dir) }, `辨識全部 ${view.shells.length} 頁`) : null,
      h('p', { class: 'muted small' }, '辨識在你的瀏覽器裡進行，頁面不會上傳。第一次使用需要下載約 6 MB 的辨識程式，每頁約 10～30 秒。辨識難免有錯字，點選後請在編輯框裡確認。'));
    return wrap;
  }

  // ================================================================ 貼紙設定

  _elementPanel(el) {
    const s = this.session;
    const id = el.id;
    const syncs = [];
    const upd = (changes, label, coalesce) => s.update(id, changes, { label, coalesce });
    const node = h('div', { class: 'panel' });
    node.append(h('h2', {}, el.label));

    if (el.kind === 'text') {
      const ta = h('textarea', { rows: 3, value: el.text, placeholder: '輸入文字', oninput: () => upd({ text: ta.value }, '輸入文字', 'type:' + id) });
      const font = this._fontSelect(el.font, v => { upd({ font: v }, '改字型'); this.app.textDefaults.font = v; });
      const size = slider(6, 120, 0.5, el.size, v => { upd({ size: v }, '改字級', 'size:' + id); this.app.textDefaults.size = v; }, v => v + ' pt');
      const color = colorPicker(el.color, v => { upd({ color: v }, '改顏色', 'color:' + id); this.app.textDefaults.color = v; });
      const bgOn = h('input', { type: 'checkbox', checked: !!el.bgColor, onchange: () => upd({ bgColor: bgOn.checked ? (bg.querySelector('input').value || '#fff59d') : null }, '文字背景') });
      const bg = colorPicker(el.bgColor || '#fff59d', v => { bgOn.checked = true; upd({ bgColor: v }, '文字背景', 'bg:' + id); }, ['#fff59d', '#c8e6c9', '#bbdefb', '#ffcdd2', '#ffffff', '#1d1f23']);
      const B = toggle('<b>B</b>', el.bold, v => upd({ bold: v }, '粗體'), '粗體');
      const U = toggle('<u>U</u>', el.underline, v => upd({ underline: v }, '底線'), '底線');
      const S = toggle('<s>S</s>', el.strike, v => upd({ strike: v }, '刪除線'), '刪除線');
      const align = segmented([['left', '靠左'], ['center', '置中'], ['right', '靠右']], el.align, v => upd({ align: v }, '對齊'));
      // 直書／橫書：直書一律用粉圓字型（標準英文字型沒有直書資訊）
      const dir = segmented([['h', '橫書'], ['v', '直書']], el.vertical ? 'v' : 'h', v => {
        const vertical = v === 'v';
        upd(vertical ? { vertical, font: 'huninn' } : { vertical }, vertical ? '改成直書' : '改成橫書');
        this.app.textDefaults.vertical = vertical;
      });
      const alignLabels = (vertical) => {
        const t = vertical ? ['靠上', '置中', '靠下'] : ['靠左', '置中', '靠右'];
        align.querySelectorAll('.seg-btn').forEach((b, k) => { b.textContent = t[k]; });
      };
      alignLabels(el.vertical);
      const lh = h('select', { onchange: () => upd({ lineHeight: +lh.value }, '行高') },
        ...[1, 1.15, 1.3, 1.5, 1.8, 2].map(v => h('option', { value: v, selected: v === el.lineHeight }, v === 1.3 ? '1.3（預設）' : String(v))));
      node.append(
        field('內容', ta, '也可以在頁面上雙擊文字直接修改。'),
        field('方向', dir),
        field('字型', font),
        field('字級', size),
        field('文字顏色', color),
        h('div', { class: 'row' }, h('span', { class: 'field-label' }, '樣式'), h('div', { class: 'tog-group' }, B, U, S)),
        field('對齊', align),
        field('行高', lh),
        h('label', { class: 'check' }, bgOn, '文字背景色'), bg);
      syncs.push(e => { if (document.activeElement !== ta) ta.value = e.text; font.value = e.font; size.set(e.size); color.set(e.color); bgOn.checked = !!e.bgColor; if (e.bgColor) bg.set(e.bgColor); B.set(e.bold); U.set(e.underline); S.set(e.strike); align.set(e.align); lh.value = e.lineHeight; dir.set(e.vertical ? 'v' : 'h'); alignLabels(e.vertical); font.disabled = !!e.vertical; });
      font.disabled = !!el.vertical;
      if (el.patch) {
        const pc = colorPicker(el.patch.color || '#ffffff', v => upd({ patch: { ...s.get(id).patch, color: v } }, '遮蓋顏色', 'patch:' + id), ['#ffffff', '#f5f5f5', '#fffde7', '#1d1f23']);
        node.append(h('h3', {}, '原文字遮蓋'),
          h('p', { class: 'muted small' }, '原本那行字會被這個顏色蓋掉。如果頁面底色不是白色，請按「從頁面取樣」。'),
          pc,
          h('button', { type: 'button', class: 'btn ghost', onclick: () => { const c = this.app.sampleColor(el.pageIndex, s.get(id).patch); if (c) upd({ patch: { ...s.get(id).patch, color: c.bg } }, '遮蓋顏色'); } }, '從頁面取樣'));
        syncs.push(e => e.patch && pc.set(e.patch.color));
      }
      node.append(h('button', { type: 'button', class: 'btn', onclick: () => this.app.view.beginEdit(id, { selectAll: true }) }, '在頁面上編輯文字'));
      if (el.inCell) {
        node.append(h('h3', {}, '表格'),
          h('p', { class: 'muted small' }, '字變長時這一列會自動撐高（頁面放不下才縮小字級）。'),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn ghost', onclick: () => this.app.insertRowFor(id) }, '＋ 插入列'),
            h('button', { type: 'button', class: 'btn ghost', onclick: () => this.app.insertColumnFor(id) }, '＋ 插入欄'),
            h('button', { type: 'button', class: 'btn ghost', onclick: () => this.app.mergeStart(id) }, '合併儲存格')));
      }
    }

    if (el.kind === 'cover') {
      const color = colorPicker(el.color, v => upd({ color: v }, '遮蓋顏色', 'color:' + id), ['#ffffff', '#f5f5f5', '#fffde7', '#000000', '#1d1f23', '#e0e0e0']);
      node.append(field('顏色', color),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { const c = this.app.sampleColor(el.pageIndex, s.get(id), true); if (c) upd({ color: c.bg }, '遮蓋顏色'); } }, '從頁面取樣周圍顏色'),
        h('p', { class: 'muted small' }, '提示：遮蓋只是把東西蓋住，原本的內容仍留在檔案裡（可能被複製或搜尋到）。'));
      syncs.push(e => color.set(e.color));
    }

    if (el.kind === 'link') {
      const url = h('input', { type: 'url', value: el.url, placeholder: 'https://example.com', inputmode: 'url', oninput: () => { upd({ url: url.value.trim() }, '網址', 'url:' + id); check(); }, onblur: () => { const n = normalizeUrl(url.value); if (n !== url.value) { url.value = n; upd({ url: n }, '網址'); } check(); } });
      const msg = h('span', { class: 'field-hint' });
      const check = () => { const v = url.value.trim(); msg.textContent = !v ? '請輸入網址（也可以是 Email 或電話：mailto: / tel:）' : /^(https?:|mailto:|tel:)/i.test(v) ? '' : '會自動補上 https://'; };
      check();
      const text = h('input', { type: 'text', value: el.text, placeholder: '留白＝透明點擊區', oninput: () => upd({ text: text.value }, '連結文字', 'ltext:' + id) });
      const size = slider(6, 72, 0.5, el.size, v => upd({ size: v }, '連結字級', 'lsize:' + id), v => v + ' pt');
      const color = colorPicker(el.color, v => upd({ color: v }, '連結顏色', 'lcolor:' + id), ['#1e63e9', '#1a0dab', '#d93025', '#188038', '#1d1f23']);
      const U = toggle('<u>底線</u>', el.underline, v => upd({ underline: v }, '底線'));
      node.append(field('網址', url), msg, field('顯示文字', text, '有文字：印出藍色連結文字。留白：變成透明的點擊區，可以蓋在原本的字上。'));
      const style = h('div', { class: 'group' }, field('字級', size), field('顏色', color), U);
      node.append(style,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { const u = s.get(id).url; if (u) window.open(normalizeUrl(u), '_blank', 'noopener'); else toast('請先輸入網址', 'warn'); } }, h('span', { html: ICONS.external }), '測試開啟'));
      syncs.push(e => { if (document.activeElement !== url) url.value = e.url; if (document.activeElement !== text) text.value = e.text; size.set(e.size); color.set(e.color); U.set(e.underline); style.hidden = !e.text; });
      style.hidden = !el.text;
      if (!el.url) setTimeout(() => url.focus(), 50);
    }

    if (el.kind === 'media') this._mediaFields(node, el, upd, syncs);

    if (el.kind === 'image') {
      const op = slider(0.1, 1, 0.05, el.opacity, v => upd({ opacity: v }, '不透明度', 'op:' + id), v => Math.round(v * 100) + '%');
      node.append(field('不透明度', op),
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          const img = await normalizeImage(f);
          const cur = s.get(id);
          upd({ image: { ...img, url: URL.createObjectURL(new Blob([img.bytes], { type: img.mime })) }, h: cur.w * img.height / img.width }, '替換圖片');
        } }, '替換圖片'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { const cur = s.get(id); if (cur.image) upd({ h: cur.w * cur.image.height / cur.image.width }, '恢復比例'); } }, '恢復原始比例'));
      syncs.push(e => op.set(e.opacity));
    }

    // 共用動作
    node.append(h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'icon-btn', title: '複製一份 (Ctrl+D)', onclick: () => this.app.duplicate(id), html: ICONS.copy }),
      h('button', { type: 'button', class: 'icon-btn', title: '移到最上層', onclick: () => this.app.reorder(id, 'front'), html: ICONS.front }),
      h('button', { type: 'button', class: 'icon-btn', title: '移到最下層', onclick: () => this.app.reorder(id, 'back'), html: ICONS.back }),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn danger', onclick: () => this.app.deleteSelected() }, h('span', { html: ICONS.trash }), '刪除')));
    return { node, sync: (e) => syncs.forEach(f => f(e)) };
  }

  _mediaFields(node, el, upd, syncs) {
    const s = this.session, id = el.id;
    const urlBox = h('div', { class: 'group' });
    const fileBox = h('div', { class: 'group' });
    const src = segmented([['url', '線上影音網址'], ['file', '本機影音檔']], el.source, v => upd({ source: v }, '影音來源'));
    const url = h('input', { type: 'url', value: el.url, placeholder: 'https://www.youtube.com/watch?v=…', oninput: () => setUrl(false), onblur: () => setUrl(true) });
    const setUrl = async (final) => {
      const v = final ? normalizeUrl(url.value) : url.value.trim();
      if (final && v !== url.value) url.value = v;
      const changes = { url: v };
      if (/\.(mp3|m4a|wav|aac|flac|oga)(\?|#|$)/i.test(v)) changes.mediaType = 'audio';
      else if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(v) || youtubeIdOf(v)) changes.mediaType = 'video';
      if (final && youtubeIdOf(v) && s.get(id).url !== v) changes.poster = null;
      upd(changes, '影音網址', 'murl:' + id);
      if (final) this.app.fetchPoster(id);
    };
    urlBox.append(field('網址', url, '支援 YouTube、Vimeo、Google 雲端硬碟分享連結，或 .mp4 / .mp3 直接連結。'));
    const qr = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: el.showQr, onchange: (e) => upd({ showQr: e.target.checked }, 'QR Code') }), '卡片附上 QR Code（紙本可用手機掃描）');
    urlBox.append(qr);

    const fileInfo = h('div', { class: 'file-info' });
    const showFile = (e) => { fileInfo.textContent = e.file ? `${e.file.name}（${formatBytes(e.file.bytes.length)}）` : '尚未選擇檔案'; };
    showFile(el);
    fileBox.append(fileInfo,
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        const f = await pickFile('video/*,audio/*,.mp4,.mp3,.m4a,.wav,.webm,.mov');
        if (!f) return;
        if (f.size > 200 * 1024 * 1024) { toast('檔案超過 200 MB，PDF 會非常大，建議改用網址。', 'warn', 6000); return; }
        if (f.size > 50 * 1024 * 1024) toast('檔案較大（' + formatBytes(f.size) + '），產生的 PDF 也會變大。', 'warn', 6000);
        const bytes = new Uint8Array(await f.arrayBuffer());
        upd({ file: { name: f.name, mime: f.type || 'application/octet-stream', bytes }, mediaType: /^audio/.test(f.type) ? 'audio' : 'video', source: 'file' }, '選擇影音檔');
      } }, '選擇影片或音訊檔…'),
      h('p', { class: 'muted small' }, '檔案會直接嵌入 PDF。在 Adobe Acrobat、Foxit 等閱讀器中點卡片右上角的迴紋針即可開啟播放；瀏覽器內建的 PDF 檢視器通常只能從附件清單下載。'));

    const type = segmented([['video', '影片'], ['audio', '音訊']], el.mediaType, v => upd({ mediaType: v }, '影音類型'));
    const title = h('input', { type: 'text', value: el.title, placeholder: '卡片標題（例如：課程影片第 1 集）', oninput: () => upd({ title: title.value }, '卡片標題', 'mtitle:' + id) });
    node.append(field('來源', src), urlBox, fileBox, field('標題', title), field('類型', type),
      h('button', { type: 'button', class: 'btn', onclick: () => { const n = this.app.view.nodeOf(id); n?.querySelector('.media-play')?.click(); } }, h('span', { html: ICONS.play }), '預覽播放'));
    const vis = (e) => { urlBox.hidden = e.source !== 'url'; fileBox.hidden = e.source !== 'file'; };
    vis(el);
    syncs.push(e => { src.set(e.source); vis(e); type.set(e.mediaType); showFile(e); if (document.activeElement !== url) url.value = e.url; if (document.activeElement !== title) title.value = e.title; qr.querySelector('input').checked = e.showQr; });
    if (el.source === 'url' && !el.url) setTimeout(() => url.focus(), 50);
  }

  _fontSelect(value, onChange) {
    const sel = h('select', { onchange: () => onChange(sel.value) },
      ...Object.entries(FONT_NAMES).map(([k, v]) => h('option', { value: k, selected: k === value }, v)));
    return sel;
  }

  // ================================================================ 加浮水印

  _watermarkPanel() {
    const w = this.wm;
    const app = this.app;
    const preview = () => app.view.setWatermarkPreview(this._previewSpec());
    const set = (k, v) => { w[k] = v; preview(); };

    const kind = segmented([['text', '文字浮水印'], ['image', '圖片浮水印']], w.kind, v => { set('kind', v); vis(); });
    const textBox = h('div', { class: 'group' });
    const imgBox = h('div', { class: 'group' });
    const text = h('textarea', { rows: 2, value: w.text, oninput: () => set('text', text.value) });
    textBox.append(field('文字', text, '可以換行。常用：機密文件、僅供內部參考、樣本、DRAFT'),
      field('字型', this._fontSelect(w.font, v => set('font', v))),
      field('大小', slider(12, 200, 1, w.size, v => set('size', v), v => v + ' pt')),
      field('顏色', colorPicker(w.color, v => set('color', v), ['#d93025', '#1d1f23', '#9e9e9e', '#1e63e9', '#188038', '#e37400'])),
      toggle('<b>粗體</b>', w.bold, v => set('bold', v)));
    const imgInfo = h('div', { class: 'file-info' }, w.image ? '已選擇圖片' : '尚未選擇圖片');
    imgBox.append(imgInfo,
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        const f = await pickFile('image/*');
        if (!f) return;
        const img = await normalizeImage(f);
        w.image = img;
        w.imageUrl = URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
        imgInfo.textContent = `${f.name}（${img.width}×${img.height}）`;
        preview();
      } }, '選擇圖片（Logo、印章…）'),
      field('寬度（佔頁寬）', slider(0.05, 1, 0.01, w.imageScale, v => set('imageScale', v), v => Math.round(v * 100) + '%')));
    const vis = () => { textBox.hidden = w.kind !== 'text'; imgBox.hidden = w.kind !== 'image'; };
    vis();

    const angle = slider(-90, 90, 1, w.angle, v => set('angle', v), v => v + '°');
    const quick = h('div', { class: 'chips' }, ...[0, 30, 45, -45, 90].map(a => h('button', { type: 'button', class: 'chip', onclick: () => { angle.set(a); set('angle', a); } }, a + '°')));
    const pages = h('input', { type: 'text', value: w.pages, placeholder: '全部頁面', oninput: () => { set('pages', pages.value); pageHint(); } });
    const pageMsg = h('span', { class: 'field-hint' });
    const pageHint = () => { const n = parsePageRange(w.pages, this.session.pages.length).length; pageMsg.textContent = `套用到 ${n} 頁。例如：1-3,5、3-、奇數、偶數`; };
    pageHint();

    const node = h('div', { class: 'panel' },
      h('h2', {}, '加浮水印', h('kbd', {}, 'W')),
      field('種類', kind), textBox, imgBox,
      field('透明度', slider(0.05, 1, 0.01, w.opacity, v => set('opacity', v), v => Math.round(v * 100) + '%')),
      field('角度', angle), quick,
      field('排列', segmented([['center', '置中'], ['tile', '滿版重複'], ['top', '頁首'], ['bottom', '頁尾']], w.layout, v => set('layout', v))),
      field('位置', segmented([['over', '蓋在內容上'], ['under', '墊在內容下']], w.layer, v => set('layer', v)), '墊在下方比較不擋字，但如果頁面本身是白底圖片（例如掃描檔）會被蓋住看不到。'),
      field('頁面', pages), pageMsg,
      h('button', { type: 'button', class: 'btn primary block', onclick: () => app.applyWatermark({ ...w }) }, '套用浮水印'),
      h('p', { class: 'muted small' }, '頁面上的半透明圖樣是預覽。套用後仍可「復原」；之後也能用「去浮水印 → 標準浮水印」完整移除。'));
    setTimeout(preview, 0);
    return { node };
  }

  /** 畫面預覽用的規格（含每頁印章位置的計算方法） */
  _previewSpec() {
    const w = this.wm;
    let stampW, stampH;
    if (w.kind === 'text') {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${w.size}px ${FONT_CSS[w.font] || FONT_CSS.huninn}`;
      const lines = String(w.text).split('\n');
      stampW = Math.max(...lines.map(l => ctx.measureText(l).width));
      stampH = w.size * (1 + 1.2 * (lines.length - 1));
    } else if (!w.image) return null;
    return {
      ...w,
      pageIndexes: parsePageRange(w.pages, this.session.pages.length),
      placements: (g) => {
        let sw = stampW, sh = stampH;
        if (w.kind === 'image') { sw = g.width * w.imageScale; sh = sw * w.image.height / w.image.width; }
        return layoutCenters(w.layout, g, { w: sw, h: sh }, w.angle).map(([cx, cy]) => ({ cx, cy, w: sw, h: sh }));
      },
    };
  }

  // ================================================================ 去浮水印

  _unwatermarkPanel() {
    const app = this.app;
    const opts = { standard: false, text: '', layers: [], images: [] };
    const body = h('div', { class: 'group' }, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), '正在分析這份文件…'));
    const btn = h('button', { type: 'button', class: 'btn primary block', disabled: true, onclick: () => app.removeWatermark({ ...opts }) }, '移除選取的浮水印');
    const updateBtn = () => { btn.disabled = !(opts.standard || opts.text.trim() || opts.layers.length || opts.images.length); };
    const node = h('div', { class: 'panel' },
      h('h2', {}, '去浮水印', h('kbd', {}, 'U')),
      h('p', { class: 'muted' }, '小柯會掃描 PDF 的繪圖指令，把屬於浮水印的部分剪掉，正文不受影響。可以多種方式一起勾選。'),
      body, btn,
      h('div', { class: 'note' }, h('b', {}, '移不掉怎麼辦？'), ' 如果浮水印和內容一起「印」在掃描圖片裡，就無法分離。這時可以用', h('b', {}, '遮蓋'), '工具蓋掉，或用', h('b', {}, '改原文字'), '重打那一行。'));

    (async () => {
      let det, cands = [];
      try {
        [det, cands] = await Promise.all([detectWatermarks(this.session.baseBytes), app.renderer.watermarkTextCandidates().catch(() => [])]);
      } catch (e) {
        body.innerHTML = '';
        body.append(h('div', { class: 'note warn' }, '分析失敗：' + e.message));
        return;
      }
      body.innerHTML = '';
      // 1. 標準浮水印
      const stdCount = det.standardBlocks + det.standardAnnots;
      opts.standard = stdCount > 0;
      body.append(h('section', { class: 'wm-sec' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.standard, onchange: (e) => { opts.standard = e.target.checked; updateBtn(); } }), h('b', {}, '標準浮水印')),
        h('p', { class: 'muted small' }, stdCount ? `找到 ${stdCount} 處（Acrobat、小柯 App 或本網頁加入的浮水印）。` : '沒有找到標記為浮水印的內容。')));

      // 2. 依文字
      const tIn = h('input', { type: 'text', placeholder: '輸入浮水印上的字，例如：機密', oninput: () => { opts.text = tIn.value; updateBtn(); est(); } });
      const tMsg = h('p', { class: 'muted small' });
      let timer;
      const est = () => {
        clearTimeout(timer);
        const t = tIn.value.trim();
        if (!t) { tMsg.textContent = ''; return; }
        tMsg.textContent = '計算中…';
        timer = setTimeout(async () => {
          const r = await previewTextRemoval(this.session.baseBytes, t);
          if (tIn.value.trim() !== t) return;
          tMsg.textContent = r.blocks ? `會移除 ${r.blocks} 個文字區塊（${r.pages} 頁）。請確認不是正文。` : '找不到含有這段文字的區塊（字可能是圖片或外框線條）。';
          tMsg.classList.toggle('warn-text', r.blocks > 0 && r.pages < det.pageCount * 0.5 && det.pageCount > 2);
        }, 350);
      };
      body.append(h('section', { class: 'wm-sec' }, h('b', {}, '依文字移除'), tIn,
        cands.length ? h('div', { class: 'chips' }, ...cands.map(c => h('button', { type: 'button', class: 'chip', title: c.reason, onclick: () => { tIn.value = c.text; opts.text = c.text; updateBtn(); est(); } }, c.text, h('small', {}, c.reason)))) : null,
        tMsg));

      // 3. 圖層
      if (det.layers.length) {
        body.append(h('section', { class: 'wm-sec' }, h('b', {}, '依圖層移除'),
          ...det.layers.map(name => {
            const likely = /water|wm|浮水|水印|draft|confidential|機密/i.test(name);
            const cb = h('input', { type: 'checkbox', checked: likely, onchange: () => { opts.layers = cb.checked ? [...opts.layers, name] : opts.layers.filter(n => n !== name); updateBtn(); } });
            if (likely) opts.layers.push(name);
            return h('label', { class: 'check' }, cb, name, likely ? h('small', { class: 'tag' }, '可能是浮水印') : null);
          })));
      }

      // 4. 重複圖片
      if (det.images.length) {
        body.append(h('section', { class: 'wm-sec' }, h('b', {}, '每頁重複的圖片'),
          h('p', { class: 'muted small' }, '同一張圖出現在大部分頁面，常是 Logo 浮水印；但也可能是頁首的公司標誌，請確認。'),
          ...det.images.map((im, k) => {
            const cb = h('input', { type: 'checkbox', onchange: () => { opts.images = cb.checked ? [...opts.images, im.ref] : opts.images.filter(r => r !== im.ref); updateBtn(); } });
            return h('label', { class: 'check' }, cb, `圖片 ${k + 1}：${im.width}×${im.height} 像素，出現在 ${im.pages} 頁`);
          })));
      }
      updateBtn();
    })();
    return { node };
  }
}
