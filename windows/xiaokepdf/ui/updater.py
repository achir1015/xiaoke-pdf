"""檢查更新：到 GitHub Releases 找最新的 Windows 版安裝程式（tag：win-v版本），下載後執行安裝。
只有在使用者按「檢查更新」或啟動時（可在設定關閉）才連線，不會送出任何文件內容。"""
import json
import os
import re
import subprocess
import tempfile
import urllib.request

from PySide6.QtCore import QObject, QThread, Signal
from PySide6.QtWidgets import QMessageBox, QProgressDialog

from .. import REPO, VERSION

ASSET = "XiaoKePdf-Windows-Setup.exe"


def _ver(s):
    return tuple(int(x) for x in re.findall(r"\d+", s)[:3]) or (0,)


class _Check(QThread):
    done = Signal(object)

    def run(self):
        try:
            req = urllib.request.Request("https://api.github.com/repos/%s/releases?per_page=20" % REPO, headers={"User-Agent": "XiaoKePdf-Windows"})
            with urllib.request.urlopen(req, timeout=15) as r:
                rels = json.loads(r.read().decode("utf-8"))
            best = None
            for rel in rels:
                tag = rel.get("tag_name", "")
                if not tag.startswith("win-v") or rel.get("draft"):
                    continue
                asset = next((a for a in rel.get("assets", []) if a.get("name") == ASSET), None)
                if asset and (best is None or _ver(tag) > _ver(best[0])):
                    best = (tag, asset["browser_download_url"], asset.get("size", 0), rel.get("body", ""))
            self.done.emit(best)
        except Exception as e:
            self.done.emit(e)


class _Download(QThread):
    progress = Signal(int)
    done = Signal(object)

    def __init__(self, url, size):
        super().__init__()
        self.url, self.size = url, size

    def run(self):
        try:
            path = os.path.join(tempfile.gettempdir(), ASSET)
            req = urllib.request.Request(self.url, headers={"User-Agent": "XiaoKePdf-Windows"})
            with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
                total = int(r.headers.get("Content-Length") or self.size or 0)
                got = 0
                while True:
                    b = r.read(65536)
                    if not b:
                        break
                    f.write(b)
                    got += len(b)
                    if total:
                        self.progress.emit(int(got * 100 / total))
            self.done.emit(path)
        except Exception as e:
            self.done.emit(e)


def check(win, manual=False):
    t = _Check(win)
    win._upd_thread = t

    def got(res):
        if isinstance(res, Exception):
            if manual:
                QMessageBox.warning(win, "檢查更新", "無法連線到 GitHub：%s" % res)
            return
        if not res or _ver(res[0]) <= _ver(VERSION):
            if manual:
                QMessageBox.information(win, "檢查更新", "目前已是最新版（%s）。" % VERSION)
            return
        tag, url, size, notes = res
        new = tag[5:]
        if win.prefs.get("skip_version") == new and not manual:
            return
        box = QMessageBox(QMessageBox.Information, "有新版本", "小柯文件PDF助手 %s 可以更新了（目前 %s）。\n\n%s" % (new, VERSION, (notes or "")[:800]), parent=win)
        yes = box.addButton("下載並安裝", QMessageBox.AcceptRole)
        box.addButton("稍後", QMessageBox.RejectRole)
        skip = box.addButton("略過這個版本", QMessageBox.DestructiveRole)
        box.exec()
        if box.clickedButton() is skip:
            win.prefs.set("skip_version", new)
            return
        if box.clickedButton() is not yes:
            return
        dl = _Download(url, size)
        win._upd_dl = dl
        pd = QProgressDialog("正在下載新版…", "取消", 0, 100, win)
        pd.setWindowTitle("更新")
        pd.setMinimumDuration(0)
        dl.progress.connect(pd.setValue)
        pd.canceled.connect(dl.terminate)

        def finished(path):
            pd.close()
            if isinstance(path, Exception):
                QMessageBox.warning(win, "更新", "下載失敗：%s" % path)
                return
            if QMessageBox.question(win, "更新", "下載完成。要關閉程式並開始安裝嗎？\n（未儲存的文件會先詢問是否儲存）") == QMessageBox.Yes:
                if win.close():
                    subprocess.Popen([path, "/SILENT", "/RESTARTAPPLICATIONS"], close_fds=True)
        dl.done.connect(finished)
        dl.start()

    t.done.connect(got)
    t.start()
