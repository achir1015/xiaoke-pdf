"""指令面板（Ctrl+K）：搜尋所有工具和指令。"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QLineEdit, QListWidget, QListWidgetItem, QVBoxLayout

from .tools import catalog


class Palette(QDialog):
    def __init__(self, win, text=""):
        super().__init__(win)
        self.win = win
        self.setWindowTitle("所有工具和指令")
        self.resize(560, 520)
        v = QVBoxLayout(self)
        self.edit = QLineEdit(text)
        self.edit.setPlaceholderText("輸入工具或指令名稱，例如：浮水印、合併、簽名、旋轉…")
        self.edit.textChanged.connect(self.filter)
        v.addWidget(self.edit)
        self.list = QListWidget()
        self.list.itemActivated.connect(self.run)
        v.addWidget(self.list, 1)
        self.items = []
        for group, items in catalog(win):
            for name, desc, fn in items:
                self.items.append(("%s　—　%s" % (name, desc), group, fn))
        for key, ac in win.act.items():
            if ac.text() and key not in ("esc",):
                sc = ac.shortcut().toString()
                self.items.append(("%s%s" % (ac.text(), "　（%s）" % sc if sc else ""), "指令", ac.trigger))
        self.edit.returnPressed.connect(lambda: self.run(self.list.currentItem()))
        self.filter(text)

    def filter(self, q):
        q = q.strip().lower()
        self.list.clear()
        for text, group, fn in self.items:
            if not q or all(part in (text + group).lower() for part in q.split()):
                it = QListWidgetItem("%s　〔%s〕" % (text, group))
                it.setData(Qt.UserRole, fn)
                self.list.addItem(it)
        if self.list.count():
            self.list.setCurrentRow(0)

    def keyPressEvent(self, e):
        if e.key() in (Qt.Key_Down, Qt.Key_Up):
            r = self.list.currentRow() + (1 if e.key() == Qt.Key_Down else -1)
            self.list.setCurrentRow(max(0, min(self.list.count() - 1, r)))
            return
        super().keyPressEvent(e)

    def run(self, it):
        if it is None:
            return
        fn = it.data(Qt.UserRole)
        self.accept()
        fn()
