# Group 2 — Mid-cap SG / diversified S-REITs

Spawn a fresh research agent with this exact prompt.

---

You are gathering authoritative REIT-specific financial metrics for a Singapore REIT screener. The user is making financial decisions worth hundreds of millions — accuracy matters more than speed. Do NOT fabricate or guess any number; if you can't find it, return null.

**Your REITs to research (8 mid-cap S-REITs):**
1. Frasers Centrepoint Trust (J69U) — IR: https://fct.frasersproperty.com/
2. Frasers Logistics & Commercial Trust (BUOU) — IR: https://flct.frasersproperty.com/
3. Suntec REIT (T82U) — IR: https://suntecreit.listedcompany.com/
4. Parkway Life REIT (C2PU) — IR: https://www.plifereit.com/investor-relations.html
5. OUE REIT (TS0U) — IR: https://investor.ouereit.com/
6. Starhill Global REIT (P40U) — IR: https://www.starhillglobalreit.com/
7. Lendlease Global Commercial REIT (JYEU) — IR: https://www.lendleaseglobalcommercialreit.com/investor/
8. ESR REIT (9A4U) — IR: https://esr-reit.listedcompany.com/

**Metrics per REIT** (most recent quarterly / semi-annual results):
`report_period`, `report_date`, `report_url`, `gearing_pct`, `icr_x`, `wace_pct`, `pct_fixed_debt`, `wadm_years`, `dpu_ttm_cents`, `dpu_last_period_cents`, `dpu_currency`, `nav_per_unit`, `occupancy_pct`, `wale_years`, `wale_basis`, `num_properties`, `aum_total`, `top10_tenant_pct`, `geographic_split`, `forward_dpu_guidance`.

For each metric include a corresponding `*_source` key with the exact URL.

**Source priority:** REIT quarterly/semi-annual results PDF > IR-page press release > SGXNet > annual report. DO NOT use sreit.fifthperson.com, yieldsavvy, reitdata.com, wealthfor.us.

**Output:** Write `c:\Users\erwin\Dropbox\Projects\GitHub\SG-Reits\data\reit_facts_group2.json`:
```json
{
  "_meta": { "fetched_at": "<ISO timestamp>", "agent": "group2-mid-caps-sg", "notes": "..." },
  "reits": { "J69U": { ... }, "BUOU": { ... }, ... }
}
```

Use today's date as reference. Find the LATEST reporting period. Set null + note for any value you cannot verify against a primary source. When finished, briefly summarise the reporting period found, any nulls, and any caveats.
