# Phase 2I-B2 — Render Worker Coordination

**Nature:** Bounded implementation of the second executable slice of `PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md` (§22: 2I-B2), building on `PHASE_2I_B1_RENDER_EXECUTION_PERSISTENCE.md`. Worker polling + claim/fail/complete contract wiring only. Output is still written to local `/tmp` only — no MinIO upload, no `@aws-sdk/client-s3` addition, no product UI change.

## 1. Objective

Implement, per B0 §9/§10/§16/§17 and B1 §14 ("what remains for 2I-B2"): the worker authentication model, the three worker-facing routes (`claim`, `complete`, `fail`), the claim-time runtime input resolver, and the worker polling coordinator — while explicitly not implementing MinIO upload (2I-B3) or the `/videos` product UI (2I-C).

## 2. Files Changed This Phase

| File | Nature |
|---|---|
| `lib/render-execution/worker-auth.ts` | New — worker Authorization header verification. |
| `lib/render-execution/worker-db-client.ts` | New — shared service-role client factory for worker routes. |
| `lib/render-execution/resolve-runtime-input.ts` | New — claim-time snapshot → `ResolvedTimelineInput` resolver. |
| `app/api/render-executions/claim/route.ts` | New — `POST /api/render-executions/claim`. |
| `app/api/render-executions/[id]/complete/route.ts` | New — `POST /api/render-executions/:id/complete`. |
| `app/api/render-executions/[id]/fail/route.ts` | New — `POST /api/render-executions/:id/fail`. |
| `infra/render-worker-runtime/coordinator.mjs` | New — worker polling loop, separate from `server.mjs`. |
| `lib/creative/resolution/resolve-timeline.ts` | Modified — additive `identitySnapshot` override option (21 lines). |
| `lib/render-execution/__tests__/resolve-runtime-input.test.ts` | New — 12 tests. |
| `lib/render-execution/__tests__/worker-auth.test.ts` | New — worker auth tests. |
| `lib/render-execution/__tests__/worker-coordination-contracts.test.ts` | New — fail/complete contract + B1.1 regression tests. |

No other file was touched. No migration, no `scripts/` addition, no `app/(dashboard)/videos/` change, no `package.json` dependency addition (the worker's `coordinator.mjs` uses only Node's built-in `fetch`/`crypto`, no `@aws-sdk/client-s3`).

## 3. Worker Authentication Model (B0 §10, Option 2)

`lib/render-execution/worker-auth.ts: verifyWorkerAuth(req)`:

- Reads `CONTENT_STUDIO_RENDER_WORKER_SECRET` from the server environment. Absent/blank → `503 WORKER_AUTH_UNCONFIGURED` (fail closed, not fail open).
- Requires `Authorization: Bearer <secret>` — no query-string delivery, no Basic scheme. Missing header → `401 WORKER_AUTH_MISSING`; wrong scheme → `401 WORKER_AUTH_INVALID_SCHEME`.
- Compares the presented secret against the configured one with a constant-time comparison (`timingSafeEqual`, scans the full byte length regardless of where strings diverge) to avoid a timing side-channel. Mismatch → `401 WORKER_AUTH_INVALID_SECRET`.
- `X-Worker-Id` header, when present, is surfaced as `workerId` for `claimed_by`/logging only — it is **never** part of the access-control decision; only the secret gates access.
- No Supabase session, JWT, or cookie is ever accepted by any worker route. This is a completely separate authentication axis from the browser's `supabase.auth.getUser()` path (B1 §6).

## 4. `POST /api/render-executions/claim`

Worker-only, per B0 §16/§17.

1. `verifyWorkerAuth` — 401/503 on failure, no further processing.
2. `createWorkerApiDbClient()` (service-role) — 503 if `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` are absent.
3. Worker identity resolved from `X-Worker-Id` header → `CONTENT_STUDIO_RENDER_WORKER_ID` env → a fixed default, in that order.
4. Optional `leaseSeconds` from the request body, clamped to `[60, 1800]`; defaults to `300` (matches B0 §4/§8's MVP value) — this value is caller-supplied but the caller is already secret-authenticated, so it is not an untrusted-input concern.
5. Calls `claim_next_render_execution(worker_id, lease_seconds)` via the service-role RPC (the B1-created Postgres function — unmodified this phase). `id IS NULL` on the returned row → `{ claimed: false }`.
6. On a real claim: loads `library_files` scoped by **both** `project_id` **and** `user_id` from the claimed execution row (not from any client input) with `deleted_at IS NULL` — this is the DB-sourced, ownership-scoped LibraryFile set the runtime resolver treats as authoritative (§5).
7. Calls `resolveRuntimeInput` (§5). On failure, immediately calls `recordClaimTimeFail` (a direct service-role `UPDATE ... WHERE status = 'claimed'`, not a public route) so a doomed claim does not sit `claimed` until lease expiry for no reason — returns `422` to the worker.
8. On success: returns `{ claimed: true, executionId, attempt, leaseExpiresAt, warnings, resolvedInput }`. `resolvedInput` (containing freshly presigned URLs) is returned to the worker **in memory only** — it is never written back to `input_snapshot` or any other column.

## 5. Runtime Input Resolution (`resolve-runtime-input.ts`)

Claim-time reconstruction of a live `ResolvedTimelineInput` from the frozen `input_snapshot` (B1 §9's `{ schema_version, manifest, identitySnapshot }` wrapper):

1. Validates the snapshot's `schema_version` matches `RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION` and that `manifest`/`identitySnapshot` are structurally present — anything else is rejected as `SNAPSHOT_SCHEMA_INVALID` before any further processing.
2. Calls `resolveTimelineManifest(snapshot.manifest, { identitySnapshot: snapshot.identitySnapshot })` — the frozen manifest is validated exactly as authored; the frozen identity tokens are used directly, never re-derived from a live Project lookup (§6 explains why this parameter exists).
3. Builds an in-memory `library_file` lookup from the caller-supplied, already project/ownership-scoped `LibraryFile[]` (loaded by the claim route in §4, not by this module) — this module never queries the database itself.
4. Calls `prepareTimelineLibraryFileAssets` (unmodified, existing function) against the frozen manifest's asset refs — this is the **only** step in the entire B2 path that produces a signed URL, and it is produced fresh, from a DB-sourced storage path, every time a row is claimed.
5. `patchResolvedTimelineAssets` merges the freshly presigned URLs into the validated `ResolvedTimelineInput`.

**What this deliberately does not do:** it never calls `prepareVideoDraftTimeline` (which re-derives the manifest from the *current* `VideoDraft.scenes`) — starting from the frozen manifest instead is what keeps a later authoring edit from silently leaking into an already-queued or already-claimed execution (B0 §6).

## 6. `identitySnapshot` Override — Audit and Rationale

**Change:** `lib/creative/resolution/resolve-timeline.ts` gains an optional second parameter, `ResolveTimelineManifestOptions { identitySnapshot?: VisualTokensSnapshot }`. When supplied, `resolveTimelineManifest` uses it directly instead of calling the fixture-backed `resolveIdentitySnapshot(manifest.identity)` registry lookup.

**Why it was needed (not a preference):** `resolveIdentitySnapshot`'s registry (`lib/creative/identity/fixtures.ts`) is closed and fixture-only — two hardcoded entries, no real-Project lookup path. A real Project's identity ref is `project:{projectId}:snapshot` (produced by `adaptProjectIdentityToVisualTokens`, B1 §8) and was never going to resolve there. Without this override, `resolveRuntimeInput` could not validate a real execution's frozen manifest at all — every real (non-fixture) claim would fail `SNAPSHOT_MANIFEST_INVALID` at `identity_error`, making the entire claim path non-functional for anything but test fixtures.

**Audit against the six closure requirements:**

| Requirement | Verdict |
|---|---|
| Smallest necessary change | Yes — 21 additive lines (one new exported type, one new optional parameter, one three-line conditional replacing a single `const` assignment). Nothing else in the function changed. |
| Backward-compatible | Yes — `options` is optional; every existing call site (`resolveTimelineManifest(input)` with no second argument, confirmed by grep across the repo) is byte-for-byte unaffected and still hits the original fixture-backed path. |
| No second identity authority | No — there is exactly one place `identity` is assigned in the function body; the override short-circuits which *source* feeds that one variable, it does not introduce a parallel identity system. Everything downstream (`resolveTypography`, per-segment token resolution) consumes the same `identity.value` regardless of which branch produced it. |
| Existing fixture behavior remains valid | Yes — confirmed by the pre-existing Static resolver precedent this mirrors (`resolveStaticRenderManifest`, `lib/creative/resolution/resolve-static-render.ts:33-47`, already shipped and exercised before this phase) and by the unmodified fixture-path test suite continuing to pass (§9's full-suite run). |
| The execution snapshot's frozen `identitySnapshot` is actually used | Yes — traced end-to-end: `resolveRuntimeInput` passes `snapshot.identitySnapshot` (the exact value written into `input_snapshot` at creation time, B1 §9) as the override on every claim-time call; no other identity source is consulted in the B2 path. |
| Tests cover the behavior | Yes — `resolve-runtime-input.test.ts`: "uses the frozen identitySnapshot tokens, not a live Project lookup" and "two executions with different identity snapshots produce different tokens without any branch" (proves no accidental caching/sharing across concurrent resolutions). |

**Verdict: correct as implemented — kept unchanged.** No correction was required.

## 7. `POST /api/render-executions/[id]/fail`

Worker-only. Validates `errorCode` (required, sanitized to `[A-Z0-9_]`, max 64 chars), optional `errorMessage` (max 500 chars) and `errorDetail` (max 4000 chars, internal-only — never returned by the browser-facing `GET`, matching B1's `error_detail` exclusion). Only the `claimed → failed` transition is accepted (`409 INVALID_STATUS_TRANSITION` otherwise); the update is guarded with `.eq('status', 'claimed')` for atomicity.

**Terminal semantics (corrected doc-comment this closure pass, no behavior change):** an explicit fail report is always terminal for that row, per B0 §4 — `claimed → failed` is described there as "worker-reported terminal error only," a category distinct from the lease-expiry self-transition (which happens entirely inside `claim_next_render_execution` and never touches this route). A retry after an explicit fail always creates a **new** row (B0 §4.2); this route never re-queues the same row. The route's `isTerminal` response field (`attempt >= max_attempts`) is a product-facing hint for a future "Tentar novamente" UI, not a signal that the row becomes reclaimable — the original code comment here incorrectly implied the stale-lease reclaim logic would "pick it up again," which does not happen once `status = 'failed'` (the claim function's eligibility clause only matches `'queued'` or `'claimed'`). The comment was corrected; the route's actual transition logic was already correct.

## 8. `POST /api/render-executions/[id]/complete` — Contract Ready, Invocation Deferred to B3

Worker-only. Only `claimed → completed` is accepted. **All four output-metadata fields are required and validated:** `outputBucket` (non-empty, ≤255 chars, no `.`), `outputStoragePath` (non-empty, ≤1024 chars, no `..`, no leading `/`), `outputSizeBytes` (positive number), `outputDurationMs` (positive number). Omitting any of them returns `400` with a field-specific code (`MISSING_OUTPUT_BUCKET`, etc.).

This is the structural enforcement of the B2 boundary: **a route that requires real scratch-storage metadata cannot be satisfied by a local-only render**, because a local-only render (§9) has no bucket or storage path to supply — there is no code path, accidental or otherwise, by which a B2-era render can produce `status = 'completed'`. The route itself is fully implemented, tested (`worker-coordination-contracts.test.ts`), and will be called unmodified by the B3 coordinator once the MinIO upload step exists and can supply real values for these four fields.

## 9. Worker Polling Coordinator (`infra/render-worker-runtime/coordinator.mjs`)

A new file, deliberately separate from `server.mjs` (which remains the unmodified local Remotion HTTP wrapper from Phase 2I-A1) — coordination logic and the render engine stay independently testable (coordination tests need no Chromium; the renderer can be exercised standalone).

**Cycle:** poll (`claimExecution`) → if claimed, `invokeRenderer` (calls `server.mjs`'s existing `/render` endpoint over loopback) → on renderer failure, `reportFail` → on renderer success, **log the local output path and stop — does not call `/complete`.**

**Safe B2 behavior for a successful local render (explicit design, not an oversight):**
- `CONTENT_STUDIO_RENDER_LOOP` unset (default): the coordinator runs **proof-only** — claims and renders exactly one execution, then exits. A successful render is logged with its local `/tmp` path and duration; `/complete` is never called. The row remains `claimed` until its 300s lease expires, at which point it becomes reclaimable again by the stale-lease path already proven in B1's claim RPC — this is explicitly documented in the code as "the expected B2 safe-hold behavior before B3 is available," not a bug.
- `CONTENT_STUDIO_RENDER_LOOP=1`: a continuous loop, guarded by a startup warning that this mode must not be used until B3 adds the MinIO upload + `/complete` call. This flag exists for forward-compatibility with B3, not for B2 operation.
- Concurrency: the coordinator claims and processes **one execution at a time**, sequentially `await`ed — the next `claimExecution()` call does not fire until the current cycle (render, then fail-report-or-log) has fully resolved. This matches B0 §8/§20's single-worker-today design; nothing in the coordinator or the claim route assumes or requires more than one concurrent claim.

**Environment contract:**

| Var | Required | Default | Purpose |
|---|---|---|---|
| `CONTENT_STUDIO_CONTROL_PLANE_URL` | Yes | — | Vercel deployment base URL the worker polls. |
| `CONTENT_STUDIO_RENDER_WORKER_SECRET` | Yes | — | Shared secret, sent as `Authorization: Bearer` on every request. |
| `CONTENT_STUDIO_RENDER_WORKER_ID` | No | random `content-studio-worker-{8 hex}` | Stable worker identity for `claimed_by`/logs across restarts. |
| `CONTENT_STUDIO_RENDER_POLL_INTERVAL_MS` | No | `8000` | Poll cadence between cycles (matches B0 §9's 5-10s recommendation). |
| `CONTENT_STUDIO_RENDER_LOOP` | No | unset (proof-only) | `"1"` enables continuous polling — not to be set before B3. |
| `PORT` | No | `3456` | Local renderer port (`server.mjs`, unchanged from Phase 2I-A1). |

Missing `CONTENT_STUDIO_CONTROL_PLANE_URL` or `CONTENT_STUDIO_RENDER_WORKER_SECRET` exits the process immediately (`process.exit(1)`) rather than running with a broken or absent auth configuration.

## 10. Security Checks (B0 §21 Threat Table, Re-verified for B2)

| Threat | B2 status |
|---|---|
| Worker holding a Supabase credential | **Confirmed absent.** `coordinator.mjs` imports only `node:crypto`; no Supabase client of any kind exists in the worker's dependency closure. All Supabase access happens inside Vercel's three new routes via `createWorkerApiDbClient` (service-role, server-only). |
| Browser calling worker-only routes | **Blocked.** All three routes (`claim`, `complete`, `fail`) call `verifyWorkerAuth` first, before any other processing; a browser session cookie is not a recognized credential on any of them (§3). |
| Browser forging `completed`/`claimed`/`failed` status | **Still blocked**, unchanged from B1.1 — RLS grants `authenticated` no `UPDATE` policy on `render_executions` at all (B1 §6/§6A); every mutation in B2 (claim, complete, fail, claim-time-fail) goes through the service-role client, never the per-request anon/cookie client. |
| Arbitrary browser-authored URL reaching the worker/presign path | **Not possible.** The claim route loads `library_files` by `(project_id, user_id)` scoped to the claimed execution's own row (server-derived, not client input) with `deleted_at IS NULL`; `resolveRuntimeInput` presigns only DB-sourced `storage_path` values, and a dedicated test (`resolveRuntimeInput — asset URL resolution`) proves the path passed to `createPresignedReadUrl` is the DB value, never anything from the snapshot itself. |
| SSRF via the frozen snapshot's asset refs | **Not possible** — the snapshot carries only opaque `library_file` UUIDs (B1 §8's `deriveVideoSceneAssetBindings`/`adaptVideoDraftToTimelineManifest`, unmodified); real storage paths are always a fresh DB lookup. |
| Persisted signed URL / credential | **Confirmed absent.** `resolveRuntimeInput`'s output (`ResolvedTimelineInput`, containing the presigned URL) is returned to the worker in the claim response body only — no route in this phase writes it back to `input_snapshot` or any other column. |
| A local-only render marking itself `completed` | **Structurally blocked**, not just avoided by convention — §8's required-field validation on `/complete` cannot be satisfied without real scratch-storage metadata, and the coordinator (§9) never calls `/complete` in its default (proof-only) mode. |
| Worker concurrency beyond one execution at a time | **Not present** — the coordinator's single-cycle loop is sequential; nothing in the claim route or RPC prevents scaling later (B0 §20 already designed the schema for N workers), but B2 introduces exactly one worker process running one cycle at a time. |
| 300s lease semantics altered | **Unchanged.** The claim route defaults to 300s (B0 §4/§8's MVP value) and the coordinator explicitly requests `leaseSeconds: 300`; the claim RPC itself (B1, unmodified this phase) still computes `lease_expires_at = now() + make_interval(secs => p_lease_seconds)`. |

## 11. B1.1 Browser-Authority Hardening — Confirmed Intact

`app/api/render-executions/[id]/complete/route.ts`, `.../[id]/fail/route.ts`, and `.../claim/route.ts` are **new** routes added this phase — they do not touch, weaken, or bypass the B1.1 correction (`032_harden_render_execution_insert_authority.sql`, documented in B1 §6A) that revoked `authenticated`/`anon` `SELECT`/`INSERT` privilege on `render_executions` and moved the creation route to a server-only service-role insert. All three B2 routes already use `createWorkerApiDbClient` (service-role) exclusively — there was never a browser-facing insert/select path in this phase's code to accidentally regress. A dedicated regression test (`worker-coordination-contracts.test.ts`, "browser authority remains unchanged (B1.1 regression)") confirms `verifyWorkerAuth` and `createWorkerApiDbClient` exist and that the DB client factory returns `null` (never a live client) when service-role env vars are absent, rather than silently falling back to some other credential.

## 12. `generation_tasks` / Schema Non-Regression

No `scripts/*.sql` file was added or modified this phase (confirmed: `git status` shows no new path under `scripts/`). No Supabase schema change of any kind — the B1-created `render_executions` table and `claim_next_render_execution` function are consumed exactly as B1 left them, never altered.

## 13. Explicit B3 Boundary — What Remains Out of Scope

Per B0 §22 and this phase's own instruction, **nothing beyond worker coordination against local `/tmp` output was built**:

- No MinIO upload — `output_bucket`/`output_storage_path`/etc. are never populated by any code path in this phase; `/complete` cannot be called successfully without them (§8).
- No `@aws-sdk/client-s3` dependency added to the worker (confirmed: no `package.json`/`package-lock.json` change under `infra/render-worker-runtime/`).
- No crash-recovery proof against a real worker process kill (2I-B4) — the stale-lease reclaim mechanism itself was proven structurally in B1 (SQL-idiom + CPM precedent) and is exercised implicitly by B2's "row stays claimed until lease expiry" default behavior, but no live kill-and-reclaim test was run this phase.
- No product UI — `app/(dashboard)/videos/page.tsx` is byte-for-byte unchanged (confirmed by `git status`); the "Renderizar vídeo" button remains exactly as fake as B1 left it.
- No Docker/Portainer/VPS deployment action — `coordinator.mjs` was written and tested locally; it was not deployed to any remote infrastructure this phase.
- No remote secrets provisioning — `CONTENT_STUDIO_RENDER_WORKER_SECRET` is documented as an environment contract (§9) but was not set in any real environment by this phase's work.

**2I-B3's exact remaining scope** (per B0 §22, unchanged by this phase): MinIO scratch upload from the coordinator after a successful render, the `@aws-sdk/client-s3` addition to the worker's own dependency closure, the object-key convention (`users/{user_id}/renders/scratch/{render_execution_id}/output.mp4`, B0 §11), and — only once that upload path exists — flipping the coordinator to actually call `POST /api/render-executions/:id/complete` with real output metadata and (optionally) enabling `CONTENT_STUDIO_RENDER_LOOP=1` for continuous operation.

## 14. Validation

- **Focused B2 tests:** 48 (across `resolve-runtime-input.test.ts`, `worker-auth.test.ts`, `worker-coordination-contracts.test.ts`), all passing.
- **Full repository suite:** 606 → **644** (56 test files, all passing; the previously-reported "48/48" was the focused subset, not the phase total).
- **Typecheck:** PASS (`tsc --noEmit -p tsconfig.typecheck.json`, zero errors).
- **Lint:** 0 errors / 45 warnings — identical to the inherited B1 baseline; no new warning introduced by any B2 file.
- **Build:** PASS, exit code 0. New routes confirmed registered as dynamic (`ƒ`) functions: `/api/render-executions/claim`, `/api/render-executions/[id]/complete`, `/api/render-executions/[id]/fail`, alongside the unmodified B1 routes. No other route changed.
- **Working tree (pre-commit):** exactly `lib/creative/resolution/resolve-timeline.ts` (modified) plus the ten new paths listed in §2 — nothing else, confirmed via `git status`.

## 15. Verdict

**`READY_FOR_RENDER_OUTPUT_PERSISTENCE`**

Every task this phase's scope requires (B0 §22's 2I-B2 line item, B1 §14's explicit remaining-work list) is implemented: worker authentication, the service-role DB client, the three worker-facing routes, claim-time runtime input resolution (including the audited, minimal, backward-compatible `identitySnapshot` override), the polling coordinator, and focused tests proving frozen-snapshot isolation, no-signed-URL-persistence at rest, and B1.1 browser-authority non-regression. The one required precision this phase's implementation evidence needed — correcting a misleading code comment about fail-transition reclaim semantics (§7) — was fixed as part of this closure pass with no behavior change. A queued row can now be claimed, rendered against a real Chromium/Remotion pipeline, and safely held in `claimed` state pending B3's upload step, without any path by which a local-only render can mark itself `completed`. Nothing MinIO-, UI-, or infrastructure-facing was implemented, matching this phase's explicit scope boundary. 2I-B3 (MinIO scratch upload) is the correct, unblocked next slice.
