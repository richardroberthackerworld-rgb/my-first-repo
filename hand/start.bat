@echo off
REM ============================================================
REM  7Hand - start a local server and open the app.
REM
REM  This is needed because the app loads JavaScript modules, and
REM  browsers refuse to load those from a file:// page. Opening
REM  app.html directly gives a blank screen. Serving the folder
REM  over http fixes it, which is all this does.
REM ============================================================

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, and this needs it to run the little
  echo   web server.
  echo.
  echo   Install it from https://nodejs.org  ^(the LTS button^), then
  echo   double-click this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting 7Hand on http://localhost:3130
echo.
echo   Learn your handwriting:  http://localhost:3130/tools/learn.html
echo   Write with it:           http://localhost:3130/app.html
echo.
echo   Leave this window open while you work.
echo   Close it when you are done.
echo.

start "" "http://localhost:3130/START-HERE.html"
npx --yes serve -p 3130 .

endlocal
