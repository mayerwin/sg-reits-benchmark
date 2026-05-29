/* metrics-doc.js
 * Single source of truth for every metric/term used in the SPA.
 * Each entry: { label, abbr, what, why, formula?, healthy?, sources? }
 *
 * Consumed by: column tooltips, drawer field labels, help page.
 */

window.METRICS = {
  // === Market ===
  price: {
    label: 'Price',
    what: 'Last regular-session close from Yahoo Finance, in the REIT\'s trading currency.',
    why: 'The denominator of every yield calculation. Use it with the data-freshness stamp at top — prices are usually intraday-stale by the time you read this.',
    sources: 'Yahoo Finance chart API.',
  },
  market_cap: {
    label: 'Market cap',
    abbr: 'Mkt cap',
    what: 'Total equity value (units outstanding × price), in trading currency.',
    why: 'Determines liquidity, index inclusion, and whether a position size is feasible. Use the market-cap filter in the left rail to screen out micro-caps where you can\'t exit a meaningful position (a ~S$200M floor is a common cut-off).',
    formula: 'shares_outstanding × price',
    sources: 'Yahoo Finance.',
  },

  // === Distribution / Yield ===
  distribution_yield_ttm: {
    label: 'Distribution Yield (TTM)',
    abbr: 'Yield TTM',
    what: 'Trailing-12-month Distribution Per Unit (DPU) divided by the current price, expressed as a percentage. We prefer manager-disclosed DPU over Yahoo\'s headline because Yahoo can include one-off capital distributions.',
    why: 'The single most-cited income metric for REITs. But high yields are NOT high quality — yields above ~9% in S-REITs are almost always a signal of distress (refi risk, falling DPU, value trap), not opportunity. The sweet spot for institutional buyers is the 5.5–7% band.',
    formula: 'DPU TTM (cents) ÷ Price',
    healthy: 'Strong: 5.5–7%. Caution above 9%. Stress above 12% or below 3.5%.',
    sources: 'DPU from issuer quarterly results; price from Yahoo.',
  },
  dpu_ttm_cents: {
    label: 'DPU TTM',
    abbr: 'DPU TTM',
    what: 'Trailing-12-month Distribution Per Unit declared by the manager, in cents of the distribution currency (usually SGD, but USD for US REITs, GBP for Elite UK, EUR for IREIT/Stoneweg).',
    why: 'The numerator of distribution yield. When this includes capital top-ups or income support, the yield it produces overstates recurring cash earnings. Compare to "Yahoo headline yield" — when they diverge, the gap is the manipulation/top-up tell.',
    sources: 'Issuer\'s distribution announcement.',
  },
  yahoo_dividend_yield: {
    label: 'Yahoo headline yield',
    what: 'Yahoo Finance\'s own trailing yield. Often equals manager-disclosed yield, but can include capital distributions, divestment gains, and other one-offs that the recurring DPU stream can\'t sustain.',
    why: 'Useful as a cross-check. When Yahoo > manager-disclosed by 0.5pp+, that gap is a warning sign that some of the declared "distribution" is capital, not income.',
    sources: 'Yahoo Finance quoteSummary API.',
  },
  payout_ratio: {
    label: 'Payout ratio',
    what: 'Yahoo\'s computed ratio of dividends paid to IFRS net income.',
    why: 'For REITs this is often misleading or wild (often >100% or near 0) because IFRS net income includes fair-value gains/losses on properties. Treat as a sanity-check, not a primary metric. A proper sustainability check is "DPU from operations / declared DPU" (we don\'t collect that yet).',
    sources: 'Yahoo Finance.',
  },
  five_year_avg_div_yield: {
    label: '5-year avg dividend yield',
    what: 'Average trailing dividend yield over the last 5 years, per Yahoo.',
    why: 'Useful for spotting yields that have re-rated materially (current yield far above or below the 5y avg can indicate value or distress). Doesn\'t adjust for one-off years.',
    sources: 'Yahoo Finance.',
  },

  // === Leverage ===
  gearing_pct: {
    label: 'Gearing (Aggregate Leverage)',
    abbr: 'Gearing',
    what: 'Total borrowings divided by total deposited property (assets at fair value), as disclosed by the manager. Most managers exclude perpetual securities from this number.',
    why: 'MAS caps S-REIT gearing at 50% (single uniform limit since Nov 2024). The healthy zone is <40%. Approaching the cap means no headroom for acquisitions and forced selling if asset values fall. BUT — gearing is a balance-sheet snapshot. ICR (interest coverage) captures the income-statement impact of rates, which is the real leading indicator of DPU cuts.',
    formula: 'Total borrowings ÷ Deposited property',
    healthy: 'Strong: <35%. Healthy: 35–40%. Caution: 40–45%. Stress: 45–50% (near MAS cap).',
    sources: 'Issuer quarterly results "Capital Management" slide.',
  },
  gearing_pct_incl_perps: {
    label: 'Gearing (incl. perpetual securities)',
    abbr: 'Gear+Perps',
    what: 'Gearing recomputed with perpetual securities added to total borrowings. Some REITs (AIMS, MPACT, Keppel REIT, CICT, Suntec, Manulife US) issue perpetuals which are accounted as equity but economically behave like debt (fixed coupon, callable). The headline gearing excludes them; this column adds them back.',
    why: 'Two REITs with identical "headline" gearing can have very different real leverage if one has heavy perpetuals. The gap between gearing and gearing-incl-perps tells you how much "hidden" leverage exists.',
    formula: '(Total borrowings + Perpetual securities) ÷ Deposited property',
    healthy: 'Same thresholds as headline gearing.',
    sources: 'Issuer balance sheet + capital management slide.',
  },
  icr_x: {
    label: 'Interest Coverage Ratio (Adjusted)',
    abbr: 'ICR',
    what: 'Trailing-12-month EBITDA (excluding fair-value changes) divided by (interest expense + distributions on perpetual securities). MAS-defined formula since Nov 2024.',
    why: 'The leading indicator of DPU sustainability in a high-rate environment. A 35%-gearing REIT looks safe, but if its cost of debt rises 2pp on refinancing, DPU can collapse — gearing barely moves but ICR does. MAS hard floor is 1.5x (no new debt allowed below); soft trigger is 1.8x (manager must publish corrective plans).',
    formula: 'EBITDA (TTM, excl. fair value) ÷ (Interest + Perpetual distributions)',
    healthy: 'Strong: >5x. Healthy: 2.5–5x. Caution: 1.8–2.5x. Stress: <1.8x.',
    sources: 'Issuer "Capital Management" slide.',
  },
  wace_pct: {
    label: 'Weighted Avg Cost of Debt',
    abbr: 'WACE',
    what: 'All-in weighted average interest rate on outstanding borrowings, including hedging effects.',
    why: 'The lower the better. Trend matters more than level — a rising WACE signals refinancing into a tougher rate environment and forewarns DPU pressure. Compare to property yield: when WACE > property yield, leverage destroys equity value.',
    sources: 'Issuer disclosure.',
  },
  pct_fixed_debt: {
    label: '% Fixed-rate debt',
    abbr: '% Fixed',
    what: 'Share of total debt that is on fixed rate (or hedged to fixed via interest-rate swaps).',
    why: 'Higher = more protection if interest rates rise. Below 60% is risky in a rising-rate environment. Above 85% is conservative.',
    healthy: 'Strong: >85%. Healthy: 75–85%. Caution: 60–75%. Stress: <60%.',
    sources: 'Issuer capital management slide.',
  },
  wadm_years: {
    label: 'Weighted Avg Debt Maturity',
    abbr: 'WADM',
    what: 'Average remaining tenor of outstanding debt, weighted by amount.',
    why: 'Longer = more time to refinance gradually rather than at the worst possible moment. <2 years means a near-term refinancing wall (risky).',
    healthy: 'Strong: >4 yrs. Healthy: 3–4 yrs. Caution: 2–3 yrs. Stress: <2 yrs.',
    sources: 'Issuer capital management slide.',
  },
  property_yield_pct: {
    label: 'Property Yield (NPI Yield)',
    abbr: 'Prop Yield',
    what: 'Net Property Income divided by total portfolio fair value. The unlevered yield the buildings themselves throw off.',
    why: 'Useful for two reasons: (1) when property yield is below cost of debt, leverage destroys value — you\'re paying more to borrow than the properties earn; (2) when property yield is unusually high vs sector peers, it may indicate old leases coming up for renewal at lower market rates (yield will compress as leases reset) OR distressed assets. A "good" property yield depends on the sector — data centres / logistics typically 5-6%, office 4-5%, retail 5-6%.',
    formula: 'Net Property Income (annualised) ÷ Portfolio fair value',
    healthy: 'Sector-dependent — compare to peers. Watch the SPREAD vs WACE: positive spread > 1pp is healthy.',
    sources: 'Issuer results (typically as "NPI yield" or "cap rate").',
  },

  // === Operations ===
  occupancy_pct: {
    label: 'Occupancy',
    abbr: 'Occ.',
    what: 'Percentage of net lettable area that is leased. For hotels, this is room-night occupancy. For PBWA/PBSA, bed occupancy.',
    why: 'Vacant space = no income. Trend matters more than level: a slow decline tells you about demand softening before it shows up in DPU. Sector thresholds differ — hospitality 80% is healthy, office/retail 95%+ is healthy.',
    healthy: 'Office/Industrial >95%. Retail >97%. Hospitality >78%. Data Centre >92%. Healthcare master-lease >99%.',
    sources: 'Issuer quarterly business update.',
  },
  wale_years: {
    label: 'Weighted Average Lease Expiry',
    abbr: 'WALE',
    what: 'Average remaining lease term across the portfolio, weighted by either net lettable area (NLA) or gross rental income (GRI). The drawer shows which basis the manager reported.',
    why: 'Long WALE = visibility on cashflow. Short WALE = repricing risk both up (positive reversion) and down. Sector norms differ — retail leases are short by design (2-3y is normal); healthcare master leases run 5-15+ years.',
    healthy: 'Industrial >4y. Data Centre >5y. Healthcare >5y. Office >3y. Retail 2-3y. Hospitality: N/A.',
    sources: 'Issuer portfolio summary.',
  },
  num_properties: {
    label: 'Number of properties',
    abbr: '# Props',
    what: 'Count of distinct properties in the portfolio.',
    why: 'Proxy for diversification — concentration in 2-3 properties means binary risk on each. But quality > count: 5 prime data centres beat 50 mediocre suburban offices.',
    sources: 'Issuer portfolio table.',
  },
  top10_tenant_pct: {
    label: 'Top-10 tenant concentration',
    abbr: 'Top-10',
    what: 'Share of gross rental income from the top 10 tenants.',
    why: 'High concentration = single-tenant credit/renewal risk dominates. Diversified is <30%. Above 50% is a single-tenant story (e.g. Elite UK REIT is essentially a UK-government play, ~92% of GRI).',
    sources: 'Issuer disclosure.',
  },

  // === Valuation ===
  nav_per_unit: {
    label: 'NAV per unit',
    abbr: 'NAV',
    what: 'Net Asset Value per unit — equity (assets at fair value minus liabilities) divided by units outstanding.',
    why: 'The "accounting" floor of the share. But NAV is appraisal-based and lags spot market 6-18 months — a REIT trading at 0.7x NAV in a downturn may simply be priced ahead of an upcoming write-down.',
    sources: 'Issuer balance sheet.',
  },
  p_nav: {
    label: 'Price / NAV',
    abbr: 'P/NAV',
    what: 'Price divided by NAV per unit. Above 1.0x = trading above accounting value (premium); below 1.0x = discount.',
    why: 'POPULAR BUT MISLEADING. NAV is appraisal-based (sticky, lags 6-18 months), ignores leverage quality, and varies by sector convention (DC/logistics persistently >1x, older office <1x). Use as ONE input among many. Better as a TREND vs the REIT\'s own 5-year history than as an absolute level.',
    formula: 'Price ÷ NAV per unit',
    sources: 'Computed. Manager-disclosed NAV preferred; Yahoo price-to-book fallback flagged in the drawer.',
  },
  trailing_pe: {
    label: 'Trailing P/E',
    what: 'Yahoo\'s price-to-earnings ratio.',
    why: 'For REITs, P/E is largely useless because IFRS net income swings wildly with fair-value revaluations. Distribution yield and gearing are far more relevant.',
    sources: 'Yahoo Finance.',
  },

  // === Composite ===
  quality_composite: {
    label: 'Composite Quality',
    abbr: 'Quality',
    what: 'Weighted blend of Leverage (40%), Distribution (30%), and Operations (30%) sub-scores. Each sub-score is normalised against sector-aware thresholds (see Methodology §7).',
    why: 'A TRIAGE TOOL, not a buy signal. It captures capital-management discipline + recurring yield + operating metrics. It does NOT capture sponsor strength, tenant credit, refinancing cliffs, distribution composition (organic vs capital top-ups), or unit-dilution from manager fees.',
    healthy: 'Strong: ≥80. Healthy: 65–80. Caution: 45–65. Stress: <45.',
    sources: 'Computed in pipeline/merge.mjs.',
  },
  report_date: {
    label: 'As of',
    what: 'Date of the most recent results filing this REIT\'s metrics were sourced from.',
    why: 'Data freshness matters — a 6-month-stale gearing number tells you about the world before the latest rate move. Quarterly REITs are usually 1-3 months stale; H-yearly ones up to 6 months.',
    sources: 'Issuer announcement date.',
  },

  // === Other terms (for tooltips on labels that aren't column headers) ===
  ttm: {
    label: 'TTM (Trailing 12 Months)',
    what: 'A rolling 12-month window ending at the latest reported period.',
    why: 'Used to normalise yields across REITs that report on different fiscal calendars and pay distributions at different cadences (quarterly vs semi-annual).',
  },
  dpu: {
    label: 'DPU (Distribution Per Unit)',
    what: 'Cash distributed per unit, declared by the manager. Singapore REITs distribute at least 90% of taxable income.',
    why: 'The cash you actually receive as a unitholder. Note: declared DPU can include capital distributions (which deplete NAV) — we surface manager DPU separately from Yahoo headline yield to spot this.',
  },
  npi: {
    label: 'NPI (Net Property Income)',
    what: 'Gross rental income minus property operating expenses (before interest, depreciation, tax, manager fees).',
    why: 'The unlevered cash the properties throw off. The numerator of property yield. NOT what flows to unitholders — that\'s "distributable income", which subtracts interest, manager fees, and trust expenses.',
  },
  wale_basis_nla: {
    label: 'WALE basis: NLA',
    what: 'WALE weighted by Net Lettable Area.',
    why: 'Often longer than GRI-weighted WALE because larger tenants with longer leases dominate area but may be lower-rent.',
  },
  wale_basis_gri: {
    label: 'WALE basis: GRI',
    what: 'WALE weighted by Gross Rental Income.',
    why: 'Often more relevant for income visibility because high-rent tenants carry more weight.',
  },
  perpetual_securities: {
    label: 'Perpetual Securities',
    what: 'Hybrid instruments with no fixed maturity that pay a fixed distribution. Accounted as equity but economically behave like debt.',
    why: 'Many SG REIT managers issue perpetuals and exclude them from headline gearing. This understates real leverage. The "Gearing incl. perps" column adds them back.',
  },

  // === Data-freshness labels (masthead tooltips) ===
  market_data_freshness: {
    label: 'Market data',
    what: 'Timestamp of the last Yahoo Finance fetch — the prices, market caps, 52-week ranges and TTM yields. Shown in Singapore time (SGT).',
    why: 'Prices move continuously while the market is open; this tells you how stale the quote-driven figures are. The GitHub Actions pipeline refreshes this every trading day after the SGX close.',
  },
  master_validated: {
    label: 'Master validated',
    what: 'The date the canonical REIT list (names, tickers, sectors, sponsors, IR links) was last cross-checked against REITAS, SGX and SGinvestors.',
    why: 'This is NOT the price date — it is when the universe itself was last verified for IPOs, delistings, renames and suspensions. The REIT-specific metrics (gearing, ICR, DPU, etc.) carry their own per-filing "As of" date, shown in each row and the detail drawer.',
  },
};

window.METRIC_GROUPS = {
  market: ['price', 'market_cap'],
  distribution: ['distribution_yield_ttm', 'dpu_ttm_cents', 'yahoo_dividend_yield', 'payout_ratio', 'five_year_avg_div_yield'],
  leverage: ['gearing_pct', 'gearing_pct_incl_perps', 'icr_x', 'wace_pct', 'pct_fixed_debt', 'wadm_years', 'property_yield_pct'],
  operations: ['occupancy_pct', 'wale_years', 'num_properties', 'top10_tenant_pct'],
  valuation: ['nav_per_unit', 'p_nav', 'trailing_pe'],
  composite: ['quality_composite', 'report_date'],
  terms: ['ttm', 'dpu', 'npi', 'wale_basis_nla', 'wale_basis_gri', 'perpetual_securities'],
};
