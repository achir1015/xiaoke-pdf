"""命令列工具（與桌面程式同一套引擎）：

  XiaoKePdf info  文件.pdf                         結構資訊（JSON）
  XiaoKePdf text  文件.pdf [--page 3]              依閱讀順序取出文字
  XiaoKePdf edit  in.pdf --rotate 1,2:90 --delete 5 --title "Q3" --out out.pdf
  XiaoKePdf combine a.pdf b.pdf --out 合併.pdf
  XiaoKePdf extract 文件.pdf --pages 1,3,5-8 --out 精選.pdf
  XiaoKePdf split 文件.pdf --every 10 --out-dir 分割/
  XiaoKePdf find  文件.pdf 關鍵字
"""
import argparse
import json
import os
import sys

import pymupdf as fitz

from .engine import pages as PG
from .engine import text as T

COMMANDS = ("info", "text", "edit", "combine", "extract", "split", "find", "help", "--help", "-h")


def _open(path, password=None):
    d = fitz.open(path)
    if d.needs_pass and not d.authenticate(password or ""):
        raise SystemExit("需要密碼：請加上 --password")
    return d


def main(argv):
    if argv[0] in ("help", "--help", "-h"):
        print(__doc__)
        return 0
    ap = argparse.ArgumentParser(prog="XiaoKePdf " + argv[0])
    ap.add_argument("files", nargs="+")
    ap.add_argument("--password")
    ap.add_argument("--out")
    ap.add_argument("--out-dir")
    ap.add_argument("--page", type=int)
    ap.add_argument("--pages")
    ap.add_argument("--every", type=int)
    ap.add_argument("--rotate", action="append", default=[])
    ap.add_argument("--delete")
    ap.add_argument("--title")
    a = ap.parse_args(argv[1:])
    cmd = argv[0]
    out = sys.stdout
    if hasattr(out, "reconfigure"):
        out.reconfigure(encoding="utf-8")
    if cmd == "info":
        d = _open(a.files[0], a.password)
        m = d.metadata or {}
        info = {"file": a.files[0], "pages": d.page_count, "version": m.get("format"), "encrypted": bool(m.get("encryption")),
                "title": m.get("title"), "author": m.get("author"), "page_size": list(d[0].rect)[2:] if d.page_count else None,
                "labels": PG.page_labels(d)[:20], "outline": d.get_toc()[:50], "fields": sum(1 for p in d for _ in (p.widgets() or [])),
                "annotations": sum(1 for p in d for _ in (p.annots() or [])), "attachments": [x["name"] for x in PG.attachments(d)],
                "layers": [n for _, n, _ in PG.layers(d)], "fonts": [{"name": n, "type": t, "embedded": e} for n, t, e, _ in PG.fonts(d)]}
        print(json.dumps(info, ensure_ascii=False, indent=2))
    elif cmd == "text":
        d = _open(a.files[0], a.password)
        pages = [a.page - 1] if a.page else range(d.page_count)
        for i in pages:
            print(d[i].get_text("text", sort=True))
    elif cmd == "find":
        d = _open(a.files[0], a.password)
        q = " ".join(a.files[1:])
        for pg, quad in T.search(d, q):
            print("第 %d 頁\t%.0f,%.0f" % (pg + 1, quad.rect.x0, quad.rect.y0))
    elif cmd == "edit":
        d = _open(a.files[0], a.password)
        for spec in a.rotate:
            pages, deg = spec.split(":")
            PG.rotate(d, PG.parse_pages(pages, d.page_count), int(deg))
        if a.delete:
            PG.delete(d, PG.parse_pages(a.delete, d.page_count))
        if a.title is not None:
            PG.set_meta(d, title=a.title)
        d.save(a.out or a.files[0] + ".out.pdf", garbage=3, deflate=True)
    elif cmd == "combine":
        data = PG.merge([(os.path.basename(f), open(f, "rb").read(), a.password) for f in a.files])
        open(a.out or "combined.pdf", "wb").write(data)
    elif cmd == "extract":
        d = _open(a.files[0], a.password)
        open(a.out or "extracted.pdf", "wb").write(PG.extract(d, PG.parse_pages(a.pages, d.page_count)))
    elif cmd == "split":
        d = _open(a.files[0], a.password)
        parts = PG.split_every(d, a.every or 1)
        od = a.out_dir or "."
        os.makedirs(od, exist_ok=True)
        base = os.path.splitext(os.path.basename(a.files[0]))[0]
        for k, data in enumerate(parts):
            open(os.path.join(od, "%s_%02d.pdf" % (base, k + 1)), "wb").write(data)
        print("%d 個檔案" % len(parts))
    return 0
