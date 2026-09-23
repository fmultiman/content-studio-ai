# Phase 2I — Production Video Operational Closure

**Nature:** Forensic audit + bounded corrective implementation, triggered by a
HUMAN production smoke test on `/videos` that exposed four real operational
gaps the prior automated proofs (2I-B0…B4, 2I-C0…C2) did not catch. This
phase does not touch template/discovery work, does not add infrastructure,
does not expand the schema, and does not loosen any RLS permission.

## 1. Human-observed failures

A real execution created from the `/videos` UI
(`95f82498-0f34-4a68-b15b-4af614d1fcf2`) stayed `status: "queued"`,
`claimed_at: null` indefinitely while the browser polled
`GET /api/render-executions/:id` every 3s. Alongside that:

- **Gallery** made a direct browser Supabase call to `render_executions` and
  received `403 permission denied for table render_executions`.
- On a page load that restored an **already-completed** execution, the
  inline player never requested `GET /api/render-executions/:id/output-url`
  — it spun forever even though the MP4 and the download path were both
  fine.
- `/videos` still displayed copy claiming the render flow is "simulated" —
  obsolete since Phase 2I-C1 shipped the real `render_execution` workflow.

## 2. Root cause: queued-never-claimed

**Neither `server.mjs` nor `coordinator.mjs` was ever a resident,
automatically-started process.** Verified directly in the shipped artifacts,
not assumed:

- `infra/render-worker-runtime/server.mjs` is a plain HTTP wrapper
  (`GET /health`, `POST /render`) around `bundle → selectComposition →
  renderMedia`. It has **no queue awareness at all** — it never calls
  `/api/render-executions/claim` or anything else on the control plane.
- `infra/render-worker-runtime/coordinator.mjs` **is** the poll → claim →
  render → upload → complete/fail loop, and already implements everything
  the production model needs: a continuous mode
  (`CONTENT_STUDIO_RENDER_LOOP=1`), exponential claim/network backoff,
  SIGTERM/SIGINT handling, and a strictly sequential `while` loop (one
  `await runOneCycle()` at a time — never concurrent claims).
- `PHASE_2I_B2_RENDER_WORKER_COORDINATION.md` documents, in its own words:
  *"No Docker/Portainer/VPS deployment action — `coordinator.mjs` was
  written and tested locally; it was not deployed to any remote
  infrastructure this phase."* `PHASE_2I_B3_MINIO_SCRATCH_OUTPUT.md` §18
  lists the coordinator's VPS start step as a **manual** operator action:
  `node coordinator.bundle.cjs`, with the operator manually choosing whether
  to set `CONTENT_STUDIO_RENDER_LOOP=1`.
- `export.mjs`'s own closing log line before this phase read: *"On the VPS,
  run: node coordinator.bundle.cjs"* — a one-shot manual instruction, not a
  service command.

**Answering the audit questions directly:**

| Question | Answer |
|---|---|
| What process is resident? | Only `server.mjs` (the render HTTP wrapper) — started once by the VPS operator/service and left running. It has no queue logic. |
| What process performs claim/render/upload/complete? | `coordinator.mjs` (bundled as `coordinator.bundle.cjs`) — but it was only ever invoked manually, once per proof run. |
| Is that consumer started automatically? | **No.** Confirmed by the docs above and by `export.mjs`'s own "run manually" instruction. |
| If not, why did proofs succeed? | Every prior proof (2I-B2/B3/B4) had a human at a terminal run `node coordinator.bundle.cjs` immediately after queuing the row. Production has no such human. |
| Is the current Swarm service only an HTTP/health runtime? | Yes — its only resident responsibility was `server.mjs`'s `/health` + `/render`. |
| Is there a dormant loop that should have been activated? | Yes — `coordinator.mjs`'s `CONTENT_STUDIO_RENDER_LOOP=1` continuous mode already existed and was never turned on automatically. |
| Intended production lifecycle? | queue a row → a resident process claims it → renders → uploads → completes — with no SSH/manual step. This phase builds exactly that. |

## 3. Resident consumer model (Task A1)

**Chosen: Option A — the existing worker service gains a resident
supervisor that launches and supervises the coordinator loop, in the same
container, alongside the (unchanged) renderer.**

New file `infra/render-worker-runtime/entrypoint.mjs` (bundled to
`entrypoint.bundle.cjs` by `export.mjs`, the exact same esbuild pattern
`coordinator.mjs` already used) becomes **the new service/container start
command**. It:

1. Spawns `server.mjs` **unmodified** (still resolves `remotion`/`@remotion/*`
   via the VPS base image's `/app/node_modules` — nothing about its
   dependency model changed).
2. Waits (boundedly — see §4) for `GET /health` to pass.
3. Spawns the coordinator with `CONTENT_STUDIO_RENDER_LOOP` **forced** to
   `'1'` — the continuous mode `coordinator.mjs` already implements.
4. Supervises both children for the process lifetime.

Why Option A over B/C:

- **Option B (`server.mjs` grows a background loop)** would merge two
  deliberately separate concerns `coordinator.mjs`'s own header comment
  documents (`server.mjs`: Remotion bundle + renderMedia;
  `coordinator.mjs`: poll → claim → render → upload → complete), and would
  require `server.mjs` — which has **zero** extra npm dependencies today —
  to gain the AWS SDK closure `coordinator.mjs` needs, undoing the whole
  point of `coordinator.mjs`'s existing esbuild-bundling step.
- **Option C (a separate Swarm service)** adds a second service definition
  against a "one current Swarm manager" constraint, for no benefit: the
  coordinator already calls the renderer over `http://127.0.0.1:3456`
  (loopback), i.e. it was already designed to run in the **same**
  container/network namespace as `server.mjs`.
- **Option A** needs no new Swarm service, no new npm dependency, and no
  change to `render_executions`, claim/complete/fail routes, or the worker
  secret contract — it only changes what process the container's existing
  start command launches.

`render_executions` remains the sole queue authority — nothing here adds
Redis, RabbitMQ, BullMQ, n8n, cron, or a new protocol.

## 4. Concurrency, lease/fencing semantics preserved (Task A2)

Untouched by this phase: `claim_next_render_execution` (atomic claim / `FOR
UPDATE SKIP LOCKED`), lease expiry, attempt increment on reclaim, stale-attempt
fencing (`PHASE_2I_B4_LEASE_RECOVERY_AUDIT.md`), `claimed_by`, the
deterministic scratch output path, and truthful `complete`/`fail`
authorization — none of `claim/route.ts`, `[id]/complete/route.ts`,
`[id]/fail/route.ts`, or `worker-lifecycle.ts` were modified.

Sequential, single-render concurrency is preserved by construction:
`coordinator.mjs`'s `main()` still `await`s each `runOneCycle()` fully
before the next; `entrypoint.mjs` spawns **exactly one** coordinator
process. A bounded health-check wait (`shouldKeepWaitingForHealth`,
30 attempts × 1s) replaces any possibility of a busy loop at startup, and
restart backoff (`nextRestartDelayMs`: 2s → 4s → … capped at 60s) does the
same for a crashing child — verified live: a coordinator missing
`CONTENT_STUDIO_CONTROL_PLANE_URL` was restarted 5 times during a 75s local
smoke run, backing off 4s → 8s → 16s → 32s → 60s, never busy-looping, its
fatal config error printed loudly on every single attempt (stdio is
inherited, nothing is swallowed).

## 5. Graceful lifecycle (Task A3)

- **Starts automatically** — the container's own command now runs
  `entrypoint.bundle.cjs`; no SSH/manual invocation is needed.
- **Idle without busy-spinning** — bounded health-wait and exponential
  restart backoff (§4); the coordinator's own claim loop already sleeps
  `POLL_INTERVAL_MS` between empty polls (unchanged).
- **Stops cleanly on SIGTERM/SIGINT** — the supervisor forwards the signal
  to both children and exits once they've stopped (bounded 10s timeout,
  then a forced exit rather than hanging).
- **Recovers after a container restart** — a fresh process re-runs the same
  bootstrap; any lease the coordinator held is abandoned exactly as before
  (server-side lease expiry, unchanged) and reclaimed by the next successful
  claim.
- **Health stays meaningful** — `GET /health` now returns
  `{ status: 'ok' | 'degraded', coordinator: {...} | null }`; a repeatedly
  crashing coordinator flips the service to `degraded` while the renderer
  itself may still be healthy.
- **Fatal startup errors are never hidden** — both children run with
  `stdio: 'inherit'`; every exit is logged via `describeChildExit` before
  any restart decision.

## 6. Gallery authority fix (Issue B)

**Root cause:** `app/(dashboard)/galeria/page.tsx` queried
`render_executions` directly with the authenticated (browser) Supabase
client. That table intentionally has no browser SELECT policy (worker/lease
internals must never reach the client) — every real page load returned
`403 permission denied for table render_executions`.

**Fix — Task B1:** new route `GET /api/gallery/video-outputs`
(`app/api/gallery/video-outputs/route.ts`), following the exact pattern
already used by `GET /api/render-executions` and
`GET /api/render-executions/:id`: authenticates the user server-side, reads
through the service-role client, scopes to `user_id = auth.uid()` and
`status = 'completed'`, and projects only
`{ id, video_draft_id, status, queued_at, completed_at }` — no
`claimed_by`, `lease_expires_at`, `input_snapshot`, `output_storage_path`,
or any other worker/internal column. **No migration, no RLS change** — the
table's permission boundary is exactly as intentional as before; only the
application changed.

`app/(dashboard)/galeria/page.tsx` now fetches this route instead of
querying the table directly, and `lib/gallery-output-library.ts`'s existing
`buildGalleryOutputs({ ..., executions, videoDrafts })` (already pure and
already tested) is finally wired up with real data — previously the page
called it with `executions`/`videoDrafts` **omitted entirely**, so even a
successful query would never have produced video output cards.

**Fix — Task B2 (failure isolation):** the previous implementation ran all
five Supabase queries (images, drafts, Projects, Productions,
render_executions) through one `Promise.all` and threw on the **first**
error — discarding `images`/`projects`/`productions` state that had already
loaded successfully. Because `setProjects` was never reached on that throw,
`projects.length` stayed `0`, and `getGalleryEmptyState` (correctly, given
that input) rendered `"Crie um Project para começar"` — a **false** "no
Projects" state, alongside the real error banner, even when Projects
existed. The fix splits the fetch into two independent phases: the core
data (images/drafts/Projects/Productions/video-draft metadata) commits to
state as soon as it succeeds; the video-outputs fetch is wrapped in its own
try/catch that sets a separate `videoOutputsUnavailable` flag on failure
and never touches `images`/`projects`/`productions`. A partial video-source
failure now shows a small, non-blocking notice while the rest of the
Gallery (including any real images) renders normally.

## 7. Completed-player restore fix (Issue C)

**Root cause:** the polling `useEffect` only ever *scheduled* its internal
`pollExecution` function via `window.setTimeout`, and only did so when
`renderExecution.status` was `'queued'` or `'claimed'`. The
terminal-state handling (toast + `fetchOutputUrl`) lived **inside**
`pollExecution` — so for an execution that loaded **already completed** (the
page-restore path, via `GET /api/render-executions?videoDraftId=`),
`pollExecution` was never scheduled and never ran. `fetchOutputUrl` was
therefore never called, and the inline player spun forever despite the
download path and the MP4 both being fine. `lib/creative/authoring/__tests__/c2-gallery-videos-product.test.ts`
had "proven" this wiring by asserting the literal substring
`fetchOutputUrl(renderExecution.id)` exists in the file — true, but
unreachable from the restore path. This is precisely the C1/C2-assumption
gap Task F asked to surface (see §9).

**Fix — Task C1:** the terminal-state hydration logic now lives in its own
`useEffect` keyed only on `renderExecution?.id`/`renderExecution?.status`,
with no dependency on ever having been scheduled by the poll effect:

```
useEffect(() => {
  if (!renderExecution?.id) return
  if (renderExecution.status !== 'completed' && renderExecution.status !== 'failed') return
  // one-shot toast via pendingNotification, then:
  if (renderExecution.status === 'completed' && !renderOutputUrl && !renderOutputUrlError) {
    fetchOutputUrl(renderExecution.id)
  }
}, [renderExecution?.id, renderExecution?.status])
```

This fires identically whether the execution just transitioned live
(queued/claimed → completed) or was already completed on mount — both
paths now request `GET /api/render-executions/:id/output-url` and receive a
transient signed URL, never persisted beyond component state.

The polling effect was simplified to a second, independent `useEffect`
scoped only to `queued`/`claimed`, using a single recursive
`setTimeout` chain (one request in flight at a time) instead of re-running
the whole effect on every poll tick (Task E — see §8).

**Fix — Task C2 (bounded error state):** `fetchOutputUrl` now sets
`renderOutputUrlError` on a failed request or a missing `url` in the
response. The player shows a bounded error card (message + **Tentar
novamente**) instead of an infinite spinner, and never fakes playback.
**Download remains available** regardless of inline-player state (it is a
wholly separate signed-URL request).

**Task C3 (inline vs. attachment) — verified, not changed:**
`GET /api/render-executions/:id/output-url` already defaults to
`disposition=inline` and only returns an attachment-disposition URL when
the caller explicitly passes `?disposition=attachment` (which
`handleDownloadOutput` does, and the inline player's `fetchOutputUrl` does
not). No change was needed here; the reported symptom was solely the
hydration-call reachability bug in §7, not the disposition itself.

## 8. Polling safety (Task E)

The 3-second polling interval is unchanged. What changed is structural:
polling now lives in an effect keyed only on `id`/`status` (not the whole
`renderExecution` object, which the poll itself replaces every tick), using
one recursive `setTimeout` chain guarded by a `cancelled` flag and cleared
on cleanup. It schedules **one** request at a time, stops the instant status
becomes terminal (the effect's own entry guard, not a runtime check inside
the poll), and cannot spawn a second parallel loop after a reload or an
unrelated state change, since a new effect instance always cleans up the
previous timer first. **The missing-worker problem was fixed at the worker
layer (§3), not by changing frontend polling** — the frontend still just
asks "is it done yet?" every 3 seconds.

## 9. Stale product copy (Issue D)

Removed the "Nota: Este módulo está preparado para integração futura com
APIs de geração de vídeo. Atualmente, o fluxo é simulado..." card from
`/videos`. It was obsolete since Phase 2I-C1 shipped the real
`render_execution` workflow; the render-result card (queued/claimed/
completed/failed states, real download and player) already communicates the
real behavior without it. No replacement copy was added — none was needed.

## 10. Reviewing C1/C2 assumptions (Task F)

Explicitly identified gaps between automated "wiring" tests and real
production behavior:

1. **`c2-gallery-videos-product.test.ts`** asserted the *existence* of
   `fetchOutputUrl(renderExecution.id)` as a source substring, which passed
   even though that call was unreachable from the restore path (§7). Fixed
   by adding reachability-specific assertions (the hydration effect's entry
   guard and dependency array, not just the call's existence) — see the new
   `describe('Phase 2I — completed-player hydration reachability ...')`
   block in that same file.
2. **The Gallery's `buildGalleryOutputs` call omitted `executions`/
   `videoDrafts` entirely** (§6) — every 2I-C2 test exercised
   `buildGalleryOutputs` directly with those fields supplied, so the
   pure-function tests passed while the actual page never passed them in
   production.
3. **The resident worker was never proven end-to-end** — 2I-B2/B3/B4's own
   docs are explicit that VPS deployment was out of scope and performed
   manually; no test or doc claimed otherwise, but nothing forced anyone to
   notice that manual proof-only invocation never becomes an automatic
   production behavior.

No other C1/C2 assumption was found to diverge from production behavior
under this review; scope was not expanded beyond the four reported issues.

## 11. No schema change, no permission loosening

**No Supabase migration was created.** `render_executions`' RLS remains
exactly as restrictive as before — the Gallery fix is entirely an
application-layer change (a new authenticated server route), never a grant.

## 12. Deployment delta (code merged, NOT deployed by this phase)

| Item | Change |
|---|---|
| Files changed | `infra/render-worker-runtime/{export.mjs, server.mjs}` (modified), `infra/render-worker-runtime/entrypoint.mjs` (new) |
| Worker bundle contents | `dist/content-studio/` now also contains `entrypoint.bundle.cjs` and `entrypoint.source.mjs` (reference copy) alongside the existing `server.mjs`, `coordinator.bundle.cjs`, `coordinator.source.mjs` |
| Service command change | **Yes.** Old: `node server.mjs`. New: `node entrypoint.bundle.cjs`. |
| `docker service update --force` required? | Yes, after copying the new `dist/content-studio/` contents to `/opt/content-studio/render-worker` and updating the service's command — a plain bind-mount refresh does not restart the running process. |
| Env vars | Unchanged contract (`CONTENT_STUDIO_CONTROL_PLANE_URL`, `CONTENT_STUDIO_RENDER_WORKER_SECRET`, MinIO vars, etc.) — `CONTENT_STUDIO_RENDER_LOOP` is now forced by the supervisor and no longer needs to be set manually. |
| Expected health check | `GET /health` → `200 { status: "ok", coordinator: { running: true, ... } }` once both children are up. |
| Expected log signature | `[supervisor] Starting renderer...` → `[content-studio-render-worker] listening on :3456` → `[supervisor] Renderer healthy after N check(s).` → `[supervisor] Starting coordinator...` → `[coordinator] Worker ID ... / Mode: continuous loop` → `[coordinator] Polling for work...` |
| Rollback | Revert the service command to `node server.mjs` (the renderer alone, unaffected by this change) and/or redeploy the previous `dist/content-studio/` contents; `server.mjs`'s own behavior (aside from `/health`'s response shape gaining an optional `coordinator` field) is unchanged. |

This phase implemented and validated the above **locally only** — it was
not deployed to the VPS and no Swarm command was run against production.

## 13. Production smoke checklist (for the human operator)

1. Deploy the new `dist/content-studio/` bundle and change the service
   command to `node entrypoint.bundle.cjs`; `docker service update --force`.
2. `GET /health` on the worker → confirm `coordinator.running: true`.
3. From `/videos`, click **Gerar Vídeo** → confirm the execution reaches
   `claimed` within one coordinator poll interval, then `completed`.
4. Reload `/videos` for that draft → confirm the inline player loads
   without a manual retry.
5. Open `/galeria` → confirm no `403` in the Network tab, and that the
   completed video appears as a generated output.
6. Kill the worker container (or send SIGTERM) → confirm it restarts
   cleanly and a new execution is still eventually claimed.

## 14. Validation summary

| Check | Result |
|---|---|
| Focused new/changed tests | 69 new/updated assertions across 6 files — all passing (see commit) |
| Full suite | 741 → **810** passed (see `npx vitest run`) |
| Typecheck (`tsc --noEmit -p tsconfig.typecheck.json`) | Clean |
| Lint (`eslint .`) | 0 errors, 45 warnings (unchanged baseline) |
| Build (`next build`) | Succeeds; `/api/gallery/video-outputs` registered |
| Portable worker bundle smoke (`node export.mjs`) | Both `coordinator.bundle.cjs` and the new `entrypoint.bundle.cjs` bundle and pass their portability smoke tests outside the repo |
| Functional local smoke of `entrypoint.bundle.cjs` | Renderer spawns, becomes healthy, coordinator spawns with the loop forced on, a missing-env fatal error is logged loudly and retried with bounded exponential backoff (4s→8s→16s→32s→60s, capped) — real observed behavior, not merely asserted |

## Final verdict

**READY_FOR_PRODUCTION_VIDEO_SMOKE**

---

## 15. Phase 2I-C2.2 — Gallery video preview correction (production smoke follow-up)

A human production smoke run **after** the fixes above confirmed the
resident worker and `/videos` live-completion fixes hold, and surfaced two
further Gallery-specific issues (Gallery only — worker lifecycle, Swarm,
render queue, MinIO upload, `render_executions` schema/RLS, and the
`/videos` live player were explicitly out of scope for this follow-up and
were not touched).

### 15.1 Production smoke result

| Area | Result |
|---|---|
| Resident worker (§3–5 above) | **PASS** — multiple new renders completed automatically with no manual `docker exec`/SSH step. |
| `/videos` live completion + inline player (§7 above) | **PASS** on subsequent real renders — the player loads without requiring a page reload. |
| Gallery "Visualizar" (preview) | **FAIL** — used the attachment-disposition endpoint; see §15.2. |
| Gallery video card presentation | **FAIL** — showed "Imagem indisponível" for a known, valid video item; see §15.3. |
| Remotion worker asset 404s (`/public/creative-fixtures`, `/creative-fixtures` Pack B assets) | **OPEN — separate follow-up, not addressed here.** This is a render-asset-resolution issue unrelated to Gallery preview/download plumbing; no trivial shared-path bug was encountered while working on the Gallery code in this patch, so per the mission's explicit instruction it was left untouched. |

### 15.2 Gallery preview attachment-path bug (fixed)

**Root cause:** the Gallery preview modal rendered
`<video src={output.downloadUrl}>` directly. `output.downloadUrl` is not a
video file — it is the **attachment-disposition endpoint**
(`/api/render-executions/:id/output-url?disposition=attachment`), an API
route that returns `{ url, expiresAt }` JSON. The `<video>` tag issued a GET
to that endpoint (matching the reported Network evidence exactly) and could
not decode the JSON response as media, producing a black player stuck at
0:00 — while the same execution's MP4 played correctly from `/videos`,
which already fetches the JSON first and assigns the resolved `url` to the
player. The Gallery never did that two-step fetch at all for preview, and
the equivalent Download code path had the identical bug (assigning the raw
endpoint string as an anchor's `href`, which would navigate to a JSON
response instead of downloading the file).

**Fix:**
- `lib/gallery-output-library.ts`'s `GalleryOutputItem` gains a new field,
  `videoPreviewEndpoint` (the **inline**, no-`disposition`-param endpoint),
  kept strictly separate from `downloadUrl` (the attachment endpoint) —
  never conflated, never reused across the two flows.
- The Gallery preview modal (`GalleryPreviewDialog`) now fetches
  `videoPreviewEndpoint` when it opens (or when the target item changes),
  and assigns the resolved, transient `url` from that JSON response to the
  `<video src>` — never the raw endpoint, never the attachment URL.
- `handleDownload`'s video branch now fetches `downloadUrl` (the attachment
  endpoint) first, and only then navigates using the resolved `data.url` —
  matching the same fetch-then-use pattern `/videos`' own download button
  already used correctly.
- Signed URLs remain transient client state (component `useState`, cleared
  on close/switch, re-fetched on reopen) — nothing is persisted.

### 15.3 Gallery video card presentation bug (fixed)

**Root cause:** `GalleryImageFrame` (used for both grid/list cards and the
modal's non-video fallback) always compared `output.thumbnailUrl ||
output.imageUrl` against `null`/error state; a completed video has neither
(deliberately — no thumbnail-generation backend exists), so it fell into
the same "Imagem indisponível" branch used for a genuinely broken/missing
image.

**Fix:** `GalleryImageFrame` now checks `output.mediaType === 'video' &&
!imageUrl` first and renders a small, honest, video-specific placeholder
(a video icon + "Vídeo renderizado") instead — a known, valid media item is
never presented as a broken one. No thumbnail-generation backend was added,
and no fake/placeholder thumbnail image was introduced; if a real
thumbnail/poster source is ever wired up for video items, this same
`imageUrl` check already picks it up automatically (the video-specific
branch only triggers when there is none).

### 15.4 Gallery modal video-state lifecycle (audited, fixed)

The shared Gallery dialog's video handling now follows exactly the required
sequence: **open Visualizar → loading state → fetch fresh inline signed URL
→ assign to `<video>` → playable.** Specifically, keyed off
`output?.id`/`output?.mediaType`/`output?.videoPreviewEndpoint`:

- Opening or switching to a different item **always clears** the previous
  `videoPreviewUrl`/`videoPreviewError`/loading state first, before deciding
  whether a new fetch is needed — a stale URL or error from a different item
  (or from before the dialog was closed) can never leak into the next one.
- **Closing** the modal sets the selected output to `null`, which re-runs
  the same clearing effect and drops the transient signed URL entirely.
- **Reopening** (a fresh `output?.id`) always re-fetches — no cached/stale
  signed URL is ever reused across opens.
- A **failed** preview fetch shows a bounded error card (message + "Tentar
  novamente" retry action) instead of an infinite spinner or a silently
  broken player; retrying re-runs the same fetch.
- **Download remains independently available** regardless of preview
  loading/error state — it is a wholly separate fetch against a different
  (attachment) endpoint.
- The non-video `GalleryImageFrame` preview is now explicitly `key`ed by
  `output.id` inside the modal, fixing a related latent bug: without a key,
  React reused one `GalleryImageFrame` instance across different Gallery
  items, so its internal `hasError` flag (set after one item's image failed
  to load) could incorrectly persist and hide a *different*, perfectly
  loadable image on the next item.

### 15.5 No schema change, no permission change, no worker/VPS deploy

This patch touched only `lib/gallery-output-library.ts` and
`app/(dashboard)/galeria/page.tsx` (plus their tests). No Supabase
migration, no RLS change, no `render_executions` schema change, and no
worker/VPS deployment action of any kind.

### 15.6 Validation

| Check | Result |
|---|---|
| Focused new/updated tests | 16 new/updated assertions across 2 files — all passing |
| Full suite | 810 → **826** passed |
| Typecheck | Clean |
| Lint | 0 errors, 45 warnings (unchanged baseline) |
| Build | Succeeds |

### Follow-up verdict

**READY_FOR_FINAL_GALLERY_VIDEO_SMOKE**
