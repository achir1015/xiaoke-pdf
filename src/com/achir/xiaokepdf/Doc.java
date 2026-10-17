package com.achir.xiaokepdf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import com.tom_roush.pdfbox.cos.COSBase;
import com.tom_roush.pdfbox.cos.COSDictionary;
import com.tom_roush.pdfbox.cos.COSName;
import com.tom_roush.pdfbox.io.MemoryUsageSetting;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.common.PDPageLabels;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission;
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException;
import com.tom_roush.pdfbox.pdmodel.encryption.PDCryptFilterDictionary;
import com.tom_roush.pdfbox.pdmodel.encryption.PDEncryption;
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import com.tom_roush.pdfbox.pdmodel.graphics.optionalcontent.PDOptionalContentProperties;
import com.tom_roush.pdfbox.pdmodel.interactive.action.PDAction;
import com.tom_roush.pdfbox.pdmodel.interactive.action.PDActionGoTo;
import com.tom_roush.pdfbox.pdmodel.interactive.action.PDActionURI;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationLink;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationWidget;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.destination.PDDestination;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.destination.PDNamedDestination;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageDestination;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一份開啟中的文件（一個分頁）。
 * 每次編輯都存成一個快照檔，撤銷 / 重做就是在快照之間移動，儲存後仍然可以撤銷。
 * 快照一律是未加密的 PDF（放在 App 私有目錄），儲存時才依設定重新加密。
 */
public class Doc {
    public static class NeedPassword extends Exception {
        public final boolean wrong;
        NeedPassword(boolean wrong) { super(wrong ? "密碼不正確" : "需要密碼"); this.wrong = wrong; }
    }

    public static class Step {
        public final String label; public final File file;
        Step(String l, File f) { label = l; file = f; }
    }

    /** 儲存時要套用的加密設定。 */
    public static class Enc {
        public String user, owner; public int perms;
        public Enc(String u, String o, int p) { user = u; owner = o; perms = p; }
    }

    /** 頁面上的註解 / 欄位 / 連結（顯示座標），供點擊判斷。 */
    public static class Annot {
        public int index; public String sub; public RectF r; public String field; public String uri; public int dest = -1;
        public boolean hidden;
    }

    public interface Op { void run(PDDocument d) throws Exception; }
    /** 編輯時打開的其他文件，要等存檔完才能關。 */
    public final List<java.io.Closeable> later = new ArrayList<>();
    public static final int K_EDIT = 0, K_ANNOT = 1, K_FORM = 2;

    public final String id;
    public final File dir;
    public Uri uri;
    public String name;
    public boolean writable;
    public long origSize;

    public boolean encrypted, owner = true, repaired, broken;
    public String openPwd = "";
    public AccessPermission perm;
    public String encDesc = "";
    public Enc encOut;

    public final List<Step> steps = new ArrayList<>();
    public int pos, savedPos;
    private int snapNo;

    // 頁面幾何（PDF 使用者座標的裁切框與 /Rotate）
    public int n;
    public float[] llx, lly, cw, ch;
    public int[] rot;
    public String[] labels;
    public boolean hasLabels;
    public List<List<Annot>> annots = new ArrayList<>();

    // 繪製
    final Object rlock = new Object();
    private PdfRenderer renderer;
    private ParcelFileDescriptor pfd;
    public volatile int gen;
    public final Map<String, Boolean> layers = new LinkedHashMap<>();

    // 文字
    private final Map<Integer, TextData.Page> text = new HashMap<>();
    private final Map<Integer, Ops.Rules> rules = new HashMap<>();
    private PDDocument reader;
    private int readerGen = -1;

    // 檢視狀態
    public int page;
    /** 分頁順序（復原時用）。 */
    public int order = 999;
    public float zoom = 1f;
    public int layout, vrot;

    private Doc(Context c, String id) {
        this.id = id;
        dir = new File(new File(c.getFilesDir(), "sessions"), id);
        dir.mkdirs();
    }

    public static MemoryUsageSetting mem() { return MemoryUsageSetting.setupMixed(96L << 20); }

    // ---------------------------------------------------------------- 開啟

    public static Doc open(Context c, Uri u, String pwd) throws Exception {
        Doc d = new Doc(c, Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1296), 36));
        try {
            d.uri = u;
            d.name = U.nameOf(c, u);
            File orig = new File(d.dir, "orig.pdf");
            U.copyToFile(c, u, orig);
            d.origSize = orig.length();
            d.init(orig, pwd);
            d.writable = canWrite(c, u);
            d.writeMeta();
            return d;
        } catch (Exception e) {
            d.discard();
            throw e;
        }
    }

    /** 從檔案（例如合併、建立的結果）開一個新分頁，沒有原始位置。 */
    public static Doc openFile(Context c, File f, String name) throws Exception {
        Doc d = new Doc(c, Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1296), 36));
        try {
            d.name = name;
            File orig = new File(d.dir, "orig.pdf");
            U.copyFile(f, orig);
            d.origSize = orig.length();
            d.init(orig, null);
            d.savedPos = -1;   // 還沒存過
            d.writeMeta();
            return d;
        } catch (Exception e) {
            d.discard();
            throw e;
        }
    }

    static boolean canWrite(Context c, Uri u) {
        if (u == null || !"content".equals(u.getScheme())) return false;
        for (android.content.UriPermission p : c.getContentResolver().getPersistedUriPermissions())
            if (p.getUri().equals(u) && p.isWritePermission()) return true;
        return false;
    }

    private void init(File orig, String pwd) throws Exception {
        PDDocument pd;
        try {
            pd = PDDocument.load(orig, pwd == null ? "" : pwd, mem());
        } catch (InvalidPasswordException e) {
            throw new NeedPassword(pwd != null);
        } catch (IOException e) {
            // PDFBox 讀不了，但也許系統的繪製引擎可以 → 唯讀
            if (!rendererOk(orig)) throw new IOException("無法開啟：檔案損壞或不是 PDF（" + e.getMessage() + "）");
            broken = true;
            steps.add(new Step("開啟", orig));
            openRenderer();
            metaFromRenderer();
            return;
        }
        File s0;
        try {
            if (pd.isEncrypted()) {
                encrypted = true;
                openPwd = pwd == null ? "" : pwd;
                perm = pd.getCurrentAccessPermission();
                owner = perm.isOwnerPermission();
                encDesc = describe(pd.getEncryption());
                encOut = owner ? new Enc(null, openPwd, perm.getPermissionBytes())
                        : new Enc(openPwd, null, perm.getPermissionBytes());
                pd.setAllSecurityToBeRemoved(true);
                s0 = snap();
                pd.save(s0);
            } else if (rendererOk(orig)) {
                s0 = orig;            // 原始位元組原封不動
            } else {
                repaired = true;       // 用 PDFBox 的容錯解析重新寫一份
                s0 = snap();
                pd.save(s0);
            }
            readMeta(pd);
        } finally { pd.close(); }
        steps.add(new Step("開啟", s0));
        pos = 0; savedPos = 0;
        openRenderer();
    }

    static boolean rendererOk(File f) {
        try (ParcelFileDescriptor p = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)) {
            PdfRenderer r = new PdfRenderer(p);
            boolean ok = r.getPageCount() > 0;
            if (ok) r.openPage(0).close();
            r.close();
            return ok;
        } catch (Throwable e) { return false; }
    }

    static String describe(PDEncryption e) {
        StringBuilder sb = new StringBuilder();
        String method;
        int v = e.getVersion(), r = e.getRevision();
        PDCryptFilterDictionary cf = e.getStdCryptFilterDictionary();
        String cfm = cf != null && cf.getCryptFilterMethod() != null ? cf.getCryptFilterMethod().getName() : "";
        if (r >= 5 || "AESV3".equals(cfm)) method = "AES-256";
        else if ("AESV2".equals(cfm)) method = "AES-128";
        else method = "RC4 " + (e.getLength() > 0 ? e.getLength() : 40) + " 位元";
        sb.append("加密方法：").append(method).append("\n");
        sb.append("安全處理程序：").append(e.getFilter()).append("（V").append(v).append("，R").append(r).append("）\n");
        sb.append("中繼資料加密：").append(e.isEncryptMetaData() ? "是" : "否");
        return sb.toString();
    }

    public void unlockOwner(String pwd) throws Exception {
        File orig = new File(dir, "orig.pdf");
        try (PDDocument pd = PDDocument.load(orig, pwd, mem())) {
            AccessPermission ap = pd.getCurrentAccessPermission();
            if (!ap.isOwnerPermission()) throw new IOException("這不是擁有者密碼");
            owner = true; perm = ap;
            if (encOut == null) encOut = new Enc(null, pwd, ap.getPermissionBytes());
            else encOut.owner = pwd;
        } catch (InvalidPasswordException e) { throw new IOException("密碼不正確"); }
    }

    /** 回傳 null 表示可以做這類編輯，否則是不行的原因。 */
    public String block(int kind) {
        if (broken) return "這份文件的結構損壞，只能閱讀，無法編輯。";
        if (encrypted && !owner && perm != null) {
            boolean ok = kind == K_ANNOT ? perm.canModifyAnnotations() || perm.canModify()
                    : kind == K_FORM ? perm.canFillInForm() || perm.canModify() : perm.canModify();
            if (!ok) return "作者限制了這份文件的修改權限。輸入擁有者密碼即可解除限制（文件屬性 → 安全性）。";
        }
        return null;
    }

    public boolean canCopy() { return !encrypted || owner || perm == null || perm.canExtractContent(); }
    public boolean canPrint() { return !encrypted || owner || perm == null || perm.canPrint(); }

    // ---------------------------------------------------------------- 快照與歷程

    public File current() { return steps.get(pos).file; }
    public boolean dirty() { return pos != savedPos; }
    public String undoLabel() { return pos > 0 ? steps.get(pos).label : null; }
    public String redoLabel() { return pos + 1 < steps.size() ? steps.get(pos + 1).label : null; }

    private File snap() { return new File(dir, "s" + (++snapNo) + "_" + System.nanoTime() % 100000 + ".pdf"); }
    public File temp(String name) { return new File(dir, name); }

    public PDDocument load() throws IOException { return PDDocument.load(current(), mem()); }

    /** 在背景執行緒呼叫：套用一個編輯並成為新的歷程步驟。 */
    public synchronized void apply(String label, int kind, Op op) throws Exception {
        String b = block(kind);
        if (b != null) throw new IllegalStateException(b);
        PDDocument d = load();
        File f = snap();
        try {
            op.run(d);
            d.save(f);
            readMeta(d);
        } catch (Exception e) {
            f.delete();
            throw e;
        } finally {
            d.close();
            for (java.io.Closeable c : later) try { c.close(); } catch (Exception ignored) {}
            later.clear();
        }
        push(label, f);
    }

    /** 已經產生好的檔案直接成為新步驟（例如數位簽章、塗銷）。 */
    public synchronized void applyFile(String label, File produced) throws Exception {
        File f = snap();
        if (!produced.renameTo(f)) { U.copyFile(produced, f); produced.delete(); }
        try (PDDocument d = PDDocument.load(f, mem())) { readMeta(d); }
        push(label, f);
    }

    private void push(String label, File f) throws IOException {
        while (steps.size() > pos + 1) {
            Step s = steps.remove(steps.size() - 1);
            if (!s.file.getName().equals("orig.pdf")) s.file.delete();
        }
        if (savedPos > pos) savedPos = -1;
        steps.add(new Step(label, f));
        pos = steps.size() - 1;
        changed();
        writeMeta();
    }

    public synchronized boolean undo() throws IOException { if (pos == 0) return false; pos--; reload(); return true; }
    public synchronized boolean redo() throws IOException { if (pos + 1 >= steps.size()) return false; pos++; reload(); return true; }

    private void reload() throws IOException {
        try (PDDocument d = load()) { readMeta(d); }
        changed();
        writeMeta();
    }

    private void changed() throws IOException {
        synchronized (text) { text.clear(); rules.clear(); closeReader(); }
        openRenderer();
    }

    // ---------------------------------------------------------------- 頁面資訊

    void readMeta(PDDocument d) {
        n = d.getNumberOfPages();
        llx = new float[n]; lly = new float[n]; cw = new float[n]; ch = new float[n]; rot = new int[n];
        List<List<Annot>> an = new ArrayList<>();
        int i = 0;
        for (PDPage p : d.getPages()) {
            PDRectangle c = p.getCropBox();
            llx[i] = c.getLowerLeftX(); lly[i] = c.getLowerLeftY();
            cw[i] = Math.max(1, c.getWidth()); ch[i] = Math.max(1, c.getHeight());
            rot[i] = ((p.getRotation() % 360) + 360) % 360;
            List<Annot> list = new ArrayList<>();
            try {
                List<PDAnnotation> al = p.getAnnotations();
                for (int k = 0; k < al.size(); k++) {
                    PDAnnotation a = al.get(k);
                    Annot x = new Annot();
                    x.index = k;
                    x.sub = a.getSubtype();
                    PDRectangle r = a.getRectangle();
                    if (r == null) continue;
                    x.r = toDisplayRect(i, r.getLowerLeftX(), r.getLowerLeftY(), r.getUpperRightX(), r.getUpperRightY());
                    x.hidden = a.isHidden() || a.isNoView() || "Popup".equals(x.sub);
                    if (a instanceof PDAnnotationWidget) x.field = fieldName(a.getCOSObject());
                    if (a instanceof PDAnnotationLink) linkTarget(d, (PDAnnotationLink) a, x);
                    list.add(x);
                }
            } catch (Exception ignored) {}
            an.add(list);
            i++;
        }
        n = i;
        annots = an;
        labels = null; hasLabels = false;
        try {
            PDPageLabels pl = d.getDocumentCatalog().getPageLabels();
            if (pl != null) { labels = pl.getLabelsByPageIndices(); hasLabels = true; }
        } catch (Exception ignored) {}
    }

    private void metaFromRenderer() {
        synchronized (rlock) {
            n = renderer.getPageCount();
            llx = new float[n]; lly = new float[n]; cw = new float[n]; ch = new float[n]; rot = new int[n];
            for (int i = 0; i < n; i++) {
                PdfRenderer.Page p = renderer.openPage(i);
                cw[i] = p.getWidth(); ch[i] = p.getHeight();
                p.close();
                annots.add(new ArrayList<>());
            }
        }
    }

    static String fieldName(COSDictionary w) {
        StringBuilder sb = new StringBuilder();
        COSDictionary c = w;
        int guard = 0;
        while (c != null && guard++ < 20) {
            String t = c.getString(COSName.T);
            if (t != null) sb.insert(0, sb.length() > 0 ? t + "." : t);
            COSBase p = c.getDictionaryObject(COSName.PARENT);
            c = p instanceof COSDictionary ? (COSDictionary) p : null;
        }
        return sb.toString();
    }

    private static void linkTarget(PDDocument d, PDAnnotationLink l, Annot x) {
        try {
            PDAction act = l.getAction();
            PDDestination dest = null;
            if (act instanceof PDActionURI) { x.uri = ((PDActionURI) act).getURI(); return; }
            if (act instanceof PDActionGoTo) dest = ((PDActionGoTo) act).getDestination();
            if (dest == null) dest = l.getDestination();
            if (dest instanceof PDNamedDestination)
                dest = d.getDocumentCatalog().findNamedDestinationPage((PDNamedDestination) dest);
            if (dest instanceof PDPageDestination) {
                PDPageDestination pd = (PDPageDestination) dest;
                int idx = pd.retrievePageNumber();
                if (idx < 0 && pd.getPage() != null) idx = d.getPages().indexOf(pd.getPage());
                x.dest = idx;
            }
        } catch (Exception ignored) {}
    }

    public String label(int i) {
        if (labels != null && i < labels.length && labels[i] != null && !labels[i].equals(String.valueOf(i + 1)))
            return labels[i];
        return null;
    }

    /** 顯示用尺寸（已套用 /Rotate，單位 pt）。 */
    public float dw(int i) { return rot[i] % 180 == 0 ? cw[i] : ch[i]; }
    public float dh(int i) { return rot[i] % 180 == 0 ? ch[i] : cw[i]; }

    /** 顯示座標（左上原點、已旋轉）→ PDF 使用者座標。 */
    public float[] toUser(int i, float dx, float dy) {
        float x0 = llx[i], y0 = lly[i], w = cw[i], h = ch[i];
        switch (rot[i]) {
            case 90: return new float[]{x0 + dy, y0 + dx};
            case 180: return new float[]{x0 + w - dx, y0 + dy};
            case 270: return new float[]{x0 + w - dy, y0 + h - dx};
            default: return new float[]{x0 + dx, y0 + h - dy};
        }
    }

    public float[] toDisplay(int i, float ux, float uy) {
        float x0 = llx[i], y0 = lly[i], w = cw[i], h = ch[i];
        switch (rot[i]) {
            case 90: return new float[]{uy - y0, ux - x0};
            case 180: return new float[]{x0 + w - ux, uy - y0};
            case 270: return new float[]{y0 + h - uy, x0 + w - ux};
            default: return new float[]{ux - x0, y0 + h - uy};
        }
    }

    public RectF toDisplayRect(int i, float ax, float ay, float bx, float by) {
        float[] p = toDisplay(i, ax, ay), q = toDisplay(i, bx, by);
        RectF r = new RectF(Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1]));
        return r;
    }

    public PDRectangle toUserRect(int i, RectF d) {
        float[] p = toUser(i, d.left, d.top), q = toUser(i, d.right, d.bottom);
        float x = Math.min(p[0], q[0]), y = Math.min(p[1], q[1]);
        return new PDRectangle(x, y, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
    }

    // ---------------------------------------------------------------- 繪製

    private void openRenderer() throws IOException {
        File src = current();
        if (!layers.isEmpty() && !broken) src = layerCopy();
        synchronized (rlock) {
            closeRenderer();
            pfd = ParcelFileDescriptor.open(src, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(pfd);
            gen++;
        }
    }

    private File layerCopy() throws IOException {
        File f = new File(dir, "render_" + System.nanoTime() % 100000 + ".pdf");
        try (PDDocument d = load()) {
            PDOptionalContentProperties ocp = d.getDocumentCatalog().getOCProperties();
            if (ocp != null) for (Map.Entry<String, Boolean> e : layers.entrySet()) ocp.setGroupEnabled(e.getKey(), e.getValue());
            d.save(f);
        }
        File[] old = dir.listFiles();
        if (old != null) for (File o : old) if (o.getName().startsWith("render_") && !o.equals(f)) o.delete();
        return f;
    }

    public void refreshLayers() throws IOException { openRenderer(); }

    private void closeRenderer() {
        try { if (renderer != null) renderer.close(); } catch (Exception ignored) {}
        try { if (pfd != null) pfd.close(); } catch (Exception ignored) {}
        renderer = null; pfd = null;
    }

    /** m：顯示座標（pt）→ 點陣圖像素。 */
    public Bitmap render(int page, int w, int h, Matrix m) {
        if (w <= 0 || h <= 0) return null;
        synchronized (rlock) {
            if (renderer == null || page < 0 || page >= renderer.getPageCount()) return null;
            Bitmap b;
            try { b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); }
            catch (OutOfMemoryError e) { return null; }
            b.eraseColor(Color.WHITE);
            PdfRenderer.Page p = renderer.openPage(page);
            try { p.render(b, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); }
            catch (Exception e) { e.printStackTrace(); }
            finally { p.close(); }
            return b;
        }
    }

    /** 給縮圖、匯出用：整頁縮放到寬 w。 */
    public Bitmap renderWidth(int page, int w) {
        float s = w / dw(page);
        int h = Math.max(1, Math.round(dh(page) * s));
        Matrix m = new Matrix();
        m.setScale(s, s);
        return render(page, w, h, m);
    }

    /** 給列印 / 匯出用：用指定 DPI 繪製另一個檔案（不經過快取）。 */
    public static Bitmap renderFile(PdfRenderer r, int page, float dpi, boolean print) {
        PdfRenderer.Page p = r.openPage(page);
        try {
            float s = dpi / 72f;
            int w = Math.max(1, Math.round(p.getWidth() * s)), h = Math.max(1, Math.round(p.getHeight() * s));
            while ((long) w * h > 40_000_000L) { s *= 0.8f; w = Math.round(p.getWidth() * s); h = Math.round(p.getHeight() * s); }
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            b.eraseColor(Color.WHITE);
            Matrix m = new Matrix();
            m.setScale(s, s);
            p.render(b, null, m, print ? PdfRenderer.Page.RENDER_MODE_FOR_PRINT : PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            return b;
        } finally { p.close(); }
    }

    // ---------------------------------------------------------------- 文字

    public TextData.Page text(int i) {
        synchronized (text) {
            TextData.Page p = text.get(i);
            if (p != null) return p;
            if (broken) { p = new TextData.Page(); text.put(i, p); return p; }
            try {
                if (reader == null || readerGen != gen) { closeReader(); reader = load(); Watermark.fixToUnicode(reader); readerGen = gen; }
                p = TextData.extract(reader, i);
            } catch (Throwable e) {
                p = new TextData.Page();
            }
            text.put(i, p);
            return p;
        }
    }

    /** 頁面上的表格框線（顯示座標），就地編輯時用來限制在同一個儲存格。 */
    public Ops.Rules rules(int i) {
        synchronized (text) {
            Ops.Rules r = rules.get(i);
            if (r != null) return r;
            if (broken) { r = new Ops.Rules(); rules.put(i, r); return r; }
            try {
                if (reader == null || readerGen != gen) { closeReader(); reader = load(); Watermark.fixToUnicode(reader); readerGen = gen; }
                r = Ops.rules(reader, this, i);
            } catch (Throwable e) {
                r = new Ops.Rules();
            }
            rules.put(i, r);
            return r;
        }
    }

    public boolean hasText(int i) { synchronized (text) { return text.containsKey(i); } }

    private void closeReader() {
        try { if (reader != null) reader.close(); } catch (Exception ignored) {}
        reader = null;
    }

    // ---------------------------------------------------------------- 儲存

    /** 產生要寫出的檔案（必要時加密），並驗證可以重新開啟。 */
    public File output() throws Exception {
        File out;
        String pw = "";
        if (encOut == null || broken) {
            out = current();
        } else {
            out = new File(dir, "out.pdf");
            try (PDDocument d = load()) {
                AccessPermission ap = new AccessPermission(encOut.perms);
                String o = encOut.owner == null ? "" : encOut.owner, u = encOut.user == null ? "" : encOut.user;
                StandardProtectionPolicy sp = new StandardProtectionPolicy(o, u, ap);
                sp.setEncryptionKeyLength(256);
                d.protect(sp);
                d.save(out);
            }
            pw = encOut.owner != null && !encOut.owner.isEmpty() ? encOut.owner : (encOut.user == null ? "" : encOut.user);
        }
        if (!broken) try (PDDocument v = PDDocument.load(out, pw, mem())) {
            if (v.getNumberOfPages() != n) throw new IOException("驗證失敗：頁數不符");
        }
        return out;
    }

    public void saveTo(Context c, Uri target) throws Exception {
        File f = output();
        U.copyToUri(c, f, target);
        savedPos = pos;
        writeMeta();
    }

    public void saveToFile(File target) throws Exception {
        File f = output();
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        U.copyFile(f, tmp);
        if (!tmp.renameTo(target)) { U.copyFile(tmp, target); tmp.delete(); }
    }

    // ---------------------------------------------------------------- 自動保存 / 復原

    public synchronized void writeMeta() {
        try {
            JSONObject o = new JSONObject();
            o.put("uri", uri == null ? "" : uri.toString());
            o.put("name", name);
            o.put("pos", pos);
            o.put("savedPos", savedPos);
            o.put("encrypted", encrypted);
            o.put("broken", broken);
            o.put("page", page);
            int ord = App.docs.indexOf(this);
            o.put("order", ord < 0 ? order : ord);
            o.put("time", System.currentTimeMillis());
            JSONArray a = new JSONArray();
            for (Step s : steps) a.put(new JSONObject().put("label", s.label).put("file", s.file.getName()));
            o.put("steps", a);
            File tmp = new File(dir, "meta.tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(o.toString().getBytes("UTF-8")); }
            tmp.renameTo(new File(dir, "meta.json"));
        } catch (Exception ignored) {}
    }

    public static List<Doc> recover(Context c) {
        List<Doc> list = new ArrayList<>();
        File root = new File(c.getFilesDir(), "sessions");
        File[] ds = root.listFiles();
        if (ds == null) return list;
        for (File dir : ds) {
            boolean open = false;
            for (Doc d : App.docs) if (d.dir.equals(dir)) open = true;
            if (open) continue;
            try {
                File mf = new File(dir, "meta.json");
                byte[] b = new byte[(int) mf.length()];
                try (FileInputStream in = new FileInputStream(mf)) { int r = 0; while (r < b.length) r += in.read(b, r, b.length - r); }
                JSONObject o = new JSONObject(new String(b, "UTF-8"));
                Doc d = new Doc(c, dir.getName());
                String u = o.optString("uri");
                d.uri = u.isEmpty() ? null : Uri.parse(u);
                d.name = o.getString("name");
                d.encrypted = o.optBoolean("encrypted");
                d.broken = o.optBoolean("broken");
                d.page = o.optInt("page");
                d.order = o.optInt("order", 999);
                JSONArray a = o.getJSONArray("steps");
                for (int i = 0; i < a.length(); i++) {
                    JSONObject s = a.getJSONObject(i);
                    File f = new File(dir, s.getString("file"));
                    if (!f.exists()) break;
                    d.steps.add(new Step(s.getString("label"), f));
                    d.snapNo = Math.max(d.snapNo, i + 1);
                }
                if (d.steps.isEmpty()) throw new IOException();
                d.pos = Math.min(o.getInt("pos"), d.steps.size() - 1);
                d.savedPos = o.getInt("savedPos");
                if (d.encrypted) d.encOut = null;   // 密碼不寫入磁碟，儲存時再詢問
                d.writable = canWrite(c, d.uri);
                d.origSize = new File(dir, "orig.pdf").length();
                if (d.broken) { d.openRenderer(); d.metaFromRenderer(); }
                else { try (PDDocument pd = d.load()) { d.readMeta(pd); } d.openRenderer(); }
                list.add(d);
            } catch (Exception e) {
                U.deleteTree(dir);
            }
        }
        return list;
    }

    public void discard() {
        synchronized (rlock) { closeRenderer(); }
        synchronized (text) { closeReader(); }
        U.deleteTree(dir);
    }
}
