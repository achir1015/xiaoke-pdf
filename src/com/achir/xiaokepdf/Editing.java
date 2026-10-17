package com.achir.xiaokepdf;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.RectF;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;

import com.tom_roush.pdfbox.pdmodel.font.PDFont;

/** 編輯工具列：編輯既有文字、新增文字 / 圖片 / 連結、浮水印、頁碼、頁面。 */
public final class Editing {
    private Editing() {}

    static final String[] NAMES = {"編輯文字", "新增文字", "插入表格", "新增圖片", "插入 QR Code", "新增連結", "貼上", "浮水印", "移除浮水印", "頁首頁尾頁碼", "裁切", "整理頁面"};
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
            case 4: qrDialog(a, "插入 QR Code", "url", "", null, (t, s) ->
                    Tools.place(a, "點一下放 QR Code（或拖曳出位置與大小）", 1, 100, false,
                            (p, r) -> a.edit("插入 QR Code", Doc.K_EDIT, pd -> Ops.addQr(pd, d, p, r, t, s)))); break;
            case 5: Tools.place(a, "框選要變成連結的區域", 0, 120, false, (p, r) ->
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
            case 6: pasteMode(a, d); break;
            case 7: Tools.watermark(a, d); break;
            case 8: Tools.removeWatermark(a); break;
            case 9: Tools.headerFooter(a, d); break;
            case 10: Tools.crop(a, null); break;
            case 11: Organizer.show(a); break;
        }
    }

    /**
     * 貼上剪貼簿：先讀剪貼簿，再點一下要放的位置。
     * 圖片 → 圖片（可拖曳出大小）；網址 → 可點的連結文字；其他文字 → 文字（新增文字的樣式）。
     */
    static void pasteMode(MainActivity a, Doc d) {
        ClipboardManager cm = (ClipboardManager) a.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = cm == null ? null : cm.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) { U.toast(a, "剪貼簿是空的"); return; }
        ClipData.Item item = clip.getItemAt(0);
        Uri uri = item.getUri();
        String mime = clip.getDescription() != null && clip.getDescription().getMimeTypeCount() > 0 ? clip.getDescription().getMimeType(0) : "";
        if (uri == null && item.getIntent() != null) uri = item.getIntent().getData();
        if (uri != null && (mime.startsWith("image/") || mime.equals("text/uri-list") || String.valueOf(a.getContentResolver().getType(uri)).startsWith("image/"))) {
            final Uri u = uri;
            U.run(a, "讀取圖片…", () -> Tools.decode(a, u, 2000), b -> Tools.place(a, "點一下要貼上圖片的位置（或拖曳出大小）", b.getWidth() / (float) b.getHeight(), 200, false,
                    (p, r) -> a.edit("貼上圖片", Doc.K_EDIT, pd -> Ops.addImage(pd, d, p, r, b, 1))));
            return;
        }
        CharSequence cs = item.coerceToText(a);
        final String text = cs == null ? "" : cs.toString().replace("\r\n", "\n").replace('\r', '\n').trim();
        if (text.isEmpty()) { U.toast(a, "剪貼簿裡沒有可以貼上的文字或圖片"); return; }
        final boolean url = !text.contains("\n") && text.matches("(?i)^(https?://|www\\.)\\S+$");
        a.setMode(new MainActivity.Mode() {
            @Override public void tap(int page, float x, float y) {
                a.exitModes();
                TextStyle st = TextStyle.load(a, "add");
                st.lineHeight = 0;
                a.edit(url ? "貼上連結" : "貼上文字", Doc.K_EDIT, pd -> {
                    float wrapW = Math.max(80, d.dw(page) - x - 24);
                    float top = y - st.size * 0.5f;      // 點的位置是第一行字的中間
                    Ops.addText(pd, d, page, new RectF(x, top, x + wrapW, top + st.size), text, st);
                    if (url) {
                        PDFont f = st.pdfFont(pd, text);
                        float w = 0;
                        try { w = f != null ? f.getStringWidth(text) / 1000 * st.size : 0; } catch (Exception e) { w = 0; }
                        if (w <= 0) w = text.length() * st.size * 0.55f;
                        String link = text.toLowerCase(java.util.Locale.ROOT).startsWith("www.") ? "https://" + text : text;
                        Ops.addLink(pd, d, page, new RectF(x, top, x + Math.min(w + 2, wrapW), top + st.size * 1.3f), link, -1);
                    }
                });
            }
        }, PdfView.T_POINT, url ? "點一下要貼上連結的位置" : "點一下要貼上文字的位置", null, null);
    }

    /** 點一下頁面上的文字 → 原本的位置直接變成編輯框（像 Word 一樣，整段一起改）。 */
    static void editTextMode(MainActivity a, Doc d) {
        a.setMode(new MainActivity.Mode() {
            @Override public void tap(int page, float x, float y) {
                Doc.Annot q = qrAt(d, page, x, y);
                if (q != null) editQr(a, d, page, q);
                else a.inline.editAt(d, page, x, y);
            }
        }, PdfView.T_POINT, "點一下要修改的文字（直接在頁面上打字）或 QR Code；點空白處可新增文字", null, null);
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

    // ------------------------------------------------------------------ QR Code

    interface QrDone { void got(String type, String data); }

    /** 頁面上這個位置的 QR Code（小柯插入的）。 */
    static Doc.Annot qrAt(Doc d, int page, float x, float y) {
        if (page >= d.annots.size()) return null;
        List<Doc.Annot> list = d.annots.get(page);
        for (int i = list.size() - 1; i >= 0; i--) {
            Doc.Annot an = list.get(i);
            if (an.qr != null && !an.hidden && an.r != null && an.r.contains(x, y)) return an;
        }
        return null;
    }

    /** 點一下 QR Code → 修改內容或刪除（位置大小不變）。 */
    static void editQr(MainActivity a, Doc d, int page, Doc.Annot an) {
        qrDialog(a, "修改 QR Code", an.qrType, an.qr,
                () -> a.edit("刪除 QR Code", Doc.K_EDIT, pd -> Ops.deleteQr(pd, page, an.qrId)),
                (t, s) -> a.edit("修改 QR Code", Doc.K_EDIT, pd -> Ops.setQr(pd, page, an.qrId, t, s)));
    }

    /** 選「網址」或「文字資料」、輸入內容，下方即時預覽。onDelete 不是 null 時多一個「刪除」。 */
    static void qrDialog(MainActivity a, String title, String type, String data, Runnable onDelete, QrDone cb) {
        final String[] t = {"url".equals(type) ? "url" : "text"};
        LinearLayout box = U.vbox(a);
        box.setPadding(U.dp(20), U.dp(8), U.dp(20), 0);
        LinearLayout seg = U.hbox(a);
        TextView url = U.text(a, "網址", 15, U.TEXT), txt = U.text(a, "文字資料", 15, U.TEXT);
        for (TextView v : new TextView[]{url, txt}) {
            v.setPadding(U.dp(16), U.dp(8), U.dp(16), U.dp(8));
            seg.addView(v);
        }
        box.addView(seg);
        EditText e = U.edit(a, "", data);
        box.addView(e);
        TextView note = U.text(a, "", 13, U.SUB);
        box.addView(note);
        ImageView pv = new ImageView(a);
        pv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams lp = U.lp(U.dp(150), U.dp(150));
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        lp.topMargin = U.dp(8);
        box.addView(pv, lp);

        Runnable preview = () -> {
            String s = value(t[0], e.getText().toString());
            if (s.isEmpty()) { pv.setImageBitmap(null); note.setText(""); return; }
            try { pv.setImageBitmap(Draw.qr(s)); note.setText("url".equals(t[0]) ? "掃描後開啟：" + s : ""); }
            catch (IllegalArgumentException x) { pv.setImageBitmap(null); note.setText(x.getMessage()); }
        };
        Runnable mode = () -> {
            boolean u = "url".equals(t[0]);
            url.setBackground(u ? U.round(U.ACCENT_SOFT, 0, 16) : null);
            url.setTextColor(u ? U.ACCENT : U.TEXT);
            txt.setBackground(u ? null : U.round(U.ACCENT_SOFT, 0, 16));
            txt.setTextColor(u ? U.TEXT : U.ACCENT);
            e.setInputType(u ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI
                    : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            e.setMaxLines(u ? 3 : 8);
            e.setHint(u ? "https://example.com" : "要放進 QR Code 的文字（可多行，例如聯絡資料、說明）");
            e.setSelection(e.getText().length());
            preview.run();
        };
        url.setOnClickListener(v -> { t[0] = "url"; mode.run(); });
        txt.setOnClickListener(v -> { t[0] = "text"; mode.run(); });
        e.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int af) {}
            @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { preview.run(); }
        });
        mode.run();

        ScrollView sv = new ScrollView(a);   // 鍵盤出現時預覽圖不會被切掉
        sv.addView(box);
        AlertDialog.Builder b = U.dlg(a).setTitle(title).setView(sv)
                .setPositiveButton(onDelete == null ? "插入" : "更新", null)
                .setNegativeButton("取消", null);
        if (onDelete != null) b.setNeutralButton("刪除", (x, w) -> onDelete.run());
        AlertDialog dlg = b.create();
        dlg.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        dlg.show();
        e.requestFocus();
        dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String s = value(t[0], e.getText().toString());
            if (s.isEmpty()) { U.toast(a, "請輸入內容"); return; }
            try { QrCode.encode(s); } catch (IllegalArgumentException x) { U.toast(a, x.getMessage()); return; }
            dlg.dismiss();
            cb.got(t[0], s);
        });
    }

    /** 網址沒寫 http(s):// 時自動補上。 */
    static String value(String type, String s) {
        s = "url".equals(type) ? s.trim() : s;
        if ("url".equals(type) && !s.isEmpty() && !s.matches("(?i)^[a-z][a-z0-9+.-]*:.*")) s = "https://" + s;
        return s;
    }
}
