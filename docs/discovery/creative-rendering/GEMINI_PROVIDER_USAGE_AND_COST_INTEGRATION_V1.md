# GEMINI_PROVIDER_USAGE_AND_COST_INTEGRATION_V1

## Status

- Mission: FUTURE-043. Baseline: `origin/main` `cc980eae8a78d7920c8756642552f813c92833c2`.
- Branch: `feat/gemini-provider-usage-cost-v1`.
- Schema: **no migration**. Paid provider calls: **0** (tests use deterministic fixtures; Preview/Production smoke are read-only).
- Result: every real Gemini `generateContent` execution of an Image or Video Review now writes truthful `provider_usage_events` rows, shown in Settings → Uso e custos through the existing API/screen/filters. **Monetary cost is intentionally not computed** (see Cost).

## Phase 0 — existing ledger architecture (as found)

| # | Item | Finding |
|---|---|---|
| 1 | `provider_usage_events` (migration 044) | Append-only. One row = one `quantity`+`unit` (both NULL when unknown) + `measurement_source` + free `provider_metadata jsonb`. `unit` CHECK: `credits, units, tokens, input_tokens, output_tokens, images, seconds, requests, characters`. `idempotency_key` is **globally UNIQUE**. Indexes: `(user_id, occurred_at desc)`, `(resource_type, resource_id)`. RLS: owner SELECT; service role has INSERT+SELECT only. No cost / currency / funding column. |
| 2 | Helpers | `lib/usage/provider-usage-recorder.ts`: `recordProviderUsageEvent` (upsert `ignoreDuplicates` on the key), `videoGenerationUsageEvent`, `recordVideoGenerationUsage` (best-effort: one retry, swallow, log error class only). |
| 3 | Producers | Only Kling video-generation completion (`lib/video-generation/completion.ts`) plus the admin-only historical importer. |
| 4 | Read API | `GET /api/settings/usage`: user session client (RLS), last 200 rows, display columns only (no task id, no idempotency key, no metadata; `historical_import` is the single derived flag). |
| 5 | UI | `components/settings/usage-history.tsx`: filters = period / provider / transport / project (provider list is derived from the rows); summary grouped by `(provider, transport, unit, source)`, never one total; unknown counted apart. |
| 6 | Kling REST | `provider_reported`, native `units`. |
| 7 | Kling MCP | `balance_delta`, native `credits`. |
| 8 | Cost / pricing | **None.** The ledger states "Nothing here is a price, a currency amount, a wallet or a balance"; there is no pricing registry. |
| 9–10 | Gemini adapters | `lib/providers/gemini/review-provider.ts` is the common boundary for Image (inline bytes) and Video (Files API). It already returned the raw `usageMetadata` as `ReviewExecutionResponse.usage`, but **nothing consumed it**, and it was **dropped on rejected responses**. |
| 11 | Response handling | `client.generateContent` → HTTP 200 JSON. `usageMetadata` is available right after `response.json()`, before block/finishReason/empty-text rejection and before strict Review parsing. |
| 12 | Linkage at that point | The services hold the Review row (`id`, `project_id`, `production_id`, `media_artifact_id`), the artifact, the model, and the credential result (`executionMode`, `credentialSource`). |

STOP check: the ledger **can** represent Gemini factual usage without a schema change (see mapping), so no migration was proposed.

## Gemini `usageMetadata` contract (verified, not recalled)

Source: the v1beta discovery document (`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`, schemas `UsageMetadata`, `ModalityTokenCount`):

`promptTokenCount` (includes cached content), `cachedContentTokenCount`, `candidatesTokenCount` (generated response, **excludes** thoughts), `thoughtsTokenCount`, `toolUsePromptTokenCount`, `totalTokenCount` (= prompt + tool-use + thoughts + candidates), `promptTokensDetails[]` / `candidatesTokensDetails[]` / `cacheTokensDetails[]` / `toolUsePromptTokensDetails[]` (`{ modality: TEXT|IMAGE|VIDEO|AUDIO|DOCUMENT, tokenCount }`), `serviceTier` (`standard|flex|priority`).

`lib/providers/gemini/usage.ts#extractGeminiUsage` keeps only non-negative integers and known modalities/tiers; absent = `null` (never 0); unrecognised fields are never copied.

## Mapping to the ledger (no schema change)

One ledger row per provider-native category, all `provider_reported`:

| Category | unit | Notes |
|---|---|---|
| `promptTokenCount` | `input_tokens` | cached/tool-use/modality split in `provider_metadata.usage` |
| `candidatesTokenCount` | `output_tokens` | |
| `thoughtsTokenCount` (> 0) | `tokens` + `provider_metadata.usage_category = 'thoughts'` | the unit enum has no thinking unit; the category keeps it distinct and the summary groups it apart. A reported 0 adds no row. |
| `totalTokenCount` | — | metadata only; **never** a row (no fake universal unit) |
| nothing usable | one event, NULL quantity/unit, source `unknown` | unknown is not zero |

Attribution: `provider='gemini'`, `transport='rest'` (the official REST API; UI shows "Gemini API"), `operation='image_review' | 'video_review'`, `model`, `resource_type='media_review'`, `resource_id=<Review id>`, `provider_task_id=<Gemini responseId>`, `user_id`, `project_id`, `production_id`. `provider_metadata`: `{ api, funding, credential_source, provider_response, review: { id, media_type, artifact_id }, usage: {…descriptors…} }`. No key, URL or free text is ever stored (tests assert it).

Where: `lib/usage/gemini-review-usage.ts` (events + best-effort recorder), called from the two services right after `provider.execute` resolves (before strict parsing) and in the error path when the provider layer rejected a received response (`ReviewProviderError.usage`, new). No route duplicates logging; the OpenAI Image path and the legacy evaluator seam are untouched.

## Exactly-one semantics and idempotency

- Key: `gemini_review:{reviewId}:{input_tokens|output_tokens|thoughts_tokens|unknown}`, written in **one** upsert (`ON CONFLICT (idempotency_key) DO NOTHING`, all rows or none). A Review row **is** one provider execution: same-`clientRequestId` replay returns before the provider, stale recovery never calls it, an in-flight 409 never calls it. So a replay cannot create a second event; an intentional new Review has a new id → new observation.
- Proven against the real migration 044 in PGlite (shape CHECK, unit CHECK, UNIQUE key).

## When usage is (not) recorded

| Situation | Usage |
|---|---|
| Response accepted, Review completes | recorded |
| Response accepted, strict parsing fails | **recorded** (`provider_response: received`) |
| Response received but rejected by the provider layer (blocked / truncated / empty) **with** usage | **recorded** (`received_rejected`) |
| Credential missing, Files API failure, HTTP error, timeout, replay, 409 | none |

A timeout after the request was sent may have been metered by Google, but no usage was reported, so nothing is recorded (documented gap).

## Ledger-write failure policy

Same as the existing recorder: one retry of the **ledger write only**, error logged by class (never keys/payloads), never thrown. The Review result is unchanged and **Gemini is never called again** to repair accounting (tests: model-call count stays 1).

## BYOK semantics

`funding` records `ProviderExecutionResult.executionMode` (`user_byok`). Provider usage ≠ Content Studio spend. The Settings row says "Chave própria (BYOK): consumo na sua conta do provedor — custo não calculado". No Content Studio Credits are created or decremented; no entitlement/wallet semantics.

## Cost: NOT implemented (unknown is better than false precision)

Current pricing was read from `https://ai.google.dev/gemini-api/docs/pricing` (page dated 2026-10-07) for the two supported Review models. Paid standard tier: `gemini-3.5-flash` $1.50 in / $9.00 out (output "including thinking tokens") per 1M; `gemini-3.5-flash-lite` $0.30 in / $2.50 out per 1M. The same models also have a **free tier**, and separate **batch / flex / priority** prices. The response reports `serviceTier` but **not** whether the user's key is on the free or a paid plan, and the ledger has no cost/currency column nor any pricing registry. Computing a number would therefore be a guess. Persisted facts (token counts, modality split, cached tokens, service tier, model) are sufficient for a later layer.

Follow-up mission required: a versioned pricing registry with provenance (model × service tier × free/paid), a way to know the key's plan or an explicit "estimated, plan unknown" label, a cost column or derived view in the ledger, and its UI. Out of scope here.

## Settings → Uso e custos

Same API and screen. Additive, whitelisted fields `usage_category` (`thoughts`) and `funding` (`user_byok`, `content_studio_credits`) are derived from `provider_metadata`; everything else stays server-side. Labels: provider "Gemini", operations "Revisão de imagem / de vídeo". Summary key now includes the category, so input, output and thinking tokens are three groups; nothing is added across units. The provider filter lists Gemini automatically. Disclaimer unchanged in meaning.

## Historical Reviews

`3c365b1e-1aad-4595-a938-cf2f13fe83cc` and `4f71a426-2936-43b4-8291-ce2347e2c30e`: checked in Production — `result_payload`, `context_snapshot` and `subject_snapshot` contain no usage metadata, and no earlier document records token counts. **No backfill, no estimation**; their provider usage remains unknown. Production had 0 Gemini ledger rows before this change.

## Tests

`gemini/__tests__/usage.test.ts` (contract extraction), `usage/__tests__/gemini-review-usage.test.ts` (events, attribution, idempotency, ledger failure, real migration 044), `reviews/__tests__/gemini-usage-video-service.test.ts`, `gemini-usage-image-service.test.ts` (replay, new Review, parse failure, rejected response, credential, errors, ledger failure, secrets, stale-recovery interplay, no backfill), `provider-usage-ledger.test.ts` (API whitelist incl. Gemini), `usage-history.test.tsx` (Gemini rows, filters, separate groups, unknown, no money). Existing Kling, Image, Video and stale-recovery suites unchanged and green.

## Preview smoke — PERFORMED & PASSED (read-only)

- Preview `https://content-studio-dq8t8p92i-fmultimans-projects.vercel.app` at PR #146 head `83915be3d12113aa215a27217d5471d27a39e4d5`; authenticated app session, Vercel share-link access.
- Settings → Uso e custos loaded with a single `GET /api/settings/usage` (no write, no provider call). Existing Kling rows rendered unchanged: MCP 18 créditos (diferença de saldo), API 2 × 3 unidades (informado pelo provedor), 2 unknown executions counted apart; provider filter present; no error state.
- Database before/after (read-only): `provider_usage_events` 5 rows, **0 Gemini**; `media_reviews` 19, 0 in flight, last Review unchanged. No fake usage was inserted. Gemini row presentation is proven by the automated UI/API tests, since no real Gemini usage exists yet and none was fabricated.

## Residual gaps

- Monetary cost (above).
- A timed-out request that Google may still have metered records no usage.
- OpenAI Image Review usage is not recorded (not requested).
- `cachedContentTokenCount` and tool-use tokens are descriptors on the input row, not separate rows.
