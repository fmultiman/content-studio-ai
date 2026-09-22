# Phase 2I-B1 — Render Execution Persistence + Product API

**Nature:** Bounded implementation of the first executable slice of `PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md`. Persistence and product-facing creation/read API only — no worker, no MinIO, no UI, no `/videos` change.

## 1. Objective

Implement, per B0 §5/§8/§16/§17: the `render_executions` table, the atomic `claim_next_render_execution` function, `POST /api/video-drafts/:id/render`, and `GET /api/render-executions/:id`, with a signed-URL-free snapshot construction path and focused tests proving snapshot immutability and no-signed-URL persistence.

## 2. Migration Created

`scripts/031_create_render_executions.sql` (next number after `030_add_studio_theme_preferences.sql`). Not applied to any Supabase environment this phase — file creation and local static/test validation only, per the phase's explicit "do not make ad-hoc production SQL changes" constraint.

## 3. Schema Actually Implemented

Matches B0 §5 field-for-field (21 columns), with no speculative additions:

- **Identity:** `id`, `user_id`, `project_id` (denormalized from `video_draft.project_id` at creation — same pattern `video_drafts.POST` already uses for `project_id` from `production_id`), `video_draft_id`.
- **State machine (B0 §4):** `status TEXT CHECK (status IN ('queued','claimed','completed','failed'))` — four states, matching this schema's universal `TEXT + CHECK` convention (confirmed against `projects.status`, `channel_pieces.status`, `generation_tasks.status` — no real Postgres `ENUM` exists anywhere in this repo).
- **Retry/claim:** `attempt`, `max_attempts`, `retry_of_execution_id` (self-FK), `claimed_by`, `lease_expires_at`.
- **Input authority:** `input_schema_version`, `input_snapshot JSONB NOT NULL`.
- **Idempotency:** `idempotency_key`, enforced by a partial unique index (`WHERE idempotency_key IS NOT NULL`) rather than a `NOT NULL` column — a render with no supplied key is never deduplicated.
- **Timestamps:** `queued_at`, `claimed_at`, `completed_at`, `failed_at`, `updated_at` (trigger-maintained via the existing shared `update_updated_at_column()` function from `001_create_tables.sql`, not a new one).
- **Output locator (unused this phase, columns present per B0 §5/§11):** `output_bucket`, `output_storage_path`, `output_mime_type`, `output_size_bytes`, `output_duration_ms`.
- **Errors:** `error_code`, `error_message`, `error_detail` (internal-only — confirmed never selected by the GET route, §7).

## 4. RPC Actually Implemented

`claim_next_render_execution(p_worker_id TEXT, p_lease_seconds INT DEFAULT 300) RETURNS render_executions`, `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO service_role` only (never `authenticated`).

- Single atomic `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
- Eligibility: `status = 'queued'` OR (`status = 'claimed' AND lease_expires_at < NOW() AND attempt < max_attempts`) — the stale-lease self-recovery B0 §4.1/§8 specified, no cron/broker required for the common case.
- `attempt` increments only on a reclaim (row was already `'claimed'`); a fresh `'queued'` row keeps `attempt = 1`.
- `claimed_at` uses `COALESCE(claimed_at, NOW())` so a reclaim preserves the original first-claim timestamp.
- 300-second default lease, matching B0 §4/§8's stated MVP value (comfortably above the 37-48s render durations proven live in Phase 2I-A1/the VPS proof cited in this phase's brief).
- No heartbeat/renewal — explicitly deferred, per B0 §8's own open question.
- Not applied to any live database this phase (same constraint as §2). Not exercised by a live-DB concurrency test — see §11.

## 5. Route Shapes

- `POST /api/video-drafts/[id]/render` (`app/api/video-drafts/[id]/render/route.ts`) — creation.
- `GET /api/render-executions/[id]` (`app/api/render-executions/[id]/route.ts`) — status read.

Both follow the exact conventions already established by `app/api/video-drafts/route.ts` and `app/api/editorial-contents/[id]/route.ts`: `RouteContext = { params: Promise<{ id: string }> }`, a shared `getAuthenticatedClient()`/`supabase.auth.getUser()` gate returning 401, the same `UUID_RE` format check, and `.eq('user_id', user.id)` on every query — no new authentication or routing pattern was introduced.

## 6. Authorization Model

- **RLS:** `render_executions` has `SELECT`/`INSERT` policies for `authenticated` (`auth.uid() = user_id`, identical shape to every other table in this schema — confirmed no team/membership model exists anywhere in the schema, so plain ownership is correct here too). **No `UPDATE`/`DELETE` policy exists for `authenticated`/`anon` at all** — Postgres RLS default-denies any command with no matching policy, so the browser has no path, authorized or otherwise, to set `status`, `claimed_by`, lease fields, `attempt`, output paths, error fields, or completion timestamps (B0 §16's explicit requirement, verified by the migration's own policy set, not merely asserted).
- **Creation route** uses the normal per-request authenticated Supabase client (anon key + cookie session, `lib/supabase/server.ts`), the same as `video_drafts.POST` — **not** service-role. RLS's own `WITH CHECK (auth.uid() = user_id)` is a second, independent guarantee against a forged owner even if the route computed one incorrectly.
- **Claim RPC** is `service_role`-only (§4) — no `authenticated` grant exists, so no user session, however crafted, can call it.
- Service-role usage is not introduced or expanded by this phase at all — this slice's two routes both use the normal authenticated client; the service-role-only claim function exists in the schema but is not called from anywhere in this phase's code (no worker/claim-broker route is implemented yet — that is 2I-B2).

## 7. Idempotency Behavior

- `POST /api/video-drafts/[id]/render` accepts an optional `{ idempotencyKey?: string }` body field (1-128 chars, trimmed).
- **Fast path:** before touching `video_drafts` at all, the route checks for an existing row with the same `(user_id, idempotency_key)` and returns it (`{ executionId, status, queuedAt, reused: true }`) instead of re-validating/re-inserting — an accidental double-submit of the same click never creates a duplicate execution or repeats the (cheap, but non-zero) validation work.
- **Race path:** if two near-simultaneous requests with the same key both pass that pre-check (a genuine race), the partial unique index (`uq_render_executions_user_idempotency_key`) makes the second `INSERT` fail with Postgres code `23505`; the route catches exactly that code, re-selects, and returns the winning row instead of surfacing a 500.
- **No global deduplication:** two deliberate renders (different keys, or no key supplied at all) always create two independent rows — matching B0 §14/§15's explicit instruction not to deduplicate intentional renders.

## 8. Snapshot Construction Path

`lib/render-execution/build-snapshot.ts: buildRenderExecutionSnapshot` — pure function, reusing two existing, unmodified functions exactly as Phase 2G-A/2H-C built them:

```
VideoDraft.scenes
  -> deriveVideoSceneAssetBindings(scenes)            (lib/video-scene-assets.ts, unmodified)
  -> adaptVideoDraftToTimelineManifest({draft, identity, sceneAssets})  (unmodified)
  -> TimelineManifest (signed-URL-free by construction)
```

Deliberately **does not** call `prepareVideoDraftTimeline` or `prepareTimelineLibraryFileAssets` — those additionally resolve real, presigned `LibraryFile` URLs, which B0 §6/§7 and this phase's brief both explicitly forbid persisting. This module stops at the manifest-producing half only.

The route (`app/api/video-drafts/[id]/render/route.ts`) supplies `identitySnapshot` by calling the same `adaptProjectIdentityToVisualTokens(project.id, projectIdentity)` the existing, production-wired `app/api/creative/static-authoring/render/route.ts` already calls for Static — no new identity-derivation logic was written.

## 9. Deviation From B0 — Disclosed, Not Silent

B0 §5 described `input_snapshot` as "the frozen, signed-URL-free `TimelineManifest`." Implementation evidence surfaced one precision B0 did not go into: the current neutral timeline resolver (`resolveTimelineManifest` → `resolveIdentitySnapshot`, `lib/creative/identity/resolve-identity-snapshot.ts`) only looks up a **closed, fixture-backed registry** (`lib/creative/identity/fixtures.ts`, two hardcoded entries) by `manifest.identity.snapshot_ref` — it has **no override parameter**. The Static resolver already solved the identical problem for its own path: `resolveStaticRenderManifest(input, { identitySnapshot })` (`lib/creative/resolution/resolve-static-render.ts:33-47`) accepts an explicit `VisualTokensSnapshot` override that bypasses the fixture lookup entirely, and `app/api/creative/static-authoring/render/route.ts` already relies on exactly that override for real Projects.

A real Project's identity ref (`project:{projectId}:snapshot`, produced by `adaptProjectIdentityToVisualTokens`) would **not** be found in the fixture registry — so persisting `input_snapshot` as *only* the bare `TimelineManifest` would silently produce a snapshot that a future claim-time step could not actually resolve for any real (non-fixture) Project.

**Resolution, not a redesign:** `input_snapshot` is a small wrapper object, `{ schema_version, manifest, identitySnapshot }`, carrying the resolved `VisualTokensSnapshot` alongside the manifest — mirroring Static's own established `identitySnapshot`-override pattern, not inventing a new one. This is still exactly what B0 asked for (a frozen, signed-URL-free render input, `input_snapshot JSONB NOT NULL`) — `identitySnapshot` contains no signed URL, no storage path, no credential; it is colors/typography/spacing tokens only (confirmed by the schema itself, `lib/schemas/creative/primitives.ts: VisualTokensSnapshotSchema`), and is proven signed-URL-free by the same test suite as the manifest (§10). **No contradiction was found that required stopping** — this is a precision the implementation evidence required, applied using an already-proven pattern from this same codebase, and is recorded here exactly as the brief requires for any such adjustment.

No other deviation from B0 was made. Table name, column set, state machine, claim semantics, RLS shape, and route shapes all match B0 as written.

## 10. Tests

`lib/render-execution/__tests__/build-snapshot.test.ts` — 8 tests, all passing:

**Snapshot immutability (Task 7):**
- A snapshot built from draft state A retains its computed values (`duration_frames`) unchanged after a second, independent snapshot is built from draft state B.
- Mutating the caller-owned `scenes` array/objects **after** the call (`scene.duration = 999`, pushing a new scene) does not retroactively change the already-returned snapshot — proves no aliasing between the pure function's output and its caller-owned input.
- Two snapshots of different scene states are structurally distinct objects (`not.toBe`), never merged or shared.

**No signed URL / no runtime credential persistence (Task 8):**
- Serialized snapshot never contains `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Expires`, or a generic `Signature=` query parameter.
- Serialized snapshot never contains the real S3-compatible storage host (`s3.multihuman.com.br`), the internal MinIO hostname (`minio:9000`), or **any** `http://`/`https://` URL at all — the snapshot is proven to contain zero URLs of any kind, not merely zero signed ones.
- A bound scene's hero asset is proven to be exactly the opaque `{ type: 'library_file', ref: <uuid>, fit: 'cover' }` shape, never a URL.
- `assertSnapshotHasNoSignedUrl` (the defense-in-depth runtime guard called by the POST route) passes for a real snapshot and throws for a deliberately corrupted one — proving the guard itself is load-bearing, not decorative.
- The wrapper's own `schema_version` (`render-execution-snapshot.v0`) is confirmed independent of the inner manifest's `schema_version` (`timeline.v0`).

This is proof at the pure-function level, applied at exactly the boundary that matters: `buildRenderExecutionSnapshot` is the **only** code path in this phase that constructs `input_snapshot`, and it never imports `createPresignedReadUrl`, `prepareTimelineLibraryFileAssets`, or any S3/network module (confirmed by its own import list, §8) — so proving its output is signed-URL-free is a complete proof for this phase's actual persistence path, not a partial one.

## 11. Claim Concurrency (Task 11) — What Was and Was Not Tested

**FACT, confirmed by repo-wide search before writing the RPC:** no DB/RPC integration test exists anywhere in this repository today — not even for the pre-existing `organize_channel_piece_media`/`remove_channel_piece_media` functions (`scripts/024_channel_piece_media_organization.sql`) this phase's claim function is modeled on. No `postgres()` connection or Supabase-backed test harness exists in `lib/**/__tests__/` or anywhere else.

Per the phase's own explicit instruction — "Use the repository's existing DB/RPC test conventions. Do not build a new integration-testing framework merely for this phase" — and given that convention is **none**, this phase does not introduce one. `claim_next_render_execution`'s concurrency semantics (queued→claimable, claimed→not-simultaneously-claimable, stale-lease→reclaimable, non-stale→not, attempt increments only on reclaim, terminal rows never claimable) are therefore proven only by:
1. The SQL's own structure — `FOR UPDATE SKIP LOCKED` inside a single atomic `UPDATE ... WHERE id = (SELECT ...)` statement is PostgreSQL's standard, well-understood idiom for exactly this claim shape, and the eligibility `WHERE` clause is written to directly encode each of those six requirements (§4).
2. Structural precedent — the same atomic-locking discipline already proven correct in production by the CPM functions this one is modeled on.

**This is a real, disclosed limitation, not a hidden gap.** A future phase that introduces the worker (2I-B2) is the natural point to add a live-Postgres concurrency proof (e.g. two concurrent `SELECT claim_next_render_execution(...)` calls against a real or locally-run Postgres instance), once that phase has legitimate reason to stand up a DB-backed test path the codebase doesn't have yet.

## 12. Error Contract (Task 12)

`POST /api/video-drafts/[id]/render` fails cleanly, with a stable `code` field, for every case the brief lists:

| Condition | Status | `code` |
|---|---|---|
| Unauthenticated | 401 | — (matches existing `Nao autorizado` convention, no code) |
| Invalid `id` route param | 400 | `INVALID_VIDEO_DRAFT_ID` |
| Invalid JSON body | 400 | `INVALID_BODY` |
| Invalid `idempotencyKey` | 400 | `INVALID_IDEMPOTENCY_KEY` |
| VideoDraft not found / not owned | 404 | `VIDEO_DRAFT_NOT_FOUND` |
| VideoDraft has no `project_id` | 409 | `VIDEO_DRAFT_PROJECT_REQUIRED` |
| VideoDraft has no `production_id` | 409 | `VIDEO_DRAFT_PRODUCTION_REQUIRED` |
| VideoDraft has zero scenes | 409 | `VIDEO_DRAFT_EMPTY` |
| Project not found / not owned | 404 | `PROJECT_NOT_FOUND` |
| Project identity structurally invalid | 409 | `PROJECT_IDENTITY_INVALID` |
| Project has no identity content | 409 | `PROJECT_IDENTITY_REQUIRED` |
| Scene→LibraryFile binding invalid (reuses `lib/video-scene-library-bindings.ts` unmodified) | 400 | one of `INVALID_LIBRARY_FILE_ID`/`LIBRARY_FILE_NOT_FOUND`/`LIBRARY_FILE_DELETED`/`LIBRARY_FILE_PROJECT_MISMATCH`/`DRAFT_PROJECT_REQUIRED` |
| Snapshot construction throws (e.g. malformed scene data reaching the pure adapter) | 500 | `SNAPSHOT_CONSTRUCTION_FAILED` |
| Insert fails for a reason other than the idempotency race | 500 | `RENDER_EXECUTION_INSERT_FAILED` |

No renderer error exists — Remotion never runs in this slice, matching the brief.

## 13. `generation_tasks` Non-Regression (Task 10)

`scripts/005_create_generation_tasks.sql`, `app/api/nanobanana/{generate,callback,status/[taskId]}/route.ts` were not read-modified this phase beyond the read-only audit already recorded in B0 §2/§3. No column, policy, or route touching `generation_tasks` was added or changed. No compatibility bridge, shared type, or shared helper exists between `generation_tasks` and `render_executions` — they remain two independent, differently-shaped tables, exactly as B0 §3 concluded they should.

## 14. What Remains for 2I-B2

Per B0 §22 and this phase's own strict scope boundary, **nothing worker-facing was built**:
- No worker polling loop.
- No `POST /api/render-executions/claim` (the HTTP broker around `claim_next_render_execution` — the SQL function exists; the route that calls it with a shared worker secret does not).
- No `POST /api/render-executions/:id/complete` / `.../fail`.
- No MinIO upload, no `@aws-sdk/client-s3` addition to the worker.
- No `infra/render-worker-runtime/` change of any kind (not read or modified this phase beyond what was already known from Phase 2I-A1).
- No product UI — `/videos`' fake "Gerar Vídeo" button is byte-for-byte unchanged (confirmed: `app/(dashboard)/videos/page.tsx` not touched).

## 15. Validation

- **Tests:** 596 → **604** (8 new, all passing; 52 test files, up from 51).
- **Typecheck:** PASS.
- **Lint:** 0 errors / 45 warnings — identical to the inherited baseline; no new warning introduced.
- **Build:** PASS, exit code 0. New routes confirmed registered as dynamic (`ƒ`) functions: `/api/render-executions/[id]`, `/api/video-drafts/[id]/render`. No other route changed.
- **No signed URLs persisted:** proven by §10's dedicated test group, not merely asserted.
- **No user-controlled Project authority:** the POST route never reads a client-supplied project id from the request body at all (only the `VideoDraft` route param); `draft.project_id` is always the freshly-fetched, ownership-checked value.
- **`generation_tasks` unchanged:** confirmed, §13.
- **No worker/VPS code added:** confirmed, §14.
- **Migration reversible:** `scripts/031_create_render_executions.sql` ends with an explicit `-- ROLLBACK` comment block (`DROP FUNCTION`, `DROP TABLE`), matching the same convention `024_channel_piece_media_organization.sql` already uses.
- **Claim function atomicity:** single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` — one statement, no application-level read-then-write race window.
- **Working tree:** `git status --short` shows exactly `lib/types.ts` (modified, additive `RenderExecutionSummary` type) plus four new paths (`app/api/render-executions/`, `app/api/video-drafts/[id]/`, `lib/render-execution/`, `scripts/031_create_render_executions.sql`) — nothing else.

## 16. Verdict

**`READY_FOR_RENDER_WORKER_COORDINATION`**

Every task in this phase's scope (schema, claim RPC, creation route, read route, idempotency, snapshot immutability/no-signed-URL proofs, error contract, `generation_tasks` non-regression) is implemented and validated. The one B0 precision this phase's implementation evidence required (§9) reuses an already-proven pattern from this same codebase rather than inventing one, and is fully disclosed. The claim function's concurrency semantics rest on PostgreSQL's own well-understood locking idiom and structural precedent rather than a live test, because no DB/RPC test convention exists anywhere in this repository to build on — adding one was correctly out of scope for this phase and is flagged as the natural first task for 2I-B2.
