#!/usr/bin/env node
/**
 * validate.mjs — automated critical-review / consistency audit of the merged dataset.
 *
 * Run AFTER merge.mjs on every refresh (`node validate.mjs`). It is deterministic — it makes
 * no judgement calls and gathers no data; it only cross-checks the numbers already in
 * data/data.json for internal consistency, coverage, freshness, source authority, and the
 * cross-REIT comparability traps that make a screener misleading (e.g. metrics reported on
 * different bases). It prints a report and exits non-zero if any SEVERE issue is found, so a
 * refresh can be gated on a clean (or human-reviewed) audit.
 *
 * The judgement-based half of the critical review (does a number make economic sense, is a
 * metric reported on a comparable basis across REITs) is documented in
 * pipeline/agent_prompts/critical-review.md and PLAYBOOK §"Critical review".
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data', 'data.json');
const TODAY = process.env.AS_OF ? new Date(process.env.AS_OF) : new Date();

const S = [], M = [], L = [];   // severe / medium / low findings
const add = (sev, ticker, msg) => (sev === 'S' ? S : sev === 'M' ? M : L).push(`${ticker.padEnd(6)} ${msg}`);
const approx = (a, b, tolPct) => a != null && b != null && b !== 0 && Math.abs(a - b) / Math.abs(b) <= tolPct;

function monthsBetween(d) {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return (TODAY - t) / (1000 * 60 * 60 * 24 * 30.44);
}

const main = async () => {
  const data = JSON.parse(await fs.readFile(DATA, 'utf8'));
  const reits = data.reits;
  console.log(`\n=== S-REIT dataset consistency audit (${reits.length} REITs, as of ${TODAY.toISOString().slice(0, 10)}) ===\n`);

  // Collect each numeric metric's distribution for outlier context.
  for (const r of reits) {
    const t = r.ticker;

    // 1. Cross-field arithmetic consistency --------------------------------
    if (r.market_cap != null && r.price != null && r.shares_outstanding > 0) {
      if (!approx(r.market_cap, r.price * r.shares_outstanding, 0.05))
        add('M', t, `market_cap (${r.market_cap.toExponential(2)}) ≠ price×shares (${(r.price * r.shares_outstanding).toExponential(2)}) >5%`);
    }
    if (r.p_nav != null && r.price != null && r.nav_per_unit != null && r.nav_per_unit > 0 && r.p_nav_source === 'manager_nav') {
      if (!approx(r.p_nav, r.price / r.nav_per_unit, 0.02))
        add('M', t, `p_nav (${r.p_nav}) ≠ price/nav (${(r.price / r.nav_per_unit).toFixed(3)})`);
    }
    // Skip suspended payers (DPU ~0) — 0 vs 0 is consistent, not a discrepancy.
    if (r.distribution_yield_ttm != null && r.dpu_ttm_cents != null && r.dpu_ttm_cents > 0 && r.price != null && r.price > 0
        && (r.dpu_currency || r.trading_currency) === r.trading_currency) {
      const implied = (r.dpu_ttm_cents / 100) / r.price;
      if (!approx(r.distribution_yield_ttm, implied, 0.03))
        add('L', t, `dist yield (${(r.distribution_yield_ttm * 100).toFixed(2)}%) ≠ dpu_ttm/price (${(implied * 100).toFixed(2)}%) — may be FX or capital-distribution gap`);
    }
    if (r.gearing_pct != null && r.gearing_pct_incl_perps != null && r.gearing_pct_incl_perps < r.gearing_pct - 0.05)
      add('S', t, `gearing_incl_perps (${r.gearing_pct_incl_perps}) < headline gearing (${r.gearing_pct}) — impossible`);

    // 2. Range sanity ------------------------------------------------------
    if (r.gearing_pct != null && (r.gearing_pct < 0 || r.gearing_pct > 60)) add('S', t, `gearing ${r.gearing_pct}% out of plausible range`);
    if (r.gearing_pct != null && r.gearing_pct > 50) add('M', t, `gearing ${r.gearing_pct}% exceeds MAS 50% cap — verify (may be pre-divestment / breach)`);
    if (r.occupancy_pct != null && (r.occupancy_pct < 0 || r.occupancy_pct > 100.5)) add('S', t, `occupancy ${r.occupancy_pct}% out of range`);
    if (r.icr_x != null && (r.icr_x < 0 || r.icr_x > 20)) add('M', t, `ICR ${r.icr_x}x implausible — verify`);
    if (r.property_yield_pct != null && (r.property_yield_pct <= 0 || r.property_yield_pct > 15)) add('M', t, `property yield ${r.property_yield_pct}% implausible`);
    if (r.distribution_yield_ttm != null && r.distribution_yield_ttm > 0.15) add('M', t, `distribution yield ${(r.distribution_yield_ttm * 100).toFixed(1)}% — extreme, likely distress/value-trap; verify it's not a capital top-up`);
    if (r.pct_fixed_debt != null && (r.pct_fixed_debt < 0 || r.pct_fixed_debt > 100)) add('S', t, `% fixed debt ${r.pct_fixed_debt} out of range`);

    // 3. Comparability / basis traps (the heart of "misleading metric" review) ----
    // ICR basis: REITs with perpetuals should report the MAS "adjusted" ICR (perp distributions
    // in the denominator). If perps exist but the ICR basis isn't noted as adjusted, the ICR may
    // not be comparable to peers that do include perps — flag for the human reviewer.
    const hasPerps = r.gearing_pct_incl_perps != null && r.gearing_pct != null && r.gearing_pct_incl_perps > r.gearing_pct + 0.2;
    if (r.icr_x != null && hasPerps) {
      const note = (r.icr_note || r.sources?.icr?.url || '') + '';
      add('L', t, `has perpetuals (${r.gearing_pct}%→${r.gearing_pct_incl_perps}% incl perps) — confirm ICR ${r.icr_x}x is the MAS adjusted basis (perp distributions in denominator) for cross-REIT comparability`);
    }
    // WALE basis mixing: NLA vs GRI are not comparable across REITs.
    if (r.wale_years != null && !r.wale_basis) add('L', t, `WALE ${r.wale_years}y has no basis (NLA/GRI) recorded — not comparable across REITs without it`);

    // 4. Source authority --------------------------------------------------
    for (const [k, s] of Object.entries(r.sources || {})) {
      if (s && typeof s === 'object' && s.url && s.authoritative === false)
        add('M', t, `non-authoritative source for ${k}: ${s.url.slice(0, 70)}`);
    }

    // 5. Freshness ---------------------------------------------------------
    if (r.report_date) {
      const m = monthsBetween(r.report_date);
      if (m != null && m > 7) add('M', t, `fact data is ${m.toFixed(0)} months old (report_date ${r.report_date}) — likely a missed quarterly`);
    } else if (r.gearing_pct != null) {
      add('L', t, 'has fact data but no report_date — freshness unverifiable');
    }
  }

  // 6. Cross-REIT: ICR comparability spotlight (answers the Keppel-vs-CLINT question) ----
  const withIcr = reits.filter(r => r.icr_x != null).sort((a, b) => a.icr_x - b.icr_x);
  if (withIcr.length) {
    const lo = withIcr.slice(0, 3).map(r => `${r.ticker} ${r.icr_x}x (gear ${r.gearing_pct ?? '?'}%, WACE ${r.wace_pct ?? '?'}%)`);
    const hi = withIcr.slice(-3).reverse().map(r => `${r.ticker} ${r.icr_x}x (gear ${r.gearing_pct ?? '?'}%, WACE ${r.wace_pct ?? '?'}%)`);
    console.log('ICR spread (a wide spread is usually GENUINE — driven by cost of debt & leverage, not error):');
    console.log('  lowest : ' + lo.join(' | '));
    console.log('  highest: ' + hi.join(' | '));
    console.log('  → If two REITs have similar gearing+WACE but very different ICR, that IS a red flag to investigate (different ICR basis or an EBITDA error).\n');
  }

  // 7. Coverage summary --------------------------------------------------
  const cov = (key) => reits.filter(r => r[key] != null).length;
  console.log('Coverage: ' + ['gearing_pct','gearing_pct_incl_perps','icr_x','property_yield_pct','wale_years','occupancy_pct','forward_yield_run_rate','rental_reversion_pct','pct_debt_due_12m','dpu_change_per_100bps_pct']
    .map(k => `${k} ${cov(k)}/${reits.length}`).join(' · ') + '\n');

  // Report -----------------------------------------------------------------
  const dump = (label, arr) => { if (arr.length) { console.log(`${label} (${arr.length}):`); arr.forEach(x => console.log('  • ' + x)); console.log(); } };
  dump('SEVERE — fix before publishing', S);
  dump('MEDIUM — review', M);
  dump('LOW — note', L);
  if (!S.length && !M.length) console.log('No severe or medium issues. ✓');

  console.log(`\nSummary: ${S.length} severe, ${M.length} medium, ${L.length} low.`);
  if (S.length) { console.log('AUDIT FAILED (severe issues present).'); process.exit(1); }
};

main().catch(e => { console.error(e); process.exit(1); });
