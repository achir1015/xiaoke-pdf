package com.achir.xiaokepdf;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.Editable;
import android.text.InputType;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextWatcher;
import android.view.Gravity;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font;

/** 文字格式：字型、大小、文字顏色、背景色、粗體、底線、刪除線。 */
public class TextStyle {
    public static final String[] FAMILIES = {"黑體（無襯線）", "明體（襯線）", "等寬"};
    public int family;              // 0 黑體 1 明體 2 等寬
    public float size = 12;
    public int color = 0xFF000000;
    public int bg;                  // 0 = 無背景
    public boolean bold, underline, strike;

    public TextStyle copy() {
        TextStyle s = new TextStyle();
        s.family = family; s.size = size; s.color = color; s.bg = bg; s.bold = bold; s.underline = underline; s.strike = strike;
        return s;
    }

    public Typeface typeface() {
        Typeface base = family == 1 ? Typeface.SERIF : family == 2 ? Typeface.MONOSPACE : Typeface.SANS_SERIF;
        return Typeface.create(base, bold ? Typeface.BOLD : Typeface.NORMAL);
    }

    /** 標準字型（英數）是否有真正的粗體。 */
    static PDFont standard(int family, boolean bold) {
        switch (family) {
            case 1: return bold ? PDType1Font.TIMES_BOLD : PDType1Font.TIMES_ROMAN;
            case 2: return bold ? PDType1Font.COURIER_BOLD : PDType1Font.COURIER;
            default: return bold ? PDType1Font.HELVETICA_BOLD : PDType1Font.HELVETICA;
        }
    }

    /** 可以用向量文字寫出時回傳字型；否則 null（改畫成圖）。 */
    public PDFont pdfFont(PDDocument d, String text) {
        PDFont s = standard(family, bold);
        if (Draw.canEncode(s, text)) return s;
        // 含中文：使用內建的開放授權 TrueType 字型，寫成可搜尋的文字
        PDFont c = Draw.cjkFont(d);
        if (Draw.canEncode(c, text)) return c;
        return null;
    }

    static boolean ascii(String s) {
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) > 0x7E && s.charAt(i) != '\n') return false;
        return true;
    }

    /** 預覽字型：英數字依選的字型；含中文時用內建中文字型（與實際寫入相同）。 */
    public Typeface previewTypeface(String text) {
        if (ascii(text)) return typeface();
        return Typeface.create(Draw.bundledTypeface(), bold ? Typeface.BOLD : Typeface.NORMAL);
    }

    public static boolean nativeBold(PDFont f) { return f instanceof PDType1Font; }

    /** 畫成圖（每 pt PX 像素），含背景、底線、刪除線。 */
    public Bitmap bitmap(String s, float maxWidthPt) {
        TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        tp.setColor(color);
        tp.setTextSize(size * Draw.PX);
        tp.setTypeface(typeface());
        if (bold && !typeface().isBold()) tp.setFakeBoldText(true);
        int flags = tp.getFlags();
        if (underline) flags |= Paint.UNDERLINE_TEXT_FLAG;
        if (strike) flags |= Paint.STRIKE_THRU_TEXT_FLAG;
        tp.setFlags(flags);
        float m = 1;
        for (String line : s.split("\n", -1)) m = Math.max(m, tp.measureText(line));
        int w = (int) Math.ceil(m) + 4;
        if (maxWidthPt > 0) w = Math.min(w, (int) (maxWidthPt * Draw.PX));
        StaticLayout sl = new StaticLayout(s, tp, Math.max(1, w), Layout.Alignment.ALIGN_NORMAL, 1.1f, 0, false);
        Bitmap b = Bitmap.createBitmap(Math.max(1, w), Math.max(1, sl.getHeight()), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        if (bg != 0) c.drawColor(bg);
        sl.draw(c);
        return b;
    }

    public static TextStyle load(MainActivity a, String key) {
        TextStyle s = new TextStyle();
        s.family = a.prefs.getInt(key + "_fam", 0);
        s.size = a.prefs.getFloat(key + "_size", 12);
        s.color = a.prefs.getInt(key + "_color", 0xFF000000);
        s.bg = a.prefs.getInt(key + "_bg", 0);
        s.bold = a.prefs.getBoolean(key + "_b", false);
        s.underline = a.prefs.getBoolean(key + "_u", false);
        s.strike = a.prefs.getBoolean(key + "_s", false);
        return s;
    }

    public void save(MainActivity a, String key) {
        a.prefs.edit().putInt(key + "_fam", family).putFloat(key + "_size", size).putInt(key + "_color", color)
                .putInt(key + "_bg", bg).putBoolean(key + "_b", bold).putBoolean(key + "_u", underline).putBoolean(key + "_s", strike).apply();
    }

    public interface Done { void done(String text, TextStyle st); }

    static final int[] FG = {0xFF000000, 0xFF555555, 0xFFFFFFFF, 0xFFE53935, 0xFFFB8C00, 0xFFFDD835, 0xFF43A047, 0xFF1E63E9, 0xFF8E24AA, 0xFFD81B60};
    static final int[] BG = {0, 0xFFFFFFFF, 0xFFFFF59D, 0xFFFFCC80, 0xFFC8E6C9, 0xFFBBDEFB, 0xFFF8BBD0, 0xFFE0E0E0, 0xFF000000};

    /**
     * 文字與格式對話框。original 不為 null 時顯示原文字（編輯模式）。
     */
    public static android.app.AlertDialog dialog(MainActivity a, String title, String original, String init, TextStyle st0, String okLabel, Done cb) {
        final TextStyle st = st0.copy();
        LinearLayout l = U.vbox(a);
        l.setPadding(U.dp(20), U.dp(8), U.dp(20), 0);
        if (original != null) {
            l.addView(U.text(a, "原文字", 12, U.SUB));
            l.addView(U.text(a, original, 14, U.SUB));
        }
        l.addView(U.text(a, original != null ? "改成（留白＝刪除）" : "文字", 12, U.SUB));
        EditText t = U.edit(a, "輸入文字", init);
        t.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        l.addView(t);

        // 預覽
        TextView pv = U.text(a, "", 16, 0);
        pv.setPadding(U.dp(10), U.dp(8), U.dp(10), U.dp(8));
        pv.setMinHeight(U.dp(44));
        pv.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams pl = U.lp(U.MATCH, U.WRAP);
        pl.setMargins(0, U.dp(6), 0, U.dp(6));
        l.addView(pv, pl);

        // 字型
        TextView fam = U.flat(a, "", null);
        fam.setGravity(Gravity.START);
        fam.setPadding(0, U.dp(8), 0, U.dp(8));
        l.addView(fam);

        // 大小
        LinearLayout sizeRow = U.hbox(a);
        sizeRow.addView(U.text(a, "大小", 13, U.SUB), U.lp(U.dp(64), U.WRAP));
        EditText sz = U.edit(a, "pt", fmt(st.size));
        sz.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        sz.setGravity(Gravity.CENTER);
        sizeRow.addView(U.icon(a, "－", "縮小", v -> { st.size = Math.max(4, st.size - 1); sz.setText(fmt(st.size)); }));
        sizeRow.addView(sz, U.lp(U.dp(70), U.WRAP));
        sizeRow.addView(U.icon(a, "＋", "放大", v -> { st.size = Math.min(144, st.size + 1); sz.setText(fmt(st.size)); }));
        sizeRow.addView(U.text(a, " pt", 13, U.SUB));
        l.addView(sizeRow);

        // 粗體 / 底線 / 刪除線
        LinearLayout fmtRow = U.hbox(a);
        fmtRow.addView(U.text(a, "樣式", 13, U.SUB), U.lp(U.dp(64), U.WRAP));
        TextView bB = toggle(a, "B"), bU = toggle(a, "U"), bS = toggle(a, "S");
        bB.setTypeface(Typeface.DEFAULT_BOLD);
        bU.setPaintFlags(bU.getPaintFlags() | Paint.UNDERLINE_TEXT_FLAG);
        bS.setPaintFlags(bS.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG);
        bB.setContentDescription("粗體"); bU.setContentDescription("底線"); bS.setContentDescription("刪除線");
        fmtRow.addView(bB); fmtRow.addView(bU); fmtRow.addView(bS);
        l.addView(fmtRow);

        // 文字顏色 / 背景
        LinearLayout fgRow = U.hbox(a), bgRow = U.hbox(a);
        l.addView(U.text(a, "文字顏色", 13, U.SUB));
        l.addView(hs(a, fgRow));
        l.addView(U.text(a, "背景顏色", 13, U.SUB));
        l.addView(hs(a, bgRow));

        final Runnable[] refresh = new Runnable[1];
        refresh[0] = () -> {
            String s = t.getText().toString();
            pv.setText(s.isEmpty() ? "預覽 Preview 永" : s);
            pv.setTypeface(st.previewTypeface(s.isEmpty() ? "預覽" : s));
            pv.setTextColor(st.color);
            pv.setTextSize(Math.max(10, Math.min(30, st.size * 1.3f)));
            int f = Paint.ANTI_ALIAS_FLAG | (st.underline ? Paint.UNDERLINE_TEXT_FLAG : 0) | (st.strike ? Paint.STRIKE_THRU_TEXT_FLAG : 0);
            pv.setPaintFlags(f);
            pv.getPaint().setFakeBoldText(st.bold && !pv.getTypeface().isBold());
            pv.setBackground(U.round(st.bg != 0 ? st.bg : 0xFFFFFFFF, U.LINE, 6));
            fam.setText("字型：" + FAMILIES[st.family] + "  ▾");
            mark(bB, st.bold); mark(bU, st.underline); mark(bS, st.strike);
            swatches(a, fgRow, FG, st.color, c -> { st.color = c; refresh[0].run(); });
            swatches(a, bgRow, BG, st.bg, c -> { st.bg = c; refresh[0].run(); });
        };
        fam.setOnClickListener(v -> U.choose(a, "字型", FAMILIES, k -> { st.family = k; refresh[0].run(); }));
        bB.setOnClickListener(v -> { st.bold = !st.bold; refresh[0].run(); });
        bU.setOnClickListener(v -> { st.underline = !st.underline; refresh[0].run(); });
        bS.setOnClickListener(v -> { st.strike = !st.strike; refresh[0].run(); });
        TextWatcher tw = new TextWatcher() {
            public void beforeTextChanged(CharSequence x, int b, int c, int d) {}
            public void onTextChanged(CharSequence x, int b, int c, int d) {}
            public void afterTextChanged(Editable e) {
                try { st.size = Math.max(4, Math.min(144, Float.parseFloat(sz.getText().toString()))); } catch (Exception ignored) {}
                refresh[0].run();
            }
        };
        t.addTextChangedListener(tw);
        sz.addTextChangedListener(tw);
        refresh[0].run();
        if (original == null) l.addView(U.text(a, "英數字使用 PDF 標準字型（黑體/明體/等寬）；中文使用內建的 jf open 粉圓字型，寫入後可以搜尋與複製。", 11.5f, U.SUB));
        else l.addView(U.text(a, "會用背景色蓋住原本的字，再在同一位置寫上新字。", 11.5f, U.SUB));

        ScrollView sv = new ScrollView(a);
        sv.addView(l);
        android.app.AlertDialog dlg = U.dlg(a).setTitle(title).setView(sv).setPositiveButton(okLabel, (x, w) -> cb.done(t.getText().toString(), st))
                .setNegativeButton("取消", null).show();
        t.requestFocus();
        return dlg;
    }

    static String fmt(float f) { return f == (int) f ? String.valueOf((int) f) : String.format(java.util.Locale.US, "%.1f", f); }

    static HorizontalScrollView hs(MainActivity a, LinearLayout row) {
        HorizontalScrollView h = new HorizontalScrollView(a);
        h.setHorizontalScrollBarEnabled(false);
        h.addView(row);
        return h;
    }

    static TextView toggle(MainActivity a, String s) {
        TextView t = U.text(a, s, 17, U.TEXT);
        t.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = U.lp(U.dp(44), U.dp(40));
        lp.setMargins(0, U.dp(4), U.dp(8), U.dp(4));
        t.setLayoutParams(lp);
        return t;
    }

    static void mark(TextView t, boolean on) {
        t.setBackground(U.round(on ? U.ACCENT_SOFT : 0, on ? U.ACCENT : U.LINE, 8));
        t.setTextColor(on ? U.ACCENT : U.TEXT);
    }

    interface Col { void got(int c); }

    static void swatches(MainActivity a, LinearLayout row, int[] cols, int cur, Col cb) {
        row.removeAllViews();
        for (int c : cols) {
            TextView v = new TextView(a);
            boolean on = c == cur;
            android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
            g.setShape(android.graphics.drawable.GradientDrawable.OVAL);
            g.setColor(c == 0 ? 0xFFFFFFFF : c);
            g.setStroke(U.dp(on ? 3 : 1), on ? U.ACCENT : 0xFF9E9E9E);
            v.setBackground(g);
            if (c == 0) { v.setText("無"); v.setTextSize(11); v.setTextColor(0xFF666666); v.setGravity(Gravity.CENTER); }
            LinearLayout.LayoutParams lp = U.lp(U.dp(34), U.dp(34));
            lp.setMargins(0, U.dp(4), U.dp(10), U.dp(8));
            v.setOnClickListener(x -> cb.got(c));
            row.addView(v, lp);
        }
    }
}
