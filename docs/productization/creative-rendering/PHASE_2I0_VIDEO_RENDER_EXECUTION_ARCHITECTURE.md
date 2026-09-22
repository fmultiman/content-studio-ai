# Phase 2I0 — Video Render Execution & Product Action Architecture

**Nature:** Read-only architecture/execution study. No source, `/videos`, schema, migration, API, worker, or database change was made. This document is the only change in the phase.

**Evidence labels:** **FACT** is verified against the current repository (or a previously-recorded live proof this phase re-checked, not re-ran). **INFERENCE** follows from those facts. **RECOMMENDATION** is the proposed direction. **OPEN QUESTION** requires a later decision, spike, or access this phase does not have.

## 1. Executive Summary

**FACT.** The product path from a persisted `VideoDraft` to a real H.264 MP4 is fully proven end-to-end (Phase 2G-A → 2H-C): `VideoScene.library_file_id → deriveVideoSceneAssetBindings → adaptVideoDraftToTimelineManifest → resolveTimelineManifest → prepareVideoDraftTimeline (runtime LibraryFile validation + S3 presign) → renderResolvedTimelineInput (Remotion) → MP4`. Every proof of this chain producing a real MP4 (Phase 2G-C, 2G-D) ran through a **standalone Node script** (`scripts/creative/*-render-proof-TEMP.mjs`) that called these library functions directly — never through an HTTP request to any Next.js route, local or deployed.

**FACT, the load-bearing finding of this phase.** No render route — static or timeline — has ever been proven to execute successfully as an actual deployed Vercel serverless function invocation. The one "live" render proof that exists for the static path (Phase 2E-B, §9, 8.3s PNG) ran against a **local `next dev -p 3000` server** with production environment variables pulled via `vercel env pull`, not against the deployed `content.multihuman.com.br` Vercel Function runtime. `app/api/creative/static-authoring/render/route.ts` is a real, UI-wired, non-dev-gated `app/api/**` route (called from `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx`) that spawns a child process running `@remotion/renderer`. Whether that spawn succeeds inside an actual Vercel Function's filesystem/package-size envelope has never been exercised. `PHASE_2D0_CREATIVE_WORKSPACE_PRODUCT_ARCHITECTURE.md` itself already flags this as an open runtime risk, not a resolved one: *"Remotion renderer/bundler está no repo, mas render server-side não deve ser presumido como uma request normal da Vercel; o bridge atual declara `local-dev-only`."*

**FACT.** Multiple discovery-phase audits (`WAVE_1_REMOTION_ISOLATION_SPIKE.md` §2.7, `SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md` §10) independently assert, citing Remotion's own documentation, that `@remotion/renderer` (Chromium-dependent) cannot run inside a standard Vercel Serverless Function because the bundled Chromium binary exceeds the historical 50 MB deployment package limit — and that production Remotion rendering on Vercel requires either Remotion Lambda or a self-hosted worker with `serverExternalPackages: ['@remotion/renderer']` configured. `next.config.mjs` (read this phase) has no such configuration. This claim is treated here as **FACT that the repository asserts it**, but **OPEN QUESTION whether it is still accurate today** given current Remotion/Vercel capabilities — it was not re-verified live in this phase (see §3, §16).

**FACT.** No async/job infrastructure in the repository has a semantic shape that fits self-hosted, long-running compute. `generation_tasks` (`scripts/005_create_generation_tasks.sql`) exists exclusively to track an **externally-dispatched, webhook-confirmed** provider job (NanoBanana image generation) where this application never runs the compute itself — it only stores a `task_id`, waits for `POST /api/nanobanana/callback`, and lets the client poll `GET /api/nanobanana/status/[taskId]`. Video timeline rendering is the opposite shape: **this application's own process** must run Chromium + Remotion + video encoding, for a duration (39–40s already proven, growth un-bounded) driven by content the app controls, with no third-party callback. Phase 2F0 already reached the identical conclusion for Static (`RenderExecution NOT NEEDED`) precisely because Static's render was synchronous, local, single-digit-seconds, in-process. Timeline render is not that shape, and does not have a working in-process host proven on the deployed platform either.

**Verdict: `DEDICATED_RENDER_EXECUTION_REQUIRED`** — not because of theoretical future scale, but because the one compute plane this application is actually deployed to (Vercel serverless) is documented, unrebutted, and never re-tested as unable to run the renderer at all, and no other compute plane currently runs anything on a schedule or on demand for this product. A persistent execution record and a real (even if minimal) out-of-band compute target are the missing pieces — not a render farm.

**Secondary implementation note:** the missing piece is not queue *sophistication* — no BullMQ/Inngest/cron exists and none is being proposed. The missing piece is: (1) confirmation of *where* Chromium+Remotion can actually run for this deployment, and (2) a small persistent record (`render_executions`-shaped) so a render whose actual host is not the request/response cycle can be observed after the request returns. See §17.

## 2. Pre-flight

`git branch --show-current` → `traycer/content-studio-ai-soft-yak`. `git status` → clean. `git log -6 --oneline` → HEAD `3090e07` ("feat: prepare persisted video scene assets for timeline"), containing Phase 2H-C. No mutation occurred in this phase; `git status` was empty before and remains empty after (only this document was added).

## 3. Current Render Requirements (Part A)

Traced from `scripts/creative/render-timeline-manifest.ts` (`renderResolvedTimelineInput`, the function every real MP4 proof called) and `lib/creative/integration/prepare-video-draft-timeline.ts`:

| Requirement | Where | Classification |
|---|---|---|
| Node.js `child_process` (`execFileSync`) | `ffprobe`/`ffmpeg` calls in `render-timeline-manifest.ts` (`probeVideo`, `extractFrame`) — **diagnostic/proof-only**, not needed by `renderMedia` itself | LOCAL-ONLY TODAY (relies on system PATH; no bundled binary, no `ffmpeg-static`-class dependency in `package.json`) — but not required for a product render endpoint that skips frame-extraction diagnostics |
| `@remotion/bundler`'s `bundle()` (webpack) | `renderResolvedTimelineInput` | SERVERLESS-SENSITIVE (must run per-invocation or be cached; not attempted from any `app/api/**` route today) |
| `@remotion/renderer`'s `renderMedia`/`selectComposition` (headless Chromium) | same | SERVERLESS-SENSITIVE — the specific, documented risk (§1) |
| Filesystem / temp output | `mkdir` under an explicit `targetOutputPath`; all real proofs wrote to `.tmp/creative/...` (gitignored, local disk) | LOCAL-ONLY TODAY — never proven against a Lambda-style ephemeral `/tmp` |
| Remotion bundle output location | `bundle()` writes a served bundle to a temp directory each invocation | SERVERLESS-SENSITIVE (cold-start cost, size) |
| S3 presigned reads | `createPresignedReadUrl` (`lib/storage/s3.ts`), used by `prepareTimelineLibraryFileAssets` before render; Chromium fetches the presigned URL over the network during render (observed via the start/end frame asset-appearance evidence in 2G-C/2G-D) | PORTABLE (plain HTTPS GET against an S3-compatible VPS endpoint; not tied to any specific compute host) |
| Network egress from the render process | required for the presigned S3 fetch above | PORTABLE |
| Memory / CPU during Chromium render | never measured in this repo (no profiling artifact exists) | UNKNOWN |
| Runtime duration | 39,375–40,415 ms measured **twice**, both for a 90-frame/3.0s/one-segment/one-asset render (Phase 2G-C, 2G-D) — both runs were local script executions, not measured inside any serverless invocation | PORTABLE fact about the workload; UNKNOWN how it maps to a specific deployed host's CPU allocation |
| Output file handling | Local proofs wrote a file to disk and read it back with `fs`; no proof has ever uploaded a render output anywhere | LOCAL-ONLY TODAY (§7) |

**INFERENCE.** The only genuinely portable requirements are the S3 presign/network fetch (already proven against the real VPS S3-compatible storage) and the pure preparation functions (`prepareVideoDraftTimeline` and everything it calls — no filesystem, no child process). Everything Chromium/bundler/child-process-shaped is either explicitly documented as serverless-hostile or has simply never been tried outside a developer's local machine.

## 4. Current Deployment Architecture (Part B)

**FACT (repo evidence, not general platform knowledge).** `docs/HANDOFF_PUBLICATION_PHASE.md` and three other docs state, repeatedly and consistently: *"Deploy: Vercel auto-deploy de `main` — domínio `content.multihuman.com.br` — região `gru1`."* `@vercel/analytics` is a real dependency (`package.json:48`), consistent with a Vercel deployment. No `vercel.json` or `vercel.ts` exists in the repository — deployment configuration is whatever Vercel's Next.js framework defaults produce for Next 16.2.4, plus whatever is set in the Vercel dashboard (not visible from this repo).

**FACT.** Storage is **not** co-located with compute: `PHASE_1C_REAL_PORTAL_STATIC_RENDER.md` identifies the object storage as *"existing VPS S3-compatible storage"* at `https://s3.multihuman.com.br`, bucket `content-studio` — a separate host from the Vercel-hosted Next.js app. There is no evidence anywhere in the repository of a general-purpose compute VPS (i.e., a VPS that runs application code/workers, as opposed to only S3-compatible storage).

**FACT.** `app/api/creative/static-authoring/render/route.ts` and `app/dev/creative-preview/render/route.ts` both declare `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'` — Node runtime, not Edge. No other route in `app/api/**` declares `runtime` at all (checked via repo-wide grep), which means every other route uses Next's default runtime resolution.

**FACT.** No route timeout, memory, or region override exists anywhere in the repository (no `vercel.json` `functions` block, no per-route `maxDuration` export anywhere in `app/**`). Whatever Vercel plan/timeout/memory applies is entirely dashboard-side configuration invisible to this audit — **OPEN QUESTION**, not resolvable from repo evidence.

**FACT.** `@remotion/renderer`, `@remotion/bundler`, and `@remotion/player` are direct production `dependencies` (not `devDependencies`) in `package.json`, and `@remotion/cli` is a `devDependency`. This means the Vercel build **does** include these packages in the production bundle graph — they are reachable by the build, even though (per §1/§3) no route currently imports `@remotion/renderer`/`@remotion/bundler` for the *timeline* path, and the one route that does reach the renderer (via child-process spawn of a script, for the *static* path) has never been confirmed to actually execute that spawn successfully once deployed.

**FACT.** No Chromium-acquisition strategy (`@sparticuz/chromium`, `puppeteer`, explicit `browserExecutable` override, or any documented headless-shell packaging step) exists anywhere in the codebase. Rendering relies entirely on `@remotion/renderer`'s own default Chromium Headless Shell management, whatever that resolves to at runtime on whatever host actually executes it.

**Classification:** deployment platform (Vercel, Next 16, Node runtime routes) is a settled FACT; render-capable compute on that platform is an **unresolved OPEN QUESTION** that repo evidence actively argues against (§1) and has never been tested for.

## 5. Synchronous HTTP Feasibility (Part C)

Evaluated against the real, evidenced current architecture — not a hypothetical one.

- **Request duration:** 39–40s already measured for the smallest realistic unit (3s/90 frames/one asset). This alone is inside even conservative historical Vercel timeouts, but is not a small number, and provides zero information about a 30-second or 3-minute output.
- **Browser/process startup:** Chromium cold-start cost inside a fresh serverless invocation has never been measured in this repo; local proofs reused an already-warm environment.
- **Memory:** UNKNOWN (§3) — Remotion's own guidance (not repo-verifiable here) typically recommends several GB for comfortable headless Chromium + video encode; no evidence this repo's target compute tier provides that.
- **Filesystem:** all real proofs wrote output to persistent local disk (`.tmp/`), never to an ephemeral `/tmp`-style serverless filesystem.
- **ffmpeg/ffprobe:** only used for post-render diagnostics (frame extraction), not the render itself — **not** a blocker for a product render endpoint that skips that diagnostic step, but any future feature that *does* want server-side frame extraction would need a bundled ffmpeg (none exists today).
- **Client disconnect / retries / duplicate renders:** a synchronous `POST .../render → wait → MP4` has no defense against a client closing the tab mid-request (the render keeps consuming compute for a response nobody reads), a double-click submitting two overlapping renders, or a retry after a timeout re-running an already-expensive job. No code anywhere in this repository currently guards against this pattern for *any* long operation — there is no precedent to reuse.
- **UX:** a single blocking `fetch` for 40s+ (with no upper bound proven) with no progress signal is a materially worse experience than the existing async-with-polling pattern the product already ships for NanoBanana image generation (§6).
- **Scaling:** unknown — no load has ever been placed on this path.
- **Failure recovery:** none exists; a failed synchronous request simply returns a 500, matching the existing `static-authoring/render` route's own error handling (`return NextResponse.json({ error: ... }, { status: 500 })`), which is adequate for an 8-second image render and not demonstrated adequate for a Chromium+video-encode workload of unknown duration.

**Classification: `INSUFFICIENT_EVIDENCE`**, trending `NOT_PRODUCT_READY`. This is not "supported but fragile" — fragility implies the mechanism is known to work and merely has rough edges. Here, the mechanism (Remotion renderer inside a Vercel Function) has a repo-documented reason to believe it **does not work at all**, and the one place that pattern is wired into product code (`static-authoring/render`) has never been proven against the actual deployed runtime, only against a local dev server. A `POST /render → wait → MP4` route for Timeline should not be built as the primary path without first closing that specific gap (§17, Part O).

## 6. Existing Async Infrastructure (Part D)

| Mechanism | File(s) | Problem it solves | Does it fit Timeline render? |
|---|---|---|---|
| `generation_tasks` (status table + webhook + poll) | `scripts/005_create_generation_tasks.sql`, `app/api/nanobanana/{generate,callback,status/[taskId]}/route.ts` | Tracking a job whose compute runs on a **third-party server** (NanoBanana), confirmed only by an inbound webhook this app does not control the timing of | **No.** Video timeline render compute runs (or would run) inside this application's own infrastructure, triggered synchronously by this app, with no external callback — the entire reason `generation_tasks` has `task_id`, `callback_received_at`, and `raw_response` (fields for an *external* provider's async contract) is absent from the Timeline problem. Reusing it would force a fake external-provider shape onto a self-hosted compute problem — PHASE_2F0 §17 already reached this exact conclusion for Static and explicitly rejected building a `RenderExecution` entity at that time because Static's render had no async shape to track; Timeline does have an async shape, but it is the *self-hosted long-running job* shape, not the *external webhook* shape `generation_tasks` was built for. |
| Autosave debounce (`video_drafts` PATCH, 800ms) | `app/(dashboard)/videos/page.tsx` | Draft persistence, not render execution | Not applicable — unrelated concern |
| `POST /api/channel-piece-media/upload` (atomic S3 → LibraryFile → CPM, with compensation) | `app/api/channel-piece-media/upload/route.ts` | Persisting an **already-produced** media file into the domain, synchronously, with rollback on partial failure | **Not a render mechanism, but the correct target for output persistence** once a render finishes (§8) — this is the existing, working, already-productized answer to "what happens to a finished file," not to "how is the file produced." |
| Cron / scheduled jobs | — | — | **None exist.** No `vercel.json` crons, no scheduled function, no background worker found anywhere in the repository. |
| Queue (BullMQ/Inngest/etc.) | — | — | **None exist.** Confirmed by repo-wide dependency and source search; zero matches. |
| VPS execution plane (compute, not storage) | — | — | **None exists.** The only VPS evidenced anywhere in the docs is the S3-compatible *storage* host (`s3.multihuman.com.br`) — there is no evidence it, or any other VPS, runs application compute for this product. |

**Answer to Part D's central question:** no existing entity's semantic model matches timeline rendering. `generation_tasks` is the closest *shape* (status + async), but its *authority model* (external provider dispatch + inbound webhook) is wrong for a job this application itself must execute. Building on it would mean either faking a webhook this app sends to itself (pointless indirection) or silently redefining what `generation_tasks.provider` means (semantic confusion the phase brief explicitly warns against).

## 7. RenderExecution Reassessment (Part E)

Re-answering the eight questions against Timeline specifically, now that a real render (unlike Static) has an unresolved compute-host question and a measured non-trivial duration:

1. **Is a persistent execution record now justified?** **RECOMMENDATION: yes, conditionally.** Not because of scale, but because — unlike Static's proven synchronous 8.3s in-process render — Timeline's actual compute host is unresolved (§4/§5). The moment a render's execution is *not* guaranteed to complete inside a single request/response cycle (whether because it moves off-request deliberately, or because a request-cycle attempt times out unpredictably), there needs to be *somewhere* for the client to ask "what happened to my render" after the original connection is gone. A transient in-memory-only status has no answer to that question across a serverless invocation boundary (§9, Part I).
2. **Could an existing task entity be reused?** **No** (§6) — `generation_tasks`'s authority model doesn't fit.
3. **Would reuse create semantic confusion?** **Yes** — `provider` would have to mean "ourselves," `task_id` would have to be invented rather than received, and `callback_received_at`/`raw_response` (both meaningful only for an inbound webhook) would sit permanently null. That is exactly the kind of parallel/duplicated semantics `PHASE_2H0`'s own decision matrix pattern warns against for other entities.
4. **Is transient job state enough?** **No**, for the reason in (1) — transient state (e.g., an in-memory map inside one serverless invocation) cannot answer a status query from a *different* invocation, which is the normal case for any request that outlives one Lambda-style execution.
5. **What must survive page reload?** At minimum: which render is in flight (or last completed) for this `VideoDraft`, its status, and — on completion — a reference to the output. This is the smallest set that makes reload/reconnect (Part I) answerable at all.
6. **What happens if user closes browser?** With no persistent record, the render (wherever it runs) has no way to report back to anyone; with a persistent record, a later page load can still observe the outcome by querying it.
7. **How are retries represented?** As a new record (or a new attempt), never as a silent overwrite — mirrors `generation_tasks`' own append/immutable-history-friendly shape without borrowing its authority model.
8. **How do we avoid duplicate renders?** A status check on the `VideoDraft` (or scene fingerprint) before allowing a new render to start — impossible without something persisted to check against.

**Verdict for this section:** a small, purpose-built `render_executions`-shaped record (not the reused `generation_tasks` table, not a generalized `RenderExecution` framework covering hypothetical future render types) is justified for Timeline specifically, precisely because Static's own justification for skipping it (`PHASE_2F0` §17: synchronous, proven, in-process, single-digit seconds) does not hold for Timeline (§1). This is not "create architecture for theoretical scale" — it is "the one condition Static's own no-RenderExecution argument depended on is factually absent here."

## 8. Output Temporary Storage (Part F)

**FACT.** Every real MP4 proof (2G-C, 2G-D) exists only as a local file under `.tmp/creative/productization/...` — gitignored, never uploaded, never referenced by any DB row. No temporary-S3-object pattern, no execution-artifact table, and no direct-LibraryFile-on-render-completion pattern exists anywhere in the repository today.

| Option | Fit |
|---|---|
| Temp local filesystem only | Matches every proof to date, but is incompatible with any compute host that isn't a long-lived local machine (ephemeral serverless `/tmp` disappears with the invocation) — a dead end the moment render moves off a developer's machine (§4). |
| Temporary S3 object (render writes directly to a scratch prefix, e.g. `renders/tmp/...`) | **RECOMMENDATION.** Matches the storage host that is already proven reachable from the render process (§3's presign evidence) and already decoupled from compute — whatever ends up running the render, it already needs S3 network access for the *input* asset, so writing the *output* to the same S3-compatible store is the same capability, not a new one. |
| Direct `LibraryFile` creation on render completion | **Reject**, per the phase brief's own instruction and `PHASE_2H0`/`PHASE_2G0`'s repeated, consistent direction: a render is not automatically a saved product output (§8/§9 below) — auto-creating a `LibraryFile` collapses that distinction the architecture has deliberately preserved since Phase 2F0. |
| Execution artifact (a blob/reference column on the new `render_executions`-shaped record, pointing at the scratch S3 object) | **RECOMMENDATION**, paired with the temp-S3 option above — the persistent record (§7) needs *some* pointer to the finished file for the explicit-save step (§9) to find it. |
| Signed temporary object (presigned GET handed to the client for preview/download before saving) | **RECOMMENDATION** for the preview/download leg specifically — mirrors the exact, already-proven `createPresignedReadUrl` pattern used for every other asset read in this codebase; no new mechanism, just a new object to point it at. |

**Answer:** a temporary MP4 lives in the same S3-compatible storage already used for every other asset, under a scratch/temp prefix, referenced by the persistent execution record — not on local disk, not auto-promoted to `LibraryFile`.

## 9. Saved Output Lifecycle (Part F/G continuation)

**FACT, re-confirmed this phase from `PHASE_2G0_TIMELINE_VIDEOS_INTEGRATION_ARCHITECTURE.md` §14 and `PHASE_2H0` §19, both unchanged since written:** the approved future shape is `render result → explicit "Salvar" action → POST /api/channel-piece-media/upload (existing, already accepts video/mp4|webm|quicktime, 50MB limit) → LibraryFile(kind='video') → ChannelPieceMedia when a ChannelPiece context exists`. `library_files.kind` already includes `'video'`; the upload route's MIME whitelist already includes the three video types (`app/api/channel-piece-media/upload/route.ts:17-19`, confirmed this phase). **No new persistence surface is required for this leg** — it is the same route Static's own future output-save path was already scoped to reuse.

**RECOMMENDATION.** Keep render execution and output save as two separate, independently-completable steps, exactly as Phase 2F0/2G0/2H0 already concluded for Static and re-affirmed for Timeline: a render can complete and be previewed/discarded without ever becoming a `LibraryFile`; only an explicit user action promotes the scratch S3 object (§8) into the existing upload route's input.

## 10. Generate vs Render UX (Part G)

**FACT, unchanged since `PHASE_2H0` §18/`PHASE_2G0` §15:** `/videos`' only real action today is `handleGenerateVideo` (`app/(dashboard)/videos/page.tsx:439-468`) — a 3-second `setTimeout` plus a toast that says outright *"Este é um fluxo simulado."* No media provider, no Timeline/Remotion call. Confirmed unchanged this phase (read live, not assumed from prior docs).

**RECOMMENDATION, matching `PHASE_2H0`'s own conclusion (its §18 table) and the phase brief's own phrasing:**

| Product intent | Action |
|---|---|
| Create/regenerate a still or AI clip for a scene | **Gerar mídia** (future, scene-level) — writes/binds a `LibraryFile`, does not touch Remotion |
| Assemble the authored timeline into an MP4 | **Renderizar vídeo** — calls the render-execution path this document scopes |

**Answer to the A/B/C options posed:** **Option B** — rename the current top-level fake action so its label matches what it will actually become (a render trigger), rather than keeping "Gerar Vídeo" pointed at a future, unrelated, scene-level generation feature and inventing a second, differently-labeled button beside it. `PHASE_2H0` §18 already reached this exact conclusion (*"the fake top-level action should semantically become 'Renderizar vídeo,' while scene-level generation remains a separately scoped future capability"*), and nothing found in this phase's repo audit contradicts it. **This phase makes no UI change** — the button, its label, and its handler remain exactly as they are (§1).

## 11. Progress / Recovery (Part H)

**RECOMMENDATION — minimum state set**, directly informed by §7: `idle → preparing → queued → rendering → completed | failed`. **`cancelled` is not recommended for the MVP** — no code anywhere in this repository cancels an in-flight Remotion render, `renderMedia`'s cancellation surface was never exercised by any proof phase, and inventing cancel semantics without a proven abort path would be exactly the "architecture for theoretical need" the brief warns against.

**FACT, checked this phase:** `renderMedia` (imported from `@remotion/renderer` in `scripts/creative/render-timeline-manifest.ts`) is called in this repo with only `{ composition, serveUrl, codec, concurrency, inputProps, outputLocation }` — no `onProgress` callback is wired anywhere. Remotion's `renderMedia` API does support a progress callback in general, but **this repo has never used it**, so "does current usage expose frame progress" is **NO** as a repo fact, independent of whether the underlying library could. **RECOMMENDATION:** do not synthesize a fake percentage; report only the coarse states above until a later slice actually wires `onProgress` and threads it through to a client-observable field.

## 12. Client Reload / Resume (Part I)

Directly dependent on §7/§11's conclusion that render state must be persisted, not held only in the request/response cycle or in-memory:

- **Browser reload:** with a persistent record, re-fetch status by `VideoDraft` id (or execution id) and resume polling — impossible without §7.
- **User navigates away:** the render (wherever it runs) is unaffected; it either completes or fails independently of the tab. Without persistence, its outcome is unobservable afterward.
- **Request disconnects:** if render is synchronous-in-request (§5), a client disconnect has no defined effect on server-side compute already in flight — Node/Vercel does not guarantee cancellation, so compute may continue "for nobody." An async/queued model avoids coupling compute lifetime to one HTTP connection's lifetime at all.
- **App restarts:** any render whose sole state was in-process memory is lost with no record it ever happened; a persisted `queued`/`rendering` row can at minimum reveal a stuck or orphaned execution for manual/product-level recovery, even if the MVP does not yet implement automatic requeue.

**This is the single strongest architectural argument against a pure synchronous HTTP endpoint for Timeline**, independent of the Chromium-on-Vercel question in §1/§5: even if Remotion could run inside a Vercel Function, coupling a 40s+ (growing) operation's only record of existing to one open HTTP connection is a regression from the UX the product already ships for image generation (§6, `generation_tasks` + polling), not a step forward.

## 13. Auth / Ownership Boundary (Part J)

**FACT, precedent already in this codebase** (`app/api/creative/static-authoring/render/route.ts:32-46`): the existing, real, UI-wired synchronous render route already implements exactly the pattern Part J asks for — `supabase.auth.getUser()` first (401 if absent) → fetch `project`/`editorialContent`/`channelPiece` scoped with `.eq('user_id', user.id)` → cross-check `editorialContent.project_id === project.id` and `channelPiece.editorial_content_id === editorialContent.id` → 404 if any mismatch — before ever touching the renderer. This is the correct, already-proven shape to carry over, not a new pattern to invent.

**FACT.** `lib/creative/integration/prepare-video-draft-timeline.ts`'s `prepareVideoDraftTimeline` is already built to this exact boundary discipline: it takes an **injected** `lookupLibraryFile` function and re-validates, inside its own `projectScopedLookup` wrapper (lines 69-75), that any resolved file's `id`, `project_id === input.draft.project_id`, and `deleted_at === null` all hold — it does not trust whatever the injected lookup alone would have returned. It never opens a database connection itself.

**RECOMMENDATION, directly derivable from the code already read, not invented new:**
```
1. supabase.auth.getUser() → 401 if absent
2. fetch VideoDraft WHERE id = :videoDraftId AND user_id = auth user  → 404 if absent
3. derive/confirm authoritative project_id from that VideoDraft row (never from client input)
4. lookupLibraryFile := a same-request Supabase query scoped to that project_id, wrapped exactly as prepareVideoDraftTimeline already expects
5. prepareVideoDraftTimeline({ draft, identity, lookupLibraryFile, assetContext })
```
The client must never be allowed to submit a `ResolvedTimelineInput`, a signed URL, or a `storage_path` as render authority — nothing in the existing code path accepts any of those as input today, and none should be added.

## 14. Render Request Contract (Part K)

**RECOMMENDATION**, matching the brief's own preferred shape and directly supported by §13's evidence that the preparation function already expects to be handed a loaded, authorized draft rather than a client-assembled render input:

```
POST /api/video-drafts/:videoDraftId/render
{}
```
or the brief's `{ videoDraftId }` body shape against a flatter route — either is consistent with the existing `prepareVideoDraftTimeline` seam; the routing convention should follow whatever this repo's existing `app/api/video-drafts/**` structure already uses (not audited to file-naming precision in this phase, since no route is being created). Server does auth → fetch → `prepareVideoDraftTimeline(...)` → (once §17's compute-host question is closed) enqueue/execute. **No field in the request body should ever carry render-authoritative data** — only an identifier the server uses to re-derive everything itself, exactly as §13 describes.

## 15. Infrastructure Options Matrix (Part L)

| Option | Impl. cost | Operational complexity | Runtime suitability (evidence) | Failure recovery | Progress | Security | Output handling | Local/dev parity | Scalability |
|---|---|---|---|---|---|---|---|---|---|
| Synchronous Next/Vercel route (`POST → wait → MP4`) | Low | Low | **Unproven / documented risk** (§1, §4, §5) — the one thing this option most needs to be true is exactly the thing repo evidence argues against | None — a failed request is just a failed request | None (blocking) | Reuses §13's proven pattern | Would have to invent a new leg (no proof any route has returned a video body) | High (identical code path in dev and prod) | Poor — ties compute lifetime to one HTTP connection (§12) |
| Existing async task system (`generation_tasks`) | Low (schema exists) | Low | N/A — wrong compute model (§6); would still need *something* to actually run Remotion | Matches external-provider retry semantics that don't apply here | Only what a webhook would report (no webhook exists here) | Would need a fake self-issued "callback" | N/A | Poor — the model itself doesn't fit | N/A — doesn't solve where compute runs |
| Dedicated worker/service (new, minimal — e.g. one small Node process reachable from the app, polling a `render_executions` table) | Medium (new table + new process + deploy target for that process) | Medium (one more thing to run/monitor) | **Proven at the library-function level** (§1: every real MP4 came from exactly this kind of long-lived Node process) — the only option with a real, repeated, working precedent in this repo's own history | Natural fit — persisted status row survives process restarts | Coarse states now (§11), real frame progress later if wired | Same auth/derive-from-server boundary as §13, executed server-side, not client-facing | Writes to scratch S3 (§8), same store already proven | High — this is exactly how every existing proof was already run locally | Bounded by that one process/host unless deliberately scaled — acceptable for MVP (§16) |
| Existing VPS execution plane, "if real/reusable" | N/A | N/A | **Not real for compute today** — the only evidenced VPS in this repo is S3-compatible *storage* (`s3.multihuman.com.br`), not a general compute host; using it for compute is a *new* capability, not a reuse | — | — | — | — | — | — |
| Remotion Lambda (named directly by discovery docs as the standard Remotion-recommended production answer, never installed: `@remotion/lambda` is explicitly listed as **not installed**, `WAVE_1_REMOTION_ISOLATION_SPIKE.md` §2.3) | Medium-high (new AWS surface, new deploy pipeline, new cost model) | Medium-high | Purpose-built for exactly this problem per Remotion's own docs (repo-cited, not independently re-verified this phase) | Built-in to the product (render-status polling is Remotion Lambda's own designed pattern) | Native frame-progress support | New credential surface (AWS) to manage | Remotion Lambda writes to S3 natively | Lower — dev/local proofs use local Node, not Lambda, so parity would need to be re-established | Naturally horizontal, but is the "future scalable render farm" the brief says not to build yet (Part M) |

## 16. MVP Recommendation (Part M)

**RECOMMENDATION.** The smallest architecture that is real, safe, recoverable, and deployable — not the smallest architecture that is merely simple to write:

1. **Do not build a synchronous Vercel render route for Timeline** (§5) — the compute-host risk is real and unresolved, and a 40s+ blocking request is a UX regression from the pattern already shipped for image generation.
2. **Do not build a queue, a cron, or a worker fleet** — none is justified by anything found in this repo; Remotion Lambda and a "dedicated render worker" are both real options (§15) but both are new infrastructure this phase found no forcing evidence to build *yet*.
3. **Do build the smallest persistent record** (§7) — status + reference to a scratch S3 output, scoped to `VideoDraft`/`Project`/`user_id` exactly as every other domain table in this repo already is.
4. **Resolve the one open technical fact everything else depends on** (§4/§5's OPEN QUESTION) **before** committing to a specific compute target for that record's execution — this is the recommended next slice (§17/Part O), not an afterthought.
5. Once (4) is answered, the actual execution step is either "a small persistent Node process this repo does not yet have anywhere to run" or "the existing Node-runtime API route pattern, if and only if it is actually proven to work against a real deployed invocation" — the architecture in (3) does not need to know which, in advance, because the persisted record + scoped preparation function (§13/§14) is the same regardless of which compute target eventually consumes it.

## 17. Long-form Implications (Part N)

**FACT, not extrapolated linearly** (per the brief's own instruction): 90 frames / 3.0s took ~40s, twice, under proof conditions (warm local process, one template segment, one real asset). No basis exists in this repo to compute a multiplier for a 30-second or 5-minute output — render cost scales with segment count, asset count/size, and composition complexity, none of which this repo has measured beyond the single-segment case.

**RECOMMENDATION — which choices would become dead ends if renders reach multiple minutes:**
- **A synchronous HTTP render route** becomes an outright non-starter (not merely "fragile") well before multi-minute durations, given even a 300s Vercel Function ceiling (per current platform defaults) — this is a dead end that should not be built even provisionally, because provisional-synchronous has a habit of shipping.
- **In-memory-only job state** becomes a dead end the moment any render outlives a single serverless invocation's lifetime — which the current 40s figure is already close to for some historical Vercel defaults, and which any growth makes categorically worse.
- **A persisted execution record with a status enum and an output reference** (§7/§16) does **not** become a dead end at longer durations — it is the one piece of this architecture explicitly chosen because it is duration-agnostic.
- **Choosing Remotion Lambda vs. a self-hosted worker** is the one decision this phase deliberately does not make (Part M/O) — both remain viable at longer durations; neither is precluded by anything decided here.

## 18. Risks / Open Questions

| # | Item | Status |
|---|---|---|
| 1 | Whether `@remotion/renderer` can actually run inside this repo's actual deployed Vercel Function (as opposed to `next dev` or a bare Node script) | **OPEN QUESTION — the single highest-priority unresolved fact in this document.** Repo docs assert it cannot (citing Remotion's own, possibly since-updated, documentation); no proof in this repo has ever tested it against the real deployed runtime. |
| 2 | Current Vercel plan's function size/memory/timeout limits for this specific project | **OPEN QUESTION** — not visible from repo evidence (no `vercel.json`/`vercel.ts`); requires the Vercel dashboard/CLI, out of scope for a read-only repo audit. |
| 3 | Whether a general-purpose compute VPS exists or could be provisioned alongside the already-existing S3-compatible storage VPS | **OPEN QUESTION** — only storage was evidenced; compute was not. |
| 4 | Render duration scaling beyond one 3-second/one-segment sample | **OPEN QUESTION**, explicitly not extrapolated (§17). |
| 5 | Whether Remotion's `renderMedia` progress callback (available in the library, unused in this repo) is worth wiring for real frame progress | **OPEN QUESTION**, deferred (§11) — no forcing need yet. |
| 6 | Movement-vocabulary ↔ `MotionSpecSchema` compatibility, `VideoDraft.status`, drag-to-reorder scenes | Unrelated pre-existing open items carried over from `PHASE_2G0`/`PHASE_2H0`, restated here only because they remain open, not because this phase investigated them further. |

## 19. Recommended Next Slice (Part O)

**RECOMMENDATION — exactly one slice, chosen because every other decision in this document (job entity shape, sync-vs-async, which worker, whether Remotion Lambda is needed) is downstream of it:**

**Prove (or disprove) Remotion + Chromium execution inside the actual deployment runtime this product uses — not `next dev`, not a bare local script.**

Concretely: attempt a real, minimal render (reusing the already-proven, unmodified `renderResolvedTimelineInput`/`prepareVideoDraftTimeline` functions, against the same real same-Project draft/asset pair already used in Phase 2G-D) triggered from and executing inside an actual deployed Vercel Function invocation for the target project — observing directly whether it succeeds, times out, or fails for a Chromium/package-size reason, rather than continuing to rely on the discovery-phase docs' citation of Remotion's own (undated, possibly stale) guidance.

This is deliberately **not** combined with an endpoint, a job table, a worker, or UI — those are all real future work, but each one's design (§7, §14, §15) currently has a placeholder for "wherever the render actually executes," and this slice is the one experiment that turns that placeholder into a fact. Building any of the rest first risks building around a constraint (§1) that may already be stale, or missing a constraint that is still very real.

## 20. Verdict

**`DEDICATED_RENDER_EXECUTION_REQUIRED`**

**Secondary implementation note:** this does not mean a render farm, a queue product, or Remotion Lambda must be adopted now — it means the two smallest missing pieces (a persistent execution record, §7/§16, and a confirmed, proven compute host for the renderer, §19) must both exist before a real "Renderizar vídeo" product action is wired up, because the current evidence base contains a documented, never-rebutted reason to believe the one compute plane this product is actually deployed to (Vercel serverless Functions) cannot run the renderer at all, and no other compute plane currently runs anything for this product. `SYNC_PRODUCT_RENDER_SUPPORTED` is ruled out by §1/§5. `EXISTING_ASYNC_INFRA_REUSABLE` is ruled out by §6 (wrong authority model). `INSUFFICIENT_EVIDENCE` was considered and rejected as the primary verdict: this phase found *enough* evidence — a specific, actionable, repo-documented blocker (§1) and a clear, minimal experiment to resolve it (§19) — to recommend a direction rather than stop at "we don't know."
