# Content Studio render-worker runtime (Phase 2I-A1)

Isolated, portable payload that runs the existing, proven Content Studio
timeline renderer (`ResolvedTimelineInput → TimelineComposition → Remotion →
MP4`) without the Next.js application. Intended to be bind-mounted into the
already-working VPS Remotion/Chromium container (Node + `remotion` +
`@remotion/renderer` + `@remotion/bundler` + Chromium already proven there).

**This directory does not contain a second renderer.** Everything under
`dist/content-studio/remotion/`, `dist/content-studio/lib/`, and
`dist/content-studio/components/` is copied byte-for-byte from the main repo
by `export.mjs` — the render tree (`TimelineComposition`, `TemplateSegment`,
`DocumentaryCard`, `QuoteCard`, `component-resolver`, `resolve-typography`,
`resolve-asset`) is unmodified, authoritative repo source. The only genuinely
new code is `remotion-entry.tsx` (a narrower Remotion root that registers
only the one composition the worker needs) and `server.mjs` (a plain-Node
HTTP wrapper around the same `bundle → selectComposition → renderMedia` calls
`scripts/creative/render-timeline-manifest.ts`'s `renderResolvedTimelineInput`
already uses).

## Scope boundary (deliberate, this phase)

The worker starts from an already-resolved `ResolvedTimelineInput`. It does
**not** load a `VideoDraft`, query Supabase, resolve a `LibraryFile`, or
presign an S3 URL — the caller (a future authenticated API route) is
responsible for calling `prepareVideoDraftTimeline` (or the static
equivalent) first and handing this worker the result, whose asset URLs are
already real, fetchable URLs. This worker also does not implement auth,
queues, `render_executions`, retries, cancellation, or progress percentages
— see `docs/productization/creative-rendering/PHASE_2I0_...md` for why those
are deliberately out of scope here.

## 1. Dependency graph (Task 1/2)

Entry point traced from the real successful MP4 proofs
(`scripts/creative/render-timeline-manifest.ts: renderResolvedTimelineInput`,
used by every real MP4 this repo has produced — Phase 2G-C, 2G-D):

```
bundle(entry=remotion/index.ts) -> selectComposition('TimelineManifestVideo')
  -> renderMedia -> MP4
```

`remotion/index.ts` -> `remotion/Root.tsx` registers `TimelineManifestVideo`
using `TimelineComposition`, but `Root.tsx` ALSO statically imports
`SpikeComposition`, `DocumentaryCardStillComposition`,
`StaticRenderManifestStillComposition`, and calls `resolveTimelineManifest`
against a fixture at module-eval time (for its own dev/spike compositions'
`defaultProps`) — none of which the isolated worker needs. `remotion-entry.tsx`
is a narrower replacement root that imports only what `TimelineComposition`
itself needs, reusing `TimelineComposition` unmodified.

Real transitive **value** (runtime) dependency closure of
`TimelineComposition` (traced import-by-import, not guessed):

| # | File | Why required |
|---|---|---|
| 1 | `remotion/timeline/TimelineComposition.tsx` | the composition itself |
| 2 | `remotion/timeline/TemplateSegment.tsx` | per-segment renderer, imported by (1) |
| 3 | `remotion/timeline/frame-model.ts` | `segmentFrameState`, imported by (2) |
| 4 | `remotion/DocumentaryCardComposition.tsx` | `remotionTemplateProps`, imported by (2) |
| 5 | `remotion/TypographyReadyBoundary.tsx` | imported by (1) and (4); gates render on local `@font-face` load |
| 6 | `lib/creative/templates/component-resolver.ts` | `resolveTemplateBinding`, imported by (2) |
| 7 | `lib/creative/typography/resolve-typography.ts` | `awaitTypographyReady`, imported by (5) |
| 8 | `lib/creative/assets/resolve-asset.ts` | `resolveFixtureAssetSync`, imported by `DocumentaryCard.tsx` (unconditional paper/tape material fallback) |
| 9 | `components/creative/documentary-card/{DocumentaryCard,CoverVariant,InfoVariant,primitives,types,index}.tsx/ts` | registered component for `editorial.documentary-card`, imported by (6) |
| 10 | `components/creative/quote-card/{QuoteCard,index}.tsx/ts` | registered component for `editorial.quote-card`, imported by (6) |

**Everything else** imported by these files (`ResolvedTimelineInput`,
`ResolvedAsset`, `AssetRef`, `VisualTokensSnapshot`, `PrimitiveTransforms`,
`ResolvedStaticRenderInput`, `AuthoringRenderOverrides`, `DocumentaryCardPreviewTuning`,
etc.) is imported with `import type` only — verified file-by-file, not
assumed. TypeScript/babel elide type-only imports before webpack resolves a
module path, so `lib/creative/resolution/resolve-timeline.ts`,
`lib/creative/resolution/resolve-static-render.ts`,
`lib/creative/templates/registry.ts` (and its zod schema parsing),
`lib/schemas/creative/*.ts`, `lib/creative/primitives/transforms.ts`, and
`lib/creative/authoring/{render-request,types}.ts` are **not** copied and are
**not** needed at render time. This is not merely asserted — it is proven by
`export.mjs` NOT copying them and the local proof (§6) still producing a real
MP4 with `remotion-entry.tsx` bundling successfully.

`resolveTemplate`/`registry.ts`'s zod-schema validation is never reached by
the worker: `TemplateSegment.tsx` calls `resolveTemplateBinding` (a plain
string→component lookup table in `component-resolver.ts`), not
`resolveTemplate` (the zod-schema-backed registry) — those are two different,
deliberately separate modules in the source repo.

## 2. Dependency classification (Task 2)

| Class | Items |
|---|---|
| **1. REQUIRED WORKER SOURCE** | The 16 files listed in §1's table (copied verbatim by `export.mjs`) plus `remotion-entry.tsx` and `server.mjs` (new, worker-only) |
| **2. EXISTING BASE-IMAGE DEPENDENCY** | `remotion`, `@remotion/renderer`, `@remotion/bundler`, `react`, `react-dom` — resolved via Node's normal `node_modules` parent-directory walk-up from `/app/content-studio` to `/app/node_modules`; never copied or reinstalled by this package |
| **100. EXTRA NPM RUNTIME DEPENDENCY** | **None.** See Task 8 — no package in the worker's actual runtime path needs anything beyond class 2. `server.mjs` uses only Node's built-in `http`/`fs`/`path`/`os`/`crypto` modules |
| **101. CONTROL-PLANE / NEXT-ONLY (not copied)** | `app/**`, `next.config.mjs`, Supabase clients, `lib/storage/s3.ts`, `lib/creative/integration/**`, `lib/creative/authoring/**` (except the type-only `types.ts`/`render-request.ts`, not copied — type-only), all of `/videos`, `/imagens`, dashboard UI |
| **102. TEST / FIXTURE / DEV ONLY (not copied)** | `lib/creative/__tests__/**`, `lib/schemas/creative/__tests__/**`, `scripts/creative/*.mjs`/`*.ts` (reused only as reference, not copied), `remotion/Root.tsx`, `remotion/SpikeComposition.tsx`, `remotion/index.ts`, `app/dev/creative-preview/**`, `lib/creative/fixtures/**` |

## 3. Remotion version compatibility (Task 3)

| Package | Local (Content Studio, `package.json`) | VPS base image (given) |
|---|---|---|
| `remotion` | `4.0.526` | `4.0.448` |
| `@remotion/renderer` | `4.0.526` | `4.0.448` |
| `@remotion/bundler` | `4.0.526` | `4.0.448` |
| `react` | `^19` | not specified — must be checked against the base image's own `react`/`react-dom` at bind-mount time |
| `react-dom` | `^19` | not specified — same |

**Verdict: `COMPATIBLE_AS_IS`, with one explicit caveat.**

Because this package intentionally does **not** ship its own
`node_modules` (per the phase's own infrastructure fact: the VPS container
already provides these), Node's module resolution means the worker will
actually execute against whatever `remotion`/`@remotion/renderer`/`@remotion/bundler`
versions live in `/app/node_modules` on the VPS (`4.0.448`) — **not** the
`4.0.526` declared in the main repo's `package.json`. The local proof in this
phase (§6) therefore validated the worker's source against `4.0.526` (the
only version available in this environment), not `4.0.448` — this is an
**OPEN QUESTION carried into the VPS step**, not silently ignored.

Why `COMPATIBLE_AS_IS` rather than `VERSION_ALIGNMENT_REQUIRED`: every
Remotion API this worker's copied source touches is long-stable, core
surface — `useCurrentFrame`, `Composition`, `registerRoot`, `delayRender`/
`continueRender`, `bundle()`, `selectComposition()`, `renderMedia()` — none of
it is a recently-introduced or edge-case API. A 78-patch-version gap within
the same `4.0.x` line is exactly the kind of drift Remotion's own versioning
policy is designed to keep safe for this API surface. No source change was
made to align versions, per the phase's explicit instruction not to update
dependency versions unless absolutely required. **The human operator should
still watch the first real VPS render for any renderer-level error**, since
this phase cannot execute against `4.0.448` directly.

## 4. JS/TS execution audit (Task 4)

- Everything under `dist/content-studio/remotion/`, `lib/`, and
  `components/` stays exactly as `.ts`/`.tsx` source, unmodified. It is never
  executed directly by Node — `@remotion/bundler`'s `bundle()` call inside
  `server.mjs` hands it to Remotion's own webpack pipeline, which transpiles
  TS/TSX itself (the same thing that already happens for every existing
  local render in this repo). **No `tsx`/`ts-node`/compilation toolchain was
  added.**
- `server.mjs` and `export.mjs`/`generate-fixture.mjs` are plain `.mjs` —
  executed directly by Node, ESM unambiguously (the `.mjs` extension is
  ESM regardless of any `package.json` `"type"` field, and no `package.json`
  is shipped in the worker package at all — module resolution to
  `/app/node_modules` works via Node's directory walk-up with or without one).
- `remotion-entry.tsx` imports exclusively via the repo's existing `@/...`
  alias (never a relative `./...` path) so it resolves identically whether
  it sits in the main repo (for `pnpm typecheck`/`pnpm lint`, which both
  passed — see §7) or in the copied `dist/content-studio/` tree, as long as
  `server.mjs`'s `webpackOverride` maps `'@'` to the tree's own root — the
  same aliasing pattern `scripts/creative/render-timeline-manifest.ts`
  already uses.

## 5. Package layout

```
infra/render-worker-runtime/
├── remotion-entry.tsx      # new, thin Remotion root (registers TimelineManifestVideo only)
├── server.mjs              # new, plain-Node HTTP wrapper (GET /health, POST /render)
├── export.mjs               # deterministic copy script — the anti-duplication seam
├── generate-fixture.mjs     # offline: derives fixtures/canonical-input.json from the real repo pipeline
├── README.md                 # this file
├── .gitignore                # dist/, fixtures/, server.log (all regeneratable/local-only)
└── dist/content-studio/      # generated by export.mjs — COPY THIS to the VPS
    ├── server.mjs
    ├── remotion-entry.tsx
    ├── remotion/…             (copied, unmodified)
    ├── lib/creative/…         (copied, unmodified)
    ├── components/creative/…  (copied, unmodified)
    ├── public/creative-fonts/…    (6 .woff2 files)
    ├── public/creative-fixtures/torn-paper-cream-01.png, tape-kraft-01.png
    └── fixtures/canonical-input.json
```

## 6. Local validation performed this phase (Task 5)

1. `node infra/render-worker-runtime/generate-fixture.mjs` — ran the real,
   unmodified `resolveTimelineManifest` against a manifest shaped exactly
   like the real product path (one `editorial.documentary-card` "cover"
   segment, `library_file` hero) and wrote the result to
   `fixtures/canonical-input.json`. **Succeeded** — confirms the manifest
   shape is still valid against current repo schemas.
2. `node infra/render-worker-runtime/export.mjs` — copied 26 files into
   `dist/content-studio/`.
3. Swapped the fixture's documented placeholder `hero.url` for a real,
   publicly reachable test image and started the worker:
   `node dist/content-studio/server.mjs` (from inside
   `infra/render-worker-runtime/dist/content-studio/`, so Node's module
   resolution reaches the main repo's own `node_modules`, standing in for
   `/app/node_modules` on the VPS).
4. `GET /health` → `{"status":"ok"}`.
5. `POST /render` with the canonical payload → **succeeded twice**:
   - Cold (first bundle): 1080×1920, h264, 90 frames, 3.0s, **47.7s**
   - Warm (bundle cached): same output shape, **30.7s**
   - `ffprobe` on the produced file independently confirmed:
     `codec_name=h264, width=1080, height=1920, r_frame_rate=30/1, duration=3.000000`
6. `pnpm typecheck` — **PASS** (confirms `remotion-entry.tsx`'s `@/...`
   imports resolve correctly at rest in the main repo).
7. `pnpm lint` (targeted at the new files, then full repo) — **0 new
   errors/warnings**; full-repo lint remained the inherited **0 errors / 45
   warnings** baseline.
8. Existing renderer/timeline tests
   (`renderer-isolation`, `timeline-render-path`, `timeline-adapter`,
   `patch-resolved-timeline-assets`, `prepare-scene-assets`) — **42/42
   passed**.
9. Full suite — **596/596 passed** (identical count to the Phase 2H-C
   baseline — no regression).
10. `pnpm build` — **PASS**, exit code 0. No new `app/api/**` route was
    added; the Next.js route manifest is unchanged.

This is a **local proof only**. It does not, and cannot, prove VPS success —
per the phase's own instruction, VPS execution is performed manually by the
human operator.

## 7. Exact commands

Regenerate the payload from current repo source:
```
node infra/render-worker-runtime/generate-fixture.mjs
node infra/render-worker-runtime/export.mjs
```

Start the worker (from inside the exported tree, so module resolution finds
`remotion`/`@remotion/bundler`/`@remotion/renderer`/`react`/`react-dom` in
the parent `node_modules` — `/app/node_modules` on the VPS):
```
cd infra/render-worker-runtime/dist/content-studio
node server.mjs
```
Optional env vars: `PORT` (default `3456`), `RENDER_OUTPUT_DIR` (default
`os.tmpdir()/content-studio-render-worker`).

Proof render — **first replace `hero.url` in `fixtures/canonical-input.json`
with a real, reachable image URL** (the generated file intentionally ships a
placeholder, `https://REPLACE-WITH-A-REAL-REACHABLE-IMAGE-URL/example.png`,
so nothing renders against a fake URL by accident):
```
curl -s -X POST http://localhost:3456/render \
  -H "Content-Type: application/json" \
  --data '{"resolvedInput": <contents of fixtures/canonical-input.json>}'
```
Produces `/tmp/content-studio-render-worker/content-studio-proof-<uuid>.mp4`
(or `%RENDER_OUTPUT_DIR%` on Windows).

## 8. Exact VPS copy target

Copy the **contents of** `infra/render-worker-runtime/dist/content-studio/`
(not the `dist/` wrapper directory itself) to:
```
VPS host:   /opt/content-studio/render-worker
container:  /app/content-studio   (bind-mount of the above)
```
`server.mjs` must end up at `/app/content-studio/server.mjs` so that its own
`node_modules` walk-up reaches `/app/node_modules`.

## 8.1. Resident service command (Phase 2I — Production Video Operational Closure)

**The container/service start command is `node entrypoint.bundle.cjs`, not
`node server.mjs`.** See
`docs/productization/creative-rendering/PHASE_2I_PRODUCTION_VIDEO_OPERATIONAL_CLOSURE.md`
for the full root-cause writeup. In short: `server.mjs` and `coordinator.mjs`
were both only ever run manually, one command at a time, during proof
sessions — nothing started the coordinator's continuous poll/claim/render
loop automatically, so a queued `render_executions` row was never claimed in
production. `entrypoint.bundle.cjs` is a new resident supervisor that:

1. Spawns `server.mjs` (unchanged) and waits for `GET /health` to pass.
2. Spawns `coordinator.bundle.cjs` with `CONTENT_STUDIO_RENDER_LOOP` forced
   to `1` (the coordinator's existing continuous-loop mode).
3. Restarts either child (bounded exponential backoff, never a busy loop) if
   it exits unexpectedly, and stops both cleanly on SIGTERM/SIGINT.

`GET /health` now also reports coordinator liveness:
`{ "status": "ok" | "degraded", "coordinator": { running, restartCount, lastExitCode, lastExitSignal, lastStartedAt } | null }`.
`coordinator: null` means no supervisor is present (e.g. a local
`node server.mjs` proof run) — that is still `"ok"`, not `"degraded"`.

## 9. Dependency manifest — explicit answers (Task 8)

| Question | Answer |
|---|---|
| Does the worker need `zod`? | **No.** Schema validation (`registry.ts`, `resolve-timeline.ts`) is not in the worker's reached code path — the worker receives an already-resolved input and does only light manual shape checks (`server.mjs: validateResolvedInput`). |
| Does it need the AWS SDK? | **No.** Asset URLs already arrive fully resolved (presigned or otherwise) inside `resolvedInput`; Chromium fetches them directly. |
| Does it need Next.js? | **No.** Nothing under `next/*` is imported anywhere in the copied closure. |
| Does it need Supabase? | **No.** |
| Does it need Sharp? | **No.** Not imported anywhere in the render path (only referenced by unrelated primitive-catalog/raster-validation code, not copied). |
| Does it need ffmpeg/ffprobe binaries? | **No**, for the render itself — `renderMedia` encodes via `@remotion/renderer`'s own bundled pipeline. (The main repo's proof scripts use external `ffmpeg`/`ffprobe` only for post-render diagnostic frame extraction, deliberately omitted here per Task 6.) |
| Does it need fonts not present in the base image? | **Yes** — 6 `.woff2` files under `public/creative-fonts/` (Fraunces 700, Source Sans 3 400/600, Space Grotesk 700, Inter 400/600), served by Remotion's own bundled `publicDir`, not by the OS. Already copied by `export.mjs`. |
| Does it need any CSS/image/font files from `public/`? | **Yes** — the 6 fonts above, plus `public/creative-fixtures/torn-paper-cream-01.png` and `tape-kraft-01.png` (the DocumentaryCard template's unconditional paper/tape material textures — used whenever no `primitiveMaterials` override is supplied, which is always true for this worker's boundary). No other `public/` files are reached. |
| Does it need `@/...` aliases that fail outside Next? | Handled — `server.mjs` sets the identical webpack `resolve.alias['@']` override the main repo's own `render-timeline-manifest.ts` already uses, pointed at the worker's own root. |
| Does it depend on `tsconfig` path resolution? | **No** for the render/bundle side (webpack alias only, not the `tsconfig.json` `paths` plugin). The main repo's `tsconfig.json` `paths` entry is used only so `pnpm typecheck`/`pnpm lint` can validate `remotion-entry.tsx` at its resting location in the main repo. |
| Does it require environment variables? | **No required vars.** `PORT` and `RENDER_OUTPUT_DIR` are optional overrides with safe defaults. |

## 10. Portability audit (Task 9)

Searched the copied closure for: `process.cwd()`, Windows absolute paths,
Next.js aliases/`next/*`, browser-only globals outside the intentional
`document.fonts` check (already guarded — `resolve-typography.ts`'s
`awaitTypographyReady` returns `[]` early when `document` is undefined,
which is Chromium-inside-Remotion, not Node, so this is expected and
correct), Supabase clients, Vercel-specific code, and hardcoded `public/`
path assumptions. **None found** in the 16 copied source files — they were
already written to be renderer/persistence-agnostic per this codebase's own
existing architecture rules (Phase 2D0 §11, Phase 2G0 §11). No source
modification was required to make them portable; only packaging
(`export.mjs`) and the two new worker-only files were needed.

## 11. Verdict

**`READY_FOR_VPS_BIND_MOUNT_PROOF`**

The extraction required no renderer rewrite and no source modification to
any existing Content Studio file — only a deterministic copy of an already
narrow, already-portable dependency closure, plus two small new files
(`remotion-entry.tsx`, `server.mjs`). The local proof produced a real,
`ffprobe`-verified H.264 MP4 (1080×1920, 30fps, 90 frames, 3.0s) through the
exact copied tree, twice. The one open item — `4.0.526` (local, used for
this proof) vs. `4.0.448` (VPS base image, unverified against this specific
source this phase) — is disclosed, not hidden, and does not touch any
recently-changed Remotion API surface.
