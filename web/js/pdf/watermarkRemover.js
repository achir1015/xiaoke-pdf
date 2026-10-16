// =====================================================================
// 去除浮水印（WatermarkRemover）
//
// 比喻：拿著「繪圖食譜」逐行檢查，把畫浮水印的那幾行剪掉。四種辨認方法：
//   1. 標準浮水印：Acrobat、小柯 App、本網頁加的浮水印都會貼上
//      「/Artifact <</Subtype /Watermark>>」標籤，整段剪掉最乾淨。
//   2. 依文字：把每個文字區塊（BT…ET）解碼，含有指定字樣就整塊剪掉。
//   3. 依圖層：有些浮水印放在獨立圖層（選用內容 OCG），整層剪掉。
//   4. 重複圖片：每一頁都畫同一張圖（例如 Logo 浮水印），剪掉那個繪圖步驟。
//
// 與 Android 版 Watermark.java 的規則一致，兩邊加的浮水印可以互相移除。
// =====================================================================
import { PDFLib } from './libs.js';
import { parseContent, joinOps, latin1ToBytes } from './contentStream.js';
import { FontDecoder } from './fontDecoder.js';
import { normalizeCjk } from './util.js';
import { N, get, nameOf, textOf, streamText, pageContentText, setPageContent, rewriteStream, PDFDict, PDFArray, PDFRef, PDFStream } from './pdfObjects.js';

const { PDFDocument } = PDFLib;

/**
 * @typedef {object} RemoveOptions
 * @property {boolean} standard  移除標準浮水印（Artifact/Watermark 標記與浮水印註解）
 * @property {string}  text      依文字移除（空白＝不使用）
 * @property {string[]} layers   要移除的圖層名稱
 * @property {string[]} images   要移除的圖片（物件參照字串，如 "12 0 R"）
 */

/** 先掃描一遍，告訴使用者這份文件裡可能有哪些浮水印 */
export async function detectWatermarks(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const report = await scan(doc, { standard: true, text: '', layers: [], images: [] }, { dryRun: true, collectImages: true });

  // 重複圖片：出現在至少 2 頁、且至少六成頁面的同一張圖
  const minPages = Math.max(2, Math.ceil(pages.length * 0.6));
  const images = [...report.imageUse.values()]
    .filter(u => pages.length >= 2 && u.pages.size >= minPages)
    .map(u => ({ ref: u.ref, width: u.width, height: u.height, pages: u.pages.size }));

  return {
    pageCount: pages.length,
    standardBlocks: report.blocks,
    standardAnnots: report.annots,
    layers: listLayers(doc),
    images,
  };
}

/** 預估「依文字移除」會刪掉多少區塊（不修改文件） */
export async function previewTextRemoval(bytes, text) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const r = await scan(doc, { standard: false, text, layers: [], images: [] }, { dryRun: true });
  return { blocks: r.blocks, pages: r.pages };
}

/** 真正移除，回傳新的 PDF 位元組與統計 */
export async function removeWatermarks(bytes, opts) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const report = await scan(doc, opts, { dryRun: false });
  if (opts.layers?.length) removeLayerDefinitions(doc, new Set(opts.layers));
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, report: { blocks: report.blocks, annots: report.annots, images: report.images, pages: report.pages } };
}

// ------------------------------------------------------------------ 掃描與過濾

async function scan(doc, opts, { dryRun, collectImages = false }) {
  const ctx = doc.context;
  const rep = { blocks: 0, annots: 0, images: 0, pages: 0, imageUse: new Map() };
  const state = {
    ctx, opts, rep, dryRun, collectImages,
    layers: new Set(opts.layers || []),
    images: new Set(opts.images || []),
    target: norm(opts.text || ''),
    doneForms: new Set(),
    decoders: new Map(),
    pageIndex: 0,
  };

  doc.getPages().forEach((page, pageIndex) => {
    state.pageIndex = pageIndex;
    const before = rep.blocks + rep.annots + rep.images;
    let src;
    try { src = pageContentText(page); } catch (e) { return; }
    const res = page.node.Resources();
    const result = filterOps(src, res, state, 0);
    if (result.changed && !dryRun) setPageContent(page, latin1ToBytes(result.text));

    if (opts.standard) {
      const annots = page.node.Annots();
      if (annots instanceof PDFArray) {
        const keep = [];
        let removed = 0;
        for (let i = 0; i < annots.size(); i++) {
          const raw = annots.get(i);
          const a = annots.lookup(i);
          if (a instanceof PDFDict && nameOf(get(a, 'Subtype', ctx)) === 'Watermark') removed++;
          else keep.push(raw);
        }
        if (removed) {
          rep.annots += removed;
          if (!dryRun) page.node.set(N('Annots'), ctx.obj(keep));
        }
      }
    }
    if (rep.blocks + rep.annots + rep.images > before) rep.pages++;
  });
  return rep;
}

/** 過濾一段內容串流。回傳 { changed, text } */
function filterOps(src, res, st, depth) {
  const ops = parseContent(src);
  const out = [];
  const mcStack = [];      // 標記內容堆疊：true＝這段要移除
  let removing = 0;
  let changed = false;
  let textBlock = null;    // BT…ET 暫存
  let blockText = '';
  let decoder = null;

  for (const o of ops) {
    const name = o.op;

    if (name === 'BDC' || name === 'BMC') {
      const rm = removing > 0 || isWatermarkMark(o.args, res, st);
      mcStack.push(rm);
      if (rm) { if (removing === 0) st.rep.blocks++; removing++; changed = true; continue; }
    } else if (name === 'EMC') {
      const rm = mcStack.length ? mcStack.pop() : false;
      if (rm) { removing--; continue; }
    }
    if (removing > 0) continue;

    // 畫 XObject：表單要往裡面找，圖片要看是不是重複的浮水印圖
    if (name === 'Do' && o.args[0]?.t === 'name' && res) {
      const handled = handleXObject(o.args[0].v, res, st, depth);
      if (handled === 'remove') { st.rep.images++; changed = true; continue; }
    }

    // 依文字移除：整個 BT…ET 區塊暫存起來，看完才決定去留
    if (st.target) {
      if (name === 'BT') { textBlock = []; blockText = ''; }
      if (textBlock) {
        textBlock.push(o);
        if (name === 'Tf' && o.args[0]?.t === 'name') decoder = decoderFor(o.args[0].v, res, st);
        else if ((name === 'Tj' || name === "'") && o.args[0]?.t === 'str') blockText += decode(decoder, o.args[0].v);
        else if (name === '"' && o.args[2]?.t === 'str') blockText += decode(decoder, o.args[2].v);
        else if (name === 'TJ' && o.args[0]?.t === 'arr') {
          for (const item of o.args[0].v) if (item.t === 'str') blockText += decode(decoder, item.v);
        }
        if (name === 'ET') {
          if (norm(blockText).includes(st.target)) { st.rep.blocks++; changed = true; }
          else out.push(...textBlock);
          textBlock = null;
        }
        continue;
      }
    }
    out.push(o);
  }
  if (textBlock) out.push(...textBlock);
  return { changed, text: changed ? joinOps(src, out) : src };
}

function handleXObject(name, res, st, depth) {
  const xobjs = get(res, 'XObject', st.ctx);
  if (!(xobjs instanceof PDFDict)) return null;
  const raw = xobjs.get(N(name));
  const ref = raw instanceof PDFRef ? raw : null;
  const x = ref ? st.ctx.lookup(ref) : raw;
  if (!(x instanceof PDFStream)) return null;
  const sub = nameOf(get(x.dict, 'Subtype', st.ctx));

  if (sub === 'Image') {
    const key = ref ? ref.toString() : null;
    if (key && st.collectImages) {
      let u = st.rep.imageUse.get(key);
      if (!u) {
        u = { ref: key, pages: new Set(), width: get(x.dict, 'Width', st.ctx)?.asNumber?.() || 0, height: get(x.dict, 'Height', st.ctx)?.asNumber?.() || 0 };
        st.rep.imageUse.set(key, u);
      }
      u.pages.add(st.pageIndex);
    }
    if (key && st.images.has(key)) return 'remove';
    return null;
  }

  if (sub === 'Form' && depth < 6) {
    const formKey = ref ? ref.toString() : null;
    if (formKey && st.doneForms.has(formKey) && !st.collectImages) return null;
    if (formKey) st.doneForms.add(formKey);
    let src;
    try { src = streamText(x); } catch (e) { return null; }
    const formRes = get(x.dict, 'Resources', st.ctx) || res;
    const r = filterOps(src, formRes, st, depth + 1);
    if (r.changed && !st.dryRun && ref) rewriteStream(st.ctx, ref, x, latin1ToBytes(r.text));
  }
  return null;
}

function isWatermarkMark(args, res, st) {
  if (!args.length || args[0].t !== 'name') return false;
  const tag = args[0].v;
  let props = null;      // 統一成 { get(key) } 介面
  if (args[1]?.t === 'dict') {
    const d = args[1].v;
    props = { subtype: d.Subtype?.v, name: d.Name?.t === 'str' ? d.Name.v : null, ocgs: null };
  } else if (args[1]?.t === 'name' && res) {
    const all = get(res, 'Properties', st.ctx);
    const p = all instanceof PDFDict ? get(all, args[1].v, st.ctx) : null;
    if (p instanceof PDFDict) props = { subtype: nameOf(get(p, 'Subtype', st.ctx)), name: textOf(get(p, 'Name', st.ctx)), ocgs: get(p, 'OCGs', st.ctx) };
  }
  if (!props) return false;
  if (st.opts.standard && tag === 'Artifact' && props.subtype === 'Watermark') return true;
  if (st.layers.size && tag === 'OC') {
    if (props.name && st.layers.has(props.name)) return true;
    // 選用內容成員字典（OCMD）：看它包含的圖層
    const ocgs = props.ocgs;
    const list = ocgs instanceof PDFArray ? [...Array(ocgs.size()).keys()].map(i => ocgs.lookup(i)) : ocgs ? [ocgs] : [];
    for (const g of list) if (g instanceof PDFDict && st.layers.has(textOf(get(g, 'Name', st.ctx)))) return true;
  }
  return false;
}

function decoderFor(fontName, res, st) {
  const fonts = get(res, 'Font', st.ctx);
  if (!(fonts instanceof PDFDict)) return null;
  const raw = fonts.get(N(fontName));
  const key = raw instanceof PDFRef ? raw.toString() : null;
  if (key && st.decoders.has(key)) return st.decoders.get(key);
  const f = raw instanceof PDFRef ? st.ctx.lookup(raw) : raw;
  const dec = f instanceof PDFDict ? new FontDecoder(f, st.ctx) : null;
  if (key) st.decoders.set(key, dec);
  return dec;
}

const decode = (decoder, s) => (decoder ? decoder.decode(s) : s);
const norm = (s) => normalizeCjk(s).replace(/\s+/g, '').toLowerCase();

// ------------------------------------------------------------------ 圖層

function ocProperties(doc) {
  const ocp = get(doc.catalog, 'OCProperties', doc.context);
  return ocp instanceof PDFDict ? ocp : null;
}

/** 列出文件裡所有圖層名稱 */
export function listLayers(doc) {
  const ocp = ocProperties(doc);
  const ocgs = ocp ? get(ocp, 'OCGs', doc.context) : null;
  if (!(ocgs instanceof PDFArray)) return [];
  const names = [];
  for (let i = 0; i < ocgs.size(); i++) {
    const g = ocgs.lookup(i);
    const nm = g instanceof PDFDict ? textOf(get(g, 'Name', doc.context)) : null;
    if (nm && !names.includes(nm)) names.push(nm);
  }
  return names;
}

/** 把圖層定義也拿掉（內容已經在上面剪掉了） */
function removeLayerDefinitions(doc, names) {
  const ctx = doc.context;
  const ocp = ocProperties(doc);
  if (!ocp) return;
  const gone = new Set();
  const prune = (arr, collect) => {
    if (!(arr instanceof PDFArray)) return;
    for (let i = arr.size() - 1; i >= 0; i--) {
      const raw = arr.get(i);
      const g = arr.lookup(i);
      const key = raw instanceof PDFRef ? raw.toString() : null;
      const hit = collect
        ? g instanceof PDFDict && names.has(textOf(get(g, 'Name', ctx)))
        : key && gone.has(key);
      if (hit) { if (collect && key) gone.add(key); arr.remove(i); }
      else if (!collect && g instanceof PDFArray) prune(g, false);   // Order 可能是巢狀陣列
    }
  };
  prune(get(ocp, 'OCGs', ctx), true);
  const d = get(ocp, 'D', ctx);
  if (d instanceof PDFDict) for (const k of ['ON', 'OFF', 'Order', 'Locked']) prune(get(d, k, ctx), false);
}
