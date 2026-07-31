@echo off
title CZ Rules Engine

echo ============================
echo   CZ Rules Engine v2.0
echo ============================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    echo Install from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [First Run] Installing dependencies...
    call npm install --registry=https://registry.npmmirror.com
    if %errorlevel% neq 0 (
        echo [ERROR] Install failed. Check network.
        pause
        exit /b 1
    )
)

if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
    )
)

echo Server starting...
echo   API URL: http://localhost:3456/v1
echo   Set game BYOK Base URL to the address above
echo   Press Ctrl+C to stop
echo ============================
echo.

node src/server.js

pause
