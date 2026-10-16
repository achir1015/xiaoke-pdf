package com.achir.xiaokepdf;

import com.tom_roush.fontbox.ttf.CmapSubtable;
import com.tom_roush.fontbox.ttf.CmapTable;
import com.tom_roush.fontbox.ttf.TrueTypeFont;
import com.tom_roush.pdfbox.contentstream.operator.Operator;
import com.tom_roush.pdfbox.cos.COSArray;
import com.tom_roush.pdfbox.cos.COSBase;
import com.tom_roush.pdfbox.cos.COSDictionary;
import com.tom_roush.pdfbox.cos.COSName;
import com.tom_roush.pdfbox.cos.COSNumber;
import com.tom_roush.pdfbox.cos.COSObject;
import com.tom_roush.pdfbox.cos.COSStream;
import com.tom_roush.pdfbox.cos.COSString;
import com.tom_roush.pdfbox.pdfparser.PDFStreamParser;
import com.tom_roush.pdfbox.pdfwriter.ContentStreamWriter;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDResources;
import com.tom_roush.pdfbox.pdmodel.common.PDStream;
import com.tom_roush.pdfbox.pdmodel.font.PDCIDFont;
import com.tom_roush.pdfbox.pdmodel.font.PDCIDFontType2;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.font.PDType0Font;
import com.tom_roush.pdfbox.pdmodel.graphics.PDXObject;
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** 移除浮水印，以及修補缺字的 ToUnicode 對照表。 */
public final class Watermark {
    private Watermark() {}

    // ================================================================ ToUnicode 修補

    /**
     * 有些 PDF 的 ToUnicode 對照表不完整，擷取文字時會漏字。
     * 這裡用內嵌 TrueType 字型自己的 cmap 把缺的字補上（只改記憶體中的文件，用於擷取文字）。
     */
    public static void fixToUnicode(PDDocument d) {
        Set<COSBase> seen = new HashSet<>();
        for (PDPage p : d.getPages()) fixRes(d, p.getResources(), seen, 0);
    }

    private static void fixRes(PDDocument d, PDResources r, Set<COSBase> seen, int depth) {
        if (r == null || depth > 6 || !seen.add(r.getCOSObject())) return;
        COSBase fb = r.getCOSObject().getDictionaryObject(COSName.FONT);
        if (fb instanceof COSDictionary) {
            for (COSName n : ((COSDictionary) fb).keySet()) {
                COSBase f = ((COSDictionary) fb).getDictionaryObject(n);
                if (f instanceof COSDictionary && seen.add(f)) {
                    try { fixFont(d, (COSDictionary) f); } catch (Throwable ignored) {}
                }
            }
        }
        try {
            for (COSName n : r.getXObjectNames()) {
                COSBase x = r.getCOSObject().getDictionaryObject(COSName.XOBJECT);
                if (!(x instanceof COSDictionary)) break;
                COSBase s = ((COSDictionary) x).getDictionaryObject(n);
                if (s instanceof COSStream && COSName.FORM.equals(((COSStream) s).getCOSName(COSName.SUBTYPE))) {
                    COSBase fr = ((COSStream) s).getDictionaryObject(COSName.RESOURCES);
                    if (fr instanceof COSDictionary) fixRes(d, new PDResources((COSDictionary) fr), seen, depth + 1);
                }
            }
        } catch (Exception ignored) {}
    }

    private static void fixFont(PDDocument d, COSDictionary fd) throws IOException {
        if (!COSName.TYPE0.equals(fd.getCOSName(COSName.SUBTYPE))) return;
        PDType0Font f = new PDType0Font(fd);
        PDCIDFont cid = f.getDescendantFont();
        // 1) 原本的 bfrange：PDFBox 遇到最後一個位元組進位就停止對應，這裡依 Acrobat 的做法進位
        java.util.Map<Integer, String> ranges = new java.util.HashMap<>();
        COSBase tu = fd.getDictionaryObject(COSName.TO_UNICODE);
        int maxCode = 0;
        if (tu instanceof COSStream) {
            String txt;
            try (InputStream in = ((COSStream) tu).createInputStream()) {
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                U.copy(in, bo);
                txt = new String(bo.toByteArray(), "ISO-8859-1");
            }
            StringBuilder blocks = new StringBuilder();
            java.util.regex.Matcher bm = java.util.regex.Pattern.compile("beginbfrange(.*?)endbfrange", java.util.regex.Pattern.DOTALL).matcher(txt);
            while (bm.find()) blocks.append(bm.group(1)).append('\n');
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("<([0-9A-Fa-f]{1,8})>[ \\t]*<([0-9A-Fa-f]{1,8})>[ \\t]*<([0-9A-Fa-f]{1,16})>").matcher(blocks);
            while (m.find()) {
                int a = Integer.parseInt(m.group(1), 16), b = Integer.parseInt(m.group(2), 16);
                long dst = Long.parseLong(m.group(3), 16);
                if (b < a || b - a > 65535 || m.group(3).length() > 8) continue;
                for (int c = a; c <= b; c++) {
                    long v = dst + (c - a);
                    String u = m.group(3).length() <= 4 ? String.valueOf((char) v)
                            : new String(new char[]{(char) (v >> 16), (char) (v & 0xFFFF)});
                    ranges.put(c, u);
                }
                maxCode = Math.max(maxCode, b);
            }
        }
        // 2) 內嵌 TrueType 字型自己的 cmap
        CmapSubtable sub = null;
        int nGlyphs = 0;
        if (cid instanceof PDCIDFontType2) {
            TrueTypeFont ttf = ((PDCIDFontType2) cid).getTrueTypeFont();
            if (ttf != null) {
                nGlyphs = ttf.getNumberOfGlyphs();
                CmapTable ct = ttf.getCmap();
                if (ct != null) {
                    sub = ct.getSubtable(3, 10);
                    if (sub == null) sub = ct.getSubtable(3, 1);
                    if (sub == null) sub = ct.getSubtable(0, 4);
                    if (sub == null) sub = ct.getSubtable(0, 3);
                }
            }
        }
        if (ranges.isEmpty() && sub == null) return;
        int n = Math.min(Math.max(nGlyphs, maxCode + 1), 65536);
        StringBuilder entries = new StringBuilder();
        int count = 0, added = 0;
        List<String> chunks = new ArrayList<>();
        for (int code = 0; code < n; code++) {
            String u = f.toUnicode(code);
            if (u == null) {
                u = ranges.get(code);
                if (u == null && sub != null) {
                    List<Integer> cs = sub.getCharCodes(cid.codeToGID(code));
                    if (cs != null && !cs.isEmpty()) u = new String(Character.toChars(cs.get(0)));
                }
                if (u == null) continue;
                added++;
            }
            entries.append(String.format(Locale.US, "<%04X> <", code));
            for (char c : u.toCharArray()) entries.append(String.format(Locale.US, "%04X", (int) c));
            entries.append(">\n");
            if (++count == 100) { chunks.add(count + " beginbfchar\n" + entries + "endbfchar\n"); entries.setLength(0); count = 0; }
        }
        if (added == 0) return;
        if (count > 0) chunks.add(count + " beginbfchar\n" + entries + "endbfchar\n");
        StringBuilder cm = new StringBuilder("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
                + "/CIDSystemInfo <</Registry(Adobe)/Ordering(UCS)/Supplement 0>> def\n/CMapName /XiaoKe-UCS def\n/CMapType 2 def\n"
                + "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");
        for (String c : chunks) cm.append(c);
        cm.append("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        COSStream s = d.getDocument().createCOSStream();
        try (OutputStream out = s.createOutputStream()) { out.write(cm.toString().getBytes("US-ASCII")); }
        fd.setItem(COSName.TO_UNICODE, s);
    }

    // ================================================================ 浮水印

    public static class Options {
        public boolean standard = true;     // 標記為 Watermark 的內容、浮水印註解
        public String text;                 // 依文字移除
        public Set<String> layers = new HashSet<>();  // 依圖層移除（圖層名稱）
    }

    public static class Report { public int blocks, annots, pages; }

    public static Report remove(PDDocument d, Options o) throws IOException {
        Report rep = new Report();
        Set<COSBase> doneForms = new HashSet<>();
        for (PDPage p : d.getPages()) {
            int before = rep.blocks + rep.annots;
            PDResources res = p.getResources();
            List<Object> tokens;
            try {
                PDFStreamParser parser = new PDFStreamParser(p);
                parser.parse();
                tokens = parser.getTokens();
            } catch (Exception e) { continue; }
            List<Object> out = filter(d, tokens, res, o, rep, doneForms, 0);
            if (out != null) {
                PDStream ns = new PDStream(d);
                try (OutputStream os = ns.createOutputStream(COSName.FLATE_DECODE)) { new ContentStreamWriter(os).writeTokens(out); }
                p.setContents(ns);
            }
            if (o.standard) {
                List<PDAnnotation> al = p.getAnnotations(), keep = new ArrayList<>();
                for (PDAnnotation a : al) { if ("Watermark".equals(a.getSubtype())) rep.annots++; else keep.add(a); }
                if (keep.size() != al.size()) p.setAnnotations(keep);
            }
            if (rep.blocks + rep.annots > before) rep.pages++;
        }
        if (!o.layers.isEmpty()) removeLayers(d, o.layers);
        return rep;
    }

    /** 回傳新的 token 清單；沒有變動時回傳 null。 */
    private static List<Object> filter(PDDocument d, List<Object> tokens, PDResources res, Options o, Report rep,
                                       Set<COSBase> doneForms, int depth) throws IOException {
        List<Object> out = new ArrayList<>();
        List<Object> operands = new ArrayList<>();
        List<Boolean> mc = new ArrayList<>();   // 標記內容堆疊：true＝這一段要移除
        int removing = 0;                       // 目前有幾層要移除的標記內容
        boolean changed = false;
        List<Object> textBlock = null;          // BT…ET 暫存
        StringBuilder blockText = null;
        PDFont font = null;

        for (Object t : tokens) {
            if (!(t instanceof Operator)) { operands.add(t); continue; }
            Operator op = (Operator) t;
            String name = op.getName();
            List<Object> unit = new ArrayList<>(operands);
            unit.add(op);
            operands.clear();

            if (name.equals("BDC") || name.equals("BMC")) {
                boolean rm = removing > 0 || isWatermarkMark(unit, res, o);
                mc.add(rm);
                if (rm) { if (removing == 0) rep.blocks++; removing++; changed = true; continue; }
            } else if (name.equals("EMC")) {
                boolean rm = !mc.isEmpty() && mc.remove(mc.size() - 1);
                if (rm) { removing--; continue; }
            }
            if (removing > 0) continue;

            // 表單 XObject 裡的浮水印
            if (name.equals("Do") && unit.size() >= 2 && unit.get(0) instanceof COSName && res != null) {
                try {
                    PDXObject x = res.getXObject((COSName) unit.get(0));
                    if (x instanceof PDFormXObject && doneForms.add(x.getCOSObject()) && depth < 6) {
                        PDFormXObject form = (PDFormXObject) x;
                        PDFStreamParser fp = new PDFStreamParser(form);
                        fp.parse();
                        PDResources fr = form.getResources() != null ? form.getResources() : res;
                        List<Object> fo = filter(d, fp.getTokens(), fr, o, rep, doneForms, depth + 1);
                        if (fo != null) {
                            try (OutputStream os = ((COSStream) form.getCOSObject()).createOutputStream(COSName.FLATE_DECODE)) {
                                new ContentStreamWriter(os).writeTokens(fo);
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            if (o.text != null && !o.text.isEmpty()) {
                if (name.equals("BT")) { textBlock = new ArrayList<>(); blockText = new StringBuilder(); }
                if (textBlock != null) {
                    textBlock.addAll(unit);
                    if (name.equals("Tf") && unit.size() >= 3 && unit.get(0) instanceof COSName && res != null) {
                        try { font = res.getFont((COSName) unit.get(0)); } catch (Exception e) { font = null; }
                    } else if (name.equals("Tj") || name.equals("'") || name.equals("\"")) {
                        Object s = unit.get(unit.size() - 2);
                        if (s instanceof COSString) blockText.append(decode(font, (COSString) s));
                    } else if (name.equals("TJ") && unit.get(0) instanceof COSArray) {
                        for (COSBase b : (COSArray) unit.get(0)) if (b instanceof COSString) blockText.append(decode(font, (COSString) b));
                    }
                    if (name.equals("ET")) {
                        if (norm(blockText.toString()).contains(norm(o.text))) { rep.blocks++; changed = true; }
                        else out.addAll(textBlock);
                        textBlock = null;
                    }
                    continue;
                }
            }
            out.addAll(unit);
        }
        if (textBlock != null) out.addAll(textBlock);
        out.addAll(operands);
        return changed ? out : null;
    }

    static String norm(String s) { return s.replaceAll("\\s+", "").toLowerCase(Locale.ROOT); }

    static String decode(PDFont f, COSString s) {
        if (f == null) return s.getString();
        StringBuilder sb = new StringBuilder();
        try (InputStream in = new ByteArrayInputStream(s.getBytes())) {
            while (in.available() > 0) {
                int code = f.readCode(in);
                String u = f.toUnicode(code);
                if (u != null) sb.append(u);
            }
        } catch (Exception ignored) {}
        return sb.toString();
    }

    private static boolean isWatermarkMark(List<Object> unit, PDResources res, Options o) {
        if (unit.size() < 2 || !(unit.get(0) instanceof COSName)) return false;
        COSName tag = (COSName) unit.get(0);
        COSDictionary props = null;
        if (unit.size() >= 3) {
            Object p = unit.get(1);
            if (p instanceof COSDictionary) props = (COSDictionary) p;
            else if (p instanceof COSName && res != null) {
                COSBase pr = res.getCOSObject().getDictionaryObject(COSName.PROPERTIES);
                if (pr instanceof COSDictionary) {
                    COSBase v = ((COSDictionary) pr).getDictionaryObject((COSName) p);
                    if (v instanceof COSDictionary) props = (COSDictionary) v;
                }
            }
        }
        if (o.standard && tag.getName().equals("Artifact") && props != null) {
            String sub = props.getNameAsString(COSName.SUBTYPE);
            if ("Watermark".equals(sub)) return true;
        }
        if (!o.layers.isEmpty() && tag.getName().equals("OC") && props != null) {
            String nm = props.getString(COSName.NAME);
            if (nm != null && o.layers.contains(nm)) return true;
            // 選用內容成員字典（OCMD）
            COSBase ocgs = props.getDictionaryObject(COSName.getPDFName("OCGs"));
            if (ocgs instanceof COSDictionary) {
                String n2 = ((COSDictionary) ocgs).getString(COSName.NAME);
                if (n2 != null && o.layers.contains(n2)) return true;
            }
        }
        return false;
    }

    /** 把圖層從選用內容設定中拿掉（內容已在上面移除）。 */
    private static void removeLayers(PDDocument d, Set<String> names) {
        COSDictionary cat = d.getDocumentCatalog().getCOSObject();
        COSBase ocp = cat.getDictionaryObject(COSName.OCPROPERTIES);
        if (!(ocp instanceof COSDictionary)) return;
        COSBase arr = ((COSDictionary) ocp).getDictionaryObject(COSName.OCGS);
        if (!(arr instanceof COSArray)) return;
        COSArray a = (COSArray) arr;
        Set<COSBase> gone = new HashSet<>();
        for (int i = a.size() - 1; i >= 0; i--) {
            COSBase g = a.getObject(i);
            if (g instanceof COSDictionary && names.contains(((COSDictionary) g).getString(COSName.NAME))) { gone.add(g); a.remove(i); }
        }
        COSBase dd = ((COSDictionary) ocp).getDictionaryObject(COSName.D);
        if (dd instanceof COSDictionary) {
            for (COSName k : new COSName[]{COSName.ON, COSName.OFF, COSName.ORDER}) {
                COSBase x = ((COSDictionary) dd).getDictionaryObject(k);
                if (x instanceof COSArray) {
                    COSArray xa = (COSArray) x;
                    for (int i = xa.size() - 1; i >= 0; i--) if (gone.contains(xa.getObject(i))) xa.remove(i);
                }
            }
        }
    }

    /** 本 App 加的浮水印 / 頁首頁尾，用 Artifact 標記包起來，之後可以乾淨移除。 */
    public static COSDictionary artifact(boolean watermark) {
        COSDictionary p = new COSDictionary();
        p.setName(COSName.TYPE, "Pagination");
        p.setName(COSName.SUBTYPE, watermark ? "Watermark" : "Header");
        return p;
    }
}
