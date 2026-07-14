@echo off
rem Double-click this file to open the VidLab site in your browser.
start "VidLab site - keep open while using the tools" /min "%USERPROFILE%\.bun\bin\bun.exe" run "%~dp0serve-site.js"
timeout /t 2 >nul
start "" "http://localhost:8080/videotools/"
