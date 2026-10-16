package com.achir.xiaokepdf;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.tom_roush.pdfbox.cos.COSDictionary;
import com.tom_roush.pdfbox.cos.COSName;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDDocumentInformation;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDResources;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.graphics.optionalcontent.PDOptionalContentGroup;
import com.tom_roush.pdfbox.pdmodel.graphics.optionalcontent.PDOptionalContentProperties;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 書籤、縮圖、註解、表單、圖層、附件、文件屬性。 */
public final class Panels {
    private Panels() {}

    static final ExecutorService thumbExec = Executors.newSingleThreadExecutor();
    static final LruCache<String, Bitmap> thumbs = new LruCache<String, Bitmap>(24 << 20) {
        @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
    };

    /** 非同步縮圖。 */
    public static void thumb(Doc d, int page, int width, ImageView iv) {
        final String key = d.id + ":" + d.gen + ":" + page + ":" + width;
        iv.setTag(key);
        Bitmap b = thumbs.get(key);
        if (b != null) { iv.setImageBitmap(b); return; }
        iv.setImageDrawable(null);
        thumbExec.execute(() -> {
            if (!key.equals(iv.getTag())) return;
            Bitmap r = page < d.n ? d.renderWidth(page, width) : null;
            if (r == null) return;
            thumbs.put(key, r);
            U.ui(() -> { if (key.equals(iv.getTag())) iv.setImageBitmap(r); });
        });
    }

    static boolean need(MainActivity a) {
        if (a.doc() == null) { U.toast(a, "請先開啟文件"); return false; }
        return true;
    }

    // ================================================================ 縮圖

    public static void thumbnails(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        U.Sheet s = new U.Sheet(a, "頁面縮圖（" + d.n + " 頁）", false);
        GridView g = new GridView(a);
        g.setNumColumns(3);
        g.setVerticalSpacing(U.dp(10));
        g.setHorizontalSpacing(U.dp(10));
        g.setPadding(U.dp(12), U.dp(12), U.dp(12), U.dp(12));
        g.setClipToPadding(false);
        final int tw = (a.getResources().getDisplayMetrics().widthPixels - U.dp(60)) / 3;
        g.setAdapter(new BaseAdapter() {
            public int getCount() { return d.n; }
            public Object getItem(int i) { return i; }
            public long getItemId(int i) { return i; }
            public View getView(int i, View cv, ViewGroup p) {
                LinearLayout c = (LinearLayout) cv;
                if (c == null) {
                    c = U.vbox(a);
                    c.setGravity(Gravity.CENTER_HORIZONTAL);
                    ImageView iv = new ImageView(a);
                    iv.setAdjustViewBounds(true);
                    iv.setBackgroundColor(Color.WHITE);
                    iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
                    c.addView(iv, U.lp(tw, (int) (tw * 1.3f)));
                    TextView t = U.text(a, "", 12, U.SUB);
                    t.setGravity(Gravity.CENTER);
                    c.addView(t);
                }
                ImageView iv = (ImageView) c.getChildAt(0);
                iv.setPadding(i == a.view.page() ? U.dp(3) : 0, i == a.view.page() ? U.dp(3) : 0, i == a.view.page() ? U.dp(3) : 0, i == a.view.page() ? U.dp(3) : 0);
                iv.setBackgroundColor(i == a.view.page() ? U.ACCENT : Color.WHITE);
                thumb(d, i, tw, iv);
                String lbl = d.label(i);
                ((TextView) c.getChildAt(1)).setText(lbl != null ? lbl + "（" + (i + 1) + "）" : String.valueOf(i + 1));
                return c;
            }
        });
        g.setOnItemClickListener((p, v, i, id) -> { a.goTo(i); s.dismiss(); });
        g.setSelection(Math.max(0, a.view.page() - 3));
        s.body.addView(g, U.lp(U.MATCH, U.MATCH));
        TextView org = U.flat(a, "整理頁面…", v -> { s.dismiss(); Organizer.show(a); });
        s.header.addView(org, 1);
        s.show();
    }

    // ================================================================ 書籤

    public static void bookmarks(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        U.run(a, null, () -> { try (PDDocument pd = d.load()) { return Ops.outline(pd); } }, list -> {
            U.Sheet s = new U.Sheet(a, "書籤", false);
            EditText q = U.edit(a, "搜尋書籤標題", "");
            q.setSingleLine(true);
            LinearLayout top = U.hbox(a);
            top.setPadding(U.dp(16), 0, U.dp(8), 0);
            top.addView(q, U.lpw(1));
            top.addView(U.flat(a, "清除", v -> q.setText("")));
            s.body.addView(top);
            android.widget.ScrollView sv = new android.widget.ScrollView(a);
            LinearLayout tree = U.vbox(a);
            sv.addView(tree);
            s.body.addView(sv, new LinearLayout.LayoutParams(U.MATCH, 0, 1));
            final Set<String> open = new HashSet<>();
            initOpen(list, open);
            final Runnable[] draw = new Runnable[1];
            draw[0] = () -> {
                tree.removeAllViews();
                String f = q.getText().toString().trim().toLowerCase();
                if (list.isEmpty()) tree.addView(pad(U.text(a, "這份文件沒有書籤。按右上角「＋」可以為目前頁面加入書籤。", 14, U.SUB)));
                int[] count = {0};
                for (Ops.Bm b : list) drawBm(a, s, d, b, 0, f, open, tree, draw[0], count);
                if (!f.isEmpty() && count[0] == 0) tree.addView(pad(U.text(a, "沒有符合的書籤", 14, U.SUB)));
            };
            q.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence x, int b, int c, int e) {}
                public void onTextChanged(CharSequence x, int b, int c, int e) {}
                public void afterTextChanged(Editable e) { draw[0].run(); }
            });
            s.header.addView(U.icon(a, "＋", "為目前頁面加入書籤", v ->
                    U.input(a, "新增書籤（第 " + (a.view.page() + 1) + " 頁）", "標題", "第 " + (a.view.page() + 1) + " 頁", t -> {
                        s.dismiss();
                        int p = a.view.page();
                        a.edit("新增書籤", Doc.K_EDIT, pd -> Ops.addBookmark(pd, null, t, p), () -> bookmarks(a));
                    })), 1);
            draw[0].run();
            s.show();
        });
    }

    private static void initOpen(List<Ops.Bm> l, Set<String> open) {
        for (Ops.Bm b : l) { if (b.open) open.add(java.util.Arrays.toString(b.path)); initOpen(b.kids, open); }
    }

    private static boolean matches(Ops.Bm b, String f) {
        if (f.isEmpty() || b.title.toLowerCase().contains(f)) return true;
        for (Ops.Bm k : b.kids) if (matches(k, f)) return true;
        return false;
    }

    private static void drawBm(MainActivity a, U.Sheet s, Doc d, Ops.Bm b, int depth, String f, Set<String> open,
                               LinearLayout tree, Runnable redraw, int[] count) {
        if (!matches(b, f)) return;
        boolean self = !f.isEmpty() && b.title.toLowerCase().contains(f);
        if (self) count[0]++;
        String key = java.util.Arrays.toString(b.path);
        boolean expanded = !f.isEmpty() || open.contains(key);
        LinearLayout r = U.hbox(a);
        r.setPadding(U.dp(10 + depth * 18), U.dp(4), U.dp(12), U.dp(4));
        TextView arrow = U.text(a, b.kids.isEmpty() ? " " : expanded ? "▾" : "▸", 16, U.SUB);
        arrow.setPadding(U.dp(6), U.dp(8), U.dp(8), U.dp(8));
        arrow.setMinWidth(U.dp(28));
        arrow.setOnClickListener(v -> { if (open.contains(key)) open.remove(key); else open.add(key); redraw.run(); });
        r.addView(arrow);
        TextView t = U.text(a, b.title, 15, f.isEmpty() || self ? U.TEXT : U.SUB);
        if (self) t.setTypeface(Typeface.DEFAULT_BOLD);
        r.addView(t, U.lpw(1));
        String lbl = b.page >= 0 ? (d.label(b.page) != null ? d.label(b.page) : String.valueOf(b.page + 1)) : "";
        r.addView(U.text(a, lbl, 13, U.SUB));
        r.setBackground(U.ripple(a));
        r.setOnClickListener(v -> { if (b.page >= 0) { a.goTo(b.page); s.dismiss(); } });
        r.setOnLongClickListener(v -> {
            U.choose(a, b.title, new String[]{"重新命名", "改為指向目前頁面", "新增子書籤（目前頁面）", "刪除"}, i -> {
                int cp = a.view.page();
                if (i == 0) U.input(a, "重新命名", "標題", b.title, nt -> { s.dismiss(); a.edit("重新命名書籤", Doc.K_EDIT, pd -> Ops.renameBookmark(pd, b.path, nt), () -> bookmarks(a)); });
                else if (i == 1) { s.dismiss(); a.edit("變更書籤目標", Doc.K_EDIT, pd -> Ops.retargetBookmark(pd, b.path, cp), () -> bookmarks(a)); }
                else if (i == 2) U.input(a, "新增子書籤", "標題", "第 " + (cp + 1) + " 頁", nt -> { s.dismiss(); a.edit("新增書籤", Doc.K_EDIT, pd -> Ops.addBookmark(pd, b.path, nt, cp), () -> bookmarks(a)); });
                else U.confirm(a, "刪除書籤", "刪除「" + b.title + "」及其子書籤？", "刪除", () -> { s.dismiss(); a.edit("刪除書籤", Doc.K_EDIT, pd -> Ops.deleteBookmark(pd, b.path), () -> bookmarks(a)); });
            });
            return true;
        });
        tree.addView(r);
        if (expanded) for (Ops.Bm k : b.kids) drawBm(a, s, d, k, depth + 1, f, open, tree, redraw, count);
    }

    static View pad(View v) { v.setPadding(U.dp(18), U.dp(16), U.dp(18), U.dp(16)); return v; }

    // ================================================================ 註解

    static final Map<String, String> SUB = new LinkedHashMap<>();
    static {
        SUB.put("Text", "便利貼"); SUB.put("Highlight", "螢光標示"); SUB.put("Underline", "底線"); SUB.put("StrikeOut", "刪除線");
        SUB.put("Squiggly", "波浪底線"); SUB.put("FreeText", "文字框"); SUB.put("Square", "矩形"); SUB.put("Circle", "橢圓");
        SUB.put("Line", "直線"); SUB.put("Ink", "手繪"); SUB.put("Stamp", "印章"); SUB.put("Polygon", "多邊形"); SUB.put("PolyLine", "折線");
        SUB.put("FileAttachment", "附件"); SUB.put("Redact", "塗銷標記"); SUB.put("Caret", "插入符號"); SUB.put("Sound", "聲音");
    }
    static final Map<String, String> STATE = new LinkedHashMap<>();
    static {
        STATE.put("Accepted", "已接受"); STATE.put("Rejected", "已拒絕"); STATE.put("Cancelled", "已取消");
        STATE.put("Completed", "已完成"); STATE.put("None", "無");
    }

    static String sub(String s) { String r = SUB.get(s); return r == null ? s : r; }

    public static void comments(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        U.run(a, null, () -> { try (PDDocument pd = d.load()) { return Ops.comments(pd, d); } }, list -> {
            U.Sheet s = new U.Sheet(a, "註解（" + list.size() + "）", true);
            if (list.isEmpty()) s.body.addView(pad(U.text(a, "還沒有註解。按上方 ✎ 開啟註解工具，或長按文字選取後加上螢光標示。", 14, U.SUB)));
            int lastPage = -1;
            for (Ops.Cm c : list) {
                if (c.page != lastPage) { s.body.addView(U.section(a, "第 " + (d.label(c.page) != null ? d.label(c.page) : String.valueOf(c.page + 1)) + " 頁")); lastPage = c.page; }
                s.body.addView(commentCard(a, s, d, c));
            }
            s.header.addView(U.icon(a, "✎", "註解工具", v -> { s.dismiss(); a.commentMode(true); }), 1);
            s.show();
        });
    }

    private static View commentCard(MainActivity a, U.Sheet s, Doc d, Ops.Cm c) {
        LinearLayout card = U.vbox(a);
        card.setPadding(U.dp(16), U.dp(10), U.dp(16), U.dp(10));
        LinearLayout h = U.hbox(a);
        h.addView(U.text(a, "● ", 14, c.color));
        h.addView(U.bold(a, sub(c.sub), 14, U.TEXT));
        h.addView(U.text(a, "  " + c.author + "  " + c.date, 12, U.SUB), U.lpw(1));
        if (c.state != null) h.addView(U.text(a, STATE.containsKey(c.state) ? STATE.get(c.state) : c.state, 12, U.ACCENT));
        card.addView(h);
        if (c.text != null && !c.text.isEmpty()) {
            TextView q = U.text(a, "「" + c.text + "」", 13, U.SUB);
            q.setMaxLines(3);
            card.addView(q);
        }
        if (!c.contents.isEmpty() && !"Stamp".equals(c.sub)) card.addView(U.text(a, c.contents, 15, U.TEXT));
        for (Ops.Cm r : c.replies) {
            LinearLayout rr = U.vbox(a);
            rr.setPadding(U.dp(14), U.dp(6), 0, 0);
            rr.addView(U.text(a, "↳ " + r.author + "  " + r.date, 12, U.SUB));
            rr.addView(U.text(a, r.contents, 14, U.TEXT));
            rr.setOnLongClickListener(v -> { U.confirm(a, "刪除回覆", r.contents, "刪除", () -> { s.dismiss(); a.edit("刪除回覆", Doc.K_ANNOT, pd -> Ops.deleteAnnot(pd, r.page, r.index), () -> comments(a)); }); return true; });
            card.addView(rr);
        }
        card.setBackground(U.ripple(a));
        card.setOnClickListener(v -> { s.dismiss(); if (c.r != null) a.view.goTo(c.page, c.r); else a.goTo(c.page); });
        card.setOnLongClickListener(v -> { commentActions(a, s, d, c); return true; });
        LinearLayout acts = U.hbox(a);
        acts.addView(small(a, "回覆", v -> U.input(a, "回覆", "你的回覆", "", t -> { s.dismiss(); a.edit("回覆註解", Doc.K_ANNOT, pd -> Ops.reply(pd, d, c.page, c.index, t), () -> comments(a)); })));
        acts.addView(small(a, "編輯", v -> U.input(a, "編輯註解內容", "", c.contents, t -> { s.dismiss(); a.edit("編輯註解", Doc.K_ANNOT, pd -> Ops.setContents(pd, c.page, c.index, t), () -> comments(a)); })));
        acts.addView(small(a, "更多…", v -> commentActions(a, s, d, c)));
        card.addView(acts);
        return card;
    }

    static TextView small(MainActivity a, String s, View.OnClickListener l) {
        TextView t = U.text(a, s, 13, U.ACCENT);
        t.setPadding(0, U.dp(8), U.dp(18), U.dp(4));
        t.setOnClickListener(l);
        return t;
    }

    static void commentActions(MainActivity a, U.Sheet s, Doc d, Ops.Cm c) {
        U.choose(a, sub(c.sub), new String[]{"設定審閱狀態", "變更顏色", "變更不透明度", "變更線寬", "刪除"}, i -> {
            Runnable back = () -> { if (s != null) comments(a); };
            if (s != null) s.dismiss();
            switch (i) {
                case 0: {
                    String[] keys = STATE.keySet().toArray(new String[0]);
                    String[] names = STATE.values().toArray(new String[0]);
                    U.choose(a, "審閱狀態", names, k -> a.edit("設定狀態", Doc.K_ANNOT, pd -> Ops.setState(pd, c.page, c.index, keys[k]), back));
                    break;
                }
                case 1: {
                    String[] names = {"黃", "橙", "紅", "粉紅", "紫", "藍", "青", "綠", "黑", "灰"};
                    U.choose(a, "顏色", names, k -> a.edit("變更註解樣式", Doc.K_ANNOT, pd -> Ops.restyle(pd, c.page, c.index, Comments.PALETTE[k], null, null), back));
                    break;
                }
                case 2: {
                    String[] names = {"100%", "75%", "50%", "25%"};
                    float[] v = {1f, 0.75f, 0.5f, 0.25f};
                    U.choose(a, "不透明度", names, k -> a.edit("變更註解樣式", Doc.K_ANNOT, pd -> Ops.restyle(pd, c.page, c.index, null, v[k], null), back));
                    break;
                }
                case 3: {
                    String[] names = {"1 pt", "2 pt", "3 pt", "5 pt", "8 pt"};
                    float[] v = {1, 2, 3, 5, 8};
                    U.choose(a, "線寬", names, k -> a.edit("變更註解樣式", Doc.K_ANNOT, pd -> Ops.restyle(pd, c.page, c.index, null, null, v[k]), back));
                    break;
                }
                case 4:
                    U.confirm(a, "刪除註解", "刪除這個" + sub(c.sub) + "（連同回覆）？", "刪除",
                            () -> a.edit("刪除註解", Doc.K_ANNOT, pd -> Ops.deleteAnnot(pd, c.page, c.index), back));
                    break;
            }
        });
    }

    /** 在頁面上點到註解時。 */
    public static void commentAt(MainActivity a, int page, int index) {
        Doc d = a.doc();
        U.run(a, null, () -> {
            try (PDDocument pd = d.load()) {
                for (Ops.Cm c : Ops.comments(pd, d)) if (c.page == page && c.index == index) return c;
            }
            return null;
        }, c -> {
            if (c == null) return;
            StringBuilder sb = new StringBuilder();
            if (c.text != null && !c.text.isEmpty()) sb.append("「").append(c.text).append("」\n\n");
            sb.append(c.contents.isEmpty() ? "（沒有內容）" : c.contents);
            for (Ops.Cm r : c.replies) sb.append("\n\n↳ ").append(r.author).append("：").append(r.contents);
            if (c.state != null) sb.append("\n\n狀態：").append(STATE.containsKey(c.state) ? STATE.get(c.state) : c.state);
            U.dlg(a).setTitle(sub(c.sub) + " · " + c.author + " · " + c.date).setMessage(sb)
                    .setPositiveButton("回覆", (x, w) -> U.input(a, "回覆", "你的回覆", "", t -> a.edit("回覆註解", Doc.K_ANNOT, pd -> Ops.reply(pd, d, page, index, t))))
                    .setNeutralButton("更多…", (x, w) -> commentActions(a, null, d, c))
                    .setNegativeButton("編輯", (x, w) -> U.input(a, "編輯註解內容", "", c.contents, t -> a.edit("編輯註解", Doc.K_ANNOT, pd -> Ops.setContents(pd, page, index, t))))
                    .show();
        });
    }

    // ================================================================ 表單

    static String ftype(String t) {
        switch (t) {
            case "text": return "文字"; case "check": return "核取方塊"; case "radio": return "選項按鈕"; case "combo": return "下拉選單";
            case "list": return "清單"; case "sign": return "簽名"; case "button": return "按鈕"; default: return "其他";
        }
    }

    public static void fields(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        U.run(a, null, () -> { try (PDDocument pd = d.load()) { return Ops.fields(pd, d); } }, list -> {
            U.Sheet s = new U.Sheet(a, "表單欄位（" + list.size() + "）", true);
            LinearLayout acts = U.hbox(a);
            acts.setPadding(U.dp(8), 0, U.dp(8), 0);
            acts.addView(U.flat(a, a.view.showFields ? "隱藏欄位標示" : "標示欄位", v -> { a.view.showFields = !a.view.showFields; a.view.invalidate(); s.dismiss(); }));
            acts.addView(U.flat(a, "新增欄位", v -> { s.dismiss(); Tools.run(a, "form"); }));
            if (!list.isEmpty()) {
                acts.addView(U.flat(a, "清除表單", v -> U.confirm(a, "清除表單", "清除所有欄位的值？", "清除", () -> { s.dismiss(); a.edit("清除表單", Doc.K_FORM, Ops::clearForm); })));
                acts.addView(U.flat(a, "平面化", v -> U.confirm(a, "平面化表單", "把欄位的目前內容直接印在頁面上，欄位將不能再編輯。", "平面化", () -> { s.dismiss(); a.edit("平面化表單", Doc.K_EDIT, Ops::flatten); })));
            }
            android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(a);
            hs.addView(acts);
            s.body.addView(hs);
            if (list.isEmpty()) s.body.addView(pad(U.text(a, "這份文件沒有互動式表單欄位。可以用「新增欄位」自己建立表單。", 14, U.SUB)));
            int lastPage = -2;
            for (Ops.Field f : list) {
                if (f.page != lastPage) { s.body.addView(U.section(a, f.page >= 0 ? "第 " + (f.page + 1) + " 頁" : "未放在頁面上")); lastPage = f.page; }
                String sub = ftype(f.type) + (f.readOnly ? " · 唯讀" : "") + (f.required ? " · 必填" : "");
                LinearLayout row = U.row(a, f.name, sub, f.value, v -> { s.dismiss(); if (f.page >= 0 && f.r != null) a.view.goTo(f.page, f.r); editField(a, f.name); });
                row.setOnLongClickListener(v -> {
                    U.confirm(a, "刪除欄位", "刪除欄位「" + f.name + "」？", "刪除", () -> { s.dismiss(); a.edit("刪除欄位", Doc.K_EDIT, pd -> Ops.deleteField(pd, f.name)); });
                    return true;
                });
                s.body.addView(row);
            }
            s.show();
        });
    }

    public static void editField(MainActivity a, String name) {
        Doc d = a.doc();
        U.run(a, null, () -> {
            try (PDDocument pd = d.load()) {
                for (Ops.Field f : Ops.fields(pd, d)) if (f.name.equals(name)) return f;
            }
            return null;
        }, f -> {
            if (f == null) return;
            if (f.readOnly) { U.alert(a, f.name, "這個欄位是唯讀的。\n目前的值：" + f.value); return; }
            String label = "填寫欄位";
            switch (f.type) {
                case "check":
                    a.edit(label, Doc.K_FORM, pd -> Ops.setField(pd, d, f.name, "是".equals(f.value) ? "false" : "true"));
                    break;
                case "radio": {
                    if (f.options.isEmpty()) return;
                    String[] o = f.options.toArray(new String[0]);
                    U.choose(a, f.name, o, i -> a.edit(label, Doc.K_FORM, pd -> Ops.setField(pd, d, f.name, o[i])));
                    break;
                }
                case "combo": case "list": {
                    String[] o = f.options.toArray(new String[0]);
                    if (f.multi) {
                        boolean[] on = new boolean[o.length];
                        for (int i = 0; i < o.length; i++) on[i] = (", " + f.value + ",").contains(" " + o[i] + ",") || f.value.equals(o[i]);
                        U.dlg(a).setTitle(f.name).setMultiChoiceItems(o, on, (x, i, c) -> on[i] = c)
                                .setPositiveButton("確定", (x, w) -> {
                                    StringBuilder sb = new StringBuilder();
                                    for (int i = 0; i < o.length; i++) if (on[i]) sb.append(sb.length() > 0 ? "\n" : "").append(f.exports.size() > i ? f.exports.get(i) : o[i]);
                                    a.edit(label, Doc.K_FORM, pd -> Ops.setField(pd, d, f.name, sb.toString()));
                                }).setNegativeButton("取消", null).show();
                    } else if ("combo".equals(f.type)) {
                        String[] withCustom = new String[o.length + 1];
                        System.arraycopy(o, 0, withCustom, 0, o.length);
                        withCustom[o.length] = "自行輸入…";
                        U.choose(a, f.name, withCustom, i -> {
                            if (i == o.length) U.input(a, f.name, "", f.value, t -> a.edit(label, Doc.K_FORM, pd -> Ops.setField(pd, d, f.name, t)));
                            else a.edit(label, Doc.K_FORM, pd -> Ops.setField(pd, d, f.name, f.exports.size() > i ? f.exports.get(i) : o[i]));
                        });
                    } else U.choose(a, f.name, o, i -> a.edit(label, Doc.K_FORM, pd -> Ops.setField(pd, d, f.name, f.exports.size() > i ? f.exports.get(i) : o[i])));
                    break;
                }
                case "sign":
                    U.dlg(a).setTitle("簽名欄位：" + f.name).setMessage(f.value)
                            .setPositiveButton("數位簽署", (x, w) -> Tools.certSign(a, f.page, f.r))
                            .setNeutralButton("手寫簽名", (x, w) -> Tools.signInRect(a, f.page, f.r))
                            .setNegativeButton("取消", null).show();
                    break;
                case "text": {
                    int type = InputType.TYPE_CLASS_TEXT | (f.multi ? InputType.TYPE_TEXT_FLAG_MULTI_LINE : 0);
                    U.input(a, f.name, "", f.value, type, t -> a.edit(label, Doc.K_FORM, pd -> Ops.setField(pd, d, f.name, t)));
                    break;
                }
                default:
                    U.alert(a, f.name, "這種欄位（" + ftype(f.type) + "）無法在這裡編輯。");
            }
        });
    }

    // ================================================================ 圖層

    public static void layers(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        U.run(a, null, () -> {
            Map<String, Boolean> m = new LinkedHashMap<>();
            try (PDDocument pd = d.load()) {
                PDOptionalContentProperties ocp = pd.getDocumentCatalog().getOCProperties();
                if (ocp != null) for (PDOptionalContentGroup g : ocp.getOptionalContentGroups()) m.put(g.getName(), ocp.isGroupEnabled(g));
            }
            return m;
        }, m -> {
            U.Sheet s = new U.Sheet(a, "圖層（" + m.size() + "）", true, 0.6f);
            if (m.isEmpty()) s.body.addView(pad(U.text(a, "這份文件沒有圖層（選用內容）。", 14, U.SUB)));
            for (Map.Entry<String, Boolean> e : m.entrySet()) {
                boolean on = d.layers.containsKey(e.getKey()) ? d.layers.get(e.getKey()) : e.getValue();
                CheckBox cb = U.check(a, e.getKey(), on);
                cb.setPadding(U.dp(8), U.dp(10), U.dp(8), U.dp(10));
                LinearLayout.LayoutParams lp = U.lp(U.MATCH, U.WRAP);
                lp.setMargins(U.dp(14), 0, U.dp(14), 0);
                cb.setOnCheckedChangeListener((b, c) -> {
                    if (c == e.getValue()) d.layers.remove(e.getKey()); else d.layers.put(e.getKey(), c);
                    U.run(a, null, () -> { d.refreshLayers(); return true; }, r -> a.view.reset());
                });
                s.body.addView(cb, lp);
            }
            if (!m.isEmpty()) s.body.addView(pad(U.text(a, "切換只影響檢視，不會改變文件；儲存時圖層維持作者的預設狀態。", 12.5f, U.SUB)));
            s.show();
        });
    }

    // ================================================================ 附件

    public static void attachments(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        U.run(a, null, () -> {
            PDDocument pd = d.load();
            List<Ops.Att> l = Ops.attachments(pd);
            // 先把內容讀進暫存檔，關閉文件後還能開啟 / 儲存
            List<Object[]> out = new ArrayList<>();
            File dir = new File(FileProv.dir(a), "att");
            dir.mkdirs();
            for (Ops.Att x : l) {
                File f = new File(dir, U.safeName(x.name));
                try (OutputStream os = new FileOutputStream(f)) { Ops.exportAttachment(x, os); } catch (Exception e) { f = null; }
                out.add(new Object[]{x, f});
            }
            pd.close();
            return out;
        }, list -> {
            U.Sheet s = new U.Sheet(a, "附件（" + list.size() + "）", true, 0.65f);
            s.header.addView(U.icon(a, "＋", "加入附件", v -> {
                s.dismiss();
                Activities.pick(a, new String[]{"*/*"}, false, uris -> {
                    Uri u = uris.get(0);
                    String name = U.nameOf(a, u);
                    String mime = a.getContentResolver().getType(u);
                    U.run(a, "讀取檔案…", () -> {
                        try (InputStream in = a.getContentResolver().openInputStream(u)) {
                            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                            U.copy(in, bo);
                            return bo.toByteArray();
                        }
                    }, data -> a.edit("加入附件", Doc.K_EDIT, pd -> Ops.addAttachment(pd, name, data, mime), () -> attachments(a)));
                });
            }), 1);
            if (list.isEmpty()) s.body.addView(pad(U.text(a, "沒有附件。按「＋」可以把任何檔案附加到這份 PDF。", 14, U.SUB)));
            for (Object[] o : list) {
                Ops.Att x = (Ops.Att) o[0];
                File f = (File) o[1];
                String sub = (x.size >= 0 ? U.size(x.size) : "") + (x.page >= 0 ? " · 第 " + (x.page + 1) + " 頁的附件" : "") + (x.desc.isEmpty() ? "" : " · " + x.desc);
                s.body.addView(U.row(a, "📎 " + x.name, sub, null, v -> {
                    if (f == null) { U.toast(a, "無法讀取附件內容"); return; }
                    String[] opts = x.page >= 0 ? new String[]{"開啟", "儲存到…", "分享"} : new String[]{"開啟", "儲存到…", "分享", "移除"};
                    U.choose(a, x.name, opts, i -> {
                        String mime = new FileProv().getType(FileProv.uri(new File(f.getName())));
                        File shared = new File(FileProv.dir(a), f.getName());
                        try { U.copyFile(f, shared); } catch (Exception ignored) {}
                        if (i == 0) {
                            try {
                                a.startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(FileProv.uri(shared), mime)
                                        .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION));
                            } catch (Exception e) { U.toast(a, "沒有可以開啟這種檔案的 App"); }
                        } else if (i == 1) {
                            Activities.create(a, x.name, mime, u -> U.run(a, "儲存中…", () -> { U.copyToUri(a, f, u); return true; }, r -> U.toast(a, "已儲存")));
                        } else if (i == 2) a.shareFile(shared, mime);
                        else U.confirm(a, "移除附件", "從文件中移除「" + x.name + "」？", "移除", () -> { s.dismiss(); a.edit("移除附件", Doc.K_EDIT, pd -> Ops.removeAttachment(pd, x.name), () -> attachments(a)); });
                    });
                }));
            }
            s.show();
        });
    }

    // ================================================================ 文件屬性

    public static void properties(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        U.run(a, "讀取文件屬性…", () -> {
            Map<String, Object> m = new LinkedHashMap<>();
            try (PDDocument pd = d.load()) {
                PDDocumentInformation info = pd.getDocumentInformation();
                m.put("title", nz(info.getTitle())); m.put("author", nz(info.getAuthor()));
                m.put("subject", nz(info.getSubject())); m.put("keywords", nz(info.getKeywords()));
                m.put("creator", nz(info.getCreator())); m.put("producer", nz(info.getProducer()));
                m.put("created", Ops.fmtDate(info.getCreationDate())); m.put("modified", Ops.fmtDate(info.getModificationDate()));
                m.put("version", String.valueOf(pd.getVersion()));
                PDRectangle mb = pd.getPage(0).getCropBox();
                m.put("size", paper(mb.getWidth(), mb.getHeight()));
                boolean mixed = false;
                for (PDPage p : pd.getPages()) if (Math.abs(p.getCropBox().getWidth() - mb.getWidth()) > 1 || Math.abs(p.getCropBox().getHeight() - mb.getHeight()) > 1) mixed = true;
                m.put("mixed", mixed);
                m.put("fields", Ops.fields(pd, d).size());
                PDOptionalContentProperties ocp = pd.getDocumentCatalog().getOCProperties();
                int nl = 0;
                if (ocp != null) for (PDOptionalContentGroup ignored : ocp.getOptionalContentGroups()) nl++;
                m.put("layers", nl);
                m.put("attachments", Ops.attachments(pd).size());
                m.put("bookmarks", Ops.outline(pd).size());
                m.put("tagged", pd.getDocumentCatalog().getMarkInfo() != null && pd.getDocumentCatalog().getMarkInfo().isMarked());
                m.put("lang", nz(pd.getDocumentCatalog().getLanguage()));
                m.put("sigs", pd.getSignatureDictionaries().size());
                // 字型
                Map<String, String> fonts = new LinkedHashMap<>();
                Set<Object> seen = new HashSet<>();
                for (PDPage p : pd.getPages()) collectFonts(p.getResources(), fonts, seen, 0);
                m.put("fonts", fonts);
            }
            return m;
        }, m -> {
            U.Sheet s = new U.Sheet(a, "文件屬性", true);
            s.body.addView(U.section(a, "描述（可編輯）"));
            LinearLayout desc = U.vbox(a);
            desc.setPadding(U.dp(18), 0, U.dp(18), 0);
            EditText t = U.edit(a, "標題", (String) m.get("title"));
            EditText au = U.edit(a, "作者", (String) m.get("author"));
            EditText su = U.edit(a, "主旨", (String) m.get("subject"));
            EditText kw = U.edit(a, "關鍵字", (String) m.get("keywords"));
            for (EditText e : new EditText[]{t, au, su, kw}) {
                desc.addView(U.text(a, e.getHint().toString(), 12, U.SUB));
                desc.addView(e);
            }
            desc.addView(U.primary(a, "儲存描述", v -> {
                s.dismiss();
                a.edit("編輯文件資訊", Doc.K_EDIT, pd -> Ops.setInfo(pd, t.getText().toString(), au.getText().toString(), su.getText().toString(), kw.getText().toString()));
            }));
            s.body.addView(desc);

            s.body.addView(U.section(a, "文件"));
            s.body.addView(U.row(a, "檔案名稱", null, d.name, null));
            s.body.addView(U.row(a, "檔案大小", null, U.size(d.current().length()), null));
            s.body.addView(U.row(a, "PDF 版本", null, (String) m.get("version"), null));
            s.body.addView(U.row(a, "頁數", null, String.valueOf(d.n), null));
            s.body.addView(U.row(a, "頁面大小", (Boolean) m.get("mixed") ? "各頁大小不同（顯示第 1 頁）" : null, (String) m.get("size"), null));
            s.body.addView(U.row(a, "頁面標籤", null, d.hasLabels ? "有（例如 " + (d.labels != null && d.labels.length > 0 ? d.labels[0] : "") + "）" : "無", v -> { s.dismiss(); Tools.labels(a); }));
            s.body.addView(U.row(a, "書籤", null, m.get("bookmarks") + " 個（第一層）", null));
            s.body.addView(U.row(a, "表單欄位", null, String.valueOf(m.get("fields")), null));
            s.body.addView(U.row(a, "圖層", null, String.valueOf(m.get("layers")), null));
            s.body.addView(U.row(a, "附件", null, String.valueOf(m.get("attachments")), null));
            s.body.addView(U.row(a, "數位簽章", null, String.valueOf(m.get("sigs")), null));
            s.body.addView(U.row(a, "標記（Tagged PDF）", null, (Boolean) m.get("tagged") ? "是" : "否", null));
            s.body.addView(U.row(a, "語言", null, ((String) m.get("lang")).isEmpty() ? "未設定" : (String) m.get("lang"), null));
            s.body.addView(U.row(a, "建立者 / 製作程式", (String) m.get("creator"), (String) m.get("producer"), null));
            s.body.addView(U.row(a, "建立 / 修改日期", (String) m.get("created"), (String) m.get("modified"), null));

            @SuppressWarnings("unchecked") Map<String, String> fonts = (Map<String, String>) m.get("fonts");
            s.body.addView(U.section(a, "字型（" + fonts.size() + "）"));
            if (fonts.isEmpty()) s.body.addView(U.row(a, "沒有使用字型", null, null, null));
            for (Map.Entry<String, String> e : fonts.entrySet()) s.body.addView(U.row(a, e.getKey(), e.getValue(), null, null));

            s.body.addView(U.section(a, "安全性"));
            if (!d.encrypted) s.body.addView(U.row(a, "未加密", "任何人都可以開啟", null, null));
            else {
                for (String line : d.encDesc.split("\n")) {
                    int i = line.indexOf('：');
                    s.body.addView(U.row(a, i > 0 ? line.substring(0, i) : line, null, i > 0 ? line.substring(i + 1) : null, null));
                }
                s.body.addView(U.row(a, "開啟時使用", null, d.owner ? "擁有者密碼（完整權限）" : (d.openPwd.isEmpty() ? "不需密碼（使用者）" : "使用者密碼"), null));
                AccessPermission p = d.perm;
                if (p != null) {
                    String[][] perms = {{"列印", "" + p.canPrint()}, {"高品質列印", "" + p.canPrintFaithful()}, {"修改文件", "" + p.canModify()},
                            {"複製文字與圖片", "" + p.canExtractContent()}, {"新增 / 修改註解", "" + p.canModifyAnnotations()},
                            {"填寫表單", "" + p.canFillInForm()}, {"無障礙擷取", "" + p.canExtractForAccessibility()}, {"組合文件（頁面）", "" + p.canAssembleDocument()}};
                    for (String[] x : perms) s.body.addView(U.row(a, x[0], null, d.owner || "true".equals(x[1]) ? "允許" : "不允許", null));
                }
                if (!d.owner) s.body.addView(U.row(a, "🔒 輸入擁有者密碼以解除限制", null, null, v -> { s.dismiss(); unlock(a, d); }));
                if (d.encOut != null) s.body.addView(U.row(a, "儲存時", "以 AES-256 重新加密，保留相同密碼", null, null));
            }
            s.body.addView(U.row(a, "變更保護設定…", null, null, v -> { s.dismiss(); Tools.run(a, "protect"); }));
            s.show();
        });
    }

    static String nz(String s) { return s == null ? "" : s; }

    static String paper(float w, float h) {
        String mm = Math.round(w * 25.4f / 72) + " × " + Math.round(h * 25.4f / 72) + " mm";
        float a = Math.min(w, h), b = Math.max(w, h);
        String[][] std = {{"A3", "842", "1191"}, {"A4", "595", "842"}, {"A5", "420", "595"}, {"B5", "499", "709"}, {"Letter", "612", "792"}, {"Legal", "612", "1008"}};
        for (String[] x : std) if (Math.abs(a - Float.parseFloat(x[1])) < 4 && Math.abs(b - Float.parseFloat(x[2])) < 4) return x[0] + (w > h ? " 橫向" : "") + "（" + mm + "）";
        return mm;
    }

    static void collectFonts(PDResources r, Map<String, String> out, Set<Object> seen, int depth) {
        if (r == null || depth > 5 || !seen.add(r.getCOSObject())) return;
        try {
            for (COSName n : r.getFontNames()) {
                try {
                    PDFont f = r.getFont(n);
                    if (f == null) continue;
                    String name = f.getName() == null ? n.getName() : f.getName();
                    int plus = name.indexOf('+');
                    boolean subset = plus == 6;
                    if (subset) name = name.substring(7);
                    out.put(name, f.getSubType() + " · " + (f.isEmbedded() ? (subset ? "已嵌入子集" : "已嵌入") : "未嵌入"));
                } catch (Exception ignored) {}
            }
            for (COSName n : r.getXObjectNames()) {
                try {
                    com.tom_roush.pdfbox.pdmodel.graphics.PDXObject x = r.getXObject(n);
                    if (x instanceof com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject)
                        collectFonts(((com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject) x).getResources(), out, seen, depth + 1);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    public static void unlock(MainActivity a, Doc d) {
        U.input(a, "解除限制", "擁有者密碼", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, p ->
                U.run(a, "驗證中…", () -> { d.unlockOwner(p); return true; }, r -> { U.toast(a, "已解除限制，可以編輯了"); a.select(App.docs.indexOf(d)); }));
    }
}
