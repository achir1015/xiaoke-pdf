"""頁面與檔案：旋轉、刪除、插入、移動、擷取、分割、合併、裁切、頁面標籤、書籤、文件屬性、附件、圖層。"""
import os

import pymupdf as fitz


def parse_pages(spec, n):
    """「1-3,5,奇數,偶數,全部」→ 0 起算的頁碼清單"""
    spec = (spec or "").strip().replace("，", ",").replace("～", "-").replace("~", "-")
    if not spec or spec in ("全部", "all"):
        return list(range(n))
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if part in ("奇數", "odd"):
            out += list(range(0, n, 2)); continue
        if part in ("偶數", "even"):
            out += list(range(1, n, 2)); continue
        if "-" in part:
            a, b = part.split("-", 1)
            a = int(a) if a.strip() else 1
            b = int(b) if b.strip() else n
            out += list(range(max(1, a) - 1, min(n, b)))
        else:
            k = int(part)
            if 1 <= k <= n:
                out.append(k - 1)
    seen, res = set(), []
    for k in out:
        if k not in seen:
            seen.add(k); res.append(k)
    return res


def rotate(doc, pages, deg):
    for i in pages:
        p = doc[i]
        p.set_rotation((p.rotation + deg) % 360)


def delete(doc, pages):
    if len(set(pages)) >= doc.page_count:
        raise ValueError("不能刪除所有頁面")
    doc.delete_pages(sorted(set(pages)))


def insert_blank(doc, at, size=None):
    if size is None:
        r = doc[min(max(at - 1, 0), doc.page_count - 1)].rect if doc.page_count else fitz.paper_rect("a4")
        size = (r.width, r.height)
    doc.new_page(at, width=size[0], height=size[1])


def insert_file(doc, src_bytes, at, password=None):
    src = fitz.open(stream=src_bytes, filetype="pdf")
    if src.needs_pass and not src.authenticate(password or ""):
        raise ValueError("要插入的檔案需要密碼")
    doc.insert_pdf(src, start_at=at, links=True, annots=True, widgets=True)
    return src.page_count


def move(doc, pages, delta):
    """把選取的頁面往前（-1）或往後（+1）移一頁。回傳新的選取位置。"""
    order = list(range(doc.page_count))
    sel = sorted(set(pages), reverse=delta > 0)
    for i in sel:
        j = order.index(i)
        k = j + delta
        if 0 <= k < len(order) and order[k] not in pages:
            order[j], order[k] = order[k], order[j]
    doc.select(order)
    return [order.index(i) for i in pages]


def move_to(doc, pages, target):
    """把選取的頁面移到 target（0 起算，移動前的位置）之前。"""
    order = [i for i in range(doc.page_count) if i not in pages]
    t = len([i for i in range(target) if i not in pages])
    order[t:t] = sorted(pages)
    doc.select(order)
    return list(range(t, t + len(pages)))


def reverse(doc, pages=None):
    pages = sorted(pages) if pages else list(range(doc.page_count))
    order = list(range(doc.page_count))
    for a, b in zip(pages, reversed(pages)):
        order[a] = b
    doc.select(order)


def extract(doc, pages, password=None):
    """選取的頁面複製成新文件（連結、表單、註解保留；書籤只留指到這些頁的）。"""
    new = fitz.open()
    for i in pages:
        new.insert_pdf(doc, from_page=i, to_page=i, links=True, annots=True, widgets=True)
    pos = {p: k for k, p in enumerate(pages)}
    toc = [[lvl, title, pos[pg - 1] + 1] for lvl, title, pg in doc.get_toc() if pg - 1 in pos]
    if toc:
        fixed, last = [], 0
        for lvl, t, p in toc:
            lvl = min(lvl, last + 1)
            fixed.append([lvl, t, p]); last = lvl
        new.set_toc(fixed)
    meta = dict(doc.metadata or {})
    meta.pop("encryption", None); meta.pop("format", None)
    new.set_metadata({k: v for k, v in meta.items() if v})
    return new.tobytes(garbage=3, deflate=True)


def split_every(doc, n):
    out = []
    for s in range(0, doc.page_count, n):
        out.append(extract(doc, list(range(s, min(doc.page_count, s + n)))))
    return out


def split_before(doc, starts):
    starts = sorted(set([0] + [s for s in starts if 0 < s < doc.page_count]))
    out = []
    for k, s in enumerate(starts):
        e = starts[k + 1] if k + 1 < len(starts) else doc.page_count
        out.append(extract(doc, list(range(s, e))))
    return out


def merge(files):
    """files：[(名稱, bytes, 密碼)]。每個檔案一個書籤，原本的書籤放在底下。"""
    out = fitz.open()
    toc = []
    for name, data, pw in files:
        src = fitz.open(stream=data, filetype="pdf")
        if src.needs_pass and not src.authenticate(pw or ""):
            raise ValueError("「%s」需要密碼" % name)
        start = out.page_count
        out.insert_pdf(src, links=True, annots=True, widgets=True)
        toc.append([1, os.path.splitext(name)[0], start + 1])
        for lvl, t, p in src.get_toc():
            toc.append([lvl + 1, t, start + p])
        for i in range(src.embfile_count()):
            try:
                info = src.embfile_info(i)
                out.embfile_add(info["filename"], src.embfile_get(i), filename=info["filename"])
            except Exception:
                pass
    fixed, last = [], 0
    for lvl, t, p in toc:
        lvl = min(lvl, last + 1)
        fixed.append([lvl, t, p]); last = lvl
    out.set_toc(fixed)
    return out.tobytes(garbage=3, deflate=True)


def crop(doc, pages, rect):
    """rect：頁面座標的裁切範圍（None＝恢復原本大小）。"""
    for i in pages:
        p = doc[i]
        if rect is None:
            p.set_cropbox(p.mediabox)
        else:
            r = fitz.Rect(rect) * p.derotation_matrix if p.rotation else fitz.Rect(rect)
            p.set_cropbox(r & p.mediabox)


def page_labels(doc):
    """每一頁的標籤（沒有設定時回傳空字串）"""
    out = []
    for i in range(doc.page_count):
        try:
            out.append(doc[i].get_label())
        except Exception:
            out.append("")
    return out


def set_labels(doc, start, style, prefix="", first=1):
    """從 start 頁（0 起算）開始套用標籤樣式：D 數字、r 小寫羅馬、R 大寫羅馬、a/A 字母、'' 只有前綴。"""
    rules = [r for r in (doc.get_page_labels() or []) if r["startpage"] != start]
    rules.append({"startpage": start, "prefix": prefix, "style": style, "firstpagenum": first})
    rules.sort(key=lambda r: r["startpage"])
    doc.set_page_labels(rules)


def toc(doc):
    return doc.get_toc(simple=True)


def set_toc(doc, items):
    fixed, last = [], 0
    for lvl, t, p in items:
        lvl = max(1, min(lvl, last + 1))
        fixed.append([lvl, t, max(1, min(p, doc.page_count))]); last = lvl
    doc.set_toc(fixed)


def set_meta(doc, title=None, author=None, subject=None, keywords=None):
    m = dict(doc.metadata or {})
    for k, v in (("title", title), ("author", author), ("subject", subject), ("keywords", keywords)):
        if v is not None:
            m[k] = v
    m.pop("encryption", None); m.pop("format", None)
    doc.set_metadata(m)


def fonts(doc):
    """[(字型名稱, 類型, 是否嵌入, 頁數範例)]"""
    seen = {}
    for i in range(doc.page_count):
        for xref, ext, typ, base, name, enc, *_ in doc[i].get_fonts(full=True):
            key = (base or name, typ)
            if key not in seen:
                seen[key] = (base or name, typ, ext not in ("n/a", ""), i + 1)
    return list(seen.values())


def attachments(doc):
    out = []
    for i in range(doc.embfile_count()):
        info = doc.embfile_info(i)
        out.append({"index": i, "name": info.get("filename") or info.get("name"), "size": info.get("size", 0), "desc": info.get("description", "")})
    return out


def layers(doc):
    """[(xref, 名稱, 目前是否顯示)]"""
    out = []
    try:
        for xref, info in (doc.get_ocgs() or {}).items():
            out.append((xref, info.get("name", "?"), info.get("on", True)))
    except Exception:
        pass
    return out


def set_layer(doc, xref, on):
    cfg = doc.get_layer() or {}
    ons = set(cfg.get("on", []) or [])
    offs = set(cfg.get("off", []) or [])
    if on:
        ons.add(xref); offs.discard(xref)
    else:
        offs.add(xref); ons.discard(xref)
    doc.set_layer(-1, on=list(ons), off=list(offs))
