# Group 5 — Small caps & new IPOs

Spawn a fresh research agent with this exact prompt.

---

You are gathering authoritative REIT-specific financial metrics for a Singapore REIT screener. The user is making financial decisions worth hundreds of millions — accuracy matters more than speed. Do NOT fabricate or guess any number; if you can't find it, return null.

**Your REITs to research (6 small caps + new IPO):**
1. UI Boustead REIT (UIBU) — IR: https://uibreit.com/ (IPO 12 Mar 2026 — limited post-IPO data; use IPO prospectus)
2. Alpha Integrated REIT (M1GU, fka Sabana Industrial REIT) — IR: https://investor.ai-reit.com/
3. Landmark REIT (D5IU, fka Lippo Malls Indonesia Retail Trust, renamed 27 Mar 2026) — IR: https://lmirt.listedcompany.com/
4. First REIT (AW9U) — IR: https://www.first-reit.com/investor-overview.html
5. BHG Retail REIT (BMGU) — IR: https://bhgreit.listedcompany.com/
6. Acrophyte Hospitality Trust (XZL, fka ARA US Hospitality Trust, USD-quoted) — IR: https://investor.acrophytetrust.com/

**Metrics per REIT** (most recent quarterly / semi-annual results):
`report_period`, `report_date`, `report_url`, `gearing_pct`, `icr_x`, `wace_pct`, `pct_fixed_debt`, `wadm_years`, `dpu_ttm_cents`, `dpu_last_period_cents`, `dpu_currency`, `nav_per_unit`, `occupancy_pct`, `wale_years`, `wale_basis`, `num_properties`, `aum_total`, `top10_tenant_pct`, `geographic_split`, `forward_dpu_guidance`.

For each metric include a corresponding `*_source` key.

**Special notes:**
- UI Boustead REIT: very recent IPO; use prospectus + post-IPO updates.
- Landmark REIT: just renamed Mar 2026, mandate expanded beyond Indonesia retail.
- Alpha Integrated REIT: renamed from Sabana; latest reporting under either name acceptable.

**Source priority:** REIT quarterly/semi-annual results PDF > IR-page press release > SGXNet > annual report > IPO prospectus. DO NOT use sreit.fifthperson.com, yieldsavvy, reitdata.com.

**Output:** Write `c:\Users\erwin\Dropbox\Projects\GitHub\SG-Reits\data\reit_facts_group5.json` with the same shape as group1. Summarise period found, nulls, caveats when finished.
