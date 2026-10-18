"""文件工作階段：開啟、每個編輯一個步驟（可一直復原／重做，儲存後仍可復原）、
安全儲存（先寫暫存檔並驗證，再取代原檔）、自動保存與當機後恢復。

每個步驟都是一份完整的 PDF 快照，存在 %LOCALAPPDATA%\\XiaoKePdf\\sessions\\<id>\\ 底下；
加密的文件快照也保持加密（用同一組密碼），磁碟上不會出現解密後的內容。
"""
import json
import os
import shutil
import tempfile
import time
import uuid

import pymupdf as fitz

from .. import data_dir

# 編輯種類：受作者權限限制時用來判斷能不能做
K_EDIT, K_ANNOT, K_FORM, K_PAGES, K_COPY, K_PRINT = range(6)


class NeedPassword(Exception):
    def __init__(self, wrong=False):
        super().__init__("需要密碼")
        self.wrong = wrong


class Session:
    def __init__(self):
        self.id = uuid.uuid4().hex[:12]
        self.dir = data_dir("sessions", self.id)
        self.path = None            # 原檔路徑（新文件為 None）
        self.name = "未命名.pdf"
        self.password = ""          # 開啟用的密碼（加密文件）
        self.owner = True           # 是否有擁有者權限（可以編輯受限制的文件）
        self.encrypted = False
        self.enc_info = {}          # 加密方式、權限
        self.repaired = False
        self.steps = []             # [{label, file}]
        self.pos = -1
        self.saved_pos = -1
        self.doc = None             # 目前版本（fitz.Document）
        self.version = 0            # 每次內容改變 +1（畫面用來判斷要不要重畫）
        self.page = 0               # 閱讀位置
        self.zoom = 1.0
        self.layout = "continuous"
        self.order = int(time.time())

    # ------------------------------------------------------------------ 開啟

    @classmethod
    def open(cls, path=None, data=None, name=None, password=None):
        s = cls()
        if path:
            s.path = os.path.abspath(path)
            s.name = os.path.basename(path)
            with open(path, "rb") as f:
                data = f.read()
        elif name:
            s.name = name
        s._load_first(data, password)
        return s

    @classmethod
    def new_blank(cls, size=(595, 842), name="新文件.pdf"):
        d = fitz.open()
        d.new_page(width=size[0], height=size[1])
        s = cls()
        s.name = name
        s._load_first(d.tobytes(), None)
        s.saved_pos = -1        # 新文件一開始就算「未儲存」
        return s

    def _load_first(self, data, password):
        try:
            d = fitz.open(stream=data, filetype="pdf")
        except Exception as e:
            shutil.rmtree(self.dir, ignore_errors=True)
            raise ValueError("這不是有效的 PDF 檔案：%s" % e)
        if d.is_repaired:
            self.repaired = True
        if d.needs_pass:
            if not password:
                shutil.rmtree(self.dir, ignore_errors=True)
                raise NeedPassword(False)
            rc = d.authenticate(password)
            if not rc:
                shutil.rmtree(self.dir, ignore_errors=True)
                raise NeedPassword(True)
            self.password = password
            # authenticate 回傳值：2/6＝使用者密碼、4＝擁有者密碼
            self.owner = bool(rc & 4)
        self.encrypted = bool(d.is_encrypted or d.metadata.get("encryption"))
        self.enc_info = {"method": d.metadata.get("encryption") or "", "perms": d.permissions}
        if self.encrypted and not d.needs_pass:
            self.owner = d.permissions == -1 or self._all_perms(d.permissions)
        self._push("開啟", data if not self.repaired else d.tobytes(encryption=fitz.PDF_ENCRYPT_KEEP))
        self.saved_pos = 0 if self.path else -1

    @staticmethod
    def _all_perms(p):
        need = fitz.PDF_PERM_MODIFY | fitz.PDF_PERM_ANNOTATE | fitz.PDF_PERM_FORM | fitz.PDF_PERM_ASSEMBLE | fitz.PDF_PERM_COPY | fitz.PDF_PERM_PRINT
        return (p & need) == need

    def unlock(self, owner_password):
        """輸入擁有者密碼解除作者的限制。"""
        d = fitz.open(stream=self.current_bytes(), filetype="pdf")
        rc = d.authenticate(owner_password)
        if rc & 4:
            self.password = owner_password
            self.owner = True
            self._reopen()
            return True
        return False

    # ------------------------------------------------------------------ 權限

    def block(self, kind):
        """被作者權限擋下時回傳說明文字，可以做時回傳 None。"""
        if not self.encrypted or self.owner:
            return None
        p = self.doc.permissions
        need = {K_EDIT: fitz.PDF_PERM_MODIFY, K_ANNOT: fitz.PDF_PERM_ANNOTATE, K_FORM: fitz.PDF_PERM_FORM | fitz.PDF_PERM_ANNOTATE,
                K_PAGES: fitz.PDF_PERM_ASSEMBLE | fitz.PDF_PERM_MODIFY, K_COPY: fitz.PDF_PERM_COPY, K_PRINT: fitz.PDF_PERM_PRINT}[kind]
        if p & need:
            return None
        what = {K_EDIT: "修改內容", K_ANNOT: "加註解", K_FORM: "填寫表單", K_PAGES: "整理頁面", K_COPY: "複製文字", K_PRINT: "列印"}[kind]
        return "作者設定了權限，不允許%s。輸入擁有者密碼即可解除限制。" % what

    # ------------------------------------------------------------------ 步驟

    def _step_file(self, n):
        return os.path.join(self.dir, "step_%04d.pdf" % n)

    def _push(self, label, data):
        # 丟掉「重做」的分支
        for st in self.steps[self.pos + 1:]:
            try:
                os.remove(st["file"])
            except OSError:
                pass
        del self.steps[self.pos + 1:]
        if self.saved_pos > self.pos:
            self.saved_pos = -2      # 儲存的版本已經不在歷史裡了
        n = (max([int(os.path.basename(s["file"])[5:9]) for s in self.steps]) + 1) if self.steps else 0
        f = self._step_file(n)
        with open(f, "wb") as fp:
            fp.write(data)
        self.steps.append({"label": label, "file": f})
        self.pos = len(self.steps) - 1
        self._reopen()
        self.write_meta()

    def current_bytes(self):
        with open(self.steps[self.pos]["file"], "rb") as f:
            return f.read()

    def _reopen(self):
        if self.doc is not None:
            try:
                self.doc.close()
            except Exception:
                pass
        d = fitz.open(stream=self.current_bytes(), filetype="pdf")
        if d.needs_pass:
            d.authenticate(self.password)
        self.doc = d
        self.version += 1
        self.page = max(0, min(self.page, d.page_count - 1))

    def apply(self, label, fn):
        """套用一個編輯：fn(doc) 直接修改目前的文件，成功後存成新的步驟；失敗時恢復原狀。"""
        try:
            r = fn(self.doc)
            data = self.doc.tobytes(garbage=1, encryption=fitz.PDF_ENCRYPT_KEEP if self.encrypted else fitz.PDF_ENCRYPT_NONE)
        except Exception:
            self._reopen()
            raise
        self._push(label, data)
        return r

    def apply_bytes(self, label, data):
        self._push(label, data)

    def can_undo(self):
        return self.pos > 0

    def can_redo(self):
        return self.pos + 1 < len(self.steps)

    def undo_label(self):
        return self.steps[self.pos]["label"] if self.can_undo() else None

    def redo_label(self):
        return self.steps[self.pos + 1]["label"] if self.can_redo() else None

    def undo(self):
        if not self.can_undo():
            return False
        self.pos -= 1
        self._reopen()
        self.write_meta()
        return True

    def redo(self):
        if not self.can_redo():
            return False
        self.pos += 1
        self._reopen()
        self.write_meta()
        return True

    @property
    def dirty(self):
        return self.pos != self.saved_pos

    # ------------------------------------------------------------------ 儲存

    def save(self, path=None, subset=True):
        """安全儲存：先寫到同一個資料夾的暫存檔、重新開啟驗證，再取代原檔。"""
        path = os.path.abspath(path or self.path)
        d = fitz.open(stream=self.current_bytes(), filetype="pdf")
        if d.needs_pass:
            d.authenticate(self.password)
        if subset:
            try:
                d.subset_fonts()
            except Exception:
                pass
        folder = os.path.dirname(path) or "."
        fd, tmp = tempfile.mkstemp(prefix=".xiaoke_", suffix=".pdf", dir=folder)
        os.close(fd)
        try:
            d.save(tmp, garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_KEEP if self.encrypted else fitz.PDF_ENCRYPT_NONE)
            d.close()
            chk = fitz.open(tmp)
            if chk.needs_pass and not chk.authenticate(self.password):
                raise IOError("驗證失敗：存出的檔案無法用原密碼開啟")
            if chk.page_count != self.doc.page_count:
                raise IOError("驗證失敗：頁數不一致")
            chk.close()
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
        self.path = path
        self.name = os.path.basename(path)
        self.saved_pos = self.pos
        self.write_meta()

    def output_bytes(self, subset=True):
        d = fitz.open(stream=self.current_bytes(), filetype="pdf")
        if d.needs_pass:
            d.authenticate(self.password)
        if subset:
            try:
                d.subset_fonts()
            except Exception:
                pass
        return d.tobytes(garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_KEEP if self.encrypted else fitz.PDF_ENCRYPT_NONE)

    # ------------------------------------------------------------------ 自動保存／恢復

    def write_meta(self):
        meta = {"path": self.path, "name": self.name, "steps": [{"label": s["label"], "file": os.path.basename(s["file"])} for s in self.steps],
                "pos": self.pos, "saved_pos": self.saved_pos, "encrypted": self.encrypted, "page": self.page,
                "zoom": self.zoom, "layout": self.layout, "order": self.order, "time": time.time()}
        tmp = os.path.join(self.dir, "meta.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(self.dir, "meta.json"))

    def discard(self):
        """關閉：刪掉這個工作階段的暫存資料。"""
        if self.doc is not None:
            try:
                self.doc.close()
            except Exception:
                pass
        shutil.rmtree(self.dir, ignore_errors=True)

    @classmethod
    def recoverable(cls):
        """上次沒有正常結束、還有未儲存變更的工作階段：[(meta, dir)]"""
        out = []
        root = data_dir("sessions")
        for name in os.listdir(root):
            d = os.path.join(root, name)
            mf = os.path.join(d, "meta.json")
            if not os.path.isfile(mf):
                shutil.rmtree(d, ignore_errors=True)
                continue
            try:
                with open(mf, encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                shutil.rmtree(d, ignore_errors=True)
                continue
            if meta.get("pos") == meta.get("saved_pos"):
                shutil.rmtree(d, ignore_errors=True)
                continue
            out.append((meta, d))
        out.sort(key=lambda m: m[0].get("order", 0))
        return out

    @classmethod
    def restore(cls, meta, folder, password=None):
        s = cls()
        shutil.rmtree(s.dir, ignore_errors=True)
        s.id = os.path.basename(folder)
        s.dir = folder
        s.path = meta.get("path")
        s.name = meta.get("name") or "恢復的文件.pdf"
        s.steps = [{"label": x["label"], "file": os.path.join(folder, x["file"])} for x in meta["steps"] if os.path.isfile(os.path.join(folder, x["file"]))]
        if not s.steps:
            raise ValueError("找不到可以恢復的內容")
        s.pos = min(meta.get("pos", len(s.steps) - 1), len(s.steps) - 1)
        s.saved_pos = meta.get("saved_pos", -1)
        s.page = meta.get("page", 0)
        s.zoom = meta.get("zoom", 1.0)
        s.layout = meta.get("layout", "continuous")
        s.order = meta.get("order", s.order)
        s.encrypted = meta.get("encrypted", False)
        d = fitz.open(stream=s.current_bytes(), filetype="pdf")
        if d.needs_pass:
            if not password:
                raise NeedPassword(False)
            if not d.authenticate(password):
                raise NeedPassword(True)
            s.password = password
        d.close()
        s._reopen()
        return s

    # ------------------------------------------------------------------ 其他

    def info_text(self):
        return {"name": self.name, "path": self.path, "pages": self.doc.page_count, "encrypted": self.encrypted}
