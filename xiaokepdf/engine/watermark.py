"""浮水印、頁首頁尾與頁碼；移除浮水印（標準浮水印、依文字、依圖層）。

加上的浮水印用 Artifact／Watermark 標記內容包起來（和 Acrobat 相同），之後可以完整移除；
頁首頁尾用 Artifact／Pagination 標記。演算法與 Android 版 Watermark.java 相同。
"""
import datetime
import math
import os
import re

import pymupdf as fitz

from .. import HUNINN
from . import tables
from .textops import font_for

# ---------------------------------------------------------------- 加浮水印


def add_text_watermark(doc, pages, text, size=60, color=(0.6, 0.6, 0.6), opacity=0.2, angle=45, pos="center", over=True):
    font, key, _ = font_for(text)
    for i in pages:
        page = doc[i]
        r = page.rect
        w = font.text_length(text, fontsize=size)
        placements = []
        if pos == "tile":
            step_x, step_y = w + size * 3, size * 5
            y = -r.height
            while y < r.height * 2:
                x = -r.width
                while x < r.width * 2:
                    placements.append((x, y)); x += step_x
                y += step_y
        else:
            cx, cy = r.width / 2, {"top": size * 1.5, "bottom": r.height - size, "center": r.height / 2}.get(pos, r.height / 2)
            placements.append((cx, cy))
        _wrap_artifact(page, "Watermark", lambda: _draw_wm_text(page, placements, text, font, size, color, opacity, angle, pos == "tile", w), over)


def _draw_wm_text(page, placements, text, font, size, color, opacity, angle, tile, w):
    for cx, cy in placements:
        tw = fitz.TextWriter(page.rect, opacity=opacity, color=color)
        start = fitz.Point(cx - w / 2, cy + size * 0.35) if not tile else fitz.Point(cx, cy)
        tw.append(start, text, font=font, fontsize=size)
        pivot = fitz.Point(cx, cy) if not tile else start
        tw.write_text(page, morph=(pivot, fitz.Matrix(-angle)), overlay=True)


def add_image_watermark(doc, pages, png, scale=0.5, opacity=0.2, pos="center", over=True):
    pix = fitz.Pixmap(png)
    for i in pages:
        page = doc[i]
        r = page.rect
        w = r.width * scale
        h = w * pix.height / pix.width
        cy = {"top": h / 2 + 20, "bottom": r.height - h / 2 - 20}.get(pos, r.height / 2)
        rect = fitz.Rect(r.width / 2 - w / 2, cy - h / 2, r.width / 2 + w / 2, cy + h / 2)
        _wrap_artifact(page, "Watermark", lambda: page.insert_image(rect, stream=png, overlay=True), over, opacity)


def _wrap_artifact(page, subtype, draw, over=True, opacity=None):
    """畫出來的新內容包成 /Artifact 標記內容；over=False 時移到原本內容的下面。"""
    doc = page.parent
    page.clean_contents(sanitize=False)
    xrefs = page.get_contents()
    old = doc.xref_stream(xrefs[0]) if xrefs else b""
    draw()
    page.clean_contents(sanitize=False)
    xref = page.get_contents()[0]
    full = doc.xref_stream(xref)
    # clean_contents 會把舊內容放在前面；新加的部分在後面
    if full.startswith(old.rstrip()) and len(full) > len(old):
        new = full[len(old.rstrip()):]
        base = old
    else:
        new, base = full, b""
    wrapped = b"/Artifact <</Type /Pagination /Subtype /" + subtype.encode() + b">> BDC\nq\n" + new + b"\nQ\nEMC\n"
    data = (base + b"\n" + wrapped) if over else (wrapped + b"\n" + base)
    doc.update_stream(xref, data)


def header_footer(doc, pages, fmt, pos, size=10, color=(0.2, 0.2, 0.2), labels=None, filename=""):
    """頁碼／頁首頁尾。pos：0 左上 1 中上 2 右上 3 左下 4 中下 5 右下。
    fmt 可用 {n} 頁碼、{N} 總頁數、{label} 頁面標籤、{date} 日期、{file} 檔名。"""
    total = doc.page_count
    for i in pages:
        page = doc[i]
        lbl = (labels[i] if labels and i < len(labels) and labels[i] else str(i + 1))
        t = (fmt.replace("{n}", str(i + 1)).replace("{N}", str(total)).replace("{label}", lbl)
             .replace("{date}", datetime.date.today().isoformat()).replace("{file}", os.path.splitext(filename or "")[0]))
        font, _, _ = font_for(t)
        w = font.text_length(t, fontsize=size)
        r = page.rect
        m = 28
        x = {0: m, 3: m, 1: (r.width - w) / 2, 4: (r.width - w) / 2, 2: r.width - m - w, 5: r.width - m - w}[pos]
        y = m + size if pos < 3 else r.height - m
        if page.rotation:
            p = fitz.Point(x, y) * page.derotation_matrix
        else:
            p = fitz.Point(x, y)

        def draw(page=page, t=t, font=font, p=p):
            tw = fitz.TextWriter(page.rect, color=color)
            tw.append(p, t, font=font, fontsize=size)
            tw.write_text(page, morph=(p, fitz.Matrix(page.rotation)) if page.rotation else None)
        _wrap_artifact(page, "Header" if pos < 3 else "Footer", draw)


# ---------------------------------------------------------------- 移除浮水印


def _tounicode_map(doc, font_xref):
    """字型的 ToUnicode 對照表：{code: text}、是否雙位元組"""
    m, two = {}, False
    try:
        sub = doc.xref_get_key(font_xref, "Subtype")[1]
        two = sub == "/Type0"
        tu = doc.xref_get_key(font_xref, "ToUnicode")
        if tu[0] != "xref":
            return m, two
        txt = doc.xref_stream(int(tu[1].split()[0])).decode("latin1")
    except Exception:
        return m, two

    def to_str(h):
        if len(h) <= 2:
            return chr(int(h, 16)) if h else ""
        return "".join(chr(int(h[j:j + 4], 16)) for j in range(0, len(h) - len(h) % 4, 4))

    for blk in re.findall(r"beginbfchar(.*?)endbfchar", txt, re.S):
        for a, b in re.findall(r"<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>", blk):
            m[int(a, 16)] = to_str(b)
            if len(a) >= 4:
                two = True
    for blk in re.findall(r"beginbfrange(.*?)endbfrange", txt, re.S):
        for a, z, rest in re.findall(r"<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])", blk):
            lo, hi = int(a, 16), int(z, 16)
            if len(a) >= 4:
                two = True
            if hi < lo or hi - lo > 65535:
                continue
            if rest.startswith("<"):
                base = rest[1:-1]
                v = int(base[-4:] or "0", 16)
                pre = to_str(base[:-4]) if len(base) > 4 else ""
                for c in range(lo, hi + 1):
                    m[c] = pre + chr(v + c - lo)
            else:
                items = re.findall(r"<([0-9a-fA-F]*)>", rest)
                for k, c in enumerate(range(lo, hi + 1)):
                    if k < len(items):
                        m[c] = to_str(items[k])
    return m, two


def _decode(raw, kind, cmap):
    """字串 token → 文字"""
    m, two = cmap
    if kind == "hex":
        h = re.sub(r"\s", "", raw[1:-1])
        if len(h) % 2:
            h += "0"
        b = bytes.fromhex(h)
    else:
        s = raw[1:-1]
        out = bytearray()
        i = 0
        while i < len(s):
            c = s[i]
            if c == "\\" and i + 1 < len(s):
                d = s[i + 1]
                if d in "nrtbf":
                    out.append({"n": 10, "r": 13, "t": 9, "b": 8, "f": 12}[d]); i += 2; continue
                if d.isdigit():
                    j = i + 1
                    while j < len(s) and j < i + 4 and s[j] in "01234567":
                        j += 1
                    out.append(int(s[i + 1:j], 8) & 255); i = j; continue
                if d in "\r\n":
                    i += 2; continue
                out.append(ord(d) & 255); i += 2; continue
            out.append(ord(c) & 255); i += 1
        b = bytes(out)
    if two:
        return "".join(m.get(int.from_bytes(b[j:j + 2], "big"), "") for j in range(0, len(b) - 1, 2))
    return "".join(m.get(x, chr(x)) for x in b)


def _norm(s):
    return re.sub(r"\s+", "", s or "").lower()


def _filter(doc, src, fonts, opts, rep, oc_names):
    """回傳 (新內容 or None)。fonts：{資源名稱: (cmap)}；oc_names：{資源名稱: 圖層名稱}"""
    toks = tables.tokenize(src)
    out, operands, mc, removing = [], [], [], 0
    block, block_text = None, None
    cmap = ({}, False)
    changed = False
    for t in toks:
        if t[0] != "op":
            operands.append(t)
            continue
        name = t[2]
        unit = operands + [t]
        operands = []
        if name in ("BDC", "BMC"):
            rm = removing > 0 or _is_wm_mark(unit, opts, oc_names)
            mc.append(rm)
            if rm:
                if removing == 0:
                    rep["blocks"] += 1
                removing += 1
                changed = True
                continue
        elif name == "EMC":
            rm = mc.pop() if mc else False
            if rm:
                removing -= 1
                continue
        if removing:
            continue
        text_q = _norm(opts.get("text"))
        if text_q:
            if name == "BT":
                block, block_text = [], []
            if block is not None:
                block.extend(unit)
                if name == "Tf" and len(unit) >= 3 and unit[0][0] == "name":
                    cmap = fonts.get(unit[0][1][1:], ({}, False))
                elif name in ("Tj", "'", '"') and len(unit) >= 2 and unit[-2][0] in ("str", "hex"):
                    block_text.append(_decode(unit[-2][1], unit[-2][0], cmap))
                elif name == "TJ" and unit[0][0] == "arr":
                    for raw in re.findall(r"<[0-9a-fA-F\s]*>|\((?:\\.|[^\\)])*\)", unit[0][1]):
                        block_text.append(_decode(raw, "hex" if raw.startswith("<") else "str", cmap))
                if name == "ET":
                    if text_q in _norm("".join(block_text)):
                        rep["blocks"] += 1
                        changed = True
                    else:
                        out.extend(block)
                    block = None
                continue
        out.extend(unit)
    if block is not None:
        out.extend(block)
    out.extend(operands)
    return tables._serialize(out) if changed else None


def _is_wm_mark(unit, opts, oc_names):
    tag = unit[-2][1] if len(unit) >= 2 and unit[-2][0] == "name" and unit[-1][2] == "BMC" else None
    if unit[-1][2] == "BDC" and len(unit) >= 3:
        tag = unit[-3][1] if unit[-3][0] == "name" else None
        props = unit[-2][1]
        if opts.get("standard") and tag == "/Artifact" and re.search(r"/(Sub)?[Tt]ype\s*/Watermark", props):
            return True
        if opts.get("layers") and tag == "/OC" and unit[-2][0] == "name":
            if oc_names.get(props[1:]) in opts["layers"]:
                return True
    return False


def _page_resources(doc, page):
    """頁面字型與 OC 屬性：({字型資源名稱: cmap}, {OC 資源名稱: 圖層名稱})"""
    fonts, ocs = {}, {}
    for xref, ext, typ, base, name, enc, *_ in page.get_fonts(full=True):
        fonts[name] = _tounicode_map(doc, xref)
    try:
        res = doc.xref_get_key(page.xref, "Resources")
        props = None
        if res[0] == "xref":
            props = doc.xref_get_key(int(res[1].split()[0]), "Properties")
        elif res[0] == "dict":
            m = re.search(r"/Properties\s*(<<.*?>>|\d+ 0 R)", res[1])
            props = ("dict", m.group(1)) if m else None
        if props and props[0] in ("dict", "xref"):
            txt = props[1] if props[0] == "dict" else doc.xref_object(int(props[1].split()[0]))
            for nm, ref in re.findall(r"/([^\s/<>\[\]]+)\s+(\d+) 0 R", txt):
                try:
                    ocs[nm] = doc.xref_get_key(int(ref), "Name")[1].strip("()")
                except Exception:
                    pass
    except Exception:
        pass
    return fonts, ocs


def remove(doc, standard=True, text=None, layers=None):
    """移除浮水印。回傳 {'blocks', 'annots', 'pages'}"""
    rep = {"blocks": 0, "annots": 0, "pages": 0}
    opts = {"standard": standard, "text": text, "layers": set(layers or [])}
    for i in range(doc.page_count):
        page = doc[i]
        before = rep["blocks"] + rep["annots"]
        fonts, ocs = _page_resources(doc, page)
        page.clean_contents(sanitize=False)
        xrefs = page.get_contents()
        if xrefs:
            src = b"".join(doc.xref_stream(x) or b"" for x in xrefs).decode("latin1")
            new = _filter(doc, src, fonts, opts, rep, ocs)
            if new is not None:
                doc.update_stream(xrefs[0], new.encode("latin1"))
                for x in xrefs[1:]:
                    doc.update_stream(x, b"")
        # 頁面上的表單 XObject（Word 匯出的浮水印常放在這裡）
        for img in page.get_xobjects():
            xref = img[0]
            try:
                s = doc.xref_stream(xref).decode("latin1")
                new = _filter(doc, s, fonts, opts, rep, ocs)
                if new is not None:
                    doc.update_stream(xref, new.encode("latin1"))
            except Exception:
                pass
        if standard:
            for an in list(page.annots() or []):
                if an.type[1] == "Watermark":
                    page.delete_annot(an)
                    rep["annots"] += 1
        if rep["blocks"] + rep["annots"] > before:
            rep["pages"] += 1
    if layers:
        try:
            for xref, info in (doc.get_ocgs() or {}).items():
                if info.get("name") in layers:
                    doc.set_layer(-1, off=[xref])
        except Exception:
            pass
    return rep


def candidates(doc, limit=60):
    """猜浮水印文字：每頁都出現的短文字、或是斜放的字"""
    hits, rotated = {}, {}
    n = min(doc.page_count, limit)
    for i in range(n):
        seen = set()
        d = doc[i].get_text("dict")
        for b in d.get("blocks", []):
            for ln in b.get("lines", []):
                t = "".join(s["text"] for s in ln["spans"]).strip()
                if not (2 <= len(t) <= 40):
                    continue
                dx, dy = ln.get("dir", (1, 0))
                ang = abs(math.degrees(math.atan2(dy, dx))) % 90
                if 8 < ang < 82:
                    rotated[t] = rotated.get(t, 0) + 1
                if t not in seen:
                    seen.add(t)
                    hits[t] = hits.get(t, 0) + 1
    out = [(t, "斜放的文字", 100 + c) for t, c in rotated.items()]
    if n >= 2:
        for t, c in hits.items():
            if c >= max(2, math.ceil(n * 0.6)) and len(t) <= 16 and not t.isdigit() and t not in rotated:
                out.append((t, "%d 頁都出現" % c, c))
    out.sort(key=lambda x: -x[2])
    return out[:6]


def layer_names(doc):
    try:
        return [info.get("name") for info in (doc.get_ocgs() or {}).values()]
    except Exception:
        return []
