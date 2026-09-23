#!/usr/bin/env node
/**
 * Phase 2I-A1 — deterministic export of the isolated Content Studio Remotion
 * render-worker payload.
 * Phase 2I-B3 — adds an esbuild bundling step for the worker coordinator
 * (see "Coordinator bundling" below) — the dependency-portability gate this
 * phase requires (Task 5).
 *
 * This script is the anti-duplication seam required by this phase: it does
 * NOT hand-maintain a second copy of the renderer. It copies the exact,
 * named set of existing repo source files (unmodified) into
 * `infra/render-worker-runtime/dist/content-studio/`, preserving their
 * original relative paths, plus the two worker-only files that genuinely
 * are new (`remotion-entry.tsx`, `server.mjs`) and the static assets the
 * render path depends on (fonts + the unconditional DocumentaryCard
 * material textures). Re-run this script any time the source files change;
 * `dist/` is gitignored and always disposable/regeneratable.
 *
 * Coordinator bundling (Phase 2I-B3): `coordinator.mjs` (and everything it
 * imports — `minio-upload.mjs`, and the shared
 * `lib/render-execution/{scratch-output-target,minio-client-config,worker-lifecycle}.ts`
 * helpers) is bundled with esbuild into a single, dependency-free
 * `coordinator.bundle.cjs` in the SAME dist directory as `server.mjs`. This
 * is required because, unlike server.mjs's dependency closure
 * (`remotion`/`@remotion/*`, already provided by the VPS base image's
 * `/app/node_modules` — see README.md §2), `@aws-sdk/client-s3` is NOT
 * provided there and this package deliberately ships no `node_modules` of
 * its own. Bundling closes that gap entirely: the VPS never needs to
 * resolve `@aws-sdk/client-s3` (or anything else new) at all.
 *
 * Usage: node infra/render-worker-runtime/export.mjs
 */
import { mkdir, copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const distRoot = path.join(here, 'dist', 'content-studio')

/**
 * Every file here is a value-import dependency (directly or transitively)
 * of `remotion-entry.tsx` -> TimelineComposition -> TemplateSegment for a
 * REAL render (ResolvedTimelineInput already resolved, so
 * resolve-timeline.ts / registry.ts / zod schema validation are never
 * reached at runtime — see PHASE_2I_A1 dependency map in README.md).
 * Files that are ONLY ever imported with `import type` elsewhere in this
 * list are deliberately NOT copied — TypeScript/babel elide type-only
 * imports before webpack ever tries to resolve the module, so the physical
 * file is not required. This is verified empirically by the local proof
 * (README.md "Validation"), not merely assumed.
 */
const REQUIRED_WORKER_SOURCE = [
  'remotion/timeline/TimelineComposition.tsx',
  'remotion/timeline/TemplateSegment.tsx',
  'remotion/timeline/frame-model.ts',
  'remotion/DocumentaryCardComposition.tsx',
  'remotion/TypographyReadyBoundary.tsx',
  'remotion/RenderAssetsReadyBoundary.tsx',
  'lib/creative/templates/component-resolver.ts',
  'lib/creative/typography/resolve-typography.ts',
  'lib/creative/assets/resolve-asset.ts',
  'components/creative/documentary-card/DocumentaryCard.tsx',
  'components/creative/documentary-card/CoverVariant.tsx',
  'components/creative/documentary-card/InfoVariant.tsx',
  'components/creative/documentary-card/primitives.tsx',
  'components/creative/documentary-card/types.ts',
  'components/creative/documentary-card/index.ts',
  'components/creative/quote-card/QuoteCard.tsx',
  'components/creative/quote-card/index.ts',
]

/** Static assets the render path fetches from Remotion's bundled publicDir. */
const REQUIRED_STATIC_ASSETS = [
  'public/creative-fonts/fraunces-700.woff2',
  'public/creative-fonts/source-sans-3-400.woff2',
  'public/creative-fonts/source-sans-3-600.woff2',
  'public/creative-fonts/space-grotesk-700.woff2',
  'public/creative-fonts/inter-400.woff2',
  'public/creative-fonts/inter-600.woff2',
  // Unconditional DocumentaryCard material textures (documentaryCardPropsFromRuntimeInput
  // always falls back to these fixture assets when no primitiveMaterials is
  // supplied — true for every real render this worker performs, since the
  // worker boundary starts from ResolvedTimelineInput and never receives
  // primitiveMaterials/primitiveTransforms). Keep these paths aligned with
  // MATERIAL_PATHS in components/creative/documentary-card/primitives.tsx.
  'public/creative-fixtures/pack-b/paper-card-light-01.png',
  'public/creative-fixtures/pack-b/paper-strip-light-01.png',
  'public/creative-fixtures/pack-b/tape-kraft-short-01.png',
  'public/creative-fixtures/pack-b/pin-brass-01.png',
  'public/creative-fixtures/pack-b/botanical-dried-sprig-01.png',
  // Static Render Worker V1 — every fixture asset a StaticRenderManifest can
  // bind (lib/creative/assets/resolve-asset.ts FIXTURE_ASSETS): the Creative
  // Editor's default Cover hero + the Portal logo, plus the remaining
  // registered fixtures so a static render never 404s a template asset.
  'public/creative-fixtures/documentary-card-hero-01.webp',
  'public/creative-fixtures/comunidades-alternativas-logo-v1.svg',
  'public/creative-fixtures/terra-una-documentary-photo-01.svg',
  'public/creative-fixtures/acme-labs-hero-01.svg',
]

/**
 * Worker-only files that are genuinely new source, not copies of app code.
 * `coordinator.mjs`/`minio-upload.mjs` are copied here in SOURCE form for
 * operator readability/debugging only — the VPS must run the bundled
 * `coordinator.bundle.cjs` (produced by bundleCoordinator() below), never
 * these raw files directly (they import `@aws-sdk/client-s3` and the
 * shared `lib/render-execution/*.ts` helpers by relative/bare specifier,
 * neither of which resolves standalone on the VPS).
 */
const WORKER_OWN_FILES = [
  { from: path.join(here, 'remotion-entry.tsx'), to: 'remotion-entry.tsx' },
  { from: path.join(here, 'server.mjs'), to: 'server.mjs' },
  { from: path.join(here, 'coordinator.mjs'), to: 'coordinator.source.mjs' },
  { from: path.join(here, 'minio-upload.mjs'), to: 'minio-upload.source.mjs' },
  { from: path.join(here, 'entrypoint.mjs'), to: 'entrypoint.source.mjs' },
]

async function copyOne(relativePath) {
  const from = path.join(repoRoot, relativePath)
  const to = path.join(distRoot, relativePath)
  await mkdir(path.dirname(to), { recursive: true })
  await copyFile(from, to)
}

/**
 * Bundles the worker coordinator + MinIO upload client + shared
 * lib/render-execution/*.ts helpers into one self-contained
 * `coordinator.bundle.cjs`. `platform: 'node'` makes esbuild treat Node
 * built-ins (fs, path, os, crypto, http, https, stream, zlib, events,
 * buffer, url, net, tls, util, assert, querystring, dns, worker_threads,
 * perf_hooks, string_decoder, timers, child_process) as external
 * automatically — they are provided by the Node runtime itself, not
 * bundled — while every actual npm dependency (`@aws-sdk/client-s3` and
 * its own transitive closure) is inlined. No `external` npm packages are
 * declared: the entire point of this step is that the output resolves
 * NOTHING beyond Node itself.
 */
async function bundleCoordinator() {
  const entry = path.join(here, 'coordinator.mjs')
  // .cjs, not .mjs: @aws-sdk/client-s3's own dependency closure
  // (@smithy/util-buffer-from et al.) contains CJS modules that call a
  // dynamic, variable-argument `require(moduleName)` for Node builtins
  // (e.g. `require('buffer')`). esbuild's ESM output target has no real
  // `require` to hand those through to (Node's ESM loader has no synchronous
  // require builtin), so it throws `Dynamic require of "..." is not
  // supported` at runtime — a known esbuild+ESM limitation, not a bug in
  // this worker's own code. Bundling to CommonJS instead gives the output a
  // real `require()` (Node natively resolves builtins through it), which
  // resolves the whole dependency graph cleanly. The coordinator's own
  // source uses no top-level await or other ESM-only construct, so CJS
  // output is a strict downgrade in format only, not in behavior.
  const outfile = path.join(distRoot, 'coordinator.bundle.cjs')
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    // .ts loader lets esbuild transpile the shared lib/render-execution/*.ts
    // helpers it pulls in via relative import — no separate tsc step.
    loader: { '.ts': 'ts' },
    // No banner: coordinator.mjs (the entry point) already starts with its
    // own `#!/usr/bin/env node` shebang, which esbuild preserves verbatim
    // as line 1 of the output — adding a banner would duplicate it onto
    // line 2, which Node does NOT treat as a shebang (only line 1 is
    // stripped), producing a SyntaxError.
    logLevel: 'silent',
  })
  // A genuinely unresolved import/require in bundled source is a hard
  // esbuild ERROR (build() throws), not merely a warning — so reaching
  // this line with zero errors already proves every actual import
  // statement resolved and was inlined. (@aws-sdk/client-s3's dependency
  // closure only ever *mentions* the optional native CRT signer package
  // names — @aws-sdk/signature-v4-crt / @aws-sdk/signature-v4a — inside
  // error-message STRING LITERALS advising a user who explicitly wants
  // SigV4A multi-region signing to `require()` them manually; this worker
  // never uses that feature, so those strings are dead text, not imports.)
  if (result.warnings.length > 0) {
    console.warn('[export] esbuild warnings while bundling coordinator.mjs:')
    for (const w of result.warnings) console.warn(`  ${w.text}`)
  }
  return outfile
}

/**
 * Phase 2I — Production Video Operational Closure. Bundles the NEW resident
 * supervisor entry point (`entrypoint.mjs`) the exact same way
 * `bundleCoordinator()` already bundles `coordinator.mjs`: it imports the
 * pure `lib/render-execution/resident-supervisor-policy.ts` helpers by
 * relative path, which only resolves through esbuild's `.ts` loader — never
 * directly via `node entrypoint.mjs` on the VPS (same constraint
 * `coordinator.mjs`/`coordinator.source.mjs` already documents above).
 * `entrypoint.bundle.cjs` is what the worker service's start command must
 * run from now on — it spawns and supervises BOTH `server.mjs` (unbundled,
 * unchanged) and `coordinator.bundle.cjs` as child processes, so a single
 * command makes the whole resident lifecycle (render HTTP wrapper + queue
 * consumer) start automatically together.
 */
async function bundleEntrypoint() {
  const entry = path.join(here, 'entrypoint.mjs')
  const outfile = path.join(distRoot, 'entrypoint.bundle.cjs')
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    loader: { '.ts': 'ts' },
    logLevel: 'silent',
  })
  if (result.warnings.length > 0) {
    console.warn('[export] esbuild warnings while bundling entrypoint.mjs:')
    for (const w of result.warnings) console.warn(`  ${w.text}`)
  }
  return outfile
}

/**
 * Task 15 — portable dependency-load smoke test. Runs the bundled
 * coordinator from a CWD OUTSIDE the repo entirely (os.tmpdir()) with a
 * deliberately empty environment (no CONTROL_PLANE_URL/WORKER_SECRET, and
 * critically no repo node_modules reachable via directory walk-up from that
 * CWD) — proving module resolution never depended on the source
 * repository's node_modules being present.
 *
 * The bundle's own first lines synchronously validate two required env
 * vars and process.exit(1) with a specific message BEFORE doing anything
 * else. Reaching that exact message means every import in the module graph
 * already resolved and evaluated successfully — a real unresolved import
 * would instead throw Node's own ERR_MODULE_NOT_FOUND before any of the
 * script's own code runs at all. This is a stronger, executable proof than
 * static source scanning (which cannot distinguish an actual import from
 * the same text appearing inside an unrelated string literal).
 */
async function smokeTestBundlePortability(outfile) {
  const cwd = os.tmpdir() // deliberately outside the repo tree
  try {
    await execFileAsync(process.execPath, [outfile], {
      cwd,
      env: { PATH: process.env.PATH }, // no CONTENT_STUDIO_* vars at all
      timeout: 15_000,
    })
    throw new Error('[export] smoke test: expected the bundle to exit(1) on missing required env vars, but it exited 0.')
  } catch (err) {
    const stderr = err.stderr ?? ''
    if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(stderr)) {
      throw new Error(
        `[export] smoke test FAILED — coordinator.bundle.cjs could not resolve a module when run outside the repo:\n${stderr}`,
      )
    }
    if (err.code !== 1 || !/CONTENT_STUDIO_CONTROL_PLANE_URL is required/.test(stderr)) {
      throw new Error(
        `[export] smoke test FAILED — unexpected exit (code=${err.code}). stderr:\n${stderr}\nstdout:\n${err.stdout ?? ''}`,
      )
    }
    // Expected: exit 1, "CONTENT_STUDIO_CONTROL_PLANE_URL is required" —
    // proves the full module graph loaded successfully outside the repo.
  }
}

/**
 * Portable dependency-load smoke test for entrypoint.bundle.cjs. Unlike
 * coordinator.mjs (which fails fast on missing required env vars — a
 * naturally cheap, deterministic exit this file reuses for its own smoke
 * test), entrypoint.mjs's real startup path spawns child processes and
 * waits on health checks/timers, which would make an executable smoke test
 * slow and non-deterministic. Instead this uses the explicit,
 * documented-as-test-only `CONTENT_STUDIO_SUPERVISOR_SELFTEST=1` escape
 * hatch (see entrypoint.mjs) to prove the bundle's full module graph
 * (including the pure resident-supervisor-policy.ts helpers) resolves and
 * evaluates successfully outside the repo, with no real process spawning.
 */
async function smokeTestEntrypointPortability(outfile) {
  const cwd = os.tmpdir()
  const { stdout } = await execFileAsync(process.execPath, [outfile], {
    cwd,
    env: { PATH: process.env.PATH, CONTENT_STUDIO_SUPERVISOR_SELFTEST: '1' },
    timeout: 15_000,
  })
  if (!/self-test: module graph loaded successfully/.test(stdout)) {
    throw new Error(`[export] entrypoint smoke test FAILED — unexpected stdout:\n${stdout}`)
  }
}

async function main() {
  await rm(distRoot, { recursive: true, force: true })
  await mkdir(distRoot, { recursive: true })

  for (const relativePath of REQUIRED_WORKER_SOURCE) await copyOne(relativePath)
  for (const relativePath of REQUIRED_STATIC_ASSETS) await copyOne(relativePath)
  for (const { from, to } of WORKER_OWN_FILES) {
    const target = path.join(distRoot, to)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(from, target)
  }

  // Canonical proof fixture: generated separately by generate-fixture.mjs
  // (it re-derives from the real repo pipeline, not hand-authored), then
  // copied here if present.
  const fixtureSrc = path.join(here, 'fixtures', 'canonical-input.json')
  try {
    await mkdir(path.join(distRoot, 'fixtures'), { recursive: true })
    await copyFile(fixtureSrc, path.join(distRoot, 'fixtures', 'canonical-input.json'))
  } catch {
    console.warn('[export] fixtures/canonical-input.json not found yet — run generate-fixture.mjs first.')
  }

  const totalFiles = REQUIRED_WORKER_SOURCE.length + REQUIRED_STATIC_ASSETS.length + WORKER_OWN_FILES.length
  console.log(`[export] Copied ${totalFiles} files into ${distRoot}`)

  // Phase 2I-B3: bundle the coordinator (control-plane polling + MinIO
  // upload) into a single self-contained file — see "Coordinator bundling"
  // above for why this is required rather than optional.
  console.log('[export] Bundling coordinator.mjs (+ minio-upload.mjs + shared lib/render-execution helpers) with esbuild...')
  const bundleOutfile = await bundleCoordinator()
  console.log('[export] Bundled coordinator.bundle.cjs. Running portable dependency-load smoke test (outside repo, empty env)...')
  await smokeTestBundlePortability(bundleOutfile)
  console.log('[export] Smoke test passed — coordinator.bundle.cjs loads its full module graph with no repo node_modules reachable.')

  // Phase 2I — Production Video Operational Closure: bundle the resident
  // supervisor entry point that makes the coordinator loop start
  // automatically alongside the renderer. See bundleEntrypoint() above.
  console.log('[export] Bundling entrypoint.mjs (+ resident-supervisor-policy.ts) with esbuild...')
  const entrypointOutfile = await bundleEntrypoint()
  console.log('[export] Bundled entrypoint.bundle.cjs. Running portable dependency-load smoke test (outside repo, empty env)...')
  await smokeTestEntrypointPortability(entrypointOutfile)
  console.log('[export] Smoke test passed — entrypoint.bundle.cjs loads its full module graph with no repo node_modules reachable.')

  console.log('[export] Done. Copy this directory to /opt/content-studio/render-worker on the VPS.')
  console.log('[export] On the VPS, run: node entrypoint.bundle.cjs (the new resident service command — starts + supervises BOTH server.mjs and coordinator.bundle.cjs automatically; do NOT run server.mjs or coordinator.bundle.cjs directly as the service command anymore).')
}

await main()
