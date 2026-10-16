package com.achir.xiaokepdf;

import android.graphics.Typeface;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** 首頁：歡迎、推薦工具、開啟檔案、所有工具、最近開啟、隱私說明。 */
public final class Home {
    private Home() {}

    public static View build(MainActivity a) {
        ScrollView sv = new ScrollView(a);
        LinearLayout l = U.vbox(a);
        l.setPadding(U.dp(16), U.dp(14), U.dp(16), U.dp(32));
        sv.addView(l);

        // 歡迎
        LinearLayout hero = U.hbox(a);
        ImageView logo = new ImageView(a);
        logo.setImageResource(R.drawable.ic_launcher);
        hero.addView(logo, U.lp(U.dp(64), U.dp(64)));
        LinearLayout ht = U.vbox(a);
        ht.setPadding(U.dp(12), 0, 0, 0);
        ht.addView(U.bold(a, "歡迎使用小柯文件PDF助手", 21, U.TEXT));
        ht.addView(U.text(a, "在手機上閱讀、註解、填寫、簽署與整理 PDF — 全部在本機完成。", 13.5f, U.SUB));
        hero.addView(ht, U.lpw(1));
        l.addView(hero);

        // 搜尋工具
        TextView search = U.text(a, "⌕  尋找工具與指令", 15, U.SUB);
        search.setBackground(U.round(U.SURFACE, U.LINE, 22));
        search.setPadding(U.dp(16), U.dp(12), U.dp(16), U.dp(12));
        search.setOnClickListener(v -> Tools.palette(a));
        LinearLayout.LayoutParams sp = U.lp(U.MATCH, U.WRAP);
        sp.setMargins(0, U.dp(16), 0, U.dp(4));
        l.addView(search, sp);

        // 推薦工具
        l.addView(head(a, "推薦工具"));
        HorizontalScrollView hs = new HorizontalScrollView(a);
        hs.setHorizontalScrollBarEnabled(false);
        LinearLayout rec = U.hbox(a);
        rec.setGravity(Gravity.TOP);
        hs.addView(rec);
        for (String id : new String[]{"organize", "comment", "form", "edit", "protect", "combine", "fillsign"}) {
            Tools.Tool t = Tools.byId(id);
            rec.addView(card(a, t), U.lp(U.dp(168), U.dp(132)));
        }
        l.addView(hs);

        // 開啟檔案
        LinearLayout open = U.vbox(a);
        open.setGravity(Gravity.CENTER);
        open.setBackground(U.round(U.ACCENT_SOFT, U.ACCENT, 14));
        open.setPadding(0, U.dp(18), 0, U.dp(18));
        TextView oi = U.text(a, "📂", 30, U.ACCENT);
        oi.setGravity(Gravity.CENTER);
        open.addView(oi);
        TextView ot = U.bold(a, "開啟檔案", 16, U.ACCENT);
        ot.setGravity(Gravity.CENTER);
        open.addView(ot);
        open.addView(U.text(a, "也可以從其他 App 分享 PDF 到這裡", 12.5f, U.SUB));
        open.setOnClickListener(v -> a.pickPdf());
        LinearLayout.LayoutParams op = U.lp(U.MATCH, U.WRAP);
        op.setMargins(0, U.dp(14), 0, 0);
        l.addView(open, op);

        // 最近開啟
        try {
            JSONArray r = new JSONArray(a.prefs.getString("recent", "[]"));
            if (r.length() > 0) {
                l.addView(head(a, "最近開啟"));
                LinearLayout box = U.vbox(a);
                box.setBackground(U.round(U.CARD, U.LINE, 14));
                for (int i = 0; i < r.length(); i++) {
                    JSONObject o = r.getJSONObject(i);
                    String uri = o.getString("uri");
                    String sub = o.optInt("pages") + " 頁 · " + U.size(o.optLong("size")) + " · "
                            + new SimpleDateFormat("MM/dd HH:mm", Locale.TAIWAN).format(new Date(o.optLong("time")));
                    LinearLayout row = U.row(a, "📄  " + o.getString("name"), sub, null, v -> a.openUri(Uri.parse(uri), false));
                    row.setOnLongClickListener(v -> {
                        U.confirm(a, "從清單移除", o.optString("name"), "移除", () -> { a.forget(uri); a.select(-1); });
                        return true;
                    });
                    box.addView(row);
                    if (i < r.length() - 1) box.addView(U.divider(a));
                }
                l.addView(box);
            }
        } catch (Exception ignored) {}

        // 所有工具
        l.addView(head(a, "所有工具"));
        LinearLayout grid = U.vbox(a);
        LinearLayout row = null;
        int col = 0;
        for (Tools.Tool t : Tools.all()) {
            if (col % 2 == 0) { row = U.hbox(a); row.setGravity(Gravity.TOP); grid.addView(row); }
            LinearLayout c = U.hbox(a);
            c.setPadding(U.dp(12), U.dp(12), U.dp(8), U.dp(12));
            c.setBackground(U.round(U.CARD, U.LINE, 12));
            TextView ic = U.text(a, t.icon, 18, t.color);
            ic.setGravity(Gravity.CENTER);
            c.addView(ic, U.lp(U.dp(30), U.WRAP));
            LinearLayout tx = U.vbox(a);
            tx.addView(U.text(a, t.name, 14.5f, U.TEXT));
            if (t.status != null) tx.addView(U.text(a, t.status, 11, U.SUB));
            c.addView(tx, U.lpw(1));
            c.setOnClickListener(v -> Tools.run(a, t.id));
            LinearLayout.LayoutParams lp = U.lpw(1);
            lp.setMargins(col % 2 == 0 ? 0 : U.dp(5), U.dp(5), col % 2 == 0 ? U.dp(5) : 0, U.dp(5));
            row.addView(c, lp);
            col++;
        }
        if (col % 2 == 1) row.addView(new View(a), U.lpw(1));
        l.addView(grid);

        // 隱私
        l.addView(head(a, "隱私"));
        l.addView(U.text(a, "文件絕對不會離開你的裝置。不需要帳號、不收集使用資料、沒有雲端處理。"
                + "編輯會先存在 App 私有空間的快照中，可以隨時撤銷；每分鐘自動保存，App 意外結束後下次開啟會詢問是否恢復。", 13, U.SUB));
        TextView upd = U.flat(a, "檢查更新（目前 v" + Updater.version(a) + "）", v -> Updater.check(a));
        upd.setGravity(Gravity.START);
        upd.setPadding(U.dp(2), U.dp(14), 0, U.dp(4));
        l.addView(upd);
        return sv;
    }

    static TextView head(MainActivity a, String s) {
        TextView t = U.bold(a, s, 16, U.TEXT);
        t.setPadding(U.dp(2), U.dp(22), 0, U.dp(8));
        return t;
    }

    static View card(MainActivity a, Tools.Tool t) {
        LinearLayout c = U.vbox(a);
        c.setPadding(U.dp(14), U.dp(12), U.dp(12), U.dp(10));
        c.setBackground(U.round(U.CARD, U.LINE, 14));
        LinearLayout top = U.hbox(a);
        top.addView(U.text(a, t.icon, 18, t.color));
        TextView n = U.bold(a, " " + t.name, 15, U.TEXT);
        top.addView(n);
        c.addView(top);
        TextView d = U.text(a, t.desc, 12, U.SUB);
        d.setMaxLines(2);
        d.setPadding(0, U.dp(6), 0, 0);
        c.addView(d, new LinearLayout.LayoutParams(U.MATCH, 0, 1));
        TextView use = U.text(a, "立即使用", 13, U.ACCENT);
        use.setTypeface(Typeface.DEFAULT_BOLD);
        c.addView(use);
        c.setOnClickListener(v -> Tools.run(a, t.id));
        LinearLayout wrap = new LinearLayout(a);
        wrap.setPadding(0, 0, U.dp(10), 0);
        wrap.addView(c, U.lp(U.MATCH, U.MATCH));
        return wrap;
    }
}
