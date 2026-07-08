@echo off
cd /d "%~dp0"
echo ============================================
echo  FundFinder - Complete Git Fix
echo ============================================
echo.
echo [1] Removing corrupted git index...
del /f ".git\index.lock" 2>nul
del /f ".git\index"
echo     Done.

echo [2] Rebuilding index from HEAD...
git reset HEAD
echo     Done.

echo [3] Staging the correct files...
git add scripts/scraper.js
git add opportunity-hub.html
echo     Done.

echo [4] Committing...
git commit -m "fix: correct scraper.js (remove duplication) + add last-run-date update"

echo [5] Force-pushing to GitHub (overwrites the broken doubled file)...
git push --force origin main

echo.
echo ============================================
if %ERRORLEVEL% == 0 (
    echo  SUCCESS! GitHub now has the correct files.
    echo  Last Run date will update daily from now on.
) else (
    echo  Something went wrong - see error above.
)
echo ============================================
pause
