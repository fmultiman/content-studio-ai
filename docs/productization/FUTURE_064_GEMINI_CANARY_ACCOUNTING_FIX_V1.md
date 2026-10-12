# FUTURE-064 — Gemini image canary accounting fix

Base verified: `origin/main` = `31eedb2359ab348a9dc9fa165ee218adc17db66b` (2026-10-12). Read the Canary, Slice C and Slice D evidence before implementation. This is a bounded bugfix; global Gemini image release remains OFF and canary access remains revoked.

## Accounting behavior

The old image recorder recorded unattributed candidate output only when the modality breakdown was absent. It dropped positive remainders when a partial breakdown existed. The recorder now subtracts **all valid reported candidate modality counts** from `candidatesTokenCount`, recording a positive remainder as `tokens` / `output_unattributed` with the existing `gemini_image:{attemptId}:output_unattributed_tokens` key.

`thoughtsTokenCount` remains separate. Mixed TEXT and IMAGE counts are subtracted once. The parser counts all candidate entries (including recognized modalities other than TEXT/IMAGE and numerical counts for unrecognized modalities), without copying unrecognized strings to ledger metadata. Only known IMAGE/TEXT modalities produce attributed rows. Valid modality-only metadata remains usable when the candidate total is absent. Malformed counts are not measurements; missing totals, over-attributed totals and unsafe sums produce no invented remainder, negative row or clamped quantity. Reported modality rows remain as reported. Existing atomic upsert / unique idempotency key and Attempt replay contracts are preserved.

No pricing or aggregate implementation change is needed: `output_unattributed` already returns `unavailable` / `output_modality_unattributed`, without amount, and the existing aggregate marks any unpriced row incomplete.

| Exact canary component | Tokens | Known estimate (USD) |
|---|---:|---:|
| input | 29 | 0.0000435 |
| image_output | 1120 | 0.0336 |
| thoughts | 868 | 0.00651 |
| output_unattributed | 315 | unavailable; no rate or cost |
| Known subtotal | | **0.0401535** |

Aggregate: `complete = false`, 3 priced events / 1 unpriced event. Presentation: **Custo estimado parcial**. The shared `/imagens` Google notice now describes paid BYOK generation and known price components, with partial/unavailable estimates under Uso.

## Historical Production dry run

Target: Supabase `nuhdhnasuohizxtmyiju`, Attempt **`56ba444f-0280-4675-aa2a-ec90267e8eb8`**. Only read-only SELECTs executed. No provider request or credential read.

Stored Attempt: succeeded; `usage_accounting` records 3 rows, `output_attribution = by_modality_incomplete`. Stored ledger: input 29, IMAGE 1120, thoughts 868. All three rows carry the same usage snapshot: candidates 1435, IMAGE 1120, thoughts 868, total 2332, service tier standard. Prompt count is proven by the input ledger row (the stored descriptors do not include `promptTokenCount`).

Executed [read-only dry-run SQL](sql/FUTURE_064_CANARY_accounting_dry_run.sql):

| Finding | Result |
|---|---|
| metadata_sufficient | **true** |
| distinct_usage_snapshots | 1 |
| candidate_tokens / attributed_tokens | 1435 / 1120 |
| proposed remainder / unit / category | **315 / tokens / output_unattributed** |
| existing_remainder_rows | **0** |
| proposed idempotency key | `gemini_image:56ba444f-0280-4675-aa2a-ec90267e8eb8:output_unattributed_tokens` |
| original execution timestamp to preserve | `2026-10-12T07:55:50.234847Z` |

**Stored evidence is sufficient to restore the missing row. It has NOT been restored.** The historical ledger still has only three rows and therefore continues to show a misleading complete subtotal until separately authorized reconciliation is executed. Application deployment does not automatically rewrite history.

[Prepared reconciliation SQL](sql/FUTURE_064_CANARY_accounting_reconcile.sql) is an operator script, not a migration or runtime path. It locks and validates the exact Attempt/source row, verifies usable consistent stored metadata, calculates the positive remainder from those facts, appends at most one event, preserves `occurred_at`, and uses `ON CONFLICT (idempotency_key) DO NOTHING`. It rejects a conflicting existing event. It changes no price or original ledger row. It intentionally leaves the Attempt's original accounting mark as execution history (3 recorded rows); the current ledger is authoritative for cost coverage. No broad backfill. **Separate owner authorization is required before executing this script in Production.**

## Validation and release

Exact fixture regression covers the 315-token remainder, complete/partial IMAGE, mixed TEXT+IMAGE, other modalities, no breakdown/total, malformed/inconsistent metadata and safe-integer overflow. Route regression preserves all four canary rows on success, failed storage and unusable responses, and proves duplicate recorder / request replay writes no additional rows or provider call. Pricing tests exercise the existing real reviewed registry; reconciliation tests use isolated PGlite with the real ledger schema and verify dry-run nonmutation, one-row scope, timestamp preservation, repeat no-op, conflicts and missing metadata.

Typecheck, lint, focused tests, full suite, build, independent review, PR checks and merged Production READY verification: pending at time of this draft; completion evidence will be recorded below. Zero real provider requests. No credentials, Vercel variables, Production SQL or prices modified.
