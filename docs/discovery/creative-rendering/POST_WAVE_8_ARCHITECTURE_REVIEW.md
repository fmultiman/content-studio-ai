# Post-Wave 8 Architecture Review — Shared Creative Rendering Spike

**Product:** Content Agent Studio  
**Layer:** Shared Creative Rendering Layer  
**Current Milestone:** Post-Wave 8 (commit `09309b8` — *feat: add timeline MP4 render path (Wave 8)*)  
**Status:** READ-ONLY Architectural Audit  
**Date:** 2026-09-20  
**Baseline Verified:** 439/439 Vitest tests PASS · `tsc --noEmit` PASS · ESLint 0 errors / 45 pre-existing warnings  
**Taxonomy of Statements:**
- `FACT`: Direct empirical evidence verified in repository code, tests, logs, or execution artifacts.
- `INFERENCE`: Deductive conclusion drawn from verified facts and systemic analysis.
- `RECOMMENDATION`: Actionable engineering direction advised to mitigate risk or achieve production readiness.
- `NOT FOUND`: Explicitly audited concept or property that does not exist in the codebase.

---

## 1. Executive Verdict

**Verdict:** **`PROCEED_WITH_CONSTRAINTS`**

### Core Finding
The Shared Creative Rendering Spike has successfully established a genuine, renderer-neutral architectural separation across both static and temporal production paths. The central architectural hypothesis—that structured editorial domain data can flow through neutral manifests, declarative schema validation, and runtime resolution into a single shared React visual tree capable of producing both pixel-accurate PNGs and deterministic MP4s—is **proven**.

Remotion has been successfully isolated as a modular render adapter rather than a domain source of truth. At no point do Remotion hooks, types, or bundler primitives leak into `lib/schemas/creative/**` or `lib/creative/resolution/**`.

### Critical Constraints
However, the architecture cannot yet proceed directly to production infrastructure deployment (queues, workers, migrations, cloud storage) due to three structural gates that remain deferred:
1. **Single-Template Registry Coupling:** While the registry schema supports arbitrary templates via opaque `component_key` identifiers, the runtime component resolver and timeline segment adapter currently hardcode assumptions around `DocumentaryCardProps` and `editorial.documentary-card`. The multi-template abstraction remains unproven.
2. **Fixture-Only Resource Boundaries:** Both visual identity (`VisualTokensSnapshot`) and assets (`AssetRef`) resolve exclusively through local in-memory fixtures. No connection yet exists between `AssetRef` and CAS's real `LibraryFile` / S3 storage, nor between Project Identity V1 and compiled visual design tokens.
3. **Unresolved Typography Pipeline:** Fonts are declared as plain CSS strings with zero loading infrastructure (no `@font-face` injection, no `@remotion/google-fonts`, no font-ready gating). Parity in headless/serverless environments is currently unprotected.

---

## 2. Current Implemented Architecture

The implemented system currently operates across three decoupled planes:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             CONTROL PLANE                                │
│  (Next.js App / Authoring State / Editorial Domain / Project Context)    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
      StaticRenderManifest (v0)             TimelineManifest (v0)
      - schema: static-render.v0            - schema: timeline.v0
      - template: TemplateRef               - tracks: TimelineTrack[]
      - canvas: CanvasSpec                  - segments: TimelineSegment[]
      - identity: IdentitySnapshotRef       - specification: width/height/fps
      - content: ContentBindings            - identity: IdentitySnapshotRef
      - assets: Record<string, AssetRef>    - assets: Record<string, AssetRef>
                     │                               │
┌────────────────────┼───────────────────────────────┼─────────────────────┐
│                    ▼                               ▼                     │
│    resolveStaticRenderManifest()         resolveTimelineManifest()       │
│    - Zod structural parse                - Zod structural parse          │
│    - Template Registry resolution        - Semantic cross-field pass     │
│    - Variant/Content/Asset validation    - Identity fixture resolution   │
│    - Identity fixture resolution         - Top-level asset resolution    │
│    - Asset fixture resolution            - Segment loop & validation     │
│                    │                               │                     │
│                    ▼                               ▼                     │
│       ResolvedStaticRenderInput           ResolvedTimelineInput          │
│                    │                               │                     │
│                    └───────────────┬───────────────┘                     │
│                                    ▼                                     │
│                     Template Registry & Component Resolver               │
│                     (component_key: "editorial.documentary-card")        │
│                                    │                                     │
│                                    ▼                                     │
│                   SHARED VISUAL TREE (React / DOM / SVG)                 │
│                   DocumentaryCard                                        │
│                   ├── CoverVariant (4:5 & 9:16)                          │
│                   └── InfoVariant (4:5 & 9:16)                           │
│                                    │                                     │
│ CREATIVE RENDERING LAYER           │                                     │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
┌────────────────────────────────────┐ ┌───────────────────────────────────┐
│     STATIC REMOTION ADAPTER        │ │     VIDEO REMOTION ADAPTER        │
│  StaticRenderManifestStillComposition│ TimelineComposition               │
│  - renderStill()                   │ │ - useCurrentFrame()               │
│  - single frame evaluation         │ │ - TemplateSegment                 │
│  - output: PNG                     │ │ - frame-model: progress arithmetic│
│                                    │ │ - renderMedia() → output: MP4     │
│ EXECUTION PLANE (Remotion / Node)  │ └───────────────────────────────────┘
└────────────────────────────────────┘
```

---

## 3. Evidence Reviewed

The review thoroughly inspected 13 wave reports, 16 conceptual authorities, and the entire implementation tree:

### Artifacts & Reports Audited
- Wave Reports: `SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md` (Wave 0) through `WAVE_8_TIMELINE_MP4_RENDER_PATH.md`.
- Conceptual Authorities: `RENDER_ARCHITECTURE_V0.md`, `STATIC_RENDER_MANIFEST_V0.md`, `TIMELINE_MANIFEST_V0_REFINEMENT.md`, `TEMPLATE_REGISTRY_V0.md`, `CREATIVE_PRIMITIVES_SCHEMA_V0.md`, `STATIC_RENDER_SCHEMA_V0.md`, `TIMELINE_SCHEMA_V0.md`, `TEMPLATE_DESCRIPTOR_SCHEMA_V0.md`, `EDITORIAL_DOCUMENTARY_CARD_V0.md`, `REMOTION_ADAPTER_MAPPING_V0.md`, `SHARED_CREATIVE_RENDERING_SPIKE_PLAN_V0.md`, `EDITORIAL_DOCUMENTARY_CARD_ANATOMY_V0.md`, `EDITORIAL_DOCUMENTARY_CARD_FIXTURES_V0.md`, `VISUAL_PRIMITIVE_LIBRARY_V0.md`, `CREATIVE_PRIMITIVE_HARNESS_V0.md`, `TYPOGRAPHY_FONT_CATALOG_V0.md`.

### Implementation Code Audited
- Neutral Schemas: `lib/schemas/creative/{primitives,static-render,timeline,template-descriptor,documentary-card,validation}.ts`.
- Resolution & Registry: `lib/creative/{resolution,templates,identity,assets,authoring}/**`.
- Shared Visual Components: `components/creative/documentary-card/{DocumentaryCard,CoverVariant,InfoVariant,primitives,types}.tsx`.
- Remotion Adapters: `remotion/{Root,SpikeComposition,DocumentaryCardComposition,index}.tsx` and `remotion/timeline/{TimelineComposition,TemplateSegment,frame-model,adapter-diagnostics}.ts`.
- Render Orchestration Scripts: `scripts/creative/{render-static-manifest.ts,render-timeline-manifest.ts,render-authoring-request.ts,run-authoring-render.mjs}`.
- Local Preview Bridge: `app/dev/creative-preview/{page.tsx,render/route.ts}`.

### Automated Suite Results (FACT)
- **Vitest:** 31 test files, 439 tests passing (15 test files and 151 tests specific to the creative rendering layer).
- **TypeScript:** `tsc --noEmit -p tsconfig.typecheck.json` completed with 0 errors.
- **ESLint:** 0 errors, 45 pre-existing warnings in dashboard components; 0 warnings in creative rendering code.

---

## 4. What the Spike Has Proven

1. **True Domain / Renderer Decoupling (FACT):** The neutral contracts in `lib/schemas/creative/` do not import or reference React, Remotion, Next.js, Supabase, or AWS S3. Automated guardrail tests (`isolation.test.ts`, `neutrality.test.ts`, `renderer-isolation.test.ts`) enforce this structurally.
2. **Unified Visual Tree Across Still and Video (FACT):** The exact same React component (`DocumentaryCard`) renders the static PNG via `renderStill()` and the video frames via `renderMedia()`. Visual parity between still frame 0 and video frame 0 is mathematically identical.
3. **Static and Video Manifest Symmetry (FACT):** Both `StaticRenderManifest` and `TimelineManifest` share identical primitive structures (`TemplateRef`, `CanvasSpec`, `IdentitySnapshotRef`, `AssetRef`, `SequenceContext`). Both resolve through the same `Template Registry` and `Identity Resolver`.
4. **Resolution Before Execution (FACT):** Manifest validation and reference resolution are completed upfront before any Remotion bundler or Chromium process is initialized. Invalid inputs fail fast in milliseconds with typed `RuntimeDiagnostic` objects, preventing costly render spawns.
5. **Deterministic Collage Motion (FACT):** Organic visual elements (torn paper skins, kraft tape, drop shadows, photo overlays) are positioned deterministically without `Math.random()`. The `slow_push` and `fade` motion presets map to pure arithmetic progress `[0..1]`, preserving focal point alignment across frames.
6. **Authoring Purity & Isolation (FACT):** In Wave 6 and 6.1, `AuthoringState` successfully produces valid `StaticRenderManifest` payloads while completely isolating ephemeral tuning sliders (`DocumentaryCardPreviewTuning`) from persisted domain schemas.
7. **Production of Real Media Artifacts (FACT):** The system has successfully rendered official 1080×1350 and 1080×1920 PNGs and a 6-second, 30 fps, 1080×1920 H.264 MP4 (4,248,319 bytes) verified via `ffprobe` and frame extraction via `ffmpeg`.

---

## 5. What the Spike Has NOT Proven

1. **Multi-Template Scalability (FACT):** The system has only been tested with a single template family (`editorial.documentary-card@0.1.0`). `component-resolver.ts` and `TemplateSegment.tsx` contain hardcoded branches expecting `DocumentaryCardProps`.
2. **Real Content Studio Asset Ingestion (FACT):** `resolveAsset()` immediately rejects any `AssetRef.type !== 'fixture'`. No connection to CAS `LibraryFile`, Supabase Storage, or S3 presigned URLs has been executed.
3. **Dynamic Project Identity Compilation (FACT):** Project Identity V1 stores visual identity as freeform text strings (`expression.visual_identity`). The compilation step `compileVisualIdentity(project.identity) → VisualTokensSnapshot` does not exist; identity is entirely mocked via hardcoded fixtures (`comunidades-alternativas` and `acme-labs`).
4. **Headless Font Parity & Reliability (FACT):** No font files (`.woff2`, `.ttf`) are loaded, registered, or bundled. Chromium relies entirely on whatever system fonts happen to exist on the host OS.
5. **Asynchronous Production Render Infrastructure (FACT):** There is no job queue, background worker, persistent `RenderExecution` database table, progress tracking, or webhook notification mechanism. All rendering occurs via synchronous local CLI scripts.
6. **Multi-Track Audio and Video Compositing (FACT):** Non-template segment kinds (`media`, `audio`, `text`, `caption`) are defined in schema but rejected with `unsupported_segment_kind` in the Remotion timeline adapter. Audio mixing is completely absent.

---

## 6. Domain / Renderer Boundary Review

| Layer | Files Audited | Remotion Leakage Status | Classification |
|---|---|---|---|
| Neutral Schemas | `lib/schemas/creative/*.ts` | Zero imports, zero references | **NOT FOUND** |
| Runtime Resolution | `lib/creative/resolution/*.ts` | Zero imports, zero references | **NOT FOUND** |
| Template Registry | `lib/creative/templates/registry.ts` | Zero imports; `component_key` is an opaque string | **NOT FOUND** |
| Component Resolver | `lib/creative/templates/component-resolver.ts` | Imports `DocumentaryCard` (React component), zero Remotion | **NOT FOUND** |
| Shared Visual Tree | `components/creative/documentary-card/*.tsx` | Zero Remotion imports; receives pure props | **NOT FOUND** |
| Remotion Adapter | `remotion/**/*.tsx` | Encapsulates all Remotion APIs (`useCurrentFrame`, `Composition`, `Still`) | **FACT (Properly Isolated)** |
| Render Scripts | `scripts/creative/*.ts` | Encapsulates `@remotion/bundler` and `@remotion/renderer` | **FACT (Properly Isolated)** |

### Leakage Analysis
- **Domain Contracts:** Pure Zod definitions utilizing `.strict()` to prevent arbitrary property injection.
- **Adapter Boundary:** The Remotion adapter (`DocumentaryCardComposition.tsx` and `remotion/timeline/TimelineComposition.tsx`) acts strictly as a downstream consumer. It accepts `ResolvedStaticRenderInput` or `ResolvedTimelineInput` and passes standard props to `DocumentaryCard`.
- **Identified Risk (RISK):** In `remotion/DocumentaryCardComposition.tsx:10-29`, the helper function `remotionProps()` rewrites asset URLs prefixed with `public/` to `/public/` so that webpack's dev server can serve them during rendering. This is an adapter-level path fixup, but it is currently specialized for `DocumentaryCardProps` rather than generic asset mapping.

---

## 7. Static vs Video Architecture Review

### Comparative Analysis of Paths

```
Static: StaticRenderManifest → resolveStaticRenderManifest() → ResolvedStaticRenderInput → StaticRenderManifestStill → renderStill() → PNG
Video:  TimelineManifest     → resolveTimelineManifest()     → ResolvedTimelineInput     → TimelineManifestVideo      → renderMedia() → MP4
```

| Dimension | Static Path | Video Path | Structural Symmetry |
|---|---|---|---|
| **Input Contract** | `StaticRenderManifest` (canvas, 1 template, content, assets) | `TimelineManifest` (specs, tracks, segments, assets) | **Asymmetrical by design** (appropriate) |
| **Shared Primitives** | `TemplateRef`, `CanvasSpec`, `IdentitySnapshotRef`, `AssetRef`, `SequenceContext` | Identical primitive definitions reused verbatim | **Fully Symmetric (FACT)** |
| **Resolution Logic** | `resolveStaticRenderManifest` | `resolveTimelineManifest` (reuses template/identity/asset validators) | **Symmetric & Reusable (FACT)** |
| **Component Binding** | Resolves `component_key` to React tree | Resolves `component_key` per template segment | **Symmetric (FACT)** |
| **Time Model** | Frame-agnostic (evaluated at frame 0) | Frame-accurate (integer frames, `localFrame`, `progress`) | **Symmetric at component level (FACT)** |
| **Output Metadata** | `StaticRenderExecutionResult` (sharp metadata, duration) | `TimelineVideoExecutionResult` (ffprobe stream, fps, duration) | **Format-specific (Appropriate)** |

### Verdict on Symmetry
The symmetry between static and video paths is structurally sound. The system avoids the trap of forcing static images into a "one-frame video composition" while successfully sharing the exact same template registry, validation rules, identity resolver, asset structures, and visual React component tree.

---

## 8. Template / Registry Review

### Boundary Health
The Template Registry (`lib/creative/templates/registry.ts`) cleanly models templates using immutable descriptors (`TemplateDescriptor`). Manifests reference templates by `scope + id + version + variant` (e.g. `editorial.documentary-card@0.1.0` variant `cover`). The descriptor defines supported modes (`['still', 'video']`), supported canvases, and schema references.

### Identified Coupling & Debt (RISK / FACT)
1. **Single-Template Typing (FACT):** In `lib/creative/templates/component-resolver.ts:5`, `ResolvedTemplateComponent` is typed as:
   ```ts
   export type ResolvedTemplateComponent = ComponentType<DocumentaryCardProps>
   ```
   The resolver cannot return a component with a different prop signature.
2. **Adapter Hardcoding (FACT):** In `remotion/timeline/TemplateSegment.tsx:25-27`:
   ```ts
   if (resolvedTemplate.descriptor.component_key !== 'editorial.documentary-card' || !RegisteredDocumentaryCard) {
     throw new Error(`No visual component is registered for ${resolvedTemplate.descriptor.component_key}`)
   }
   ```
   The timeline adapter currently throws an error if any template other than `editorial.documentary-card` is encountered.
3. **Internal Material Ingestion (FACT):** In `DocumentaryCard.tsx:95-98`, `documentaryCardPropsFromRuntimeInput()` directly calls `resolveAsset()` for internal material skins (`torn-paper-cream-01` and `tape-kraft-01`). These materials are template-level implementation fixtures rather than manifest-declared assets. While this keeps the manifest clean, it means the template component directly depends on the asset resolver.

---

## 9. Authoring Boundary Review

### State Separation Assessment
Audited files: `lib/creative/authoring/{types,authoring-state,render-request}.ts` and `app/dev/creative-preview/page.tsx`.

1. **Manifest Purity (FACT):** The function `deriveManifestFromState(state)` takes the full `AuthoringState` and extracts strictly the fields permitted by `StaticRenderManifestSchema`. The ephemeral visual tuning (`DocumentaryCardPreviewTuning`) and UI flags (`debugPanelOpen`) are completely excluded.
2. **Request Packaging (FACT):** When triggering a local render, `AuthoringRenderRequest` packages the pure manifest alongside an optional `overrides` bag:
   ```ts
   type AuthoringRenderRequest = {
     manifest: StaticRenderManifest
     overrides?: { documentaryCard?: DocumentaryCardPreviewTuning }
   }
   ```
   This keeps runtime overrides explicitly separated from the versioned, reproducible manifest.
3. **No Field Promotion Warranted (RECOMMENDATION):** Ephemeral sliders (`hero.offsetX`, `hero.rotation`, etc.) must **NOT** be promoted to `StaticRenderManifestSchema`. In an editorial documentary card, layout is governed by the template's design invariants. Allowing arbitrary positional overrides in the core manifest would degrade the template contract into an unconstrained freeform canvas.

---

## 10. Timeline & Motion Review

### Timeline Architecture
- **Boundary Invariant:** `Scene Plan (intent) ≠ Timeline (edit decision) ≠ Template (visual layout) ≠ Renderer (execution)`. This invariant is maintained. The optional `scene_plan_ref` connects back to narrative intent without structural coupling.
- **Frame Arithmetic:** `remotion/timeline/frame-model.ts` provides pure arithmetic for segment local frame and progress (`[0..1]`). It contains zero Remotion imports and is 100% unit-tested.

### Motion Model Evaluation
- **Semantic Specification (FACT):** `MotionSpec` (`preset`, `intensity`, `direction`) describes motion semantically. It does not contain keyframes, easing curves, or renderer-specific animation ASTs.
- **Current Motion Coverage (FACT):**
  - `none`: Completely static.
  - `fade`: Implemented in `DocumentaryCard.tsx:35-36` via opacity and subtle vertical translation (`(1 - contentOpacity) * 18px`).
  - `slow_push`: Implemented in `CoverVariant.tsx:12` via scale transform (`1 + progress * 0.06`) centered at the hero's focal point.
  - `slow_pan`: Declared as supported in the template descriptor, but **NOT FOUND** in component implementation.
  - `intensity`: Defined in schema and passed in fixtures (`0.35`), but ignored in component calculation (uses hardcoded multipliers).
  - `rise`, `reveal`: Declared in schema enum, but not supported by the template.

---

## 11. Identity Review

### Findings
1. **Fixture Isolation (FACT):** `resolveIdentitySnapshot()` resolves `IdentitySnapshotRef` against `IDENTITY_FIXTURES`. It contains two identities: `comunidades-alternativas:v1` (warm, editorial) and `acme-labs:v1` (dark, technical).
2. **Zero Portal Coupling (FACT):** The component tree has zero conditional branches checking for "comunidades-alternativas" or "portal". Both identities flow through the identical rendering code.
3. **Project Identity V1 Status (FACT):** `lib/schemas/project-identity.ts` has remained completely untouched throughout all 8 waves.
4. **Integration Gap (INFERENCE):** Project Identity V1 currently stores visual guidelines as unstructured text (`expression.visual_identity: string`). Before real Project Identity can drive rendering, an automated compiler (`compileVisualIdentity`) or structured Project Identity V2 must be introduced to generate `VisualTokensSnapshot`.

---

## 12. Assets, Materials & Primitives Review

### Tri-Tier Classification

#### 1. Sufficient for Architecture Validation (Spike Complete)
- `AssetRef` schema with `type`, `ref`, `fit`, and normalized `focal_point` (`0..1`).
- `ResolvedAsset` structure providing absolute path, URL, MIME type, dimensions, and checksum.
- Sharp-based alpha channel verification for PNG materials.
- Local raster skins for paper fibre and kraft tape.

#### 2. Must Exist Before Production Rendering
- **CAS Storage Adapter:** Resolving `AssetRef.type === 'library_file'` by mapping library IDs to signed S3 URLs via `lib/storage/s3.ts`.
- **URL Lifetime Management:** Manifests must persist permanent references (`AssetRef`), while resolution must generate short-lived, fresh signed URLs immediately prior to render execution.
- **External Asset Ingestion & Sanitization:** Validating dimensions, format, and size for user uploads and external URLs.

#### 3. Deferred Beyond Initial Product Integration
- Full Visual Primitive Library (the 20+ item catalog).
- Creative Primitive Harness (automated ingestion/sanitization pipeline).
- Automated background removal / AI alpha matting.

---

## 13. Typography Review

### Current Shortcut & Risk Assessment
- **Current Mechanism (FACT):** The template sets `fontFamily: tokens.typography.display.family` directly in inline CSS styles.
- **Parity Vulnerability (RISK / FACT):**
  - Neither Next.js nor Remotion loads font files dynamically. Chromium relies on local operating system fonts.
  - If a production render executes on an AWS Lambda container or Linux Docker worker lacking "Fraunces" or "Space Grotesk", Chromium will silently substitute a generic serif/sans-serif font.
  - Silent font substitution alters text metrics, causing line breaks, title wrapping, and layout overflow to diverge drastically between authoring preview and final media.
- **Requirement Before Production (RECOMMENDATION):** A deterministic font loader must be integrated into the Remotion entrypoint (e.g. via `@remotion/google-fonts` or local `@font-face` asset injection) before deploying headless rendering workers.

---

## 14. Execution & RenderExecution Review

### Local Execution vs Durable Domain Model
The current spike generates ephemeral local JSON files (`*.execution.json`). These must be differentiated from future durable database records:

| Field / Concern | Local Spike Execution | Future Durable `RenderExecution` Table |
|---|---|---|
| Identity | Local filename / UUID | Database Primary Key (`id: uuid`) |
| Context | None | `project_id`, `production_id`, `user_id` |
| Manifest | Path to local JSON fixture | Pinned JSONB snapshot (`manifest_snapshot`) |
| Status | Synchronous string (`'succeeded'`) | State machine (`queued`, `rendering`, `succeeded`, `failed`) |
| Output | Local `.tmp/...` path | S3 key / `library_files` record |
| Technical Diagnostics | Console output / array | Structured JSONB diagnostic log |
| Runtime Options | CLI arguments (`concurrency: 1`) | Worker runtime profile metadata |

**Invariant Confirmed:** In accordance with `RENDER_ARCHITECTURE_V0.md`, a render failure does not alter or invalidate the manifest. The manifest is the immutable declaration of intent; `RenderExecution` is the operational log of an attempt to realize that intent.

---

## 15. Performance Review

### Analysis of Wave 8 Benchmark
- **Metric:** 6-second video · 180 frames · 1080×1920 · H.264 · 117.8 seconds local render time.
- **Throughput:** ~654 ms per frame.

### Factor Breakdown (INFERENCE)
1. **Concurrency Bottleneck:** `render-timeline-manifest.ts` explicitly sets `concurrency: 1`. Frames were rendered sequentially in a single Chromium tab.
2. **Cold Webpack Bundling:** Every CLI invocation bundles the entire Remotion codebase from scratch via `@remotion/bundler` (~4–6 seconds of startup overhead).
3. **Headless CSS Compositing Load:** `DocumentaryCard` utilizes heavy visual effects: multiple full-screen layered containers, `clipPath` polygons, `mix-blend-mode: soft-light` (grain overlay), `background-blend-mode: multiply` (paper skins), drop shadows, and SVG filters. On a developer machine without GPU rasterization flags, Chromium renders these via CPU software rasterization (SwiftShader).
4. **Encoding Overhead:** Local FFmpeg encoding of 1080×1920 frames into H.264.

### Performance Verdict
117.8 seconds is **not a failure of the architecture**; it is the predictable consequence of a local, unoptimized, sequential CLI benchmark with heavy compositing. The architecture remains sound.
- **Next Measurement Step (RECOMMENDATION):** Benchmark concurrency scaling (1 vs 2 vs 4 vs auto-cores) and profile frame capture time vs bundle time before contemplating visual simplifications or cloud infrastructure.

---

## 16. Test Architecture Review

### Test Inventory (31 files / 439 tests)
- **Pre-existing CAS Core:** 16 files, 288 tests (Project Identity, Context Compiler, Draft Hub, Studio Shell, etc.).
- **Creative Rendering Layer:** 15 files, 151 tests.

### Quality Distribution
1. **Contract & Schema Guardrails (High Value):** Tests verify `.strict()` rejection of illegal properties, invalid aspect ratios, out-of-order sequence contexts, and invalid frame durations.
2. **Architectural Fitness Functions (High Value):** `isolation.test.ts` and `renderer-isolation.test.ts` scan source code ASTs/regexes to guarantee zero unauthorized cross-layer imports.
3. **Runtime Resolution & Semantics (High Value):** Tests verify full resolution pipelines and semantic error detection (e.g. duplicate track IDs, segment bounds overflow).
4. **Orchestration Mocks (Medium Value / Slight Brittle Risk):** `static-render-path.test.ts` and `timeline-render-path.test.ts` mock `@remotion/bundler` and `execFileSync` to verify CLI flows without invoking Chromium.

---

## 17. Security Review

### Audit of `app/dev/creative-preview/render/route.ts`
1. **No Arbitrary Shell Execution (FACT):** Uses `spawn(process.execPath, [runner], { shell: false })`. No shell interpolation or shell injection is possible.
2. **Controlled Script Path (FACT):** `runner` is pinned to a hardcoded repository path (`scripts/creative/run-authoring-render.mjs`).
3. **Input Sanitization (FACT):** Input payload is parsed strictly via `authoringRenderRequestSchema`. Data is passed to the runner via standard input (`stdin.end()`).
4. **Path Traversal Prevention (FACT):** Output filenames are generated server-side using timestamps and `randomUUID()`. The client has zero influence over filesystem output paths.
5. **Environment Gating (FACT):** Route returns `404 Not Found` if `process.env.NODE_ENV === 'production'`.
6. **Productionization Warning (RECOMMENDATION):** This IPC bridge is suitable only for local developer workflows. Production environments must never spawn local Node render processes from HTTP handlers; they require an asynchronous queue and isolated workers.

---

## 18. Visual System Maturity

### Structural Evaluation
- **Visual Discipline:** The synthesis of Pack A (editorial typography, clear reading hierarchy, dominant evidence) and Pack B (organic collage, paper tearing, kraft tape, subtle rotation) is functional and aesthetically coherent.
- **Deterministic Composition:** The collage grammar relies on fixed, curated planes (`cover-collage-01` and `info-collage-01`). There is zero layout randomness.
- **Aspect Ratio Agility:** 4:5 (portrait card) and 9:16 (full vertical Reel) are independently staged. The 9:16 layout is an authentic vertical redesign, not an anamorphic stretch.
- **Verdict:** The visual system is structurally mature. Further aesthetic polish or new template variants (e.g. quote cards, data comparison) can proceed independently without altering the rendering architecture.

---

## 19. Architecture Debt & Risks

| Issue | Severity | Type | Evidence | Consequence | Recommended Timing |
|---|---|---|---|---|---|
| **Hardcoded Template in Resolver & Adapter** | High | FACT | `component-resolver.ts:5`, `TemplateSegment.tsx:25-27` hardcode `DocumentaryCard` | Second template cannot be registered or rendered without breaking changes | Before Product Integration |
| **Fixture-Only Asset Resolver** | High | FACT | `resolve-asset.ts:97` rejects `type !== 'fixture'` | System cannot render images from CAS Library or S3 | Before Product Integration |
| **Unresolved Font Pipeline** | High | FACT | No font files or loaders exist in Remotion entry | Headless renders risk silent font substitution and layout distortion | Before Production Rendering |
| **Hardcoded Dark Palette Heuristic** | Medium | FACT | `primitives.tsx:34-36` checks `#0b1020` explicitly for paper tint | Visual styles break if custom identities provide alternative dark backgrounds | Before Product Integration |
| **Unimplemented Motion Presets** | Low | FACT | `slow_pan` declared in descriptor but missing in JSX; `intensity` ignored | Manifests requesting slow pan render static content silently | Before Public Release |
| **Direct Material Ingestion in Component** | Low | FACT | `DocumentaryCard.tsx:95` resolves material fixtures internally | Materials bypass manifest and descriptor schemas | Later / Optional |
| **Sequential Render Concurrency** | Medium | FACT | `render-timeline-manifest.ts:33` pins `concurrency: 1` | Video renders take ~2 minutes locally | Before Production Rendering |
| **Proxy / Env Blocker on Dev Route** | Medium | FACT | `proxy.ts` intercepts `/dev/creative-preview` without Supabase credentials | Local developer preview blocked on fresh worktrees without `.env` | Before Product Integration |

---

## 20. Deferred Items Classification

### 1. BEFORE PRODUCT INTEGRATION
- Generalize `component-resolver.ts` and `TemplateSegment.tsx` to handle polymorphic component props.
- Add read-only asset resolution for CAS `LibraryFile` (mapping library IDs to S3 signed URLs).
- Bypass or mock Supabase session validation in `proxy.ts` for `/dev/creative-preview` when running in dev mode without `.env`.
- Establish a structured bridge between Project Identity and `VisualTokensSnapshot`.

### 2. BEFORE PRODUCTION RENDERING
- Implement deterministic font loading in Remotion compositions (bundling local font files or loading via `@remotion/google-fonts`).
- Benchmark and configure render concurrency (`concurrency: 4+`).
- Define the database schema for the durable `RenderExecution` table.
- Build asynchronous job queue (e.g. BullMQ / Inngest) with dedicated rendering worker processes or Remotion Lambda integration.

### 3. BEFORE PUBLIC RELEASE
- Implement multi-track audio compositing (audio segments, gain, voiceover).
- Support burn-in and sidecar captions (`CaptionSegment`).
- Implement remaining declared motion presets (`slow_pan`, `rise`, `reveal`) and consume `MotionSpec.intensity`.
- Implement visual regression testing across all template variants.

### 4. LATER / OPTIONAL
- Full Visual Primitive Library and Creative Primitive Harness.
- Dynamic asset provenance tracking and licensing verification.
- Interactive web-based timeline editing UI.

---

## 21. Roadmap Reconciliation

### The Dilemma
- Original Plan (`SHARED_CREATIVE_RENDERING_SPIKE_PLAN_V0.md`): Wave 9 = Visual QA / Parity; Wave 10 = Final Verdict.
- Implementation Suggestion (Wave 8 Report): Wave 9 = Production Execution Infrastructure.

### Analysis & Synthesis
- **Why Pure Visual QA is Insufficient for Wave 9:** Visual parity was already substantially proven in Waves 5, 7, and 8 via `sharp`, `ffmpeg` frame extraction, and automated metadata comparison. A wave dedicated solely to re-inspecting pixels yields diminishing returns.
- **Why Jumping to Production Infrastructure is Premature:** Deploying queues, worker clusters, and database tables while `resolveAsset()` rejects real files and `TemplateSegment` hardcodes `DocumentaryCard` would calcify spike shortcuts into production debt.

### Recommended Roadmap

#### Wave 9: Architecture Hardening & Real Integration Slice
1. **Multi-Template Proof:** De-hardcode `component-resolver.ts` and `TemplateSegment.tsx`. Register a minimal second template (e.g. `editorial.quote-card@0.1.0` or `minimal.stat-card@0.1.0`) to prove the registry and timeline adapter are genuinely polymorphic.
2. **Real Asset Resolution Slice:** Enable `resolveAsset()` to resolve at least one real CAS asset type (`library_file`) using the existing `lib/storage/s3.ts` client.
3. **Font Resolution Proof:** Add deterministic font loading for `Fraunces` and `Source Sans 3` in the Remotion bundle, guaranteeing parity on headless environments.
4. **Proxy Exemption:** Ensure `/dev/creative-preview` can be loaded and tested in browser environments without requiring active Supabase cloud credentials.
5. **Formal Visual Parity Matrix:** Run an automated comparison across all 4 canonical matrices (Still 4:5, Still 9:16, Video 9:16, Identities A/B) and archive visual diff artifacts.

#### Wave 10: Final Verdict & Production Blueprint
1. **Formal Engine Assessment:** Evaluate Remotion's final fitness against HyperFrames / alternative engines based on hardened Wave 9 metrics.
2. **Production Blueprint:** Specify the database migration for `render_executions`, the asynchronous worker topology, and the cloud execution strategy (Remotion Lambda vs ECS/Fargate container workers).
3. **Formal Spike Closure:** Issue the definitive `PROCEED` sign-off to exit the spike and enter core product integration.

---

## 22. Final Verdict

### Selection: **`PROCEED_WITH_CONSTRAINTS`**

### Rationale
The Shared Creative Rendering architecture is conceptually sound, cleanly isolated, and empirically validated. It successfully unifies static and video rendering under a single declarative domain model while protecting the existing Content Agent Studio codebase from framework contamination.

Proceeding is strongly recommended, provided that **Wave 9 focuses on architecture hardening and real integration proof** rather than premature infrastructure deployment.

---
*Report compiled autonomously following read-only cross-cutting architectural audit of Waves 0 through 8.*
