# Wave 8 — TimelineManifest → MP4 render path

## Verdict

**Gate 8: PASS_WITH_CONSTRAINTS.** The official local CLI now accepts the
canonical `TimelineManifest` JSON, validates and resolves it, drives the
existing `TimelineComposition`, and produces a real H.264 MP4. The slice is
deliberately local-only: no production API, queue, worker, persistence,
upload, audio pipeline, or Wave 9 work is included.

## Official path

```text
TimelineManifest JSON
  → readTimelineManifest()
  → resolveTimelineManifest()
  → ResolvedTimelineInput
  → TimelineManifestVideo / TimelineComposition
  → Remotion bundler + renderer
  → MP4 + execution-result.json
```

The entrypoint is:

```text
pnpm creative:render-timeline [optional-manifest-fixture.json]
```

With no argument it uses
`[documentary-card-cover-1080x1920-a.json](../../../scripts/creative/fixtures/timeline-manifests/documentary-card-cover-1080x1920-a.json)`.
The runner never imports the TypeScript fixture to construct component props;
the JSON manifest is parsed, resolved, and passed as `resolvedInput` to the
existing composition.

## Fixture and execution options

The canonical fixture is the Wave 7 scenario: 1080×1920, 30 fps, 180 frames
(6 seconds), one visual template segment using
`editorial.documentary-card@0.1.0`, cover variant, Identity A, the archival
hero fixture, sequence 1/10, and `slow_push` motion.

Renderer-specific options are a separate runtime type and never enter the
neutral manifest:

```ts
type VideoRenderOptions = {
  codec: 'h264'
  concurrency: number
}
```

The spike defaults to `{ codec: 'h264', concurrency: 1 }`. The output path is
also controlled by the script (`.tmp/creative/timeline-render/`), not by
browser or manifest input.

## Local execution result

The real command completed successfully on 2026-09-20:

| Field | Result |
| --- | --- |
| status | `succeeded` |
| execution kind | `video` |
| manifest | `fixture:timeline:documentary-card:cover-a:preview-v0` |
| template/component | `editorial.documentary-card@0.1.0` / `editorial.documentary-card` |
| canvas | 1080×1920 px |
| fps / frames / duration | 30 / 180 / 6.0 s |
| codec | H.264 (`h264`) |
| MP4 size | 4,248,319 bytes |
| render duration | 117,778 ms |
| diagnostics | `[]` |

The structured record is
`.tmp/creative/timeline-render/execution-result.json`; it includes start and
finish timestamps, source fixture, renderer options, and extracted-frame paths.
The MP4 is
`.tmp/creative/timeline-render/documentary-card-cover-1080x1920-a.mp4`.
Both are ignored local evidence and are not committed.

## Metadata and parity evidence

The runner uses local `ffprobe` to verify the video stream and local `ffmpeg`
to extract start, middle (3 s), and end frames. Those files are
`extracted-start.png`, `extracted-middle.png`, and `extracted-end.png` in the
same evidence directory.

Visual QA compared those frames with the Wave 7 evidence at frames 0, 90, and
179. The DocumentaryCard content, identity, canvas, sequence marker, alpha
and material treatment remain the same. The hero exhibits the expected
deterministic, subtle `slow_push` progression over time; no layout or semantic
content changes were observed.

## Failure behavior and deferred scope

Resolution happens before bundling. Invalid manifests and missing templates
raise `TimelineRenderValidationError` with structured diagnostics. Required
segment kinds that the visual adapter does not support (for example audio)
also fail predictably instead of being silently omitted. Audio, captions, and
other non-visual tracks remain schema-valid but deferred for a later slice.

`ffprobe`/`ffmpeg` failures remain local execution failures and do not create
any persistence record. There is no production render endpoint.

## Isolation

`lib/schemas/creative/**` and `lib/creative/resolution/**` remain renderer
neutral and contain no Remotion imports. Remotion-specific composition,
bundling, codec, probing, and extraction are confined to `remotion/**` and
`scripts/creative/render-timeline-manifest.ts`. The existing Wave 7 temporal
adapter owns `none`, `fade`, and `slow_push`; the runner does not reimplement
motion.

## Tests and baseline

Focused Wave 8 tests cover manifest entry, resolver use, derived dimensions and
duration, preserved template/motion, renderer-option isolation, invalid and
missing templates, and unsupported required segments. Final validation:

- full suite: **439/439 passing**;
- typecheck: **PASS**;
- lint: **0 errors / 45 warnings** (baseline unchanged);
- build: **PASS**.

The inherited Wave 7 baseline was 435/435 tests, typecheck pass, lint 0/45,
and build pass. No protected areas, credentials, neutral schemas, or render
binaries were changed or committed.

## Gate 8 constraints

This is the first official visual TimelineManifest → MP4 vertical slice, not a
production render service. Bundle/cache reuse is local to the Remotion CLI
execution, and the output is an ephemeral `.tmp` artifact. Wave 9 may extend
execution policy and production concerns only after this proof is accepted.
