// 數位簽章：PKCS#12 憑證簽署（增量寫入）、驗證、自簽憑證。憑證存在瀏覽器的 IndexedDB。
import { L, N, T, D, loadLib, latin1, boxMatrix, pdfRect } from './core.js';
import { vpOf } from './ops.js';
import { idb } from './util.js';

const { PDFArray, PDFNumber, PDFName, PDFHexString, PDFString, PDFInvalidObject, PDFOperator } = L;
const SIG_LEN = 16384;   // 簽章預留空間（十六進位字元數 / 2）

const f = () => window.forge;

export async function listCerts() {
  const keys = await idb.keys('certs');
  return keys.map(String).sort();
}
export async function getCert(name) { return await idb.get('certs', name); }
export async function saveCert(name, bytes) { await idb.set('certs', name, bytes); }
export async function deleteCert(name) { await idb.del('certs', name); }

function parseP12(bytes, password) {
  const forge = f();
  const der = forge.util.createBuffer(latin1(new Uint8Array(bytes)));
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password); }
  catch { throw new Error('無法開啟憑證：密碼錯誤或格式不支援'); }
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const keyBag2 = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  const key = (keyBags[0] || keyBag2[0] || {}).key;
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(b => b.cert).filter(Boolean);
  if (!key || !certs.length) throw new Error('憑證裡沒有私鑰');
  // 找出與私鑰配對的憑證
  let cert = certs.find(c => c.publicKey && c.publicKey.n && key.n && c.publicKey.n.equals(key.n)) || certs[0];
  return { key, cert, chain: certs };
}

const cn = cert => { const a = cert.subject.getField('CN'); return a ? a.value : cert.subject.attributes.map(x => x.value).join(', '); };

export function describe(bytes, password) {
  const { cert } = parseP12(bytes, password);
  const dt = d => d.toLocaleString('zh-TW');
  return `主體：${cert.subject.attributes.map(a => `${a.shortName || a.name}=${a.value}`).join(', ')}\n簽發者：${cert.issuer.attributes.map(a => `${a.shortName || a.name}=${a.value}`).join(', ')}\n有效期限：${dt(cert.validity.notBefore)} ～ ${dt(cert.validity.notAfter)}`;
}

/** 建立自簽憑證（RSA 2048、SHA-256、十年），回傳 p12 bytes */
export function createSelfSigned(name, email, password) {
  const forge = f();
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1, workerScript: 'vendor/prime.worker.min.js' }, (err, keys) => {
      if (err) {
        // 沒有 worker 檔時改用分段計算
        forge.pki.rsa.generateKeyPair({ bits: 2048 }, (e2, k2) => e2 ? reject(e2) : resolve(build(k2)));
        return;
      }
      resolve(build(keys));
    });
  });
  function build(keys) {
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01' + Date.now().toString(16);
    cert.validity.notBefore = new Date(Date.now() - 86400000);
    cert.validity.notAfter = new Date(Date.now() + 3650 * 86400000);
    const attrs = [{ name: 'commonName', value: name }, { name: 'organizationName', value: 'XiaoKe PDF' }];
    if (email) attrs.push({ name: 'emailAddress', value: email });
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des', friendlyName: name });
    const der = forge.asn1.toDer(p12).getBytes();
    const out = new Uint8Array(der.length);
    for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i);
    return out;
  }
}

/**
 * 簽署：在目前的 bytes 後面增量加上簽章（原本的位元組不變）。
 * visible：{page, rect(基準顯示座標), png} 或 null
 */
export async function sign(bytes, p12, password, { reason, location, visible }) {
  const forge = f();
  const { key, cert, chain } = parseP12(p12, password);
  const nowD = new Date();
  if (cert.validity.notAfter < nowD || cert.validity.notBefore > nowD) throw new Error('憑證已過期或尚未生效');
  const d = await L.PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const pageIdx = visible ? visible.page : 0;
  const page = d.getPage(pageIdx);
  const byteRange = PDFArray.withContext(d.context);
  byteRange.push(PDFNumber.of(0));
  byteRange.push(PDFName.of('**********'));
  byteRange.push(PDFName.of('**********'));
  byteRange.push(PDFName.of('**********'));
  const sigDict = d.context.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: byteRange,
    Contents: PDFHexString.of('0'.repeat(SIG_LEN * 2)), M: PDFString.fromDate(nowD), Name: T(cn(cert)),
    ...(reason ? { Reason: T(reason) } : {}), ...(location ? { Location: T(location) } : {}),
    Prop_Build: { Filter: { Name: 'Adobe.PPKLite' }, App: { Name: 'XiaoKe PDF Web' } },
  });
  const buf = new Uint8Array(sigDict.sizeInBytes());
  sigDict.copyBytesInto(buf, 0);
  const sigRef = d.context.register(PDFInvalidObject.of(buf));
  let rect = [0, 0, 0, 0], apOps = [], res = {};
  if (visible) {
    const vp = vpOf(page);
    rect = pdfRect(vp, visible.rect);
    const img = await d.embedPng(visible.png);
    const m = boxMatrix(vp, visible.rect, [rect[0], rect[1]]);
    apOps = [PDFOperator.of('q'), PDFOperator.of('cm', m.map(PDFNumber.of)), PDFOperator.of('cm', [visible.rect.w, 0, 0, visible.rect.h, 0, 0].map(PDFNumber.of)),
      PDFOperator.of('Do', [N('Im0')]), PDFOperator.of('Q')];
    res = { XObject: { Im0: img.ref } };
  }
  const ap = d.context.formXObject(apOps, { BBox: [0, 0, rect[2] - rect[0], rect[3] - rect[1]], Resources: res });
  const widget = d.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: rect, V: sigRef, T: T('Signature' + Date.now()), F: 4, P: page.ref, AP: { N: d.context.register(ap) } });
  const wRef = d.context.register(widget);
  page.node.addAnnot(wRef);
  const acro = d.catalog.getOrCreateAcroForm();
  acro.addField(wRef);
  acro.dict.set(N('SigFlags'), PDFNumber.of(3));
  const pdf = await d.save({ useObjectStreams: false });

  // 找出預留位置，填入 ByteRange 與簽章
  const s = latin1(pdf);
  const zeros = '<' + '0'.repeat(SIG_LEN * 2) + '>';
  const contentsStart = s.lastIndexOf(zeros);
  if (contentsStart < 0) throw new Error('找不到簽章預留位置');
  const contentsEnd = contentsStart + zeros.length;
  const ph = s.lastIndexOf('/**********', contentsStart + s.length) >= 0 ? s.lastIndexOf('/**********') : -1;
  if (ph < 0) throw new Error('找不到 ByteRange 預留位置');
  const brStart = s.lastIndexOf('[', ph), brEnd = s.indexOf(']', ph);
  const ranges = [0, contentsStart, contentsEnd, pdf.length - contentsEnd];
  let brStr = `[${ranges.join(' ')}]`;
  if (brStr.length > brEnd - brStart + 1) throw new Error('ByteRange 預留空間不足');
  brStr = brStr.slice(0, -1).padEnd(brEnd - brStart, ' ') + ']';
  const out = new Uint8Array(pdf);
  for (let i = 0; i < brStr.length; i++) out[brStart + i] = brStr.charCodeAt(i);
  const signed = latin1(out.subarray(0, contentsStart)) + latin1(out.subarray(contentsEnd));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(signed, 'raw');
  for (const c of chain) p7.addCertificate(c);
  p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [{ type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: nowD }] });
  p7.sign({ detached: true });
  const hex = forge.util.bytesToHex(forge.asn1.toDer(p7.toAsn1()).getBytes());
  if (hex.length > SIG_LEN * 2) throw new Error('簽章太大');
  const padded = hex.padEnd(SIG_LEN * 2, '0');
  for (let i = 0; i < padded.length; i++) out[contentsStart + 1 + i] = padded.charCodeAt(i);
  return out;
}

/** 驗證所有簽章 */
export async function verify(bytes) {
  const forge = f();
  const s = latin1(bytes);
  const out = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m;
  while ((m = re.exec(s))) {
    const [a, b, c, dd] = m.slice(1).map(Number);
    const r = { name: '', date: '', reason: '', location: '', signer: '', valid: false, coversAll: c + dd === bytes.length, status: '' };
    try {
      const hex = s.slice(a + b + 1, c - 1).replace(/[^0-9a-fA-F]/g, '').replace(/(00)+$/, '');
      const der = forge.util.hexToBytes(hex.length % 2 ? hex + '0' : hex);
      const msg = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der, { strict: false }));
      const signedData = s.slice(a, a + b) + s.slice(c, c + dd);
      const cert = msg.certificates[0];
      r.signer = cert ? cert.subject.attributes.map(x => `${x.shortName || x.name}=${x.value}`).join(', ') : '';
      // 從 ASN.1 取出 signerInfo
      const asn = forge.asn1.fromDer(der, { strict: false });
      const sd = asn.value[1].value[0];
      const signerInfos = sd.value[sd.value.length - 1].value;
      const si = signerInfos[0].value;
      let attrsAsn = null, sigBytes = null, digestOid = forge.pki.oids.sha256;
      for (const node of si) {
        if (node.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && node.type === 0) attrsAsn = node;
        if (node.type === forge.asn1.Type.OCTETSTRING) sigBytes = node.value;
        if (node.type === forge.asn1.Type.SEQUENCE && node.value[0] && node.value[0].type === forge.asn1.Type.OID && !digestOid.__set) {
          const oid = forge.asn1.derToOid(node.value[0].value);
          if (forge.pki.oids[oid] && /sha/i.test(forge.pki.oids[oid])) { digestOid = oid; digestOid.__set = true; }
        }
      }
      const mdName = (forge.pki.oids[digestOid] || 'sha256').toLowerCase();
      const md = (forge.md[mdName] || forge.md.sha256).create();
      md.update(signedData);
      const contentDigest = md.digest().getBytes();
      let ok = false, digestOk = false;
      if (attrsAsn) {
        for (const at of attrsAsn.value) {
          const oid = forge.asn1.derToOid(at.value[0].value);
          if (oid === forge.pki.oids.messageDigest) digestOk = at.value[1].value[0].value === contentDigest;
          if (oid === forge.pki.oids.signingTime) { try { r.date = forge.asn1.utcTimeToDate(at.value[1].value[0].value).toLocaleString('zh-TW'); } catch {} }
        }
        const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrsAsn.value);
        const md2 = (forge.md[mdName] || forge.md.sha256).create();
        md2.update(forge.asn1.toDer(set).getBytes());
        ok = digestOk && cert && cert.publicKey.verify(md2.digest().getBytes(), sigBytes);
      }
      r.valid = !!ok;
      r.status = r.valid ? (r.coversAll ? '簽章有效，簽署後文件沒有被修改' : '簽章有效，但簽署後文件又有新的修改') : '簽章無效：內容已被竄改或簽章損壞';
    } catch (e) { r.status = '無法驗證：' + (e.message || e); }
    // 名稱、原因
    const dictStart = s.lastIndexOf('<<', m.index), dictEnd = s.indexOf('>>', m.index + m[0].length + SIG_LEN * 2);
    const dict = s.slice(dictStart, Math.min(dictEnd + 2, dictStart + SIG_LEN * 2 + 4000));
    const get = k => { const x = new RegExp('/' + k + '\\s*(<[0-9A-Fa-f]*>|\\((?:\\\\.|[^\\\\)])*\\))').exec(dict); return x ? decodePdfStr(x[1]) : ''; };
    r.name = get('Name'); r.reason = get('Reason'); r.location = get('Location');
    out.push(r);
  }
  return out;
}

function decodePdfStr(t) {
  let bytes;
  if (t[0] === '<') { const h = t.slice(1, -1); bytes = []; for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.substr(i, 2), 16)); }
  else bytes = [...t.slice(1, -1).replace(/\\([()\\])/g, '$1')].map(c => c.charCodeAt(0));
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) { let s = ''; for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] << 8 | bytes[i + 1]); return s; }
  return String.fromCharCode(...bytes);
}
