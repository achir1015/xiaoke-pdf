package com.achir.xiaokepdf;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** QR Code 產生器（位元組模式、UTF-8、錯誤更正等級 M、版本 1–40）。 */
public final class QrCode {
    public final int size;
    /** [y][x]，true = 黑。 */
    public final boolean[][] dark;
    private final boolean[][] fn;
    private final int ver;

    private static final int[] ECC = {-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
            26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28};
    private static final int[] BLOCKS = {-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
            17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49};

    public static QrCode encode(String text) {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        for (int v = 1; v <= 40; v++) {
            int cap = dataCodewords(v) * 8;
            if (4 + (v <= 9 ? 8 : 16) + b.length * 8 <= cap) return new QrCode(v, b);
        }
        throw new IllegalArgumentException("內容太長，無法做成 QR Code");
    }

    private QrCode(int v, byte[] data) {
        ver = v;
        size = v * 4 + 17;
        dark = new boolean[size][size];
        fn = new boolean[size][size];
        functionPatterns();
        drawCodewords(interleave(dataBits(data)));
        int best = 0, min = Integer.MAX_VALUE;
        for (int m = 0; m < 8; m++) {
            mask(m);
            formatBits(m);
            int p = penalty();
            if (p < min) { min = p; best = m; }
            mask(m);
        }
        mask(best);
        formatBits(best);
    }

    // ---------------------------------------------------------------- 資料

    private static int rawModules(int v) {
        int r = (16 * v + 128) * v + 64;
        if (v >= 2) {
            int n = v / 7 + 2;
            r -= (25 * n - 10) * n - 55;
            if (v >= 7) r -= 36;
        }
        return r;
    }

    private static int dataCodewords(int v) { return rawModules(v) / 8 - ECC[v] * BLOCKS[v]; }

    private byte[] dataBits(byte[] data) {
        int cap = dataCodewords(ver);
        byte[] out = new byte[cap];
        int[] pos = {0};
        put(out, pos, 0b0100, 4);
        put(out, pos, data.length, ver <= 9 ? 8 : 16);
        for (byte x : data) put(out, pos, x & 0xFF, 8);
        put(out, pos, 0, Math.min(4, cap * 8 - pos[0]));
        pos[0] = (pos[0] + 7) / 8 * 8;
        for (int i = pos[0] / 8, k = 0; i < cap; i++, k++) out[i] = (byte) (k % 2 == 0 ? 0xEC : 0x11);
        return out;
    }

    private static void put(byte[] out, int[] pos, int val, int len) {
        for (int i = len - 1; i >= 0; i--, pos[0]++) if (((val >>> i) & 1) != 0) out[pos[0] >>> 3] |= 1 << (7 - (pos[0] & 7));
    }

    private byte[] interleave(byte[] data) {
        int nb = BLOCKS[ver], el = ECC[ver], raw = rawModules(ver) / 8;
        int nShort = nb - raw % nb, shortLen = raw / nb;
        byte[] div = rsDivisor(el);
        byte[][] blocks = new byte[nb][];
        for (int i = 0, k = 0; i < nb; i++) {
            int len = shortLen - el + (i < nShort ? 0 : 1);
            byte[] dat = Arrays.copyOfRange(data, k, k + len);
            k += len;
            byte[] ecc = rsRemainder(dat, div);
            byte[] blk = new byte[shortLen + 1];
            System.arraycopy(dat, 0, blk, 0, len);
            System.arraycopy(ecc, 0, blk, blk.length - el, el);
            blocks[i] = blk;
        }
        byte[] out = new byte[raw];
        int o = 0;
        for (int i = 0; i < shortLen + 1; i++)
            for (int j = 0; j < nb; j++)
                if (i != shortLen - el || j >= nShort) out[o++] = blocks[j][i];
        return out;
    }

    private static byte[] rsDivisor(int deg) {
        byte[] r = new byte[deg];
        r[deg - 1] = 1;
        int root = 1;
        for (int i = 0; i < deg; i++) {
            for (int j = 0; j < deg; j++) {
                r[j] = (byte) mul(r[j] & 0xFF, root);
                if (j + 1 < deg) r[j] ^= r[j + 1];
            }
            root = mul(root, 2);
        }
        return r;
    }

    private static byte[] rsRemainder(byte[] data, byte[] div) {
        byte[] r = new byte[div.length];
        for (byte b : data) {
            int f = (b ^ r[0]) & 0xFF;
            System.arraycopy(r, 1, r, 0, r.length - 1);
            r[r.length - 1] = 0;
            for (int i = 0; i < r.length; i++) r[i] ^= mul(div[i] & 0xFF, f);
        }
        return r;
    }

    private static int mul(int x, int y) {
        int z = 0;
        for (int i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z;
    }

    // ---------------------------------------------------------------- 圖樣

    private void set(int x, int y, boolean d) { dark[y][x] = d; fn[y][x] = true; }

    private void functionPatterns() {
        for (int i = 0; i < size; i++) { set(6, i, i % 2 == 0); set(i, 6, i % 2 == 0); }
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
        int[] al = alignPositions();
        int n = al.length;
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) {
                if (i == 0 && j == 0 || i == 0 && j == n - 1 || i == n - 1 && j == 0) continue;
                for (int dy = -2; dy <= 2; dy++)
                    for (int dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
            }
        formatBits(0);
        if (ver >= 7) {
            int rem = ver;
            for (int i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            int bits = ver << 12 | rem;
            for (int i = 0; i < 18; i++) {
                boolean b = ((bits >>> i) & 1) != 0;
                int a = size - 11 + i % 3, c = i / 3;
                set(a, c, b); set(c, a, b);
            }
        }
    }

    private void finder(int x, int y) {
        for (int dy = -4; dy <= 4; dy++)
            for (int dx = -4; dx <= 4; dx++) {
                int d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
                if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d != 2 && d != 4);
            }
    }

    private int[] alignPositions() {
        if (ver == 1) return new int[0];
        int n = ver / 7 + 2;
        int step = (ver * 8 + n * 3 + 5) / (n * 4 - 4) * 2;
        int[] r = new int[n];
        r[0] = 6;
        for (int i = n - 1, p = size - 7; i >= 1; i--, p -= step) r[i] = p;
        return r;
    }

    /** 錯誤更正等級 M 的格式資訊。 */
    private void formatBits(int m) {
        int data = m;   // M = 00
        int rem = data;
        for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        int bits = (data << 10 | rem) ^ 0x5412;
        for (int i = 0; i <= 5; i++) set(8, i, bit(bits, i));
        set(8, 7, bit(bits, 6));
        set(8, 8, bit(bits, 7));
        set(7, 8, bit(bits, 8));
        for (int i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
        for (int i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
        for (int i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
        set(8, size - 8, true);
    }

    private static boolean bit(int x, int i) { return ((x >>> i) & 1) != 0; }

    private void drawCodewords(byte[] data) {
        int i = 0;
        for (int right = size - 1; right >= 1; right -= 2) {
            if (right == 6) right = 5;
            for (int vert = 0; vert < size; vert++)
                for (int j = 0; j < 2; j++) {
                    int x = right - j;
                    boolean up = ((right + 1) & 2) == 0;
                    int y = up ? size - 1 - vert : vert;
                    if (!fn[y][x] && i < data.length * 8) {
                        dark[y][x] = bit(data[i >>> 3], 7 - (i & 7));
                        i++;
                    }
                }
        }
    }

    private void mask(int m) {
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++) {
                boolean inv;
                switch (m) {
                    case 0: inv = (x + y) % 2 == 0; break;
                    case 1: inv = y % 2 == 0; break;
                    case 2: inv = x % 3 == 0; break;
                    case 3: inv = (x + y) % 3 == 0; break;
                    case 4: inv = (x / 3 + y / 2) % 2 == 0; break;
                    case 5: inv = x * y % 2 + x * y % 3 == 0; break;
                    case 6: inv = (x * y % 2 + x * y % 3) % 2 == 0; break;
                    default: inv = ((x + y) % 2 + x * y % 3) % 2 == 0; break;
                }
                if (inv && !fn[y][x]) dark[y][x] = !dark[y][x];
            }
    }

    /** 選遮罩用的罰分（連續同色、2×2 方塊、類似定位圖樣、黑白比例）。 */
    private int penalty() {
        int p = 0;
        for (int pass = 0; pass < 2; pass++)
            for (int a = 0; a < size; a++) {
                int run = 1;
                for (int b = 1; b < size; b++) {
                    boolean c = pass == 0 ? dark[a][b] : dark[b][a], prev = pass == 0 ? dark[a][b - 1] : dark[b - 1][a];
                    if (c == prev) { run++; if (run == 5) p += 3; else if (run > 5) p++; }
                    else run = 1;
                }
                for (int b = 0; b + 7 <= size; b++) {
                    boolean m = true;
                    for (int k = 0; k < 7 && m; k++) {
                        boolean c = pass == 0 ? dark[a][b + k] : dark[b + k][a];
                        m = c == (k != 1 && k != 5);
                    }
                    if (m && (light(pass, a, b - 4, b) || light(pass, a, b + 7, b + 11))) p += 40;
                }
            }
        int black = 0;
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++) {
                if (dark[y][x]) black++;
                if (x + 1 < size && y + 1 < size && dark[y][x] == dark[y][x + 1] && dark[y][x] == dark[y + 1][x] && dark[y][x] == dark[y + 1][x + 1]) p += 3;
            }
        int total = size * size;
        p += Math.max(0, (Math.abs(black * 20 - total * 10) + total - 1) / total - 1) * 10;
        return p;
    }

    /** 這一段（含超出邊界的部分）都是白的。 */
    private boolean light(int pass, int a, int from, int to) {
        for (int b = from; b < to; b++) {
            if (b < 0 || b >= size) continue;
            if (pass == 0 ? dark[a][b] : dark[b][a]) return false;
        }
        return true;
    }
}
