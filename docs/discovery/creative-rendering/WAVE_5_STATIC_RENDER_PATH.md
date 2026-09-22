# Wave 5 — Static Render Path

## Verdict

**Gate 5: PASS_WITH_CONSTRAINTS**

The spike now has one official local path from a `StaticRenderManifest` fixture to a real PNG:

```text
manifest JSON
  -> StaticRenderManifestSchema + template/identity/asset resolution
  -> ResolvedStaticRenderInput
  -> registry component_key (editorial.documentary-card)
  -> Remotion still adapter
  -> PNG + local execution result JSON
```

No database, Supabase, S3, LibraryFile, upload, or editor path is involved.

## Implementation

The entrypoint is:

```text
pnpm creative:render-static
```

It invokes `scripts/creative/run-static-manifest.mjs`, which loads the TypeScript orchestration module through the small `jiti` runner with the repository `@/*` alias. The orchestration lives at `scripts/creative/render-static-manifest.ts` and:

1. reads the official JSON fixtures under `scripts/creative/fixtures/static-render-manifests/`;
2. calls `resolveStaticRenderManifest` for schema, registry, content, binding, identity, and local asset resolution;
3. verifies the registry `component_key` resolves to the Documentary Card component;
4. bundles the existing Remotion entry with the repository `public/` directory;
5. selects `StaticRenderManifestStill`, passing the resolved input as `inputProps`;
6. renders one still frame and writes a PNG and execution result under `.tmp/creative/static-manifest/`.

The Remotion boundary is `remotion/DocumentaryCardComposition.tsx`. `StaticRenderManifestStillComposition` receives only `ResolvedStaticRenderInput`, accepts the registry-approved `component_key`, converts the input to the existing Documentary Card props helper, and renders the still. The Node entrypoint performs the registry lookup before selecting the composition; the adapter keeps the runtime component boundary explicit without creating a dynamic React component during render. `calculateMetadata` in `remotion/Root.tsx` derives the composition dimensions from the manifest canvas, so 4:5 and 9:16 are not stretched into one another.

## Official manifest fixtures

| Fixture | Variant | Canvas | Identity |
| --- | --- | --- | --- |
| `documentary-card-cover-1080x1350-a.json` | cover | 1080×1350 | fixture identity A |
| `documentary-card-info-1080x1350-a.json` | info | 1080×1350 | fixture identity A |
| `documentary-card-cover-1080x1920-a.json` | cover | 1080×1920 | fixture identity A |
| `documentary-card-cover-1080x1350-b.json` | cover | 1080×1350 | fixture identity B |

The manifests are the source of truth for these runs. No render script constructs content props outside the resolution path.

## Local execution result

Each successful run writes a sibling `*.execution.json` and the aggregate `summary.json`. The result shape is:

```json
{
  "status": "succeeded",
  "template_key": "editorial.documentary-card@0.1.0",
  "component_key": "editorial.documentary-card",
  "variant": "cover",
  "canvas": { "width": 1080, "height": 1350, "unit": "px" },
  "output_path": ".tmp/creative/static-manifest/documentary-card-cover-1080x1350-a.png",
  "width": 1080,
  "height": 1350,
  "started_at": "...",
  "finished_at": "...",
  "duration_ms": 4171,
  "diagnostics": [],
  "alpha_assets": [],
  "source_manifest_fixture": "scripts/creative/fixtures/static-render-manifests/documentary-card-cover-1080x1350-a.json"
}
```

This is deliberately a local execution record, not a persisted RenderExecution domain object.

## Transparency / alpha verification

The render entrypoint checks the material fixtures with `sharp` on every run:

| Asset | Format | Alpha | Decision |
| --- | --- | --- | --- |
| `torn-paper-cream-01.png` | PNG RGBA | **real alpha** | can rotate and overlap without a white matte |
| `tape-kraft-01.png` | PNG RGBA | **real alpha** | can rotate and overlap without a white matte |
| `documentary-card-hero-01.webp` | WebP RGB | **opaque by design** | evidence photo uses its own rectangular frame |

The material assets are referenced through the existing local fixture resolver and are remapped to the bundled `/public/` paths at the Remotion adapter boundary. The official outputs were inspected at full dimensions: no unexpected white boxes or rectangular matte from the paper/tape assets remains, and rotated/overlapped scraps read as cut material. The hero remains an intentionally opaque photographic/documentary surface rather than pretending to be transparent.

This is sufficient for the spike, but it is not a general alpha-aware asset pipeline. Real LibraryFile/S3 metadata, color management, premultiplied-alpha policy, and user-uploaded transparency remain deferred.

## Evidence generated

The official command generated these ignored local files:

```text
.tmp/creative/static-manifest/
  documentary-card-cover-1080x1350-a.png
  documentary-card-info-1080x1350-a.png
  documentary-card-cover-1080x1920-a.png
  documentary-card-cover-1080x1350-b.png
  *.execution.json
  summary.json
```

Visual QA preserved the Wave 4.1 language: the cover hero is dominant, the material headline remains legible, the info fact cards keep editorial hierarchy, the 9:16 cover uses its own vertical treatment, and identity B changes tokens/hero treatment through the same component key and pipeline.

## Validation

- focused Wave 5 contract tests: **5/5 PASS**;
- complete suite: **388/388 PASS** (baseline 383 + 5 Wave 5 tests);
- typecheck: PASS;
- lint: PASS with the existing 45 warnings and no errors;
- build: PASS;
- official manifest render: four PNGs at exact 1080×1350 / 1080×1920 dimensions;
- protected areas (`/videos`, `/imagens`, `/api/video-drafts`, `/api/image-drafts`) unchanged.

## Constraints and deferred work

- `.tmp/creative/` remains ignored and no rendered binaries are committed;
- this is a local fixture path, not production render orchestration;
- `RenderExecution` persistence, retries, queueing, LibraryFile/S3, provenance, and publication checks remain out of scope;
- video/timeline rendering is not changed by this Wave;
- alpha support is verified for the current material fixtures only, not generalized to every future asset type.

## Gate 5 recommendation

The static path is closed enough to proceed. The next bounded step should be **Wave 6**, with any broader asset/provenance/production concerns handled as explicit scope rather than folded into this local spike.
