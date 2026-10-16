package com.achir.xiaokepdf;

import android.graphics.RectF;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;
import com.tom_roush.pdfbox.text.TextPosition;

import java.io.IOException;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** 依閱讀順序取出一頁文字，並記住每個字元在頁面上的位置（顯示座標）。 */
public class TextData {
    public static class Page {
        public String text = "";
        public float[] r = new float[0];   // 每個字元 4 個值：x, y, w, h
        public float[] fs = new float[0];  // 每個字元的字級（pt）

        /** 第 i 個字所在的那一行（不含換行），回傳 [start, end]。 */
        public int[] line(int i) {
            int a = i, b = i;
            while (a > 0 && text.charAt(a - 1) != '\n') a--;
            while (b + 1 < count() && text.charAt(b + 1) != '\n') b++;
            while (a < b && !real(a)) a++;
            while (b > a && !real(b)) b--;
            return new int[]{a, b};
        }

        public float size(int a, int b) {
            float m = 0;
            for (int i = a; i <= b && i < fs.length; i++) m = Math.max(m, fs[i]);
            return m > 0 ? m : 12;
        }

        public int count() { return text.length(); }

        public RectF rect(int i) {
            int k = i * 4;
            return new RectF(r[k], r[k + 1], r[k] + r[k + 2], r[k + 1] + r[k + 3]);
        }

        public boolean real(int i) { return r[i * 4 + 2] > 0 && r[i * 4 + 3] > 0; }

        /** 最接近 (x,y) 的字元；太遠回傳 -1。 */
        public int hit(float x, float y, float slop) {
            int best = -1;
            float bd = slop * slop;
            for (int i = 0; i < count(); i++) {
                if (!real(i)) continue;
                int k = i * 4;
                float cx = Math.max(r[k], Math.min(x, r[k] + r[k + 2]));
                float cy = Math.max(r[k + 1], Math.min(y, r[k + 1] + r[k + 3]));
                float d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
                if (d < bd || (d == 0 && best < 0)) { bd = d; best = i; if (d == 0) break; }
            }
            return best;
        }

        /** a..b（含）合併成每一行一個矩形。 */
        public List<RectF> rects(int a, int b) {
            List<RectF> out = new ArrayList<>();
            RectF cur = null;
            for (int i = Math.max(0, a); i <= b && i < count(); i++) {
                if (!real(i)) continue;
                RectF c = rect(i);
                if (cur != null && Math.abs(c.centerY() - cur.centerY()) < Math.max(c.height(), cur.height()) * 0.5f
                        && c.left >= cur.left - c.height()) {
                    cur.union(c);
                } else {
                    if (cur != null) out.add(cur);
                    cur = new RectF(c);
                }
            }
            if (cur != null) out.add(cur);
            return out;
        }

        public int wordStart(int i) {
            if (isCjk(text.charAt(i))) return i;
            while (i > 0 && Character.isLetterOrDigit(text.charAt(i - 1)) && !isCjk(text.charAt(i - 1))) i--;
            return i;
        }

        public int wordEnd(int i) {
            if (isCjk(text.charAt(i))) return i;
            while (i + 1 < count() && Character.isLetterOrDigit(text.charAt(i + 1)) && !isCjk(text.charAt(i + 1))) i++;
            return i;
        }

        /** 找出所有出現位置（不分大小寫），回傳 [start, end) 配對。 */
        public List<int[]> find(String q) {
            List<int[]> out = new ArrayList<>();
            if (q.isEmpty()) return out;
            String t = norm(text), qq = norm(q);
            int i = 0;
            while ((i = t.indexOf(qq, i)) >= 0) { out.add(new int[]{i, i + qq.length()}); i += Math.max(1, qq.length()); }
            return out;
        }
    }

    static boolean isCjk(char c) { return c >= 0x2E80 && c <= 0x9FFF || c >= 0xAC00 && c <= 0xD7AF || c >= 0xF900 && c <= 0xFAFF; }

    /** 搜尋用：小寫，換行當空白（長度不變，位置才能對上）。 */
    static String norm(String s) { return s.toLowerCase(Locale.ROOT).replace('\n', ' ').replace(' ', ' '); }

    public static Page extract(PDDocument d, int index) throws IOException {
        final StringBuilder sb = new StringBuilder();
        final List<float[]> rs = new ArrayList<>();
        final List<Float> sizes = new ArrayList<>();
        PDFTextStripper s = new PDFTextStripper() {
            float cur;
            void add(char c, float x, float y, float w, float h) { sb.append(c); rs.add(new float[]{x, y, w, h}); sizes.add(cur); }

            @Override
            protected void writeString(String text, List<TextPosition> tps) {
                for (TextPosition tp : tps) {
                    String u = tp.getUnicode();
                    if (u == null || u.isEmpty()) continue;
                    cur = tp.getFontSizeInPt();
                    float w = Math.max(tp.getWidth(), 0.5f);
                    float h = Math.max(tp.getHeight(), tp.getFontSizeInPt() * 0.75f);
                    if (h <= 0 || Float.isNaN(h)) h = 8;
                    float x = tp.getX(), y = tp.getY() - h;
                    int n = u.length();
                    for (int k = 0; k < n; k++) add(u.charAt(k), x + w * k / n, y, w / n, h * 1.15f);
                }
            }

            @Override protected void writeWordSeparator() { add(' ', 0, 0, 0, 0); }
            @Override protected void writeLineSeparator() { add('\n', 0, 0, 0, 0); }
        };
        s.setSortByPosition(true);
        s.setStartPage(index + 1);
        s.setEndPage(index + 1);
        s.writeText(d, new StringWriter());
        Page p = new Page();
        p.text = sb.toString();
        p.r = new float[rs.size() * 4];
        p.fs = new float[sizes.size()];
        for (int i = 0; i < rs.size(); i++) { System.arraycopy(rs.get(i), 0, p.r, i * 4, 4); p.fs[i] = sizes.get(i); }
        return p;
    }
}
