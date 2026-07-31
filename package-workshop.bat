@echo off
rem Package the workshop release - excludes .env / private key / node_modules / personal saves
rem Output: dist\cz-rules-engine\ and dist\cz-rules-engine.zip
setlocal

set SRC=%~dp0
set DIST=%~dp0dist\cz-rules-engine

if exist "%~dp0dist" rmdir /s /q "%~dp0dist"
mkdir "%DIST%"

echo [1/2] Copying files...
robocopy "%SRC%." "%DIST%" /E /NFL /NDL /NJH /XD node_modules cert dist .git "%SRC%data\archives" /XF .env autosave.json autosave.json.bak autosave.json.tmp *.log patch-simulator.js package-workshop.bat >nul
rem robocopy exit codes 0-7 are all success
if %errorlevel% gtr 7 (
    echo [ERROR] Copy failed.
    pause
    exit /b 1
)

echo [2/2] Creating zip...
powershell -NoProfile -Command "Compress-Archive -Path '%DIST%\*' -DestinationPath '%~dp0dist\cz-rules-engine.zip' -Force"
if %errorlevel% neq 0 (
    echo [ERROR] Zip failed.
    pause
    exit /b 1
)

echo.
echo ============================
echo   Done!
echo   Folder: dist\cz-rules-engine\
echo   Zip:    dist\cz-rules-engine.zip
echo.
echo   Excluded: .env, cert/, node_modules/,
echo             autosave, archives, logs
echo ============================
echo.
pause
