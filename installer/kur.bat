@echo off
chcp 65001 >nul 2>&1
title Internet Test - Kurulum
color 0B

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║    INTERNET TEST                                      ║
echo  ║    Kurulum Sihirbazi v1.0                             ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  Bu program internet baglantinizi gercek zamanli izler,
echo  kopmalari tespit eder ve sebebini analiz eder.
echo.
echo  Kurulum sunlari yapacak:
echo    - Uygulama dosyalarini bilgisayariniza kopyalar
echo    - Masaustune kisayol olusturur
echo    - Windows baslangicina ekler (otomatik baslatma)
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\InternetTest"

echo  Kurulum klasoru: %INSTALL_DIR%
echo.
pause

echo.
echo  [1/5] Kurulum klasoru olusturuluyor...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo  [2/5] Uygulama dosyalari kopyalaniyor...
copy /Y "%~dp0app\index.html" "%INSTALL_DIR%\index.html" >nul
copy /Y "%~dp0app\style.css" "%INSTALL_DIR%\style.css" >nul
copy /Y "%~dp0app\app.js" "%INSTALL_DIR%\app.js" >nul
copy /Y "%~dp0app\sw.js" "%INSTALL_DIR%\sw.js" >nul
copy /Y "%~dp0app\manifest.json" "%INSTALL_DIR%\manifest.json" >nul
copy /Y "%~dp0app\icon-512.png" "%INSTALL_DIR%\icon-512.png" >nul
copy /Y "%~dp0app\server.ps1" "%INSTALL_DIR%\server.ps1" >nul

echo  [3/5] Baslatma dosyalari olusturuluyor...

:: Create the launcher VBS (starts server hidden + opens browser)
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%INSTALL_DIR%\server.ps1""", 0, False
echo WScript.Sleep 3000
echo WshShell.Run "http://localhost:8088", 1, False
echo Set WshShell = Nothing
) > "%INSTALL_DIR%\start.vbs"

:: Create stop script
(
echo @echo off
echo echo Sunucu durduruluyor...
echo for /f "tokens=5" %%%%a in ^('netstat -aon ^| findstr :8088 ^| findstr LISTENING'^) do taskkill /PID %%%%a /F ^>nul 2^>^&1
echo echo Tamam.
echo timeout /t 2 ^>nul
) > "%INSTALL_DIR%\stop.bat"

echo  [4/5] Masaustu kisayolu olusturuluyor...

:: Create desktop shortcut using VBS
(
echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
echo sLinkFile = oWS.SpecialFolders^("Desktop"^) ^& "\Internet Test.lnk"
echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
echo oLink.TargetPath = "%INSTALL_DIR%\start.vbs"
echo oLink.WorkingDirectory = "%INSTALL_DIR%"
echo oLink.Description = "Internet Test - Baglanti Izleme"
echo oLink.WindowStyle = 7
echo oLink.Save
) > "%TEMP%\create_shortcut.vbs"
cscript //nologo "%TEMP%\create_shortcut.vbs"
del "%TEMP%\create_shortcut.vbs"

echo  [5/5] Windows baslangicina ekleniyor...
copy /Y "%INSTALL_DIR%\start.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\InternetTest.vbs" >nul

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║    Kurulum basariyla tamamlandi!                      ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  - Masaustunuzdeki "Internet Test" kisayoluna tiklayin
echo  - Bilgisayar her acildiginda otomatik baslayacak
echo  - Kaldirmak icin: %INSTALL_DIR%\kaldir.bat
echo.

:: Create uninstaller
(
echo @echo off
echo chcp 65001 ^>nul 2^>^&1
echo title Internet Test - Kaldirma
echo echo.
echo echo  Internet Test kaldiriliyor...
echo echo.
echo echo  Sunucu durduruluyor...
echo for /f "tokens=5" %%%%a in ^('netstat -aon ^| findstr :8088 ^| findstr LISTENING'^) do taskkill /PID %%%%a /F ^>nul 2^>^&1
echo echo  Baslangic kaydi siliniyor...
echo del /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\InternetTest.vbs" ^>nul 2^>^&1
echo echo  Masaustu kisayolu siliniyor...
echo del /Q "%USERPROFILE%\Desktop\Internet Test.lnk" ^>nul 2^>^&1
echo echo  Uygulama dosyalari siliniyor...
echo timeout /t 2 /nobreak ^>nul
echo rmdir /S /Q "%INSTALL_DIR%" 2^>nul
echo echo.
echo echo  Kaldirma tamamlandi!
echo echo.
echo pause
) > "%INSTALL_DIR%\kaldir.bat"

:: Ask to launch now
echo  Simdi baslatmak ister misiniz? (E/H)
set /p LAUNCH_NOW=  > 
if /i "%LAUNCH_NOW%"=="E" (
    echo.
    echo  Baslatiliyor...
    start "" "%INSTALL_DIR%\start.vbs"
)

echo.
echo  Iyi kullanimlar!
echo.
pause
