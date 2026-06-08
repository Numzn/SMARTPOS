Start-Process -FilePath "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
Write-Host "Waiting for Docker Desktop..."
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Docker is ready."
        exit 0
    }
}
Write-Host "Docker did not start within 3 minutes."
exit 1
