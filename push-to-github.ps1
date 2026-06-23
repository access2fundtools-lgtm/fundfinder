# ============================================================
# FundFinder AI — Push to GitHub (run this ONCE to set up)
# ============================================================

$Folder  = "C:\Users\user\Claude\Projects\Funding Opportunities"
$RepoUrl = "https://github.com/access2fundtools-lgtm/a2frepo.git"

Set-Location $Folder

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  FundFinder AI — Pushing to GitHub..." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

# Initialise git if not already done
if (-not (Test-Path ".git")) {
    Write-Host "Initialising git repository..." -ForegroundColor Yellow
    git init
    git branch -M main
} else {
    Write-Host "Git already initialised." -ForegroundColor Gray
}

# Add remote if not already set
$remotes = git remote 2>$null
if ($remotes -notcontains "origin") {
    Write-Host "Adding GitHub remote..." -ForegroundColor Yellow
    git remote add origin $RepoUrl
} else {
    Write-Host "Remote already set." -ForegroundColor Gray
    git remote set-url origin $RepoUrl
}

# Stage and commit everything
Write-Host ""
Write-Host "Staging all files..." -ForegroundColor Yellow
git add .

Write-Host "Committing..." -ForegroundColor Yellow
git commit -m "FundFinder AI — initial deployment $(Get-Date -Format 'yyyy-MM-dd')"

# Push
Write-Host ""
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
Write-Host "(GitHub may ask for your username + Personal Access Token)" -ForegroundColor Cyan
Write-Host ""
git push -u origin main

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  DONE! Files are now on GitHub." -ForegroundColor Green
Write-Host "  Next: connect the repo to Netlify." -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"
