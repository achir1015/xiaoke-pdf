package com.achir.xiaokepdf;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 介面與執行緒的小工具。 */
public final class U {
    private U() {}

    public static final Handler main = new Handler(Looper.getMainLooper());
    /** 所有改動文件的工作依序在這條執行緒上做。 */
    public static final ExecutorService bg = Executors.newSingleThreadExecutor();
    public static float dens = 3f;

    // 配色
    public static boolean dark;
    public static int BG, SURFACE, CARD, TEXT, SUB, LINE, ACCENT, ACCENT_SOFT, PAGE_BG, DANGER;

    public static void palette(boolean d) {
        dark = d;
        if (d) {
            BG = 0xFF1B1C1F; SURFACE = 0xFF232428; CARD = 0xFF2B2D31; TEXT = 0xFFE8E9EC; SUB = 0xFF9CA0A8;
            LINE = 0xFF3A3C42; ACCENT = 0xFF6EA2FF; ACCENT_SOFT = 0xFF263552; PAGE_BG = 0xFF111214; DANGER = 0xFFFF6B6B;
        } else {
            BG = 0xFFF3F4F6; SURFACE = 0xFFFFFFFF; CARD = 0xFFFFFFFF; TEXT = 0xFF1D1F23; SUB = 0xFF6B7078;
            LINE = 0xFFE1E3E8; ACCENT = 0xFF1E63E9; ACCENT_SOFT = 0xFFE3ECFD; PAGE_BG = 0xFFE9EAEE; DANGER = 0xFFD93025;
        }
    }

    static { palette(false); }

    public static int dp(float v) { return Math.round(v * dens); }

    public interface Task<T> { T run() throws Exception; }
    public interface Done<T> { void done(T r); }
    public interface Str { void got(String s); }
    public interface Idx { void got(int i); }

    public static void ui(Runnable r) { main.post(r); }

    /** 在背景跑，顯示忙碌視窗；完成後回主執行緒。例外會顯示錯誤。 */
    public static <T> void run(final Activity a, final String msg, final Task<T> t, final Done<T> d) {
        final Dialog busy = msg == null ? null : busy(a, msg);
        bg.execute(() -> {
            T r = null; Throwable err = null;
            try { r = t.run(); } catch (Throwable e) { err = e; }
            final T fr = r; final Throwable fe = err;
            main.post(() -> {
                if (busy != null) try { busy.dismiss(); } catch (Exception ignored) {}
                if (a.isFinishing()) return;
                if (fe != null) { fe.printStackTrace(); error(a, fe); }
                else if (d != null) d.done(fr);
            });
        });
    }

    public static void error(Context c, Throwable e) {
        String m = e.getMessage();
        if (e instanceof OutOfMemoryError) m = "記憶體不足，請關閉其他文件後再試。";
        if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();
        alert(c, "發生錯誤", m);
    }

    public static Dialog busy(Context c, String msg) {
        LinearLayout l = hbox(c);
        l.setPadding(dp(24), dp(22), dp(24), dp(22));
        l.setGravity(Gravity.CENTER_VERTICAL);
        ProgressBar pb = new ProgressBar(c);
        l.addView(pb, new LinearLayout.LayoutParams(dp(36), dp(36)));
        TextView t = text(c, msg, 15, TEXT);
        t.setPadding(dp(16), 0, 0, 0);
        l.addView(t);
        AlertDialog dlg = dlg(c).setView(l).setCancelable(false).create();
        dlg.show();
        return dlg;
    }

    public static AlertDialog.Builder dlg(Context c) {
        return new AlertDialog.Builder(c, dark ? android.R.style.Theme_Material_Dialog_Alert
                : android.R.style.Theme_Material_Light_Dialog_Alert);
    }

    public static void alert(Context c, String title, String msg) {
        dlg(c).setTitle(title).setMessage(msg).setPositiveButton("確定", null).show();
    }

    public static void toast(Context c, String s) { Toast.makeText(c, s, Toast.LENGTH_SHORT).show(); }

    public static void confirm(Context c, String title, String msg, String ok, Runnable yes) {
        dlg(c).setTitle(title).setMessage(msg).setPositiveButton(ok, (d, w) -> yes.run())
                .setNegativeButton("取消", null).show();
    }

    public static void input(Context c, String title, String hint, String init, Str cb) {
        input(c, title, hint, init, InputType.TYPE_CLASS_TEXT, cb);
    }

    public static void input(Context c, String title, String hint, String init, int type, Str cb) {
        final EditText e = edit(c, hint, init);
        e.setInputType(type);
        FrameLayout f = new FrameLayout(c);
        f.setPadding(dp(20), dp(8), dp(20), 0);
        f.addView(e);
        AlertDialog d = dlg(c).setTitle(title).setView(f)
                .setPositiveButton("確定", (x, w) -> cb.got(e.getText().toString()))
                .setNegativeButton("取消", null).create();
        d.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        d.show();
        e.requestFocus();
        e.selectAll();
    }

    public static void choose(Context c, String title, String[] items, Idx cb) {
        dlg(c).setTitle(title).setItems(items, (d, w) -> cb.got(w)).setNegativeButton("取消", null).show();
    }

    public static EditText edit(Context c, String hint, String init) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setTextColor(TEXT);
        e.setHintTextColor(SUB);
        e.setTextSize(16);
        if (init != null) e.setText(init);
        return e;
    }

    public static CheckBox check(Context c, String label, boolean on) {
        CheckBox b = new CheckBox(c);
        b.setText(label);
        b.setTextColor(TEXT);
        b.setChecked(on);
        return b;
    }

    public static TextView text(Context c, String s, float sp, int color) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        return t;
    }

    public static TextView bold(Context c, String s, float sp, int color) {
        TextView t = text(c, s, sp, color);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    public static LinearLayout vbox(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    public static LinearLayout hbox(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    public static GradientDrawable round(int fill, int stroke, float radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(radiusDp));
        if (stroke != 0) g.setStroke(Math.max(1, dp(1)), stroke);
        return g;
    }

    /** 文字按鈕（扁平）。 */
    public static TextView flat(Context c, String s, View.OnClickListener l) {
        TextView t = text(c, s, 15, ACCENT);
        t.setPadding(dp(12), dp(10), dp(12), dp(10));
        t.setGravity(Gravity.CENTER);
        t.setOnClickListener(l);
        t.setBackground(ripple(c));
        return t;
    }

    /** 實心主要按鈕。 */
    public static TextView primary(Context c, String s, View.OnClickListener l) {
        TextView t = text(c, s, 15, Color.WHITE);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(dp(16), dp(10), dp(16), dp(10));
        t.setGravity(Gravity.CENTER);
        t.setBackground(round(ACCENT, 0, 20));
        t.setOnClickListener(l);
        return t;
    }

    /** 工具列上的圖示按鈕（用符號字元）。 */
    public static TextView icon(Context c, String glyph, String desc, View.OnClickListener l) {
        TextView t = text(c, glyph, 19, TEXT);
        t.setGravity(Gravity.CENTER);
        t.setMinWidth(dp(44));
        t.setPadding(dp(8), dp(8), dp(8), dp(8));
        t.setContentDescription(desc);
        t.setOnClickListener(l);
        t.setBackground(ripple(c));
        if (desc != null) t.setOnLongClickListener(v -> { toast(c, desc); return true; });
        return t;
    }

    public static android.graphics.drawable.Drawable ripple(Context c) {
        TypedValue tv = new TypedValue();
        c.getTheme().resolveAttribute(android.R.attr.selectableItemBackground, tv, true);
        return c.getDrawable(tv.resourceId);
    }

    public static View divider(Context c) {
        View v = new View(c);
        v.setBackgroundColor(LINE);
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(1))));
        return v;
    }

    public static LinearLayout.LayoutParams lp(int w, int h) { return new LinearLayout.LayoutParams(w, h); }
    public static LinearLayout.LayoutParams lpw(float weight) {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight);
    }
    public static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT, WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    /** 從下方滑出的面板。回傳內容容器（可捲動）。 */
    public static class Sheet {
        public final Dialog dialog;
        public final LinearLayout body;
        public final LinearLayout header;
        public final TextView title;

        public Sheet(Context c, String t, boolean scroll) { this(c, t, scroll, 0.82f); }

        public Sheet(Context c, String t, boolean scroll, float heightFrac) {
            dialog = new Dialog(c, dark ? android.R.style.Theme_Material_Dialog : android.R.style.Theme_Material_Light_Dialog);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            LinearLayout root = vbox(c);
            root.setBackground(round(SURFACE, 0, 16));
            header = hbox(c);
            header.setPadding(dp(18), dp(10), dp(6), dp(6));
            title = bold(c, t, 18, TEXT);
            header.addView(title, lpw(1));
            header.addView(icon(c, "✕", "關閉", v -> dialog.dismiss()));
            root.addView(header);
            root.addView(divider(c));
            body = vbox(c);
            if (scroll) {
                ScrollView sv = new ScrollView(c);
                sv.addView(body);
                root.addView(sv, new LinearLayout.LayoutParams(MATCH, 0, 1));
            } else {
                root.addView(body, new LinearLayout.LayoutParams(MATCH, 0, 1));
            }
            dialog.setContentView(root);
            Window w = dialog.getWindow();
            w.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
            int h = (int) (c.getResources().getDisplayMetrics().heightPixels * heightFrac);
            w.setLayout(MATCH, h);
            w.setGravity(Gravity.BOTTOM);
        }

        public void show() { dialog.show(); }
        public void dismiss() { dialog.dismiss(); }
    }

    /** 清單列：標題 + 副標 + 右側文字。 */
    public static LinearLayout row(Context c, String title, String sub, String right, View.OnClickListener l) {
        LinearLayout r = hbox(c);
        r.setPadding(dp(18), dp(11), dp(18), dp(11));
        LinearLayout tx = vbox(c);
        TextView t = text(c, title, 15, TEXT);
        tx.addView(t);
        if (sub != null && !sub.isEmpty()) tx.addView(text(c, sub, 12.5f, SUB));
        r.addView(tx, lpw(1));
        if (right != null) {
            TextView rt = text(c, right, 13, SUB);
            rt.setMaxWidth(dp(170));
            rt.setSingleLine(true);
            rt.setEllipsize(android.text.TextUtils.TruncateAt.END);
            rt.setPadding(dp(10), 0, 0, 0);
            r.addView(rt);
        }
        if (l != null) { r.setOnClickListener(l); r.setBackground(ripple(c)); }
        return r;
    }

    public static TextView section(Context c, String s) {
        TextView t = bold(c, s, 13, SUB);
        t.setPadding(dp(18), dp(16), dp(18), dp(6));
        return t;
    }

    // ---------- 檔案 ----------

    public static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] b = new byte[1 << 16];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
    }

    public static void copyFile(File a, File b) throws IOException {
        try (InputStream in = new FileInputStream(a); OutputStream out = new FileOutputStream(b)) { copy(in, out); }
    }

    public static void copyToFile(Context c, Uri u, File f) throws IOException {
        try (InputStream in = c.getContentResolver().openInputStream(u); OutputStream out = new FileOutputStream(f)) {
            if (in == null) throw new IOException("無法讀取檔案");
            copy(in, out);
        }
    }

    public static void copyToUri(Context c, File f, Uri u) throws IOException {
        OutputStream out = null;
        try {
            try { out = c.getContentResolver().openOutputStream(u, "wt"); }
            catch (Exception e) { out = c.getContentResolver().openOutputStream(u, "w"); }
            if (out == null) throw new IOException("無法寫入檔案");
            try (InputStream in = new FileInputStream(f)) { copy(in, out); }
        } finally { if (out != null) out.close(); }
    }

    public static String nameOf(Context c, Uri u) {
        String n = null;
        try (Cursor cur = c.getContentResolver().query(u, null, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int i = cur.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) n = cur.getString(i);
            }
        } catch (Exception ignored) {}
        if (n == null) n = u.getLastPathSegment();
        if (n == null) n = "文件.pdf";
        int slash = n.lastIndexOf('/');
        if (slash >= 0) n = n.substring(slash + 1);
        return n;
    }

    public static long sizeOf(Context c, Uri u) {
        try (Cursor cur = c.getContentResolver().query(u, null, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int i = cur.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0 && !cur.isNull(i)) return cur.getLong(i);
            }
        } catch (Exception ignored) {}
        return -1;
    }

    public static String size(long b) {
        if (b < 0) return "";
        if (b < 1024) return b + " B";
        if (b < 1024 * 1024) return String.format("%.1f KB", b / 1024.0);
        return String.format("%.1f MB", b / 1048576.0);
    }

    public static String base(String name) {
        int i = name.toLowerCase().lastIndexOf(".pdf");
        return i > 0 ? name.substring(0, i) : name;
    }

    public static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] k = f.listFiles();
        if (k != null) for (File x : k) deleteTree(x);
        f.delete();
    }

    /** 解析「1,3,5-8」這類頁碼（1 起算），回傳 0 起算、排序、不重複。 */
    public static int[] pages(String spec, int n) {
        TreeSet<Integer> s = new TreeSet<>();
        if (spec == null) return new int[0];
        spec = spec.replace('，', ',').replace('、', ',').replace('～', '-').replace('~', '-').replace(" ", "");
        for (String part : spec.split(",")) {
            if (part.isEmpty()) continue;
            try {
                int dash = part.indexOf('-', 1);
                if (dash > 0) {
                    int a = Integer.parseInt(part.substring(0, dash));
                    String bs = part.substring(dash + 1);
                    int b = bs.isEmpty() ? n : Integer.parseInt(bs);
                    if (a > b) { int t = a; a = b; b = t; }
                    for (int i = Math.max(1, a); i <= Math.min(n, b); i++) s.add(i - 1);
                } else {
                    int a = Integer.parseInt(part);
                    if (a >= 1 && a <= n) s.add(a - 1);
                }
            } catch (NumberFormatException ignored) {}
        }
        int[] r = new int[s.size()];
        int i = 0;
        for (int v : s) r[i++] = v;
        return r;
    }

    /** 0 起算的頁碼陣列 → 「1-3, 5」。 */
    public static String spec(int[] p) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < p.length; ) {
            int j = i;
            while (j + 1 < p.length && p[j + 1] == p[j] + 1) j++;
            if (sb.length() > 0) sb.append(", ");
            sb.append(p[i] + 1);
            if (j > i) sb.append('-').append(p[j] + 1);
            i = j + 1;
        }
        return sb.toString();
    }

    public static List<Integer> list(int[] a) {
        List<Integer> l = new ArrayList<>();
        for (int v : a) l.add(v);
        return l;
    }

    public static String safeName(String s) {
        return s.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
