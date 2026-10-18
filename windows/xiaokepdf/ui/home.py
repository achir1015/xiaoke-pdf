"""首頁：開啟檔案、最近開啟、推薦工具、所有工具目錄。"""
import os

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QPushButton,
                               QScrollArea, QVBoxLayout, QWidget)

from .. import APP_NAME, resource
from . import theme


class Card(QFrame):
    def __init__(self, title, desc, fn, icon=""):
        super().__init__(objectName="card")
        self.fn = fn
        self.setCursor(Qt.PointingHandCursor)
        v = QVBoxLayout(self)
        v.setContentsMargins(14, 12, 14, 12)
        t = QLabel(("%s  %s" % (icon, title)).strip())
        f = t.font()
        f.setPointSize(theme.pt(11))
        f.setBold(True)
        t.setFont(f)
        d = QLabel(desc, objectName="sub")
        d.setWordWrap(True)
        v.addWidget(t)
        v.addWidget(d)
        self.setMinimumHeight(theme.px(78))

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.fn()


class Home(QScrollArea):
    def __init__(self, win):
        super().__init__()
        self.win = win
        self.setWidgetResizable(True)
        self.setFrameShape(QFrame.NoFrame)
        self.body = QWidget()
        self.setWidget(self.body)
        self.v = QVBoxLayout(self.body)
        self.v.setContentsMargins(36, 26, 36, 26)
        self.v.setSpacing(14)

    def refresh(self):
        while self.v.count():
            it = self.v.takeAt(0)
            if it.widget():
                it.widget().hide()
                it.widget().deleteLater()
            elif it.layout():
                _clear(it.layout())
        win = self.win
        head = QHBoxLayout()
        logo = QLabel()
        logo.setPixmap(QPixmap(resource("assets", "icon.png")).scaled(theme.px(72), theme.px(72), Qt.KeepAspectRatio, Qt.SmoothTransformation))
        head.addWidget(logo)
        tv = QVBoxLayout()
        title = QLabel("歡迎使用" + APP_NAME, objectName="title")
        sub = QLabel("在電腦上閱讀、註解、填寫、簽署與整理 PDF — 全部在本機完成，檔案不會上傳。", objectName="sub")
        tv.addWidget(title)
        tv.addWidget(sub)
        head.addLayout(tv, 1)
        self.v.addLayout(head)

        search = QLineEdit()
        search.setPlaceholderText("⌕  尋找工具與指令（Ctrl+K）")
        search.setMinimumHeight(theme.px(38))
        search.textChanged.connect(lambda t: (win.palette_with(t), search.clear()) if t else None)
        self.v.addWidget(search)

        row = QHBoxLayout()
        open_btn = QPushButton("📂  開啟檔案")
        open_btn.setProperty("primary", True)
        open_btn.setMinimumHeight(theme.px(48))
        open_btn.clicked.connect(win.open_dialog)
        row.addWidget(open_btn, 2)
        for t, fn in (("建立空白文件", win.new_blank), ("圖片轉 PDF", lambda: win.tools.images_to_pdf()), ("合併 PDF", lambda: win.tools.combine())):
            b = QPushButton(t)
            b.setMinimumHeight(theme.px(48))
            b.clicked.connect(fn)
            row.addWidget(b, 1)
        self.v.addLayout(row)
        hint = QLabel("也可以把 PDF 拖進這個視窗，或在檔案總管按右鍵「開啟方式」選小柯文件PDF助手。", objectName="sub")
        self.v.addWidget(hint)

        rec = win.prefs.get("recent", [])
        if rec:
            self.v.addWidget(_section("最近開啟"))
            lst = QListWidget()
            lst.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
            lst.setMaximumHeight(min(theme.px(260), theme.px(34) * len(rec) + 8))
            for r in rec[:12]:
                folder = os.path.dirname(r["path"])
                if len(folder) > 60:
                    folder = folder[:20] + "…" + folder[-36:]
                it = QListWidgetItem("📄  %s　　%s" % (r["name"], folder))
                it.setToolTip(r["path"])
                it.setData(Qt.UserRole, r["path"])
                if not os.path.isfile(r["path"]):
                    it.setForeground(Qt.gray)
                lst.addItem(it)
            lst.itemActivated.connect(lambda it: win.open_path(it.data(Qt.UserRole)) if os.path.isfile(it.data(Qt.UserRole)) else win.toast("找不到這個檔案"))
            lst.itemClicked.connect(lambda it: win.open_path(it.data(Qt.UserRole)) if os.path.isfile(it.data(Qt.UserRole)) else win.toast("找不到這個檔案"))
            self.v.addWidget(lst)

        from .tools import catalog
        for group, items in catalog(win):
            self.v.addWidget(_section(group))
            grid = QGridLayout()
            grid.setSpacing(10)
            for k, (name, desc, fn) in enumerate(items):
                grid.addWidget(Card(name, desc, fn), k // 4, k % 4)
            w = QWidget()
            w.setLayout(grid)
            self.v.addWidget(w)
        self.v.addStretch(1)


def _section(t):
    l = QLabel(t)
    f = l.font()
    f.setPointSize(theme.pt(12))
    f.setBold(True)
    l.setFont(f)
    l.setContentsMargins(0, 10, 0, 0)
    return l


def _clear(lay):
    while lay.count():
        it = lay.takeAt(0)
        if it.widget():
            it.widget().deleteLater()
        elif it.layout():
            _clear(it.layout())
