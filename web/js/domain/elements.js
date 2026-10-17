// =====================================================================
// 頁面元素（領域模型）
//
// 比喻：原始 PDF 是一張「底稿」，使用者的每一次編輯都是貼在底稿上的「貼紙」。
// 貼紙可以移動、修改、撕掉，直到按「下載」時才真正印到 PDF 上。
//
// 座標系統：「顯示座標」——頁面以 100% 縮放、套用頁面旋轉後，
// 左上角為原點 (0,0)，往右 x 增加、往下 y 增加，單位是 PDF 點 (pt, 1/72 吋)。
// 匯出時再由 PageGeometry 換算成 PDF 自己的座標。
// =====================================================================

let seq = 0;
export const newId = (prefix = 'el') => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/** 所有貼紙的共同祖先：知道自己在哪一頁、哪個位置、多大。 */
export class PageElement {
  constructor({ id, pageIndex = 0, x = 0, y = 0, w = 100, h = 30 } = {}) {
    this.id = id || newId(this.constructor.kind);
    this.pageIndex = pageIndex;
    this.x = x; this.y = y; this.w = w; this.h = h;
  }
  static kind = 'element';
  get kind() { return this.constructor.kind; }
  /** 可以用拖曳控制點改變大小嗎？ */
  get resizable() { return true; }
  /** 給使用者看的名稱 */
  get label() { return '元素'; }

  /** 複製一份（歷史紀錄用）。二進位資料（圖片、影音檔）不會被複製，只共用參照。 */
  clone() {
    const c = Object.create(Object.getPrototypeOf(this));
    Object.assign(c, this);
    if (this.patch) c.patch = { ...this.patch };
    return c;
  }
  /** 套用一組變更，回傳新的貼紙（不修改原本的，方便復原）。 */
  with(changes) { return Object.assign(this.clone(), changes); }
}

/** 文字貼紙：新增文字，或「編輯原文字」時取代原本那一行。 */
export class TextElement extends PageElement {
  static kind = 'text';
  constructor(o = {}) {
    super(o);
    this.text = o.text ?? '';
    this.font = o.font ?? 'huninn';          // huninn（粉圓，支援中文）| Helvetica | Times | Courier
    this.size = o.size ?? 16;                 // 字級（pt）
    this.lineHeight = o.lineHeight ?? 1.3;    // 行高倍數
    this.color = o.color ?? '#1d1f23';
    this.bgColor = o.bgColor ?? null;         // 文字背景色（null＝透明）
    this.bold = !!o.bold;
    this.underline = !!o.underline;
    this.strike = !!o.strike;
    this.align = o.align ?? 'left';           // left | center | right（多行時的對齊）
    // 「編輯原文字」時要蓋掉的原始區域（顯示座標），null＝單純新增的文字
    this.patch = o.patch ? { ...o.patch } : null;
    // 自動換行的寬度（pt）；null＝不換行。表格儲存格裡的文字用格子寬度
    this.maxW = o.maxW ?? null;
  }
  get resizable() { return false; }           // 文字大小由字級決定，寬高自動量測
  get label() { return this.patch ? '修改的文字' : '文字'; }
  get lines() { return String(this.text).split('\n'); }
}

/** 遮蓋貼紙：像修正帶，蓋住不要的內容（例如浮水印殘影、錯字、個資）。 */
export class CoverElement extends PageElement {
  static kind = 'cover';
  constructor(o = {}) {
    super(o);
    this.color = o.color ?? '#ffffff';
  }
  get label() { return '遮蓋'; }
}

/** 網址連結貼紙：可以是一段可點擊的文字，也可以是一塊透明的點擊區域。 */
export class LinkElement extends PageElement {
  static kind = 'link';
  constructor(o = {}) {
    super(o);
    this.url = o.url ?? '';
    this.text = o.text ?? '';                 // 空字串＝只是透明點擊區（蓋在原本的字上）
    this.size = o.size ?? 14;
    this.color = o.color ?? '#1e63e9';
    this.underline = o.underline ?? true;
  }
  get resizable() { return !this.text; }
  get label() { return '網址連結'; }
  get isArea() { return !this.text; }
}

/**
 * 影音貼紙：在頁面上放一張「播放卡片」。
 * - 線上影音（YouTube 或任何網址）：卡片整塊可點擊開啟，並可附 QR Code 給紙本讀者掃描。
 * - 本機影音檔：檔案直接嵌入 PDF 成為附件，在 Acrobat / Foxit 等閱讀器點附件圖示即可播放。
 */
export class MediaElement extends PageElement {
  static kind = 'media';
  constructor(o = {}) {
    super(o);
    this.source = o.source ?? 'url';          // url | file
    this.url = o.url ?? '';
    this.title = o.title ?? '';
    this.showQr = o.showQr ?? true;
    this.mediaType = o.mediaType ?? 'video';  // video | audio
    this.file = o.file ?? null;               // { name, mime, bytes: Uint8Array }（共用參照，不複製）
    this.poster = o.poster ?? null;           // 封面圖 dataURL（YouTube 縮圖等，可能抓不到）
  }
  get label() { return this.mediaType === 'audio' ? '音訊' : '影片'; }
  get youtubeId() { return youtubeIdOf(this.url); }
  /** 卡片上顯示的標題 */
  get displayTitle() {
    if (this.title) return this.title;
    if (this.source === 'file' && this.file) return this.file.name;
    if (this.youtubeId) return 'YouTube 影片';
    return this.mediaType === 'audio' ? '音訊' : '影片';
  }
}

/** 圖片貼紙 */
export class ImageElement extends PageElement {
  static kind = 'image';
  constructor(o = {}) {
    super(o);
    this.image = o.image ?? null;             // { mime, bytes: Uint8Array, url: objectURL }
    this.opacity = o.opacity ?? 1;
  }
  get label() { return '圖片'; }
}

export const ELEMENT_CLASSES = { text: TextElement, cover: CoverElement, link: LinkElement, media: MediaElement, image: ImageElement };

/** 從網址取出 YouTube 影片 ID，不是 YouTube 就回傳 null */
export function youtubeIdOf(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** 補上 https://（使用者常只打 www.xxx.com） */
export function normalizeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^(https?:|mailto:|tel:|ftp:)/i.test(u)) return u;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return 'mailto:' + u;
  return 'https://' + u;
}
