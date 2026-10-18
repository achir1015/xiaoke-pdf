# 小柯文件PDF助手（Windows 11 版）

在電腦上閱讀、編輯、註解、填寫、簽署與整理 PDF。和 Android 版、網頁版功能相同，用 Python（PySide6 ＋ PyMuPDF）開發。

**隱私至上：文件只在你的電腦上處理，絕對不會上傳。** 不需要帳號、不收集使用資料；只有檢查更新時會連到 GitHub。

開發者：吳玉柱（achir1015@gmail.com）

## 下載

**[⬇️ 下載 Windows 安裝程式（XiaoKePdf-Windows-Setup.exe）](https://github.com/achir1015/xiaoke-pdf/releases/download/win-v1.0.1/XiaoKePdf-Windows-Setup.exe)**

所有版本：<https://github.com/achir1015/xiaoke-pdf/releases>（Windows 版的 tag 是 `win-v版本`）

## 安裝

1. 執行下載的 `XiaoKePdf-Windows-Setup.exe`。如果出現「Windows 已保護您的電腦」（SmartScreen），按「其他資訊」→「仍要執行」（程式沒有購買付費的程式碼簽章憑證，不是病毒）。
2. 預設「只安裝給我」，不需要系統管理員權限（也可以選擇安裝給所有使用者）。
3. 可以勾選「建立桌面捷徑」與「加入 PDF 檔案的『開啟方式』選單」（不會改掉你原本預設的 PDF 程式）。
4. 安裝後從開始功能表或桌面開啟；也可以在檔案總管對 PDF 按右鍵 →「開啟方式」→「小柯文件PDF助手」。
5. 移除：設定 → 應用程式 → 已安裝的應用程式 →「小柯文件PDF助手」→ 解除安裝。你的設定、簽名與憑證會保留在 `%LOCALAPPDATA%\XiaoKePdf`。

系統需求：Windows 10 / 11（64 位元）。

## 功能

### 閱讀
- 連續捲動、單頁、雙頁、檢視旋轉、全螢幕（F11）、無干擾閱讀（F10）
- 放大後只重畫看得到的區塊，放多大都清晰；Ctrl＋滾輪縮放
- 淺色／深色主題、夜間頁面（反白）、護眼色
- 多分頁：未儲存的分頁有圓點；右鍵分頁可關閉、關閉其他、重新開啟上次關閉的分頁、在檔案總管中顯示
- 側邊面板：縮圖、書籤（可搜尋、可編輯，保留上層脈絡）、註解、表單、圖層、附件
- 文件自己的頁面標籤（i、ii、1、2…）；Ctrl+G 跳頁（可輸入標籤）
- 搜尋整份文件（逗號分隔可同時找多個詞，F3 下一個）；拖曳選取文字、Ctrl+C 複製、右鍵更多動作
- 受損的檔案自動修復；加密檔案輸入密碼即可開啟，並遵守作者設定的權限
- 指令面板（Ctrl+K）搜尋所有工具與指令

### 編輯（像 Word 一樣）
- **就地編輯**：點一下頁面上的文字，原本的位置直接變成編輯框，游標在點到的地方；整段一起改、自動換行；舊字從檔案裡真正刪除
- 格式列：字型（黑體／明體／等寬）、大小、粗體、底線、刪除線、文字顏色、背景色
- **表格**：只在點到的儲存格裡編輯；字變長時那一列自動撐高（下面的內容一起往下移，放不下才縮小字級）；插入表格、插入列、插入欄、合併儲存格；空白格子可以直接打字
- 中文使用內建的 jf open 粉圓字型，寫進去的是可以搜尋、複製的真正文字
- 新增文字、圖片、QR Code、連結；貼上剪貼簿（文字、網址、圖片）
- 浮水印（文字或圖片、透明度、角度、滿版重複）、**移除浮水印**（標準浮水印、依文字、依圖層）
- 頁首頁尾與頁碼、裁切頁面、頁面標籤、書籤

### 註解、表單與簽署
- 便利貼、螢光筆、底線、刪除線、波浪線、文字框、矩形、橢圓、直線、箭頭、手繪、印章（核准、機密、草稿…或自訂文字、圖片）
- 註解面板：回覆、審閱狀態、編輯、改顏色／不透明度／線寬、刪除
- 表單：點欄位直接填寫、清除、平面化；自己建立文字欄位、核取方塊、選項按鈕、下拉選單、清單、簽名欄位
- 填寫與簽署：手寫簽名（可儲存重複使用）、日期、勾選、縮寫
- 數位簽章：用 .p12 / .pfx 憑證簽署（可見或不可見，增量更新不改原內容）、驗證簽章、建立自簽憑證

### 頁面與檔案
- 整理頁面：頁面格狀、多選（Ctrl／Shift）、旋轉、刪除、插入空白頁、從其他檔案插入、拖曳排序、前後移動、反轉、擷取
- 合併多個 PDF（每個檔案一個書籤，原本的書籤放在底下）、擷取頁面、每 N 頁分割、在指定頁之前分割
- 建立 PDF：圖片轉 PDF、文字轉 PDF、空白文件
- 匯出：圖片（PNG／JPG）、純文字、Word（.docx）；列印

### 安全與隱私
- 密碼保護（AES-256）與權限設定、移除保護、輸入擁有者密碼解除限制
- 塗銷：框選或搜尋後永久移除內容
- 移除隱藏資訊（作者、中繼資料、JavaScript、附件、隱藏文字）
- 文件屬性：標題、作者、主旨、關鍵字可編輯；字型與嵌入狀態、PDF 版本、頁面大小、完整安全性資訊

### 可靠的儲存
- 每次編輯都是一個步驟，可以一直復原／重做，**儲存後仍然可以復原**
- 存檔先寫到暫存檔並重新開啟驗證，再取代原檔；加密文件存檔後仍保持加密
- 每分鐘自動保存；程式意外結束後，下次開啟會詢問是否恢復未儲存的工作

### 其他工具
- 壓縮 PDF、轉灰階、比較兩份文件的文字差異、測量距離與面積（可設比例尺）
- 無障礙檢查與修正、引導式動作（發佈前清理、寄送前準備、封存、匯出註解）
- OCR 文字辨識（需要另外安裝免費的 Tesseract，含繁體中文語言檔）
- 檢查更新：有新版時下載並執行安裝程式

### 命令列工具

安裝資料夾裡的 `XiaoKePdf-cli.exe`：

```
XiaoKePdf-cli info  文件.pdf                         結構資訊（JSON）
XiaoKePdf-cli text  文件.pdf --page 3                依閱讀順序取出文字
XiaoKePdf-cli edit  in.pdf --rotate 1,2:90 --delete 5 --title "Q3" --out out.pdf
XiaoKePdf-cli combine a.pdf b.pdf --out 合併.pdf
XiaoKePdf-cli extract 文件.pdf --pages 1,3,5-8 --out 精選.pdf
XiaoKePdf-cli split 文件.pdf --every 10 --out-dir 分割
XiaoKePdf-cli find  文件.pdf 關鍵字
```

## 開發

需要 Python 3.12（64 位元）。

```
pip install pymupdf PySide6 pyhanko pillow qrcode pyinstaller
python -m xiaokepdf                 # 開啟視窗
python -m xiaokepdf info 文件.pdf   # 命令列
```

程式結構：

```
xiaokepdf/
├─ engine/          PDF 引擎（不依賴畫面，視窗與命令列共用）
│  ├─ session.py    工作階段：步驟式復原、安全儲存、自動保存與恢復
│  ├─ text.py       每個字的位置、分行、找段落、搜尋
│  ├─ tables.py     表格框線、儲存格、撐高列、插入列／欄、合併儲存格
│  ├─ textops.py    寫字（字型、格式、換行）、就地修改
│  ├─ pages.py      頁面與檔案操作、書籤、標籤、屬性、附件、圖層
│  ├─ annots.py     註解、印章與簽名圖片
│  ├─ forms.py      表單
│  ├─ security.py   加密、塗銷、移除隱藏資訊、壓縮
│  ├─ watermark.py  浮水印、頁首頁尾、移除浮水印
│  ├─ signing.py    數位簽章（pyHanko）
│  ├─ export.py     匯出、建立 PDF
│  └─ misc.py       QR Code、連結、比較、無障礙、OCR
├─ ui/              視窗介面（PySide6）
└─ cli.py           命令列工具
```

### 打包成安裝程式

```
winget install JRSoftware.InnoSetup
python packaging/build.py
```

產生 `dist\XiaoKePdf\`（程式）與 `dist\XiaoKePdf-Windows-Setup.exe`（安裝程式）。
發佈新版：修改 `xiaokepdf/__init__.py` 的 `VERSION`，打包後在 GitHub Releases 建立 tag `win-v版本`，上傳 `XiaoKePdf-Windows-Setup.exe`，程式裡的「檢查更新」就會找到。

## 授權

AGPL-3.0（因為使用 AGPL 授權的 PyMuPDF）。中文字型 jf open 粉圓為 SIL Open Font License 1.1。詳見 `LICENSE.txt`。
