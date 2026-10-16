package com.achir.xiaokepdf;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;

import com.tom_roush.pdfbox.cos.COSArray;
import com.tom_roush.pdfbox.cos.COSBase;
import com.tom_roush.pdfbox.cos.COSDictionary;
import com.tom_roush.pdfbox.cos.COSName;
import com.tom_roush.pdfbox.multipdf.PDFMergerUtility;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDDocumentCatalog;
import com.tom_roush.pdfbox.pdmodel.PDDocumentInformation;
import com.tom_roush.pdfbox.pdmodel.PDDocumentNameDictionary;
import com.tom_roush.pdfbox.pdmodel.PDEmbeddedFilesNameTreeNode;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream;
import com.tom_roush.pdfbox.pdmodel.PDResources;
import com.tom_roush.pdfbox.pdmodel.common.PDNameTreeNode;
import com.tom_roush.pdfbox.pdmodel.common.PDPageLabelRange;
import com.tom_roush.pdfbox.pdmodel.common.PDPageLabels;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.common.filespecification.PDComplexFileSpecification;
import com.tom_roush.pdfbox.pdmodel.common.filespecification.PDEmbeddedFile;
import com.tom_roush.pdfbox.pdmodel.common.filespecification.PDFileSpecification;
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font;
import com.tom_roush.pdfbox.pdmodel.graphics.PDXObject;
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDColor;
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB;
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject;
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory;
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory;
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject;
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState;
import com.tom_roush.pdfbox.pdmodel.interactive.action.PDActionURI;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationFileAttachment;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationLine;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationLink;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationMarkup;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationRubberStamp;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationSquareCircle;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationText;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationTextMarkup;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationUnknown;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationWidget;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceCharacteristicsDictionary;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceDictionary;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceStream;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDBorderStyleDictionary;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageFitDestination;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDAcroForm;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDCheckBox;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDChoice;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDComboBox;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDField;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDListBox;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDPushButton;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDRadioButton;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTerminalField;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTextField;
import com.tom_roush.pdfbox.util.Matrix;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** 所有用 PDFBox 改文件的動作。座標參數都是「顯示座標」（pt，左上原點），由 Doc 換算成 PDF 座標。 */
public final class Ops {
    private Ops() {}

    public static String author = "小柯";

    // ================================================================ 頁面

    public static List<PDPage> pages(PDDocument d) {
        List<PDPage> l = new ArrayList<>();
        for (PDPage p : d.getPages()) l.add(p);
        return l;
    }

    /** 把從父節點繼承的屬性寫進頁面本身，頁面重新排列後才不會遺失。 */
    static void materialize(PDPage p) {
        COSDictionary c = p.getCOSObject();
        if (!c.containsKey(COSName.RESOURCES)) { PDResources r = p.getResources(); if (r != null) c.setItem(COSName.RESOURCES, r); }
        if (!c.containsKey(COSName.MEDIA_BOX)) c.setItem(COSName.MEDIA_BOX, p.getMediaBox());
        if (!c.containsKey(COSName.CROP_BOX)) {
            COSBase cb = com.tom_roush.pdfbox.pdmodel.PDPageTree.getInheritableAttribute(c, COSName.CROP_BOX);
            if (cb != null) c.setItem(COSName.CROP_BOX, cb);
        }
        if (!c.containsKey(COSName.ROTATE)) c.setInt(COSName.ROTATE, p.getRotation());
    }

    /** 用新的順序重建頁面樹（扁平）。 */
    public static void reorder(PDDocument d, List<PDPage> order) {
        if (order.isEmpty()) throw new IllegalStateException("文件至少要有一頁");
        for (PDPage p : order) materialize(p);
        COSDictionary root = d.getPages().getCOSObject();
        COSArray kids = new COSArray();
        for (PDPage p : order) {
            kids.add(p.getCOSObject());
            p.getCOSObject().setItem(COSName.PARENT, root);
        }
        root.setItem(COSName.KIDS, kids);
        root.setInt(COSName.COUNT, order.size());
        for (COSName k : new COSName[]{COSName.RESOURCES, COSName.MEDIA_BOX, COSName.CROP_BOX, COSName.ROTATE}) root.removeItem(k);
    }

    public static void rotate(PDDocument d, int[] sel, int deg) {
        for (int i : sel) {
            PDPage p = d.getPage(i);
            p.setRotation(((p.getRotation() + deg) % 360 + 360) % 360);
        }
    }

    public static void delete(PDDocument d, int[] sel) {
        List<PDPage> all = pages(d);
        Set<Integer> s = new HashSet<>(U.list(sel));
        List<PDPage> keep = new ArrayList<>();
        for (int i = 0; i < all.size(); i++) if (!s.contains(i)) keep.add(all.get(i));
        if (keep.isEmpty()) throw new IllegalStateException("不能刪除全部頁面");
        reorder(d, keep);
    }

    public static void insertBlank(PDDocument d, int at, PDRectangle size, int count) {
        List<PDPage> all = pages(d);
        at = Math.max(0, Math.min(at, all.size()));
        for (int k = 0; k < count; k++) all.add(at + k, new PDPage(new PDRectangle(size.getWidth(), size.getHeight())));
        reorder(d, all);
    }

    /** 從另一個檔案插入頁面（pick 為 null 表示全部）。src 要等 d 存檔後才能關，所以放進 later。 */
    public static int insertFile(PDDocument d, int at, File f, String pwd, int[] pick, List<java.io.Closeable> later) throws IOException {
        PDDocument src = PDDocument.load(f, pwd == null ? "" : pwd, Doc.mem());
        later.add(src);
        src.setAllSecurityToBeRemoved(true);
        if (pick != null) {
            Set<Integer> keep = new HashSet<>(U.list(pick));
            for (int i = src.getNumberOfPages() - 1; i >= 0; i--) if (!keep.contains(i)) src.removePage(i);
        }
        int before = d.getNumberOfPages();
        new PDFMergerUtility().appendDocument(d, src);
        List<PDPage> all = pages(d);
        List<PDPage> added = new ArrayList<>(all.subList(before, all.size()));
        List<PDPage> order = new ArrayList<>(all.subList(0, before));
        at = Math.max(0, Math.min(at, before));
        order.addAll(at, added);
        reorder(d, order);
        return added.size();
    }

    /** 把選取的頁面往前（-1）或往後（+1）移一格，回傳新的選取位置。 */
    public static int[] move(PDDocument d, int[] sel, int delta) {
        List<PDPage> all = pages(d);
        int n = all.size();
        boolean[] s = new boolean[n];
        for (int i : sel) s[i] = true;
        if (delta < 0) {
            for (int i = 1; i < n; i++) if (s[i] && !s[i - 1]) { swap(all, s, i, i - 1); }
        } else {
            for (int i = n - 2; i >= 0; i--) if (s[i] && !s[i + 1]) { swap(all, s, i, i + 1); }
        }
        reorder(d, all);
        List<Integer> r = new ArrayList<>();
        for (int i = 0; i < n; i++) if (s[i]) r.add(i);
        int[] out = new int[r.size()];
        for (int i = 0; i < out.length; i++) out[i] = r.get(i);
        return out;
    }

    private static void swap(List<PDPage> l, boolean[] s, int a, int b) {
        PDPage t = l.get(a); l.set(a, l.get(b)); l.set(b, t);
        boolean x = s[a]; s[a] = s[b]; s[b] = x;
    }

    /** 把頁面移到指定位置（拖放用）。 */
    public static void moveTo(PDDocument d, int[] sel, int at) {
        List<PDPage> all = pages(d);
        List<PDPage> picked = new ArrayList<>();
        int shift = 0;
        for (int i : sel) { picked.add(all.get(i)); if (i < at) shift++; }
        all.removeAll(picked);
        at = Math.max(0, Math.min(at - shift, all.size()));
        all.addAll(at, picked);
        reorder(d, all);
    }

    public static void reverse(PDDocument d, int[] sel) {
        List<PDPage> all = pages(d);
        List<PDPage> picked = new ArrayList<>();
        for (int i : sel) picked.add(all.get(i));
        for (int k = 0; k < sel.length; k++) all.set(sel[k], picked.get(sel.length - 1 - k));
        reorder(d, all);
    }

    /** 依顯示方向的邊界（pt）裁切頁面。 */
    public static void crop(PDDocument d, Doc doc, int[] sel, float l, float t, float r, float b) {
        for (int i : sel) {
            RectF disp = new RectF(l, t, doc.dw(i) - r, doc.dh(i) - b);
            if (disp.width() < 20 || disp.height() < 20) throw new IllegalStateException("裁切範圍太小");
            d.getPage(i).setCropBox(doc.toUserRect(i, disp));
        }
    }

    public static void resize(PDDocument d, int[] sel, PDRectangle size) {
        for (int i : sel) {
            PDPage p = d.getPage(i);
            PDRectangle old = p.getCropBox();
            float sx = size.getWidth() / old.getWidth(), sy = size.getHeight() / old.getHeight();
            float s = Math.min(sx, sy);
            p.setMediaBox(new PDRectangle(old.getLowerLeftX(), old.getLowerLeftY(), size.getWidth() / s, size.getHeight() / s));
            p.setCropBox(p.getMediaBox());
            p.getCOSObject().setItem(COSName.getPDFName("UserUnit"), new com.tom_roush.pdfbox.cos.COSFloat(s));
        }
    }

    // ================================================================ 檔案層級

    public static class NeedPwd extends IOException {
        public final int index;
        NeedPwd(int i) { super("需要密碼"); index = i; }
    }

    /** 合併：每個檔案一個書籤，原本的書籤放在它底下。 */
    public static void merge(List<File> files, List<String> titles, String[] pwds, File out) throws IOException {
        PDDocument dest = new PDDocument(Doc.mem());
        List<PDDocument> srcs = new ArrayList<>();
        try {
            PDFMergerUtility mu = new PDFMergerUtility();
            for (int i = 0; i < files.size(); i++) {
                PDDocument s;
                try { s = PDDocument.load(files.get(i), pwds[i] == null ? "" : pwds[i], Doc.mem()); }
                catch (InvalidPasswordException e) { throw new NeedPwd(i); }
                srcs.add(s);
                s.setAllSecurityToBeRemoved(true);
                wrapOutline(s, titles.get(i));
                mu.appendDocument(dest, s);
            }
            dest.save(out);
        } finally {
            dest.close();
            for (PDDocument s : srcs) s.close();
        }
    }

    private static void wrapOutline(PDDocument s, String title) {
        if (s.getNumberOfPages() == 0) return;
        PDDocumentCatalog cat = s.getDocumentCatalog();
        PDDocumentOutline old = cat.getDocumentOutline();
        PDDocumentOutline no = new PDDocumentOutline();
        PDOutlineItem top = new PDOutlineItem();
        top.setTitle(title);
        top.setDestination(s.getPage(0));
        if (old != null) {
            List<PDOutlineItem> kids = new ArrayList<>();
            for (PDOutlineItem k : old.children()) kids.add(k);
            for (PDOutlineItem k : kids) {
                k.getCOSObject().removeItem(COSName.PREV);
                k.getCOSObject().removeItem(COSName.NEXT);
                k.getCOSObject().removeItem(COSName.PARENT);
                top.addLast(k);
            }
        }
        no.addLast(top);
        cat.setDocumentOutline(no);
    }

    /** 只留下 keep 這些頁（0 起算）另存新檔：連結、表單、圖層、附件都跟著走。 */
    public static void keepPages(File src, int[] keep, File out) throws IOException {
        try (PDDocument d = PDDocument.load(src, Doc.mem())) {
            Set<Integer> k = new HashSet<>(U.list(keep));
            for (int i = d.getNumberOfPages() - 1; i >= 0; i--) if (!k.contains(i)) d.removePage(i);
            if (d.getNumberOfPages() == 0) throw new IOException("沒有選到任何頁面");
            d.save(out);
        }
    }

    // ================================================================ 內容（文字、圖片）

    /** 顯示座標的矩形 → 方框座標（左下原點、向上）到 PDF 座標的轉換。off 為外觀串流的原點。 */
    static Matrix boxMatrix(Doc doc, int page, RectF r, float offX, float offY) {
        float[] o = doc.toUser(page, r.left, r.bottom);
        float[] ax = doc.toUser(page, r.left + 1, r.bottom);
        float[] ay = doc.toUser(page, r.left, r.bottom - 1);
        return new Matrix(ax[0] - o[0], ax[1] - o[1], ay[0] - o[0], ay[1] - o[1], o[0] - offX, o[1] - offY);
    }

    public static PDColor color(int argb) {
        return new PDColor(new float[]{Color.red(argb) / 255f, Color.green(argb) / 255f, Color.blue(argb) / 255f}, PDDeviceRGB.INSTANCE);
    }

    static PDImageXObject image(PDDocument d, Bitmap b) throws IOException {
        if (!b.hasAlpha()) return JPEGFactory.createFromImage(d, b, 0.9f);
        return LosslessFactory.createFromImage(d, b);
    }

    /** 在頁面內容上畫圖片（永久）。 */
    public static void addImage(PDDocument d, Doc doc, int page, RectF r, Bitmap b, float opacity) throws IOException {
        PDPage p = d.getPage(page);
        PDImageXObject img = image(d, b);
        try (PDPageContentStream cs = new PDPageContentStream(d, p, PDPageContentStream.AppendMode.APPEND, true, true)) {
            if (opacity < 1) { PDExtendedGraphicsState gs = new PDExtendedGraphicsState(); gs.setNonStrokingAlphaConstant(opacity); cs.setGraphicsStateParameters(gs); }
            cs.transform(boxMatrix(doc, page, r, 0, 0));
            cs.drawImage(img, 0, 0, r.width(), r.height());
        }
    }

    /** 在頁面內容上寫字（舊介面：只有大小與顏色）。 */
    public static void addText(PDDocument d, Doc doc, int page, RectF r, String text, float size, int color) throws IOException {
        TextStyle st = new TextStyle();
        st.size = size; st.color = color;
        addText(d, doc, page, r, text, st);
    }

    /** 在頁面內容上寫字：字型、大小、顏色、背景、粗體、底線、刪除線。能用字型就寫向量文字（可搜尋），否則畫成圖。 */
    public static void addText(PDDocument d, Doc doc, int page, RectF r, String text, TextStyle st) throws IOException {
        PDFont f = st.pdfFont(d, text);
        if (f == null) {
            Bitmap b = st.bitmap(text, r.width() > 20 ? Math.max(r.width(), 40) : 0);
            addImage(d, doc, page, new RectF(r.left, r.top, r.left + b.getWidth() / Draw.PX, r.top + b.getHeight() / Draw.PX), b, 1);
            return;
        }
        float size = st.size;
        List<String> lines = wrap(f, text, size, r.width() > 20 ? Math.max(r.width(), size * 2) : 0);
        float lh = size * 1.25f, H = lines.size() * lh;
        float maxW = 0;
        float[] widths = new float[lines.size()];
        for (int i = 0; i < lines.size(); i++) { widths[i] = f.getStringWidth(lines.get(i)) / 1000 * size; maxW = Math.max(maxW, widths[i]); }
        RectF box = new RectF(r.left, r.top, r.left + maxW + 2, r.top + H);
        PDPage p = d.getPage(page);
        boolean fakeBold = st.bold && !TextStyle.nativeBold(f);
        try (PDPageContentStream cs = new PDPageContentStream(d, p, PDPageContentStream.AppendMode.APPEND, true, true)) {
            cs.transform(boxMatrix(doc, page, box, 0, 0));
            if (st.bg != 0) {
                cs.setNonStrokingColor(color(st.bg));
                cs.addRect(-1, -size * 0.05f, maxW + 4, H + size * 0.05f);
                cs.fill();
            }
            cs.setNonStrokingColor(color(st.color));
            cs.setStrokingColor(color(st.color));
            cs.beginText();
            cs.setFont(f, size);
            if (fakeBold) {
                cs.setRenderingMode(com.tom_roush.pdfbox.pdmodel.graphics.state.RenderingMode.FILL_STROKE);
                cs.setLineWidth(size * 0.035f);
            }
            cs.newLineAtOffset(1, H - size);
            for (int i = 0; i < lines.size(); i++) {
                if (i > 0) cs.newLineAtOffset(0, -lh);
                cs.showText(lines.get(i));
            }
            cs.endText();
            if (st.underline || st.strike) {
                cs.setLineWidth(Math.max(0.5f, size * 0.06f));
                for (int i = 0; i < lines.size(); i++) {
                    float base = H - size - i * lh;
                    if (st.underline) { cs.moveTo(1, base - size * 0.12f); cs.lineTo(1 + widths[i], base - size * 0.12f); cs.stroke(); }
                    if (st.strike) { cs.moveTo(1, base + size * 0.3f); cs.lineTo(1 + widths[i], base + size * 0.3f); cs.stroke(); }
                }
            }
        }
    }

    /**
     * 修改頁面上既有的文字：用背景色蓋掉原本的字，再在同一位置寫上新字。
     * area 是原文字的範圍（顯示座標），bg 是取樣到的背景色。
     */
    public static void replaceText(PDDocument d, Doc doc, int page, RectF area, String text, TextStyle st, int bg) throws IOException {
        float size = st.size;
        RectF cover = new RectF(area);
        cover.inset(-1.2f, -1.2f);
        PDPage p = d.getPage(page);
        try (PDPageContentStream cs = new PDPageContentStream(d, p, PDPageContentStream.AppendMode.APPEND, true, true)) {
            cs.transform(boxMatrix(doc, page, cover, 0, 0));
            cs.setNonStrokingColor(color(bg));
            cs.addRect(0, 0, cover.width(), cover.height());
            cs.fill();
        }
        if (text.isEmpty()) return;
        // 新文字寬度可能不同：寬度至少保留原範圍，必要時往右延伸
        PDFont f = st.pdfFont(d, text);
        float w = area.width();
        if (f != null) {
            float need = 0;
            for (String line : text.split("\n")) need = Math.max(need, f.getStringWidth(line) / 1000 * size);
            w = Math.max(w, need + 1);
        } else {
            // 畫成圖時：量出自然寬度，不要擠在原本的寬度裡換行
            Bitmap probe = st.bitmap(text, 0);
            w = Math.max(w, probe.getWidth() / Draw.PX + 1);
            probe.recycle();
        }
        w = Math.min(w, Math.max(area.width(), doc.dw(page) - area.left - 6));
        float top = area.bottom - size * 1.1f;
        addText(d, doc, page, new RectF(area.left, Math.max(0, top), area.left + w, area.bottom), text, st);
    }

    static List<String> wrap(PDFont f, String text, float size, float maxW) throws IOException {
        List<String> out = new ArrayList<>();
        for (String para : text.split("\n", -1)) {
            StringBuilder cur = new StringBuilder();
            for (int i = 0; i < para.length(); i++) {
                char ch = para.charAt(i);
                cur.append(ch);
                if (maxW > 0 && f.getStringWidth(cur.toString()) / 1000 * size > maxW && cur.length() > 1) {
                    // 英文盡量在空白處斷行
                    int sp = cur.lastIndexOf(" ");
                    if (sp > 0 && !TextData.isCjk(ch)) { out.add(cur.substring(0, sp)); cur.delete(0, sp + 1); }
                    else { out.add(cur.substring(0, cur.length() - 1)); cur.delete(0, cur.length() - 1); }
                }
            }
            out.add(cur.toString());
        }
        return out;
    }

    /** 頁碼 / 頁首頁尾 / 浮水印。pos：0 左上 1 中上 2 右上 3 左下 4 中下 5 右下 6 中央斜放。 */
    public static void stampText(PDDocument d, Doc doc, int[] sel, String fmt, int pos, float size, int color, float opacity) throws IOException {
        int total = d.getNumberOfPages();
        PDFont font = null;
        boolean fontChecked = false;
        for (int i : sel) {
            String lbl = doc.labels != null && i < doc.labels.length && doc.labels[i] != null ? doc.labels[i] : String.valueOf(i + 1);
            String t = fmt.replace("{n}", String.valueOf(i + 1)).replace("{N}", String.valueOf(total))
                    .replace("{label}", lbl).replace("{date}", Draw.today()).replace("{file}", U.base(doc.name));
            if (!fontChecked || !Draw.canEncode(font, t)) { font = Draw.fontFor(d, t); fontChecked = true; }
            float dw = doc.dw(i), dh = doc.dh(i), m = 28;
            Bitmap img = null;
            float tw, th;
            if (font != null) { tw = font.getStringWidth(t) / 1000 * size; th = size; }
            else { img = Draw.text(t, size, color, 0, pos == 6); tw = img.getWidth() / Draw.PX; th = img.getHeight() / Draw.PX; }
            PDPage p = d.getPage(i);
            try (PDPageContentStream cs = new PDPageContentStream(d, p, PDPageContentStream.AppendMode.APPEND, true, true)) {
                cs.beginMarkedContent(COSName.getPDFName("Artifact"),
                        com.tom_roush.pdfbox.pdmodel.documentinterchange.markedcontent.PDPropertyList.create(Watermark.artifact(pos == 6)));
                if (opacity < 1) { PDExtendedGraphicsState gs = new PDExtendedGraphicsState(); gs.setNonStrokingAlphaConstant(opacity); cs.setGraphicsStateParameters(gs); }
                cs.transform(boxMatrix(doc, i, new RectF(0, 0, dw, dh), 0, 0));
                float x, y;
                if (pos == 6) {
                    cs.transform(Matrix.getRotateInstance(Math.atan2(dh, dw), dw / 2, dh / 2));
                    x = -tw / 2; y = -th / 3;
                } else {
                    x = pos % 3 == 0 ? m : pos % 3 == 1 ? (dw - tw) / 2 : dw - m - tw;
                    y = pos < 3 ? dh - m - th : m;
                }
                if (img != null) {
                    cs.drawImage(image(d, img), x, y, tw, th);
                } else {
                    cs.setNonStrokingColor(color(color));
                    cs.beginText();
                    cs.setFont(font, size);
                    cs.newLineAtOffset(x, y + size * 0.2f);
                    cs.showText(t);
                    cs.endText();
                }
                cs.endMarkedContent();
            }
        }
    }

    // ================================================================ 註解

    static Calendar now() { return Calendar.getInstance(); }

    static void common(PDAnnotationMarkup a, int color, String contents) {
        a.setColor(color(color));
        a.setTitlePopup(author);
        a.setCreationDate(now());
        a.setModifiedDate(now());
        a.setPrinted(true);
        if (contents != null) a.setContents(contents);
    }

    static void add(PDDocument d, int page, PDAnnotation a) throws IOException {
        PDPage p = d.getPage(page);
        a.setPage(p);
        p.getAnnotations().add(a);
    }

    static PDBorderStyleDictionary border(float w) {
        PDBorderStyleDictionary b = new PDBorderStyleDictionary();
        b.setWidth(w);
        return b;
    }

    public static void addNote(PDDocument d, Doc doc, int page, float x, float y, String text, int color) throws IOException {
        PDAnnotationText a = new PDAnnotationText();
        common(a, color, text);
        a.setName(PDAnnotationText.NAME_COMMENT);
        float[] u = doc.toUser(page, x, y);
        a.setRectangle(new PDRectangle(u[0] - 10, u[1] - 10, 20, 20));
        a.setNoRotate(true);
        a.setNoZoom(true);
        add(d, page, a);
        a.constructAppearances(d);
    }

    /** 螢光標示 / 底線 / 刪除線 / 波浪底線。sub：Highlight、Underline、StrikeOut、Squiggly。 */
    public static void addMarkup(PDDocument d, Doc doc, int page, List<RectF> rects, String sub, int color, String text, String contents) throws IOException {
        if (rects.isEmpty()) return;
        PDAnnotationTextMarkup a = new PDAnnotationTextMarkup(sub);
        common(a, color, contents);
        if (sub.equals(PDAnnotationTextMarkup.SUB_TYPE_HIGHLIGHT)) a.setConstantOpacity(0.45f);
        float[] q = new float[rects.size() * 8];
        float minX = Float.MAX_VALUE, minY = Float.MAX_VALUE, maxX = -Float.MAX_VALUE, maxY = -Float.MAX_VALUE;
        for (int k = 0; k < rects.size(); k++) {
            RectF r = rects.get(k);
            float[] ul = doc.toUser(page, r.left, r.top), ur = doc.toUser(page, r.right, r.top),
                    ll = doc.toUser(page, r.left, r.bottom), lr = doc.toUser(page, r.right, r.bottom);
            float[] v = {ul[0], ul[1], ur[0], ur[1], ll[0], ll[1], lr[0], lr[1]};
            System.arraycopy(v, 0, q, k * 8, 8);
            for (int j = 0; j < 8; j += 2) {
                minX = Math.min(minX, v[j]); maxX = Math.max(maxX, v[j]);
                minY = Math.min(minY, v[j + 1]); maxY = Math.max(maxY, v[j + 1]);
            }
        }
        a.setQuadPoints(q);
        a.setRectangle(new PDRectangle(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4));
        if (text != null) a.getCOSObject().setString(COSName.getPDFName("XiaoKeText"), text);
        add(d, page, a);
        a.constructAppearances(d);
    }

    public static void addShape(PDDocument d, Doc doc, int page, RectF r, boolean ellipse, int color, float width, String contents) throws IOException {
        PDAnnotationSquareCircle a = new PDAnnotationSquareCircle(ellipse ? PDAnnotationSquareCircle.SUB_TYPE_CIRCLE : PDAnnotationSquareCircle.SUB_TYPE_SQUARE);
        common(a, color, contents);
        a.setBorderStyle(border(width));
        PDRectangle u = doc.toUserRect(page, r);
        a.setRectangle(new PDRectangle(u.getLowerLeftX() - width, u.getLowerLeftY() - width, u.getWidth() + 2 * width, u.getHeight() + 2 * width));
        add(d, page, a);
        a.constructAppearances(d);
    }

    public static void addInk(PDDocument d, Doc doc, int page, List<List<float[]>> strokes, int color, float width) throws IOException {
        PDAnnotationMarkup a = new PDAnnotationMarkup();
        a.getCOSObject().setName(COSName.SUBTYPE, PDAnnotationMarkup.SUB_TYPE_INK);
        common(a, color, null);
        a.setBorderStyle(border(width));
        float[][] ink = new float[strokes.size()][];
        float minX = Float.MAX_VALUE, minY = Float.MAX_VALUE, maxX = -Float.MAX_VALUE, maxY = -Float.MAX_VALUE;
        for (int s = 0; s < strokes.size(); s++) {
            List<float[]> st = strokes.get(s);
            ink[s] = new float[st.size() * 2];
            for (int k = 0; k < st.size(); k++) {
                float[] u = doc.toUser(page, st.get(k)[0], st.get(k)[1]);
                ink[s][k * 2] = u[0]; ink[s][k * 2 + 1] = u[1];
                minX = Math.min(minX, u[0]); maxX = Math.max(maxX, u[0]);
                minY = Math.min(minY, u[1]); maxY = Math.max(maxY, u[1]);
            }
        }
        a.setInkList(ink);
        a.setRectangle(new PDRectangle(minX - width, minY - width, maxX - minX + 2 * width, maxY - minY + 2 * width));
        add(d, page, a);
        a.constructAppearances(d);
    }

    public static void addLine(PDDocument d, Doc doc, int page, float x1, float y1, float x2, float y2, boolean arrow, int color, float width, String caption) throws IOException {
        PDAnnotationLine a = new PDAnnotationLine();
        common(a, color, caption);
        float[] p = doc.toUser(page, x1, y1), q = doc.toUser(page, x2, y2);
        a.setLine(new float[]{p[0], p[1], q[0], q[1]});
        a.setBorderStyle(border(width));
        if (arrow) a.setEndPointEndingStyle(PDAnnotationLine.LE_OPEN_ARROW);
        if (caption != null) { a.setCaption(true); a.setInteriorColor(color(color)); }
        float pad = 12 + width;
        a.setRectangle(new PDRectangle(Math.min(p[0], q[0]) - pad, Math.min(p[1], q[1]) - pad,
                Math.abs(p[0] - q[0]) + 2 * pad, Math.abs(p[1] - q[1]) + 2 * pad));
        add(d, page, a);
        a.constructAppearances(d);
    }

    /** 用一張圖當註解的外觀（自動處理頁面旋轉）。 */
    static void imageAppearance(PDDocument d, PDAnnotation a, Doc doc, int page, RectF r, Bitmap b) throws IOException {
        PDRectangle u = doc.toUserRect(page, r);
        a.setRectangle(u);
        PDAppearanceStream as = new PDAppearanceStream(d);
        as.setBBox(new PDRectangle(u.getWidth(), u.getHeight()));
        as.setResources(new PDResources());
        PDImageXObject img = image(d, b);
        try (PDPageContentStream cs = new PDPageContentStream(d, as)) {
            cs.transform(boxMatrix(doc, page, r, u.getLowerLeftX(), u.getLowerLeftY()));
            cs.drawImage(img, 0, 0, r.width(), r.height());
        }
        PDAppearanceDictionary ap = new PDAppearanceDictionary();
        ap.setNormalAppearance(as);
        a.setAppearance(ap);
    }

    /** 文字方塊（FreeText）。 */
    public static void addFreeText(PDDocument d, Doc doc, int page, RectF r, String text, float size, int color) throws IOException {
        TextStyle st = new TextStyle();
        st.size = size; st.color = color;
        addFreeText(d, doc, page, r, text, st);
    }

    public static void addFreeText(PDDocument d, Doc doc, int page, RectF r, String text, TextStyle st) throws IOException {
        float size = st.size;
        int color = st.color;
        PDAnnotationMarkup a = new PDAnnotationMarkup();
        a.getCOSObject().setName(COSName.SUBTYPE, PDAnnotationMarkup.SUB_TYPE_FREETEXT);
        common(a, color, text);
        a.setDefaultAppearance(String.format(Locale.US, "/Helv %.1f Tf %.3f %.3f %.3f rg", size,
                Color.red(color) / 255f, Color.green(color) / 255f, Color.blue(color) / 255f));
        a.setBorderStyle(border(0));
        Bitmap b = st.bitmap(text, r.width());
        RectF rr = new RectF(r.left, r.top, r.left + Math.max(r.width(), b.getWidth() / Draw.PX), r.top + Math.max(r.height(), b.getHeight() / Draw.PX));
        Bitmap full = Bitmap.createBitmap(Math.round(rr.width() * Draw.PX), Math.round(rr.height() * Draw.PX), Bitmap.Config.ARGB_8888);
        new Canvas(full).drawBitmap(b, 0, 0, null);
        add(d, page, a);
        imageAppearance(d, a, doc, page, rr, full);
    }

    /** 印章 / 簽名 / 圖片註解（可在註解面板刪除）。 */
    public static void addStamp(PDDocument d, Doc doc, int page, RectF r, Bitmap b, String name, String contents) throws IOException {
        PDAnnotationRubberStamp a = new PDAnnotationRubberStamp();
        common(a, Color.RED, contents);
        a.setName(name);
        add(d, page, a);
        imageAppearance(d, a, doc, page, r, b);
    }

    public static void addLink(PDDocument d, Doc doc, int page, RectF r, String uri, int destPage) throws IOException {
        PDAnnotationLink l = new PDAnnotationLink();
        l.setRectangle(doc.toUserRect(page, r));
        l.setBorderStyle(border(0));
        if (uri != null) {
            PDActionURI a = new PDActionURI();
            a.setURI(uri);
            l.setAction(a);
        } else {
            PDPageFitDestination dest = new PDPageFitDestination();
            dest.setPage(d.getPage(destPage));
            l.setDestination(dest);
        }
        add(d, page, l);
    }

    /** 塗銷標記（Redact），套用前只是標記。 */
    public static void addRedact(PDDocument d, Doc doc, int page, RectF r) throws IOException {
        COSDictionary c = new COSDictionary();
        c.setItem(COSName.TYPE, COSName.ANNOT);
        c.setName(COSName.SUBTYPE, "Redact");
        PDAnnotationUnknown a = new PDAnnotationUnknown(c);
        a.setColor(color(Color.RED));
        a.setRectangle(doc.toUserRect(page, r));
        PDRectangle u = a.getRectangle();
        PDAppearanceStream as = new PDAppearanceStream(d);
        as.setBBox(new PDRectangle(u.getWidth(), u.getHeight()));
        as.setResources(new PDResources());
        try (PDPageContentStream cs = new PDPageContentStream(d, as)) {
            cs.setStrokingColor(0.9f, 0.1f, 0.1f);
            cs.setLineWidth(1.5f);
            cs.setLineDashPattern(new float[]{4, 2}, 0);
            cs.addRect(0.75f, 0.75f, u.getWidth() - 1.5f, u.getHeight() - 1.5f);
            cs.stroke();
        }
        PDAppearanceDictionary ap = new PDAppearanceDictionary();
        ap.setNormalAppearance(as);
        a.setAppearance(ap);
        c.setString(COSName.T, author);
        add(d, page, a);
    }

    // ---------------- 註解清單

    public static class Cm {
        public int page, index, color;
        public String sub, author, contents, date, state, text;
        public RectF r;
        public COSDictionary cos;
        public final List<Cm> replies = new ArrayList<>();
        public Cm parent;
    }

    static final Set<String> NOT_COMMENT = new HashSet<>(Arrays.asList("Link", "Widget", "Popup"));

    public static List<Cm> comments(PDDocument d, Doc doc) throws IOException {
        List<Cm> all = new ArrayList<>();
        Map<COSDictionary, Cm> by = new IdentityHashMap<>();
        int pi = 0;
        for (PDPage p : d.getPages()) {
            List<PDAnnotation> al = p.getAnnotations();
            for (int k = 0; k < al.size(); k++) {
                PDAnnotation a = al.get(k);
                String sub = a.getSubtype();
                if (sub == null || NOT_COMMENT.contains(sub)) continue;
                Cm c = new Cm();
                c.page = pi; c.index = k; c.sub = sub; c.cos = a.getCOSObject();
                c.contents = a.getContents() == null ? "" : a.getContents();
                c.text = c.cos.getString(COSName.getPDFName("XiaoKeText"));
                c.author = c.cos.getString(COSName.T);
                if (c.author == null) c.author = "";
                String dt = c.cos.getString(COSName.M);
                if (dt == null) dt = c.cos.getString(COSName.CREATION_DATE);
                c.date = pdfDate(dt);
                PDColor col = a.getColor();
                c.color = Color.GRAY;
                try { if (col != null) { float[] v = col.getComponents(); if (v.length >= 3) c.color = Color.rgb((int) (v[0] * 255), (int) (v[1] * 255), (int) (v[2] * 255)); } } catch (Exception ignored) {}
                PDRectangle r = a.getRectangle();
                if (r != null) c.r = doc.toDisplayRect(pi, r.getLowerLeftX(), r.getLowerLeftY(), r.getUpperRightX(), r.getUpperRightY());
                by.put(c.cos, c);
                all.add(c);
            }
            pi++;
        }
        List<Cm> top = new ArrayList<>();
        for (Cm c : all) {
            COSBase irt = c.cos.getDictionaryObject(COSName.getPDFName("IRT"));
            Cm par = irt instanceof COSDictionary ? by.get(irt) : null;
            if (par != null) {
                String model = c.cos.getString(COSName.getPDFName("StateModel"));
                if (model != null) { par.state = c.cos.getString(COSName.getPDFName("State")); continue; }
                c.parent = par;
                par.replies.add(c);
            } else top.add(c);
        }
        return top;
    }

    static String pdfDate(String s) {
        if (s == null) return "";
        if (s.startsWith("D:")) s = s.substring(2);
        if (s.length() >= 12) return s.substring(0, 4) + "-" + s.substring(4, 6) + "-" + s.substring(6, 8) + " " + s.substring(8, 10) + ":" + s.substring(10, 12);
        if (s.length() >= 8) return s.substring(0, 4) + "-" + s.substring(4, 6) + "-" + s.substring(6, 8);
        return s;
    }

    static PDAnnotation annot(PDDocument d, int page, int index) throws IOException {
        List<PDAnnotation> al = d.getPage(page).getAnnotations();
        if (index < 0 || index >= al.size()) throw new IOException("找不到這個註解");
        return al.get(index);
    }

    public static void deleteAnnot(PDDocument d, int page, int index) throws IOException {
        PDPage p = d.getPage(page);
        List<PDAnnotation> al = p.getAnnotations();
        PDAnnotation a = al.get(index);
        COSDictionary c = a.getCOSObject();
        COSBase popup = c.getDictionaryObject(COSName.getPDFName("Popup"));
        List<PDAnnotation> keep = new ArrayList<>();
        for (PDAnnotation x : al) {
            if (x.getCOSObject() == c || x.getCOSObject() == popup) continue;
            if (x.getCOSObject().getDictionaryObject(COSName.getPDFName("IRT")) == c) continue;
            keep.add(x);
        }
        p.setAnnotations(keep);
    }

    public static void setContents(PDDocument d, int page, int index, String s) throws IOException {
        PDAnnotation a = annot(d, page, index);
        a.setContents(s);
        a.setModifiedDate(now());
    }

    public static void reply(PDDocument d, Doc doc, int page, int index, String s) throws IOException {
        PDAnnotation par = annot(d, page, index);
        PDAnnotationText a = new PDAnnotationText();
        common(a, Color.GRAY, s);
        a.setInReplyTo(par);
        a.setReplyType(PDAnnotationMarkup.RT_REPLY);
        a.setRectangle(par.getRectangle());
        a.setNoView(true);
        a.setPrinted(false);
        add(d, page, a);
    }

    /** 審閱狀態：Accepted、Rejected、Cancelled、Completed、None。 */
    public static void setState(PDDocument d, int page, int index, String state) throws IOException {
        PDAnnotation par = annot(d, page, index);
        PDAnnotationText a = new PDAnnotationText();
        common(a, Color.GRAY, author + " 將狀態設為 " + state);
        a.setInReplyTo(par);
        a.setStateModel("Review");
        a.setState(state);
        a.setRectangle(par.getRectangle());
        a.setNoView(true);
        a.setPrinted(false);
        // 移除舊的狀態
        List<PDAnnotation> al = d.getPage(page).getAnnotations();
        List<PDAnnotation> keep = new ArrayList<>();
        for (PDAnnotation x : al) {
            if (x.getCOSObject().getDictionaryObject(COSName.getPDFName("IRT")) == par.getCOSObject()
                    && x.getCOSObject().getString(COSName.getPDFName("StateModel")) != null) continue;
            keep.add(x);
        }
        d.getPage(page).setAnnotations(keep);
        add(d, page, a);
    }

    /** 改顏色 / 不透明度 / 線寬，並重新產生外觀。 */
    public static void restyle(PDDocument d, int page, int index, Integer color, Float opacity, Float width) throws IOException {
        PDAnnotation a = annot(d, page, index);
        if (color != null) a.setColor(color(color));
        if (a instanceof PDAnnotationMarkup) {
            PDAnnotationMarkup m = (PDAnnotationMarkup) a;
            if (opacity != null) m.setConstantOpacity(opacity);
            if (width != null) m.setBorderStyle(border(width));
        }
        a.setModifiedDate(now());
        String sub = a.getSubtype();
        if (!"FreeText".equals(sub) && !"Stamp".equals(sub) && !"Redact".equals(sub)) {
            a.setAppearance(null);
            a.constructAppearances(d);
        } else if (opacity != null) {
            a.getCOSObject().setFloat(COSName.CA, opacity);
        }
    }

    // ================================================================ 表單

    public static class Field {
        public String name, type, value = "", on;
        public List<String> options = new ArrayList<>(), exports = new ArrayList<>();
        public int page = -1;
        public RectF r;
        public boolean readOnly, multi, required;
    }

    public static PDAcroForm acro(PDDocument d, boolean create) {
        PDDocumentCatalog cat = d.getDocumentCatalog();
        PDAcroForm af = cat.getAcroForm();
        if (af == null && create) {
            af = new PDAcroForm(d);
            cat.setAcroForm(af);
        }
        if (af != null && create) {
            PDResources dr = af.getDefaultResources();
            if (dr == null) { dr = new PDResources(); af.setDefaultResources(dr); }
            if (dr.getCOSObject().getDictionaryObject(COSName.FONT) == null
                    || !((COSDictionary) dr.getCOSObject().getDictionaryObject(COSName.FONT)).containsKey(COSName.getPDFName("Helv")))
                dr.put(COSName.getPDFName("Helv"), PDType1Font.HELVETICA);
            if (af.getDefaultAppearance() == null || af.getDefaultAppearance().isEmpty()) af.setDefaultAppearance("/Helv 0 Tf 0 g");
        }
        return af;
    }

    static int pageOf(PDDocument d, PDAnnotationWidget w) {
        PDPage p = w.getPage();
        if (p != null) { int i = d.getPages().indexOf(p); if (i >= 0) return i; }
        int i = 0;
        for (PDPage pg : d.getPages()) {
            try { for (PDAnnotation a : pg.getAnnotations()) if (a.getCOSObject() == w.getCOSObject()) return i; } catch (IOException ignored) {}
            i++;
        }
        return -1;
    }

    public static List<Field> fields(PDDocument d, Doc doc) {
        List<Field> out = new ArrayList<>();
        PDAcroForm af = acro(d, false);
        if (af == null) return out;
        for (PDField f : af.getFieldTree()) {
            if (!(f instanceof PDTerminalField)) continue;
            Field x = new Field();
            x.name = f.getFullyQualifiedName();
            x.readOnly = f.isReadOnly();
            x.required = f.isRequired();
            if (f instanceof PDCheckBox) { x.type = "check"; x.value = ((PDCheckBox) f).isChecked() ? "是" : "否"; x.on = ((PDCheckBox) f).getOnValue(); }
            else if (f instanceof PDRadioButton) {
                x.type = "radio";
                x.value = f.getValueAsString();
                try { x.options.addAll(((PDRadioButton) f).getOnValues()); } catch (Exception ignored) {}
            }
            else if (f instanceof PDPushButton) { x.type = "button"; }
            else if (f instanceof PDSignatureField) { x.type = "sign"; x.value = ((PDSignatureField) f).getSignature() != null ? "已簽署" : "未簽署"; }
            else if (f instanceof PDChoice) {
                PDChoice c = (PDChoice) f;
                x.type = f instanceof PDComboBox ? "combo" : "list";
                x.multi = c.isMultiSelect();
                x.options.addAll(c.getOptionsDisplayValues());
                x.exports.addAll(c.getOptionsExportValues());
                x.value = String.join(", ", c.getValue());
            } else if (f instanceof PDTextField) { x.type = "text"; x.value = f.getValueAsString(); x.multi = ((PDTextField) f).isMultiline(); }
            else { x.type = "other"; x.value = f.getValueAsString(); }
            List<PDAnnotationWidget> ws = f.getWidgets();
            if (!ws.isEmpty()) {
                PDAnnotationWidget w = ws.get(0);
                x.page = pageOf(d, w);
                PDRectangle r = w.getRectangle();
                if (x.page >= 0 && r != null) x.r = doc.toDisplayRect(x.page, r.getLowerLeftX(), r.getLowerLeftY(), r.getUpperRightX(), r.getUpperRightY());
            }
            out.add(x);
        }
        return out;
    }

    /** 填欄位。check 欄位 value 傳 "true"/"false"；多選清單用換行分隔。 */
    public static void setField(PDDocument d, Doc doc, String name, String value) throws IOException {
        PDAcroForm af = acro(d, true);
        PDField f = af.getField(name);
        if (f == null) throw new IOException("找不到欄位：" + name);
        if (f instanceof PDCheckBox) {
            PDCheckBox cb = (PDCheckBox) f;
            try { if ("true".equals(value)) cb.check(); else cb.unCheck(); }
            catch (Exception e) {
                String on = "Yes";
                try { on = cb.getOnValue(); } catch (Exception ignored) {}
                String v = "true".equals(value) ? on : "Off";
                cb.getCOSObject().setName(COSName.V, v);
                for (PDAnnotationWidget w : cb.getWidgets()) w.setAppearanceState(v);
            }
            return;
        }
        if (f instanceof PDChoice && ((PDChoice) f).isMultiSelect()) {
            ((PDChoice) f).setValue(Arrays.asList(value.split("\n")));
            return;
        }
        try {
            f.setValue(value);
        } catch (Exception e) {
            if (!(f instanceof PDTextField)) throw new IOException("無法設定欄位：" + e.getMessage());
            // 欄位字型沒有這些字（例如中文）→ 自己畫外觀
            f.getCOSObject().setString(COSName.V, value);
            for (PDAnnotationWidget w : f.getWidgets()) {
                int pg = pageOf(d, w);
                PDRectangle r = w.getRectangle();
                if (pg < 0 || r == null) continue;
                RectF disp = doc.toDisplayRect(pg, r.getLowerLeftX(), r.getLowerLeftY(), r.getUpperRightX(), r.getUpperRightY());
                boolean multi = ((PDTextField) f).isMultiline();
                float size = multi ? 10 : Math.max(6, Math.min(12, disp.height() * 0.62f));
                Bitmap t = Draw.text(value, size, Color.BLACK, multi ? disp.width() - 4 : 0, false);
                Bitmap full = Bitmap.createBitmap(Math.max(1, Math.round(disp.width() * Draw.PX)), Math.max(1, Math.round(disp.height() * Draw.PX)), Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(full);
                float top = multi ? 2 * Draw.PX : (full.getHeight() - t.getHeight()) / 2f;
                c.drawBitmap(t, 2 * Draw.PX, top, null);
                imageAppearance(d, w, doc, pg, disp, full);
            }
            af.setNeedAppearances(false);
        }
    }

    public static void clearForm(PDDocument d) {
        PDAcroForm af = acro(d, false);
        if (af == null) return;
        for (PDField f : af.getFieldTree()) {
            try {
                if (f instanceof PDCheckBox) ((PDCheckBox) f).unCheck();
                else if (f instanceof PDRadioButton) {
                    f.getCOSObject().setName(COSName.V, "Off");
                    for (PDAnnotationWidget w : f.getWidgets()) w.setAppearanceState("Off");
                } else if (f instanceof PDChoice) ((PDChoice) f).setValue(new ArrayList<>());
                else if (f instanceof PDTextField) f.setValue("");
            } catch (Exception e) {
                f.getCOSObject().removeItem(COSName.V);
            }
        }
    }

    public static void flatten(PDDocument d) throws IOException {
        PDAcroForm af = acro(d, false);
        if (af == null) throw new IOException("這份文件沒有表單");
        try { af.refreshAppearances(); } catch (Exception ignored) {}
        af.flatten();
    }

    /** 新增欄位：text、multiline、check、combo、sign。 */
    public static void addField(PDDocument d, Doc doc, int page, RectF disp, String type, String name, List<String> options) throws IOException {
        PDAcroForm af = acro(d, true);
        if (af.getField(name) != null) throw new IOException("已經有叫「" + name + "」的欄位");
        PDPage pg = d.getPage(page);
        PDRectangle r = doc.toUserRect(page, disp);
        PDTerminalField f;
        switch (type) {
            case "check": f = new PDCheckBox(af); break;
            case "combo": { PDComboBox c = new PDComboBox(af); c.setOptions(options); f = c; break; }
            case "list": { PDListBox c = new PDListBox(af); c.setOptions(options); f = c; break; }
            case "sign": f = new PDSignatureField(af); break;
            default: {
                PDTextField t = new PDTextField(af);
                if ("multiline".equals(type)) t.setMultiline(true);
                f = t;
            }
        }
        f.setPartialName(name);
        if (!(f instanceof PDSignatureField) && !(f instanceof PDCheckBox))
            f.getCOSObject().setString(COSName.DA, "/Helv 0 Tf 0 g");
        PDAnnotationWidget w = f.getWidgets().get(0);
        w.setRectangle(r);
        w.setPage(pg);
        w.setPrinted(true);
        PDAppearanceCharacteristicsDictionary mk = new PDAppearanceCharacteristicsDictionary(new COSDictionary());
        mk.setBorderColour(new PDColor(new float[]{0.45f, 0.5f, 0.6f}, PDDeviceRGB.INSTANCE));
        w.setAppearanceCharacteristics(mk);
        w.setBorderStyle(border(1));
        pg.getAnnotations().add(w);
        af.getFields().add(f);
        if (f instanceof PDCheckBox) checkAppearance(d, w, r.getWidth(), r.getHeight());
        else if (f instanceof PDSignatureField) {
            PDAppearanceStream as = new PDAppearanceStream(d);
            as.setBBox(new PDRectangle(r.getWidth(), r.getHeight()));
            as.setResources(new PDResources());
            try (PDPageContentStream cs = new PDPageContentStream(d, as)) {
                cs.setStrokingColor(0.45f, 0.5f, 0.6f);
                cs.addRect(0.5f, 0.5f, r.getWidth() - 1, r.getHeight() - 1);
                cs.stroke();
            }
            PDAppearanceDictionary ap = new PDAppearanceDictionary();
            ap.setNormalAppearance(as);
            w.setAppearance(ap);
        } else {
            try {
                if (f instanceof PDChoice && !options.isEmpty()) f.setValue(options.get(0));
                else f.setValue("");
            } catch (Exception ignored) {}
        }
    }

    private static void checkAppearance(PDDocument d, PDAnnotationWidget w, float wd, float ht) throws IOException {
        PDAppearanceStream on = new PDAppearanceStream(d), off = new PDAppearanceStream(d);
        for (PDAppearanceStream s : new PDAppearanceStream[]{on, off}) {
            s.setBBox(new PDRectangle(wd, ht));
            s.setResources(new PDResources());
            try (PDPageContentStream cs = new PDPageContentStream(d, s)) {
                cs.setStrokingColor(0.45f, 0.5f, 0.6f);
                cs.setLineWidth(1);
                cs.addRect(0.5f, 0.5f, wd - 1, ht - 1);
                cs.stroke();
                if (s == on) {
                    cs.setStrokingColor(0.1f, 0.1f, 0.1f);
                    cs.setLineWidth(Math.max(1.2f, Math.min(wd, ht) / 9));
                    cs.moveTo(wd * 0.2f, ht * 0.5f);
                    cs.lineTo(wd * 0.42f, ht * 0.25f);
                    cs.lineTo(wd * 0.8f, ht * 0.78f);
                    cs.stroke();
                }
            }
        }
        COSDictionary n = new COSDictionary();
        n.setItem(COSName.getPDFName("Yes"), on);
        n.setItem(COSName.Off, off);
        PDAppearanceDictionary ap = new PDAppearanceDictionary();
        ap.getCOSObject().setItem(COSName.N, n);
        w.setAppearance(ap);
        w.setAppearanceState("Off");
        w.getCOSObject().setName(COSName.V, "Off");
    }

    public static void deleteField(PDDocument d, String name) throws IOException {
        PDAcroForm af = acro(d, false);
        PDField f = af == null ? null : af.getField(name);
        if (f == null) throw new IOException("找不到欄位");
        Set<COSDictionary> ws = new HashSet<>();
        for (PDAnnotationWidget w : f.getWidgets()) ws.add(w.getCOSObject());
        for (PDPage p : d.getPages()) {
            List<PDAnnotation> keep = new ArrayList<>();
            for (PDAnnotation a : p.getAnnotations()) if (!ws.contains(a.getCOSObject())) keep.add(a);
            p.setAnnotations(keep);
        }
        if (f.getParent() == null) {
            List<PDField> fl = new ArrayList<>(af.getFields());
            fl.remove(f);
            af.setFields(fl);
        } else {
            COSArray kids = (COSArray) f.getParent().getCOSObject().getDictionaryObject(COSName.KIDS);
            if (kids != null) kids.remove(f.getCOSObject());
        }
    }

    // ================================================================ 書籤與頁面標籤

    public static class Bm {
        public String title; public int page = -1; public boolean open; public int[] path;
        public final List<Bm> kids = new ArrayList<>();
    }

    public static List<Bm> outline(PDDocument d) {
        PDDocumentOutline o = d.getDocumentCatalog().getDocumentOutline();
        List<Bm> l = new ArrayList<>();
        if (o != null) kids(d, o, new int[0], l, 0);
        return l;
    }

    private static void kids(PDDocument d, PDOutlineNode n, int[] path, List<Bm> out, int depth) {
        if (depth > 30) return;
        int k = 0;
        Set<COSDictionary> seen = new HashSet<>();
        for (PDOutlineItem it : n.children()) {
            if (!seen.add(it.getCOSObject())) break;
            Bm b = new Bm();
            b.title = it.getTitle() == null ? "（無標題）" : it.getTitle();
            try { PDPage p = it.findDestinationPage(d); if (p != null) b.page = d.getPages().indexOf(p); } catch (Exception ignored) {}
            b.open = it.isNodeOpen();
            b.path = Arrays.copyOf(path, path.length + 1);
            b.path[path.length] = k++;
            kids(d, it, b.path, b.kids, depth + 1);
            out.add(b);
        }
    }

    private static PDOutlineNode node(PDDocument d, int[] path, int len) {
        PDOutlineNode n = d.getDocumentCatalog().getDocumentOutline();
        for (int i = 0; i < len && n != null; i++) {
            int k = 0;
            PDOutlineNode next = null;
            for (PDOutlineItem it : n.children()) if (k++ == path[i]) { next = it; break; }
            n = next;
        }
        if (n == null) throw new IllegalStateException("找不到這個書籤");
        return n;
    }

    public static void addBookmark(PDDocument d, int[] parent, String title, int page) {
        PDDocumentCatalog cat = d.getDocumentCatalog();
        if (cat.getDocumentOutline() == null) cat.setDocumentOutline(new PDDocumentOutline());
        PDOutlineNode p = parent == null ? cat.getDocumentOutline() : node(d, parent, parent.length);
        PDOutlineItem it = new PDOutlineItem();
        it.setTitle(title);
        it.setDestination(d.getPage(page));
        p.addLast(it);
        if (p instanceof PDOutlineItem) ((PDOutlineItem) p).openNode();
    }

    public static void renameBookmark(PDDocument d, int[] path, String title) {
        ((PDOutlineItem) node(d, path, path.length)).setTitle(title);
    }

    public static void retargetBookmark(PDDocument d, int[] path, int page) {
        PDOutlineItem it = (PDOutlineItem) node(d, path, path.length);
        it.setAction(null);
        it.setDestination(d.getPage(page));
    }

    public static void deleteBookmark(PDDocument d, int[] path) {
        PDOutlineNode parent = node(d, path, path.length - 1);
        PDOutlineItem it = (PDOutlineItem) node(d, path, path.length);
        PDOutlineItem prev = it.getPreviousSibling(), next = it.getNextSibling();
        COSDictionary pc = parent.getCOSObject();
        if (prev != null) {
            if (next != null) prev.getCOSObject().setItem(COSName.NEXT, next.getCOSObject()); else prev.getCOSObject().removeItem(COSName.NEXT);
        } else {
            if (next != null) pc.setItem(COSName.FIRST, next.getCOSObject()); else pc.removeItem(COSName.FIRST);
        }
        if (next != null) {
            if (prev != null) next.getCOSObject().setItem(COSName.PREV, prev.getCOSObject()); else next.getCOSObject().removeItem(COSName.PREV);
        } else {
            if (prev != null) pc.setItem(COSName.LAST, prev.getCOSObject()); else pc.removeItem(COSName.LAST);
        }
        int cnt = 0;
        for (PDOutlineItem ignored : parent.children()) cnt++;
        int old = pc.getInt(COSName.COUNT, 0);
        if (cnt == 0) pc.removeItem(COSName.COUNT); else pc.setInt(COSName.COUNT, old < 0 ? -cnt : cnt);
    }

    /** style：D、r、R、a、A，或 null（只有前綴）。 */
    public static void setLabel(PDDocument d, int startPage, String style, String prefix, int start) throws IOException {
        PDDocumentCatalog cat = d.getDocumentCatalog();
        PDPageLabels pl = cat.getPageLabels();
        if (pl == null) pl = new PDPageLabels(d);
        PDPageLabelRange r = new PDPageLabelRange();
        if (style != null) r.setStyle(style);
        if (prefix != null && !prefix.isEmpty()) r.setPrefix(prefix);
        r.setStart(Math.max(1, start));
        pl.setLabelItem(startPage, r);
        cat.setPageLabels(pl);
    }

    public static void clearLabels(PDDocument d) {
        d.getDocumentCatalog().getCOSObject().removeItem(COSName.PAGE_LABELS);
    }

    // ================================================================ 文件資訊與附件

    public static void setInfo(PDDocument d, String title, String author, String subject, String keywords) {
        PDDocumentInformation info = d.getDocumentInformation();
        info.setTitle(title.isEmpty() ? null : title);
        info.setAuthor(author.isEmpty() ? null : author);
        info.setSubject(subject.isEmpty() ? null : subject);
        info.setKeywords(keywords.isEmpty() ? null : keywords);
        info.setModificationDate(now());
        d.setDocumentInformation(info);
    }

    public static class Att {
        public String name, desc = ""; public long size = -1; public int page = -1; public PDComplexFileSpecification fs;
    }

    static Map<String, PDComplexFileSpecification> embedded(PDDocument d) throws IOException {
        Map<String, PDComplexFileSpecification> m = new TreeMap<>();
        PDDocumentNameDictionary names = d.getDocumentCatalog().getNames();
        if (names == null || names.getEmbeddedFiles() == null) return m;
        collect(names.getEmbeddedFiles(), m, 0);
        return m;
    }

    private static void collect(PDNameTreeNode<PDComplexFileSpecification> n, Map<String, PDComplexFileSpecification> m, int depth) throws IOException {
        if (depth > 20) return;
        Map<String, PDComplexFileSpecification> x = n.getNames();
        if (x != null) m.putAll(x);
        List<PDNameTreeNode<PDComplexFileSpecification>> kids = n.getKids();
        if (kids != null) for (PDNameTreeNode<PDComplexFileSpecification> k : kids) collect(k, m, depth + 1);
    }

    static PDEmbeddedFile file(PDComplexFileSpecification fs) {
        PDEmbeddedFile e = fs.getEmbeddedFileUnicode();
        if (e == null) e = fs.getEmbeddedFile();
        return e;
    }

    public static List<Att> attachments(PDDocument d) throws IOException {
        List<Att> out = new ArrayList<>();
        for (Map.Entry<String, PDComplexFileSpecification> e : embedded(d).entrySet()) {
            Att a = new Att();
            a.fs = e.getValue();
            a.name = a.fs.getFilename() != null ? a.fs.getFilename() : e.getKey();
            a.desc = a.fs.getFileDescription() == null ? "" : a.fs.getFileDescription();
            PDEmbeddedFile f = file(a.fs);
            if (f != null) a.size = f.getSize() > 0 ? f.getSize() : f.getLength();
            out.add(a);
        }
        int pi = 0;
        for (PDPage p : d.getPages()) {
            for (PDAnnotation an : p.getAnnotations()) {
                if (an instanceof PDAnnotationFileAttachment) {
                    PDFileSpecification fs = ((PDAnnotationFileAttachment) an).getFile();
                    if (fs instanceof PDComplexFileSpecification) {
                        Att a = new Att();
                        a.fs = (PDComplexFileSpecification) fs;
                        a.name = a.fs.getFilename() == null ? "附件" : a.fs.getFilename();
                        a.page = pi;
                        PDEmbeddedFile f = file(a.fs);
                        if (f != null) a.size = f.getLength();
                        out.add(a);
                    }
                }
            }
            pi++;
        }
        return out;
    }

    public static void exportAttachment(Att a, OutputStream out) throws IOException {
        PDEmbeddedFile f = file(a.fs);
        if (f == null) throw new IOException("這個附件沒有內嵌的檔案內容");
        try (InputStream in = f.createInputStream()) { U.copy(in, out); }
    }

    public static void addAttachment(PDDocument d, String name, byte[] data, String mime) throws IOException {
        Map<String, PDComplexFileSpecification> m = embedded(d);
        PDEmbeddedFile ef = new PDEmbeddedFile(d, new ByteArrayInputStream(data));
        ef.setSize(data.length);
        if (mime != null) ef.setSubtype(mime);
        ef.setCreationDate(now());
        ef.setModDate(now());
        PDComplexFileSpecification fs = new PDComplexFileSpecification();
        fs.setFile(name);
        fs.setFileUnicode(name);
        fs.setEmbeddedFile(ef);
        fs.setEmbeddedFileUnicode(ef);
        String key = name;
        int k = 2;
        while (m.containsKey(key)) key = name + " (" + k++ + ")";
        m.put(key, fs);
        putEmbedded(d, m);
    }

    public static void removeAttachment(PDDocument d, String name) throws IOException {
        Map<String, PDComplexFileSpecification> m = embedded(d);
        String hit = null;
        for (Map.Entry<String, PDComplexFileSpecification> e : m.entrySet()) {
            String fn = e.getValue().getFilename();
            if (e.getKey().equals(name) || name.equals(fn)) { hit = e.getKey(); break; }
        }
        if (hit == null) throw new IOException("只能移除文件層級的附件；頁面上的附件請從註解面板刪除");
        m.remove(hit);
        putEmbedded(d, m);
    }

    private static void putEmbedded(PDDocument d, Map<String, PDComplexFileSpecification> m) {
        PDDocumentCatalog cat = d.getDocumentCatalog();
        PDDocumentNameDictionary names = cat.getNames();
        if (names == null) { names = new PDDocumentNameDictionary(cat); }
        if (m.isEmpty()) names.getCOSObject().removeItem(COSName.EMBEDDED_FILES);
        else {
            PDEmbeddedFilesNameTreeNode node = new PDEmbeddedFilesNameTreeNode();
            node.setNames(m);
            names.setEmbeddedFiles(node);
        }
        cat.setNames(names);
    }

    // ================================================================ 安全性、清理、壓縮

    /** 移除隱藏資訊。 */
    public static String sanitize(PDDocument d, boolean meta, boolean js, boolean attach, boolean comments, boolean forms, boolean layers) throws IOException {
        StringBuilder r = new StringBuilder();
        PDDocumentCatalog cat = d.getDocumentCatalog();
        if (meta) {
            d.setDocumentInformation(new PDDocumentInformation());
            cat.getCOSObject().removeItem(COSName.METADATA);
            r.append("・已移除文件資訊與 XMP 中繼資料\n");
        }
        if (js) {
            cat.getCOSObject().removeItem(COSName.OPEN_ACTION);
            cat.getCOSObject().removeItem(COSName.AA);
            if (cat.getNames() != null) cat.getNames().getCOSObject().removeItem(COSName.JAVA_SCRIPT);
            for (PDPage p : d.getPages()) {
                p.getCOSObject().removeItem(COSName.AA);
                for (PDAnnotation a : p.getAnnotations()) {
                    a.getCOSObject().removeItem(COSName.AA);
                    COSBase act = a.getCOSObject().getDictionaryObject(COSName.A);
                    if (act instanceof COSDictionary && "JavaScript".equals(((COSDictionary) act).getNameAsString(COSName.S)))
                        a.getCOSObject().removeItem(COSName.A);
                }
            }
            r.append("・已移除 JavaScript 與自動動作\n");
        }
        if (attach) {
            if (cat.getNames() != null) cat.getNames().getCOSObject().removeItem(COSName.EMBEDDED_FILES);
            for (PDPage p : d.getPages()) {
                List<PDAnnotation> keep = new ArrayList<>();
                for (PDAnnotation a : p.getAnnotations()) if (!(a instanceof PDAnnotationFileAttachment)) keep.add(a);
                p.setAnnotations(keep);
            }
            r.append("・已移除附件\n");
        }
        if (comments) {
            for (PDPage p : d.getPages()) {
                List<PDAnnotation> keep = new ArrayList<>();
                for (PDAnnotation a : p.getAnnotations()) if (a instanceof PDAnnotationWidget || a instanceof PDAnnotationLink) keep.add(a);
                p.setAnnotations(keep);
            }
            r.append("・已移除所有註解\n");
        }
        if (forms && acro(d, false) != null) {
            flatten(d);
            r.append("・已將表單平面化\n");
        }
        if (layers && cat.getOCProperties() != null) {
            r.append("・已保留圖層，但移除圖層設定中的隱藏狀態\n");
            COSBase dd = cat.getOCProperties().getCOSObject().getDictionaryObject(COSName.D);
            if (dd instanceof COSDictionary) ((COSDictionary) dd).removeItem(COSName.OFF);
        }
        return r.toString();
    }

    /** 重新壓縮內嵌圖片。回傳處理的張數。 */
    public static int compressImages(PDDocument d, int maxDim, float quality) throws IOException {
        Map<COSBase, PDImageXObject> done = new IdentityHashMap<>();
        int[] count = {0};
        Set<COSBase> forms = new HashSet<>();
        for (PDPage p : d.getPages()) compressRes(d, p.getResources(), maxDim, quality, done, count, forms, 0);
        return count[0];
    }

    private static void compressRes(PDDocument d, PDResources res, int maxDim, float q, Map<COSBase, PDImageXObject> done,
                                    int[] count, Set<COSBase> forms, int depth) throws IOException {
        if (res == null || depth > 8) return;
        for (COSName n : res.getXObjectNames()) {
            PDXObject x;
            try { x = res.getXObject(n); } catch (Exception e) { continue; }
            if (x instanceof PDFormXObject) {
                if (forms.add(x.getCOSObject())) compressRes(d, ((PDFormXObject) x).getResources(), maxDim, q, done, count, forms, depth + 1);
            } else if (x instanceof PDImageXObject) {
                PDImageXObject img = (PDImageXObject) x;
                COSBase key = img.getCOSObject();
                PDImageXObject rep = done.get(key);
                if (rep == null && !done.containsKey(key)) {
                    rep = shrink(d, img, maxDim, q);
                    done.put(key, rep);
                    if (rep != null) count[0]++;
                }
                if (rep != null) res.put(n, rep);
            }
        }
    }

    private static PDImageXObject shrink(PDDocument d, PDImageXObject img, int maxDim, float q) {
        try {
            if (img.isStencil() || img.getSoftMask() != null || img.getMask() != null || img.getColorKeyMask() != null) return null;
            int w = img.getWidth(), h = img.getHeight();
            if (w * (long) h < 64 * 64) return null;
            long before = img.getCOSObject().getLength();
            Bitmap b = img.getImage();
            if (b == null) return null;
            float s = Math.min(1f, maxDim / (float) Math.max(w, h));
            if (s < 1) {
                Bitmap sc = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), true);
                if (sc != b) b.recycle();
                b = sc;
            }
            if (b.hasAlpha()) {
                Bitmap o = Bitmap.createBitmap(b.getWidth(), b.getHeight(), Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(o);
                c.drawColor(Color.WHITE);
                c.drawBitmap(b, 0, 0, null);
                b = o;
            }
            PDImageXObject n = JPEGFactory.createFromImage(d, b, q);
            b.recycle();
            if (n.getCOSObject().getLength() >= before && s >= 1) return null;
            return n;
        } catch (Throwable e) {
            return null;
        }
    }

    // ================================================================ 塗銷（需要繪製）

    /** 套用塗銷：有標記的頁面會被轉成圖片並塗黑，底下的文字與圖片真正被移除。 */
    public static File applyRedactions(Doc doc, float dpi) throws Exception {
        File a = doc.temp("redact_a.pdf");
        Map<Integer, List<PDRectangle>> marks = new HashMap<>();
        try (PDDocument d = doc.load()) {
            int pi = 0;
            for (PDPage p : d.getPages()) {
                List<PDAnnotation> keep = new ArrayList<>();
                for (PDAnnotation an : p.getAnnotations()) {
                    if ("Redact".equals(an.getSubtype())) {
                        List<PDRectangle> l = marks.get(pi);
                        if (l == null) marks.put(pi, l = new ArrayList<>());
                        l.add(an.getRectangle());
                    } else keep.add(an);
                }
                p.setAnnotations(keep);
                pi++;
            }
            if (marks.isEmpty()) throw new IOException("還沒有任何塗銷標記。先在頁面上框選要塗銷的區域。");
            d.save(a);
        }
        Map<Integer, Bitmap> imgs = new HashMap<>();
        try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(a, ParcelFileDescriptor.MODE_READ_ONLY)) {
            PdfRenderer r = new PdfRenderer(pfd);
            for (Map.Entry<Integer, List<PDRectangle>> e : marks.entrySet()) {
                int i = e.getKey();
                Bitmap b = Doc.renderFile(r, i, dpi, true);
                Canvas c = new Canvas(b);
                Paint black = new Paint();
                black.setColor(Color.BLACK);
                float sx = b.getWidth() / doc.dw(i), sy = b.getHeight() / doc.dh(i);
                for (PDRectangle u : e.getValue()) {
                    RectF dr = doc.toDisplayRect(i, u.getLowerLeftX(), u.getLowerLeftY(), u.getUpperRightX(), u.getUpperRightY());
                    c.drawRect(dr.left * sx, dr.top * sy, dr.right * sx, dr.bottom * sy, black);
                }
                imgs.put(i, b);
            }
            r.close();
        }
        File out = doc.temp("redact_b.pdf");
        try (PDDocument d = PDDocument.load(a, Doc.mem())) {
            for (Map.Entry<Integer, Bitmap> e : imgs.entrySet()) {
                int i = e.getKey();
                PDPage p = d.getPage(i);
                p.setResources(new PDResources());
                p.setAnnotations(new ArrayList<>());
                PDImageXObject img = JPEGFactory.createFromImage(d, e.getValue(), 0.85f);
                try (PDPageContentStream cs = new PDPageContentStream(d, p, PDPageContentStream.AppendMode.OVERWRITE, true, true)) {
                    cs.transform(boxMatrix(doc, i, new RectF(0, 0, doc.dw(i), doc.dh(i)), 0, 0));
                    cs.drawImage(img, 0, 0, doc.dw(i), doc.dh(i));
                }
                e.getValue().recycle();
            }
            d.save(out);
        }
        a.delete();
        return out;
    }

    /** 整份文件轉成影像（灰階或彩色），用於印刷或徹底移除內容。 */
    public static File rasterize(Doc doc, float dpi, boolean gray) throws Exception {
        File out = doc.temp("raster.pdf");
        try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(doc.current(), ParcelFileDescriptor.MODE_READ_ONLY);
             PDDocument d = PDDocument.load(doc.current(), Doc.mem())) {
            PdfRenderer r = new PdfRenderer(pfd);
            for (int i = 0; i < d.getNumberOfPages(); i++) {
                Bitmap b = Doc.renderFile(r, i, dpi, true);
                if (gray) {
                    Bitmap g = Bitmap.createBitmap(b.getWidth(), b.getHeight(), Bitmap.Config.ARGB_8888);
                    Paint p = new Paint();
                    android.graphics.ColorMatrix cm = new android.graphics.ColorMatrix();
                    cm.setSaturation(0);
                    p.setColorFilter(new android.graphics.ColorMatrixColorFilter(cm));
                    new Canvas(g).drawBitmap(b, 0, 0, p);
                    b.recycle();
                    b = g;
                }
                PDPage p = d.getPage(i);
                p.setResources(new PDResources());
                p.setAnnotations(new ArrayList<>());
                PDImageXObject img = JPEGFactory.createFromImage(d, b, 0.85f);
                try (PDPageContentStream cs = new PDPageContentStream(d, p, PDPageContentStream.AppendMode.OVERWRITE, true, true)) {
                    cs.transform(boxMatrix(doc, i, new RectF(0, 0, doc.dw(i), doc.dh(i)), 0, 0));
                    cs.drawImage(img, 0, 0, doc.dw(i), doc.dh(i));
                }
                b.recycle();
            }
            r.close();
            d.getDocumentCatalog().setAcroForm(null);
            d.save(out);
        }
        return out;
    }

    public static String fmtDate(Calendar c) {
        if (c == null) return "";
        return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.TAIWAN).format(c.getTime());
    }
}
