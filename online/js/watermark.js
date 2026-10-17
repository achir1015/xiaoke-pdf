// 移除浮水印：標準（Artifact/Watermark 標記、浮水印註解）、依文字、依圖層
import { L, N, tokenize, serialize, pageContent, setPageContent, fontDecoder, streamBytes } from './core.js';

const { PDFDict, PDFArray, PDFRawStream } = L;
const norm = s => s.replace(/\s+/g, '').toLowerCase();

export function layerNames(d) {
  try { return d.getOptionalContentGroups().map(g => g.name || g.getName && g.getName()).filter(Boolean); } catch {}
  const out = [];
  const oc = d.catalog.lookup(N('OCProperties'));
  const arr = oc instanceof PDFDict ? oc.lookup(N('OCGs')) : null;
  if (arr instanceof PDFArray) for (let i = 0; i < arr.size(); i++) { const g = arr.lookup(i); try { out.push(g.lookup(N('Name')).decodeText()); } catch {} }
  return out;
}

/** opts: {standard, text, layers:Set<string>}；回傳 {blocks, annots, pages} */
export function removeWatermarks(d, opts) {
  const rep = { blocks: 0, annots: 0, pages: 0 };
  const doneForms = new Set();
  const want = opts.text ? norm(opts.text) : '';
  const decoders = new Map();

  const resLookup = (res, cat, key) => {
    if (!(res instanceof PDFDict)) return null;
    const c = res.lookup(N(cat));
    return c instanceof PDFDict ? c.lookup(N(key)) : null;
  };
  const decoderFor = (res, fontName) => {
    const f = resLookup(res, 'Font', fontName);
    if (!f) return s => s;
    if (!decoders.has(f)) decoders.set(f, fontDecoder(d.context, f));
    return decoders.get(f);
  };
  const isWatermarkMark = (unit, res) => {
    const tag = unit[0];
    if (!tag || tag.k !== 'name') return false;
    let props = null;
    if (unit.length >= 3) {
      const p = unit[1];
      if (p.k === 'dict') props = { get: k => p.v[k], str: k => p.v[k] && (p.v[k].k === 'name' ? p.v[k].v : p.v[k].v) };
      else if (p.k === 'name') {
        const dct = resLookup(res, 'Properties', p.v);
        if (dct instanceof PDFDict) props = { get: () => null, str: k => { const v = dct.lookup(N(k)); try { return v.decodeText ? v.decodeText() : v.asString().replace(/^\//, ''); } catch { return null; } }, dict: dct };
      }
    }
    if (opts.standard && tag.v === 'Artifact' && props && props.str('Subtype') === 'Watermark') return true;
    if (opts.layers && opts.layers.size && tag.v === 'OC' && props) {
      const nm = props.str('Name');
      if (nm && opts.layers.has(nm)) return true;
      if (props.dict) {
        const ocgs = props.dict.lookup(N('OCGs'));
        if (ocgs instanceof PDFDict) { try { if (opts.layers.has(ocgs.lookup(N('Name')).decodeText())) return true; } catch {} }
      }
    }
    return false;
  };

  /** 回傳新的 token 陣列；沒有變動回傳 null */
  const filter = (tokens, res, depth) => {
    const out = [];
    let operands = [];
    const mc = [];
    let removing = 0, changed = false, block = null, blockText = '', decode = s => s;
    for (const t of tokens) {
      if (t.k !== 'op') { operands.push(t); continue; }
      const unit = [...operands, t];
      operands = [];
      const name = t.v;
      if (name === 'BDC' || name === 'BMC') {
        const rm = removing > 0 || isWatermarkMark(unit, res);
        mc.push(rm);
        if (rm) { if (!removing) rep.blocks++; removing++; changed = true; continue; }
      } else if (name === 'EMC') {
        const rm = mc.length ? mc.pop() : false;
        if (rm) { removing--; continue; }
      }
      if (removing) continue;
      if (name === 'Do' && unit[0] && unit[0].k === 'name' && depth < 6) {
        const x = resLookup(res, 'XObject', unit[0].v);
        if (x instanceof PDFRawStream && !doneForms.has(x) && x.dict.lookup(N('Subtype')) === N('Form')) {
          doneForms.add(x);
          try {
            const fr = x.dict.lookup(N('Resources')) || res;
            const ft = filter(tokenize(streamBytes(x)), fr, depth + 1);
            if (ft) {
              const ns = d.context.flateStream(serialize(ft), Object.fromEntries([...x.dict.entries()].filter(([k]) => !['Filter', 'Length', 'DecodeParms'].includes(k.asString().slice(1))).map(([k, v]) => [k.asString().slice(1), v])));
              const ref = [...d.context.enumerateIndirectObjects()].find(([, o]) => o === x);
              if (ref) d.context.assign(ref[0], ns);
            }
          } catch {}
        }
      }
      if (want) {
        if (name === 'BT') { block = []; blockText = ''; }
        if (block) {
          block.push(...unit);
          if (name === 'Tf' && unit[0] && unit[0].k === 'name') decode = decoderFor(res, unit[0].v);
          else if ((name === 'Tj' || name === "'" || name === '"') && unit.length >= 2) { const s = unit[unit.length - 2]; if (s.k === 'str' || s.k === 'hex') blockText += decode(s.v); }
          else if (name === 'TJ' && unit[0] && unit[0].k === 'arr') for (const e of unit[0].v) if (e.k === 'str' || e.k === 'hex') blockText += decode(e.v);
          if (name === 'ET') {
            if (norm(blockText).includes(want)) { rep.blocks++; changed = true; } else out.push(...block);
            block = null;
          }
          continue;
        }
      }
      out.push(...unit);
    }
    if (block) out.push(...block);
    out.push(...operands);
    return changed ? out : null;
  };

  d.getPages().forEach(page => {
    const before = rep.blocks + rep.annots;
    let tokens;
    try { tokens = tokenize(pageContent(page)); } catch { return; }
    const res = page.node.Resources();
    const out = filter(tokens, res, 0);
    if (out) setPageContent(d, page, serialize(out));
    if (opts.standard) {
      const a = page.node.Annots();
      if (a) {
        const keep = [];
        for (let k = 0; k < a.size(); k++) {
          const o = a.lookup(k);
          if (o instanceof PDFDict && o.lookup(N('Subtype')) === N('Watermark')) rep.annots++; else keep.push(a.get(k));
        }
        if (keep.length !== a.size()) page.node.set(N('Annots'), d.context.obj(keep));
      }
    }
    if (rep.blocks + rep.annots > before) rep.pages++;
  });

  if (opts.layers && opts.layers.size) removeLayers(d, opts.layers);
  return rep;
}

function removeLayers(d, names) {
  const oc = d.catalog.lookup(N('OCProperties'));
  if (!(oc instanceof PDFDict)) return;
  const arr = oc.lookup(N('OCGs'));
  if (!(arr instanceof PDFArray)) return;
  const gone = new Set();
  for (let i = arr.size() - 1; i >= 0; i--) {
    const g = arr.lookup(i);
    let nm = '';
    try { nm = g.lookup(N('Name')).decodeText(); } catch {}
    if (names.has(nm)) { gone.add(arr.get(i).toString()); arr.remove(i); }
  }
  const D = oc.lookup(N('D'));
  if (D instanceof PDFDict) for (const k of ['ON', 'OFF', 'Order']) {
    const x = D.lookup(N(k));
    if (x instanceof PDFArray) for (let i = x.size() - 1; i >= 0; i--) if (gone.has(String(x.get(i)))) x.remove(i);
  }
}
