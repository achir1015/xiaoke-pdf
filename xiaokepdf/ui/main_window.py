"""主視窗：分頁、工具列、模式（閱讀／編輯／註解／表單／填寫與簽署）、搜尋、側邊面板、狀態列、
自動保存與恢復、拖放開檔。"""
import json
import os
import subprocess
import sys

import pymupdf as fitz
from PySide6.QtCore import QSize, Qt, QTimer, QUrl
from PySide6.QtGui import QAction, QCursor, QDesktopServices, QIcon, QKeySequence, QShortcut
from PySide6.QtWidgets import (QApplication, QComboBox, QDockWidget, QFileDialog, QFrame, QHBoxLayout, QInputDialog, QLabel,
                               QLineEdit, QMainWindow, QMenu, QMessageBox, QPushButton, QStackedWidget, QStatusBar, QTabBar,
                               QToolBar, QToolButton, QVBoxLayout, QWidget)

from .. import APP_NAME, VERSION, data_dir, resource
from ..engine import annots as AN
from ..engine import text as T
from ..engine.session import K_ANNOT, K_COPY, K_EDIT, K_FORM, K_PAGES, NeedPassword, Session
from . import theme
from .viewer import PageView, T_ELLIPSE, T_INK, T_LINE, T_NONE, T_POINT, T_RECT


class Prefs:
    def __init__(self):
        self.path = data_dir("settings.json")
        try:
            with open(self.path, encoding="utf-8") as f:
                self.d = json.load(f)
        except Exception:
            self.d = {}

    def get(self, k, default=None):
        return self.d.get(k, default)

    def set(self, k, v):
        self.d[k] = v
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.d, f, ensure_ascii=False, indent=1)
        except Exception:
            pass


class Mode:
    """工具模式：處理頁面上的點、框、線、手繪。"""

    def __init__(self, name, hint, tool=T_NONE, tap=None, rect=None, line=None, ink=None, exit=None, buttons=None, selectable=False):
        self.name, self.hint, self.tool = name, hint, tool
        self.tap, self.rect, self.line, self.ink, self.exit = tap, rect, line, ink, exit
        self.buttons = buttons or []
        self.selectable = selectable


class MainWindow(QMainWindow):
    def __init__(self, files=()):
        super().__init__()
        self.prefs = Prefs()
        # 主題與介面字型要在建立任何元件之前套用，字級才會一致
        theme.apply(QApplication.instance(), self.prefs.get("dark", False))
        self.sessions = []
        self.closed = []            # 最近關閉的分頁（檔案路徑）
        self.cur = -1
        self.mode = None
        self.strip_kind = None
        self.setWindowTitle(APP_NAME)
        self.setWindowIcon(QIcon(resource("assets", "icon.ico")))
        self.resize(1280, 860)
        self.setAcceptDrops(True)
        from .inline_editor import Inline
        self.inline = Inline(self)
        self._tab_sync = True       # 介面還沒建好之前，忽略分頁切換事件
        self._build()
        self._tab_sync = False
        self._autosave = QTimer(self)
        self._autosave.timeout.connect(self._autosave_tick)
        self._autosave.start(60_000)
        QTimer.singleShot(0, lambda: self._startup(files))

    # ================================================================== 介面

    def _build(self):
        from .home import Home
        from .panels import SidePanels

        tb = QToolBar("工具列")
        tb.setMovable(False)
        tb.setIconSize(QSize(18, 18))
        self.addToolBar(Qt.TopToolBarArea, tb)
        self.toolbar = tb
        menu_btn = QToolButton()
        menu_btn.setText("☰")
        menu_btn.setToolTip("選單")
        menu_btn.setPopupMode(QToolButton.InstantPopup)
        self.menu = QMenu(self)
        menu_btn.setMenu(self.menu)
        tb.addWidget(menu_btn)
        self.act = {}

        def a(key, text, fn, shortcut=None, tip=None, checkable=False):
            ac = QAction(text, self)
            ac.triggered.connect(lambda *_: fn())
            if shortcut:
                ac.setShortcut(QKeySequence(shortcut))
                ac.setShortcutContext(Qt.WindowShortcut)
            if tip:
                ac.setToolTip(tip)
            ac.setCheckable(checkable)
            self.addAction(ac)
            self.act[key] = ac
            return ac

        tb.addAction(a("open", "開啟", self.open_dialog, "Ctrl+O", "開啟 PDF（Ctrl+O）"))
        tb.addAction(a("save", "儲存", self.save, "Ctrl+S", "儲存（Ctrl+S）"))
        tb.addSeparator()
        tb.addAction(a("undo", "↶", self.undo, "Ctrl+Z", "復原（Ctrl+Z）"))
        tb.addAction(a("redo", "↷", self.redo, "Ctrl+Y", "重做（Ctrl+Y）"))
        tb.addSeparator()
        for key, text, tip, fn in (("read", "閱讀", "閱讀、選取文字", self.read_mode), ("edit", "編輯", "編輯文字、新增文字、表格、圖片…", self.edit_mode),
                                   ("comment", "註解", "便利貼、螢光筆、形狀、手繪、印章", self.comment_mode), ("form", "表單", "填寫表單", self.form_mode),
                                   ("sign", "填寫與簽署", "簽名、日期、勾選、數位簽章", self.sign_mode), ("organize", "整理頁面", "旋轉、刪除、插入、移動頁面", self.organize)):
            ac = a("mode_" + key, text, fn, tip=tip, checkable=key not in ("organize",))
            tb.addAction(ac)
        tb.addSeparator()
        tb.addAction(a("search", "⌕ 搜尋", self.open_search, "Ctrl+F", "搜尋（Ctrl+F）"))
        tb.addAction(a("zoom_out", "－", lambda: self.view.set_zoom(self.view.zoom / 1.2), "Ctrl+-", "縮小"))
        self.zoom_label = QPushButton("100%")
        self.zoom_label.setFlat(True)
        self.zoom_label.setMinimumWidth(72)
        self.zoom_label.clicked.connect(self._zoom_menu)
        tb.addWidget(self.zoom_label)
        tb.addAction(a("zoom_in", "＋", lambda: self.view.set_zoom(self.view.zoom * 1.2), "Ctrl+=", "放大"))
        self.layout_box = QComboBox()
        self.layout_box.addItems(["連續捲動", "單頁", "雙頁"])
        self.layout_box.setToolTip("版面")
        self.layout_box.currentIndexChanged.connect(lambda k: self.view.set_layout(["continuous", "single", "two"][k]) if self.session() else None)
        tb.addWidget(self.layout_box)
        tb.addAction(a("rotate_view", "⟳", lambda: self.view.rotate_view(1), tip="旋轉檢視（不改檔案）"))
        spacer = QWidget()
        spacer.setSizePolicy(spacer.sizePolicy().horizontalPolicy().Expanding, spacer.sizePolicy().verticalPolicy().Preferred)
        tb.addWidget(spacer)
        tb.addAction(a("palette", "⌘ 所有工具", self.palette, "Ctrl+K", "搜尋所有工具和指令（Ctrl+K）"))
        tb.addAction(a("theme", "☾", self.toggle_theme, tip="切換淺色／深色"))
        # 其他快捷鍵
        a("save_as", "另存新檔…", self.save_as, "Ctrl+Shift+S")
        a("close_tab", "關閉分頁", lambda: self.close_tab(self.cur), "Ctrl+W")
        a("reopen", "重新開啟關閉的分頁", self.reopen_closed, "Ctrl+Shift+T")
        a("print", "列印…", self.print_doc, "Ctrl+P")
        a("full", "全螢幕", self.toggle_full, "F11")
        a("focus", "無干擾閱讀", self.toggle_focus, "F10")
        a("next_tab", "下一個分頁", lambda: self.select((self.cur + 1) % len(self.sessions)) if self.sessions else None, "Ctrl+Tab")
        a("copy", "複製", self.copy_selection, "Ctrl+C")
        a("paste", "貼上", self.paste, "Ctrl+V")
        a("select_all", "全選這一頁", lambda: self.view.select_all(self.view.current_page()) if self.session() else None, "Ctrl+A")
        a("fit", "符合寬度", lambda: self.view.fit_width(), "Ctrl+0")
        a("find_next", "下一個符合項目", lambda: self.search_step(1), "F3")
        a("find_prev", "上一個符合項目", lambda: self.search_step(-1), "Shift+F3")
        a("goto", "到第幾頁…", self.ask_page, "Ctrl+G")
        a("esc", "離開模式", self.escape, "Esc")
        self._build_menu()

        # 分頁列
        central = QWidget()
        v = QVBoxLayout(central)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(0)
        self.tabs = QTabBar()
        self.tabs.setExpanding(False)
        self.tabs.setTabsClosable(True)
        self.tabs.setMovable(True)
        self.tabs.setUsesScrollButtons(True)
        self.tabs.setDocumentMode(True)
        self.tabs.setContextMenuPolicy(Qt.CustomContextMenu)
        self.tabs.customContextMenuRequested.connect(self._tab_menu)
        self.tabs.tabCloseRequested.connect(lambda k: self.close_tab(k - 1) if k > 0 else None)
        self.tabs.currentChanged.connect(lambda k: self.select(k - 1) if not getattr(self, "_tab_sync", False) else None)
        self.tabs.tabMoved.connect(self._tab_moved)
        self.tabs.addTab("⌂ 首頁")
        self.tabs.setTabButton(0, QTabBar.RightSide, None)
        v.addWidget(self.tabs)
        # 工具列（各模式）、提示列、格式列、搜尋列
        self.strip = QFrame(objectName="strip")
        QHBoxLayout(self.strip).setContentsMargins(6, 2, 6, 2)
        self.strip.hide()
        v.addWidget(self.strip)
        self.hint = QFrame(objectName="hint")
        hl = QHBoxLayout(self.hint)
        hl.setContentsMargins(14, 4, 6, 4)
        self.hint_label = QLabel()
        self.hint_label.setWordWrap(True)
        hl.addWidget(self.hint_label, 1)
        self.hint_buttons = QHBoxLayout()
        hl.addLayout(self.hint_buttons)
        self.hint.hide()
        v.addWidget(self.hint)
        self.format_bar = QFrame(objectName="strip")
        QHBoxLayout(self.format_bar).setContentsMargins(6, 2, 6, 2)
        self.format_bar.hide()
        v.addWidget(self.format_bar)
        self.search_bar = QFrame(objectName="strip")
        sl = QHBoxLayout(self.search_bar)
        sl.setContentsMargins(8, 4, 8, 4)
        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText("搜尋文件（逗號分隔可同時找多個詞）")
        self.search_edit.setClearButtonEnabled(True)
        self.search_edit.textChanged.connect(lambda t: self._search_timer.start(250))
        self.search_edit.returnPressed.connect(lambda: self.search_step(1))
        self._search_timer = QTimer(self)
        self._search_timer.setSingleShot(True)
        self._search_timer.timeout.connect(lambda: self.run_search(self.search_edit.text()))
        sl.addWidget(self.search_edit, 1)
        self.search_count = QLabel("")
        sl.addWidget(self.search_count)
        for t, fn in (("▲", lambda: self.search_step(-1)), ("▼", lambda: self.search_step(1)), ("✕", self.close_search)):
            b = QToolButton()
            b.setText(t)
            b.clicked.connect(fn)
            sl.addWidget(b)
        self.search_bar.hide()
        v.addWidget(self.search_bar)
        # 首頁／閱讀畫面
        self.stack = QStackedWidget()
        self.home = Home(self)
        self.stack.addWidget(self.home)
        self.view = PageView()
        self.stack.addWidget(self.view)
        v.addWidget(self.stack, 1)
        self.setCentralWidget(central)
        self.view.pageChanged.connect(self._page_changed)
        self.view.zoomChanged.connect(lambda z: self.zoom_label.setText("%d%%" % round(z * 100)))
        self.view.tapped.connect(self._tap)
        self.view.rectDrawn.connect(lambda p, r: self.mode and self.mode.rect and self.mode.rect(p, r))
        self.view.lineDrawn.connect(lambda p, a, b: self.mode and self.mode.line and self.mode.line(p, a, b))
        self.view.inkChanged.connect(lambda: self.mode and self.mode.ink and self.mode.ink())
        self.view.selectionChanged.connect(self._selection_changed)
        self.view.contextMenu.connect(self._page_menu)
        self.view.doubleTapped.connect(self._double_tap)
        # 側邊面板
        self.panels = SidePanels(self)
        self.dock = QDockWidget("面板", self)
        self.dock.setObjectName("panels")
        self.dock.setWidget(self.panels)
        self.dock.setTitleBarWidget(QWidget())      # 面板本身有分頁標籤，不需要標題列
        self.dock.setFeatures(QDockWidget.DockWidgetMovable | QDockWidget.DockWidgetFloatable | QDockWidget.DockWidgetClosable)
        self.addDockWidget(Qt.LeftDockWidgetArea, self.dock)
        self.resizeDocks([self.dock], [260], Qt.Horizontal)
        self.dock.hide()
        # 狀態列
        sb = QStatusBar()
        self.setStatusBar(sb)
        self.page_label = QPushButton("")
        self.page_label.setFlat(True)
        self.page_label.clicked.connect(self.ask_page)
        sb.addPermanentWidget(self.page_label)
        self.toast_label = QLabel("")
        sb.addWidget(self.toast_label, 1)
        self._toast_timer = QTimer(self)
        self._toast_timer.setSingleShot(True)
        self._toast_timer.timeout.connect(lambda: self.toast_label.setText(""))
        self.refresh_bars()

    def _build_menu(self):
        m = self.menu
        m.clear()
        f = m.addMenu("檔案")
        f.addAction(self.act["open"])
        f.addAction("新增空白文件", self.new_blank)
        rec = f.addMenu("最近開啟")
        rec.aboutToShow.connect(lambda: self._recent_menu(rec))
        f.addAction(self.act["save"])
        f.addAction(self.act["save_as"])
        f.addAction(self.act["reopen"])
        f.addAction("在檔案總管中顯示", lambda: self.show_in_explorer(self.cur))
        f.addSeparator()
        f.addAction(self.act["print"])
        f.addAction("文件屬性…", lambda: self.tools.properties())
        f.addSeparator()
        f.addAction(self.act["close_tab"])
        f.addAction("結束", self.close)
        e = m.addMenu("編輯")
        e.addAction(self.act["undo"])
        e.addAction(self.act["redo"])
        e.addSeparator()
        e.addAction(self.act["copy"])
        e.addAction(self.act["paste"])
        e.addAction(self.act["select_all"])
        e.addAction(self.act["search"])
        vm = m.addMenu("檢視")
        vm.addAction("連續捲動", lambda: self.layout_box.setCurrentIndex(0))
        vm.addAction("單頁", lambda: self.layout_box.setCurrentIndex(1))
        vm.addAction("雙頁", lambda: self.layout_box.setCurrentIndex(2))
        vm.addAction(self.act["fit"])
        vm.addAction(self.act["rotate_view"])
        vm.addSeparator()
        vm.addAction(self.act["full"])
        vm.addAction(self.act["focus"])
        vm.addAction("夜間頁面（反白）", self.toggle_night)
        vm.addAction("護眼色", self.toggle_sepia)
        vm.addAction(self.act["theme"])
        vm.addAction("顯示／隱藏面板", lambda: self.dock.setVisible(not self.dock.isVisible()))
        t = m.addMenu("工具")
        from .tools import catalog
        for group, items in catalog(self):
            g = t.addMenu(group)
            for name, desc, fn in items:
                g.addAction(name, fn)
        h = m.addMenu("說明")
        h.addAction("檢查更新…", lambda: self.check_update(manual=True))
        h.addAction("設定…", lambda: self.tools.settings())
        h.addAction("關於 " + APP_NAME, self.about)

    @property
    def tools(self):
        if not hasattr(self, "_tools"):
            from .tools import Tools
            self._tools = Tools(self)
        return self._tools

    # ================================================================== 啟動、恢復

    def _startup(self, files):
        self.view.night = self.prefs.get("night", False)
        self.view.sepia = self.prefs.get("sepia", False)
        self.home.refresh()
        rec = Session.recoverable()
        if rec:
            names = "\n".join("・%s（%d 個編輯步驟）" % (m.get("name"), max(0, m.get("pos", 0))) for m, _ in rec)
            r = QMessageBox.question(self, "恢復未儲存的工作？", "%s 上次沒有正常結束，以下文件還有未儲存的變更：\n\n%s\n\n恢復後可以繼續編輯或復原。" % (APP_NAME, names),
                                     QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes)
            for meta, d in rec:
                if r == QMessageBox.Yes:
                    pw = None
                    while True:
                        try:
                            self.add_session(Session.restore(meta, d, pw))
                            break
                        except NeedPassword as e:
                            pw, ok = QInputDialog.getText(self, "需要密碼", ("密碼不正確，請再試一次" if e.wrong else "「%s」受密碼保護" % meta.get("name")),
                                                          QLineEdit.Password)
                            if not ok:
                                break
                        except Exception as e:
                            QMessageBox.warning(self, "無法恢復", "「%s」無法恢復：%s" % (meta.get("name"), e))
                            break
                else:
                    import shutil
                    shutil.rmtree(d, ignore_errors=True)
        for f in files:
            if os.path.isfile(f):
                self.open_path(f)
        if self.prefs.get("auto_update", True):
            QTimer.singleShot(4000, lambda: self.check_update(manual=False))

    def _autosave_tick(self):
        for s in self.sessions:
            try:
                s.write_meta()
            except Exception:
                pass

    # ================================================================== 分頁

    def session(self):
        return self.sessions[self.cur] if 0 <= self.cur < len(self.sessions) else None

    def add_session(self, s):
        self.sessions.append(s)
        self._tab_sync = True
        self.tabs.addTab(self._tab_title(s))
        self._tab_sync = False
        self.select(len(self.sessions) - 1)
        if s.repaired:
            self.toast("這份文件有損壞，已自動修復")
        if s.encrypted and not s.owner:
            self.toast("這份文件受作者限制。輸入擁有者密碼可以解除限制（工具 → 解除限制）", 6000)
        self.remember(s)

    def _tab_title(self, s):
        return ("● " if s.dirty else "") + s.name

    def refresh_tabs(self):
        self._tab_sync = True
        for k, s in enumerate(self.sessions):
            self.tabs.setTabText(k + 1, self._tab_title(s))
            self.tabs.setTabToolTip(k + 1, s.path or s.name)
        self.tabs.setCurrentIndex(self.cur + 1)
        self._tab_sync = False

    def _tab_moved(self, a, b):
        if a == 0 or b == 0:
            self._tab_sync = True
            self.tabs.moveTab(b, a)
            self._tab_sync = False
            return
        s = self.sessions.pop(a - 1)
        self.sessions.insert(b - 1, s)
        self.cur = self.tabs.currentIndex() - 1

    def select(self, k):
        if self.inline.active():
            self.inline.commit()
        self.exit_modes()
        self.cur = k if 0 <= k < len(self.sessions) else -1
        s = self.session()
        if s is None:
            self.stack.setCurrentIndex(0)
            self.home.refresh()
            self.view.set_session(None)
            self.dock.hide()
        else:
            self.stack.setCurrentIndex(1)
            self.view.set_session(s)
            self.layout_box.blockSignals(True)
            self.layout_box.setCurrentIndex(["continuous", "single", "two"].index(s.layout))
            self.layout_box.blockSignals(False)
            self.zoom_label.setText("%d%%" % round(self.view.zoom * 100))
            if self.prefs.get("panels", True) and not self.dock.isVisible():
                self.dock.show()
                self.resizeDocks([self.dock], [240], Qt.Horizontal)
            self.panels.set_session(s)
        self.refresh_tabs()
        self.refresh_bars()
        self._page_changed(self.view.current_page() if s else 0)
        self.setWindowTitle(("%s – %s" % (s.name, APP_NAME)) if s else APP_NAME)

    def close_tab(self, k, ask=True):
        if not (0 <= k < len(self.sessions)):
            return True
        s = self.sessions[k]
        if self.inline.active() and k == self.cur:
            self.inline.commit()
        if ask and s.dirty:
            self.select(k)
            r = QMessageBox.question(self, "儲存變更？", "「%s」有尚未儲存的變更，要儲存嗎？" % s.name,
                                     QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel, QMessageBox.Save)
            if r == QMessageBox.Cancel:
                return False
            if r == QMessageBox.Save and not self.save():
                return False
        if s.path:
            self.closed.append(s.path)
        s.discard()
        self.sessions.pop(k)
        self._tab_sync = True
        self.tabs.removeTab(k + 1)
        self._tab_sync = False
        self.select(min(k, len(self.sessions) - 1))
        return True

    def reopen_closed(self):
        while self.closed:
            p = self.closed.pop()
            if os.path.isfile(p):
                self.open_path(p)
                return
        self.toast("沒有可以重新開啟的分頁")

    def show_in_explorer(self, k):
        s = self.sessions[k] if 0 <= k < len(self.sessions) else None
        if not s or not s.path:
            self.toast("這份文件還沒有存成檔案")
            return
        subprocess.Popen(["explorer", "/select,", os.path.normpath(s.path)])

    def _tab_menu(self, pos):
        k = self.tabs.tabAt(pos) - 1
        m = QMenu(self)
        if k >= 0:
            m.addAction("關閉", lambda: self.close_tab(k))
            m.addAction("關閉其他分頁", lambda: self._close_others(k))
            m.addAction("在檔案總管中顯示", lambda: self.show_in_explorer(k))
        ra = m.addAction("重新開啟上次關閉的分頁", self.reopen_closed)
        ra.setEnabled(bool(self.closed))
        m.exec(self.tabs.mapToGlobal(pos))

    def _close_others(self, k):
        keep = self.sessions[k]
        for s in list(self.sessions):
            if s is not keep:
                if not self.close_tab(self.sessions.index(s)):
                    return

    # ================================================================== 開啟／儲存

    def open_dialog(self):
        files, _ = QFileDialog.getOpenFileNames(self, "開啟 PDF", self.prefs.get("last_dir", ""), "PDF 檔案 (*.pdf);;所有檔案 (*.*)")
        for f in files:
            self.prefs.set("last_dir", os.path.dirname(f))
            self.open_path(f)

    def open_path(self, path, password=None):
        path = os.path.abspath(path)
        for k, s in enumerate(self.sessions):
            if s.path and os.path.normcase(s.path) == os.path.normcase(path):
                self.select(k)
                return
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            s = Session.open(path, password=password)
        except NeedPassword as e:
            QApplication.restoreOverrideCursor()
            pw, ok = QInputDialog.getText(self, "需要密碼", "密碼不正確，請再試一次" if e.wrong else "「%s」受密碼保護，請輸入開啟密碼或擁有者密碼" % os.path.basename(path), QLineEdit.Password)
            if ok:
                self.open_path(path, pw)
            return
        except Exception as e:
            QApplication.restoreOverrideCursor()
            QMessageBox.warning(self, "無法開啟", "無法開啟「%s」：\n%s" % (os.path.basename(path), e))
            return
        QApplication.restoreOverrideCursor()
        self.add_session(s)

    def open_bytes(self, data, name):
        try:
            s = Session.open(data=data, name=name)
        except Exception as e:
            QMessageBox.warning(self, "無法開啟", str(e))
            return
        self.add_session(s)

    def new_blank(self):
        self.add_session(Session.new_blank())

    def remember(self, s):
        if not s.path:
            return
        rec = [r for r in self.prefs.get("recent", []) if os.path.normcase(r["path"]) != os.path.normcase(s.path)]
        rec.insert(0, {"path": s.path, "name": s.name, "pages": s.doc.page_count})
        self.prefs.set("recent", rec[:20])

    def _recent_menu(self, menu):
        menu.clear()
        for r in self.prefs.get("recent", []):
            menu.addAction(r["name"], lambda p=r["path"]: self.open_path(p))
        if menu.isEmpty():
            menu.addAction("（沒有）").setEnabled(False)

    def save(self):
        s = self.session()
        if not s:
            return False
        if self.inline.active():
            self.inline.commit()
        if not s.path:
            return self.save_as()
        try:
            QApplication.setOverrideCursor(Qt.WaitCursor)
            s.save()
        except PermissionError:
            QApplication.restoreOverrideCursor()
            QMessageBox.warning(self, "無法儲存", "檔案被其他程式開啟中或沒有寫入權限，請改用「另存新檔」。")
            return False
        except Exception as e:
            QApplication.restoreOverrideCursor()
            QMessageBox.warning(self, "無法儲存", str(e))
            return False
        QApplication.restoreOverrideCursor()
        self.toast("已儲存（儲存後仍然可以復原）")
        self.remember(s)
        self.refresh_tabs()
        self.refresh_bars()
        return True

    def save_as(self):
        s = self.session()
        if not s:
            return False
        if self.inline.active():
            self.inline.commit()
        start = s.path or os.path.join(self.prefs.get("last_dir", os.path.expanduser("~/Documents")), s.name)
        f, _ = QFileDialog.getSaveFileName(self, "另存新檔", start, "PDF 檔案 (*.pdf)")
        if not f:
            return False
        if not f.lower().endswith(".pdf"):
            f += ".pdf"
        try:
            s.save(f)
        except Exception as e:
            QMessageBox.warning(self, "無法儲存", str(e))
            return False
        self.prefs.set("last_dir", os.path.dirname(f))
        self.toast("已儲存到 " + f)
        self.remember(s)
        self.refresh_tabs()
        self.setWindowTitle("%s – %s" % (s.name, APP_NAME))
        return True

    def save_bytes_dialog(self, data, name, title="儲存"):
        f, _ = QFileDialog.getSaveFileName(self, title, os.path.join(self.prefs.get("last_dir", os.path.expanduser("~/Documents")), name), "PDF 檔案 (*.pdf)")
        if not f:
            return None
        if not f.lower().endswith(".pdf"):
            f += ".pdf"
        with open(f, "wb") as fp:
            fp.write(data)
        self.prefs.set("last_dir", os.path.dirname(f))
        return f

    # ================================================================== 編輯

    def blocked(self, msg):
        s = self.session()
        box = QMessageBox(QMessageBox.Information, "無法編輯", msg, QMessageBox.Ok, self)
        if s and s.encrypted and not s.owner:
            b = box.addButton("輸入擁有者密碼", QMessageBox.ActionRole)
            box.exec()
            if box.clickedButton() is b:
                self.tools.unlock()
            return
        box.exec()

    def edit(self, label, kind, fn, after=None):
        """套用一個編輯（一個復原步驟），完成後更新畫面。"""
        s = self.session()
        if not s:
            self.toast("請先開啟文件")
            return False
        b = s.block(kind)
        if b:
            self.blocked(b)
            return False
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            s.apply(label, fn)
        except Exception as e:
            QApplication.restoreOverrideCursor()
            QMessageBox.warning(self, label + "失敗", str(e) or e.__class__.__name__)
            return False
        QApplication.restoreOverrideCursor()
        self.changed()
        if after:
            after()
        return True

    def apply_bytes(self, label, data):
        s = self.session()
        s.apply_bytes(label, data)
        self.changed()

    def changed(self):
        s = self.session()
        self.view.reset()
        self.panels.refresh()
        self.refresh_tabs()
        self.refresh_bars()
        if self.search_bar.isVisible() and self.search_edit.text():
            self.run_search(self.search_edit.text(), keep=True)

    def undo(self):
        if self.inline.active():
            self.inline.cancel()
            return
        s = self.session()
        if s and s.can_undo():
            lbl = s.undo_label()
            s.undo()
            self.changed()
            self.toast("已復原：" + lbl)

    def redo(self):
        s = self.session()
        if s and s.can_redo():
            lbl = s.redo_label()
            s.redo()
            self.changed()
            self.toast("已重做：" + lbl)

    def refresh_bars(self):
        s = self.session()
        has = s is not None
        for k in ("save", "save_as", "search", "zoom_in", "zoom_out", "rotate_view", "print", "mode_read", "mode_edit", "mode_comment", "mode_form", "mode_sign", "mode_organize"):
            self.act[k].setEnabled(has)
        self.zoom_label.setEnabled(has)
        self.layout_box.setEnabled(has)
        self.act["undo"].setEnabled(bool(has and s.can_undo()))
        self.act["redo"].setEnabled(bool(has and s.can_redo()))
        self.act["undo"].setToolTip("復原：" + s.undo_label() if has and s.can_undo() else "復原（Ctrl+Z）")
        self.act["redo"].setToolTip("重做：" + s.redo_label() if has and s.can_redo() else "重做（Ctrl+Y）")
        for k in ("read", "edit", "comment", "form", "sign"):
            self.act["mode_" + k].setChecked(self.strip_kind == k or (k == "read" and has and self.strip_kind is None))

    # ================================================================== 狀態列

    def toast(self, msg, ms=3500):
        self.toast_label.setText(msg)
        self._toast_timer.start(ms)

    def _page_changed(self, i):
        s = self.session()
        if not s:
            self.page_label.setText("")
            return
        lbl = ""
        try:
            lbl = s.doc[i].get_label()
        except Exception:
            pass
        txt = "第 %d / %d 頁" % (i + 1, s.doc.page_count)
        if lbl and lbl != str(i + 1):
            txt += "（%s）" % lbl
        self.page_label.setText(txt)
        self.panels.page_changed(i)

    def ask_page(self):
        s = self.session()
        if not s:
            return
        t, ok = QInputDialog.getText(self, "到第幾頁", "頁碼（1–%d）或頁面標籤" % s.doc.page_count)
        if not ok or not t.strip():
            return
        t = t.strip()
        if t.isdigit():
            self.view.go_to(int(t) - 1)
            return
        for i in range(s.doc.page_count):
            try:
                if s.doc[i].get_label() == t:
                    self.view.go_to(i)
                    return
            except Exception:
                break
        self.toast("找不到這一頁")

    def _zoom_menu(self):
        m = QMenu(self)
        for z in (0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0):
            m.addAction("%d%%" % (z * 100), lambda z=z: self.view.set_zoom(z))
        m.addSeparator()
        m.addAction("符合寬度", self.view.fit_width)
        m.exec(QCursor.pos())

    # ================================================================== 模式

    def set_hint(self, text, buttons=None, done=None):
        self.hint_label.setText(text)
        while self.hint_buttons.count():
            w = self.hint_buttons.takeAt(0).widget()
            if w:
                w.hide()
                w.deleteLater()
        for t, fn in (buttons or []):
            b = QPushButton(t)
            b.clicked.connect(lambda *_, fn=fn: fn())
            self.hint_buttons.addWidget(b)
        # 有工具列（它自己有「完成」）或正在就地編輯時，提示列不再放「完成」
        if done is None:
            done = self.mode is not None and not self.strip.isVisible() and not self.inline.active()
        if done:
            done = QPushButton("完成")
            done.setProperty("primary", True)
            done.clicked.connect(self.exit_modes)
            self.hint_buttons.addWidget(done)
        self.hint.show()

    def restore_hint(self):
        if self.mode:
            self.set_hint(self.mode.hint, self.mode.buttons)
        else:
            self.hint.hide()

    def set_mode(self, mode):
        """進入一個工具模式（保留目前的工具列）。"""
        if self.inline.active():
            self.inline.commit()
        if self.mode and self.mode.exit:
            self.mode.exit()
        self.mode = mode
        self.view.tool = mode.tool
        self.view.selectable = mode.selectable
        self.view.clear_selection()
        self.set_hint(mode.hint, mode.buttons)

    def set_tool_mode(self, name, hint, tap):
        self.set_mode(Mode(name, hint, T_POINT, tap=tap))

    def exit_modes(self):
        if self.inline.active():
            self.inline.commit()
        had = self.mode is not None or self.strip.isVisible()
        if self.mode and self.mode.exit:
            m = self.mode
            self.mode = None
            m.exit()
        self.mode = None
        self.view.tool = T_NONE
        self.view.selectable = True
        self.view.ink = []
        self.view.measure_text = None
        self.view.field_rects = {}
        self.hint.hide()
        self.strip.hide()
        self.strip_kind = None
        self.view.viewport().update()
        self.refresh_bars()
        return had

    def escape(self):
        if self.inline.active():
            self.inline.cancel()
            return
        if self.search_bar.isVisible():
            self.close_search()
            return
        if self.isFullScreen():
            self.toggle_full()
            return
        self.exit_modes()

    def _tap(self, page, x, y):
        if self.mode and self.mode.tap:
            self.mode.tap(page, x, y)
            return
        # 閱讀模式：點到註解時顯示內容
        s = self.session()
        an = AN.at(s.doc[page], x, y)
        if an is not None:
            self.panels.show_comment(page, an.xref)

    def _double_tap(self, page, x, y):
        if self.strip_kind in (None, "read"):
            self.edit_mode()
            self.inline.edit_at(page, x, y)

    def show_strip(self, kind, items, selected=0):
        """模式的工具列：[(名稱, 函式)]"""
        if self.inline.active():
            self.inline.commit()
        lay = self.strip.layout()
        while lay.count():
            it = lay.takeAt(0)
            if it.widget():
                it.widget().hide()
                it.widget().deleteLater()
        self.strip_kind = kind
        self._strip_buttons = []
        for k, (name, fn) in enumerate(items):
            if name == "|":
                sep = QFrame()
                sep.setFrameShape(QFrame.VLine)
                lay.addWidget(sep)
                continue
            if isinstance(name, QWidget):
                lay.addWidget(name)
                continue
            b = QToolButton()
            b.setText(name)
            b.setCheckable(True)
            b.setChecked(k == selected)
            b.clicked.connect(lambda *_, k=k, fn=fn: (self._mark_strip(k), fn()))
            lay.addWidget(b)
            self._strip_buttons.append((k, b))
        lay.addStretch(1)
        done = QPushButton("完成")
        done.clicked.connect(self.exit_modes)
        lay.addWidget(done)
        self.strip.show()
        self.refresh_bars()

    def _mark_strip(self, k):
        for kk, b in self._strip_buttons:
            b.setChecked(kk == k)

    def read_mode(self):
        self.exit_modes()

    def edit_mode(self, sel=0):
        s = self.session()
        if not s:
            return
        b = s.block(K_EDIT)
        if b:
            self.blocked(b)
            self.refresh_bars()
            return
        t = self.tools
        items = [
            ("編輯文字", lambda: self.set_mode(Mode("edittext", "點一下文字就能直接修改（像 Word 一樣，整段一起改）；點空白處可新增文字", T_POINT, tap=self.inline.edit_at))),
            ("新增文字", lambda: self.set_mode(Mode("addtext", "點一下要加文字的位置，直接打字", T_POINT, tap=lambda p, x, y: self.inline.add_at(p, x, y)))),
            ("插入表格", t.insert_table), ("新增圖片", t.add_image), ("插入 QR Code", t.add_qr), ("新增連結", t.add_link), ("貼上", self.paste),
            ("|", None), ("浮水印", t.watermark), ("移除浮水印", t.remove_watermark), ("頁首頁尾頁碼", t.header_footer),
            ("裁切", t.crop), ("頁面標籤", t.labels), ("整理頁面", self.organize),
        ]
        self.show_strip("edit", items, sel)
        items[sel][1]()

    def comment_mode(self, sel=2):
        s = self.session()
        if not s:
            return
        b = s.block(K_ANNOT)
        if b:
            self.blocked(b)
            self.refresh_bars()
            return
        self.tools.comment_strip(sel)

    def form_mode(self):
        if not self.session():
            return
        self.tools.form_strip()

    def sign_mode(self):
        if not self.session():
            return
        self.tools.sign_strip()

    def organize(self):
        s = self.session()
        if not s:
            return
        b = s.block(K_PAGES)
        if b:
            self.blocked(b)
            return
        from .organizer import Organizer
        Organizer(self).exec()
        self.refresh_bars()

    # ================================================================== 選取、複製、貼上

    def _selection_changed(self):
        if self.view.sel:
            t = self.view.selected_text()
            self.toast("已選取 %d 個字（Ctrl+C 複製、右鍵有更多動作）" % len(t), 5000)

    def copy_selection(self):
        if self.inline.active():
            self.inline.cur.ed.copy()
            return
        s = self.session()
        if not s or not self.view.sel:
            return
        b = s.block(K_COPY)
        if b:
            QMessageBox.information(self, "無法複製", b)
            return
        QApplication.clipboard().setText(self.view.selected_text())
        self.toast("已複製")

    def paste(self):
        if self.inline.active():
            self.inline.cur.ed.paste()
            return
        if not self.session():
            return
        self.tools.paste()

    def _page_menu(self, page, x, y, gpos):
        m = QMenu(self)
        if self.view.sel:
            sel_rects = self.view.selected_rects()
            m.addAction("複製", self.copy_selection)
            m.addAction("改文字（就地編輯）", lambda: (self.edit_mode(), self.inline.edit_selection(self.view.sel[0], sel_rects[0])) if sel_rects else None)
            m.addSeparator()
            for name, kind, col in (("螢光", "highlight", (1, 0.83, 0)), ("底線", "underline", (0.12, 0.39, 0.91)), ("刪除線", "strike", (0.9, 0.22, 0.21)), ("波浪線", "squiggly", (0.9, 0.22, 0.21))):
                m.addAction(name, lambda kind=kind, col=col: self.tools.markup_selection(kind, col))
            m.addAction("加註解…", lambda: self.tools.markup_selection("highlight", (1, 0.83, 0), ask=True))
            m.addAction("塗銷（永久移除）", self.tools.redact_selection)
            m.addAction("搜尋這段文字", lambda t=self.view.selected_text(): (self.open_search(), self.search_edit.setText(t)))
            m.addSeparator()
        an = AN.at(self.session().doc[page], x, y)
        if an is not None:
            m.addAction("查看註解", lambda: self.panels.show_comment(page, an.xref))
            m.addAction("刪除註解", lambda: self.edit("刪除註解", K_ANNOT, lambda d: AN.delete(d, page, an.xref)))
            m.addSeparator()
        m.addAction("在這裡改文字", lambda: (self.edit_mode(), self.inline.edit_at(page, x, y)))
        m.addAction("在這裡新增文字", lambda: (self.edit_mode(1), self.inline.add_at(page, x, y)))
        m.addAction("在這裡加便利貼", lambda: self.tools.note_at(page, x, y))
        m.addSeparator()
        m.addAction("全選這一頁", lambda: self.view.select_all(page))
        m.addAction("旋轉這一頁", lambda: self.edit("旋轉頁面", K_PAGES, lambda d: d[page].set_rotation((d[page].rotation + 90) % 360)))
        m.exec(gpos)

    # ================================================================== 搜尋

    def open_search(self):
        if not self.session():
            return
        self.search_bar.show()
        self.search_edit.setFocus()
        self.search_edit.selectAll()
        if self.view.sel and not self.search_edit.text():
            self.search_edit.setText(self.view.selected_text()[:80])

    def close_search(self):
        self.search_bar.hide()
        self.view.hits = {}
        self.view.hit_cur = None
        self._hits = []
        self.view.viewport().update()

    def run_search(self, q, keep=False):
        s = self.session()
        self._hits = T.search(s.doc, q) if (s and q.strip()) else []
        hits = {}
        for pg, quad in self._hits:
            hits.setdefault(pg, []).append(quad)
        self.view.hits = hits
        self._hit_pos = -1
        if self._hits and not keep:
            # 從目前這一頁開始找
            cur = self.view.current_page()
            for k, (pg, quad) in enumerate(self._hits):
                if pg >= cur:
                    self._hit_pos = k - 1
                    break
            self.search_step(1)
        else:
            self.view.hit_cur = None
        self.search_count.setText("沒有符合項目" if q.strip() and not self._hits else ("%d 個符合" % len(self._hits) if self._hits else ""))
        self.view.viewport().update()

    def search_step(self, d):
        hits = getattr(self, "_hits", [])
        if not hits:
            return
        self._hit_pos = (self._hit_pos + d) % len(hits)
        pg, quad = hits[self._hit_pos]
        self.view.hit_cur = (pg, quad)
        self.view.go_to(pg, quad.rect)
        self.search_count.setText("符合 %d / %d" % (self._hit_pos + 1, len(hits)))

    # ================================================================== 其他

    def follow_link(self, l):
        kind = l.get("kind")
        if kind in (fitz.LINK_GOTO, fitz.LINK_NAMED) and l.get("page", -1) >= 0:
            to = l.get("to")
            self.view.go_to(l["page"], fitz.Rect(to.x, to.y, to.x + 1, to.y + 1) if to is not None and l.get("page") is not None else None)
        elif kind == fitz.LINK_URI and l.get("uri"):
            uri = l["uri"]
            if QMessageBox.question(self, "開啟連結", "要用瀏覽器開啟這個連結嗎？\n\n%s" % uri) == QMessageBox.Yes:
                QDesktopServices.openUrl(QUrl(uri))
        elif kind == fitz.LINK_LAUNCH:
            self.toast("基於安全考量，不會執行文件裡的外部程式連結")

    def toggle_theme(self):
        dark = not self.prefs.get("dark", False)
        self.prefs.set("dark", dark)
        theme.apply(QApplication.instance(), dark)
        self.home.refresh()
        self.view.viewport().update()

    def toggle_night(self):
        self.view.night = not self.view.night
        self.prefs.set("night", self.view.night)
        self.view._cache.clear()
        self.view.viewport().update()

    def toggle_sepia(self):
        self.view.sepia = not self.view.sepia
        self.prefs.set("sepia", self.view.sepia)
        self.view.viewport().update()

    def toggle_full(self):
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()

    def toggle_focus(self):
        """無干擾閱讀：隱藏工具列、分頁、面板、狀態列。"""
        on = self.toolbar.isVisible()
        for w in (self.toolbar, self.tabs, self.statusBar()):
            w.setVisible(not on)
        if on:
            self._dock_was = self.dock.isVisible()
            self.dock.hide()
            self.toast("無干擾閱讀：按 F10 回到一般畫面")
        elif getattr(self, "_dock_was", False):
            self.dock.show()

    def palette(self):
        from .palette import Palette
        Palette(self).exec()

    def palette_with(self, text):
        from .palette import Palette
        Palette(self, text).exec()

    def print_doc(self):
        self.tools.print_doc()

    def check_update(self, manual=False):
        from .updater import check
        check(self, manual)

    def about(self):
        QMessageBox.about(self, "關於 " + APP_NAME,
                          "<b>%s</b> Windows 版 %s<br><br>在電腦上閱讀、編輯、註解、填寫、簽署與整理 PDF。<br>"
                          "隱私至上：文件絕對不會離開你的電腦，不需要帳號、不收集使用資料。<br><br>"
                          "使用的開放原始碼：PyMuPDF（AGPL）、Qt for Python（LGPL）、pyHanko（MIT）、Pillow、qrcode；"
                          "中文字型 jf open 粉圓（SIL OFL 1.1）。<br>原始碼：https://github.com/achir1015/xiaoke-pdf" % (APP_NAME, VERSION))

    # ================================================================== 拖放、關閉

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e):
        for u in e.mimeData().urls():
            p = u.toLocalFile()
            if p.lower().endswith(".pdf"):
                self.open_path(p)
            elif p.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff", ".webp")) and self.session():
                self.tools.add_image(path=p)

    def closeEvent(self, e):
        if self.inline.active():
            self.inline.commit()
        for s in list(self.sessions):
            if s.dirty:
                self.select(self.sessions.index(s))
                r = QMessageBox.question(self, "儲存變更？", "「%s」有尚未儲存的變更，要儲存嗎？" % s.name,
                                         QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel, QMessageBox.Save)
                if r == QMessageBox.Cancel:
                    e.ignore()
                    return
                if r == QMessageBox.Save and not self.save():
                    e.ignore()
                    return
        for s in self.sessions:
            s.discard()
        self.sessions = []
        e.accept()
