@echo off
cd /d "%~dp0"
echo ============================================
echo  FundFinder - Full Git Fix + Push All Files
echo ============================================
echo.

echo [1] Removing git lock files...
del /f ".git\index.lock" 2>nul
del /f ".git\HEAD.lock" 2>nul
del /f ".git\MERGE_HEAD" 2>nul
echo     Done.

echo [2] Staging ALL new and modified files...
git add -A
echo     Done.

echo [3] Checking what will be committed...
git status --short
echo.

echo [4] Committing everything...
git commit -m "bot: push all accumulated flyers and updates — %date%"

echo [5] Pulling remote changes first (GitHub Actions may have pushed ahead)...
git pull --rebase origin main
echo     Done.

echo [6] Pushing to GitHub (triggers Netlify auto-deploy)...
git push origin main

echo.
echo ============================================
if %ERRORLEVEL% == 0 (
    echo  SUCCESS! All files pushed to GitHub.
    echo  Netlify will now auto-deploy in ~1 minute.
    echo  Visit: https://app.netlify.com to confirm.
) else (
    echo  Normal push failed - trying force push...
    git push --force origin main
    if %ERRORLEVEL% == 0 (
        echo  SUCCESS via force push!
    ) else (
        echo  FAILED. Contact support.
    )
)
echo ============================================
pause
