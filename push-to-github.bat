@echo off
cd /d "%~dp0"
echo ============================================
echo  FundFinder - Push Last Run Date Fix
echo ============================================
echo.

echo [1/5] Removing git lock if it exists...
if exist ".git\index.lock" (
    del /f ".git\index.lock"
    echo     Lock removed.
) else (
    echo     No lock found.
)

echo [2/5] Stashing local changes temporarily...
git stash

echo [3/5] Pulling latest from GitHub...
git pull --rebase origin main

echo [4/5] Restoring your changes...
git stash pop

echo [5/5] Staging, committing and pushing the fix...
git add scripts/scraper.js opportunity-hub.html
git commit -m "fix: auto-update Last Run date on every scraper run"
git push origin main

echo.
echo ============================================
if %ERRORLEVEL% == 0 (
    echo  SUCCESS! Fix pushed to GitHub.
    echo  The Last Run date will now update daily.
) else (
    echo  Something went wrong. See error above.
)
echo ============================================
pause
