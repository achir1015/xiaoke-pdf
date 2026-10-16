package com.achir.xiaokepdf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.pdf.PdfDocument;
import android.graphics.pdf.PdfRenderer;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.text.Editable;
import android.text.InputType;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextWatcher;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.tom_roush.pdfbox.cos.COSDictionary;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDDocumentCatalog;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission;
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException;
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory;
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory;
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject;
import com.tom_roush.pdfbox.pdmodel.interactive.viewerpreferences.PDViewerPreferences;
import com.tom_roush.pdfbox.text.PDFTextStripper;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** 工具目錄、指令面板，以及每個工具的流程。 */
public final class Tools {
    private Tools() {}

    public static class Tool {
        public final String id, name, desc, icon, status, keys;
        public final int color;
        Tool(String id, String name, String desc, String icon, int color, String status, String keys) {
            this.id = id; this.name = name; this.desc = desc; this.icon = icon; this.color = color; this.status = status; this.keys = keys;
        }
    }

    private static final List<Tool> TOOLS = Arrays.asList(
            new Tool("export", "匯出 PDF", "轉成圖片・純文字・Word", "⇪", 0xFF1E88E5, null, "export png jpg image text word docx 圖片 文字 轉檔"),
            new Tool("fillsign", "填寫與簽署", "填表單・手寫簽名・日期・勾選", "✍", 0xFF8E24AA, null, "fill sign signature 簽名 表單 日期"),
            new Tool("edit", "編輯 PDF", "編輯文字・新增文字・圖片・連結・浮水印・頁碼・裁切", "✎", 0xFFD81B60, null, "edit text image link watermark header footer 頁碼 浮水印 頁首 頁尾 裁切 編輯文字 修改文字"),
            new Tool("create", "建立 PDF", "圖片轉 PDF・空白文件・文字・相機", "＋", 0xFFE53935, null, "create new image photo blank 新增 圖片 空白"),
            new Tool("combine", "合併檔案", "多個 PDF 合成一份，每份一個書籤", "⧉", 0xFF1E63E9, null, "merge combine 合併"),
            new Tool("organize", "整理頁面", "頁面格狀・旋轉・刪除・插入・移動", "▦", 0xFF43A047, null, "organize pages rotate delete insert move 旋轉 刪除 插入 移動 頁面"),
            new Tool("split", "分割與擷取", "擷取頁面・每 N 頁分割・指定頁前分割", "✂", 0xFF00897B, null, "split extract 分割 擷取"),
            new Tool("comment", "新增註解", "便利貼・螢光標示・底線・圖形・手繪", "💬", 0xFFFB8C00, null, "comment annotate highlight note 註解 螢光 便利貼 手繪"),
            new Tool("scan", "掃描與 OCR", "用相機掃描文件成 PDF", "⌗", 0xFF43A047, "OCR 文字辨識：開發中（預計 v1.2）", "scan camera ocr 掃描 相機 辨識"),
            new Tool("protect", "保護 PDF", "密碼保護・權限・移除隱藏資訊", "🛡", 0xFF1E63E9, null, "protect password encrypt security 密碼 加密 權限 安全"),
            new Tool("redact", "塗銷 PDF", "框選或搜尋後永久移除內容", "▬", 0xFFE53935, null, "redact 塗銷 遮蔽 隱私"),
            new Tool("compress", "壓縮 PDF", "縮小圖片，讓檔案變小", "⇲", 0xFFE53935, null, "compress reduce size 壓縮 縮小"),
            new Tool("form", "準備表單", "新增文字欄位・核取方塊・下拉選單・簽名欄位", "☐", 0xFF8E24AA, null, "form field 表單 欄位"),
            new Tool("stamp", "加上印章", "核准・機密・草稿…或自訂文字、圖片", "⎔", 0xFF8E24AA, null, "stamp 印章 核准"),
            new Tool("cert", "使用憑證", "數位簽署・驗證簽章・自簽憑證", "✔", 0xFF00897B, null, "certificate digital signature verify 憑證 數位簽章 驗證"),
            new Tool("print", "印刷製作", "列印・頁面方塊・灰階・點陣化", "⎙", 0xFF1E63E9, null, "print 列印 灰階"),
            new Tool("measure", "測量物件", "距離・面積・比例尺", "📏", 0xFFD81B60, null, "measure distance area 測量 距離 面積"),
            new Tool("compare", "比較檔案", "逐頁找出兩份文件的文字差異", "⇄", 0xFF8E24AA, null, "compare diff 比較 差異"),
            new Tool("guided", "引導式動作", "一鍵完成發佈前清理、封存等多個步驟", "☰", 0xFF1E63E9, null, "guided action wizard 引導 批次"),
            new Tool("access", "無障礙準備", "檢查並修正標題、語言等設定", "♿", 0xFF8E24AA, null, "accessibility 無障礙"),
            new Tool("unwatermark", "移除浮水印", "移除標準浮水印、指定文字或浮水印圖層", "⌫", 0xFFE53935, null, "remove watermark 移除 去除 浮水印"),
            new Tool("properties", "文件屬性", "標題・作者・字型・頁面大小・安全性", "ⓘ", 0xFF6B7078, null, "properties info metadata 屬性 資訊 字型"),
            new Tool("bookmarks", "書籤", "瀏覽、搜尋、新增與編輯書籤", "🔖", 0xFFFB8C00, null, "bookmark outline 書籤 目錄"),
            new Tool("labels", "頁面標籤", "i、ii、1、2… 自訂頁碼樣式", "#", 0xFF00897B, null, "page labels 頁碼 標籤"),
            new Tool("attachments", "附件", "開啟、儲存、加入、移除附件", "📎", 0xFF6B7078, null, "attachment 附件"),
            new Tool("layers", "圖層", "切換選用內容的顯示", "◫", 0xFF6B7078, null, "layers ocg 圖層"));

    public static List<Tool> all() { return TOOLS; }

    public static Tool byId(String id) {
        for (Tool t : TOOLS) if (t.id.equals(id)) return t;
        return TOOLS.get(0);
    }

    /** 所有工具目錄。 */
    public static void catalog(MainActivity a) {
        U.Sheet s = new U.Sheet(a, "所有工具", true);
        TextView q = U.text(a, "⌕  尋找工具與指令（Ctrl+K）", 14, U.SUB);
        q.setBackground(U.round(U.BG, U.LINE, 20));
        q.setPadding(U.dp(14), U.dp(10), U.dp(14), U.dp(10));
        q.setOnClickListener(v -> { s.dismiss(); palette(a); });
        LinearLayout.LayoutParams lp = U.lp(U.MATCH, U.WRAP);
        lp.setMargins(U.dp(16), U.dp(12), U.dp(16), U.dp(4));
        s.body.addView(q, lp);
        for (Tool t : TOOLS) {
            LinearLayout r = U.hbox(a);
            r.setPadding(U.dp(16), U.dp(10), U.dp(16), U.dp(10));
            TextView ic = U.text(a, t.icon, 19, t.color);
            ic.setGravity(android.view.Gravity.CENTER);
            r.addView(ic, U.lp(U.dp(36), U.WRAP));
            LinearLayout tx = U.vbox(a);
            tx.addView(U.text(a, t.name, 15.5f, U.TEXT));
            tx.addView(U.text(a, t.status != null ? t.desc + "｜" + t.status : t.desc, 12.5f, U.SUB));
            r.addView(tx, U.lpw(1));
            r.setBackground(U.ripple(a));
            r.setOnClickListener(v -> { s.dismiss(); run(a, t.id); });
            s.body.addView(r);
        }
        s.show();
    }

    static class Cmd {
        final String name, keys; final Runnable r; final boolean needDoc;
        Cmd(String n, String k, boolean nd, Runnable r) { name = n; keys = k; needDoc = nd; this.r = r; }
    }

    /** 指令面板（⌘K）：搜尋所有工具和指令。 */
    public static void palette(MainActivity a) {
        List<Cmd> cmds = new ArrayList<>();
        for (Tool t : TOOLS) cmds.add(new Cmd(t.icon + "  " + t.name, t.desc + " " + t.keys, false, () -> run(a, t.id)));
        Object[][] extra = {
                {"開啟檔案", "open 開啟", false, (Runnable) a::pickPdf},
                {"儲存", "save 儲存", true, (Runnable) () -> a.save(a.doc(), null)},
                {"另存新檔", "save as 另存", true, (Runnable) () -> a.saveAs(a.doc(), null)},
                {"搜尋文件", "find search 搜尋 尋找", true, (Runnable) a::openSearch},
                {"復原", "undo 復原 撤銷", true, (Runnable) a::undo},
                {"重做", "redo 重做", true, (Runnable) a::redo},
                {"前往頁面", "go to page 前往 跳頁", true, (Runnable) a::askPage},
                {"檢視：連續捲動", "continuous view 連續", true, (Runnable) () -> a.view.setMode(PdfView.CONT)},
                {"檢視：單頁", "single page 單頁", true, (Runnable) () -> a.view.setMode(PdfView.SINGLE)},
                {"檢視：雙頁", "two page spread 雙頁", true, (Runnable) () -> a.view.setMode(PdfView.TWO)},
                {"檢視：向右旋轉", "rotate view 旋轉檢視", true, (Runnable) () -> a.view.rotateView(1)},
                {"檢視：向左旋轉", "rotate view 旋轉檢視", true, (Runnable) () -> a.view.rotateView(-1)},
                {"全螢幕閱讀", "fullscreen distraction free 全螢幕 無干擾", true, (Runnable) () -> a.setFullscreen(true)},
                {"夜間頁面（反白）", "night invert 夜間", true, (Runnable) () -> { a.view.night = !a.view.night; a.view.sepia = false; a.prefs.edit().putBoolean("night", a.view.night).apply(); a.view.invalidate(); }},
                {"護眼色", "sepia 護眼", true, (Runnable) () -> { a.view.sepia = !a.view.sepia; a.view.night = false; a.prefs.edit().putBoolean("sepia", a.view.sepia).apply(); a.view.invalidate(); }},
                {"主題：深色", "dark theme 深色 主題", false, (Runnable) () -> a.setTheme("dark")},
                {"主題：淺色", "light theme 淺色 主題", false, (Runnable) () -> a.setTheme("light")},
                {"主題：跟隨系統", "system theme 主題", false, (Runnable) () -> a.setTheme("system")},
                {"頁面縮圖", "thumbnails 縮圖", true, (Runnable) () -> Panels.thumbnails(a)},
                {"註解清單", "comments list 註解", true, (Runnable) () -> Panels.comments(a)},
                {"表單欄位清單", "fields 表單 欄位", true, (Runnable) () -> Panels.fields(a)},
                {"標示表單欄位", "highlight fields 標示", true, (Runnable) () -> { a.view.showFields = !a.view.showFields; a.view.invalidate(); }},
                {"分享", "share 分享", true, (Runnable) () -> a.share(a.doc())},
                {"關閉分頁", "close tab 關閉", true, (Runnable) () -> a.closeTab(App.docs.indexOf(a.doc()), null)},
                {"重新開啟上次關閉的分頁", "reopen 重新開啟", false, (Runnable) a::reopenClosed},
                {"顯示檔案", "show file 檔案 位置", true, (Runnable) () -> a.showFile(a.doc())},
                {"選取整頁文字", "select all 全選", true, (Runnable) () -> a.view.selectAllOnPage(a.view.page())},
                {"設定", "settings 設定 作者", false, (Runnable) () -> settings(a)},
                {"檢查更新", "update 更新 新版 版本", false, (Runnable) () -> Updater.check(a)},
        };
        for (Object[] e : extra) cmds.add(new Cmd((String) e[0], (String) e[1], (Boolean) e[2], (Runnable) e[3]));

        U.Sheet s = new U.Sheet(a, "尋找工具與指令", false);
        EditText q = U.edit(a, "輸入關鍵字，例如：旋轉、簽名、壓縮", "");
        q.setSingleLine(true);
        LinearLayout.LayoutParams lp = U.lp(U.MATCH, U.WRAP);
        lp.setMargins(U.dp(16), U.dp(4), U.dp(16), 0);
        s.body.addView(q, lp);
        ScrollView sv = new ScrollView(a);
        LinearLayout list = U.vbox(a);
        sv.addView(list);
        s.body.addView(sv, new LinearLayout.LayoutParams(U.MATCH, 0, 1));
        Runnable draw = () -> {
            list.removeAllViews();
            String f = q.getText().toString().trim().toLowerCase(Locale.ROOT);
            for (Cmd c : cmds) {
                if (!f.isEmpty() && !c.name.toLowerCase(Locale.ROOT).contains(f) && !c.keys.toLowerCase(Locale.ROOT).contains(f)) continue;
                boolean off = c.needDoc && a.doc() == null;
                LinearLayout r = U.row(a, c.name, off ? "需要先開啟文件" : null, null, v -> {
                    if (off) { U.toast(a, "請先開啟文件"); return; }
                    s.dismiss();
                    c.r.run();
                });
                if (off) r.setAlpha(0.5f);
                list.addView(r);
            }
        };
        q.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence x, int b, int c, int d) {}
            public void onTextChanged(CharSequence x, int b, int c, int d) {}
            public void afterTextChanged(Editable e) { draw.run(); }
        });
        draw.run();
        s.dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        s.show();
        q.requestFocus();
    }

    // ================================================================ 執行

    static boolean need(MainActivity a) {
        if (a.doc() == null) {
            U.dlg(a).setTitle("需要文件").setMessage("這個工具要先開啟一份 PDF。").setPositiveButton("開啟檔案", (x, w) -> a.pickPdf())
                    .setNegativeButton("取消", null).show();
            return false;
        }
        return true;
    }

    public static void run(MainActivity a, String id) {
        switch (id) {
            case "create": create(a); return;
            case "combine": combine(a); return;
            case "cert": cert(a); return;
            case "scan": scan(a); return;
            case "compare": if (need(a)) compare(a); return;
        }
        if (!need(a)) return;
        switch (id) {
            case "export": export(a); break;
            case "fillsign": fillSign(a); break;
            case "edit": edit(a); break;
            case "organize": Organizer.show(a); break;
            case "split": split(a); break;
            case "comment": a.commentMode(true); break;
            case "protect": protect(a); break;
            case "redact": redact(a); break;
            case "compress": compress(a); break;
            case "form": prepareForm(a, -1); break;
            case "stamp": stamp(a); break;
            case "print": printTool(a); break;
            case "measure": measure(a); break;
            case "guided": guided(a); break;
            case "access": access(a); break;
            case "properties": Panels.properties(a); break;
            case "unwatermark": removeWatermark(a); break;
            case "bookmarks": Panels.bookmarks(a); break;
            case "labels": labels(a); break;
            case "attachments": Panels.attachments(a); break;
            case "layers": Panels.layers(a); break;
        }
    }

    // ================================================================ 放置（框選或點一下）

    interface Place { void at(int page, RectF r); }

    static RectF fit(RectF r, float aspect) {
        float w = r.width(), h = r.height();
        if (w / h > aspect) w = h * aspect; else h = w / aspect;
        return new RectF(r.centerX() - w / 2, r.centerY() - h / 2, r.centerX() + w / 2, r.centerY() + h / 2);
    }

    /** aspect：寬 / 高（0 表示不限）；defW：點一下時的預設寬度（pt）。 */
    static void place(MainActivity a, String hint, float aspect, float defW, boolean sticky, Place cb) {
        Doc d = a.doc();
        a.setMode(new MainActivity.Mode() {
            void done(int page, RectF r) {
                r.offset(Math.max(0, -r.left), Math.max(0, -r.top));
                r.offset(Math.min(0, d.dw(page) - r.right), Math.min(0, d.dh(page) - r.bottom));
                if (!sticky) a.exitModes();
                cb.at(page, r);
            }
            @Override public void rect(int page, RectF r) { done(page, aspect > 0 ? fit(r, aspect) : new RectF(r)); }
            @Override public void tap(int page, float x, float y) {
                float w = defW, h = aspect > 0 ? defW / aspect : defW * 0.35f;
                done(page, new RectF(x - w / 2, y - h / 2, x + w / 2, y + h / 2));
            }
        }, PdfView.T_RECT, hint, null, null);
    }

    static void pickImage(MainActivity a, U.Done<Bitmap> cb) {
        Activities.pick(a, new String[]{"image/*"}, false, uris ->
                U.run(a, "讀取圖片…", () -> decode(a, uris.get(0), 2000), cb));
    }

    static Bitmap decode(Context c, Uri u, int max) throws IOException {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = c.getContentResolver().openInputStream(u)) { BitmapFactory.decodeStream(in, null, o); }
        int s = 1;
        while (Math.max(o.outWidth, o.outHeight) / s > max * 2) s *= 2;
        o = new BitmapFactory.Options();
        o.inSampleSize = s;
        Bitmap b;
        try (InputStream in = c.getContentResolver().openInputStream(u)) { b = BitmapFactory.decodeStream(in, null, o); }
        if (b == null) throw new IOException("無法讀取這張圖片");
        int rot = 0;
        try (InputStream in = c.getContentResolver().openInputStream(u)) {
            int or = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            rot = or == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : or == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : or == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
        } catch (Exception ignored) {}
        float sc = Math.min(1f, max / (float) Math.max(b.getWidth(), b.getHeight()));
        if (rot != 0 || sc < 1) {
            android.graphics.Matrix m = new android.graphics.Matrix();
            m.postScale(sc, sc);
            m.postRotate(rot);
            Bitmap r = Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
            if (r != b) b.recycle();
            b = r;
        }
        return b;
    }

    static Uri createIn(Context c, Uri tree, String mime, String name) throws IOException {
        Uri dir = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri u = DocumentsContract.createDocument(c.getContentResolver(), dir, mime, name);
        if (u == null) throw new IOException("無法在資料夾中建立檔案");
        return u;
    }

    static LinearLayout form(Context c) {
        LinearLayout l = U.vbox(c);
        l.setPadding(U.dp(20), U.dp(8), U.dp(20), 0);
        return l;
    }

    static EditText field(Context c, LinearLayout l, String label, String init, int type) {
        l.addView(U.text(c, label, 12, U.SUB));
        EditText e = U.edit(c, "", init);
        if (type != 0) e.setInputType(type);
        l.addView(e);
        return e;
    }

    static float num(EditText e, float def) {
        try { return Float.parseFloat(e.getText().toString().trim()); } catch (Exception x) { return def; }
    }

    static ScrollView scroll(Context c, View v) { ScrollView s = new ScrollView(c); s.addView(v); return s; }

    // ================================================================ 匯出

    static void export(MainActivity a) {
        Doc d = a.doc();
        if (!d.canCopy()) { U.alert(a, "無法匯出", "作者不允許擷取這份文件的內容。"); return; }
        U.choose(a, "匯出 PDF", new String[]{"圖片（PNG）", "圖片（JPG）", "純文字（.txt）", "Word 文件（.docx，文字內容）", "PDF 副本"}, i -> {
            if (i <= 1) {
                String[] dpis = {"72 DPI（螢幕）", "150 DPI（一般）", "300 DPI（印刷）"};
                U.choose(a, "解析度", dpis, k -> U.input(a, "要匯出哪些頁？", "例如 1,3,5-8；留白＝全部", "", spec -> Activities.tree(a, tree -> {
                    float dpi = k == 0 ? 72 : k == 1 ? 150 : 300;
                    int[] pages = spec.trim().isEmpty() ? null : U.pages(spec, d.n);
                    exportImages(a, d, tree, dpi, i == 0, pages);
                })));
            } else if (i == 2) {
                Activities.create(a, U.base(d.name) + ".txt", "text/plain", u -> U.run(a, "擷取文字…", () -> {
                    try (PDDocument pd = d.load(); OutputStream out = a.getContentResolver().openOutputStream(u, "wt");
                         Writer w = new OutputStreamWriter(out, "UTF-8")) {
                        Watermark.fixToUnicode(pd);
                        PDFTextStripper s = new PDFTextStripper();
                        s.setSortByPosition(true);
                        s.writeText(pd, w);
                    }
                    return true;
                }, r -> U.toast(a, "已匯出文字")));
            } else if (i == 3) {
                Activities.create(a, U.base(d.name) + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        u -> U.run(a, "轉換成 Word…", () -> {
                            List<String> pages = new ArrayList<>();
                            try (PDDocument pd = d.load()) {
                                Watermark.fixToUnicode(pd);
                                PDFTextStripper s = new PDFTextStripper();
                                s.setSortByPosition(true);
                                for (int p = 1; p <= pd.getNumberOfPages(); p++) { s.setStartPage(p); s.setEndPage(p); pages.add(s.getText(pd)); }
                            }
                            try (OutputStream out = a.getContentResolver().openOutputStream(u, "wt")) { docx(out, pages); }
                            return true;
                        }, r -> U.toast(a, "已匯出 Word 文件")));
            } else {
                Activities.create(a, U.base(d.name) + "_副本.pdf", "application/pdf", u -> U.run(a, "儲存副本…",
                        () -> { U.copyToUri(a, d.output(), u); return true; }, r -> U.toast(a, "已儲存副本")));
            }
        });
    }

    static void exportImages(MainActivity a, Doc d, Uri tree, float dpi, boolean png, int[] pages) {
        U.run(a, "匯出圖片…", () -> {
            int count = 0;
            try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(d.current(), ParcelFileDescriptor.MODE_READ_ONLY)) {
                PdfRenderer r = new PdfRenderer(pfd);
                int[] ps = pages;
                if (ps == null) { ps = new int[r.getPageCount()]; for (int i = 0; i < ps.length; i++) ps[i] = i; }
                for (int p : ps) {
                    Bitmap b = Doc.renderFile(r, p, dpi, false);
                    String name = U.base(d.name) + String.format(Locale.US, "_第%03d頁", p + 1) + (png ? ".png" : ".jpg");
                    Uri u = createIn(a, tree, png ? "image/png" : "image/jpeg", name);
                    try (OutputStream out = a.getContentResolver().openOutputStream(u)) {
                        b.compress(png ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 92, out);
                    }
                    b.recycle();
                    count++;
                }
                r.close();
            }
            return count;
        }, n -> U.alert(a, "完成", "已匯出 " + n + " 張圖片。"));
    }

    static String xml(String s) {
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (c == '&') b.append("&amp;"); else if (c == '<') b.append("&lt;"); else if (c == '>') b.append("&gt;");
            else if (c < 0x20 && c != '\t') continue; else b.append(c);
        }
        return b.toString();
    }

    /** 最小的 .docx：每段一個段落，每頁之間分頁。 */
    static void docx(OutputStream out, List<String> pages) throws IOException {
        try (ZipOutputStream z = new ZipOutputStream(out)) {
            z.putNextEntry(new ZipEntry("[Content_Types].xml"));
            z.write(("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                    + "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>").getBytes("UTF-8"));
            z.putNextEntry(new ZipEntry("_rels/.rels"));
            z.write(("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>").getBytes("UTF-8"));
            z.putNextEntry(new ZipEntry("word/document.xml"));
            StringBuilder sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>");
            for (int i = 0; i < pages.size(); i++) {
                for (String line : pages.get(i).split("\\r?\\n"))
                    sb.append("<w:p><w:r><w:rPr><w:rFonts w:eastAsia=\"Microsoft JhengHei\"/></w:rPr><w:t xml:space=\"preserve\">").append(xml(line)).append("</w:t></w:r></w:p>");
                if (i < pages.size() - 1) sb.append("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
            }
            sb.append("</w:body></w:document>");
            z.write(sb.toString().getBytes("UTF-8"));
            z.closeEntry();
        }
    }

    // ================================================================ 填寫與簽署

    static File sigDir(Context c) { File f = new File(c.getFilesDir(), "signatures"); f.mkdirs(); return f; }

    static void fillSign(MainActivity a) {
        Doc d = a.doc();
        U.choose(a, "填寫與簽署", new String[]{"填寫表單欄位", "手寫簽名", "使用已存的簽名", "加入文字", "加入今天日期", "打勾 ✓", "打叉 ✗", "畫圓點 ●", "加入姓名縮寫"}, i -> {
            switch (i) {
                case 0: a.view.showFields = true; a.view.invalidate(); Panels.fields(a); break;
                case 1: signPad(a, b -> placeSignature(a, b)); break;
                case 2: savedSignatures(a); break;
                case 3: place(a, "拖曳出文字的位置（或點一下）", 0, 160, false, (p, r) -> Comments.freeText(a, d, p, r)); break;
                case 4: placeText(a, d, Draw.today(), 11); break;
                case 5: placeText(a, d, "✓", 18); break;
                case 6: placeText(a, d, "✗", 18); break;
                case 7: placeText(a, d, "●", 12); break;
                case 8: U.input(a, "姓名縮寫", "例如 K.W.", a.prefs.getString("initials", ""), t -> {
                    a.prefs.edit().putString("initials", t).apply();
                    placeText(a, d, t, 14);
                }); break;
            }
        });
    }

    static void placeText(MainActivity a, Doc d, String text, float size) {
        a.view.toolColor = 0xFF10204A;
        Bitmap probe = Draw.text(text, size, Color.BLACK, 0, false);
        float w = probe.getWidth() / Draw.PX + 4, h = probe.getHeight() / Draw.PX;
        place(a, "點一下要放「" + text + "」的位置", w / h, w, true, (p, r) ->
                a.edit("加入文字", Doc.K_FORM, pd -> Ops.addFreeText(pd, d, p, r, text, size, 0xFF10204A)));
    }

    interface Bmp { void got(Bitmap b); }

    static void signPad(MainActivity a, Bmp cb) {
        LinearLayout l = U.vbox(a);
        l.setPadding(U.dp(12), U.dp(8), U.dp(12), 0);
        SignPad pad = new SignPad(a);
        l.addView(pad, U.lp(U.MATCH, U.dp(220)));
        LinearLayout colors = U.hbox(a);
        for (int c : new int[]{0xFF10204A, 0xFF000000, 0xFF1E63E9, 0xFFC62828}) {
            TextView t = U.text(a, "●", 26, c);
            t.setPadding(U.dp(8), 0, U.dp(8), 0);
            t.setOnClickListener(v -> { pad.color = c; pad.invalidate(); });
            colors.addView(t);
        }
        colors.addView(new View(a), U.lpw(1));
        colors.addView(U.flat(a, "清除", v -> pad.clear()));
        l.addView(colors);
        CheckBox keep = U.check(a, "儲存這個簽名供下次使用", true);
        l.addView(keep);
        U.dlg(a).setTitle("在框內簽名").setView(l).setPositiveButton("使用", (x, w) -> {
            if (pad.isEmpty()) { U.toast(a, "還沒有簽名"); return; }
            Bitmap b = pad.bitmap();
            if (keep.isChecked()) {
                try (FileOutputStream out = new FileOutputStream(new File(sigDir(a), "sig_" + System.currentTimeMillis() + ".png"))) {
                    b.compress(Bitmap.CompressFormat.PNG, 100, out);
                } catch (IOException ignored) {}
            }
            cb.got(b);
        }).setNegativeButton("取消", null).show();
    }

    static void savedSignatures(MainActivity a) {
        File[] fs = sigDir(a).listFiles();
        if (fs == null || fs.length == 0) { U.toast(a, "還沒有儲存的簽名"); signPad(a, b -> placeSignature(a, b)); return; }
        Arrays.sort(fs, (x, y) -> Long.compare(y.lastModified(), x.lastModified()));
        U.Sheet s = new U.Sheet(a, "我的簽名", true, 0.6f);
        for (File f : fs) {
            android.widget.ImageView iv = new android.widget.ImageView(a);
            iv.setImageBitmap(BitmapFactory.decodeFile(f.getAbsolutePath()));
            iv.setBackgroundColor(Color.WHITE);
            iv.setPadding(U.dp(8), U.dp(8), U.dp(8), U.dp(8));
            LinearLayout.LayoutParams lp = U.lp(U.MATCH, U.dp(110));
            lp.setMargins(U.dp(16), U.dp(8), U.dp(16), U.dp(8));
            iv.setOnClickListener(v -> { s.dismiss(); placeSignature(a, BitmapFactory.decodeFile(f.getAbsolutePath())); });
            iv.setOnLongClickListener(v -> { U.confirm(a, "刪除簽名", "刪除這個已儲存的簽名？", "刪除", () -> { f.delete(); s.dismiss(); savedSignatures(a); }); return true; });
            s.body.addView(iv, lp);
        }
        s.body.addView(U.flat(a, "＋ 新增簽名", v -> { s.dismiss(); signPad(a, b -> placeSignature(a, b)); }));
        s.show();
    }

    static void placeSignature(MainActivity a, Bitmap b) {
        Doc d = a.doc();
        float aspect = b.getWidth() / (float) b.getHeight();
        place(a, "拖曳出簽名的位置與大小（或點一下）", aspect, 140, false, (p, r) ->
                a.edit("加入簽名", Doc.K_FORM, pd -> Ops.addStamp(pd, d, p, r, b, "Signature", "簽名")));
    }

    /** 在簽名欄位裡手寫簽名。 */
    public static void signInRect(MainActivity a, int page, RectF r) {
        Doc d = a.doc();
        signPad(a, b -> {
            if (page < 0 || r == null) { placeSignature(a, b); return; }
            RectF rr = fit(new RectF(r), b.getWidth() / (float) b.getHeight());
            a.edit("加入簽名", Doc.K_FORM, pd -> Ops.addStamp(pd, d, page, rr, b, "Signature", "簽名"));
        });
    }

    // ================================================================ 編輯

    static void edit(MainActivity a) {
        Doc d = a.doc();
        U.choose(a, "編輯 PDF", new String[]{"開啟編輯工具列（編輯文字、新增文字…）", "新增文字（寫入頁面）", "新增圖片", "新增連結", "浮水印", "頁首、頁尾與頁碼",
                "裁切頁面", "旋轉、刪除、插入頁面", "頁面標籤", "書籤", "移除浮水印"}, i -> {
            if (i == 0) { a.editMode(); return; }
            switch (i - 1) {
                case 0: place(a, "拖曳出文字區域（或點一下）", 0, 200, false, (p, r) -> addTextDialog(a, d, p, r)); break;
                case 1: pickImage(a, b -> place(a, "拖曳出圖片的位置與大小（或點一下）", b.getWidth() / (float) b.getHeight(), 200, false,
                        (p, r) -> a.edit("新增圖片", Doc.K_EDIT, pd -> Ops.addImage(pd, d, p, r, b, 1)))); break;
                case 2: place(a, "框選要變成連結的區域", 0, 120, false, (p, r) ->
                        U.choose(a, "連結到", new String[]{"網址", "文件中的頁面"}, k -> {
                            if (k == 0) U.input(a, "網址", "https://", "https://", InputType.TYPE_TEXT_VARIATION_URI | InputType.TYPE_CLASS_TEXT,
                                    t -> a.edit("新增連結", Doc.K_EDIT, pd -> Ops.addLink(pd, d, p, r, t, -1)));
                            else U.input(a, "連到第幾頁", "1–" + d.n, "1", InputType.TYPE_CLASS_NUMBER, t -> {
                                try {
                                    int dest = Math.max(0, Math.min(d.n - 1, Integer.parseInt(t.trim()) - 1));
                                    a.edit("新增連結", Doc.K_EDIT, pd -> Ops.addLink(pd, d, p, r, null, dest));
                                } catch (NumberFormatException e) { U.toast(a, "請輸入頁碼"); }
                            });
                        })); break;
                case 3: watermark(a, d); break;
                case 4: headerFooter(a, d); break;
                case 5: crop(a, null); break;
                case 6: Organizer.show(a); break;
                case 7: labels(a); break;
                case 8: Panels.bookmarks(a); break;
                case 9: removeWatermark(a); break;
            }
        });
    }

    static void addTextDialog(MainActivity a, Doc d, int p, RectF r) {
        TextStyle.dialog(a, "新增文字", null, "", TextStyle.load(a, "add"), "新增", (s, st) -> {
            if (s.trim().isEmpty()) return;
            st.save(a, "add");
            a.edit("新增文字", Doc.K_EDIT, pd -> Ops.addText(pd, d, p, r, s, st));
        });
    }

    static void watermark(MainActivity a, Doc d) {
        LinearLayout l = form(a);
        EditText t = field(a, l, "浮水印文字", "機密", 0);
        EditText sz = field(a, l, "字級（pt）", "60", InputType.TYPE_CLASS_NUMBER);
        EditText op = field(a, l, "不透明度（%）", "20", InputType.TYPE_CLASS_NUMBER);
        EditText pg = field(a, l, "頁面（留白＝全部）", "", 0);
        U.dlg(a).setTitle("加入浮水印").setView(scroll(a, l)).setPositiveButton("加入", (x, w) -> {
            int[] pages = pg.getText().toString().trim().isEmpty() ? U.pages("1-" + d.n, d.n) : U.pages(pg.getText().toString(), d.n);
            float size = num(sz, 60), opacity = Math.max(0.05f, Math.min(1, num(op, 20) / 100f));
            String s = t.getText().toString();
            a.edit("加入浮水印", Doc.K_EDIT, pd -> Ops.stampText(pd, d, pages, s, 6, size, 0xFF888888, opacity));
        }).setNegativeButton("取消", null).show();
    }

    static void headerFooter(MainActivity a, Doc d) {
        LinearLayout l = form(a);
        EditText t = field(a, l, "內容（{n}＝頁碼、{N}＝總頁數、{label}＝頁面標籤、{date}＝日期、{file}＝檔名）", "第 {n} 頁，共 {N} 頁", 0);
        String[] pos = {"左上", "中上", "右上", "左下", "中下", "右下"};
        final int[] sel = {4};
        TextView pv = U.flat(a, "位置：" + pos[4], null);
        pv.setOnClickListener(v -> U.choose(a, "位置", pos, k -> { sel[0] = k; pv.setText("位置：" + pos[k]); }));
        l.addView(pv);
        EditText sz = field(a, l, "字級（pt）", "10", InputType.TYPE_CLASS_NUMBER);
        EditText pg = field(a, l, "頁面（留白＝全部）", "", 0);
        U.dlg(a).setTitle("頁首、頁尾與頁碼").setView(scroll(a, l)).setPositiveButton("加入", (x, w) -> {
            int[] pages = pg.getText().toString().trim().isEmpty() ? U.pages("1-" + d.n, d.n) : U.pages(pg.getText().toString(), d.n);
            String s = t.getText().toString();
            float size = num(sz, 10);
            a.edit("加入頁首頁尾", Doc.K_EDIT, pd -> Ops.stampText(pd, d, pages, s, sel[0], size, 0xFF333333, 1f));
        }).setNegativeButton("取消", null).show();
    }

    /** 移除浮水印：標準（Watermark 標記、浮水印註解）、依文字、依圖層。 */
    public static void removeWatermark(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        String b = d.block(Doc.K_EDIT);
        if (b != null) { a.blocked(d, b); return; }
        U.run(a, null, () -> {
            List<String> names = new ArrayList<>();
            try (PDDocument pd = d.load()) {
                com.tom_roush.pdfbox.pdmodel.graphics.optionalcontent.PDOptionalContentProperties ocp = pd.getDocumentCatalog().getOCProperties();
                if (ocp != null) for (com.tom_roush.pdfbox.pdmodel.graphics.optionalcontent.PDOptionalContentGroup g : ocp.getOptionalContentGroups()) names.add(g.getName());
            }
            return names;
        }, layers -> {
            LinearLayout l = form(a);
            CheckBox std = U.check(a, "標準浮水印（Acrobat 或本 App 加入、標記為浮水印的內容與浮水印註解）", true);
            l.addView(std);
            EditText txt = field(a, l, "依文字移除：輸入浮水印上的文字（可留白）", "", 0);
            List<CheckBox> lcs = new ArrayList<>();
            if (!layers.isEmpty()) {
                l.addView(U.text(a, "依圖層移除（連同圖層上的內容）：", 13, U.SUB));
                for (String n : layers) {
                    String low = n.toLowerCase(Locale.ROOT);
                    CheckBox c = U.check(a, n, low.contains("watermark") || n.contains("浮水印"));
                    lcs.add(c);
                    l.addView(c);
                }
            }
            l.addView(U.text(a, "只用在你有權修改的文件上。若浮水印與頁面內容合成在同一張圖片裡（例如掃描檔），無法移除。可以用「復原」還原。", 11.5f, U.SUB));
            U.dlg(a).setTitle("移除浮水印").setView(scroll(a, l)).setPositiveButton("移除", (x, w) -> {
                Watermark.Options o = new Watermark.Options();
                o.standard = std.isChecked();
                o.text = txt.getText().toString().trim();
                for (int i = 0; i < lcs.size(); i++) if (lcs.get(i).isChecked()) o.layers.add(layers.get(i));
                if (!o.standard && o.text.isEmpty() && o.layers.isEmpty()) { U.toast(a, "請至少選一種移除方式"); return; }
                final Watermark.Report[] r = new Watermark.Report[1];
                a.edit("移除浮水印", Doc.K_EDIT, pd -> r[0] = Watermark.remove(pd, o), () -> {
                    if (r[0].blocks + r[0].annots == 0 && o.layers.isEmpty()) {
                        U.alert(a, "找不到浮水印", "沒有找到符合條件的浮水印（可以按復原）。\n\n如果浮水印是文字，試試在「依文字移除」輸入浮水印上的字。");
                    } else U.alert(a, "已移除浮水印", "在 " + r[0].pages + " 頁移除了 " + r[0].blocks + " 段內容"
                            + (r[0].annots > 0 ? "、" + r[0].annots + " 個浮水印註解" : "") + (o.layers.isEmpty() ? "" : "，並移除 " + o.layers.size() + " 個圖層") + "。\n可以按「復原」還原。");
                });
            }).setNegativeButton("取消", null).show();
        });
    }

    public static void crop(MainActivity a, int[] pages) {
        Doc d = a.doc();
        LinearLayout l = form(a);
        l.addView(U.text(a, "從各邊裁掉的寬度（公釐）", 14, U.TEXT));
        EditText top = field(a, l, "上", "10", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        EditText bot = field(a, l, "下", "10", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        EditText left = field(a, l, "左", "10", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        EditText right = field(a, l, "右", "10", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        EditText pg = field(a, l, "頁面（留白＝目前頁面）", pages == null ? "" : U.spec(pages), 0);
        U.dlg(a).setTitle("裁切頁面").setView(scroll(a, l)).setPositiveButton("裁切", (x, w) -> {
            int[] ps = pg.getText().toString().trim().isEmpty() ? new int[]{a.view.page()} : U.pages(pg.getText().toString(), d.n);
            float k = 72 / 25.4f;
            float t = num(top, 0) * k, b = num(bot, 0) * k, le = num(left, 0) * k, r = num(right, 0) * k;
            a.edit("裁切頁面", Doc.K_EDIT, pd -> Ops.crop(pd, d, ps, le, t, r, b));
        }).setNegativeButton("取消", null).show();
    }

    public static void labels(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        LinearLayout l = form(a);
        EditText start = field(a, l, "從第幾頁開始（實際頁碼）", String.valueOf(a.view.page() + 1), InputType.TYPE_CLASS_NUMBER);
        String[] styles = {"1, 2, 3", "i, ii, iii", "I, II, III", "a, b, c", "A, B, C", "無（只有前綴）"};
        String[] codes = {"D", "r", "R", "a", "A", null};
        final int[] sel = {0};
        TextView sv = U.flat(a, "樣式：" + styles[0], null);
        sv.setOnClickListener(v -> U.choose(a, "樣式", styles, k -> { sel[0] = k; sv.setText("樣式：" + styles[k]); }));
        l.addView(sv);
        EditText prefix = field(a, l, "前綴（例如「附錄-」）", "", 0);
        EditText first = field(a, l, "起始數字", "1", InputType.TYPE_CLASS_NUMBER);
        l.addView(U.text(a, "目前：" + (d.hasLabels ? "第 1 頁標為「" + (d.labels != null && d.labels.length > 0 ? d.labels[0] : "") + "」" : "沒有頁面標籤"), 12.5f, U.SUB));
        U.dlg(a).setTitle("頁面標籤").setView(scroll(a, l)).setPositiveButton("套用", (x, w) -> {
            int sp = (int) num(start, 1) - 1;
            if (sp < 0 || sp >= d.n) { U.toast(a, "頁碼超出範圍"); return; }
            String code = codes[sel[0]], pre = prefix.getText().toString();
            int f = (int) num(first, 1);
            a.edit("設定頁面標籤", Doc.K_EDIT, pd -> Ops.setLabel(pd, sp, code, pre, f));
        }).setNeutralButton("全部移除", (x, w) -> a.edit("移除頁面標籤", Doc.K_EDIT, Ops::clearLabels))
                .setNegativeButton("取消", null).show();
    }

    // ================================================================ 建立

    static void create(MainActivity a) {
        U.choose(a, "建立 PDF", new String[]{"從圖片建立", "空白文件", "從文字建立", "用相機掃描"}, i -> {
            switch (i) {
                case 0: Activities.pick(a, new String[]{"image/*"}, true, uris -> U.choose(a, "頁面大小", new String[]{"依圖片大小", "A4（圖片置中）"},
                        k -> imagesToPdf(a, uris, k == 1, false, "圖片轉 PDF.pdf"))); break;
                case 1: {
                    LinearLayout l = form(a);
                    EditText n = field(a, l, "頁數", "1", InputType.TYPE_CLASS_NUMBER);
                    String[] sizes = {"A4 直向", "A4 橫向", "Letter", "A5", "A3"};
                    final int[] s = {0};
                    TextView sv = U.flat(a, "大小：" + sizes[0], null);
                    sv.setOnClickListener(v -> U.choose(a, "大小", sizes, k -> { s[0] = k; sv.setText("大小：" + sizes[k]); }));
                    l.addView(sv);
                    U.dlg(a).setTitle("空白文件").setView(l).setPositiveButton("建立", (x, w) -> {
                        int count = Math.max(1, Math.min(500, (int) num(n, 1)));
                        PDRectangle r = s[0] == 0 ? PDRectangle.A4 : s[0] == 1 ? new PDRectangle(842, 595) : s[0] == 2 ? PDRectangle.LETTER : s[0] == 3 ? PDRectangle.A5 : PDRectangle.A3;
                        U.run(a, "建立中…", () -> {
                            File f = new File(a.getCacheDir(), "blank.pdf");
                            try (PDDocument pd = new PDDocument()) { for (int k = 0; k < count; k++) pd.addPage(new PDPage(r)); pd.save(f); }
                            return f;
                        }, f -> a.openFile(f, "新文件.pdf"));
                    }).setNegativeButton("取消", null).show();
                    break;
                }
                case 2: textToPdf(a); break;
                case 3: scanLoop(a, new ArrayList<>()); break;
            }
        });
    }

    static void imagesToPdf(MainActivity a, List<Uri> uris, boolean a4, boolean enhance, String name) {
        U.run(a, "建立 PDF…", () -> {
            File f = new File(a.getCacheDir(), "images.pdf");
            try (PDDocument pd = new PDDocument()) {
                for (Uri u : uris) {
                    Bitmap b = decode(a, u, 2400);
                    if (enhance) b = enhance(b);
                    PDImageXObject img = b.hasAlpha() ? LosslessFactory.createFromImage(pd, b) : JPEGFactory.createFromImage(pd, b, 0.85f);
                    float iw = b.getWidth() * 72f / 150, ih = b.getHeight() * 72f / 150;
                    PDRectangle size = a4 ? (iw > ih ? new PDRectangle(842, 595) : PDRectangle.A4) : new PDRectangle(iw, ih);
                    PDPage p = new PDPage(size);
                    pd.addPage(p);
                    float s = Math.min(size.getWidth() / iw, size.getHeight() / ih);
                    if (!a4) s = 1;
                    else s *= 0.94f;
                    float w = iw * s, h = ih * s;
                    try (PDPageContentStream cs = new PDPageContentStream(pd, p)) {
                        cs.drawImage(img, (size.getWidth() - w) / 2, (size.getHeight() - h) / 2, w, h);
                    }
                    b.recycle();
                }
                pd.save(f);
            }
            return f;
        }, f -> a.openFile(f, name));
    }

    /** 掃描文件增強：提高對比、變亮。 */
    static Bitmap enhance(Bitmap b) {
        Bitmap o = Bitmap.createBitmap(b.getWidth(), b.getHeight(), Bitmap.Config.ARGB_8888);
        float c = 1.35f, t = -40;
        ColorMatrix cm = new ColorMatrix(new float[]{c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0});
        Paint p = new Paint();
        p.setColorFilter(new ColorMatrixColorFilter(cm));
        new Canvas(o).drawBitmap(b, 0, 0, p);
        b.recycle();
        return o;
    }

    static void textToPdf(MainActivity a) {
        LinearLayout l = form(a);
        EditText title = field(a, l, "標題（可留白）", "", 0);
        EditText body = field(a, l, "內容", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        body.setMinLines(6);
        EditText sz = field(a, l, "字級（pt）", "12", InputType.TYPE_CLASS_NUMBER);
        U.dlg(a).setTitle("從文字建立 PDF").setView(scroll(a, l)).setPositiveButton("建立", (x, w) -> {
            String t = title.getText().toString(), s = body.getText().toString();
            float size = Math.max(6, Math.min(48, num(sz, 12)));
            U.run(a, "建立中…", () -> {
                File f = new File(a.getCacheDir(), "text.pdf");
                // 用系統的 PdfDocument：文字是向量、中文字型自動嵌入、可搜尋
                PdfDocument pd = new PdfDocument();
                int W = 595, H = 842, M = 56;
                TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
                tp.setTextSize(size);
                tp.setColor(Color.BLACK);
                String all = (t.isEmpty() ? "" : t + "\n\n") + s;
                StaticLayout sl = new StaticLayout(all, tp, W - 2 * M, Layout.Alignment.ALIGN_NORMAL, 1.35f, 0, false);
                int line = 0, page = 1;
                while (line < sl.getLineCount()) {
                    PdfDocument.Page p = pd.startPage(new PdfDocument.PageInfo.Builder(W, H, page++).create());
                    Canvas c = p.getCanvas();
                    int top = sl.getLineTop(line), end = line;
                    while (end < sl.getLineCount() && sl.getLineBottom(end) - top <= H - 2 * M) end++;
                    if (end == line) end++;
                    c.save();
                    c.translate(M, M - top);
                    c.clipRect(0, top, W - 2 * M, sl.getLineBottom(end - 1));
                    sl.draw(c);
                    c.restore();
                    pd.finishPage(p);
                    line = end;
                }
                if (sl.getLineCount() == 0) pd.finishPage(pd.startPage(new PdfDocument.PageInfo.Builder(W, H, 1).create()));
                try (FileOutputStream out = new FileOutputStream(f)) { pd.writeTo(out); }
                pd.close();
                return f;
            }, f -> a.openFile(f, (t.isEmpty() ? "文字文件" : U.safeName(t)) + ".pdf"));
        }).setNegativeButton("取消", null).show();
    }

    static void scan(MainActivity a) {
        U.choose(a, "掃描與 OCR", new String[]{"用相機掃描成 PDF", "從相簿圖片建立（文件增強）", "OCR 文字辨識（開發中）"}, i -> {
            if (i == 0) scanLoop(a, new ArrayList<>());
            else if (i == 1) Activities.pick(a, new String[]{"image/*"}, true, uris -> imagesToPdf(a, uris, true, true, "掃描文件.pdf"));
            else U.alert(a, "OCR 文字辨識", "開發中，預計在 v1.2 推出。\n\n辨識需要在手機上執行的文字辨識模型，為了維持「文件不離開裝置」的原則，"
                    + "不會把影像送到雲端。目前可以先用相機掃描成 PDF，並用「無障礙準備」設定標題與語言。");
        });
    }

    static void scanLoop(MainActivity a, List<Uri> shots) {
        File f = new File(FileProv.dir(a), "scan_" + System.currentTimeMillis() + ".jpg");
        Activities.camera(a, f, () -> {
            shots.add(Uri.fromFile(f));
            U.dlg(a).setTitle("已掃描 " + shots.size() + " 頁").setMessage("繼續掃描下一頁，或完成並建立 PDF。")
                    .setPositiveButton("完成", (x, w) -> {
                        List<Uri> list = new ArrayList<>();
                        for (Uri u : shots) list.add(FileProv.uri(new File(u.getPath())));
                        imagesToPdf(a, list, true, true, "掃描文件.pdf");
                    })
                    .setNeutralButton("下一頁", (x, w) -> scanLoop(a, shots))
                    .setNegativeButton("取消", null).show();
        });
    }

    // ================================================================ 合併、分割

    static void combine(MainActivity a) {
        List<Uri> uris = new ArrayList<>();
        List<String> names = new ArrayList<>();
        Doc cur = a.doc();
        Runnable[] show = new Runnable[1];
        show[0] = () -> {
            U.Sheet s = new U.Sheet(a, "合併檔案（" + names.size() + "）", true, 0.75f);
            if (cur != null && !names.contains("［目前文件］" + cur.name)) {
                s.body.addView(U.row(a, "＋ 加入目前文件「" + cur.name + "」", null, null, v -> {
                    uris.add(0, null); names.add(0, "［目前文件］" + cur.name); s.dismiss(); show[0].run();
                }));
            }
            for (int i = 0; i < names.size(); i++) {
                final int k = i;
                LinearLayout r = U.hbox(a);
                r.setPadding(U.dp(16), U.dp(6), U.dp(8), U.dp(6));
                r.addView(U.text(a, (i + 1) + ".  " + names.get(i), 15, U.TEXT), U.lpw(1));
                r.addView(U.icon(a, "▲", "上移", v -> { if (k > 0) { swap(uris, names, k, k - 1); s.dismiss(); show[0].run(); } }));
                r.addView(U.icon(a, "▼", "下移", v -> { if (k < names.size() - 1) { swap(uris, names, k, k + 1); s.dismiss(); show[0].run(); } }));
                r.addView(U.icon(a, "✕", "移除", v -> { uris.remove(k); names.remove(k); s.dismiss(); show[0].run(); }));
                s.body.addView(r);
            }
            s.body.addView(U.flat(a, "＋ 加入檔案…", v -> {
                s.dismiss();
                Activities.pick(a, new String[]{"application/pdf"}, true, us -> { for (Uri u : us) { uris.add(u); names.add(U.nameOf(a, u)); } show[0].run(); });
            }));
            if (names.size() >= 2) {
                TextView go = U.primary(a, "合併 " + names.size() + " 個檔案", v -> { s.dismiss(); doMerge(a, cur, uris, names, new String[names.size()]); });
                LinearLayout.LayoutParams lp = U.lp(U.MATCH, U.WRAP);
                lp.setMargins(U.dp(16), U.dp(12), U.dp(16), U.dp(12));
                s.body.addView(go, lp);
            }
            s.body.addView(Panels.pad(U.text(a, "每個檔案會變成一個書籤，原本的書籤放在它底下；連結、表單、圖層和附件都會保留。", 12.5f, U.SUB)));
            s.show();
        };
        if (cur == null) Activities.pick(a, new String[]{"application/pdf"}, true, us -> { for (Uri u : us) { uris.add(u); names.add(U.nameOf(a, u)); } show[0].run(); });
        else show[0].run();
    }

    static void swap(List<Uri> u, List<String> n, int i, int j) {
        Uri t = u.get(i); u.set(i, u.get(j)); u.set(j, t);
        String s = n.get(i); n.set(i, n.get(j)); n.set(j, s);
    }

    static void doMerge(MainActivity a, Doc cur, List<Uri> uris, List<String> names, String[] pwds) {
        U.run(a, "合併中…", () -> {
            List<File> files = new ArrayList<>();
            List<String> titles = new ArrayList<>();
            for (int i = 0; i < uris.size(); i++) {
                File f = new File(a.getCacheDir(), "merge_" + i + ".pdf");
                if (uris.get(i) == null) U.copyFile(cur.current(), f); else U.copyToFile(a, uris.get(i), f);
                files.add(f);
                titles.add(U.base(names.get(i).replace("［目前文件］", "")));
            }
            File out = new File(a.getCacheDir(), "merged.pdf");
            try { Ops.merge(files, titles, pwds, out); }
            catch (Ops.NeedPwd e) { return e; }
            finally { for (File f : files) f.delete(); }
            return out;
        }, r -> {
            if (r instanceof Ops.NeedPwd) {
                int i = ((Ops.NeedPwd) r).index;
                U.input(a, "「" + names.get(i) + "」需要密碼", "密碼", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, p -> {
                    pwds[i] = p;
                    doMerge(a, cur, uris, names, pwds);
                });
                return;
            }
            a.openFile((File) r, "合併文件.pdf");
        });
    }

    public static void extract(MainActivity a, int[] pages) {
        Doc d = a.doc();
        U.choose(a, "擷取 " + pages.length + " 頁（" + U.spec(pages) + "）", new String[]{"在新分頁開啟", "存成檔案…"}, i -> {
            if (i == 0) U.run(a, "擷取中…", () -> {
                File f = new File(a.getCacheDir(), "extract.pdf");
                Ops.keepPages(d.current(), pages, f);
                return f;
            }, f -> a.openFile(f, U.base(d.name) + "_擷取.pdf"));
            else Activities.create(a, U.base(d.name) + "_擷取.pdf", "application/pdf", u -> U.run(a, "擷取中…", () -> {
                File f = new File(a.getCacheDir(), "extract.pdf");
                Ops.keepPages(d.current(), pages, f);
                U.copyToUri(a, f, u);
                f.delete();
                return true;
            }, r -> U.toast(a, "已擷取")));
        });
    }

    public static void split(MainActivity a) {
        Doc d = a.doc();
        U.choose(a, "分割與擷取", new String[]{"擷取頁面成新檔", "每 N 頁分割", "在指定頁面之前分割", "每頁一個檔案"}, i -> {
            if (i == 0) {
                U.input(a, "擷取哪些頁？", "例如 1,3,5-8", "1-" + d.n, s -> {
                    int[] p = U.pages(s, d.n);
                    if (p.length == 0) U.toast(a, "沒有有效的頁碼"); else extract(a, p);
                });
                return;
            }
            if (i == 3) { splitRanges(a, d, every(d.n, 1)); return; }
            if (i == 1) U.input(a, "每幾頁分割一次", "例如 10", "10", InputType.TYPE_CLASS_NUMBER, s -> {
                try { splitRanges(a, d, every(d.n, Math.max(1, Integer.parseInt(s.trim())))); } catch (NumberFormatException e) { U.toast(a, "請輸入數字"); }
            });
            else U.input(a, "在這些頁之前分割", "例如 5,12", "", s -> {
                int[] cuts = U.pages(s, d.n);
                List<int[]> r = new ArrayList<>();
                int start = 0;
                for (int c : cuts) if (c > start) { r.add(new int[]{start, c - 1}); start = c; }
                r.add(new int[]{start, d.n - 1});
                splitRanges(a, d, r);
            });
        });
    }

    static List<int[]> every(int n, int k) {
        List<int[]> r = new ArrayList<>();
        for (int s = 0; s < n; s += k) r.add(new int[]{s, Math.min(n, s + k) - 1});
        return r;
    }

    static void splitRanges(MainActivity a, Doc d, List<int[]> ranges) {
        U.confirm(a, "分割文件", "會產生 " + ranges.size() + " 個檔案。接下來選擇要存放的資料夾。", "選擇資料夾", () -> Activities.tree(a, tree ->
                U.run(a, "分割中…", () -> {
                    int k = 1;
                    for (int[] r : ranges) {
                        int[] keep = new int[r[1] - r[0] + 1];
                        for (int i = 0; i < keep.length; i++) keep[i] = r[0] + i;
                        File f = new File(a.getCacheDir(), "part.pdf");
                        Ops.keepPages(d.current(), keep, f);
                        String name = U.base(d.name) + String.format(Locale.US, "_%02d（第%d-%d頁）.pdf", k++, r[0] + 1, r[1] + 1);
                        U.copyToUri(a, f, createIn(a, tree, "application/pdf", name));
                        f.delete();
                    }
                    return ranges.size();
                }, n -> U.alert(a, "完成", "已分割成 " + n + " 個檔案。"))));
    }

    // ================================================================ 保護

    static void protect(MainActivity a) {
        Doc d = a.doc();
        U.choose(a, "保護 PDF", new String[]{"設定密碼保護", "移除密碼保護", "移除隱藏資訊", "目前的安全性"}, i -> {
            if (i == 3) { Panels.properties(a); return; }
            if (d.encrypted && !d.owner) { a.blocked(d, "需要擁有者密碼才能變更安全性設定。"); return; }
            if (i == 0) setPassword(a, d);
            else if (i == 1) {
                if (!d.encrypted && d.encOut == null) { U.toast(a, "這份文件沒有加密"); return; }
                U.confirm(a, "移除密碼保護", "儲存後任何人都可以開啟與編輯這份文件。", "移除", () -> {
                    d.encOut = null;
                    d.encrypted = false;
                    a.edit("移除密碼保護", Doc.K_EDIT, pd -> {}, () -> a.save(d, null));
                });
            } else sanitizeDialog(a);
        });
    }

    static void setPassword(MainActivity a, Doc d) {
        LinearLayout l = form(a);
        int pw = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD;
        EditText user = field(a, l, "開啟密碼（開啟文件時需要；可留白）", "", pw);
        EditText owner = field(a, l, "權限密碼（擁有者密碼，用來變更限制）", "", pw);
        l.addView(U.text(a, "允許：", 13, U.SUB));
        String[] names = {"列印", "高品質列印", "修改文件", "複製文字與圖片", "新增 / 修改註解", "填寫表單", "組合文件（插入、刪除、旋轉頁面）", "無障礙擷取"};
        CheckBox[] cbs = new CheckBox[names.length];
        for (int i = 0; i < names.length; i++) { cbs[i] = U.check(a, names[i], true); l.addView(cbs[i]); }
        l.addView(U.text(a, "使用 AES-256 加密。", 12, U.SUB));
        U.dlg(a).setTitle("密碼保護").setView(scroll(a, l)).setPositiveButton("套用", (x, w) -> {
            String u = user.getText().toString(), o = owner.getText().toString();
            if (u.isEmpty() && o.isEmpty()) { U.toast(a, "至少要設定一個密碼"); return; }
            if (o.isEmpty()) o = u;
            AccessPermission ap = new AccessPermission();
            ap.setCanPrint(cbs[0].isChecked()); ap.setCanPrintFaithful(cbs[1].isChecked()); ap.setCanModify(cbs[2].isChecked());
            ap.setCanExtractContent(cbs[3].isChecked()); ap.setCanModifyAnnotations(cbs[4].isChecked()); ap.setCanFillInForm(cbs[5].isChecked());
            ap.setCanAssembleDocument(cbs[6].isChecked()); ap.setCanExtractForAccessibility(cbs[7].isChecked());
            d.encOut = new Doc.Enc(u, o, ap.getPermissionBytes());
            d.encrypted = true;
            d.owner = true;
            d.encDesc = "加密方法：AES-256\n安全處理程序：Standard（V5，R6）";
            a.edit("設定密碼保護", Doc.K_EDIT, pd -> {}, () ->
                    U.dlg(a).setTitle("已設定密碼保護").setMessage("儲存後生效。要現在儲存嗎？")
                            .setPositiveButton("儲存", (y, z) -> a.save(d, null)).setNegativeButton("稍後", null).show());
        }).setNegativeButton("取消", null).show();
    }

    static void sanitizeDialog(MainActivity a) {
        LinearLayout l = form(a);
        CheckBox meta = U.check(a, "文件資訊與中繼資料（作者、建立程式…）", true);
        CheckBox js = U.check(a, "JavaScript 與自動執行的動作", true);
        CheckBox att = U.check(a, "附件", false);
        CheckBox com = U.check(a, "所有註解", false);
        CheckBox frm = U.check(a, "表單平面化", false);
        CheckBox lay = U.check(a, "隱藏圖層的隱藏狀態", false);
        for (CheckBox c : new CheckBox[]{meta, js, att, com, frm, lay}) l.addView(c);
        U.dlg(a).setTitle("移除隱藏資訊").setView(scroll(a, l)).setPositiveButton("移除", (x, w) -> {
            final String[] report = {""};
            a.edit("移除隱藏資訊", Doc.K_EDIT, pd -> report[0] = Ops.sanitize(pd, meta.isChecked(), js.isChecked(), att.isChecked(),
                    com.isChecked(), frm.isChecked(), lay.isChecked()), () -> U.alert(a, "完成", report[0].isEmpty() ? "沒有需要移除的內容。" : report[0]));
        }).setNegativeButton("取消", null).show();
    }

    // ================================================================ 塗銷

    static void redact(MainActivity a) {
        Doc d = a.doc();
        a.setMode(new MainActivity.Mode() {
            @Override public void rect(int page, RectF r) { a.edit("標記塗銷", Doc.K_EDIT, pd -> Ops.addRedact(pd, d, page, r)); }
        }, PdfView.T_RECT, "框選要塗銷的區域（紅框＝標記）", new String[]{"搜尋", "套用"}, new Runnable[]{
                () -> U.input(a, "搜尋並標記塗銷", "要塗銷的文字（逗號分隔多個）", "", q -> searchRedact(a, d, q)),
                () -> applyRedact(a, d)});
    }

    static void searchRedact(MainActivity a, Doc d, String q) {
        List<String> terms = new ArrayList<>();
        for (String t : q.replace('，', ',').split(",")) if (!t.trim().isEmpty()) terms.add(t.trim());
        U.run(a, "搜尋中…", () -> {
            List<Object[]> hits = new ArrayList<>();
            for (int p = 0; p < d.n; p++) {
                TextData.Page tp = d.text(p);
                for (String t : terms) for (int[] m : tp.find(t)) for (RectF r : tp.rects(m[0], m[1] - 1)) hits.add(new Object[]{p, r});
            }
            return hits;
        }, hits -> {
            if (hits.isEmpty()) { U.toast(a, "找不到"); return; }
            U.confirm(a, "標記塗銷", "找到 " + hits.size() + " 處，全部標記為塗銷？", "標記", () ->
                    a.edit("搜尋並標記塗銷", Doc.K_EDIT, pd -> { for (Object[] h : hits) Ops.addRedact(pd, d, (int) h[0], (RectF) h[1]); }));
        });
    }

    static void applyRedact(MainActivity a, Doc d) {
        U.confirm(a, "套用塗銷", "有塗銷標記的頁面會轉成影像並把標記處塗黑，底下的文字與圖片會被永久移除（仍可在儲存前復原）。", "套用", () ->
                U.run(a, "套用塗銷…", () -> {
                    String b = d.block(Doc.K_EDIT);
                    if (b != null) throw new IllegalStateException(b);
                    File f = Ops.applyRedactions(d, 200);
                    d.applyFile("套用塗銷", f);
                    return true;
                }, r -> { a.exitModes(); a.changed(d); U.toast(a, "已套用塗銷"); }));
    }

    // ================================================================ 壓縮

    static void compress(MainActivity a) {
        Doc d = a.doc();
        long before = d.current().length();
        U.choose(a, "壓縮 PDF（目前 " + U.size(before) + "）", new String[]{"高品質（輕度壓縮）", "平衡", "最小檔案", "整份轉成影像（文字將無法選取）"}, i -> {
            if (i == 3) {
                U.run(a, "轉換中…", () -> { File f = Ops.rasterize(d, 110, false); d.applyFile("點陣化壓縮", f); return true; },
                        r -> { a.changed(d); U.alert(a, "完成", U.size(before) + " → " + U.size(d.current().length())); });
                return;
            }
            int max = i == 0 ? 2400 : i == 1 ? 1600 : 1100;
            float q = i == 0 ? 0.85f : i == 1 ? 0.7f : 0.5f;
            final int[] n = {0};
            a.edit("壓縮 PDF", Doc.K_EDIT, pd -> n[0] = Ops.compressImages(pd, max, q), () -> {
                long after = d.current().length();
                U.alert(a, "壓縮完成", "重新壓縮了 " + n[0] + " 張圖片。\n" + U.size(before) + " → " + U.size(after)
                        + (after < before ? "（減少 " + Math.round(100 - after * 100.0 / before) + "%）" : "（沒有變小，可以按復原）"));
            });
        });
    }

    // ================================================================ 表單

    static void prepareForm(MainActivity a, int type) {
        Doc d = a.doc();
        String[] types = {"文字欄位", "多行文字", "核取方塊", "下拉選單", "清單", "簽名欄位"};
        String[] codes = {"text", "multiline", "check", "combo", "list", "sign"};
        if (type < 0) {
            U.choose(a, "要新增哪種欄位？", types, k -> prepareForm(a, k));
            return;
        }
        a.view.showFields = true;
        final int[] count = {1};
        a.setMode(new MainActivity.Mode() {
            void add(int page, RectF r) {
                String def = codes[type] + "_" + System.currentTimeMillis() % 10000;
                if (codes[type].equals("combo") || codes[type].equals("list")) {
                    LinearLayout l = form(a);
                    EditText n = field(a, l, "欄位名稱", def, 0);
                    EditText o = field(a, l, "選項（用逗號分隔）", "選項一,選項二,選項三", 0);
                    U.dlg(a).setTitle(types[type]).setView(l).setPositiveButton("新增", (x, w) -> {
                        List<String> opts = new ArrayList<>();
                        for (String s : o.getText().toString().replace('，', ',').split(",")) if (!s.trim().isEmpty()) opts.add(s.trim());
                        a.edit("新增欄位", Doc.K_EDIT, pd -> Ops.addField(pd, d, page, r, codes[type], n.getText().toString().trim(), opts));
                    }).setNegativeButton("取消", null).show();
                } else U.input(a, types[type] + "名稱", "欄位名稱", def, s ->
                        a.edit("新增欄位", Doc.K_EDIT, pd -> Ops.addField(pd, d, page, r, codes[type], s.trim(), new ArrayList<>())));
            }
            @Override public void rect(int page, RectF r) { add(page, r); }
            @Override public void tap(int page, float x, float y) {
                float w = codes[type].equals("check") ? 14 : codes[type].equals("sign") ? 180 : 160;
                float h = codes[type].equals("check") ? 14 : codes[type].equals("sign") ? 50 : codes[type].equals("multiline") || codes[type].equals("list") ? 60 : 22;
                add(page, new RectF(x, y - h / 2, x + w, y + h / 2));
            }
        }, PdfView.T_RECT, "拖曳出「" + types[type] + "」的位置（可連續新增）", new String[]{"換類型", "欄位清單"},
                new Runnable[]{() -> prepareForm(a, -1), () -> Panels.fields(a)});
    }

    // ================================================================ 印章

    public static void stamp(MainActivity a) {
        if (!need(a)) return;
        Doc d = a.doc();
        String[] names = {"核准", "已審閱", "機密", "草稿", "最終版", "作廢", "急件", "僅供內部使用", "已收到", "自訂文字…", "圖片…"};
        int[] cols = {0xFF2E7D32, 0xFF1E63E9, 0xFFC62828, 0xFF6B7078, 0xFF2E7D32, 0xFFC62828, 0xFFC62828, 0xFF8E24AA, 0xFF1E63E9};
        U.choose(a, "選擇印章", names, i -> {
            if (i == names.length - 1) {
                pickImage(a, b -> place(a, "拖曳出印章的位置（或點一下）", b.getWidth() / (float) b.getHeight(), 120, false,
                        (p, r) -> a.edit("加上印章", Doc.K_ANNOT, pd -> Ops.addStamp(pd, d, p, r, b, "Image", "圖片印章"))));
                return;
            }
            if (i == names.length - 2) {
                U.input(a, "印章文字", "", "", t -> stampWith(a, d, t, 0xFFC62828));
                return;
            }
            stampWith(a, d, names[i], cols[i]);
        });
    }

    static void stampWith(MainActivity a, Doc d, String title, int color) {
        String sub = Ops.author + " · " + Draw.now();
        Bitmap b = Draw.stamp(title, sub, color);
        place(a, "拖曳出印章的位置與大小（或點一下）", b.getWidth() / (float) b.getHeight(), 130, true,
                (p, r) -> a.edit("加上印章", Doc.K_ANNOT, pd -> Ops.addStamp(pd, d, p, r, b, title, title)));
    }

    // ================================================================ 憑證

    static void cert(MainActivity a) {
        U.choose(a, "使用憑證", new String[]{"數位簽署文件", "驗證簽章", "建立自簽憑證", "匯入憑證（.p12 / .pfx）", "管理憑證"}, i -> {
            switch (i) {
                case 0: if (need(a)) certSign(a, -1, null); break;
                case 1: if (need(a)) verify(a); break;
                case 2: createCert(a); break;
                case 3: importCert(a, null); break;
                case 4: manageCerts(a); break;
            }
        });
    }

    static File[] certs(Context c) {
        File[] f = Signer.certDir(c).listFiles();
        return f == null ? new File[0] : f;
    }

    public static void certSign(MainActivity a, int page, RectF rect) {
        Doc d = a.doc();
        String b = d.block(Doc.K_EDIT);
        if (b != null && d.block(Doc.K_FORM) != null) { a.blocked(d, b); return; }
        File[] cs = certs(a);
        if (cs.length == 0) {
            U.dlg(a).setTitle("沒有憑證").setMessage("數位簽署需要一個含私鑰的憑證（.p12 / .pfx）。可以匯入現有的憑證，或建立一個自簽憑證。")
                    .setPositiveButton("建立自簽憑證", (x, w) -> createCert(a))
                    .setNeutralButton("匯入", (x, w) -> importCert(a, () -> certSign(a, page, rect)))
                    .setNegativeButton("取消", null).show();
            return;
        }
        String[] names = new String[cs.length];
        for (int i = 0; i < cs.length; i++) names[i] = cs[i].getName();
        U.choose(a, "選擇憑證", names, k -> U.input(a, "憑證密碼", "", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, pw -> {
            LinearLayout l = form(a);
            EditText reason = field(a, l, "簽署原因", "我同意此文件內容", 0);
            EditText loc = field(a, l, "地點", "台灣", 0);
            CheckBox vis = U.check(a, "在頁面上顯示簽章", true);
            if (page < 0) l.addView(vis);
            U.dlg(a).setTitle("數位簽署").setView(l).setPositiveButton("簽署", (x, w) -> {
                String r = reason.getText().toString(), lo = loc.getText().toString();
                if (page >= 0 && rect != null) doSign(a, d, cs[k], pw, r, lo, page, rect);
                else if (vis.isChecked()) place(a, "拖曳出簽章外觀的位置（或點一下）", 2.6f, 180, false, (p, rr) -> doSign(a, d, cs[k], pw, r, lo, p, rr));
                else doSign(a, d, cs[k], pw, r, lo, 0, null);
            }).setNegativeButton("取消", null).show();
        }));
    }

    static void doSign(MainActivity a, Doc d, File cert, String pw, String reason, String loc, int page, RectF r) {
        U.run(a, "簽署中…", () -> {
            String who = Signer.describe(cert, pw.toCharArray()).split("\n")[0].replace("主體：", "");
            int i = who.indexOf("CN=");
            if (i >= 0) { who = who.substring(i + 3); int j = who.indexOf(','); if (j > 0) who = who.substring(0, j); }
            Bitmap look = null;
            if (r != null) {
                String text = "數位簽署者：" + who + "\n日期：" + Draw.now() + (reason.isEmpty() ? "" : "\n原因：" + reason);
                Bitmap t = Draw.text(text, 8, 0xFF10204A, r.width() - 6, false);
                look = Bitmap.createBitmap(Math.round(r.width() * Draw.PX), Math.round(r.height() * Draw.PX), Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(look);
                c.drawColor(0x10007A55);
                Paint p = new Paint();
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(Draw.PX);
                p.setColor(0xFF00897B);
                c.drawRect(Draw.PX / 2, Draw.PX / 2, look.getWidth() - Draw.PX / 2, look.getHeight() - Draw.PX / 2, p);
                c.drawBitmap(t, 3 * Draw.PX, Math.max(0, (look.getHeight() - t.getHeight()) / 2f), null);
            }
            File out = Signer.sign(d, cert, pw.toCharArray(), reason, loc, page, r, look);
            d.applyFile("數位簽章", out);
            return true;
        }, x -> {
            a.changed(d);
            U.dlg(a).setTitle("已簽署").setMessage("數位簽章已加入（以增量方式寫入，簽署前的內容一個位元組也沒變）。\n\n之後若再編輯，簽章會顯示為「簽署後已修改」。建議現在儲存。")
                    .setPositiveButton("儲存", (y, z) -> a.save(d, null)).setNegativeButton("稍後", null).show();
        });
    }

    static void verify(MainActivity a) {
        Doc d = a.doc();
        U.run(a, "驗證簽章…", () -> Signer.verify(d.current()), list -> {
            U.Sheet s = new U.Sheet(a, "數位簽章（" + list.size() + "）", true, 0.6f);
            if (list.isEmpty()) s.body.addView(Panels.pad(U.text(a, "這份文件沒有數位簽章。", 14, U.SUB)));
            for (Signer.Result r : list) {
                LinearLayout c = U.vbox(a);
                c.setPadding(U.dp(18), U.dp(12), U.dp(18), U.dp(12));
                c.addView(U.bold(a, (r.valid ? "✔ " : "✖ ") + (r.name.isEmpty() ? "簽章" : r.name), 16, r.valid ? 0xFF2E7D32 : U.DANGER));
                c.addView(U.text(a, r.status, 14, U.TEXT));
                if (r.signer != null) c.addView(U.text(a, "憑證：" + r.signer, 12.5f, U.SUB));
                c.addView(U.text(a, "時間：" + r.date + (r.reason.isEmpty() ? "" : "\n原因：" + r.reason) + (r.location.isEmpty() ? "" : "\n地點：" + r.location), 12.5f, U.SUB));
                c.addView(U.text(a, "※ 只驗證文件完整性；自簽憑證的身分無法由第三方確認。", 11.5f, U.SUB));
                s.body.addView(c);
            }
            s.show();
        });
    }

    static void createCert(MainActivity a) {
        LinearLayout l = form(a);
        EditText name = field(a, l, "姓名（會顯示在簽章上）", Ops.author, 0);
        EditText mail = field(a, l, "電子郵件（可留白）", "", InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS | InputType.TYPE_CLASS_TEXT);
        int pw = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD;
        EditText p1 = field(a, l, "憑證密碼", "", pw);
        EditText p2 = field(a, l, "再輸入一次", "", pw);
        U.dlg(a).setTitle("建立自簽憑證").setView(scroll(a, l)).setPositiveButton("建立", (x, w) -> {
            String p = p1.getText().toString();
            if (p.length() < 4) { U.toast(a, "密碼至少 4 個字"); return; }
            if (!p.equals(p2.getText().toString())) { U.toast(a, "兩次密碼不一樣"); return; }
            U.run(a, "產生金鑰…", () -> Signer.createSelfSigned(a, name.getText().toString().trim(), mail.getText().toString().trim(), p.toCharArray()),
                    f -> U.alert(a, "已建立", "憑證「" + f.getName() + "」已存在 App 中（RSA 2048，有效十年）。\n可以在「管理憑證」匯出備份。"));
        }).setNegativeButton("取消", null).show();
    }

    static void importCert(MainActivity a, Runnable after) {
        Activities.pick(a, new String[]{"application/x-pkcs12", "application/octet-stream", "*/*"}, false, uris -> {
            Uri u = uris.get(0);
            String n = U.nameOf(a, u);
            U.run(a, "匯入中…", () -> {
                File f = new File(Signer.certDir(a), U.safeName(n.toLowerCase().endsWith(".p12") || n.toLowerCase().endsWith(".pfx") ? n : n + ".p12"));
                U.copyToFile(a, u, f);
                return f;
            }, f -> { U.toast(a, "已匯入 " + f.getName()); if (after != null) after.run(); });
        });
    }

    static void manageCerts(MainActivity a) {
        File[] cs = certs(a);
        U.Sheet s = new U.Sheet(a, "我的憑證（" + cs.length + "）", true, 0.6f);
        if (cs.length == 0) s.body.addView(Panels.pad(U.text(a, "還沒有憑證。", 14, U.SUB)));
        for (File f : cs) s.body.addView(U.row(a, "🔑 " + f.getName(), U.size(f.length()), null, v ->
                U.choose(a, f.getName(), new String[]{"檢視資訊", "匯出備份", "刪除"}, i -> {
                    if (i == 0) U.input(a, "憑證密碼", "", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                            p -> U.run(a, null, () -> Signer.describe(f, p.toCharArray()), info -> U.alert(a, f.getName(), info)));
                    else if (i == 1) Activities.create(a, f.getName(), "application/x-pkcs12", u -> U.run(a, null, () -> { U.copyToUri(a, f, u); return true; }, r -> U.toast(a, "已匯出")));
                    else U.confirm(a, "刪除憑證", "刪除「" + f.getName() + "」？沒有備份的話無法復原。", "刪除", () -> { f.delete(); s.dismiss(); manageCerts(a); });
                })));
        s.body.addView(U.flat(a, "＋ 建立自簽憑證", v -> { s.dismiss(); createCert(a); }));
        s.body.addView(U.flat(a, "＋ 匯入憑證", v -> { s.dismiss(); importCert(a, null); }));
        s.show();
    }

    // ================================================================ 列印

    static void printTool(MainActivity a) {
        Doc d = a.doc();
        U.choose(a, "印刷製作", new String[]{"列印", "頁面方塊資訊", "轉換為灰階（影像）", "點陣化（轉成影像）"}, i -> {
            if (i == 0) print(a);
            else if (i == 1) boxes(a, d);
            else U.confirm(a, i == 2 ? "轉換為灰階" : "點陣化", "每一頁都會轉成 200 DPI 影像，文字將無法再選取或搜尋（可以復原）。", "轉換", () ->
                    U.run(a, "轉換中…", () -> { File f = Ops.rasterize(d, 200, i == 2); d.applyFile(i == 2 ? "轉換為灰階" : "點陣化", f); return true; },
                            r -> a.changed(d)));
        });
    }

    public static void print(MainActivity a) {
        Doc d = a.doc();
        if (d == null) return;
        if (!d.canPrint()) { U.alert(a, "無法列印", "作者不允許列印這份文件。"); return; }
        PrintManager pm = (PrintManager) a.getSystemService(Context.PRINT_SERVICE);
        final File f = d.current();
        pm.print(d.name, new PrintDocumentAdapter() {
            @Override
            public void onLayout(PrintAttributes o, PrintAttributes n, CancellationSignal c, LayoutResultCallback cb, Bundle extras) {
                if (c.isCanceled()) { cb.onLayoutCancelled(); return; }
                cb.onLayoutFinished(new PrintDocumentInfo.Builder(d.name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(d.n).build(), true);
            }

            @Override
            public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal c, WriteResultCallback cb) {
                try (InputStream in = new FileInputStream(f); OutputStream out = new FileOutputStream(dest.getFileDescriptor())) {
                    U.copy(in, out);
                    cb.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                } catch (Exception e) { cb.onWriteFailed(e.getMessage()); }
            }
        }, null);
    }

    static void boxes(MainActivity a, Doc d) {
        int p = a.view.page();
        U.run(a, null, () -> {
            try (PDDocument pd = d.load()) {
                PDPage pg = pd.getPage(p);
                StringBuilder sb = new StringBuilder();
                String[] n = {"媒體框 MediaBox", "裁切框 CropBox", "出血框 BleedBox", "成品框 TrimBox", "作品框 ArtBox"};
                PDRectangle[] r = {pg.getMediaBox(), pg.getCropBox(), pg.getBleedBox(), pg.getTrimBox(), pg.getArtBox()};
                for (int i = 0; i < n.length; i++) {
                    sb.append(n[i]).append("\n  ").append(String.format(Locale.US, "%.1f × %.1f mm（原點 %.1f, %.1f pt）",
                            r[i].getWidth() * 25.4f / 72, r[i].getHeight() * 25.4f / 72, r[i].getLowerLeftX(), r[i].getLowerLeftY())).append("\n");
                }
                sb.append("旋轉：").append(pg.getRotation()).append("°\n紙張：").append(Panels.paper(pg.getCropBox().getWidth(), pg.getCropBox().getHeight()));
                return sb.toString();
            }
        }, s -> U.alert(a, "第 " + (p + 1) + " 頁的頁面方塊", s));
    }

    // ================================================================ 測量

    static void measure(MainActivity a) {
        Doc d = a.doc();
        measureDistance(a, d);
    }

    static float scale(MainActivity a) { return a.prefs.getFloat("mscale", 1f); }
    static String unit(MainActivity a) { return a.prefs.getString("munit", "mm"); }

    static String fmtLen(MainActivity a, float pt) {
        float mm = pt * 25.4f / 72 * scale(a);
        String u = unit(a);
        float v = u.equals("cm") ? mm / 10 : u.equals("m") ? mm / 1000 : u.equals("in") ? mm / 25.4f : mm;
        return String.format(Locale.US, v < 10 ? "%.2f %s" : "%.1f %s", v, u);
    }

    static String fmtArea(MainActivity a, float wpt, float hpt) {
        float s = scale(a), k = 25.4f / 72 * s;
        float mm2 = wpt * k * hpt * k;
        String u = unit(a);
        float v = u.equals("cm") ? mm2 / 100 : u.equals("m") ? mm2 / 1e6f : u.equals("in") ? mm2 / 645.16f : mm2;
        return String.format(Locale.US, v < 10 ? "%.3f %s²" : "%.1f %s²", v, u);
    }

    static String[] mBtns() { return new String[]{"面積", "比例尺"}; }

    static void measureDistance(MainActivity a, Doc d) {
        a.setMode(new MainActivity.Mode() {
            @Override public void line(int page, float x1, float y1, float x2, float y2) {
                float len = (float) Math.hypot(x2 - x1, y2 - y1);
                if (page < 0) { a.view.measure = "距離 " + fmtLen(a, len); a.view.invalidate(); return; }
                String s = fmtLen(a, len);
                a.view.measure = "距離 " + s;
                U.dlg(a).setTitle("距離：" + s).setMessage("比例尺 1 : " + fmt(scale(a)))
                        .setPositiveButton("加入為註解", (x, w) -> a.edit("加入測量", Doc.K_ANNOT, pd -> Ops.addLine(pd, d, page, x1, y1, x2, y2, false, 0xFFD81B60, 1f, s)))
                        .setNegativeButton("關閉", null).show();
            }
        }, PdfView.T_LINE, "拖曳量測距離（比例 1:" + fmt(scale(a)) + "，單位 " + unit(a) + "）", mBtns(),
                new Runnable[]{() -> measureArea(a, d), () -> setScale(a)});
    }

    static void measureArea(MainActivity a, Doc d) {
        a.setMode(new MainActivity.Mode() {
            @Override public void rect(int page, RectF r) {
                String w = fmtLen(a, r.width()), h = fmtLen(a, r.height()), ar = fmtArea(a, r.width(), r.height());
                String s = w + " × " + h + " ＝ " + ar;
                a.view.measure = s;
                a.view.invalidate();
                U.dlg(a).setTitle("面積").setMessage(s + "\n周長：" + fmtLen(a, 2 * (r.width() + r.height())))
                        .setPositiveButton("加入為註解", (x, y) -> a.edit("加入測量", Doc.K_ANNOT, pd -> Ops.addShape(pd, d, page, r, false, 0xFFD81B60, 1f, s)))
                        .setNegativeButton("關閉", null).show();
            }
        }, PdfView.T_RECT, "拖曳框出要量測面積的範圍", new String[]{"距離", "比例尺"},
                new Runnable[]{() -> measureDistance(a, d), () -> setScale(a)});
    }

    static String fmt(float f) { return f == (int) f ? String.valueOf((int) f) : String.valueOf(f); }

    static void setScale(MainActivity a) {
        LinearLayout l = form(a);
        EditText s = field(a, l, "比例尺 1 : ？（圖面 1 單位＝實際幾單位）", fmt(scale(a)), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        String[] units = {"mm", "cm", "m", "in"};
        final int[] u = {Arrays.asList(units).indexOf(unit(a))};
        TextView uv = U.flat(a, "單位：" + unit(a), null);
        uv.setOnClickListener(v -> U.choose(a, "單位", units, k -> { u[0] = k; uv.setText("單位：" + units[k]); }));
        l.addView(uv);
        U.dlg(a).setTitle("比例尺").setView(l).setPositiveButton("確定", (x, w) -> {
            a.prefs.edit().putFloat("mscale", Math.max(0.0001f, num(s, 1))).putString("munit", units[Math.max(0, u[0])]).apply();
            measure(a);
        }).setNegativeButton("取消", null).show();
    }

    // ================================================================ 比較

    static void compare(MainActivity a) {
        Doc d = a.doc();
        Activities.pick(a, new String[]{"application/pdf"}, false, uris -> compareWith(a, d, uris.get(0), null));
    }

    static void compareWith(MainActivity a, Doc d, Uri u, String pwd) {
        String name = U.nameOf(a, u);
        U.run(a, "比較中…", () -> {
            File f = new File(a.getCacheDir(), "compare.pdf");
            U.copyToFile(a, u, f);
            try { return Compare.run(d.current(), d.name, f, name, pwd); }
            catch (InvalidPasswordException e) { return null; }
            finally { f.delete(); }
        }, r -> {
            if (r == null) {
                U.input(a, "「" + name + "」需要密碼", "密碼", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, p -> compareWith(a, d, u, p));
                return;
            }
            U.Sheet s = new U.Sheet(a, "比較結果", true);
            TextView t = U.text(a, "", 13.5f, U.TEXT);
            t.setText(r.text);
            t.setTextIsSelectable(true);
            t.setPadding(U.dp(16), U.dp(12), U.dp(16), U.dp(24));
            s.body.addView(t);
            s.show();
        });
    }

    // ================================================================ 引導式動作

    static void guided(MainActivity a) {
        Doc d = a.doc();
        String[] acts = {"發佈前清理：移除中繼資料與 JavaScript，再壓縮", "寄送前準備：壓縮後加上密碼", "封存：表單平面化並移除 JavaScript", "審閱彙整：匯出所有註解成文字檔"};
        U.choose(a, "引導式動作", acts, i -> {
            switch (i) {
                case 0:
                    a.edit("移除隱藏資訊", Doc.K_EDIT, pd -> Ops.sanitize(pd, true, true, false, false, false, false),
                            () -> a.edit("壓縮 PDF", Doc.K_EDIT, pd -> Ops.compressImages(pd, 1600, 0.7f),
                                    () -> U.alert(a, "完成", "已完成 2 個步驟：移除隱藏資訊、壓縮。\n每個步驟都可以個別復原。")));
                    break;
                case 1:
                    a.edit("壓縮 PDF", Doc.K_EDIT, pd -> Ops.compressImages(pd, 1600, 0.7f), () -> setPassword(a, d));
                    break;
                case 2:
                    a.edit("封存", Doc.K_EDIT, pd -> {
                        if (Ops.acro(pd, false) != null) Ops.flatten(pd);
                        Ops.sanitize(pd, false, true, false, false, false, false);
                    }, () -> U.alert(a, "完成", "表單已平面化、JavaScript 已移除。"));
                    break;
                case 3:
                    Activities.create(a, U.base(d.name) + "_註解.txt", "text/plain", u -> U.run(a, "彙整中…", () -> {
                        StringBuilder sb = new StringBuilder("「" + d.name + "」的註解\n\n");
                        try (PDDocument pd = d.load()) {
                            for (Ops.Cm c : Ops.comments(pd, d)) {
                                sb.append("第 ").append(c.page + 1).append(" 頁 · ").append(Panels.sub(c.sub)).append(" · ").append(c.author).append(" · ").append(c.date).append("\n");
                                if (c.text != null) sb.append("  「").append(c.text).append("」\n");
                                if (!c.contents.isEmpty()) sb.append("  ").append(c.contents).append("\n");
                                for (Ops.Cm r : c.replies) sb.append("    ↳ ").append(r.author).append("：").append(r.contents).append("\n");
                                sb.append("\n");
                            }
                        }
                        try (OutputStream out = a.getContentResolver().openOutputStream(u, "wt")) { out.write(sb.toString().getBytes("UTF-8")); }
                        return true;
                    }, r -> U.toast(a, "已匯出註解")));
                    break;
            }
        });
    }

    // ================================================================ 無障礙

    static void access(MainActivity a) {
        Doc d = a.doc();
        U.run(a, "檢查中…", () -> {
            List<String[]> r = new ArrayList<>();
            try (PDDocument pd = d.load()) {
                PDDocumentCatalog cat = pd.getDocumentCatalog();
                String title = pd.getDocumentInformation().getTitle();
                r.add(new String[]{title != null && !title.isEmpty() ? "✔" : "✖", "文件標題", title == null || title.isEmpty() ? "未設定" : title});
                String lang = cat.getLanguage();
                r.add(new String[]{lang != null && !lang.isEmpty() ? "✔" : "✖", "文件語言", lang == null ? "未設定" : lang});
                PDViewerPreferences vp = cat.getViewerPreferences();
                boolean show = vp != null && vp.displayDocTitle();
                r.add(new String[]{show ? "✔" : "✖", "視窗顯示文件標題", show ? "是" : "否"});
                boolean tagged = cat.getMarkInfo() != null && cat.getMarkInfo().isMarked();
                r.add(new String[]{tagged ? "✔" : "!", "標記（Tagged PDF）", tagged ? "是" : "否（需要專業工具加上結構標記）"});
                int textPages = 0, check = Math.min(d.n, 5);
                for (int i = 0; i < check; i++) if (d.text(i).text.trim().length() > 10) textPages++;
                r.add(new String[]{textPages > 0 ? "✔" : "✖", "可擷取文字", textPages + "/" + check + " 頁有文字" + (textPages == 0 ? "（可能是掃描影像，需要 OCR）" : "")});
                boolean bm = !Ops.outline(pd).isEmpty();
                r.add(new String[]{bm || d.n <= 20 ? "✔" : "!", "書籤（長文件導覽）", bm ? "有" : (d.n <= 20 ? "文件不長，可不需要" : "建議加入")});
                java.util.Map<String, String> fonts = new java.util.LinkedHashMap<>();
                java.util.Set<Object> seen = new java.util.HashSet<>();
                for (PDPage p : pd.getPages()) Panels.collectFonts(p.getResources(), fonts, seen, 0);
                int notEmb = 0;
                for (String v : fonts.values()) if (v.contains("未嵌入")) notEmb++;
                r.add(new String[]{notEmb == 0 ? "✔" : "!", "字型已嵌入", notEmb == 0 ? "全部" : notEmb + " 個字型未嵌入"});
                boolean enc = d.encrypted && d.perm != null && !d.owner && !d.perm.canExtractForAccessibility();
                r.add(new String[]{enc ? "✖" : "✔", "輔助工具可讀取", enc ? "權限禁止" : "允許"});
            }
            return r;
        }, r -> {
            U.Sheet s = new U.Sheet(a, "無障礙檢查", true, 0.7f);
            for (String[] x : r) s.body.addView(U.row(a, x[0] + "  " + x[1], x[2], null, null));
            TextView fix = U.primary(a, "自動修正標題、語言與顯示設定", v -> {
                s.dismiss();
                U.input(a, "文件標題", "", U.base(d.name), t -> a.edit("無障礙修正", Doc.K_EDIT, pd -> {
                    PDDocumentCatalog cat = pd.getDocumentCatalog();
                    if (!t.trim().isEmpty()) pd.getDocumentInformation().setTitle(t.trim());
                    if (cat.getLanguage() == null || cat.getLanguage().isEmpty()) cat.setLanguage("zh-TW");
                    PDViewerPreferences vp = cat.getViewerPreferences();
                    if (vp == null) vp = new PDViewerPreferences(new COSDictionary());
                    vp.setDisplayDocTitle(true);
                    cat.setViewerPreferences(vp);
                }, () -> access(a)));
            });
            LinearLayout.LayoutParams lp = U.lp(U.MATCH, U.WRAP);
            lp.setMargins(U.dp(16), U.dp(14), U.dp(16), U.dp(16));
            s.body.addView(fix, lp);
            s.show();
        });
    }

    // ================================================================ 設定

    public static void settings(MainActivity a) {
        String[] items = {"署名（註解作者）：" + Ops.author, "主題：跟隨系統", "主題：淺色", "主題：深色", "測量比例尺",
                "檢查更新（目前 v" + Updater.version(a) + "）", "關於小柯文件PDF助手"};
        U.choose(a, "設定", items, i -> {
            switch (i) {
                case 0: U.input(a, "署名", "註解和印章上顯示的名字", Ops.author, s -> { Ops.author = s.trim().isEmpty() ? "小柯" : s.trim(); a.prefs.edit().putString("author", Ops.author).apply(); }); break;
                case 1: a.setTheme("system"); break;
                case 2: a.setTheme("light"); break;
                case 3: a.setTheme("dark"); break;
                case 4: setScale(a); break;
                case 5: Updater.check(a); break;
                case 6: U.alert(a, "小柯文件PDF助手 " + Updater.version(a), "手機版 PDF 閱讀與編輯工具，參考 PdfCraft 的功能設計。\n\n"
                        + "・PDF 引擎：PDFBox-Android（Apache 2.0）\n・數位簽章：Bouncy Castle（MIT）\n・頁面繪製：Android PdfRenderer\n"
                        + "・中文字型：jf open 粉圓 2.1（justfont，SIL Open Font License 1.1；漢字部分源自 Kosugi Maru，Apache-2.0）\n\n"
                        + "隱私至上：文件絕對不會離開你的裝置，不需要帳號、不收集使用資料、沒有雲端處理。"
                        + "只有按「檢查更新」時會連到 GitHub 查詢新版。"); break;
            }
        });
    }
}
