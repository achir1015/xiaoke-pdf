package com.achir.xiaokepdf;

import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.BackgroundColorSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** 逐頁比較兩份文件的文字。 */
public final class Compare {
    private Compare() {}

    public static class Report {
        public CharSequence text;
        public int changedPages, added, removed;
    }

    static List<String> pagesText(File f, String pwd) throws IOException {
        List<String> out = new ArrayList<>();
        try (PDDocument d = PDDocument.load(f, pwd == null ? "" : pwd, Doc.mem())) {
            Watermark.fixToUnicode(d);
            PDFTextStripper s = new PDFTextStripper();
            s.setSortByPosition(true);
            for (int i = 1; i <= d.getNumberOfPages(); i++) {
                s.setStartPage(i);
                s.setEndPage(i);
                out.add(s.getText(d));
            }
        }
        return out;
    }

    static List<String> lines(String s) {
        List<String> l = new ArrayList<>();
        for (String x : s.split("\\r?\\n")) { String t = x.trim(); if (!t.isEmpty()) l.add(t); }
        return l;
    }

    public static Report run(File a, String nameA, File b, String nameB, String pwdB) throws IOException {
        List<String> pa = pagesText(a, null), pb = pagesText(b, pwdB);
        SpannableStringBuilder sb = new SpannableStringBuilder();
        Report r = new Report();
        int n = Math.max(pa.size(), pb.size());
        head(sb, "「" + nameA + "」（" + pa.size() + " 頁） ↔ 「" + nameB + "」（" + pb.size() + " 頁）\n\n");
        for (int i = 0; i < n; i++) {
            List<String> la = i < pa.size() ? lines(pa.get(i)) : new ArrayList<>();
            List<String> lb = i < pb.size() ? lines(pb.get(i)) : new ArrayList<>();
            if (la.equals(lb)) continue;
            r.changedPages++;
            head(sb, "第 " + (i + 1) + " 頁" + (i >= pa.size() ? "（只在新文件）" : i >= pb.size() ? "（只在原文件）" : "") + "\n");
            // 最長共同子序列
            int[][] L = new int[la.size() + 1][lb.size() + 1];
            for (int x = la.size() - 1; x >= 0; x--)
                for (int y = lb.size() - 1; y >= 0; y--)
                    L[x][y] = la.get(x).equals(lb.get(y)) ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
            int x = 0, y = 0, ctx = 0;
            while (x < la.size() || y < lb.size()) {
                if (x < la.size() && y < lb.size() && la.get(x).equals(lb.get(y))) {
                    if (ctx++ < 1) line(sb, "  ", la.get(x), 0, 0xFF888888);
                    x++; y++;
                } else if (y < lb.size() && (x >= la.size() || L[x][y + 1] >= L[x + 1][y])) {
                    line(sb, "＋ ", lb.get(y), 0x3333C060, 0xFF1B7F3A); r.added++; y++; ctx = 0;
                } else {
                    line(sb, "－ ", la.get(x), 0x33E04040, 0xFFB3261E); r.removed++; x++; ctx = 0;
                }
            }
            sb.append("\n");
        }
        if (r.changedPages == 0) sb.append("兩份文件的文字內容完全相同。");
        else sb.insert(0, "共 " + r.changedPages + " 頁有差異：新增 " + r.added + " 行、刪除 " + r.removed + " 行。\n");
        r.text = sb;
        return r;
    }

    private static void head(SpannableStringBuilder sb, String s) {
        int a = sb.length();
        sb.append(s);
        sb.setSpan(new StyleSpan(Typeface.BOLD), a, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    private static void line(SpannableStringBuilder sb, String mark, String s, int bg, int fg) {
        int a = sb.length();
        sb.append(mark).append(s).append("\n");
        if (bg != 0) sb.setSpan(new BackgroundColorSpan(bg), a, sb.length() - 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sb.setSpan(new ForegroundColorSpan(fg), a, sb.length() - 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }
}
