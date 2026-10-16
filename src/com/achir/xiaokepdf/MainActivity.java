package com.achir.xiaokepdf;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;

import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationTextMarkup;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity implements PdfView.L {

    public SharedPreferences prefs;
    public PdfView view;
    private int cur = -1;            // -1 = 首頁
    private LinearLayout root, tabStrip, toolbar, hintBar, bottomBar, annotBar, selBar, searchBar;
    private HorizontalScrollView tabScroll, annotScroll;
    private FrameLayout content, readerFrame;
    private TextView pageBadge, hintText, searchCount;
    private EditText searchEdit;
    private boolean fullscreen;

    // ------------------------------------------------------------------ 生命週期

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("prefs", MODE_PRIVATE);
        Ops.author = prefs.getString("author", "小柯");
        applyTheme();
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        view = new PdfView(this);
        view.l = this;
        view.night = prefs.getBoolean("night", false);
        view.sepia = prefs.getBoolean("sepia", false);
        buildUi();
        if (App.docs.isEmpty()) recover();
        else select(Math.min(App.docs.size() - 1, Math.max(-1, prefs.getInt("cur", -1))));
        handleIntent(getIntent());
        U.main.postDelayed(autosave, 60_000);
    }

    private final Runnable autosave = new Runnable() {
        @Override public void run() {
            for (Doc d : App.docs) if (d.dirty()) U.bg.execute(d::writeMeta);
            U.main.postDelayed(this, 60_000);
        }
    };

    @Override
    protected void onDestroy() {
        U.main.removeCallbacks(autosave);
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        super.onPause();
        prefs.edit().putInt("cur", cur).apply();
        for (Doc d : App.docs) U.bg.execute(d::writeMeta);
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        handleIntent(i);
    }

    private void handleIntent(Intent i) {
        if (i == null) return;
        String a = i.getAction();
        if (Intent.ACTION_VIEW.equals(a) && i.getData() != null) openUri(i.getData(), false);
        else if (Intent.ACTION_SEND.equals(a)) {
            Parcelable p = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (p instanceof Uri) openUri((Uri) p, false);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            ArrayList<Parcelable> ps = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (ps != null) for (Parcelable p : ps) if (p instanceof Uri) openUri((Uri) p, false);
        }
        setIntent(new Intent());
    }

    private void recover() {
        U.run(this, null, () -> { List<Doc> l = Doc.recover(this); l.sort((x, y) -> Integer.compare(x.order, y.order)); return l; }, list -> {
            List<Doc> dirty = new ArrayList<>();
            for (Doc d : list) { if (d.dirty()) dirty.add(d); else App.docs.add(d); }
            refreshTabs();
            int want = prefs.getInt("cur", -1);
            select(Math.min(App.docs.size() - 1, want));
            if (!dirty.isEmpty()) {
                StringBuilder names = new StringBuilder();
                for (Doc d : dirty) names.append("・").append(d.name).append(d.uri == null && d.steps.size() == 1 ? "（尚未儲存的新文件）" : "（" + (d.steps.size() - 1) + " 個編輯步驟）").append("\n");
                U.dlg(this).setTitle("恢復未儲存的工作？")
                        .setMessage("小柯文件PDF助手上次沒有正常結束，以下文件還有未儲存的變更：\n\n" + names + "\n恢復後可以繼續編輯或撤銷。")
                        .setCancelable(false)
                        .setPositiveButton("恢復", (x, w) -> { App.docs.addAll(dirty); App.docs.sort((x1, y1) -> Integer.compare(x1.order, y1.order)); refreshTabs(); select(Math.min(App.docs.size() - 1, prefs.getInt("cur", 0))); })
                        .setNegativeButton("捨棄", (x, w) -> { for (Doc d : dirty) d.discard(); })
                        .show();
            }
        });
    }

    // ------------------------------------------------------------------ 主題

    private void applyTheme() {
        String t = prefs.getString("theme", "system");
        boolean dark = t.equals("dark") || (t.equals("system")
                && (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES);
        U.palette(dark);
        Window w = getWindow();
        w.setStatusBarColor(U.BG);
        w.setNavigationBarColor(U.SURFACE);
        int flags = 0;
        if (!dark) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        w.getDecorView().setSystemUiVisibility(flags);
        w.getDecorView().setBackgroundColor(U.BG);
    }

    public void setTheme(String t) {
        prefs.edit().putString("theme", t).apply();
        applyTheme();
        buildUi();
        select(cur);
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        boolean was = U.dark;
        applyTheme();
        if (was != U.dark) { buildUi(); select(cur); }
    }

    // ------------------------------------------------------------------ 版面

    private void buildUi() {
        if (view.getParent() != null) ((ViewGroup) view.getParent()).removeView(view);
        root = U.vbox(this);
        root.setBackgroundColor(U.BG);
        root.setFitsSystemWindows(true);

        // 分頁列
        tabScroll = new HorizontalScrollView(this);
        tabScroll.setHorizontalScrollBarEnabled(true);
        tabStrip = U.hbox(this);
        tabStrip.setPadding(U.dp(4), U.dp(4), U.dp(4), 0);
        tabScroll.addView(tabStrip);
        root.addView(tabScroll, U.lp(U.MATCH, U.WRAP));

        toolbar = U.hbox(this);
        toolbar.setBackgroundColor(U.SURFACE);
        toolbar.setPadding(U.dp(2), 0, U.dp(2), 0);
        root.addView(toolbar, U.lp(U.MATCH, U.dp(52)));
        searchBar = U.hbox(this);
        searchBar.setBackgroundColor(U.SURFACE);
        searchBar.setVisibility(View.GONE);
        root.addView(searchBar, U.lp(U.MATCH, U.dp(52)));
        root.addView(U.divider(this));

        hintBar = U.hbox(this);
        hintBar.setBackgroundColor(U.ACCENT_SOFT);
        hintBar.setPadding(U.dp(14), U.dp(4), U.dp(4), U.dp(4));
        hintText = U.text(this, "", 14, U.TEXT);
        hintBar.setVisibility(View.GONE);
        root.addView(hintBar, U.lp(U.MATCH, U.WRAP));

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(U.MATCH, 0, 1));

        readerFrame = new FrameLayout(this);
        readerFrame.addView(view, new FrameLayout.LayoutParams(U.MATCH, U.MATCH));
        pageBadge = U.text(this, "", 13, Color.WHITE);
        pageBadge.setBackground(U.round(0xAA222222, 0, 14));
        pageBadge.setPadding(U.dp(12), U.dp(6), U.dp(12), U.dp(6));
        pageBadge.setOnClickListener(v -> askPage());
        FrameLayout.LayoutParams bl = new FrameLayout.LayoutParams(U.WRAP, U.WRAP, Gravity.BOTTOM | Gravity.END);
        bl.setMargins(0, 0, U.dp(14), U.dp(14));
        readerFrame.addView(pageBadge, bl);
        selBar = U.hbox(this);
        selBar.setBackground(U.round(U.CARD, U.LINE, 12));
        selBar.setElevation(U.dp(6));
        selBar.setVisibility(View.GONE);
        HorizontalScrollView selScroll = new HorizontalScrollView(this);
        selScroll.addView(selBar);
        FrameLayout.LayoutParams sl = new FrameLayout.LayoutParams(U.WRAP, U.WRAP, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        sl.setMargins(U.dp(8), U.dp(8), U.dp(8), 0);
        readerFrame.addView(selScroll, sl);

        annotScroll = new HorizontalScrollView(this);
        annotScroll.setBackgroundColor(U.SURFACE);
        annotBar = U.hbox(this);
        annotScroll.addView(annotBar);
        annotScroll.setVisibility(View.GONE);
        root.addView(annotScroll, U.lp(U.MATCH, U.WRAP));

        bottomBar = U.hbox(this);
        bottomBar.setBackgroundColor(U.SURFACE);
        root.addView(bottomBar, U.lp(U.MATCH, U.WRAP));

        setContentView(root);
        refreshTabs();
    }

    // ------------------------------------------------------------------ 分頁

    public Doc doc() { return cur >= 0 && cur < App.docs.size() ? App.docs.get(cur) : null; }

    public void refreshTabs() {
        if (tabStrip == null) return;
        tabStrip.removeAllViews();
        tabStrip.addView(tab("⌂", null, cur == -1, v -> select(-1), null));
        for (int i = 0; i < App.docs.size(); i++) {
            final int idx = i;
            Doc d = App.docs.get(i);
            View t = tab(d.name, d, cur == i, v -> select(idx), v -> { tabMenu(v, idx); return true; });
            tabStrip.addView(t);
        }
        TextView open = U.flat(this, "＋ 開啟", v -> pickPdf());
        open.setTextSize(14);
        tabStrip.addView(open);
        if (cur >= 0) {
            final int idx = cur + 1;
            tabStrip.post(() -> { if (idx < tabStrip.getChildCount()) { View c = tabStrip.getChildAt(idx); tabScroll.requestChildRectangleOnScreen(c, new android.graphics.Rect(0, 0, c.getWidth(), c.getHeight()), false); } });
        }
    }

    private View tab(String name, Doc d, boolean sel, View.OnClickListener click, View.OnLongClickListener lc) {
        LinearLayout t = U.hbox(this);
        t.setPadding(U.dp(12), U.dp(7), d == null ? U.dp(12) : U.dp(4), U.dp(7));
        GradientBg(t, sel);
        if (d != null && d.dirty()) { TextView dot = U.text(this, "● ", 11, U.ACCENT); t.addView(dot); }
        TextView n = U.text(this, name, 14, sel ? U.TEXT : U.SUB);
        if (sel) n.setTypeface(Typeface.DEFAULT_BOLD);
        n.setMaxWidth(U.dp(150));
        n.setSingleLine(true);
        n.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        t.addView(n);
        if (d != null) {
            TextView x = U.text(this, "✕", 13, U.SUB);
            x.setPadding(U.dp(8), U.dp(2), U.dp(6), U.dp(2));
            x.setOnClickListener(v -> closeTab(App.docs.indexOf(d), null));
            t.addView(x);
        }
        t.setOnClickListener(click);
        if (lc != null) t.setOnLongClickListener(lc);
        LinearLayout.LayoutParams lp = U.lp(U.WRAP, U.WRAP);
        lp.setMargins(0, 0, U.dp(4), 0);
        t.setLayoutParams(lp);
        return t;
    }

    private void GradientBg(View v, boolean sel) {
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(sel ? U.SURFACE : 0);
        float r = U.dp(10);
        g.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        v.setBackground(g);
    }

    private void tabMenu(View anchor, int idx) {
        PopupMenu pm = new PopupMenu(this, anchor);
        pm.getMenu().add(0, 1, 0, "關閉");
        pm.getMenu().add(0, 2, 0, "關閉其他分頁");
        pm.getMenu().add(0, 3, 0, "重新開啟上次關閉的分頁").setEnabled(!App.closed.isEmpty());
        pm.getMenu().add(0, 4, 0, "顯示檔案");
        pm.getMenu().add(0, 5, 0, "分享");
        pm.setOnMenuItemClickListener(it -> {
            Doc d = App.docs.get(idx);
            switch (it.getItemId()) {
                case 1: closeTab(idx, null); break;
                case 2: closeOthers(d); break;
                case 3: reopenClosed(); break;
                case 4: showFile(d); break;
                case 5: share(d); break;
            }
            return true;
        });
        pm.show();
    }

    public void select(int i) {
        if (i >= App.docs.size()) i = App.docs.size() - 1;
        exitModes();
        cur = i;
        Doc d = doc();
        content.removeAllViews();
        if (d == null) {
            content.addView(Home.build(this));
            view.setDoc(null);
        } else {
            content.addView(readerFrame);
            view.setDoc(d);
            if (d.repaired) { d.repaired = false; U.toast(this, "這份文件有損壞，已自動修復"); }
            if (d.broken) U.toast(this, "文件結構損壞，以唯讀模式開啟");
            else if (d.encrypted && !d.owner && d.block(Doc.K_EDIT) != null) restrictedBanner(d);
        }
        refreshTabs();
        refreshBars();
    }

    private void restrictedBanner(Doc d) {
        showHint("🔒 作者限制了這份文件的部分權限。", new String[]{"解除限制"}, new Runnable[]{() -> Panels.unlock(this, d)});
    }

    /** 工具列、底部列依目前狀態更新。 */
    public void refreshBars() {
        toolbar.removeAllViews();
        bottomBar.removeAllViews();
        Doc d = doc();
        toolbar.addView(U.icon(this, "☰", "所有工具", v -> Tools.catalog(this)));
        if (d == null) {
            ImageView logo = new ImageView(this);
            logo.setImageResource(R.drawable.ic_launcher);
            toolbar.addView(logo, U.lp(U.dp(30), U.dp(30)));
            TextView t = U.bold(this, " 小柯文件PDF助手", 17, U.TEXT);
            toolbar.addView(t, U.lpw(1));
            toolbar.addView(U.icon(this, "⌕", "尋找工具與指令", v -> Tools.palette(this)));
            toolbar.addView(U.icon(this, U.dark ? "☀" : "☾", "切換深色 / 淺色主題", v -> setTheme(U.dark ? "light" : "dark")));
            bottomBar.setVisibility(View.GONE);
            pageBadge.setVisibility(View.GONE);
            return;
        }
        TextView undo = U.icon(this, "↶", d.undoLabel() == null ? "復原" : "復原：" + d.undoLabel(), v -> undo());
        TextView redo = U.icon(this, "↷", d.redoLabel() == null ? "重做" : "重做：" + d.redoLabel(), v -> redo());
        undo.setAlpha(d.undoLabel() == null ? 0.35f : 1);
        redo.setAlpha(d.redoLabel() == null ? 0.35f : 1);
        toolbar.addView(undo);
        toolbar.addView(redo);
        View sp = new View(this);
        toolbar.addView(sp, U.lpw(1));
        toolbar.addView(U.icon(this, "⌕", "搜尋文件（逗號分隔可同時找多個詞）", v -> openSearch()));
        TextView ed = U.text(this, "編輯", 15, U.ACCENT);
        ed.setTypeface(Typeface.DEFAULT_BOLD);
        ed.setPadding(U.dp(12), U.dp(8), U.dp(12), U.dp(8));
        ed.setBackground(U.round(U.ACCENT_SOFT, 0, 16));
        ed.setOnClickListener(v -> Editing.show(this, annotBar));
        LinearLayout.LayoutParams elp = U.lp(U.WRAP, U.WRAP);
        elp.setMargins(U.dp(4), 0, U.dp(4), 0);
        toolbar.addView(ed, elp);
        toolbar.addView(U.icon(this, "💬", "註解工具", v -> commentMode(true)));
        TextView save = U.icon(this, "💾", d.dirty() ? "儲存（有未儲存的變更）" : "儲存", v -> save(d, null));
        if (d.dirty()) save.setTextColor(U.ACCENT);
        toolbar.addView(save);
        toolbar.addView(U.icon(this, "⋮", "更多", this::moreMenu));

        bottomBar.setVisibility(fullscreen ? View.GONE : View.VISIBLE);
        bottomBar.addView(bottomBtn("書籤", v -> Panels.bookmarks(this)), U.lpw(1));
        bottomBar.addView(bottomBtn("縮圖", v -> Panels.thumbnails(this)), U.lpw(1));
        bottomBar.addView(bottomBtn("註解", v -> Panels.comments(this)), U.lpw(1));
        bottomBar.addView(bottomBtn("表單", v -> Panels.fields(this)), U.lpw(1));
        bottomBar.addView(bottomBtn("圖層", v -> Panels.layers(this)), U.lpw(1));
        bottomBar.addView(bottomBtn("附件", v -> Panels.attachments(this)), U.lpw(1));
        pageBadge.setVisibility(View.VISIBLE);
        onPage(view.page());
    }

    private View bottomBtn(String s, View.OnClickListener l) {
        TextView t = U.text(this, s, 13, U.TEXT);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, U.dp(12), 0, U.dp(12));
        t.setBackground(U.ripple(this));
        t.setOnClickListener(l);
        return t;
    }

    private void moreMenu(View anchor) {
        Doc d = doc();
        if (d == null) return;
        PopupMenu pm = new PopupMenu(this, anchor);
        android.view.Menu m = pm.getMenu();
        String[] items = {"連續捲動", "單頁", "雙頁", "向右旋轉檢視", "全螢幕閱讀", view.night ? "關閉夜間頁面" : "夜間頁面（反白）",
                view.sepia ? "關閉護眼色" : "護眼色", "前往頁面…", "整理頁面", "文件屬性", "另存新檔…", "分享", "列印",
                "顯示檔案", "關閉分頁", "重新開啟上次關閉的分頁", "設定"};
        for (int i = 0; i < items.length; i++) m.add(0, i, i, items[i]);
        m.findItem(15).setEnabled(!App.closed.isEmpty());
        pm.setOnMenuItemClickListener(it -> {
            switch (it.getItemId()) {
                case 0: view.setMode(PdfView.CONT); break;
                case 1: view.setMode(PdfView.SINGLE); break;
                case 2: view.setMode(PdfView.TWO); break;
                case 3: view.rotateView(1); break;
                case 4: setFullscreen(true); break;
                case 5: view.night = !view.night; view.sepia = false; savePageLook(); break;
                case 6: view.sepia = !view.sepia; view.night = false; savePageLook(); break;
                case 7: askPage(); break;
                case 8: Organizer.show(this); break;
                case 9: Panels.properties(this); break;
                case 10: saveAs(d, null); break;
                case 11: share(d); break;
                case 12: Tools.print(this); break;
                case 13: showFile(d); break;
                case 14: closeTab(cur, null); break;
                case 15: reopenClosed(); break;
                case 16: Tools.settings(this); break;
            }
            return true;
        });
        pm.show();
    }

    private void savePageLook() {
        prefs.edit().putBoolean("night", view.night).putBoolean("sepia", view.sepia).apply();
        view.invalidate();
    }

    public void setFullscreen(boolean on) {
        fullscreen = on;
        tabScroll.setVisibility(on ? View.GONE : View.VISIBLE);
        toolbar.setVisibility(on ? View.GONE : View.VISIBLE);
        bottomBar.setVisibility(on || doc() == null ? View.GONE : View.VISIBLE);
        pageBadge.setVisibility(on ? View.GONE : (doc() == null ? View.GONE : View.VISIBLE));
        View dv = getWindow().getDecorView();
        if (on) {
            dv.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            U.toast(this, "無干擾閱讀：點一下空白處或按返回鍵離開");
        } else applyTheme();
    }

    // ------------------------------------------------------------------ 開啟

    public void pickPdf() {
        Activities.pick(this, new String[]{"application/pdf"}, true, uris -> { for (Uri u : uris) openUri(u, true); });
    }

    public void openUri(Uri u, boolean persist) {
        if (persist) {
            try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
            catch (Exception e) {
                try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) {}
            }
        }
        for (int i = 0; i < App.docs.size(); i++) if (u.equals(App.docs.get(i).uri)) { select(i); return; }
        openUri(u, null);
    }

    private void openUri(Uri u, String pwd) {
        U.run(this, "正在開啟…", () -> {
            try { return Doc.open(this, u, pwd); }
            catch (Doc.NeedPassword e) { return e; }
        }, r -> {
            if (r instanceof Doc.NeedPassword) {
                boolean wrong = ((Doc.NeedPassword) r).wrong;
                U.input(this, wrong ? "密碼不正確，請再試一次" : "這份文件受密碼保護", "輸入開啟密碼或擁有者密碼", "",
                        InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, p -> openUri(u, p));
                return;
            }
            Doc d = (Doc) r;
            addDoc(d);
            remember(d);
        });
    }

    public void addDoc(Doc d) {
        App.docs.add(d);
        select(App.docs.size() - 1);
    }

    /** 檔案（合併結果等）開成新分頁。 */
    public void openFile(File f, String name) {
        U.run(this, "正在開啟…", () -> Doc.openFile(this, f, name), d -> { f.delete(); addDoc(d); });
    }

    private void remember(Doc d) {
        if (d.uri == null) return;
        try {
            JSONArray a = new JSONArray(prefs.getString("recent", "[]"));
            JSONArray b = new JSONArray();
            b.put(new JSONObject().put("uri", d.uri.toString()).put("name", d.name).put("pages", d.n)
                    .put("size", d.origSize).put("time", System.currentTimeMillis()));
            for (int i = 0; i < a.length() && b.length() < 15; i++)
                if (!a.getJSONObject(i).getString("uri").equals(d.uri.toString())) b.put(a.getJSONObject(i));
            prefs.edit().putString("recent", b.toString()).apply();
        } catch (Exception ignored) {}
    }

    public void forget(String uri) {
        try {
            JSONArray a = new JSONArray(prefs.getString("recent", "[]")), b = new JSONArray();
            for (int i = 0; i < a.length(); i++) if (!a.getJSONObject(i).getString("uri").equals(uri)) b.put(a.getJSONObject(i));
            prefs.edit().putString("recent", b.toString()).apply();
        } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------------ 編輯

    /** 套用一個編輯（背景執行），完成後更新畫面。 */
    public void edit(String label, int kind, Doc.Op op) { edit(label, kind, op, null); }

    public void edit(String label, int kind, Doc.Op op, Runnable after) {
        Doc d = doc();
        if (d == null) { U.toast(this, "請先開啟文件"); return; }
        String b = d.block(kind);
        if (b != null) { blocked(d, b); return; }
        U.run(this, label + "…", () -> { d.apply(label, kind, op); return true; }, r -> {
            changed(d);
            if (after != null) after.run();
        });
    }

    public void blocked(Doc d, String msg) {
        AlertDialog.Builder b = U.dlg(this).setTitle("無法編輯").setMessage(msg).setPositiveButton("確定", null);
        if (d.encrypted && !d.owner) b.setNeutralButton("輸入擁有者密碼", (x, w) -> Panels.unlock(this, d));
        b.show();
    }

    /** 文件內容改變後（編輯、撤銷、重做）。 */
    public void changed(Doc d) {
        if (d != doc()) { refreshTabs(); return; }
        view.reset();
        if (searchBar.getVisibility() == View.VISIBLE && searchEdit != null) runSearch(searchEdit.getText().toString());
        refreshTabs();
        refreshBars();
        Organizer.refresh();
    }

    public void undo() {
        Doc d = doc();
        if (d == null || d.undoLabel() == null) return;
        String l = d.undoLabel();
        U.run(this, null, d::undo, r -> { changed(d); U.toast(this, "已復原：" + l); });
    }

    public void redo() {
        Doc d = doc();
        if (d == null || d.redoLabel() == null) return;
        String l = d.redoLabel();
        U.run(this, null, d::redo, r -> { changed(d); U.toast(this, "已重做：" + l); });
    }

    // ------------------------------------------------------------------ 儲存與關閉

    /** 加密文件儲存前確認密碼。 */
    private void ensureEnc(Doc d, Runnable next) {
        if (!d.encrypted || (d.encOut != null && d.encOut.user != null && d.encOut.owner != null)) { next.run(); return; }
        LinearLayout l = U.vbox(this);
        l.setPadding(U.dp(20), U.dp(8), U.dp(20), 0);
        l.addView(U.text(this, "這份文件原本有加密。儲存時會用 AES-256 重新加密，請確認密碼：", 14, U.SUB));
        EditText user = U.edit(this, "開啟密碼（留白＝不需密碼即可開啟）", d.encOut == null ? "" : d.encOut.user);
        EditText owner = U.edit(this, "擁有者密碼（變更權限用）", d.encOut == null ? "" : d.encOut.owner);
        user.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        owner.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        l.addView(user);
        l.addView(owner);
        AlertDialog.Builder b = U.dlg(this).setTitle("保持加密").setView(l)
                .setPositiveButton("加密並儲存", (x, w) -> {
                    String u = user.getText().toString(), o = owner.getText().toString();
                    if (o.isEmpty()) o = u.isEmpty() ? Long.toHexString(Double.doubleToLongBits(Math.random())) : u;
                    int perms = d.perm != null ? d.perm.getPermissionBytes() : -4;
                    d.encOut = new Doc.Enc(u, o, perms);
                    next.run();
                })
                .setNegativeButton("取消", null);
        if (d.owner) b.setNeutralButton("不加密儲存", (x, w) -> { d.encOut = null; d.encrypted = false; next.run(); });
        b.show();
    }

    public void save(Doc d, Runnable after) {
        if (d.broken) { U.alert(this, "無法儲存", "這份文件以唯讀模式開啟。可以用「另存新檔」存一份副本。"); return; }
        if (!d.writable || d.uri == null) { saveAs(d, after); return; }
        ensureEnc(d, () -> U.run(this, "正在儲存…", () -> { d.saveTo(this, d.uri); return true; }, r -> {
            U.toast(this, "已儲存");
            refreshTabs(); refreshBars();
            remember(d);
            if (after != null) after.run();
        }));
    }

    public void saveAs(Doc d, Runnable after) {
        ensureEnc(d, () -> Activities.create(this, d.name.toLowerCase().endsWith(".pdf") ? d.name : d.name + ".pdf", "application/pdf", u -> {
            try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
            catch (Exception ignored) {}
            U.run(this, "正在儲存…", () -> { d.saveTo(this, u); return true; }, r -> {
                d.uri = u;
                d.name = U.nameOf(this, u);
                d.writable = Doc.canWrite(this, u);
                U.toast(this, "已儲存為「" + d.name + "」");
                refreshTabs(); refreshBars();
                remember(d);
                if (after != null) after.run();
            });
        }));
    }

    public void closeTab(int idx, Runnable after) {
        if (idx < 0 || idx >= App.docs.size()) return;
        Doc d = App.docs.get(idx);
        Runnable close = () -> {
            int i = App.docs.indexOf(d);
            if (i < 0) return;
            App.docs.remove(i);
            if (d.uri != null) App.closed.add(new String[]{d.uri.toString(), d.name});
            U.bg.execute(d::discard);
            int nc = cur;
            if (i < cur) nc = cur - 1;
            else if (i == cur) nc = Math.min(i, App.docs.size() - 1);
            select(nc);
            if (after != null) after.run();
        };
        if (!d.dirty()) { close.run(); return; }
        U.dlg(this).setTitle("要儲存「" + d.name + "」的變更嗎？")
                .setMessage("如果不儲存，這些變更會遺失。")
                .setPositiveButton("儲存", (x, w) -> save(d, close))
                .setNegativeButton("不儲存", (x, w) -> close.run())
                .setNeutralButton("取消", null).show();
    }

    private void closeOthers(Doc keep) {
        for (Doc d : new ArrayList<>(App.docs)) {
            if (d == keep) continue;
            if (d.dirty()) { U.toast(this, "「" + d.name + "」有未儲存的變更，已保留"); continue; }
            App.docs.remove(d);
            if (d.uri != null) App.closed.add(new String[]{d.uri.toString(), d.name});
            U.bg.execute(d::discard);
        }
        select(App.docs.indexOf(keep));
    }

    public void reopenClosed() {
        if (App.closed.isEmpty()) { U.toast(this, "沒有最近關閉的分頁"); return; }
        String[] last = App.closed.remove(App.closed.size() - 1);
        openUri(Uri.parse(last[0]), null);
    }

    public void showFile(Doc d) {
        StringBuilder sb = new StringBuilder();
        sb.append("名稱：").append(d.name).append("\n");
        sb.append("位置：").append(d.uri == null ? "（尚未儲存）" : Uri.decode(d.uri.toString())).append("\n");
        sb.append("頁數：").append(d.n).append("\n");
        sb.append("原始大小：").append(U.size(d.origSize)).append("\n");
        sb.append("可直接寫回原檔：").append(d.writable ? "是" : "否（儲存時會另存新檔）");
        AlertDialog.Builder b = U.dlg(this).setTitle("檔案").setMessage(sb).setPositiveButton("確定", null)
                .setNeutralButton("分享", (x, w) -> share(d));
        if (d.uri != null) b.setNegativeButton("用其他 App 開啟", (x, w) -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(d.uri, "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(i, "開啟"));
            } catch (Exception e) { U.toast(this, "沒有可以開啟的 App"); }
        });
        b.show();
    }

    public void share(Doc d) {
        ensureEnc(d, () -> U.run(this, "準備分享…", () -> {
            File f = new File(FileProv.dir(this), U.safeName(d.name.toLowerCase().endsWith(".pdf") ? d.name : d.name + ".pdf"));
            d.saveToFile(f);
            return f;
        }, f -> shareFile(f, "application/pdf")));
    }

    public void shareFile(File f, String mime) {
        Intent i = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, FileProv.uri(f))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(i, "分享"));
    }

    @Override
    public void onBackPressed() {
        if (fullscreen) { setFullscreen(false); return; }
        if (exitModes()) return;
        if (cur >= 0) { select(-1); return; }
        super.onBackPressed();
    }

    // ------------------------------------------------------------------ 頁碼

    @Override
    public void onPage(int p) {
        Doc d = doc();
        if (d == null) return;
        String lbl = d.label(p);
        pageBadge.setText((lbl != null ? lbl + "（" + (p + 1) + " / " + d.n + "）" : (p + 1) + " / " + d.n));
    }

    public void askPage() {
        Doc d = doc();
        if (d == null) return;
        U.input(this, "前往頁面", "頁碼（1–" + d.n + "）或頁面標籤", "", s -> {
            s = s.trim();
            if (d.labels != null) for (int i = 0; i < d.labels.length; i++) if (s.equalsIgnoreCase(d.labels[i])) { view.goTo(i); return; }
            try { view.goTo(Integer.parseInt(s) - 1); } catch (NumberFormatException e) { U.toast(this, "找不到這一頁"); }
        });
    }

    public void goTo(int p) { view.goTo(p); }

    // ------------------------------------------------------------------ 點擊

    @Override
    public void onEmptyTap() {
        if (fullscreen) setFullscreen(false);
    }

    @Override
    public void onTap(int page, float x, float y) {
        Doc d = doc();
        if (d == null) return;
        if (mode != null) { mode.tap(page, x, y); return; }
        // 連結、表單欄位、註解
        if (page < d.annots.size()) {
            List<Doc.Annot> list = d.annots.get(page);
            for (int i = list.size() - 1; i >= 0; i--) {
                Doc.Annot a = list.get(i);
                if (a.hidden || a.r == null) continue;
                RectF r = new RectF(a.r);
                r.inset(-4, -4);
                if (!r.contains(x, y)) continue;
                if ("Link".equals(a.sub)) {
                    if (a.uri != null) {
                        U.confirm(this, "開啟連結", a.uri, "開啟", () -> {
                            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(a.uri))); } catch (Exception e) { U.toast(this, "無法開啟"); }
                        });
                    } else if (a.dest >= 0) view.goTo(a.dest);
                    return;
                }
                if (a.field != null) { Panels.editField(this, a.field); return; }
                Panels.commentAt(this, page, a.index);
                return;
            }
        }
        if (fullscreen) setFullscreen(false);
    }

    // ------------------------------------------------------------------ 選取文字

    @Override
    public void onSelection(int page, int a, int b) {
        if (mode != null && mode.selection(page)) return;
        showSelBar();
    }

    private void showSelBar() {
        Doc d = doc();
        selBar.removeAllViews();
        selBar.setVisibility(View.VISIBLE);
        selBar.addView(selBtn("複製", v -> {
            if (!d.canCopy()) { U.alert(this, "無法複製", "作者不允許複製這份文件的內容。"); return; }
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("PDF", view.selectedText()));
            U.toast(this, "已複製");
            clearSel();
        }));
        selBar.addView(selBtn("改文字", v -> {
            int p = view.selPage, sa = Math.min(view.selA, view.selB), sb = Math.max(view.selA, view.selB);
            selBar.setVisibility(View.GONE);
            Editing.editRange(this, d, p, d.text(p), sa, sb);
        }));
        selBar.addView(selBtn("螢光", v -> markup(PDAnnotationTextMarkup.SUB_TYPE_HIGHLIGHT, color("hl", 0xFFFFD400), null)));
        selBar.addView(selBtn("底線", v -> markup(PDAnnotationTextMarkup.SUB_TYPE_UNDERLINE, color("ul", 0xFF1E63E9), null)));
        selBar.addView(selBtn("刪除線", v -> markup(PDAnnotationTextMarkup.SUB_TYPE_STRIKEOUT, color("so", 0xFFE53935), null)));
        selBar.addView(selBtn("加註解", v -> U.input(this, "註解", "寫下你的意見", "", s ->
                markup(PDAnnotationTextMarkup.SUB_TYPE_HIGHLIGHT, color("hl", 0xFFFFD400), s))));
        selBar.addView(selBtn("塗銷", v -> {
            int p = view.selPage;
            List<RectF> rs = view.selectedRects();
            clearSel();
            edit("標記塗銷", Doc.K_EDIT, x -> { for (RectF r : rs) Ops.addRedact(x, d, p, r); });
        }));
        selBar.addView(selBtn("搜尋", v -> { String s = view.selectedText(); clearSel(); openSearch(); searchEdit.setText(s); }));
        selBar.addView(selBtn("分享", v -> {
            if (!d.canCopy()) { U.alert(this, "無法分享", "作者不允許複製這份文件的內容。"); return; }
            startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, view.selectedText()), "分享文字"));
        }));
        selBar.addView(selBtn("整頁", v -> view.selectAllOnPage(view.selPage)));
        selBar.addView(selBtn("✕", v -> clearSel()));
    }

    private TextView selBtn(String s, View.OnClickListener l) {
        TextView t = U.text(this, s, 14, U.TEXT);
        t.setPadding(U.dp(12), U.dp(10), U.dp(12), U.dp(10));
        t.setOnClickListener(l);
        t.setBackground(U.ripple(this));
        return t;
    }

    private void clearSel() {
        view.clearSelection();
        selBar.setVisibility(View.GONE);
    }

    private void markup(String sub, int color, String note) {
        Doc d = doc();
        int p = view.selPage;
        List<RectF> rs = view.selectedRects();
        String text = view.selectedText();
        clearSel();
        edit(sub.equals(PDAnnotationTextMarkup.SUB_TYPE_HIGHLIGHT) ? "螢光標示" : sub.equals(PDAnnotationTextMarkup.SUB_TYPE_UNDERLINE) ? "加底線"
                        : sub.equals(PDAnnotationTextMarkup.SUB_TYPE_STRIKEOUT) ? "加刪除線" : "波浪底線", Doc.K_ANNOT,
                x -> Ops.addMarkup(x, d, p, rs, sub, color, text, note));
    }

    public int color(String key, int def) { return prefs.getInt("color_" + key, def); }

    // ------------------------------------------------------------------ 搜尋

    private int searchGen;
    private final List<Object[]> results = new ArrayList<>();   // {page, RectF, List<RectF>}
    private int resultIdx = -1;

    public void openSearch() {
        if (doc() == null) return;
        exitModes();
        toolbar.setVisibility(View.GONE);
        searchBar.removeAllViews();
        searchBar.setVisibility(View.VISIBLE);
        searchBar.setPadding(U.dp(8), 0, U.dp(2), 0);
        searchEdit = U.edit(this, "搜尋（逗號分隔多個詞）", "");
        searchEdit.setSingleLine(true);
        searchEdit.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        searchEdit.setBackground(null);
        searchBar.addView(searchEdit, U.lpw(1));
        searchCount = U.text(this, "", 13, U.SUB);
        searchBar.addView(searchCount);
        searchBar.addView(U.icon(this, "▲", "上一個", v -> stepResult(-1)));
        searchBar.addView(U.icon(this, "▼", "下一個", v -> stepResult(1)));
        searchBar.addView(U.icon(this, "✕", "關閉搜尋", v -> closeSearch()));
        searchEdit.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable e) {
                U.main.removeCallbacks(searchTask);
                U.main.postDelayed(searchTask, 300);
            }
        });
        searchEdit.setOnEditorActionListener((v, a, e) -> { stepResult(1); return true; });
        searchEdit.requestFocus();
        ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(searchEdit, 0);
    }

    private final Runnable searchTask = () -> { if (searchEdit != null) runSearch(searchEdit.getText().toString()); };

    private void runSearch(String q) {
        final Doc d = doc();
        final int g = ++searchGen;
        results.clear();
        resultIdx = -1;
        view.hits = new HashMap<>();
        view.hitCur = null;
        view.invalidate();
        final List<String> terms = new ArrayList<>();
        for (String t : q.replace('，', ',').split(",")) if (!t.trim().isEmpty()) terms.add(t.trim());
        if (terms.isEmpty() || d == null) { searchCount.setText(""); return; }
        searchCount.setText("搜尋中…");
        final int start = view.page();
        new Thread(() -> {
            for (int k = 0; k < d.n; k++) {
                if (g != searchGen) return;
                int p = (start + k) % d.n;
                TextData.Page tp = d.text(p);
                List<Object[]> found = new ArrayList<>();
                for (String t : terms)
                    for (int[] m : tp.find(t)) {
                        List<RectF> rs = tp.rects(m[0], m[1] - 1);
                        if (rs.isEmpty()) continue;
                        RectF u = new RectF(rs.get(0));
                        for (RectF r : rs) u.union(r);
                        found.add(new Object[]{p, u, rs, m[0]});
                    }
                found.sort((x, y) -> Integer.compare((int) x[3], (int) y[3]));
                final int fp = p, done = k + 1;
                U.main.post(() -> {
                    if (g != searchGen) return;
                    List<RectF> all = new ArrayList<>();
                    for (Object[] f : found) all.addAll((List<RectF>) f[2]);
                    if (!all.isEmpty()) view.hits.put(fp, all);
                    results.addAll(found);
                    results.sort((x, y) -> {
                        int c = Integer.compare((int) x[0], (int) y[0]);
                        return c != 0 ? c : Integer.compare((int) x[3], (int) y[3]);
                    });
                    if (resultIdx < 0 && !results.isEmpty()) {
                        resultIdx = 0;
                        for (int i = 0; i < results.size(); i++) if ((int) results.get(i)[0] >= start) { resultIdx = i; break; }
                        showResult();
                    } else if (resultIdx >= 0 && view.hitCur != null) {
                        for (int i = 0; i < results.size(); i++) if (results.get(i)[1] == view.hitCur) resultIdx = i;
                    }
                    String prog = done < d.n ? "（" + done + "/" + d.n + " 頁）" : "";
                    searchCount.setText(results.isEmpty() ? (done < d.n ? "搜尋中" + prog : "找不到") : "符合 " + (resultIdx + 1) + "/" + results.size() + prog);
                    view.invalidate();
                });
            }
        }).start();
    }

    private void stepResult(int dir) {
        if (results.isEmpty()) return;
        resultIdx = ((resultIdx + dir) % results.size() + results.size()) % results.size();
        showResult();
        searchCount.setText("符合 " + (resultIdx + 1) + "/" + results.size());
    }

    private void showResult() {
        Object[] r = results.get(resultIdx);
        view.hitPage = (int) r[0];
        view.hitCur = (RectF) r[1];
        view.goTo((int) r[0], (RectF) r[1]);
    }

    private void closeSearch() {
        searchGen++;
        searchBar.setVisibility(View.GONE);
        toolbar.setVisibility(View.VISIBLE);
        view.hits = new HashMap<>();
        view.hitCur = null;
        view.invalidate();
        if (searchEdit != null) ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(searchEdit.getWindowToken(), 0);
    }

    /** 給塗銷用：目前的搜尋結果。 */
    public List<Object[]> searchResults() { return results; }

    // ------------------------------------------------------------------ 工具模式

    /** 工具模式：處理頁面上的點、框、線、選取。 */
    public abstract static class Mode {
        public void tap(int page, float x, float y) {}
        public void rect(int page, RectF r) {}
        public void line(int page, float x1, float y1, float x2, float y2) {}
        public boolean selection(int page) { return false; }
        public void ink() {}
        public void exit() {}
    }

    public Mode mode;

    public void setMode(Mode m, int tool, String hint, String[] btns, Runnable[] acts) {
        exitModes();
        if (doc() == null) return;
        mode = m;
        view.tool = tool;
        view.selectable = true;
        showHint(hint, btns, acts);
    }

    public void showHint(String hint, String[] btns, Runnable[] acts) {
        hintBar.removeAllViews();
        hintText = U.text(this, hint, 14, U.TEXT);
        hintBar.addView(hintText, U.lpw(1));
        if (btns != null) for (int i = 0; i < btns.length; i++) {
            final Runnable r = acts[i];
            hintBar.addView(U.flat(this, btns[i], v -> r.run()));
        }
        hintBar.addView(U.flat(this, mode != null ? "完成" : "✕", v -> { if (mode != null) exitModes(); else hintBar.setVisibility(View.GONE); }));
        hintBar.setVisibility(View.VISIBLE);
    }

    public void setHint(String s) { if (hintText != null) hintText.setText(s); }

    public boolean exitModes() {
        boolean had = mode != null || annotScroll.getVisibility() == View.VISIBLE || selBar.getVisibility() == View.VISIBLE
                || searchBar.getVisibility() == View.VISIBLE;
        if (mode != null) { Mode m = mode; mode = null; m.exit(); }
        view.tool = PdfView.T_NONE;
        view.measure = null;
        if (view.inkPage >= 0) view.takeInk();
        hintBar.setVisibility(View.GONE);
        annotScroll.setVisibility(View.GONE);
        if (selBar.getVisibility() == View.VISIBLE) clearSel();
        if (searchBar.getVisibility() == View.VISIBLE) closeSearch();
        view.invalidate();
        return had;
    }

    @Override
    public void onRect(int page, RectF r) { if (mode != null) mode.rect(page, r); }

    @Override
    public void onLine(int page, float x1, float y1, float x2, float y2) { if (mode != null) mode.line(page, x1, y1, x2, y2); }

    @Override
    public void onInkChanged() { if (mode != null) mode.ink(); }

    /** 註解工具列。 */
    public void commentMode(boolean show) {
        if (doc() == null) return;
        Comments.show(this, annotBar, annotScroll);
    }

    /** 編輯工具列（編輯文字、新增文字…）。 */
    public void editMode() { if (doc() != null) Editing.show(this, annotBar); }

    public void showAnnotBar(boolean on) { annotScroll.setVisibility(on ? View.VISIBLE : View.GONE); }

    // ------------------------------------------------------------------ Activity 結果

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        Activities.result(this, req, res, data);
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (e.isCtrlPressed()) {
            switch (code) {
                case KeyEvent.KEYCODE_Z: if (e.isShiftPressed()) redo(); else undo(); return true;
                case KeyEvent.KEYCODE_Y: redo(); return true;
                case KeyEvent.KEYCODE_F: openSearch(); return true;
                case KeyEvent.KEYCODE_K: Tools.palette(this); return true;
                case KeyEvent.KEYCODE_S: if (doc() != null) save(doc(), null); return true;
                case KeyEvent.KEYCODE_O: pickPdf(); return true;
                case KeyEvent.KEYCODE_G: stepResult(e.isShiftPressed() ? -1 : 1); return true;
                case KeyEvent.KEYCODE_W: if (doc() != null) closeTab(cur, null); return true;
            }
        }
        return super.onKeyDown(code, e);
    }
}
