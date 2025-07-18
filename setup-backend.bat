@echo off
echo ====================================
echo    Smart POS Backend Setup
echo ====================================
echo.

echo Navigating to backend directory...
cd /d "C:\Users\NUMERI\POSPROJECT\smart-pos-backend"

echo.
echo Installing dependencies...
call npm install

echo.
echo Running database migrations...
call npx prisma migrate dev

echo.
echo Seeding database with test data...
call npx prisma db seed

echo.
echo Starting backend server...
call npm run dev

echo.
echo ====================================
echo     Backend Setup Complete!
echo ====================================
pause
