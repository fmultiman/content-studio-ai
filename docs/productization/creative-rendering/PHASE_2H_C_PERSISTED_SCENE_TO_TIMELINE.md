# Phase 2H-C — Persisted VideoScene Binding → Timeline

## 1. Objective

Connect persisted `VideoScene.library_file_id` values to the existing
VideoDraft → Timeline → runtime asset path without changing `/videos`, the fake
Generate action, Remotion, or persistence.

## 2. Existing manual binding

Phase 2G callers supplied `sceneAssets: Record<sceneId, AssetRef>` directly to
`adaptVideoDraftToTimelineManifest`. That seam remains supported for fixtures
and proofs, but production preparation no longer needs to hand-build it.

## 3. Persisted binding authority

`VideoScene.library_file_id` is the only persisted identity consumed here.
`AssetRef`, URLs, storage paths, MIME snapshots, and signed URLs remain
transient render inputs.

## 4. AssetRef derivation

`lib/video-scene-assets.ts` exports the pure
`deriveVideoSceneAssetBindings(scenes)` helper. Each non-null binding produces
`{ type: 'library_file', ref, fit: 'cover' }`; absent/null bindings produce no
entry. Duplicate refs across scenes are independent valid entries. Legacy
`image_url` is never inspected or converted.

## 5. Product-layer preparation

`lib/creative/integration/prepare-video-draft-timeline.ts` exports
`prepareVideoDraftTimeline`. It derives bindings, calls the existing pure
adapter, resolves the manifest, prepares LibraryFiles through the existing
`prepareTimelineLibraryFileAssets`, and patches the resolved input with
`patchResolvedTimelineAssets`.

## 6. Adapter boundary

`adaptVideoDraftToTimelineManifest` is unchanged and remains free of React,
Remotion, Supabase, S3, and network access. The new orchestration layer owns
the product-to-neutral translation.

## 7. Runtime validation

The injected LibraryFile lookup is wrapped by the product layer and accepts a
file only when its id matches the reference, its `project_id` equals the
authoritative loaded VideoDraft project, and `deleted_at` is null. Invalid or
stale references become the existing explicit `library_file_not_found`
diagnostic; no fixture fallback is introduced. Presigning remains delegated to
the existing injected runtime adapter context.

## 8. Legacy `image_url` behavior

`image_url` remains outside the canonical LibraryFile render path. No base64
conversion, upload, or automatic migration occurs.

## 9. Manifest result

The existing adapter emits a valid `TimelineManifest`; bound scenes carry the
derived `library_file` hero AssetRef and unbound scenes retain the established
fixture fallback.

## 10. Resolver result

`resolveTimelineManifest` remains the neutral synchronous resolver and accepts
the manifest without database or storage dependencies.

## 11. ResolvedTimelineInput result

For valid same-Project active image files, runtime preparation produces a real
`ResolvedAsset` and patches the corresponding hero slot in
`ResolvedTimelineInput`. Missing, deleted, cross-Project, non-image, or
unpresignable files remain explicitly unresolved.

## 12. Real-draft status

No authenticated browser session was available in the prior 2H-B worktree, so
there is no newly verified live persisted binding to inspect. The canonical
persisted shape is covered by the integration tests without database mutation.

## 13. Optional MP4 proof

Not repeated. The renderer and runtime preparation path are unchanged from the
Phase 2G-C/D real MP4 proofs; this phase proves the missing product bridge.

## 14. Tests

`lib/__tests__/video-scene-timeline-preparation.test.ts` covers independent
multi-scene derivation, duplicate refs, null/absent bindings, legacy image
exclusion, end-to-end manifest/resolver/runtime preparation, and deleted/stale
runtime rejection. Existing Phase 2G preparation and adapter tests remain
green.

## 15. Baseline

Final validation target: 592/592 tests, typecheck PASS, lint 0 errors / 45
warnings, and build PASS.

## 16. Remaining UI/render-action gap

The `/videos` picker and autosave are unchanged. The fake “Gerar Vídeo” action
still does not invoke this preparation path; product render UX and MP4 output
persistence remain a later slice.

## 17. Verdict

`PASS` when the full validation gate is green. No renderer redesign, UI change,
database mutation, or manual `sceneAssets` construction is required for the
normal product preparation path.
