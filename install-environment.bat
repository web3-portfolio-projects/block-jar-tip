@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"

echo ==============================================
echo Installing development environment
echo Root: %ROOT%
echo ==============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found in PATH.
  echo Install Node.js 20+ and try again.
  exit /b 1
)

call :installDir ".hardhat"
if errorlevel 1 exit /b 1

call :installDir ".backend"
if errorlevel 1 exit /b 1

call :installDir ".frontend\BlockJarTip"
if errorlevel 1 exit /b 1

echo.
echo ==============================================
echo Environment installed successfully.
echo ==============================================
exit /b 0

:installDir
set "TARGET=%~1"
echo ----------------------------------------------
echo Installing dependencies in %TARGET%
pushd "%ROOT%%TARGET%" >nul 2>nul
if errorlevel 1 (
  echo ERROR: folder not found: %TARGET%
  exit /b 1
)

if not exist "package.json" (
  echo ERROR: package.json not found in %TARGET%
  popd
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo ERROR: installation failed in %TARGET%
  popd
  exit /b 1
)

popd
echo Done: %TARGET%
echo.
exit /b 0
