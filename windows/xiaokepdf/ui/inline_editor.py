"""像 Word 一樣就地編輯：點頁面上的文字，原本的位置直接變成編輯框，游標在點到的地方；
整段（表格裡只取同一格）一起編輯、自動換行；上方是格式列。表格裡可以插入列／欄、合併儲存格，
字變長時那一列自動撐高。"""
import pymupdf as fitz
from PySide6.QtCore import QEvent, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QFontDatabase, QTextBlockFormat, QTextCursor, QTextOption
from PySide6.QtWidgets import (QColorDialog, QComboBox, QFrame, QHBoxLayout, QInputDialog, QLabel, QMenu, QPushButton,
                               QTextEdit, QToolButton, QWidget)

from .. import HUNINN
from ..engine import tables as TB
from ..engine import text as T
from ..engine import textops as TO
from ..engine.session import K_EDIT
from . import theme

FG = ["#000000", "#555555", "#FFFFFF", "#E53935", "#FB8C00", "#FDD835", "#43A047", "#1E63E9", "#8E24AA", "#D81B60"]
BG = [None, "#FFFFFF", "#FFF59D", "#FFCC80", "#C8E6C9", "#BBDEFB", "#F8BBD0", "#E0E0E0", "#000000"]
_huninn_family = None


def huninn_family():
    global _huninn_family
    if _huninn_family is None:
        fid = QFontDatabase.addApplicationFont(HUNINN)
        fams = QFontDatabase.applicationFontFamilies(fid) if fid >= 0 else []
        _huninn_family = fams[0] if fams else "Microsoft JhengHei"
    return _huninn_family


def qfont_for(text, st):
    try:
        text.encode("cp1252")
        fam = ["Arial", "Times New Roman", "Courier New"][st.family]
    except UnicodeEncodeError:
        fam = huninn_family()
    f = QFont(fam)
    f.setBold(st.bold)
    f.setUnderline(st.underline)
    f.setStrikeOut(st.strike)
    return f


def to_qcolor(c):
    return QColor(int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


def from_hex(h):
    q = QColor(h)
    return (q.redF(), q.greenF(), q.blueF())


class Cur:
    pass


class Editor(QTextEdit):
    def __init__(self, inline, parent):
        super().__init__(parent)
        self.inline = inline
        self.setAcceptRichText(False)
        self.setFrameStyle(QFrame.NoFrame)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setWordWrapMode(QTextOption.WrapAtWordBoundaryOrAnywhere)
        self.document().setDocumentMargin(0)
        self.setViewportMargins(0, 0, 0, 0)
        self.setContentsMargins(0, 0, 0, 0)

    def keyPressEvent(self, e):
        if e.key() == Qt.Key_Escape:
            self.inline.cancel()
            return
        if e.key() in (Qt.Key_Return, Qt.Key_Enter) and e.modifiers() & Qt.ControlModifier:
            self.inline.commit()
            return
        super().keyPressEvent(e)


class Inline:
    def __init__(self, win):
        self.win = win
        self.cur = None
        self.bar = None
        self._merge_from = None

    @property
    def view(self):
        return self.win.view

    @property
    def s(self):
        return self.win.session()

    def active(self):
        return self.cur is not None

    # ------------------------------------------------------------------ 開始

    def rules(self, page):
        key = (self.s.version, page)
        cache = self.win.__dict__.setdefault("_rules_cache", {})
        if key not in cache:
            if len(cache) > 30:
                cache.clear()
            cache[key] = TB.rules(self.s.doc[page])
        return cache[key]

    def _bg_color(self, page, area):
        """原文字外框一圈最常見的顏色（蓋住原文字用）。"""
        try:
            r = fitz.Rect(area.x0 - 3, area.y0 - 3, area.x1 + 3, area.y1 + 3) & self.s.doc[page].rect
            pix = self.s.doc[page].get_pixmap(clip=r, dpi=72, alpha=False)
            counts = {}
            w, h, n = pix.width, pix.height, pix.n
            sm = pix.samples
            pts = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
            for x, y in pts:
                o = (y * w + x) * n
                c = (sm[o] >> 3, sm[o + 1] >> 3, sm[o + 2] >> 3)
                counts[c] = counts.get(c, 0) + 1
            c = max(counts, key=counts.get)
            return QColor(c[0] << 3 | 4, c[1] << 3 | 4, c[2] << 3 | 4)
        except Exception:
            return QColor("#FFFFFF")

    def edit_at(self, page, x, y):
        if self.active():
            self.commit()
            return
        b = self.s.block(K_EDIT)
        if b:
            self.win.blocked(b)
            return
        ru = self.rules(page)
        cell = TB.cell_at(ru, x, y)
        blk = T.find_block(page, self.view.chars(page), x, y, cell, self.s.doc[page].rect.width)
        if blk is None:
            self.add_at(page, x, y, cell)
            return
        saved = self.win.prefs.get("edit_style", {})
        st = TO.Style(family=saved.get("family", blk.family), size=blk.size, color=TO.rgb_int(blk.color), bold=blk.bold)
        c = Cur()
        c.edit, c.page, c.area, c.base, c.wrap_w = True, page, blk.area, blk.base, blk.wrap_w
        c.line_height, c.cell, c.last_bottom = blk.line_height, cell, blk.last_bottom
        c.orig, c.caret, c.st = blk.text.rstrip(), blk.caret, st
        c.mask = self._bg_color(page, blk.area)
        self.open(c)

    def add_at(self, page, x, y, cell="auto"):
        if self.active():
            self.commit()
            return
        b = self.s.block(K_EDIT)
        if b:
            self.win.blocked(b)
            return
        if cell == "auto":
            cell = TB.cell_at(self.rules(page), x, y)
        saved = self.win.prefs.get("add_style", {})
        st = TO.Style(family=saved.get("family", 0), size=saved.get("size", 12), color=tuple(saved.get("color", (0, 0, 0))),
                      bg=tuple(saved["bg"]) if saved.get("bg") else None, bold=saved.get("bold", False),
                      underline=saved.get("underline", False), strike=saved.get("strike", False))
        c = Cur()
        c.edit, c.page, c.cell = False, page, cell
        pw = self.s.doc[page].rect.width
        c.wrap_w = max(80, pw - x - 24)
        c.base = y + st.size * 0.35
        if cell:
            x = cell[0] + 4
            c.wrap_w = max(st.size * 2, cell[2] - cell[0] - 8)
            c.base = cell[1] + 4 + st.size * 0.95
        c.last_bottom = cell[3] - 3 if cell else 0
        c.area = fitz.Rect(x, c.base - st.size * 1.15, x + c.wrap_w, c.base + st.size * 0.15)
        c.line_height = st.size * 1.25
        c.orig, c.caret, c.st, c.mask = "", 0, st, None
        self.open(c)

    def edit_selection(self, page, rect):
        self.edit_at(page, rect.x0 + 1, (rect.y0 + rect.y1) / 2)

    def open(self, c):
        v = self.view
        if v.vrot:
            v.rotate_view(-v.vrot)
        v.clear_selection()
        self.cur = c
        c.orig_sig = self._sig(c.st)
        ed = Editor(self, v.viewport())
        c.ed = ed
        ed.setPlainText(c.orig)
        ed.textChanged.connect(self.layout)
        if c.edit:
            v.mask = (c.page, fitz.Rect(c.area.x0 - 1.5, c.area.y0 - 1.5, c.area.x1 + 1.5, c.area.y1 + 1.5), c.mask)
        v.frame.connect(self.layout)
        self.style()
        self.layout()
        ed.show()
        ed.setFocus()
        cur = ed.textCursor()
        cur.setPosition(min(c.caret, len(c.orig)))
        ed.setTextCursor(cur)
        self.show_bar()
        QTimer.singleShot(0, self.reveal)
        self.win.set_hint("直接修改文字；點頁面其他地方或按「完成」套用（Ctrl+Enter 完成、Esc 取消）" if c.edit
                          else "輸入新文字；點頁面其他地方或按「完成」套用（Ctrl+Enter 完成、Esc 取消）")

    @staticmethod
    def _sig(st):
        return (st.family, st.size, st.color, st.bg, st.bold, st.underline, st.strike)

    # ------------------------------------------------------------------ 樣式與位置

    def style(self):
        c = self.cur
        if not c:
            return
        st = c.st
        text = c.ed.toPlainText() or c.orig or "A"
        f = qfont_for(text, st)
        c.ed.setFont(f)
        fill = st.bg and to_qcolor(st.bg) or (c.mask if c.edit else QColor(255, 255, 255, 230))
        col = to_qcolor(st.color)
        border = "#E53935" if getattr(c, "over", False) else theme.C["accent"]
        c.ed.setStyleSheet("QTextEdit { background: rgba(%d,%d,%d,%d); color: %s; border: 1.5px solid %s; border-radius: 0; padding: 0; }"
                           % (fill.red(), fill.green(), fill.blue(), fill.alpha(), col.name(), border))

    def layout(self):
        c = self.cur
        if not c or not self.s:
            return
        v = self.view
        if c.page >= v.doc.page_count:
            return
        s = v.s()
        st = c.st
        lh = max(c.line_height, st.size * 1.05) if c.edit else st.size * 1.25
        f = c.ed.font()
        px = max(1, st.size * s)
        if abs(f.pixelSize() - px) > 0.3 or f.pixelSize() <= 0:
            f.setPixelSize(int(round(px)))
            c.ed.setFont(f)
        # 固定行高
        doc = c.ed.document()
        cur = QTextCursor(doc)
        cur.select(QTextCursor.Document)
        bf = QTextBlockFormat()
        bf.setLineHeight(lh * s, 2)       # 2＝FixedHeight
        c.ed.blockSignals(True)
        cur.mergeBlockFormat(bf)
        c.ed.blockSignals(False)
        x, y = v.to_screen(c.page, c.area.x0, c.base)
        w = max(c.wrap_w * s, st.size * s * 2)
        fm = c.ed.fontMetrics()
        top = y - fm.ascent() - (lh * s - fm.height()) / 2
        doc.setTextWidth(w)
        h = max(doc.size().height(), lh * s) + 2
        c.ed.setGeometry(int(x) - 1, int(top) - 1, int(w) + 3, int(h) + 2)
        over = False
        if c.cell:
            _, cy = v.to_screen(c.page, c.cell[0], c.cell[3])
            over = top + h > cy + 3
        if over != getattr(c, "over", False):
            c.over = over
            self.style()
            if over:
                self.win.toast("按「完成」後會自動撐高這一列")

    def reveal(self):
        c = self.cur
        if not c:
            return
        v = self.view
        g = c.ed.geometry()
        vh = v.viewport().height()
        if g.bottom() > vh - 24:
            v.verticalScrollBar().setValue(v.verticalScrollBar().value() + g.bottom() - vh + 48)
        elif g.top() < 24:
            v.verticalScrollBar().setValue(v.verticalScrollBar().value() + g.top() - 48)

    # ------------------------------------------------------------------ 格式列

    def show_bar(self):
        bar = self.win.format_bar
        lay = bar.layout()
        while lay.count():
            it = lay.takeAt(0)
            if it.widget():
                it.widget().hide()
                it.widget().deleteLater()
        c = self.cur
        st = c.st

        def btn(text, tip, fn, checked=None, bold=False):
            b = QToolButton()
            b.setText(text)
            b.setToolTip(tip)
            b.setFocusPolicy(Qt.NoFocus)
            if checked is not None:
                b.setCheckable(True)
                b.setChecked(checked)
            f = b.font()
            f.setBold(bold)
            f.setPointSize(theme.pt(11))
            b.setFont(f)
            b.clicked.connect(lambda *_: (fn(), self.refresh()))
            lay.addWidget(b)
            return b

        lay.addWidget(QLabel("就地編輯" if c.edit else "新增文字"))
        fam = QComboBox()
        fam.setFocusPolicy(Qt.NoFocus)
        fam.addItems([x.split("（")[0] for x in TO.FAMILIES])
        fam.setCurrentIndex(st.family)
        fam.currentIndexChanged.connect(lambda k: (setattr(st, "family", k), self.refresh()))
        lay.addWidget(fam)
        btn("－", "縮小字級", lambda: setattr(st, "size", max(4, round((st.size - 1) * 2) / 2)))
        size = QPushButton("%g" % st.size)
        size.setFocusPolicy(Qt.NoFocus)
        size.setToolTip("輸入字級")
        size.setFixedWidth(theme.px(52))
        size.clicked.connect(self._ask_size)
        lay.addWidget(size)
        btn("＋", "放大字級", lambda: setattr(st, "size", min(144, round((st.size + 1) * 2) / 2)))
        b = btn("B", "粗體", lambda: setattr(st, "bold", not st.bold), st.bold, bold=True)
        u = btn("U", "底線", lambda: setattr(st, "underline", not st.underline), st.underline)
        f = u.font(); f.setUnderline(True); u.setFont(f)
        k = btn("S", "刪除線", lambda: setattr(st, "strike", not st.strike), st.strike)
        f = k.font(); f.setStrikeOut(True); k.setFont(f)
        fg = btn("A", "文字顏色", lambda: self._pick(FG, "color"), bold=True)
        fg.setStyleSheet("QToolButton { border-bottom: 4px solid %s; }" % to_qcolor(st.color).name())
        bgb = btn("▧", "背景顏色", lambda: self._pick(BG, "bg"))
        bgb.setStyleSheet("QToolButton { border-bottom: 4px solid %s; }" % (to_qcolor(st.bg).name() if st.bg else "#CCCCCC"))
        if c.cell:
            lay.addSpacing(12)
            for t, tip, fn in (("＋列", "在下方插入一列", self.insert_row), ("＋欄", "在右邊插入一欄", self.insert_column), ("合併", "合併儲存格", self.merge_start)):
                tb = QToolButton()
                tb.setText(t)
                tb.setToolTip(tip)
                tb.setFocusPolicy(Qt.NoFocus)
                tb.setStyleSheet("QToolButton { color: %s; }" % theme.C["accent"])
                tb.clicked.connect(lambda *_, fn=fn: fn())
                lay.addWidget(tb)
        lay.addStretch(1)
        cancel = QPushButton("取消")
        cancel.setFocusPolicy(Qt.NoFocus)
        cancel.clicked.connect(self.cancel)
        done = QPushButton("完成")
        done.setProperty("primary", True)
        done.setFocusPolicy(Qt.NoFocus)
        done.clicked.connect(lambda: self.commit())
        lay.addWidget(cancel)
        lay.addWidget(done)
        bar.show()

    def _ask_size(self):
        c = self.cur
        v, ok = QInputDialog.getDouble(self.win, "字級", "字級（pt）", c.st.size, 4, 144, 1)
        if ok:
            c.st.size = v
            self.refresh()

    def _pick(self, colors, attr):
        c = self.cur
        m = QMenu(self.win)
        for h in colors:
            act = m.addAction("無" if h is None else "■ " + h)
            if h:
                pm = act.font()
            act.setData(h)
        m.addSeparator()
        other = m.addAction("其他顏色…")
        act = m.exec(self.win.cursor().pos())
        if act is None:
            return
        if act is other:
            q = QColorDialog.getColor(to_qcolor(getattr(c.st, attr) or (1, 1, 1)), self.win, "選擇顏色")
            if q.isValid():
                setattr(c.st, attr, (q.redF(), q.greenF(), q.blueF()))
        else:
            h = act.data()
            setattr(c.st, attr, from_hex(h) if h else None)
        self.refresh()

    def refresh(self):
        if not self.cur:
            return
        self.style()
        self.layout()
        self.show_bar()
        self.cur.ed.setFocus()

    # ------------------------------------------------------------------ 完成／取消

    def close(self):
        c = self.cur
        if not c:
            return
        self.cur = None
        v = self.view
        try:
            v.frame.disconnect(self.layout)
        except Exception:
            pass
        v.mask = None
        c.ed.hide()
        c.ed.deleteLater()
        self.win.format_bar.hide()
        self.win.restore_hint()
        v.viewport().update()
        v.setFocus()

    def cancel(self):
        self.close()

    def _fit(self, c, doc):
        if not c.cell:
            return None
        page = doc[c.page]
        chars = T.page_chars(page)
        ru = TB.rules(page)
        return TO.Fit(c.cell, c.last_bottom, TB.below_max(chars, ru, c.cell[3] - 1.5), page.rect.height)

    def commit(self, after=None):
        c = self.cur
        if not c:
            if after:
                after()
            return
        text = c.ed.toPlainText().rstrip()
        st = c.st.copy()
        changed = text != c.orig or self._sig(c.st) != c.orig_sig
        self.close()
        if not changed or (not c.edit and not text.strip()):
            if after:
                after()
            return
        key = "edit_style" if c.edit else "add_style"
        self.win.prefs.set(key, {"family": st.family, "size": st.size, "color": list(st.color), "bg": list(st.bg) if st.bg else None,
                                 "bold": st.bold, "underline": st.underline, "strike": st.strike})
        if c.edit:
            st.line_height = max(c.line_height, st.size * 1.05)

            def op(doc):
                TO.replace_block(doc[c.page], c.area, c.base, c.wrap_w, text, st, self._fit(c, doc))
            self.win.edit("編輯文字" if text.strip() else "刪除文字", K_EDIT, op, after)
        else:
            st.line_height = 0

            def op(doc):
                TO.add_text(doc[c.page], c.area.x0, c.base, c.wrap_w, text, st, self._fit(c, doc))
            self.win.edit("新增文字", K_EDIT, op, after)

    # ------------------------------------------------------------------ 表格

    def _with_cell(self, job):
        c = self.cur
        if not c or not c.cell:
            return
        page, px, py = c.page, c.cell[0] + 3, c.cell[1] + 3

        def go():
            cell = TB.cell_at(self.rules(page), px, py)
            if cell is None:
                self.win.toast("找不到這個儲存格")
                return
            job(page, cell)
        self.commit(after=go)

    def insert_row(self):
        def job(page, cell):
            ru = self.rules(page)
            table = TB.table_at(ru, cell)
            h = cell[3] - cell[1]
            below = TB.below_max(self.view.chars(page), ru, cell[3] - 1.5)
            if below + h > self.s.doc[page].rect.height - 18:
                self.win.toast("頁面下方的空間不夠，無法插入新的一列")
                return
            self.win.edit("插入表格列", K_EDIT, lambda doc: TB.insert_row(doc[page], cell, table, h))
        self._with_cell(job)

    def insert_column(self):
        def job(page, cell):
            ru = self.rules(page)
            table = TB.table_at(ru, cell)
            w = min(cell[2] - cell[0], 120)
            if table[2] + w <= self.s.doc[page].rect.width - 18:
                self.win.edit("插入表格欄", K_EDIT, lambda doc: TB.insert_column(doc[page], cell, table, w))
                return
            # 右邊沒空間：從這一欄沒用到的右半邊切出新的一欄
            right = cell[0] + 4
            for ch in self.view.chars(page):
                if ch.c.strip() and cell[0] < ch.cx < cell[2] and table[1] < ch.cy < table[3]:
                    right = max(right, ch.x1)
            avail = cell[2] - right - 6
            if avail < 30:
                self.win.toast("這一欄的字已經填滿，右邊也沒有空間，無法插入新的一欄")
                return
            x = cell[2] - min(avail, (cell[2] - cell[0]) / 2)
            self.win.edit("插入表格欄", K_EDIT, lambda doc: TB.split_column(doc[page], x, table))
        self._with_cell(job)

    def merge_start(self):
        def job(page, first):
            self._merge_from = (page, first)
            self.win.set_tool_mode("merge", "點一下要和它合併的儲存格（中間的格子也會一起合併）", self._merge_tap)
        self._with_cell(job)

    def _merge_tap(self, page, x, y):
        frm = self._merge_from
        self._merge_from = None
        other = TB.cell_at(self.rules(page), x, y) if frm and frm[0] == page else None
        if other is None:
            self.win.toast("請點同一頁表格裡的儲存格")
            self.win.edit_mode()
            return
        a = frm[1]
        box = (min(a[0], other[0]), min(a[1], other[1]), max(a[2], other[2]), max(a[3], other[3]))
        self.win.edit("合併儲存格", K_EDIT, lambda doc: TB.merge(doc[page], box), self.win.edit_mode)

    def insert_table_at(self, page, x, y, rows, cols):
        ru = self.rules(page)
        y = TB.below_tables(ru, y)
        pr = self.s.doc[page].rect
        x0 = max(18, min(x, pr.width - 18 - 60 * cols))
        w = pr.width - 18 - x0
        row_h = 24
        H = rows * row_h
        low = TB.below_max(self.view.chars(page), ru, y - 2)
        push = low > y - 2 and low + H + 6 <= pr.height - 18

        def done():
            if not push and low > y - 2:
                self.win.toast("下方空間不夠，所以沒有把內容往下移")
            else:
                self.win.toast("點表格的格子就可以直接打字")
            self.win.edit_mode()
        self.win.edit("插入表格", K_EDIT, lambda doc: TB.add_table(doc[page], x0, y, w, rows, cols, row_h, push), done)
