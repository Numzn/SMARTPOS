function Probe($name, $url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        Write-Host ("[UP]   {0,-15} {1} ({2})" -f $name, $url, $r.StatusCode)
    } catch {
        Write-Host ("[DOWN] {0,-15} {1} ({2})" -f $name, $url, $_.Exception.Message)
    }
}
Probe 'frontend' 'http://localhost:8080/'
Probe 'backend'  'http://localhost:4000/api/health'
Probe 'mock-vsdc' 'http://localhost:8090/health'
Write-Host ''
$composeFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'docker-compose.yml'
docker compose -f $composeFile ps
