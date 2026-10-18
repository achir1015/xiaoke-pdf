"""其他工具：QR Code、連結、圖片、比較兩份文件、無障礙檢查、OCR。"""
import difflib
import io
import shutil

import pymupdf as fitz
import qrcode


def qr_png(data, scale=8):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=scale)
    q.add_data(data)
    q.make(fit=True)
    im = q.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def add_qr(page, rect, data, url=True):
    """QR Code 畫進頁面；網址的話整塊加上連結（點一下就開）。"""
    page.insert_image(rect, stream=qr_png(data))
    if url and data.lower().startswith(("http://", "https://", "mailto:", "tel:")):
        page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(rect), "uri": data})


def add_link(page, rect, uri=None, dest_page=None):
    if uri:
        if not uri.lower().startswith(("http://", "https://", "mailto:", "tel:", "file:")):
            uri = "https://" + uri
        page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(rect), "uri": uri})
    else:
        page.insert_link({"kind": fitz.LINK_GOTO, "from": fitz.Rect(rect), "page": dest_page, "to": fitz.Point(0, 0)})


def add_image(page, rect, data, opacity=1.0):
    page.insert_image(rect, stream=data, keep_proportion=False)


def compare(doc_a, doc_b):
    """逐頁比較文字，回傳 [(頁碼, [(類型, 文字)])]，類型為 '+'、'-'。"""
    out = []
    n = max(doc_a.page_count, doc_b.page_count)
    for i in range(n):
        a = doc_a[i].get_text("text", sort=True).splitlines() if i < doc_a.page_count else []
        b = doc_b[i].get_text("text", sort=True).splitlines() if i < doc_b.page_count else []
        diffs = []
        for line in difflib.unified_diff(a, b, lineterm="", n=0):
            if line.startswith(("---", "+++", "@@")):
                continue
            if line[:1] in "+-" and line[1:].strip():
                diffs.append((line[0], line[1:]))
        if diffs:
            out.append((i, diffs))
    return out


def accessibility(doc):
    """無障礙檢查：[(項目, 是否通過, 說明, 修正方式代號或 None)]"""
    m = doc.metadata or {}
    cat = doc.pdf_catalog()
    lang = doc.xref_get_key(cat, "Lang")[1] if cat else "null"
    marked = doc.xref_get_key(cat, "MarkInfo")[1] if cat else "null"
    has_text = any(doc[i].get_text().strip() for i in range(min(doc.page_count, 10)))
    fonts_ok = True
    for i in range(min(doc.page_count, 20)):
        for f in doc[i].get_fonts():
            if f[1] in ("n/a", ""):
                fonts_ok = False
    rows = [
        ("文件標題", bool(m.get("title")), "有標題時，螢幕閱讀器會讀出標題而不是檔名", "title"),
        ("文件語言", lang not in ("null", ""), "設定語言（例如 zh-TW）讓朗讀用正確的發音", "lang"),
        ("可選取的文字", has_text, "沒有文字的掃描檔請先做 OCR 文字辨識", None),
        ("標記內容（Tagged PDF）", marked not in ("null", ""), "有結構標記時閱讀順序更正確（需要原始檔重新匯出）", None),
        ("字型都已嵌入", fonts_ok, "沒有嵌入的字型在別的電腦上可能顯示不同", None),
        ("書籤", bool(doc.get_toc()) or doc.page_count < 10, "長文件建議加上書籤方便瀏覽", "toc"),
    ]
    return rows


def fix_accessibility(doc, what, value=None):
    if what == "title":
        m = dict(doc.metadata or {}); m.pop("encryption", None); m.pop("format", None)
        m["title"] = value or m.get("title") or "未命名文件"
        doc.set_metadata(m)
        doc.xref_set_key(doc.pdf_catalog(), "ViewerPreferences", "<</DisplayDocTitle true>>")
    elif what == "lang":
        doc.xref_set_key(doc.pdf_catalog(), "Lang", "(%s)" % (value or "zh-TW"))


def tesseract_available():
    if shutil.which("tesseract"):
        return True
    import os
    for p in (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"):
        if os.path.isfile(p):
            os.environ["PATH"] = os.path.dirname(p) + os.pathsep + os.environ.get("PATH", "")
            return True
    return False


def ocr_page(doc, i, lang="chi_tra+eng", dpi=300):
    """用 Tesseract 辨識一頁，把看不見的文字層疊在原本的位置（可以搜尋、複製）。"""
    page = doc[i]
    tp = page.get_textpage_ocr(language=lang, dpi=dpi, full=True)
    d = page.get_text("dict", textpage=tp)
    font = fitz.Font("cjk")
    tw = fitz.TextWriter(page.rect)
    n = 0
    for b in d["blocks"]:
        for ln in b.get("lines", []):
            for sp in ln["spans"]:
                t = sp["text"].strip()
                if not t:
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                size = max(4, (y1 - y0) * 0.85)
                w = font.text_length(t, fontsize=size)
                tw.append((x0, y1 - (y1 - y0) * 0.2), t, font=font, fontsize=size * min(1.0, (x1 - x0) / max(w, 1)))
                n += 1
    tw.write_text(page, render_mode=3)     # 3＝看不見的文字
    return n
