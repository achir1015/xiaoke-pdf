package com.achir.xiaokepdf;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 檢查更新：比對 GitHub 最新 Release，有新版就用 DownloadManager 下載 APK，再開系統安裝畫面。
 * 只在使用者按下「檢查更新」時才連線，這是 App 唯一會用到網路的地方。
 */
final class Updater {
    private Updater() {}

    static final String REPO = "achir1015/xiaoke-pdf";

    static final class Release { String tag, name, body, apkUrl; }

    static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("User-Agent", "XiaoKePdf");
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            U.copy(in, bo);
            return new String(bo.toByteArray(), "UTF-8");
        } finally { c.disconnect(); }
    }

    static void check(final Activity a) {
        U.run(a, "檢查更新中…", () -> {
            JSONObject o = new JSONObject(get("https://api.github.com/repos/" + REPO + "/releases/latest"));
            Release r = new Release();
            r.tag = o.getString("tag_name");
            r.name = o.optString("name", r.tag);
            r.body = o.optString("body", "");
            JSONArray as = o.optJSONArray("assets");
            for (int i = 0; as != null && i < as.length(); i++) {
                JSONObject x = as.getJSONObject(i);
                if (x.optString("name").endsWith(".apk")) r.apkUrl = x.getString("browser_download_url");
            }
            return r;
        }, r -> {
            String cur = version(a);
            if (compare(r.tag, cur) <= 0 || r.apkUrl == null) {
                U.dlg(a).setTitle("已是最新版")
                        .setMessage("目前版本 v" + cur + "\nGitHub 最新版 " + r.tag)
                        .setPositiveButton("好", null).show();
                return;
            }
            U.dlg(a).setTitle("有新版 " + r.tag)
                    .setMessage("目前版本 v" + cur + "\n\n" + r.body.replace("**", "").replace("### ", ""))
                    .setPositiveButton("下載並安裝", (d, w) -> download(a, r))
                    .setNegativeButton("稍後", null).show();
        });
    }

    static String version(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; }
        catch (Exception e) { return "0"; }
    }

    /** "v1.2.0" 與 "1.10" 這類版本號逐段比數字 */
    static int compare(String a, String b) {
        String[] x = a.replaceAll("^[vV]", "").split("[^0-9]+"), y = b.replaceAll("^[vV]", "").split("[^0-9]+");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length && !x[i].isEmpty() ? Integer.parseInt(x[i]) : 0;
            int q = i < y.length && !y[i].isEmpty() ? Integer.parseInt(y[i]) : 0;
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }

    private static void download(final Activity a, Release r) {
        // Android 8+ 要先允許本 App「安裝未知應用程式」
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            U.dlg(a).setTitle("需要安裝權限")
                    .setMessage("請在接下來的畫面開啟「允許來自這個來源的應用程式」，返回後再按一次「檢查更新」。")
                    .setPositiveButton("前往設定", (d, w) -> a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + a.getPackageName()))))
                    .setNegativeButton("取消", null).show();
            return;
        }
        // 有未儲存的變更時提醒（安裝會重新啟動 App，但未儲存的工作仍會在下次開啟時詢問是否恢復）
        final DownloadManager dm = (DownloadManager) a.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return;
        String file = "XiaoKePdf-" + r.tag + ".apk";
        File old = new File(a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), file);
        if (old.exists()) old.delete();
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(r.apkUrl))
                .setTitle("小柯文件PDF助手 " + r.tag)
                .setDescription("下載新版中")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(a, Environment.DIRECTORY_DOWNLOADS, file);
        final long id = dm.enqueue(req);
        U.toast(a, "下載中，完成後會自動開啟安裝畫面");

        final Context app = a.getApplicationContext();
        BroadcastReceiver done = new BroadcastReceiver() {
            public void onReceive(Context c, Intent i) {
                if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                try { app.unregisterReceiver(this); } catch (Exception ignored) {}
                install(app, dm, id);
            }
        };
        IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(done, f, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(done, f);
    }

    private static void install(Context c, DownloadManager dm, long id) {
        int status = -1;
        try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id))) {
            if (cur != null && cur.moveToFirst()) status = cur.getInt(cur.getColumnIndex(DownloadManager.COLUMN_STATUS));
        }
        Uri uri = dm.getUriForDownloadedFile(id);
        if (status != DownloadManager.STATUS_SUCCESSFUL || uri == null) {
            U.toast(c, "下載失敗，請稍後再試");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(i); }
        catch (Exception e) { U.toast(c, "無法開啟安裝畫面：" + e.getMessage()); }
    }
}
