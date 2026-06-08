# Start Postgres + backend for local dev (run frontend separately: npm run dev)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "Starting PostgreSQL..."
docker compose up -d
Start-Sleep -Seconds 5

Write-Host "Starting API on http://localhost:4000 ..."
$env:PORT = "4000"
node index.js
