# One-shot: Postgres (Docker) + schema + seed + validate
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "Starting PostgreSQL (Docker)..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker failed. Start Docker Desktop, then run again."
    exit 1
}

Write-Host "Waiting for Postgres..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    docker compose exec -T postgres pg_isready -U smartpos -d smartpos 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Write-Host "ERROR: Postgres did not become ready in time."
    exit 1
}

Write-Host "Applying schema..."
npx prisma generate
npx prisma db push --accept-data-loss
npx prisma db seed

Write-Host "Running validation..."
node "$Root\scripts\validate-system.js"
