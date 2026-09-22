# Phase 2G-D — Same-Project Timeline Provenance Proof

## 1. Objective

Close the one disclosed gap from Phase 2G-C: prove the same `VideoDraft → TimelineManifest → real LibraryFile → ResolvedTimelineInput → Remotion → MP4` chain using a real `VideoDraft` and a real `LibraryFile` that belong to the **same** real Project — no cross-project pairing. Live-proof phase; zero source changes expected and none were made.

## 2. Pre-flight

`git branch --show-current` → `traycer/content-studio-ai-soft-yak`; `git status` → clean; `git log -5` → HEAD at `a571b5c`. Baseline confirmed before any action: 581/581 tests, typecheck PASS, lint 0 errors/45 warnings, build PASS.

## 3. Real VideoDraft

Read-only query (same authorized Supabase connector precedent as Phase 1C/2G-B/2G-C, project ref `nuhdhnasuohizxtmyiju`) for every `video_drafts` row where `project_id` = the Portal project. **Exactly one result** — no ambiguity, no `VIDEODRAFT_SELECTION_REQUIRED` needed:

| Field | Value |
|---|---|
| id | `97bbb8be-ce00-437d-ad9f-acc457cd61f5` |
| name | "Teste Timeline Portal 01" |
| project_id | `8659505e-cd48-4937-9dd9-3f18058210a0` |
| production_id | `c4eb1f9a-0cbe-45e3-8aa2-5b6642b078ae` |
| scene_count | 1 |
| created_at / updated_at | 2026-09-22 01:34:59 / 01:35:56 |

Its one scene: id `bfeef7d1-4c1c-4e52-b5b2-908af6bbb378`, `order: 1`, `duration: 3`, `movement: 'static'`, no `image_url`, no `prompt`. Single-scene, so no scene-selection judgment call was needed.

## 4. Real Project Relationship

Project: **Portal Comunidades Alternativas** (`8659505e-cd48-4937-9dd9-3f18058210a0`). The draft's `project_id` matches this exactly — read directly from the row, not assumed.

## 5. Real LibraryFile

Re-queried (not assumed from prior phases) to confirm current, live state:

| Field | Value |
|---|---|
| id | `afa6868e-a2d6-473d-9df7-bbf713ad8b02` |
| name | `paper-card-light-01.png` |
| kind / mime_type | `image` / `image/png` |
| file_size | 1,766,502 bytes |
| project_id | `8659505e-cd48-4937-9dd9-3f18058210a0` |
| deleted_at | `null` (still valid) |

## 6. Same-Project Assertion

```
VideoDraft.project_id      = 8659505e-cd48-4937-9dd9-3f18058210a0
LibraryFile.project_id     = 8659505e-cd48-4937-9dd9-3f18058210a0
same_project                = true
```

Asserted explicitly in the proof harness before any rendering step, with a hard stop (`SAME_PROJECT_PROVENANCE_FAILED`, no cross-project fallback) wired in had it been false. It was true, so the render proceeded — no cross-project pairing anywhere in this phase, closing the gap Phase 2G-C disclosed.

## 7. Asset Semantics Disclaimer

**Asset binary:** REAL. **Project provenance:** REAL / SAME PROJECT. **Scene semantic relevance:** TECHNICAL PROOF ONLY — `paper-card-light-01.png` is a Pack B primitive texture, not photographic scene content. Its presence proves the resolution/render mechanism handles a real, same-project S3-backed file correctly; it does not represent what this scene's real content would look like.

## 8. VideoDraft Adaptation

`adaptVideoDraftToTimelineManifest` (Phase 2G-A, unmodified) was called with the real draft's `id`/`project_id`/`production_id`/`scenes` exactly as read, plus `sceneAssets: { '<real scene id>': { type: 'library_file', ref: '<real LibraryFile id>', fit: 'cover' } }` — the exact Phase 2G-B seam, no new binding mechanism. `description`/`prompt`/`image_url` were not mapped into the manifest (verified: `image_url` was `null` on this real scene; `description`/`prompt` were read only to confirm shape, then explicitly excluded per the unmodified 2G-A rule). `movement: 'static'` → `{ preset: 'none' }`, the same already-proven mapping.

## 9. TimelineManifest Validation

`TimelineManifestSchema.safeParse` → `success: true`. `resolveTimelineManifest` → `valid: true`, one resolved template segment. Before patching, `resolvedTemplateSegments[0].resolvedAssets.hero` was the neutral resolver's own placeholder (`source: 'library_file'`, `url: ''`), exactly as designed and unchanged since 2G-B/2G-C.

## 10. Runtime Asset Preparation

`prepareTimelineLibraryFileAssets` + the real, unmodified `createPresignedReadUrl` (via `vercel env pull --environment=development`, cleaned up immediately after) produced a real `ResolvedAsset`: `source: 'library_file'`, `mime_type: 'image/png'`, a real (unlogged) presigned URL. `patchResolvedTimelineAssets` (Phase 2G-C, unmodified) merged it in. Post-patch hero: real source, real MIME, real runtime URL. No signed URL, credential, or storage secret was logged, persisted, or committed at any point.

## 11. Remotion Render

`renderResolvedTimelineInput` (Phase 2G-C, unmodified) was called with the patched `ResolvedTimelineInput` and a `.tmp/creative/productization/phase-2g-d/` output path — the same bundle, the same `TimelineManifestVideo` composition, the same `renderMedia` call. No new renderer, no new composition, no source change of any kind.

## 12. MP4 Result

| Field | Value |
|---|---|
| status | succeeded |
| codec | h264 |
| width × height | 1080 × 1920 |
| fps | 30 |
| duration_frames | 90 |
| duration_seconds | 3.0 |
| file | `.tmp/creative/productization/phase-2g-d/same-project-videodraft-render.mp4` (not committed) |

## 13. Frame Evidence

Start, middle, and end frames were all produced and visually reviewed. The proof harness (not the renderer) computed the middle-seek from the video's own real duration (`durationSeconds / 2` = 1.5s) rather than reusing Phase 2G-C's hardcoded `-ss 3`, which had landed past the end of an identically-3.0-second clip and produced no middle frame there. This is a harness-only fix — `renderResolvedTimelineInput`/`render-timeline-manifest.ts` were not touched.

- **Start:** the field-notes card is blank; the torn-paper title card ("CENA 1") is already present and legible.
- **Middle (1.5s) and end (3.0s):** both show the real `paper-card-light-01.png` texture fully rendered in the lower card.

This is the same coherent temporal pattern observed in Phase 2G-C (asset not yet loaded at frame 0, present by mid-clip) — consistent with Chromium's real network fetch of the presigned S3 asset completing during the render, not a blank or broken composition at any point.

## 14. Performance Measurement

**Factual only:** this render (90 frames, 3.0s, one template segment, real network asset, same project) completed in **39,375 ms** — closely in line with Phase 2G-C's 40,415 ms for the equivalent shape (90 frames/3.0s, different real asset pairing). No causal claim is made about the similarity or any prior Wave 8 reference point.

## 15. Mutations

**Zero.** No `LibraryFile` was created or modified. No `ChannelPieceMedia` was created. No `VideoDraft`, `VideoScene`, `Production`, or `Project` row was modified. The MP4 was not uploaded anywhere and was not persisted outside the local, git-ignored `.tmp/` directory. The only "write" in this entire phase was local, temporary filesystem output under `.tmp/`, never committed.

## 16. Source Changes

**Zero.** The existing `VideoDraft → TimelineManifest` adapter (2G-A), the scene-asset-binding seam and `prepareTimelineLibraryFileAssets`/`patchResolvedTimelineAssets` (2G-B/2G-C), and `renderResolvedTimelineInput` (2G-C) all worked exactly as already implemented. The only new code this phase was a temporary, uncommitted proof script (`scripts/creative/phase-2g-d-render-proof-TEMP.mjs`, deleted after use) that wired the existing modules together and computed a duration-aware middle-frame seek for its own evidence capture. `git status` was empty at the end of this phase.

## 17. Validation

Given zero source changes, the full baseline was still re-run for certainty rather than assumed from Phase 2G-C:
- Full suite: **581/581 passed** (47 test files) — identical count to the inherited Phase 2G-C baseline, confirming nothing regressed.
- typecheck: **PASS**
- lint: **0 errors / 45 warnings** — identical to the inherited baseline
- production build: **PASS**, exit code 0

No new tests were added — the phase's own instruction not to write artificial tests when zero source changed was followed; the proof itself (§3–§13) is the validation.

## 18. Remaining Product Gap

Unchanged from Phase 2G-C/2G0: `/videos` UI still shows the simulated "Gerar Vídeo" button; no MP4 output-persistence path (`LibraryFile` upload, `ChannelPieceMedia` creation) was exercised or is proposed here; multi-scene composition, AI clip generation, and long-form render performance remain fully deferred.

## 19. Verdict

**`PASS`**

A real `VideoDraft` (unambiguous, single candidate) and a real `LibraryFile` were located read-only, both confirmed to belong to the same real Project (Portal Comunidades Alternativas) — the exact cross-project gap Phase 2G-C disclosed is closed. The existing adapter, asset-binding seam, runtime LibraryFile preparation, timeline resolver, and Remotion renderer were reused entirely unmodified. `TimelineManifestSchema` and `resolveTimelineManifest` both accepted the manifest. A real H.264 MP4 (1080×1920, 30fps, 90 frames, 3.0s) was produced, with coherent, non-blank start/middle/end frame evidence. Zero DB/storage mutation occurred, zero cross-project pairing was used, and zero source changes were made — baseline remains green throughout (581/581, typecheck, lint, build).
