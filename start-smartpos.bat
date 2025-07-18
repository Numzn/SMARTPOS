@echo off
echo ====================================
echo    Smart POS System Startup
echo ====================================
echo.

echo Starting Backend Server...
cd /d "C:\Users\NUMERI\POSPROJECT\smart-pos-backend"
start "Backend Server" cmd /k "npm run dev"

echo.
echo Waiting 3 seconds for backend to start...
timeout /t 3 /nobreak >nul

echo.
echo Starting Frontend Server...
cd /d "C:\Users\NUMERI\POSPROJECT\smart-pos-frontend"
start "Frontend Server" cmd /k "npm run dev"

echo.
echo ====================================
echo     SMART POS SYSTEM READY!
echo ====================================
echo.
echo Backend:  http://localhost:3000
echo Frontend: http://localhost:5173
echo.
echo LOGIN CREDENTIALS:
echo.
echo ADMIN USER:
echo   Email:    admin@smartpos.com
echo   Password: admin123
echo.
echo CASHIER USER:
echo   Email:    cashier@smartpos.com  
echo   Password: cashier123
echo.
echo ====================================
echo.
pause
