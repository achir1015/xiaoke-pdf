package com.achir.xiaokepdf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.PopupWindow;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * 像 Word 一樣就地編輯：點頁面上的文字，原本的位置直接變成編輯框，游標在點到的地方；
 * 整段（同一個表格儲存格內）一起編輯並自動換行。上方工具列換成格式列。
 */
public final class Inline {
    private final MainActivity a;
    private Cur cur;
    private LinearLayout bar;
    private Runnable restore;
    private PopupWindow pop;

    Inline(MainActivity a) { this.a = a; }

    public boolean active() { return cur != null; }

    private static class Cur {
        boolean edit;
        Doc doc;
        int page;
        RectF area;          // 原文字範圍（顯示座標）
        float base, wrapW, lineHeight;
        RectF cell;
        String orig;
        TextStyle st;
        String origSt;
        int mask;            // 背景色（蓋住原文字）
        int caretTmp;        // 開始時游標位置
        float lastBottom;    // 原本最後一行字的下緣（判斷字有沒有變長）
        EditText et;
        View.OnLayoutChangeListener resize;
    }

    // ================================================================ 找段落

    /** 一行：字元索引、範圍、字級、基線。 */
    static class Line {
        final List<Integer> idx = new ArrayList<>();
        float x1 = Float.MAX_VALUE, x2 = -Float.MAX_VALUE, top = Float.MAX_VALUE, bottom = -Float.MAX_VALUE, size, base;
    }

    /** 頁面文字分行；cell 不為 null 時只取中心點在儲存格內的字。 */
    static List<Line> lines(TextData.Page tp, RectF cell) {
        List<Line> out = new ArrayList<>();
        Line cur = null;
        float baseSum = 0;
        int n = 0;
        for (int i = 0; i <= tp.count(); i++) {
            boolean end = i == tp.count() || tp.text.charAt(i) == '\n';
            if (!end) {
                if (!tp.real(i)) { if (cur != null) cur.idx.add(i); continue; }   // 字中間的空白
                RectF r = tp.rect(i);
                if (cell != null && !cell.contains(r.centerX(), r.centerY())) continue;
                // 同一行裡相隔太遠的字（多欄排版）分成不同行
                if (cur != null && r.left - cur.x2 > Math.max(r.height(), cur.size) * 3) { finish(out, cur, baseSum / n); cur = null; }
                if (cur == null) { cur = new Line(); baseSum = 0; n = 0; }
                cur.idx.add(i);
                cur.x1 = Math.min(cur.x1, r.left); cur.x2 = Math.max(cur.x2, r.right);
                cur.top = Math.min(cur.top, r.top); cur.bottom = Math.max(cur.bottom, r.bottom);
                cur.size = Math.max(cur.size, i < tp.fs.length ? tp.fs[i] : 12);
                baseSum += r.top + r.height() / 1.15f; n++;
            } else if (cur != null) { finish(out, cur, baseSum / n); cur = null; }
        }
        java.util.Collections.sort(out, (p, q) -> Float.compare(p.base, q.base) != 0 ? Float.compare(p.base, q.base) : Float.compare(p.x1, q.x1));
        return out;
    }

    private static void finish(List<Line> out, Line l, float base) {
        l.base = base;
        out.add(l);
    }

    static String lineText(TextData.Page tp, Line l) {
        StringBuilder sb = new StringBuilder();
        for (int i : l.idx) sb.append(tp.text.charAt(i));
        return sb.toString().replaceAll("\\s+$", "");
    }

    /** 點到的位置所在的表格儲存格（四邊都有框線）；不在表格裡回傳 null。 */
    static RectF cellAt(Ops.Rules ru, float x, float y) {
        float tol = 1.5f, x1 = -Float.MAX_VALUE, x2 = Float.MAX_VALUE, y1 = -Float.MAX_VALUE, y2 = Float.MAX_VALUE;
        for (float[] v : ru.v) if (y >= v[1] - tol && y <= v[2] + tol) {
            if (v[0] <= x && v[0] > x1) x1 = v[0];
            if (v[0] >= x && v[0] < x2) x2 = v[0];
        }
        if (x1 == -Float.MAX_VALUE || x2 == Float.MAX_VALUE) return null;
        float mx = (x1 + x2) / 2;
        // 橫框線要橫跨整個格子（底線、刪除線之類的短線不算）
        for (float[] h : ru.h) if (h[1] <= x1 + 2 && h[2] >= x2 - 2) {
            if (h[0] <= y && h[0] > y1) y1 = h[0];
            if (h[0] >= y && h[0] < y2) y2 = h[0];
        }
        if (y1 == -Float.MAX_VALUE || y2 == Float.MAX_VALUE) return null;
        return new RectF(x1, y1, x2, y2);
    }

    static boolean cjk(char c) { return TextData.isCjk(c) || c >= 0xFF00 && c <= 0xFFEF || c >= 0x3000 && c <= 0x303F; }

    /** 點到的段落：連續、字級相同、行距一致、左邊對齊相近的行。回傳 null＝沒點到文字。 */
    static Cur findBlock(Doc d, int page, float x, float y) {
        TextData.Page tp = d.text(page);
        RectF cell = cellAt(d.rules(page), x, y);
        List<Line> ls = lines(tp, cell);
        int hit = -1;
        for (int k = 0; k < ls.size(); k++) {
            Line l = ls.get(k);
            if (y >= l.top - 2 && y <= l.bottom + 2 && x >= l.x1 - 6 && x <= l.x2 + 6) { hit = k; break; }
        }
        if (hit < 0) return null;
        int s = hit, e = hit;
        float pitch = 0;
        while (e + 1 < ls.size() && ok(ls.get(e), ls.get(e + 1), pitch)) { if (pitch == 0) pitch = ls.get(e + 1).base - ls.get(e).base; e++; }
        while (s > 0 && ok(ls.get(s), ls.get(s - 1), pitch)) { if (pitch == 0) pitch = ls.get(s).base - ls.get(s - 1).base; s--; }

        StringBuilder text = new StringBuilder();
        int caret = 0;
        RectF area = null;
        float size = 0;
        for (int k = s; k <= e; k++) {
            Line l = ls.get(k);
            String t = lineText(tp, l);
            if (text.length() > 0 && t.length() > 0) {
                char p = text.charAt(text.length() - 1), q = t.charAt(0);
                if (!(cjk(p) || cjk(q) || p == ' ')) text.append(' ');
            }
            if (k == hit) {
                // 游標放在點到的字
                int best = t.length();
                float bd = Float.MAX_VALUE;
                for (int j = 0; j < l.idx.size() && j < t.length(); j++) {
                    int i = l.idx.get(j);
                    if (!tp.real(i)) continue;
                    RectF r = tp.rect(i);
                    boolean left = x < r.centerX();
                    float dd = Math.abs(x - (left ? r.left : r.right));
                    if (dd < bd) { bd = dd; best = left ? j : j + 1; }
                }
                caret = text.length() + best;
            }
            text.append(t);
            RectF lr = new RectF(l.x1, l.top, l.x2, l.bottom);
            if (area == null) area = lr; else area.union(lr);
            size = Math.max(size, l.size);
        }
        Cur c = new Cur();
        c.edit = true;
        c.doc = d;
        c.page = page;
        c.area = area;
        c.cell = cell;
        c.orig = text.toString().replaceAll("\\s+$", "");
        c.base = ls.get(s).base;
        c.lineHeight = e > s ? (ls.get(e).base - ls.get(s).base) / (e - s) : size * 1.25f;
        // 換行寬度：表格裡＝儲存格寬（扣內距），否則＝整個文字欄
        if (cell != null) {
            float right = cell.right - Math.max(2, area.left - cell.left);
            c.wrapW = Math.max(size * 2, right - area.left);
        } else {
            float right = area.right;
            for (Line l : ls) right = Math.max(right, l.x2);
            right = Math.min(right, d.dw(page) - 18);
            c.wrapW = Math.max(area.width(), right - area.left);
        }
        c.st = new TextStyle();
        c.st.size = Math.round(size * 10) / 10f;
        c.st.lineHeight = 0;
        c.caretTmp = Math.min(caret, c.orig.length());
        c.lastBottom = ls.get(e).base + size * 0.25f;
        return c;
    }

    private static boolean ok(Line a, Line b, float pitch) {
        float gap = Math.abs(b.base - a.base);
        return Math.abs(a.size - b.size) <= a.size * 0.15f
                && gap <= a.size * 1.9f && (pitch == 0 || Math.abs(gap - pitch) <= pitch * 0.25f)
                && b.x1 < a.x2 && b.x2 > a.x1 - a.size * 2
                && Math.abs(b.x1 - a.x1) < Math.max(a.size * 3, (a.x2 - a.x1) * 0.5f);
    }

    // ================================================================ 取色

    /** {背景色, 文字顏色}：背景取外框一圈最常見的顏色，文字取和背景差最多的顏色。 */
    static int[] colors(Doc d, int page, RectF r) {
        int bg = Editing.background(d, page, r), fg = Color.BLACK;
        Bitmap b = d.renderWidth(page, 1200);
        if (b != null) {
            float s = b.getWidth() / d.dw(page);
            int x0 = Math.max(0, (int) (r.left * s)), y0 = Math.max(0, (int) (r.top * s));
            int x1 = Math.min(b.getWidth() - 1, (int) (r.right * s)), y1 = Math.min(b.getHeight() - 1, (int) (r.bottom * s));
            int fd = 0;
            for (int y = y0; y <= y1; y += 2) for (int x = x0; x <= x1; x += 2) {
                int c = b.getPixel(x, y);
                int dd = Math.abs(Color.red(c) - Color.red(bg)) + Math.abs(Color.green(c) - Color.green(bg)) + Math.abs(Color.blue(c) - Color.blue(bg));
                if (dd > fd) { fd = dd; fg = c | 0xFF000000; }
            }
            b.recycle();
            if (fd < 120) fg = Color.BLACK;
            int sum = Color.red(fg) + Color.green(fg) + Color.blue(fg);
            int spread = Math.max(Color.red(fg), Math.max(Color.green(fg), Color.blue(fg))) - Math.min(Color.red(fg), Math.min(Color.green(fg), Color.blue(fg)));
            if (sum < 200 && spread < 40) fg = Color.BLACK;   // 深色字一律當黑色（反鋸齒會讓顏色偏淡）
        }
        return new int[]{bg, fg};
    }

    // ================================================================ 開始編輯

    /** 點一下：點到文字就就地編輯那一段，點到空白就新增文字。 */
    public void editAt(Doc d, int page, float x, float y) {
        if (active()) { commit(); return; }
        String b = d.block(Doc.K_EDIT);
        if (b != null) { a.blocked(d, b); return; }
        U.bg.execute(() -> {
            Cur c = findBlock(d, page, x, y);
            if (c == null) { RectF cell = cellAt(d.rules(page), x, y); U.ui(() -> addIn(d, page, x, y, cell)); return; }
            int[] col = colors(d, page, c.area);
            c.mask = col[0];
            TextStyle saved = TextStyle.load(a, "edit");
            c.st.family = saved.family;
            c.st.color = col[1];
            U.ui(() -> open(c));
        });
    }

    public void addAt(Doc d, int page, float x, float y) {
        if (active()) { commit(); return; }
        U.bg.execute(() -> { RectF cell = cellAt(d.rules(page), x, y); U.ui(() -> addIn(d, page, x, y, cell)); });
    }

    private void addIn(Doc d, int page, float x, float y, RectF cell) {
        if (active()) { commit(); return; }
        String b = d.block(Doc.K_EDIT);
        if (b != null) { a.blocked(d, b); return; }
        Cur c = new Cur();
        c.edit = false;
        c.doc = d;
        c.page = page;
        c.st = TextStyle.load(a, "add");
        c.st.lineHeight = 0;
        c.base = y + c.st.size * 0.35f;
        c.wrapW = Math.max(80, d.dw(page) - x - 24);
        if (cell != null) {
            // 空白的表格儲存格：從格子左上角開始打字，在格子寬度內換行
            c.cell = cell;
            x = cell.left + 4;
            c.wrapW = Math.max(c.st.size * 2, cell.width() - 8);
            c.base = cell.top + 4 + c.st.size * 0.95f;
            c.lastBottom = cell.bottom - 3;
        }
        c.area = new RectF(x, c.base - c.st.size * 1.15f, x + c.wrapW, c.base + c.st.size * 0.15f);
        c.lineHeight = c.st.size * 1.25f;
        c.orig = "";
        c.caretTmp = 0;
        c.mask = 0;
        open(c);
    }

    /** 從選取的文字開始編輯（選取列的「改文字」）。 */
    public void editSelection(Doc d, int page, RectF first) {
        editAt(d, page, first.left + 1, first.centerY());
    }

    private void open(Cur c) {
        if (a.doc() != c.doc) return;
        PdfView v = a.view;
        if (v.vrot != 0) v.rotateView(-v.vrot);
        v.clearSelection();
        cur = c;
        c.origSt = sig(c.st);
        EditText et = new EditText(a);
        c.et = et;
        et.setText(c.orig);
        et.setPadding(0, 0, 0, 0);
        et.setIncludeFontPadding(false);
        et.setGravity(Gravity.TOP | Gravity.START);
        et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        et.setImeOptions(EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        et.setHorizontallyScrolling(false);
        et.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int b, int n, int d) {}
            public void onTextChanged(CharSequence s, int b, int n, int d) {}
            public void afterTextChanged(Editable e) { layout(); }
        });
        a.readerFrame().addView(et, new FrameLayout.LayoutParams(1, FrameLayout.LayoutParams.WRAP_CONTENT));
        if (c.edit) { v.maskPage = c.page; v.maskRect = new RectF(c.area.left - 1.5f, c.area.top - 1.5f, c.area.right + 1.5f, c.area.bottom + 1.5f); v.maskColor = c.mask; }
        v.onFrame = this::layout;
        c.resize = (x, l, t, r, b, ol, ot, or, ob) -> { if (b != ob) v.postDelayed(this::reveal, 80); };
        v.addOnLayoutChangeListener(c.resize);
        style();
        layout();
        et.requestFocus();
        et.setSelection(Math.min(c.caretTmp, et.length()));
        InputMethodManager imm = (InputMethodManager) a.getSystemService(Context.INPUT_METHOD_SERVICE);
        et.postDelayed(() -> { if (cur == c) imm.showSoftInput(et, InputMethodManager.SHOW_IMPLICIT); }, 120);
        et.postDelayed(this::reveal, 450);
        showBar();
        a.setHint(c.edit ? "直接修改文字；點頁面其他地方或按「完成」套用" : "輸入新文字；點頁面其他地方或按「完成」套用");
    }

    private static String sig(TextStyle s) {
        return s.family + "|" + s.size + "|" + s.color + "|" + s.bg + "|" + s.bold + s.underline + s.strike;
    }

    /** 文字樣式（字型、大小、顏色、粗體、底線、刪除線）。 */
    private void style() {
        Cur c = cur;
        if (c == null) return;
        EditText et = c.et;
        TextStyle st = c.st;
        String t = et.getText().toString();
        et.setTypeface(st.previewTypeface(t.isEmpty() ? (c.orig.isEmpty() ? "A" : c.orig) : t));
        et.getPaint().setFakeBoldText(st.bold && !et.getTypeface().isBold());
        int f = Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG | (st.underline ? Paint.UNDERLINE_TEXT_FLAG : 0) | (st.strike ? Paint.STRIKE_THRU_TEXT_FLAG : 0);
        et.setPaintFlags(f);
        et.setTextColor(st.color);
        GradientDrawable g = new GradientDrawable();
        g.setColor(st.bg != 0 ? st.bg : c.edit ? c.mask : 0x22FFFFFF);
        g.setStroke(U.dp(1.5f), U.ACCENT);
        et.setBackground(g);
        et.setPadding(0, 0, 0, 0);
    }

    /** 依目前縮放、捲動把編輯框放到頁面上原本文字的位置（每次重繪都會呼叫）。 */
    void layout() {
        Cur c = cur;
        if (c == null) return;
        PdfView v = a.view;
        if (v.doc != c.doc) return;
        float s = v.s();
        EditText et = c.et;
        TextStyle st = c.st;
        float lh = c.edit ? Math.max(c.lineHeight, st.size * 1.05f) : st.size * 1.25f;
        float px = st.size * s;
        if (Math.abs(et.getTextSize() - px) > 0.1f) et.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
        String t = et.getText().toString();
        android.graphics.Typeface tf = st.previewTypeface(t.isEmpty() ? (c.orig.isEmpty() ? "A" : c.orig) : t);
        if (tf != et.getTypeface()) et.setTypeface(tf);
        Paint.FontMetrics fm = et.getPaint().getFontMetrics();
        float extra = lh * s - et.getPaint().getFontSpacing();
        if (Math.abs(et.getLineSpacingExtra() - extra) > 0.5f) et.setLineSpacing(extra, 1f);
        float[] p = {c.area.left, c.base};
        Matrix m = v.pageMatrix(c.page);
        m.mapPoints(p);
        int w = Math.max(Math.round(c.wrapW * s), Math.round(st.size * s * 2));
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) et.getLayoutParams();
        if (lp.width != w) { lp.width = w; et.setLayoutParams(lp); }
        et.setX(p[0]);
        et.setY(p[1] + fm.ascent);         // 第一行基線對齊原本的基線
        et.setMinHeight(Math.round(lh * s));
        // 表格裡：超出儲存格下緣時用紅框提醒
        boolean over = false;
        if (c.cell != null && et.getHeight() > 0) {
            float[] q = {c.cell.left, c.cell.bottom};
            m.mapPoints(q);
            over = et.getY() + et.getHeight() > q[1] + U.dp(2);
        }
        Object tag = et.getTag();
        if (!Boolean.valueOf(over).equals(tag)) {
            et.setTag(over);
            GradientDrawable g = (GradientDrawable) et.getBackground();
            if (g != null) g.setStroke(U.dp(over ? 2.5f : 1.5f), over ? 0xFFE53935 : U.ACCENT);
            if (over) U.toast(a, "按「完成」後會自動撐高這一列");
        }
    }

    /** 鍵盤出現後，捲動頁面讓編輯框看得到。 */
    private void reveal() {
        Cur c = cur;
        if (c == null) return;
        PdfView v = a.view;
        float top = c.et.getY(), bottom = top + Math.max(c.et.getHeight(), U.dp(30));
        float margin = U.dp(24), dy = 0;
        if (bottom > v.getHeight() - margin) dy = bottom - (v.getHeight() - margin);
        if (top - dy < margin) dy = top - margin;
        float dx = 0, left = c.et.getX(), right = left + c.et.getWidth();
        if (right > v.getWidth() && left > 0) dx = Math.min(left - U.dp(8), right - v.getWidth() + U.dp(8));
        else if (left < 0) dx = left - U.dp(8);
        if (dx != 0 || dy != 0) v.panBy(dx, dy);
    }

    // ================================================================ 格式列

    private void showBar() {
        bar = a.annotBar();
        final LinearLayout toolbar = bar;
        restore = a.annotBarVisible() ? () -> Editing.show(a, toolbar) : () -> a.showAnnotBar(false);
        a.showAnnotBar(true);
        fillBar();
    }

    private void fillBar() {
        Cur c = cur;
        if (c == null || bar == null) return;
        TextStyle st = c.st;
        bar.removeAllViews();
        bar.setPadding(U.dp(4), U.dp(2), U.dp(4), U.dp(2));
        TextView fam = btn(TextStyle.FAMILIES[st.family].replaceAll("（.*）", "") + " ▾", false, v -> choice(v, TextStyle.FAMILIES, st.family, k -> st.family = k));
        bar.addView(fam);
        bar.addView(btn("－", false, v -> st.size = Math.max(4, Math.round((st.size - 1) * 2) / 2f)));
        TextView sz = btn(TextStyle.fmt(st.size), false, v -> U.input(a, "字級（pt）", "pt", TextStyle.fmt(st.size), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL, t -> {
            try { st.size = Math.max(4, Math.min(144, Float.parseFloat(t.trim()))); } catch (Exception ignored) {}
            refresh();
            focus();
        }));
        sz.setMinWidth(U.dp(40));
        bar.addView(sz);
        bar.addView(btn("＋", false, v -> st.size = Math.min(144, Math.round((st.size + 1) * 2) / 2f)));
        TextView b = btn("B", st.bold, v -> st.bold = !st.bold);
        b.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        TextView u = btn("U", st.underline, v -> st.underline = !st.underline);
        u.setPaintFlags(u.getPaintFlags() | Paint.UNDERLINE_TEXT_FLAG);
        TextView s = btn("S", st.strike, v -> st.strike = !st.strike);
        s.setPaintFlags(s.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG);
        b.setContentDescription("粗體"); u.setContentDescription("底線"); s.setContentDescription("刪除線");
        bar.addView(b); bar.addView(u); bar.addView(s);
        TextView fg = btn("A", false, v -> swatches(v, TextStyle.FG, st.color, x -> st.color = x));
        fg.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        fg.setBackground(underline(st.color));
        fg.setContentDescription("文字顏色");
        TextView bgb = btn("▧", false, v -> swatches(v, TextStyle.BG, st.bg, x -> st.bg = x));
        bgb.setBackground(underline(st.bg != 0 ? st.bg : 0xFFCCCCCC));
        bgb.setContentDescription("背景顏色");
        bar.addView(fg); bar.addView(bgb);
        TextView cancel = U.text(a, "取消", 14, U.SUB);
        cancel.setPadding(U.dp(14), U.dp(10), U.dp(10), U.dp(10));
        cancel.setOnClickListener(v -> cancel());
        TextView done = U.text(a, "完成", 14, U.ACCENT);
        done.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        done.setPadding(U.dp(10), U.dp(10), U.dp(14), U.dp(10));
        done.setOnClickListener(v -> commit());
        if (c.cell != null) {
            bar.addView(tbtn("＋列", "在下方插入一列", () -> insertRow()));
            bar.addView(tbtn("＋欄", "在右邊插入一欄", () -> insertColumn()));
            bar.addView(tbtn("合併", "合併儲存格", () -> mergeStart()));
        }
        bar.addView(cancel); bar.addView(done);
    }

    private android.graphics.drawable.Drawable underline(int color) {
        GradientDrawable line = new GradientDrawable();
        line.setColor(color);
        android.graphics.drawable.LayerDrawable ld = new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{line});
        ld.setLayerInset(0, U.dp(12), U.dp(34), U.dp(12), U.dp(6));
        return ld;
    }

    private TextView btn(String t, boolean on, View.OnClickListener l) {
        TextView v = U.text(a, t, 16, on ? U.ACCENT : U.TEXT);
        v.setGravity(Gravity.CENTER);
        v.setMinWidth(U.dp(40));
        v.setMinHeight(U.dp(44));
        v.setPadding(U.dp(8), U.dp(6), U.dp(8), U.dp(6));
        if (on) v.setBackground(U.round(U.ACCENT_SOFT, 0, 8));
        v.setOnClickListener(x -> {
            l.onClick(x);
            refresh();
            focus();
        });
        return v;
    }

    private void refresh() { style(); layout(); fillBar(); }

    private void focus() {
        Cur c = cur;
        if (c == null) return;
        c.et.requestFocus();
        InputMethodManager imm = (InputMethodManager) a.getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.showSoftInput(c.et, InputMethodManager.SHOW_IMPLICIT);
    }

    interface Pick { void pick(int v); }

    /** 格式列下方的小視窗（不搶走編輯框的焦點，鍵盤不會收起來）。 */
    private void popup(View anchor, View content) {
        if (pop != null) pop.dismiss();
        HorizontalScrollView hs = new HorizontalScrollView(a);
        hs.setHorizontalScrollBarEnabled(false);
        hs.addView(content);
        hs.setBackground(U.round(U.CARD, U.LINE, 10));
        hs.setElevation(U.dp(6));
        pop = new PopupWindow(hs, LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT, false);
        pop.setOutsideTouchable(true);
        pop.setElevation(U.dp(6));
        pop.showAsDropDown(anchor, 0, U.dp(2));
    }

    private void swatches(View anchor, int[] cols, int curC, Pick p) {
        LinearLayout row = U.hbox(a);
        row.setPadding(U.dp(8), U.dp(6), U.dp(2), U.dp(6));
        for (int c : cols) {
            TextView v = new TextView(a);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            g.setColor(c == 0 ? 0xFFFFFFFF : c);
            g.setStroke(U.dp(c == curC ? 3 : 1), c == curC ? U.ACCENT : 0xFF9E9E9E);
            v.setBackground(g);
            if (c == 0) { v.setText("無"); v.setTextSize(11); v.setTextColor(0xFF666666); v.setGravity(Gravity.CENTER); }
            LinearLayout.LayoutParams lp = U.lp(U.dp(34), U.dp(34));
            lp.setMargins(0, 0, U.dp(8), 0);
            v.setOnClickListener(x -> { p.pick(c); if (pop != null) pop.dismiss(); refresh(); focus(); });
            row.addView(v, lp);
        }
        popup(anchor, row);
    }

    private void choice(View anchor, String[] items, int curK, Pick p) {
        LinearLayout row = U.hbox(a);
        for (int i = 0; i < items.length; i++) {
            final int k = i;
            TextView v = U.text(a, items[i].replaceAll("（.*）", ""), 15, k == curK ? U.ACCENT : U.TEXT);
            v.setPadding(U.dp(14), U.dp(12), U.dp(14), U.dp(12));
            TextStyle ts = new TextStyle();
            ts.family = k;
            v.setTypeface(ts.typeface());
            v.setOnClickListener(x -> { p.pick(k); if (pop != null) pop.dismiss(); refresh(); focus(); });
            row.addView(v);
        }
        popup(anchor, row);
    }

    // ================================================================ 完成 / 取消

    private void close() {
        Cur c = cur;
        if (c == null) return;
        cur = null;
        if (pop != null) { pop.dismiss(); pop = null; }
        PdfView v = a.view;
        v.onFrame = null;
        v.maskPage = -1; v.maskRect = null;
        v.removeOnLayoutChangeListener(c.resize);
        InputMethodManager imm = (InputMethodManager) a.getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(c.et.getWindowToken(), 0);
        a.readerFrame().removeView(c.et);
        v.invalidate();
        Runnable r = restore;
        restore = null;
        bar = null;
        if (r != null) r.run();
    }

    public void cancel() { close(); }

    /** 套用（點頁面其他地方、按「完成」、離開編輯模式時）。 */
    public void commit() { commit(null); }

    /** 套用；after 在套用完成（或沒有變更）之後執行。 */
    public void commit(Runnable after) {
        Cur c = cur;
        if (c == null) { if (after != null) after.run(); return; }
        String text = c.et.getText().toString().replaceAll("\\s+$", "");
        TextStyle st = c.st.copy();
        boolean changed = !text.equals(c.orig) || !sig(c.st).equals(c.origSt);
        close();
        if (!changed || !c.edit && text.trim().isEmpty()) { if (after != null) after.run(); return; }
        st.save(a, c.edit ? "edit" : "add");
        if (c.edit) {
            st.lineHeight = Math.max(c.lineHeight, st.size * 1.05f);
            a.edit(text.trim().isEmpty() ? "刪除文字" : "編輯文字", Doc.K_EDIT,
                    pd -> Ops.replaceBlock(pd, c.doc, c.page, c.area, c.base, c.wrapW, text, st, c.mask, fitInfo(c)), after);
        } else {
            st.lineHeight = 0;
            float x = c.area.left;
            a.edit("新增文字", Doc.K_EDIT, pd -> {
                TextStyle s2 = TableOps.fit(pd, c.doc, c.page, text, st, c.base, c.wrapW, fitInfo(c));
                Ops.addText(pd, c.doc, c.page, new RectF(x - 1, c.base - s2.size, x - 1 + c.wrapW + 1, c.base), text, s2);
            }, after);
        }
    }

    // ================================================================ 表格

    private TextView tbtn(String t, String desc, Runnable r) {
        TextView v = U.text(a, t, 15, U.ACCENT);
        v.setGravity(Gravity.CENTER);
        v.setMinHeight(U.dp(44));
        v.setPadding(U.dp(10), U.dp(6), U.dp(10), U.dp(6));
        v.setContentDescription(desc);
        v.setOnClickListener(x -> r.run());
        return v;
    }

    /** 分隔線 split 以下內容（文字、框線）的最低點；沒有內容時回傳 split。 */
    static float belowMax(Doc d, int page, float split) {
        float m = split;
        TextData.Page tp = d.text(page);
        for (int i = 0; i < tp.count(); i++) {
            if (!tp.real(i) || Character.isWhitespace(tp.text.charAt(i))) continue;
            RectF r = tp.rect(i);
            if (r.centerY() > split) m = Math.max(m, r.bottom);
        }
        Ops.Rules ru = d.rules(page);
        for (float[] v : ru.v) if (v[2] > split) m = Math.max(m, v[2]);
        for (float[] h : ru.h) if (h[0] > split) m = Math.max(m, h[0]);
        return m;
    }

    /** 點在既有的表格裡（直框線跨過這個高度）時，改放到那個表格下面，免得把舊表格的直線一起拉長。 */
    static float belowTables(Doc d, int page, float y) {
        Ops.Rules ru = d.rules(page);
        for (int k = 0; k < 10; k++) {
            float ny = y;
            for (float[] v : ru.v) if (v[1] < y - 1 && v[2] > y + 1) ny = Math.max(ny, v[2] + 8);
            if (ny == y) break;
            y = ny;
        }
        return y;
    }

    /** 表格範圍：沿著這一格的左右直框線找上下範圍、沿著上下橫框線找左右範圍（不會連到旁邊別的表格）。 */
    static RectF tableAt(Doc d, int page, RectF cell) {
        Ops.Rules ru = d.rules(page);
        float cx = cell.centerX(), cy = cell.centerY();
        RectF t = new RectF(cell);
        for (float[] v : ru.v)
            if ((Math.abs(v[0] - cell.left) < 1.5f || Math.abs(v[0] - cell.right) < 1.5f) && v[1] <= cy && v[2] >= cy) { t.top = Math.min(t.top, v[1]); t.bottom = Math.max(t.bottom, v[2]); }
        for (float[] h : ru.h)
            if ((Math.abs(h[0] - cell.top) < 1.5f || Math.abs(h[0] - cell.bottom) < 1.5f) && h[1] <= cx && h[2] >= cx) { t.left = Math.min(t.left, h[1]); t.right = Math.max(t.right, h[2]); }
        return t;
    }

    /** 撐高用的資訊（在背景執行緒、套用前呼叫）。 */
    private static TableOps.Fit fitInfo(Cur c) {
        if (c.cell == null) return null;
        TableOps.Fit f = new TableOps.Fit();
        f.cell = c.cell;
        f.lastBottom = c.lastBottom;
        f.below = belowMax(c.doc, c.page, c.cell.bottom - 1.5f);
        f.pageH = c.doc.dh(c.page);
        return f;
    }

    private interface CellJob { void run(Doc d, int page, RectF cell); }

    /** 先完成目前的編輯，再重新找到這一格（表格可能已經被撐高）。 */
    private void withCell(CellJob job) {
        Cur c = cur;
        if (c == null || c.cell == null) return;
        Doc d = c.doc;
        int page = c.page;
        float px = c.cell.left + 3, py = c.cell.top + 3;
        commit(() -> U.bg.execute(() -> {
            RectF cell = cellAt(d.rules(page), px, py);
            U.ui(() -> { if (cell == null) U.toast(a, "找不到這個儲存格"); else job.run(d, page, cell); });
        }));
    }

    /** 在目前儲存格下方插入一列。 */
    void insertRow() {
        withCell((d, page, cell) -> U.bg.execute(() -> {
            RectF table = tableAt(d, page, cell);
            float h = cell.height();
            boolean room = belowMax(d, page, cell.bottom - 1.5f) + h <= d.dh(page) - 18;
            U.ui(() -> {
                if (!room) { U.toast(a, "頁面下方的空間不夠，無法插入新的一列"); return; }
                a.edit("插入表格列", Doc.K_EDIT, pd -> TableOps.insertRow(pd, d, page, cell, table, h));
            });
        }));
    }

    /** 在目前儲存格右邊插入一欄；右邊沒空間時，從這一欄沒用到的右半邊切出新的一欄。 */
    void insertColumn() {
        withCell((d, page, cell) -> U.bg.execute(() -> {
            RectF table = tableAt(d, page, cell);
            float w = Math.min(cell.width(), 120);
            if (table.right + w <= d.dw(page) - 18) {
                U.ui(() -> a.edit("插入表格欄", Doc.K_EDIT, pd -> TableOps.insertColumn(pd, d, page, cell, table, w)));
                return;
            }
            TextData.Page tp = d.text(page);
            float right = cell.left + 4;
            for (int i = 0; i < tp.count(); i++) {
                if (!tp.real(i) || Character.isWhitespace(tp.text.charAt(i))) continue;
                RectF r = tp.rect(i);
                if (r.centerX() > cell.left && r.centerX() < cell.right && r.centerY() > table.top && r.centerY() < table.bottom) right = Math.max(right, r.right);
            }
            float avail = cell.right - right - 6;
            float x = cell.right - Math.min(avail, cell.width() / 2);
            U.ui(() -> {
                if (avail < 30) { U.toast(a, "這一欄的字已經填滿，右邊也沒有空間，無法插入新的一欄"); return; }
                a.edit("插入表格欄", Doc.K_EDIT, pd -> TableOps.line(pd, d, page, x, table.top, x, table.bottom));
            });
        }));
    }

    /** 合併儲存格：先選這一格，再點要一起合併的格子。 */
    void mergeStart() {
        withCell((d, page, first) -> a.setMode(new MainActivity.Mode() {
            @Override public void tap(int p, float x, float y) {
                U.bg.execute(() -> {
                    RectF other = p == page ? cellAt(d.rules(p), x, y) : null;
                    U.ui(() -> {
                        if (other == null) { U.toast(a, "請點同一頁表格裡的儲存格"); return; }
                        RectF box = new RectF(first);
                        box.union(other);
                        a.edit("合併儲存格", Doc.K_EDIT, pd -> TableOps.merge(pd, d, p, box), () -> a.editMode());
                    });
                });
            }
        }, PdfView.T_POINT, "點一下要和它合併的儲存格（中間的格子也會一起合併）", null, null));
    }

    /** 插入表格：選列數、欄數，再點要放的位置。 */
    public void insertTableMode() {
        commit();
        Doc d = a.doc();
        if (d == null) return;
        LinearLayout l = U.vbox(a);
        l.setPadding(U.dp(20), U.dp(8), U.dp(20), 0);
        l.addView(U.text(a, "列數", 13, U.SUB));
        EditText rows = U.edit(a, "列數", String.valueOf(a.prefs.getInt("tbl_rows", 3)));
        rows.setInputType(InputType.TYPE_CLASS_NUMBER);
        l.addView(rows);
        l.addView(U.text(a, "欄數", 13, U.SUB));
        EditText cols = U.edit(a, "欄數", String.valueOf(a.prefs.getInt("tbl_cols", 3)));
        cols.setInputType(InputType.TYPE_CLASS_NUMBER);
        l.addView(cols);
        l.addView(U.text(a, "接著點一下頁面上要放表格的位置（表格左上角），下面的內容會自動往下移。", 12, U.SUB));
        U.dlg(a).setTitle("插入表格").setView(l).setPositiveButton("下一步", (x, w) -> {
            int r, c;
            try { r = Math.max(1, Math.min(50, Integer.parseInt(rows.getText().toString().trim()))); } catch (Exception e) { r = 3; }
            try { c = Math.max(1, Math.min(20, Integer.parseInt(cols.getText().toString().trim()))); } catch (Exception e) { c = 3; }
            a.prefs.edit().putInt("tbl_rows", r).putInt("tbl_cols", c).apply();
            final int R = r, C = c;
            a.setMode(new MainActivity.Mode() {
                @Override public void tap(int page, float tx, float ty0) {
                    U.bg.execute(() -> {
                        float ty = belowTables(d, page, ty0);
                        float x0 = Math.max(18, Math.min(tx, d.dw(page) - 18 - 60 * C));
                        float w2 = d.dw(page) - 18 - x0, rowH = 24, H = R * rowH;
                        float low = belowMax(d, page, ty - 2);
                        boolean push = low > ty - 2 && low + H + 6 <= d.dh(page) - 18;
                        U.ui(() -> a.edit("插入表格", Doc.K_EDIT, pd -> TableOps.addTable(pd, d, page, x0, ty, w2, R, C, rowH, push), () -> {
                            if (!push && low > ty - 2) U.toast(a, "下方空間不夠，所以沒有把內容往下移");
                            else U.toast(a, "點表格的格子就可以直接打字");
                            a.editMode();
                        }));
                    });
                }
            }, PdfView.T_POINT, "點一下要放 " + R + " × " + C + " 表格的位置（左上角）", null, null);
        }).setNegativeButton("取消", null).show();
    }
}
