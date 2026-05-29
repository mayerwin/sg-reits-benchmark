#!/usr/bin/env node
/**
 * merge.mjs
 *
 * Merges:
 *   data/reits_master.json    — canonical REIT metadata (name, sector, IR URLs, ...)
 *   data/yahoo.json           — Yahoo Finance market data per REIT
 *   data/reit_facts_*.json    — REIT-specific metrics gathered from IR pages (one per agent group)
 *
 * Into:
 *   data/data.json            — flat array consumed by the SPA
 *   spa/data.json             — copy for SPA consumption (relative URL)
 *
 * Each merged record carries per-field provenance (source URL + when it was fetched).
 *
 * The merger DERIVES some metrics:
 *   - distribution_yield_ttm (computed from manager DPU/price, OR Yahoo's headline if facts missing)
 *   - yield_gap_yahoo_vs_manager (Yahoo headline minus manager-DPU yield — flags capital top-ups)
 *   - p_nav (manager NAV preferred, Yahoo price-to-book fallback) + p_nav_source
 *   - gearing_pct_incl_perps passthrough (perpetual-securities-inclusive leverage)
 *   - composite quality score (per docs/METHODOLOGY.md §7 weighting)
 *   - "passes_user_screen" boolean: gearing < 40% AND market_cap >= 200M trading-currency
 *
 * NOTE: there is intentionally NO "cash_earnings_yield" field. (dpu_ttm × shares / mcap)
 * is algebraically identical to (dpu_ttm / price) = distribution_yield_ttm, so emitting it
 * separately would mislead. See the long comment in the record-building map below.
 *
 * Re-run after either Yahoo or facts files refresh.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SPA_DIR = path.resolve(__dirname, '..', 'spa');

const MASTER = path.join(DATA_DIR, 'reits_master.json');
const YAHOO = path.join(DATA_DIR, 'yahoo.json');
const OUT_DATA = path.join(DATA_DIR, 'data.json');
const OUT_SPA = path.join(SPA_DIR, 'data.json');

const FACT_GROUP_FILES = [
  'reit_facts_group1.json',
  'reit_facts_group2.json',
  'reit_facts_group3.json',
  'reit_facts_group4.json',
  'reit_facts_group5.json',
];
const SOURCE_WHITELIST_FILE = path.join(DATA_DIR, 'source_whitelist.json');

async function readJsonSafe(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Allowed source check. Returns true if the URL is from an authoritative source.
 *   Authoritative = SGX, Yahoo Finance, issuer IR pages, REITAS, MAS, or any host
 *   explicitly whitelisted in data/source_whitelist.json.
 */
function isAuthoritativeSource(url, whitelist) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  const u = url.toLowerCase();
  // Built-in authoritative patterns.
  // Categories: (1) the exchange, (2) Yahoo, (3) regulator/industry body,
  //   (4) generic issuer-IR hosting platforms, (5) manager corporate domains.
  const builtIn = [
    // (1) Exchange
    'sgx.com', 'links.sgx.com',
    // (2) Yahoo
    'finance.yahoo.com', 'query1.finance.yahoo.com', 'query2.finance.yahoo.com',
    // (3) Regulator / industry
    'reitas.sg', 'mas.gov.sg',
    // (4) Generic issuer-IR hosting platforms. `listedcompany.com` is SGX's own
    //     investor-relations hosting service (operated by SGX/Investis) — every URL
    //     on it is an issuer's own filing. q4cdn.com is Q4 Inc's IR-platform CDN that
    //     hosts issuers' own documents (used by Digital Core REIT etc.).
    'listedcompany.com', 'q4cdn.com',
    // (5) Manager / sponsor corporate domains and per-REIT IR subdomains
    'capitaland.com', 'frasersproperty.com', 'mapletree',
    'investor.cict.com.sg', 'investor.capitaland-ascendasreit.com',
    'investor.capitalandascotttrust.com', 'investor.clct.com.sg', 'investor.clint.com.sg',
    'keppelreit.com', 'keppeldcreit.com', 'keppel.com', 'koreusreit.com',
    'investor.suntecreit.com',
    'plifereit.com', 'investor.ouereit.com', 'ouect.com', 'starhillglobalreit.com',
    'lendleaseglobalcommercialreit.com',
    'investor.aimsapacreit.com', 'investor.cdlht.com', 'cdlht.com',
    'investor.sasseurreit.com',
    'investor.careit.com.sg', 'nttdcreit.com', 'ir.nttdcreit.com',
    'digitalcorereit.com', 'daiwahouse-logisticstrust.com',
    'ir.uibreit.com', 'uibreit.com', 'investor.ai-reit.com', 'ai-reit.com',
    'ir.landmarkreit.com',
    'first-reit.com',
    'investor.ireitglobal.com', 'ireitglobal.com',
    'stonewegeuropestapledtrust.com.sg',
    'investor.eliteukreit.com', 'eliteukreit.com',
    'investor.manulifeusreit.sg', 'manulifeusreit.sg',
    'investor.primeusreit.com', 'primeusreit.com', 'investor.uhreit.com', 'uhreit.com',
    'investor.acrophytetrust.com', 'acrophytetrust.com',
  ];
  for (const pattern of builtIn) if (u.includes(pattern)) return true;
  // User-whitelisted hosts
  if (whitelist?.allow) {
    for (const pattern of whitelist.allow) if (u.includes(pattern)) return true;
  }
  return false;
}

/**
 * Quality scoring — see docs/METHODOLOGY.md §7 for the exact weighting and bands.
 *
 * Each sub-score returns: { score, ..._partials, n_inputs, max_inputs }
 * so the SPA can render a confidence indicator alongside the number.
 */
function scoreLeverage({ gearing_pct, icr_x, pct_fixed_debt, wadm_years }) {
  // gearing — single 50% MAS cap (post-Nov 2024); harder penalty as you approach the ceiling
  let gearScore = null;
  if (gearing_pct != null) {
    if (gearing_pct < 35) gearScore = 100;
    else if (gearing_pct < 40) gearScore = 80;
    else if (gearing_pct < 45) gearScore = 55;
    else if (gearing_pct < 50) gearScore = 25; // Stress — within 5pp of MAS cap
    else gearScore = 0;                          // Breach
  }
  // ICR — MAS 1.5x hard floor, 1.8x soft trigger
  let icrScore = null;
  if (icr_x != null) {
    if (icr_x >= 5) icrScore = 100;
    else if (icr_x >= 3.5) icrScore = 85;
    else if (icr_x >= 2.5) icrScore = 70;
    else if (icr_x >= 1.8) icrScore = 45;
    else if (icr_x >= 1.5) icrScore = 25;
    else icrScore = 10;
  }
  let fixedScore = null;
  if (pct_fixed_debt != null) {
    if (pct_fixed_debt >= 85) fixedScore = 100;
    else if (pct_fixed_debt >= 75) fixedScore = 85;
    else if (pct_fixed_debt >= 60) fixedScore = 65;
    else fixedScore = 40;
  }
  let wadmScore = null;
  if (wadm_years != null) {
    if (wadm_years >= 4) wadmScore = 100;
    else if (wadm_years >= 3) wadmScore = 80;
    else if (wadm_years >= 2) wadmScore = 60;
    else wadmScore = 35;
  }
  const parts = [gearScore, icrScore, fixedScore, wadmScore].filter(s => s != null);
  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  return { score, gearScore, icrScore, fixedScore, wadmScore, n_inputs: parts.length, max_inputs: 4 };
}

/** Map a sector string to a normalised key for sector-aware scoring. */
function classifySector(sector) {
  const s = (sector || '').toLowerCase();
  if (s.includes('hospitality')) return 'hospitality';
  if (s.includes('healthcare')) return 'healthcare';
  if (s.includes('data centre') || s.includes('data center')) return 'data_centre';
  if (s.includes('retail')) return 'retail';
  if (s.includes('office')) return 'office';
  if (s.includes('industrial')) return 'industrial';
  return 'diversified';
}

function scoreOperations({ occupancy_pct, wale_years, sector }) {
  const cls = classifySector(sector);
  let occScore = null;
  let waleScore = null;

  // Occupancy thresholds (sector-aware). Hospitality occupancy is not comparable to office/retail
  // occupancy (one is nightly room nights, the other is leased NLA), so we use much lower bands.
  if (occupancy_pct != null) {
    if (cls === 'hospitality') {
      occScore = occupancy_pct >= 85 ? 100 : occupancy_pct >= 78 ? 80 : occupancy_pct >= 70 ? 55 : 30;
    } else if (cls === 'retail') {
      occScore = occupancy_pct >= 98 ? 100 : occupancy_pct >= 95 ? 80 : occupancy_pct >= 90 ? 55 : 30;
    } else if (cls === 'data_centre') {
      occScore = occupancy_pct >= 97 ? 100 : occupancy_pct >= 92 ? 85 : occupancy_pct >= 88 ? 60 : 35;
    } else if (cls === 'healthcare') {
      // Healthcare REITs typically run on master leases — occupancy ~100% by structure
      occScore = occupancy_pct >= 99 ? 100 : occupancy_pct >= 95 ? 85 : occupancy_pct >= 90 ? 60 : 30;
    } else {
      // office / industrial / diversified
      occScore = occupancy_pct >= 97 ? 100 : occupancy_pct >= 95 ? 85 : occupancy_pct >= 90 ? 55 : 30;
    }
  }

  // WALE thresholds (sector-aware). Hospitality WALE is N/A (nightly rates), so we don't score it.
  if (wale_years != null && cls !== 'hospitality') {
    if (cls === 'data_centre') {
      waleScore = wale_years >= 7 ? 100 : wale_years >= 5 ? 85 : wale_years >= 3 ? 60 : 30;
    } else if (cls === 'healthcare') {
      // Healthcare master leases are very long; 10y+ is normal
      waleScore = wale_years >= 8 ? 100 : wale_years >= 5 ? 85 : wale_years >= 3 ? 60 : 35;
    } else if (cls === 'industrial') {
      waleScore = wale_years >= 5 ? 100 : wale_years >= 3 ? 80 : wale_years >= 2 ? 55 : 30;
    } else if (cls === 'office') {
      waleScore = wale_years >= 4 ? 100 : wale_years >= 2.5 ? 80 : wale_years >= 1.5 ? 55 : 30;
    } else if (cls === 'retail') {
      // Retail leases are short by design (2-3 yrs is normal)
      waleScore = wale_years >= 3 ? 100 : wale_years >= 2 ? 80 : wale_years >= 1.5 ? 60 : 35;
    } else {
      waleScore = wale_years >= 3 ? 100 : wale_years >= 2 ? 75 : wale_years >= 1.5 ? 50 : 25;
    }
  }

  const parts = [occScore, waleScore].filter(s => s != null);
  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  // For hospitality, WALE is structurally absent — so max_inputs is 1 not 2
  const max_inputs = cls === 'hospitality' ? 1 : 2;
  return { score, occScore, waleScore, n_inputs: parts.length, max_inputs };
}

/**
 * Distribution score.
 *
 * IMPORTANT: high yield is NOT high quality. Yields above ~9% in S-REITs are almost always
 * a signal of distress (gearing/refi risk, falling DPU, value trap) rather than opportunity.
 * The score peaks in the 5.5–7% band and decays both above and below.
 */
function scoreDistribution({ distribution_yield_ttm, payoutRatio, dpu_ttm_cents, yahoo_dividend_yield }) {
  let yieldScore = null;
  if (distribution_yield_ttm != null) {
    const y = distribution_yield_ttm * 100;
    if (y >= 12) yieldScore = 35;       // extreme — almost certainly distressed
    else if (y >= 9) yieldScore = 55;    // very high — strong yield-trap risk
    else if (y >= 7) yieldScore = 80;
    else if (y >= 5.5) yieldScore = 95;  // sweet spot
    else if (y >= 4.5) yieldScore = 80;
    else if (y >= 3.5) yieldScore = 65;
    else yieldScore = 50;
  }
  // Sustainability flag: when manager-disclosed DPU implies a yield materially BELOW Yahoo's
  // headline yield, that's a sign Yahoo is counting capital distributions / one-off top-ups
  // that the recurring distributable income can't sustain.
  let sustainScore = null;
  if (distribution_yield_ttm != null && yahoo_dividend_yield != null && dpu_ttm_cents != null) {
    const ratio = distribution_yield_ttm / yahoo_dividend_yield;
    if (ratio >= 0.98) sustainScore = 95;
    else if (ratio >= 0.90) sustainScore = 75;
    else if (ratio >= 0.80) sustainScore = 55;
    else sustainScore = 35; // headline yield dominated by non-recurring items
  } else if (payoutRatio != null && payoutRatio > 0) {
    if (payoutRatio <= 0.9) sustainScore = 80;
    else if (payoutRatio <= 1.0) sustainScore = 65;
    else if (payoutRatio <= 1.1) sustainScore = 45;
    else sustainScore = 25;
  }
  const parts = [yieldScore, sustainScore].filter(s => s != null);
  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  return { score, yieldScore, sustainScore, n_inputs: parts.length, max_inputs: 2 };
}

// Composite weights — kept in sync with METHODOLOGY.md §7.
// The "valuation" bucket is currently null for all REITs (would require 5y P/NAV history we
// don't collect); when null its weight is redistributed across the other three.
const COMPOSITE_WEIGHTS = { leverage: 0.40, distribution: 0.30, operations: 0.30 };

function compositeQualityScore(parts, weights = COMPOSITE_WEIGHTS) {
  let sum = 0, totalW = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (parts[k] != null) {
      sum += parts[k] * w;
      totalW += w;
    }
  }
  return totalW > 0 ? Math.round(sum / totalW) : null;
}

async function main() {
  const master = JSON.parse(await fs.readFile(MASTER, 'utf8'));
  const yahoo = JSON.parse(await fs.readFile(YAHOO, 'utf8'));
  const whitelist = await readJsonSafe(SOURCE_WHITELIST_FILE);

  const facts = {};
  const factsMeta = {};
  for (const fname of FACT_GROUP_FILES) {
    const fp = path.join(DATA_DIR, fname);
    const j = await readJsonSafe(fp);
    if (!j) continue;
    factsMeta[fname] = j._meta;
    if (j.reits) {
      for (const [ticker, rec] of Object.entries(j.reits)) {
        facts[ticker] = { ...rec, _fetched_at: rec._fetched_at || j._meta?.fetched_at || null, _group: j._meta?.agent || fname };
      }
    }
  }

  const yahooByTicker = Object.fromEntries(yahoo.data.map(d => [d.ticker, d]));
  const FX = yahoo._meta?.fx || { SGD: 1 };   // units of SGD per 1 unit of currency

  const records = master.reits.map(reit => {
    const t = reit.ticker;
    const y = yahooByTicker[t] || {};
    const f = facts[t] || {};

    const price = y.chart?.regularMarketPrice;
    const currency = y.chart?.currency || reit.trading_currency;
    const marketCap = y.summary?.marketCap;
    const yahooYield = y.summary?.dividendYield_trailing; // fraction
    const dpuCurrency = f.dpu_currency || currency;
    const dpuTTM = f.dpu_ttm_cents != null ? f.dpu_ttm_cents / 100 : null;
    const isStub = f.dpu_ttm_is_stub === true;   // recent IPO: trailing/period figures unreliable

    // Convert `price` (in trading currency) into the DISTRIBUTION currency so a yield divides
    // like-for-like. Needed for REITs that pay in a different currency than they trade in
    // (e.g. Stoneweg / IREIT trade in SGD but distribute in EUR). FX = SGD-per-unit.
    const priceInDpuCcy = (price != null && FX[currency] && FX[dpuCurrency])
      ? price * FX[currency] / FX[dpuCurrency]
      : price;
    const yieldFromDpu = (dpuCents) => (dpuCents != null && priceInDpuCcy != null && priceInDpuCcy > 0)
      ? (dpuCents / 100) / priceInDpuCcy
      : null;

    // Distribution yield: prefer manager-disclosed DPU (FX-reconciled) over Yahoo. For a
    // stub-period IPO the trailing DPU isn't a true 12 months, so we suppress it (the forward
    // yield carries the real signal) rather than show a misleadingly low number.
    const sanitize = (v) => (v == null || Number.isNaN(v)) ? null : v;
    const distYield = isStub ? null : sanitize(
      (dpuTTM != null) ? yieldFromDpu(f.dpu_ttm_cents) : yahooYield,
    );

    // Run-rate forward yield = latest declared period DPU annualised by payment frequency.
    // This is only trustworthy when the latest figure IS one full distribution period. Several
    // semi-annual payers report a QUARTERLY DPU in their 1Q update, so `last × freq` under-
    // annualises. Guard: keep the run-rate only when it's within a sane band of the (reliable,
    // FX-reconciled) trailing yield, OR the divergence is explained by a large real DPU trend
    // (|YoY| > 20%, e.g. IREIT down 42%). Otherwise the period basis is ambiguous → suppress.
    let fwdRunRate = (!isStub && f.dpu_last_period_cents != null && f.distribution_frequency)
      ? yieldFromDpu(f.dpu_last_period_cents * f.distribution_frequency)
      : null;
    if (fwdRunRate != null && distYield != null && distYield > 0) {
      const ratio = fwdRunRate / distYield;
      const trendExplains = f.dpu_yoy_pct != null && Math.abs(f.dpu_yoy_pct) > 20;
      if ((ratio > 1.4 || ratio < 0.7) && !trendExplains) fwdRunRate = null;
    }

    // NOTE on "true profits" / cash earnings yield:
    //   The user asked for "cash received minus all cash costs (incl. interest), excluding
    //   depreciation and fair-value gains". The IDEAL metric is `DPU from operations` (recurring
    //   distributable income with capital top-ups, income support, and unit-settled manager fees
    //   stripped out) divided by market cap.
    //
    //   We do NOT currently collect `dpu_from_operations` from the IR pages. Until the IR-data
    //   agents emit that field, the best honest proxy we have is `distribution_yield_ttm` itself
    //   computed from manager-disclosed DPU (preferred) vs Yahoo's headline (fallback). Note that
    //   when manager-DPU and Yahoo-headline diverge, the gap is itself informative: it suggests
    //   Yahoo is counting capital distributions / one-offs that the recurring distributable
    //   income can't sustain. The merger surfaces both values for that comparison.
    //
    //   We do NOT compute `dpu_ttm × shares / market_cap` separately because algebraically that
    //   equals `dpu_ttm / price` — the same number labelled twice would mislead.

    // P/NAV from manager-disclosed NAV when available, else Yahoo's price-to-book as fallback.
    // We tag the source so the SPA can warn the user when the fallback is used (priceToBook is
    // not strictly P/NAV for SG-listed instruments — different share-count conventions).
    const navPerUnit = f.nav_per_unit;
    let pNav = null, pNavSource = null;
    if (navPerUnit != null && price != null && navPerUnit > 0) {
      pNav = price / navPerUnit;
      pNavSource = 'manager_nav';
    } else if (y.summary?.priceToBook != null) {
      pNav = y.summary.priceToBook;
      pNavSource = 'yahoo_priceToBook';
    }

    // Scores
    const levScore = scoreLeverage({
      gearing_pct: f.gearing_pct,
      icr_x: f.icr_x,
      pct_fixed_debt: f.pct_fixed_debt,
      wadm_years: f.wadm_years,
    });
    const opsScore = scoreOperations({
      occupancy_pct: f.occupancy_pct,
      wale_years: f.wale_years,
      sector: reit.sector,
    });
    const distScore = scoreDistribution({
      distribution_yield_ttm: distYield,
      payoutRatio: y.summary?.payoutRatio,
    });
    const valScore = null; // P/NAV scoring requires 5y history we don't have — left null for now
    const composite = compositeQualityScore({
      leverage: levScore.score,
      distribution: distScore.score,
      operations: opsScore.score,
      valuation: valScore,
    });

    // User's screen: gearing < 40% AND market cap > 200M trading-currency
    const passesUserScreen = (f.gearing_pct != null && f.gearing_pct < 40)
      && (marketCap != null && marketCap >= 200e6);

    return {
      ticker: t,
      name: reit.name,
      sector: reit.sector,
      sub_sector: reit.sub_sector,
      geography: reit.geography,
      sponsor: reit.sponsor,
      ir_url: reit.ir_url,
      trading_currency: currency,
      alt_counter: reit.alt_counter || null,

      // Market data
      price,
      market_cap: marketCap,
      fifty_two_week_high: y.summary?.fiftyTwoWeekHigh,
      fifty_two_week_low: y.summary?.fiftyTwoWeekLow,
      fifty_day_avg: y.summary?.fiftyDayAverage,
      two_hundred_day_avg: y.summary?.twoHundredDayAverage,
      shares_outstanding: y.summary?.sharesOutstanding,
      price_series: y.chart?.priceSeries || [],
      quote_time: y.chart?.regularMarketTime,
      beta: y.summary?.beta,

      // Distributions
      distribution_yield_ttm: distYield,
      yahoo_dividend_yield: yahooYield,
      dpu_ttm_cents: f.dpu_ttm_cents ?? null,
      dpu_last_period_cents: f.dpu_last_period_cents ?? null,
      dpu_currency: f.dpu_currency ?? currency,
      payout_ratio: y.summary?.payoutRatio,
      ex_dividend_date: y.summary?.exDividendDate,
      five_year_avg_div_yield: y.summary?.fiveYearAvgDividendYield, // sometimes a percent value (e.g. 4.72)
      forward_dpu_guidance: f.forward_dpu_guidance ?? null,

      // Cash earnings yield is intentionally NOT emitted as a separate field — see the long
      // comment in merge.mjs. Until DPU-from-operations is collected, the manager-disclosed
      // `distribution_yield_ttm` is the most honest "true profits" proxy we can produce.
      // The yield_gap_yahoo_vs_manager value below quantifies the gap between Yahoo's headline
      // (which can include capital distributions) and the recurring DPU yield.
      yield_gap_yahoo_vs_manager: (yahooYield != null && distYield != null && distYield > 0)
        ? (yahooYield - distYield)
        : null,

      // === Forward-looking (expected future yield) ===
      // Run-rate forward yield: annualise the latest declared period DPU (period × freq), FX-
      // reconciled to the distribution currency. Captures a recent acquisition/divestment the
      // trailing-12M yield hasn't caught up to. SUPPRESSED for stub-period IPOs, whose maiden
      // period isn't a clean ×freq window — their guided forward yield is the honest read instead.
      forward_yield_run_rate: fwdRunRate,
      // Guided forward yield: from a manager/prospectus numeric DPU forecast (mostly IPOs/guidance).
      forward_yield_guidance: yieldFromDpu(f.forecast_dpu_cents),
      dpu_ttm_is_stub: isStub,
      distribution_frequency: f.distribution_frequency ?? null,
      forecast_dpu_cents: f.forecast_dpu_cents ?? null,
      forecast_dpu_basis: f.forecast_dpu_basis ?? null,
      // Leading indicators of future DPU direction:
      rental_reversion_pct: f.rental_reversion_pct ?? null,           // future rental income
      pct_debt_due_12m: f.pct_debt_due_12m ?? null,                   // refinancing wall
      dpu_change_per_100bps_pct: f.dpu_change_per_100bps_pct ?? null, // MAS-mandated rate sensitivity
      dpu_yoy_pct: f.dpu_yoy_pct ?? null,                             // organic momentum

      // Capital management
      gearing_pct: f.gearing_pct ?? null,
      gearing_pct_incl_perps: f.gearing_pct_incl_perps ?? null,
      perpetual_securities_note: f.perpetual_securities_note ?? null,
      icr_x: f.icr_x ?? null,
      wace_pct: f.wace_pct ?? null,
      pct_fixed_debt: f.pct_fixed_debt ?? null,
      wadm_years: f.wadm_years ?? null,
      property_yield_pct: f.property_yield_pct ?? null,

      // Valuation
      nav_per_unit: navPerUnit ?? null,
      p_nav: pNav,
      p_nav_source: pNavSource,
      trailing_pe: y.summary?.trailingPE,

      // Portfolio
      occupancy_pct: f.occupancy_pct ?? null,
      wale_years: f.wale_years ?? null,
      wale_basis: f.wale_basis ?? null,
      num_properties: f.num_properties ?? null,
      aum_total: f.aum_total ?? null,
      top10_tenant_pct: f.top10_tenant_pct ?? null,
      geographic_split: f.geographic_split ?? null,

      // Reporting
      report_period: f.report_period ?? null,
      report_date: f.report_date ?? null,
      report_url: f.report_url ?? null,

      // Sources per field — accept several common key variants from agent outputs.
      // Each source is tagged with `authoritative` so the SPA can warn the user.
      sources: (() => {
        const raw = {
          chart: y.sources?.chart,
          summary: y.sources?.quote_summary,
          gearing: f.gearing_source ?? null,
          gearing_incl_perps: f.gearing_pct_incl_perps_source ?? null,
          icr: f.icr_source ?? null,
          dpu: f.dpu_source ?? f.dpu_ttm_source ?? f.dpu_last_period_source ?? null,
          nav: f.nav_source ?? f.nav_per_unit_source ?? null,
          occupancy: f.occupancy_source ?? null,
          wale: f.wale_source ?? null,
          debt: f.debt_source ?? f.wace_source ?? f.pct_fixed_debt_source ?? f.wadm_source ?? null,
          properties: f.num_properties_source ?? f.properties_source ?? null,
          property_yield: f.property_yield_source ?? null,
          forecast_dpu: f.forecast_dpu_source ?? null,
          rental_reversion: f.rental_reversion_source ?? null,
          debt_maturity: f.pct_debt_due_12m_source ?? null,
          rate_sensitivity: f.dpu_change_per_100bps_source ?? null,
          dpu_yoy: f.dpu_yoy_source ?? null,
          distribution_frequency: f.distribution_frequency_source ?? null,
          report: f.report_url_source ?? null,
        };
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v) out[k] = { url: v, authoritative: isAuthoritativeSource(v, whitelist) };
          else out[k] = null;
        }
        return out;
      })(),

      // Scores
      scores: {
        leverage: levScore,
        distribution: distScore,
        operations: opsScore,
        composite,
      },

      // User screen
      passes_user_screen: passesUserScreen,

      // Provenance
      yahoo_fetched_at: y.fetched_at ?? null,
      facts_fetched_at: f._fetched_at ?? null,
    };
  });

  const out = {
    _meta: {
      generated_at: new Date().toISOString(),
      master_validated: master._meta.last_validated,
      yahoo_generated_at: yahoo._meta.generated_at,
      facts_groups_present: Object.keys(factsMeta),
      reit_count: records.length,
      doc: 'Per-field provenance lives in each record\'s .sources sub-object. See docs/METHODOLOGY.md for metric definitions.',
    },
    reits: records,
  };

  // Set generated_at AFTER all work is complete (more honest than at start)
  out._meta.generated_at = new Date().toISOString();

  await fs.writeFile(OUT_DATA, JSON.stringify(out, null, 2));
  await fs.mkdir(SPA_DIR, { recursive: true });
  await fs.writeFile(OUT_SPA, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_DATA}`);
  console.log(`Wrote ${OUT_SPA}`);
  const passing = records.filter(r => r.passes_user_screen).length;
  const withFacts = records.filter(r => r.gearing_pct != null);
  const missing = records.filter(r => r.gearing_pct == null);
  console.log(`REITs with fact data: ${withFacts.length} / ${records.length}`);
  console.log(`REITs passing user screen (gearing<40% AND mcap>=200M trading-ccy): ${passing} / ${records.length}`);
  if (missing.length) {
    console.log(`Missing fact data for ${missing.length} REITs: ${missing.map(r => r.ticker).join(', ')}`);
    console.log('  (re-run the relevant agent_prompts/group{N}.md or update those REITs manually)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
