# ============================================================
# FundFinder AI — One-Click Netlify Deploy Script
# Double-click this file anytime to push the site live.
# ============================================================

$SiteId = "6e303fcf-c0bf-4c8b-a31b-915d928a4312"
$Token  = "nfp_2BWxKN8cG9CRQGoCcAixBWcUMZzd6yiL632b"
$Folder = $PSScriptRoot
$ZipPath = "$env:TEMP\fundfinder-deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  FundFinder AI — Deploying to Netlify..." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

# Step 1 — Zip the site folder
Write-Host "Step 1/3 — Zipping site folder..." -ForegroundColor Yellow
try {
    Compress-Archive -Path "$Folder\*" -DestinationPath $ZipPath -Force
    $size = [math]::Round((Get-Item $ZipPath).Length / 1KB, 1)
    Write-Host "         Done. ($size KB)" -ForegroundColor Gray
} catch {
    Write-Host "ERROR zipping files: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Step 2 — Push to Netlify API
Write-Host "Step 2/3 — Pushing to Netlify..." -ForegroundColor Yellow
try {
    $headers = @{
        "Authorization" = "Bearer $Token"
        "Content-Type"  = "application/zip"
    }
    $zipBytes = [System.IO.File]::ReadAllBytes($ZipPath)
    $response = Invoke-RestMethod `
        -Uri "https://api.netlify.com/api/v1/sites/$SiteId/deploys" `
        -Method POST `
        -Headers $headers `
        -Body $zipBytes
    Write-Host "         Deploy ID: $($response.id)" -ForegroundColor Gray
} catch {
    Write-Host "ERROR deploying to Netlify: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Tip: Check your internet connection and that the API token is valid." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Step 3 — Cleanup
Write-Host "Step 3/3 — Cleaning up temp files..." -ForegroundColor Yellow
Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
Write-Host "         Done." -ForegroundColor Gray

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  DEPLOYED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "  Live at: https://opportunities.a2fpartners.com" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Deploy state: $($response.state)" -ForegroundColor White
Write-Host "Started at:   $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor White
Write-Host ""

Start-Sleep -Seconds 2
Start-Process "https://opportunities.a2fpartners.com"

Read-Host "Press Enter to close"
