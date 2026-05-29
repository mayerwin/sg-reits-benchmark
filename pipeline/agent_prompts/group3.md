# Group 3 — Hospitality / Specialty / Industrial S-REITs

Spawn a fresh research agent with this exact prompt.

---

You are gathering authoritative REIT-specific financial metrics for a Singapore REIT screener. The user is making financial decisions worth hundreds of millions — accuracy matters more than speed. Do NOT fabricate or guess any number; if you can't find it, return null.

**Your REITs to research (8 specialty / hospitality / industrial S-REITs):**
1. AIMS APAC REIT (O5RU) — IR: https://investor.aimsapacreit.com/
2. CDL Hospitality Trusts (J85) — IR: https://investor.cdlht.com/
3. Far East Hospitality Trust (Q5T) — IR: https://feht.listedcompany.com/
4. Sasseur REIT (CRPU) — IR: https://investor.sasseurreit.com/
5. Centurion Accommodation REIT (8C8U) — IR: https://investor.careit.com.sg/  (IPO 25 Sep 2025)
6. NTT DC REIT (NTDU, USD-quoted) — IR: https://www.nttdcreit.com/investor-relations/ (IPO 14 Jul 2025)
7. Digital Core REIT (DCRU, USD-quoted) — IR: https://www.digitalcorereit.com/investor-relations/
8. Daiwa House Logistics Trust (DHLU) — IR: https://www.daiwahouse-logisticstrust.com/

**Metrics per REIT** (most recent quarterly / semi-annual results):
`report_period`, `report_date`, `report_url`, `gearing_pct`, `icr_x`, `wace_pct`, `pct_fixed_debt`, `wadm_years`, `dpu_ttm_cents`, `dpu_last_period_cents`, `dpu_currency`, `nav_per_unit`, `occupancy_pct`, `wale_years`, `wale_basis`, `num_properties`, `aum_total`, `top10_tenant_pct`, `geographic_split`, `forward_dpu_guidance`.

For each metric include a corresponding `*_source` key with the exact URL.

**Special notes:**
- Hospitality REITs: occupancy = average hotel occupancy; if WALE not applicable (hotels), set null with note.
- PBSA/PBWA REITs (Centurion Accommodation): occupancy refers to bed-occupancy.

**Source priority:** REIT quarterly/semi-annual results PDF > IR-page press release > SGXNet > annual report. For new IPOs (NTT DC, Centurion Accom): IPO prospectus + first-period results. DO NOT use sreit.fifthperson.com, yieldsavvy, reitdata.com.

**Output:** Write `c:\Users\erwin\Dropbox\Projects\GitHub\SG-Reits\data\reit_facts_group3.json` with the same shape as group1. Summarise period found, nulls, caveats when finished.
