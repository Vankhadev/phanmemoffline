@echo off
echo ========================================
echo KHA POS - Web App Starter
echo ========================================
echo.

REM Check if backend is running on port 3001
netstat -an | findstr :3001 >nul
if %errorlevel% equ 0 (
    echo Backend is already running on port 3001
) else (
    echo Starting backend server...
    start "Backend Server" cmd /k "cd backend && npm start"
    timeout /t 3 /nobreak >nul
)

REM Check if frontend dev server is running on port 5173
netstat -an | findstr :5173 >nul
if %errorlevel% equ 0 (
    echo Frontend is already running on port 5173
) else (
    echo Starting frontend dev server...
    start "Frontend Dev Server" cmd /k "cd frontend && npm run dev"
)

echo.
echo ========================================
echo All servers started!
echo.
echo Backend API: http://localhost:3001
echo Frontend:    http://localhost:5173
echo.
echo Database will be saved to: D:\phanmienoffline.db.json
echo ========================================
pause
