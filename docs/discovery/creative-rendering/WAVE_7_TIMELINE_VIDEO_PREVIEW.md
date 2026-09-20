# Wave 7 — Timeline / Video Preview Proof

## Verdict

**Gate 7: PASS_WITH_CONSTRAINTS**

The Wave proves a real neutral `TimelineManifest` flowing through existing
validation and resolution into a Remotion-only timeline adapter. A visual
template segment is frame-aware, uses the registered `editorial.documentary-card`
component, and produces deterministic frame evidence for `slow_push`, `fade`,
and `none` motion. The constraint is environmental: no browser surface or
Supabase `.env` was available, so the proof uses isolated Remotion frame
extraction rather than `@remotion/player`; non-visual segment kinds remain
explicitly deferred/diagnosed.

Wave 8 was not started. No MP4, `renderMedia`, production pipeline, database,
S3, or `/videos` change was introduced.

## Timeline fixture

`lib/creative/fixtures/timeline-preview-fixtures.ts` contains two neutral
runtime fixtures:

| Fixture | Canvas | Time | Identity | Segment motion |
| --- | --- | --- | --- | --- |
| `documentaryCardTimelinePreview` | 1080×1920 | 30fps × 180 frames (6s) | fixture A | `slow_push` |
| `documentaryCardFadeTimelinePreview` | 1080×1920 | 30fps × 180 frames (6s) | fixture B | `fade` |

The primary fixture has one `video` track and one template segment from frame 0
through frame 179. The segment carries the existing sequence context
`{ index: 1, total: 10 }`, content, hero fixture, and semantic motion only.
There is no Remotion `Composition`, `Sequence`, React component, bundle path,
or Chromium option in the manifest.

## Adapter architecture

```text
TimelineManifest
  → TimelineManifestSchema + validateTimelineSemantics
  → resolveTimelineManifest()
  → ResolvedTimelineInput
  → remotion/timeline/TimelineComposition
  → visual/overlay tracks
  → TemplateSegment
  → component_key registry lookup
  → DocumentaryCard (shared tree)
```

The adapter lives under `remotion/timeline/`:

- `frame-model.ts` — pure runtime arithmetic for global frame, local frame,
  visibility, and 0..1 progress;
- `TimelineComposition.tsx` — reads the Remotion current frame, orders visual
  tracks, and maps resolved template segments;
- `TemplateSegment.tsx` — validates the registry component key, builds shared
  DocumentaryCard runtime props, and renders the existing component tree;
- `adapter-diagnostics.ts` — reports unsupported non-template or non-visual
  track segments instead of faking them.

`components/creative/documentary-card/DocumentaryCard.tsx` now exposes a shared
`documentaryCardPropsFromRuntimeInput()` builder. Static and timeline adapters
therefore share material resolution, tokens, sequence, motion, and the same
`DocumentaryCard` / `CoverVariant` / `InfoVariant` tree.

## Frame model and boundaries

For each segment:

```text
localFrame = globalFrame - start_frame
visible    = 0 <= localFrame < duration_frames
progress   = localFrame / (duration_frames - 1)
```

The adapter renders at frame 0, frame 45, frame 90, frame 135, and frame 179.
It returns no visual segment before its start or at/after frame 180. Progress is
runtime-only and is never persisted into the manifest.

## Motion mapping

The manifest carries only semantic presets:

- `none` — stable output across frames;
- `fade` — the shared DocumentaryCard video mode drives deterministic opacity;
- `slow_push` — the shared cover tree applies a subtle frame-based hero scale
  from 1.0 through approximately 1.06 while preserving focal point and layout.

No interpolate/spring details or renderer configuration enter the neutral schema.
Still mode remains frame-independent and unchanged.

## Preview strategy and evidence

Because this checkout still has no `.env*`, `proxy.ts` cannot serve the Next dev
route without Supabase configuration, and `cua.getState()` reported no browser
surfaces. The accepted isolated-composition path was used:

```text
node scripts/creative/run-timeline-preview.mjs
```

This bundles the existing Remotion entry and extracts still frames from the
`TimelineManifestPreview` composition. It does not create an MP4 or establish a
production render path.

Generated ignored evidence:

```text
.tmp/creative/timeline-preview/
  frame-000.png
  frame-045.png
  frame-090.png
  frame-135.png
  frame-179.png
  summary.json
```

The summary reports `status: succeeded`, 1080×1920, 30fps, 180 frames,
`component_key: editorial.documentary-card`, `slow_push`, and no adapter
diagnostics. Visual inspection confirms the hero changes subtly between frames
while title, content, sequence marker, and layout remain stable.

## Segment support and deferred kinds

Wave 7 implements only template segments on `video`/`overlay` tracks. Neutral
schema validation still accepts media, audio, text, and caption kinds where
their existing contracts allow them. The adapter reports explicit diagnostics
for unsupported segment kinds or template segments on non-visual tracks; it does
not invent placeholder rendering. Audio, captions, media playback, transitions,
and waveform behavior remain deferred.

## Identity, assets, and tuning

Identity A is the primary fixture. Identity B resolves through the exact same
timeline adapter and component key with different tokens; there is no identity
branch in the adapter. Existing fixture asset resolvers provide hero, paper, and
tape material assets. No LibraryFile, S3, upload, provenance, or alpha pipeline
was added.

Wave 6 `DocumentaryCardPreviewTuning` is not added to the TimelineManifest and
is not carried into this proof. Any future timeline authoring override must be a
separate runtime boundary.

## Isolation

The neutral schema and resolution layers remain free of Remotion imports:

```text
lib/schemas/creative/**   → no Remotion
lib/creative/resolution/** → no Remotion
remotion/timeline/**      → adapter-only Remotion boundary
```

The manifest remains renderer-neutral and can be resolved independently of the
Remotion composition.

## Tests and validation

Focused Wave 7 tests cover:

- canonical manifest resolution and 180-frame/30fps preservation;
- visual track/template segment and `component_key` resolution;
- identity B using the same branch;
- sequence preservation;
- before/start/middle/last/after segment boundaries;
- deterministic `slow_push` progression;
- deterministic `fade` opacity progression;
- stable `none` motion;
- unsupported segment diagnostics;
- manifest immutability.

Results:

| Check | Result |
| --- | --- |
| Focused Wave 7 tests | **39/39 PASS** |
| Full suite | **435/435 PASS** |
| Typecheck | PASS |
| Lint | **0 errors / 45 warnings** |
| Build | PASS |
| Frame extraction | 5 PNGs, frames 0/45/90/135/179 |

## Gate 7 checklist

| Criterion | Status |
| --- | --- |
| Real TimelineManifest resolved | PASS |
| Real ResolvedTimelineInput used | PASS |
| Visual/template track functional | PASS |
| DocumentaryCard reused | PASS |
| Frame progression functional | PASS |
| Segment boundaries correct | PASS |
| Fade functional | PASS |
| Slow push functional | PASS |
| Multiple frame evidence | PASS |
| Neutral contracts free of Remotion | PASS |
| Baseline without relevant regression | PASS_WITH_CONSTRAINTS (424 → 435 tests; same lint warning count) |

## Recommendation

Stop at Wave 7. The next separately scoped effort is **Wave 8 — official
TimelineManifest → MP4 render path**, which may decide how a production-grade
renderer should consume this adapter proof. It was not started here.
