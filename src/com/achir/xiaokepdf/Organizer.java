package com.achir.xiaokepdf;

import android.app.Dialog;
import android.graphics.Color;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/** 整理頁面：像卡片一樣把所有頁面攤在桌上。 */
public final class Organizer {
    private Organizer() {}

    private static Dialog dlg;
    private static Runnable refresher;

    public static void refresh() { if (dlg != null && dlg.isShowing() && refresher != null) refresher.run(); }

    public static void show(MainActivity a) {
        Doc d = a.doc();
        if (d == null) { U.toast(a, "請先開啟文件"); return; }
        final TreeSet<Integer> sel = new TreeSet<>();
        final int[] anchor = {-1};
        dlg = new Dialog(a, U.dark ? android.R.style.Theme_Material_NoActionBar : android.R.style.Theme_Material_Light_NoActionBar);
        dlg.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout root = U.vbox(a);
        root.setBackgroundColor(U.BG);

        LinearLayout top = U.hbox(a);
        top.setBackgroundColor(U.SURFACE);
        top.addView(U.icon(a, "✕", "關閉", v -> dlg.dismiss()));
        TextView title = U.bold(a, "整理頁面", 17, U.TEXT);
        top.addView(title, U.lpw(1));
        TextView undo = U.icon(a, "↶", "復原", v -> a.undo());
        TextView redo = U.icon(a, "↷", "重做", v -> a.redo());
        top.addView(undo);
        top.addView(redo);
        top.addView(U.icon(a, "💾", "儲存", v -> a.save(d, null)));
        root.addView(top, U.lp(U.MATCH, U.dp(52)));

        HorizontalScrollView hs = new HorizontalScrollView(a);
        hs.setBackgroundColor(U.SURFACE);
        LinearLayout tools = U.hbox(a);
        hs.addView(tools);
        root.addView(hs);
        root.addView(U.divider(a));

        GridView g = new GridView(a);
        int cols = a.getResources().getDisplayMetrics().widthPixels > U.dp(600) ? 5 : 3;
        g.setNumColumns(cols);
        g.setVerticalSpacing(U.dp(14));
        g.setHorizontalSpacing(U.dp(12));
        g.setPadding(U.dp(14), U.dp(14), U.dp(14), U.dp(14));
        g.setClipToPadding(false);
        final int tw = (a.getResources().getDisplayMetrics().widthPixels - U.dp(28 + 12 * (cols - 1))) / cols;
        final BaseAdapter ad = new BaseAdapter() {
            public int getCount() { return d.n; }
            public Object getItem(int i) { return i; }
            public long getItemId(int i) { return i; }
            public View getView(int i, View cv, ViewGroup p) {
                LinearLayout c = (LinearLayout) cv;
                if (c == null) {
                    c = U.vbox(a);
                    c.setGravity(Gravity.CENTER_HORIZONTAL);
                    FrameLayout f = new FrameLayout(a);
                    ImageView iv = new ImageView(a);
                    iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
                    iv.setAdjustViewBounds(true);
                    f.addView(iv, new FrameLayout.LayoutParams(tw, (int) (tw * 1.32f)));
                    TextView chk = U.text(a, "✓", 14, Color.WHITE);
                    chk.setGravity(Gravity.CENTER);
                    chk.setBackground(U.round(U.ACCENT, 0, 12));
                    f.addView(chk, new FrameLayout.LayoutParams(U.dp(24), U.dp(24), Gravity.TOP | Gravity.END));
                    c.addView(f);
                    TextView t = U.text(a, "", 12, U.SUB);
                    t.setGravity(Gravity.CENTER);
                    c.addView(t);
                }
                FrameLayout f = (FrameLayout) c.getChildAt(0);
                ImageView iv = (ImageView) f.getChildAt(0);
                boolean on = sel.contains(i);
                iv.setBackground(U.round(Color.WHITE, on ? U.ACCENT : U.LINE, 4));
                int pd = on ? U.dp(3) : U.dp(1);
                iv.setPadding(pd, pd, pd, pd);
                f.getChildAt(1).setVisibility(on ? View.VISIBLE : View.GONE);
                Panels.thumb(d, i, tw, iv);
                String lbl = d.label(i);
                ((TextView) c.getChildAt(1)).setText((lbl != null ? lbl + "（" + (i + 1) + "）" : String.valueOf(i + 1))
                        + (d.rot[i] != 0 ? "  ⟳" + d.rot[i] + "°" : ""));
                return c;
            }
        };
        g.setAdapter(ad);
        // 點擊＝切換選取；長按＝從上次點的頁選到這頁（相當於 Shift-點擊）
        g.setOnItemClickListener((p, v, i, id) -> {
            if (sel.contains(i)) sel.remove(i); else sel.add(i);
            anchor[0] = i;
            ad.notifyDataSetChanged();
            refresher.run();
        });
        g.setOnItemLongClickListener((p, v, i, id) -> {
            int from = anchor[0] < 0 ? i : anchor[0];
            for (int k = Math.min(from, i); k <= Math.max(from, i); k++) sel.add(k);
            anchor[0] = i;
            ad.notifyDataSetChanged();
            refresher.run();
            return true;
        });
        root.addView(g, new LinearLayout.LayoutParams(U.MATCH, 0, 1));

        TextView hint = U.text(a, "點一下選取頁面，長按可連續選取一個範圍。", 12.5f, U.SUB);
        hint.setPadding(U.dp(14), U.dp(8), U.dp(14), U.dp(10));
        hint.setBackgroundColor(U.SURFACE);
        root.addView(hint);

        refresher = () -> {
            sel.removeIf(x -> x >= d.n);
            title.setText(sel.isEmpty() ? "整理頁面（" + d.n + " 頁）" : "已選取 " + sel.size() + " / " + d.n + " 頁");
            undo.setAlpha(d.undoLabel() == null ? 0.35f : 1);
            redo.setAlpha(d.redoLabel() == null ? 0.35f : 1);
            undo.setContentDescription(d.undoLabel() == null ? "復原" : "復原：" + d.undoLabel());
            ad.notifyDataSetChanged();
        };

        // 工具列
        tools.addView(tb(a, "全選", v -> { if (sel.size() == d.n) sel.clear(); else for (int i = 0; i < d.n; i++) sel.add(i); refresher.run(); }));
        tools.addView(tb(a, "↺ 左轉", v -> withSel(a, sel, s -> a.edit("旋轉頁面", Doc.K_EDIT, pd -> Ops.rotate(pd, s, -90)))));
        tools.addView(tb(a, "↻ 右轉", v -> withSel(a, sel, s -> a.edit("旋轉頁面", Doc.K_EDIT, pd -> Ops.rotate(pd, s, 90)))));
        tools.addView(tb(a, "刪除", v -> withSel(a, sel, s -> U.confirm(a, "刪除頁面", "刪除選取的 " + s.length + " 頁？（可以復原）", "刪除",
                () -> { sel.clear(); a.edit("刪除頁面", Doc.K_EDIT, pd -> Ops.delete(pd, s)); }))));
        tools.addView(tb(a, "插入空白頁", v -> {
            int at = sel.isEmpty() ? d.n : sel.last() + 1;
            String[] sizes = {"與相鄰頁面相同", "A4 直向", "A4 橫向", "Letter", "A5"};
            U.choose(a, "插入空白頁（第 " + at + " 頁之後）", sizes, k -> {
                int ref = Math.max(0, Math.min(at - 1, d.n - 1));
                PDRectangle r = k == 0 ? new PDRectangle(d.dw(ref), d.dh(ref)) : k == 1 ? PDRectangle.A4 : k == 2 ? new PDRectangle(842, 595) : k == 3 ? PDRectangle.LETTER : PDRectangle.A5;
                a.edit("插入空白頁", Doc.K_EDIT, pd -> Ops.insertBlank(pd, at, r, 1));
            });
        }));
        tools.addView(tb(a, "從檔案插入", v -> {
            int at = sel.isEmpty() ? d.n : sel.last() + 1;
            Activities.pick(a, new String[]{"application/pdf"}, false, uris -> insertFrom(a, d, uris.get(0), at, null));
        }));
        tools.addView(tb(a, "◀ 往前", v -> withSel(a, sel, s -> a.edit("往前移動頁面", Doc.K_EDIT, pd -> {
            int[] ns = Ops.move(pd, s, -1);
            U.ui(() -> { sel.clear(); for (int x : ns) sel.add(x); });
        }))));
        tools.addView(tb(a, "往後 ▶", v -> withSel(a, sel, s -> a.edit("往後移動頁面", Doc.K_EDIT, pd -> {
            int[] ns = Ops.move(pd, s, 1);
            U.ui(() -> { sel.clear(); for (int x : ns) sel.add(x); });
        }))));
        tools.addView(tb(a, "移到…", v -> withSel(a, sel, s -> U.input(a, "移到第幾頁之前", "1–" + (d.n + 1), "1", t -> {
            try {
                int at = Integer.parseInt(t.trim()) - 1;
                sel.clear();
                a.edit("移動頁面", Doc.K_EDIT, pd -> Ops.moveTo(pd, s, at));
            } catch (NumberFormatException e) { U.toast(a, "請輸入頁碼"); }
        }))));
        tools.addView(tb(a, "反轉順序", v -> withSel(a, sel, s -> a.edit("反轉頁面順序", Doc.K_EDIT, pd -> Ops.reverse(pd, s)))));
        tools.addView(tb(a, "擷取成新檔", v -> withSel(a, sel, s -> Tools.extract(a, s))));
        tools.addView(tb(a, "分割…", v -> Tools.split(a)));
        tools.addView(tb(a, "裁切", v -> withSel(a, sel, s -> Tools.crop(a, s))));
        tools.addView(tb(a, "前往", v -> withSel(a, sel, s -> { dlg.dismiss(); a.goTo(s[0]); })));

        refresher.run();
        dlg.setContentView(root);
        dlg.setOnDismissListener(x -> { refresher = null; dlg = null; });
        dlg.show();
        dlg.getWindow().setLayout(U.MATCH, U.MATCH);
    }

    interface Sel { void run(int[] s); }

    private static void withSel(MainActivity a, TreeSet<Integer> sel, Sel r) {
        if (sel.isEmpty()) { U.toast(a, "先點選要處理的頁面"); return; }
        int[] s = new int[sel.size()];
        int i = 0;
        for (int x : sel) s[i++] = x;
        r.run(s);
    }

    private static TextView tb(MainActivity a, String s, View.OnClickListener l) {
        TextView t = U.text(a, s, 14, U.TEXT);
        t.setPadding(U.dp(13), U.dp(12), U.dp(13), U.dp(12));
        t.setBackground(U.ripple(a));
        t.setOnClickListener(l);
        return t;
    }

    static void insertFrom(MainActivity a, Doc d, Uri u, int at, String pwd) {
        String name = U.nameOf(a, u);
        U.run(a, "讀取檔案…", () -> {
            File f = d.temp("insert_src.pdf");
            U.copyToFile(a, u, f);
            return f;
        }, f -> U.input(a, "要插入「" + name + "」的哪些頁？", "例如 1,3,5-8；留白＝全部", "", spec -> {
            a.edit("從檔案插入頁面", Doc.K_EDIT, pd -> {
                int[] pick = spec.trim().isEmpty() ? null : U.pages(spec, 100000);
                if (pick != null) for (int k = 0; k < pick.length; k++) pick[k] = pick[k];
                try { Ops.insertFile(pd, at, f, pwd, pick, d.later); }
                catch (com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException e) {
                    U.ui(() -> U.input(a, "「" + name + "」需要密碼", "密碼", "", android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD,
                            p -> insertFrom(a, d, u, at, p)));
                    throw new IllegalStateException("需要密碼才能插入這個檔案");
                }
            });
        }));
    }
}
