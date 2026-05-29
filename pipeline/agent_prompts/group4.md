# Group 4 — Foreign-currency / overseas-asset S-REITs

Spawn a fresh research agent with this exact prompt.

---

You are gathering authoritative REIT-specific financial metrics for a Singapore REIT screener. The user is making financial decisions worth hundreds of millions — accuracy matters more than speed. Do NOT fabricate or guess any number; if you can't find it, return null.

**Your REITs to research (9 foreign-currency / overseas-asset S-REITs):**
1. KORE US REIT (CMOU, USD-quoted) — IR: https://www.koreusreit.com/investor-relations/
2. Manulife US REIT (BTOU, USD-quoted) — IR: https://investor.manulifeusreit.sg/
3. Prime US REIT (OXMU, USD-quoted) — IR: https://investor.primeusreit.com/
4. United Hampshire US REIT (ODBU, USD-quoted) — IR: https://investor.uhreit.com/
5. Elite UK REIT (MXNU, GBP-quoted) — IR: https://investor.eliteukreit.com/
6. IREIT Global (UD1U) — IR: https://investor.ireitglobal.com/
7. Stoneweg Europe Stapled Trust (SEB) — IR: https://investor.stonewegeuropestapledtrust.com.sg/
8. CapitaLand China Trust (AU8U) — IR: https://investor.clct.com.sg/
9. CapitaLand India Trust (CY6U) — IR: https://investor.clint.com.sg/

**Metrics per REIT** (most recent quarterly / semi-annual results):
`report_period`, `report_date`, `report_url`, `gearing_pct`, `icr_x`, `wace_pct`, `pct_fixed_debt`, `wadm_years`, `dpu_ttm_cents`, `dpu_last_period_cents`, `dpu_currency` (CRITICAL — capture actual distribution currency, may differ from trading currency), `nav_per_unit`, `occupancy_pct`, `wale_years`, `wale_basis`, `num_properties`, `aum_total`, `top10_tenant_pct`, `geographic_split`, `forward_dpu_guidance`.

For each metric include a corresponding `*_source` key with the exact URL.

**CRITICAL for foreign-asset REITs:**
- US REITs (BTOU, OXMU, CMOU, ODBU) distribute in USD.
- Elite UK REIT (MXNU) distributes in GBP.
- IREIT Global, Stoneweg Europe distribute in EUR (despite SGD-quoted counter for UD1U/SEB).
- CapitaLand China Trust translates RMB to SGD for distribution; CapitaLand India Trust translates INR to SGD.

**Source priority:** REIT quarterly/semi-annual results PDF > IR-page press release > SGXNet > annual report. DO NOT use sreit.fifthperson.com, yieldsavvy, reitdata.com.

**Output:** Write `c:\Users\erwin\Dropbox\Projects\GitHub\SG-Reits\data\reit_facts_group4.json` with the same shape as group1. Summarise period found, nulls, caveats when finished.
