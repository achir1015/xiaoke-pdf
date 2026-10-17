package com.achir.xiaokepdf;

import android.graphics.RectF;

import com.tom_roush.pdfbox.contentstream.operator.Operator;
import com.tom_roush.pdfbox.cos.COSArray;
import com.tom_roush.pdfbox.cos.COSFloat;
import com.tom_roush.pdfbox.cos.COSName;
import com.tom_roush.pdfbox.cos.COSNumber;
import com.tom_roush.pdfbox.pdfparser.PDFStreamParser;
import com.tom_roush.pdfbox.pdfwriter.ContentStreamWriter;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.common.PDStream;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 表格編輯：撐高列、插入列／欄、合併儲存格、插入表格。
 * PDF 裡沒有「表格」，只有框線和擺在固定位置的字，所以：
 *   插入一列＝把那條線以下的東西全部往下搬（跨過邊界的直線被拉長），再補一條橫線；
 *   合併儲存格＝把合併範圍內部的框線剪掉。
 * 所有座標參數都是顯示座標（左上原點、y 往下）。演算法與網頁版的 rowgrow.js 相同。
 */
public final class TableOps {
    private TableOps() {}

    /** 顯示座標的區域判斷。 */
    public interface Area { boolean in(float x, float y); }

    private static final float[] I = {1, 0, 0, 1, 0, 0};
    private static final Set<String> PAINT = new HashSet<>(Arrays.asList("S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"));

    private static float[] mul(float[] a, float[] b) {
        return new float[]{
                a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
                a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
                a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]};
    }

    private static float[] inv(float[] m) {
        float d = m[0] * m[3] - m[1] * m[2];
        if (d == 0) d = 1e-9f;
        return new float[]{m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d};
    }

    private static float[] apply(float[] m, float x, float y) { return new float[]{m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]}; }

    /** 使用者空間的位移 → m 座標系裡的位移 */
    private static float[] vecIn(float[] m, float ux, float uy) { float[] k = inv(m); return new float[]{k[0] * ux + k[2] * uy, k[1] * ux + k[3] * uy}; }

    private static float num(List<Object> ops, int k) { return k >= 0 && k < ops.size() && ops.get(k) instanceof COSNumber ? ((COSNumber) ops.get(k)).floatValue() : 0; }

    private static COSFloat n(float v) { return new COSFloat(Math.round(v * 1000) / 1000f); }

    private static Operator op(String s) { return Operator.getOperator(s); }

    private static List<Object> tokens(PDPage p) throws IOException {
        PDFStreamParser parser = new PDFStreamParser(p);
        parser.parse();
        return parser.getTokens();
    }

    private static void write(PDDocument d, PDPage p, List<Object> out) throws IOException {
        PDStream ns = new PDStream(d);
        try (OutputStream os = ns.createOutputStream(COSName.FLATE_DECODE)) { new ContentStreamWriter(os).writeTokens(out); }
        p.setContents(ns);
    }

    private static class Seg {
        List<Object> ops; Operator op; float[][] pts; String kind;
        Seg(List<Object> ops, Operator op, float[][] pts, String kind) { this.ops = ops; this.op = op; this.pts = pts; this.kind = kind; }
    }

    private static void addPts(List<Object> out, float[]... pts) { for (float[] p : pts) { out.add(n(p[0])); out.add(n(p[1])); } }

    // ================================================================ 搬移

    /** 把 area 裡的內容（框線、文字、圖片、註解）移動 (dx, dy)。回傳有沒有東西被移動。 */
    public static boolean move(PDDocument d, Doc doc, int page, Area area, float dx, float dy) throws IOException {
        PDPage p = d.getPage(page);
        float[] a0 = doc.toUser(page, 0, 0), b0 = doc.toUser(page, dx, dy);
        final float ux = b0[0] - a0[0], uy = b0[1] - a0[1];
        List<Object> toks;
        try { toks = tokens(p); } catch (Exception e) { return false; }

        List<Object> out = new ArrayList<>(), ops = new ArrayList<>();
        List<Seg> path = new ArrayList<>();
        ArrayDeque<float[]> stack = new ArrayDeque<>();
        float[] ctm = I.clone(), tm = I.clone(), tlm = I.clone();
        float tl = 0, fs = 10;
        boolean applied = false, changed = false;

        for (Object t : toks) {
            if (!(t instanceof Operator)) { ops.add(t); continue; }
            Operator o = (Operator) t;
            String name = o.getName();
            int k = ops.size();
            switch (name) {
                case "m": case "l": path.add(new Seg(ops, o, new float[][]{{num(ops, k - 2), num(ops, k - 1)}}, name)); ops = new ArrayList<>(); continue;
                case "c": path.add(new Seg(ops, o, new float[][]{{num(ops, 0), num(ops, 1)}, {num(ops, 2), num(ops, 3)}, {num(ops, 4), num(ops, 5)}}, name)); ops = new ArrayList<>(); continue;
                case "v": case "y": path.add(new Seg(ops, o, new float[][]{{num(ops, 0), num(ops, 1)}, {num(ops, 2), num(ops, 3)}}, name)); ops = new ArrayList<>(); continue;
                case "re": {
                    float x = num(ops, 0), y = num(ops, 1), w = num(ops, 2), h = num(ops, 3);
                    path.add(new Seg(ops, o, new float[][]{{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}}, "re"));
                    ops = new ArrayList<>();
                    continue;
                }
                case "h": case "W": case "W*": path.add(new Seg(ops, o, new float[0][], name)); ops = new ArrayList<>(); continue;
            }
            if (PAINT.contains(name) || !path.isEmpty()) {
                // 路徑：在搬移區的點跟著移，跨過邊界的線被拉長
                float[] d2 = vecIn(ctm, ux, uy);
                for (Seg s : path) {
                    boolean[] fl = new boolean[s.pts.length];
                    boolean any = false;
                    for (int j = 0; j < s.pts.length; j++) { float[] q = apply(ctm, s.pts[j][0], s.pts[j][1]); float[] dd = doc.toDisplay(page, q[0], q[1]); fl[j] = area.in(dd[0], dd[1]); any |= fl[j]; }
                    if (!any) { out.addAll(s.ops); out.add(s.op); continue; }
                    changed = true;
                    float[][] pts = new float[s.pts.length][];
                    for (int j = 0; j < pts.length; j++) pts[j] = fl[j] ? new float[]{s.pts[j][0] + d2[0], s.pts[j][1] + d2[1]} : s.pts[j];
                    if (s.kind.equals("re")) {
                        addPts(out, pts[0]); out.add(op("m"));
                        addPts(out, pts[1]); out.add(op("l"));
                        addPts(out, pts[2]); out.add(op("l"));
                        addPts(out, pts[3]); out.add(op("l"));
                        out.add(op("h"));
                    } else { addPts(out, pts); out.add(s.op); }
                }
                path.clear();
                if (PAINT.contains(name)) { out.addAll(ops); out.add(o); ops = new ArrayList<>(); continue; }
            }
            switch (name) {
                case "q": stack.push(ctm.clone()); break;
                case "Q": if (!stack.isEmpty()) ctm = stack.pop(); break;
                case "cm": if (k >= 6) ctm = mul(new float[]{num(ops, k - 6), num(ops, k - 5), num(ops, k - 4), num(ops, k - 3), num(ops, k - 2), num(ops, k - 1)}, ctm); break;
                case "BT": tm = I.clone(); tlm = I.clone(); applied = false; break;
                case "Tf": if (k >= 2) { float f = Math.abs(num(ops, k - 1)); if (f > 0) fs = f; } break;
                case "TL": tl = num(ops, k - 1); break;
                case "Td": tlm = mul(new float[]{1, 0, 0, 1, num(ops, k - 2), num(ops, k - 1)}, tlm); tm = tlm.clone(); break;
                case "TD": tl = -num(ops, k - 1); tlm = mul(new float[]{1, 0, 0, 1, num(ops, k - 2), num(ops, k - 1)}, tlm); tm = tlm.clone(); break;
                case "Tm": if (k >= 6) { tlm = new float[]{num(ops, k - 6), num(ops, k - 5), num(ops, k - 4), num(ops, k - 3), num(ops, k - 2), num(ops, k - 1)}; tm = tlm.clone(); } applied = false; break;
                case "T*": tlm = mul(new float[]{1, 0, 0, 1, 0, -tl}, tlm); tm = tlm.clone(); break;
                case "Tj": case "TJ": case "'": case "\"": {
                    List<Object> pre = new ArrayList<>();
                    List<Object> show = ops;
                    Operator showOp = o;
                    if (name.equals("'") || name.equals("\"")) {
                        // 先換行再寫字：拆成 (Tw Tc) T* + Tj，才能在中間插入新的文字矩陣
                        if (name.equals("\"") && k >= 3) { pre.add(ops.get(0)); pre.add(op("Tw")); pre.add(ops.get(1)); pre.add(op("Tc")); }
                        pre.add(op("T*"));
                        tlm = mul(new float[]{1, 0, 0, 1, 0, -tl}, tlm); tm = tlm.clone();
                        show = new ArrayList<>();
                        if (k >= 1) show.add(ops.get(k - 1));
                        showOp = op("Tj");
                    }
                    float[] q = apply(mul(tm, ctm), 0, fs * 0.3f);
                    float[] dd = doc.toDisplay(page, q[0], q[1]);
                    boolean need = area.in(dd[0], dd[1]);
                    out.addAll(pre);
                    if (need != applied) {
                        float[] lin = vecIn(ctm, ux, uy);
                        float[] m = need ? new float[]{tm[0], tm[1], tm[2], tm[3], tm[4] + lin[0], tm[5] + lin[1]} : tm;
                        for (float v : m) out.add(n(v));
                        out.add(op("Tm"));
                        applied = need;
                        changed = true;
                    }
                    out.addAll(show);
                    out.add(showOp);
                    ops = new ArrayList<>();
                    continue;
                }
                case "Do": case "sh": case "BI": {
                    // 圖片、表單物件、漸層、內嵌圖片：整個在搬移區裡就跟著移
                    boolean all = true;
                    for (float[] c : new float[][]{{0, 0}, {1, 0}, {1, 1}, {0, 1}}) {
                        float[] u = apply(ctm, c[0], c[1]);
                        float[] dd = doc.toDisplay(page, u[0], u[1]);
                        if (!area.in(dd[0], dd[1])) { all = false; break; }
                    }
                    if (all) {
                        float[] M = mul(mul(ctm, new float[]{1, 0, 0, 1, ux, uy}), inv(ctm));
                        out.add(op("q"));
                        for (float v : M) out.add(n(v));
                        out.add(op("cm"));
                        out.addAll(ops); out.add(o);
                        out.add(op("Q"));
                        changed = true;
                        ops = new ArrayList<>();
                        continue;
                    }
                    break;
                }
            }
            out.addAll(ops);
            out.add(o);
            ops = new ArrayList<>();
        }
        for (Seg s : path) { out.addAll(s.ops); out.add(s.op); }
        out.addAll(ops);
        if (changed) write(d, p, out);

        // 註解（連結、表單欄位）也一起移
        boolean moved = changed;
        try {
            for (PDAnnotation an : p.getAnnotations()) {
                PDRectangle r = an.getRectangle();
                if (r == null) continue;
                float[] p1 = doc.toDisplay(page, r.getLowerLeftX(), r.getLowerLeftY()), p2 = doc.toDisplay(page, r.getUpperRightX(), r.getUpperRightY());
                if (!area.in(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])) || !area.in(Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1]))) continue;
                an.setRectangle(new PDRectangle(r.getLowerLeftX() + ux, r.getLowerLeftY() + uy, r.getWidth(), r.getHeight()));
                moved = true;
            }
        } catch (Exception ignored) {}
        return moved;
    }

    // ================================================================ 合併儲存格（剪掉內部框線）

    /** 剪掉穿過 box（顯示座標，已往內縮）內部的框線。回傳有沒有剪到。 */
    public static boolean cut(PDDocument d, Doc doc, int page, RectF box) throws IOException {
        PDPage p = d.getPage(page);
        List<Object> toks;
        try { toks = tokens(p); } catch (Exception e) { return false; }
        List<Object> out = new ArrayList<>(), ops = new ArrayList<>();
        List<Seg> path = new ArrayList<>();
        ArrayDeque<float[]> stack = new ArrayDeque<>();
        final float[][] ctmH = {I.clone()};
        boolean changed = false;

        for (Object t : toks) {
            if (!(t instanceof Operator)) { ops.add(t); continue; }
            Operator o = (Operator) t;
            String name = o.getName();
            int k = ops.size();
            switch (name) {
                case "m": case "l": path.add(new Seg(ops, o, new float[][]{{num(ops, k - 2), num(ops, k - 1)}}, name)); ops = new ArrayList<>(); continue;
                case "c": path.add(new Seg(ops, o, new float[][]{{num(ops, 4), num(ops, 5)}}, name)); ops = new ArrayList<>(); continue;
                case "v": case "y": path.add(new Seg(ops, o, new float[][]{{num(ops, 2), num(ops, 3)}}, name)); ops = new ArrayList<>(); continue;
                case "re": {
                    float x = num(ops, 0), y = num(ops, 1), w = num(ops, 2), h = num(ops, 3);
                    path.add(new Seg(ops, o, new float[][]{{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}}, "re"));
                    ops = new ArrayList<>();
                    continue;
                }
                case "h": case "W": case "W*": path.add(new Seg(ops, o, new float[0][], name)); ops = new ArrayList<>(); continue;
            }
            if (PAINT.contains(name)) {
                boolean clip = name.equals("n");
                for (Seg s : path) if (s.kind.startsWith("W")) clip = true;
                List<Object> segOut = new ArrayList<>();
                boolean cutHere = !clip && cutPath(path, segOut, doc, page, ctmH[0], box, name);
                if (cutHere) changed = true;
                if (clip) for (Seg s : path) { out.addAll(s.ops); out.add(s.op); }
                else out.addAll(segOut);
                path.clear();
                out.addAll(ops);
                if (!(cutHere && segOut.isEmpty())) out.add(o);   // 整個路徑都被剪掉時，繪製指令也拿掉
                ops = new ArrayList<>();
                continue;
            }
            if (!path.isEmpty()) { for (Seg s : path) { out.addAll(s.ops); out.add(s.op); } path.clear(); }
            if (name.equals("q")) stack.push(ctmH[0].clone());
            else if (name.equals("Q")) { if (!stack.isEmpty()) ctmH[0] = stack.pop(); }
            else if (name.equals("cm") && k >= 6) ctmH[0] = mul(new float[]{num(ops, k - 6), num(ops, k - 5), num(ops, k - 4), num(ops, k - 3), num(ops, k - 2), num(ops, k - 1)}, ctmH[0]);
            out.addAll(ops);
            out.add(o);
            ops = new ArrayList<>();
        }
        for (Seg s : path) { out.addAll(s.ops); out.add(s.op); }
        out.addAll(ops);
        if (changed) write(d, p, out);
        return changed;
    }

    private static float[] disp(Doc doc, int page, float[] ctm, float[] pt) { float[] u = apply(ctm, pt[0], pt[1]); return doc.toDisplay(page, u[0], u[1]); }

    private static float[] lerp(float[] a, float[] b, float t) { return new float[]{a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t}; }

    /** 線段 a→b 被 box 內部蓋住的參數範圍；只處理水平、垂直線 */
    private static float[] cutRange(Doc doc, int page, float[] ctm, RectF box, float[] a, float[] b) {
        float[] A = disp(doc, page, ctm, a), B = disp(doc, page, ctm, b);
        boolean vert = Math.abs(A[0] - B[0]) < 0.8f, hori = Math.abs(A[1] - B[1]) < 0.8f;
        if (!vert && !hori) return null;
        float fixed, va, vb, lo, hi;
        if (vert) { fixed = (A[0] + B[0]) / 2; if (fixed <= box.left || fixed >= box.right) return null; va = A[1]; vb = B[1]; lo = box.top; hi = box.bottom; }
        else { fixed = (A[1] + B[1]) / 2; if (fixed <= box.top || fixed >= box.bottom) return null; va = A[0]; vb = B[0]; lo = box.left; hi = box.right; }
        if (Math.abs(vb - va) < 1e-6) return null;
        float t1 = (lo - va) / (vb - va), t2 = (hi - va) / (vb - va);
        if (t1 > t2) { float x = t1; t1 = t2; t2 = x; }
        t1 = Math.max(0, t1); t2 = Math.min(1, t2);
        return t2 - t1 > 1e-4 ? new float[]{t1, t2} : null;
    }

    /** 剪掉中間後的線段（筆尖已在 a）；沒剪到回傳 false */
    private static boolean cutLine(List<Object> out, Doc doc, int page, float[] ctm, RectF box, float[] a, float[] b) {
        float[] r = cutRange(doc, page, ctm, box, a, b);
        if (r == null) return false;
        if (r[0] > 1e-4) { addPts(out, lerp(a, b, r[0])); out.add(op("l")); }
        if (r[1] < 1 - 1e-4) { addPts(out, lerp(a, b, r[1])); out.add(op("m")); addPts(out, b); out.add(op("l")); }
        else { addPts(out, b); out.add(op("m")); }
        return true;
    }

    private static boolean cutPath(List<Seg> path, List<Object> out, Doc doc, int page, float[] ctm, RectF box, String paint) {
        boolean stroke = paint.startsWith("S") || paint.startsWith("s") || paint.startsWith("B") || paint.startsWith("b");
        boolean changed = false;
        float[] cur = null, start = null;
        for (Seg s : path) {
            switch (s.kind) {
                case "m": cur = start = s.pts[0]; out.addAll(s.ops); out.add(s.op); continue;
                case "l": case "h": {
                    float[] b = s.kind.equals("h") ? start : s.pts[0];
                    if (cur != null && b != null && cutLine(out, doc, page, ctm, box, cur, b)) changed = true;
                    else { out.addAll(s.ops); out.add(s.op); }
                    cur = b;
                    continue;
                }
                case "re": {
                    float[] p0 = s.pts[0], p1 = s.pts[1], p2 = s.pts[2], p3 = s.pts[3];
                    float[] d0 = disp(doc, page, ctm, p0), d2 = disp(doc, page, ctm, p2);
                    float w = Math.abs(d2[0] - d0[0]), h = Math.abs(d2[1] - d0[1]);
                    cur = start = p0;
                    if (Math.min(w, h) < 3) {
                        // 細長矩形＝一條框線：沿著長邊剪成兩段
                        float[][] lg = w >= h ? new float[][]{lerp(p0, p3, 0.5f), lerp(p1, p2, 0.5f)} : new float[][]{lerp(p0, p1, 0.5f), lerp(p3, p2, 0.5f)};
                        float[] r = cutRange(doc, page, ctm, box, lg[0], lg[1]);
                        if (r != null) {
                            changed = true;
                            float[] half = w >= h ? new float[]{(p3[0] - p0[0]) / 2, (p3[1] - p0[1]) / 2} : new float[]{(p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2};
                            if (r[0] > 1e-4) piece(out, lg, half, 0, r[0]);
                            if (r[1] < 1 - 1e-4) piece(out, lg, half, r[1], 1);
                            continue;
                        }
                    } else if (stroke) {
                        float[][][] edges = {{p0, p1}, {p1, p2}, {p2, p3}, {p3, p0}};
                        boolean hit = false;
                        for (float[][] e : edges) if (cutRange(doc, page, ctm, box, e[0], e[1]) != null) { hit = true; break; }
                        if (hit) {
                            changed = true;
                            addPts(out, p0); out.add(op("m"));
                            for (float[][] e : edges) if (!cutLine(out, doc, page, ctm, box, e[0], e[1])) { addPts(out, e[1]); out.add(op("l")); }
                            continue;
                        }
                    }
                    out.addAll(s.ops); out.add(s.op);
                    continue;
                }
                default:
                    out.addAll(s.ops); out.add(s.op);
                    if (s.pts.length > 0) cur = s.pts[s.pts.length - 1];
            }
        }
        return changed;
    }

    private static void piece(List<Object> out, float[][] lg, float[] half, float t1, float t2) {
        float[] a = lerp(lg[0], lg[1], t1), b = lerp(lg[0], lg[1], t2);
        addPts(out, new float[]{a[0] - half[0], a[1] - half[1]}); out.add(op("m"));
        addPts(out, new float[]{b[0] - half[0], b[1] - half[1]}); out.add(op("l"));
        addPts(out, new float[]{b[0] + half[0], b[1] + half[1]}); out.add(op("l"));
        addPts(out, new float[]{a[0] + half[0], a[1] + half[1]}); out.add(op("l"));
        out.add(op("h"));
    }

    // ================================================================ 動作

    /** 畫一條線（顯示座標）。 */
    static void line(PDDocument d, Doc doc, int page, float x1, float y1, float x2, float y2) throws IOException {
        float[] a = doc.toUser(page, x1, y1), b = doc.toUser(page, x2, y2);
        try (PDPageContentStream cs = new PDPageContentStream(d, d.getPage(page), PDPageContentStream.AppendMode.APPEND, true, true)) {
            cs.setStrokingColor(Ops.color(0xFF000000));
            cs.setLineWidth(0.75f);
            cs.moveTo(a[0], a[1]);
            cs.lineTo(b[0], b[1]);
            cs.stroke();
        }
    }

    /** 表格的資訊：儲存格、原本最後一行字的下緣、分隔線以下內容的最低點、頁高。 */
    public static class Fit { public RectF cell; public float lastBottom, below, pageH; }

    /**
     * 表格儲存格裡的文字變長：先把那一列撐高（下面的內容往下移），放不下才縮小字級。
     * 回傳要用的樣式（可能縮小了字級）。
     */
    public static TextStyle fit(PDDocument d, Doc doc, int page, String text, TextStyle st, float baseline, float wrapW, Fit info) throws IOException {
        if (info == null || info.cell == null || text.trim().isEmpty()) return st;
        PDFont f = st.pdfFont(d, text);
        if (f == null) return st;
        RectF c = info.cell;
        float pad = Math.max(1, c.bottom - info.lastBottom);
        float lh = st.lineHeight > 0 ? st.lineHeight : st.size * 1.25f;
        int lines = Ops.wrap(f, text, st.size, Math.max(wrapW + 1, st.size * 2)).size();
        float need = baseline + (lines - 1) * lh + st.size * 0.25f + pad - c.bottom;
        if (need <= 0.5f) return st;
        if (need <= info.pageH - 18 - Math.max(info.below, c.bottom)) {
            final float split = c.bottom - 1.5f;
            move(d, doc, page, (x, y) -> y > split, 0, need);
            return st;
        }
        TextStyle s = st.copy();
        for (float size = st.size - 0.5f; size >= 5; size -= 0.5f) {
            s = st.copy();
            s.size = size;
            s.lineHeight = lh * size / st.size;
            int n2 = Ops.wrap(f, text, size, Math.max(wrapW + 1, size * 2)).size();
            if (baseline + (n2 - 1) * s.lineHeight + size * 0.25f + pad <= c.bottom + 0.5f) return s;
        }
        return s;
    }

    /** 在儲存格下方插入一列（高 h），table 為表格範圍 */
    public static void insertRow(PDDocument d, Doc doc, int page, RectF cell, RectF table, float h) throws IOException {
        final float split = cell.bottom - 1.5f;
        move(d, doc, page, (x, y) -> y > split, 0, h);
        line(d, doc, page, table.left, cell.bottom, table.right, cell.bottom);
    }

    /** 在儲存格右邊插入一欄（寬 w）：表格範圍內、右邊的內容往右移 */
    public static void insertColumn(PDDocument d, Doc doc, int page, RectF cell, RectF table, float w) throws IOException {
        final float split = cell.right - 1.5f;
        move(d, doc, page, (x, y) -> x > split && y >= table.top - 2 && y <= table.bottom + 2, w, 0);
        line(d, doc, page, cell.right, table.top, cell.right, table.bottom);
    }

    /** 合併儲存格：剪掉 box 內部的框線 */
    public static boolean merge(PDDocument d, Doc doc, int page, RectF box) throws IOException {
        return cut(d, doc, page, new RectF(box.left + 0.75f, box.top + 0.75f, box.right - 0.75f, box.bottom - 0.75f));
    }

    /** 插入表格；push＝把下面的內容往下移 */
    public static void addTable(PDDocument d, Doc doc, int page, float x, float y, float w, int rows, int cols, float rowH, boolean push) throws IOException {
        float H = rows * rowH;
        if (push) move(d, doc, page, (X, Y) -> Y > y - 2, 0, H + 6);
        for (int r = 0; r <= rows; r++) line(d, doc, page, x, y + r * rowH, x + w, y + r * rowH);
        for (int c = 0; c <= cols; c++) line(d, doc, page, x + c * w / cols, y, x + c * w / cols, y + H);
    }
}
