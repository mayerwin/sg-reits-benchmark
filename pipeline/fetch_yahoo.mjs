#!/usr/bin/env node
/**
 * fetch_yahoo.mjs
 *
 * Pulls market data for every REIT in data/reits_master.json from Yahoo Finance.
 *
 * Two endpoints are used per REIT:
 *   1. Chart API (no auth):
 *        https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}.SI?interval=1d&range=1y
 *      Yields: latest price, currency, 52-week range, 1-year price series for sparkline.
 *
 *   2. quoteSummary API (cookie + crumb required):
 *        https://query2.finance.yahoo.com/v10/finance/quoteSummary/{TICKER}.SI
 *      Yields: dividendYield (TTM), dividendRate, exDividendDate, payoutRatio,
 *              marketCap, priceToBook, bookValue, trailingPE, forwardPE,
 *              fiveYearAvgDividendYield, beta.
 *
 *   The crumb is obtained once at start by hitting fc.yahoo.com (for cookies)
 *   then v1/test/getcrumb.
 *
 * Each emitted record carries `fetched_at` (ISO timestamp).
 *
 * Output: data/yahoo.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const MASTER_PATH = path.join(DATA_DIR, 'reits_master.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'yahoo.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Get a {cookie, crumb} pair to authorize quoteSummary calls. */
async function getAuthOnce() {
  // Trigger fc.yahoo.com to set the A1/A3 cookies
  const seed = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
    redirect: 'manual',
  });
  const setCookie = seed.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map(s => s.split(';')[0]).join('; ');
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'text/plain' },
  });
  if (!crumbRes.ok) throw new Error(`crumb endpoint ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  // A valid crumb is a short alphanumeric token. Yahoo returns an HTML/error page when it
  // blocks the request (common from cloud/CI egress IPs).
  if (!crumb || crumb.length > 32 || !/^[A-Za-z0-9._\-]+$/.test(crumb)) {
    throw new Error(`No valid crumb returned (cookies/IP may be blocked). Got: "${crumb.slice(0, 40)}"`);
  }
  return { cookie, crumb };
}

/**
 * Acquire auth with a few retries. If it ultimately fails (e.g. Yahoo blocks the CI runner's
 * IP from the crumb endpoint), returns null so the run degrades to CHART-ONLY data — the
 * v8 chart API needs no auth, so prices/52w/sparkline still refresh. quoteSummary fields
 * (market cap, TTM yield, P/B) will be null for that run; the merger handles nulls gracefully.
 */
async function getAuth(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await getAuthOnce();
    } catch (e) {
      console.warn(`  auth attempt ${attempt}/${retries} failed: ${e.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

/** FX rates as "units of SGD per 1 unit of currency" (so SGD = 1). Used ONLY to reconcile a
 *  REIT whose distribution currency differs from its trading currency (e.g. Stoneweg/IREIT pay
 *  EUR but trade in SGD) so its yield is computed in a single currency. Chart API needs no auth. */
async function fetchFx() {
  const fx = { SGD: 1 };
  for (const ccy of ['USD', 'EUR', 'GBP']) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ccy}SGD=X?interval=1d&range=5d`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`FX ${ccy} ${res.status}`);
      const j = await res.json();
      const rate = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (Number.isFinite(rate) && rate > 0) fx[ccy] = rate;
    } catch (e) { console.warn(`  FX ${ccy}SGD failed: ${e.message}`); }
  }
  return fx;
}

async function fetchChart(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SI?interval=1d&range=1y&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Chart API ${res.status} for ${ticker}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart result for ${ticker}`);
  return result;
}

async function fetchQuoteSummary(ticker, auth) {
  const modules = 'summaryDetail,price,defaultKeyStatistics';
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}.SI?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Cookie': auth.cookie, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`QuoteSummary ${res.status} for ${ticker}`);
  const json = await res.json();
  if (json?.quoteSummary?.error) throw new Error(`QuoteSummary err: ${JSON.stringify(json.quoteSummary.error)}`);
  return json.quoteSummary?.result?.[0] ?? null;
}

/** Robust raw-or-null. Yahoo wraps values as { raw, fmt }. Some values are returned as {}
 *  (empty object) when the field exists but has no value — treat those as null. */
const rawOrNull = (obj, key) => {
  const v = obj?.[key];
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.raw !== undefined && Number.isFinite(v.raw)) return v.raw;
    return null; // empty {} or wrapper with no raw
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v;
};

/** Yahoo is inconsistent on yield units:
 *   - dividendYield, trailingAnnualDividendYield  → fraction (0..1)
 *   - fiveYearAvgDividendYield                   → percent  (e.g. 4.72)
 *   - payoutRatio                                → fraction, but occasionally a wild >>1 value
 *     when trailing earnings are near zero (IFRS fair-value losses). Cap at 3.0 — anything
 *     larger is noise and a payout ratio above 200% has no meaningful interpretation.
 *  Returning normalised values so all downstream consumers can trust one convention. */
function normalise(summary) {
  if (!summary) return summary;
  // fiveYearAvgDividendYield: percent → fraction
  if (summary.fiveYearAvgDividendYield != null && summary.fiveYearAvgDividendYield > 1) {
    summary.fiveYearAvgDividendYield = summary.fiveYearAvgDividendYield / 100;
  }
  // payoutRatio sanity-cap
  if (summary.payoutRatio != null && (summary.payoutRatio > 3 || summary.payoutRatio < 0)) {
    summary._payoutRatio_raw = summary.payoutRatio;
    summary.payoutRatio = null;
  }
  return summary;
}

function extractSummary(qs) {
  if (!qs) return null;
  const sd = qs.summaryDetail ?? {};
  const ks = qs.defaultKeyStatistics ?? {};
  const pr = qs.price ?? {};
  const out = {
    // Distributions (fractions)
    dividendYield_trailing: rawOrNull(sd, 'dividendYield'),
    dividendRate_trailing: rawOrNull(sd, 'dividendRate'),
    trailingAnnualDividendYield: rawOrNull(sd, 'trailingAnnualDividendYield'),
    trailingAnnualDividendRate: rawOrNull(sd, 'trailingAnnualDividendRate'),
    fiveYearAvgDividendYield: rawOrNull(sd, 'fiveYearAvgDividendYield'), // normalised below
    exDividendDate: rawOrNull(sd, 'exDividendDate'),
    payoutRatio: rawOrNull(sd, 'payoutRatio'),                            // normalised below
    // Valuation
    marketCap: rawOrNull(sd, 'marketCap') ?? rawOrNull(pr, 'marketCap'),
    priceToBook: rawOrNull(ks, 'priceToBook'),
    bookValue: rawOrNull(ks, 'bookValue'),
    trailingPE: rawOrNull(sd, 'trailingPE'),
    forwardPE: rawOrNull(sd, 'forwardPE'),
    priceToSalesTrailing12Months: rawOrNull(sd, 'priceToSalesTrailing12Months'),
    // Risk
    beta: rawOrNull(sd, 'beta'),
    // Stats
    fiftyTwoWeekHigh: rawOrNull(sd, 'fiftyTwoWeekHigh'),
    fiftyTwoWeekLow: rawOrNull(sd, 'fiftyTwoWeekLow'),
    fiftyDayAverage: rawOrNull(sd, 'fiftyDayAverage'),
    twoHundredDayAverage: rawOrNull(sd, 'twoHundredDayAverage'),
    sharesOutstanding: rawOrNull(ks, 'sharesOutstanding'),
    floatShares: rawOrNull(ks, 'floatShares'),
    // Price meta
    currency: pr?.currency ?? null,
    longName: pr?.longName ?? null,
    quoteType: pr?.quoteType ?? null,
  };
  return normalise(out);
}

function downsamplePriceSeries(timestamps, closes, points = 60) {
  if (!timestamps || !closes) return [];
  const n = timestamps.length;
  if (n <= points) return timestamps.map((t, i) => ({ t, c: closes[i] })).filter(p => p.c != null);
  const step = n / points;
  const out = [];
  for (let i = 0; i < points; i++) {
    const idx = Math.floor(i * step);
    if (closes[idx] != null) out.push({ t: timestamps[idx], c: closes[idx] });
  }
  return out;
}

async function processOne(reit, auth, priorByTicker) {
  const ticker = reit.ticker;
  const record = {
    ticker,
    name: reit.name,
    fetched_at: new Date().toISOString(),
    sources: {
      chart: `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SI`,
      quote_summary: `https://finance.yahoo.com/quote/${ticker}.SI/`,
    },
    chart: null,
    summary: null,
    errors: [],
  };
  try {
    const chart = await fetchChart(ticker);
    const meta = chart.meta || {};
    const ts = chart.timestamp || [];
    const closes = chart.indicators?.quote?.[0]?.close || [];
    record.chart = {
      currency: meta.currency,
      regularMarketPrice: meta.regularMarketPrice,
      regularMarketTime: meta.regularMarketTime,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      longName: meta.longName,
      shortName: meta.shortName,
      firstTradeDate: meta.firstTradeDate,
      exchangeName: meta.exchangeName,
      priceSeries: downsamplePriceSeries(ts, closes, 60),
    };
  } catch (e) {
    record.errors.push(`chart: ${e.message}`);
  }
  if (auth) {
    try {
      const qs = await fetchQuoteSummary(ticker, auth);
      record.summary = extractSummary(qs);
    } catch (e) {
      record.errors.push(`summary: ${e.message}`);
    }
  }

  const prior = priorByTicker?.[ticker];

  // If we have no fresh summary at all (chart-only run, or quoteSummary failed) carry forward
  // the previous run's summary so a transient auth/crumb outage doesn't wipe everything.
  if (!record.summary) {
    if (prior?.summary) {
      record.summary = prior.summary;
      record.summary_stale = true;
      record.summary_stale_since = prior.fetched_at || prior.summary_stale_since || null;
      record.errors.push('summary: carried forward from prior run (no fresh auth/quoteSummary)');
    } else {
      record.errors.push('summary: unavailable (no auth and no prior data to carry forward)');
    }
  } else if (prior?.summary) {
    // FIELD-LEVEL carry-forward: Yahoo intermittently returns null for individual fields
    // (e.g. marketCap / sharesOutstanding for some SGX REITs like CRPU) even on a successful
    // call. Don't let a transient per-field null wipe a value we had last run — back-fill any
    // null field from the prior summary and note which fields were carried.
    const carried = [];
    for (const [k, v] of Object.entries(record.summary)) {
      if (v == null && prior.summary[k] != null) {
        record.summary[k] = prior.summary[k];
        carried.push(k);
      }
    }
    if (carried.length) {
      record.summary_carried_fields = carried;
      record.summary_carried_since = prior.fetched_at || null;
    }
  }

  // Last-resort market-cap fallback: derive from price × shares when Yahoo omits marketCap
  // but exposes sharesOutstanding (matches how Yahoo's own website computes it).
  if (record.summary && record.summary.marketCap == null
      && record.summary.sharesOutstanding != null && record.chart?.regularMarketPrice != null) {
    record.summary.marketCap = record.summary.sharesOutstanding * record.chart.regularMarketPrice;
    record.summary.marketCap_derived = true;
  }

  return record;
}

async function main() {
  const masterRaw = await fs.readFile(MASTER_PATH, 'utf8');
  const master = JSON.parse(masterRaw);
  const reits = master.reits;

  // Read prior output (if any) so a chart-only run can carry forward summary fields.
  let priorByTicker = {};
  try {
    const prior = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
    priorByTicker = Object.fromEntries((prior.data || []).map(d => [d.ticker, d]));
  } catch { /* first run — no prior */ }

  console.log('Fetching FX (EUR/USD/GBP → SGD)...');
  const fx = await fetchFx();
  console.log('  fx:', JSON.stringify(fx));

  console.log('Acquiring Yahoo Finance auth (cookie + crumb)...');
  const auth = await getAuth();
  if (auth) {
    console.log(`  cookie: ${auth.cookie ? auth.cookie.slice(0, 30) + '…' : '(none)'}`);
    console.log(`  crumb: ${auth.crumb}`);
  } else {
    console.warn('  ⚠ No auth — running CHART-ONLY (prices/52w/sparkline refresh; market-cap/yield/P-B unavailable this run).');
  }

  console.log(`Fetching Yahoo data for ${reits.length} REITs (concurrency=4)...`);

  const out = {
    _meta: {
      generated_at: new Date().toISOString(),
      source: 'Yahoo Finance v8 chart + v10 quoteSummary',
      master_validated: master._meta.last_validated,
      auth_mode: auth ? 'full' : 'chart-only',
      fx: fx,   // {SGD:1, USD:.., EUR:.., GBP:..} units of SGD per 1 unit; for DPU↔price ccy reconciliation
    },
    data: [],
  };
  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < reits.length) {
      const my = i++;
      const r = reits[my];
      const result = await processOne(r, auth, priorByTicker);
      out.data.push(result);
      const status = result.errors.length ? `ERR ${result.errors.join('; ')}` : `ok ($${result.chart?.regularMarketPrice} ${result.chart?.currency}, mcap=${result.summary?.marketCap})`;
      console.log(`[${my + 1}/${reits.length}] ${r.ticker} ${status}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const order = new Map(reits.map((r, idx) => [r.ticker, idx]));
  out.data.sort((a, b) => order.get(a.ticker) - order.get(b.ticker));

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
