@echo off
REM S3 File Manager - Windows startup script
REM All ASCII, no Chinese characters in .bat files

set NODE_EXE=D:\Program Files\nodejs\node.exe
set NPM_CLI=D:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js
set SERVER_DIR=%~dp0server
set WEB_DIR=%~dp0web

echo ============================================
echo   S3 File Manager
echo ============================================
echo.

REM Check .env exists
if not exist "%SERVER_DIR%\.env" (
  echo [WARN] server\.env not found. Copying from .env.example...
  copy "%SERVER_DIR%\.env.example" "%SERVER_DIR%\.env" >nul
  echo [INFO] Please edit server\.env with your S3 credentials, then re-run.
  echo.
  notepad "%SERVER_DIR%\.env"
  pause
  exit /b 0
)

REM Check if web/dist exists, if not build it
if not exist "%WEB_DIR%\dist" (
  echo [INFO] Building frontend...
  cd /d "%WEB_DIR%"
  "%NODE_EXE%" "%NPM_CLI%" run build
  if errorlevel 1 (
    echo [ERROR] Frontend build failed. Install deps first: cd web ^& npm install
    pause
    exit /b 1
  )
  echo [INFO] Frontend built successfully.
  echo.
)

REM Start server (serves both API and frontend)
echo [INFO] Starting server on http://localhost:3001
echo [INFO] Press Ctrl+C to stop.
echo.
cd /d "%SERVER_DIR%"
"%NODE_EXE%" src\index.js
pause
