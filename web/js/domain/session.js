// =====================================================================
// 編輯工作階段（EditSession）
//
// 比喻：一本「工作日誌」。裡面記著：
//   1. 底稿（baseBytes）：目前的 PDF 原始位元組。加浮水印、去浮水印會直接換一份新底稿。
//   2. 貼紙清單（elements）：還沒印上去的編輯。
//   3. 歷史快照（history）：每一步之前先拍照，復原就是翻回上一張照片。
//
// 介面（UI）只能透過這裡的方法修改資料，修改後會發出事件通知畫面更新。
// =====================================================================

const MAX_HISTORY = 80;
let versionCounter = 0;   // 每份底稿一個獨一無二的版本號

export class EditSession extends EventTarget {
  constructor() {
    super();
    this.fileName = '';
    this.baseBytes = null;      // Uint8Array
    this.baseVersion = 0;       // 底稿換過幾次（畫面用來判斷要不要重畫頁面）
    this.pages = [];            // PageGeometry[]（由畫面載入 PDF 後填入）
    this.elements = [];         // PageElement[]
    this.undoStack = [];
    this.redoStack = [];
    this.savedMarker = null;    // 上次下載時的快照，用來判斷「有未儲存的變更」
    this._coalesce = null;      // 連續輸入合併成一步：{ key, time }
  }

  // ------------------------------------------------------------ 讀取

  get isOpen() { return !!this.baseBytes; }
  get(id) { return this.elements.find(e => e.id === id) || null; }
  elementsOn(pageIndex) { return this.elements.filter(e => e.pageIndex === pageIndex); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get dirty() { return this._snapshotKey() !== this.savedMarker; }

  // ------------------------------------------------------------ 開檔

  open(fileName, bytes) {
    this.fileName = fileName;
    this.baseBytes = bytes;
    this.baseVersion = ++versionCounter;
    this.elements = [];
    this.undoStack = [];
    this.redoStack = [];
    this.savedMarker = this._snapshotKey();
    this._emit('base');
    this._emit('elements');
    this._emit('history');
  }

  // ------------------------------------------------------------ 修改（全部都會記錄歷史）

  add(el, label = '新增' + el.label) {
    this._record(label);
    this.elements.push(el);
    this._emit('elements', { ids: [el.id] });
    return el;
  }

  /**
   * 修改一張貼紙。
   * @param {object} opts.coalesce 同一個 key 在 1.5 秒內的連續修改合併成一步（例如打字、拖拉滑桿）
   */
  update(id, changes, { label = '修改', coalesce = null } = {}) {
    const i = this.elements.findIndex(e => e.id === id);
    if (i < 0) return null;
    const now = Date.now();
    const merge = coalesce && this._coalesce && this._coalesce.key === coalesce && now - this._coalesce.time < 1500;
    if (!merge) this._record(label);
    this._coalesce = coalesce ? { key: coalesce, time: now } : null;
    this.elements[i] = this.elements[i].with(changes);
    this._emit('elements', { ids: [id] });
    return this.elements[i];
  }

  remove(id, label = '刪除') {
    const el = this.get(id);
    if (!el) return;
    this._record(label + el.label);
    this.elements = this.elements.filter(e => e.id !== id);
    this._emit('elements', { ids: [id], removed: true });
  }

  /** 改變上下順序（陣列越後面越上層） */
  reorder(id, where) {
    const el = this.get(id);
    if (!el) return;
    const others = this.elements.filter(e => e.id !== id);
    this._record(where === 'front' ? '移到最上層' : '移到最下層');
    this.elements = where === 'front' ? [...others, el] : [el, ...others];
    this._emit('elements', { ids: [id] });
  }

  /**
   * 取消剛剛新增的貼紙，就像它從來沒出現過（不留下歷史紀錄）。
   * 例如：按了「新增文字」但什麼都沒打就離開。
   */
  cancelAdd(id) {
    let snap = null;
    while (this.undoStack.length) {
      snap = this.undoStack.pop();
      if (!snap.elements.some(e => e.id === id)) break;   // 找到「新增之前」的那張快照
    }
    if (!snap || snap.base !== this.baseBytes) { this.remove(id); return; }
    this.elements = snap.elements.map(e => e.clone());
    this._coalesce = null;
    this._emit('elements', { ids: [id], removed: true });
    this._emit('history');
  }

  /** 換一份新底稿（加/去浮水印）。貼紙保留。 */
  replaceBase(bytes, label) {
    this._record(label);
    this.baseBytes = bytes;
    this.baseVersion = ++versionCounter;
    this._emit('base');
  }

  /** 頁面數量變了（例如重新載入），把超出範圍的貼紙移除 */
  setPages(pages) {
    this.pages = pages;
    const before = this.elements.length;
    this.elements = this.elements.filter(e => e.pageIndex < pages.length);
    if (this.elements.length !== before) this._emit('elements');
  }

  // ------------------------------------------------------------ 復原 / 重做

  undo() { this._travel(this.undoStack, this.redoStack); }
  redo() { this._travel(this.redoStack, this.undoStack); }

  markSaved() { this.savedMarker = this._snapshotKey(); this._emit('history'); }

  // ------------------------------------------------------------ 內部

  _snapshot(label) {
    return { label, base: this.baseBytes, baseVersion: this.baseVersion, elements: this.elements.map(e => e.clone()) };
  }

  _record(label) {
    this.undoStack.push(this._snapshot(label));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this._coalesce = null;
    queueMicrotask(() => this._emit('history'));
  }

  _travel(from, to) {
    const snap = from.pop();
    if (!snap) return;
    to.push(this._snapshot(snap.label));
    const baseChanged = snap.base !== this.baseBytes;
    this.baseBytes = snap.base;
    this.baseVersion = snap.baseVersion;
    this.elements = snap.elements.map(e => e.clone());
    this._coalesce = null;
    if (baseChanged) this._emit('base');
    this._emit('elements');
    this._emit('history', { label: snap.label });
  }

  /** 用來比較「現在」和「上次存檔」是否相同的簡單指紋 */
  _snapshotKey() {
    return this.baseVersion + '|' + this.elements.map(e => e.id + ':' + JSON.stringify(e, (k, v) => (v instanceof Uint8Array ? v.length : v))).join(';');
  }

  _emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
