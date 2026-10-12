# FUTURE-064 — Official Nano Banana: Production release gate, single paid canary

Status: **canary executed once and CLOSED on 2026-10-12. The global release switch (`CONTENT_STUDIO_GEMINI_IMAGE_GENERATION`) was never set and is still OFF. A successful single-image canary is NOT an authorization to launch publicly.**
Owner authorization: confirmed Gemini key rotation and authorized **exactly one** billable image-generation request (model `gemini-nb-2.1`, 1K, 1:1). No key was retrieved, printed or exported.

## 1. Preconditions (verified 2026-10-12 07:12–07:55 UTC)

| Check | Result |
|---|---|
| Production app | `56ff5d1` READY (later `805dee9`, see §2) |
| Pricing registry | 28 rows, 2 `image_output` prices (30.00 USD/1M each), latest migration `20261012065009` |
| Gemini BYOK | `configured` for exactly one of 7 users — the owner (`flavio.multiman@gmail.com`, id `35428fd4-4784-4934-9af9-82a606aad77e`); status only, no value read |
| Global switch | variable absent from Production env; `/api/settings/providers` → `release_switch_off`; authenticated probe → 403 |
| Prior Gemini canary Attempts / images / image usage rows | 0 / 0 / 0 |
| Pending work | no open PRs, no unrelated migrations, `origin/main` = Production SHA |

## 2. Restricted access (the route had none)

The existing switch is global, so a purpose-built, minimal gate was added — **PR #185, merge `805dee9`** (`app/api/gemini/generate-image/route.ts`, `lib/providers/gemini/image-feature.ts`, 50 mocked tests; full suite = the two known `Estilo` baselines plus load-induced 5 s timeouts that pass in isolation; Vercel green):

- inert unless `CONTENT_STUDIO_GEMINI_IMAGE_CANARY` = `v1|<owner uuid>|<client request uuid>|gemini-nb-2.1|<expiry UTC>` is present and valid;
- honored **only while the global switch is OFF**, for **exactly one verified user id**, **exactly one fixed `clientRequestId`**, **only `gemini-nb-2.1`**, **only 1:1** (the backend still owns 1K), and only until the expiry (rejected if malformed/expired/more than 24 h ahead); everything else gets the unchanged 403 `GEMINI_IMAGE_GENERATION_DISABLED` before any Attempt, credential read or provider call;
- no UI exposure (browser availability still derives from the global switch), FUTURE-050 policy still applies, Attempt idempotency means a replay of the fixed id cannot cause a second provider execution (tested, including a failed first attempt);
- revocation = delete the variable (and redeploy) or let it expire.

Configuration steps (the Vercel MCP cannot see the project, so the Vercel CLI logged in as `fmultiman` was used): variable added to **Production only** at ~07:52 UTC with expiry `2026-10-12T09:15:00Z` (canary request id `198818bc-8d83-46cc-a85b-4c941573b0be`, canary Session `19dab644-60f8-4c0d-9e8c-9a91c19ec834`, created through the app API, owner-scoped, non-billable) and the Production deployment redeployed (`content-studio-72v74g1kq`). Non-spend activation probe (owner, empty prompt): **400 `PROMPT_REQUIRED`** (active) versus **403** before the variable existed.

## 3. The ONE live request

| | |
|---|---|
| Route / session | existing canonical `POST /api/gemini/generate-image`, authenticated owner browser session (no cookie/token/key exposed) |
| Body | `{prompt, model: "gemini-nb-2.1", aspectRatio: "1:1", sessionId, clientRequestId}` — prompt exactly the authorized text ("A small young tree growing in a peaceful green garden, warm morning sunlight, natural colors, detailed botanical illustration, no text, no logos.") |
| Official model | `gemini-nano-banana-2.1`, `responseModalities: ["IMAGE"]`, `imageConfig {aspectRatio: "1:1", imageSize: "1K"}` |
| Google execution calls | **exactly 1** (one client request, no retry; one Attempt, one Google `responseId`, one set of usage rows) |
| Started / finished | 07:55:34.551Z → 07:55:50.432Z (~16 s) |
| HTTP result | **200**, `replayed: false` |

## 4. Result evidence

- **Attempt:** exactly one — `56ba444f-0280-4675-aa2a-ec90267e8eb8`, sequence 1, `status = succeeded`, provider `gemini`, `model = gemini-nb-2.1`, `submitted_config = {aspectRatio: "1:1", imageSize: "1K", providerModel: "gemini-nano-banana-2.1"}`, `failure_details = null`, `client_request_id = 198818bc-…`, one Attempt in the Session; `result_metadata.usage_accounting = {ledger: "recorded", rows: 3, usage: "reported", output_attribution: "by_modality_incomplete"}`, `provider_response = {state: "received", response_id: "eJLMauPnEZmE1MkPwYOCkAU", provider_model: "gemini-nano-banana-2.1", model_alias: "gemini-nb-2.1"}`.
- **Idempotency:** the fixed request id is bound to that Attempt; the route replays (never re-calls) and, after revocation, even the exact canary body is refused (403).
- **Image / storage / history:** exactly one `images` row (id = Attempt id, `status = draft`, `model = gemini-nb-2.1`, `image/jpeg`, 1,194,075 bytes, `storage_provider = s3`, key `users/<owner>/images/<uuid>/original.jpg`, thumbnail present); the Session shows one Attempt; the stored object loads from `s3.multihuman.com.br` and renders at **1024×1024** in the workspace (a botanical watercolor garden); the workspace shows the model as "Google Gemini — Nano Banana 2.1 (oficial)" with the BYOK charge notice.
- **Total Gemini executions in Production after the test:** 1 Attempt, 1 image, 3 usage rows, 1 user.

## 5. Usage and cost

Provider-reported `usageMetadata` (as recorded; `serviceTier = standard` **was reported**, so the sole-tier fallback was not needed):

| Field | Tokens |
|---|---|
| `promptTokenCount` | 29 (`promptTokensDetails`: TEXT 29) |
| `candidatesTokenCount` | 1,435 (`candidatesTokensDetails`: **IMAGE 1,120** only) |
| `thoughtsTokenCount` | 868 |
| `totalTokenCount` | 2,332 (= 29 + 1,435 + 868) |

Ledger rows (`operation image_generation`, `resource_id` = Attempt, official model id, `funding user_byok`, `provider_reported`): `input_tokens 29`, `tokens`/`image_output 1,120`, `tokens`/`thoughts 868`. Costs derived on read by `GET /api/settings/usage` (Standard, list-price equivalent, prices `observed_at_source` 2026-10-12):

| Component | Tokens | Rate (USD/1M) | USD |
|---|---|---|---|
| input | 29 | 1.50 | 0.0000435 |
| IMAGE output (`image_output` dimension) | 1,120 | 30.00 | **0.0336** (exactly as expected) |
| thinking (priced as output) | 868 | 7.50 | 0.00651 |
| **Priced rows total** | | | **0.0401535** |

**Unknown component:** `candidatesTokenCount` (1,435) exceeds the reported IMAGE modality (1,120) by **315 tokens that Google did not attribute to any modality**. Nothing was fabricated: no row exists for them and they are not priced. (For scale only: at the listed text rate they would be USD 0.0023625, at the image rate USD 0.00945.) `output_attribution` is recorded as `by_modality_incomplete`.

## 6. Provider model compatibility findings

- `gemini-nano-banana-2.1` accepted `responseModalities: ["IMAGE"]` together with `imageConfig {aspectRatio: "1:1", imageSize: "1K"}` — **proven** for this model (the Lite model was not exercised).
- Google returned **JPEG** (`image/jpeg`, 1024×1024), not PNG — handled by the validator.
- `usageMetadata` reports the **IMAGE modality** exactly (1,120 = the page's 1K token count) and **reports `serviceTier`** (`standard`).
- The model **thinks even for an image-only request**: 868 thought tokens, billed at the text/thinking output rate (~16% of the priced cost).
- Latency ~16 s.

## 7. Findings to resolve before any general activation

1. **Unrecorded remainder (accuracy):** the Slice C recorder writes rows only for the reported modality breakdown, so the 315-token remainder has **no row**, and the Usage screen therefore treats the three rows as a *complete* total (normal "Custo estimado" label) although the total is understated. Fix: record `candidatesTokenCount − Σ modalities` as an `output_unattributed` row (stays unpriced per the approved decision) so the aggregate is labelled "Custo estimado parcial". This needs a small code change; no paid call is required to test it.
2. **Stale cost copy:** the workspace notice still says "O custo estimado ainda não está disponível no Content Studio" — now inaccurate; reword (keep the BYOK charge warning, no free-tier claim).
3. The canary gate remains in `main` (inert without the variable): keep deliberately for future canaries or remove in a follow-up.
4. Not exercised live (deliberately): the Lite model, Automatic mode, rate-limit/quota behavior, content-block and error paths with a real provider, concurrent users.

## 8. Closing the canary (verified 2026-10-12 07:57–08:00 UTC)

- `CONTENT_STUDIO_GEMINI_IMAGE_CANARY` **removed** from Production immediately after the call (`vercel env rm`); Production **redeployed** (`content-studio-o6xjchpom`, aliased to `content.multihuman.com.br`, Ready in 2 m) so the running deployment no longer carries it. Production env now contains **no** `GEMINI_IMAGE` variable; the global switch was never created.
- Post-close probes (owner, authenticated): empty body → **403** `GEMINI_IMAGE_GENERATION_DISABLED`; the exact canary body → **403** (the grant is gone; it could only ever have replayed the existing Attempt). `/api/settings/providers` → `imageGeneration.gemini = {available: false, reason: "release_switch_off"}`.
- Other users were never authorized (the grant named only the owner id; tests prove other users get 403 with nothing touched); only one user has any Gemini Attempt.
- OpenAI and third-party NanoBananaAPI.ai: untouched (PR #185 changed only the Gemini route and its feature module; their suites pass; provider statuses unchanged: OpenAI/Kling/NanoBanana `configured`).
- Evidence preserved: the Attempt, image row, S3 object, three usage rows and the canary Session were left in place.
- Final state: `origin/main` = Production SHA `805dee9` (plus this docs PR); registry 28 rows / 2 `image_output` prices.

## 9. Recommendation

**Do not activate generally yet.** The canary proves the end-to-end path (route, Google call, storage, history, idempotency, usage and image-output pricing at exactly USD 0.0336 for 1,120 IMAGE tokens). Before a general release: fix finding 1 (partial-cost accounting) and finding 2 (copy); decide on Automatic-mode price/confirmation UX and quota handling; then plan a separately authorized, staged enablement (the global switch is a single deployment variable plus redeploy; rollback = remove it). Any further paid test needs its own authorization.
