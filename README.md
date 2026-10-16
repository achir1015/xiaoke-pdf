# 小柯文件PDF助手（XiaoKePdf）

手機版 PDF 閱讀與編輯 App（Android），功能參考 [PdfCraft](https://github.com/storytold/pdfcraft)。
閱讀、編輯文字、註解、填表、簽署、整理頁面、合併分割、加密、塗銷、移除浮水印……全部在手機上完成。

**隱私至上：文件絕對不會離開你的裝置。** 不需要帳號、不收集使用資料、沒有雲端處理。只有按「檢查更新」時會連到 GitHub 查詢新版。

<img src="docs/edit-text.png" width="240" alt="編輯文字與格式"> <img src="docs/edited.png" width="240" alt="修改後的文字"> <img src="docs/remove-watermark.png" width="240" alt="移除浮水印">

## 📲 下載安裝（Android 7.0 以上）

**[⬇️ 下載 XiaoKePdf.apk（v1.0.1）](https://github.com/achir1015/xiaoke-pdf/raw/main/release/XiaoKePdf.apk)**

也可以到 [Releases 頁面](https://github.com/achir1015/xiaoke-pdf/releases/latest) 下載。

<img src="release/qr.png" width="180" alt="手機掃描下載 APK">

1. 用手機開上面的連結，或用相機掃 QR Code 下載 APK（約 19 MB）。
2. 下載完成後點開檔案。如果出現「為了安全起見，你的手機目前無法安裝來自這個來源的應用程式」，按「設定」→ 開啟「允許來自這個來源的應用程式」→ 返回再按「安裝」。
3. 三星手機如果被 Play Protect 擋下，選「更多詳細資料」→「仍要安裝」。
4. 安裝後打開「小柯文件PDF助手」，按「開啟檔案」選 PDF；也可以從 LINE、Gmail、檔案管理等 App 用「分享」或「開啟方式」把 PDF 交給它。
5. 之後要更新：在 App 首頁最下方（或「⋮ → 設定」）按「檢查更新」，有新版會自動下載並開啟安裝畫面，直接安裝覆蓋即可，開著的文件與設定都會保留。第一次更新時，Android 會要求允許本 App「安裝未知應用程式」。

## 功能

### 閱讀
- 連續捲動、單頁、雙頁、檢視旋轉、全螢幕無干擾閱讀
- 放大後只重繪看得到的區塊，放多大文字都清晰
- 淺色 / 深色主題、夜間頁面（反白）、護眼色
- 多分頁：未儲存的分頁有圓點、長按分頁可關閉其他、重新開啟上次關閉的分頁、顯示檔案
- 書籤（可搜尋，保留上層脈絡）、頁面縮圖、文件自己的頁面標籤（i、ii、1、2…）
- 搜尋整份文件，逗號分隔可同時找多個詞；長按選取文字、複製、分享
- 受損的檔案會自動修復；加密檔案輸入密碼即可開啟，並遵守作者設定的權限

### 編輯
- **編輯文字**：點一下頁面上的文字，直接修改那一行
- **新增文字**：字型（黑體／明體／等寬）、大小、文字顏色、背景顏色、粗體、底線、刪除線，附即時預覽
- 中文使用內建的開放授權字型，寫入後是可以搜尋、複製的真正文字
- 新增圖片、連結、浮水印、頁首頁尾與頁碼、裁切頁面、頁面標籤、書籤
- **移除浮水印**：標準浮水印（Acrobat 或本 App 加入的）、依文字移除、依圖層移除

### 註解、表單與簽署
- 便利貼、螢光筆、底線、刪除線、波浪線、文字框、矩形、橢圓、直線、箭頭、手繪、印章
- 註解面板：回覆、審閱狀態、改顏色 / 不透明度 / 線寬、刪除
- 表單：填寫文字、核取方塊、選項按鈕、下拉選單、清單；標示欄位、清除、平面化；自己建立表單欄位
- 填寫與簽署：手寫簽名（可儲存重複使用）、日期、勾選、縮寫
- 數位簽章：用 .p12 / .pfx 憑證簽署（可見或不可見）、驗證簽章、建立自簽憑證

### 頁面與檔案
- 整理頁面：多選、旋轉、刪除、插入空白頁、從其他檔案插入、前後移動、反轉、擷取
- 合併多個 PDF（每個檔案一個書籤，原本的書籤放在底下）、擷取頁面、每 N 頁分割、指定頁前分割
- 建立 PDF：圖片轉 PDF、空白文件、文字、相機掃描
- 匯出：圖片（PNG / JPG）、純文字、Word（.docx）
- 壓縮 PDF、列印、轉灰階、比較兩份文件的文字差異

### 安全與隱私
- 密碼保護（AES-256）與權限設定、移除保護、移除隱藏資訊
- 塗銷：框選或搜尋後永久移除內容
- 文件屬性：標題、作者、主旨、關鍵字可編輯；字型與嵌入狀態、PDF 版本、頁面大小、完整安全性資訊

### 可靠的儲存
- 每次編輯都是一個步驟，可以一直復原 / 重做，**儲存後仍然可以復原**
- 存檔前先寫到暫存檔並驗證，再覆蓋原檔
- 每分鐘自動保存；App 意外結束後，下次開啟會詢問是否恢復未儲存的工作

### 工具
- 所有工具目錄、指令面板（搜尋所有工具和指令）
- 測量距離與面積（可設比例尺）、無障礙檢查與修正、引導式動作（發佈前清理、寄送前準備、封存、匯出註解）

> OCR 文字辨識還在開發中（預計 v1.2）。

## 編譯（不用 Gradle）

需要 Python 3.8+、JDK 17、Android SDK（build-tools 34.0.0、platforms/android-34）。
在專案根目錄建立 `local.properties`：

```properties
sdk.dir=C:\\Android\\Sdk
jdk.dir=C:\\Program Files\\Java\\jdk-17
```

```bash
python build.py
```

產生 `build/XiaoKePdf.apk`。加上 `install` 參數會用 adb 安裝並啟動。第一次編譯會自動產生簽章金鑰 `xiaokepdf.jks`（不會上傳到 GitHub）。

## 使用的開放原始碼與授權

| 元件 | 用途 | 授權 |
|---|---|---|
| [PDFBox-Android](https://github.com/TomRoush/PdfBox-Android) 2.0.27.0 | PDF 解析、編輯、文字擷取 | Apache 2.0 |
| [Bouncy Castle](https://www.bouncycastle.org/) 1.72 | 數位簽章 | MIT |
| [jf open 粉圓](https://github.com/justfont/open-huninn-font) 2.1 | 寫入 PDF 的中文字型 | SIL Open Font License 1.1（漢字部分源自 Kosugi Maru，Apache 2.0），授權全文見 `assets/fonts/jf-openhuninn-OFL.txt` |

頁面繪製使用 Android 內建的 PdfRenderer。
