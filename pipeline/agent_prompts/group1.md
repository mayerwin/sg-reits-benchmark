# Group 1 — Large-cap S-REITs

Spawn a fresh research agent with this exact prompt.

---

You are gathering authoritative REIT-specific financial metrics for a Singapore REIT screener. The user is making financial decisions worth hundreds of millions — accuracy matters more than speed. Do NOT fabricate or guess any number; if you can't find it, return null.

**Your REITs to research (8 large-cap S-REITs):**
1. CapitaLand Integrated Commercial Trust (C38U) — IR: https://investor.cict.com.sg/
2. CapitaLand Ascendas REIT (A17U) — IR: https://investor.capitaland-ascendasreit.com/
3. CapitaLand Ascott Trust (HMN) — IR: https://investor.capitalandascotttrust.com/
4. Mapletree Logistics Trust (M44U) — IR: https://investor.mapletreelogisticstrust.com/
5. Mapletree Industrial Trust (ME8U) — IR: https://investor.mapletreeindustrialtrust.com/
6. Mapletree Pan Asia Commercial Trust (N2IU) — IR: https://investor.mapletreepact.com/
7. Keppel REIT (K71U) — IR: https://www.keppelreit.com/en/investor-relations/
8. Keppel DC REIT (AJBU) — IR: https://www.keppeldcreit.com/en/investor-relations/

**Metrics per REIT** (most recent quarterly / semi-annual results):
`report_period`, `report_date`, `report_url`, `gearing_pct`, `icr_x`, `wace_pct`, `pct_fixed_debt`, `wadm_years`, `dpu_ttm_cents`, `dpu_last_period_cents`, `dpu_currency`, `nav_per_unit`, `occupancy_pct`, `wale_years`, `wale_basis`, `num_properties`, `aum_total`, `top10_tenant_pct`, `geographic_split`, `forward_dpu_guidance`.

For each metric include a corresponding `*_source` key with the exact URL.

**Source priority:** REIT quarterly/semi-annual results PDF > IR-page press release > SGXNet > annual report. DO NOT use sreit.fifthperson.com, yieldsavvy, reitdata.com, wealthfor.us.

**Output:** Write `c:\Users\erwin\Dropbox\Projects\GitHub\SG-Reits\data\reit_facts_group1.json`:
```json
{
  "_meta": { "fetched_at": "<ISO timestamp>", "agent": "group1-large-caps", "notes": "..." },
  "reits": {
    "C38U": { ...all fields above + *_source URLs... },
    "A17U": { ... },
    ...
  }
}
```

Use today's date as reference. Find the LATEST reporting period. Set null + note for any value you cannot verify against a primary source. When finished, briefly summarise (a) the reporting period found for each REIT, (b) any nulls and why, (c) which REITs needed secondary-source corroboration.
