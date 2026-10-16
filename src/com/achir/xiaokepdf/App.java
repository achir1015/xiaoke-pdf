package com.achir.xiaokepdf;

import android.app.Application;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;

import java.util.ArrayList;
import java.util.List;

/** 開著的文件放在這裡，畫面重建時不會遺失。 */
public class App extends Application {
    public static App I;
    public static final List<Doc> docs = new ArrayList<>();
    /** 最近關閉的分頁（可重新開啟）。 */
    public static final List<String[]> closed = new ArrayList<>();

    @Override
    public void onCreate() {
        super.onCreate();
        I = this;
        U.dens = getResources().getDisplayMetrics().density;
        PDFBoxResourceLoader.init(getApplicationContext());
    }
}
