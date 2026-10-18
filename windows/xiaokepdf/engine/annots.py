"""註解：便利貼、螢光筆、底線、刪除線、波浪線、文字框、矩形、橢圓、直線、箭頭、手繪、印章；
回覆、審閱狀態、改顏色／不透明度／線寬、刪除；印章與簽名的圖片。"""
import datetime
import io

import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFont

from .. import HUNINN

TYPES = {
    fitz.PDF_ANNOT_TEXT: "便利貼", fitz.PDF_ANNOT_HIGHLIGHT: "螢光筆", fitz.PDF_ANNOT_UNDERLINE: "底線",
    fitz.PDF_ANNOT_STRIKE_OUT: "刪除線", fitz.PDF_ANNOT_SQUIGGLY: "波浪線", fitz.PDF_ANNOT_FREE_TEXT: "文字框",
    fitz.PDF_ANNOT_SQUARE: "矩形", fitz.PDF_ANNOT_CIRCLE: "橢圓", fitz.PDF_ANNOT_LINE: "直線",
    fitz.PDF_ANNOT_INK: "手繪", fitz.PDF_ANNOT_STAMP: "印章", fitz.PDF_ANNOT_POLYGON: "多邊形",
    fitz.PDF_ANNOT_POLY_LINE: "折線", fitz.PDF_ANNOT_FILE_ATTACHMENT: "附件", fitz.PDF_ANNOT_LINK: "連結",
    fitz.PDF_ANNOT_WIDGET: "表單欄位", fitz.PDF_ANNOT_REDACT: "塗銷標記",
}
STATES = ["", "Accepted", "Rejected", "Cancelled", "Completed", "None"]
STATE_NAMES = {"": "（無）", "Accepted": "接受", "Rejected": "拒絕", "Cancelled": "取消", "Completed": "完成", "None": "清除狀態"}
STAMPS = ["核准", "已審閱", "機密", "草稿", "最終版", "作廢", "急件", "僅供內部使用", "已收到"]
STAMP_COLORS = {"核准": (46, 125, 50), "已審閱": (30, 99, 233), "機密": (211, 47, 47), "草稿": (117, 117, 117), "最終版": (46, 125, 50),
                "作廢": (211, 47, 47), "急件": (211, 47, 47), "僅供內部使用": (142, 36, 170), "已收到": (30, 99, 233)}


def _stamp_info(an, author):
    an.set_info(title=author, modDate=fitz.get_pdf_now(), creationDate=fitz.get_pdf_now())


def finish(an, author, color=None, opacity=None, width=None, content=None):
    info = an.info
    an.set_info(title=author, content=content if content is not None else info.get("content", ""), modDate=fitz.get_pdf_now())
    if color is not None:
        try:
            if an.type[0] in (fitz.PDF_ANNOT_HIGHLIGHT, fitz.PDF_ANNOT_UNDERLINE, fitz.PDF_ANNOT_STRIKE_OUT, fitz.PDF_ANNOT_SQUIGGLY, fitz.PDF_ANNOT_TEXT, fitz.PDF_ANNOT_INK, fitz.PDF_ANNOT_LINE, fitz.PDF_ANNOT_SQUARE, fitz.PDF_ANNOT_CIRCLE):
                an.set_colors(stroke=color)
        except Exception:
            pass
    if opacity is not None:
        an.set_opacity(opacity)
    if width is not None:
        try:
            an.set_border(width=width)
        except Exception:
            pass
    an.update()
    return an


def note(page, point, text, author, color=(1, 0.76, 0.03)):
    an = page.add_text_annot(point, text, icon="Comment")
    return finish(an, author, color=color, content=text)


def markup(page, kind, quads, author, color, text=""):
    fn = {"highlight": page.add_highlight_annot, "underline": page.add_underline_annot,
          "strike": page.add_strikeout_annot, "squiggly": page.add_squiggly_annot}[kind]
    an = fn(quads)
    return finish(an, author, color=color, content=text)


def freetext(page, rect, text, author, size=12, color=(0, 0, 0), fill=None, border=None):
    an = page.add_freetext_annot(rect, text, fontsize=size, fontname="china-t", text_color=color, fill_color=fill,
                                 border_color=border, border_width=1 if border else 0)
    an.set_info(title=author, content=text, modDate=fitz.get_pdf_now())
    an.update(fontsize=size, fontname="china-t", text_color=color, fill_color=fill)
    return an


def shape(page, kind, rect_or_line, author, color, width=2, fill=None, opacity=1.0):
    if kind == "rect":
        an = page.add_rect_annot(rect_or_line)
    elif kind == "ellipse":
        an = page.add_circle_annot(rect_or_line)
    else:
        (x1, y1), (x2, y2) = rect_or_line
        an = page.add_line_annot((x1, y1), (x2, y2))
        if kind == "arrow":
            an.set_line_ends(fitz.PDF_ANNOT_LE_NONE, fitz.PDF_ANNOT_LE_OPEN_ARROW)
    an.set_border(width=width)
    an.set_colors(stroke=color, fill=fill)
    an.set_opacity(opacity)
    an.set_info(title=author, modDate=fitz.get_pdf_now())
    an.update()
    return an


def ink(page, strokes, author, color, width=2, opacity=1.0):
    an = page.add_ink_annot([[tuple(p) for p in s] for s in strokes if s])
    an.set_border(width=width)
    an.set_colors(stroke=color)
    an.set_opacity(opacity)
    an.set_info(title=author, modDate=fitz.get_pdf_now())
    an.update()
    return an


def image_stamp(page, rect, png, author, label="印章"):
    an = page.add_stamp_annot(rect, stamp=png)
    an.set_info(title=author, content=label, modDate=fitz.get_pdf_now())
    an.update()
    return an


# ---------------------------------------------------------------- 印章、簽名的圖片


def _font(px):
    try:
        return ImageFont.truetype(HUNINN, px)
    except Exception:
        return ImageFont.load_default()


def stamp_png(text, author, color=None, scale=4):
    """紅框（或依類型配色）圓角印章：大字＋作者與日期。回傳 (png bytes, 寬高比)"""
    color = color or STAMP_COLORS.get(text, (211, 47, 47))
    f1, f2 = _font(30 * scale), _font(10 * scale)
    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    w1 = d.textlength(text, font=f1)
    sub = "%s · %s" % (author, datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
    w2 = d.textlength(sub, font=f2)
    W = int(max(w1, w2) + 28 * scale)
    H = int(58 * scale)
    im = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((2 * scale, 2 * scale, W - 2 * scale, H - 2 * scale), radius=8 * scale, outline=color + (255,), width=3 * scale, fill=(255, 255, 255, 200))
    d.text(((W - w1) / 2, 6 * scale), text, font=f1, fill=color + (255,))
    d.text(((W - w2) / 2, 40 * scale), sub, font=f2, fill=color + (255,))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue(), W / H


def text_png(text, color=(0, 0, 0), size=28, scale=4):
    """把字畫成透明背景的圖（簽名欄、縮寫用）。"""
    f = _font(size * scale)
    tmp = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    w = tmp.textlength(text, font=f)
    im = Image.new("RGBA", (int(w + size * scale * 0.4), int(size * scale * 1.4)), (255, 255, 255, 0))
    ImageDraw.Draw(im).text((size * scale * 0.2, size * scale * 0.15), text, font=f, fill=tuple(int(c * 255) for c in color) + (255,))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue(), im.width / im.height


def strokes_png(strokes, color=(0, 0, 0), width=3, scale=3):
    """手寫簽名的筆劃（任意座標）→ 剛好包住筆劃的透明 PNG。"""
    pts = [p for s in strokes for p in s]
    if not pts:
        return None, 1
    x0 = min(p[0] for p in pts); y0 = min(p[1] for p in pts)
    x1 = max(p[0] for p in pts); y1 = max(p[1] for p in pts)
    pad = width * 2
    W = int((x1 - x0 + pad * 2) * scale) + 1
    H = int((y1 - y0 + pad * 2) * scale) + 1
    im = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    col = tuple(int(c * 255) for c in color) + (255,)
    for s in strokes:
        xy = [((p[0] - x0 + pad) * scale, (p[1] - y0 + pad) * scale) for p in s]
        if len(xy) == 1:
            x, y = xy[0]
            r = width * scale / 2
            d.ellipse((x - r, y - r, x + r, y + r), fill=col)
        else:
            d.line(xy, fill=col, width=int(width * scale), joint="curve")
            r = width * scale / 2
            for x, y in (xy[0], xy[-1]):
                d.ellipse((x - r, y - r, x + r, y + r), fill=col)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue(), W / H


# ---------------------------------------------------------------- 註解清單、回覆、狀態


def listing(doc):
    """所有註解（含回覆），依頁碼：[{page, xref, type, name, author, content, date, rect, irt, state, color}]"""
    out = []
    for i in range(doc.page_count):
        for an in doc[i].annots() or []:
            t = an.type[0]
            if t in (fitz.PDF_ANNOT_LINK, fitz.PDF_ANNOT_WIDGET, fitz.PDF_ANNOT_POPUP):
                continue
            info = an.info
            try:
                irt = an.irt_xref
            except Exception:
                irt = 0
            state = ""
            try:
                st = doc.xref_get_key(an.xref, "State")
                if st[0] == "string" or st[0] == "name":
                    state = st[1].strip("/()")
            except Exception:
                pass
            out.append({"page": i, "xref": an.xref, "type": t, "name": TYPES.get(t, an.type[1]), "author": info.get("title", ""),
                        "content": info.get("content", ""), "date": info.get("modDate", ""), "rect": an.rect, "irt": irt,
                        "state": state, "color": (an.colors or {}).get("stroke")})
    return out


def find(doc, page, xref):
    """回傳 (頁面, 註解)。頁面物件要一直拿著，註解才不會失效。"""
    pg = doc[page]
    for an in pg.annots() or []:
        if an.xref == xref:
            return pg, an
    return pg, None


def reply(doc, page, xref, text, author):
    pg, parent = find(doc, page, xref)
    an = pg.add_text_annot(parent.rect.tl, text, icon="Comment")
    an.set_info(title=author, content=text, modDate=fitz.get_pdf_now())
    an.set_irt_xref(parent.xref)
    an.set_flags(fitz.PDF_ANNOT_IS_HIDDEN)
    an.update()
    return an


def set_state(doc, page, xref, state, author):
    """審閱狀態：用一個回覆註解記錄（PDF 標準做法）。"""
    pg, parent = find(doc, page, xref)
    an = pg.add_text_annot(parent.rect.tl, "狀態：" + STATE_NAMES.get(state, state), icon="Comment")
    an.set_info(title=author, content="狀態：" + STATE_NAMES.get(state, state), modDate=fitz.get_pdf_now())
    an.set_irt_xref(parent.xref)
    doc.xref_set_key(an.xref, "State", "(%s)" % state)
    doc.xref_set_key(an.xref, "StateModel", "(Review)")
    an.set_flags(fitz.PDF_ANNOT_IS_HIDDEN)
    an.update()


def restyle(doc, page, xref, color=None, opacity=None, width=None, content=None):
    pg, an = find(doc, page, xref)
    if an is None:
        return
    if content is not None:
        an.set_info(content=content, modDate=fitz.get_pdf_now())
    if color is not None:
        try:
            an.set_colors(stroke=color)
        except Exception:
            pass
    if opacity is not None:
        an.set_opacity(opacity)
    if width is not None:
        try:
            an.set_border(width=width)
        except Exception:
            pass
    an.update()


def delete(doc, page, xref):
    pg, an = find(doc, page, xref)
    if an is not None:
        # 一起刪掉回覆
        for other in list(pg.annots() or []):
            try:
                if other.irt_xref == xref:
                    pg.delete_annot(other)
            except Exception:
                pass
        pg, an = find(doc, page, xref)
        if an is not None:
            pg.delete_annot(an)


def at(page, x, y):
    """點到的註解（不含連結、表單欄位）"""
    best = None
    for an in page.annots() or []:
        if an.type[0] in (fitz.PDF_ANNOT_LINK, fitz.PDF_ANNOT_WIDGET, fitz.PDF_ANNOT_POPUP):
            continue
        if an.flags & fitz.PDF_ANNOT_IS_HIDDEN:
            continue
        r = an.rect
        if r.x0 - 3 <= x <= r.x1 + 3 and r.y0 - 3 <= y <= r.y1 + 3:
            best = an
    return best
