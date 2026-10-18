"""淺色／深色主題（長時間閱讀護眼），以及共用的樣式表。"""
from PySide6.QtGui import QColor, QFont, QPalette

LIGHT = {"bg": "#F3F4F6", "surface": "#FFFFFF", "card": "#FFFFFF", "text": "#1D1F23", "sub": "#6B7078", "line": "#E1E3E8",
         "accent": "#1E63E9", "accent_soft": "#E3ECFD", "page_bg": "#E9EAEE", "danger": "#D93025", "hover": "#EEF1F6"}
DARK = {"bg": "#1B1C1F", "surface": "#232428", "card": "#2B2D31", "text": "#E8E9EC", "sub": "#9CA0A8", "line": "#3A3C42",
        "accent": "#6EA2FF", "accent_soft": "#263552", "page_bg": "#111214", "danger": "#FF6B6B", "hover": "#30323A"}

C = dict(LIGHT)
SCALE = 1.8          # 介面字級倍率（設定裡可以調整；預設比一般大 80%，比較好閱讀）
SCALES = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2]


def pt(n):
    """依介面字級倍率換算的字級（點）"""
    return max(1, round(n * SCALE))


def px(n):
    """依介面字級倍率換算的大小（像素）"""
    return int(round(n * SCALE))


def apply(app, dark, scale=None):
    global SCALE
    if scale:
        SCALE = scale
    C.clear()
    C.update(DARK if dark else LIGHT)
    pal = QPalette()
    pal.setColor(QPalette.Window, QColor(C["bg"]))
    pal.setColor(QPalette.WindowText, QColor(C["text"]))
    pal.setColor(QPalette.Base, QColor(C["surface"]))
    pal.setColor(QPalette.AlternateBase, QColor(C["hover"]))
    pal.setColor(QPalette.Text, QColor(C["text"]))
    pal.setColor(QPalette.Button, QColor(C["surface"]))
    pal.setColor(QPalette.ButtonText, QColor(C["text"]))
    pal.setColor(QPalette.Highlight, QColor(C["accent"]))
    pal.setColor(QPalette.HighlightedText, QColor("#FFFFFF"))
    pal.setColor(QPalette.ToolTipBase, QColor(C["card"]))
    pal.setColor(QPalette.ToolTipText, QColor(C["text"]))
    pal.setColor(QPalette.PlaceholderText, QColor(C["sub"]))
    app.setPalette(pal)
    # 介面字型用 setFont（不寫在樣式表裡，就地編輯框才能用自己的字型與大小）
    f = QFont("Microsoft JhengHei UI", pt(10))
    f.setFamilies(["Microsoft JhengHei UI", "Microsoft JhengHei", "Segoe UI", "Segoe UI Symbol", "Segoe UI Emoji"])
    app.setFont(f)
    # Windows 會替某些元件類別另外指定字型（清單、選單、面板標題…），統一成同一個字級
    for cls in ("QAbstractItemView", "QListView", "QTreeView", "QListWidget", "QTreeWidget", "QDockWidget", "QTabBar", "QMenu", "QMenuBar",
                "QToolButton", "QToolBar", "QPushButton", "QLabel", "QLineEdit", "QComboBox", "QStatusBar", "QHeaderView", "QMessageBox", "QCheckBox"):
        app.setFont(f, cls)
    app.setStyleSheet(qss())


def qss():
    return """
    QWidget { color: %(text)s; }
    QMainWindow, QDialog { background: %(bg)s; }
    QToolBar { background: %(surface)s; border: none; border-bottom: 1px solid %(line)s; spacing: 2px; padding: 3px 6px; }
    QToolBar QToolButton { padding: 6px 9px; border-radius: 6px; }
    QToolButton { border: none; background: transparent; padding: 5px 8px; border-radius: 6px; }
    QToolButton:hover { background: %(hover)s; }
    QToolButton:checked { background: %(accent_soft)s; color: %(accent)s; }
    QToolButton:disabled { color: %(sub)s; }
    QPushButton { background: %(surface)s; border: 1px solid %(line)s; border-radius: 6px; padding: 6px 14px; }
    QPushButton:hover { background: %(hover)s; }
    QPushButton[primary="true"] { background: %(accent)s; color: white; border: none; }
    QPushButton[primary="true"]:hover { background: %(accent)s; }
    QPushButton:disabled { color: %(sub)s; }
    QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QComboBox { background: %(surface)s; border: 1px solid %(line)s; border-radius: 6px; padding: 4px 6px; }
    QLineEdit:focus, QTextEdit:focus, QSpinBox:focus, QComboBox:focus { border: 1px solid %(accent)s; }
    QTabBar::tab { background: transparent; padding: 7px 12px; border: none; border-bottom: 2px solid transparent; margin-right: 2px; }
    QTabBar::tab:selected { border-bottom: 2px solid %(accent)s; color: %(accent)s; }
    QTabBar::tab:hover { background: %(hover)s; }
    QTabWidget::pane { border: none; }
    QDockWidget { titlebar-close-icon: none; }
    QDockWidget::title { background: %(surface)s; padding: 6px; border-bottom: 1px solid %(line)s; }
    QListWidget, QTreeWidget, QTableWidget { background: %(surface)s; border: none; }
    QListWidget::item:selected, QTreeWidget::item:selected { background: %(accent_soft)s; color: %(text)s; }
    QStatusBar { background: %(surface)s; border-top: 1px solid %(line)s; }
    QMenu { background: %(card)s; border: 1px solid %(line)s; padding: 4px; }
    QMenu::item { padding: 6px 22px 6px 14px; border-radius: 4px; }
    QMenu::item:selected { background: %(accent_soft)s; }
    QMenuBar { background: %(surface)s; }
    QMenuBar::item:selected { background: %(hover)s; }
    QScrollBar:vertical { width: 12px; background: transparent; }
    QScrollBar:horizontal { height: 12px; background: transparent; }
    QScrollBar::handle { background: %(line)s; border-radius: 5px; min-height: 24px; min-width: 24px; }
    QScrollBar::add-line, QScrollBar::sub-line { width: 0; height: 0; }
    QFrame#strip { background: %(surface)s; border-bottom: 1px solid %(line)s; }
    QFrame#hint { background: %(accent_soft)s; }
    QFrame#card { background: %(card)s; border: 1px solid %(line)s; border-radius: 10px; }
    QLabel#sub { color: %(sub)s; }
    QLabel#title { font-size: %(title)dpt; font-weight: bold; }
    """ % dict(C, title=pt(16))
