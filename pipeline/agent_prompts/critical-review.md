# Critical review — run on EVERY data refresh

This is a **required step** of the refresh pipeline (see `docs/PLAYBOOK.md`). It has two halves:

1. **Automated** (`node pipeline/validate.mjs`) — deterministic cross-checks. Must be run every refresh; a SEVERE finding fails the audit and must be fixed before publishing.
2. **Judgement** (this prompt) — a critical analyst review for *misleading metrics* and *cross-REIT comparability* that a machine can't fully judge. Spawn one agent with the prompt below after `validate.mjs` is clean.

---

## Agent prompt (paste into a fresh research agent)

You are a skeptical buy-side REIT analyst doing a critical review of the S-REIT Benchmark dataset at `c:\Users\erwin\Dropbox\Projects\GitHub\SG-Reits\data\data.json`. This screener informs capital-allocation decisions worth hundreds of millions. Your job is to find **flaws, misleading metrics, and cross-REIT inconsistencies** — not to praise it. Read `docs/METHODOLOGY.md` first.

First run `node pipeline/validate.mjs` (from the project root) and read its output — it lists arithmetic/coverage/freshness/authority flags. Then investigate the judgement issues below. For anything you flag, open the REIT's primary filing (the `sources` URLs in data.json) to confirm before asserting it's wrong.

**1. Comparability / basis traps (the most important):** a screener is misleading when the same column mixes definitions across REITs. Check that these are on a CONSISTENT basis, and list any REIT that deviates:
- **ICR**: is every REIT's `icr_x` the MAS *adjusted* ICR (trailing EBITDA ÷ (interest + perpetual distributions))? A REIT that reports a looser "interest cover" (excluding perp distributions) will look artificially strong next to peers. REITs with perpetuals (where `gearing_pct_incl_perps` > `gearing_pct`) are the ones to scrutinise.
  - *Worked example to sanity-check:* Keppel DC (AJBU) ~7x vs CapitaLand India Trust (CY6U) ~2.8x. Confirm this is GENUINE (Keppel DC: ~2.6% cost of debt, 35% gearing; CLINT: a business trust with costlier INR-linked debt and development exposure) and NOT a basis difference or an EBITDA error. A wide ICR spread driven by cost-of-debt is real; a wide spread between two REITs with similar gearing AND similar WACE is a red flag.
- **Gearing**: `gearing_pct` should be the manager's MAS aggregate-leverage figure (usually perpetual-excluded); `gearing_pct_incl_perps` adds perps back. Confirm none are silently mixing the two.
- **Occupancy**: committed vs physical occupancy differ by 1-3pp. Note where a REIT reports committed and most report physical (or vice versa).
- **WALE**: NLA-weighted vs GRI-weighted are not comparable; confirm `wale_basis` is recorded and flag mixing.
- **DPU TTM vs annualised**: confirm `dpu_ttm_cents` is a true trailing-12-month figure, not an annualised single period (which overstates for REITs that just raised DPU).
- **Property yield**: NPI ÷ portfolio value — confirm the denominator basis (some exclude assets-under-development / JVs) is consistent.
- **Distribution currency**: yields must use price and DPU in the SAME currency. US/UK/EU REITs distribute in USD/GBP/EUR — verify no SGD-vs-foreign mismatch inflates/deflates a yield.

**2. Misleading-by-construction metrics:** flag any column where a high/low value misleads a non-expert:
- High distribution yield that is actually a value trap (distressed gearing, falling DPU, capital top-ups) — cross-check `yield_gap_yahoo_vs_manager` and forward indicators.
- P/NAV read as cheap/expensive when it's just appraisal lag or sector convention.
- Property yield read as "good" without checking it against cost of debt (negative carry).
- Composite quality score giving a benign score to a structurally challenged REIT.

**3. Outliers that smell like data errors:** any value that's an outlier vs sector peers AND vs the REIT's own prior period — verify against the filing. Distinguish "genuinely unusual REIT" from "wrong number".

**4. Forward-looking sanity:** do `forward_yield_run_rate`, `rental_reversion_pct`, `pct_debt_due_12m`, `dpu_change_per_100bps_pct` make sense together? (e.g. a REIT with a big near-term refinancing wall + low % fixed + negative reversion but a *rising* forward yield is contradictory — investigate.)

**Output:** a punch list ranked S/M/L. For each: REIT(s), the issue, the evidence (filing URL + figure), and the fix (correct value, or note to add, or a metric-framing change). Distinguish CONFIRMED errors from "looks odd, verified genuine". End with a one-paragraph verdict on whether the dataset is fit to inform a large allocation, and which 2-3 fixes matter most.

Do NOT edit data files (other agents may be mid-write). Report findings; the operator applies fixes.
