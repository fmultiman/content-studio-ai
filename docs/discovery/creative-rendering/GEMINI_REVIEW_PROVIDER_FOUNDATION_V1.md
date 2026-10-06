# GEMINI_REVIEW_PROVIDER_FOUNDATION_V1

## Closure

- Starting `origin/main`: `54bd6b74647f80349bb51e24736de6070a3ded34` (after `GEMINI_BYOK_CREDENTIAL_STORAGE_V1`).
- Branch: `feat/gemini-review-provider-foundation-v1` (same worktree reused; the stale local branch from the blocked attempt pointed at an ancestor and was reset to `origin/main`).
- Authority: `GEMINI_PROVIDER_AND_UNIVERSAL_MEDIA_REVIEW_PREFLIGHT_V1.md`, `UNIVERSAL_MEDIA_REVIEW_SUBJECT_FOUNDATION_V1.md`, `GEMINI_BYOK_CREDENTIAL_STORAGE_V1.md`.
- Paid Gemini calls: **0**. Paid OpenAI calls: **0**. Every provider and storage interaction in tests is mocked.
- Schema changes / migrations: **none**.

This slice adds the official Gemini API as a Review **execution provider** behind a provider-neutral boundary. It does not add a Video Review adapter, criteria, route or UI, any generation work, Antigravity, or Flow.

## Adapter versus provider

| Concern | Owner |
|---|---|
| Criteria, prompt, context, strict result validation | Review **adapter** (`lib/reviews/adapters/image.ts`, unchanged semantics) |
| Authentication, media transport, model call, structured-output request, raw response metadata, provider errors | Execution **provider** |

Gemini is one provider behind the boundary. Nothing equates a future Video adapter with Gemini.

## Provider interface — `lib/reviews/execution-provider.ts`

`ReviewExecutionProvider { providerId; capabilities; execute(request) }`. A request carries `model`, server-resolved `apiKey`, `instructions`, `input`, `media: AuthorizedReviewMedia[]`, an optional `responseSchema` hint and an optional timeout. A response carries `rawText`, `providerId`, `model`, `providerRequestId`, `usage`, `remoteFile` and `warnings`. Providers never interpret the result.

`AuthorizedReviewMedia` (`kind: 'image' | 'video'`) has **no client-URL field**. Bytes come only from `load()`, bound to an owner-checked artifact. An optional server-resolved `url` exists only so OpenAI keeps its historical delivery.

## OpenAI compatibility

The outbound Chat Completions request moved unchanged into `lib/reviews/providers/openai.ts` (same body: `json_object`, `detail: 'low'`, 1400 max tokens, `OPENAI_EVALUATION_MODEL` else `gpt-4o-mini`). OpenAI remains the default Image Review provider (`DEFAULT_REVIEW_PROVIDER_ID`). Changes: a 60 s timeout was added where none existed, and HTTP/timeout failures now normalize through `ReviewProviderError`. The legacy `evaluator` injection seam is preserved for OpenAI. The OpenAI path performs no extra DB reads and no new media guards, so no existing Review can newly fail. Historical OpenAI Review metadata is untouched.

## Provider selection

`createImageReviewExecution` accepts a server-only `providerId` (default `openai`) plus test overrides. `POST /api/reviews/image` does not pass it, and `ReviewRequestSchema` stays `{ attemptId, clientRequestId }.strict()`, so the browser cannot choose a provider, model, or media URL. A boundary test enforces this. No picker was added.

## Gemini provider

- Provider ID: **`gemini`** (distinct from `nano_banana`, Antigravity, Flow, Kling MCP).
- Files: `lib/providers/gemini/client.ts` (REST), `review-provider.ts`, `review-models.ts`, selected through `lib/reviews/provider-registry.ts`.
- Transport is plain `fetch` to `generativelanguage.googleapis.com` — no SDK dependency, fully mockable. Only `client.ts` contains the host (boundary test).
- Auth: `x-goog-api-key` header; never in a URL, never in an error message. Provider response bodies are never copied into errors.
- Structured output: `responseMimeType: application/json` plus `responseJsonSchema` (`IMAGE_EVALUATOR_RESPONSE_SCHEMA`). This is a **request hint only**: the existing strict `parseImageEvaluatorResponse` always runs afterwards, and malformed/invalid-JSON output fails the Review.
- Non-`STOP` finish reasons (truncation, safety), prompt blocks, empty text and thought-only output are `invalid_response`, never success.

## Credential strategy

Reuses the merged BYOK path: `resolveProviderExecution(db, { provider: 'gemini' })` with `user_byok`, scoped to the user, no platform fallback, never mixed with the OpenAI or Nano Banana columns. Missing credential fails the Review with `REVIEW_PROVIDER_NOT_CONFIGURED` before any media read or provider call. The browser never receives the key (status-only Settings API from the prerequisite; the Review route accepts no credential). No schema or Settings change was needed.

## Model registry

`review-models.ts` lists `gemini-3.5-flash` (default) and `gemini-3.5-flash-lite`, both declared `image_review` and `video_review`. They were checked against Google's published model pages on 2026-10-06, with no live call. `GEMINI_REVIEW_MODEL` selects the active model and must be a registry member; anything else is `unsupported_model`, rejected before credentials are spent. Changing the supported set later is a one-file edit. The model is persisted as `evaluator_model`; the provider as `evaluator_provider` (`gemini` vs `openai`).

## Capability registry

`PROVIDER_METADATA` gained `reviewCapabilities` (`openai: image_review`; `gemini: image_review, video_review`; others none). `executionImplemented` for Gemini stays `false` because it has no generation path. Provider and model capability guards (`assertMediaSupported`, `assertProviderModelSupportsMedia`, `assertGeminiModelSupports`) run before upload or any model call. Unimplemented capabilities are not exposed as product actions.

## Media authority — `lib/reviews/media.ts`

`resolveAuthorizedReviewMedia(db, { userId, artifactId })`:

1. selects `media_artifacts` filtered by `id` **and** `user_id` — cross-user and unknown ids are both `REVIEW_SUBJECT_NOT_FOUND`;
2. requires `storage_provider = 's3'` and a trusted path (owner Library path, owner image `original`, or the owner/project tenant video path); arbitrary URLs and foreign namespaces are `REVIEW_OUTPUT_UNAVAILABLE`;
3. applies local guardrails;
4. on `load()` reads via the existing S3 reader and, for `sha256` artifacts, re-verifies the content hash. A changed object is refused.

For Gemini Image Review the service resolves media this way and does not disclose the delivery URL in the prompt.

## Image execution

Image bytes go inline (base64) in the model request, with the artifact MIME. Gemini Image Review is reachable through the service with `providerId: 'gemini'` and is covered by mocked service tests; it is not reachable from the browser.

## Video foundation — Files API lifecycle

Native video only (no ffmpeg or frame extraction). Per execution:

1. **Guards first** (no network): one video max, 500 MB, 10 minutes, unknown size or duration rejected (fails closed), and a re-check of real byte length after load.
2. **Upload**: resumable start, then `upload, finalize`. The returned session URL must be `https://generativelanguage.googleapis.com`.
3. **Process**: poll `GET files/{id}` until `ACTIVE` with backoff 2 s → 10 s capped, total bound 180 s; `FAILED` is `file_processing_failed`, deadline is `timeout`.
4. **Use**: reference `fileData.fileUri` in `generateContent`.
5. **Cleanup** in all paths: `DELETE files/{id}`; a 404 counts as done.

Upload-per-execution; there is no persistent provider-file cache and no DB schema. The remote file is transport only and never changes `media_artifacts`.

**Cleanup failure never changes the Review outcome.** On success it becomes a `REMOTE_FILE_CLEANUP_FAILED` warning on the response (logged by code only). On execution failure the warning is attached to the thrown `ReviewProviderError.warnings`. Remote files also expire on Google's side (about 48 h per the preflight).

## Timeouts and bounds

| Step | Bound |
|---|---|
| Model request | 120 s |
| Upload (each of start/finalize) | 300 s |
| File processing | 180 s total, polls ≥ 2 s apart, ≤ 10 s |
| Status check | 30 s |
| Cleanup | 15 s |
| OpenAI request | 60 s |

There are no automatic retries on paid calls.

## Error normalization

`ReviewProviderError` kinds: `missing_credential`, `invalid_credential`, `unsupported_model`, `unsupported_capability`, `media_limit_exceeded`, `provider_client_error`, `provider_server_error`, `timeout`, `upload_failed`, `file_processing_failed`, `invalid_response`. `toReviewServiceError` maps them to the existing codes (`REVIEW_PROVIDER_TIMEOUT`, `REVIEW_INVALID_EVALUATOR_RESPONSE`, `REVIEW_PROVIDER_NOT_CONFIGURED`, `REVIEW_PROVIDER_ERROR`) plus one new code, `REVIEW_PROVIDER_UNSUPPORTED` (HTTP 422), for model, capability and limit rejections. The persisted failure codes are unchanged (`provider_error`, `provider_timeout`, `invalid_evaluator_response`, `media_unavailable`). A Review is never fabricated as successful.

## Tests (all mocked; zero live calls)

- `lib/reviews/__tests__/execution-provider.test.ts` — contract conformance, selection, unsupported provider/capability/media, model metadata, error mapping, OpenAI request parity.
- `lib/providers/gemini/__tests__/review-provider.test.ts` — 17 tests: image inline, header-only key, HTTP mapping with no leakage, timeout, malformed/blocked/truncated output, and the full video flow (order, headers, guards, real-size recheck, unsupported model before upload, upload failure, foreign upload host, processing failure, bounded polling, cleanup failure vs success, both failing, 404 cleanup).
- `lib/reviews/__tests__/media.test.ts` — ownership, cross-user, untrusted paths, video namespace, guards, kind mismatch, hash mismatch, storage failure.
- `lib/reviews/__tests__/service.test.ts` — OpenAI default unchanged, Gemini image through authorized media, strict parser failure, provider failure, unregistered model before any call, fail-closed credential without OpenAI fallback. The original 4 OpenAI tests pass unchanged.
- `lib/__tests__/credential-boundary.test.ts` — Gemini host only in the server client, no client import of Gemini or `gemini_api_key`, no platform env key, and no provider, model or URL from the Review request. Two allowlists were updated: the OpenAI host now lives in `lib/reviews/providers/openai.ts`, and `lib/reviews/service.ts` was added to the service-role allowlist. That second test was already failing on `main` for the shared-review-core service, which predates this slice.
- Prerequisite credential, execution and Settings API suites still pass.

## Validation

- Focused: reviews, providers, credentials, Settings API, media-artifacts and boundary suites pass.
- `pnpm typecheck`: pass. ESLint on the touched scope: pass. `pnpm build`: pass. `git diff --check`: pass.
- Full suite: 4305 passed, 14 failed in 3 files, none touching this change:
  - `lib/creative/authoring/__tests__/editor-workspace.test.ts` and `lib/creative/video-editor/__tests__/static-parity.test.ts`: the known Creative Editor `Estilo`/`Estilos` label drift.
  - `components/videos/video-generation-workspace.test.tsx` (12 tests): `GenerationSessionNavigationProvider is missing` in the test wrapper. Video UI is unrelated to Review and was not changed.
- Production smoke: no authenticated Production session was available and no Gemini execution was run. Gemini is not reachable from any route, so there is no new user-facing surface.

## Settings and schema impact

None. Settings already exposes the Gemini credential card from the prerequisite. No migration, no new table, no new column.

## Residual debt

- `readS3Object` buffers the full object, so a 500 MB video is held in memory during upload. A streaming reader and streaming upload are needed before Video Review is enabled broadly.
- Model IDs were verified against documentation only. The first live Gemini call (Video Review slice, explicitly approved) should confirm the model, `responseJsonSchema` and Files API behavior.
- Cleanup warnings are logged and returned, not persisted: `media_reviews` has no column for them.
- No runtime creator exists for Video artifacts yet, so `resolveAuthorizedReviewMedia` video paths are exercised by tests only.

## Exact next mission

`GEMINI_VIDEO_REVIEW_ADAPTER_V1`: Video Review criteria, universal artifact subject, Gemini native-video execution through this provider, timestamped findings, and asynchronous Review API/UX. It is not started here.
