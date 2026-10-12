# FUTURE-064 — Gemini image canary accounting fix

Base verified: `origin/main` = `31eedb2359ab348a9dc9fa165ee218adc17db66b` (2026-10-12). Read the Canary, Slice C and Slice D evidence before implementation. This is a bounded bugfix; global Gemini image release remains OFF and canary access remains revoked.

## Accounting behavior

The old image recorder recorded unattributed candidate output only when the modality breakdown was absent. It dropped positive remainders when a partial breakdown existed. The recorder now subtracts **all valid reported candidate modality counts** from `candidatesTokenCount`, recording a positive remainder as `tokens` / `output_unattributed` with the existing `gemini_image:{attemptId}:output_unattributed_tokens` key.

`thoughtsTokenCount` remains separate. Mixed TEXT and IMAGE counts are subtracted once. The parser counts all candidate entries (including recognized modalities other than TEXT/IMAGE and numerical counts for unrecognized modalities), without copying unrecognized strings to ledger metadata. Only known IMAGE/TEXT modalities produce attributed rows. The numeric all-modality sum (including null overflow state) is preserved in ledger descriptors and the failed-ledger Attempt recovery snapshot; round-trip tests prove recovery cannot misclassify unknown-modality tokens as an unattributed remainder. Valid modality-only metadata remains usable when the candidate total is absent. Malformed counts are not measurements; missing totals, over-attributed totals and unsafe sums produce no invented remainder, negative row or clamped quantity. Safe reported modality sums remain as reported. Existing atomic upsert / unique idempotency key and Attempt replay contracts are preserved.

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

| Verification | Result |
|---|---|
| Typecheck (`tsc --noEmit -p tsconfig.typecheck.json`) | PASS on final code |
| Lint (`eslint .`) | PASS: 0 errors, 62 existing warnings; follow-up files also lint clean |
| Initial focused regressions | 6 files / 190 tests PASS |
| Final accounting/parser/pricing/reconciliation regressions | 6 files / 130 tests PASS |
| Workspace, partial/complete cost presentation, reconciliation | 3 files / 60 tests PASS |
| Other-provider regression | OpenAI, NanoBanana, route convergence and legacy cost matrix PASS |
| Full suite (`vitest run --pool=forks --maxWorkers=2`) | Completed: **312 files / 6020 tests PASS; 3 failures; 68 skipped** |
| Full-suite failures | Two `Estilo` vs `Estilos` baseline expectations, reproduced on detached `31eedb2`; unrelated video autosave conflict test intermittent under the suite, passes isolated on the final branch and in the baseline's full file (13 tests) |
| Local build | Default Turbopack blocked by the external node_modules junction; webpack compiled successfully, then failed on the documented pre-existing Next generated-type restriction for `ImagesPageShell` exported from `/imagens/page.tsx` (file unchanged) |
| Independent review | Both findings resolved; no remaining actionable findings. Reviewer independently passed 2 files / 33 tests |
| PR | [#187](https://github.com/fmultiman/content-studio-ai/pull/187), focused fix + regression/evidence only |

The first full-suite threads run hit the previously observed native runner crash (exit 139); the full forks rerun completed. Load-induced credential scan failures from the first run passed in isolation and in the completed full rerun. The unrelated video/label failures and local build restriction are disclosed; they are not claimed green. The pnpm wrapper tried a dependency refresh, which was refused without a TTY, so verification invoked the already installed script executables directly; dependencies/configuration were not changed.

Vercel and Vercel Preview Comments checks both passed for code head `55713d21ed0c35b460bd964c8047c367a1dff9c0`. The final documentation commit must also pass these checks before merge. Merged Production deployment and post-release evidence are recorded in the epic delivery artifact, after merge.

Pre-release read-only checks: Production deployment of `31eedb2` READY; `/api/settings/providers` reports `{ available: false, reason: "release_switch_off" }`; `vercel env ls production` lists neither Gemini image release nor canary variable. No Production variable was modified. CLI linking created an ephemeral local OIDC `.env.local`; it was removed without reading its contents. No provider credentials were retrieved or modified, no prices or Production SQL were changed, and zero real provider requests were made. The reconciliation script remains unexecuted.
