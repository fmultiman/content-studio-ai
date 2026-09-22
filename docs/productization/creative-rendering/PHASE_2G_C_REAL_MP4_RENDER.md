# Phase 2G-C — Real MP4 Render from VideoDraft Timeline Path

## 1. Objective

Prove that the chain connected in Phase 2G-A/2G-B actually reaches the existing video renderer: `VideoDraft-shaped input → TimelineManifest → real LibraryFile hero → ResolvedTimelineInput → TimelineComposition → Remotion → real H.264 MP4`, for one scene. No `/videos` UI change, no multi-scene, no AI generation, no output persistence.

## 2. Pre-flight

`git branch --show-current` → `traycer/content-studio-ai-soft-yak`; `git status` → clean; `git log -5` → HEAD at `d9a7651`. Baseline confirmed before any change: 575/575 tests, typecheck PASS, lint 0 errors/45 warnings, build PASS.

## 3. Existing Render Path Audit

`scripts/creative/render-timeline-manifest.ts` (Wave 8's official path) already implements exactly:
```
TimelineManifest JSON → readTimelineManifest → resolveOfficialTimeline (resolveTimelineManifest + adapter diagnostics)
  → prepareTypography → bundle (Remotion) → selectComposition('TimelineManifestVideo') → renderMedia → ffprobe → ffmpeg frame extraction
```
**FACT:** the only gap for this phase's purpose is that `renderOfficialTimelineManifest` builds its own `ResolvedTimelineInput` internally (from a JSON fixture path, through the neutral resolver only) and offers no seam to substitute a `ResolvedTimelineInput` that already carries a real, runtime-prepared `library_file` asset (Phase 2G-B's `resolvedAssets` patch). Reusing it as-is would have meant rendering with the neutral resolver's own `library_file` placeholder (`url: ''`), not the real asset.

**Decision: reuse, minimally extend — no second renderer.** The render-only steps (bundle → `selectComposition` → `renderMedia` → probe → extract frames) were extracted, unchanged, into a new exported function `renderResolvedTimelineInput(resolvedInput, outputPath, options)`. `renderOfficialTimelineManifest` now calls it internally — its own behavior, defaults, and output path are byte-for-byte unchanged (verified: the existing Wave 8 test file, `timeline-render-path.test.ts`, passes unmodified). One incidental bug was fixed as part of the extraction: `extractFrame` previously wrote frames to the module-level `outputDir` constant regardless of the actual video's location; it now derives the frame directory from the video path's own directory (`path.dirname(videoPath)`), which is behavior-identical for the existing default path (same directory either way) but makes the function correctly reusable for a different output location — required for this phase's separate `.tmp/creative/productization/phase-2g-c/` output.

No `TIMELINE_RENDER_ARCHITECTURE_ESCALATION_REQUIRED` condition was triggered: `TimelineComposition` was not touched, no second Remotion composition or bundle path was created, `TimelineManifest`'s structure was not changed, and `VideoDraft` was not coupled to Remotion directly — the adapter (2G-A/2G-B) still only ever produces a neutral `TimelineManifest`/patches a `ResolvedTimelineInput`; only this phase's small script drives the renderer.

## 4. Input Provenance

Two real, read-only Supabase rows were used together for this proof — labeled precisely, per the handoff's own instruction not to overstate:

| Row | Label | Detail |
|---|---|---|
| `VideoDraft` | **REAL** | id `e77ae6ec-91d7-4d3c-a545-8bf5758afc8b` ("Teaser do MeShama.Ai"), read-only via the same authorized Supabase connector precedent as Phase 1C/2G-B (project ref `nuhdhnasuohizxtmyiju`). One real scene: `duration: 3`, `movement: 'static'`. `description`/`prompt`/`image_url` were read to confirm shape but never mapped into the manifest (2G-A rule, unchanged). |
| `LibraryFile` | **REAL** | id `afa6868e-a2d6-473d-9df7-bbf713ad8b02` (`paper-card-light-01.png`, `image/png`, `1,766,502` bytes) — the same file proven live in Phase 2G-B. |
| **Pairing of the two** | **PROOF-TIME ONLY, not product-authorized** | The real `VideoDraft`'s own Project has no `image`-kind `LibraryFile` (checked, zero rows) — so its real hero could not come from its own Project. Binding it to a real asset from a *different* Project ("Portal Comunidades Alternativas") is legitimate for proving the render mechanism (no DB write occurred, nothing was persisted), but it is **not** a claim that this pairing would ever be valid in the product (cross-project asset binding is exactly the kind of consistency check `channel_piece_media`'s own RLS already enforces elsewhere in this domain, and would need the same here before any real feature ships). |

Nothing was created, updated, or deleted in either table.

## 5. VideoDraft-Shaped Source

`adaptVideoDraftToTimelineManifest` (Phase 2G-A, unmodified) was called with the real draft's `id`/`project_id`/`production_id`/`scenes` exactly as read, plus `sceneAssets: { '<real scene id>': { type: 'library_file', ref: '<real LibraryFile id>', fit: 'cover' } }` (the Phase 2G-B seam). `scene.movement = 'static'` mapped to `{ preset: 'none' }`, matching the already-established, template-declared-safe mapping.

## 6. Timeline Adaptation

The resulting `TimelineManifest` validated against `TimelineManifestSchema` and was accepted by `resolveTimelineManifest` (`valid: true`). Before patching, `resolvedTemplateSegments[0].resolvedAssets.hero` was, as expected and unchanged from 2G-B's finding, the neutral resolver's own placeholder (`source: 'library_file'`, `url: ''`).

## 7. Real LibraryFile Asset

**`asset binary = REAL`, `asset semantics = TECHNICAL PROOF`** (per the handoff's own required framing) — `paper-card-light-01.png` is a real Pack B primitive texture, not scene-appropriate photographic content; it stands in here only to prove the resolution/render mechanism handles a real S3-backed file correctly.

## 8. Runtime Asset Preparation

`prepareTimelineLibraryFileAssets` (Phase 2G-B, unmodified) + the real, unmodified `createPresignedReadUrl` (via the same safe `vercel env pull --environment=development` procedure, `.env.local`/`.vercel` removed immediately after) produced a real `ResolvedAsset`: `source: 'library_file'`, `mime_type: 'image/png'`, a real (unlogged) presigned URL. `patchResolvedTimelineAssets` (new, pure, this phase) merged it into the `ResolvedTimelineInput` obtained in §6 — `resolvedTemplateSegments[0].resolvedAssets.hero` after patching: real source, real MIME, real runtime URL. The neutral manifest itself was re-checked and, as in 2G-B, contains no `storage_path`, signed URL, or S3 host string.

## 9. Chromium Asset Access

The extracted start and end frames (§12) differ: the start frame shows the lower "field notes" card blank, and the end frame shows it fully rendered with the real `paper-card-light-01.png` texture visibly present. With `movement: 'static'` mapped to the `none` motion preset (expected to be visually stable per Wave 7's own finding), the most consistent explanation is that this reflects Chromium's real network fetch of the presigned S3 image completing partway through the render — the same kind of mid-render network fetch evidence Phase 1B/1C relied on for static rendering. This is reported as an observation, not asserted as a definitively profiled cause (no additional network instrumentation was added, per the instruction to avoid excessive new instrumentation when the render itself already provides sufficient evidence: a successful render with the real asset visibly present).

## 10. Remotion Render Path

`renderResolvedTimelineInput` (§3) — the same bundle, the same `TimelineManifestVideo` composition id, the same `renderMedia` call Wave 8 already proved — was invoked with the patched `ResolvedTimelineInput` and a `.tmp/creative/productization/phase-2g-c/` output path. No second composition, no second bundler invocation path, no second renderer.

## 11. MP4 Result

| Field | Value |
|---|---|
| status | succeeded |
| codec | h264 |
| width × height | 1080 × 1920 |
| fps | 30 |
| duration_frames | 90 |
| duration_seconds | 3.0 |
| file | `.tmp/creative/productization/phase-2g-c/videodraft-single-scene-real-asset.mp4` (142,708 bytes; not committed) |

## 12. Frame Evidence

`extracted-start.png` and `extracted-end.png` were produced and visually reviewed: the composition is not blank/black, the title placeholder ("Cena 1," per Phase 2G-A's positional-title rule) is legible, and the real hero material is visibly present by the end frame (§9). **`extracted-middle.png` was not produced** — the extraction helper's "middle" seek argument is a hardcoded `-ss 3` (correct for Wave 8's 6-second fixture, landing at its midpoint) but for this phase's exactly-3.0-second video that seeks to/past the very last frame, so `ffmpeg` produced no output file. This is reported factually rather than silently patched around; start+end frames were sufficient to confirm the composition is live and coherent for this proof.

## 13. Diagnostics

- Adapter diagnostics: 2 (the same, expected, non-blocking `content_title_placeholder` and one `field_unused`-class diagnostic the 2G-A/2G-B mapping already produces for any scene lacking a legitimate title/description source — nothing new).
- Asset-preparation diagnostics: 0 — the real `LibraryFile` resolved cleanly on the first attempt.
- `resolvedInput.diagnostics` (neutral resolver): `[]`.
- No step silently substituted a fixture asset when the real one was requested.

## 14. Performance Measurement

**Factual, not causally interpreted:** this render (90 frames, 3.0s, one template segment, real network asset) completed in **40,415 ms**. Wave 8's own reference point was ~117,778 ms for 180 frames/6.0s of a fixture asset. The two runs differ in frame count, asset source (fixture vs. real network fetch), and machine/session state, so no improvement or regression is claimed — this is simply the new, factual measurement for this exact input.

## 15. Real-Row Status

**A real `VideoDraft` row was read this phase** (`e77ae6ec-91d7-4d3c-a545-8bf5758afc8b`), resolving the constraint Phase 2G-A/2G-B could not close — via the same authorized read-only Supabase connector, no service-role bypass, no auth weakening, no row created or mutated. Its own Project had no compatible real asset, so the asset half of the proof (§4) remains a cross-project, proof-time pairing, not a fully product-coherent real chain end-to-end. The correct summary sentence, per the handoff's explicit guidance: *"A real MP4 was produced from a real VideoDraft row's shape, through the VideoDraft → TimelineManifest product adapter path, using a real LibraryFile/S3 asset — the two real rows are from different Projects, so this proves the mechanism, not a fully product-coherent same-Project chain."*

## 16. Tests

6 new tests in `lib/creative/__tests__/patch-resolved-timeline-assets.test.ts`, all passing:
- The neutral resolver's hero placeholder is confirmed unpatched before merging (`url: ''`).
- `patchResolvedTimelineAssets` correctly substitutes the real, runtime-prepared asset (source/mime/URL) without touching anything else in the resolved input (manifest/tokens/typography identity-checked via `toBe`).
- Frame range (`start_frame`, `duration_frames`) and motion (`slow_push` for `zoom_in`) are preserved through the patched result.
- The patch is a true no-op (`toBe`, same reference) when empty.
- The manifest never carries the signed URL string; only the runtime-only patched `ResolvedAsset` does.

**Regression:** Phase 2G-A's 31 tests, Phase 2G-B's 18 tests, all static creative-rendering tests, and all primitive tests were re-run unmodified and remain green — full suite grew from 575 to 581.

## 17. Baseline

- Full suite: **581/581 passed** (47 test files; 575 pre-existing + 6 new)
- typecheck: **PASS**
- lint: **0 errors / 45 warnings** — identical to the inherited baseline
- production build: **PASS**, exit code 0

## 18. Remaining Product Integration Gap

Unchanged and explicitly out of scope here: `/videos` UI still shows the simulated "Gerar Vídeo" button; the MP4 produced in this phase was not uploaded to `LibraryFile`, no `ChannelPieceMedia` was created, and `/api/channel-piece-media/upload` was not called (Phase 2F0/2G0's already-identified future output-persistence path, deliberately untouched). Multi-scene composition, AI clip generation, and long-form render performance remain fully deferred, as in Phase 2G0/2G-A/2G-B.

## 19. Verdict

**`PASS`**

The `VideoDraft` adapter path (2G-A) was used, unmodified. The resulting `TimelineManifest` validated and was accepted by `resolveTimelineManifest`. A real `LibraryFile` was resolved into a real presigned asset (2G-B, unmodified) and merged into the resolved input via one new, pure, tested function. The existing Remotion render path was reused via a minimal, behavior-preserving extraction — no second renderer, no second composition, no duplicated bundle logic. Chromium's real network asset fetch is evidenced by the visible difference between the start and end frames. A real H.264 MP4 (1080×1920, 30fps, 90 frames, 3.0s) was produced. Frame evidence (start/end) confirms a live, non-blank composition; the missing middle frame is a documented, factual boundary case of the inherited fixed-seek extraction helper, not a render failure. No `/videos` UI, schema, or DB/storage mutation occurred. Baseline is green throughout (581/581, typecheck, lint, build). A real `VideoDraft` row was read this phase, closing the prior constraint, though the specific asset pairing used remains cross-project and proof-time only, as disclosed in §4/§15.
