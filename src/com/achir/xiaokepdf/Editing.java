package com.achir.xiaokepdf;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.RectF;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

/** 編輯工具列：編輯既有文字、新增文字 / 圖片 / 連結、浮水印、頁碼、頁面。 */
public final class Editing {
    private Editing() {}

    static final String[] NAMES = {"編輯文字", "新增文字", "插入表格", "新增圖片", "新增連結", "浮水印", "移除浮水印", "頁首頁尾頁碼", "裁切", "整理頁面"};
    private static int current;

    public static void show(MainActivity a, LinearLayout bar) {
        a.exitModes();
        Doc d = a.doc();
        if (d == null) return;
        String b = d.block(Doc.K_EDIT);
        if (b != null) { a.blocked(d, b); return; }
        bar.removeAllViews();
        bar.setPadding(U.dp(4), U.dp(2), U.dp(4), U.dp(2));
        for (int i = 0; i < NAMES.length; i++) {
            final int k = i;
            TextView t = U.text(a, NAMES[i], 14, U.TEXT);
            t.setPadding(U.dp(12), U.dp(10), U.dp(12), U.dp(10));
            t.setTag(k);
            t.setOnClickListener(v -> choose(a, bar, k));
            bar.addView(t);
        }
        TextView done = U.text(a, "完成", 14, U.ACCENT);
        done.setPadding(U.dp(14), U.dp(10), U.dp(14), U.dp(10));
        done.setOnClickListener(v -> a.exitModes());
        bar.addView(done);
        a.showAnnotBar(true);
        choose(a, bar, current == 1 ? 1 : 0);
    }

    private static void highlight(LinearLayout bar, int k) {
        for (int i = 0; i < bar.getChildCount(); i++) {
            View v = bar.getChildAt(i);
            if (v.getTag() instanceof Integer) {
                boolean on = (Integer) v.getTag() == k;
                v.setBackground(on ? U.round(U.ACCENT_SOFT, 0, 16) : null);
                ((TextView) v).setTextColor(on ? U.ACCENT : U.TEXT);
            }
        }
    }

    static void choose(MainActivity a, LinearLayout bar, int k) {
        Doc d = a.doc();
        switch (k) {
            case 0: case 1:
                current = k;
                highlight(bar, k);
                if (k == 0) editTextMode(a, d);
                else addTextMode(a, d);
                a.showAnnotBar(true);
                return;
            case 2: a.inline.insertTableMode(); break;
            case 3: Tools.pickImage(a, b -> Tools.place(a, "拖曳出圖片的位置與大小（或點一下）", b.getWidth() / (float) b.getHeight(), 200, false,
                    (p, r) -> a.edit("新增圖片", Doc.K_EDIT, pd -> Ops.addImage(pd, d, p, r, b, 1)))); break;
            case 4: Tools.place(a, "框選要變成連結的區域", 0, 120, false, (p, r) ->
                    U.choose(a, "連結到", new String[]{"網址", "文件中的頁面"}, x -> {
                        if (x == 0) U.input(a, "網址", "https://", "https://", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI,
                                t -> a.edit("新增連結", Doc.K_EDIT, pd -> Ops.addLink(pd, d, p, r, t, -1)));
                        else U.input(a, "連到第幾頁", "1–" + d.n, "1", InputType.TYPE_CLASS_NUMBER, t -> {
                            try {
                                int dest = Math.max(0, Math.min(d.n - 1, Integer.parseInt(t.trim()) - 1));
                                a.edit("新增連結", Doc.K_EDIT, pd -> Ops.addLink(pd, d, p, r, null, dest));
                            } catch (NumberFormatException e) { U.toast(a, "請輸入頁碼"); }
                        });
                    })); break;
            case 5: Tools.watermark(a, d); break;
            case 6: Tools.removeWatermark(a); break;
            case 7: Tools.headerFooter(a, d); break;
            case 8: Tools.crop(a, null); break;
            case 9: Organizer.show(a); break;
        }
    }

    /** 點一下頁面上的文字 → 原本的位置直接變成編輯框（像 Word 一樣，整段一起改）。 */
    static void editTextMode(MainActivity a, Doc d) {
        a.setMode(new MainActivity.Mode() {
            @Override public void tap(int page, float x, float y) { a.inline.editAt(d, page, x, y); }
        }, PdfView.T_POINT, "點一下要修改的文字，直接在頁面上打字（點空白處可新增文字）", null, null);
    }

    /** 修改 s..e 這段文字（舊介面）：改成就地編輯那一段。 */
    public static void editRange(MainActivity a, Doc d, int page, TextData.Page tp, int s, int e) {
        List<RectF> rs = tp.rects(s, e);
        if (!rs.isEmpty()) a.inline.editSelection(d, page, rs.get(0));
    }

    /** 取樣文字周圍的背景色（多數頁面是白色，但也支援有底色的頁面）。 */
    static int background(Doc d, int page, RectF r) {
        int W = 800;
        Bitmap b = d.renderWidth(page, W);
        if (b == null) return Color.WHITE;
        float s = b.getWidth() / d.dw(page);
        float[][] pts = {{r.left - 2, r.top - 2}, {r.right + 2, r.top - 2}, {r.left - 2, r.bottom + 2}, {r.right + 2, r.bottom + 2},
                {r.centerX(), r.top - 2}, {r.centerX(), r.bottom + 2}};
        int best = Color.WHITE, bestL = -1;
        int[] counts = new int[pts.length];
        int[] cols = new int[pts.length];
        for (int i = 0; i < pts.length; i++) {
            int x = Math.max(0, Math.min(b.getWidth() - 1, Math.round(pts[i][0] * s)));
            int y = Math.max(0, Math.min(b.getHeight() - 1, Math.round(pts[i][1] * s)));
            cols[i] = b.getPixel(x, y) | 0xFF000000;
        }
        // 最常出現的顏色（容許些微差異）
        for (int i = 0; i < cols.length; i++) for (int j = 0; j < cols.length; j++) if (close(cols[i], cols[j])) counts[i]++;
        for (int i = 0; i < cols.length; i++) {
            int l = Color.red(cols[i]) + Color.green(cols[i]) + Color.blue(cols[i]);
            if (counts[i] > bestL || counts[i] == bestL && l > Color.red(best) + Color.green(best) + Color.blue(best)) { bestL = counts[i]; best = cols[i]; }
        }
        b.recycle();
        return best;
    }

    static boolean close(int a, int b) {
        return Math.abs(Color.red(a) - Color.red(b)) + Math.abs(Color.green(a) - Color.green(b)) + Math.abs(Color.blue(a) - Color.blue(b)) < 30;
    }

    /** 點一下 → 在那裡直接打字（可連續新增）。 */
    static void addTextMode(MainActivity a, Doc d) {
        a.setMode(new MainActivity.Mode() {
            @Override public void tap(int page, float x, float y) { a.inline.addAt(d, page, x, y); }
            @Override public void rect(int page, RectF r) { a.inline.addAt(d, page, r.left, r.top + 8); }
        }, PdfView.T_RECT, "點一下要加文字的位置，直接打字（可連續新增）", null, null);
    }
}
