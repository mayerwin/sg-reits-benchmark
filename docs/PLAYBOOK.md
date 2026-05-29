# S-REIT Benchmark — Re-run Playbook

This is the **complete, replicable** procedure for refreshing the S-REIT Benchmark dataset. Follow these steps verbatim. Every command runs from the project root unless noted.

> The dashboard exists to support **financial decisions worth hundreds of millions**. Accuracy is non-negotiable. The playbook below is designed so that any reasonably capable agent or operator can re-run it without context from prior runs and arrive at the same correct dataset.

---

## 0 · Prerequisites

| Tool | Version tested | Notes |
|---|---|---|
| Node.js | **≥ 20** (tested on v22.19.0) | The pipeline scripts use ES modules, built-in `fetch`, and the `getSetCookie()` Headers method (Node 19.7+). The `engines` field in `pipeline/package.json` enforces this. |
| `curl` | any | Used for FX/health checks only. Optional. |
| Playwright | 1.60.x | Only required for SPA screenshot QA — not for the data pipeline. Install via `npm i playwright@1.60.0` inside `spa/`. |
| `pdf-parse-fork` | optional | Only needed if you use `pipeline/extract_pdf.cjs` to extract metrics from REIT PDF results manually. Run `npm i pdf-parse-fork` inside `pipeline/`. |

No paid API keys are required. No credentials. Yahoo Finance is hit anonymously (with a cookie+crumb dance the script handles automatically). REIT IR pages are publicly accessible.

### Shell

Commands are shown in **bash** notation. On **PowerShell** (the default shell on the dev machine), substitute:
- `cmd1 && cmd2` → `cmd1 ; if ($?) { cmd2 }`
- `cmd &` (background) → `Start-Process node cmd.mjs` or run in a separate terminal
- `for t in A B C; do …; done` → `foreach ($t in 'A','B','C') { … }`
- `2>&1 | tail -N` → `… | Select-Object -Last N` after the command

---

## 1 · Project structure (what lives where)

```
SG-Reits/
├── data/
│   ├── reits_master.json          ← Canonical 39-REIT list (manually curated; rarely changes)
│   ├── yahoo.json                 ← Output of step 3 (Yahoo market data)
│   ├── reit_facts_group{1..5}.json ← Output of step 4 (REIT-disclosed metrics per group)
│   └── data.json                  ← Merged final dataset; copied into spa/
├── pipeline/
│   ├── package.json
│   ├── fetch_yahoo.mjs            ← Step 3
│   └── merge.mjs                  ← Step 5
├── spa/
│   ├── index.html, styles.css, app.js
│   ├── data.json                  ← Auto-written by step 5
│   └── serve.mjs                  ← Local preview server
├── docs/
│   ├── METHODOLOGY.md             ← What every metric means and healthy thresholds
│   └── PLAYBOOK.md                ← This file
└── README.md
```

Re-runs that just need updated *prices* skip steps 2 and 4. Re-runs after a REIT reports quarterly results need step 4 too.

---

## 2 · Refresh the master REIT list (only when listings change)

The canonical universe of SGX-listed S-REITs and stapled property trusts lives in `data/reits_master.json`. It is **stable** — only edit when:

- A REIT IPOs (e.g. Centurion Accommodation REIT, NTT DC REIT, UI Boustead REIT in 2025–2026 all required additions)
- A REIT is suspended (e.g. Eagle Hospitality, EC World, Dasin Retail) — remove or move to a `suspended` list
- A REIT is delisted (e.g. Frasers Hospitality Trust, Oct 2025) — remove
- A REIT renames (e.g. ESR-LOGOS REIT → ESR REIT; Sabana → Alpha Integrated; Lippo Malls → Landmark REIT) — update name + check ticker

### Procedure

1. Cross-reference the latest REITAS sector list:
   - https://www.reitas.sg/singapore-reits/s-reit-sectors/
   - https://www.reitas.sg/singapore-reits/overview-of-the-s-reit-industry/
2. Cross-reference SGinvestors.io alphabetical and by-sector listings:
   - https://sginvestors.io/sgx/reit-listing/alpha
   - https://sginvestors.io/sgx/reit-listing/sector
3. Cross-reference SGX's own REITs page:
   - https://www.sgx.com/reits
4. Confirm every ticker resolves on Yahoo Finance with the `.SI` suffix:
   ```bash
   for t in C38U A17U HMN AU8U; do
     curl -s "https://query1.finance.yahoo.com/v8/finance/chart/${t}.SI?range=5d" | grep -o '"longName":"[^"]*"'
   done
   ```
   A blank line means the ticker is dead — investigate (renamed? delisted? suspended?).
5. Update `_meta.last_validated` to today's date (ISO).

The current `reits_master.json` was validated **2026-05-27** against all four sources, with 39 active REITs.

---

## 3 · Fetch live market data from Yahoo Finance

The Yahoo fetcher is the **only** part of the pipeline that pulls automatic, structured market data. Run it whenever you want fresh prices, market caps, and trailing-12M dividend yields.

### Procedure

```bash
cd pipeline
node fetch_yahoo.mjs
```

### What it does

1. Hits `fc.yahoo.com` to seed A1/A3 cookies, then `query2.finance.yahoo.com/v1/test/getcrumb` to obtain a crumb (Yahoo's CSRF token for free API access).
2. For each REIT in `reits_master.json`:
   - Calls `query1.finance.yahoo.com/v8/finance/chart/{TICKER}.SI?range=1y&interval=1d`:
     - latest price, currency, 52-week high/low, regular market time
     - 1-year daily close series (downsampled to ~60 points for the SPA sparkline)
   - Calls `query2.finance.yahoo.com/v10/finance/quoteSummary/{TICKER}.SI?modules=summaryDetail,price,defaultKeyStatistics`:
     - `dividendYield` (TTM, fraction)
     - `dividendRate` (TTM, in trading currency)
     - `exDividendDate`, `payoutRatio`, `fiveYearAvgDividendYield`
     - `marketCap`, `priceToBook`, `bookValue`
     - `trailingPE`, `forwardPE`
     - `sharesOutstanding`, `floatShares`, `beta`
     - `fiftyTwoWeekHigh/Low`, `fiftyDayAverage`, `twoHundredDayAverage`

### Output

`data/yahoo.json` — array of `{ ticker, name, fetched_at, chart, summary, errors }` records, in master-list order.

### Expected run time

~30–60 seconds for all 39 REITs at concurrency 4.

### Validation

The script logs one line per REIT with `ok ($price ccy, mcap=N)` or `ERR …`. **All 39 must report `ok`.** If any fail, re-run; if they still fail check (a) Yahoo's crumb endpoint is reachable, (b) the ticker isn't recently renamed.

### Caveats / known quirks

- Yahoo's `payoutRatio` and `dividendYield` are derived from declared dividends, which for some REITs include capital distributions or one-off top-ups. That's why the merger (step 5) **prefers manager-disclosed DPU** from the IR facts file when available.
- For dual-currency-counter REITs (Elite UK REIT MXNU/MENU, IREIT Global UD1U/8U7U, Stoneweg Europe SEB/SET) only the primary counter listed in `reits_master.json` is fetched. The alternative counter is noted in the record's `alt_counter` field.

---

## 4 · Fetch REIT-disclosed metrics from manager IR pages

This is the slowest and most variable step. Each REIT publishes a quarterly or semi-annual business update on its IR page with a "Capital Management" / "Financial Highlights" slide containing all the metrics we need:

- Gearing (aggregate leverage %)
- Interest coverage ratio (ICR, MAS-defined "adjusted ICR" since Nov 2024)
- Weighted-average cost of debt; % fixed/hedged; WA debt maturity
- DPU TTM, DPU last period, distribution currency
- NAV per unit
- Occupancy %, WALE years (NLA or GRI basis)
- Number of properties, AUM, top-10 tenant share, geographic split

**No fully-automated scraping is possible** — each manager formats this differently (some publish only PDFs; some embed in HTML; some only in earnings call decks). Two practical approaches:

### Approach A — Multi-agent (the default for this project)

Spawn 5 research agents in parallel. Each agent receives a list of ~6–9 REITs and writes a `data/reit_facts_groupN.json` file. The agents:

1. Read the master list to learn each REIT's IR URL
2. Use a browser-capable WebFetch (or Playwright) to load each REIT's IR page
3. Locate the most recent quarterly / semi-annual / annual results announcement
4. Extract the metrics from the announcement's PDF or HTML (using `pipeline/extract_pdf.cjs` for binary PDF responses)
5. Write a structured JSON with per-field `*_source` URLs and a top-level `_meta.fetched_at` timestamp

The prompts for those agents are saved as `pipeline/agent_prompts/group{1..5}.md` (copy and paste into a fresh agent or sub-agent invocation). See `pipeline/agent_prompts/README.md` for group composition.

**Expected runtime:** ~15–25 minutes per group when all 5 are launched in parallel (each agent hits 6–9 IR pages, extracts text from PDF results, and writes structured JSON). Total wall time **~20–30 min**. Agents can occasionally time out — re-run any group whose output file is missing or has fewer REITs than expected.

#### Output schema (per REIT inside `reit_facts_groupN.json`)

```json
{
  "_meta": { "fetched_at": "ISO", "agent": "group1-large-caps", "notes": "..." },
  "reits": {
    "C38U": {
      "report_period": "FY2025",
      "report_date": "2026-01-28",
      "report_url": "https://investor.cict.com.sg/financial-results/",
      "gearing_pct": 38.6,        "gearing_source": "https://...",
      "icr_x": 3.1,               "icr_source": "https://...",
      "wace_pct": 3.42,           "debt_source": "https://...",
      "pct_fixed_debt": 78.0,
      "wadm_years": 3.7,
      "dpu_ttm_cents": 10.71,     "dpu_source": "https://...",
      "dpu_last_period_cents": 5.31,
      "dpu_currency": "SGD",
      "nav_per_unit": 2.06,       "nav_source": "https://...",
      "occupancy_pct": 96.6,      "occupancy_source": "https://...",
      "wale_years": 3.4,          "wale_basis": "GRI",  "wale_source": "https://...",
      "num_properties": 26,       "num_properties_source": "https://...",
      "aum_total": "S$26.0B",
      "top10_tenant_pct": 19.8,
      "geographic_split": { "Singapore": 92.0, "Australia": 6.0, "Germany": 2.0 },
      "forward_dpu_guidance": "Manager guided positive rental reversion ..."
    },
    "A17U": { … }
  }
}
```

### Approach B — Manual operator

A single operator can populate the same files by hand from each REIT's most recent results press release. Allow ~3 hours for all 39 REITs.

### Source priority (in order — never deviate)

1. **The REIT's most recent quarterly / semi-annual results presentation (PDF)** on its IR page
2. The REIT's most recent results press release (HTML) on its IR page
3. **SGXNet announcement filing** at `https://www.sgx.com/securities/equities/{ticker}` → Announcements tab
4. Annual report if quarterly isn't available
5. IPO prospectus for very-recent IPOs

### Sources NOT to use (data is stale or unverifiable)

- `sreit.fifthperson.com`
- `yieldsavvy.com`
- `reitdata.com`
- `wealthfor.us`
- Generic dashboard aggregators

These can be useful for cross-reference but never as the primary source.

### MAS regulatory context for the metrics

The MAS rules apply uniformly since Nov 2024 (see [MAS Nov 2024 release](https://www.mas.gov.sg/news/media-releases/2024/mas-rationalises-leverage-requirements-and-introduces-additional-disclosures-for-reits)):

- **Gearing ≤ 50%** (single cap, replacing the prior 45%/50% tiered system)
- **ICR ≥ 1.5x**: REIT cannot incur additional borrowings if breached
- **ICR < 1.8x**: Manager must publish corrective action plans in interim/annual reports
- **Sensitivity disclosures**: Every REIT must publish ICR sensitivity to a 10% EBITDA drop and a 100bps rate increase

When recording ICR, use the **Adjusted ICR** that includes perpetual-security distributions in the denominator (MAS-defined) — not the bare "ICR" some REITs still publish.

---

## 5 · Merge into the final dataset

```bash
cd pipeline
node merge.mjs
```

### What it does

Reads `data/reits_master.json`, `data/yahoo.json`, and any `data/reit_facts_group*.json` files, then produces `data/data.json` and `spa/data.json` (identical content).

For each REIT it:

- Carries over the manager-disclosed fields verbatim (gearing, gearing-incl-perps, ICR, WACE, property yield, DPU, NAV, WALE, occupancy, etc.)
- Computes `distribution_yield_ttm`: prefers `dpu_ttm_cents / price` when fact-file DPU is present (excludes capital distributions); otherwise falls back to Yahoo's `dividendYield`
- Computes `yield_gap_yahoo_vs_manager` = Yahoo headline yield − manager-DPU yield. A positive gap flags that Yahoo's headline includes capital top-ups / income support the recurring DPU can't sustain. (There is intentionally NO separate `cash_earnings_yield` field — `dpu_ttm × shares / mcap` is algebraically identical to `dpu_ttm / price`, so it would duplicate the distribution yield under a misleading name.)
- Computes `p_nav` from manager NAV when present, else falls back to Yahoo's `priceToBook` (tagged via `p_nav_source`)
- Scores each REIT on (see `docs/METHODOLOGY.md` §7):
  - **Leverage** (gearing, ICR, % fixed, debt maturity) — sector-aware thresholds
  - **Distribution** (yield, sustainability — high yields >9% penalised as trap risk)
  - **Operations** (occupancy, WALE — sector-aware thresholds)
  - **Composite** = weighted average (**0.40 leverage + 0.30 distribution + 0.30 operations**; the valuation bucket is null for all REITs and re-normalised away)
- Sets `passes_user_screen = true` if gearing < 40% AND market_cap ≥ 200M trading-currency

### Validation

After the merger runs, you should see:

```
REITs with fact data: N / 39
REITs passing user screen (gearing<40% AND mcap>=200M trading-ccy): M / 39
Missing fact data for K REITs: TICK1, TICK2, …
  (re-run the relevant agent_prompts/group{N}.md or update those REITs manually)
```

The missing-tickers line tells you exactly which REITs to refresh — match them against `pipeline/agent_prompts/README.md` group composition to find the right prompt to re-run.

---

## 6 · Preview locally

```bash
cd spa
node serve.mjs        # → http://localhost:8765
```

**Windows / PowerShell:** if port 8765 is already bound from a previous run, free it first:
```powershell
Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force
}
node serve.mjs
```

The SPA reads `spa/data.json` directly. Check:

- Top header shows the correct `master_validated` and `yahoo_generated_at`
- All 39 REITs render in the table
- Currency badges (SGD / USD / GBP / EUR) appear next to every price and market cap
- Clicking a row opens the right-side drawer with the sparkline and full metric grid
- "Source ↗" links open the IR page or report URL
- The "User screen" checkbox correctly filters to gearing < 40% AND mcap ≥ 200M (trading currency)

For a quick visual diff before/after a refresh, use `spa/screenshot.mjs`:

```bash
cd spa
node serve.mjs &
node screenshot.mjs
```

Produces `screenshot_main.png` and `screenshot_drawer.png`.

---

## 7 · Recommended refresh cadence

| Step | Cadence |
|---|---|
| 2 · Master list | Once per quarter, plus immediately after any IPO/delisting/rename announcement |
| 3 · Yahoo market data | Daily (or before any decision) |
| 4 · IR-disclosed metrics | Within 1 week of each REIT's quarterly results filing (most file end-Jan, end-Apr, end-Jul, end-Oct) |
| 5 · Merge | After every refresh of step 3 or step 4 |

For a fully automated daily refresh, only step 3 + step 5 need to run. Step 4 is event-driven (per-REIT result announcement) — set calendar reminders for each major filing season.

---

## 8 · Failure modes & troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `fetch_yahoo.mjs` reports `crumb endpoint 429` | Yahoo rate-limit on shared IPs | Wait 5 min, re-run; or change network |
| `fetch_yahoo.mjs` reports `summary: …Invalid Crumb` | Cookie didn't stick, or crumb expired mid-run | Re-run; if persistent, lower concurrency in `fetch_yahoo.mjs` (currently 4) |
| One ticker logs `No chart result` | Ticker renamed, delisted, or suspended | Step back to step 2: verify on REITAS, SGX, SGinvestors |
| `merge.mjs` says "REITs with fact data: 0" | No `reit_facts_group*.json` files present | Run step 4 |
| Partial fact coverage (e.g. 30/39) | One or more agents ran out of tool budget mid-run | The merge output tells you which tickers are missing — re-run those groups |
| Two agents claimed the same REIT | Duplicate keys across group files; later file in `FACT_GROUP_FILES` order silently wins | Fix the group assignment in `pipeline/agent_prompts/README.md` |
| `fact_group*.json` parses but every record has nulls | Agent wrote a skeleton then ran out of budget before filling values | Re-run that single group; consider splitting into smaller groups |
| SPA shows "n/d" for gearing on every REIT | Same as "fact data: 0" | Run step 4 |
| Drawer sparkline is flat | `price_series` is empty in that record | Look at the record's `errors` field; refetch with `fetch_yahoo.mjs` |
| Long `forward_dpu_guidance` breaks drawer layout | Agent emitted a multi-paragraph blob | The SPA renders it in a wide prose cell; consider trimming the agent output |
| Yahoo's `payout_ratio` shows >300% or negative | Trailing earnings are tiny/negative (IFRS fair-value losses) | The fetcher now caps at 3.0 and sets null beyond — you should not see this anymore |
| `beta` / `fiveYearAvgDividendYield` shows `{}` | Yahoo returns empty object for new IPOs | The fetcher now coerces these to `null` — you should not see this anymore |
| "REITs passing user screen" jumps unexpectedly | A REIT was just refreshed with a different gearing number | Compare `report_date` and `report_period` in the record to confirm a new filing dropped |
| Some sources point to aggregator sites (minichart, growbeansprout) instead of SGXNet | Agent couldn't decode the binary PDF response | Re-run that REIT's group; or fix manually using `pipeline/extract_pdf.cjs <PDF_URL>` |

---

## 9 · Auditability — every number must be traceable

Each merged record in `data.json` carries a `sources` block with URLs for the primary fields:

```json
"sources": {
  "chart": "https://query1.finance.yahoo.com/v8/finance/chart/C38U.SI",
  "summary": "https://finance.yahoo.com/quote/C38U.SI/",
  "gearing": "https://investor.cict.com.sg/.../q4-fy2025-results.pdf",
  "icr": "...",
  "dpu": "...",
  "nav": "...",
  "occupancy": "...",
  "wale": "...",
  "debt": "...",
  "properties": "...",
  "report": "..."
}
```

In the SPA drawer, every **primary** capital-management and distribution metric has a "source ↗" link. Secondary metrics (`top10_tenant_pct`, `geographic_split`, `aum_total`, `forward_dpu_guidance`) inherit the parent filing's `report_url`. If a number doesn't have a source link in the drawer, **do not act on it** — verify against the issuer's filing first.

The merger also stamps `p_nav_source` as either `manager_nav` (preferred — derived from manager-disclosed NAV per unit) or `yahoo_priceToBook` (fallback when manager NAV isn't in the latest quarterly). When `yahoo_priceToBook` is used, the drawer prints a warning.

Per-REIT fetch timestamps live on `yahoo_fetched_at` (from the Yahoo fetcher) and `facts_fetched_at` (from the IR-data agent).

---

## 10 · Quick re-run recipe (daily refresh)

```bash
cd pipeline
node fetch_yahoo.mjs && node merge.mjs
```

That's it. Open `http://localhost:8765` to preview. Commit `data/data.json` if you want the dataset versioned.
