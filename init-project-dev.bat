@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"

echo ==============================================
echo Starting frontend and backend in external CMD windows
echo ==============================================
echo.

if not exist "%ROOT%.backend\package.json" (
  echo ERROR: backend not found in .backend
  exit /b 1
)

if not exist "%ROOT%.frontend\BlockJarTip\package.json" (
  echo ERROR: frontend not found in .frontend\BlockJarTip
  exit /b 1
)

start "BlockJarTip Backend" cmd /k "cd /d ""%ROOT%.backend"" && npm run dev"
start "BlockJarTip Frontend" cmd /k "cd /d ""%ROOT%.frontend\BlockJarTip"" && npm run dev"

echo Windows opened:
echo - Backend
echo - Frontend
echo.
echo You can close this terminal now.
exit /b 0
