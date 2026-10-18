# PyInstaller 設定：一個視窗程式 XiaoKePdf.exe ＋ 一個命令列工具 XiaoKePdf-cli.exe，共用同一份函式庫。
# 用法：python packaging/build.py（會先跑這個 spec，再用 Inno Setup 做安裝程式）
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

a = Analysis(
    [os.path.join(ROOT, "packaging", "launcher.py")],
    pathex=[ROOT],
    datas=[
        (os.path.join(ROOT, "assets", "fonts", "jf-openhuninn-2.1.ttf"), "assets/fonts"),
        (os.path.join(ROOT, "assets", "fonts", "jf-openhuninn-OFL.txt"), "assets/fonts"),
        (os.path.join(ROOT, "assets", "icon.ico"), "assets"),
        (os.path.join(ROOT, "assets", "icon.png"), "assets"),
        (os.path.join(ROOT, "LICENSE.txt"), "."),
    ],
    hiddenimports=["PySide6.QtPrintSupport", "PySide6.QtNetwork", "pyhanko.sign.signers.pdf_signer", "pyhanko_certvalidator"],
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "scipy", "IPython", "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
              "PySide6.Qt3DCore", "PySide6.QtQuick", "PySide6.QtQml", "PySide6.QtMultimedia", "PySide6.QtCharts", "PySide6.QtDataVisualization"],
    noarchive=False,
)
pyz = PYZ(a.pure)

app = EXE(pyz, a.scripts, [], exclude_binaries=True, name="XiaoKePdf", icon=os.path.join(ROOT, "assets", "icon.ico"),
          console=False, version=os.path.join(ROOT, "packaging", "version_info.txt"))
cli = EXE(pyz, a.scripts, [], exclude_binaries=True, name="XiaoKePdf-cli", icon=os.path.join(ROOT, "assets", "icon.ico"),
          console=True, version=os.path.join(ROOT, "packaging", "version_info.txt"))
coll = COLLECT(app, cli, a.binaries, a.datas, strip=False, upx=False, name="XiaoKePdf")
