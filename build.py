"""不用 Gradle 的小柯文件PDF助手建置腳本：aapt2 → javac → d8 → zipalign → apksigner。

需要：Python 3.8+、JDK 17、Android SDK（build-tools 34.0.0、platforms/android-34）。
SDK / JDK 位置依序讀取 local.properties（sdk.dir= / jdk.dir=）、ANDROID_HOME / JAVA_HOME。
函式庫放在 libs/*.jar（PDFBox-Android、BouncyCastle），PDFBox 的資源檔在 libs/pdfbox-assets/assets。
用法：python build.py          產生 build/XiaoKePdf.apk
      python build.py install  另外用 adb 安裝並啟動
"""
import glob
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(ROOT, "build")
EXE = ".exe" if os.name == "nt" else ""
BAT = ".bat" if os.name == "nt" else ""
PKG = "com.achir.xiaokepdf"


def props():
    p = {}
    f = os.path.join(ROOT, "local.properties")
    if os.path.exists(f):
        for line in open(f, encoding="utf-8"):
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                p[k.strip()] = v.strip().replace("\\:", ":").replace("\\\\", "\\")
    return p


P = props()
SDK = P.get("sdk.dir") or os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") \
    or os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk")
JDK = P.get("jdk.dir") or os.environ.get("JAVA_HOME", "")


def latest(pattern):
    found = sorted(glob.glob(pattern))
    if not found:
        sys.exit("找不到 " + pattern)
    return found[-1]


BT = latest(os.path.join(SDK, "build-tools", "*"))
ANDROID_JAR = latest(os.path.join(SDK, "platforms", "android-*", "android.jar"))
JAVAC = os.path.join(JDK, "bin", "javac" + EXE) if JDK else "javac"
KEYTOOL = os.path.join(JDK, "bin", "keytool" + EXE) if JDK else "keytool"
ADB = os.path.join(SDK, "platform-tools", "adb" + EXE)
if JDK:
    os.environ["JAVA_HOME"] = JDK
LIBS = sorted(glob.glob(os.path.join(ROOT, "libs", "*.jar")))


def rel(p):
    try:
        return os.path.relpath(p, ROOT)
    except ValueError:
        return p


def run(*cmd):
    print(">", " ".join(os.path.basename(c) if i == 0 else c for i, c in enumerate(cmd))[:300])
    subprocess.check_call(list(cmd), cwd=ROOT)


def main():
    shutil.rmtree(BUILD, ignore_errors=True)
    for d in ("res", "gen", "classes", "dex"):
        os.makedirs(os.path.join(BUILD, d))

    # 1. 資源（PDFBox 的 cmap / afm / glyphlist 等放進 assets）
    run(os.path.join(BT, "aapt2" + EXE), "compile", "--dir", "res", "-o", rel(os.path.join(BUILD, "res.zip")))
    unsigned = os.path.join(BUILD, "unsigned.apk")
    run(os.path.join(BT, "aapt2" + EXE), "link", "-o", rel(unsigned),
        "-I", rel(ANDROID_JAR), "--manifest", "AndroidManifest.xml",
        "--java", rel(os.path.join(BUILD, "gen")), "--auto-add-overlay",
        "-A", rel(os.path.join(ROOT, "libs", "pdfbox-assets", "assets")),
        *(["-A", "assets"] if os.path.isdir(os.path.join(ROOT, "assets")) else []),
        rel(os.path.join(BUILD, "res.zip")))

    # 2. Java
    sources = glob.glob(os.path.join(ROOT, "src", "**", "*.java"), recursive=True)
    sources += glob.glob(os.path.join(BUILD, "gen", "**", "*.java"), recursive=True)
    argfile = os.path.join(BUILD, "sources.txt")
    with open(argfile, "w", encoding="utf-8") as f:
        f.write("\n".join('"%s"' % s.replace("\\", "/") for s in sources))
    run(JAVAC, "-encoding", "UTF-8", "--release", "8", "-nowarn", "-Xlint:-options",
        "-classpath", os.pathsep.join([ANDROID_JAR] + LIBS), "-d", os.path.join(BUILD, "classes"), "@" + argfile)

    # 3. dex（先打包成 jar，避免 d8.bat 命令列超過 8191 字元；方法數超過 64K 會自動拆成多個 dex）
    jar = os.path.join(BUILD, "classes.jar")
    cdir = os.path.join(BUILD, "classes")
    with zipfile.ZipFile(jar, "w") as z:
        for f in glob.glob(os.path.join(cdir, "**", "*.class"), recursive=True):
            z.write(f, os.path.relpath(f, cdir).replace(os.sep, "/"))
    run(os.path.join(BT, "d8" + BAT), "--release", "--min-api", "24", "--lib", ANDROID_JAR,
        "--output", os.path.join(BUILD, "dex"), jar, *LIBS)
    with zipfile.ZipFile(unsigned, "a") as z:
        for dex in sorted(glob.glob(os.path.join(BUILD, "dex", "*.dex"))):
            z.write(dex, os.path.basename(dex))
        # BouncyCastle 需要的服務設定檔等非 class 資源
        for lib in LIBS:
            with zipfile.ZipFile(lib) as lz:
                for n in lz.namelist():
                    if n.endswith(".class") or n.endswith("/") or n.upper().startswith("META-INF/"):
                        continue
                    if n.endswith(".properties") and n not in z.namelist():
                        z.writestr(n, lz.read(n))

    # 4. 對齊 + 簽章
    aligned = os.path.join(BUILD, "aligned.apk")
    run(os.path.join(BT, "zipalign" + EXE), "-f", "4", unsigned, aligned)
    ks = os.path.join(ROOT, "xiaokepdf.jks")
    if not os.path.exists(ks):
        run(KEYTOOL, "-genkeypair", "-keystore", ks, "-storepass", "android", "-keypass", "android",
            "-alias", "xiaokepdf", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
            "-dname", "CN=XiaoKePdf")
    out = os.path.join(BUILD, "XiaoKePdf.apk")
    run(os.path.join(BT, "apksigner" + BAT), "sign", "--ks", ks, "--ks-pass", "pass:android",
        "--out", out, aligned)
    print("完成：", out, "%.1f MB" % (os.path.getsize(out) / 1048576))

    if "install" in sys.argv[1:]:
        run(ADB, "install", "-r", "-g", out)
        run(ADB, "shell", "am", "start", "-n", PKG + "/.MainActivity")


if __name__ == "__main__":
    main()
