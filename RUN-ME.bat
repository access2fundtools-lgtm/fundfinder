@echo off
cd /d "%~dp0"
echo ============================================ > "%~dp0git-log.txt" 2>&1
echo  FundFinder Git Fix Log >> "%~dp0git-log.txt" 2>&1
echo ============================================ >> "%~dp0git-log.txt" 2>&1
echo. >> "%~dp0git-log.txt" 2>&1

echo Removing git locks and corrupted index... >> "%~dp0git-log.txt" 2>&1
del /f ".git\index.lock" >> "%~dp0git-log.txt" 2>&1
del /f ".git\HEAD.lock" >> "%~dp0git-log.txt" 2>&1
del /f ".git\index" >> "%~dp0git-log.txt" 2>&1

echo Rebuilding index... >> "%~dp0git-log.txt" 2>&1
git reset HEAD >> "%~dp0git-log.txt" 2>&1

echo Staging files... >> "%~dp0git-log.txt" 2>&1
git add scripts/scraper.js >> "%~dp0git-log.txt" 2>&1
git add opportunity-hub.html >> "%~dp0git-log.txt" 2>&1

echo Committing... >> "%~dp0git-log.txt" 2>&1
git commit -m "fix: correct scraper.js and add last-run-date update" >> "%~dp0git-log.txt" 2>&1

echo Pushing... >> "%~dp0git-log.txt" 2>&1
git push --force origin main >> "%~dp0git-log.txt" 2>&1

echo DONE >> "%~dp0git-log.txt" 2>&1
echo Exit code: %ERRORLEVEL% >> "%~dp0git-log.txt" 2>&1
