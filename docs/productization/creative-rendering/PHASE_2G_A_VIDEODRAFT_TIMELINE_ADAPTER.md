# Phase 2G-A — VideoDraft → TimelineManifest Adapter

## 1. Objective

Implement and prove a pure, testable transformation `VideoDraft + VideoScene[] → TimelineManifest`, and confirm that its output is accepted by the existing `TimelineManifestSchema` and `resolveTimelineManifest` — the exact "single-scene" first bridge recommended in `PHASE_2G0_TIMELINE_VIDEOS_INTEGRATION_ARCHITECTURE.md` §18 step 2. No UI, no MP4 render, no real asset resolution, no `/videos` change, no schema change.

## 2. Domain Shapes (audited from real code, not assumed from docs)

**`VideoDraft`** (`lib/types.ts`, `scripts/002_create_drafts_tables.sql` + `020_create_productions.sql`): `id, user_id, project_id (nullable in schema, but required by the API to save), production_id (nullable in schema, required by the API to save), name, scenes: VideoScene[], created_at, updated_at`. No channel/format/target field — confirmed absent, matching Phase 2G0 §10.

**`VideoScene`** (`lib/types.ts`): `id, order, description, prompt: string | null, image_url: string | null, duration: number (seconds), movement: string | null`. `movement` is a free string from a fixed UI list (`scene-card.tsx`): `static, zoom_in, zoom_out, pan_left, pan_right, tilt_up, tilt_down, dolly` — not a schema enum.

**`TimelineManifest`** (`lib/schemas/creative/timeline.ts`): `schema_version: 'timeline.v0'`, `manifest_id`, `context: { project_ref, production_ref, video_work_ref? }`, `specification: { width, height, fps, duration_frames }`, `identity: IdentitySnapshotRef`, `tracks: TimelineTrack[]` (min 1), `segments: TimelineSegment[]`, `assets: Record<string, AssetRef>`, `captions?`, `render_intent`. Frames are the canonical time unit. Semantic validation (`validateTimelineSemantics`) additionally requires: unique track ids, unique segment ids, every segment's `track_id` to reference a real track, and `start_frame + duration_frames <= specification.duration_frames`.

**Template used:** `editorial.documentary-card@0.1.0` (`lib/creative/templates/registry.ts`), the only registered template proven through both the static and timeline paths. Its declared `capabilities.motion_presets = ['none', 'fade', 'slow_push', 'slow_pan']` and `canvas_support` sizes `1080×1350` / `1080×1920` are authoritative — `resolveTimelineManifest` calls `validateTemplateMotion`/`validateTemplateCanvas` against exactly these declared values, not against the full `MotionPresetSchema` enum (which also includes `rise`/`reveal`, not supported by this template).

## 3. TimelineManifest Shape — Key Constraints Confirmed in Code

- `resolveTimelineManifest` (`lib/creative/resolution/resolve-timeline.ts`) calls, for every `template` segment: `resolveTemplate` → `validateTemplateMode(..., 'video')` → `validateTemplateCanvas` → `validateTemplateContent` → `validateTemplateAssetBindings` → `validateTemplateMotion` → `resolveAssetSlots`. All must pass for the segment to resolve.
- `resolveIdentitySnapshot` (`lib/creative/identity/resolve-identity-snapshot.ts`) only resolves `snapshot_ref` values present in `IDENTITY_FIXTURES` — real Project Identity resolution is a separate bridge (used by Static, not wired here), so this adapter takes `identity` as a caller-supplied input rather than resolving it itself.
- `resolveAsset` (`lib/creative/assets/resolve-asset.ts`) resolves `type: 'fixture'` refs from a static in-memory registry; `type: 'library_file'` refs currently resolve to a stub with `url: ''` (confirmed in Phase 2G0 §11) — real asset wiring is out of scope here by design.

## 4. Mapping Table

| VideoDraft/VideoScene field | TimelineManifest destination | Classification |
|---|---|---|
| `draft.id` | `context.video_work_ref`, `manifest_id` | DIRECT / DERIVED — `video_work_ref` is a field the schema already reserves for exactly this (comment in `timeline.ts`: *"VideoWork does not exist in the product yet... `video_work_ref` is optional"*) |
| `draft.project_id` | `context.project_ref` | DIRECT (required — adapter throws if missing, matching the API's own requirement) |
| `draft.production_id` | `context.production_ref` | DIRECT (required, same reasoning) |
| `draft.name` | — | NOT USED — no manifest-level title/name field exists |
| `scene.id` | `segment.id` (`scene:<id>`) | DIRECT |
| `scene.order` | `segment.payload.sequence.index` | DIRECT |
| `scenes.length` | `segment.payload.sequence.total` | DERIVED |
| `scene.duration` (seconds) | `segment.duration_frames` | DERIVED (`round(seconds × fps)`, floor of 1 frame) |
| cumulative prior scene frames | `segment.start_frame` | DERIVED |
| `scene.movement` | `segment.payload.motion` | ADAPTED — see §6; several values are explicitly UNSUPPORTED, not forced |
| `scene.description` | — | **NOT USED** — explicitly excluded per instruction; never enters the manifest, even as a fallback title (see §7) |
| `scene.prompt` | — | **NOT USED** — same reasoning; an AI-generation instruction string is not editorial display content |
| `scene.image_url` | — | **NOT USED** — never becomes the canonical asset; a fixture hero is used instead (see §8) |
| — | `content.title` | DEFAULTED — positional placeholder (`"Cena {order}"`), not derived from any scene text field |
| — | `assets.hero` | DEFAULTED — proven-resolvable fixture `AssetRef` |
| — | `identity` | INPUT — caller-supplied (fixture ref in this proof; real Project Identity snapshot when wired later) |
| — | `specification.width/height/fps` | DEFAULTED — 1080×1920 @ 30fps (matches every existing timeline fixture and Wave 7/8; also a declared `canvas_support` size for the template used) |
| — | `render_intent` | DEFAULTED — `{ purpose: 'preview', container: 'mp4', audio: false, captions: 'none' }`, identical to the Wave 7 fixture |
| — | `tracks` | DEFAULTED — one `video` track; `VideoDraft` has no track concept to derive from |
| — | `segment.payload.template` | DEFAULTED — `editorial.documentary-card@0.1.0` cover, system scope |

No field was forced into a slot it doesn't legitimately belong in. `description`/`prompt`/`image_url` are explicitly excluded per the handoff's own instruction, not merely deprioritized.

## 5. Time Mapping

`duration_frames = max(1, round(scene.duration_seconds × fps))`. Default `fps = 30`, matching every existing timeline fixture (`lib/creative/fixtures/timeline-preview-fixtures.ts`) and both Wave 7 (180 frames/6s/30fps) and Wave 8 (identical) — not a newly invented default; empirically the only fps value used anywhere in the existing timeline proof surface. `start_frame` accumulates sequentially across scenes (`cursor += segment.duration_frames` per scene in the loop), so the single scene starts at frame 0 and the manifest's `specification.duration_frames` equals the sum of all scene frames — satisfying `validateTimelineSemantics`'s bounds check by construction.

## 6. Motion Mapping

Audited against the **actual enforced capability list** of `editorial.documentary-card` (`capabilities.motion_presets = ['none', 'fade', 'slow_push', 'slow_pan']`), not the full `MotionPresetSchema` enum, since `validateTemplateMotion` rejects any preset not declared by the specific template:

| `VideoScene.movement` | Motion result | Status |
|---|---|---|
| `static` | `{ preset: 'none' }` | Supported — exact semantic match, visually proven in Wave 7 |
| `zoom_in` | `{ preset: 'slow_push' }` | Supported — matches Wave 7's own description of `slow_push` ("subtle hero scale from 1.0 to ~1.06"), visually proven |
| `pan_left` / `pan_right` / `tilt_up` / `tilt_down` | `{ preset: 'slow_pan', direction: 'left'/'right'/'up'/'down' }` | Supported by the template's declared capabilities and `MotionSpecSchema.direction`; **not** part of Wave 7's frame-by-frame visual inspection (which only exercised `none`/`fade`/`slow_push`) — schema/capability-valid, visual behavior unverified |
| `zoom_out` | `{ preset: 'none' }` + diagnostic | **Unsupported** — no scale-out preset exists; not forced |
| `dolly` | `{ preset: 'none' }` + diagnostic | **Unsupported** — a distinct camera technique with no dedicated preset; mapping it onto `slow_push` would conflate two different source values, so it is not forced |
| `null` / any unrecognized string | `{ preset: 'none' }` + diagnostic | **Unsupported**, handled explicitly rather than silently reinterpreted |

`fade` is not reachable from any current `VideoScene.movement` value — it remains available in the template but has no VideoScene-side trigger today.

## 7. Content Mapping

Per the handoff's explicit instruction, `scene.description` and `scene.prompt` are **never** placed into manifest content, in any field, under any circumstance — verified by tests that plant a marker string in each field and assert it never appears anywhere in the serialized manifest. Since `editorial.documentary-card`'s cover variant requires a `title` (`DocumentaryCardCoverContentSchema`), and no domain field is a legitimate editorial headline, the adapter uses a positional placeholder (`"Cena {order}"`) instead — this is explicitly flagged as `content_defaulted` in the adapter's diagnostics, not silently substituted. `eyebrow`, `subtitle`, `source_line`, `detail_note` are all optional and left unset.

## 8. Asset Boundary

Every scene's `hero` asset slot is filled with the same proven fixture ref, `{ type: 'fixture', ref: 'fixture:asset:documentary-card:hero-archival-01', fit: 'cover' }` (confirmed present in `resolve-asset.ts`'s registry), regardless of `scene.image_url`. If `scene.image_url` is non-null, a `field_unused` diagnostic (`scene_image_url_not_used`) is emitted noting that real per-scene asset resolution is deferred. A test asserts the base64 payload never appears anywhere in the output manifest and that the string `"base64"` itself never appears — this is the explicit "no base64 becomes canonical" guard requested. The adapter's `heroAssetRef` input parameter leaves the exact boundary the next phase needs (`VideoScene.image_url/media → AssetRef`) without implementing it.

## 9. Adapter Implementation

`lib/creative/timeline-adapter/video-draft-to-timeline.ts` exports:
- `adaptVideoDraftToTimelineManifest(input): { manifest, diagnostics }` — the main pure function.
- `sceneToSegment(scene, startFrame, fps, trackId, totalScenes, heroAssetRef)` — the per-scene mapping, called in a loop rather than assuming `segments[0]` is the only segment, so a future multi-scene caller can reuse it without rewriting the mapping (multi-scene *composition* — transitions, multi-track layout — is explicitly not implemented).
- `movementToMotion(movement)` — the motion-mapping table from §6, independently unit-tested.
- Constants `DEFAULT_TIMELINE_FPS`, `DEFAULT_TIMELINE_CANVAS`, `DEFAULT_HERO_ASSET_REF` — all documented as reused/proven defaults, not invented ones.

The module has zero Supabase, S3, Remotion, React, Next, filesystem, or network imports or calls — verified both by direct code review and by an automated isolation test (§14) mirroring the existing `lib/schemas/creative/__tests__/isolation.test.ts` pattern.

## 10. Single-Scene Proof

A single-scene `VideoDraft` (one `VideoScene`, `duration: 3`, `movement: 'zoom_in'`) is adapted, then:
1. `TimelineManifestSchema.safeParse(manifest)` → `success: true`.
2. `validateTimelineSemantics(manifest)` → zero error-severity issues.
3. `resolveTimelineManifest(manifest)` → `valid: true`, with exactly one resolved template segment and a resolved `hero` asset.

All three are asserted directly in tests (§14), not just described.

## 11. Real-Row Proof

**Not available this phase.** As established and unchanged since Phase 2E-B/2F-A, no legitimate authenticated local session exists to read a real `video_drafts` row through the normal RLS-protected path, and using a service-role key to bypass RLS for a "read-only" query would still be the auth bypass this project has consistently avoided — it was not attempted. Fabricating a real DB row was correctly not done either (explicitly disallowed).

**Substituted with:** a canonical fixture shaped exactly like a real `VideoDraft` row would be — `{ id, project_id, production_id, scenes: [VideoScene] }` — using the same field names, types, and constraints (`project_id`/`production_id` both required, matching what the real `POST /api/video-drafts` route already enforces on every real save). This is the same "canonical fixture matching the exact real domain shape" path the handoff explicitly permits when no real row is reachable.

## 12. Resolver Acceptance

Confirmed via test: the adapter's output is accepted by `resolveTimelineManifest` not just for the one canonical scene, but for **every** mapped `movement` value in §6 (`static, zoom_in, pan_left, pan_right, tilt_up, tilt_down, zoom_out, dolly, null`) — including the "unsupported, falls back to none" cases, proving the fallback path itself still produces a resolver-valid manifest rather than merely a schema-valid one.

## 13. Diagnostics / Lossy Mappings

The adapter returns `{ manifest, diagnostics: AdapterDiagnostic[] }`. Diagnostics are emitted (never silent) for:
- `content_title_placeholder` — every segment, since no domain title field exists.
- `scene_description_not_used` / `scene_prompt_not_used` — whenever the scene has non-empty text in that field.
- `scene_image_url_not_used` — whenever the scene has inline image data.
- `motion_unsupported` (`movement_no_preset_equivalent`) — whenever `scene.movement` has no template-declared preset equivalent.

Nothing is dropped without an explanation attached to the result.

## 14. Tests

31 new tests, all passing, in `lib/creative/__tests__/video-draft-to-timeline.test.ts`:
- **Basic** (6): valid manifest for one scene; deterministic output; correct `schema_version`; `video_work_ref`/`project_ref`/`production_ref` populated; missing `project_id` throws; zero scenes throws.
- **Time** (4): seconds→frames at default 30fps; start frame 0; total duration equals segment duration; caller-supplied fps respected.
- **Order** (2): `sequence.index`/`sequence.total` correct; `sceneToSegment` works at a non-zero start frame with a non-1 order (proves no `segments[0]` hardcoding).
- **Motion** (7): every mapped value from §6, both supported and explicitly-unsupported-with-diagnostic cases, plus null/unknown handling.
- **Content** (3): `description` never appears anywhere in the serialized manifest (marker-string test) and is flagged unused; same for `prompt`; placeholder title used and flagged as defaulted.
- **Assets** (3): fixture hero accepted; base64 marker never appears anywhere in the manifest (and the literal string `"base64"` never appears) even when `image_url` is set, with a diagnostic; no false-positive diagnostic when `image_url` is absent.
- **Template** (1): valid, registered `TemplateRef` emitted; no React/Remotion/component-name string leaks into the manifest.
- **Resolution** (4): schema validation; semantic validation; full `resolveTimelineManifest` acceptance for the canonical scene; acceptance across every mapped movement value.
- **Boundaries** (2): static-analysis isolation test (no Supabase/S3/Remotion/React/Next imports anywhere under `lib/creative/timeline-adapter/`); no `fetch`/filesystem usage in the adapter file.

## 15. Baseline

- Full suite: **557/557 passed** (45 test files; 526 pre-existing + 31 new)
- typecheck: **PASS**
- lint: **0 errors / 45 warnings** — identical to the inherited baseline
- production build: **PASS**, exit code 0

## 16. Deferred Real-Asset Integration

Unchanged, explicitly out of scope here: `VideoScene.image_url` (or a future real media reference) → `AssetRef` resolution against a real `LibraryFile`/S3 object. The adapter's `heroAssetRef` input parameter and the `field_unused` diagnostic on `image_url` are the exact seam a later phase would extend — no redesign needed to add it, since the per-scene mapping already accepts an asset ref as an external input rather than deriving one internally.

## 17. Multi-Scene Implications

The per-scene mapping (`sceneToSegment`) and the sequential frame-accumulation loop in `adaptVideoDraftToTimelineManifest` already work for an arbitrary number of scenes mechanically (tested indirectly via the "arbitrary start frame/order" test, §14) — but this phase does **not** implement or test multi-scene composition concerns: no cross-scene transitions (`TransitionSpec`), no multi-track authoring, no aggregate-duration product decisions. A draft with more than one scene was not exercised end-to-end through `resolveTimelineManifest` in this phase and should be its own proof before being treated as supported.

## 18. Verdict

**`PASS_WITH_CONSTRAINTS`**

The pure adapter exists, is fully isolated from Supabase/S3/Remotion/React, and deterministically maps one `VideoScene` into a valid `TimelineManifest` segment. Frame timing is correct and verified against a non-invented fps default. Motion mapping is explicit for every real `VideoScene.movement` value, with unsupported values falling back safely and visibly rather than being forced. No base64 or raw scene text ever becomes canonical manifest content or the canonical asset. `TimelineManifestSchema` and `resolveTimelineManifest` both accept the output, proven across every mapped movement value, not just the one happy-path scene. Baseline is green throughout (557/557, typecheck, lint, build). The sole constraint is the carried-forward, pre-existing inability to read one real `video_drafts` row locally without a session this automation should not fabricate or bypass — the substitute canonical fixture is shaped identically to what a real row's fields would be.
