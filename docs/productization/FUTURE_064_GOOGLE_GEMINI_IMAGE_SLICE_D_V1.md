# FUTURE-064 Slice D — Image-output pricing: cost-derivation implementation

Status: **code implemented and deployable against today's Production registry. The reviewed SQL (`docs/productization/sql/FUTURE_064_SLICE_D_image_output_pricing.{up,down}.sql`) is NOT applied, no price was seeded in Production, the Gemini image switch is OFF, no Vercel setting, credential or paid call was touched.**
Canonical design: `FUTURE_064_GOOGLE_GEMINI_IMAGE_SLICE_D_DESIGN_V1.md` (merged `6a1f638`). Approved decisions: D1 tier fallback as specified below, D2 `effective_from = 2026-10-12` (Production application time is recorded separately in execution evidence and prices are re-checked against the live Google page before applying), D3 aggregate-level partial label only, `output_unattributed` stays UNPRICED.

## What changed

| File | Change |
|---|---|
| `lib/usage/pricing/registry.ts` | `PRICING_CATEGORIES` gains `image_output`; the loader now keeps those rows (before, an unknown category was dropped). |
| `lib/usage/pricing/derive.ts` | `planGemini`: `tokens` + `usage_category: image_output` → one `image_output` line; `tokens` + `output_unattributed` → `unavailable('output_modality_unattributed')`. Tier selection gains the sole-Standard-tier fallback (below). New reason `output_modality_unattributed`, new assumption `service_tier_sole_registry_tier`. Nothing else in the file changed. |
| `lib/usage/pricing/aggregate.ts` | `EstimatedCostSummary.complete`. |
| `lib/usage/pricing/presentation.ts` | `PARTIAL_ESTIMATED_COST_LABEL = 'Custo estimado parcial'`; pt-BR texts for the new reason and assumption. |
| `components/settings/usage-history.tsx` | The aggregate headline reads "Custo estimado parcial (preço de tabela)" when the total omits unpriced rows. Detailed rows untouched; no per-execution regrouping. |
| tests | See below. |

No SQL, no migration, no seed, no `app/api` change (the usage route already derives on read and whitelists `image_output` / `output_unattributed` from Slice C).

## Image pricing derivation

Per ledger row (each row is a provider-native billable dimension, so nothing is double counted; `totalTokenCount` is never a row and is never priced):

| Ledger row | Billable line used | Notes |
|---|---|---|
| `input_tokens` | `input` (+ `cached_input` split if cached tokens are reported) | no cached price exists for these models → that row is `unavailable`, never guessed |
| `output_tokens` (TEXT modality) | `output` | "text and thinking" rate |
| `tokens` + `thoughts` | `output` | priced once, same rate |
| `tokens` + `image_output` | **`image_output` only** | never the `output` price; with no `image_output` version the row is `no_pricing_for_category`, not a text price |
| `tokens` + `output_unattributed` | none | `output_modality_unattributed` — never assumed to be image or text, never $0 |

Lookups use the **canonical provider model id** stored in the row (`gemini-nano-banana-2.1`, `gemini-3.1-flash-lite-image`); the internal alias, a neighbouring model or an unapproved Google model has no price (`no_pricing_for_model`). Price versions are resolved at the execution's `occurred_at` (half-open windows; before the first version → `pricing_not_effective_at_execution`; a later version never reprices earlier executions; overlap → ambiguous). Currency and unit come from the version. With the reviewed rows: 1,120 IMAGE tokens = **USD 0.0336** on both models; input 14 tokens = 0.000021 (2.1) / 0.0000035 (Lite); a fully classified 1K execution totals 0.033621 (2.1).

## Tier fallback (D1)

1. A **provider-reported** tier always takes precedence — including a non-Standard one, which receives *no* Standard price (no Flex/Priority version exists for these models → `no_pricing_for_category`).
2. A reported but unrecognized tier is never replaced (stays `ambiguous: service_tier_not_proven`).
3. Only when the response reported **no** tier **and** the row is a Gemini `image_generation` row **and** the registry prices **exactly one tier for that model and it is `standard`**, Standard is used, and the estimate carries the assumption `service_tier_sole_registry_tier` ("o provedor não informou o nível de serviço; foi usado o nível padrão porque é o único com preço cadastrado para este modelo").
4. If a second tier is ever added for the model, or the sole tier is not Standard, the fallback switches itself off (`ambiguous`). It never applies to other operations on the same model, to other providers, or against an empty registry.

## Partial-cost UI (D3)

`summarizeEstimatedCost` returns `complete = totalEvents > 0 && unpricedEvents === 0`. The Usage screen's aggregate headline shows **"Custo estimado parcial (preço de tabela)"** when a known sum exists but one or more rows (unavailable, ambiguous, unknown usage, or an older payload without a cost) are not in it; the existing "N registros sem preço disponível — não entram no total e não valem zero" line and every detailed row ("Custo estimado: …" / "Preço indisponível" + reason) are unchanged. When everything is priced the normal "Custo estimado" label is kept; when nothing is priced there is no total and no "parcial" claim. A measured zero amount is a known priced row (complete); an absent quantity or unknown price is never zero and never completes a total. The label follows the active filters (it is computed from the visible rows).

## Old / new registry compatibility

- **Today's Production registry** (old constraint, 22 rows, no image row): the code deploys safely. Every Gemini image row derives to `unavailable: no_pricing_for_model` (HTTP 200, no failure, no amount); the aggregate has no total. Tested at the pricing, aggregate and `GET /api/settings/usage` levels.
- **Registry after the reviewed SQL** (28 rows, produced in isolated PGlite from the real 061 + 062 + the reviewed up SQL): input / text / thinking / IMAGE price as above.
- **Code-before-SQL and SQL-before-code are both safe**; with only the input/output rows present, IMAGE stays unpriced (never text-priced).

## Tests and local SQL evidence

- `image-output-pricing-derive.test.ts` (PRODUCTION code over PGlite-produced registries; real Slice C events → ledger rows → cost input): Nano Banana 2.1 and Lite Standard rates, the `image_output` dimension, text / thinking / input separately, `totalTokenCount` never priced, canonical model ids, `output_unattributed` unpriced, missing/partial/unknown usage, measured zero vs unknown, provider-reported tier honored (flex/priority never get Standard), unknown reported tier, no-tier Standard assumption, second tier disables the fallback, fallback limited to image-generation rows and to a Standard sole tier, effective dates and price-version resolution, overlap ambiguity, aggregate complete/partial rules, Production-registry compatibility, no network.
- `image-output-pricing-api.test.ts`: `GET /api/settings/usage` end to end over both registries (derived on read, nothing written, no leakage of response ids / keys).
- `image-output-pricing-migration.test.ts` (52-test design proof, kept): the real SQL against a Production-shaped PGlite — clean apply, re-run no-op, rollback restores the exact original digest, old categories/prices preserved, `image_output` accepted and any other category rejected, exact six prices, access model unchanged, nine drift scenarios abort, a late failure rolls the widened constraint back.
- `legacy-cost-regression.test.ts` + `fixtures/legacy-cost-golden.json`: 1,806 OpenAI / Gemini text-Review-prompt-assistance / Kling / unknown rows priced by the deriver **as it was before this change** (generated once from main `6a1f638`); the new code reproduces every entry over today's registry **and** over the post-SQL registry.
- `usage-cost.test.tsx` (+5): complete / partial / unknown / nothing-priced / filter-dependent headline.
- Updated deliberately: `pricing.test.ts` (aggregate now carries `complete`), `gemini-image-usage.test.ts` (the Slice C boundary now resolves to the real Slice D outcomes), `gemini-image-boundary.test.ts` (pricing code may name the `image_output` dimension, never a model id or a rate).
- Mutation checks (IMAGE priced on the `output` line; second-tier guard removed; `complete` forced true) fail 24 tests.
- The Gemini image route / UI / release-switch behavior is unchanged (their suites pass); nothing in this slice calls a provider.

## Production state after this slice

Application code only. `provider_pricing_versions` is unchanged (22 rows, original 4-category constraint, no image price); no SQL applied; switch OFF. Gemini image executions (none exist) would show "Preço indisponível" until the SQL is applied.

## Exact next operational step

Owner/operator, in this order (nothing below has been done):
1. Re-check the six Standard figures on <https://ai.google.dev/gemini-api/docs/pricing> (2.1: 1.50 / 7.50 / 30.00; Lite: 0.25 / 1.50 / 30.00 per 1M; no Flex/Priority/cache for these models). If anything differs: stop and revise the SQL.
2. Record the pre-state: `SELECT count(*), md5(string_agg(t::text,'|' ORDER BY id)) FROM provider_pricing_versions t;` (expected `22`, `6b65ae838be0bfd1046bfcd7f064b1f1`) and the application timestamp (kept separately from the `effective_from` of 2026-10-12).
3. Apply `FUTURE_064_SLICE_D_image_output_pricing.up.sql` as the table owner in one run; verify 28 rows, the widened constraint and the six rows; keep the rollback file ready.
4. Record the application as execution evidence (docs PR).
5. Only then plan the FUTURE-064 release gate (authorized single-image smoke, then — with explicit approval — the switch).
