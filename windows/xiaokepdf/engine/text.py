"""頁面文字：每個字的位置、分行、找段落（表格裡只取同一格）、搜尋。
座標一律是 PyMuPDF 的頁面座標（左上原點、y 往下、未套用 /Rotate）。
"""
import re
from dataclasses import dataclass, field

import pymupdf as fitz

CJK = re.compile(r"[⺀-鿿가-힯豈-﫿＀-￯　-〿]")


@dataclass
class Char:
    c: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    base: float
    color: int
    font: str
    flags: int
    vertical: bool = False

    @property
    def cx(self):
        return (self.x0 + self.x1) / 2

    @property
    def cy(self):
        return (self.y0 + self.y1) / 2


@dataclass
class Line:
    chars: list = field(default_factory=list)
    x0: float = 1e9
    x1: float = -1e9
    y0: float = 1e9
    y1: float = -1e9
    size: float = 0
    base: float = 0

    def add(self, ch):
        self.chars.append(ch)
        self.x0 = min(self.x0, ch.x0)
        self.x1 = max(self.x1, ch.x1)
        self.y0 = min(self.y0, ch.y0)
        self.y1 = max(self.y1, ch.y1)
        self.size = max(self.size, ch.size)

    def text(self):
        out = []
        prev = None
        for ch in self.chars:
            if prev is not None and ch.x0 - prev.x1 > ch.size * 0.25 and prev.c != " " and ch.c != " ":
                out.append(" ")
            out.append(ch.c)
            prev = ch
        return "".join(out).rstrip()


@dataclass
class Block:
    page: int
    area: fitz.Rect
    text: str
    caret: int
    size: float
    base: float
    line_height: float
    wrap_w: float
    cell: tuple = None          # (x1, y1, x2, y2)
    color: int = 0
    family: int = 0
    bold: bool = False
    last_bottom: float = 0
    lines: list = field(default_factory=list)


def page_chars(page):
    """頁面上每個字（rawdict）。空白字元也保留，排版時用來判斷字距。"""
    out = []
    try:
        d = page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_MEDIABOX_CLIP)
    except Exception:
        return out
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for ln in b["lines"]:
            dx, dy = ln.get("dir", (1, 0))
            vertical = abs(dx) < 0.5
            for sp in ln["spans"]:
                size = sp["size"]
                for ch in sp.get("chars", []):
                    x0, y0, x1, y1 = ch["bbox"]
                    out.append(Char(ch["c"], x0, y0, x1, y1, size, ch["origin"][1], sp.get("color", 0), sp.get("font", ""), sp.get("flags", 0), vertical))
    return out


def group_lines(chars, cell=None):
    """把字分成行；cell 不為 None 時只取中心點在格子裡的字。"""
    cs = [c for c in chars if not c.vertical and c.c.strip()]
    if cell:
        x1, y1, x2, y2 = cell
        cs = [c for c in cs if x1 < c.cx < x2 and y1 < c.cy < y2]
    cs.sort(key=lambda c: (round(c.base, 1), c.x0))
    lines = []
    for ch in cs:
        best = None
        for ln in lines[-8:]:
            if abs(ln.base - ch.base) < max(ln.size, ch.size) * 0.45 and ch.x0 < ln.x1 + ch.size * 3 and ch.x1 > ln.x0 - ch.size * 3:
                best = ln
        if best is None:
            best = Line(base=ch.base)
            lines.append(best)
        best.add(ch)
    for ln in lines:
        ln.chars.sort(key=lambda c: c.x0)
    lines.sort(key=lambda ln: (ln.base, ln.x0))
    return lines


def _family(font):
    f = font.lower()
    if any(k in f for k in ("times", "serif", "ming", "song", "mincho", "明", "宋")) and "sans" not in f:
        return 1
    if any(k in f for k in ("courier", "mono", "consol")):
        return 2
    return 0


def find_block(page_no, chars, x, y, cell=None, page_w=595):
    """點到的段落：連續、字級相同、行距一致、左邊對齊相近的行。沒點到字回傳 None。"""
    lines = group_lines(chars, cell)
    hit = None
    for i, ln in enumerate(lines):
        if ln.y0 - 2 <= y <= ln.y1 + 2 and ln.x0 - 6 <= x <= ln.x1 + 6:
            hit = i
            break
    if hit is None:
        return None

    def ok(a, b, pitch):
        gap = abs(b.base - a.base)
        return (abs(a.size - b.size) <= a.size * 0.15 and gap <= a.size * 1.9 and (not pitch or abs(gap - pitch) <= pitch * 0.25)
                and b.x0 < a.x1 and b.x1 > a.x0 - a.size * 2 and abs(b.x0 - a.x0) < max(a.size * 3, (a.x1 - a.x0) * 0.5))

    s = e = hit
    pitch = 0
    while e + 1 < len(lines) and ok(lines[e], lines[e + 1], pitch):
        pitch = pitch or lines[e + 1].base - lines[e].base
        e += 1
    while s > 0 and ok(lines[s], lines[s - 1], pitch):
        pitch = pitch or lines[s].base - lines[s - 1].base
        s -= 1
    blk = lines[s:e + 1]
    text, caret = "", 0
    for k, ln in enumerate(blk):
        t = ln.text()
        if text and t and not (CJK.match(text[-1]) or CJK.match(t[0]) or text[-1] == " "):
            text += " "
        if s + k == hit:
            # 游標放在點到的字前後
            best, bd = len(t), 1e9
            j = 0
            for ch in ln.chars:
                left = x < ch.cx
                dd = abs(x - (ch.x0 if left else ch.x1))
                if dd < bd:
                    bd, best = dd, (j if left else j + 1)
                j += 1
            caret = len(text) + min(best, len(t))
        text += t
    area = fitz.Rect(min(l.x0 for l in blk), min(l.y0 for l in blk), max(l.x1 for l in blk), max(l.y1 for l in blk))
    size = max(l.size for l in blk)
    lh = (blk[-1].base - blk[0].base) / (len(blk) - 1) if len(blk) > 1 else size * 1.25
    if cell:
        right = cell[2] - max(2, area.x0 - cell[0])
        wrap_w = max(size * 2, right - area.x0)
    else:
        right = max([area.x1] + [l.x1 for l in lines])
        right = min(right, page_w - 18)
        wrap_w = max(area.width, right - area.x0)
    first = blk[0].chars[0]
    return Block(page_no, area, text, caret, round(size * 10) / 10, blk[0].base, lh, wrap_w, cell,
                 first.color, _family(first.font), bool(first.flags & 16) or "bold" in first.font.lower(),
                 blk[-1].base + size * 0.25, blk)


def page_text(page):
    return page.get_text("text", sort=True)


def search(doc, query, pages=None):
    """搜尋整份文件；逗號分隔可同時找多個詞。回傳 [(page, Quad)]。"""
    terms = [t.strip() for t in query.split(",") if t.strip()]
    out = []
    for i in (pages if pages is not None else range(doc.page_count)):
        page = doc[i]
        for t in terms:
            for q in page.search_for(t, quads=True):
                out.append((i, q))
    out.sort(key=lambda r: (r[0], round(r[1].rect.y0, 0), r[1].rect.x0))
    return out
