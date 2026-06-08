@echo off
echo ====================================
echo    Database Setup & Initialization
echo ====================================
echo.

cd /d "C:\Users\NUMERI\POSPROJECT\smart-pos-backend"

echo Step 1: Installing dependencies...
call npm install

echo.
echo Step 2: Generating Prisma client...
call npx prisma generate

echo.
echo Step 3: Running database migrations...
call npx prisma migrate deploy

echo.
echo Step 4: Seeding database with test users...
call npx prisma db seed

echo.
echo ====================================
echo   Database Setup Complete!
echo ====================================
echo.
echo Test Users Created:
echo   Admin: admin@smartpos.com / admin123
echo   Cashier: cashier@smartpos.com / cashier123
echo.
pause
