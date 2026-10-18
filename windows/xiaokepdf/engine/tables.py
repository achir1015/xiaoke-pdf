"""表格：找框線、找儲存格、撐高列、插入列／欄、合併儲存格、插入表格。

PDF 裡沒有「表格」，只有框線和擺在固定位置的字，所以：
  插入一列＝把那條線以下的東西全部往下搬（跨過邊界的直線被拉長），再補一條橫線；
  合併儲存格＝把合併範圍內部的框線剪掉。
演算法和網頁版 rowgrow.js、Android 版 TableOps.java 相同。
座標參數一律是頁面座標（左上原點、y 往下）。
"""
import re

import pymupdf as fitz

# ---------------------------------------------------------------- 框線與儲存格


def rules(page):
    """頁面上的框線：{'v': [(x, y1, y2)], 'h': [(y, x1, x2)]}。
    描邊的線才算；填色的只有細長矩形（當線畫的框線）才算，文字底色、儲存格底色不算。"""
    v, h = [], []

    def seg(a, b, out_v, out_h):
        if abs(a.x - b.x) < 1.5 and abs(a.y - b.y) > 4:
            out_v.append(((a.x + b.x) / 2, min(a.y, b.y), max(a.y, b.y)))
        elif abs(a.y - b.y) < 1.5 and abs(a.x - b.x) > 4:
            out_h.append(((a.y + b.y) / 2, min(a.x, b.x), max(a.x, b.x)))

    try:
        paths = page.get_drawings()
    except Exception:
        return {"v": v, "h": h}
    for p in paths:
        typ = p.get("type") or ""
        stroke = "s" in typ
        for it in p["items"]:
            if it[0] == "l" and stroke:
                seg(it[1], it[2], v, h)
            elif it[0] == "re":
                r = it[1]
                if r.width < 2.5 and r.height > 4:
                    v.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
                elif r.height < 2.5 and r.width > 4:
                    h.append(((r.y0 + r.y1) / 2, r.x0, r.x1))
                elif stroke:
                    tl, tr, br, bl = r.tl, r.tr, r.br, r.bl
                    for a, b in ((tl, tr), (tr, br), (br, bl), (bl, tl)):
                        seg(a, b, v, h)
            elif it[0] == "qu" and stroke:
                q = it[1]
                for a, b in ((q.ul, q.ur), (q.ur, q.lr), (q.lr, q.ll), (q.ll, q.ul)):
                    seg(a, b, v, h)
    return {"v": v, "h": h}


def cell_at(ru, x, y):
    """點 (x, y) 所在的表格儲存格 (x1, y1, x2, y2)；不在表格裡回傳 None。"""
    tol = 1.5
    x1, x2, y1, y2 = -1e9, 1e9, -1e9, 1e9
    for vx, a, b in ru["v"]:
        if a - tol <= y <= b + tol:
            if vx <= x and vx > x1:
                x1 = vx
            if vx >= x and vx < x2:
                x2 = vx
    if x1 == -1e9 or x2 == 1e9:
        return None
    # 橫框線要橫跨整個格子（底線、刪除線之類的短線不算）
    for hy, a, b in ru["h"]:
        if a <= x1 + 2 and b >= x2 - 2:
            if hy <= y and hy > y1:
                y1 = hy
            if hy >= y and hy < y2:
                y2 = hy
    if y1 == -1e9 or y2 == 1e9:
        return None
    return (x1, y1, x2, y2)


def table_at(ru, cell):
    """表格範圍：沿著這一格的左右直框線找上下範圍、沿著上下橫框線找左右範圍。"""
    x1, y1, x2, y2 = cell
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    t = [x1, y1, x2, y2]
    for vx, a, b in ru["v"]:
        if (abs(vx - x1) < 1.5 or abs(vx - x2) < 1.5) and a <= cy <= b:
            t[1] = min(t[1], a)
            t[3] = max(t[3], b)
    for hy, a, b in ru["h"]:
        if (abs(hy - y1) < 1.5 or abs(hy - y2) < 1.5) and a <= cx <= b:
            t[0] = min(t[0], a)
            t[2] = max(t[2], b)
    return tuple(t)


def below_max(chars, ru, split):
    """分隔線 split 以下內容（文字、框線）的最低點；沒有內容時回傳 split。"""
    m = split
    for c in chars:
        if c.c.strip() and c.cy > split:
            m = max(m, c.y1)
    for vx, a, b in ru["v"]:
        if b > split:
            m = max(m, b)
    for hy, a, b in ru["h"]:
        if hy > split:
            m = max(m, hy)
    return m


def below_tables(ru, y):
    """點在既有的表格裡（直框線跨過這個高度）時，改放到那個表格下面。"""
    for _ in range(10):
        ny = y
        for vx, a, b in ru["v"]:
            if a < y - 1 and b > y + 1:
                ny = max(ny, b + 8)
        if ny == y:
            break
        y = ny
    return y


# ---------------------------------------------------------------- 內容串流解析

_WS = b" \t\r\n\f\x00"
_DELIM = b"()<>[]{}/%"
PAINT = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"}
# 畫路徑中間可能夾著的繪圖狀態設定（PyMuPDF 會在 m l 和 S 之間寫線寬、顏色）
STATE = {"w", "J", "j", "M", "d", "ri", "i", "gs", "CS", "cs", "SC", "SCN", "sc", "scn", "G", "g", "RG", "rg", "K", "k"}


def tokenize(s):
    """內容串流（latin1 字串）→ token：(kind, raw, value)"""
    i, n = 0, len(s)
    out = []

    def skip():
        nonlocal i
        while True:
            while i < n and s[i] in " \t\r\n\f\x00":
                i += 1
            if i < n and s[i] == "%":
                while i < n and s[i] not in "\r\n":
                    i += 1
                continue
            break

    def obj():
        nonlocal i
        skip()
        if i >= n:
            return None
        st, c = i, s[i]
        if c == "(":
            depth = 0
            while i < n:
                if s[i] == "\\":
                    i += 2
                    continue
                if s[i] == "(":
                    depth += 1
                elif s[i] == ")":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                i += 1
            return ("str", s[st:i], None)
        if c == "<" and s[i + 1:i + 2] == "<":
            i += 2
            while True:
                skip()
                if s[i:i + 2] == ">>":
                    i += 2
                    break
                if i >= n or obj() is None:
                    break
            return ("dict", s[st:i], None)
        if c == "<":
            e = s.find(">", i)
            i = (n if e < 0 else e) + 1
            return ("hex", s[st:i], None)
        if c == "[":
            i += 1
            while True:
                skip()
                if i < n and s[i] == "]":
                    i += 1
                    break
                if i >= n or obj() is None:
                    break
            return ("arr", s[st:i], None)
        if c == "/":
            i += 1
            while i < n and s[i] not in " \t\r\n\f\x00()<>[]{}/%":
                i += 1
            return ("name", s[st:i], None)
        while i < n and s[i] not in " \t\r\n\f\x00()<>[]{}/%":
            i += 1
        if i == st:
            i += 1
            return ("kw", s[st], None)
        w = s[st:i]
        if re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)", w):
            return ("num", w, float(w))
        return ("op", w, w)

    while True:
        t = obj()
        if t is None:
            break
        out.append(t)
        if t[0] == "op" and t[2] == "ID":
            st = i + 1
            e = st
            while True:
                e = s.find("EI", e)
                if e < 0:
                    e = n
                    break
                if s[e - 1] in _WS.decode() and (e + 2 >= n or s[e + 2] in _WS.decode()):
                    break
                e += 2
            out.append(("data", s[st:e], None))
            i = e
    return out


def _serialize(toks):
    parts = []
    for k, raw, _ in toks:
        if k == "data":
            parts.append("\n" + raw)
        else:
            parts.append(raw + ("\n" if k == "op" else " "))
    return "".join(parts)


def _mul(a, b):
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def _inv(m):
    d = m[0] * m[3] - m[1] * m[2] or 1e-9
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]


def _apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def _vec_in(m, ux, uy):
    k = _inv(m)
    return (k[0] * ux + k[2] * uy, k[1] * ux + k[3] * uy)


def _f(v):
    v = round(v, 3)
    return "0" if abs(v) < 1e-6 else ("%g" % v)


I6 = [1, 0, 0, 1, 0, 0]


def _page_xf(page):
    """PDF 使用者座標 → 頁面座標 的轉換，和反過來。"""
    m = page.transformation_matrix
    fwd = lambda x, y: (fitz.Point(x, y) * m)
    inv = ~m
    back = lambda x, y: (fitz.Point(x, y) * inv)
    return fwd, back


def _content(page):
    doc = page.parent
    page.clean_contents(sanitize=False)
    xrefs = page.get_contents()
    if not xrefs:
        return None, ""
    data = b"".join(doc.xref_stream(x) or b"" for x in xrefs)
    return xrefs, data.decode("latin1")


def _set_content(page, xrefs, s):
    doc = page.parent
    doc.update_stream(xrefs[0], s.encode("latin1"))
    if len(xrefs) > 1:
        for x in xrefs[1:]:
            doc.update_stream(x, b"")


def shift(page, area, dx, dy):
    """把 area(x, y)（頁面座標）裡的內容移動 (dx, dy)，跨過邊界的線會被拉長。回傳有沒有東西被移動。"""
    fwd, back = _page_xf(page)
    a0, b0 = back(0, 0), back(dx, dy)
    ux, uy = b0.x - a0.x, b0.y - a0.y
    xrefs, src = _content(page)
    changed = False
    if xrefs:
        toks = tokenize(src)
        out, ops, path, stack = [], [], [], []
        ctm, tm, tlm = I6[:], I6[:], I6[:]
        tl, fs, applied = 0.0, 10.0, False
        pending_bi = False

        def moves(x, y):
            u = _apply(ctm, x, y)
            p = fwd(u[0], u[1])
            return area(p.x, p.y)

        def num(k):
            return ops[k][2] if 0 <= k < len(ops) and ops[k][0] == "num" else 0.0

        def flush():
            nonlocal changed
            d2 = _vec_in(ctm, ux, uy)
            for seg_ops, op, pts, kind in path:
                fl = [moves(x, y) for x, y in pts]
                if not any(fl):
                    out.extend(seg_ops)
                    out.append(op)
                    continue
                changed = True
                np_ = [(x + d2[0], y + d2[1]) if fl[j] else (x, y) for j, (x, y) in enumerate(pts)]
                if kind == "re":
                    out.append(("op", "%s %s m %s %s l %s %s l %s %s l h" % tuple(_f(v) for p in np_ for v in p), None))
                else:
                    out.append(("op", " ".join("%s %s" % (_f(x), _f(y)) for x, y in np_) + " " + op[1], None))
            path.clear()

        for t in toks:
            if t[0] != "op":
                ops.append(t)
                continue
            name = t[2]
            k = len(ops)
            if name in ("m", "l"):
                path.append((ops, t, [(num(k - 2), num(k - 1))], name)); ops = []; continue
            if name == "c":
                path.append((ops, t, [(num(0), num(1)), (num(2), num(3)), (num(4), num(5))], name)); ops = []; continue
            if name in ("v", "y"):
                path.append((ops, t, [(num(0), num(1)), (num(2), num(3))], name)); ops = []; continue
            if name == "re":
                x, y, w, h = num(0), num(1), num(2), num(3)
                path.append((ops, t, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], "re")); ops = []; continue
            if name in ("h", "W", "W*"):
                path.append((ops, t, [], name)); ops = []; continue
            if name in STATE and path:
                path.append((ops, t, [], "state")); ops = []; continue
            if name in PAINT or path:
                flush()
                if name in PAINT:
                    out.extend(ops); out.append(t); ops = []; continue
            if name == "q":
                stack.append(ctm[:])
            elif name == "Q":
                ctm = stack.pop() if stack else I6[:]
            elif name == "cm" and k >= 6:
                ctm = _mul([num(k - 6 + j) for j in range(6)], ctm)
            elif name == "BT":
                tm, tlm, applied = I6[:], I6[:], False
            elif name == "Tf" and k >= 2:
                fs = abs(num(k - 1)) or fs
            elif name == "TL":
                tl = num(k - 1)
            elif name == "Td":
                tlm = _mul([1, 0, 0, 1, num(k - 2), num(k - 1)], tlm); tm = tlm[:]
            elif name == "TD":
                tl = -num(k - 1); tlm = _mul([1, 0, 0, 1, num(k - 2), num(k - 1)], tlm); tm = tlm[:]
            elif name == "Tm" and k >= 6:
                tlm = [num(k - 6 + j) for j in range(6)]; tm = tlm[:]; applied = False
            elif name == "T*":
                tlm = _mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm[:]
            elif name in ("Tj", "TJ", "'", '"'):
                pre, show, show_op = [], ops, t
                if name in ("'", '"'):
                    # 先換行再寫字：拆成 (Tw Tc) T* + Tj，才能在中間插入新的文字矩陣
                    if name == '"' and k >= 3:
                        pre += [ops[0], ("op", "Tw", "Tw"), ops[1], ("op", "Tc", "Tc")]
                    pre.append(("op", "T*", "T*"))
                    tlm = _mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm[:]
                    show = ops[-1:]
                    show_op = ("op", "Tj", "Tj")
                p = _apply(tm, 0, fs * 0.3)
                need = moves(p[0], p[1])
                out.extend(pre)
                if need != applied:
                    lin = _vec_in(ctm, ux, uy)
                    m = [tm[0], tm[1], tm[2], tm[3], tm[4] + lin[0], tm[5] + lin[1]] if need else tm
                    out.append(("op", " ".join(_f(v) for v in m) + " Tm", None))
                    applied = need
                    changed = True
                out.extend(show)
                out.append(show_op)
                ops = []
                continue
            elif name in ("Do", "sh", "BI"):
                if all(moves(cx, cy) for cx, cy in ((0, 0), (1, 0), (1, 1), (0, 1))):
                    M = _mul(_mul(ctm, [1, 0, 0, 1, ux, uy]), _inv(ctm))
                    out.append(("op", "q", None))
                    out.append(("op", " ".join(_f(v) for v in M) + " cm", None))
                    out.extend(ops)
                    out.append(t)
                    if name == "BI":
                        pending_bi = True      # 內嵌圖片：Q 要在 EI 之後補
                    else:
                        out.append(("op", "Q", None))
                    changed = True
                    ops = []
                    continue
            elif name == "EI" and pending_bi:
                out.extend(ops); out.append(t); ops = []
                out.append(("op", "Q", None))
                pending_bi = False
                continue
            out.extend(ops)
            out.append(t)
            ops = []
        for seg_ops, op, pts, kind in path:
            out.extend(seg_ops)
            out.append(op)
        out.extend(ops)
        if changed:
            _set_content(page, xrefs, _serialize(out))
    # 註解（連結、表單欄位、便利貼…）也一起移
    moved = changed
    for an in list(page.annots() or []):
        r = an.rect
        if area(r.x0, r.y0) and area(r.x1, r.y1):
            try:
                an.set_rect(r + (dx, dy, dx, dy))
                moved = True
            except Exception:
                pass
    for w in list(page.widgets() or []):
        r = w.rect
        if area(r.x0, r.y0) and area(r.x1, r.y1):
            w.rect = r + (dx, dy, dx, dy)
            w.update()
            moved = True
    for ln in page.get_links():
        r = ln["from"]
        if area(r.x0, r.y0) and area(r.x1, r.y1):
            ln["from"] = r + (dx, dy, dx, dy)
            page.update_link(ln)
            moved = True
    return moved


def cut(page, box):
    """合併儲存格：剪掉穿過 box（頁面座標，已往內縮）內部的框線。回傳有沒有剪到。"""
    fwd, back = _page_xf(page)
    xrefs, src = _content(page)
    if not xrefs:
        return False
    bx1, by1, bx2, by2 = box
    toks = tokenize(src)
    out, ops, path, stack = [], [], [], []
    ctm = I6[:]
    changed = False

    def disp(p):
        u = _apply(ctm, p[0], p[1])
        q = fwd(u[0], u[1])
        return q.x, q.y

    def lerp(a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    def cut_range(a, b):
        A, B = disp(a), disp(b)
        vert, hori = abs(A[0] - B[0]) < 0.8, abs(A[1] - B[1]) < 0.8
        if not vert and not hori:
            return None
        if vert:
            fixed = (A[0] + B[0]) / 2
            if fixed <= bx1 or fixed >= bx2:
                return None
            va, vb, lo, hi = A[1], B[1], by1, by2
        else:
            fixed = (A[1] + B[1]) / 2
            if fixed <= by1 or fixed >= by2:
                return None
            va, vb, lo, hi = A[0], B[0], bx1, bx2
        if abs(vb - va) < 1e-6:
            return None
        t1, t2 = (lo - va) / (vb - va), (hi - va) / (vb - va)
        if t1 > t2:
            t1, t2 = t2, t1
        t1, t2 = max(0, t1), min(1, t2)
        return (t1, t2) if t2 - t1 > 1e-4 else None

    P = lambda p: "%s %s" % (_f(p[0]), _f(p[1]))

    def cut_line(a, b):
        r = cut_range(a, b)
        if not r:
            return None
        s = ""
        if r[0] > 1e-4:
            s += "%s l " % P(lerp(a, b, r[0]))
        if r[1] < 1 - 1e-4:
            s += "%s m %s l " % (P(lerp(a, b, r[1])), P(b))
        else:
            s += "%s m " % P(b)
        return s

    def flush(paint):
        nonlocal changed
        stroke = paint[:1] in ("S", "s", "B", "b")
        cur = start = None
        before = len(out)
        for seg_ops, op, pts, kind in path:
            if kind == "m":
                cur = start = pts[0]
                out.extend(seg_ops); out.append(op); continue
            if kind in ("l", "h"):
                b = start if kind == "h" else pts[0]
                s = cut_line(cur, b) if cur and b else None
                if s is not None:
                    out.append(("op", s.strip(), None)); changed = True
                else:
                    out.extend(seg_ops); out.append(op)
                cur = b
                continue
            if kind == "re":
                p0, p1, p2, p3 = pts
                d0, d2 = disp(p0), disp(p2)
                w, h = abs(d2[0] - d0[0]), abs(d2[1] - d0[1])
                cur = start = p0
                if min(w, h) < 3:
                    lg = ((lerp(p0, p3, .5), lerp(p1, p2, .5)) if w >= h else (lerp(p0, p1, .5), lerp(p3, p2, .5)))
                    r = cut_range(*lg)
                    if r:
                        changed = True
                        half = ((p3[0] - p0[0]) / 2, (p3[1] - p0[1]) / 2) if w >= h else ((p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2)

                        def piece(t1, t2):
                            a, b = lerp(lg[0], lg[1], t1), lerp(lg[0], lg[1], t2)
                            return "%s m %s l %s l %s l h " % (P((a[0] - half[0], a[1] - half[1])), P((b[0] - half[0], b[1] - half[1])),
                                                                P((b[0] + half[0], b[1] + half[1])), P((a[0] + half[0], a[1] + half[1])))
                        s = ""
                        if r[0] > 1e-4:
                            s += piece(0, r[0])
                        if r[1] < 1 - 1e-4:
                            s += piece(r[1], 1)
                        if s:
                            out.append(("op", s.strip(), None))
                        continue
                elif stroke:
                    edges = ((p0, p1), (p1, p2), (p2, p3), (p3, p0))
                    if any(cut_range(a, b) for a, b in edges):
                        changed = True
                        s = "%s m " % P(p0)
                        for a, b in edges:
                            s += cut_line(a, b) or ("%s l " % P(b))
                        out.append(("op", s.strip(), None))
                        continue
                out.extend(seg_ops); out.append(op)
                continue
            out.extend(seg_ops); out.append(op)
            if pts:
                cur = pts[-1]
        path.clear()
        return len(out) > before

    for t in toks:
        if t[0] != "op":
            ops.append(t)
            continue
        name = t[2]
        k = len(ops)
        num = lambda j: ops[j][2] if 0 <= j < len(ops) and ops[j][0] == "num" else 0.0
        if name in ("m", "l"):
            path.append((ops, t, [(num(k - 2), num(k - 1))], name)); ops = []; continue
        if name == "c":
            path.append((ops, t, [(num(4), num(5))], name)); ops = []; continue
        if name in ("v", "y"):
            path.append((ops, t, [(num(2), num(3))], name)); ops = []; continue
        if name == "re":
            x, y, w, h = num(0), num(1), num(2), num(3)
            path.append((ops, t, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], "re")); ops = []; continue
        if name in ("h", "W", "W*"):
            path.append((ops, t, [], name)); ops = []; continue
        if name in STATE and path:
            path.append((ops, t, [], "state")); ops = []; continue
        if name in PAINT:
            if name == "n" or any(p[3] in ("W", "W*") for p in path):
                for seg_ops, op, pts, kind in path:
                    out.extend(seg_ops); out.append(op)
                path.clear()
            elif not flush(name):
                out.extend(ops); ops = []
                continue        # 整個路徑都被剪掉時，繪製指令也拿掉
            out.extend(ops); out.append(t); ops = []
            continue
        if path:
            for seg_ops, op, pts, kind in path:
                out.extend(seg_ops); out.append(op)
            path.clear()
        if name == "q":
            stack.append(ctm[:])
        elif name == "Q":
            ctm = stack.pop() if stack else I6[:]
        elif name == "cm" and k >= 6:
            ctm = _mul([num(k - 6 + j) for j in range(6)], ctm)
        out.extend(ops); out.append(t); ops = []
    for seg_ops, op, pts, kind in path:
        out.extend(seg_ops); out.append(op)
    out.extend(ops)
    if changed:
        _set_content(page, xrefs, _serialize(out))
    return changed


# ---------------------------------------------------------------- 動作


def line(page, x1, y1, x2, y2, width=0.75):
    page.draw_line((x1, y1), (x2, y2), color=(0, 0, 0), width=width)


def insert_row(page, cell, table, h):
    """在儲存格下方插入一列（高 h）。"""
    split = cell[3] - 1.5
    shift(page, lambda x, y: y > split, 0, h)
    line(page, table[0], cell[3], table[2], cell[3])


def insert_column(page, cell, table, w):
    """在儲存格右邊插入一欄（寬 w）：表格範圍內、右邊的內容往右移。"""
    split = cell[2] - 1.5
    shift(page, lambda x, y: x > split and table[1] - 2 <= y <= table[3] + 2, w, 0)
    line(page, cell[2], table[1], cell[2], table[3])


def split_column(page, x, table):
    line(page, x, table[1], x, table[3])


def merge(page, box):
    return cut(page, (box[0] + 0.75, box[1] + 0.75, box[2] - 0.75, box[3] - 0.75))


def add_table(page, x, y, w, rows, cols, row_h=24, push=False):
    H = rows * row_h
    if push:
        shift(page, lambda X, Y: Y > y - 2, 0, H + 6)
    for r in range(rows + 1):
        line(page, x, y + r * row_h, x + w, y + r * row_h)
    for c in range(cols + 1):
        line(page, x + c * w / cols, y, x + c * w / cols, y + H)
