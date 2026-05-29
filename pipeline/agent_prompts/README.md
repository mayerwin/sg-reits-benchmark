# Agent prompts for refreshing REIT-disclosed metrics

Each file in this folder is the **exact prompt** to paste into a fresh research/general-purpose agent invocation to refresh one of the five REIT groups. The groups are sized so each agent handles ~6–9 REITs, which keeps each run under the agent's tool budget.

## Process

1. Spawn 5 agents **in parallel**, one per group.
2. Each writes its output to `data/reit_facts_group{N}.json`.
3. After all 5 complete, run `node pipeline/merge.mjs` to produce the final merged dataset.

## Group composition (39 REITs total, May 2026)

| Group | Theme | Count | REITs |
|---|---|---|---|
| 1 | Large caps | 8 | C38U, A17U, HMN, M44U, ME8U, N2IU, K71U, AJBU |
| 2 | Mid-cap SG / diversified | 8 | J69U, BUOU, T82U, C2PU, TS0U, P40U, JYEU, 9A4U |
| 3 | Hospitality / specialty / industrial | 8 | O5RU, J85, Q5T, CRPU, 8C8U, NTDU, DCRU, DHLU |
| 4 | Foreign-currency / overseas assets | 9 | CMOU, BTOU, OXMU, ODBU, MXNU, UD1U, SEB, AU8U, CY6U |
| 5 | Small caps & new IPOs | 6 | UIBU, M1GU, D5IU, AW9U, BMGU, XZL |

## Re-grouping rules

If new REITs IPO or existing ones are delisted, **rebalance groups** rather than letting any single agent exceed ~10 REITs (otherwise its tool budget runs out before it finishes). Update `pipeline/merge.mjs::FACT_GROUP_FILES` if you add a group file.

## Updating prompts

The prompts hard-code each REIT's IR URL — keep those in sync with `data/reits_master.json`. When a REIT renames or relocates its IR site, update both.
