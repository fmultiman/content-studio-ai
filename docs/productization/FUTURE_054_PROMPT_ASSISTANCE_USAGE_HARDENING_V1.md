# FUTURE-054 — Prompt Assistance usage accounting and pricing hardening V1

Status: code merged (see Delivery evidence); **pricing seed `062` authored but not applied to Production** (operator step); no live paid verification of the new fields (none was authorized). Follows FUTURE-053 Slice 1 (`FUTURE_053_PROMPT_ASSISTANCE_IMAGE_V1.md`). Video Slice 2 is out of scope.

## Phase A — accounting audit (read-only)

**Write sites of `provider_usage_events`** (every one, from `grep` over `app/`, `lib/`, `components/`): `lib/usage/provider-usage-recorder.ts` (the generic recorder and the video-generation event), `lib/usage/gemini-review-usage.ts` (Gemini Review), `lib/usage/historical-proofs.ts` (admin-only importer), and `lib/prompt-assistance/usage.ts` (Prompt Assistance). `app/api/settings/usage/route.ts` only reads. Prompt Assistance has exactly one write site, reached only from `POST /api/prompt-assistance` after the provider returned.

**Execution path.** route → auth + ownership → `resolveProviderExecution` → `executePromptProvider` (OpenAI `fetch` / Gemini `generateContent`) → `recordPromptAssistanceUsage` → ledger. Usage is also recorded on a typed error when the provider reported usage on a received-but-rejected response.

### Why 4 provider requests produced 8 rows — verdict: legitimate, documented event model; not duplicated accounting

Evidence from the FUTURE-053 Production smoke (read-only SQL on the ledger):

| Request | Provider request id (`provider_task_id`) | Rows | Units | Idempotency keys | `occurred_at` (UTC) |
| --- | --- | --- | --- | --- | --- |
| A OpenAI create | `chatcmpl-EXH2Rs…` | 2 | `input_tokens` 265, `output_tokens` 74 | `…:input`, `…:output` | 02:23:47.826 / .901 |
| B OpenAI improve | `chatcmpl-EXH2wU…` | 2 | 285 / 26 | `…:input`, `…:output` | 02:24:19.321 / .401 |
| C Gemini create | `CKLJarfyNq2d…` | 2 | 273 / 79 | `…:input`, `…:output` | 02:25:14.068 / .126 |
| D Gemini improve | `F6LJasnmDYWt…` | 2 | 296 / 56 | `…:input`, `…:output` | 02:25:27.942 / .999 |

Each pair shares one provider request id, operation, model, metadata and owner, and differs in **unit** (`input_tokens` vs `output_tokens`), quantity and key suffix. They are two different **billable dimensions of one execution**, which is exactly the convention of the existing Gemini Review integration (`gemini-review-usage.ts`: "provider-native categories stay separate rows … never added into one fake total") and of the ledger's own principle ("one provider charge = one event" per measured quantity). The ~75 ms gap between the two rows was sequential, non-atomic inserts (see Phase D); it is not a lifecycle event pair. No row is a started/completed pair, retry or replay.

**Usage UI.** `summarizeUsage` groups by `(provider, transport, unit, usage_category, measurement source)`; a group's "N execuções" counts rows of that unit, so one execution contributes exactly one row to each group. The four smoke executions summarize to OpenAI 550 in / 100 out and Gemini 569 in / 135 out, each "2 execuções", which matches the ledger — no double count (asserted by `usage.test.ts`). The cost summary lists one estimate per row and never adds unknowns.

### Event-cardinality contract (final)

One provider execution = one logical set of rows sharing one provider request id:

| Row | Unit | When written | Key |
| --- | --- | --- | --- |
| input | `input_tokens` | provider reported prompt tokens | `prompt_assistance:{id}:input` |
| output | `output_tokens` | provider reported output tokens | `prompt_assistance:{id}:output` |
| thinking | `tokens` + `usage_category: thoughts` | Gemini reported `thoughtsTokenCount` **> 0** | `prompt_assistance:{id}:thoughts` |
| unknown | null | no usable usage at all | `prompt_assistance:{id}:unknown` |

A usual request is therefore 2 rows (3 for a Gemini call that thought). The provider total is never a row. Keys for existing rows are unchanged, so a replay of an already-recorded execution is still a no-op.

## Phase B — usage completeness

Semantics (Gemini `UsageMetadata`, as documented in `lib/providers/gemini/usage.ts` and already relied on by Review): `promptTokenCount` includes cached content; `candidatesTokenCount` **excludes** thoughts; `thoughtsTokenCount` is separate; `totalTokenCount` = prompt + tool-use + thoughts + candidates. Therefore thinking tokens are **not** contained in output tokens and are recorded as their own row; the total is never summed or stored as a row, so no category is counted twice (a test asserts the rows partition the provider total exactly). A reported 0 or an absent field adds no row — absent stays unknown. OpenAI `completion_tokens` already contains any reasoning tokens, so no thinking row is ever written for OpenAI; `prompt_tokens` includes the cached subset.

**Service tier.** Captured only as the provider reported it, in `provider_metadata.usage.serviceTier`: Gemini `usageMetadata.serviceTier` (restricted by the existing extractor to `standard|flex|priority`) and OpenAI's response `service_tier` (kept only when a plain lowercase token). Nothing is inferred from the key, billing status, model name or apparent access; an absent tier is left absent. Also stored when reported: cached subset (`cachedContentTokenCount`, same key for both providers because the existing cost derivation reads it), tool-use prompt tokens, and the provider total as a descriptor. The truthful `funding` (`user_byok`, from `executionMode`) and `api` are now recorded like Review rows, which enables the existing "chave própria" explanation in Settings.

**Schema.** All of this fits existing columns (`unit`, `provider_metadata`, `idempotency_key`). **No ledger migration is required.**

**Not verifiable without a paid call.** Whether OpenAI Chat Completions and Gemini actually return `service_tier` / `serviceTier` / `thoughtsTokenCount` for these requests was not measured: the FUTURE-053 smoke did not persist raw usage objects and no paid call is authorized here. The code records them if present and degrades to "ambiguous"/"unavailable" if absent.

## Phase C — pricing

`provider_pricing_versions` (migration 061) is public reference data, read-only at runtime; "the only write path is a reviewed migration". Lookup is by exact `(provider, model, usage_category, service_tier)` over half-open `[effective_from, effective_to)` windows; overlaps are rejected at write time and ambiguous at read time.

- **Gemini:** existing seeded entries (retrieved 2026-10-09; `https://ai.google.dev/gemini-api/docs/pricing`; basis `observed_at_source`) are used unchanged. `gemini-3.5-flash-lite` Standard: input $0.30, output $2.50 per 1M tokens (thinking priced once, as output). A tier is matched only when the event proves it.
- **OpenAI `gpt-4o-mini`:** verified on 2026-10-10 against OpenAI's official pricing page `https://developers.openai.com/api/docs/pricing` ("Standard pricing data"; same figures on the model page): input **$0.15**, cached input **$0.075**, output **$0.60** per 1M text tokens (Batch is $0.075 / $0.30 and is not used). New migration `scripts/062_seed_openai_gpt_4o_mini_pricing.sql` is **data-only** (three INSERTs, `ON CONFLICT DO NOTHING`, re-runnable, rollback `DELETE` documented). `effective_from = 2026-10-10T00:00:00Z`, basis `observed_at_source` — the page publishes no effective date or price history, so the price is not back-dated and earlier executions stay unpriced (same convention as the 061 seed). Flex/Priority/Batch tiers and every other OpenAI model (including `gpt-3.5-turbo`) are deliberately not seeded.
- **Derivation.** The existing deriver had no OpenAI billing adapter ("OpenAI … write no ledger rows" was no longer true). A small `planOpenAi` adapter was added in the same style as `planGemini`: input (with the cached subset split out, never added on top), output; the tier is `standard` only when the response reported `default`; any other reported tier has no price (unavailable); an absent tier is `ambiguous` (`service_tier_not_proven`). Unknown models, pre-effective-date executions, unknown usage and inconsistent cached counts yield no amount. The result remains an estimated list-price equivalent, never an invoice.

**Resulting cost semantics.** Historical rows (including the 8 smoke rows) carry no tier, so they stay unpriced (OpenAI: ambiguous; Gemini: ambiguous) — no historical cost is invented and nothing is backfilled. New rows are priced only when the provider's own response proves the tier **and** (for OpenAI) migration 062 is applied.

## Phase D — corrections made

1. Thinking tokens, cached subset, tool-use tokens, total and the provider-reported tier are now preserved from provider to ledger (`PromptAssistanceUsage`, `providers.ts`, `usage.ts`).
2. The rows of an execution are written with **one** batched statement (`recordProviderUsageEvents`, all-or-none) instead of sequential inserts, with one retry of the ledger write; failures are logged by class only, never thrown, and can never re-call the provider. Previously a failure between the two inserts could leave an execution with only its input row.
3. `funding` / `api` metadata added (Review parity); `media_type` and `operation` kept.
4. OpenAI billing adapter + migration 062 (above). One existing test that asserted "OpenAI is unsupported" encoded the pre-FUTURE-054 state and now uses Nano Banana as the unsupported example.
5. Error-path recording is unchanged in policy and now also carries thinking tokens and the tier.

Not changed: image/video generation, Prompt Assistance UX, the HTTP response shape, the idempotency keys of existing rows, the worker, historical rows.

## Phase E — validation (all providers mocked; no paid call)

New/extended coverage: `lib/prompt-assistance/__tests__/usage.test.ts` (cardinality, no total row, thoughts separate/absent/zero, unknown event, measured zero, tier/cached only when reported, metadata hygiene, one-statement write, replay no-op, distinct executions, failure swallow/retry, UI summary of the 4 smoke executions), `providers.test.ts` (Gemini thinking/cached/tool-use/tier, no invention, rejected response keeps thinking tokens; OpenAI cached subset and tier, malformed tier ignored), `lib/__tests__/prompt-assistance-route.test.ts` (Gemini thinking row + tier + funding + unchanged response keys, replay no duplicate, unusable paid response, no fabricated usage; existing image-assistance regressions retained), `lib/usage/pricing/__tests__/prompt-assistance-pricing.test.ts` (migration 062 on the real 061/044 schema in PGlite: data-only, exact prices/provenance/not back-dated, idempotent; OpenAI and Gemini cost derivation: known/unknown tier, cached split, unsupported model, pre-effective date, tool-use ambiguity, already-recorded smoke rows stay unpriced).

| Check | Result |
| --- | --- |
| Focused (usage, prompt-assistance, route, credential boundary, ledger, Gemini provider, Prompt Assistance UI) | **272 passed / 16 files** |
| Full suite | 5065 tests / 276 files: **5056 passed, 9 failed** — 7 are 5 s timeouts of repo-scanning/UI tests under full-suite load (create-video-generation-dialog ×3, supabase-admin-credential ×4) that pass in isolation (80/80 with a raised timeout); 2 are the pre-existing `Estilo`/`Estilos` label mismatches reproduced on clean `ec7afea` (FUTURE-053 doc) |
| Typecheck | 0 errors |
| ESLint on changed areas | 0 errors, 0 warnings |
| Build | Local `next build --webpack` compiles; it then trips the page-export type check on `ImagesPageShell`, which reproduces on clean `ec7afea` (environment/mode artefact). The Vercel build of the PR is the authoritative build gate |

## Migration verdict

- **Ledger / metering: none required.** Existing columns suffice.
- **Pricing: one data-only reviewed migration, `062`, authored in the repo. It has NOT been applied to Production.** Until an operator applies it, new OpenAI executions record the correct usage and descriptors but remain "Preço indisponível" (`no_pricing_for_model`). Apply (idempotent): run `scripts/062_seed_openai_gpt_4o_mini_pricing.sql` in the Supabase SQL editor; verify with `select usage_category, price_amount from provider_pricing_versions where provider='openai';` (3 rows: 0.075, 0.15, 0.6). Rollback is the `DELETE` in the file header.

## Remaining limitations

- Live behaviour of the new fields (does each provider return a tier / thinking tokens for these requests) is unproven until a future authorized call; cost may therefore stay "ambiguous" for OpenAI if `service_tier` is not returned. We deliberately do not send a `service_tier` request parameter (it would change the provider request shape without a live check).
- `gpt-3.5-turbo` (still selectable in Prompt Assistance) and every other OpenAI model remain unpriced; only `gpt-4o-mini` was verified and added.
- Estimates are list-price equivalents (BYOK invoices may differ); Gemini free tier is not distinguishable.
- The 8 historical smoke rows are unchanged and stay unpriced.

## Delivery evidence

Filled at merge time (see below).
