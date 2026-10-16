package com.achir.xiaokepdf;

import android.graphics.RectF;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationTextMarkup;

import java.util.ArrayList;
import java.util.List;

/** 註解工具列：便利貼、文字標記、圖形、手繪、文字框、印章。 */
public final class Comments {
    private Comments() {}

    static final String[] NAMES = {"選取", "便利貼", "螢光筆", "底線", "刪除線", "波浪線", "文字框", "矩形", "橢圓", "直線", "箭頭", "手繪", "印章"};
    static final String[] KEYS = {"sel", "note", "hl", "ul", "so", "sq", "ft", "rect", "oval", "line", "arrow", "ink", "stamp"};
    static final int[] DEF = {0, 0xFFFFC107, 0xFFFFD400, 0xFF1E63E9, 0xFFE53935, 0xFF8E24AA, 0xFF1D1F23, 0xFFE53935, 0xFF1E88E5, 0xFFE53935, 0xFFE53935, 0xFF1E63E9, 0xFFE53935};
    public static final int[] PALETTE = {0xFFFFD400, 0xFFFF9800, 0xFFE53935, 0xFFE91E63, 0xFF8E24AA, 0xFF1E63E9, 0xFF00ACC1, 0xFF43A047, 0xFF1D1F23, 0xFF9E9E9E};

    private static int current;
    private static TextView colorBtn;

    public static void show(MainActivity a, LinearLayout bar, HorizontalScrollView scroll) {
        a.exitModes();
        if (a.doc() == null) return;
        String b = a.doc().block(Doc.K_ANNOT);
        if (b != null) { a.blocked(a.doc(), b); return; }
        build(a, bar);
        a.showAnnotBar(true);
        choose(a, bar, current == 0 ? 2 : current);
    }

    private static void build(MainActivity a, LinearLayout bar) {
        bar.removeAllViews();
        bar.setPadding(U.dp(4), U.dp(2), U.dp(4), U.dp(2));
        for (int i = 0; i < NAMES.length; i++) {
            final int k = i;
            TextView t = U.text(a, NAMES[i], 14, U.TEXT);
            t.setPadding(U.dp(12), U.dp(10), U.dp(12), U.dp(10));
            t.setOnClickListener(v -> choose(a, bar, k));
            t.setTag(k);
            bar.addView(t);
        }
        colorBtn = U.text(a, "●", 22, U.ACCENT);
        colorBtn.setPadding(U.dp(12), U.dp(4), U.dp(12), U.dp(4));
        colorBtn.setOnClickListener(v -> pickColor(a, bar));
        bar.addView(colorBtn);
        TextView w = U.text(a, "線寬", 14, U.TEXT);
        w.setPadding(U.dp(12), U.dp(10), U.dp(12), U.dp(10));
        w.setOnClickListener(v -> U.choose(a, "線寬", new String[]{"細 1 pt", "2 pt", "3 pt", "粗 5 pt", "特粗 8 pt"}, i -> {
            float[] ws = {1, 2, 3, 5, 8};
            a.prefs.edit().putFloat("width", ws[i]).apply();
            a.view.toolWidth = ws[i];
        }));
        bar.addView(w);
        TextView done = U.text(a, "完成", 14, U.ACCENT);
        done.setPadding(U.dp(14), U.dp(10), U.dp(14), U.dp(10));
        done.setOnClickListener(v -> a.exitModes());
        bar.addView(done);
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

    private static void pickColor(MainActivity a, LinearLayout bar) {
        LinearLayout row = U.hbox(a);
        row.setPadding(U.dp(16), U.dp(16), U.dp(16), U.dp(8));
        final android.app.AlertDialog[] dlg = new android.app.AlertDialog[1];
        for (int c : PALETTE) {
            TextView t = U.text(a, "●", 30, c);
            t.setPadding(U.dp(4), 0, U.dp(4), 0);
            t.setOnClickListener(v -> {
                a.prefs.edit().putInt("color_" + KEYS[current], c).apply();
                a.view.toolColor = c;
                colorBtn.setTextColor(c);
                dlg[0].dismiss();
            });
            row.addView(t);
        }
        HorizontalScrollView hs = new HorizontalScrollView(a);
        hs.addView(row);
        dlg[0] = U.dlg(a).setTitle("顏色").setView(hs).setNegativeButton("取消", null).show();
    }

    static void choose(MainActivity a, LinearLayout bar, int k) {
        current = k;
        highlight(bar, k);
        int col = a.color(KEYS[k], DEF[k]);
        a.view.toolColor = col;
        a.view.toolWidth = a.prefs.getFloat("width", 2f);
        if (colorBtn != null) colorBtn.setTextColor(col);
        Doc d = a.doc();
        if (a.view.inkPage >= 0 && k != 11) a.view.takeInk();
        switch (KEYS[k]) {
            case "sel":
                mode(a, null, PdfView.T_NONE, "長按文字開始選取，拖曳調整範圍。點註解可以檢視或回覆。");
                break;
            case "note":
                mode(a, new MainActivity.Mode() {
                    @Override public void tap(int page, float x, float y) {
                        U.input(a, "便利貼", "寫下你的意見", "", s -> a.edit("新增便利貼", Doc.K_ANNOT,
                                pd -> Ops.addNote(pd, d, page, x, y, s, a.view.toolColor)));
                    }
                }, PdfView.T_POINT, "點一下頁面放置便利貼");
                break;
            case "hl": case "ul": case "so": case "sq": {
                final String sub = k == 2 ? PDAnnotationTextMarkup.SUB_TYPE_HIGHLIGHT : k == 3 ? PDAnnotationTextMarkup.SUB_TYPE_UNDERLINE
                        : k == 4 ? PDAnnotationTextMarkup.SUB_TYPE_STRIKEOUT : PDAnnotationTextMarkup.SUB_TYPE_SQUIGGLY;
                mode(a, new MainActivity.Mode() {
                    @Override public void rect(int page, RectF r) {
                        U.bg.execute(() -> {
                            TextData.Page tp = d.text(page);
                            int first = -1, last = -1;
                            for (int i = 0; i < tp.count(); i++) {
                                if (!tp.real(i)) continue;
                                RectF c = tp.rect(i);
                                if (RectF.intersects(c, r) && c.centerY() > r.top && c.centerY() < r.bottom || r.contains(c.centerX(), c.centerY())) {
                                    if (first < 0) first = i;
                                    last = i;
                                }
                            }
                            final int f = first, l = last;
                            U.ui(() -> {
                                if (f < 0) { U.toast(a, "框選範圍內沒有文字"); return; }
                                List<RectF> rs = tp.rects(f, l);
                                String txt = tp.text.substring(f, l + 1);
                                a.edit(NAMES[k], Doc.K_ANNOT, pd -> Ops.addMarkup(pd, d, page, rs, sub, a.view.toolColor, txt, null));
                            });
                        });
                    }
                }, PdfView.T_RECT, "拖曳框住要" + NAMES[k].replace("筆", "") + "的文字");
                break;
            }
            case "ft":
                mode(a, new MainActivity.Mode() {
                    @Override public void rect(int page, RectF r) { freeText(a, d, page, r); }
                    @Override public void tap(int page, float x, float y) { freeText(a, d, page, new RectF(x, y, Math.min(d.dw(page), x + 180), y + 30)); }
                }, PdfView.T_RECT, "拖曳出文字框的位置（或點一下）");
                break;
            case "rect": case "oval":
                mode(a, new MainActivity.Mode() {
                    @Override public void rect(int page, RectF r) {
                        a.edit(k == 7 ? "新增矩形" : "新增橢圓", Doc.K_ANNOT, pd -> Ops.addShape(pd, d, page, r, k == 8, a.view.toolColor, a.view.toolWidth, null));
                    }
                }, k == 7 ? PdfView.T_RECT : PdfView.T_ELLIPSE, "拖曳畫出" + NAMES[k]);
                break;
            case "line": case "arrow":
                mode(a, new MainActivity.Mode() {
                    @Override public void line(int page, float x1, float y1, float x2, float y2) {
                        if (page < 0) return;
                        a.edit(k == 9 ? "新增直線" : "新增箭頭", Doc.K_ANNOT, pd -> Ops.addLine(pd, d, page, x1, y1, x2, y2, k == 10, a.view.toolColor, a.view.toolWidth, null));
                    }
                }, PdfView.T_LINE, "拖曳畫出" + NAMES[k]);
                break;
            case "ink": {
                MainActivity.Mode m = new MainActivity.Mode() {
                    @Override public void ink() { a.setHint("已畫 " + a.view.ink.size() + " 筆。可繼續畫，或按「儲存」。"); }
                    @Override public void exit() { commitInk(a, d); }
                };
                a.setMode(m, PdfView.T_INK, "用手指在同一頁上手繪（雙指可移動縮放）",
                        new String[]{"復原筆畫", "儲存"}, new Runnable[]{() -> a.view.undoInk(), () -> commitInk(a, d)});
                a.showAnnotBar(true);
                break;
            }
            case "stamp":
                Tools.stamp(a);
                a.showAnnotBar(true);
                break;
        }
    }

    private static void mode(MainActivity a, MainActivity.Mode m, int tool, String hint) {
        a.setMode(m == null ? new MainActivity.Mode() {} : m, tool, hint, null, null);
        a.showAnnotBar(true);
    }

    static void commitInk(MainActivity a, Doc d) {
        if (a.view.ink.isEmpty()) return;
        final int page = a.view.inkPage;
        final List<List<float[]>> strokes = new ArrayList<>(a.view.takeInk());
        final int col = a.view.toolColor;
        final float w = a.view.toolWidth;
        a.setHint("用手指在同一頁上手繪（雙指可移動縮放）");
        a.edit("手繪", Doc.K_ANNOT, pd -> Ops.addInk(pd, d, page, strokes, col, w));
    }

    static void freeText(MainActivity a, Doc d, int page, RectF r) {
        TextStyle st0 = TextStyle.load(a, "ft");
        if (!a.prefs.contains("ft_color")) st0.color = a.view.toolColor;
        TextStyle.dialog(a, "文字框", null, "", st0, "新增", (s, st) -> {
            if (s.trim().isEmpty()) return;
            st.save(a, "ft");
            a.edit("新增文字框", Doc.K_ANNOT, pd -> Ops.addFreeText(pd, d, page, r, s, st));
        });
    }
}
