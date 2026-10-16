package com.achir.xiaokepdf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.RectF;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream;
import com.tom_roush.pdfbox.pdmodel.PDResources;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.common.PDStream;
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject;
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory;
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationWidget;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceDictionary;
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceStream;
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.PDSignature;
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.SignatureInterface;
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.SignatureOptions;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDAcroForm;
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField;

import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x509.BasicConstraints;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.KeyUsage;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaCertStore;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.cms.CMSProcessableByteArray;
import org.bouncycastle.cms.CMSSignedData;
import org.bouncycastle.cms.CMSSignedDataGenerator;
import org.bouncycastle.cms.SignerInformation;
import org.bouncycastle.cms.jcajce.JcaSignerInfoGeneratorBuilder;
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import org.bouncycastle.operator.jcajce.JcaDigestCalculatorProviderBuilder;
import org.bouncycastle.util.Store;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Provider;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collection;
import java.util.Date;
import java.util.Enumeration;
import java.util.List;

/** 數位簽章：用 PKCS#12 憑證簽署、驗證簽章、建立自簽憑證。 */
public final class Signer {
    private Signer() {}

    static final Provider BC = new BouncyCastleProvider();

    public static File certDir(Context c) {
        File d = new File(c.getFilesDir(), "certs");
        d.mkdirs();
        return d;
    }

    static KeyStore loadStore(File p12, char[] pwd) throws Exception {
        Exception first = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try (InputStream in = new FileInputStream(p12)) {
                KeyStore ks = attempt == 0 ? KeyStore.getInstance("PKCS12") : KeyStore.getInstance("PKCS12", BC);
                ks.load(in, pwd);
                return ks;
            } catch (Exception e) { if (first == null) first = e; }
        }
        throw new IOException("無法開啟憑證（密碼錯誤或格式不支援）：" + first.getMessage());
    }

    public static String describe(File p12, char[] pwd) throws Exception {
        KeyStore ks = loadStore(p12, pwd);
        for (Enumeration<String> e = ks.aliases(); e.hasMoreElements(); ) {
            String a = e.nextElement();
            if (!ks.isKeyEntry(a)) continue;
            X509Certificate c = (X509Certificate) ks.getCertificate(a);
            return "主體：" + c.getSubjectX500Principal().getName() + "\n簽發者：" + c.getIssuerX500Principal().getName()
                    + "\n有效期限：" + Ops.fmtDate(cal(c.getNotBefore())) + " ～ " + Ops.fmtDate(cal(c.getNotAfter()));
        }
        throw new IOException("憑證裡沒有私鑰");
    }

    static Calendar cal(Date d) { Calendar c = Calendar.getInstance(); c.setTime(d); return c; }

    /** 建立自簽憑證（RSA 2048、SHA-256，十年）。 */
    public static File createSelfSigned(Context ctx, String name, String email, char[] pwd) throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair kp = g.generateKeyPair();
        StringBuilder dn = new StringBuilder("CN=").append(name.replace(",", " ")).append(", O=XiaoKe PDF");
        if (email != null && !email.isEmpty()) dn.append(", E=").append(email.replace(",", " "));
        X500Name x = new X500Name(dn.toString());
        Date from = new Date(System.currentTimeMillis() - 86400000L), to = new Date(System.currentTimeMillis() + 3650L * 86400000L);
        JcaX509v3CertificateBuilder b = new JcaX509v3CertificateBuilder(x, BigInteger.valueOf(System.currentTimeMillis()), from, to, x, kp.getPublic());
        b.addExtension(Extension.keyUsage, true, new KeyUsage(KeyUsage.digitalSignature | KeyUsage.nonRepudiation));
        b.addExtension(Extension.basicConstraints, true, new BasicConstraints(false));
        ContentSigner cs = new JcaContentSignerBuilder("SHA256withRSA").setProvider(BC).build(kp.getPrivate());
        X509Certificate cert = new JcaX509CertificateConverter().setProvider(BC).getCertificate(b.build(cs));
        KeyStore ks = KeyStore.getInstance("PKCS12", BC);
        ks.load(null, null);
        ks.setKeyEntry("xiaoke", kp.getPrivate(), pwd, new Certificate[]{cert});
        File f = new File(certDir(ctx), U.safeName(name) + ".p12");
        try (FileOutputStream out = new FileOutputStream(f)) { ks.store(out, pwd); }
        return f;
    }

    /**
     * 簽署目前的快照，產生新檔（增量寫入，原本的位元組不變）。
     * visible 為 null 表示不可見簽章；否則在該頁該位置放簽名圖。
     */
    public static File sign(Doc doc, File p12, char[] pwd, String reason, String location, int page, RectF visible, Bitmap look) throws Exception {
        KeyStore ks = loadStore(p12, pwd);
        String alias = null;
        for (Enumeration<String> e = ks.aliases(); e.hasMoreElements(); ) { String a = e.nextElement(); if (ks.isKeyEntry(a)) { alias = a; break; } }
        if (alias == null) throw new IOException("憑證裡沒有私鑰");
        final PrivateKey key = (PrivateKey) ks.getKey(alias, pwd);
        final Certificate[] chain = ks.getCertificateChain(alias);
        final X509Certificate cert = (X509Certificate) chain[0];
        cert.checkValidity();

        File out = doc.temp("signed.pdf");
        try (PDDocument d = PDDocument.load(doc.current(), Doc.mem()); FileOutputStream fos = new FileOutputStream(out)) {
            PDSignature sig = new PDSignature();
            sig.setFilter(PDSignature.FILTER_ADOBE_PPKLITE);
            sig.setSubFilter(PDSignature.SUBFILTER_ADBE_PKCS7_DETACHED);
            String cn = cert.getSubjectX500Principal().getName();
            int i = cn.indexOf("CN=");
            if (i >= 0) { cn = cn.substring(i + 3); int j = cn.indexOf(','); if (j > 0) cn = cn.substring(0, j); }
            sig.setName(cn);
            if (reason != null && !reason.isEmpty()) sig.setReason(reason);
            if (location != null && !location.isEmpty()) sig.setLocation(location);
            sig.setSignDate(Calendar.getInstance());
            SignatureInterface si = content -> {
                try {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    U.copy(content, bo);
                    String alg = key.getAlgorithm().equals("EC") ? "SHA256withECDSA" : "SHA256withRSA";
                    CMSSignedDataGenerator gen = new CMSSignedDataGenerator();
                    ContentSigner cs = new JcaContentSignerBuilder(alg).setProvider(BC).build(key);
                    gen.addSignerInfoGenerator(new JcaSignerInfoGeneratorBuilder(
                            new JcaDigestCalculatorProviderBuilder().setProvider(BC).build()).build(cs, cert));
                    gen.addCertificates(new JcaCertStore(Arrays.asList(chain)));
                    CMSSignedData sd = gen.generate(new CMSProcessableByteArray(bo.toByteArray()), false);
                    return sd.getEncoded();
                } catch (Exception e) {
                    throw new IOException(e);
                }
            };
            SignatureOptions opt = null;
            try {
                if (visible != null) {
                    opt = new SignatureOptions();
                    opt.setVisualSignature(template(d, doc, page, visible, look));
                    opt.setPage(page);
                }
                opt = opt == null ? new SignatureOptions() : opt;
                opt.setPreferredSignatureSize(SignatureOptions.DEFAULT_SIGNATURE_SIZE * 2);
                d.addSignature(sig, si, opt);
                d.saveIncremental(fos);
            } finally {
                if (opt != null) opt.close();
            }
        }
        return out;
    }

    /** 可見簽章的外觀範本（一頁、一個簽章欄位）。 */
    private static InputStream template(PDDocument src, Doc doc, int page, RectF disp, Bitmap look) throws IOException {
        try (PDDocument t = new PDDocument()) {
            PDPage sp = src.getPage(page);
            PDPage p = new PDPage(sp.getMediaBox());
            p.setRotation(sp.getRotation());
            p.setCropBox(sp.getCropBox());
            t.addPage(p);
            PDAcroForm af = new PDAcroForm(t);
            t.getDocumentCatalog().setAcroForm(af);
            PDSignatureField f = new PDSignatureField(af);
            PDAnnotationWidget w = f.getWidgets().get(0);
            af.setSignaturesExist(true);
            af.setAppendOnly(true);
            af.getCOSObject().setDirect(true);
            af.getFields().add(f);
            PDRectangle r = doc.toUserRect(page, disp);
            w.setRectangle(r);
            PDStream stream = new PDStream(t);
            PDFormXObject form = new PDFormXObject(stream);
            form.setResources(new PDResources());
            form.setFormType(1);
            form.setBBox(new PDRectangle(r.getWidth(), r.getHeight()));
            PDAppearanceDictionary ap = new PDAppearanceDictionary();
            ap.getCOSObject().setDirect(true);
            PDAppearanceStream as = new PDAppearanceStream(form.getCOSObject());
            ap.setNormalAppearance(as);
            w.setAppearance(ap);
            PDImageXObject img = LosslessFactory.createFromImage(t, look);
            try (PDPageContentStream cs = new PDPageContentStream(t, as)) {
                cs.transform(Ops.boxMatrix(doc, page, disp, r.getLowerLeftX(), r.getLowerLeftY()));
                cs.drawImage(img, 0, 0, disp.width(), disp.height());
            }
            p.getAnnotations().add(w);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            t.save(bo);
            return new ByteArrayInputStream(bo.toByteArray());
        }
    }

    public static class Result {
        public String name, date, reason, location, signer, status;
        public boolean valid, coversAll;
    }

    /** 驗證目前快照中的每個簽章。 */
    public static List<Result> verify(File f) throws Exception {
        List<Result> out = new ArrayList<>();
        byte[] all;
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) { all = new byte[(int) raf.length()]; raf.readFully(all); }
        try (PDDocument d = PDDocument.load(f, Doc.mem())) {
            for (PDSignature s : d.getSignatureDictionaries()) {
                Result r = new Result();
                r.name = s.getName() == null ? "" : s.getName();
                r.date = s.getSignDate() == null ? "" : Ops.fmtDate(s.getSignDate());
                r.reason = s.getReason() == null ? "" : s.getReason();
                r.location = s.getLocation() == null ? "" : s.getLocation();
                int[] br = s.getByteRange();
                try {
                    byte[] contents = s.getContents(all);
                    byte[] signed = s.getSignedContent(all);
                    CMSSignedData sd = new CMSSignedData(new CMSProcessableByteArray(signed), contents);
                    @SuppressWarnings("unchecked") Store<X509CertificateHolder> certs = sd.getCertificates();
                    boolean ok = !sd.getSignerInfos().getSigners().isEmpty();
                    for (SignerInformation si : sd.getSignerInfos().getSigners()) {
                        @SuppressWarnings("unchecked") Collection<X509CertificateHolder> m = certs.getMatches(si.getSID());
                        if (m.isEmpty()) { ok = false; continue; }
                        X509CertificateHolder h = m.iterator().next();
                        r.signer = h.getSubject().toString();
                        ok &= si.verify(new JcaSimpleSignerInfoVerifierBuilder().setProvider(BC).build(h));
                    }
                    r.valid = ok;
                } catch (Exception e) {
                    r.valid = false;
                    r.status = e.getMessage();
                }
                r.coversAll = br != null && br.length == 4 && (long) br[2] + br[3] == all.length;
                if (r.status == null) r.status = r.valid ? (r.coversAll ? "簽章有效，簽署後文件沒有被修改" : "簽章有效，但簽署後文件又有新的修改")
                        : "簽章無效：內容已被竄改或簽章損壞";
                out.add(r);
            }
        }
        return out;
    }
}
