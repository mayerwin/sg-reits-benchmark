/* S-REIT Benchmark — single-file vanilla JS app
 *
 * Loads data.json, renders a sortable filterable table with detail drawer + sparklines.
 * Persists user preferences (filters, column visibility, hidden REITs) to localStorage.
 * Centralised metric documentation in metrics-doc.js drives tooltips, the drawer, and the Help page.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const priceFmt = (v, ref = v) => {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Math.abs(ref ?? v);
  if (r >= 1) return Number(v).toFixed(2);
  if (r >= 0.1) return Number(v).toFixed(3);
  return Number(v).toFixed(4);
};

/** Signed number with an explicit + for positives (for YoY / reversion / sensitivity). */
const signed = (v, dp = 1) => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(dp);

const fmt = {
  pct: (v, dp = 2) => v == null ? '—' : `${(v * 100).toFixed(dp)}<span class="muted">%</span>`,
  pctRaw: (v, dp = 1) => v == null ? '—' : `${Number(v).toFixed(dp)}<span class="muted">%</span>`,
  num: (v, dp = 2) => v == null ? '—' : Number(v).toFixed(dp),
  money: (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}<span class="muted">B</span>`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}<span class="muted">M</span>`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}<span class="muted">K</span>`;
    return v.toLocaleString('en-SG');
  },
  date: (v) => {
    if (v == null) return '—';
    const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  },
  dateTime: (v) => {
    if (v == null) return '—';
    const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' SGT';
  },
};

function ccyBadge(ccy) {
  if (!ccy || ccy === 'SGD') return '';
  return ` <span class="ccy ccy--${esc(ccy)}">${esc(ccy)}</span>`;
}
function ccyBadgeAlways(ccy) {
  if (!ccy) return '';
  return ` <span class="ccy ccy--${esc(ccy)}">${esc(ccy)}</span>`;
}
function sectorChip(sector) {
  return `<span class="sector-chip" data-sector="${esc(sector)}">${esc(sector || '—')}</span>`;
}

const QUALITY_BANDS = [
  { min: 80, k: 'strong',  label: 'strong' },
  { min: 65, k: 'healthy', label: 'healthy' },
  { min: 45, k: 'caution', label: 'caution' },
  { min: 0,  k: 'stress',  label: 'stress' },
];
const qualityBand = (score) => score == null ? null : QUALITY_BANDS.find(b => score >= b.min);

function qualityCell(score) {
  const b = qualityBand(score);
  if (!b) return `<span class="qual qual--null" aria-label="Quality n/d"><span class="qual__bar"><span class="qual__fill" style="width:0%"></span></span><span class="qual__val">—</span></span>`;
  const w = Math.min(100, Math.max(0, score));
  return `<span class="qual qual--${b.k}" aria-label="Quality ${score} — ${b.label}"><span class="qual__bar"><span class="qual__fill" style="width:${w}%"></span></span><span class="qual__val">${score}</span></span>`;
}

function thresholdBadge(kind, value) {
  if (value == null) return '';
  const bands = {
    gearing: [ ['strong', v => v < 35], ['healthy', v => v < 40], ['caution', v => v < 45], ['stress', v => v < 50], ['stress', v => v >= 50] ],
    icr:     [ ['strong', v => v >= 5], ['healthy', v => v >= 2.5], ['caution', v => v >= 1.8], ['stress', v => v < 1.8] ],
    occ:     [ ['strong', v => v >= 97], ['healthy', v => v >= 95], ['caution', v => v >= 90], ['stress', v => v < 90] ],
    wale:    [ ['strong', v => v >= 4], ['healthy', v => v >= 3], ['caution', v => v >= 2], ['stress', v => v < 2] ],
    fixed:   [ ['strong', v => v >= 85], ['healthy', v => v >= 75], ['caution', v => v >= 60], ['stress', v => v < 60] ],
    wadm:    [ ['strong', v => v >= 4], ['healthy', v => v >= 3], ['caution', v => v >= 2], ['stress', v => v < 2] ],
    yld:     [ ['caution', v => v >= 0.09], ['strong', v => v >= 0.055], ['healthy', v => v >= 0.045], ['caution', v => v >= 0.035], ['stress', v => v < 0.035] ],
  };
  for (const [b, fn] of (bands[kind] || [])) if (fn(value)) return ` <span class="metric__threshold metric__threshold--${b}">${b}</span>`;
  return '';
}

/* =====================  STATE & PERSISTENCE  ===================== */

const LS_KEY = 'sreit-terminal-v2';
// Default VISIBLE columns (Price hidden by default; WACE shown, placed right after Prop Yield).
const DEFAULT_COLUMNS = ['ticker', 'name', 'sector', 'geography', 'market_cap', 'distribution_yield_ttm', 'gearing_pct', 'gearing_pct_incl_perps', 'icr_x', 'wale_years', 'occupancy_pct', 'property_yield_pct', 'wace_pct', 'p_nav', 'quality', 'report_date'];
const ALL_COLUMNS = [
  { key: 'ticker', label: 'Ticker', num: true, metric: null },
  { key: 'name', label: 'Name', num: false, metric: null, sticky: true },
  { key: 'sector', label: 'Sector', num: false, metric: null },
  { key: 'geography', label: 'Geography', num: false, metric: null },
  { key: 'price', label: 'Price', num: true, metric: 'price' },
  { key: 'market_cap', label: 'Mkt cap', num: true, metric: 'market_cap' },
  { key: 'distribution_yield_ttm', label: 'Yield TTM', num: true, metric: 'distribution_yield_ttm' },
  { key: 'forward_yield_run_rate', label: 'Fwd Yield', num: true, metric: 'forward_yield_run_rate' },
  { key: 'forward_yield_guidance', label: 'Fwd Yield (guided)', num: true, metric: 'forward_yield_guidance' },
  { key: 'dpu_yoy_pct', label: 'DPU YoY', num: true, metric: 'dpu_yoy_pct' },
  { key: 'rental_reversion_pct', label: 'Reversion', num: true, metric: 'rental_reversion_pct' },
  { key: 'gearing_pct', label: 'Gearing', num: true, metric: 'gearing_pct' },
  { key: 'gearing_pct_incl_perps', label: 'Gear+Perps', num: true, metric: 'gearing_pct_incl_perps' },
  { key: 'icr_x', label: 'ICR', num: true, metric: 'icr_x' },
  { key: 'pct_debt_due_12m', label: 'Debt ≤1y', num: true, metric: 'pct_debt_due_12m' },
  { key: 'dpu_change_per_100bps_pct', label: 'ΔDPU/+100bp', num: true, metric: 'dpu_change_per_100bps_pct' },
  { key: 'pct_fixed_debt', label: '% Fixed', num: true, metric: 'pct_fixed_debt' },
  { key: 'wadm_years', label: 'WADM', num: true, metric: 'wadm_years' },
  { key: 'wale_years', label: 'WALE', num: true, metric: 'wale_years' },
  { key: 'occupancy_pct', label: 'Occ.', num: true, metric: 'occupancy_pct' },
  { key: 'property_yield_pct', label: 'Prop Yield', num: true, metric: 'property_yield_pct' },
  { key: 'wace_pct', label: 'WACE', num: true, metric: 'wace_pct' },
  { key: 'num_properties', label: '# Props', num: true, metric: 'num_properties' },
  { key: 'top10_tenant_pct', label: 'Top-10', num: true, metric: 'top10_tenant_pct' },
  { key: 'nav_per_unit', label: 'NAV', num: true, metric: 'nav_per_unit' },
  { key: 'p_nav', label: 'P/NAV', num: true, metric: 'p_nav' },
  { key: 'trailing_pe', label: 'P/E', num: true, metric: 'trailing_pe' },
  { key: 'quality', label: 'Quality', num: true, metric: 'quality_composite' },
  { key: 'report_date', label: 'As of', num: true, metric: 'report_date' },
];
const COL_BY_KEY = Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c]));
const DEFAULT_ORDER = ALL_COLUMNS.map(c => c.key);

const STATE = {
  // Multi-level sort: most-recent first = primary. Sorting by A then B ⇒ [B, A] ⇒ B primary.
  // Starts EMPTY — the default market-cap-desc ordering is the implicit tiebreak (see tieBreak),
  // so the user's own sorts are the only ones that get rank badges.
  sortStack: [],
  search: '',
  sectors: new Set(),
  currencies: new Set(),
  ranges: {},                 // { columnKey: [lo, hi] } in display units; only present when narrowed
  columns: new Set(DEFAULT_COLUMNS),
  columnOrder: [...DEFAULT_ORDER], // display order (includes hidden); visibility from `columns`
  columnWidths: {},           // { columnKey: px } — user-resized widths
  hiddenReits: new Set(),
  lastFocusBeforeDrawer: null,
  lastModalTrigger: null,
};

/** Columns to render, in user order, visible only. */
function visibleColumns() {
  return STATE.columnOrder.filter(k => STATE.columns.has(k) && COL_BY_KEY[k]).map(k => COL_BY_KEY[k]);
}

/** Baseline default width (px). Tuned for typical CELL content; the header-fit floor below
 *  guarantees the header text itself is never clipped. Geography is intentionally narrow. */
function defaultColWidth(c) {
  const W = {
    name: 210, sector: 110, geography: 126,   // geography ~30% narrower than its content
    market_cap: 96, report_date: 108, quality: 120,
  };
  return W[c.key] || 84;
}

/** Rendered width (px) of a header label, measured with the actual header font (uppercase +
 *  letter-spacing), so a column default never truncates its own title. Cached; recomputed when
 *  webfonts finish loading. */
const HEADER_FIT = {};
function headerFitWidth(c) {
  if (HEADER_FIT[c.key] != null) return HEADER_FIT[c.key];
  const cv = headerFitWidth._cv || (headerFitWidth._cv = document.createElement('canvas'));
  const ctx = cv.getContext('2d');
  ctx.font = "500 10.5px 'IBM Plex Mono', Menlo, monospace";
  const txt = String(c.label || '').toUpperCase();
  const letterSpacing = 0.07 * 10.5 * Math.max(0, txt.length - 1);  // matches CSS letter-spacing
  const w = ctx.measureText(txt).width + letterSpacing + 24 /*cell padding*/ + 18 /*sort caret + multi-sort rank badge*/;
  return (HEADER_FIT[c.key] = Math.ceil(w));
}

/** Effective width: a user override wins; otherwise max(content default, header-fit floor). */
function colWidth(c) {
  return STATE.columnWidths[c.key] || Math.max(defaultColWidth(c), headerFitWidth(c));
}

// Per-column numeric filter definitions (bounds computed from data at init).
let FILTER_DEFS = [];  // [{ key, label, metric, value(r), fmt(v), bound:[min,max], step }]
let FILTER_BY_KEY = {};

function savePrefs() {
  try {
    const p = {
      sortStack: STATE.sortStack,
      search: STATE.search,
      sectors: [...STATE.sectors],
      currencies: [...STATE.currencies],
      ranges: STATE.ranges,
      // Never persist an empty column set — fall back to default so a reload can't load blank.
      columns: STATE.columns.size ? [...STATE.columns] : [...DEFAULT_COLUMNS],
      columnOrder: STATE.columnOrder,
      columnWidths: STATE.columnWidths,
      hiddenReits: [...STATE.hiddenReits],
    };
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {}
}

// Loaded from storage before FILTER_DEFS exist; applied/clamped once defs are built.
let _pendingRanges = null;

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    // Validate sort keys against known columns; ignore stale/garbage. Supports the new
    // multi-level sortStack and migrates a legacy single {sort}.
    const validSortKeys = new Set(ALL_COLUMNS.map(c => c.key));
    const cleanStack = (arr) => arr.filter(s => s && validSortKeys.has(s.key)).map(s => ({ key: s.key, asc: !!s.asc })).slice(0, 4);
    if (Array.isArray(p.sortStack) && p.sortStack.length) {
      const s = cleanStack(p.sortStack);
      if (s.length) STATE.sortStack = s;
    } else if (p.sort && typeof p.sort === 'object' && validSortKeys.has(p.sort.key)) {
      STATE.sortStack = [{ key: p.sort.key, asc: !!p.sort.asc }];
    }
    if (typeof p.search === 'string') STATE.search = p.search;
    if (Array.isArray(p.sectors)) STATE.sectors = new Set(p.sectors);
    if (Array.isArray(p.currencies)) STATE.currencies = new Set(p.currencies);
    if (p.ranges && typeof p.ranges === 'object') _pendingRanges = p.ranges;
    // Only restore columns that still exist in ALL_COLUMNS; ignore empty/garbage.
    if (Array.isArray(p.columns)) {
      const valid = p.columns.filter(c => COL_BY_KEY[c]);
      if (valid.length) STATE.columns = new Set(valid);
    }
    // Column order: keep valid persisted keys in their saved order, then append any columns
    // added since (e.g. a new metric) so they're never lost.
    if (Array.isArray(p.columnOrder)) {
      const valid = p.columnOrder.filter(c => COL_BY_KEY[c]);
      const missing = DEFAULT_ORDER.filter(c => !valid.includes(c));
      STATE.columnOrder = [...valid, ...missing];
    }
    if (p.columnWidths && typeof p.columnWidths === 'object') {
      for (const [k, w] of Object.entries(p.columnWidths)) {
        if (COL_BY_KEY[k] && Number.isFinite(w) && w >= 40 && w <= 600) STATE.columnWidths[k] = w;
      }
    }
    if (Array.isArray(p.hiddenReits)) STATE.hiddenReits = new Set(p.hiddenReits);
  } catch {}
}

let DATA = null;
let IS_TOUCH = false;

/* ===================== PER-COLUMN NUMERIC FILTERS (dual-range sliders) ===================== */

// How to read each numeric column's value (in the unit the slider operates in) and format it.
const FILTER_META = {
  price:                  { unit: 'price', accessor: r => r.price },
  market_cap:             { unit: 'money', accessor: r => r.market_cap == null ? null : r.market_cap / 1e6 }, // millions
  distribution_yield_ttm: { unit: 'pct',   accessor: r => r.distribution_yield_ttm == null ? null : r.distribution_yield_ttm * 100 },
  gearing_pct:            { unit: 'pct',   accessor: r => r.gearing_pct },
  gearing_pct_incl_perps: { unit: 'pct',   accessor: r => r.gearing_pct_incl_perps },
  icr_x:                  { unit: 'x',     accessor: r => r.icr_x },
  wace_pct:               { unit: 'pct',   accessor: r => r.wace_pct },
  pct_fixed_debt:         { unit: 'pct',   accessor: r => r.pct_fixed_debt },
  wadm_years:             { unit: 'yr',    accessor: r => r.wadm_years },
  wale_years:             { unit: 'yr',    accessor: r => r.wale_years },
  occupancy_pct:          { unit: 'pct',   accessor: r => r.occupancy_pct },
  property_yield_pct:     { unit: 'pct',   accessor: r => r.property_yield_pct },
  num_properties:         { unit: 'int',   accessor: r => r.num_properties },
  top10_tenant_pct:       { unit: 'pct',   accessor: r => r.top10_tenant_pct },
  nav_per_unit:           { unit: 'price', accessor: r => r.nav_per_unit },
  p_nav:                  { unit: 'x',     accessor: r => r.p_nav },
  trailing_pe:            { unit: 'pe',    accessor: r => r.trailing_pe },
  quality:                { unit: 'int',   accessor: r => r.scores?.composite ?? null },
  forward_yield_run_rate: { unit: 'pct',   accessor: r => r.forward_yield_run_rate == null ? null : r.forward_yield_run_rate * 100 },
  forward_yield_guidance: { unit: 'pct',   accessor: r => r.forward_yield_guidance == null ? null : r.forward_yield_guidance * 100 },
  dpu_yoy_pct:            { unit: 'pct',   accessor: r => r.dpu_yoy_pct },
  rental_reversion_pct:   { unit: 'pct',   accessor: r => r.rental_reversion_pct },
  pct_debt_due_12m:       { unit: 'pct',   accessor: r => r.pct_debt_due_12m },
  dpu_change_per_100bps_pct: { unit: 'pct', accessor: r => r.dpu_change_per_100bps_pct },
};

function fmtFilter(unit, v) {
  if (v == null) return '—';
  switch (unit) {
    case 'pct': return (Number.isInteger(v) ? v : v.toFixed(1)) + '%';
    case 'money': return v >= 1000 ? (v / 1000).toFixed(1) + 'B' : Math.round(v) + 'M'; // v is in millions
    case 'x': return v.toFixed(2) + 'x';
    case 'yr': return v.toFixed(1) + 'y';
    case 'price': return v < 1 ? v.toFixed(3) : v.toFixed(2);
    case 'pe': return v.toFixed(1);
    case 'int': default: return String(Math.round(v));
  }
}

/** A "lo–hi" range label. Switches to " to " when either bound is negative, so the
 *  en-dash isn't jammed against a minus sign (e.g. "-20.5%–-1%" → "-20.5% to -1%"). */
function fmtRangeLabel(d, lo, hi) {
  const sep = (lo < 0 || hi < 0) ? ' to ' : '–';
  return `${d.fmt(lo)}${sep}${d.fmt(hi)}`;
}

// Pick a "nice" step for a given numeric span.
function niceStep(span, unit) {
  if (unit === 'int') return 1;
  if (unit === 'money') return span > 4000 ? 50 : 10;     // millions
  if (span <= 2) return 0.05;
  if (span <= 10) return 0.1;
  if (span <= 60) return 0.5;
  if (span <= 200) return 1;
  return Math.pow(10, Math.floor(Math.log10(span / 50)));
}

function buildFilterDefs() {
  FILTER_DEFS = [];
  for (const col of ALL_COLUMNS) {
    const meta = FILTER_META[col.key];
    if (!meta) continue; // categorical / non-numeric columns
    const vals = DATA.reits.map(meta.accessor).filter(v => v != null && Number.isFinite(v));
    if (!vals.length) continue;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const step = niceStep(hi - lo || 1, meta.unit);
    // Round bounds outward to the step so the full data range is reachable.
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    FILTER_DEFS.push({
      key: col.key,
      label: col.label,
      metric: col.metric,
      unit: meta.unit,
      value: meta.accessor,
      fmt: (v) => fmtFilter(meta.unit, v),
      bound: [lo, hi],
      step,
    });
  }
  FILTER_BY_KEY = Object.fromEntries(FILTER_DEFS.map(d => [d.key, d]));

  // Apply any persisted ranges now that bounds exist (clamp to current bounds; drop full-range).
  if (_pendingRanges) {
    for (const [k, v] of Object.entries(_pendingRanges)) {
      const d = FILTER_BY_KEY[k];
      if (!d || !Array.isArray(v) || v.length !== 2) continue;
      let [a, b] = v.map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      a = Math.max(d.bound[0], Math.min(a, d.bound[1]));
      b = Math.max(d.bound[0], Math.min(b, d.bound[1]));
      if (a > b) [a, b] = [b, a];
      if (a > d.bound[0] || b < d.bound[1]) STATE.ranges[k] = [a, b];
    }
    _pendingRanges = null;
  }
}

/** Range filters that are narrowed AND whose column is currently visible.
 *  A hidden column's range is preserved in STATE.ranges but neither shown nor applied,
 *  so re-showing the column restores its filter (no invisible filtering). */
function activeRangeFilters() {
  return FILTER_DEFS
    .filter(d => STATE.ranges[d.key] && STATE.columns.has(d.key))
    .map(d => {
      const [lo, hi] = STATE.ranges[d.key];
      return { label: d.label, value: d.value, min: lo, max: hi };
    });
}

/** HTML for one dual-range slider (used inside the column popover). */
function dualSliderHTML(d) {
  const cur = STATE.ranges[d.key] || d.bound;
  return `<div class="dual" data-key="${esc(d.key)}">
      <div class="dual__track"><div class="dual__fill" data-fill-for="${esc(d.key)}"></div></div>
      <input type="range" class="dual__in dual__in--min" data-key="${esc(d.key)}" min="${d.bound[0]}" max="${d.bound[1]}" step="${d.step}" value="${cur[0]}" aria-label="${esc(d.label)} minimum" />
      <input type="range" class="dual__in dual__in--max" data-key="${esc(d.key)}" min="${d.bound[0]}" max="${d.bound[1]}" step="${d.step}" value="${cur[1]}" aria-label="${esc(d.label)} maximum" />
    </div>`;
}

function updateDualUI(key) {
  const d = FILTER_BY_KEY[key];
  const cur = STATE.ranges[key] || d.bound;
  const [bMin, bMax] = d.bound;
  const span = (bMax - bMin) || 1;
  const fill = $(`[data-fill-for="${cssEscape(key)}"]`);
  if (fill) {
    fill.style.left = ((cur[0] - bMin) / span * 100) + '%';
    fill.style.right = ((bMax - cur[1]) / span * 100) + '%';
  }
  const val = $(`[data-val-for="${cssEscape(key)}"]`);
  if (val) val.textContent = STATE.ranges[key] ? fmtRangeLabel(d, cur[0], cur[1]) : 'any';
}

/** Show/hide the open popover's "Clear this filter" link to match the live filter state
 *  (the link is baked in at build time, so slider drags / chip toggles must refresh it). */
function updateColpopClear() {
  const sec = $('#colpop [data-colpop-clear-sec]');
  if (!sec) return;
  const active = COLPOP_KEY === 'sector' ? STATE.sectors.size > 0 : !!STATE.ranges[COLPOP_KEY];
  sec.hidden = !active;
}

function onDualInput(e) {
  const input = e.target.closest('.dual__in');
  if (!input) return;
  const key = input.dataset.key;
  const d = FILTER_BY_KEY[key];
  const isMin = input.classList.contains('dual__in--min');
  const wrap = input.closest('.dual');
  const minEl = $('.dual__in--min', wrap), maxEl = $('.dual__in--max', wrap);
  let lo = Number(minEl.value), hi = Number(maxEl.value);
  // Clamp so the thumbs can't cross.
  if (isMin && lo > hi) { lo = hi; minEl.value = lo; }
  if (!isMin && hi < lo) { hi = lo; maxEl.value = hi; }
  // Store only when narrowed from the full bounds; otherwise clear the filter.
  if (lo <= d.bound[0] && hi >= d.bound[1]) delete STATE.ranges[key];
  else STATE.ranges[key] = [lo, hi];
  updateDualUI(key);
  updateColpopClear();
  savePrefs();
  render();
}

/* ===================== HORIZONTAL SCROLLBAR (synced, pinned above headers) ===================== */
function wireHbar() {
  const hbar = $('#hbar'), scroll = $('#table-scroll');
  if (!hbar || !scroll) return;
  let lock = false;
  hbar.addEventListener('scroll', () => { if (lock) return; lock = true; scroll.scrollLeft = hbar.scrollLeft; lock = false; });
  scroll.addEventListener('scroll', () => { if (lock) return; lock = true; hbar.scrollLeft = scroll.scrollLeft; lock = false; });
  window.addEventListener('resize', syncHbar);
}
function syncHbar() {
  const hbar = $('#hbar'), inner = $('#hbar-inner'), scroll = $('#table-scroll'), table = $('#reit-table');
  if (!hbar || !inner || !scroll || !table) return;
  const overflow = table.scrollWidth > scroll.clientWidth + 1;
  hbar.classList.toggle('is-hidden', !overflow);
  inner.style.width = table.scrollWidth + 'px';
}

/* ===================== FLOATING (sticky-on-page-scroll) HEADER CLONE =====================
   The whole page scrolls, so the real <thead> scrolls away. This clones the header row into
   a fixed bar that appears once the real header passes the top, mirrors column widths, and
   syncs horizontal position with the table. The real <thead> stays the accessible one. */
/** Sort by `key` in direction `asc`, making it the PRIMARY level. Any previous sort on other
 *  columns drops one level down (so "sort A then B" ⇒ B primary, A secondary). Pass asc=null
 *  to toggle when this column is already primary. */
function applySort(key, asc = null) {
  const cur = STATE.sortStack[0];
  if (asc == null) asc = (cur && cur.key === key) ? !cur.asc : false;
  STATE.sortStack = [{ key, asc }, ...STATE.sortStack.filter(s => s.key !== key)].slice(0, 4);
  savePrefs(); render(); renderColpopSortState(key);
}
function sortEntry(key) { return STATE.sortStack.find(s => s.key === key); }
function sortRank(key) { const i = STATE.sortStack.findIndex(s => s.key === key); return i < 0 ? null : i; }

/* ===================== COLUMN RESIZE (drag the right edge of a header) ===================== */
function wireColumnResize() {
  const thead = $('#reit-thead');
  if (!thead) return;
  thead.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.col-resize');
    if (!handle) return;
    e.preventDefault(); e.stopPropagation();
    const key = handle.dataset.resize;
    const th = handle.closest('th');
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    // Minimum = the header label's own width + padding, so a column can't be shrunk so far
    // that its title is unreadable.
    const label = th.querySelector('.th-label');
    const labelW = label ? label.getBoundingClientRect().width : 0;
    const minW = Math.max(44, Math.ceil(labelW + 28)); // can't shrink below the header text
    document.body.classList.add('is-col-resizing');
    const onMove = (ev) => {
      const w = Math.max(minW, Math.min(600, Math.round(startW + (ev.clientX - startX))));
      STATE.columnWidths[key] = w;
      th.style.width = w + 'px';
      applyTableWidth();          // keep table width = Σ column widths so the change sticks
      syncHbar(); updateFloatHead();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-col-resizing');
      savePrefs();
      buildFloatHead(); updateFloatHead();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
  // Double-click a handle resets that column to auto width.
  thead.addEventListener('dblclick', (e) => {
    const handle = e.target.closest('.col-resize');
    if (!handle) return;
    e.preventDefault(); e.stopPropagation();
    delete STATE.columnWidths[handle.dataset.resize];
    savePrefs(); render();
  });
}

function buildFloatHead() {
  const realThead = $('#reit-thead'), ft = $('#float-head-thead'), table = $('#reit-table'), ftable = $('#float-head-table');
  if (!realThead || !ft || !table || !ftable) return;
  ft.innerHTML = realThead.innerHTML;
  // Clones must not be focusable (the bar is aria-hidden; real header carries a11y).
  $$('#float-head-thead th').forEach(th => th.setAttribute('tabindex', '-1'));
  // The clone is display-only — strip the (non-functional) resize grips.
  $$('#float-head-thead .col-resize').forEach(el => el.remove());
  // Mirror each column's rendered width so the clone aligns pixel-for-pixel with the table.
  const realThs = $$('#reit-thead th'), cloneThs = $$('#float-head-thead th');
  realThs.forEach((th, i) => {
    const w = th.getBoundingClientRect().width;
    const c = cloneThs[i];
    if (c) { c.style.width = c.style.minWidth = c.style.maxWidth = w + 'px'; }
  });
  ftable.style.width = table.offsetWidth + 'px';
  ftable.style.tableLayout = 'fixed';
}

function syncFloatHeadX() {
  const scroll = $('#table-scroll'), ftable = $('#float-head-table');
  if (!scroll || !ftable || $('#float-head').hidden) return;
  const sl = scroll.scrollLeft;
  ftable.style.transform = `translateX(${-sl}px)`;
  // Keep the sticky Name column pinned at the left within the floating header too.
  $$('#float-head-thead th.is-sticky').forEach(th => { th.style.transform = `translateX(${sl}px)`; });
}

function updateFloatHead() {
  const fh = $('#float-head'), scroll = $('#table-scroll'), thead = $('#reit-thead');
  if (!fh || !scroll || !thead) return;
  const sRect = scroll.getBoundingClientRect();
  const headH = thead.getBoundingClientRect().height || 38;
  const hbar = $('#hbar');
  const floatTop = (hbar && !hbar.classList.contains('is-hidden')) ? hbar.getBoundingClientRect().height : 0;
  // Show once the real header has scrolled above the float anchor, while the table still spans it.
  const show = sRect.top < floatTop - 0.5 && sRect.bottom > floatTop + headH;
  if (!show) { if (!fh.hidden) fh.hidden = true; return; }
  fh.hidden = false;
  fh.style.top = floatTop + 'px';
  fh.style.left = sRect.left + 'px';
  fh.style.width = scroll.clientWidth + 'px';
  fh.style.height = headH + 'px';
  syncFloatHeadX();
}

async function load() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    DATA = await res.json();
  } catch (e) {
    document.body.innerHTML = `<div class="empty">Failed to load data.json — ${esc(e.message)}</div>`;
    return;
  }
  loadPrefs();
  init();
}

function init() {
  $('#yahoo-time').textContent = fmt.dateTime(DATA._meta.yahoo_generated_at);
  $('#master-time').textContent = fmt.date(DATA._meta.master_validated);
  $('#universe-count').textContent = String(DATA._meta.reit_count);

  // Device-aware affordance wording. A coarse pointer with no hover ⇒ touch device.
  IS_TOUCH = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches
    || ('ontouchstart' in window && !window.matchMedia?.('(pointer: fine)').matches);
  const hint = $('#table-hint');
  if (hint) hint.innerHTML = IS_TOUCH
    ? 'Tap a column name to filter · tap a row for detail · long-press any value for its source'
    : 'Click a column name to filter · click a row for detail · right-click any value for source';

  buildFilterDefs();   // compute per-column bounds + apply any persisted ranges
  buildChipFilters();
  buildTableHead();
  wireHbar();

  // Search
  const searchEl = $('#search');
  searchEl.value = STATE.search;
  searchEl.addEventListener('input', e => { STATE.search = e.target.value.toLowerCase(); savePrefs(); render(); });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== searchEl && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); searchEl.focus();
    }
  });

  $('#reset-filters').addEventListener('click', resetFilters);
  $('#reset-app').addEventListener('click', () => {
    if (confirm('Clear all saved settings (filters, sort, columns, hidden REITs, widths) from this browser and reload?')) {
      try { localStorage.removeItem(LS_KEY); } catch {}
      location.reload();
    }
  });

  // Clicking a column header opens its filter+sort popover (ignore clicks on a resize handle).
  const onHeadClick = (e) => {
    if (e.target.closest('.col-resize')) return;
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    openColumnFilter(th.dataset.sort, th);
  };
  $('#reit-thead').addEventListener('click', onHeadClick);
  $('#float-head').addEventListener('click', onHeadClick);
  wireColumnResize();
  $('#reit-thead').addEventListener('keydown', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openColumnFilter(th.dataset.sort, th); }
  });
  // Popover: dual-slider inputs + clicks (sort buttons, sector chips, clear, close).
  const colpop = $('#colpop');
  colpop.addEventListener('input', onDualInput);
  colpop.addEventListener('click', (e) => {
    if (e.target.closest('[data-colpop-close]')) { closeColpop(true); return; }
    const sortBtn = e.target.closest('[data-sort-dir]');
    if (sortBtn) { applySort(COLPOP_KEY, sortBtn.dataset.sortDir === 'asc'); return; }
    const chip = e.target.closest('#colpop-sector .chip');
    if (chip) {
      const s = chip.dataset.sector;
      const on = STATE.sectors.has(s);
      if (on) STATE.sectors.delete(s); else STATE.sectors.add(s);
      chip.classList.toggle('is-on', !on); chip.setAttribute('aria-pressed', String(!on));
      updateColpopClear();
      savePrefs(); render();
      return;
    }
    if (e.target.closest('[data-colpop-clear]')) {
      // Clear in place — don't rebuild via innerHTML. Rebuilding detaches the clicked node,
      // and the outside-click handler then sees a target that's no longer inside #colpop and
      // closes the popover. Resetting the existing controls keeps it open in its cleared state.
      const key = COLPOP_KEY;
      if (key === 'sector') {
        STATE.sectors.clear();
        $$('#colpop-sector .chip').forEach(ch => { ch.classList.remove('is-on'); ch.setAttribute('aria-pressed', 'false'); });
      } else {
        delete STATE.ranges[key];
        const def = FILTER_BY_KEY[key];
        if (def) {
          const mn = $('#colpop .dual__in--min'), mx = $('#colpop .dual__in--max');
          if (mn) mn.value = def.bound[0];
          if (mx) mx.value = def.bound[1];
          updateDualUI(key);
        }
      }
      updateColpopClear();
      savePrefs(); render();
      return;
    }
  });
  colpop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeColpop(true); } });
  window.addEventListener('scroll', () => { if (!$('#colpop').hidden) positionColpop(lastColpopAnchor); }, { passive: true });

  // Floating header: keep it positioned/synced on scroll + resize.
  window.addEventListener('scroll', updateFloatHead, { passive: true });
  window.addEventListener('resize', () => { buildFloatHead(); updateFloatHead(); });
  $('#table-scroll').addEventListener('scroll', () => { syncFloatHeadX(); }, { passive: true });

  // Row open + right-click context menu (event delegation on tbody)
  const tbody = $('#reit-rows');
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-ticker]');
    if (!tr) return;
    activateRow(tr);
  });
  tbody.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-ticker]');
    if (!tr) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateRow(tr); }
  });
  tbody.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('td[data-col]');
    if (!cell) return;
    e.preventDefault();
    const tr = cell.closest('tr[data-ticker]');
    showContextMenu(e.clientX, e.clientY, tr.dataset.ticker, cell.dataset.col);
  });
  // Long-press for mobile right-click
  let touchTimer = null;
  tbody.addEventListener('touchstart', (e) => {
    const cell = e.target.closest('td[data-col]');
    if (!cell) return;
    const tr = cell.closest('tr[data-ticker]');
    const touch = e.touches[0];
    touchTimer = setTimeout(() => {
      showContextMenu(touch.clientX, touch.clientY, tr.dataset.ticker, cell.dataset.col);
      touchTimer = null;
    }, 550);
  }, { passive: true });
  tbody.addEventListener('touchend', () => { if (touchTimer) clearTimeout(touchTimer); });
  tbody.addEventListener('touchmove', () => { if (touchTimer) clearTimeout(touchTimer); });

  // Overlay close. Each [data-close] closes only ITS overlay (drawer scrim/× closes drawer;
  // modal scrim/× closes modal). Escape closes only the topmost overlay (modal > drawer).
  $$('#drawer [data-close]').forEach(el => el.addEventListener('click', closeDrawer));
  $$('#modal [data-close]').forEach(el => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#ctx-menu').hidden) { hideContextMenu(); return; }
    if (!$('#colpop').hidden) { closeColpop(true); return; }
    if (!$('#modal').hidden) { closeModal(); return; }       // modal is above the drawer
    if (!$('#drawer').hidden) { closeDrawer(); return; }
  });
  $('#drawer').addEventListener('keydown', trapFocus($('#drawer .drawer__panel')));
  $('#modal').addEventListener('keydown', trapFocus($('#modal .modal__panel')));

  // Action buttons (each records its trigger so focus returns there on close)
  $('#columns-btn').addEventListener('click', (e) => openColumnsModal(e.currentTarget));
  $('#hidden-btn').addEventListener('click', (e) => openHiddenModal(e.currentTarget));
  $('#help-btn').addEventListener('click', (e) => openHelpModal(e.currentTarget));
  $('#open-methodology-foot').addEventListener('click', (e) => { e.preventDefault(); openMethodologyModal(e.currentTarget); });
  $('#open-playbook-foot').addEventListener('click', (e) => { e.preventDefault(); openPlaybookModal(e.currentTarget); });

  // Close context menu / popover on outside click; hide transient layers on scroll/resize.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctx-menu')) hideContextMenu();
    if (!e.target.closest('#colpop') && !e.target.closest('th[data-sort]') && !e.target.closest('.pill')) closeColpop();
  });
  const dismissFloaters = () => { hideContextMenu(); closeColpop(); $('#tooltip').hidden = true; };
  window.addEventListener('scroll', dismissFloaters, true); // capture: catches inner .table-scroll
  window.addEventListener('resize', dismissFloaters);

  // Tooltip system (hover/focus on [data-tip])
  document.addEventListener('mouseover', showTipFromEvent);
  document.addEventListener('mouseout', hideTipFromEvent);
  document.addEventListener('focusin', showTipFromEvent);
  document.addEventListener('focusout', hideTipFromEvent);

  // Touch: long-press a [data-tip] element to show its definition tooltip.
  let tipTouchTimer = null;
  document.addEventListener('touchstart', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const touch = e.touches[0];
    tipTouchTimer = setTimeout(() => {
      showTip(el, touch.clientX, touch.clientY);
      tipTouchTimer = null;
    }, 450);
  }, { passive: true });
  const cancelTipTouch = () => { if (tipTouchTimer) { clearTimeout(tipTouchTimer); tipTouchTimer = null; } };
  document.addEventListener('touchend', cancelTipTouch, { passive: true });
  document.addEventListener('touchmove', () => { cancelTipTouch(); $('#tooltip').hidden = true; }, { passive: true });
  // Tap anywhere else dismisses an open touch-tooltip.
  document.addEventListener('touchstart', (e) => { if (!e.target.closest('[data-tip]')) $('#tooltip').hidden = true; }, { passive: true });

  // Modal content handlers (bound once)
  initModalDelegation();

  // Filter pills: click body → open that filter's popover; click × → remove.
  $('#filter-pills').addEventListener('click', onPillClick);

  // Restore active currency chips (sector now lives in the column popover)
  for (const c of STATE.currencies) $(`#currency-filter .chip[data-ccy="${cssEscape(c)}"]`)?.classList.add('is-on');
  $$('#currency-filter .chip.is-on').forEach(c => c.setAttribute('aria-pressed', 'true'));

  updateHiddenCount();
  render();

  // Header-fit widths are first measured with the fallback font; once IBM Plex Mono loads,
  // clear the cache and re-render so default widths match the real metrics.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      for (const k of Object.keys(HEADER_FIT)) delete HEADER_FIT[k];
      render();
    });
  }
}

function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function buildChipFilters() {
  // Only currency lives in the top bar now; sector is filtered via its column-header popover.
  const ccyWrap = $('#currency-filter');
  const ccys = Array.from(new Set(DATA.reits.map(r => r.trading_currency).filter(Boolean))).sort();
  ccyWrap.innerHTML = ccys.map(c => `<button type="button" class="chip" data-ccy="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('');
  ccyWrap.addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    const cc = c.dataset.ccy;
    const on = STATE.currencies.has(cc);
    if (on) STATE.currencies.delete(cc); else STATE.currencies.add(cc);
    c.classList.toggle('is-on'); c.setAttribute('aria-pressed', String(!on));
    savePrefs(); render();
  });
}

function buildTableHead() {
  const cols = visibleColumns();
  const ths = cols.map(c => {
    const w = colWidth(c);   // fixed layout: every column carries an explicit width
    return `<th scope="col" tabindex="0" role="button" aria-haspopup="dialog" aria-expanded="false" data-sort="${esc(c.key)}" aria-sort="none" class="${c.num ? 'num' : ''} ${c.sticky ? 'is-sticky' : ''}" style="width:${w}px" ${c.metric ? `data-tip="${esc(c.metric)}"` : ''}>`
      + `<span class="th-label">${esc(c.label)}</span>`
      + `<span class="col-resize" data-resize="${esc(c.key)}" title="Drag to resize · double-click to auto-fit" aria-hidden="true"></span>`
      + `</th>`;
  }).join('');
  $('#reit-thead').innerHTML = `<tr>${ths}</tr>`;
  applyTableWidth(cols);
}

/** Fixed layout honours per-column widths only if the table's own width = their sum. */
function applyTableWidth(cols = visibleColumns()) {
  const total = cols.reduce((s, c) => s + colWidth(c), 0);
  const tbl = $('#reit-table');
  if (tbl) tbl.style.width = total + 'px';
}

function updateHiddenCount() {
  $('#hidden-count').textContent = String(STATE.hiddenReits.size);
}

function resetFilters() {
  STATE.search = ''; STATE.sectors.clear(); STATE.currencies.clear();
  STATE.ranges = {};
  STATE.sortStack = [];   // back to the implicit market-cap-desc default
  $('#search').value = '';
  $$('#currency-filter .chip.is-on').forEach(c => { c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false'); });
  closeColpop();
  savePrefs(); render();
}

/** Categorical filters: hidden / search / sector / currency. */
function passesCategorical(r) {
  if (STATE.hiddenReits.has(r.ticker)) return false;
  if (STATE.search) {
    const s = (r.ticker + ' ' + r.name + ' ' + (r.sponsor || '') + ' ' + (r.geography || '')).toLowerCase();
    if (!s.includes(STATE.search)) return false;
  }
  if (STATE.sectors.size && !STATE.sectors.has(r.sector)) return false;
  if (STATE.currencies.size && !STATE.currencies.has(r.trading_currency)) return false;
  return true;
}

function passesFilters(r) {
  if (!passesCategorical(r)) return false;
  for (const f of activeRangeFilters()) {
    const v = f.value(r);
    // A missing value can't be range-matched, so keep the row rather than hide it — its cell
    // reads "n/d", so the gap is immediately visible and nothing is silently dropped.
    if (v != null && (v < f.min || v > f.max)) return false;
  }
  return true;
}

function getSortVal(r, key) {
  if (key === 'quality') return r.scores?.composite ?? null;
  if (['sector','name','geography','ticker'].includes(key)) return (r[key] || '').toLowerCase();
  if (key === 'report_date') return r.report_date ? new Date(r.report_date).getTime() : null;
  return r[key];
}

/* ===================== ACTIVE-FILTER PILLS ===================== */
/** Each active filter becomes a pill: click the body to edit it (reopens the column popover),
 *  click × to remove it. Sector + numeric ranges are column-based; search/currency live in the
 *  always-visible top bar so they aren't duplicated here. */
function renderPills() {
  const pills = [];
  if (STATE.sectors.size) {
    pills.push({ key: 'sector', label: `Sector: ${[...STATE.sectors].join(', ')}` });
  }
  for (const d of FILTER_DEFS) {
    const r = STATE.ranges[d.key];
    // Only pill a range that's actually applied (a hidden column's range is suspended).
    if (r && STATE.columns.has(d.key)) pills.push({ key: d.key, label: `${COL_BY_KEY[d.key]?.label || d.label}: ${fmtRangeLabel(d, r[0], r[1])}` });
  }
  const el = $('#filter-pills');
  el.innerHTML = pills.map(p =>
    `<li class="pill"><button type="button" class="pill__body" data-pill="${esc(p.key)}">${esc(p.label)}</button>`
    + `<button type="button" class="pill__x" data-pill-remove="${esc(p.key)}" aria-label="Remove filter ${esc(p.label)}">×</button></li>`
  ).join('');
}

function onPillClick(e) {
  const rm = e.target.closest('[data-pill-remove]');
  if (rm) {
    const k = rm.dataset.pillRemove;
    if (k === 'sector') STATE.sectors.clear(); else delete STATE.ranges[k];
    if (COLPOP_KEY === k) closeColpop();
    savePrefs(); render();
    return;
  }
  const body = e.target.closest('[data-pill]');
  if (body) openColumnFilter(body.dataset.pill, body);
}

/** Stable tiebreak: larger market cap first, then ticker A→Z. */
function tieBreak(a, b) {
  return (b.market_cap || 0) - (a.market_cap || 0) || a.ticker.localeCompare(b.ticker);
}

/** Compare one level. Nulls always last (return ±1 directly, unaffected by asc). */
function cmpLevel(a, b, level) {
  const va = getSortVal(a, level.key), vb = getSortVal(b, level.key);
  const aNull = va == null || (typeof va === 'string' && va === '');
  const bNull = vb == null || (typeof vb === 'string' && vb === '');
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
  return level.asc ? cmp : -cmp;
}

function render() {
  buildTableHead();
  const rows = DATA.reits.filter(passesFilters);
  rows.sort((a, b) => {
    for (const level of STATE.sortStack) {
      const c = cmpLevel(a, b, level);
      if (c !== 0) return c;
    }
    return tieBreak(a, b);
  });

  // Header sort indicators: each user-sorted column shows the arrow; with >1 level each shows
  // its rank (1,2,3…). When the user hasn't sorted anything, show a faint default arrow on
  // Market cap (the implicit default order) without a rank badge.
  const defaultSort = STATE.sortStack.length === 0;
  $$('#reit-thead th').forEach(th => {
    th.classList.remove('is-sorted', 'asc', 'is-default-sort');
    th.setAttribute('aria-sort', 'none');
    const old = th.querySelector('.sort-rank'); if (old) old.remove();
    const rank = sortRank(th.dataset.sort);
    if (rank != null) {
      const e = STATE.sortStack[rank];
      th.classList.add('is-sorted');
      if (e.asc) th.classList.add('asc');
      th.setAttribute('aria-sort', e.asc ? 'ascending' : 'descending');
      if (STATE.sortStack.length > 1) {
        const badge = document.createElement('span');
        badge.className = 'sort-rank';
        badge.innerHTML = `<span class="sr-only">sort priority </span>${rank + 1}`;
        th.querySelector('.th-label')?.appendChild(badge);
      }
    } else if (defaultSort && th.dataset.sort === 'market_cap') {
      th.classList.add('is-sorted', 'is-default-sort');
      th.setAttribute('aria-sort', 'descending');
    }
  });

  $('#visible-count').textContent = rows.length;
  updateHiddenCount();
  renderPills();

  // Note when a range filter is KEEPING REITs that don't report that metric (a blank can't be
  // range-matched, so we show them rather than silently dropping them — the cell reads "n/d").
  const noteEl = $('#filter-note');
  const ranges = activeRangeFilters();
  let note = '';
  if (ranges.length) {
    let shownMissing = 0;
    const missingMetrics = new Set();   // only the metrics actually absent on kept REITs
    for (const r of DATA.reits) {
      if (!passesFilters(r)) continue;  // only those actually in the visible set
      const lacking = ranges.filter(f => f.value(r) == null);
      if (lacking.length) { shownMissing++; lacking.forEach(f => missingMetrics.add(f.label)); }
    }
    if (shownMissing) {
      const metrics = [...missingMetrics].join(' / ');
      const one = shownMissing === 1;
      note = `· ${shownMissing} REIT${one ? '' : 's'} shown without ${metrics} (n/d — kept for review)`;
    }
  } else if (STATE.hiddenReits.size) {
    note = `· ${STATE.hiddenReits.size} hidden`;
  }
  noteEl.textContent = note;

  const tbody = $('#reit-rows');
  if (!rows.length) {
    const cols = visibleColumns().length;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">no REITs match these filters</td></tr>`;
    syncHbar(); buildFloatHead(); updateFloatHead();
    return;
  }
  tbody.innerHTML = rows.map(r => rowHTML(r)).join('');
  // Defer header-clone measurement to next frame so column widths are final.
  syncHbar();
  requestAnimationFrame(() => { buildFloatHead(); updateFloatHead(); });
}

const CELL_RENDERERS = {
  ticker: r => `<td class="tick num" data-col="ticker">${esc(r.ticker)}</td>`,
  name: r => `<td class="name is-sticky" data-col="name" title="${esc(r.name)}">${esc(r.name)}</td>`,
  sector: r => `<td data-col="sector" title="${esc(r.sub_sector || r.sector || '')}">${sectorChip(r.sector)}</td>`,
  geography: r => `<td class="geo" data-col="geography" title="${esc(r.geography || '')}">${esc(r.geography || '—')}</td>`,
  price: r => `<td class="num" data-col="price">${priceFmt(r.price)}${ccyBadge(r.trading_currency)}</td>`,
  market_cap: r => `<td class="num" data-col="market_cap">${fmt.money(r.market_cap)}${ccyBadge(r.trading_currency)}</td>`,
  distribution_yield_ttm: r => `<td class="num" data-col="distribution_yield_ttm">${r.distribution_yield_ttm != null ? (r.distribution_yield_ttm * 100).toFixed(2) + '%' : '<span class="miss">n/d</span>'}</td>`,
  forward_yield_run_rate: r => `<td class="num" data-col="forward_yield_run_rate">${r.forward_yield_run_rate != null ? (r.forward_yield_run_rate * 100).toFixed(2) + '%' : '<span class="miss">n/d</span>'}</td>`,
  forward_yield_guidance: r => `<td class="num" data-col="forward_yield_guidance">${r.forward_yield_guidance != null ? (r.forward_yield_guidance * 100).toFixed(2) + '%' : '<span class="miss">n/d</span>'}</td>`,
  dpu_yoy_pct: r => `<td class="num" data-col="dpu_yoy_pct">${r.dpu_yoy_pct != null ? signed(r.dpu_yoy_pct) + '%' : '<span class="miss">n/d</span>'}</td>`,
  rental_reversion_pct: r => `<td class="num" data-col="rental_reversion_pct">${r.rental_reversion_pct != null ? signed(r.rental_reversion_pct) + '%' : '<span class="miss">n/d</span>'}</td>`,
  pct_debt_due_12m: r => `<td class="num" data-col="pct_debt_due_12m">${r.pct_debt_due_12m != null ? r.pct_debt_due_12m.toFixed(0) + '%' : '<span class="miss">n/d</span>'}</td>`,
  dpu_change_per_100bps_pct: r => `<td class="num" data-col="dpu_change_per_100bps_pct">${r.dpu_change_per_100bps_pct != null ? signed(r.dpu_change_per_100bps_pct, 1) + '%' : '<span class="miss">n/d</span>'}</td>`,
  gearing_pct: r => `<td class="num" data-col="gearing_pct">${r.gearing_pct != null ? r.gearing_pct.toFixed(1) + '%' : '<span class="miss">n/d</span>'}</td>`,
  gearing_pct_incl_perps: r => `<td class="num" data-col="gearing_pct_incl_perps">${r.gearing_pct_incl_perps != null ? r.gearing_pct_incl_perps.toFixed(1) + '%' : '<span class="miss">n/d</span>'}</td>`,
  icr_x: r => `<td class="num" data-col="icr_x">${r.icr_x != null ? r.icr_x.toFixed(2) + 'x' : '<span class="miss">n/d</span>'}</td>`,
  wace_pct: r => `<td class="num" data-col="wace_pct">${r.wace_pct != null ? r.wace_pct.toFixed(2) + '%' : '<span class="miss">n/d</span>'}</td>`,
  pct_fixed_debt: r => `<td class="num" data-col="pct_fixed_debt">${r.pct_fixed_debt != null ? r.pct_fixed_debt.toFixed(0) + '%' : '<span class="miss">n/d</span>'}</td>`,
  wadm_years: r => `<td class="num" data-col="wadm_years">${r.wadm_years != null ? r.wadm_years.toFixed(1) + 'y' : '<span class="miss">n/d</span>'}</td>`,
  wale_years: r => `<td class="num" data-col="wale_years">${r.wale_years != null ? r.wale_years.toFixed(1) + 'y' : '<span class="miss">n/d</span>'}</td>`,
  occupancy_pct: r => `<td class="num" data-col="occupancy_pct">${r.occupancy_pct != null ? r.occupancy_pct.toFixed(1) + '%' : '<span class="miss">n/d</span>'}</td>`,
  property_yield_pct: r => `<td class="num" data-col="property_yield_pct">${r.property_yield_pct != null ? r.property_yield_pct.toFixed(2) + '%' : '<span class="miss">n/d</span>'}</td>`,
  num_properties: r => `<td class="num" data-col="num_properties">${r.num_properties != null ? r.num_properties : '<span class="miss">n/d</span>'}</td>`,
  top10_tenant_pct: r => `<td class="num" data-col="top10_tenant_pct">${r.top10_tenant_pct != null ? r.top10_tenant_pct.toFixed(0) + '%' : '<span class="miss">n/d</span>'}</td>`,
  nav_per_unit: r => `<td class="num" data-col="nav_per_unit">${r.nav_per_unit != null ? priceFmt(r.nav_per_unit, r.price) : '<span class="miss">n/d</span>'}</td>`,
  p_nav: r => `<td class="num" data-col="p_nav">${r.p_nav != null ? r.p_nav.toFixed(2) + 'x' : '<span class="miss">n/d</span>'}</td>`,
  trailing_pe: r => `<td class="num" data-col="trailing_pe">${r.trailing_pe != null ? r.trailing_pe.toFixed(1) : '<span class="miss">n/d</span>'}</td>`,
  quality: r => `<td class="num" data-col="quality">${qualityCell(r.scores?.composite)}</td>`,
  report_date: r => `<td class="num muted" data-col="report_date" style="font-size:10.5px">${esc(r.report_date || (r.yahoo_fetched_at ? r.yahoo_fetched_at.slice(0,10) : '—'))}</td>`,
};

function rowHTML(r) {
  const cells = visibleColumns().map(c => CELL_RENDERERS[c.key](r)).join('');
  return `<tr data-ticker="${esc(r.ticker)}" tabindex="0" role="button" aria-label="Open detail for ${esc(r.name)}">${cells}</tr>`;
}

/* =====================  DRAWER  ===================== */

function activateRow(tr) {
  const ticker = tr.dataset.ticker;
  $$('#reit-rows tr').forEach(t => t.classList.remove('is-active'));
  tr.classList.add('is-active');
  STATE.lastFocusBeforeDrawer = tr;
  openDrawer(ticker);
}

function openDrawer(ticker) {
  const r = DATA.reits.find(x => x.ticker === ticker);
  if (!r) return;
  const drawer = $('#drawer');
  $('#drawer-content').innerHTML = drawerHTML(r);
  drawer.hidden = false;
  $('#drawer-content').scrollTop = 0;
  $('.drawer__panel', drawer).scrollTop = 0;
  setTimeout(() => $('.drawer__panel', drawer)?.focus(), 30);
}

function closeDrawer() {
  const drawer = $('#drawer');
  if (drawer.hidden) return;
  drawer.hidden = true;
  $$('#reit-rows tr').forEach(t => t.classList.remove('is-active'));
  if (STATE.lastFocusBeforeDrawer) { STATE.lastFocusBeforeDrawer.focus(); STATE.lastFocusBeforeDrawer = null; }
}

function closeModal() {
  const m = $('#modal');
  if (m.hidden) return;
  m.hidden = true;
  // Reset the trigger's aria-expanded and return focus to it.
  if (STATE.lastModalTrigger) {
    STATE.lastModalTrigger.setAttribute?.('aria-expanded', 'false');
    STATE.lastModalTrigger.focus?.();
    STATE.lastModalTrigger = null;
  }
}

/* ===================== COLUMN FILTER + SORT POPOVER ===================== */

// Smart asc/desc labels by column semantics.
function sortLabels(c) {
  const sizeCols = new Set(['market_cap', 'num_properties']);
  if (c.key === 'report_date') return { desc: 'Newest first', asc: 'Oldest first' };
  if (!c.num) return { asc: 'A → Z', desc: 'Z → A' };
  if (sizeCols.has(c.key)) return { desc: 'Largest first', asc: 'Smallest first' };
  return { desc: 'Highest first', asc: 'Lowest first' };
}

let COLPOP_KEY = null;
let lastColpopAnchor = null;

function openColumnFilter(key, anchorEl) {
  const c = COL_BY_KEY[key];
  if (!c) return;
  const pop = $('#colpop');
  // Toggle off if re-clicking the same column's header
  if (COLPOP_KEY === key && !pop.hidden && (anchorEl === lastColpopAnchor)) { closeColpop(); return; }
  COLPOP_KEY = key;
  lastColpopAnchor = anchorEl || lastColpopAnchor;
  const L = sortLabels(c);
  const def = FILTER_BY_KEY[key];
  const isSector = key === 'sector';

  let filterHTML = '';
  if (def) {
    const cur = STATE.ranges[key] || def.bound;
    const valTxt = STATE.ranges[key] ? `${def.fmt(cur[0])} – ${def.fmt(cur[1])}` : `any (${def.fmt(def.bound[0])} – ${def.fmt(def.bound[1])})`;
    filterHTML = `<div class="colpop__sec">
        <div class="colpop__sublabel">Filter range <span class="colpop__rangeval" data-val-for="${esc(key)}">${esc(valTxt)}</span></div>
        ${dualSliderHTML(def)}
      </div>`;
  } else if (isSector) {
    const sectors = Array.from(new Set(DATA.reits.map(r => r.sector).filter(Boolean))).sort();
    filterHTML = `<div class="colpop__sec">
        <div class="colpop__sublabel" id="colpop-seclabel">Show sectors</div>
        <div class="chip-list" id="colpop-sector" role="group" aria-labelledby="colpop-seclabel">${sectors.map(s =>
          `<button type="button" class="chip ${STATE.sectors.has(s) ? 'is-on' : ''}" data-sector="${esc(s)}" aria-pressed="${STATE.sectors.has(s)}">${esc(s)}</button>`).join('')}</div>
      </div>`;
  } else {
    filterHTML = `<div class="colpop__sec colpop__hint">Filter this text column with the Search box (top-left).</div>`;
  }

  const m = c.metric ? window.METRICS[c.metric] : null;
  pop.innerHTML = `
    <div class="colpop__head">
      <span class="colpop__title">${esc(c.label)}</span>
      <button type="button" class="colpop__x" data-colpop-close aria-label="Close">×</button>
    </div>
    ${m ? `<div class="colpop__what">${esc(m.what)}</div>` : ''}
    <div class="colpop__sec">
      <div class="colpop__sublabel" id="colpop-sortlabel">Sort</div>
      <div class="colpop__sort" role="group" aria-labelledby="colpop-sortlabel">
        <button type="button" class="colpop__sortbtn" data-sort-dir="desc">${esc(L.desc)}</button>
        <button type="button" class="colpop__sortbtn" data-sort-dir="asc">${esc(L.asc)}</button>
      </div>
    </div>
    ${filterHTML}
    <div class="colpop__sec" data-colpop-clear-sec ${(def && STATE.ranges[key]) || (isSector && STATE.sectors.size) ? '' : 'hidden'}><button type="button" class="colpop__clear" data-colpop-clear>Clear this filter</button></div>
  `;
  pop.hidden = false;
  positionColpop(anchorEl);
  if (def) updateDualUI(key);
  renderColpopSortState(key);
  // Reflect open state on the originating header (if it is one) for AT.
  if (anchorEl?.matches?.('th[data-sort]')) anchorEl.setAttribute('aria-expanded', 'true');
  // Focus first sort button for keyboard users.
  setTimeout(() => pop.querySelector('.colpop__sortbtn')?.focus(), 20);
}

function positionColpop(anchorEl) {
  const pop = $('#colpop');
  const a = anchorEl?.getBoundingClientRect?.();
  pop.style.left = '0px'; pop.style.top = '0px';
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = a ? a.left : 80;
  let top = a ? a.bottom + 6 : 80;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  if (top + h > window.innerHeight - 8) top = Math.max(8, (a ? a.top : 80) - h - 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function renderColpopSortState(key) {
  if (COLPOP_KEY !== key) return;
  const e = sortEntry(key);
  const dir = e && STATE.sortStack[0].key === key ? (e.asc ? 'asc' : 'desc') : null;
  $$('#colpop .colpop__sortbtn').forEach(b => b.classList.toggle('is-active', b.dataset.sortDir === dir));
}

function closeColpop(restoreFocus = false) {
  const pop = $('#colpop');
  if (pop && !pop.hidden) {
    pop.hidden = true;
    $$('#reit-thead th[aria-expanded="true"]').forEach(th => th.setAttribute('aria-expanded', 'false'));
    // On a keyboard-driven close (Esc / ×) return focus to the header so the user isn't
    // dumped to <body>. On outside-click / scroll we leave focus where the user put it.
    if (restoreFocus && COLPOP_KEY) {
      const target = (lastColpopAnchor && document.contains(lastColpopAnchor) && lastColpopAnchor)
        || $(`#reit-thead th[data-sort="${cssEscape(COLPOP_KEY)}"]`);
      target?.focus?.();
    }
  }
  COLPOP_KEY = null;
}

function trapFocus(panel) {
  return (e) => {
    if (e.key !== 'Tab') return;
    const focusables = $$('a, button, input, [tabindex]:not([tabindex="-1"])', panel)
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
}

function drawerHTML(r) {
  const ccy = r.trading_currency || '';
  const sources = r.sources || {};
  const srcUrl = (s) => (s && typeof s === 'object' && s.url) ? s.url : (typeof s === 'string' ? s : null);
  const srcAuth = (s) => (s && typeof s === 'object') ? s.authoritative : null;

  const metric = (label, val, opts = {}) => {
    const { unit = '', source = null, threshold = '', note = '', metricKey = null } = opts;
    const url = srcUrl(source);
    const auth = srcAuth(source);
    const labelHTML = metricKey
      ? `<span class="metric__label has-tip" data-tip="${esc(metricKey)}">${esc(label)}</span>`
      : `<span class="metric__label">${esc(label)}</span>`;
    const valHTML = val == null
      ? '<div class="metric__val miss">n/d</div>'
      : `<div class="metric__val">${val}${unit ? `<small> ${esc(unit)}</small>` : ''}${threshold || ''}</div>`;
    const srcLink = url ? `<a class="metric__src ${auth === false ? 'metric__src--warn' : ''}" href="${esc(url)}" target="_blank" rel="noopener">${auth === false ? '⚠ non-authoritative source ↗' : 'source ↗'}</a>` : '';
    const noteHTML = note ? `<div class="metric__note">${esc(note)}</div>` : '';
    return `<div class="metric">${labelHTML}${valHTML}${noteHTML}${srcLink}</div>`;
  };

  const priceDisp = priceFmt(r.price);
  const yieldDisp = r.distribution_yield_ttm != null ? (r.distribution_yield_ttm * 100).toFixed(2) + '%' : null;
  const pnavDisp = r.p_nav != null ? r.p_nav.toFixed(2) + 'x' : null;
  const navDisp = r.nav_per_unit != null ? priceFmt(r.nav_per_unit, r.price) : null;
  const dpuDisp = r.dpu_ttm_cents != null ? `${r.dpu_ttm_cents.toFixed(2)}¢` : null;
  const gearVal = r.gearing_pct != null ? r.gearing_pct.toFixed(1) : null;
  const gearPerpsVal = r.gearing_pct_incl_perps != null ? r.gearing_pct_incl_perps.toFixed(1) : null;
  const icrVal = r.icr_x != null ? r.icr_x.toFixed(2) : null;
  const fixedVal = r.pct_fixed_debt != null ? r.pct_fixed_debt.toFixed(1) : null;
  const waceVal = r.wace_pct != null ? r.wace_pct.toFixed(2) : null;
  const wadmVal = r.wadm_years != null ? r.wadm_years.toFixed(1) : null;
  const propYieldVal = r.property_yield_pct != null ? r.property_yield_pct.toFixed(2) : null;
  const occVal = r.occupancy_pct != null ? r.occupancy_pct.toFixed(1) : null;
  const waleVal = r.wale_years != null ? r.wale_years.toFixed(1) : null;
  const topVal = r.top10_tenant_pct != null ? r.top10_tenant_pct.toFixed(1) : null;

  const spark = sparkSVG(r.price_series, r);
  const geoBlock = renderGeoSplit(r.geographic_split);

  const pnavNote = r.p_nav_source === 'yahoo_priceToBook'
    ? 'Yahoo price-to-book fallback (NAV not disclosed in latest manager filing); not strictly P/NAV'
    : '';
  const gapNote = r.yield_gap_yahoo_vs_manager != null && Math.abs(r.yield_gap_yahoo_vs_manager) > 0.005 && r.yahoo_dividend_yield != null
    ? `Yahoo headline (${(r.yahoo_dividend_yield * 100).toFixed(2)}%) exceeds manager-disclosed DPU yield by ${(r.yield_gap_yahoo_vs_manager * 100).toFixed(2)}pp — possible capital top-up / income support`
    : '';
  const perpsNote = r.perpetual_securities_note || '';

  const sc = r.scores || {};
  const scoreBlock = (label, sub) => {
    if (!sub) return `<div class="score-block"><span class="l">${esc(label)}</span><span class="bar"><i style="width:0%"></i></span><span class="v miss">n/d</span></div>`;
    const v = sub.score;
    if (v == null) return `<div class="score-block"><span class="l">${esc(label)}</span><span class="bar"><i style="width:0%"></i></span><span class="v miss">n/d</span></div>`;
    const conf = sub.n_inputs != null && sub.max_inputs ? `<span class="conf">${sub.n_inputs}/${sub.max_inputs}</span>` : '';
    return `<div class="score-block"><span class="l">${esc(label)} ${conf}</span><span class="bar"><i style="width:${v}%"></i></span><span class="v">${v}</span></div>`;
  };

  return `
    <h2 class="dh" id="drawer-title">
      <small>${esc(r.ticker)}${ccyBadgeAlways(ccy)}</small>
      ${esc(r.name)}
    </h2>
    <div class="d-sub">
      ${sectorChip(r.sector)}
      &nbsp;<strong>${esc(r.sub_sector || '')}</strong>
      &nbsp;·&nbsp; ${esc(r.geography || '')}
      &nbsp;·&nbsp; sponsor <strong>${esc(r.sponsor || '—')}</strong>
    </div>

    <div class="d-pills">
      ${r.alt_counter ? `<span class="pill">alt counter: ${esc(r.alt_counter.ticker)} ${esc(r.alt_counter.currency)}</span>` : ''}
      <span class="pill">price as of ${esc(fmt.date(r.quote_time))}</span>
      ${r.report_period ? `<span class="pill">results: ${esc(r.report_period)}</span>` : ''}
      ${r.report_date ? `<span class="pill">filed ${esc(r.report_date)}</span>` : ''}
      <button type="button" class="pill pill--btn" id="hide-reit-btn" data-ticker="${esc(r.ticker)}">hide this REIT</button>
    </div>

    <div class="spark">
      <div class="spark__title">
        <span>1-year price · close</span>
        <span>52w range: ${priceFmt(r.fifty_two_week_low, r.price)}–${priceFmt(r.fifty_two_week_high, r.price)} ${esc(ccy)}</span>
      </div>
      ${spark}
    </div>

    <div class="d-section">Market</div>
    <div class="metrics">
      ${metric('Price', priceDisp, { unit: ccy, metricKey: 'price' })}
      ${metric('Market cap', fmt.money(r.market_cap), { unit: ccy, metricKey: 'market_cap' })}
      ${metric('Shares outstanding', r.shares_outstanding ? fmt.money(r.shares_outstanding) : null)}
      ${metric('52w high / low', `${priceFmt(r.fifty_two_week_high, r.price)} / ${priceFmt(r.fifty_two_week_low, r.price)}`, { unit: ccy })}
      ${metric('50d / 200d avg', `${priceFmt(r.fifty_day_avg, r.price)} / ${priceFmt(r.two_hundred_day_avg, r.price)}`, { unit: ccy })}
      ${metric('Beta', r.beta != null ? r.beta.toFixed(2) : null)}
    </div>

    <div class="d-section">Distribution &amp; cash yield</div>
    <div class="metrics">
      ${metric('Distribution yield (TTM)', yieldDisp, { threshold: thresholdBadge('yld', r.distribution_yield_ttm), source: sources.dpu, metricKey: 'distribution_yield_ttm' })}
      ${metric('DPU TTM', dpuDisp, { unit: `(${r.dpu_currency || ccy})`, source: sources.dpu, metricKey: 'dpu_ttm_cents' })}
      ${metric('Last period DPU', r.dpu_last_period_cents != null ? r.dpu_last_period_cents.toFixed(3) + '¢' : null, { unit: `(${r.dpu_currency || ccy})` })}
      ${metric('Yahoo headline yield', r.yahoo_dividend_yield != null ? (r.yahoo_dividend_yield * 100).toFixed(2) + '%' : null, { note: gapNote, metricKey: 'yahoo_dividend_yield' })}
      ${metric('Payout ratio (Yahoo)', r.payout_ratio != null ? (r.payout_ratio * 100).toFixed(1) + '%' : null, { metricKey: 'payout_ratio' })}
      ${metric('5y avg div yield (Yahoo)', r.five_year_avg_div_yield != null ? (r.five_year_avg_div_yield * 100).toFixed(2) + '%' : null, { metricKey: 'five_year_avg_div_yield' })}
      ${metric('Ex-dividend date', r.ex_dividend_date ? fmt.date(r.ex_dividend_date) : null)}
      ${r.forward_dpu_guidance ? `<div class="metric metric--wide"><span class="metric__label">Forward DPU guidance</span><div class="metric__val metric__val--prose">${esc(r.forward_dpu_guidance)}</div></div>` : ''}
    </div>

    <div class="d-section">Forward-looking · expected future yield</div>
    <div class="metrics">
      ${metric('Forward yield (run-rate)', r.forward_yield_run_rate != null ? (r.forward_yield_run_rate * 100).toFixed(2) + '%' : null, { note: r.forward_yield_run_rate != null && r.distribution_yield_ttm != null ? (r.forward_yield_run_rate > r.distribution_yield_ttm * 1.02 ? 'above TTM — DPU run-rate rising' : r.forward_yield_run_rate < r.distribution_yield_ttm * 0.98 ? 'below TTM — DPU run-rate falling' : '') : '', metricKey: 'forward_yield_run_rate' })}
      ${metric('Forward yield (guided)', r.forward_yield_guidance != null ? (r.forward_yield_guidance * 100).toFixed(2) + '%' : null, { source: sources.forecast_dpu, note: r.forecast_dpu_basis || '', metricKey: 'forward_yield_guidance' })}
      ${metric('DPU growth (YoY)', r.dpu_yoy_pct != null ? signed(r.dpu_yoy_pct) + '%' : null, { source: sources.dpu_yoy, metricKey: 'dpu_yoy_pct' })}
      ${metric('Rental reversion', r.rental_reversion_pct != null ? signed(r.rental_reversion_pct) + '%' : null, { source: sources.rental_reversion, metricKey: 'rental_reversion_pct' })}
      ${metric('Debt due ≤ 12 months', r.pct_debt_due_12m != null ? r.pct_debt_due_12m.toFixed(0) + '%' : null, { source: sources.debt_maturity, metricKey: 'pct_debt_due_12m' })}
      ${metric('DPU sensitivity to +100bps', r.dpu_change_per_100bps_pct != null ? signed(r.dpu_change_per_100bps_pct) + '%' : null, { source: sources.rate_sensitivity, metricKey: 'dpu_change_per_100bps_pct' })}
      ${metric('Distribution frequency', r.distribution_frequency != null ? (r.distribution_frequency === 4 ? 'Quarterly' : r.distribution_frequency === 2 ? 'Semi-annual' : `${r.distribution_frequency}×/yr`) : null, { source: sources.distribution_frequency })}
    </div>

    <div class="d-section">Capital management</div>
    <div class="metrics">
      ${metric('Gearing (aggregate leverage)', gearVal, { unit: '%', threshold: thresholdBadge('gearing', r.gearing_pct), source: sources.gearing, metricKey: 'gearing_pct' })}
      ${metric('Gearing (incl. perpetuals)', gearPerpsVal, { unit: '%', threshold: thresholdBadge('gearing', r.gearing_pct_incl_perps), source: sources.gearing_incl_perps, note: perpsNote, metricKey: 'gearing_pct_incl_perps' })}
      ${metric('ICR (adjusted)', icrVal, { unit: 'x', threshold: thresholdBadge('icr', r.icr_x), source: sources.icr, metricKey: 'icr_x' })}
      ${metric('Property yield (NPI/AUM)', propYieldVal, { unit: '%', source: sources.property_yield, metricKey: 'property_yield_pct' })}
      ${metric('Weighted avg cost of debt', waceVal, { unit: '%', source: sources.debt, metricKey: 'wace_pct' })}
      ${metric('% Fixed/hedged debt', fixedVal, { unit: '%', threshold: thresholdBadge('fixed', r.pct_fixed_debt), source: sources.debt, metricKey: 'pct_fixed_debt' })}
      ${metric('WA debt maturity', wadmVal, { unit: 'yrs', threshold: thresholdBadge('wadm', r.wadm_years), source: sources.debt, metricKey: 'wadm_years' })}
      ${metric('NAV per unit', navDisp, { unit: ccy, source: sources.nav, metricKey: 'nav_per_unit' })}
      ${metric('P / NAV', pnavDisp, { note: pnavNote, metricKey: 'p_nav' })}
      ${metric('Trailing P/E', r.trailing_pe != null ? r.trailing_pe.toFixed(1) : null, { metricKey: 'trailing_pe' })}
    </div>

    <div class="d-section">Portfolio &amp; operations</div>
    <div class="metrics">
      ${metric('Occupancy', occVal, { unit: '%', threshold: thresholdBadge('occ', r.occupancy_pct), source: sources.occupancy, metricKey: 'occupancy_pct' })}
      ${metric('WALE', waleVal, { unit: `yrs (${r.wale_basis || '—'})`, threshold: thresholdBadge('wale', r.wale_years), source: sources.wale, metricKey: 'wale_years' })}
      ${metric('Number of properties', r.num_properties, { source: sources.properties, metricKey: 'num_properties' })}
      ${metric('Total portfolio (AUM)', r.aum_total)}
      ${metric('Top-10 tenant share', topVal, { unit: '%', metricKey: 'top10_tenant_pct' })}
    </div>

    ${geoBlock}

    <div class="d-section">Quality score breakdown</div>
    <div>
      ${scoreBlock('Leverage', sc.leverage)}
      ${scoreBlock('Distribution', sc.distribution)}
      ${scoreBlock('Operations', sc.operations)}
      <div class="score-block score-block--composite">
        <span class="l">Composite</span>
        <span class="bar"><i style="width:${sc.composite ?? 0}%"></i></span>
        <span class="v">${sc.composite ?? '<span class="miss">n/d</span>'}</span>
      </div>
    </div>
    <div class="score-caveat">Sector-aware blend of leverage / distribution / operations (see <a href="#" id="open-meth-from-drawer">Methodology §7</a>). Does NOT capture sponsor strength, tenant credit, refinancing cliffs, or distribution composition. Triage tool, not buy signal.</div>

    <div class="d-section">Sources &amp; freshness</div>
    <ul class="src-list">
      <li><span class="key">Issuer IR page</span><a href="${esc(r.ir_url)}" target="_blank" rel="noopener">${esc(r.ir_url)}</a></li>
      ${r.report_url ? `<li><span class="key">Latest results filing</span><a href="${esc(r.report_url)}" target="_blank" rel="noopener">${esc(r.report_url)}</a></li>` : ''}
      <li><span class="key">Yahoo Finance quote</span><a href="${esc(srcUrl(sources.summary))}" target="_blank" rel="noopener">${esc(srcUrl(sources.summary))}</a></li>
      <li><span class="key">Yahoo fetched</span><span>${esc(fmt.dateTime(r.yahoo_fetched_at))}</span></li>
      ${r.facts_fetched_at ? `<li><span class="key">IR data fetched</span><span>${esc(fmt.dateTime(r.facts_fetched_at))}</span></li>` : ''}
    </ul>
  `;
}

/* =====================  CONTEXT MENU  ===================== */

function showContextMenu(x, y, ticker, col) {
  const r = DATA.reits.find(x => x.ticker === ticker);
  if (!r) return;
  const sources = r.sources || {};
  // Map column key to source key
  const colToSource = {
    gearing_pct: sources.gearing,
    gearing_pct_incl_perps: sources.gearing_incl_perps,
    icr_x: sources.icr,
    wace_pct: sources.debt, pct_fixed_debt: sources.debt, wadm_years: sources.debt,
    distribution_yield_ttm: sources.dpu,
    nav_per_unit: sources.nav, p_nav: sources.nav,
    occupancy_pct: sources.occupancy,
    wale_years: sources.wale,
    num_properties: sources.properties,
    property_yield_pct: sources.property_yield,
    forward_yield_run_rate: sources.dpu, forward_yield_guidance: sources.forecast_dpu,
    dpu_yoy_pct: sources.dpu_yoy, rental_reversion_pct: sources.rental_reversion,
    pct_debt_due_12m: sources.debt_maturity, dpu_change_per_100bps_pct: sources.rate_sensitivity,
    price: sources.chart, market_cap: sources.summary,
  };
  const src = colToSource[col];
  const srcUrl = (s) => (s && typeof s === 'object' && s.url) ? s.url : (typeof s === 'string' ? s : null);
  const srcAuth = (s) => (s && typeof s === 'object') ? s.authoritative : null;
  const items = [];
  const url = srcUrl(src);
  const auth = srcAuth(src);
  if (url) {
    items.push({ label: auth === false ? '⚠ Open source (non-authoritative)' : 'Open source ↗', href: url });
    items.push({ label: 'Copy source URL', action: () => navigator.clipboard?.writeText(url) });
  } else {
    items.push({ label: 'No source URL recorded', disabled: true });
  }
  items.push({ label: 'Open issuer IR page ↗', href: r.ir_url });
  if (r.report_url) items.push({ label: 'Open latest filing ↗', href: r.report_url });
  items.push({ sep: true });
  items.push({ label: 'Open detail drawer', action: () => openDrawer(ticker) });
  items.push({ label: STATE.hiddenReits.has(ticker) ? 'Unhide this REIT' : 'Hide this REIT', action: () => toggleHidden(ticker) });

  const menu = $('#ctx-menu');
  menu.innerHTML = items.map((it, i) => {
    if (it.sep) return `<li class="ctx-sep" role="separator"></li>`;
    if (it.href) return `<li class="ctx-item" role="menuitem" tabindex="-1"><a href="${esc(it.href)}" target="_blank" rel="noopener" tabindex="-1">${esc(it.label)}</a></li>`;
    if (it.disabled) return `<li class="ctx-item is-disabled" role="menuitem" aria-disabled="true">${esc(it.label)}</li>`;
    return `<li class="ctx-item" role="menuitem" tabindex="-1" data-i="${i}">${esc(it.label)}</li>`;
  }).join('');
  menu.hidden = false;
  // Position, clamp to viewport
  menu.style.left = '0px'; menu.style.top = '0px';
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const px = Math.min(x, window.innerWidth - w - 6);
  const py = Math.min(y, window.innerHeight - h - 6);
  menu.style.left = px + 'px'; menu.style.top = py + 'px';

  // Remember the cell that opened the menu so Escape can return focus there.
  CTX.originCell = document.activeElement && document.activeElement.closest?.('td[data-col]') || null;

  const activate = (li) => {
    if (!li) return;
    const a = li.querySelector('a');
    if (a) { window.open(a.href, '_blank', 'noopener'); hideContextMenu(); return; }
    const fn = items[Number(li.dataset.i)]?.action;
    if (fn) fn();
    hideContextMenu();
  };
  // Action items (no anchor) activate via JS.
  menu.querySelectorAll('.ctx-item[data-i]').forEach(li => {
    li.addEventListener('click', () => activate(li));
  });
  // Anchor items navigate natively; just close the menu after the click.
  menu.querySelectorAll('.ctx-item a').forEach(a => {
    a.addEventListener('click', () => hideContextMenu());
  });

  // Keyboard: focus first actionable item; arrows to move; Enter/Space to activate; Esc to close.
  const focusables = [...menu.querySelectorAll('.ctx-item:not(.is-disabled)')];
  setTimeout(() => focusables[0]?.focus(), 0);
  menu.onkeydown = (e) => {
    const idx = focusables.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(idx + 1) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(idx - 1 + focusables.length) % focusables.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); focusables[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); focusables[focusables.length - 1]?.focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(document.activeElement); }
    else if (e.key === 'Escape') { e.preventDefault(); hideContextMenu(); }
  };
}
const CTX = { originCell: null };
function hideContextMenu() {
  const m = $('#ctx-menu');
  if (!m || m.hidden) return;
  m.hidden = true;
  m.onkeydown = null;
  if (CTX.originCell) { CTX.originCell.focus?.(); CTX.originCell = null; }
}

/* =====================  MODALS  ===================== */

function openModal(title, html, trigger = null) {
  const m = $('#modal');
  const wasHidden = m.hidden;
  // `title` is always a static string literal from the callers; escape defensively anyway.
  // `html` is built by the callers with esc() applied to any dynamic content.
  $('#modal-content').innerHTML = `<h2 class="modal__title" id="modal-title">${esc(title)}</h2>${html}`;
  // Only capture the trigger on the FIRST open — preserve it across in-modal re-renders
  // (e.g. Columns "reset to default" or Hidden "unhide" which re-call the open function).
  if (wasHidden) {
    STATE.lastModalTrigger = trigger || document.activeElement;
    trigger?.setAttribute?.('aria-expanded', 'true');
  }
  m.hidden = false;
  $('.modal__panel', m).scrollTop = 0;
  setTimeout(() => $('.modal__panel', m)?.focus(), 30);
}

function openColumnsModal(trigger) {
  // Rows in the current display order; drag the ⠿ handle (or use ↑/↓) to reorder.
  const items = STATE.columnOrder.filter(k => COL_BY_KEY[k]).map((k, i) => {
    const c = COL_BY_KEY[k];
    const m = c.metric ? window.METRICS[c.metric] : null;
    const hint = m ? esc(m.what) : '';
    return `<div class="col-toggle" draggable="true" data-colrow="${esc(c.key)}"${c.metric ? ` data-tip="${esc(c.metric)}"` : ''}>
      <span class="col-grip" aria-hidden="true" title="Drag to reorder">⠿</span>
      <input type="checkbox" id="colcb-${esc(c.key)}" data-col="${esc(c.key)}" ${STATE.columns.has(c.key) ? 'checked' : ''} />
      <label class="col-toggle__name" for="colcb-${esc(c.key)}">${esc(c.label)}</label>
      <span class="col-move">
        <button type="button" class="col-move__btn" data-move-up="${esc(c.key)}" title="Move up" aria-label="Move ${esc(c.label)} up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="col-move__btn" data-move-down="${esc(c.key)}" title="Move down" aria-label="Move ${esc(c.label)} down">↓</button>
      </span>
      ${hint ? `<small class="col-toggle__hint">${hint}</small>` : ''}
    </div>`;
  }).join('');
  openModal('Columns', `<p class="modal__lead">Toggle, reorder (drag the ⠿ handle or use ↑/↓), and resize columns. Resize by dragging a column's right edge in the table (double-click the edge to auto-fit). All saved to your browser. Hover/long-press a row for the definition, or open the <button type="button" class="link-btn" id="cols-to-help">Help page</button>.</p>
    <div class="col-toggle-list" id="col-toggle-list">${items}</div>
    <div class="modal__actions">
      <button type="button" id="cols-reset">Reset columns (show, order &amp; width)</button>
    </div>`, trigger);
  wireColumnReorderDnD();
  // Toggle / button handlers are bound ONCE at init via delegation (initModalDelegation).
}

/** Move a column key before/after in STATE.columnOrder, then re-render. */
function moveColumn(key, dir) {
  const order = STATE.columnOrder.filter(k => COL_BY_KEY[k]);
  const i = order.indexOf(key);
  if (i < 0) return;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  STATE.columnOrder = order;
  savePrefs(); render(); openColumnsModal();
}

/** HTML5 drag-and-drop reordering within the Columns modal list. */
function wireColumnReorderDnD() {
  const list = $('#col-toggle-list');
  if (!list) return;
  let dragKey = null;
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-colrow]'); if (!row) return;
    dragKey = row.dataset.colrow; row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragend', (e) => {
    e.target.closest('[data-colrow]')?.classList.remove('is-dragging');
    $$('.col-toggle.is-dragover', list).forEach(el => el.classList.remove('is-dragover'));
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const row = e.target.closest('[data-colrow]');
    $$('.col-toggle.is-dragover', list).forEach(el => el.classList.remove('is-dragover'));
    if (row && row.dataset.colrow !== dragKey) row.classList.add('is-dragover');
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const row = e.target.closest('[data-colrow]');
    if (!row || !dragKey || row.dataset.colrow === dragKey) return;
    const targetKey = row.dataset.colrow;
    const order = STATE.columnOrder.filter(k => COL_BY_KEY[k]);
    const from = order.indexOf(dragKey);
    order.splice(from, 1);
    const to = order.indexOf(targetKey);
    order.splice(to, 0, dragKey);   // insert before the drop target
    STATE.columnOrder = order;
    dragKey = null;
    savePrefs(); render(); openColumnsModal();
  });
}

function openHiddenModal(trigger) {
  if (STATE.hiddenReits.size === 0) {
    openModal('Hidden REITs', `<p class="modal__lead">You haven't hidden any REITs.</p>
      <p>To hide a REIT, ${IS_TOUCH ? 'long-press' : 'right-click'} any cell in its row, or open its detail drawer and tap "hide this REIT".</p>`, trigger);
    return;
  }
  const items = [...STATE.hiddenReits].map(t => {
    const r = DATA.reits.find(x => x.ticker === t);
    if (!r) return '';
    return `<li class="hidden-item"><strong>${esc(t)}</strong> <span>${esc(r.name)}</span> <button type="button" data-unhide="${esc(t)}">unhide</button></li>`;
  }).join('');
  openModal('Hidden REITs', `<p class="modal__lead">REITs you've hidden from the table. They'll stay hidden across sessions.</p>
    <ul class="hidden-list">${items}</ul>
    <div class="modal__actions">
      <button type="button" id="unhide-all">Unhide all</button>
    </div>`, trigger);
}

/** Single delegated handler set, bound once at init. Avoids listener accumulation on the
 *  persistent #modal-content node across repeated modal opens. */
function initModalDelegation() {
  const content = $('#modal-content');
  content.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-col]'); if (!cb) return;
    if (cb.checked) {
      STATE.columns.add(cb.dataset.col);
    } else {
      if (STATE.columns.size <= 1) { cb.checked = true; return; } // keep >=1 column
      STATE.columns.delete(cb.dataset.col);
    }
    savePrefs(); render();
  });
  content.addEventListener('click', (e) => {
    if (e.target.closest('#cols-reset')) {
      STATE.columns = new Set(DEFAULT_COLUMNS);
      STATE.columnOrder = [...DEFAULT_ORDER];
      STATE.columnWidths = {};
      savePrefs(); render(); openColumnsModal();
      return;
    }
    const up = e.target.closest('[data-move-up]');
    if (up) { moveColumn(up.dataset.moveUp, 'up'); return; }
    const down = e.target.closest('[data-move-down]');
    if (down) { moveColumn(down.dataset.moveDown, 'down'); return; }
    if (e.target.closest('#cols-to-help')) { openHelpModal(); return; }
    const unhide = e.target.closest('[data-unhide]');
    if (unhide) { toggleHidden(unhide.dataset.unhide); openHiddenModal(); return; }
    if (e.target.closest('#unhide-all')) {
      STATE.hiddenReits.clear(); savePrefs(); render(); openHiddenModal();
      return;
    }
    if (e.target.closest('#open-help-from-method')) { openHelpModal(); return; }
  });
}

function openHelpModal() {
  const sections = {
    'Distribution & yield': ['distribution_yield_ttm', 'dpu_ttm_cents', 'yahoo_dividend_yield', 'payout_ratio', 'five_year_avg_div_yield'],
    'Forward-looking (expected future yield)': ['forward_yield_run_rate', 'forward_yield_guidance', 'dpu_yoy_pct', 'rental_reversion_pct', 'pct_debt_due_12m', 'dpu_change_per_100bps_pct'],
    'Leverage & capital management': ['gearing_pct', 'gearing_pct_incl_perps', 'icr_x', 'wace_pct', 'pct_fixed_debt', 'wadm_years', 'property_yield_pct'],
    'Operations': ['occupancy_pct', 'wale_years', 'num_properties', 'top10_tenant_pct'],
    'Valuation': ['nav_per_unit', 'p_nav', 'trailing_pe'],
    'Market': ['price', 'market_cap'],
    'Composite': ['quality_composite'],
    'Other terms': ['ttm', 'dpu', 'npi', 'wale_basis_nla', 'wale_basis_gri', 'perpetual_securities'],
  };
  const render = (k) => {
    const m = window.METRICS[k]; if (!m) return '';
    return `<div class="help-entry" id="help-${esc(k)}">
      <h3>${esc(m.label)}${m.abbr && m.abbr !== m.label ? ` <span class="help-abbr">(${esc(m.abbr)})</span>` : ''}</h3>
      <p class="help-what"><strong>What:</strong> ${esc(m.what)}</p>
      <p class="help-why"><strong>Why it matters:</strong> ${esc(m.why)}</p>
      ${m.formula ? `<p class="help-formula"><strong>Formula:</strong> <code>${esc(m.formula)}</code></p>` : ''}
      ${m.healthy ? `<p class="help-healthy"><strong>Healthy bands:</strong> ${esc(m.healthy)}</p>` : ''}
      ${m.sources ? `<p class="help-sources"><strong>Source:</strong> ${esc(m.sources)}</p>` : ''}
    </div>`;
  };
  const html = `
    <p class="modal__lead">Every metric on this dashboard, in plain English. The data drives capital-allocation decisions, so each definition includes <strong>why the metric matters</strong> (or doesn't) — not just what it is.</p>
    <p class="modal__intro"><strong>How to read the screener:</strong> sort by <em>Quality</em> for a triage view, then open a REIT's row for the full detail drawer. ${IS_TOUCH ? 'Long-press' : 'Right-click'} any cell value to jump to the exact source filing. ${IS_TOUCH ? 'Tap' : 'Click'} a column header to filter and sort that column; active filters appear as removable pills above the table. Search and currency are in the top bar. Your filters, sorting and column choices are remembered in this browser.</p>
    <p class="modal__intro"><strong>Which metrics are most attractive?</strong> For institutional REIT investors, the most actionable indicators in this environment are: (1) <em>ICR</em> as the leading indicator of DPU sustainability under rising rates; (2) <em>Gearing including perpetuals</em> for true leverage; (3) <em>Distribution yield TTM</em> — but with a twist: the sweet spot is 5.5–7%, anything above 9% is usually distress, not opportunity; (4) <em>Property yield vs WACE spread</em> to see if leverage is value-additive or value-destroying. <em>Price-to-NAV</em> is overrated — appraisals lag spot 6–18 months.</p>
    ${Object.entries(sections).map(([title, keys]) => `
      <h2 class="help-section">${esc(title)}</h2>
      ${keys.map(render).join('')}
    `).join('')}
  `;
  openModal('Help — terminology & analysis', html);
}

const _docCache = {};
/** Load a project markdown doc and render it inline with consistent styling. */
async function openDocModal(title, lead, path, trigger) {
  openModal(title, `<p class="modal__lead">${esc(lead)}</p><div class="md-body" id="md-body"><p class="md-loading">Loading…</p></div>`, trigger);
  const target = $('#md-body');
  try {
    if (!_docCache[path]) {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _docCache[path] = await res.text();
    }
    // Guard against a stale modal (user may have navigated away while fetching)
    if (!$('#md-body')) return;
    $('#md-body').innerHTML = window.renderMarkdown(_docCache[path]);
  } catch (e) {
    if ($('#md-body')) {
      $('#md-body').innerHTML = `<p class="md-loading">Couldn't load ${esc(path)} (${esc(e.message)}). `
        + `It's also in the <a href="https://github.com/${esc(window.GITHUB_REPO || '')}/blob/main/${esc(path)}" target="_blank" rel="noopener">repository</a>.</p>`;
    }
  }
}

function openMethodologyModal(trigger) {
  openDocModal('Methodology', 'Full data dictionary, scoring thresholds, MAS regulatory references, and the "true profits" framing. For a quick per-metric breakdown, see the Help page.', 'docs/METHODOLOGY.md', trigger);
}

function openPlaybookModal(trigger) {
  openDocModal('Re-run Playbook', 'The complete, replicable procedure for refreshing this dataset — for operators and agents.', 'docs/PLAYBOOK.md', trigger);
}

function toggleHidden(ticker) {
  if (STATE.hiddenReits.has(ticker)) STATE.hiddenReits.delete(ticker);
  else STATE.hiddenReits.add(ticker);
  savePrefs(); render();
  // If the just-hidden REIT's drawer is open, close it (it's no longer in the table).
  if (!$('#drawer').hidden && STATE.hiddenReits.has(ticker)) closeDrawer();
}

// Hook the "hide this REIT" button inside the drawer
document.addEventListener('click', (e) => {
  const b = e.target.closest('#hide-reit-btn');
  if (b) toggleHidden(b.dataset.ticker);
  const m = e.target.closest('#open-meth-from-drawer');
  if (m) { e.preventDefault(); openMethodologyModal(); }
});

/* =====================  TOOLTIPS  ===================== */

function showTipFromEvent(e) {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  showTip(el);
}
/** Render the metric tooltip for `el`. If x/y are given (touch long-press) anchor near the
 *  touch point; otherwise anchor to the element's bounding box (hover/focus). */
function showTip(el, x = null, y = null) {
  const m = window.METRICS?.[el.dataset.tip];
  if (!m) return;
  const tip = $('#tooltip');
  tip.innerHTML = `<div class="tooltip__title">${esc(m.label)}${m.abbr && m.abbr !== m.label ? ` <small>(${esc(m.abbr)})</small>` : ''}</div>
    <div class="tooltip__what">${esc(m.what)}</div>
    ${m.why ? `<div class="tooltip__why"><strong>Why:</strong> ${esc(m.why)}</div>` : ''}
    ${m.healthy ? `<div class="tooltip__healthy"><strong>Healthy:</strong> ${esc(m.healthy)}</div>` : ''}
    <div class="tooltip__more">Open <em>Help</em> for the full definition · ${IS_TOUCH ? 'long-press' : 'right-click'} a cell for its source</div>`;
  tip.hidden = false;
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  let left, top;
  if (x != null && y != null) {
    left = x - tipW / 2;
    top = y + 14;
    if (top + tipH > window.innerHeight - 8) top = y - tipH - 14;
  } else {
    const r = el.getBoundingClientRect();
    left = r.left + r.width / 2 - tipW / 2;
    top = r.bottom + 8;
    if (top + tipH > window.innerHeight - 8) top = r.top - tipH - 8;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
  tip.style.left = left + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
function hideTipFromEvent(e) {
  const tip = $('#tooltip');
  if (!e.relatedTarget || !e.relatedTarget.closest?.('[data-tip]')) tip.hidden = true;
}

/* =====================  SPARKLINE & GEO  ===================== */

function sparkSVG(series, r) {
  if (!series || !series.length) return '<svg viewBox="0 0 100 40" aria-label="No price data"></svg>';
  const W = 600, H = 140, padX = 6, padY = 12;
  const closes = series.map(p => p.c).filter(v => v != null);
  if (!closes.length) return '<svg viewBox="0 0 100 40" aria-label="No price data"></svg>';
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  if (series.length === 1 || max === min) {
    const cy = H / 2;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Flat price series">
      <line x1="${padX}" x2="${W - padX}" y1="${cy}" y2="${cy}" class="spark__path" />
    </svg>`;
  }
  const x = (i) => padX + (i / (series.length - 1)) * (W - 2 * padX);
  const y = (v) => H - padY - ((v - min) / (max - min)) * (H - 2 * padY);
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ');
  const area = `${path} L${x(series.length - 1).toFixed(1)},${(H - padY).toFixed(1)} L${padX},${(H - padY).toFixed(1)} Z`;
  const baseY = y(series[0].c).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="1-year price chart">
    <line x1="${padX}" x2="${W - padX}" y1="${baseY}" y2="${baseY}" class="spark__base" />
    <path d="${area}" class="spark__area" />
    <path d="${path}" class="spark__path" />
    <text x="${W - padX - 2}" y="${(y(max) - 4).toFixed(1)}" text-anchor="end" class="spark__hi">${priceFmt(max, r.price)}</text>
    <text x="${W - padX - 2}" y="${(y(min) + 11).toFixed(1)}" text-anchor="end" class="spark__lo">${priceFmt(min, r.price)}</text>
  </svg>`;
}

function renderGeoSplit(split) {
  if (!split || typeof split !== 'object' || !Object.keys(split).length) return '';
  const entries = Object.entries(split).sort((a, b) => (typeof b[1] === 'number' ? b[1] : 0) - (typeof a[1] === 'number' ? a[1] : 0));
  const total = entries.reduce((acc, [, v]) => acc + (typeof v === 'number' ? v : 0), 0) || 1;
  const colors = ['#4FD3B8', '#7DA89F', '#B49BC8', '#D5A26B', '#A9C76B', '#6F9BC3', '#C77F7F', '#9590A8'];
  const bar = entries.map(([k, v], i) => {
    const pct = typeof v === 'number' ? (v / total) * 100 : 0;
    return `<div class="geo-seg" style="width:${pct.toFixed(2)}%; background:${colors[i % colors.length]}" title="${esc(k)}: ${typeof v === 'number' ? v.toFixed(1) + '%' : esc(String(v))}"></div>`;
  }).join('');
  const legend = entries.map(([k, v]) => `<span class="lk">${esc(k)}</span><span class="lv">${typeof v === 'number' ? v.toFixed(1) + '%' : esc(String(v))}</span>`).join('');
  return `
    <div class="d-section">Geographic split</div>
    <div class="geo-bar" role="img" aria-label="Geographic AUM split">${bar}</div>
    <div class="geo-legend">${legend}</div>
  `;
}

load();
