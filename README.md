# S-REIT Terminal

A re-runnable Singapore REIT screener and data pipeline. Built for investors making capital-allocation decisions — accuracy and per-field source provenance over polish.

> Decision support, not investment advice. Verify every figure against the linked source before acting on it.

## What you get

- **39 SGX-listed REITs and stapled property trusts** validated against REITAS / SGX / SGinvestors (May 2026).
- **Node.js pipeline** that pulls live market data from Yahoo Finance + REIT-disclosed metrics from manager IR filings only (no aggregators).
- **A single-page web UI** with sortable filterable table, sticky-headed dense layout, sparklines, right-click context menu to jump to source, full Help page with terminology + analysis guidance, column show/hide + filter persistence + hide-REITs in localStorage.
- **Two perspective gearing metrics:** the manager-disclosed gearing (which usually excludes perpetual securities) AND a gearing-incl-perpetuals view for real leverage.
- **Property yield** (NPI / portfolio fair value) as an additional indicator — useful for spotting REITs with old leases that may reset down on renewal.
- **Authoritative-source enforcement:** the merger flags any source URL that's not from SGX / Yahoo / issuer IR / an explicitly whitelisted host. The SPA shows a ⚠ warning next to non-authoritative sources.
- **GitHub Actions** that refresh market data daily and auto-deploy the SPA to GitHub Pages.

## Quick start (local)

```bash
# 1. Refresh market data (Yahoo)
cd pipeline
node fetch_yahoo.mjs

# 2. (Optional) refresh REIT-disclosed metrics — see docs/PLAYBOOK.md §4
#    These come from manager quarterly filings. Use agent_prompts/group{1..5}.md.

# 3. Merge into the dashboard dataset
node merge.mjs

# 4. Preview the SPA locally
cd ../spa
node serve.mjs            # → http://localhost:8765
```

PowerShell users: substitute `;` for `&&` and use `Start-Process node serve.mjs` for backgrounding.

## Deploy to GitHub Pages

The repo ships with two GitHub Actions workflows that handle the heavy lifting:

1. **`.github/workflows/daily-refresh.yml`** — runs Mon–Fri at 19:00 SGT, refreshes `data/yahoo.json`, re-merges, commits the updated dataset to `main`.
2. **`.github/workflows/deploy-pages.yml`** — on every push to `main` (and after a successful daily refresh), bundles the `spa/` folder and deploys to GitHub Pages.

### One-time setup

1. **Push the repo to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-user>/<your-repo>.git
   git push -u origin main
   ```

2. **Enable GitHub Pages:** in the repo settings → Pages → Source = "GitHub Actions". No manual branch picking needed; the deploy workflow does it.

3. **Verify the daily refresh has commit permission:** repo settings → Actions → General → "Workflow permissions" = "Read and write permissions".

Within a few minutes the SPA is live at `https://<your-user>.github.io/<your-repo>/`.

## Project layout

```
SG-Reits/
├── .github/workflows/      # CI: daily-refresh + deploy-pages
├── data/                   # JSON: master list, Yahoo fetch, IR facts (per group), merged data, source whitelist
├── pipeline/               # Node.js scripts (fetch + merge) + agent prompts for IR refresh
├── spa/                    # Static SPA — index.html + styles.css + app.js + metrics-doc.js + data.json
└── docs/                   # METHODOLOGY.md, PLAYBOOK.md
```

## Methodology highlights

The dashboard surfaces metrics with deliberate framing:

- **Distribution yield TTM** is computed from manager-disclosed DPU (not Yahoo's headline, which can include capital distributions). The drawer shows BOTH and flags the gap as a "is this yield real?" warning.
- **Gearing** is shown in two forms: as the manager discloses (usually perpetual-securities-excluded) and "incl. perpetuals" so you see real leverage. Two REITs with identical headline gearing can have very different true leverage.
- **ICR** is the leading indicator of DPU sustainability under rising rates — far more informative than gearing in this environment.
- **Property yield (NPI/AUM)** is shown but contextualised: high property yield can signal old leases that will reset down on renewal (capped upside on DPU growth), or distressed assets. The useful comparison is property yield vs WACE — positive spread > 1pp = leverage is value-additive.
- **High distribution yields (>9%) are NOT high quality** — the scoring penalises them as yield-trap risk. The sweet spot is 5.5–7%.
- **Composite quality** is a sector-aware Leverage (40%) / Distribution (30%) / Operations (30%) blend. It captures regulatory safety + recurring yield — it does NOT capture sponsor strength, tenant credit, refinancing cliffs, or distribution composition.

Full thresholds, MAS regulatory references, and "true profits" framing: `docs/METHODOLOGY.md`.

## Sources

Allowed primary sources only:
- **Yahoo Finance** (chart + quoteSummary APIs) — prices, market cap, TTM yield, basic stats
- **SGX official** (sgx.com, links.sgx.com) — SGXNet filings
- **Each REIT's investor relations page** — quarterly / semi-annual results
- **REITAS** — REIT industry directory
- **MAS** — regulatory rules and thresholds

Explicitly **not** used as data sources: `sreit.fifthperson.com`, `yieldsavvy.com`, `reitdata.com`, generic dashboard aggregators or analyst blogs. The merger automatically flags any URL not from an authoritative host with a ⚠ warning in the SPA.

To temporarily allow a new host (e.g. a new aggregator you trust), add a substring to `data/source_whitelist.json`.

## Currency

REIT prices and market caps are shown in the **trading currency** of each counter (SGD, USD, GBP, EUR) with explicit badges. **SGD is implicit** — badges only appear for non-SGD lines. No automatic FX conversion is applied; ratios (yield, gearing, occupancy, etc.) are currency-independent and compare directly across REITs.

## Re-running the pipeline

See `docs/PLAYBOOK.md` for the complete operator procedure (PowerShell-compatible). Key recurring tasks:

| Cadence | Step | What runs |
|---|---|---|
| Daily | `node pipeline/fetch_yahoo.mjs && node pipeline/merge.mjs` | Refreshes prices, yields, market caps |
| Per quarterly results | Re-run `pipeline/agent_prompts/groupN.md` for the affected group | Updates gearing, ICR, DPU, WALE, occupancy, property yield |
| As needed | Edit `data/reits_master.json` | Add new IPO, remove delisted REIT |
| As needed | Edit `data/source_whitelist.json` | Whitelist a new source host |
