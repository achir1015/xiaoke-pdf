package com.achir.xiaokepdf;

import android.graphics.RectF;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.graphics.state.RenderingMode;
import com.tom_roush.pdfbox.util.Matrix;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 直書文字：找出頁面上的直行、把修改後的文字以直書寫回 PDF。
 *
 * 比喻：直書就像把稿紙轉個方向——中文字「站著」由上往下排，英數字「躺著」排，
 * 一行寫滿再往左開新的一行。規則和網頁版（web/js/pdf/vertical.js）相同。
 *
 * 判斷直行的方法：點到的字「離上下鄰居比較近、還是離左右鄰居比較近」。
 * 直書的字上下緊貼、左右隔著行距；橫書剛好相反。
 */
final class Vertical {
    private Vertical() {}

    /** 一個直行：範圍（顯示座標）、中心線、字級、文字。 */
    static final class Column {
        RectF area;
        float cx, top, size;
        String text;
    }

    // ================================================================ 找直行

    /** 點到的位置是直書的一行就回傳它，否則回傳 null（交給原本的橫書編輯）。 */
    static Column columnAt(TextData.Page tp, float x, float y) {
        int h = tp.hit(x, y, 14);
        if (h < 0 || Character.isWhitespace(tp.text.charAt(h))) return null;
        RectF hr = tp.rect(h);
        float size = Math.max(Math.min(hr.width(), hr.height()), h < tp.fs.length ? tp.fs[h] * 0.8f : 0);
        if (size <= 0) size = 12;

        // 所有實際的字（不含空白）
        List<Integer> chars = new ArrayList<>();
        for (int i = 0; i < tp.count(); i++) if (tp.real(i) && !Character.isWhitespace(tp.text.charAt(i))) chars.add(i);

        float gapV = Float.MAX_VALUE, gapH = Float.MAX_VALUE;
        for (int i : chars) {
            if (i == h) continue;
            RectF r = tp.rect(i);
            if (Math.abs(r.centerX() - hr.centerX()) < size * 0.4f && r.width() < size * 1.8f) {
                float gap = r.top >= hr.top ? r.top - hr.bottom : hr.top - r.bottom;
                if (gap > -size * 0.6f) gapV = Math.min(gapV, Math.max(0, gap));
            }
            if (Math.abs(r.centerY() - hr.centerY()) < size * 0.4f) {
                float gap = r.left >= hr.left ? r.left - hr.right : hr.left - r.right;
                if (gap > -size * 0.6f) gapH = Math.min(gapH, Math.max(0, gap));
            }
        }
        if (!(gapV < size * 0.6f && gapV + size * 0.1f < gapH)) return null;

        // 同一條中心線上的字，由上往下排，取包含點到的字、中間沒有大空隙的那一段
        final float cx = hr.centerX();
        List<Integer> col = new ArrayList<>();
        for (int i : chars) {
            RectF r = tp.rect(i);
            if (Math.abs(r.centerX() - cx) < size * 0.45f) col.add(i);
        }
        Collections.sort(col, (p, q) -> Float.compare(tp.rect(p).top, tp.rect(q).top));
        int at = col.indexOf(h);
        if (at < 0) return null;
        int s = at, e = at;
        while (s > 0 && tp.rect(col.get(s)).top - tp.rect(col.get(s - 1)).bottom < size * 1.2f) s--;
        while (e + 1 < col.size() && tp.rect(col.get(e + 1)).top - tp.rect(col.get(e)).bottom < size * 1.2f) e++;
        if (e - s < 1) return null;      // 只有一個字：當成橫書處理

        Column c = new Column();
        StringBuilder sb = new StringBuilder();
        float sum = 0, maxFs = 0;
        for (int k = s; k <= e; k++) {
            int i = col.get(k);
            RectF r = tp.rect(i);
            if (c.area == null) c.area = new RectF(r); else c.area.union(r);
            sb.append(tp.text.charAt(i));
            sum += r.centerX();
            if (i < tp.fs.length) maxFs = Math.max(maxFs, tp.fs[i]);
        }
        c.text = sb.toString();
        c.cx = sum / (e - s + 1);
        c.top = c.area.top;
        c.size = Math.round((maxFs > 0 ? maxFs : size) * 10) / 10f;
        return c;
    }

    // ================================================================ 寫回 PDF

    static final float ASC = 0.88f;    // 中文字身：基線以上 0.88 em、以下 0.12 em

    private static final Map<Character, Character> FORMS = new HashMap<>();
    static {
        String from = "（）｛｝〔〕【】《》〈〉「」『』［］", to = "︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹇﹈";
        for (int i = 0; i < from.length(); i++) FORMS.put(from.charAt(i), to.charAt(i));
    }

    /** 直書時要站著的字（中日韓文字、全形符號）；其他（英數字）順時針躺著 */
    static boolean upright(char c) {
        return c >= 0x1100 && c <= 0x11FF || c >= 0x2E80 && c <= 0xA4CF || c >= 0xAC00 && c <= 0xD7AF
                || c >= 0xF900 && c <= 0xFAFF || c >= 0xFE10 && c <= 0xFE4F || c >= 0xFF01 && c <= 0xFF60
                || c >= 0xFFE0 && c <= 0xFFE6 || c >= 0x2460 && c <= 0x24FF || c >= 0x25A0 && c <= 0x27BF
                || Character.isSurrogate(c);
    }

    /**
     * 修改一個直行：先把原本的字從內容串流刪掉（刪不到就用背景色蓋住），
     * 再從原本的位置往下寫新文字。換行＝往左開新的一行；太長會在頁面下緣自動換到左邊一行。
     */
    static void replace(PDDocument d, Doc doc, int page, Column col, String text, TextStyle st, int bg) throws IOException {
        RectF cover = new RectF(col.area);
        cover.inset(-1.5f, -1.5f);
        if (!Ops.removeTextIn(d, doc, page, cover)) {
            try (PDPageContentStream cs = new PDPageContentStream(d, d.getPage(page), PDPageContentStream.AppendMode.APPEND, true, true)) {
                cs.transform(Ops.boxMatrix(doc, page, cover, 0, 0));
                cs.setNonStrokingColor(Ops.color(bg));
                cs.addRect(0, 0, cover.width(), cover.height());
                cs.fill();
            }
        }
        if (text.trim().isEmpty()) return;
        write(d, doc, page, col.cx, col.top, Math.max(col.area.height(), doc.dh(page) - 18 - col.top), text, st);
    }

    /** 從 (cx, top)（第一個字的中心線與上緣，顯示座標）開始寫直書文字。 */
    static void write(PDDocument d, Doc doc, int page, float cx, float top, float maxH, String text, TextStyle st) throws IOException {
        PDFont f = Draw.cjkFont(d);
        if (f == null) throw new IOException("找不到中文字型");
        float size = st.size, pitch = size * 1.3f;
        float W = doc.dw(page), H = doc.dh(page);
        PDPage p = d.getPage(page);
        try (PDPageContentStream cs = new PDPageContentStream(d, p, PDPageContentStream.AppendMode.APPEND, true, true)) {
            // 整頁的方框座標：左下原點、往上為正；顯示座標 (X, Y) → (X, H − Y)。頁面旋轉由 boxMatrix 處理
            cs.transform(Ops.boxMatrix(doc, page, new RectF(0, 0, W, H), 0, 0));
            cs.setNonStrokingColor(Ops.color(st.color));
            cs.setStrokingColor(Ops.color(st.color));
            if (st.bold) { cs.setLineWidth(size * 0.035f); }
            float x = cx, y = top;
            StringBuilder run = new StringBuilder();
            for (int i = 0; i <= text.length(); i++) {
                char c = i < text.length() ? text.charAt(i) : '\n';
                boolean up = c != '\n' && upright(c);
                // 一段英數字（躺著）一起畫
                if ((c == '\n' || up) && run.length() > 0) {
                    String r = run.toString();
                    float len = width(f, r, size);
                    if (y + len > top + maxH && y > top) { x -= pitch; y = top; }
                    cs.beginText();
                    cs.setFont(f, size);
                    if (st.bold) cs.setRenderingMode(RenderingMode.FILL_STROKE);
                    // 順時針轉 90 度：字的前進方向朝下、字頭朝右；字身置中在中心線上
                    cs.setTextMatrix(new Matrix(0, -1, 1, 0, x - size * (ASC - (1 - ASC)) / 2, H - y));
                    showSafe(cs, f, r);
                    cs.endText();
                    y += len;
                    run.setLength(0);
                }
                if (c == '\n') { if (i < text.length()) { x -= pitch; y = top; } continue; }
                if (!up) { if (c != ' ' || run.length() > 0) run.append(c); continue; }
                if (y + size > top + maxH && y > top) { x -= pitch; y = top; }
                String g = String.valueOf(c);
                Character form = FORMS.get(c);
                if (form != null && Draw.canEncode(f, String.valueOf(form))) g = String.valueOf(form);
                if (Draw.canEncode(f, g)) {
                    float adv = width(f, g, size);
                    cs.beginText();
                    cs.setFont(f, size);
                    if (st.bold) cs.setRenderingMode(RenderingMode.FILL_STROKE);
                    cs.newLineAtOffset(x - adv / 2, H - (y + size * ASC));
                    cs.showText(g);
                    cs.endText();
                }
                y += size;
            }
        }
    }

    private static float width(PDFont f, String s, float size) {
        try { return f.getStringWidth(s) / 1000 * size; } catch (Exception e) { return s.length() * size * 0.5f; }
    }

    /** 字型沒有的字略過，不要讓整段寫入失敗。 */
    private static void showSafe(PDPageContentStream cs, PDFont f, String s) throws IOException {
        StringBuilder ok = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            String c = String.valueOf(s.charAt(i));
            if (Draw.canEncode(f, c)) ok.append(c);
        }
        if (ok.length() > 0) cs.showText(ok.toString());
    }
}
