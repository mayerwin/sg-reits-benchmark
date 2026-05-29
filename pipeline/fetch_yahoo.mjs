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
async function getAuth() {
  // Trigger fc.yahoo.com to set the A1/A3 cookies
  const seed = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
    redirect: 'manual',
  });
  const setCookie = seed.headers.getSetCookie?.() ?? [];
  // Build a Cookie header from the Set-Cookie values
  const cookie = setCookie.map(s => s.split(';')[0]).join('; ');
  // Get the crumb
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'text/plain' },
  });
  if (!crumbRes.ok) throw new Error(`crumb endpoint ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes('Unauthorized')) {
    throw new Error(`No crumb returned (cookies may have failed). Got: "${crumb}"`);
  }
  return { cookie, crumb };
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

async function processOne(reit, auth) {
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
  try {
    const qs = await fetchQuoteSummary(ticker, auth);
    record.summary = extractSummary(qs);
  } catch (e) {
    record.errors.push(`summary: ${e.message}`);
  }
  return record;
}

async function main() {
  const masterRaw = await fs.readFile(MASTER_PATH, 'utf8');
  const master = JSON.parse(masterRaw);
  const reits = master.reits;

  console.log('Acquiring Yahoo Finance auth (cookie + crumb)...');
  const auth = await getAuth();
  console.log(`  cookie: ${auth.cookie ? auth.cookie.slice(0, 30) + '…' : '(none)'}`);
  console.log(`  crumb: ${auth.crumb}`);

  console.log(`Fetching Yahoo data for ${reits.length} REITs (concurrency=4)...`);

  const out = {
    _meta: {
      generated_at: new Date().toISOString(),
      source: 'Yahoo Finance v8 chart + v10 quoteSummary',
      master_validated: master._meta.last_validated,
    },
    data: [],
  };
  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < reits.length) {
      const my = i++;
      const r = reits[my];
      const result = await processOne(r, auth);
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
