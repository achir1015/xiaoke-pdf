"""匯出：圖片（PNG／JPG）、純文字、Word（.docx）；建立 PDF：圖片轉 PDF、文字轉 PDF、空白文件。"""
import io
import os
import zipfile
from xml.sax.saxutils import escape

import pymupdf as fitz

from .textops import Style, write


def images(doc, pages, folder, base, fmt="png", dpi=150):
    """每頁存成一張圖，回傳檔案清單。"""
    out = []
    for i in pages:
        pix = doc[i].get_pixmap(dpi=dpi, alpha=False)
        f = os.path.join(folder, "%s_%03d.%s" % (base, i + 1, fmt))
        if fmt == "jpg":
            pix.save(f, jpg_quality=90)
        else:
            pix.save(f)
        out.append(f)
    return out


def text(doc, pages=None):
    parts = []
    for i in (pages if pages is not None else range(doc.page_count)):
        parts.append("──── 第 %d 頁 ────\n" % (i + 1) + doc[i].get_text("text", sort=True))
    return "\n".join(parts)


def docx(doc, path, pages=None):
    """匯出成 Word：每個文字區塊一段，保留粗體、字級與分頁；圖片照原大小放進去。"""
    body = []
    media = []
    for n, i in enumerate(pages if pages is not None else range(doc.page_count)):
        page = doc[i]
        if n:
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        d = page.get_text("dict", sort=True)
        for b in d["blocks"]:
            if b["type"] == 1:
                try:
                    img = b["image"]
                    ext = b.get("ext", "png")
                    if ext not in ("png", "jpeg", "jpg"):
                        pix = fitz.Pixmap(img)
                        img, ext = pix.tobytes("png"), "png"
                    rid = "rIdImg%d" % (len(media) + 1)
                    name = "image%d.%s" % (len(media) + 1, "jpg" if ext in ("jpeg", "jpg") else "png")
                    media.append((rid, name, img))
                    w = int((b["bbox"][2] - b["bbox"][0]) * 12700)
                    h = int((b["bbox"][3] - b["bbox"][1]) * 12700)
                    body.append(_img_xml(rid, len(media), w, h))
                except Exception:
                    pass
                continue
            for ln in b["lines"]:
                runs = []
                for sp in ln["spans"]:
                    t = sp["text"]
                    if not t:
                        continue
                    bold = "<w:b/>" if sp["flags"] & 16 else ""
                    ital = "<w:i/>" if sp["flags"] & 2 else ""
                    sz = '<w:sz w:val="%d"/>' % max(2, round(sp["size"] * 2))
                    col = '<w:color w:val="%06X"/>' % sp["color"] if sp["color"] else ""
                    runs.append('<w:r><w:rPr><w:rFonts w:eastAsia="微軟正黑體"/>%s%s%s%s</w:rPr><w:t xml:space="preserve">%s</w:t></w:r>' % (bold, ital, col, sz, escape(t)))
                if runs:
                    body.append("<w:p>%s</w:p>" % "".join(runs))
    xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
           'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
           'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
           'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>%s'
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
           '</w:body></w:document>') % "".join(body)
    rels = ['<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/%s"/>' % (rid, name) for rid, name, _ in media]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
                   '<Default Extension="jpg" ContentType="image/jpeg"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % "".join(rels))
        z.writestr("word/document.xml", xml)
        for rid, name, data in media:
            z.writestr("word/media/" + name, data)


def _img_xml(rid, n, cx, cy):
    return ('<w:p><w:r><w:drawing><wp:inline><wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="圖片%d"/>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
            '<pic:nvPicPr><pic:cNvPr id="%d" name="圖片%d"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>') % (cx, cy, n, n, n, n, rid, cx, cy)


# ---------------------------------------------------------------- 建立 PDF

PAPER = {"A4 直式": (595, 842), "A4 橫式": (842, 595), "Letter": (612, 792), "A5": (420, 595), "A3": (842, 1191)}


def from_images(paths, paper=None, margin=0):
    """圖片轉 PDF：paper=None 時每頁和圖片一樣大，否則置中縮放到紙張大小。"""
    out = fitz.open()
    for p in paths:
        img = fitz.open(p)
        r = img[0].rect
        if paper:
            W, H = paper
            if (r.width > r.height) != (W > H):
                W, H = H, W
            page = out.new_page(width=W, height=H)
            k = min((W - 2 * margin) / r.width, (H - 2 * margin) / r.height)
            w, h = r.width * k, r.height * k
            page.insert_image(fitz.Rect((W - w) / 2, (H - h) / 2, (W + w) / 2, (H + h) / 2), filename=p)
        else:
            page = out.new_page(width=r.width, height=r.height)
            page.insert_image(page.rect, filename=p)
    return out.tobytes(garbage=3, deflate=True)


def from_text(text, size=12, paper=(595, 842), margin=56):
    out = fitz.open()
    st = Style(size=size)
    from .textops import font_for, wrap
    font, _, _ = font_for(text)
    lines = wrap(font, text, size, paper[0] - 2 * margin)
    per = int((paper[1] - 2 * margin) // st.lh())
    for s in range(0, max(1, len(lines)), max(1, per)):
        page = out.new_page(width=paper[0], height=paper[1])
        chunk = "\n".join(lines[s:s + per])
        if chunk.strip():
            write(page, margin, margin + size, paper[0] - 2 * margin, chunk, st)
    return out.tobytes(garbage=3, deflate=True)
