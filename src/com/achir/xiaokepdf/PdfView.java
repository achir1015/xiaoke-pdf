package com.achir.xiaokepdf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.LruCache;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.OverScroller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 頁面檢視：連續 / 單頁 / 雙頁、檢視旋轉、縮放。
 * 平常顯示整頁的低解析度圖，放大後只把螢幕上看得到的那一塊用目前倍率重新繪製，所以放多大都清楚。
 * 所有覆蓋物（搜尋結果、選取、表單欄位、繪製中的圖形）都用「顯示座標」（pt，左上原點，已套用 /Rotate）。
 */
public class PdfView extends View {
    public interface L {
        void onPage(int page);
        void onTap(int page, float x, float y);
        void onEmptyTap();
        void onSelection(int page, int a, int b);
        void onRect(int page, RectF r);
        void onLine(int page, float x1, float y1, float x2, float y2);
        void onInkChanged();
    }

    public static final int CONT = 0, SINGLE = 1, TWO = 2;
    public static final int T_NONE = 0, T_RECT = 1, T_INK = 2, T_LINE = 3, T_POINT = 4, T_ELLIPSE = 5;

    public Doc doc;
    public L l;
    public int mode = CONT, vrot = 0;
    public int tool = T_NONE;
    public int toolColor = 0xFFE53935;
    public float toolWidth = 2f;
    public boolean night, sepia, showFields, selectable = true;
    public String measure;          // 測量中顯示的文字

    private RectF[] lay;
    private float layW = 1, layH = 1, base = 1, sx, sy;
    public float zoom = 1f;
    private int curPage;
    private static final float GAP = 10;

    private final LruCache<Integer, Bitmap> low;
    private float lowScale;
    private int lowGen = -1;
    private final Set<Integer> pending = new HashSet<>();
    private final Map<Integer, Detail> details = new HashMap<>();
    private final Handler rh;
    private volatile int visA, visB;
    private static final ExecutorService textExec = Executors.newSingleThreadExecutor();

    private static class Detail { Bitmap bm; float cx, cy, s; int gen; }

    // 搜尋
    public Map<Integer, List<RectF>> hits = new HashMap<>();
    public int hitPage = -1;
    public RectF hitCur;
    // 選取
    public int selPage = -1, selA, selB;
    private boolean selDragging;
    private int handleDrag;
    // 工具
    private int dragPage = -1;
    private RectF drag;
    private float dx0, dy0;
    public int inkPage = -1;
    public final List<List<float[]>> ink = new ArrayList<>();
    private List<float[]> stroke;
    private float[] line;
    private boolean toolActive;
    // 閃爍標示（跳到書籤、註解時）
    private RectF flash;
    private int flashPage = -1;

    private final Paint pPaper = new Paint(), pBmp = new Paint(Paint.FILTER_BITMAP_FLAG), pFill = new Paint(Paint.ANTI_ALIAS_FLAG),
            pStroke = new Paint(Paint.ANTI_ALIAS_FLAG), pText = new Paint(Paint.ANTI_ALIAS_FLAG), pShadow = new Paint();
    private final GestureDetector gest;
    private final ScaleGestureDetector scale;
    private final OverScroller scroller;

    public PdfView(Context c) {
        super(c);
        int mb = (int) Math.min(Runtime.getRuntime().maxMemory() / 4, 256L << 20);
        low = new LruCache<Integer, Bitmap>(mb) {
            @Override protected int sizeOf(Integer k, Bitmap b) { return b.getByteCount(); }
        };
        HandlerThread ht = new HandlerThread("render");
        ht.start();
        rh = new Handler(ht.getLooper());
        scroller = new OverScroller(c);
        pStroke.setStyle(Paint.Style.STROKE);
        pStroke.setStrokeCap(Paint.Cap.ROUND);
        pStroke.setStrokeJoin(Paint.Join.ROUND);
        pText.setTextSize(U.dp(14));
        pShadow.setColor(0x22000000);
        gest = new GestureDetector(c, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) { scroller.forceFinished(true); return true; }

            @Override public boolean onScroll(MotionEvent a, MotionEvent b, float dx, float dy) {
                sx += dx; sy += dy; clamp(); invalidate(); updatePage(); return true;
            }

            @Override public boolean onFling(MotionEvent a, MotionEvent b, float vx, float vy) {
                if (mode == SINGLE && zoom <= 1.05f && Math.abs(vx) > Math.abs(vy) * 1.5f) {
                    goTo(curPage + (vx < 0 ? 1 : -1)); return true;
                }
                scroller.fling((int) sx, (int) sy, (int) -vx, (int) -vy, 0, (int) maxX(), 0, (int) maxY());
                postInvalidateOnAnimation();
                return true;
            }

            @Override public boolean onDoubleTap(MotionEvent e) {
                setZoom(zoom < 1.6f ? 2.5f : 1f, e.getX(), e.getY());
                return true;
            }

            @Override public boolean onSingleTapConfirmed(MotionEvent e) {
                if (selPage >= 0) { clearSelection(); return true; }
                if (mode == SINGLE && zoom <= 1.05f) {
                    if (e.getX() < getWidth() * 0.15f) { goTo(curPage - 1); return true; }
                    if (e.getX() > getWidth() * 0.85f) { goTo(curPage + 1); return true; }
                }
                int p = pageAt(e.getX(), e.getY());
                if (p < 0) { if (l != null) l.onEmptyTap(); return true; }
                float[] pt = toPt(p, e.getX(), e.getY());
                if (l != null) l.onTap(p, pt[0], pt[1]);
                return true;
            }

            @Override public void onLongPress(MotionEvent e) {
                if (tool != T_NONE || !selectable) return;
                final int p = pageAt(e.getX(), e.getY());
                if (p < 0 || doc == null) return;
                final float[] pt = toPt(p, e.getX(), e.getY());
                selDragging = true;
                performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
                textExec.execute(() -> {
                    final TextData.Page tp = doc.text(p);
                    post(() -> {
                        int i = tp.hit(pt[0], pt[1], 30);
                        if (i < 0) { selDragging = false; U.toast(getContext(), "這裡沒有可選取的文字"); return; }
                        selPage = p; selA = tp.wordStart(i); selB = tp.wordEnd(i);
                        invalidate();
                        if (!selDragging) finishSelection();
                    });
                });
            }
        });
        gest.setIsLongpressEnabled(true);
        scale = new ScaleGestureDetector(c, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector d) {
                setZoom(zoom * d.getScaleFactor(), d.getFocusX(), d.getFocusY());
                return true;
            }
        });
    }

    // ---------------------------------------------------------------- 版面

    public void setDoc(Doc d) {
        doc = d;
        low.evictAll();
        details.clear();
        pending.clear();
        hits.clear(); hitCur = null; selPage = -1; ink.clear(); inkPage = -1;
        if (d != null) { mode = d.layout; vrot = d.vrot; zoom = d.zoom; curPage = d.page; }
        lay = null;
        relayout();
        if (d != null) goTo(d.page);
        invalidate();
    }

    /** 文件內容改變（編輯、撤銷）後呼叫。 */
    public void reset() {
        low.evictAll();
        for (Detail dt : details.values()) dt.gen = -1;
        pending.clear();
        float fy = sy;
        relayout();
        sy = fy; clamp();
        invalidate();
        scheduleDetail();
    }

    private float pw(int i) { return vrot % 2 == 0 ? doc.dw(i) : doc.dh(i); }
    private float ph(int i) { return vrot % 2 == 0 ? doc.dh(i) : doc.dw(i); }

    private void relayout() {
        if (doc == null || getWidth() == 0 || doc.n == 0) { lay = null; return; }
        int n = doc.n;
        curPage = Math.max(0, Math.min(curPage, n - 1));
        lay = new RectF[n];
        float W = getWidth() - 2 * pad(), H = getHeight() - 2 * pad();
        if (mode == SINGLE) {
            int p = curPage;
            lay[p] = new RectF(0, 0, pw(p), ph(p));
            layW = pw(p); layH = ph(p);
            base = Math.min(W / layW, H / layH);
        } else if (mode == TWO) {
            float y = 0, maxW = 0;
            float[] rowW = new float[n];
            for (int i = 0; i < n; i += 2) {
                float w0 = pw(i), h0 = ph(i);
                float w1 = i + 1 < n ? pw(i + 1) : 0, h1 = i + 1 < n ? ph(i + 1) : 0;
                float rw = w0 + (i + 1 < n ? GAP + w1 : 0), rhh = Math.max(h0, h1);
                lay[i] = new RectF(0, y + (rhh - h0) / 2, w0, y + (rhh - h0) / 2 + h0);
                if (i + 1 < n) lay[i + 1] = new RectF(w0 + GAP, y + (rhh - h1) / 2, w0 + GAP + w1, y + (rhh - h1) / 2 + h1);
                rowW[i] = rw;
                maxW = Math.max(maxW, rw);
                y += rhh + GAP;
            }
            for (int i = 0; i < n; i += 2) {
                float off = (maxW - rowW[i]) / 2;
                lay[i].offset(off, 0);
                if (i + 1 < n) lay[i + 1].offset(off, 0);
            }
            layW = maxW; layH = y - GAP;
            base = W / layW;
        } else {
            float maxW = 0, y = 0;
            for (int i = 0; i < n; i++) maxW = Math.max(maxW, pw(i));
            for (int i = 0; i < n; i++) {
                lay[i] = new RectF((maxW - pw(i)) / 2, y, (maxW - pw(i)) / 2 + pw(i), y + ph(i));
                y += ph(i) + GAP;
            }
            layW = maxW; layH = y - GAP;
            base = W / layW;
        }
        float ls = base;
        // 低解析度圖的倍率：約螢幕寬，不要太大
        float maxDim = 0;
        for (int i = 0; i < n; i++) if (lay[i] != null) maxDim = Math.max(maxDim, Math.max(doc.dw(i), doc.dh(i)));
        if (maxDim * ls > 2400) ls = 2400 / maxDim;
        if (ls != lowScale || lowGen != doc.gen) { low.evictAll(); lowScale = ls; lowGen = doc.gen; }
        clamp();
    }

    private float pad() { return U.dp(10); }
    public float s() { return base * zoom; }
    private float ox() { float cw = layW * s(); return cw + 2 * pad() < getWidth() ? (getWidth() - cw) / 2 : pad(); }
    private float oy() { float c = layH * s(); return c + 2 * pad() < getHeight() ? (getHeight() - c) / 2 : pad(); }
    private float maxX() { return Math.max(0, layW * s() + 2 * pad() - getWidth()); }
    private float maxY() { return Math.max(0, layH * s() + 2 * pad() - getHeight()); }
    private void clamp() { sx = Math.max(0, Math.min(sx, maxX())); sy = Math.max(0, Math.min(sy, maxY())); }

    private RectF screen(int i) {
        RectF r = lay[i];
        float s = s(), ox = ox(), oy = oy();
        return new RectF(ox + r.left * s - sx, oy + r.top * s - sy, ox + r.right * s - sx, oy + r.bottom * s - sy);
    }

    static void rot(Matrix m, int vr, float W, float H) {
        switch (vr) {
            case 1: m.postRotate(90); m.postTranslate(H, 0); break;
            case 2: m.postRotate(180); m.postTranslate(W, H); break;
            case 3: m.postRotate(270); m.postTranslate(0, W); break;
        }
    }

    /** 顯示座標（pt）→ 螢幕像素。 */
    public Matrix pageMatrix(int i) {
        RectF r = screen(i);
        float s = s();
        Matrix m = new Matrix();
        m.setScale(s, s);
        rot(m, vrot, doc.dw(i) * s, doc.dh(i) * s);
        m.postTranslate(r.left, r.top);
        return m;
    }

    public float[] toPt(int i, float x, float y) {
        Matrix inv = new Matrix();
        pageMatrix(i).invert(inv);
        float[] p = {x, y};
        inv.mapPoints(p);
        return p;
    }

    public int pageAt(float x, float y) {
        if (lay == null) return -1;
        for (int i = visA; i <= visB && i < lay.length; i++) if (lay[i] != null && screen(i).contains(x, y)) return i;
        for (int i = 0; i < lay.length; i++) if (lay[i] != null && screen(i).contains(x, y)) return i;
        return -1;
    }

    public int page() { return curPage; }

    private void updatePage() {
        if (lay == null || mode == SINGLE) return;
        float cy = getHeight() / 2f;
        int best = curPage;
        float bd = Float.MAX_VALUE;
        for (int i = visA; i <= visB && i < lay.length; i++) {
            if (lay[i] == null) continue;
            RectF r = screen(i);
            float d = r.top <= cy && r.bottom >= cy ? 0 : Math.min(Math.abs(r.top - cy), Math.abs(r.bottom - cy));
            if (d < bd) { bd = d; best = i; }
        }
        if (best != curPage) {
            curPage = best;
            if (doc != null) doc.page = best;
            if (l != null) l.onPage(best);
        }
    }

    public void goTo(int p) {
        if (doc == null || doc.n == 0) return;
        p = Math.max(0, Math.min(p, doc.n - 1));
        curPage = p;
        doc.page = p;
        if (mode == SINGLE) { relayout(); sx = sy = 0; }
        else if (lay != null) { sy = lay[p].top * s(); clamp(); }
        invalidate();
        scheduleDetail();
        if (l != null) l.onPage(p);
    }

    /** 跳到某頁並把一個區域（pt）放到畫面中央。 */
    public void goTo(int p, RectF r) {
        goTo(p);
        if (lay == null || r == null) return;
        float[] c = {r.centerX(), r.centerY()};
        pageMatrix(p).mapPoints(c);
        sx += c[0] - getWidth() / 2f;
        sy += c[1] - getHeight() / 2f;
        clamp();
        flash = new RectF(r); flashPage = p;
        postDelayed(() -> { flash = null; invalidate(); }, 1600);
        invalidate();
        scheduleDetail();
    }

    public void setZoom(float z, float fx, float fy) {
        if (lay == null) return;
        z = Math.max(mode == SINGLE ? 1f : 0.3f, Math.min(z, 12f));
        float s0 = s(), lx = (fx + sx - ox()) / s0, ly = (fy + sy - oy()) / s0;
        zoom = z;
        if (doc != null) doc.zoom = z;
        float s1 = s();
        sx = lx * s1 + ox() - fx;
        sy = ly * s1 + oy() - fy;
        clamp();
        invalidate();
        scheduleDetail();
    }

    public void setMode(int m) {
        int p = curPage;
        mode = m;
        if (doc != null) doc.layout = m;
        if (m == SINGLE) zoom = 1;
        relayout();
        goTo(p);
    }

    public void rotateView(int delta) {
        int p = curPage;
        vrot = ((vrot + delta) % 4 + 4) % 4;
        if (doc != null) doc.vrot = vrot;
        low.evictAll();
        details.clear();
        relayout();
        goTo(p);
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        int p = curPage;
        relayout();
        goTo(p);
    }

    @Override
    public void computeScroll() {
        if (scroller.computeScrollOffset()) {
            sx = scroller.getCurrX(); sy = scroller.getCurrY();
            clamp(); updatePage();
            postInvalidateOnAnimation();
            if (scroller.isFinished()) scheduleDetail();
        }
    }

    // ---------------------------------------------------------------- 繪製

    private final Runnable detailTask = this::requestDetail;

    private void scheduleDetail() {
        removeCallbacks(detailTask);
        postDelayed(detailTask, 140);
    }

    private void requestLow(final int i) {
        if (pending.contains(i)) return;
        pending.add(i);
        final Doc d = doc;
        final int g = d.gen;
        final float ls = lowScale;
        rh.post(() -> {
            Bitmap b = null;
            if (d == doc && g == d.gen && i >= visA - 2 && i <= visB + 2)
                b = d.renderWidth(i, Math.max(1, Math.round(d.dw(i) * ls)));
            final Bitmap fb = b;
            post(() -> {
                pending.remove(i);
                if (fb != null && d == doc && g == d.gen && ls == lowScale) { low.put(i, fb); invalidate(); }
            });
        });
    }

    private void requestDetail() {
        if (doc == null || lay == null || s() <= lowScale * 1.1f || scale.isInProgress()) return;
        final Doc d = doc;
        final int g = d.gen;
        final float s = s();
        RectF view = new RectF(0, 0, getWidth(), getHeight());
        for (int i = visA; i <= visB && i < lay.length; i++) {
            if (lay[i] == null) continue;
            RectF r = screen(i);
            RectF clip = new RectF();
            if (!clip.setIntersect(r, view)) continue;
            Detail old = details.get(i);
            final float cx = (float) Math.floor(clip.left) + sx, cy = (float) Math.floor(clip.top) + sy;
            final int w = (int) Math.ceil(clip.width()) + 1, h = (int) Math.ceil(clip.height()) + 1;
            if (old != null && old.gen == g && old.s == s && old.cx <= cx && old.cy <= cy
                    && old.cx + old.bm.getWidth() >= cx + w && old.cy + old.bm.getHeight() >= cy + h) continue;
            final Matrix m = pageMatrix(i);
            m.postTranslate(-(float) Math.floor(clip.left), -(float) Math.floor(clip.top));
            final int page = i;
            rh.post(() -> {
                if (d != doc || g != d.gen || s != s() || page < visA || page > visB) return;
                final Bitmap b = d.render(page, w, h, m);
                post(() -> {
                    if (b == null || d != doc || g != d.gen) return;
                    Detail dt = new Detail();
                    dt.bm = b; dt.cx = cx; dt.cy = cy; dt.s = s; dt.gen = g;
                    details.put(page, dt);
                    invalidate();
                });
            });
        }
    }

    private ColorMatrixColorFilter filter() {
        if (night) {
            ColorMatrix inv = new ColorMatrix(new float[]{-1, 0, 0, 0, 255, 0, -1, 0, 0, 255, 0, 0, -1, 0, 255, 0, 0, 0, 1, 0});
            ColorMatrix dim = new ColorMatrix();
            dim.setScale(0.86f, 0.86f, 0.88f, 1f);
            inv.postConcat(dim);
            return new ColorMatrixColorFilter(inv);
        }
        if (sepia) {
            return new ColorMatrixColorFilter(new ColorMatrix(new float[]{
                    0.95f, 0, 0, 0, 0, 0, 0.90f, 0, 0, 0, 0, 0, 0.78f, 0, 0, 0, 0, 0, 1, 0}));
        }
        return null;
    }

    @Override
    protected void onDraw(Canvas c) {
        c.drawColor(night ? 0xFF000000 : U.PAGE_BG);
        if (doc == null) return;
        if (lay == null) relayout();
        if (lay == null) return;
        pBmp.setColorFilter(filter());
        pPaper.setColor(night ? 0xFF1E1E1E : sepia ? 0xFFF3E9D2 : 0xFFFFFFFF);
        int a = Integer.MAX_VALUE, b = -1;
        float H = getHeight(), W = getWidth();
        for (int i = 0; i < lay.length; i++) {
            if (lay[i] == null) continue;
            RectF r = screen(i);
            if (r.bottom < -H * 0.5f || r.top > H * 1.5f || r.right < 0 || r.left > W) {
                if (r.top > H * 1.5f && mode != SINGLE) break;
                continue;
            }
            a = Math.min(a, i); b = Math.max(b, i);
        }
        if (b >= 0) { visA = a; visB = b; }
        for (int i = Math.max(0, a); i <= b; i++) {
            if (lay[i] == null) continue;
            RectF r = screen(i);
            if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
            c.drawRect(r.left + U.dp(1), r.top + U.dp(2), r.right + U.dp(1), r.bottom + U.dp(2), pShadow);
            c.drawRect(r, pPaper);
            Bitmap bm = low.get(i);
            if (bm != null) {
                float s = s();
                Matrix m = new Matrix();
                m.setScale(doc.dw(i) * s / bm.getWidth(), doc.dh(i) * s / bm.getHeight());
                rot(m, vrot, doc.dw(i) * s, doc.dh(i) * s);
                m.postTranslate(r.left, r.top);
                c.drawBitmap(bm, m, pBmp);
            } else requestLow(i);
            Detail dt = details.get(i);
            if (dt != null && dt.gen == doc.gen && dt.s == s()) {
                c.save();
                c.clipRect(r);
                c.drawBitmap(dt.bm, dt.cx - sx, dt.cy - sy, pBmp);
                c.restore();
            }
            overlays(c, i);
        }
        // 預先繪製前後頁
        if (b >= 0) {
            if (b + 1 < lay.length && lay[b + 1] != null && low.get(b + 1) == null) requestLow(b + 1);
            if (a - 1 >= 0 && lay[a - 1] != null && low.get(a - 1) == null) requestLow(a - 1);
        }
        handles(c);
        if (measure != null) {
            pText.setColor(0xFFFFFFFF);
            float tw = pText.measureText(measure);
            pFill.setColor(0xCC000000);
            c.drawRoundRect(W / 2 - tw / 2 - U.dp(10), U.dp(8), W / 2 + tw / 2 + U.dp(10), U.dp(40), U.dp(8), U.dp(8), pFill);
            c.drawText(measure, W / 2 - tw / 2, U.dp(30), pText);
        }
    }

    private void overlays(Canvas c, int i) {
        c.save();
        c.concat(pageMatrix(i));
        float inv = 1f / s();
        if (showFields && i < doc.annots.size()) {
            pFill.setColor(0x332B6CF0);
            pStroke.setColor(0x992B6CF0); pStroke.setStrokeWidth(inv);
            for (Doc.Annot an : doc.annots.get(i)) if (an.field != null && !an.hidden) { c.drawRect(an.r, pFill); c.drawRect(an.r, pStroke); }
        }
        List<RectF> hs = hits.get(i);
        if (hs != null) {
            pFill.setColor(0x66FFD400);
            for (RectF r : hs) c.drawRect(r, pFill);
        }
        if (hitCur != null && hitPage == i) {
            pFill.setColor(0x99FF7A00);
            c.drawRect(hitCur, pFill);
        }
        if (selPage == i) {
            pFill.setColor(0x553D7BFF);
            TextData.Page tp = doc.text(i);
            for (RectF r : tp.rects(Math.min(selA, selB), Math.max(selA, selB))) c.drawRect(r, pFill);
        }
        if (flash != null && flashPage == i) {
            pStroke.setColor(0xFFFF7A00); pStroke.setStrokeWidth(3 * inv);
            c.drawRect(flash, pStroke);
        }
        pStroke.setColor(toolColor);
        pStroke.setStrokeWidth(Math.max(toolWidth, 1.5f * inv));
        if (drag != null && dragPage == i) {
            if (tool == T_ELLIPSE) c.drawOval(drag, pStroke); else c.drawRect(drag, pStroke);
        }
        if (line != null && dragPage == i) c.drawLine(line[0], line[1], line[2], line[3], pStroke);
        if (inkPage == i) {
            for (List<float[]> st : ink) drawStroke(c, st);
            if (stroke != null) drawStroke(c, stroke);
        }
        c.restore();
    }

    private void drawStroke(Canvas c, List<float[]> st) {
        if (st.isEmpty()) return;
        Path p = new Path();
        p.moveTo(st.get(0)[0], st.get(0)[1]);
        for (int k = 1; k < st.size(); k++) p.lineTo(st.get(k)[0], st.get(k)[1]);
        if (st.size() == 1) p.lineTo(st.get(0)[0] + 0.1f, st.get(0)[1]);
        c.drawPath(p, pStroke);
    }

    private float[][] handlePts() {
        if (selPage < 0 || lay == null || selPage >= lay.length || lay[selPage] == null) return null;
        TextData.Page tp = doc.text(selPage);
        List<RectF> rs = tp.rects(Math.min(selA, selB), Math.max(selA, selB));
        if (rs.isEmpty()) return null;
        RectF f = rs.get(0), e = rs.get(rs.size() - 1);
        float[] pts = {f.left, f.bottom, e.right, e.bottom};
        pageMatrix(selPage).mapPoints(pts);
        return new float[][]{{pts[0], pts[1]}, {pts[2], pts[3]}};
    }

    private void handles(Canvas c) {
        float[][] h = handlePts();
        if (h == null) return;
        pFill.setColor(U.ACCENT);
        for (float[] p : h) {
            c.drawCircle(p[0], p[1] + U.dp(9), U.dp(9), pFill);
            c.drawRect(p[0] - U.dp(1), p[1] - U.dp(4), p[0] + U.dp(1), p[1] + U.dp(4), pFill);
        }
    }

    // ---------------------------------------------------------------- 選取

    public void clearSelection() { selPage = -1; invalidate(); }

    public String selectedText() {
        if (selPage < 0) return "";
        TextData.Page tp = doc.text(selPage);
        int a = Math.min(selA, selB), b = Math.max(selA, selB);
        return tp.text.substring(Math.max(0, a), Math.min(tp.count(), b + 1)).trim();
    }

    public List<RectF> selectedRects() {
        TextData.Page tp = doc.text(selPage);
        return tp.rects(Math.min(selA, selB), Math.max(selA, selB));
    }

    public void selectAllOnPage(int p) {
        textExec.execute(() -> {
            TextData.Page tp = doc.text(p);
            post(() -> {
                if (tp.count() == 0) { U.toast(getContext(), "這一頁沒有文字"); return; }
                selPage = p; selA = 0; selB = tp.count() - 1;
                invalidate();
                finishSelection();
            });
        });
    }

    private void finishSelection() {
        if (selPage >= 0 && l != null) l.onSelection(selPage, Math.min(selA, selB), Math.max(selA, selB));
    }

    private void moveSel(float x, float y, boolean end) {
        if (selPage < 0) return;
        float[] pt = toPt(selPage, x, y - (handleDrag != 0 ? U.dp(12) : 0));
        TextData.Page tp = doc.text(selPage);
        int i = tp.hit(pt[0], pt[1], 400);
        if (i < 0) return;
        if (end) selB = i; else selA = i;
        invalidate();
    }

    // ---------------------------------------------------------------- 觸控

    public List<List<float[]>> takeInk() {
        List<List<float[]>> r = new ArrayList<>(ink);
        ink.clear();
        inkPage = -1;
        invalidate();
        return r;
    }

    public void undoInk() {
        if (!ink.isEmpty()) ink.remove(ink.size() - 1);
        if (ink.isEmpty()) inkPage = -1;
        invalidate();
        if (l != null) l.onInkChanged();
    }

    private boolean toolTouch(MotionEvent e) {
        float x = e.getX(), y = e.getY();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                int p = pageAt(x, y);
                if (p < 0) return false;
                if (tool == T_INK && inkPage >= 0 && inkPage != p) return false;
                float[] pt = toPt(p, x, y);
                dragPage = p; dx0 = pt[0]; dy0 = pt[1];
                toolActive = true;
                if (tool == T_RECT || tool == T_ELLIPSE) drag = new RectF(dx0, dy0, dx0, dy0);
                else if (tool == T_LINE) line = new float[]{dx0, dy0, dx0, dy0};
                else if (tool == T_INK) { inkPage = p; stroke = new ArrayList<>(); stroke.add(pt); }
                invalidate();
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                if (!toolActive) return false;
                float[] pt = toPt(dragPage, x, y);
                pt[0] = Math.max(0, Math.min(pt[0], doc.dw(dragPage)));
                pt[1] = Math.max(0, Math.min(pt[1], doc.dh(dragPage)));
                if (drag != null) drag.set(Math.min(dx0, pt[0]), Math.min(dy0, pt[1]), Math.max(dx0, pt[0]), Math.max(dy0, pt[1]));
                if (line != null) {
                    line[2] = pt[0]; line[3] = pt[1];
                    if (l != null) l.onLine(-1 - dragPage, line[0], line[1], line[2], line[3]);
                }
                if (stroke != null) for (int h = 0; h < e.getHistorySize(); h++) stroke.add(toPt(dragPage, e.getHistoricalX(h), e.getHistoricalY(h)));
                if (stroke != null) stroke.add(pt);
                invalidate();
                return true;
            }
            case MotionEvent.ACTION_UP: {
                if (!toolActive) return false;
                toolActive = false;
                int p = dragPage;
                if (drag != null) {
                    RectF r = drag; drag = null;
                    if (r.width() > 4 && r.height() > 4) { if (l != null) l.onRect(p, r); }
                    else if (l != null) l.onTap(p, dx0, dy0);
                } else if (line != null) {
                    float[] ln = line; line = null;
                    if (Math.hypot(ln[2] - ln[0], ln[3] - ln[1]) > 3 && l != null) l.onLine(p, ln[0], ln[1], ln[2], ln[3]);
                } else if (stroke != null) {
                    ink.add(stroke); stroke = null;
                    if (l != null) l.onInkChanged();
                } else if (tool == T_POINT) {
                    if (l != null) l.onTap(p, dx0, dy0);
                }
                invalidate();
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                cancelTool();
                return true;
        }
        return toolActive;
    }

    private void cancelTool() {
        toolActive = false; drag = null; line = null; stroke = null;
        invalidate();
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (doc == null) return true;
        int act = e.getActionMasked();
        if (e.getPointerCount() > 1 && toolActive) cancelTool();
        // 拖曳選取的端點
        if (act == MotionEvent.ACTION_DOWN && selPage >= 0) {
            float[][] h = handlePts();
            if (h != null) {
                float r = U.dp(28);
                if (Math.hypot(e.getX() - h[1][0], e.getY() - h[1][1] - U.dp(9)) < r) handleDrag = 2;
                else if (Math.hypot(e.getX() - h[0][0], e.getY() - h[0][1] - U.dp(9)) < r) handleDrag = 1;
            }
        }
        if (handleDrag != 0) {
            if (act == MotionEvent.ACTION_MOVE) moveSel(e.getX(), e.getY(), handleDrag == 2);
            if (act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) { handleDrag = 0; finishSelection(); }
            return true;
        }
        if (selDragging) {
            if (act == MotionEvent.ACTION_MOVE) moveSel(e.getX(), e.getY(), true);
            if (act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) { selDragging = false; finishSelection(); }
            return true;
        }
        if (tool != T_NONE && e.getPointerCount() == 1 && (toolActive || act == MotionEvent.ACTION_DOWN)) {
            if (toolTouch(e)) return true;
        }
        scale.onTouchEvent(e);
        if (!scale.isInProgress()) gest.onTouchEvent(e);
        if (act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) scheduleDetail();
        return true;
    }

    public void release() {
        rh.getLooper().quitSafely();
    }
}
