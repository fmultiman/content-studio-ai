# FUTURE-064 Slice C — Usage accounting for official Google Gemini image generation

Status: implemented. **The Production release switch stays OFF** — nothing here enables Google generation, makes a paid call, runs a migration, adds a price, or touches credentials. Cost remains **unknown** (never `$0`).
Builds on: `FUTURE_064_GOOGLE_GEMINI_IMAGE_SLICE_A_V1.md` (route, client; merge `aef01fa`) and `FUTURE_064_GOOGLE_GEMINI_IMAGE_SLICE_B_V1.md` (UI; merge `b18bd6b`).

## What changed

| Piece | File |
|---|---|
| Ledger events + recorder + Attempt accounting mark (server-only) | `lib/usage/gemini-image-usage.ts` |
| Client carries what Google sent on failures after a 2xx response (`GeminiImageError.received`) | `lib/providers/gemini/image-client.ts` |
| Route accounts for the provider response (before storage) | `app/api/gemini/generate-image/route.ts` |
| Presentation vocabulary for the new categories / operation | `lib/usage/provider-usage.ts` |
| Shared in-memory fake of the ledger + Attempt lifecycle (tests) | `lib/__tests__/helpers/fake-image-db.ts` |
| Boundary allow-list: the new recorder may create the service-role client (like `lib/prompt-assistance/usage.ts`) | `lib/__tests__/credential-boundary.test.ts` |

No migration, no pricing row, no change to `derive.ts`/`registry.ts`, no change to the text/Review recorders, the OpenAI or NanoBananaAPI.ai paths.

## Schema investigation (why no database change is needed)

`provider_usage_events` (scripts/044) already provides what Slice C needs, verified on the live project (read-only):

- `UNIQUE (idempotency_key)` and `CHECK (length(idempotency_key) > 0)`;
- `resource_id uuid` (the Attempt id is a uuid), free-text `operation` / `resource_type` / `model` / `provider_task_id`, `provider_metadata jsonb`;
- unit allow-list includes `tokens`, `input_tokens`, `output_tokens`; shape check `quantity/unit NULL ⇔ measurement_source = 'unknown'`;
- the recorder already writes a whole set in **one statement** (`upsert … onConflict: idempotency_key, ignoreDuplicates`): all rows or none, duplicates silently skipped.

So Attempt-linked idempotency is guaranteed by the existing unique key. `image_generation_attempts.result_metadata` (jsonb) is a lifecycle column the immutability trigger does not freeze, so the accounting outcome can be stored there without a schema change. **No STOP condition was hit.**

## Usage fields recorded

One provider execution = one logical set of rows, `operation = image_generation`, `resource_type = image_generation_attempt`, `resource_id = <Attempt id>`, `provider = gemini`, `transport = rest`, `model = <official Google id>` (the key pricing will use), `provider_task_id = responseId`, `measurement_source = provider_reported`:

| Row (key `gemini_image:{attemptId}:…`) | Unit | `usage_category` | Source field |
|---|---|---|---|
| `input_tokens` | `input_tokens` | — | `promptTokenCount` (includes cached content) |
| `image_output_tokens` | `tokens` | `image_output` | `candidatesTokensDetails[IMAGE]` (summed) |
| `text_output_tokens` | `output_tokens` | — | `candidatesTokensDetails[TEXT]` (summed) |
| `thoughts_tokens` | `tokens` | `thoughts` | `thoughtsTokenCount` (> 0) |
| `output_unattributed_tokens` | `tokens` | `output_unattributed` | `candidatesTokenCount` **only when Google sent no modality breakdown** |
| `unknown` | NULL | — | nothing usable was reported (null quantity, source `unknown`) |

`provider_metadata` carries, exactly as reported and only when reported: `serviceTier`, `cachedContentTokenCount`, `toolUsePromptTokenCount`, `totalTokenCount`, `thoughtsTokenCount`, `candidatesTokenCount`, `promptTokensDetails[]`, `candidatesTokensDetails[]`; plus `funding` (`user_byok`), `credential_source`, `provider_response` (`received` | `received_rejected`, with `rejected_as`), and `image_generation { attempt_id, model_alias, provider_model, model_version, aspect_ratio, image_size, response_modalities, usage_completeness, output_attribution }`. The internal alias (`gemini-nb-2.1` / `gemini-nb-lite`) is in metadata, the official id is the row `model`.

Rules: `totalTokenCount` is never a row; nothing is merged or converted; a **reported zero adds no row** for thinking/IMAGE counts (a zero prompt count is a real measurement and is kept); tokens are never estimated from image size, dimensions or count; modalities other than IMAGE/TEXT stay in metadata only.

### Why IMAGE tokens are not `output_tokens`

The cost deriver prices `output_tokens` at the ordinary text-output rate. Google bills image output tokens at a different (higher) rate, so an IMAGE row in `output_tokens` would be mispriced the moment any text price exists for the model. Image and unattributed output are therefore unit `tokens` with a distinct `usage_category`; `derive.ts` answers `unit_not_priceable` for them, and tests assert that even with hypothetical text rates present they are **never** priced (while genuine TEXT output and input are). The Usage UI groups them separately (never merged with thinking or text output) and labels them "tokens de saída de imagem" / "…(modalidade não informada)"; the operation is shown as "Geração de imagem". The two category names were added to `USAGE_CATEGORIES` (additive; the settings usage route whitelists by that list).

## Idempotency guarantee

- Key: `gemini_image:{attemptId}:{category}`, deterministic per Attempt. The Attempt claim (Slice A) lets exactly one request call Google, so one Attempt produces one set; the ledger's unique key plus `ON CONFLICT DO NOTHING` makes any second write (a replay, a recorder retry, two concurrent writers) a no-op — also proven by re-recording an Attempt directly.
- A replayed request id returns the stored result without reaching Google or the recorder again; concurrent identical posts → one provider call, one set; a new request id → a new Attempt with distinct keys.
- All rows of a set go in one statement (all or nothing).

## Failure accounting

| Situation | Ledger | Attempt |
|---|---|---|
| Provider never called (validation, ownership, switch OFF, missing/unreadable credential) | none | unchanged (existing semantics) |
| Call rejected before usage reported (HTTP 4xx/5xx status, bad key, quota) | none — no provider execution with usage | `failed`, `outcome_unknown` per Slice A (false for 4xx, true for 5xx) |
| Network failure, timeout, unreadable/non-JSON body | none — Content Studio holds no provider response | `failed`, `outcome_unknown = true` (uncertain provider work; documented, **no imaginary row**) |
| Response received (2xx) with known usage | the rows above | `succeeded` |
| Response received, no usage | ONE `unknown` event | `succeeded` |
| Response received but unusable (blocked prompt/image, no image, invalid image, malformed part, too large) | rows for the usage Google reported, or one `unknown` event; `provider_response = received_rejected`, `rejected_as = <kind>` | `failed` (`outcome_unknown` per Slice A) |
| Storage / link failure **after** the provider answered | already recorded — accounting runs **before** storage | `failed`, `outcome_unknown = true` |
| Replay of an existing Attempt | no new rows | unchanged |
| Ledger write fails | none written; ONE retry of the ledger write; class-only log (`[gemini-image-usage] usage ledger write failed`, Attempt id) | `result_metadata.usage_accounting.ledger = 'ledger_failed'` plus the numbers Google reported (`reported_usage`) so it is visible and reconcilable without calling the provider |
| Malformed event | none | `ledger = 'ledger_rejected'` |

The classified outcome is written to `image_generation_attempts.result_metadata` (`provider_response`, `usage_accounting { ledger, rows, usage, output_attribution, reported_usage? }`); a failure to write the mark is logged by class and never breaks the request. A ledger failure never undoes a delivered, paid image and never causes the provider to be called again (same best-effort contract as the Review and Prompt Assistance recorders). Reconciliation of an Attempt marked `ledger_failed` is an operator follow-up using the stored numbers and the idempotent key; no automatic reconciler is added in this slice.

## Unknown usage and unknown cost

- Missing `usageMetadata` → one `unknown` event (null quantity/unit), never `0`; partial metadata → only the reported rows; no field is back-filled.
- No pricing is added or changed. Every Gemini image row derives to `unavailable` today (`no_pricing_for_model`, `unit_not_priceable` or `usage_unknown`), never an amount and never `0`. The route response contains no cost or usage field.
- Funding is `user_byok`: provider usage, not Content Studio spend.

## Release safety

Switch unchanged (`CONTENT_STUDIO_GEMINI_IMAGE_GENERATION` not touched, OFF in Production): with it OFF the route answers 403 before any Attempt, credential read, provider call or ledger write (tested). No Google request, paid call, credential change, migration, or FUTURE-059 activation.

## Tests (mocked only)

- `lib/usage/__tests__/gemini-image-usage.test.ts` (24): row shapes for Nano Banana 2.1 and 2 Lite, IMAGE/TEXT/mixed/unattributed/other modalities, unknown and partial usage, reported zeros, service tier present/absent, official model attribution, deterministic keys, valid ledger rows, the price boundary (no pricing ⇒ unavailable; with hypothetical text rates IMAGE/unattributed rows still unpriceable), presentation, ledger outcome classification (one-statement upsert, single retry, rejected event, Attempt mark never throws).
- `lib/__tests__/gemini-image-usage-accounting.test.ts` (33): route + faithful ledger fake — successful Attempt, both models, replay, concurrent duplicates, distinct Attempts, storage failure after the provider response, link failure, HTTP errors/network/timeout (no rows), blocked/no-image/invalid-image/oversized with and without usage, "never imaginary tokens", ledger failure (image still delivered, one ledger retry, no provider re-call, `ledger_failed` + snapshot, class-only log, replay does not pretend), mark failure harmless, switch OFF, no usage for rejected requests, only Gemini-image rows written.
- `lib/providers/gemini/__tests__/image-client.test.ts` (+5): `received` carried on 2xx failures and absent for status/transport/body failures.
- Boundary additions in `lib/__tests__/gemini-image-boundary.test.ts`: single importer, no pricing/SQL/migration/provider-call/process.env in the recorder, accounting before storage with exactly two call sites, legacy NanoBanana / OpenAI image / prompt assistance / Review untouched, pricing code untouched.
- Mutation checks (IMAGE tokens as `output_tokens`; rejected-response accounting disabled) fail 8 tests as intended.
- Existing suites unchanged and green: OpenAI and NanoBananaAPI.ai routes, Gemini text assistance and Review usage, credential-boundary, the corrected Settings key-list test; the only full-suite failures are the two known `Estilo` baseline tests.

## Prerequisites for Slice D (pricing registry)

1. **Registry vocabulary:** `provider_pricing_versions.usage_category` allows only `input | cached_input | output | unit`. Image-output tokens need a new category (e.g. `output_image`) — an approved, owner-applied migration that widens that CHECK (and its trigger/seed shape), plus `derive.ts`/`registry.ts` support mapping `usage_category = image_output` rows to it. Until then those rows stay `unit_not_priceable` by design.
2. **Prices:** verified list prices (per 1M tokens) for `gemini-nano-banana-2.1` and `gemini-3.1-flash-lite-image` — text/thinking input and output, image output — with `effective_from` basis and source URL, per service tier (`standard` is what Google reports in `serviceTier`).
3. **Unattributed output:** decide whether `output_unattributed` rows should stay permanently unpriced or be priced as image output when the request was image-only (an inference this slice deliberately does not make).
4. **Backfill:** no historical rows exist (the feature has never been enabled); pricing applies from `effective_from` forward.
5. **Release gate** (unchanged): switch enablement only with explicit approval after a single authorized smoke that also confirms `usageMetadata.candidatesTokensDetails` actually reports the IMAGE modality for both models (this slice is built for that shape and degrades to `output_unattributed`/`unknown` if Google omits it).
