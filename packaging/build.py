"""打包：PyInstaller → dist\\XiaoKePdf\\，再用 Inno Setup 做成安裝程式 dist\\XiaoKePdf-Windows-Setup.exe。

    python packaging/build.py            # 全部
    python packaging/build.py --no-installer
"""
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from xiaokepdf import VERSION, APP_NAME  # noqa: E402


def version_info():
    v = [int(x) for x in re.findall(r"\d+", VERSION)[:3]] + [0]
    v = (v + [0, 0, 0, 0])[:4]
    txt = """VSVersionInfo(
  ffi=FixedFileInfo(filevers=%(t)s, prodvers=%(t)s, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[StringFileInfo([StringTable('040404B0', [
    StringStruct('CompanyName', 'Achir'),
    StringStruct('FileDescription', '%(name)s'),
    StringStruct('FileVersion', '%(v)s'),
    StringStruct('InternalName', 'XiaoKePdf'),
    StringStruct('LegalCopyright', 'AGPL-3.0'),
    StringStruct('OriginalFilename', 'XiaoKePdf.exe'),
    StringStruct('ProductName', '%(name)s'),
    StringStruct('ProductVersion', '%(v)s')])]),
  VarFileInfo([VarStruct('Translation', [1028, 1200])])]
)
""" % {"t": tuple(v), "v": VERSION, "name": APP_NAME}
    with open(os.path.join(ROOT, "packaging", "version_info.txt"), "w", encoding="utf-8") as f:
        f.write(txt)


def find_iscc():
    cands = [shutil.which("iscc"),
             os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Inno Setup 6", "ISCC.exe"),
             r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe", r"C:\Program Files\Inno Setup 6\ISCC.exe"]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def main():
    version_info()
    dist = os.path.join(ROOT, "dist")
    subprocess.check_call([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", dist,
                           "--workpath", os.path.join(ROOT, "build"), os.path.join(ROOT, "packaging", "XiaoKePdf.spec")], cwd=ROOT)
    print("程式：", os.path.join(dist, "XiaoKePdf"))
    if "--no-installer" in sys.argv:
        return
    iscc = find_iscc()
    if not iscc:
        print("找不到 Inno Setup（ISCC.exe），跳過安裝程式。請安裝 Inno Setup 6：winget install JRSoftware.InnoSetup")
        return
    subprocess.check_call([iscc, "/DAppVersion=" + VERSION, os.path.join(ROOT, "packaging", "installer.iss")], cwd=ROOT)
    print("安裝程式：", os.path.join(dist, "XiaoKePdf-Windows-Setup.exe"))


if __name__ == "__main__":
    main()
