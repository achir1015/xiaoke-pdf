"""程式進入點：沒有參數或參數是 PDF 檔 → 開視窗；第一個參數是命令列指令（info、text、combine…）→ 命令列工具。"""
import os
import sys


def main():
    args = sys.argv[1:]
    from . import cli
    if args and args[0] in cli.COMMANDS:
        sys.exit(cli.main(args))
    gui(args)


def gui(files):
    from PySide6.QtCore import QCoreApplication, Qt
    from PySide6.QtGui import QIcon
    from PySide6.QtNetwork import QLocalServer, QLocalSocket
    from PySide6.QtWidgets import QApplication

    from . import APP_ID, APP_NAME, resource

    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Achir." + APP_ID)
        except Exception:
            pass
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("Achir")
    app.setWindowIcon(QIcon(resource("assets", "icon.ico")))
    files = [os.path.abspath(f) for f in files if not f.startswith("-")]

    # 已經開著：把檔案交給原本的視窗
    key = "%s-%s" % (APP_ID, os.environ.get("USERNAME", "user"))
    sock = QLocalSocket()
    sock.connectToServer(key)
    if sock.waitForConnected(300):
        sock.write(("\n".join(files) or "\x00").encode("utf-8"))
        sock.flush()
        sock.waitForBytesWritten(1000)
        sock.disconnectFromServer()
        return
    QLocalServer.removeServer(key)
    server = QLocalServer()
    server.listen(key)

    from .ui.main_window import MainWindow
    win = MainWindow(files)

    def incoming():
        c = server.nextPendingConnection()
        if c is None:
            return

        def read():
            data = bytes(c.readAll()).decode("utf-8", "ignore")
            for p in data.split("\n"):
                p = p.strip("\x00").strip()
                if p and os.path.isfile(p):
                    win.open_path(p)
            win.setWindowState(win.windowState() & ~Qt.WindowMinimized | Qt.WindowActive)
            win.raise_()
            win.activateWindow()
        c.readyRead.connect(read)
    server.newConnection.connect(incoming)
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
