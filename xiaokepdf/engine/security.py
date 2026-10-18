"""安全與隱私：密碼保護（AES-256）與權限、移除保護、塗銷、移除隱藏資訊、壓縮、轉灰階。"""
import io

import pymupdf as fitz
from PIL import Image

PERMS = [
    ("print", "列印", fitz.PDF_PERM_PRINT | fitz.PDF_PERM_PRINT_HQ),
    ("modify", "修改內容", fitz.PDF_PERM_MODIFY | fitz.PDF_PERM_ASSEMBLE),
    ("copy", "複製文字與圖片", fitz.PDF_PERM_COPY | fitz.PDF_PERM_ACCESSIBILITY),
    ("annotate", "加註解", fitz.PDF_PERM_ANNOTATE),
    ("form", "填寫表單", fitz.PDF_PERM_FORM),
]


def encrypt(data, password_in, user_pw, owner_pw, allow):
    """回傳加密後的 bytes。allow：允許的權限 key 集合。"""
    d = fitz.open(stream=data, filetype="pdf")
    if d.needs_pass:
        d.authenticate(password_in or "")
    perm = 0
    for key, _, bits in PERMS:
        if key in allow:
            perm |= bits
    return d.tobytes(garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_AES_256,
                     user_pw=user_pw or "", owner_pw=owner_pw or user_pw or "", permissions=perm)


def decrypt(data, password):
    d = fitz.open(stream=data, filetype="pdf")
    if d.needs_pass and not d.authenticate(password or ""):
        raise ValueError("密碼不正確")
    return d.tobytes(garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)


def describe(doc, session=None):
    """完整的安全狀況：[(項目, 值)]"""
    m = doc.metadata or {}
    rows = [("加密方式", m.get("encryption") or "沒有加密")]
    if m.get("encryption"):
        if session is not None:
            rows.append(("開啟方式", "擁有者密碼（完整權限）" if session.owner else "使用者密碼（受作者限制）"))
        p = doc.permissions
        for key, name, bits in PERMS:
            rows.append((name, "允許" if p & bits else "不允許"))
    return rows


def redact(page, rects, fill=(0, 0, 0)):
    """塗銷：框選範圍內的文字、圖片、圖形永久移除，蓋上黑色方塊。"""
    for r in rects:
        page.add_redact_annot(r, fill=fill, cross_out=False)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS, graphics=getattr(fitz, 'PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED', 2), text=fitz.PDF_REDACT_TEXT_REMOVE)


def sanitize(doc, metadata=True, javascript=True, attachments=True, comments=False, links=False, hidden=True, xml=True):
    """移除隱藏資訊（作者、建立程式、JavaScript、附件、隱藏文字、XMP…）。"""
    doc.scrub(attached_files=attachments, clean_pages=True, embedded_files=attachments, hidden_text=hidden,
              javascript=javascript, metadata=metadata, redactions=True, redact_images=0, remove_links=links,
              reset_fields=False, reset_responses=comments, thumbnails=True, xml_metadata=xml)


def compress(doc, max_dpi=150, quality=70):
    """壓縮圖片：超過 max_dpi 的降解析度、轉成 JPEG。回傳 (處理的圖片數)"""
    done = set()
    count = 0
    for i in range(doc.page_count):
        page = doc[i]
        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref")
            if not xref or xref in done:
                continue
            done.add(xref)
            try:
                bbox = fitz.Rect(info["bbox"])
                w, h = info["width"], info["height"]
                if bbox.width <= 0:
                    continue
                dpi = w / (bbox.width / 72)
                pix = fitz.Pixmap(doc, xref)
                if pix.alpha or pix.n - pix.alpha > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                    if pix.alpha:
                        continue
                im = Image.frombytes("RGB" if pix.n >= 3 else "L", (pix.width, pix.height), pix.samples)
                if dpi > max_dpi:
                    k = max_dpi / dpi
                    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=quality, optimize=True)
                old = len(doc.xref_stream_raw(xref) or b"")
                if len(buf.getvalue()) < old * 0.95:
                    page.replace_image(xref, stream=buf.getvalue())
                    count += 1
            except Exception:
                continue
    return count


def grayscale(data):
    """轉灰階：每一頁重新繪製成灰階影像（文字變成圖，適合列印存檔）。"""
    src = fitz.open(stream=data, filetype="pdf")
    out = fitz.open()
    for p in src:
        pix = p.get_pixmap(dpi=200, colorspace=fitz.csGRAY)
        np = out.new_page(width=p.rect.width, height=p.rect.height)
        np.insert_image(np.rect, pixmap=pix)
    return out.tobytes(garbage=3, deflate=True)
