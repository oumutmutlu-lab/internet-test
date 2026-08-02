Set WshShell = CreateObject("WScript.Shell")
' Sunucuyu arka planda gizli pencerede baslat
WshShell.Run """C:\Users\UMUT\Documents\antigravity\nifty-bell\start-server.bat""", 0, False
' Sunucunun ayaga kalkmasi icin 6 saniye bekle
WScript.Sleep 6000
' Tarayicida otomatik ac
WshShell.Run "http://localhost:8080", 1, False
Set WshShell = Nothing
