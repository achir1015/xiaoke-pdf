"""寫字：字型、大小、文字顏色、背景色、粗體、底線、刪除線；自動換行。
英數字用 PDF 標準字型（黑體／明體／等寬），含中文時用內建的 jf open 粉圓字型，
寫進去的都是可以搜尋、複製的真正文字。
"""
from dataclasses import dataclass, asdict

import pymupdf as fitz

from .. import HUNINN
from . import tables
from .text import CJK

FAMILIES = ["黑體（無襯線）", "明體（襯線）", "等寬"]
_STD = {(0, False): "helv", (0, True): "hebo", (1, False): "tiro", (1, True): "tibo", (2, False): "cour", (2, True): "cobo"}
_fonts = {}


@dataclass
class Style:
    family: int = 0
    size: float = 12
    color: tuple = (0, 0, 0)
    bg: tuple = None
    bold: bool = False
    underline: bool = False
    strike: bool = False
    line_height: float = 0      # 0＝字級 × 1.25

    def copy(self, **kw):
        d = asdict(self)
        d.update(kw)
        return Style(**d)

    def lh(self):
        return self.line_height or self.size * 1.25


def rgb_int(c):
    """PyMuPDF 的 sRGB 整數 → (r, g, b) 0~1"""
    return ((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255)


def font_for(text, family=0, bold=False):
    """回傳 (fitz.Font, 字型代號, 是否為真粗體)"""
    try:
        text.encode("cp1252")
        latin = True
    except UnicodeEncodeError:
        latin = False
    if latin:
        key = _STD[(family, bold)]
        if key not in _fonts:
            _fonts[key] = fitz.Font(key)
        return _fonts[key], key, True
    if "huninn" not in _fonts:
        _fonts["huninn"] = fitz.Font(fontfile=HUNINN)
    return _fonts["huninn"], "huninn", False


def wrap(font, text, size, max_w):
    """依寬度斷行：中文逐字，英文盡量在空白處斷。"""
    out = []
    for para in text.split("\n"):
        cur = ""
        for ch in para:
            nxt = cur + ch
            if cur and max_w > 0 and font.text_length(nxt, fontsize=size) > max_w:
                sp = cur.rfind(" ")
                if ch.strip() and not CJK.match(ch) and sp > 0:
                    out.append(cur[:sp])
                    cur = cur[sp + 1:] + ch
                else:
                    out.append(cur)
                    cur = "" if ch == " " else ch
            else:
                cur = nxt
        out.append(cur)
    return out


def measure(text, st, max_w):
    font, _, _ = font_for(text, st.family, st.bold)
    lines = wrap(font, text, st.size, max(max_w, st.size * 2))
    return lines, max([font.text_length(l, fontsize=st.size) for l in lines] + [1])


def write(page, x, baseline, max_w, text, st):
    """從 (x, 第一行基線) 開始寫字，在 max_w 寬度內換行。回傳寫出的範圍。"""
    font, key, native_bold = font_for(text, st.family, st.bold)
    lines = wrap(font, text, st.size, max(max_w, st.size * 2) if max_w > 0 else 0)
    lh = st.lh()
    widths = [font.text_length(l, fontsize=st.size) for l in lines]
    W = max(widths + [1])
    top = baseline - st.size * 0.95
    box = fitz.Rect(x - 1, top, x + W + 2, baseline + (len(lines) - 1) * lh + st.size * 0.3)
    if st.bg:
        page.draw_rect(box, color=None, fill=st.bg, overlay=True)
    tw = fitz.TextWriter(page.rect)
    for i, ln in enumerate(lines):
        if ln:
            tw.append((x, baseline + i * lh), ln, font=font, fontsize=st.size)
    tw.write_text(page, color=st.color)
    if st.bold and not native_bold:
        # 中文字型沒有粗體：往右多寫一次（偏移 3% 字級）
        tw2 = fitz.TextWriter(page.rect)
        for i, ln in enumerate(lines):
            if ln:
                tw2.append((x + st.size * 0.03, baseline + i * lh), ln, font=font, fontsize=st.size)
        tw2.write_text(page, color=st.color)
    th = max(0.5, st.size * 0.06)
    for i, ln in enumerate(lines):
        b = baseline + i * lh
        if st.underline and ln:
            page.draw_line((x, b + st.size * 0.12), (x + widths[i], b + st.size * 0.12), color=st.color, width=th)
        if st.strike and ln:
            page.draw_line((x, b - st.size * 0.3), (x + widths[i], b - st.size * 0.3), color=st.color, width=th)
    return box


def remove_text(page, rect):
    """把範圍內的字從內容串流裡真正刪除（不是用白色蓋住），框線、圖片保留。"""
    page.add_redact_annot(rect, fill=False, cross_out=False)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE, text=fitz.PDF_REDACT_TEXT_REMOVE)


@dataclass
class Fit:
    cell: tuple
    last_bottom: float      # 原本最後一行字的下緣
    below: float            # 分隔線以下內容的最低點
    page_h: float


def fit_cell(page, text, st, baseline, wrap_w, fit):
    """表格裡的字變長：先把那一列撐高（下面的內容往下移），放不下才縮小字級。回傳要用的樣式。"""
    if not fit or not fit.cell or not text.strip():
        return st
    c = fit.cell
    pad = max(1, c[3] - fit.last_bottom)
    lines, _ = measure(text, st, wrap_w)
    need = baseline + (len(lines) - 1) * st.lh() + st.size * 0.25 + pad - c[3]
    if need <= 0.5:
        return st
    if need <= fit.page_h - 18 - max(fit.below, c[3]):
        split = c[3] - 1.5
        tables.shift(page, lambda x, y: y > split, 0, need)
        return st
    s = st
    size = st.size - 0.5
    while size >= 5:
        s = st.copy(size=size, line_height=st.lh() * size / st.size)
        lines, _ = measure(text, s, wrap_w)
        if baseline + (len(lines) - 1) * s.lh() + size * 0.25 + pad <= c[3] + 0.5:
            return s
        size -= 0.5
    return s


def replace_block(page, area, baseline, wrap_w, text, st, fit=None):
    """就地修改一段文字：刪掉原本的字，從原本第一行的基線開始寫新文字（表格裡會撐高那一列）。"""
    remove_text(page, fitz.Rect(area.x0 - 0.5, area.y0 - 0.5, area.x1 + 0.5, area.y1 + 0.5))
    if not text.strip():
        return
    st = fit_cell(page, text, st, baseline, wrap_w, fit)
    write(page, area.x0, baseline, wrap_w, text, st)


def add_text(page, x, baseline, wrap_w, text, st, fit=None):
    if not text.strip():
        return
    st = fit_cell(page, text, st, baseline, wrap_w, fit)
    return write(page, x, baseline, wrap_w, text, st)
