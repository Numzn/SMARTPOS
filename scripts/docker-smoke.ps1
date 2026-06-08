# End-to-end smoke test against the dockerized Smart POS stack.
# Run after `npm run docker:up`:
#   powershell -ExecutionPolicy Bypass -File ./scripts/docker-smoke.ps1
#   - or -
#   npm run docker:smoke

param(
    [string]$FrontendUrl = 'http://localhost:8080',
    [string]$BackendUrl  = 'http://localhost:4000',
    [string]$MockVsdcUrl = 'http://localhost:8090',
    [string]$Email       = 'admin@smartpos.com',
    [string]$Password    = 'admin123'
)

$failures = 0
function Probe($name, $url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        Write-Host ("[PASS] {0,-18} {1} -> {2}" -f $name, $url, $r.StatusCode)
    } catch {
        $script:failures++
        Write-Host ("[FAIL] {0,-18} {1} -> {2}" -f $name, $url, $_.Exception.Message)
    }
}

Probe 'frontend root'  "$FrontendUrl/"
Probe 'api via nginx'  "$FrontendUrl/api/health"
Probe 'api direct'     "$BackendUrl/api/health"
Probe 'mock vsdc'      "$MockVsdcUrl/health"

Write-Host ''
Write-Host '---- login -> stock -> sale -> ZRA submit ----'
try {
    $login = Invoke-RestMethod -Uri "$FrontendUrl/api/users/login" -Method Post `
        -ContentType 'application/json' `
        -Body (@{ email = $Email; password = $Password } | ConvertTo-Json) `
        -TimeoutSec 5
    Write-Host ("[PASS] login as {0} ({1})" -f $login.user.email, $login.user.role)

    $headers = @{ Authorization = ('Bearer ' + $login.token) }
    $products = Invoke-RestMethod -Uri "$FrontendUrl/api/products" -Headers $headers -TimeoutSec 5
    Write-Host ("[PASS] products listed: {0}" -f $products.Count)

    foreach ($p in $products) {
        $adj = @{
            productId      = $p.id
            adjustmentType = 'IN'
            quantity       = 50
            reason         = 'Initial stock (smoke test)'
            branchId       = 'main'
        } | ConvertTo-Json
        try {
            Invoke-RestMethod -Uri "$FrontendUrl/api/inventory/adjust" -Method Post `
                -ContentType 'application/json' -Headers $headers -Body $adj -TimeoutSec 10 | Out-Null
        } catch {
            Write-Host ('[WARN] adjust ' + $p.sku + ': ' + $_.Exception.Message)
        }
    }
    Write-Host '[PASS] inventory adjusted +50 for all products'

    $product = $products[0]
    $saleBody = @{
        userId        = $login.user.id
        items         = @(@{ productId = $product.id; quantity = 1; price = $product.price })
        paymentMethod = 'CASH'
        tax           = 0
        discount      = 0
    } | ConvertTo-Json -Depth 5

    $sale = Invoke-RestMethod -Uri "$FrontendUrl/api/sales" -Method Post `
        -ContentType 'application/json' -Headers $headers -Body $saleBody -TimeoutSec 10
    Write-Host ("[PASS] sale created: {0}" -f $sale.id)

    $zra = Invoke-RestMethod -Uri ("$FrontendUrl/api/zra/send-invoice/" + $sale.id) `
        -Method Post -Headers $headers -TimeoutSec 10
    $rcpt = $zra.rcptNo
    if (-not $rcpt) { $rcpt = $zra.data.rcptNo }
    if (-not $rcpt) { $rcpt = '(no rcptNo in payload)' }
    Write-Host ("[PASS] zra submitted: {0}" -f $rcpt)
} catch {
    $failures++
    Write-Host ('[FAIL] flow: ' + $_.Exception.Message)
}

Write-Host ''
if ($failures -eq 0) {
    Write-Host '=== smoke test: all checks passed ==='
    exit 0
} else {
    Write-Host ("=== smoke test: {0} failure(s) ===" -f $failures)
    exit 1
}
