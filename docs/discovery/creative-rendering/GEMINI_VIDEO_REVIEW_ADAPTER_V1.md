# GEMINI_VIDEO_REVIEW_ADAPTER_V1

## Closure

- Baseline: `origin/main` `24634901fe4726528973018c232ddff50b84af9e` (migration 060 applied and verified in Production before this work resumed).
- Branch: `feat/gemini-video-review-adapter-v1`.
- Schema: **no migration**. Migration 060 (`media_reviews` image | video) is present in Production and was reproduced exactly in the test database. No 061 was needed.
- Paid provider calls: **0**. Gemini, Kling, OpenAI and Nano Banana were never called; every transport is mocked.
- UI: none. No Review button, panel, provider picker or Creative Editor/Library entry point.
- Existing Production data: the 17 Image Reviews are untouched (this change writes no rows by itself and Production has 0 Video Review rows).

This slice wires the pieces built earlier into one backend path and nothing else:

```
typed source → owner-scoped source resolution → ensure/reuse media_artifact (+ provenance)
  → trusted media authorization (limits, trusted path) → server context
  → immutable media_review (pending) → Gemini execution provider
  → authorized byte STREAM → Files API → strict structured result → completed/failed media_review
```

Review stays **advisory**: it never approves, blocks or mutates a video or its source, and it carries no approval field.

## API contract

`POST /api/reviews/video` — session-authenticated, Node runtime, `maxDuration = 300`.

Request (strict; any extra key anywhere is `400 INVALID_BODY`):

```json
{ "source": { "kind": "video_generation | render_execution | library_file", "id": "<uuid>" }, "clientRequestId": "<uuid>" }
```

The browser can never send a URL, bucket, storage key, MIME type, size, duration, width, credential, provider, model, project, production or artifact id. The provider is a server decision (`gemini`), the model comes from the existing registry/config, and the credential is the user's BYOK key resolved server-side.

Response `201` (new) or `200` (replay of the same `clientRequestId` + same request): `{ review, replayed }` where `review` is the shared `ReviewRecordV1` with `subject: { mediaType: "video", artifactId }`. No storage key, bucket, credential, provider payload or approval field is returned.

Errors use the existing Review vocabulary:

| Case | Status / code |
|---|---|
| unauthenticated | 401 `UNAUTHORIZED` |
| invalid/extra body, bad kind, non-UUID id | 400 `INVALID_BODY` (413 `PAYLOAD_TOO_LARGE`) |
| unknown or another user's source | 404 `REVIEW_SUBJECT_NOT_FOUND` (indistinguishable by design) |
| source not a completed video (queued/claimed/failed render, still render, trashed or non-video Library file, unfinished generation) | 422 `REVIEW_OUTPUT_UNAVAILABLE` |
| stored key outside the owner's trusted namespace | 422 `REVIEW_OUTPUT_UNAVAILABLE` |
| storage unreadable / size mismatch / hash or length mismatch while streaming | 422 `REVIEW_OUTPUT_UNAVAILABLE` (recorded as a failed Review when it happens during execution) |
| oversize, over-long, or unknown size/duration | 422 `REVIEW_PROVIDER_UNSUPPORTED` |
| `clientRequestId` reused for a different request | 409 `REVIEW_IDEMPOTENCY_CONFLICT` |
| another Review of this artifact is in flight | 409 `REVIEW_IN_PROGRESS` (+ `reviewId`) |
| no Gemini key configured | 422 `REVIEW_PROVIDER_NOT_CONFIGURED` (recorded as failed) |
| malformed provider output | 502 `REVIEW_INVALID_EVALUATOR_RESPONSE` (recorded as failed) |
| provider/upload/model failure | 502 `REVIEW_PROVIDER_ERROR` (recorded as failed) |
| Files API processing timeout | 504 `REVIEW_PROVIDER_TIMEOUT` (recorded as failed) |
| persistence failure | 503 `REVIEW_STORE_UNAVAILABLE` |
| anything unexpected | 500 `REVIEW_INTERNAL_ERROR` (never echoed) |

Pre-flight rejections (source, trust, guardrails) happen **before** a Review row exists, like Image context failures. Everything from credential resolution onward is recorded as a failed Review row, like Image.

## Typed source families

Named as the code names them: `video_generation` (→ `video_generations`), `render_execution` (→ `render_executions`, completed `kind='video'` only), `library_file` (→ `library_files`, `kind='video'`, not trashed). They map onto `ensureVideoArtifact`'s `video_generation | render_execution | library` sources.

## Artifact resolution and provenance

`lib/reviews/video-service.ts` uses the two halves of the artifact foundation separately so a guardrail can run between them:

1. `resolveVideoArtifactSource` — owner-filtered row, trusted-path check per family, trusted known facts.
2. Pre-read guardrail on those recorded facts (size > 500 MB or duration > 10 min is rejected **before** the object is read or hashed).
3. `registerVideoArtifact` — idempotent create/reuse of the sha256 artifact and its typed provenance (`provenance_key`, `ON CONFLICT (artifact_id, provenance_key)`); a second Review of the same video takes the provenance fast path and reads no storage for registration.
4. `resolveAuthorizedReviewMedia` — owner re-check, kind, trusted path, size/duration limits (unknown fails closed).

No Library move, rewrite or public exposure occurs; the Library object is only read. The known Library-move key debt was not touched and did not block reviewing the current LibraryFile.

## Authorization

Browser → typed id only. Server loads every row filtered by the authenticated user (service-role client with explicit `user_id` filters; `lib/reviews/video-service.ts` is registered in the existing service-role allowlist test with the same justification as the Image Review service). Cross-user is not-found. Storage is opened only after the family's trusted-path rule passes, and only for the key derived from the row's own owner. The request schema has no field through which a URL, key or credential could enter.

## Context

Resolved server-side from the **artifact's own scope** (migration 060: a Review's Project/Production equal the artifact's, NULL-safe): Project context, evaluation mode, normalized Identity, Production. A Library video with no Project/Production is reviewed with an explicit empty context (`PROJECT CONTEXT: None`). Source context: the submitted prompt, mode, provider and model for `video_generation`; origin for `library_file`; nothing for `render_execution` (authored composition, not a prompt). The request fingerprint excludes the capture time, so replays of the same request are stable.

## Video criteria (what the adapter asks the provider to evaluate)

`lib/reviews/adapters/video.ts` (`video` / `video-review-v1`, prompt `video-review-prompt-v1`). The adapter owns criteria, prompt, context shape, schema hint and strict parsing; it owns no transport.

- Always: `visual_consistency`, `composition_readability`, `temporal_coherence`, `technical_defects`.
- Only when applicable: `pacing` (only if inferable), `text_caption_legibility` (only if text is visible), `brand_context_alignment` (only if Project identity/context exists), `prompt_adherence` (only if a submitted prompt exists).
- **Audio is not evaluated.** The instruction restricts the evaluator to visuals and no audio criterion exists, so no audio claim can be recorded. (The uploaded file may carry an audio track; whether Gemini uses it is unproven and out of scope.)
- `refinedPrompt` is `null` unless the source has a prompt; when present it is advisory text stored with the immutable Review, never applied.
- The result envelope is the shared `ReviewResultV1` (`adapterResult.analyzed = "visual_only"`); parsing reuses the strict shared parser. Unknown criterion keys are accepted as the Image adapter does (they are labelled evidence, not authority).

## Provider boundary

The adapter builds `{ instructions, input, responseSchema }`; `createGeminiReviewProvider` (unchanged) owns authentication, model, transport, Files API lifecycle, timeout, cleanup and raw response. The model is the existing registry/config value (`gemini-3.5-flash` by default); it is not browser-selectable and was not changed.

## Streaming path (PR #140)

Video bytes only ever flow through `AuthorizedReviewMedia.openStream()`: S3 stream → length + SHA-256 verifier → 8 MiB chunker → resumable Files API upload; the final chunk is sent only after the source is drained and verified, so a changed object aborts before any remote file exists. A video's `load()` refuses, `readS3Object` is never reached, and the provider rejects video media without a stream. Tests make the default readers throw and assert the exact uploaded bytes (SHA-256) and chunk bounds for a 40 MiB object.

File lifecycle: start → chunks → finalize → poll until ACTIVE (bounded) → `generateContent` → best-effort `DELETE`. A cleanup failure is a logged warning (codes only: no key, no file id) and never changes an otherwise successful Review.

## Persistence

`subject_media_type='video'`, `image_attempt_id` and `image_output_id` NULL, `media_artifact_id` set, `project_id`/`production_id` equal to the artifact's. Lifecycle `pending → running → completed | failed`; `evaluator_provider/model/prompt_version`, score, assessment, summary, payload and refined prompt recorded; immutable once terminal (the 060 guards). One artifact may have many completed Reviews; at most one `pending`/`running` Review exists per artifact (`media_reviews_active_video_artifact_key`), which the service checks first and also maps from the database error under a race.

## Repository / contracts

`ReviewRecordSchema.subject` is now a discriminated union: image keeps `attemptId/outputId/artifactId`; video carries only `artifactId` (strict; image links on a video subject are rejected). `MediaReviewRow` image link columns are nullable and `toReviewRecord` refuses a corrupt Image row rather than coercing it. `findActiveReviewByArtifact` was added. The Image Review service, context, adapter behavior and `POST /api/reviews/image` are unchanged (only `assessment()` was exported from the image adapter for reuse).

## Tests (all mocked; no network, no provider)

- `video-service.test.ts` (32): each source family end to end with the real artifact, media, provider and Files API client; reuse/provenance; replay; conflict; in-flight guard (application and database race); wrong user; untrusted keys; incomplete/non-video sources; size, duration and unknown-duration guardrails; streaming and no whole-object read; Files API order; cleanup attempt and non-fatal failure; malformed output, upload failure, processing timeout, model failure, rejected key, missing credential; hash change after registration aborts before finalize; storage read failure; persistence failures; context.
- `video-review-db-compat.test.ts` (4): every artifact, provenance and Review statement the service issues is replayed into the REAL migration history (054–060, PGlite) — shape, scope, provenance key, refined-prompt consistency, lifecycle and failure rows all accepted; forbidden shapes refused by the real database.
- `video-contracts.test.ts`, `adapters/__tests__/video.test.ts`, `video-route.test.ts`: typed-source-only schema (every forbidden field), discriminated record, adapter prompt/criteria/no-audio/parse/map, route auth/validation/error mapping/no leakage.
- Regression: the existing Image Review suites (`service`, `contracts`, `adapters/image`, `media`, Gemini provider) are unchanged and green; `credential-boundary` was updated only to register the new server-only service.

## Limits of this validation (explicit)

- **No live Gemini call was made.** The external contract is proven only against mocks of the documented resumable-upload and `generateContent` shapes. See `LIVE_GEMINI_VALIDATION_REQUIRED` in the closure report: whether `gemini-3.5-flash` accepts the uploaded MP4 for video understanding, whether `responseJsonSchema` is honored with `fileData`, and the real processing time are unproven.
- No successful Review can be produced in Preview without a Gemini key and a paid call; Preview smoke covers route existence, auth and rejection paths only.

## Residual gaps

- Live Gemini validation (above).
- First registration of a large video hashes it inside the request (bounded memory, but time scales with size); a background pre-registration job is a possible later optimization.
- No Review history endpoint for video (`GET`) and no UI; both are later missions.
- Observed, **not changed** (Image behavior is frozen here): `resolveImageReviewContext` includes `capturedAt` in its fingerprint, so an Image replay with the same `clientRequestId` may compute a different fingerprint and answer `REVIEW_IDEMPOTENCY_CONFLICT`. The Video path excludes the capture time.
- Library moves still rewrite object keys and can leave an older artifact stale (known debt; a moved file is re-registered as a new artifact on next Review).
