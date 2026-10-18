"""表單：讀取欄位、填寫、清除、平面化、建立欄位。"""
import pymupdf as fitz

KINDS = {
    fitz.PDF_WIDGET_TYPE_TEXT: "文字", fitz.PDF_WIDGET_TYPE_CHECKBOX: "核取方塊", fitz.PDF_WIDGET_TYPE_RADIOBUTTON: "選項按鈕",
    fitz.PDF_WIDGET_TYPE_COMBOBOX: "下拉選單", fitz.PDF_WIDGET_TYPE_LISTBOX: "清單", fitz.PDF_WIDGET_TYPE_SIGNATURE: "簽名",
    fitz.PDF_WIDGET_TYPE_BUTTON: "按鈕",
}


def fields(doc):
    """[{page, xref, name, kind, type, value, options, rect}]"""
    out = []
    for i in range(doc.page_count):
        pg = doc[i]
        for w in pg.widgets() or []:
            out.append({"page": i, "xref": w.xref, "name": w.field_name or "", "type": w.field_type, "kind": KINDS.get(w.field_type, w.field_type_string),
                        "value": w.field_value, "options": list(w.choice_values or []), "rect": w.rect, "on": w.on_state() if w.field_type in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON) else None})
    return out


def widget(doc, page, xref):
    """回傳 (頁面, 欄位)。頁面物件要一直拿著，欄位才不會失效。"""
    pg = doc[page]
    for w in pg.widgets() or []:
        if w.xref == xref:
            return pg, w
    return pg, None


def _has_cjk(s):
    return any(ord(c) > 0x2e80 for c in str(s or ""))


def set_value(doc, page, xref, value):
    pg, w = widget(doc, page, xref)
    if w is None:
        return
    if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
        w.field_value = w.on_state() if value else "Off"
    elif w.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
        w.field_value = w.on_state() if value else "Off"
    else:
        w.field_value = value
        if _has_cjk(value):
            w.text_font = "china-t"
    w.update()


def clear(doc):
    for i in range(doc.page_count):
        pg = doc[i]
        for w in pg.widgets() or []:
            if w.field_type in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON):
                w.field_value = "Off"
            elif w.field_type in (fitz.PDF_WIDGET_TYPE_TEXT, fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
                w.field_value = ""
            else:
                continue
            w.update()


def flatten(doc):
    """平面化：把欄位（和註解）畫進頁面內容，之後不能再修改。"""
    doc.bake(annots=False, widgets=True)


def add_field(doc, page, rect, kind, name, options=None, value=""):
    w = fitz.Widget()
    w.field_type = kind
    w.field_name = name
    w.rect = fitz.Rect(rect)
    w.text_fontsize = 0 if kind == fitz.PDF_WIDGET_TYPE_TEXT else 11
    w.text_font = "china-t"
    w.border_color = (0.3, 0.3, 0.3)
    w.border_width = 1
    if kind in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
        w.choice_values = options or ["選項一", "選項二"]
        w.field_value = value or w.choice_values[0]
    elif kind == fitz.PDF_WIDGET_TYPE_CHECKBOX:
        w.field_value = False
    elif kind == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
        w.field_value = False
    else:
        w.field_value = value
    doc[page].add_widget(w)
    return w
