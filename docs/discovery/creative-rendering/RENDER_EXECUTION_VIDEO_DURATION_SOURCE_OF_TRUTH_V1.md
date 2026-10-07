# RENDER_EXECUTION_VIDEO_DURATION_SOURCE_OF_TRUTH_V1

## Closure

- Baseline: `origin/main` `06ecefada712e66ea085a2e7e3b76774b49cf51d`.
- Branch: `fix/render-execution-video-duration-source-of-truth-v1`.
- Schema: **no migration**. Production data: **no row was read-modified or repaired**; no historical artifact was mutated.
- Paid provider calls: **0**. No UI, no worker change, no Image Review change.

## The factual mismatch

During `LIVE_GEMINI_VIDEO_REVIEW_VALIDATION_V1`, LibraryFile `0c5e4fba-142f-4ed5-b353-b2be089ef0e2` (a saved render) was registered through the **Library** source. The artifact stored `duration_ms = 3051`, read from the MP4's own `moov` box, and Gemini described a 3-second clip. Its source RenderExecution records `output_duration_ms = 10896`.

## Root cause

`render_executions.output_duration_ms` is **not the media duration**. It is the renderer's elapsed wall-clock time:

- `infra/render-worker-runtime/server.mjs` answers a render with `duration_ms: Date.now() - startedAt` (how long rendering took), alongside the real `duration_frames` and `fps`.
- `coordinator.mjs` forwards that value as `outputDurationMs`, and `POST /api/render-executions/[id]/complete` requires a positive number and stores it as `output_duration_ms`.

So every historical render's `output_duration_ms` is render time (10.9 s to render a 3.05 s clip). The field is misnamed for what it holds. In the repo, the **only** consumer that read it as a media duration was the artifact registration; the API selects and the TypeScript type merely expose the column and no UI renders it.

## Old authority path (the bug)

```
RenderExecution.output_duration_ms
  -> resolveRenderExecution()            lib/media-artifacts/video.ts   (durationMs: positiveInt(data.output_duration_ms))
  -> ResolvedVideoSource.known.durationMs
  -> registerVideoArtifact()             durationMs: source.known.durationMs ?? probed.durationMs
                                         (and no probe at all when duration + width + height were already known)
  -> media_artifacts.duration_ms         immutable
```

A render-sourced artifact therefore stored render wall-clock time as its duration, silently, and it would have fed `adapterResult.durationMs`, the review prompt's "VIDEO FACTS" and the 10-minute guardrail. The pre-read duration pre-check in `video-service.ts` used the same recorded value to veto a Review before reading the object.

## Corrected authority path

```
stored bytes (MP4 moov via bounded ranged reads, no download, no ffmpeg)
  -> probeMp4()                          lib/media-artifacts/mp4-metadata.ts
  -> registerVideoArtifact()             durationMs: probed.durationMs   (every source family, always)
  -> media_artifacts.duration_ms
```

- `KnownVideoFacts` no longer has a `durationMs` field at all, so no source family can supply one. The mistake is now structurally impossible rather than merely avoided.
- `resolveRenderExecution` no longer selects `output_duration_ms`.
- The probe always runs, for every source family, so the duration cannot depend on which family registered the object. The Library and Video Generation paths already worked this way.
- The pre-read duration veto in `video-service.ts` is removed. A recorded value can neither reject nor approve a video; the real duration is enforced by `resolveAuthorizedReviewMedia` after registration (unknown or over 10 minutes still fails closed, limits unchanged).
- The size pre-check on the recorded size stays: size is cross-checked against the streamed bytes (a disagreement is `SIZE_MISMATCH`), and the artifact stores the bytes actually counted.

### Failure semantics (decided and documented)

- Container cannot prove a duration (no readable `moov`, fragmented MP4, not an MP4): `duration_ms` stays `NULL` and the Review **fails closed** with the existing "Video size and duration must be known" error. There is **no fallback** to any recorded value.
- **Changed:** a *storage failure* while probing now aborts registration (`STORAGE_UNAVAILABLE`, nothing is written) instead of being swallowed into a `NULL`. Before this change a transient range-read error could permanently freeze an unknown duration into an immutable artifact; with render sources now probed on every registration that exposure would have grown. A parse-level unknown is permanent and honest; a transient read failure is not.

## Audit of the other intrinsic facts

| Fact | Result |
|---|---|
| Size (`byte_size`) | Already authoritative: the artifact stores the bytes actually streamed; the recorded size is only a cross-check. No change. |
| MIME | Render: constant `video/mp4`, enforced by the eligibility policy and the `.mp4` scratch key. Video Generation: recorded value or `video/mp4` from the validated `.mp4` key. Library: the row's `mime_type` (a user-writable claim) is not verified against the bytes; a non-MP4 mislabeled as MP4 still fails closed on duration. Recorded as a residual, not changed (no evidence of a mismatch). |
| Width/Height | Render sources still prefer the worker-recorded `output_width/height`. These come from `composition.width/height` (the configured output size) and are semantically intrinsic, and they equal the file's `tkhd` size in the live case (1080x1920 both). Per the mission scope they were **not** changed; if the invariant is later extended to dimensions it is the same one-line change. |

## Cross-source identity semantics

Artifact identity is unchanged: `(owner, media_type, storage_provider, storage_path, content_hash)` with `identity_mode = 'sha256'`.

- A Library copy of a render (what "Save to Library" produces) is a **different physical object at a different key**, so under the existing contract it is a different artifact with the same `content_hash`. Both orders (Library -> Render, Render -> Library) yield the same real duration for both artifacts, and re-registering either source adds nothing.
- The *same key* reached through two families cannot happen through the public API (a Library key and a render scratch key live in different trusted namespaces). At the registration boundary, two resolved sources on one key converge on **one** artifact in either order, with the real duration and one provenance row per family.
- No artifact is created or rewritten merely to correct metadata.

## Production audit (read-only, before any change)

- Exactly **1** video artifact, `e62bad5b-f077-489b-99e1-68d71b1ff004`, `duration_ms = 3051`, provenance kind `library` only.
- **0** `render_execution` provenance, **0** `video_generation` provenance: no incorrectly registered render artifact exists, so there was nothing to repair.
- 1 video Review (completed), 17 Image Reviews, hash `b7eb6d5a253a215d91f2e6b477b3a8c4`.
- 24 completed video RenderExecutions exist; each `output_duration_ms` is render wall-clock time and must not be read as media duration.

## Tests

- `media-artifacts/__tests__/video.test.ts`: the render fixture now records `10896` against an 8000 ms MP4 and the artifact says 8000; the live case (recorded 10896, file 3051) yields 3051; an unreadable container yields `NULL` rather than the recorded value; a probe storage failure writes nothing; cross-source A and B orders; the Library-copy-is-a-distinct-artifact case; same-key convergence in both orders.
- `reviews/__tests__/video-service.test.ts`: a recorded duration above the cap cannot veto a real 8 s clip; a recorded tiny duration cannot approve an unreadable file; an over-long file is rejected on its real duration; the 40 MiB streaming test now uses a large valid MP4 (lazy, `moov` at the end) and still proves bounded chunks and no whole-object join.
- A mutation check (hard-wiring the old wrong value) fails 17 tests.
- Regression: Image Review, Gemini provider/upload, storage/streaming, RenderExecution and the credential boundary suites are unchanged and green.

## Impact

- Migration: none. Production data: none touched. API shape: unchanged. Worker: unchanged.
- Behavior change visible only to render-sourced Video Reviews: their artifact duration, prompt facts and guardrail now reflect the file.

## Residual limitations

- The worker still stores render wall-clock time in `output_duration_ms` (misnamed). Fixing or renaming it needs an operator-only worker deploy and is out of scope; until then treat the column as "render time".
- Dimensions for render sources are still recorded-first (see audit).
- Fragmented MP4s (no `moov` duration) and non-MP4 containers have no readable duration and therefore cannot be Reviewed (fail closed).
- The probe runs after the full hash read of the same object; an object replaced between the two reads is not detected here (the Review stream re-verifies the hash).
- Library `mime_type` is a claim that is not checked against the bytes.
