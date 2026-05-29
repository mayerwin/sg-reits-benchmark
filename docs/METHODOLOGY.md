# S-REIT Screener — Methodology & Data Dictionary

This is the reference document for every metric in this dashboard. It explains what each number means, why it matters, where it comes from, and what counts as healthy. Numerical thresholds were validated against MAS rules (Nov 2024 revisions) and S-REIT sector data current as of 2026.

## TL;DR — The "True Profits" Lens

The user wants to assess REITs on *cash actually received minus all cash costs, including interest, excluding depreciation and fair-value gains*. The closest existing metric is:

> **DPU from Operations** (also called "Operating Distributable Income") — distributable income stripped of one-off items, income support, capital top-ups, and ideally maintenance capex.

This is reported in each REIT's quarterly distribution statement. Headline declared DPU can be inflated by capital distributions and income support; DPU from Operations is the cleaner read.

### Current implementation honesty

The dashboard does NOT yet collect a dedicated `dpu_from_operations` field. The IR-data agents harvest `dpu_ttm_cents` from each manager's most recent results — which is *declared* DPU (recurring + any capital top-ups bundled). The dashboard surfaces TWO yield figures so the user can spot the gap themselves:

1. **`distribution_yield_ttm`** = manager-disclosed `dpu_ttm_cents / price`. Preferred.
2. **`yahoo_dividend_yield`** = Yahoo's headline yield, which can include capital distributions.

When the two diverge materially (≥0.5pp), the drawer prints a warning: *"Yahoo headline (X%) exceeds manager-disclosed DPU yield by Ypp — possible capital top-up / income support"*. This is currently the best proxy for "is this yield real?" without dedicated DPU-from-operations data collection.

The merger does **NOT** emit a separate "cash earnings yield" field. Algebraically, `(dpu_ttm × shares) / market_cap = dpu_ttm / price` — the same number labelled twice would mislead, not inform. (This was a real bug found by the methodology review and fixed.)

A future improvement is to enhance the IR-data agent prompts to extract the **recurring distributable income** line item explicitly, then compute `recurring_dpu_yield = recurring_DI / market_cap`. Until then, the gap between manager-DPU yield and Yahoo headline yield is the honest workaround.

## 1. The S-REIT Equivalent of AFFO

| Concept | US REIT (NAREIT) | S-REIT |
|---|---|---|
| Starting point | GAAP Net Income | IFRS Net Income (or NPI) |
| Add back property D&A | Yes (FFO) | Yes |
| Exclude gains/losses on property disposals | Yes (FFO) | Yes |
| Exclude fair-value (revaluation) gains/losses | Implicit (US uses historical cost + D&A) | **Explicitly excluded** (IFRS uses fair value) |
| Deduct maintenance capex / leasing costs | Yes (AFFO) | **Not standardised** — varies by REIT |
| Deduct straight-line rent | Yes (AFFO) | Yes |
| Deduct interest expense | Yes | **Yes** — interest is a real cash cost, deducted |
| Treatment of mgr fees paid in units | N/A | Added back (non-cash) — dilutive over time |
| Distributions retained / income support | N/A | Often topped up to smooth distributed DPU — manipulation risk |

## 2. Leverage Metrics (Regulatory)

### Gearing Ratio (Aggregate Leverage)
**Formula:** Total Borrowings / Deposited Property (total assets at fair value)

**MAS rule (effective Nov 2024):** Single uniform **50% cap** for all S-REITs. The previous tiered system (45% standard / 50% if ICR≥2.5x) was replaced.

### Perpetual Securities — Two Gearing Views

Many SG REIT managers explicitly **exclude perpetual securities** from "Total Borrowings" when computing headline gearing. The disclosure language is typically:

> "Aggregate leverage ratio is computed as total borrowings as a percentage of total assets… The total borrowings excluded Perpetual Securities holders' funds." (AIMS APAC REIT FY2026)

Other data providers (e.g. fifthperson) compute gearing **inclusive** of perpetuals. Both are defensible — but they produce different numbers and rank REITs differently.

**Why this matters for investors:**
- **Perpetuals are equity in accounting but debt in economics.** They pay a fixed coupon, are callable, and step up in rate if not called — fundamentally a debt instrument with no maturity.
- A REIT that uses perpetuals heavily appears more conservatively-geared than one that uses straight debt for the same capital structure. The headline gearing understates the real leverage.
- When you compare REITs cross-sectionally, **the perp-inclusive view is the more apples-to-apples comparison**. AIMS APAC at 34.8% headline gearing with S$250M perpetuals (~6% of AUM) has roughly 41% "true" gearing — comparable to a REIT at 41% headline gearing with no perpetuals.

**How this dashboard handles it:**
- The "Gearing" column shows the **manager-disclosed** number (whatever convention the manager uses). This is what management reports to MAS and what the official MAS 50% cap is measured against.
- The "Gear+Perps" column shows gearing **recomputed with perpetuals added back**. For REITs with no perpetuals, this column shows the same number. The gap between the two columns is the "hidden leverage" indicator.
- For screening, **prefer the perpetual-inclusive view** when comparing REITs across managers. For regulatory compliance / MAS cap purposes, the manager-disclosed view is what matters.

This dashboard now collects both. If a REIT discloses perpetuals but the manager hasn't published an inclusive figure, the merger leaves `gearing_pct_incl_perps` as null with a note explaining why.

### Adjusted Interest Coverage Ratio (ICR)
**Formula:** Trailing 12-month EBITDA (excl. fair-value changes) / (Interest Expense + Distributions on Perpetual Securities)

**MAS rules (effective Nov 2024):**
- **< 1.5x** → REIT cannot incur additional borrowings (refinancing still allowed)
- **< 1.8x** → manager must disclose corrective plans in interim/annual reports
- All REITs must publish sensitivity disclosures (10% EBITDA drop, +100 bps rate)

### Why ICR > Gearing in a high-rate environment
A 35% gearing REIT looks safe, but if its weighted-average cost of debt jumps 2.5% → 4.5% on refinancing, interest expense nearly doubles and DPU collapses — gearing barely moves. Sector ICR fell from ~5x in 2021 to ~2x by mid-2025; gearing was nearly flat. **Pair both, but ICR is the leading indicator.**

## 3. Yield Metrics — What to Trust and What Not To

| Metric | Formula | Trust Level |
|---|---|---|
| **Distribution Yield TTM** (mgr-disclosed DPU / price) | What we surface as the headline | ✓✓ Preferred |
| **Yahoo Headline Yield** | What Yahoo computes from declared dividends | ⚠ Can include capital distributions / one-offs |
| **Property Yield (Cap Rate)** (NPI / property fair value) | Unlevered look at the buildings | ✗ Misleading alone — ignores debt service |
| **Forward DPU Yield** (consensus or annualised latest qtr / price) | Better for current-rate environment | ✓✓ Not currently computed (would need to extend the IR-data agents) |

**Why Property Yield is misleading alone:** It ignores debt. A REIT with 5% property yield and 4% cost of debt at 40% gearing has ~5.4% equity yield. If cost of debt rises to 6%, the same property yield destroys equity value. The screener shows distribution yield + the Yahoo-vs-manager gap, not property yield in isolation.

**But Property Yield IS useful** as a secondary indicator:
1. **Compare property yield to WACE** (weighted average cost of debt). When property yield − WACE > ~1pp, leverage is value-additive. When the spread compresses below 1pp or goes negative, leverage destroys equity value — DPU will decline as debt refinances.
2. **Unusually high property yield can signal old leases coming up for renewal**. A REIT showing 6.5% property yield in a sector where peers are 5% may simply have legacy leases at above-market rents — when those expire and reset to current market rates, the property yield (and DPU growth potential) compresses. Low property yield is the inverse: lots of room to grow into market rates on renewal.
3. **Sector norms differ.** Data centres / logistics typically 5–6%, office 4–5%, retail 5–6%, healthcare 4–5%. Cross-sector comparison is misleading; intra-sector matters.

This dashboard now exposes `property_yield_pct` per REIT, sourced from each manager's results presentation (typically labelled "NPI yield" or "cap rate"). The Help page explains the spread-vs-WACE analytic.

## 4. Why Price-to-NAV Is Misleading (confirming your hypothesis)

1. **NAV is appraisal-based, not market-based.** Singapore REITs use fair-value IFRS accounting — investment property revalued annually by independent valuers using DCF + comparable cap rates. Valuers lag the market; appraisal NAVs trail spot transactions by 6–18 months. A "0.7x P/NAV" REIT in a downturn may simply be priced ahead of an upcoming valuation write-down.
2. **NAV ignores leverage quality.** Two REITs at 0.8x P/NAV can have very different risk profiles — one at 30% gearing on 2.5% fixed debt, another at 45% gearing on floating SORA.
3. **NAV ignores DPU sustainability.** A REIT could be at attractive P/NAV but paying via capital distributions, eroding NAV forward.
4. **Sector effects.** Data centres and logistics persistently trade at premiums; older retail/office at discounts. Cross-sector P/NAV comparison is apples-to-oranges.

**How the dashboard handles this:** the P/NAV column shows the *absolute level* (useful as one data point) but the SPA flags when Yahoo's `priceToBook` is used as a fallback (when manager NAV isn't disclosed in the latest quarterly). A future improvement is to expose P/NAV as a percentile vs the REIT's own 5-year history, not a level — that requires historical NAV data we don't collect yet.

## 5. Other Metrics That Belong on the Dashboard

### Portfolio quality (sector-aware — see §7 for scoring bands)
| Metric | Healthy threshold |
|---|---|
| Occupancy (Office/Industrial/Diversified) | >95% |
| Occupancy (Retail) | >97% |
| Occupancy (Hospitality — room nights) | >78% |
| Occupancy (Data Centre) | >92% |
| Occupancy (Healthcare — master lease) | >99% |
| WALE (Industrial/Logistics) | >4 yrs |
| WALE (Data Centre) | >5 yrs |
| WALE (Healthcare) | >5 yrs |
| WALE (Office) | >3 yrs |
| WALE (Retail) | 2–3 yrs is normal (short leases by design) |
| WALE (Hospitality) | N/A (nightly stays) |
| Top-10 tenant concentration | <30% (diversified) |
| Rental reversion | Positive; >5% is strong |
| Number of properties | More = better diversification (quality > count) |

### Capital structure / debt
| Metric | Healthy threshold |
|---|---|
| Cost of debt (WAIR) | <4% currently; trend matters |
| % Fixed-rate / hedged debt | >75% |
| Weighted avg debt maturity | >3 yrs |
| Refinancing in next 12M | <20% of total (not yet collected) |
| Unencumbered assets ratio | >50% (not yet collected) |

## 6. Composite Healthy Thresholds (cheat sheet)

| Category | Metric | Strong | Healthy | Caution | Stress |
|---|---|---|---|---|---|
| Leverage | Gearing | <35% | 35–40% | 40–45% | 45–50% (near MAS cap) |
| Leverage | ICR | >5x | 2.5–5x | 1.8–2.5x | <1.8x |
| Leverage | % Fixed/Hedged | >85% | 75–85% | 60–75% | <60% |
| Leverage | Avg Debt Maturity | >4 yrs | 3–4 yrs | 2–3 yrs | <2 yrs |
| Operations | Occupancy (Off/Ind) | >97% | 95–97% | 90–95% | <90% |
| Operations | Occupancy (Retail) | >98% | 95–98% | 90–95% | <90% |
| Operations | Occupancy (Hospitality) | >85% | 78–85% | 70–78% | <70% |
| Operations | Occupancy (Data Centre) | >97% | 92–97% | 88–92% | <88% |
| Operations | Occupancy (Healthcare) | >99% | 95–99% | 90–95% | <90% |
| Operations | WALE (Industrial) | >5 yrs | 3–5 yrs | 2–3 yrs | <2 yrs |
| Operations | WALE (Data Centre) | >7 yrs | 5–7 yrs | 3–5 yrs | <3 yrs |
| Operations | WALE (Office) | >4 yrs | 2.5–4 yrs | 1.5–2.5 yrs | <1.5 yrs |
| Operations | WALE (Retail) | >3 yrs | 2–3 yrs | 1.5–2 yrs | <1.5 yrs |
| Distribution | Yield TTM (peaks in 5.5–7%) | 5.5–7% | 4.5–5.5%, 7–9% | 3.5–4.5%, 9–12% | <3.5% or >12% |

**Note on yield scoring:** Yields above ~9% in S-REITs are almost always a signal of distress (gearing/refi risk, falling DPU, value trap) rather than opportunity. The scoring peaks in the 5.5–7% band and decays both above and below, mirroring institutional practice. Manulife US REIT and Lippo Malls Indonesia Retail Trust (now Landmark) historically traded at 12%+ TTM yields when distributions were about to be cut or suspended.

## 7. Composite Quality Score (as applied in this dashboard)

The composite quality score is the **weighted average of sub-scores that are actually available** for a REIT. Weights:

```
Composite =
    0.40 × Leverage           (gearing, ICR, % fixed-rate, debt maturity)
  + 0.30 × Distribution       (yield, sustainability flag)
  + 0.30 × Operations         (occupancy, WALE — sector-aware)
```

Missing sub-scores are dropped and the remaining weights are re-normalised. The drawer shows the composite alongside each sub-score so the user can see what's driving it. A small `n/4` or `n/2` confidence indicator appears next to each sub-score to show how many of its component metrics actually contributed.

### Important caveats — what the composite does NOT capture

This is a **regulatory-safety + recurring-yield triage tool**, not a buy signal. Specifically, the composite is **silent on**:

- **Sponsor strength** and refinancing support (a strong sponsor's S$1B revolver matters more than a 0.2x ICR difference)
- **Tenant credit quality** (Elite UK REIT's UK-government tenant is structurally different from Sasseur's variable Chinese outlet rent at the same composite score)
- **Refinancing cliff** in the next 12–24 months and the rate gap between expiring debt and current WACE
- **Distribution composition** (organic NPI vs capital top-up vs divestment gain vs income support)
- **Manager-fee unit dilution** over time
- **DPU growth trend** (3y / 5y CAGR of recurring DPU)
- **Rate sensitivity** (DPU change at +100bps / −10% EBITDA — MAS-mandated disclosures)
- **Stapled trust / business trust governance differences** (e.g. CapitaLand India Trust is a business trust, not a REIT)

A buy-side decision must layer these on top of the composite. The composite filters the universe down to "not obviously broken" — it does not pick winners.

## 8. The User Screen

The dashboard surfaces a `passes_user_screen` boolean per REIT, true when:
- `gearing_pct < 40%` AND
- `market_cap >= 200_000_000` (in trading currency)

The 200M floor is applied in the REIT's *trading currency*, not SGD. So a USD-quoted REIT at USD 200M passes; a SGD-quoted REIT at SGD 200M passes. Rough SGD-equivalents: USD 200M ≈ SGD 270M; GBP 200M ≈ SGD 340M; EUR 200M ≈ SGD 290M (as of May 2026). The dashboard does not perform automatic FX conversion — this is intentional, since most decision-relevant ratios are currency-independent and converting absolute market cap introduces FX-volatility noise.

## 9. Sources Used

- [REITAS REIT Glossary](https://www.reitas.sg/reit-basics/reit-glossary/)
- [MAS: Rationalises Leverage Requirements (Nov 2024)](https://www.mas.gov.sg/news/media-releases/2024/mas-rationalises-leverage-requirements-and-introduces-additional-disclosures-for-reits)
- [MAS: Proposes Minimum ICR (Jul 2024)](https://www.mas.gov.sg/news/media-releases/2024/mas-proposes-to-impose-minimum-interest-coverage-on-all-reits)
- [Lexology: MAS Imposes Minimum ICR and 50% Aggregate Leverage](https://www.lexology.com/library/detail.aspx?g=bd7775eb-aa09-4b0d-a3de-09c176cbee75)
- [REIT-TIREMENT: Understanding REIT Distribution Components](https://www.reit-tirement.com/2024/07/understanding-reit-distribution.html)
- [NAREIT: AFFO Definition](https://www.reit.com/glossary/adjusted-funds-operations-affo)
- [Wall Street Prep: AFFO Formula](https://www.wallstreetprep.com/knowledge/affo-adjusted-funds-from-operations/)
- [Growbeansprout: ICR & single leverage limit explainers](https://growbeansprout.com/)
- [The Edge: ICR / Leverage Changes Come Into Effect](https://www.theedgesingapore.com/news/reits/changes-icr-leverage-come-effect-immediately-additional-disclosures-march)

## 10. Data Quality — Known Limitations (as of 2026-05-27)

1. **Secondary sources used for some REITs.** A small subset of REITs (notably Manulife US REIT) have source URLs pointing to aggregator articles (minichart, drwealth, thesingaporeaninvestor) rather than the manager's primary SGXNet PDF — this happened because the IR-data agents couldn't directly parse certain binary PDF responses. Numbers were cross-checked against multiple secondary sources, but the audit trail is weaker for these REITs. Re-running the IR-data agents with the included `pipeline/extract_pdf.cjs` helper improves coverage.
2. **Three REITs have no fact data yet** (Landmark REIT D5IU, BHG Retail REIT BMGU, Acrophyte Hospitality Trust XZL) — their quarterly results PDFs returned as binary streams that the agent couldn't decode. These show as "n/d" in the screener and don't pass the user screen.
3. **Some REITs missing `report_period`/`report_date`/`report_url`** even though numerics are present (Sasseur, Centurion Accommodation). Easy fix: re-run those groups with the prompt updated to require these metadata fields.
4. **Forward-looking DPU yield not computed.** Manager qualitative guidance is captured in `forward_dpu_guidance` but no numeric forward yield is produced. A quantitative forward yield needs either (a) sell-side consensus, or (b) reliable annualisation of the most recent quarterly DPU — both are doable extensions.
5. **No 5-year history** of DPU, NAV, or gearing — only point-in-time snapshots. A buy-side decision typically wants trend lines; this is a future enhancement.
6. **No tenant-level credit data** beyond top-10 concentration percentage.
7. **No refinancing-wall data** beyond WA debt maturity.

Each item above is a deliberate scope cut for v1, not a hidden assumption.
