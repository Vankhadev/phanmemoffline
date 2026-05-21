@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
if not defined KHA_BACKEND_HOST set "KHA_BACKEND_HOST=127.0.0.1"
if not defined KHA_BACKEND_PORT set "KHA_BACKEND_PORT=3001"
set "BACKEND_HOST=%KHA_BACKEND_HOST%"
set "BACKEND_PORT=%KHA_BACKEND_PORT%"
set "FRONTEND_HOST=127.0.0.1"
set "FRONTEND_PORT=5174"
set "BACKEND_HEALTH_URL=http://%BACKEND_HOST%:%BACKEND_PORT%/api/health"
set "FRONTEND_URL=http://%FRONTEND_HOST%:%FRONTEND_PORT%"
set "DB_PATH=%ROOT_DIR%\backend\data\phanmienoffline.db.json"

echo ========================================
echo KHA POS - Web App Starter
echo ========================================
echo.

call :check_backend_health
if %errorlevel% equ 0 (
    echo Backend health check OK at %BACKEND_HEALTH_URL%
) else (
    echo Starting backend server...
    start "Backend Server" cmd /k "cd /d %ROOT_DIR%\backend && set KHA_BACKEND_HOST=%BACKEND_HOST%&& set KHA_BACKEND_PORT=%BACKEND_PORT%&& set PORT=%BACKEND_PORT%&& set KHA_DB_PATH=%DB_PATH%&& npm start"
    call :wait_for_backend_health 30
    if errorlevel 1 (
        echo Backend did not become healthy at %BACKEND_HEALTH_URL%
        echo Please inspect the Backend Server window for details.
        echo ========================================
        pause
        exit /b 1
    )
    echo Backend health check OK at %BACKEND_HEALTH_URL%
)

call :check_frontend_health
if %errorlevel% equ 0 (
    echo Frontend dev server responded at %FRONTEND_URL%
) else (
    echo Starting frontend dev server...
    start "Frontend Dev Server" cmd /k "cd /d %ROOT_DIR%\frontend && set VITE_BACKEND_HOST=%BACKEND_HOST%&& set VITE_BACKEND_PORT=%BACKEND_PORT%&& npm run dev -- --host %FRONTEND_HOST% --port %FRONTEND_PORT% --strictPort"
    call :wait_for_frontend_health 30
    if errorlevel 1 (
        echo Frontend did not respond at %FRONTEND_URL%
        echo Please inspect the Frontend Dev Server window for details.
        echo ========================================
        pause
        exit /b 1
    )
    echo Frontend dev server responded at %FRONTEND_URL%
)

echo.
echo ========================================
echo All servers started and healthy.
echo.
echo Backend API: %BACKEND_HEALTH_URL%
echo Frontend:    %FRONTEND_URL%
echo.
echo Database will be saved to: %DB_PATH%
echo ========================================
pause
exit /b 0

:check_backend_health
curl -fsS --max-time 2 "%BACKEND_HEALTH_URL%" | findstr /i /c:"\"ok\":true" >nul
if errorlevel 1 exit /b 1
curl -fsS --max-time 2 "%BACKEND_HEALTH_URL%" | findstr /i /c:"\"service\":\"phanmienoffline-backend\"" >nul
exit /b %errorlevel%

:wait_for_backend_health
set "MAX_ATTEMPTS=%~1"
for /L %%i in (1,1,%MAX_ATTEMPTS%) do (
    call :check_backend_health
    if !errorlevel! equ 0 exit /b 0
    timeout /t 1 /nobreak >nul
)
exit /b 1

:check_frontend_health
curl -fsS --max-time 2 "%FRONTEND_URL%/" | findstr /i "<!doctype html>" >nul
exit /b %errorlevel%

:wait_for_frontend_health
set "MAX_ATTEMPTS=%~1"
for /L %%i in (1,1,%MAX_ATTEMPTS%) do (
    call :check_frontend_health
    if !errorlevel! equ 0 exit /b 0
    timeout /t 1 /nobreak >nul
)
exit /b 1
