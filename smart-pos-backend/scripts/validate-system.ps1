# End-to-end system validation for Smart POS Backend
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$BaseUrl = "http://localhost:4000"
$MockUrl = "http://localhost:8090"
$results = @()

function Add-Result($name, $ok, $detail) {
    $script:results += [pscustomobject]@{ Test = $name; Pass = $ok; Detail = $detail }
    $icon = if ($ok) { "PASS" } else { "FAIL" }
    Write-Host "[$icon] $name - $detail"
}

Write-Host "`n=== Smart POS System Validation ===`n"

# 1. Environment
Add-Result "Node.js" (Get-Command node -ErrorAction SilentlyContinue) $(node -v 2>$null)

# 2. Database
$dbOk = $false
try {
    $out = node test-db-connection.js 2>&1 | Out-String
    if ($out -match "Prisma connection successful") { $dbOk = $true }
} catch {}
Add-Result "PostgreSQL" $dbOk $(if ($dbOk) { "Connected" } else { "Start: npm run db:up (Docker Desktop must be running)" })

if (-not $dbOk) {
    Write-Host "`nDatabase unavailable — skipping API tests. Fix Postgres then re-run: npm run validate:system`n"
    $results | Format-Table -AutoSize
    exit 1
}

# 3. Prisma schema
try {
    npx prisma validate 2>&1 | Out-Null
    Add-Result "Prisma schema" $true "Valid"
} catch {
    Add-Result "Prisma schema" $false $_.Exception.Message
}

# 4. Start mock VSDC
$mockJob = Start-Job -ScriptBlock {
    Set-Location $using:Root
    node mock-vsdc-server.js 2>&1
}
Start-Sleep -Seconds 2
try {
    $mockHealth = Invoke-RestMethod -Uri "$MockUrl/health" -TimeoutSec 5
    Add-Result "Mock VSDC" $true $mockHealth.message
} catch {
    Add-Result "Mock VSDC" $false $_.Exception.Message
}

# 5. Start API server
$apiJob = Start-Job -ScriptBlock {
    Set-Location $using:Root
    $env:PORT = "4000"
    node index.js 2>&1
}
Start-Sleep -Seconds 3

# 6. Health check
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 10
    Add-Result "API health" ($health.status -eq "healthy") $health.message
} catch {
    Add-Result "API health" $false $_.Exception.Message
}

# 7. Login
$token = $null
try {
    $loginBody = @{ email = "admin@smartpos.com"; password = "admin123" } | ConvertTo-Json
    $login = Invoke-RestMethod -Uri "$BaseUrl/api/users/login" -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 10
    $token = $login.token
    Add-Result "Auth login" ($null -ne $token) "admin@smartpos.com"
} catch {
    Add-Result "Auth login" $false $_.Exception.Message
}

$headers = @{ Authorization = "Bearer $token" }

# 8. Products
try {
    $products = Invoke-RestMethod -Uri "$BaseUrl/api/products" -Headers $headers -TimeoutSec 10
    $count = if ($products -is [array]) { $products.Count } elseif ($products.products) { $products.products.Count } else { 1 }
    Add-Result "Products API" ($count -gt 0) "$count product(s)"
} catch {
    Add-Result "Products API" $false $_.Exception.Message
}

# 9. Inventory
try {
    $inv = Invoke-RestMethod -Uri "$BaseUrl/api/inventory" -Headers $headers -TimeoutSec 15
    $n = if ($inv.inventory) { $inv.inventory.Count } else { 0 }
    Add-Result "Inventory API" ($true) "$n item(s)"
} catch {
    Add-Result "Inventory API" $false $_.Exception.Message
}

# 10. Create sale (need user id + product)
$saleId = $null
try {
    $profile = Invoke-RestMethod -Uri "$BaseUrl/api/users/profile" -Headers $headers -TimeoutSec 10
    $prods = Invoke-RestMethod -Uri "$BaseUrl/api/products" -Headers $headers -TimeoutSec 10
    $productList = if ($prods -is [array]) { $prods } else { $prods }
    $firstProduct = $productList[0]
    if (-not $firstProduct) { throw "No products in database — run: npx prisma db seed" }

    # Ensure stock via inventory receive
    $receiveBody = @{
        productId = $firstProduct.id
        quantity  = 50
        unitCost  = 1.0
        branchId  = "main"
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$BaseUrl/api/inventory/receive" -Method POST -Headers $headers -Body $receiveBody -ContentType "application/json" -TimeoutSec 15 | Out-Null

    $saleBody = @{
        userId = $profile.id
        paymentMethod = "CASH"
        items = @(
            @{
                productId = $firstProduct.id
                quantity = 1
                price = $firstProduct.price
            }
        )
    } | ConvertTo-Json -Depth 5
    $sale = Invoke-RestMethod -Uri "$BaseUrl/api/sales" -Method POST -Headers $headers -Body $saleBody -ContentType "application/json" -TimeoutSec 15
    $saleId = $sale.id
    Add-Result "Create sale" ($null -ne $saleId) "Sale $saleId"
} catch {
    Add-Result "Create sale" $false $_.Exception.Message
}

# 11. ZRA submit
if ($saleId) {
    try {
        $zra = Invoke-RestMethod -Uri "$BaseUrl/api/zra/send-invoice/$saleId" -Method POST -Headers $headers -TimeoutSec 30
        $hasRcpt = $null -ne $zra.sale.rcptNo -or $null -ne $zra.zraResponse.rcptNo
        Add-Result "ZRA invoice" $hasRcpt $(if ($hasRcpt) { "rcptNo present" } else { "no receipt" })
    } catch {
        Add-Result "ZRA invoice" $false $_.Exception.Message
    }
}

# Cleanup
Stop-Job $mockJob, $apiJob -ErrorAction SilentlyContinue
Remove-Job $mockJob, $apiJob -Force -ErrorAction SilentlyContinue

Write-Host "`n=== Summary ===`n"
$results | Format-Table -AutoSize
$failed = ($results | Where-Object { -not $_.Pass }).Count
if ($failed -gt 0) { exit 1 }
exit 0
