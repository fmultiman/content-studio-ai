# Phase 2G-B — Real LibraryFile Asset Boundary for VideoDraft Timeline

## 1. Objective

Prove, for one scene, the full chain `VideoScene → timeline adapter → AssetRef(type=library_file) → real LibraryFile resolution → ResolvedAsset → resolveTimelineManifest`, using a real, already-existing `LibraryFile`. No MP4 render, no `/videos` UI change, no video generation, no multi-scene work.

## 2. Existing `library_file` Resolution Audit

1. **Where `library_file` is a stub today:** `lib/creative/assets/resolve-asset.ts` — the neutral `resolveAsset()` used inside `resolveTimelineManifest`/`resolveStaticRenderManifest` returns, for `type: 'library_file'`, a placeholder `{ url: '', mime_type: 'image/*' }` with the comment *"Empty until resolved by integration layer or authoring proxy."* This is unchanged in this phase, deliberately.
2. **Where Static already completes the path:** `lib/creative/integration/library-file-adapter.ts` — `adaptLibraryFileToResolvedAsset(file, context)`, proven in Phase 1B (schema/adapter) and Phase 1C (live DB + live S3 GET + live Chromium fetch). It takes a real `LibraryFile` row plus an injected `createPresignedReadUrl`, and returns a real `ResolvedAsset` or explicit `null` on failure. **This phase reuses it directly — it is not duplicated.**
3. **Where primitive rendering completes the path:** Static authoring's own render route (`app/api/creative/static-authoring/render/route.ts`, confirmed in Phase 2E-A/2F0/2F-A) resolves real primitive `LibraryFile`s server-side and hands already-resolved URLs to the render script — a second, bespoke instance of "real resolution happens outside the neutral resolver," consistent with #4 below.
4. **Genuinely reusable parts:** `adaptLibraryFileToResolvedAsset` itself — pure, storage-agnostic (dependency-injected presign), asset-kind-agnostic (works for any `LibraryFile`, not static- or timeline-specific). This is the one piece worth reusing as-is.
5. **Static/authoring-specific parts:** the *caller* of that adapter differs per surface (static's render route wires it one way; this phase wires it for Timeline) — that wiring is legitimately surface-specific and not shared, because each surface has its own manifest shape and its own way of knowing which `LibraryFile` belongs where.
6. **Duplication check:** no second `LibraryFile → ResolvedAsset` adapter was found or created. Only one exists in the repository (`library-file-adapter.ts`), and both Static and this Timeline phase call it.
7. **Smallest correct boundary for Timeline:** a new, Timeline-specific *orchestration* module that walks a `TimelineManifest`'s template segments, finds `library_file` asset slots, and calls the existing adapter per slot — never a new resolution algorithm.

## 3. Static Integration Reuse

**Decision: reuse, do not duplicate.** `lib/creative/timeline-adapter/prepare-scene-assets.ts` imports `adaptLibraryFileToResolvedAsset` and `ProductAssetAdapterContext` from `lib/creative/integration/library-file-adapter.ts` unmodified. The only new code is the walk over `TimelineManifest.segments` to find which slots need real resolution and to call the existing adapter for each — the per-file resolution logic itself is 100% the same code Static already proved in Phase 1B/1C.

## 4. Neutral vs Runtime Boundary (preserved, not redesigned)

**FACT, confirmed by re-reading `resolve-timeline.ts`:** `resolveTimelineManifest` stays fully synchronous and calls `resolveAsset()` (the stub) for every asset, including `library_file` ones. It was **not** made async and **not** taught to call Supabase/S3 — doing so was explicitly a stop condition for this phase, and the architecture that separates "neutral resolution" from "async product/runtime preparation" (documented in `PHASE_2D0` and demonstrated by Phase 1B's own proof script never routing real assets through the neutral resolver) is still correct and was preserved.

The new `prepareTimelineLibraryFileAssets()` function is a **separate, async, product-layer step** — exactly mirroring how `scripts/creative/phase-1b-proof.ts` hand-assembles a `resolvedInput` with the real asset slotted in rather than asking the neutral resolver to produce it. A caller wanting the real URL merges `prepareTimelineLibraryFileAssets()`'s output into a `ResolvedTimelineInput` obtained from `resolveTimelineManifest()`, the same two-step pattern Static already uses.

No stop condition was triggered: `AssetRef`'s global contract was not changed, `resolveTimelineManifest` was not made async, no Supabase/S3 import entered any neutral module, Static's asset preparation was not redesigned, and no second, competing resolution architecture was created.

## 5. Scene Asset Binding Model

`AdaptVideoDraftInput` (from Phase 2G-A) gained one new, optional, additive field:

```ts
sceneAssets?: Record<string /* VideoScene.id */, AssetRef>
```

A scene with an entry in `sceneAssets` uses that binding for its `hero` slot; a scene without one still falls back to the existing default fixture hero (Phase 2G-A behavior, unchanged and regression-tested). `VideoScene.image_url`/`description`/`prompt` remain exactly as excluded as Phase 2G-A left them — verified again in this phase's tests with a live binding present, to prove the two concerns (explicit binding vs. raw scene fields) don't get confused with each other.

## 6. AssetRef Shape

The manifest asset slot uses the existing, unmodified `AssetRef` shape (`lib/schemas/creative/primitives.ts`): `{ type: 'library_file', ref: <LibraryFile.id>, fit?, focal_point?, alt? }`. No `storage_path`, signed URL, S3 endpoint, or credential ever enters this object or the manifest — verified by a test that serializes the full manifest and asserts none of `storage_path`, the real S3 host, or an AWS signature query parameter pattern appear anywhere in it.

## 7. LibraryFile Mapping

**Real LibraryFile used** (read-only, via the same authorized read-only Supabase connector precedent set in Phase 1C, project ref `nuhdhnasuohizxtmyiju`, "Content Agent Studio"):

| Field | Value | Label |
|---|---|---|
| Project | `Portal Comunidades Alternativas` (`8659505e-cd48-4937-9dd9-3f18058210a0`) | REAL |
| LibraryFile id | `afa6868e-a2d6-473d-9df7-bbf713ad8b02` | REAL |
| name | `paper-card-light-01.png` | REAL |
| kind / mime_type | `image` / `image/png` | REAL |
| file_size | `1766502` bytes | REAL |
| storage_path | (redacted — never printed here or in any committed file) | REAL, not disclosed |

**Audit result:** this Project's only two `kind='image'` `LibraryFile` rows are the two Pack B primitives (`paper-card-light-01.png`, `tape-kraft-short-01.png`) — no separate "hero photo" asset exists yet for this Project. Per the handoff's own explicit allowance, this real file is used as a **technical proof** of the resolution path, not as a claim that a paper texture is meaningfully a video scene's hero content:

**`asset semantics = fixture/proof` · `asset binary = REAL`.**

The unit tests use a *real-shaped* `LibraryFile` fixture object carrying this same real id/kind/mime/file_size (so MIME/kind assertions are meaningful) but a placeholder `storage_path` string, since the real path was only ever handled transiently by the live proof script (§9) and is not committed anywhere.

## 8. Runtime Preparation

`lib/creative/timeline-adapter/prepare-scene-assets.ts` exports `prepareTimelineLibraryFileAssets(manifest, lookupLibraryFile, context)`:
- Walks every `template` segment's asset slots.
- Skips anything that isn't `type: 'library_file'` (fixture assets are left to the neutral resolver, unchanged).
- Looks up the real `LibraryFile` via a caller-supplied, synchronous `lookupLibraryFile` (no DB call inside this module).
- Calls the existing `adaptLibraryFileToResolvedAsset` (§3) with a caller-supplied `context.createPresignedReadUrl`.
- Returns `{ resolvedAssets: Record<"<segmentId>:<slot>", ResolvedAsset>, diagnostics }` — never throws for expected failure modes; every failure becomes an explicit `asset_unresolved` diagnostic instead (§12).

No Supabase, S3, Remotion, React, or Next import exists in this file or anywhere under `lib/creative/timeline-adapter/` — verified by an automated isolation test mirroring the existing `lib/schemas/creative/__tests__/isolation.test.ts` pattern.

## 9. S3 Read Proof (live, real)

Performed once, read-only, using the same safe procedure as every prior phase (`vercel link` + `vercel env pull --environment=development`, used only for the duration of this proof, both files removed immediately after — confirmed git-ignored throughout and absent from the final `git status`).

1. Confirmed the object is **not** publicly reachable: a plain GET on `public_url` returned `HTTP 403`.
2. Called the real, unmodified `createPresignedReadUrl()` (`lib/storage/s3.ts`) with the real `storage_path` → got a real signed URL.
3. `GET` on that signed URL:

| Check | Result |
|---|---|
| HTTP status | **200** |
| Content-Type | **image/png** |
| Bytes received | **1,766,502** — exactly matches the DB's `file_size` |

4. Ran this same real presign+GET through the actual `adaptLibraryFileToResolvedAsset` + `prepareTimelineLibraryFileAssets` code (not a reimplementation) against a manifest produced by the real `adaptVideoDraftToTimelineManifest`. Result: `resolvedAssets["scene:scene-1:hero"] = { source: 'library_file', mime_type: 'image/png', url: <real signed URL, not logged> }`.

No signed URL, credential, or storage secret was logged, persisted, or committed. Redacted summary saved to `.tmp/creative/productization/phase-2g-b/execution-summary-redacted.json` (git-ignored, confirmed via `git status --porcelain --ignored`) — reproduced here with the URL itself omitted:

```json
{
  "phase": "2G-B",
  "manifest_schema_version": "timeline.v0",
  "manifest_valid": true,
  "resolved_template_segments": 1,
  "library_file_ref": "afa6868e-a2d6-473d-9df7-bbf713ad8b02",
  "library_file_kind": "image",
  "library_file_mime_type": "image/png",
  "library_file_size_bytes": 1766502,
  "runtime_resolved_asset": { "source": "library_file", "mime_type": "image/png", "has_runtime_url": true },
  "runtime_prep_diagnostics": [],
  "real_s3_get_proof": { "http_status": 200, "content_type": "image/png", "byte_length": 1766502 }
}
```

## 10. Single-Scene Proof

One `VideoScene` (`duration: 3, movement: 'zoom_in'`), bound via `sceneAssets: { 'scene-1': { type: 'library_file', ref: <real id>, fit: 'cover' } }` → `adaptVideoDraftToTimelineManifest` → valid `TimelineManifest` → `resolveTimelineManifest` accepts it (`valid: true`, one resolved template segment) → `prepareTimelineLibraryFileAssets` (using the real presign function during the live proof, §9; a fake one in the committed unit tests) → real `ResolvedAsset` with `source: 'library_file'`, real MIME, real byte-verified URL.

## 11. Resolver Acceptance

Confirmed via test and via the live script: `TimelineManifestSchema.safeParse(manifest).success === true`, and `resolveTimelineManifest(manifest).valid === true` — the neutral resolver accepts a manifest carrying a real `library_file` `AssetRef` exactly as it accepts a fixture one (its own internal resolution for that slot remains the pre-existing placeholder, by design, §4 — the *real* value comes from the separate runtime-preparation step, not from the neutral resolver).

## 12. Failure Behavior

All covered by tests, none silently falling back to a fixture:

| Case | Result |
|---|---|
| Unknown `LibraryFile` ref (lookup returns nothing) | `asset_unresolved` / `library_file_not_found`, no resolved asset produced |
| Non-image `LibraryFile` (`kind !== 'image'`) | `asset_unresolved` / `library_file_unresolvable` (via the existing adapter's own `null` return) |
| Missing `storage_path` | `asset_unresolved` / `library_file_unresolvable` (existing adapter's own guard) |
| Presign failure (`createPresignedReadUrl` returns `null`) | `asset_unresolved` / `library_file_unresolvable` |
| Unsupported `AssetRef.type` (not `library_file`) | Skipped by this module (left to the neutral resolver/fixture path — not this module's concern) |

## 13. Tests

18 new tests in `lib/creative/__tests__/prepare-scene-assets.test.ts`, all passing:
- **Adapter boundary** (4): explicit binding lands in the manifest; unbound scenes still fall back to the fixture default; `image_url` stays ignored even alongside a real binding; no storage_path/signed-URL/S3-host string ever appears in the serialized manifest.
- **LibraryFile mapping** (2): a real-shaped `library_file` `AssetRef` validates through the manifest schema; real MIME (`image/png`) is preserved through `adaptLibraryFileToResolvedAsset`.
- **Runtime preparation** (6): resolved URL is runtime-only and never equals `storage_path`; `storage_path` surfaces only as `ResolvedAsset.path` (an internal field), not a "leak"; explicit failure for an unknown ref, a non-image kind, a failed presign, and a missing `storage_path` — none silently substitute a fixture.
- **Timeline** (3): schema validation; `resolveTimelineManifest` acceptance; the runtime-prepared hero reports `source: 'library_file'` with the real MIME and a runtime URL.
- **Isolation** (3): no Supabase/S3/Remotion/React/Next import anywhere under `lib/creative/timeline-adapter/`; `DocumentaryCard.tsx` has no Supabase/S3 import; `remotion/timeline/TimelineComposition.tsx` has no `LibraryFile`/Supabase lookup.

**Regression:** all 31 Phase 2G-A tests still pass unmodified (the `sceneAssets` addition is purely additive), and the full suite grew from 557 to 575 with zero pre-existing failures.

## 14. Baseline

- Full suite: **575/575 passed** (46 test files; 557 pre-existing + 18 new)
- typecheck: **PASS**
- lint: **0 errors / 45 warnings** — identical to the inherited baseline
- production build: **PASS**, exit code 0

## 15. Remaining VideoScene Media Debt

Unchanged from Phase 2G-A/2G0: `VideoScene.image_url` (raw base64) is still never interpreted as an asset — a future phase would need an explicit, separate step to turn a user-uploaded scene image into a real `LibraryFile` (mirroring the static "Salvar nesta peça" flow from Phase 2F-A) before it could ever appear in `sceneAssets`. This phase deliberately did not build that step.

## 16. Deferred Video/Audio Assets

Not addressed, as instructed: video clip assets, audio/voiceover/music tracks, multiple overlays, and background layers. `prepareTimelineLibraryFileAssets` only processes the `hero` slot of `template` segments and only for `kind: 'image'` `LibraryFile`s — extending it to other asset kinds is future work, not attempted here.

## 17. Verdict

**`PASS`**

An explicit scene-asset-binding seam exists (`sceneAssets`), additive and non-breaking. Raw `VideoScene.image_url`/base64 remains outside the neutral manifest, verified even when a real binding is simultaneously present. A real, already-existing `LibraryFile` was used — its binary verified live via a real presigned S3 GET (200, correct MIME, byte-exact match to its recorded `file_size`). The existing Static-proven `adaptLibraryFileToResolvedAsset` was reused without duplication. Runtime preparation produces a real `ResolvedAsset` through a separate, async, product-layer step that does not touch the neutral resolver, preserving the existing neutral/runtime architectural separation. `TimelineManifestSchema` and `resolveTimelineManifest` both accept the resulting manifest. No storage concern leaked into the adapter, the manifest, `DocumentaryCard`, or the Remotion timeline composition. No DB/storage mutation occurred at any point. Baseline is green throughout (575/575, typecheck, lint, build).
