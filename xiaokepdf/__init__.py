"""小柯文件PDF助手（Windows 版）。"""
import os
import sys

APP_NAME = "小柯文件PDF助手"
APP_ID = "XiaoKePdf"
VERSION = "1.0.0"
REPO = "achir1015/xiaoke-pdf"


def resource(*parts):
    """程式資源（字型、圖示）的路徑；打包成 exe 後在 _MEIPASS 底下。"""
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)


def data_dir(*parts):
    """使用者資料（設定、自動保存、最近開啟）：%LOCALAPPDATA%\\XiaoKePdf"""
    root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    p = os.path.join(root, APP_ID, *parts)
    os.makedirs(p if not os.path.splitext(p)[1] else os.path.dirname(p), exist_ok=True)
    return p


HUNINN = resource("assets", "fonts", "jf-openhuninn-2.1.ttf")
