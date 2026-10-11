# FUTURE-064 Slice A — Official Google Gemini image generation: server client + text-to-image route

Status: implemented, **disabled by default**, no UI, no migration, no paid call.
Authority: Traycer artifact `future-064-google-gemini-image-generation-audit` (baseline `origin/main` `a7b7c00`).

## What shipped

| Piece | File |
|---|---|
| Closed alias → official model registry | `lib/providers/gemini/image-models.ts` |
| Image-only `generateContent` client (bounded, validated, typed errors, usage capture) | `lib/providers/gemini/image-client.ts` |
| Release switch | `lib/providers/gemini/image-feature.ts` |
| `POST /api/gemini/generate-image` | `app/api/gemini/generate-image/route.ts` |
| Tests | `lib/providers/gemini/__tests__/image-client.test.ts`, `lib/__tests__/gemini-generate-image-route.test.ts`, `lib/__tests__/gemini-image-boundary.test.ts` |
| Boundary allow-list pin (one new credential-resolving route) | `lib/__tests__/credential-boundary.test.ts` |

Not touched: the text/Review Gemini client (`client.ts`), the OpenAI and NanoBananaAPI.ai routes and callback, credential storage, Supabase grants/schema, pricing tables, any UI, `PROVIDER_METADATA` (Gemini keeps `executionImplemented: false` until the release gate), user-selected image defaults.

## Official Google API contract (verified against ai.google.dev on 2026-10-11)

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
x-goog-api-key: <the user's own Gemini BYOK key>      (never in a URL, log or message)

{ "contents": [{ "role": "user", "parts": [{ "text": "<prompt>" }] }],
  "generationConfig": { "responseModalities": ["IMAGE"],
                        "imageConfig": { "aspectRatio": "<one of 10>", "imageSize": "1K" } } }
```

- Response image: `candidates[0].content.parts[].inlineData { mimeType, data(base64) }`; usage: `usageMetadata` (incl. `candidatesTokensDetails[]` with an `IMAGE` modality); blocks: `promptFeedback.blockReason`, candidate `finishReason`.
- Google states `generateContent` "remains fully supported"; the newer Interactions API is not used (no custom safety settings, different shape, would not reuse the existing usage normalizer).
- Aspect ratios: `1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9`. V1 size is fixed at `1K` server-side (not client-selectable, bounds cost).
- All images carry a SynthID watermark. These image models have **no free tier**: every call is billed to the user's Google account.
- Not live-verified (no paid call was made): that both V1 models accept `responseModalities:["IMAGE"]` alone and `imageSize:"1K"`. The first authorized smoke (release gate) must confirm; if a model rejects image-only output the single constant in `buildGeminiImageRequestBody` is the only change needed.

## Alias mapping (closed registry, resolved only on the server)

| Persisted selector / Attempt `model` (≤ 20 chars) | Official Google model id | Stored in |
|---|---|---|
| `gemini-nb-2.1` | `gemini-nano-banana-2.1` | `submitted_config.providerModel` |
| `gemini-nb-lite` | `gemini-3.1-flash-lite-image` | `submitted_config.providerModel` |

Anything else — `gpt-image-*`, `nanobanana-v1/v2`, an official Google id, `gemini-3-pro-image`, `gemini-3.1-flash-image`, the shut-down `gemini-2.5-flash-image`, case variants, prototype keys, non-strings, or an omitted model — is `400 INVALID_IMAGE_MODEL` before any Attempt, credential read or provider call. There is no default model and no fallback to OpenAI, to the third-party NanoBanana provider, or to another Gemini model.
`image_generation_attempts.provider = 'gemini'`; `images.model` and the Attempt `model` carry the alias; `varchar(20)` selector columns are never exceeded and **no schema change** was needed (`attempts.model`, `images.model`, `submitted_config` are text/jsonb).

## Request contract

`POST /api/gemini/generate-image` — JSON object, closed field set: `prompt` (≤ 20 000 chars), `model` (alias, required), `aspectRatio` (optional, default `1:1`), `sessionId`, `clientRequestId` (both UUID, required: canonical Session/Attempt path only; there is no legacy un-sessioned path). Body ≤ 64 KiB.
Any other field is rejected: names that look like an input image/reference/mask/file/source/attachment → `400 SOURCE_NOT_SUPPORTED` (image-to-image is explicitly not in V1); everything else (`size`, `quality`, `provider`, `apiKey`, …) → `400 UNSUPPORTED_FIELD`. A Session whose saved state carries `sourceReferences` is also refused (`SOURCE_NOT_SUPPORTED`, existing `freezeAndClaimImageAttempt` gate).

## Order of operations

1. authenticate (401) → 2. **release switch** (403 `GEMINI_IMAGE_GENERATION_DISABLED`) → 3. FUTURE-050 execution policy (403 in Preview/local/unknown) → 4. validate → 5. `freezeAndClaimImageAttempt` (ownership of Session/Project/Production, immutable snapshot + fingerprint, unique `(user_id, client_request_id)`, CAS claim) → 6. `resolveProviderExecution(provider:'gemini')` → 7. **one** Gemini call → 8. strict image validation → 9. `uploadImageToS3` → `createPresignedReadUrl` → `linkImageOutput`.

## Credential resolution

Existing `resolveProviderExecution` / user_byok Gemini resolver only; the route has no `process.env` key, no `user_settings` access, no service-role import. Missing key → `400 PROVIDER_NOT_CONFIGURED` (Attempt closed, outcome known); unreadable store → `503 PROVIDER_CREDENTIAL_UNAVAILABLE` (retryable, Attempt closed, outcome known). Tests prove the OpenAI and third-party NanoBanana keys saved beside the Gemini key are never used. FUTURE-059 is untouched: Production remains `legacy` credential mode with Slice 2 containment; nothing here reads, rotates, migrates or claims encryption of keys.

## Response handling

- Body read under a 24 MiB cap (declared `content-length` checked first, streamed read aborted at the cap).
- Strict base64, MIME allow-list (`image/png|jpeg|webp`), file-signature must match the declared type, `sharp` must decode the header with a matching format, 64 B ≤ size ≤ 16 MiB, each side ≤ 8192 px. First image part wins.
- Error kinds → HTTP: invalid key 400 `PROVIDER_CREDENTIAL_REJECTED` (never 401, so the app does not treat it as a session logout); 429 `PROVIDER_RATE_LIMITED`; safety block 422 `PROVIDER_CONTENT_BLOCKED`; 404 model `PROVIDER_MODEL_UNAVAILABLE`; timeout 504 `PROVIDER_TIMEOUT`; no image 502 `EMPTY_PROVIDER_RESULT`; malformed/invalid/oversized 502 `INVALID_PROVIDER_RESPONSE`; 5xx/network 502 `PROVIDER_UNAVAILABLE`. Provider bodies, prompts and keys never appear in responses, Attempt `failure_details` or logs.
- Bytes are stored through the existing `uploadImageToS3`; if storage is unconfigured the request fails (no `data:` URL fallback, unlike the legacy OpenAI path).

## Attempt, idempotency and retry semantics

- One canonical Attempt per `clientRequestId`; identical resubmission replays (`replayed: true`) and **never** calls Google again; two simultaneous identical posts → one provider call; the same id with a different prompt/model/aspect ratio → `409 IDEMPOTENCY_CONFLICT`. Sequence increments only for new request ids.
- The fingerprint covers `provider`, alias, `aspectRatio`, `imageSize`, `providerModel`.
- Failures before a stored result close the Attempt `failed` with `outcome_unknown` = `true` when Google may have processed (and billed) the call (network, timeout, 5xx, unusable 200, storage/link failure after a good response) and `false` for definite rejections (bad key, 429, safety block, missing/unreadable credential).
- **No automatic retry anywhere**: one `fetch` call site, no loop; a retry is a new explicit request id (a second paid call chosen by the user). Replaying a failed id returns the failure without re-spending.
- Known, accepted gap (same as the OpenAI route): if the process is killed after Google answers but before the Attempt is closed, the Attempt stays `submitted`; replays report that state and do not re-spend. Stale recovery for this pattern is not part of Slice A.
- If storage succeeds but linking fails, the Attempt is closed `failed` and the stored object is left in place (nothing is deleted).

## Release safety

- Disabled by default: the route answers 403 until the deployment environment sets `CONTENT_STUDIO_GEMINI_IMAGE_GENERATION=enabled` (exact string; `1`/`true` are rejected). It is checked after authentication and before any Attempt, credential read or provider call. No checked-in file sets it (boundary-tested), and nothing in the UI references the route, so hydration, background work, stale UI paths or applying a prompt cannot reach it.
- Independent of the switch, FUTURE-050 blocks Preview, local (without opt-in) and unknown runtimes.
- **Operator enabling procedure (later release gate, not part of this slice):** merge UI Slice B → set the variable in Production only → one explicitly authorized, single-image smoke → record the result. Rollback: unset the variable (instant) or revert.

## Usage and cost (Slice C contract; nothing recorded here)

`generateGeminiImage` returns `usage: GeminiUsage | null` from the shared `extractGeminiUsage` (prompt/candidates/thoughts/total tokens, `promptTokensDetails[]`, `candidatesTokensDetails[]` with the `IMAGE` modality, `serviceTier`), plus `responseId` and `modelVersion`. Unreported usage is `null` — never `0`. Slice A writes **no** `provider_usage_events`, adds **no** pricing rows, runs **no** migration, computes **no** cost, and the route response contains no cost/usage field. Image output remains un-priced in `provider_pricing_versions` (its `usage_category` check has no image-output category); that registry decision belongs to a later, approved slice.

## Tests (all mocked; 0 real provider calls)

167 new tests: registry/aliases (closed, ≤ 20 chars, prototype keys), release switch, request validation incl. 16 image-to-image shapes, ownership (other user's Session/Project/Production), BYOK selection (Gemini key only), not-configured vs unavailable, success persistence against an in-memory fake database running the real `execution.ts` lifecycle, idempotent/concurrent duplicates, 409 conflict, provider HTTP/network/timeout/safety/malformed/no-image/invalid-image/oversized cases, storage and link failure after a good response, no-retry call counts, plus static boundary tests (server-only, UI-free, order of guards, single call site, no key/prompt logging, no pricing/usage/migration code, legacy routes free of Gemini image code). Mutation checks (flag check removed; silent model fallback added) failed 34 tests as intended. The shared vitest harness also refuses any real provider host.

## Prerequisites for UI Slice B

1. Extend `ImageModel`/`normalizeImageModel`/Settings radio with the two aliases (today an unknown value silently becomes `gpt-image-2`; keep legacy values valid) and make `imageProviderReady` a three-way provider resolver (OpenAI / Gemini / third-party NanoBanana) using the existing `geminiConfigured` state.
2. Label models "Google Gemini · Nano Banana … (oficial)" and relabel the NanoBanana card/options "NanoBananaAPI.ai (terceiros) — legado"; update the Gemini Settings card copy and flip `PROVIDER_METADATA.gemini.executionImplemented` (and its pinned tests) in that slice.
3. Manual dispatch posts `{prompt, model, aspectRatio, sessionId, clientRequestId}` only; Automatic mode must stay opt-in and surface model + paid-per-image notice (no free tier).
4. Handle the new error codes above; treat `403 GEMINI_IMAGE_GENERATION_DISABLED` as "not available yet".
5. Decide the Slice C/D follow-ups (usage recording, image pricing registry) before enabling beyond a smoke.
