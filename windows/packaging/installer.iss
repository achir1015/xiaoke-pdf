; 小柯文件PDF助手 Windows 版安裝程式（Inno Setup 6）
; 由 packaging\build.py 呼叫：ISCC /DAppVersion=1.0.0 packaging\installer.iss

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "小柯文件PDF助手"
#define AppExe "XiaoKePdf.exe"
#define Developer "吳玉柱"
#define DevEmail "achir1015@gmail.com"

[Setup]
AppId={{6B7E2C1A-3F4D-4E8B-9C21-7A5D0E9F1B42}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#Developer}
AppContact={#DevEmail}
AppCopyright=Copyright © 2026 {#Developer}（{#DevEmail}）
AppPublisherURL=https://github.com/achir1015/xiaoke-pdf
AppSupportURL=https://github.com/achir1015/xiaoke-pdf/issues
AppUpdatesURL=https://github.com/achir1015/xiaoke-pdf/releases
DefaultDirName={autopf}\XiaoKePdf
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; 預設只裝給自己（不需要系統管理員權限），也可以選擇裝給所有使用者
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=XiaoKePdf-Windows-Setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
LicenseFile=..\LICENSE.txt
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=yes
RestartApplications=yes
ChangesAssociations=yes
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} 安裝程式
VersionInfoCompany={#Developer}
VersionInfoCopyright=Copyright © 2026 {#Developer}

[Languages]
Name: "cht"; MessagesFile: "compiler:Default.isl"

[LangOptions]
; 安裝畫面的字放大一倍（視窗會跟著字一起放大）
DialogFontName=Microsoft JhengHei UI
DialogFontSize=18
WelcomeFontName=Microsoft JhengHei UI
WelcomeFontSize=26

[Messages]
SetupAppTitle=安裝程式
SetupWindowTitle=安裝 - %1
UninstallAppTitle=解除安裝
UninstallAppFullTitle=解除安裝 %1
SetupAlreadyRunning=安裝程式已經在執行中。
PrivilegesRequiredOverrideTitle=選擇安裝方式
PrivilegesRequiredOverrideInstruction=選擇安裝方式
PrivilegesRequiredOverrideText1=%1 可以安裝給所有使用者（需要系統管理員權限），或只安裝給你自己。
PrivilegesRequiredOverrideText2=%1 可以只安裝給你自己，或安裝給所有使用者（需要系統管理員權限）。
PrivilegesRequiredOverrideAllUsers=安裝給所有使用者(&A)
PrivilegesRequiredOverrideAllUsersRecommended=安裝給所有使用者（建議）(&A)
PrivilegesRequiredOverrideCurrentUser=只安裝給我(&M)
PrivilegesRequiredOverrideCurrentUserRecommended=只安裝給我（建議）(&M)
ErrorCreatingDir=無法建立資料夾「%1」
ExitSetupTitle=結束安裝
ExitSetupMessage=安裝尚未完成。如果現在結束，程式不會被安裝。%n%n你可以之後再執行安裝程式完成安裝。%n%n確定要結束嗎？
ButtonBack=< 上一步(&B)
ButtonNext=下一步(&N) >
ButtonInstall=安裝(&I)
ButtonOK=確定
ButtonCancel=取消
ButtonYes=是(&Y)
ButtonYesToAll=全部皆是(&A)
ButtonNo=否(&N)
ButtonNoToAll=全部皆否(&O)
ButtonFinish=完成(&F)
ButtonBrowse=瀏覽(&B)...
ButtonWizardBrowse=瀏覽(&R)...
ButtonNewFolder=建立新資料夾(&M)
SelectLanguageTitle=選擇安裝語言
BrowseDialogTitle=選擇資料夾
BrowseDialogLabel=在下面清單中選擇資料夾，然後按「確定」。
NewFolderName=新資料夾
WelcomeLabel1=歡迎使用 [name] 安裝精靈
WelcomeLabel2=這會在你的電腦上安裝 [name/ver]。%n%n在電腦上閱讀、編輯、註解、填寫、簽署與整理 PDF，全部在本機完成，檔案不會上傳。%n%n開發者：{#Developer}%nEmail：{#DevEmail}%n%n建議先關閉其他應用程式再繼續。
WizardLicense=授權
LicenseLabel=繼續之前，請閱讀以下重要資訊。
LicenseLabel3=請閱讀以下授權。你必須接受授權的條款才能繼續安裝。
LicenseAccepted=我接受授權(&A)
LicenseNotAccepted=我不接受授權(&D)
WizardSelectDir=選擇安裝位置
SelectDirDesc=要把 [name] 安裝在哪裡？
SelectDirLabel3=安裝程式會把 [name] 安裝到以下資料夾。
SelectDirBrowseLabel=按「下一步」繼續。如果要選擇其他資料夾，請按「瀏覽」。
DiskSpaceGBLabel=至少需要 [gb] GB 的可用磁碟空間。
DiskSpaceMBLabel=至少需要 [mb] MB 的可用磁碟空間。
DiskSpaceWarningTitle=磁碟空間不足
DiskSpaceWarning=安裝至少需要 %1 KB 的可用空間，但所選的磁碟只有 %2 KB。%n%n仍然要繼續嗎？
DirExistsTitle=資料夾已存在
DirExists=資料夾：%n%n%1%n%n已經存在。仍然要安裝到這個資料夾嗎？
DirDoesntExist=資料夾：%n%n%1%n%n不存在。要建立這個資料夾嗎？
WizardSelectTasks=選擇其他工作
SelectTasksDesc=要執行哪些其他工作？
SelectTasksLabel2=選擇安裝 [name] 時要執行的其他工作，然後按「下一步」。
WizardReady=準備安裝
ReadyLabel1=安裝程式已經準備好在你的電腦上安裝 [name]。
ReadyLabel2a=按「安裝」開始安裝；如果要檢查或變更設定，請按「上一步」。
ReadyLabel2b=按「安裝」開始安裝。
ReadyMemoDir=安裝位置：
ReadyMemoGroup=開始功能表資料夾：
ReadyMemoTasks=其他工作：
WizardPreparing=準備安裝
PreparingDesc=安裝程式正在準備在你的電腦上安裝 [name]。
ApplicationsFound=以下程式正在使用需要更新的檔案。建議讓安裝程式自動關閉這些程式。
ApplicationsFound2=以下程式正在使用需要更新的檔案。建議讓安裝程式自動關閉這些程式。安裝完成後會嘗試重新啟動它們。
CloseApplications=自動關閉這些程式(&A)
DontCloseApplications=不要關閉這些程式(&D)
WizardInstalling=正在安裝
InstallingLabel=正在把 [name] 安裝到你的電腦，請稍候。
FinishedHeadingLabel=[name] 安裝完成
FinishedLabelNoIcons=已經在你的電腦上安裝好 [name]。
FinishedLabel=已經在你的電腦上安裝好 [name]。可以從開始功能表或桌面捷徑開啟。%n%n開發者：{#Developer}（{#DevEmail}）
ClickFinish=按「完成」結束安裝。
RunEntryExec=開啟 %1
StatusExtractFiles=正在解壓縮檔案...
StatusCreateIcons=正在建立捷徑...
StatusCreateRegistryEntries=正在建立登錄項目...
StatusSavingUninstall=正在儲存解除安裝資訊...
StatusRollback=正在復原變更...
ConfirmUninstall=確定要完全移除 %1 嗎？%n%n（你的設定、簽名與憑證不會被刪除）
UninstallStatusLabel=正在從你的電腦移除 %1，請稍候。
UninstalledAll=已經從你的電腦移除 %1。
WizardUninstalling=解除安裝
StatusUninstalling=正在解除安裝 %1...

[Tasks]
Name: "desktopicon"; Description: "建立桌面捷徑"; GroupDescription: "捷徑："
Name: "openwith"; Description: "加入 PDF 檔案的「開啟方式」選單（不會變更預設的 PDF 程式）"; GroupDescription: "檔案關聯："

[Files]
Source: "..\dist\XiaoKePdf\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "閱讀、編輯、註解、簽署 PDF"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; 「開啟方式」：註冊程式代號，並加入 .pdf 的 OpenWithProgids（不搶預設程式）
Root: HKA; Subkey: "Software\Classes\XiaoKePdf.PDF"; ValueType: string; ValueName: ""; ValueData: "PDF 文件"; Flags: uninsdeletekey; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\XiaoKePdf.PDF\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExe},0"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\XiaoKePdf.PDF\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: string; ValueName: "XiaoKePdf.PDF"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".pdf"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""

[Run]
Filename: "{app}\{#AppExe}"; Description: "開啟 {#AppName}"; Flags: nowait postinstall skipifsilent
