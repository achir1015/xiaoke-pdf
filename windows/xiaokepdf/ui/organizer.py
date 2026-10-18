"""整理頁面：把頁面像卡片一樣放在桌上。多選（Ctrl、Shift）後旋轉、刪除、插入空白頁、從其他檔案插入、
往前往後移、拖曳排序、反轉、擷取。每個動作都是一個復原步驟。"""
import os

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QColor, QIcon, QPixmap
from PySide6.QtWidgets import (QAbstractItemView, QDialog, QFileDialog, QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
                               QMessageBox, QPushButton, QToolButton, QVBoxLayout)

from ..engine import pages as PG
from ..engine.session import K_PAGES
from .panels import thumb


class Grid(QListWidget):
    def __init__(self, org):
        super().__init__()
        self.org = org
        self.setViewMode(QListWidget.IconMode)
        self.setIconSize(QSize(150, 200))
        self.setResizeMode(QListWidget.Adjust)
        self.setSpacing(12)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setDragDropMode(QAbstractItemView.InternalMove)
        self.setMovement(QListWidget.Snap)

    def dropEvent(self, e):
        sel = sorted(self.row(it) for it in self.selectedItems())
        target = self.row(self.itemAt(e.position().toPoint())) if self.itemAt(e.position().toPoint()) else self.count()
        e.ignore()
        if sel and target not in sel:
            self.org.move_to(sel, target)


class Organizer(QDialog):
    def __init__(self, win):
        super().__init__(win)
        self.win = win
        self.setWindowTitle("整理頁面")
        self.resize(1080, 760)
        v = QVBoxLayout(self)
        bar = QHBoxLayout()
        for text, fn, tip in (("⟲ 向左轉", lambda: self.rotate(-90), "旋轉選取的頁面"), ("⟳ 向右轉", lambda: self.rotate(90), None),
                              ("🗑 刪除", self.delete, None), ("＋ 空白頁", self.blank, "在選取頁面的後面插入空白頁"),
                              ("📄 從檔案插入", self.insert_file, None), ("◀ 往前", lambda: self.move(-1), None), ("往後 ▶", lambda: self.move(1), None),
                              ("⇅ 反轉", self.reverse, "反轉選取的頁面（沒選＝全部）"), ("⤴ 擷取", self.extract, "選取的頁面另存新檔")):
            b = QToolButton()
            b.setText(text)
            if tip:
                b.setToolTip(tip)
            b.clicked.connect(lambda *_, fn=fn: fn())
            bar.addWidget(b)
        bar.addStretch(1)
        self.undo_btn = QToolButton()
        self.undo_btn.setText("↶ 復原")
        self.undo_btn.clicked.connect(self.undo)
        bar.addWidget(self.undo_btn)
        v.addLayout(bar)
        self.info = QLabel("點一下選取，Ctrl／Shift＋點選多頁；可以直接拖曳排序。雙擊頁面跳到那一頁。", objectName="sub")
        v.addWidget(self.info)
        self.grid = Grid(self)
        self.grid.itemDoubleClicked.connect(lambda it: (self.win.view.go_to(self.grid.row(it)), self.accept()))
        v.addWidget(self.grid, 1)
        row = QHBoxLayout()
        row.addStretch(1)
        done = QPushButton("完成")
        done.setProperty("primary", True)
        done.clicked.connect(self.accept)
        row.addWidget(done)
        v.addLayout(row)
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._next)
        self.load()

    @property
    def s(self):
        return self.win.session()

    def load(self, select=None):
        self.grid.clear()
        doc = self.s.doc
        labels = PG.page_labels(doc)
        for i in range(doc.page_count):
            lbl = labels[i] if labels[i] and labels[i] != str(i + 1) else ""
            it = QListWidgetItem("%d%s" % (i + 1, "（%s）" % lbl if lbl else ""))
            r = doc[i].rect
            pm = QPixmap(150, int(150 * r.height / max(r.width, 1)))
            pm.fill(QColor("#FFFFFF"))
            it.setIcon(QIcon(pm))
            self.grid.addItem(it)
        for k in (select or []):
            if 0 <= k < self.grid.count():
                self.grid.item(k).setSelected(True)
        self._pending = list(range(doc.page_count))
        self._timer.start(0)
        self.undo_btn.setEnabled(self.s.can_undo())

    def _next(self):
        if not self._pending:
            self._timer.stop()
            return
        i = self._pending.pop(0)
        try:
            self.grid.item(i).setIcon(QIcon(QPixmap.fromImage(thumb(self.s.doc, i))))
        except Exception:
            pass

    def sel(self):
        return sorted(self.grid.row(it) for it in self.grid.selectedItems())

    def _need(self):
        s = self.sel()
        if not s:
            self.win.toast("請先選取頁面")
        return s

    def _do(self, label, fn, select=None):
        res = {}
        if self.win.edit(label, K_PAGES, lambda d: res.update(r=fn(d))):
            r = res.get("r")
            self.load(r if isinstance(r, list) else select)

    def rotate(self, deg):
        s = self._need()
        if s:
            self._do("旋轉頁面", lambda d: PG.rotate(d, s, deg), s)

    def delete(self):
        s = self._need()
        if not s:
            return
        if len(s) >= self.s.doc.page_count:
            QMessageBox.information(self, "刪除頁面", "不能刪除所有頁面")
            return
        self._do("刪除頁面", lambda d: PG.delete(d, s))

    def blank(self):
        s = self.sel()
        at = (s[-1] + 1) if s else self.s.doc.page_count
        self._do("插入空白頁", lambda d: PG.insert_blank(d, at), [at])

    def insert_file(self):
        f, _ = QFileDialog.getOpenFileName(self, "選擇要插入的 PDF", self.win.prefs.get("last_dir", ""), "PDF 檔案 (*.pdf)")
        if not f:
            return
        s = self.sel()
        at = (s[-1] + 1) if s else self.s.doc.page_count
        data = open(f, "rb").read()
        n = {}

        def op(d):
            n["c"] = PG.insert_file(d, data, at)
            return list(range(at, at + n["c"]))
        self._do("從檔案插入頁面", op)

    def move(self, delta):
        s = self._need()
        if s:
            self._do("移動頁面", lambda d: PG.move(d, s, delta))

    def move_to(self, sel, target):
        self._do("移動頁面", lambda d: PG.move_to(d, sel, target))

    def reverse(self):
        s = self.sel()
        self._do("反轉頁面", lambda d: PG.reverse(d, s if len(s) > 1 else None), s)

    def extract(self):
        s = self._need()
        if s:
            self.win.tools.extract(s)

    def undo(self):
        self.win.undo()
        self.load()
