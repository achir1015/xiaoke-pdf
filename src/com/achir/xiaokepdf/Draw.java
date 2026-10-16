package com.achir.xiaokepdf;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;

import com.tom_roush.fontbox.ttf.TrueTypeCollection;
import com.tom_roush.fontbox.ttf.TrueTypeFont;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.font.PDType0Font;
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** 文字點陣圖、印章圖，以及找系統中文字型。 */
public final class Draw {
    private Draw() {}

    /** 圖片的像素 / pt 比例。 */
    public static final float PX = 4f;

    /** 多行文字畫成透明背景的圖，回傳的圖每 pt 有 PX 個像素。maxWidthPt ≤ 0 表示不換行。 */
    public static Bitmap text(String s, float sizePt, int color, float maxWidthPt, boolean bold) {
        TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        tp.setColor(color);
        tp.setTextSize(sizePt * PX);
        if (bold) tp.setTypeface(Typeface.DEFAULT_BOLD);
        int w;
        if (maxWidthPt > 0) w = (int) (maxWidthPt * PX);
        else {
            float m = 1;
            for (String line : s.split("\n", -1)) m = Math.max(m, tp.measureText(line));
            w = (int) Math.ceil(m) + 2;
        }
        StaticLayout sl = new StaticLayout(s, tp, Math.max(1, w), Layout.Alignment.ALIGN_NORMAL, 1.1f, 0, false);
        int h = Math.max(1, sl.getHeight());
        Bitmap b = Bitmap.createBitmap(Math.max(1, w), h, Bitmap.Config.ARGB_8888);
        sl.draw(new Canvas(b));
        return b;
    }

    /** 印章：圓角外框 + 粗體文字 + 可選日期 / 姓名。 */
    public static Bitmap stamp(String title, String sub, int color) {
        TextPaint big = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        big.setColor(color);
        big.setTextSize(22 * PX);
        big.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        big.setLetterSpacing(0.08f);
        TextPaint small = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        small.setColor(color);
        small.setTextSize(9 * PX);
        float tw = big.measureText(title), sw = sub == null ? 0 : small.measureText(sub);
        float pad = 10 * PX;
        int w = (int) (Math.max(tw, sw) + pad * 2), h = (int) ((sub == null ? 34 : 46) * PX);
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint st = new Paint(Paint.ANTI_ALIAS_FLAG);
        st.setStyle(Paint.Style.STROKE);
        st.setColor(color);
        st.setStrokeWidth(2.5f * PX);
        float in = 2 * PX;
        c.drawRoundRect(new RectF(in, in, w - in, h - in), 6 * PX, 6 * PX, st);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor((color & 0x00FFFFFF) | 0x14000000);
        c.drawRoundRect(new RectF(in, in, w - in, h - in), 6 * PX, 6 * PX, fill);
        c.drawText(title, (w - tw) / 2, 27 * PX, big);
        if (sub != null) c.drawText(sub, (w - sw) / 2, 39 * PX, small);
        return b;
    }

    public static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.TAIWAN).format(new Date()); }
    public static String now() { return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.TAIWAN).format(new Date()); }

    /** 把點陣圖裁掉透明邊。 */
    public static Bitmap trim(Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        int l = w, t = h, r = -1, bt = -1;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if ((px[y * w + x] >>> 24) > 8) {
            if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > bt) bt = y;
        }
        if (r < 0) return b;
        int m = 6;
        l = Math.max(0, l - m); t = Math.max(0, t - m); r = Math.min(w - 1, r + m); bt = Math.min(h - 1, bt + m);
        return Bitmap.createBitmap(b, l, t, r - l + 1, bt - t + 1);
    }

    // ---------------------------------------------------------------- 字型

    private static TrueTypeFont cjk;
    private static boolean searched;
    public static final String BUNDLED = "fonts/jf-openhuninn-2.1.ttf";

    /** 內建的 jf open 粉圓（SIL OFL 1.1），第一次使用時從 assets 複製出來。 */
    static File bundledFont() {
        try {
            File dir = new File(App.I.getFilesDir(), "fonts");
            dir.mkdirs();
            File f = new File(dir, "jf-openhuninn-2.1.ttf");
            if (!f.exists() || f.length() == 0) {
                File tmp = new File(dir, "font.tmp");
                try (java.io.InputStream in = App.I.getAssets().open(BUNDLED); java.io.OutputStream out = new java.io.FileOutputStream(tmp)) { U.copy(in, out); }
                tmp.renameTo(f);
            }
            return f;
        } catch (Exception e) { return null; }
    }

    private static android.graphics.Typeface bundledFace;

    /** 預覽用：與寫入 PDF 的中文字型相同。 */
    public static synchronized android.graphics.Typeface bundledTypeface() {
        if (bundledFace == null) {
            try { bundledFace = android.graphics.Typeface.createFromAsset(App.I.getAssets(), BUNDLED); }
            catch (Exception e) { bundledFace = android.graphics.Typeface.SANS_SERIF; }
        }
        return bundledFace;
    }

    /** 可以寫中文的字型（嵌入子集）；找不到回傳 null，呼叫端改用圖片。 */
    public static synchronized PDFont cjkFont(PDDocument d) {
        if (!searched) {
            searched = true;
            File b = bundledFont();
            String[] cands = {b == null ? "" : b.getAbsolutePath(), "/system/fonts/SECCJK-Regular-Extra.ttf", "/system/fonts/DroidSansFallbackFull.ttf",
                    "/system/fonts/DroidSansFallback.ttf", "/system/fonts/NotoSansCJK-Regular.ttc",
                    "/system/fonts/SECCJK-Regular.ttc", "/system/fonts/NotoSansTC-Regular.ttf"};
            for (String c : cands) {
                File f = new File(c);
                if (!f.exists()) continue;
                try {
                    TrueTypeFont t;
                    if (c.endsWith(".ttc")) {
                        final List<TrueTypeFont> all = new ArrayList<>();
                        TrueTypeCollection col = new TrueTypeCollection(f);
                        col.processAllFonts(all::add);
                        t = null;
                        for (TrueTypeFont x : all) {
                            String nm = x.getName() == null ? "" : x.getName();
                            if (nm.contains("TC") || nm.contains("Trad")) { t = x; break; }
                        }
                        if (t == null && !all.isEmpty()) t = all.get(0);
                    } else {
                        t = new com.tom_roush.fontbox.ttf.TTFParser().parse(f);
                    }
                    if (t == null) continue;
                    // CFF 外框（OTF）的字型 PDFBox 無法嵌入子集
                    if (t instanceof com.tom_roush.fontbox.ttf.OpenTypeFont && ((com.tom_roush.fontbox.ttf.OpenTypeFont) t).isPostScript()) continue;
                    // 真的寫一頁並存檔，確認可以嵌入子集
                    try (PDDocument test = new PDDocument()) {
                        com.tom_roush.pdfbox.pdmodel.PDPage pg = new com.tom_roush.pdfbox.pdmodel.PDPage();
                        test.addPage(pg);
                        PDType0Font tf = PDType0Font.load(test, t, true);
                        try (com.tom_roush.pdfbox.pdmodel.PDPageContentStream cs = new com.tom_roush.pdfbox.pdmodel.PDPageContentStream(test, pg)) {
                            cs.beginText();
                            cs.setFont(tf, 12);
                            cs.showText("中文測試的一是了我");
                            cs.endText();
                        }
                        test.save(new java.io.ByteArrayOutputStream());
                    }
                    android.util.Log.i("XiaoKePdf", "CJK font: " + c + " / " + t.getName());
                    cjk = t;
                    break;
                } catch (Throwable e) {
                    e.printStackTrace();
                }
            }
        }
        if (cjk == null) return null;
        try { return PDType0Font.load(d, cjk, true); } catch (Throwable e) { return null; }
    }

    /** 這段文字能不能用這個字型寫出。 */
    public static boolean canEncode(PDFont f, String s) {
        if (f == null) return false;
        try { f.encode(s.replace("\n", "")); return true; } catch (Throwable e) { return false; }
    }

    /** 先試 Helvetica，再試中文字型；都不行回傳 null。 */
    public static PDFont fontFor(PDDocument d, String s) {
        if (canEncode(PDType1Font.HELVETICA, s)) return PDType1Font.HELVETICA;
        PDFont f = cjkFont(d);
        return canEncode(f, s) ? f : null;
    }

    public static int argb(int r, int g, int b) { return Color.rgb(r, g, b); }
}
