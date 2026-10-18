"""側邊面板：縮圖、書籤（可搜尋、可編輯）、註解（回覆、狀態、改樣式、刪除）、表單欄位、圖層、附件。"""
import os

import pymupdf as fitz
from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QColor, QIcon, QImage, QPixmap
from PySide6.QtWidgets import (QAbstractItemView, QColorDialog, QFileDialog, QHBoxLayout, QInputDialog, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QMenu, QMessageBox, QPushButton, QTabWidget, QToolButton,
                               QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget)

from ..engine import annots as AN
from ..engine import forms as FM
from ..engine import pages as PG
from ..engine.session import K_ANNOT, K_EDIT, K_FORM


def thumb(doc, i, width=150):
    page = doc[i]
    k = width / max(page.rect.width, 1)
    pix = page.get_pixmap(matrix=fitz.Matrix(k, k), alpha=False)
    return QImage(pix.samples, pix.width, pix.height, pix.stride, QImage.Format_RGB888).copy()


def _btn(text, fn, tip=None):
    b = QToolButton()
    b.setText(text)
    if tip:
        b.setToolTip(tip)
    b.clicked.connect(lambda *_: fn())
    return b


class SidePanels(QTabWidget):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.s = None
        self.setDocumentMode(True)
        self.thumbs = Thumbs(win)
        self.marks = Bookmarks(win)
        self.comments = Comments(win)
        self.fields = Fields(win)
        self.layers = Layers(win)
        self.files = Attachments(win)
        for w, t in ((self.thumbs, "縮圖"), (self.marks, "書籤"), (self.comments, "註解"), (self.fields, "表單"), (self.layers, "圖層"), (self.files, "附件")):
            self.addTab(w, t)
        self.currentChanged.connect(lambda _: self.refresh())

    def set_session(self, s):
        self.s = s
        self.refresh(all_=True)

    def refresh(self, all_=False):
        if not self.s:
            return
        w = self.currentWidget()
        if all_:
            for p in (self.thumbs, self.marks, self.comments, self.fields, self.layers, self.files):
                p.dirty = True
        else:
            for p in (self.thumbs, self.marks, self.comments, self.fields, self.layers, self.files):
                p.dirty = True
        w.load(self.s)
        w.dirty = False

    def page_changed(self, i):
        if self.currentWidget() is self.thumbs:
            self.thumbs.mark(i)

    def show_comment(self, page, xref):
        self.win.dock.show()
        self.setCurrentWidget(self.comments)
        self.comments.load(self.win.session())
        self.comments.focus(page, xref)


class Thumbs(QListWidget):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.dirty = True
        self.setViewMode(QListWidget.IconMode)
        self.setIconSize(QSize(150, 200))
        self.setResizeMode(QListWidget.Adjust)
        self.setMovement(QListWidget.Static)
        self.setSpacing(8)
        self.setUniformItemSizes(False)
        self.itemClicked.connect(lambda it: self.win.view.go_to(self.row(it)))
        self._version = None
        self._pending = []
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._next)

    def load(self, s):
        if self._version == (id(s), s.version) and self.count() == s.doc.page_count:
            return
        self._version = (id(s), s.version)
        self.clear()
        labels = PG.page_labels(s.doc)
        for i in range(s.doc.page_count):
            lbl = labels[i] if labels[i] and labels[i] != str(i + 1) else ""
            it = QListWidgetItem("%d%s" % (i + 1, "（%s）" % lbl if lbl else ""))
            r = s.doc[i].rect
            pm = QPixmap(150, int(150 * r.height / max(r.width, 1)))
            pm.fill(QColor("#FFFFFF"))
            it.setIcon(QIcon(pm))
            it.setTextAlignment(Qt.AlignHCenter)
            self.addItem(it)
        self._pending = list(range(s.doc.page_count))
        self._s = s
        self._timer.start(0)
        self.mark(self.win.view.current_page())

    def _next(self):
        if not self._pending or self._s is not self.win.session():
            self._timer.stop()
            return
        # 先畫看得到的
        vis = [i for i in self._pending if not self.visualItemRect(self.item(i)).isEmpty() and self.viewport().rect().intersects(self.visualItemRect(self.item(i)))]
        i = vis[0] if vis else self._pending[0]
        self._pending.remove(i)
        try:
            self.item(i).setIcon(QIcon(QPixmap.fromImage(thumb(self._s.doc, i))))
        except Exception:
            pass

    def mark(self, i):
        if 0 <= i < self.count():
            self.setCurrentRow(i)
            self.scrollToItem(self.item(i))


class Bookmarks(QWidget):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.dirty = True
        v = QVBoxLayout(self)
        v.setContentsMargins(4, 4, 4, 4)
        self.find = QLineEdit()
        self.find.setPlaceholderText("搜尋書籤")
        self.find.setClearButtonEnabled(True)
        self.find.textChanged.connect(self._filter)
        v.addWidget(self.find)
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.itemClicked.connect(lambda it: self.win.view.go_to(it.data(0, Qt.UserRole) - 1))
        self.tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._menu)
        v.addWidget(self.tree, 1)
        row = QHBoxLayout()
        row.addWidget(_btn("＋", self.add, "在目前頁面新增書籤"))
        row.addWidget(_btn("✎", self.rename, "重新命名"))
        row.addWidget(_btn("▲", lambda: self.move(-1), "上移"))
        row.addWidget(_btn("▼", lambda: self.move(1), "下移"))
        row.addWidget(_btn("⇥", lambda: self.indent(1), "降一層"))
        row.addWidget(_btn("⇤", lambda: self.indent(-1), "升一層"))
        row.addWidget(_btn("🗑", self.delete, "刪除"))
        row.addStretch(1)
        v.addLayout(row)
        self.empty = QLabel("這份文件沒有書籤。按「＋」在目前頁面新增。", objectName="sub")
        self.empty.setWordWrap(True)
        v.addWidget(self.empty)

    def load(self, s):
        self.s = s
        self.items = [list(x) for x in s.doc.get_toc(simple=True)]
        self._build()

    def _build(self):
        self.tree.clear()
        stack = [(0, self.tree.invisibleRootItem())]
        for k, (lvl, title, page) in enumerate(self.items):
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            parent = stack[-1][1] if stack else self.tree.invisibleRootItem()
            it = QTreeWidgetItem(parent, [title])
            it.setData(0, Qt.UserRole, page)
            it.setData(0, Qt.UserRole + 1, k)
            it.setToolTip(0, "第 %d 頁" % page)
            stack.append((lvl, it))
        self.tree.expandToDepth(0)
        self.empty.setVisible(not self.items)
        self._filter(self.find.text())

    def _filter(self, q):
        """搜尋：符合的項目保留上層脈絡；清除後恢復。"""
        q = q.strip().lower()

        def walk(it):
            hit = bool(q) and q in it.text(0).lower()
            child_hit = False
            for k in range(it.childCount()):
                child_hit |= walk(it.child(k))
            show = not q or hit or child_hit
            it.setHidden(not show)
            if q and child_hit:
                it.setExpanded(True)
            return hit or child_hit
        root = self.tree.invisibleRootItem()
        for k in range(root.childCount()):
            walk(root.child(k))

    def _cur(self):
        it = self.tree.currentItem()
        return None if it is None else it.data(0, Qt.UserRole + 1)

    def _save(self, label):
        items = [list(x) for x in self.items]
        self.win.edit(label, K_EDIT, lambda d: PG.set_toc(d, items))

    def add(self):
        p = self.win.view.current_page() + 1
        t, ok = QInputDialog.getText(self, "新增書籤", "書籤名稱", text="第 %d 頁" % p)
        if not ok or not t.strip():
            return
        k = self._cur()
        lvl = self.items[k][0] if k is not None else 1
        pos = (k + 1) if k is not None else len(self.items)
        self.items.insert(pos, [lvl, t.strip(), p])
        self._save("新增書籤")

    def rename(self):
        k = self._cur()
        if k is None:
            return
        t, ok = QInputDialog.getText(self, "重新命名", "書籤名稱", text=self.items[k][1])
        if ok and t.strip():
            self.items[k][1] = t.strip()
            self._save("重新命名書籤")

    def _span(self, k):
        lvl = self.items[k][0]
        e = k + 1
        while e < len(self.items) and self.items[e][0] > lvl:
            e += 1
        return e

    def move(self, d):
        k = self._cur()
        if k is None:
            return
        e = self._span(k)
        block = self.items[k:e]
        rest = self.items[:k] + self.items[e:]
        # 找同一層的前一個／後一個
        lvl = block[0][0]
        if d < 0:
            j = k - 1
            while j >= 0 and rest[j][0] > lvl:
                j -= 1
            if j < 0:
                return
            pos = j
        else:
            j = k
            if j >= len(rest):
                return
            jj = j + 1
            while jj < len(rest) and rest[jj][0] > rest[j][0]:
                jj += 1
            pos = jj
        self.items = rest[:pos] + block + rest[pos:]
        self._save("移動書籤")

    def indent(self, d):
        k = self._cur()
        if k is None:
            return
        e = self._span(k)
        for j in range(k, e):
            self.items[j][0] = max(1, self.items[j][0] + d)
        self._save("調整書籤層級")

    def delete(self):
        k = self._cur()
        if k is None:
            return
        del self.items[k:self._span(k)]
        self._save("刪除書籤")

    def _menu(self, pos):
        m = QMenu(self)
        m.addAction("重新命名", self.rename)
        m.addAction("改成目前頁面", self._set_page)
        m.addAction("刪除", self.delete)
        m.exec(self.tree.viewport().mapToGlobal(pos))

    def _set_page(self):
        k = self._cur()
        if k is not None:
            self.items[k][2] = self.win.view.current_page() + 1
            self._save("修改書籤頁碼")


class Comments(QWidget):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.dirty = True
        v = QVBoxLayout(self)
        v.setContentsMargins(4, 4, 4, 4)
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setWordWrap(True)
        self.tree.itemClicked.connect(self._go)
        v.addWidget(self.tree, 1)
        row = QHBoxLayout()
        row.addWidget(_btn("回覆", self.reply))
        row.addWidget(_btn("狀態", self.state))
        row.addWidget(_btn("編輯", self.edit_text))
        row.addWidget(_btn("樣式", self.style))
        row.addWidget(_btn("刪除", self.delete))
        row.addStretch(1)
        v.addLayout(row)
        self.empty = QLabel("沒有註解。用「註解」工具加上便利貼、螢光筆、形狀或印章。", objectName="sub")
        self.empty.setWordWrap(True)
        v.addWidget(self.empty)

    def load(self, s):
        self.s = s
        self.tree.clear()
        lst = AN.listing(s.doc)
        by_x = {c["xref"]: c for c in lst}
        roots = {}
        for c in lst:
            if c["irt"] and c["irt"] in by_x:
                continue
            title = "第 %d 頁・%s・%s" % (c["page"] + 1, c["name"], c["author"] or "")
            it = QTreeWidgetItem(self.tree, [title + ("\n" + c["content"] if c["content"] else "")])
            it.setData(0, Qt.UserRole, (c["page"], c["xref"]))
            roots[c["xref"]] = it
        for c in lst:
            if c["irt"] in roots:
                st = AN.STATE_NAMES.get(c["state"], "") if c["state"] else ""
                it = QTreeWidgetItem(roots[c["irt"]], ["↳ %s：%s" % (c["author"] or "回覆", c["content"]) + ("（%s）" % st if st and st not in c["content"] else "")])
                it.setData(0, Qt.UserRole, (c["page"], c["xref"]))
        self.tree.expandAll()
        self.empty.setVisible(not lst)

    def _sel(self):
        it = self.tree.currentItem()
        return None if it is None else it.data(0, Qt.UserRole)

    def _go(self, it):
        page, xref = it.data(0, Qt.UserRole)
        pg, an = AN.find(self.s.doc, page, xref)
        if an is not None:
            self.win.view.go_to(page, an.rect)

    def focus(self, page, xref):
        root = self.tree.invisibleRootItem()
        for k in range(root.childCount()):
            it = root.child(k)
            if it.data(0, Qt.UserRole) == (page, xref):
                self.tree.setCurrentItem(it)
                self.tree.scrollToItem(it)
                return

    def _author(self):
        return self.win.prefs.get("author", "小柯")

    def reply(self):
        sel = self._sel()
        if not sel:
            return
        t, ok = QInputDialog.getMultiLineText(self, "回覆", "回覆內容")
        if ok and t.strip():
            self.win.edit("回覆註解", K_ANNOT, lambda d: AN.reply(d, sel[0], sel[1], t.strip(), self._author()))

    def state(self):
        sel = self._sel()
        if not sel:
            return
        names = [AN.STATE_NAMES[k] for k in AN.STATES[1:]]
        t, ok = QInputDialog.getItem(self, "審閱狀態", "狀態", names, 0, False)
        if ok:
            st = AN.STATES[1:][names.index(t)]
            self.win.edit("審閱狀態", K_ANNOT, lambda d: AN.set_state(d, sel[0], sel[1], st, self._author()))

    def edit_text(self):
        sel = self._sel()
        if not sel:
            return
        pg, an = AN.find(self.s.doc, *sel)
        old = an.info.get("content", "") if an else ""
        t, ok = QInputDialog.getMultiLineText(self, "編輯註解", "內容", old)
        if ok:
            self.win.edit("編輯註解", K_ANNOT, lambda d: AN.restyle(d, sel[0], sel[1], content=t))

    def style(self):
        sel = self._sel()
        if not sel:
            return
        m = QMenu(self)
        m.addAction("改顏色…", lambda: self._color(sel))
        op = m.addMenu("不透明度")
        for o in (1.0, 0.75, 0.5, 0.3):
            op.addAction("%d%%" % (o * 100), lambda o=o: self.win.edit("註解不透明度", K_ANNOT, lambda d: AN.restyle(d, sel[0], sel[1], opacity=o)))
        wd = m.addMenu("線寬")
        for w in (1, 2, 3, 5, 8):
            wd.addAction("%d" % w, lambda w=w: self.win.edit("註解線寬", K_ANNOT, lambda d: AN.restyle(d, sel[0], sel[1], width=w)))
        m.exec(self.cursor().pos())

    def _color(self, sel):
        q = QColorDialog.getColor(QColor("#E53935"), self, "註解顏色")
        if q.isValid():
            c = (q.redF(), q.greenF(), q.blueF())
            self.win.edit("註解顏色", K_ANNOT, lambda d: AN.restyle(d, sel[0], sel[1], color=c))

    def delete(self):
        sel = self._sel()
        if sel:
            self.win.edit("刪除註解", K_ANNOT, lambda d: AN.delete(d, sel[0], sel[1]))


class Fields(QWidget):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.dirty = True
        v = QVBoxLayout(self)
        v.setContentsMargins(4, 4, 4, 4)
        self.list = QListWidget()
        self.list.itemClicked.connect(self._go)
        self.list.itemDoubleClicked.connect(lambda it: self.win.tools.fill_field(*it.data(Qt.UserRole)))
        v.addWidget(self.list, 1)
        self.empty = QLabel("這份文件沒有表單欄位。可以用「工具 → 準備表單」自己建立。", objectName="sub")
        self.empty.setWordWrap(True)
        v.addWidget(self.empty)

    def load(self, s):
        self.s = s
        self.list.clear()
        fs = FM.fields(s.doc)
        for f in fs:
            val = f["value"]
            it = QListWidgetItem("第 %d 頁・%s・%s：%s" % (f["page"] + 1, f["kind"], f["name"] or "（未命名）", "" if val in (None, "Off", False) else val))
            it.setData(Qt.UserRole, (f["page"], f["xref"]))
            self.list.addItem(it)
        self.empty.setVisible(not fs)

    def _go(self, it):
        page, xref = it.data(Qt.UserRole)
        pg, w = FM.widget(self.s.doc, page, xref)
        if w is not None:
            self.win.view.go_to(page, w.rect)


class Layers(QWidget):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.dirty = True
        v = QVBoxLayout(self)
        v.setContentsMargins(4, 4, 4, 4)
        self.list = QListWidget()
        self.list.itemChanged.connect(self._toggle)
        v.addWidget(self.list, 1)
        self.empty = QLabel("這份文件沒有圖層（選用內容）。", objectName="sub")
        self.empty.setWordWrap(True)
        v.addWidget(self.empty)

    def load(self, s):
        self.s = s
        self.list.blockSignals(True)
        self.list.clear()
        for xref, name, on in PG.layers(s.doc):
            it = QListWidgetItem(name)
            it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
            it.setCheckState(Qt.Checked if on else Qt.Unchecked)
            it.setData(Qt.UserRole, xref)
            self.list.addItem(it)
        self.list.blockSignals(False)
        self.empty.setVisible(self.list.count() == 0)

    def _toggle(self, it):
        """只改變顯示（不會成為編輯步驟）。"""
        try:
            PG.set_layer(self.s.doc, it.data(Qt.UserRole), it.checkState() == Qt.Checked)
        except Exception:
            pass
        self.win.view._cache.clear()
        self.win.view.viewport().update()


class Attachments(QWidget):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.dirty = True
        v = QVBoxLayout(self)
        v.setContentsMargins(4, 4, 4, 4)
        self.list = QListWidget()
        self.list.itemDoubleClicked.connect(lambda it: self.open_(it))
        v.addWidget(self.list, 1)
        row = QHBoxLayout()
        row.addWidget(_btn("開啟", lambda: self.open_(self.list.currentItem())))
        row.addWidget(_btn("另存", self.save_))
        row.addWidget(_btn("＋ 加入", self.add))
        row.addWidget(_btn("刪除", self.delete))
        row.addStretch(1)
        v.addLayout(row)
        self.empty = QLabel("沒有附件。", objectName="sub")
        v.addWidget(self.empty)

    def load(self, s):
        self.s = s
        self.list.clear()
        for a in PG.attachments(s.doc):
            it = QListWidgetItem("📎 %s（%s）" % (a["name"], _size(a["size"])))
            it.setData(Qt.UserRole, a["name"])
            self.list.addItem(it)
        self.empty.setVisible(self.list.count() == 0)

    def _name(self, it=None):
        it = it or self.list.currentItem()
        return None if it is None else it.data(Qt.UserRole)

    def open_(self, it):
        name = self._name(it)
        if not name:
            return
        if QMessageBox.question(self, "開啟附件", "附件可能含有不安全的內容。確定要用預設程式開啟「%s」嗎？" % name) != QMessageBox.Yes:
            return
        import tempfile
        d = tempfile.mkdtemp(prefix="xiaoke_att_")
        p = os.path.join(d, os.path.basename(name))
        with open(p, "wb") as f:
            f.write(self.s.doc.embfile_get(name))
        os.startfile(p)

    def save_(self):
        name = self._name()
        if not name:
            return
        f, _ = QFileDialog.getSaveFileName(self, "另存附件", os.path.basename(name))
        if f:
            with open(f, "wb") as fp:
                fp.write(self.s.doc.embfile_get(name))

    def add(self):
        f, _ = QFileDialog.getOpenFileName(self, "加入附件")
        if f:
            data = open(f, "rb").read()
            self.win.edit("加入附件", K_EDIT, lambda d: d.embfile_add(os.path.basename(f), data, filename=os.path.basename(f)))

    def delete(self):
        name = self._name()
        if name:
            self.win.edit("刪除附件", K_EDIT, lambda d: d.embfile_del(name))


def _size(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return "%.0f %s" % (n, u)
        n /= 1024
    return "%.1f TB" % n
