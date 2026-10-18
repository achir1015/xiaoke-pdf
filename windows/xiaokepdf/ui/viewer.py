"""頁面檢視：連續捲動、單頁、雙頁；縮放後只重畫看得到的區塊（放多大都清晰）；檢視旋轉；
夜間（反白）、護眼色；搜尋標示、文字選取、工具（點、框、線、手繪）。

座標：
  頁面座標＝PyMuPDF 的頁面座標（未套用 /Rotate，左上原點）。所有編輯都用這個。
  顯示座標＝套用 /Rotate 之後（page.rect），再乘上檢視旋轉。
"""
from collections import OrderedDict

import pymupdf as fitz
from PySide6.QtCore import QPointF, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QImage, QPainter, QPainterPath, QPen, QTransform
from PySide6.QtWidgets import QAbstractScrollArea

from ..engine import text as T
from . import theme

GAP = 12
PAD = 16
T_NONE, T_POINT, T_RECT, T_LINE, T_INK, T_ELLIPSE = range(6)


class PageView(QAbstractScrollArea):
    pageChanged = Signal(int)
    zoomChanged = Signal(float)
    tapped = Signal(int, float, float)                 # 頁碼、頁面座標
    rectDrawn = Signal(int, object)                    # 頁碼、fitz.Rect（頁面座標）
    lineDrawn = Signal(int, object, object)            # 頁碼、起點、終點
    inkChanged = Signal()
    selectionChanged = Signal()
    contextMenu = Signal(int, float, float, object)    # 頁碼、頁面座標、全域位置
    doubleTapped = Signal(int, float, float)
    frame = Signal()                                    # 每次重畫後（就地編輯框要跟著移動）

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMouseTracking(True)
        self.viewport().setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        self.session = None
        self.layout_mode = "continuous"
        self.zoom = 1.0
        self.vrot = 0
        self.night = False
        self.sepia = False
        self.tool = T_NONE
        self.tool_color = QColor("#E53935")
        self.tool_width = 2.0
        self.selectable = True
        # 顯示用的狀態
        self.hits = {}          # page -> [fitz.Quad]
        self.hit_cur = None     # (page, quad)
        self.sel = None         # (page, a, b) 字元索引
        self.flash = None       # (page, rect)
        self.mask = None        # (page, rect, QColor) 就地編輯時蓋住原文字
        self.field_rects = {}   # page -> [rect]（標示表單欄位）
        self.measure_text = None
        self.ink = []           # [(page, [[QPointF(頁面座標)...]])]
        self._stroke = None
        self._drag = None       # (page, start(頁面), end(頁面))
        self._press = None
        self._lay = []          # 每頁在版面上的 QRectF（版面座標，單位 pt）
        self._lay_w = self._lay_h = 1
        self._base = 1.0
        self._cur = 0
        self._cache = OrderedDict()   # (page, version, scale, vrot, clip) -> QImage
        self._cache_bytes = 0
        self._queue = []
        self._chars = {}              # (version, page) -> chars
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._render_next)
        self.horizontalScrollBar().valueChanged.connect(lambda _: self._scrolled())
        self.verticalScrollBar().valueChanged.connect(lambda _: self._scrolled())

    # ------------------------------------------------------------------ 文件

    def set_session(self, s):
        self.session = s
        self.hits, self.hit_cur, self.sel, self.flash, self.mask = {}, None, None, None, None
        self.ink = []
        self._chars.clear()
        if s:
            self.layout_mode, self.zoom = s.layout, s.zoom
            self._cur = s.page
        self.relayout()
        if s:
            self.go_to(s.page)
        self.viewport().update()

    def reset(self):
        """文件內容改變（編輯、復原）後。"""
        self._chars.clear()
        keep = self.verticalScrollBar().value()
        self.relayout()
        self.verticalScrollBar().setValue(keep)
        self._queue.clear()
        self.viewport().update()

    def chars(self, i):
        key = (self.session.version, i)
        if key not in self._chars:
            if len(self._chars) > 40:
                self._chars.clear()
            self._chars[key] = T.page_chars(self.session.doc[i])
        return self._chars[key]

    @property
    def doc(self):
        return self.session.doc if self.session else None

    # ------------------------------------------------------------------ 版面

    def _psize(self, i):
        r = self.doc[i].rect
        return (r.height, r.width) if self.vrot % 2 else (r.width, r.height)

    def relayout(self):
        self._lay = []
        if not self.doc or self.doc.page_count == 0:
            self.horizontalScrollBar().setRange(0, 0)
            self.verticalScrollBar().setRange(0, 0)
            return
        n = self.doc.page_count
        self._cur = max(0, min(self._cur, n - 1))
        W = max(100, self.viewport().width() - 2 * PAD)
        H = max(100, self.viewport().height() - 2 * PAD)
        if self.layout_mode == "single":
            w, h = self._psize(self._cur)
            self._lay = [None] * n
            self._lay[self._cur] = QRectF(0, 0, w, h)
            self._lay_w, self._lay_h = w, h
            self._base = min(W / w, H / h)
        elif self.layout_mode == "two":
            y, mw, rows = 0, 0, []
            self._lay = [None] * n
            for i in range(0, n, 2):
                w0, h0 = self._psize(i)
                w1, h1 = self._psize(i + 1) if i + 1 < n else (0, 0)
                rh = max(h0, h1)
                rw = w0 + (GAP + w1 if i + 1 < n else 0)
                self._lay[i] = QRectF(0, y + (rh - h0) / 2, w0, h0)
                if i + 1 < n:
                    self._lay[i + 1] = QRectF(w0 + GAP, y + (rh - h1) / 2, w1, h1)
                rows.append((i, rw))
                mw = max(mw, rw)
                y += rh + GAP
            for i, rw in rows:
                off = (mw - rw) / 2
                self._lay[i].translate(off, 0)
                if i + 1 < n:
                    self._lay[i + 1].translate(off, 0)
            self._lay_w, self._lay_h = mw, y - GAP
            self._base = W / mw
        else:
            mw = max(self._psize(i)[0] for i in range(n))
            y = 0
            for i in range(n):
                w, h = self._psize(i)
                self._lay.append(QRectF((mw - w) / 2, y, w, h))
                y += h + GAP
            self._lay_w, self._lay_h = mw, y - GAP
            self._base = W / mw
        self._update_scroll()

    def s(self):
        return self._base * self.zoom

    def _update_scroll(self):
        s = self.s()
        cw, ch = self._lay_w * s + 2 * PAD, self._lay_h * s + 2 * PAD
        self.horizontalScrollBar().setRange(0, max(0, int(cw - self.viewport().width())))
        self.verticalScrollBar().setRange(0, max(0, int(ch - self.viewport().height())))
        self.horizontalScrollBar().setPageStep(self.viewport().width())
        self.verticalScrollBar().setPageStep(self.viewport().height())
        self.verticalScrollBar().setSingleStep(40)
        self.horizontalScrollBar().setSingleStep(40)

    def _origin(self):
        s = self.s()
        cw, ch = self._lay_w * s, self._lay_h * s
        vw, vh = self.viewport().width(), self.viewport().height()
        ox = (vw - cw) / 2 if cw + 2 * PAD < vw else PAD - self.horizontalScrollBar().value()
        oy = (vh - ch) / 2 if ch + 2 * PAD < vh else PAD - self.verticalScrollBar().value()
        return ox, oy

    def page_screen_rect(self, i):
        r = self._lay[i] if 0 <= i < len(self._lay) else None
        if r is None:
            return None
        s = self.s()
        ox, oy = self._origin()
        return QRectF(ox + r.x() * s, oy + r.y() * s, r.width() * s, r.height() * s)

    def page_matrix(self, i):
        """頁面座標 → 視窗座標（fitz.Matrix）"""
        page = self.doc[i]
        sr = self.page_screen_rect(i)
        s = self.s()
        m = page.rotation_matrix * fitz.Matrix(s, s)
        r = page.rect
        W, H = r.width * s, r.height * s
        if self.vrot == 1:
            m = m * fitz.Matrix(0, 1, -1, 0, H, 0)
        elif self.vrot == 2:
            m = m * fitz.Matrix(-1, 0, 0, -1, W, H)
        elif self.vrot == 3:
            m = m * fitz.Matrix(0, -1, 1, 0, 0, W)
        return m * fitz.Matrix(1, 0, 0, 1, sr.x(), sr.y())

    def qtransform(self, i):
        m = self.page_matrix(i)
        return QTransform(m.a, m.b, m.c, m.d, m.e, m.f)

    def to_page(self, i, x, y):
        p = fitz.Point(x, y) * ~self.page_matrix(i)
        return p.x, p.y

    def to_screen(self, i, x, y):
        p = fitz.Point(x, y) * self.page_matrix(i)
        return p.x, p.y

    def rect_to_screen(self, i, r):
        q = fitz.Rect(r).quad * self.page_matrix(i)
        rr = q.rect
        return QRectF(rr.x0, rr.y0, rr.width, rr.height)

    def page_at(self, x, y):
        for i in range(len(self._lay)):
            r = self.page_screen_rect(i)
            if r is not None and r.contains(x, y):
                return i
        return -1

    def visible_pages(self):
        out = []
        vh, vw = self.viewport().height(), self.viewport().width()
        for i in range(len(self._lay)):
            r = self.page_screen_rect(i)
            if r is not None and r.bottom() >= 0 and r.top() <= vh and r.right() >= 0 and r.left() <= vw:
                out.append(i)
        return out

    def current_page(self):
        return self._cur

    def _scrolled(self):
        if self.layout_mode != "single" and self._lay:
            cy = self.viewport().height() * 0.4
            best, bd = self._cur, 1e18
            for i in self.visible_pages():
                r = self.page_screen_rect(i)
                d = 0 if r.top() <= cy <= r.bottom() else min(abs(r.top() - cy), abs(r.bottom() - cy))
                if d < bd:
                    bd, best = d, i
            if best != self._cur:
                self._cur = best
                if self.session:
                    self.session.page = best
                self.pageChanged.emit(best)
        self.viewport().update()

    def go_to(self, i, rect=None):
        if not self.doc:
            return
        i = max(0, min(i, self.doc.page_count - 1))
        self._cur = i
        if self.session:
            self.session.page = i
        if self.layout_mode == "single":
            self.relayout()
            self.horizontalScrollBar().setValue(0)
            self.verticalScrollBar().setValue(0)
        elif self._lay:
            self.verticalScrollBar().setValue(int(self._lay[i].y() * self.s()))
        if rect is not None:
            r = self.rect_to_screen(i, rect)
            self.horizontalScrollBar().setValue(int(self.horizontalScrollBar().value() + r.center().x() - self.viewport().width() / 2))
            self.verticalScrollBar().setValue(int(self.verticalScrollBar().value() + r.center().y() - self.viewport().height() / 2))
            self.flash = (i, fitz.Rect(rect))
            QTimer.singleShot(1600, self._clear_flash)
        self.pageChanged.emit(i)
        self.viewport().update()

    def _clear_flash(self):
        self.flash = None
        self.viewport().update()

    def set_zoom(self, z, fx=None, fy=None):
        if not self.doc:
            return
        z = max(0.25 if self.layout_mode != "single" else 1.0, min(z, 16.0))
        fx = self.viewport().width() / 2 if fx is None else fx
        fy = self.viewport().height() / 2 if fy is None else fy
        s0 = self.s()
        ox, oy = self._origin()
        lx, ly = (fx - ox) / s0, (fy - oy) / s0
        self.zoom = z
        if self.session:
            self.session.zoom = z
        self._update_scroll()
        s1 = self.s()
        self.horizontalScrollBar().setValue(int(lx * s1 + PAD - fx))
        self.verticalScrollBar().setValue(int(ly * s1 + PAD - fy))
        self.zoomChanged.emit(z)
        self.viewport().update()

    def set_layout(self, mode):
        p = self._cur
        self.layout_mode = mode
        if self.session:
            self.session.layout = mode
        if mode == "single":
            self.zoom = 1.0
        self.relayout()
        self.go_to(p)

    def rotate_view(self, d):
        p = self._cur
        self.vrot = (self.vrot + d) % 4
        self._cache.clear()
        self.relayout()
        self.go_to(p)

    def fit_width(self):
        if self.layout_mode == "single":
            self.layout_mode = "continuous"
            self.relayout()
        self.set_zoom(1.0)

    def resizeEvent(self, e):
        p = self._cur
        old_w = getattr(self, "_last_w", None)
        self._last_w = self.viewport().width()
        if old_w == self._last_w and self.layout_mode != "single":
            self._update_scroll()           # 只有高度改變：維持捲動位置
        else:
            self.relayout()
            self.go_to(p)
        super().resizeEvent(e)

    # ------------------------------------------------------------------ 繪製頁面

    def _filter(self, img):
        if self.night:
            img.invertPixels()
        return img

    def _key(self, i, scale, clip=None):
        return (i, self.session.version, round(scale, 3), self.vrot, self.night, clip)

    def _best_image(self, i):
        """快取裡這一頁最接近目前倍率的整頁圖。"""
        best = None
        for k, img in self._cache.items():
            if k[0] == i and k[1] == self.session.version and k[3] == self.vrot and k[4] == self.night and k[5] is None:
                if best is None or abs(k[2] - self.s()) < abs(best[0] - self.s()):
                    best = (k[2], img)
        return best

    def _request(self, item):
        if item not in self._queue:
            self._queue.append(item)
        if not self._timer.isActive():
            self._timer.start(0)

    def _render_next(self):
        while self._queue:
            i, scale, clip = self._queue.pop(0)
            if not self.doc or i >= self.doc.page_count:
                continue
            if i not in self.visible_pages() and clip is not None:
                continue
            key = self._key(i, scale, clip)
            if key in self._cache:
                continue
            try:
                page = self.doc[i]
                m = fitz.Matrix(scale, scale).prerotate(90 * self.vrot)
                if clip is not None:
                    pix = page.get_pixmap(matrix=m, clip=fitz.Rect(clip), annots=True)
                else:
                    pix = page.get_pixmap(matrix=m, annots=True)
                img = QImage(pix.samples, pix.width, pix.height, pix.stride, QImage.Format_RGB888 if pix.n == 3 else QImage.Format_RGBA8888).copy()
                img = self._filter(img)
                self._cache[key] = img
                self._cache_bytes += img.sizeInBytes()
                while self._cache_bytes > 400 * 1024 * 1024 and len(self._cache) > 4:
                    _, old = self._cache.popitem(last=False)
                    self._cache_bytes -= old.sizeInBytes()
            except Exception:
                pass
            self.viewport().update()
            if self._queue:
                self._timer.start(0)
            return

    def paintEvent(self, e):
        p = QPainter(self.viewport())
        p.setRenderHint(QPainter.SmoothPixmapTransform, True)
        p.setRenderHint(QPainter.Antialiasing, True)
        p.fillRect(self.viewport().rect(), QColor("#000000" if self.night else theme.C["page_bg"]))
        if not self.doc or not self._lay:
            p.end()
            return
        dpr = self.devicePixelRatioF()
        s = self.s()
        vis = self.visible_pages()
        paper = QColor("#1E1E1E") if self.night else (QColor("#F3E9D2") if self.sepia else QColor("#FFFFFF"))
        for i in vis:
            r = self.page_screen_rect(i)
            p.fillRect(r.translated(1, 2), QColor(0, 0, 0, 34))
            p.fillRect(r, paper)
            want = s * dpr
            # 整頁圖：太大時只畫看得到的區塊
            full_px = r.width() * dpr * r.height() * dpr
            best = self._best_image(i)
            if best is not None:
                p.drawImage(r, best[1])
            if full_px <= 24e6:
                if best is None or abs(best[0] - want) > 0.01:
                    self._request((i, want, None))
            else:
                if best is None:
                    self._request((i, min(want, 2.0), None))
                vr = QRectF(self.viewport().rect()).intersected(r)
                if not vr.isEmpty():
                    # 看得到的區塊（顯示座標，未乘倍率）
                    pr = self.page_screen_rect(i)
                    dx0, dy0 = (vr.x() - pr.x()) / s, (vr.y() - pr.y()) / s
                    clip = (round(dx0, 1), round(dy0, 1), round(dx0 + vr.width() / s, 1), round(dy0 + vr.height() / s, 1))
                    # 檢視旋轉時 clip 換回未旋轉的顯示座標
                    if self.vrot:
                        clip = None
                    if clip is not None:
                        key = self._key(i, want, clip)
                        img = self._cache.get(key)
                        if img is not None:
                            p.drawImage(QRectF(pr.x() + clip[0] * s, pr.y() + clip[1] * s, (clip[2] - clip[0]) * s, (clip[3] - clip[1]) * s), img)
                        else:
                            # 用最接近的舊區塊頂著
                            for k, im in reversed(self._cache.items()):
                                if k[0] == i and k[1] == self.session.version and k[5] is not None and abs(k[2] - want) < 0.01:
                                    c = k[5]
                                    p.drawImage(QRectF(pr.x() + c[0] * s, pr.y() + c[1] * s, (c[2] - c[0]) * s, (c[3] - c[1]) * s), im)
                                    break
                            self._request((i, want, clip))
            self._overlays(p, i)
        # 預先繪製前後頁
        if vis:
            for j in (vis[-1] + 1, vis[0] - 1):
                if 0 <= j < self.doc.page_count and self._lay[j] is not None and self._best_image(j) is None:
                    self._request((j, s * dpr, None))
        if self.measure_text:
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(0, 0, 0, 200))
            fm = p.fontMetrics()
            w = fm.horizontalAdvance(self.measure_text) + 24
            box = QRectF(self.viewport().width() / 2 - w / 2, 10, w, 30)
            p.drawRoundedRect(box, 8, 8)
            p.setPen(QColor("white"))
            p.drawText(box, Qt.AlignCenter, self.measure_text)
        p.end()
        self.frame.emit()

    def _overlays(self, p, i):
        p.save()
        p.setTransform(self.qtransform(i), True)
        inv = 1.0 / max(self.s(), 0.01)
        if self.mask and self.mask[0] == i:
            r = self.mask[1]
            p.fillRect(QRectF(r.x0, r.y0, r.width, r.height), self.mask[2])
        for r in self.field_rects.get(i, []):
            p.fillRect(QRectF(r.x0, r.y0, r.width, r.height), QColor(43, 108, 240, 40))
            p.setPen(QPen(QColor(43, 108, 240, 150), inv))
            p.drawRect(QRectF(r.x0, r.y0, r.width, r.height))
        for q in self.hits.get(i, []):
            p.fillRect(QRectF(q.rect.x0, q.rect.y0, q.rect.width, q.rect.height), QColor(255, 212, 0, 110))
        if self.hit_cur and self.hit_cur[0] == i:
            q = self.hit_cur[1]
            p.fillRect(QRectF(q.rect.x0, q.rect.y0, q.rect.width, q.rect.height), QColor(255, 122, 0, 150))
        if self.sel and self.sel[0] == i:
            for r in self.selected_rects():
                p.fillRect(QRectF(r.x0, r.y0, r.width, r.height), QColor(61, 123, 255, 80))
        if self.flash and self.flash[0] == i:
            r = self.flash[1]
            p.setPen(QPen(QColor("#FF7A00"), 3 * inv))
            p.setBrush(Qt.NoBrush)
            p.drawRect(QRectF(r.x0, r.y0, r.width, r.height))
        pen = QPen(self.tool_color, max(self.tool_width, 1.5 * inv))
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        p.setPen(pen)
        p.setBrush(Qt.NoBrush)
        if self._drag and self._drag[0] == i:
            a, b = self._drag[1], self._drag[2]
            if self.tool == T_LINE:
                p.drawLine(QPointF(*a), QPointF(*b))
            else:
                rr = QRectF(QPointF(*a), QPointF(*b)).normalized()
                if self.tool == T_ELLIPSE:
                    p.drawEllipse(rr)
                else:
                    p.drawRect(rr)
        for pg, strokes in self.ink:
            if pg != i:
                continue
            for st in strokes:
                self._draw_stroke(p, st)
        if self._stroke and self._stroke[0] == i:
            self._draw_stroke(p, self._stroke[1])
        p.restore()

    def _draw_stroke(self, p, st):
        if not st:
            return
        path = QPainterPath(QPointF(*st[0]))
        for q in st[1:]:
            path.lineTo(QPointF(*q))
        if len(st) == 1:
            path.lineTo(QPointF(st[0][0] + 0.1, st[0][1]))
        p.drawPath(path)

    # ------------------------------------------------------------------ 文字選取

    def selected_rects(self):
        if not self.sel:
            return []
        i, a, b = self.sel
        a, b = min(a, b), max(a, b)
        cs = self.chars(i)
        out = []
        cur = None
        for ch in cs[a:b + 1]:
            r = fitz.Rect(ch.x0, ch.y0, ch.x1, ch.y1)
            if cur is not None and abs(r.y0 - cur.y0) < max(r.height, cur.height) * 0.5 and r.x0 >= cur.x0 - r.height:
                cur |= r
            else:
                if cur is not None:
                    out.append(cur)
                cur = r
        if cur is not None:
            out.append(cur)
        return out

    def selected_text(self):
        if not self.sel:
            return ""
        i, a, b = self.sel
        a, b = min(a, b), max(a, b)
        cs = self.chars(i)
        out, prev = [], None
        for ch in cs[a:b + 1]:
            if prev is not None and (ch.base - prev.base) > prev.size * 0.5:
                out.append("\n")
            out.append(ch.c)
            prev = ch
        return "".join(out).strip()

    def _char_at(self, i, x, y, slop=12):
        best, bd = -1, slop * slop
        for k, ch in enumerate(self.chars(i)):
            cx = max(ch.x0, min(x, ch.x1))
            cy = max(ch.y0, min(y, ch.y1))
            d = (cx - x) ** 2 + (cy - y) ** 2
            if d < bd:
                bd, best = d, k
                if d == 0:
                    break
        return best

    def clear_selection(self):
        if self.sel:
            self.sel = None
            self.selectionChanged.emit()
            self.viewport().update()

    def select_all(self, i):
        n = len(self.chars(i))
        if n:
            self.sel = (i, 0, n - 1)
            self.selectionChanged.emit()
            self.viewport().update()

    # ------------------------------------------------------------------ 滑鼠

    def _pt(self, e):
        pos = e.position()
        i = self.page_at(pos.x(), pos.y())
        if i < 0:
            return -1, 0, 0
        x, y = self.to_page(i, pos.x(), pos.y())
        return i, x, y

    def mousePressEvent(self, e):
        self.setFocus()
        if e.button() == Qt.MiddleButton or (e.button() == Qt.LeftButton and e.modifiers() & Qt.AltModifier):
            self._press = ("pan", e.position(), self.horizontalScrollBar().value(), self.verticalScrollBar().value())
            self.viewport().setCursor(Qt.ClosedHandCursor)
            return
        if e.button() == Qt.RightButton:
            i, x, y = self._pt(e)
            if i >= 0:
                self.contextMenu.emit(i, x, y, e.globalPosition().toPoint())
            return
        if e.button() != Qt.LeftButton:
            return
        i, x, y = self._pt(e)
        self._press = ("down", e.position(), i, x, y)
        if i < 0:
            return
        if self.tool in (T_RECT, T_ELLIPSE, T_LINE):
            self._drag = (i, (x, y), (x, y))
        elif self.tool == T_INK:
            self._stroke = (i, [(x, y)])
        elif self.tool == T_NONE and self.selectable:
            k = self._char_at(i, x, y, 4)
            if k >= 0:
                self.sel = (i, k, k)
                self._press = ("select", e.position(), i, x, y)
            elif self.sel:
                self.clear_selection()
        self.viewport().update()

    def mouseMoveEvent(self, e):
        if self._press and self._press[0] == "pan":
            d = e.position() - self._press[1]
            self.horizontalScrollBar().setValue(int(self._press[2] - d.x()))
            self.verticalScrollBar().setValue(int(self._press[3] - d.y()))
            return
        if not self._press:
            i, x, y = self._pt(e)
            if self.tool == T_NONE and i >= 0 and self.selectable:
                over = self._char_at(i, x, y, 2) >= 0
                link = any(fitz.Rect(l["from"]).contains((x, y)) for l in self.doc[i].get_links())
                self.viewport().setCursor(Qt.PointingHandCursor if link else (Qt.IBeamCursor if over else Qt.ArrowCursor))
            elif self.tool != T_NONE:
                self.viewport().setCursor(Qt.CrossCursor)
            return
        if self._press[0] == "select":
            i = self._press[2]
            pos = e.position()
            x, y = self.to_page(i, pos.x(), pos.y())
            k = self._char_at(i, x, y, 40)
            if k >= 0 and self.sel:
                self.sel = (i, self.sel[1], k)
                self.viewport().update()
            return
        i0 = self._press[2]
        if i0 < 0:
            return
        pos = e.position()
        x, y = self.to_page(i0, pos.x(), pos.y())
        if self._drag:
            self._drag = (self._drag[0], self._drag[1], (x, y))
        elif self._stroke:
            self._stroke[1].append((x, y))
        self.viewport().update()

    def mouseReleaseEvent(self, e):
        pr = self._press
        self._press = None
        self.viewport().unsetCursor()
        if not pr or pr[0] == "pan":
            return
        moved = (e.position() - pr[1]).manhattanLength() > 6
        if pr[0] == "select":
            if moved and self.sel:
                self.selectionChanged.emit()
            else:
                self.sel = None
                self.selectionChanged.emit()
                self._tap(pr[2], pr[3], pr[4])
            self.viewport().update()
            return
        i, x, y = pr[2], pr[3], pr[4]
        if self._drag:
            d = self._drag
            self._drag = None
            if moved:
                if self.tool == T_LINE:
                    self.lineDrawn.emit(d[0], fitz.Point(*d[1]), fitz.Point(*d[2]))
                else:
                    self.rectDrawn.emit(d[0], fitz.Rect(d[1], d[2]).normalize())
            else:
                self.tapped.emit(i, x, y)
            self.viewport().update()
            return
        if self._stroke:
            st = self._stroke
            self._stroke = None
            for k, (pg, strokes) in enumerate(self.ink):
                if pg == st[0]:
                    strokes.append(st[1])
                    break
            else:
                self.ink = [(st[0], [st[1]])]
            self.inkChanged.emit()
            self.viewport().update()
            return
        if i >= 0 and not moved:
            self._tap(i, x, y)

    def _tap(self, i, x, y):
        # 閱讀模式點到連結就打開
        if self.tool == T_NONE:
            for l in self.doc[i].get_links():
                if fitz.Rect(l["from"]).contains((x, y)):
                    self.window().follow_link(l)
                    return
        self.tapped.emit(i, x, y)

    def mouseDoubleClickEvent(self, e):
        i, x, y = self._pt(e)
        if i < 0:
            return
        if self.tool == T_NONE and self.selectable:
            k = self._char_at(i, x, y, 4)
            if k >= 0:
                cs = self.chars(i)
                a = b = k
                if not T.CJK.match(cs[k].c):
                    while a > 0 and cs[a - 1].c.isalnum() and abs(cs[a - 1].base - cs[k].base) < 1:
                        a -= 1
                    while b + 1 < len(cs) and cs[b + 1].c.isalnum() and abs(cs[b + 1].base - cs[k].base) < 1:
                        b += 1
                self.sel = (i, a, b)
                self.selectionChanged.emit()
                self.viewport().update()
                return
        self.doubleTapped.emit(i, x, y)

    def wheelEvent(self, e):
        if e.modifiers() & Qt.ControlModifier:
            f = 1.15 if e.angleDelta().y() > 0 else 1 / 1.15
            self.set_zoom(self.zoom * f, e.position().x(), e.position().y())
            return
        if self.layout_mode == "single" and self.verticalScrollBar().maximum() == 0:
            self.go_to(self._cur + (1 if e.angleDelta().y() < 0 else -1))
            return
        super().wheelEvent(e)

    def keyPressEvent(self, e):
        k = e.key()
        if k in (Qt.Key_PageDown, Qt.Key_Space) and self.layout_mode == "single":
            self.go_to(self._cur + 1); return
        if k == Qt.Key_PageUp and self.layout_mode == "single":
            self.go_to(self._cur - 1); return
        if k == Qt.Key_Home:
            self.go_to(0); return
        if k == Qt.Key_End:
            self.go_to(self.doc.page_count - 1 if self.doc else 0); return
        super().keyPressEvent(e)

    def take_ink(self):
        strokes = [(pg, st) for pg, st in self.ink]
        self.ink = []
        self.viewport().update()
        return strokes

    def undo_ink(self):
        if self.ink and self.ink[-1][1]:
            self.ink[-1][1].pop()
            if not self.ink[-1][1]:
                self.ink.pop()
            self.inkChanged.emit()
            self.viewport().update()
