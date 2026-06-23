# FundFinder AI — GitHub Auto-Deploy Setup Guide

Once this is done, every update made to files in this folder will go live on
`opportunities.a2fpartners.com` with a single `git push` — no manual steps.

---

## STEP 1 — Create a GitHub Repository

1. Go to **https://github.com/new**
2. Fill in:
   - **Repository name:** `fundfinder-ai` (or any name you like)
   - **Visibility:** Private (recommended — keeps your token hidden)
   - **Do NOT** tick "Add a README" or any other initialisation options
3. Click **Create repository**
4. Copy the repository URL shown — it will look like:
   `https://github.com/YOUR-USERNAME/fundfinder-ai.git`

---

## STEP 2 — Push This Folder to GitHub

Open **PowerShell** or **Command Prompt**, then run these commands one by one.
Replace `YOUR-GITHUB-URL` with the URL you copied in Step 1.

```powershell
# Navigate to the FundFinder AI folder
cd "C:\Users\user\Claude\Projects\Funding Opportunities"

# Initialise a git repository
git init

# Stage all files
git add .

# Make the first commit
git commit -m "FundFinder AI — initial deployment"

# Set the branch name to main
git branch -M main

# Add your GitHub repo as the remote
git remote add origin YOUR-GITHUB-URL

# Push everything to GitHub
git push -u origin main
```

GitHub may ask you to log in — use your GitHub username and a
**Personal Access Token** (not your password).
To create one: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → tick `repo` scope.

---

## STEP 3 — Connect GitHub to Your Existing Netlify Site

1. Go to **https://app.netlify.com** and open your FundFinder AI site
2. Click **Site configuration** → **Build & deploy** → **Link to Git repository**
3. Choose **GitHub** and authorise Netlify
4. Select the `fundfinder-ai` repository you just created
5. Netlify will detect the `netlify.toml` file automatically — no extra settings needed
6. Click **Save** — Netlify will run an immediate deploy from GitHub

---

## STEP 4 — How It Works Going Forward

Every time files in this folder are updated (by you or by FundFinder AI's daily run):

```powershell
cd "C:\Users\user\Claude\Projects\Funding Opportunities"
git add .
git commit -m "Daily update — June 22"
git push
```

Netlify detects the push and deploys automatically — usually live within 30–60 seconds.
You can watch the deploy at: https://app.netlify.com

---

## QUICK DEPLOY — ONE COMMAND

After the initial setup, save this as a shortcut. Open PowerShell and run:

```powershell
cd "C:\Users\user\Claude\Projects\Funding Opportunities"; git add .; git commit -m "Update $(Get-Date -Format 'yyyy-MM-dd')"; git push
```

That's it. One line. Site is live.

---

## WHILE YOU SET UP GITHUB

Use `deploy-to-netlify.ps1` (also in this folder) as your manual deploy method.
Right-click it → **Run with PowerShell** — it zips the site and pushes to Netlify directly.

---

## NEED HELP?

Email: funding@a2fpartners.com
