"""所有工具：註解、表單、填寫與簽署、浮水印、頁首頁尾、裁切、頁面標籤、合併分割、建立 PDF、匯出、
密碼保護、塗銷、移除隱藏資訊、壓縮、比較、測量、無障礙、引導式動作、列印、OCR、數位簽章、設定。"""
import datetime
import math
import os
import tempfile

import pymupdf as fitz
from PySide6.QtCore import QPointF, QRectF, QSize, Qt
from PySide6.QtGui import QColor, QIcon, QImage, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import (QApplication, QCheckBox, QColorDialog, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox,
                               QFileDialog, QFormLayout, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QMessageBox, QPlainTextEdit, QPushButton, QRadioButton, QSlider, QSpinBox,
                               QTabWidget, QTextBrowser, QToolButton, QVBoxLayout, QWidget)

from .. import data_dir
from ..engine import annots as AN
from ..engine import export as EX
from ..engine import forms as FM
from ..engine import misc as MI
from ..engine import pages as PG
from ..engine import security as SEC
from ..engine import signing as SG
from ..engine import text as T
from ..engine import watermark as WM
from ..engine.session import K_ANNOT, K_EDIT, K_FORM, K_PAGES, K_PRINT, Session
from . import theme
from .viewer import T_ELLIPSE, T_INK, T_LINE, T_NONE, T_POINT, T_RECT

IMG_FILTER = "圖片 (*.png *.jpg *.jpeg *.bmp *.gif *.tif *.tiff *.webp)"


def catalog(win):
    t = win.tools
    return [
        ("推薦工具", [
            ("整理頁面", "頁面格狀・旋轉・刪除・插入・移動", win.organize),
            ("編輯 PDF", "像 Word 一樣就地改字・新增文字・表格", lambda: _need(win) and win.edit_mode()),
            ("新增註解", "便利貼・螢光標示・底線・形狀・印章", lambda: _need(win) and win.comment_mode()),
            ("填寫與簽署", "手寫簽名・日期・勾選・數位簽章", lambda: _need(win) and win.sign_mode()),
        ]),
        ("編輯", [
            ("插入表格", "選列數欄數，下面的內容自動往下移", lambda: _need(win) and (win.edit_mode(2))),
            ("新增圖片", "PNG・JPG・拖曳改大小", lambda: _need(win) and t.add_image()),
            ("插入 QR Code", "網址或文字資料", lambda: _need(win) and t.add_qr()),
            ("加入浮水印", "文字或圖片・透明度・角度・滿版", lambda: _need(win) and t.watermark()),
            ("移除浮水印", "標準浮水印・依文字・依圖層", lambda: _need(win) and t.remove_watermark()),
            ("頁首頁尾頁碼", "第 n 頁／共 N 頁・日期・檔名", lambda: _need(win) and t.header_footer()),
            ("裁切頁面", "拖曳出要保留的範圍", lambda: _need(win) and t.crop()),
            ("頁面標籤", "i、ii、1、2…", lambda: _need(win) and t.labels()),
        ]),
        ("頁面與檔案", [
            ("合併 PDF", "多個檔案合併成一份，每個檔案一個書籤", t.combine),
            ("擷取頁面", "選取的頁面另存新檔", lambda: _need(win) and t.extract()),
            ("分割 PDF", "每 N 頁一份，或在指定頁之前分割", lambda: _need(win) and t.split()),
            ("圖片轉 PDF", "多張圖片合成一份 PDF", t.images_to_pdf),
            ("文字轉 PDF", "貼上文字產生 PDF", t.text_to_pdf),
            ("建立空白文件", "A4、Letter…", win.new_blank),
            ("匯出圖片", "每頁存成 PNG 或 JPG", lambda: _need(win) and t.export_images()),
            ("匯出 Word", "存成 .docx", lambda: _need(win) and t.export_docx()),
            ("匯出純文字", "存成 .txt", lambda: _need(win) and t.export_text()),
            ("列印", "選擇印表機與頁面", lambda: _need(win) and t.print_doc()),
        ]),
        ("註解、表單與簽署", [
            ("準備表單", "建立文字欄位・核取方塊・下拉選單", lambda: _need(win) and t.prepare_form()),
            ("填寫表單", "點欄位直接填寫・清除・平面化", lambda: _need(win) and win.form_mode()),
            ("數位簽章", "用 .p12／.pfx 憑證簽署", lambda: _need(win) and t.digital_sign()),
            ("驗證簽章", "檢查文件裡的數位簽章", lambda: _need(win) and t.verify()),
            ("管理憑證", "建立自簽憑證・匯入憑證", t.certs),
            ("匯出註解", "所有註解存成文字檔", lambda: _need(win) and t.export_comments()),
        ]),
        ("安全與隱私", [
            ("密碼保護", "AES-256 加密・權限設定", lambda: _need(win) and t.protect()),
            ("移除保護", "去掉開啟密碼與權限限制", lambda: _need(win) and t.remove_protection()),
            ("解除限制", "輸入擁有者密碼", lambda: _need(win) and t.unlock()),
            ("塗銷", "框選後永久移除內容", lambda: _need(win) and t.redact_mode()),
            ("移除隱藏資訊", "作者・中繼資料・JavaScript・附件", lambda: _need(win) and t.sanitize()),
            ("文件屬性", "標題・作者・字型・安全性", lambda: _need(win) and t.properties()),
        ]),
        ("其他工具", [
            ("壓縮 PDF", "縮小圖片，檔案變小", lambda: _need(win) and t.compress()),
            ("轉灰階", "整份文件轉成黑白", lambda: _need(win) and t.grayscale()),
            ("比較文件", "找出兩份文件的文字差異", lambda: _need(win) and t.compare()),
            ("測量", "距離與面積（可設比例尺）", lambda: _need(win) and t.measure()),
            ("無障礙檢查", "檢查並修正標題、語言…", lambda: _need(win) and t.accessibility()),
            ("引導式動作", "發佈前清理・寄送前準備・封存", lambda: _need(win) and t.guided()),
            ("OCR 文字辨識", "掃描檔變成可搜尋的文字", lambda: _need(win) and t.ocr()),
            ("設定", "作者名稱・主題・更新", t.settings),
        ]),
    ]


def _need(win):
    if win.session() is None:
        win.toast("請先開啟文件")
        win.open_dialog()
        return False
    return True


class Form(QDialog):
    """簡單的表單對話框。"""

    def __init__(self, parent, title, note=None, ok="確定"):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setMinimumWidth(theme.px(440))
        self.v = QVBoxLayout(self)
        self.form = QFormLayout()
        self.form.setLabelAlignment(Qt.AlignRight)
        self.v.addLayout(self.form)
        self.note = note
        self.ok_text = ok

    def add(self, label, w):
        self.form.addRow(label, w)
        return w

    def line(self, label, value="", placeholder="", password=False):
        e = QLineEdit(str(value))
        e.setPlaceholderText(placeholder)
        if password:
            e.setEchoMode(QLineEdit.Password)
        return self.add(label, e)

    def num(self, label, value, lo, hi, step=1, dec=0):
        if dec:
            w = QDoubleSpinBox()
            w.setDecimals(dec)
        else:
            w = QSpinBox()
        w.setRange(lo, hi)
        w.setSingleStep(step)
        w.setValue(value)
        return self.add(label, w)

    def combo(self, label, items, index=0):
        c = QComboBox()
        c.addItems(items)
        c.setCurrentIndex(index)
        return self.add(label, c)

    def check(self, text, on=False):
        c = QCheckBox(text)
        c.setChecked(on)
        self.form.addRow("", c)
        return c

    def run(self):
        if self.note:
            l = QLabel(self.note, objectName="sub")
            l.setWordWrap(True)
            self.v.addWidget(l)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText(self.ok_text)
        bb.button(QDialogButtonBox.Cancel).setText("取消")
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        self.v.addWidget(bb)
        return self.exec() == QDialog.Accepted


def color_button(initial):
    b = QPushButton()
    b.setFixedWidth(theme.px(60))
    b._color = QColor(initial)

    def paint():
        b.setStyleSheet("QPushButton { background: %s; border: 1px solid #999; }" % b._color.name())
    paint()

    def pick():
        q = QColorDialog.getColor(b._color, b, "選擇顏色")
        if q.isValid():
            b._color = q
            paint()
    b.clicked.connect(pick)
    b.rgb = lambda: (b._color.redF(), b._color.greenF(), b._color.blueF())
    return b


class SignPad(QDialog):
    """手寫簽名板。"""

    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("手寫簽名")
        self.strokes = []
        self.cur = None
        v = QVBoxLayout(self)
        self.pad = QWidget()
        self.pad.setMinimumSize(theme.px(560), theme.px(220))
        self.pad.setStyleSheet("background: white; border: 1px solid #ccc;")
        self.pad.paintEvent = self._paint
        self.pad.mousePressEvent = lambda e: self._start(e.position())
        self.pad.mouseMoveEvent = lambda e: self._move(e.position())
        self.pad.mouseReleaseEvent = lambda e: self._end()
        v.addWidget(QLabel("用滑鼠或觸控筆在下面簽名："))
        v.addWidget(self.pad, 1)
        row = QHBoxLayout()
        self.color = color_button("#1D1F23")
        row.addWidget(QLabel("顏色"))
        row.addWidget(self.color)
        clear = QPushButton("清除")
        clear.clicked.connect(self._clear)
        row.addWidget(clear)
        self.save = QCheckBox("儲存起來，下次可以直接使用")
        self.save.setChecked(True)
        row.addWidget(self.save)
        row.addStretch(1)
        v.addLayout(row)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("使用這個簽名")
        bb.button(QDialogButtonBox.Cancel).setText("取消")
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        v.addWidget(bb)

    def _start(self, p):
        self.cur = [(p.x(), p.y())]
        self.strokes.append(self.cur)
        self.pad.update()

    def _move(self, p):
        if self.cur is not None:
            self.cur.append((p.x(), p.y()))
            self.pad.update()

    def _end(self):
        self.cur = None

    def _clear(self):
        self.strokes = []
        self.pad.update()

    def _paint(self, e):
        p = QPainter(self.pad)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.pad.rect(), QColor("white"))
        p.setPen(QPen(QColor("#DDDDDD"), 1, Qt.DashLine))
        y = self.pad.height() * 0.72
        p.drawLine(20, int(y), self.pad.width() - 20, int(y))
        pen = QPen(self.color._color, 3)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        p.setPen(pen)
        for st in self.strokes:
            path = QPainterPath(QPointF(*st[0]))
            for q in st[1:]:
                path.lineTo(QPointF(*q))
            if len(st) == 1:
                path.lineTo(QPointF(st[0][0] + 0.5, st[0][1]))
            p.drawPath(path)
        p.end()


class Tools:
    def __init__(self, win):
        self.win = win

    @property
    def s(self):
        return self.win.session()

    @property
    def view(self):
        return self.win.view

    def author(self):
        return self.win.prefs.get("author", "小柯")

    def edit(self, label, kind, fn, after=None):
        return self.win.edit(label, kind, fn, after)

    def place(self, hint, ratio, done, default_w=160):
        """拖曳出位置與大小（或點一下用預設大小）。ratio：寬高比（0＝自由）。"""
        def rect(p, r):
            if ratio and r.height > 0:
                r = fitz.Rect(r.x0, r.y0, r.x0 + max(r.width, r.height * ratio), r.y0 + max(r.width, r.height * ratio) / ratio)
            done(p, r)

        def tap(p, x, y):
            w = default_w
            h = w / ratio if ratio else w * 0.5
            done(p, fitz.Rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2))
        from .main_window import Mode
        self.win.set_mode(Mode("place", hint, T_RECT, tap=tap, rect=rect))

    # ================================================================== 編輯

    def insert_table(self):
        f = Form(self.win, "插入表格", "接著點一下頁面上要放表格的位置（表格左上角）。下面的內容會自動往下移；點在既有的表格裡會放到它的下面。", "下一步")
        rows = f.num("列數", self.win.prefs.get("tbl_rows", 3), 1, 50)
        cols = f.num("欄數", self.win.prefs.get("tbl_cols", 3), 1, 20)
        if not f.run():
            return
        r, c = rows.value(), cols.value()
        self.win.prefs.set("tbl_rows", r)
        self.win.prefs.set("tbl_cols", c)
        from .main_window import Mode
        self.win.set_mode(Mode("table", "點一下要放 %d × %d 表格的位置（左上角）" % (r, c), T_POINT,
                               tap=lambda p, x, y: self.win.inline.insert_table_at(p, x, y, r, c)))

    def add_image(self, path=None):
        if path is None:
            path, _ = QFileDialog.getOpenFileName(self.win, "選擇圖片", "", IMG_FILTER)
            if not path:
                return
        try:
            pix = fitz.Pixmap(path)
            if pix.alpha:
                data = pix.tobytes("png")
            else:
                data = open(path, "rb").read()
            ratio = pix.width / max(pix.height, 1)
        except Exception as e:
            QMessageBox.warning(self.win, "無法讀取圖片", str(e))
            return
        self.place("拖曳出圖片的位置與大小（或點一下）", ratio,
                   lambda p, r: self.edit("新增圖片", K_EDIT, lambda d: MI.add_image(d[p], r, data)), 200)

    def add_qr(self):
        f = Form(self.win, "插入 QR Code", None, "下一步")
        kind = f.combo("內容", ["網址", "文字資料"])
        text = f.line("網址或文字", "https://")
        if not f.run() or not text.text().strip():
            return
        data = text.text().strip()
        url = kind.currentIndex() == 0
        if url and not data.lower().startswith(("http://", "https://", "mailto:", "tel:")):
            data = "https://" + data
        self.place("點一下放 QR Code（或拖曳出位置與大小）", 1,
                   lambda p, r: self.edit("插入 QR Code", K_EDIT, lambda d: MI.add_qr(d[p], r, data, url)), 100)

    def add_link(self):
        def done(p, r):
            f = Form(self.win, "新增連結")
            kind = f.combo("連結到", ["網址", "文件中的頁面"])
            url = f.line("網址", "https://")
            page = f.num("頁碼", 1, 1, self.s.doc.page_count)
            if not f.run():
                return
            if kind.currentIndex() == 0:
                self.edit("新增連結", K_EDIT, lambda d: MI.add_link(d[p], r, uri=url.text().strip()))
            else:
                self.edit("新增連結", K_EDIT, lambda d: MI.add_link(d[p], r, dest_page=page.value() - 1))
        from .main_window import Mode
        self.win.set_mode(Mode("link", "框選要變成連結的區域", T_RECT, rect=done))

    def paste(self):
        """貼上剪貼簿：圖片、網址（變成連結文字）或文字，點一下要放的位置。"""
        cb = QApplication.clipboard()
        md = cb.mimeData()
        if md.hasImage():
            img = cb.image()
            buf = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            buf.close()
            img.save(buf.name, "PNG")
            data = open(buf.name, "rb").read()
            os.remove(buf.name)
            ratio = img.width() / max(img.height(), 1)
            self.place("點一下要貼上圖片的位置（或拖曳出大小）", ratio,
                       lambda p, r: self.edit("貼上圖片", K_EDIT, lambda d: MI.add_image(d[p], r, data)), 220)
            return
        text = md.text().strip() if md.hasText() else ""
        if not text:
            self.win.toast("剪貼簿裡沒有可以貼上的文字或圖片")
            return
        from ..engine import textops as TO
        from .main_window import Mode

        def tap(p, x, y):
            st = TO.Style(size=self.win.prefs.get("add_style", {}).get("size", 12))
            is_url = text.lower().startswith(("http://", "https://")) and " " not in text and "\n" not in text
            if is_url:
                st.color = (0.12, 0.39, 0.91)
                st.underline = True

            def op(d):
                box = TO.add_text(d[p], x, y + st.size * 0.35, d[p].rect.width - x - 24, text, st)
                if is_url and box:
                    MI.add_link(d[p], box, uri=text)
            self.edit("貼上連結" if is_url else "貼上文字", K_EDIT, op)
        self.win.set_mode(Mode("paste", "點一下要貼上%s的位置" % ("連結" if text.lower().startswith("http") else "文字"), T_POINT, tap=tap))

    def watermark(self):
        f = Form(self.win, "加入浮水印", "浮水印會標記成「浮水印」，之後可以用「移除浮水印」完整移除。")
        kind = f.combo("類型", ["文字", "圖片"])
        text = f.line("文字", "機密")
        size = f.num("字級", 60, 6, 300)
        color = f.add("顏色", color_button("#9E9E9E"))
        op = f.num("不透明度（%）", 20, 5, 100)
        angle = f.num("角度", 45, -90, 90)
        pos = f.combo("位置", ["置中", "滿版重複", "頁首", "頁尾"])
        under = f.check("墊在內容下面（不遮住文字）")
        pages = f.line("頁面", "", "留白＝全部，例如 1-3,5、奇數")
        if not f.run():
            return
        sel = PG.parse_pages(pages.text(), self.s.doc.page_count)
        p = ["center", "tile", "top", "bottom"][pos.currentIndex()]
        if kind.currentIndex() == 1:
            path, _ = QFileDialog.getOpenFileName(self.win, "選擇浮水印圖片", "", IMG_FILTER)
            if not path:
                return
            png = fitz.Pixmap(path).tobytes("png")
            self.edit("加入浮水印", K_EDIT, lambda d: WM.add_image_watermark(d, sel, png, 0.5, op.value() / 100, p, not under.isChecked()))
        else:
            t = text.text().strip() or "機密"
            self.edit("加入浮水印", K_EDIT, lambda d: WM.add_text_watermark(d, sel, t, size.value(), color.rgb(), op.value() / 100, angle.value(), p, not under.isChecked()))

    def remove_watermark(self):
        cands = WM.candidates(self.s.doc)
        layers = WM.layer_names(self.s.doc)
        f = Form(self.win, "移除浮水印", "標準浮水印：Acrobat、Word 匯出或本程式加入的浮水印。依文字：刪除含有這段文字的文字區塊。依圖層：整個圖層移除。")
        std = f.check("移除標準浮水印", True)
        text = QComboBox()
        text.setEditable(True)
        text.addItem("")
        for t, why, _ in cands:
            text.addItem(t, why)
        f.add("依文字移除", text)
        layer_checks = []
        for name in layers:
            layer_checks.append((name, f.check("移除圖層：" + name)))
        if not f.run():
            return
        t = text.currentText().strip()
        ls = [n for n, c in layer_checks if c.isChecked()]
        result = {}

        def op(d):
            result.update(WM.remove(d, std.isChecked(), t or None, ls))
            if result["blocks"] + result["annots"] == 0:
                raise ValueError("沒有找到符合條件的浮水印")
        if self.edit("移除浮水印", K_EDIT, op):
            self.win.toast("已移除 %d 處浮水印（%d 頁）。不滿意可以按「復原」。" % (result["blocks"] + result["annots"], result["pages"]), 6000)

    def header_footer(self):
        f = Form(self.win, "頁首頁尾與頁碼", "可以用 {n} 頁碼、{N} 總頁數、{label} 頁面標籤、{date} 日期、{file} 檔名。")
        fmt = f.line("內容", "第 {n} 頁／共 {N} 頁")
        pos = f.combo("位置", ["左上", "中上", "右上", "左下", "中下", "右下"], 4)
        size = f.num("字級", 10, 6, 48)
        color = f.add("顏色", color_button("#333333"))
        pages = f.line("頁面", "", "留白＝全部")
        if not f.run():
            return
        sel = PG.parse_pages(pages.text(), self.s.doc.page_count)
        labels = PG.page_labels(self.s.doc)
        name = self.s.name
        self.edit("頁首頁尾頁碼", K_EDIT, lambda d: WM.header_footer(d, sel, fmt.text(), pos.currentIndex(), size.value(), color.rgb(), labels, name))

    def crop(self):
        def rect(p, r):
            if QMessageBox.question(self.win, "裁切", "要把所有頁面都裁成這個範圍嗎？\n（選「否」只裁切這一頁）", QMessageBox.Yes | QMessageBox.No) == QMessageBox.Yes:
                sel = list(range(self.s.doc.page_count))
            else:
                sel = [p]
            self.edit("裁切頁面", K_EDIT, lambda d: PG.crop(d, sel, r), self.win.exit_modes)
        from .main_window import Mode
        self.win.set_mode(Mode("crop", "拖曳出要保留的範圍", T_RECT, rect=rect,
                               buttons=[("恢復原本大小", lambda: self.edit("恢復頁面大小", K_EDIT, lambda d: PG.crop(d, range(d.page_count), None)))]))

    def labels(self):
        f = Form(self.win, "頁面標籤", "例如：封面與目錄用 i、ii、iii，內文從 1 開始。")
        start = f.num("從第幾頁開始", self.view.current_page() + 1, 1, self.s.doc.page_count)
        style = f.combo("樣式", ["1、2、3", "i、ii、iii", "I、II、III", "a、b、c", "A、B、C", "只有前綴"])
        prefix = f.line("前綴", "", "例如：附錄-")
        first = f.num("第一頁的編號", 1, 1, 9999)
        if not f.run():
            return
        st = ["D", "r", "R", "a", "A", ""][style.currentIndex()]
        self.edit("頁面標籤", K_EDIT, lambda d: PG.set_labels(d, start.value() - 1, st, prefix.text(), first.value()))

    # ================================================================== 註解

    def comment_strip(self, sel=2):
        from .main_window import Mode
        w = self.win
        prefs = w.prefs
        defs = {"note": "#FFC107", "hl": "#FFD400", "ul": "#1E63E9", "so": "#E53935", "sq": "#E53935", "ft": "#1D1F23",
                "rect": "#E53935", "oval": "#1E88E5", "line": "#E53935", "arrow": "#E53935", "ink": "#1E63E9"}

        def col(k):
            return QColor(prefs.get("color." + k, defs.get(k, "#E53935")))

        def rgb(k):
            c = col(k)
            return (c.redF(), c.greenF(), c.blueF())

        width = lambda: prefs.get("width", 2)

        def markup_mode(kind, key, label):
            def rect(p, r):
                quads = self._quads_in(p, r)
                if not quads:
                    w.toast("框選範圍裡沒有文字")
                    return
                self.edit(label, K_ANNOT, lambda d: AN.markup(d[p], kind, quads, self.author(), rgb(key)))
            m = Mode(key, "拖曳框住要%s的文字（也可以先選取文字再按右鍵）" % label, T_RECT, rect=rect)
            w.view.tool_color = col(key)
            return m

        def shape_mode(kind, key, label, tool):
            def rect(p, r):
                self.edit(label, K_ANNOT, lambda d: AN.shape(d[p], kind, r, self.author(), rgb(key), width()))

            def line(p, a, b):
                self.edit(label, K_ANNOT, lambda d: AN.shape(d[p], kind, ((a.x, a.y), (b.x, b.y)), self.author(), rgb(key), width()))
            w.view.tool_color = col(key)
            w.view.tool_width = width()
            return Mode(key, "拖曳畫出%s" % label, tool, rect=rect, line=line)

        def ink_mode():
            def finish():
                strokes = w.view.take_ink()
                for pg, st in strokes:
                    self.edit("手繪", K_ANNOT, lambda d, pg=pg, st=st: AN.ink(d[pg], st, self.author(), rgb("ink"), width()))

            w.view.tool_color = col("ink")
            w.view.tool_width = width()
            return Mode("ink", "直接在頁面上畫；畫完按「完成手繪」", T_INK, exit=finish,
                        buttons=[("復原一筆", w.view.undo_ink), ("完成手繪", lambda: (finish(), w.set_mode(ink_mode())))])

        def note():
            def tap(p, x, y):
                t, ok = QInputDialog.getMultiLineText(w, "便利貼", "內容")
                if ok and t.strip():
                    self.edit("便利貼", K_ANNOT, lambda d: AN.note(d[p], (x, y), t.strip(), self.author(), rgb("note")))
            return Mode("note", "點一下要貼便利貼的位置", T_POINT, tap=tap)

        def freetext():
            def make(p, r):
                t, ok = QInputDialog.getMultiLineText(w, "文字框", "內容")
                if ok and t.strip():
                    self.edit("文字框", K_ANNOT, lambda d: AN.freetext(d[p], r, t.strip(), self.author(), 12, rgb("ft")))
            return Mode("ft", "拖曳出文字框的位置（或點一下）", T_RECT, rect=make, tap=lambda p, x, y: make(p, fitz.Rect(x, y, x + 200, y + 40)))

        def select_mode():
            def tap(p, x, y):
                an = AN.at(self.s.doc[p], x, y)
                if an is not None:
                    w.panels.show_comment(p, an.xref)
            return Mode("sel", "點一下註解可以查看、回覆、改樣式或刪除", T_POINT, tap=tap)

        items = [("選取", lambda: w.set_mode(select_mode())), ("便利貼", lambda: w.set_mode(note())),
                 ("螢光筆", lambda: w.set_mode(markup_mode("highlight", "hl", "螢光標示"))),
                 ("底線", lambda: w.set_mode(markup_mode("underline", "ul", "加底線"))),
                 ("刪除線", lambda: w.set_mode(markup_mode("strike", "so", "加刪除線"))),
                 ("波浪線", lambda: w.set_mode(markup_mode("squiggly", "sq", "加波浪線"))),
                 ("文字框", lambda: w.set_mode(freetext())),
                 ("矩形", lambda: w.set_mode(shape_mode("rect", "rect", "矩形", T_RECT))),
                 ("橢圓", lambda: w.set_mode(shape_mode("ellipse", "oval", "橢圓", T_ELLIPSE))),
                 ("直線", lambda: w.set_mode(shape_mode("line", "line", "直線", T_LINE))),
                 ("箭頭", lambda: w.set_mode(shape_mode("arrow", "arrow", "箭頭", T_LINE))),
                 ("手繪", lambda: w.set_mode(ink_mode())),
                 ("印章", self.stamp), ("|", None)]
        cbtn = QToolButton()
        cbtn.setText("● 顏色")
        cbtn.clicked.connect(lambda: self._pick_color(w.mode.name if w.mode else "hl", defs))
        wbtn = QToolButton()
        wbtn.setText("線寬")
        wbtn.clicked.connect(self._pick_width)
        items += [(cbtn, None), (wbtn, None)]
        w.show_strip("comment", items, sel)
        items[sel][1]()

    def _pick_color(self, key, defs):
        q = QColorDialog.getColor(QColor(self.win.prefs.get("color." + key, defs.get(key, "#E53935"))), self.win, "選擇顏色")
        if q.isValid():
            self.win.prefs.set("color." + key, q.name())
            self.view.tool_color = q
            self.win.toast("已改成新的顏色")

    def _pick_width(self):
        v, ok = QInputDialog.getInt(self.win, "線寬", "線寬（pt）", self.win.prefs.get("width", 2), 1, 20)
        if ok:
            self.win.prefs.set("width", v)
            self.view.tool_width = v

    def _quads_in(self, p, r):
        out = []
        for ln in T.group_lines(self.view.chars(p)):
            cs = [c for c in ln.chars if r.x0 <= c.cx <= r.x1 and r.y0 <= c.cy <= r.y1]
            if cs:
                out.append(fitz.Rect(min(c.x0 for c in cs), min(c.y0 for c in cs), max(c.x1 for c in cs), max(c.y1 for c in cs)).quad)
        return out

    def markup_selection(self, kind, color, ask=False):
        if not self.view.sel:
            return
        p = self.view.sel[0]
        rects = self.view.selected_rects()
        text = ""
        if ask:
            text, ok = QInputDialog.getMultiLineText(self.win, "註解", "寫下你的意見")
            if not ok:
                return
        quads = [r.quad for r in rects]
        self.view.clear_selection()
        self.edit("加註解" if ask else "標示文字", K_ANNOT, lambda d: AN.markup(d[p], kind, quads, self.author(), color, text))

    def note_at(self, p, x, y):
        t, ok = QInputDialog.getMultiLineText(self.win, "便利貼", "內容")
        if ok and t.strip():
            self.edit("便利貼", K_ANNOT, lambda d: AN.note(d[p], (x, y), t.strip(), self.author()))

    def stamp(self):
        items = AN.STAMPS + ["自訂文字…", "圖片…"]
        t, ok = QInputDialog.getItem(self.win, "選擇印章", "印章", items, 0, False)
        if not ok:
            return
        if t == "自訂文字…":
            t, ok = QInputDialog.getText(self.win, "自訂印章", "印章文字")
            if not ok or not t.strip():
                return
            png, ratio = AN.stamp_png(t.strip(), self.author(), (211, 47, 47))
            label = t.strip()
        elif t == "圖片…":
            path, _ = QFileDialog.getOpenFileName(self.win, "選擇印章圖片", "", IMG_FILTER)
            if not path:
                return
            pix = fitz.Pixmap(path)
            png, ratio, label = pix.tobytes("png"), pix.width / max(1, pix.height), "圖片印章"
        else:
            png, ratio = AN.stamp_png(t, self.author())
            label = t
        self.place("拖曳出印章的位置與大小（或點一下）", ratio,
                   lambda p, r: self.edit("印章", K_ANNOT, lambda d: AN.image_stamp(d[p], r, png, self.author(), label)), 150)

    # ================================================================== 表單

    def form_strip(self):
        from .main_window import Mode
        w = self.win
        s = self.s
        fs = FM.fields(s.doc)
        w.view.field_rects = {}
        for f in fs:
            w.view.field_rects.setdefault(f["page"], []).append(f["rect"])

        def tap(p, x, y):
            for f in FM.fields(self.s.doc):
                if f["page"] == p and fitz.Rect(f["rect"]).contains((x, y)):
                    self.fill_field(p, f["xref"])
                    return
            w.toast("這裡沒有表單欄位")

        def mode():
            return Mode("fill", "點一下欄位就可以填寫（藍色框是欄位）" if fs else "這份文件沒有表單欄位。可以用「建立欄位」自己加。", T_POINT, tap=tap)
        items = [("填寫", lambda: w.set_mode(mode())), ("建立欄位", self.prepare_form),
                 ("清除表單", lambda: self.edit("清除表單", K_FORM, FM.clear)),
                 ("平面化", self.flatten)]
        w.show_strip("form", items, 0)
        w.set_mode(mode())
        w.view.viewport().update()

    def fill_field(self, p, xref):
        pg, wd = FM.widget(self.s.doc, p, xref)
        if wd is None:
            return
        name = wd.field_name or "欄位"
        t = wd.field_type
        if t in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON):
            on = wd.field_value not in (False, "Off", "", None)
            self.edit("填寫表單", K_FORM, lambda d: FM.set_value(d, p, xref, not on))
        elif t in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
            opts = list(wd.choice_values or [])
            cur = opts.index(wd.field_value) if wd.field_value in opts else 0
            v, ok = QInputDialog.getItem(self.win, name, "選擇", opts, cur, t == fitz.PDF_WIDGET_TYPE_COMBOBOX)
            if ok:
                self.edit("填寫表單", K_FORM, lambda d: FM.set_value(d, p, xref, v))
        elif t == fitz.PDF_WIDGET_TYPE_SIGNATURE:
            self.digital_sign()
        elif t == fitz.PDF_WIDGET_TYPE_TEXT:
            multi = bool(wd.field_flags & 4096)
            if multi:
                v, ok = QInputDialog.getMultiLineText(self.win, name, "內容", wd.field_value or "")
            else:
                v, ok = QInputDialog.getText(self.win, name, "內容", text=wd.field_value or "")
            if ok:
                self.edit("填寫表單", K_FORM, lambda d: FM.set_value(d, p, xref, v))

    def flatten(self):
        if QMessageBox.question(self.win, "平面化", "平面化後欄位會變成頁面的一部分，不能再修改（可以按「復原」）。要繼續嗎？") == QMessageBox.Yes:
            self.edit("平面化表單", K_FORM, FM.flatten)

    def prepare_form(self):
        kinds = [("文字欄位", fitz.PDF_WIDGET_TYPE_TEXT), ("核取方塊", fitz.PDF_WIDGET_TYPE_CHECKBOX), ("選項按鈕", fitz.PDF_WIDGET_TYPE_RADIOBUTTON),
                 ("下拉選單", fitz.PDF_WIDGET_TYPE_COMBOBOX), ("清單", fitz.PDF_WIDGET_TYPE_LISTBOX), ("簽名欄位", fitz.PDF_WIDGET_TYPE_SIGNATURE)]
        t, ok = QInputDialog.getItem(self.win, "建立欄位", "欄位類型", [k[0] for k in kinds], 0, False)
        if not ok:
            return
        kind = dict(kinds)[t]

        def rect(p, r):
            n = len(FM.fields(self.s.doc)) + 1
            name, ok = QInputDialog.getText(self.win, "欄位名稱", "名稱", text="%s%d" % (t, n))
            if not ok:
                return
            opts = None
            if kind in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
                o, ok = QInputDialog.getText(self.win, "選項", "選項（用逗號分隔）", text="選項一,選項二,選項三")
                if not ok:
                    return
                opts = [x.strip() for x in o.replace("，", ",").split(",") if x.strip()]
            self.edit("建立表單欄位", K_FORM, lambda d: FM.add_field(d, p, r, kind, name.strip() or t, opts))
        from .main_window import Mode
        self.win.set_mode(Mode("field", "拖曳出「%s」的位置與大小" % t, T_RECT, rect=rect,
                               tap=lambda p, x, y: rect(p, fitz.Rect(x, y, x + (16 if kind in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON) else 160), y + (16 if kind in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON) else 22)))))

    # ================================================================== 填寫與簽署

    def sign_strip(self):
        w = self.win
        items = [("簽名", self.signature), ("日期", self.sign_date), ("✓ 勾選", lambda: self.sign_mark("✓")), ("✗ 打叉", lambda: self.sign_mark("✗")),
                 ("縮寫", self.sign_initials), ("|", None), ("數位簽章", self.digital_sign), ("驗證簽章", self.verify), ("管理憑證", self.certs)]
        w.show_strip("sign", items, 0)
        self.signature()

    def _sig_dir(self):
        return data_dir("signatures")

    def signature(self):
        d = self._sig_dir()
        saved = sorted(f for f in os.listdir(d) if f.endswith(".png"))
        choice = None
        if saved:
            dlg = QDialog(self.win)
            dlg.setWindowTitle("選擇簽名")
            v = QVBoxLayout(dlg)
            lst = QListWidget()
            lst.setIconSize(QSize(220, 80))
            for f in saved:
                it = QListWidgetItem(QIcon(os.path.join(d, f)), "")
                it.setData(Qt.UserRole, f)
                lst.addItem(it)
            lst.setCurrentRow(0)
            v.addWidget(lst)
            row = QHBoxLayout()
            new = QPushButton("新的簽名")
            dele = QPushButton("刪除選取的簽名")
            use = QPushButton("使用")
            use.setProperty("primary", True)
            row.addWidget(new)
            row.addWidget(dele)
            row.addStretch(1)
            row.addWidget(use)
            v.addLayout(row)
            res = {}
            new.clicked.connect(lambda: (res.update(new=True), dlg.accept()))
            use.clicked.connect(lambda: (res.update(file=lst.currentItem().data(Qt.UserRole) if lst.currentItem() else None), dlg.accept()))
            lst.itemDoubleClicked.connect(lambda it: (res.update(file=it.data(Qt.UserRole)), dlg.accept()))

            def remove():
                it = lst.currentItem()
                if it:
                    os.remove(os.path.join(d, it.data(Qt.UserRole)))
                    lst.takeItem(lst.row(it))
            dele.clicked.connect(remove)
            if dlg.exec() != QDialog.Accepted:
                return
            if res.get("file"):
                choice = os.path.join(d, res["file"])
        if choice is None:
            pad = SignPad(self.win)
            if pad.exec() != QDialog.Accepted or not pad.strokes:
                return
            c = pad.color._color
            png, ratio = AN.strokes_png(pad.strokes, (c.redF(), c.greenF(), c.blueF()), 3)
            if pad.save.isChecked():
                f = os.path.join(d, "sig_%s.png" % datetime.datetime.now().strftime("%Y%m%d%H%M%S"))
                with open(f, "wb") as fp:
                    fp.write(png)
        else:
            png = open(choice, "rb").read()
            pix = fitz.Pixmap(png)
            ratio = pix.width / max(1, pix.height)
        self.place("點一下放簽名（或拖曳出大小）", ratio,
                   lambda p, r: self.edit("簽名", K_ANNOT, lambda doc: AN.image_stamp(doc[p], r, png, self.author(), "簽名")), 150)

    def sign_date(self):
        t = datetime.date.today().strftime("%Y-%m-%d")
        png, ratio = AN.text_png(t)
        self.place("點一下放日期", ratio, lambda p, r: self.edit("日期", K_ANNOT, lambda d: AN.image_stamp(d[p], r, png, self.author(), t)), 90)

    def sign_mark(self, ch):
        png, ratio = AN.text_png(ch, (0.12, 0.39, 0.91) if ch == "✓" else (0.9, 0.22, 0.21), 32)
        self.place("點一下放「%s」" % ch, ratio, lambda p, r: self.edit("勾選", K_ANNOT, lambda d: AN.image_stamp(d[p], r, png, self.author(), ch)), 18)

    def sign_initials(self):
        t, ok = QInputDialog.getText(self.win, "縮寫", "你的縮寫", text=self.win.prefs.get("initials", ""))
        if not ok or not t.strip():
            return
        self.win.prefs.set("initials", t.strip())
        png, ratio = AN.text_png(t.strip())
        self.place("點一下放縮寫", ratio, lambda p, r: self.edit("縮寫", K_ANNOT, lambda d: AN.image_stamp(d[p], r, png, self.author(), t)), 60)

    def certs(self):
        while True:
            lst = SG.list_certs()
            items = lst + ["＋ 建立自簽憑證…", "＋ 匯入 .p12／.pfx…"]
            t, ok = QInputDialog.getItem(self.win, "管理憑證", "憑證（存在本機，不會上傳）", items, 0, False)
            if not ok:
                return
            if t.startswith("＋ 建立"):
                f = Form(self.win, "建立自簽憑證", "自簽憑證可以證明文件簽署後沒有被改過；要讓別人信任你的身分，請使用憑證機構發的憑證。")
                name = f.line("姓名", self.author())
                email = f.line("Email", "")
                pw = f.line("保護密碼", "", "", True)
                if f.run() and name.text().strip():
                    SG.create_self_signed(name.text().strip(), email.text().strip(), pw.text())
                    self.win.toast("已建立憑證")
            elif t.startswith("＋ 匯入"):
                p, _ = QFileDialog.getOpenFileName(self.win, "匯入憑證", "", "憑證 (*.p12 *.pfx)")
                if p:
                    SG.import_cert(p)
            else:
                if QMessageBox.question(self.win, "刪除憑證", "要刪除「%s」嗎？" % t) == QMessageBox.Yes:
                    os.remove(os.path.join(SG.cert_dir(), t))

    def digital_sign(self):
        s = self.s
        if s.dirty:
            if QMessageBox.question(self.win, "先儲存", "數位簽章要簽在已儲存的檔案上。要先儲存目前的變更嗎？") != QMessageBox.Yes or not self.win.save():
                return
        certs = SG.list_certs()
        if not certs:
            QMessageBox.information(self.win, "沒有憑證", "還沒有憑證。請先建立自簽憑證或匯入 .p12／.pfx。")
            self.certs()
            certs = SG.list_certs()
            if not certs:
                return
        f = Form(self.win, "數位簽章", "簽署會用增量更新寫入，原本的內容一個位元組都不會變。", "簽署")
        cert = f.combo("憑證", certs)
        pw = f.line("憑證密碼", "", "", True)
        reason = f.line("原因", "我同意這份文件的內容")
        loc = f.line("地點", "台灣")
        visible = f.check("在頁面上顯示簽章（接著框選位置）", True)
        if not f.run():
            return
        p12 = os.path.join(SG.cert_dir(), cert.currentText())
        try:
            SG.describe(open(p12, "rb").read(), pw.text())
        except Exception:
            QMessageBox.warning(self.win, "密碼錯誤", "憑證密碼不正確")
            return

        def do(page=0, r=None):
            rect = None
            if r is not None:
                pg = s.doc[page]
                pr = (fitz.Rect(r) * ~pg.transformation_matrix).normalize()     # 頁面座標 → PDF 座標
                rect = (pr.x0, pr.y0, pr.x1, pr.y1)
            try:
                QApplication.setOverrideCursor(Qt.WaitCursor)
                out = SG.sign(s.output_bytes(subset=False), p12, pw.text(), reason.text(), loc.text(), page=page, rect=rect)
            except Exception as e:
                QApplication.restoreOverrideCursor()
                QMessageBox.warning(self.win, "簽署失敗", str(e))
                return
            QApplication.restoreOverrideCursor()
            with open(s.path, "wb") as fp:
                fp.write(out)
            s.apply_bytes("數位簽章", out)
            s.saved_pos = s.pos
            self.win.changed()
            self.win.exit_modes()
            QMessageBox.information(self.win, "已簽署", "已用數位簽章簽署並儲存到原檔。\n之後再修改文件會讓簽章失效（會顯示「簽署後有修改」）。")
        if visible.isChecked():
            from .main_window import Mode
            self.win.set_mode(Mode("dsig", "拖曳出簽章顯示的位置", T_RECT, rect=lambda p, r: do(p, r)))
        else:
            do()

    def verify(self):
        try:
            res = SG.verify(self.s.current_bytes())
        except Exception as e:
            QMessageBox.warning(self.win, "無法驗證", str(e))
            return
        if not res:
            QMessageBox.information(self.win, "驗證簽章", "這份文件沒有數位簽章。")
            return
        lines = []
        for r in res:
            ok = r["intact"] and r["valid"]
            lines.append("%s %s\n　簽署者：%s\n　時間：%s\n　%s；%s%s" % ("✅" if ok else "❌", r["field"], r["signer"], r["time"], "內容完整" if r["intact"] else "內容已被修改",
                                                              r["coverage"], "；憑證受信任" if r["trusted"] else "；憑證不在受信任清單（例如自簽憑證）"))
        QMessageBox.information(self.win, "驗證簽章", "\n\n".join(lines))

    # ================================================================== 頁面與檔案

    def combine(self):
        files, _ = QFileDialog.getOpenFileNames(self.win, "選擇要合併的 PDF（依選取順序）", self.win.prefs.get("last_dir", ""), "PDF 檔案 (*.pdf)")
        if not files:
            return
        if len(files) == 1 and self.s is None:
            self.win.toast("請選兩個以上的檔案")
            return
        dlg = QDialog(self.win)
        dlg.setWindowTitle("合併 PDF：調整順序")
        v = QVBoxLayout(dlg)
        lst = QListWidget()
        lst.setDragDropMode(QListWidget.InternalMove)
        if self.s is not None:
            it = QListWidgetItem("（目前文件）" + self.s.name)
            it.setData(Qt.UserRole, None)
            lst.addItem(it)
        for f in files:
            it = QListWidgetItem(os.path.basename(f))
            it.setData(Qt.UserRole, f)
            lst.addItem(it)
        v.addWidget(QLabel("拖曳可以調整順序。每個檔案會變成一個書籤，原本的書籤放在底下。"))
        v.addWidget(lst)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("合併")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        v.addWidget(bb)
        if dlg.exec() != QDialog.Accepted:
            return
        parts = []
        for k in range(lst.count()):
            p = lst.item(k).data(Qt.UserRole)
            if p is None:
                parts.append((self.s.name, self.s.current_bytes(), self.s.password))
            else:
                parts.append((os.path.basename(p), open(p, "rb").read(), None))
        try:
            QApplication.setOverrideCursor(Qt.WaitCursor)
            data = PG.merge(parts)
        except ValueError as e:
            QApplication.restoreOverrideCursor()
            QMessageBox.warning(self.win, "無法合併", str(e))
            return
        QApplication.restoreOverrideCursor()
        self.win.open_bytes(data, "合併文件.pdf")

    def extract(self, pages=None):
        if pages is None:
            t, ok = QInputDialog.getText(self.win, "擷取頁面", "要擷取的頁面（例如 1-3,5,奇數）", text=str(self.view.current_page() + 1))
            if not ok:
                return
            pages = PG.parse_pages(t, self.s.doc.page_count)
        if not pages:
            return
        data = PG.extract(self.s.doc, pages)
        base = os.path.splitext(self.s.name)[0]
        if QMessageBox.question(self.win, "擷取頁面", "要直接開成新分頁嗎？（選「否」另存成檔案）") == QMessageBox.Yes:
            self.win.open_bytes(data, "%s_擷取.pdf" % base)
        else:
            self.win.save_bytes_dialog(data, "%s_擷取.pdf" % base)

    def split(self):
        f = Form(self.win, "分割 PDF", "分割出的檔案會存到你選的資料夾。", "分割")
        how = f.combo("方式", ["每 N 頁一份", "在指定頁之前分割"])
        n = f.num("N", 1, 1, 9999)
        before = f.line("在這些頁之前分割", "", "例如 4,9")
        if not f.run():
            return
        folder = QFileDialog.getExistingDirectory(self.win, "存到資料夾", self.win.prefs.get("last_dir", ""))
        if not folder:
            return
        if how.currentIndex() == 0:
            parts = PG.split_every(self.s.doc, n.value())
        else:
            starts = [p for p in PG.parse_pages(before.text(), self.s.doc.page_count)]
            parts = PG.split_before(self.s.doc, starts)
        base = os.path.splitext(self.s.name)[0]
        for k, data in enumerate(parts):
            with open(os.path.join(folder, "%s_%02d.pdf" % (base, k + 1)), "wb") as fp:
                fp.write(data)
        self.win.toast("已分割成 %d 個檔案" % len(parts))
        os.startfile(folder)

    def images_to_pdf(self):
        files, _ = QFileDialog.getOpenFileNames(self.win, "選擇圖片（依選取順序）", "", IMG_FILTER)
        if not files:
            return
        paper, ok = QInputDialog.getItem(self.win, "頁面大小", "紙張", ["和圖片一樣大"] + list(EX.PAPER.keys()), 1, False)
        if not ok:
            return
        data = EX.from_images(files, None if paper == "和圖片一樣大" else EX.PAPER[paper], 0 if paper == "和圖片一樣大" else 24)
        self.win.open_bytes(data, "圖片轉 PDF.pdf")

    def text_to_pdf(self):
        t, ok = QInputDialog.getMultiLineText(self.win, "文字轉 PDF", "貼上或輸入文字")
        if ok and t.strip():
            self.win.open_bytes(EX.from_text(t), "文字.pdf")

    def export_images(self):
        f = Form(self.win, "匯出圖片", None, "匯出")
        fmt = f.combo("格式", ["PNG", "JPG"])
        dpi = f.num("解析度（DPI）", 150, 36, 600)
        pages = f.line("頁面", "", "留白＝全部")
        if not f.run():
            return
        folder = QFileDialog.getExistingDirectory(self.win, "存到資料夾", self.win.prefs.get("last_dir", ""))
        if not folder:
            return
        QApplication.setOverrideCursor(Qt.WaitCursor)
        out = EX.images(self.s.doc, PG.parse_pages(pages.text(), self.s.doc.page_count), folder, os.path.splitext(self.s.name)[0], fmt.currentText().lower(), dpi.value())
        QApplication.restoreOverrideCursor()
        self.win.toast("已匯出 %d 張圖片" % len(out))
        os.startfile(folder)

    def export_docx(self):
        f, _ = QFileDialog.getSaveFileName(self.win, "匯出 Word", os.path.splitext(self.s.name)[0] + ".docx", "Word 文件 (*.docx)")
        if f:
            EX.docx(self.s.doc, f)
            self.win.toast("已匯出 " + f)

    def export_text(self):
        f, _ = QFileDialog.getSaveFileName(self.win, "匯出純文字", os.path.splitext(self.s.name)[0] + ".txt", "文字檔 (*.txt)")
        if f:
            with open(f, "w", encoding="utf-8") as fp:
                fp.write(EX.text(self.s.doc))
            self.win.toast("已匯出 " + f)

    def export_comments(self):
        lst = AN.listing(self.s.doc)
        if not lst:
            self.win.toast("沒有註解")
            return
        f, _ = QFileDialog.getSaveFileName(self.win, "匯出註解", os.path.splitext(self.s.name)[0] + "_註解.txt", "文字檔 (*.txt)")
        if f:
            with open(f, "w", encoding="utf-8") as fp:
                for c in lst:
                    fp.write("第 %d 頁｜%s｜%s｜%s\n%s\n\n" % (c["page"] + 1, c["name"], c["author"], c["date"], c["content"]))
            self.win.toast("已匯出 %d 則註解" % len(lst))

    def print_doc(self):
        b = self.s.block(K_PRINT)
        if b:
            QMessageBox.information(self.win, "無法列印", b)
            return
        from PySide6.QtPrintSupport import QPrintDialog, QPrinter
        pr = QPrinter(QPrinter.HighResolution)
        pr.setDocName(self.s.name)
        pr.setFromTo(1, self.s.doc.page_count)
        dlg = QPrintDialog(pr, self.win)
        dlg.setOption(QPrintDialog.PrintPageRange, True)
        if dlg.exec() != QDialog.Accepted:
            return
        a, b2 = (pr.fromPage(), pr.toPage()) if pr.fromPage() > 0 else (1, self.s.doc.page_count)
        painter = QPainter()
        if not painter.begin(pr):
            QMessageBox.warning(self.win, "無法列印", "無法連線到印表機")
            return
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            for k, i in enumerate(range(a - 1, b2)):
                if k:
                    pr.newPage()
                page = self.s.doc[i]
                pix = page.get_pixmap(dpi=300, alpha=False)
                img = QImage(pix.samples, pix.width, pix.height, pix.stride, QImage.Format_RGB888)
                area = painter.viewport()
                sz = img.size().scaled(area.size(), Qt.KeepAspectRatio)
                painter.drawImage(QRectF((area.width() - sz.width()) / 2, (area.height() - sz.height()) / 2, sz.width(), sz.height()), img)
        finally:
            painter.end()
            QApplication.restoreOverrideCursor()
        self.win.toast("已送出列印")

    # ================================================================== 安全與隱私

    def properties(self):
        s = self.s
        d = s.doc
        dlg = QDialog(self.win)
        dlg.setWindowTitle("文件屬性")
        dlg.resize(560, 480)
        v = QVBoxLayout(dlg)
        tabs = QTabWidget()
        v.addWidget(tabs)
        m = d.metadata or {}
        desc = QWidget()
        fl = QFormLayout(desc)
        title = QLineEdit(m.get("title", ""))
        author = QLineEdit(m.get("author", ""))
        subject = QLineEdit(m.get("subject", ""))
        keywords = QLineEdit(m.get("keywords", ""))
        for lbl, w in (("標題", title), ("作者", author), ("主旨", subject), ("關鍵字", keywords)):
            fl.addRow(lbl, w)
        fl.addRow("建立程式", QLabel(m.get("creator", "")))
        fl.addRow("PDF 製作程式", QLabel(m.get("producer", "")))
        fl.addRow("建立日期", QLabel(_date(m.get("creationDate", ""))))
        fl.addRow("修改日期", QLabel(_date(m.get("modDate", ""))))
        tabs.addTab(desc, "描述")
        gen = QTextBrowser()
        r = d[0].rect if d.page_count else fitz.Rect()
        size = os.path.getsize(s.path) if s.path and os.path.isfile(s.path) else len(s.current_bytes())
        gen.setPlainText("檔案：%s\n位置：%s\n大小：%.1f KB\nPDF 版本：%s\n頁數：%d\n頁面大小：%.0f × %.0f pt（%.0f × %.0f mm）\n頁面標籤：%s\n表單欄位：%d\n圖層：%d\n附件：%d\n書籤：%d"
                         % (s.name, s.path or "（尚未儲存）", size / 1024, m.get("format", ""), d.page_count, r.width, r.height, r.width / 72 * 25.4, r.height / 72 * 25.4,
                            "有" if d.get_page_labels() else "沒有", len(FM.fields(d)), len(PG.layers(d)), d.embfile_count(), len(d.get_toc())))
        tabs.addTab(gen, "一般")
        ft = QTextBrowser()
        ft.setPlainText("\n".join("%s（%s）%s，第一次出現在第 %d 頁" % (n, t, "已嵌入" if e else "未嵌入", p) for n, t, e, p in PG.fonts(d)) or "沒有字型")
        tabs.addTab(ft, "字型")
        sec = QTextBrowser()
        sec.setPlainText("\n".join("%s：%s" % row for row in SEC.describe(d, s)))
        tabs.addTab(sec, "安全性")
        bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Close)
        bb.button(QDialogButtonBox.Save).setText("套用描述")
        bb.button(QDialogButtonBox.Close).setText("關閉")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        v.addWidget(bb)
        if dlg.exec() == QDialog.Accepted:
            self.edit("文件屬性", K_EDIT, lambda doc: PG.set_meta(doc, title.text(), author.text(), subject.text(), keywords.text()))

    def unlock(self):
        s = self.s
        if not s.encrypted or s.owner:
            QMessageBox.information(self.win, "解除限制", "這份文件沒有作者限制。")
            return
        pw, ok = QInputDialog.getText(self.win, "解除限制", "輸入擁有者密碼", QLineEdit.Password)
        if ok:
            if s.unlock(pw):
                self.win.changed()
                self.win.toast("已解除限制")
            else:
                QMessageBox.warning(self.win, "解除限制", "擁有者密碼不正確")

    def protect(self):
        f = Form(self.win, "密碼保護（AES-256）", "開啟密碼：開檔時要輸入。權限密碼：可以限制列印、修改、複製；有權限密碼的人不受限制。", "加密")
        user = f.line("開啟密碼", "", "留白＝不需要密碼就能開", True)
        owner = f.line("權限密碼", "", "建議設定", True)
        checks = {}
        for key, name, _ in SEC.PERMS:
            checks[key] = f.check("允許" + name, True)
        if not f.run():
            return
        if not user.text() and not owner.text():
            QMessageBox.information(self.win, "密碼保護", "請至少設定一個密碼")
            return
        allow = {k for k, c in checks.items() if c.isChecked()}
        s = self.s
        data = SEC.encrypt(s.current_bytes(), s.password, user.text(), owner.text(), allow)
        s.password = owner.text() or user.text()
        s.encrypted = True
        s.owner = True
        s.apply_bytes("密碼保護", data)
        self.win.changed()
        self.win.toast("已加密。記得儲存檔案。")

    def remove_protection(self):
        s = self.s
        if not s.encrypted:
            QMessageBox.information(self.win, "移除保護", "這份文件沒有加密。")
            return
        if not s.owner:
            self.unlock()
            if not s.owner:
                return
        data = SEC.decrypt(s.current_bytes(), s.password)
        s.encrypted = False
        s.apply_bytes("移除保護", data)
        self.win.changed()
        self.win.toast("已移除密碼與權限限制。記得儲存檔案。")

    def redact_mode(self):
        from .main_window import Mode
        rects = {}

        def rect(p, r):
            rects.setdefault(p, []).append(r)
            self.view.hits = {pg: [fitz.Rect(x).quad for x in rs] for pg, rs in rects.items()}
            self.view.viewport().update()
            self.win.set_hint("已標記 %d 個區域。按「套用塗銷」永久移除。" % sum(len(v) for v in rects.values()), [("套用塗銷", apply_), ("搜尋並塗銷…", find)])

        def find():
            t, ok = QInputDialog.getText(self.win, "搜尋並塗銷", "要塗銷的文字（逗號分隔多個詞）")
            if ok and t.strip():
                from ..engine.text import search
                for pg, q in search(self.s.doc, t):
                    rect(pg, q.rect)

        def apply_():
            if not rects:
                return
            if QMessageBox.warning(self.win, "套用塗銷", "標記範圍裡的文字、圖片、圖形會被永久移除，蓋上黑色方塊。要繼續嗎？", QMessageBox.Yes | QMessageBox.No) != QMessageBox.Yes:
                return
            items = {k: list(v) for k, v in rects.items()}
            rects.clear()
            self.view.hits = {}
            self.edit("塗銷", K_EDIT, lambda d: [SEC.redact(d[p], rs) for p, rs in items.items()], self.win.exit_modes)
        self.win.set_mode(Mode("redact", "框選要永久移除的內容（可以標記多個區域）", T_RECT, rect=rect,
                               buttons=[("搜尋並塗銷…", find)], exit=lambda: (setattr(self.view, "hits", {}), self.view.viewport().update())))

    def redact_selection(self):
        if not self.view.sel:
            return
        p = self.view.sel[0]
        rs = self.view.selected_rects()
        self.view.clear_selection()
        if QMessageBox.warning(self.win, "塗銷", "選取的文字會被永久移除。要繼續嗎？", QMessageBox.Yes | QMessageBox.No) == QMessageBox.Yes:
            self.edit("塗銷", K_EDIT, lambda d: SEC.redact(d[p], rs))

    def sanitize(self):
        f = Form(self.win, "移除隱藏資訊", "發佈或寄送前，把可能洩漏個資的隱藏內容拿掉。", "移除")
        meta = f.check("作者、建立程式等中繼資料", True)
        js = f.check("JavaScript", True)
        att = f.check("附件", True)
        hidden = f.check("隱藏的文字", True)
        com = f.check("註解", False)
        links = f.check("連結", False)
        if f.run():
            self.edit("移除隱藏資訊", K_EDIT, lambda d: SEC.sanitize(d, meta.isChecked(), js.isChecked(), att.isChecked(), com.isChecked(), links.isChecked(), hidden.isChecked()))

    def compress(self):
        f = Form(self.win, "壓縮 PDF", "圖片解析度超過設定值時會縮小並轉成 JPEG。文字與向量圖不受影響。", "壓縮")
        dpi = f.num("圖片最高解析度（DPI）", 150, 50, 600)
        q = f.num("JPEG 品質", 70, 20, 95)
        if not f.run():
            return
        before = len(self.s.current_bytes())
        n = {}
        if self.edit("壓縮 PDF", K_EDIT, lambda d: n.update(c=SEC.compress(d, dpi.value(), q.value()))):
            after = len(self.s.output_bytes())
            self.win.toast("壓縮了 %d 張圖片；%.0f KB → %.0f KB" % (n.get("c", 0), before / 1024, after / 1024), 6000)

    def grayscale(self):
        if QMessageBox.question(self.win, "轉灰階", "每一頁會重新繪製成灰階圖片（文字將無法搜尋）。會開成新分頁。要繼續嗎？") == QMessageBox.Yes:
            QApplication.setOverrideCursor(Qt.WaitCursor)
            data = SEC.grayscale(self.s.current_bytes())
            QApplication.restoreOverrideCursor()
            self.win.open_bytes(data, os.path.splitext(self.s.name)[0] + "_灰階.pdf")

    # ================================================================== 其他

    def compare(self):
        f, _ = QFileDialog.getOpenFileName(self.win, "選擇要比較的另一份 PDF", self.win.prefs.get("last_dir", ""), "PDF 檔案 (*.pdf)")
        if not f:
            return
        other = fitz.open(f)
        res = MI.compare(self.s.doc, other)
        dlg = QDialog(self.win)
        dlg.setWindowTitle("比較文件：%s ↔ %s" % (self.s.name, os.path.basename(f)))
        dlg.resize(720, 560)
        v = QVBoxLayout(dlg)
        tb = QTextBrowser()
        if not res:
            tb.setHtml("<p>兩份文件的文字完全相同。</p>")
        else:
            html = []
            for i, diffs in res:
                html.append("<h3>第 %d 頁</h3>" % (i + 1))
                for kind, t in diffs:
                    color = "#2E7D32" if kind == "+" else "#C62828"
                    html.append('<div style="color:%s">%s %s</div>' % (color, "＋" if kind == "+" else "－", t.replace("<", "&lt;")))
            tb.setHtml("<p>綠色＝只在「%s」裡，紅色＝只在目前文件裡。</p>%s" % (os.path.basename(f), "".join(html)))
        v.addWidget(tb)
        dlg.exec()

    def measure(self):
        from .main_window import Mode
        scale = self.win.prefs.get("measure_scale", 1.0)       # 1 pt 實際代表幾 mm
        unit = self.win.prefs.get("measure_unit", "mm")

        def mm(pt):
            return pt / 72 * 25.4 * scale

        def line(p, a, b):
            d = math.hypot(b.x - a.x, b.y - a.y)
            self.view.measure_text = "距離：%.1f %s" % (mm(d) if unit == "mm" else mm(d) / 10, unit)
            self.view.viewport().update()

        def rect(p, r):
            self.view.measure_text = "寬 %.1f × 高 %.1f %s，面積 %.1f %s²" % (_u(mm(r.width), unit), _u(mm(r.height), unit), unit, _u(mm(r.width), unit) * _u(mm(r.height), unit), unit)
            self.view.viewport().update()

        def set_scale():
            v, ok = QInputDialog.getDouble(self.win, "比例尺", "圖面上 1 mm 代表實際幾 mm（例如 1:100 輸入 100）", scale, 0.001, 1e6, 3)
            if ok:
                self.win.prefs.set("measure_scale", v)
                self.measure()
        self.win.set_mode(Mode("measure", "拖曳量距離（按住 Shift 拖曳量面積）；比例尺 1:%g" % scale, T_LINE, line=line,
                               buttons=[("量面積", lambda: self.win.set_mode(Mode("measure_a", "拖曳出要量面積的範圍", T_RECT, rect=rect, exit=lambda: setattr(self.view, "measure_text", None)))),
                                        ("比例尺…", set_scale)],
                               exit=lambda: setattr(self.view, "measure_text", None)))

    def accessibility(self):
        rows = MI.accessibility(self.s.doc)
        msg = "\n".join("%s %s\n　%s" % ("✅" if ok else "⚠️", name, why) for name, ok, why, fix in rows)
        fixes = [(name, fix) for name, ok, why, fix in rows if not ok and fix]
        if not fixes:
            QMessageBox.information(self.win, "無障礙檢查", msg)
            return
        if QMessageBox.question(self.win, "無障礙檢查", msg + "\n\n要自動修正可以修正的項目嗎？") == QMessageBox.Yes:
            title = None
            if any(f == "title" for _, f in fixes):
                title, ok = QInputDialog.getText(self.win, "文件標題", "標題", text=os.path.splitext(self.s.name)[0])
            self.edit("無障礙修正", K_EDIT, lambda d: [MI.fix_accessibility(d, f, title if f == "title" else None) for _, f in fixes if f != "toc"])

    def guided(self):
        items = ["發佈前清理（移除隱藏資訊＋壓縮）", "寄送前準備（平面化表單與註解＋移除隱藏資訊）", "封存（平面化＋嵌入字型子集）", "匯出註解"]
        t, ok = QInputDialog.getItem(self.win, "引導式動作", "要做什麼？", items, 0, False)
        if not ok:
            return
        k = items.index(t)
        if k == 0:
            self.edit("發佈前清理", K_EDIT, lambda d: (SEC.sanitize(d), SEC.compress(d)))
        elif k == 1:
            self.edit("寄送前準備", K_EDIT, lambda d: (d.bake(annots=True, widgets=True), SEC.sanitize(d, comments=True)))
        elif k == 2:
            self.edit("封存", K_EDIT, lambda d: (d.bake(annots=True, widgets=True), d.subset_fonts()))
        else:
            self.export_comments()

    def ocr(self):
        if not MI.tesseract_available():
            if QMessageBox.question(self.win, "OCR 文字辨識", "OCR 需要免費的 Tesseract 辨識引擎（含繁體中文語言檔）。\n\n"
                                    "要開啟下載頁面嗎？安裝時請勾選「Chinese (Traditional)」語言，裝好後重新開啟本程式。") == QMessageBox.Yes:
                from PySide6.QtGui import QDesktopServices
                from PySide6.QtCore import QUrl
                QDesktopServices.openUrl(QUrl("https://github.com/UB-Mannheim/tesseract/wiki"))
            return
        t, ok = QInputDialog.getText(self.win, "OCR 文字辨識", "要辨識的頁面（例如 1-3，留白＝目前這一頁）", text="")
        if not ok:
            return
        pages = PG.parse_pages(t, self.s.doc.page_count) if t.strip() else [self.view.current_page()]
        cnt = {}

        def op(d):
            for i in pages:
                cnt[i] = MI.ocr_page(d, i)
        if self.edit("OCR 文字辨識", K_EDIT, op):
            self.win.toast("辨識完成：%d 段文字，現在可以搜尋、選取了" % sum(cnt.values()), 6000)

    def settings(self):
        p = self.win.prefs
        f = Form(self.win, "設定", None, "儲存")
        author = f.line("作者名稱（註解、印章用）", p.get("author", "小柯"))
        dark = f.check("深色主題", p.get("dark", False))
        upd = f.check("啟動時自動檢查更新", p.get("auto_update", True))
        panels = f.check("開啟文件時顯示側邊面板", p.get("panels", True))
        cur = p.get("ui_scale", 1.8)
        names = ["%d%%" % round(x * 100) for x in theme.SCALES]
        size = f.combo("介面字級", names, theme.SCALES.index(cur) if cur in theme.SCALES else 4)
        if not f.run():
            return
        p.set("author", author.text().strip() or "小柯")
        p.set("auto_update", upd.isChecked())
        p.set("panels", panels.isChecked())
        new = theme.SCALES[size.currentIndex()]
        if new != p.get("ui_scale", 1.8):
            p.set("ui_scale", new)
            QMessageBox.information(self.win, "介面字級", "介面字級已改成 %d%%，重新開啟程式後全部生效。" % round(new * 100))
        if dark.isChecked() != p.get("dark", False):
            self.win.toggle_theme()


def _u(mm, unit):
    return mm / 10 if unit == "cm" else (mm / 1000 if unit == "m" else mm)


def _date(s):
    s = (s or "").replace("D:", "")
    if len(s) >= 12 and s[:8].isdigit():
        return "%s-%s-%s %s:%s" % (s[:4], s[4:6], s[6:8], s[8:10], s[10:12])
    return s
