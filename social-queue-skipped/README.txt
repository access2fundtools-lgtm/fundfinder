WHY THESE CAPTIONS ARE NOT IN THE POSTING QUEUE
Moved here 2026-08-27.

The facebook-daily-poster task selects caption files matching YYYY-MM-DD-*.txt
in the repo root. Files in this folder do not match, so they are never posted.

Each caption in here was generated with a Nigerian framing (the 🚨 NEW FUNDING
OPPORTUNITY 🇳🇬 header) for a programme that Nigerians cannot apply to:

  kenya-artificial-intelligence...  Kenyan startups and innovators only
  sasol-mining-fence-line...        young South Africans only
  the-sasol-technician-...          young South African graduates only

The listings themselves stay live on the site with corrected country badges —
they are accurate, just not ours to broadcast. What could not stand was
promising a Nigerian audience a South African mining programme under a
Nigerian flag.

ROOT CAUSE, STILL OPEN: scripts/scraper.js writes scope "Nigeria" and the
🇳🇬 hero tag onto every listing regardless of the programme's real country.
Until that is fixed, expect this folder to keep filling up.
