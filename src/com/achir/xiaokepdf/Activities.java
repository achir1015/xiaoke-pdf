package com.achir.xiaokepdf;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 系統檔案挑選、建立檔案、資料夾、相機。 */
public final class Activities {
    private Activities() {}

    public interface Uris { void got(List<Uri> u); }
    public interface One { void got(Uri u); }

    private static int next = 100;
    private static final Map<Integer, Object> cbs = new HashMap<>();

    private static void start(Activity a, Intent i, Object cb) {
        int code = next++;
        cbs.put(code, cb);
        try { a.startActivityForResult(i, code); }
        catch (ActivityNotFoundException e) { cbs.remove(code); U.toast(a, "找不到可以處理的 App"); }
    }

    public static void pick(Activity a, String[] mimes, boolean multiple, Uris cb) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mimes.length == 1 ? mimes[0] : "*/*");
        if (mimes.length > 1) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        start(a, i, cb);
    }

    public static void create(Activity a, String name, String mime, One cb) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime)
                .putExtra(Intent.EXTRA_TITLE, name);
        start(a, i, cb);
    }

    public static void tree(Activity a, One cb) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        start(a, i, cb);
    }

    /** 拍照，結果寫入 out（透過 FileProv）。 */
    public static void camera(Activity a, File out, Runnable done) {
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        Uri u = FileProv.uri(out);
        i.putExtra(MediaStore.EXTRA_OUTPUT, u);
        i.setClipData(ClipData.newRawUri("photo", u));
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        start(a, i, (One) x -> { if (out.exists() && out.length() > 0) done.run(); else U.toast(a, "沒有拍到照片"); });
    }

    public static void result(Activity a, int req, int res, Intent data) {
        Object cb = cbs.remove(req);
        if (cb == null || res != Activity.RESULT_OK) return;
        if (cb instanceof Uris) {
            List<Uri> l = new ArrayList<>();
            if (data != null && data.getClipData() != null) {
                ClipData c = data.getClipData();
                for (int i = 0; i < c.getItemCount(); i++) l.add(c.getItemAt(i).getUri());
            } else if (data != null && data.getData() != null) l.add(data.getData());
            if (!l.isEmpty()) ((Uris) cb).got(l);
        } else if (cb instanceof One) {
            ((One) cb).got(data == null ? null : data.getData());
        }
    }
}
