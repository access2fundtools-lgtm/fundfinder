@echo off
cd /d "%~dp0"
echo ============================================
echo  FundFinder - Fix Git + Push Date Fix
echo ============================================
echo.

echo [1/6] Removing git locks and corrupted index...
if exist ".git\index.lock" del /f ".git\index.lock"
if exist ".git\index" del /f ".git\index"
echo     Done.

echo [2/6] Rebuilding git index from HEAD...
git reset HEAD
echo     Done.

echo [3/6] Pulling latest changes from GitHub...
git pull origin main
echo     Done.

echo [4/6] Staging the Last Run date fix files...
git add scripts/scraper.js
git add opportunity-hub.html
echo     Done.

echo [5/6] Committing...
git commit -m "fix: auto-update Last Run date on every scraper run"

echo [6/6] Pushing to GitHub...
git push origin main

echo.
echo ============================================
if %ERRORLEVEL% == 0 (
    echo  SUCCESS! Fix is live on GitHub.
    echo  Last Run date will now update daily.
) else (
    echo  Something went wrong - see error above.
)
echo ============================================
pause
