@echo off
cd /d "%~dp0"
node scripts\build.mjs
if errorlevel 1 exit /b 1
start "" "http://127.0.0.1:8787"
node server.mjs
