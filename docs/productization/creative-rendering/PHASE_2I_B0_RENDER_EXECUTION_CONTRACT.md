# Phase 2I-B0 — Render Execution Contract & Coordination Architecture

**Nature:** Read-only architecture/contract design. No migration, no Supabase mutation, no API implementation, no worker/VPS/Docker/MinIO change. This document is the only change in the phase. **Evidence labels:** **FACT** (verified in code/schema/docs), **INFERENCE** (reasoned from facts), **RECOMMENDATION** (proposed decision), **OPEN QUESTION** (unresolved).

## 1. Executive Verdict

**`READY_FOR_RENDER_EXECUTION_IMPLEMENTATION`**

A minimal, four-state (`queued → claimed → completed | failed`) `render_executions` table, one Postgres claim function modeled directly on this repo's own existing `organize_channel_piece_media`/`remove_channel_piece_media` RPC pattern (`scripts/024_channel_piece_media_organization.sql`), and a small set of Vercel-only API routes (never called by the browser, never called with a raw Supabase service-role key from the worker) are sufficient to connect the proven control plane (`prepareVideoDraftTimeline`, Phase 2H-C) to the proven execution plane (`infra/render-worker-runtime`, Phase 2I-A1). No Redis, no queue broker, no generic job framework, and no reuse of `generation_tasks` are required or recommended.

## 2. Existing Factual Authority (Task 1)

Audited directly (not inferred) this phase:

| Area | File(s) | Finding |
|---|---|---|
| `VideoDraft`/`VideoScene` | `scripts/002_create_drafts_tables.sql`, `scripts/020_create_productions.sql`, `lib/types.ts` | `video_drafts(id, user_id, project_id nullable, production_id, name, scenes JSONB, created_at, updated_at)`. Plain `user_id = auth.uid()` RLS on all four operations (`video_drafts_select_own` etc.). |
| `LibraryFile` | `scripts/015_create_library_files.sql` | `library_files(id, user_id, project_id nullable, folder, name, kind CHECK(image|video|audio|document|other), mime_type, file_size, storage_provider, storage_path, public_url, thumbnail_url, deleted_at, created_at, updated_at)`. Same plain-ownership RLS shape. |
| `generation_tasks` | `scripts/005_create_generation_tasks.sql` | `(id, user_id, project_id, task_id UNIQUE, provider, prompt, aspect_ratio, image_url, status TEXT NOT NULL DEFAULT 'processing', error_message, callback_received_at, raw_response JSONB, created_at, updated_at)`. **FACT:** `status` defaults straight to `'processing'` — the schema's own `'pending'` possibility is never actually used by `app/api/nanobanana/generate/route.ts`, which inserts with `status: 'processing'` immediately after the external API accepts the job. |
| Supabase client/server | `lib/supabase/server.ts`, `client.ts`, `middleware.ts` | `createClient()` (server) uses `createServerClient` with the **anon** key + cookie-based session — a normal authenticated-user client, not service-role. |
| Service-role usage | repo-wide grep for `SUPABASE_SERVICE_ROLE_KEY` | **Exactly one usage in the entire repository**: `app/api/nanobanana/callback/route.ts:6`, because that route is a webhook called by an external provider with no user session to authenticate against RLS. This is the only existing precedent for bypassing RLS, and it is narrow and single-purpose. |
| API auth pattern | `app/api/video-drafts/route.ts` | Every verb: `supabase.auth.getUser()` → 401 if absent → every query scoped with `.eq('user_id', user.id)` → related-entity ownership re-validated server-side (`validateProductionOwnership`, `validateProjectOwnership`) → client-supplied `project_id`/`production_id` never trusted without a fresh DB check. This is the pattern every new render-execution route should copy. |
| RLS assumptions | `scripts/001_create_tables.sql`, `015`, `020`, `021` | **FACT:** No `project_members`/`team_members`/organization table exists anywhere in the schema (confirmed by repo-wide grep — zero matches). Ownership throughout the entire product is single-owner `user_id = auth.uid()`. This significantly simplifies the RLS design in §18 — there is no team/sharing model to account for. |
| Storage/S3 utilities | `lib/storage/s3.ts` | `createPresignedReadUrl(path)` (GET, 3600s expiry), `createPresignedImageUpload` (PUT, 900s expiry), `uploadLibraryFile` (direct buffer upload, path convention `users/{userId}/library/{uuid}/{safeName}.{ext}`), `moveS3Object`/`moveLibraryS3Object` (server-side COPY+DELETE, no re-download). All configured via `S3_ENDPOINT`/`S3_BUCKET_NAME`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` env vars; bucket confirmed elsewhere in this repo's docs as `content-studio`. |
| Existing task/status polling pattern | `app/api/nanobanana/{generate,callback,status/[taskId]}/route.ts` | Insert (`processing`) → external webhook update (`completed`/`failed`, service-role) → client polls `GET .../status/[taskId]` (user-scoped, anon-key client). No Realtime subscription exists anywhere in the repo (confirmed by grep for `realtime`/`.channel(` — zero matches). |
| Existing status enum convention | `projects.status`, `editorial_contents.status`, `channel_pieces.status`, `generation_tasks.status` | **FACT:** every status column in this schema is `TEXT NOT NULL DEFAULT '...' CHECK (status IN (...))` — never a real Postgres `ENUM` type. `render_executions.status` should follow the same convention for consistency. |
| Retry/idempotency precedent | repo-wide | **None found.** No table in this schema has ever needed idempotency-key or attempt-count semantics before now — this is genuinely new ground, not an existing pattern to copy. |
| Project ownership validation | `app/api/video-drafts/route.ts: validateProjectOwnership/validateProductionOwnership` | Always a fresh `SELECT ... WHERE id = :id AND user_id = :user` — never trusts a client-supplied `project_id` without independent verification. |
| Atomic-mutation-with-locking precedent | `scripts/024_channel_piece_media_organization.sql` | **FACT, the single most load-bearing precedent for this phase.** Two `SECURITY INVOKER` Postgres functions already implement exactly the pattern this phase needs elsewhere in the schema: `FOR UPDATE NOWAIT` row locking, ownership checked via `auth.uid()`, structured `RAISE EXCEPTION 'CODE: message'` errors parsed by the API layer into HTTP status codes (`CPM_UNAUTHORIZED`→401, `CPM_NOT_FOUND`→404, `CPM_CONFLICT`/`CPM_LOCK_CONFLICT`→409, `CPM_INVALID_INPUT`→400), fixed `search_path = public, auth`, and `REVOKE ALL ... GRANT EXECUTE TO authenticated`. This is directly reused, not reinvented, in §9's claim design (with one necessary difference: the claim function is not called by an end user — see §11). |

## 3. Why `generation_tasks` Is Not Reusable (Task 2)

**FACT, confirmed against the real schema, not merely re-asserted from Phase 2I0.** `generation_tasks` exists for exactly one shape: *this application dispatches work to a third-party HTTP API, which computes asynchronously on infrastructure this application does not control, and reports back via an inbound webhook this application cannot control the timing of.* Every column reflects that: `task_id` is the **external** provider's ID (not ours), `provider` names the external service, `callback_received_at` exists only because an inbound webhook exists, `raw_response` stores the external payload verbatim.

Timeline rendering is the structural opposite: **this application's own infrastructure** (the VPS render-worker, Phase 2I-A1) runs the compute, on a schedule this application controls (poll-and-claim), with no external party and no inbound webhook — the worker has no public port at all (given fact, §"Proven VPS execution plane"). Forcing `render_executions` semantics onto `generation_tasks` would require either inventing a fake external "provider" (`provider = 'self'`) or leaving `task_id`/`callback_received_at`/`raw_response` permanently meaningless — exactly the "semantic confusion" this phase's brief warns against, and the same conclusion Phase 2I0 §6 already reached before this phase's own schema audit. **Confirmed, not merely inherited.**

**Compared against the other two alternatives:**
- **Extending `VideoDraft` itself** (e.g. `video_drafts.render_status`) — rejected. A `VideoDraft` is a mutable, continuously-autosaved authoring document (800ms debounce, per `app/(dashboard)/videos/page.tsx`); a render execution is an immutable, timestamped, worker-owned attempt record. Coupling them would mean every render attempt overwrites the same row (no history, no concurrent-attempt safety, no lease/claim semantics possible on a row the user's own autosave is simultaneously writing to).
- **Ephemeral HTTP-only execution** (no persistence at all) — rejected per Phase 2I0 §5/§12: the render duration (37-48s observed, §"Proven Real VPS Render") already exceeds a comfortable single HTTP round-trip, and a worker with no public port cannot itself be the thing the browser polls.
- **A dedicated `render_executions` record** — **accepted.** It is the only option whose lifecycle (queued → claimed → terminal, worker-owned, immutable-per-attempt) actually matches the problem.

**Verdict: a new, purpose-built table is justified.** Not a generic `jobs`/`tasks` abstraction — a table shaped specifically for this one execution kind, matching this repo's existing convention of one table per real domain concept (`generation_tasks` itself is not generic either — it is NanoBanana-shaped).

## 4. Execution State Machine (Task 3)

**RECOMMENDATION — four persisted states, not six.** The `idle`/`preparing`/`queued`/`rendering`/`completed`/`failed` list carried over from Phase 2I0 was explicitly a **product/UI** state sketch, not a persistence proposal — Phase 2I0 itself already flagged this distinction as open. Answering it now:

- **`idle` is never persisted.** It is the absence of a row. A UI showing "idle" simply has no in-flight execution for this `VideoDraft` to query.
- **`preparing` and `rendering` collapse into one persisted state, `claimed`.** Once a worker claims a row, the row is worker-owned until it reports a terminal outcome — from the persisted record's point of view, "reconstructing `ResolvedTimelineInput`" (§7) and "actually calling `renderMedia`" are both just "a worker currently owns this and hasn't finished." Splitting them into two DB states would require the worker to make an extra write between them for zero decision-making benefit (nothing in this architecture branches on "preparing vs. rendering" — not retry logic, not lease expiry, not the UI). A future slice can distinguish them for progress display via non-persisted heartbeat metadata if real frame-progress reporting is ever wired (Phase 2I0 §11 already noted this isn't wired today).

```
queued ──(claim)──► claimed ──(complete)──► completed   [terminal]
   ▲                    │
   │                (lease expiry;                      
   │             reclaimed atomically,               
   │              same row, attempt+1)                  
   └────────────────────┘
                    │
                (explicit fail)
                    ▼
                 failed   [terminal]
```

- **Valid transitions:** `queued → claimed` (claim RPC only); `claimed → completed` (worker-reported success only); `claimed → failed` (worker-reported terminal error only); `claimed → claimed` (lease-expiry self-transition, same row, `attempt` incremented, `claimed_by`/`lease_expires_at` overwritten — this is the *only* transition that does not require an explicit worker call, because it is what happens when a worker never calls back at all).
- **Terminal states:** `completed`, `failed`. Neither is ever re-opened. A user-initiated re-render after `failed` creates a **new row** (`retry_of_execution_id`, §6/§16), never flips the old one back to `queued`.
- **Retry semantics:** two independent kinds, deliberately not conflated (Task 13/14 both depend on this split):
  1. **Infrastructure retry (same row):** a worker claims a row and then dies/network-partitions before reporting back. The row's `lease_expires_at` passes; the *next* claim query (§9) is written to also match `status = 'claimed' AND lease_expires_at < now()`, so it is atomically reclaimable — `attempt` increments, `claimed_by`/`claimed_at`/`lease_expires_at` are overwritten. After `attempt > max_attempts`, the claim query excludes the row and a scheduled cleanup (§21, later slice) marks it `failed` with `error_code = 'max_attempts_exceeded'`.
  2. **User retry (new row):** an execution reaches `failed` (or the user just wants another take). A new "Renderizar vídeo" action creates a **new** `render_executions` row with `retry_of_execution_id` pointing at the failed one and `attempt = 1` (a fresh attempt chain), never resurrecting the old row.
- **Stale/abandoned execution handling:** covered by the lease-expiry self-transition above — no cron/broker required for the common case; only the `max_attempts_exceeded` terminal flip needs a periodic sweep (deferred to a later slice, §21).
- **Lease expiry duration:** **RECOMMENDATION:** a fixed, generous lease (e.g. 5 minutes) set once at claim time, comfortably above the 37-48s durations actually observed (§"Proven Real VPS Render") with headroom for a cold Remotion bundle. No heartbeat/renewal mechanism for MVP — see §9 open question for when renders grow long enough that this stops being safe.
- **Cancellation:** **not implemented.** Nothing in this architecture (or in `infra/render-worker-runtime/server.mjs`, which has no cancel endpoint — confirmed by reading it this phase) makes cancellation cheap or real today; inventing it now would be exactly the "architecture for theoretical need" the brief warns against.

## 5. Proposed Schema (Task 4)

Table name: **`render_executions`** — the brief's own preferred name fits the repo's existing naming convention (`generation_tasks`, `channel_piece_media`: plural, snake_case, domain-noun-first) and there is no evidence suggesting a better one.

| Column | Type | Null? | Semantic meaning | Writer | Reader | Why needed |
|---|---|---|---|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | no | Execution identity | creation API | everyone | Standard PK, matches every table in this schema. |
| `user_id` | `UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` | no | Owning user | creation API (from `auth.uid()`, never client body) | RLS (§18) | Every table in this schema keys RLS off this column; no reason to diverge. |
| `project_id` | `UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE` | no | Owning project, **denormalized at creation time** from `video_draft.project_id` | creation API only | RLS/filtering, debugging | `video_drafts.POST` already denormalizes `project_id` from the resolved `production_id` at insert time (`app/api/video-drafts/route.ts:216`) — this is an established, not invented, pattern in this codebase. Freezing it protects the execution record if the draft is later reparented/deleted. |
| `video_draft_id` | `UUID NOT NULL REFERENCES video_drafts(id) ON DELETE CASCADE` | no | The authoritative subject being rendered | creation API | everyone | This is literally what is being rendered — required. |
| `status` | `TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','completed','failed'))` | no | §4's state machine | creation API (`queued`), claim function, complete/fail routes | everyone | Matches this schema's universal `TEXT + CHECK` convention (no real Postgres ENUM anywhere in this repo). |
| `attempt` | `INT NOT NULL DEFAULT 1 CHECK (attempt >= 1)` | no | Claim-attempt counter **on this row** (infra retries, §4.1) | claim function (increments on lease-expiry reclaim) | worker (max-attempts guard), debugging | Needed to bound infra retries and distinguish a first claim from a reclaimed one in logs. |
| `max_attempts` | `INT NOT NULL DEFAULT 3` | no | Ceiling for `attempt` before permanent `failed` | creation API (fixed default; not client-settable) | claim query, cleanup sweep | Table-driven ceiling avoids hardcoding it in application/SQL logic in two places. |
| `retry_of_execution_id` | `UUID NULL REFERENCES render_executions(id)` | yes | Links a user-initiated retry (§4.2) back to its predecessor | creation API | product UI, debugging | Answers Task 14/6 without resurrecting terminal rows. |
| `claimed_by` | `TEXT NULL` | yes | Worker instance identifier (e.g. hostname/PID or a configured worker id) | claim function | debugging, lease-recovery logic | Needed to reason about "which worker (still) thinks it owns this" during incident review; single-worker today, but required the moment a second replica exists (Task 19). |
| `lease_expires_at` | `TIMESTAMPTZ NULL` | yes | When an unfinished claim becomes reclaimable | claim function (set on every claim) | claim query itself | The entire stale-lease mechanism (§4) depends on this column. |
| `input_schema_version` | `TEXT NOT NULL` | no | Copied from the frozen manifest's own `schema_version` (e.g. `'timeline.v0'`) at creation | creation API | worker/claim endpoint (sanity check), future migration tooling | Cheap defense against silently rendering a manifest shape the reconstruction code no longer understands. |
| `input_snapshot` | `JSONB NOT NULL` | no | The frozen, **signed-URL-free** `TimelineManifest` (see §7) | creation API only, **immutable after insert** | claim endpoint (to reconstruct `ResolvedTimelineInput`) | See §7 — this is the entire input-authority design, not a generic "job payload" field. JSONB (not normalized columns) mirrors this repo's own existing convention of authoring-shaped JSONB (`video_drafts.scenes`) validated at the boundary rather than fully normalized. |
| `idempotency_key` | `TEXT NULL`, `UNIQUE (user_id, idempotency_key)` | yes | Client-supplied dedup key for one user gesture (§14) | creation API (from request body, optional) | creation API (conflict check) | Distinguishes accidental double-submit from intentional repeat renders — see §16. |
| `queued_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | no | When the row was created | creation API | UI, debugging | Needed for FIFO claim ordering and "how long has this been waiting" observability. |
| `claimed_at` | `TIMESTAMPTZ NULL` | yes | When first claimed (not overwritten on reclaim) | claim function (`COALESCE` — set only if null) | UI, debugging | Distinguishes "never started" from "worker died mid-run." |
| `completed_at` | `TIMESTAMPTZ NULL` | yes | Terminal success timestamp | complete route | UI, retention/cleanup (§20) | Terminal marker + cleanup anchor. |
| `failed_at` | `TIMESTAMPTZ NULL` | yes | Terminal failure timestamp | fail route / lease-sweep | UI, debugging | Terminal marker. |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | no | Generic last-write marker | trigger (matches `update_updated_at_column()` used everywhere else in this schema) | debugging | Standard convention in every other table here. |
| `output_bucket` | `TEXT NULL` | yes | MinIO bucket holding the rendered MP4 | complete route | product (future Save action, §12), debugging | Needed to retrieve the output without hardcoding the bucket name in every reader. |
| `output_storage_path` | `TEXT NULL` | yes | Object key within `output_bucket` (see §12 convention) | complete route | product (future Save action), debugging | Same shape as `library_files.storage_path` — precedented column semantics, new table. |
| `output_mime_type` | `TEXT NULL DEFAULT 'video/mp4'` | yes | MIME of the produced object | complete route | future Save action (feeds directly into the *existing* `/api/channel-piece-media/upload` MIME whitelist, which already accepts `video/mp4`) | |
| `output_size_bytes` | `BIGINT NULL` | yes | Byte size of the uploaded object | complete route | UI, retention decisions | Mirrors `library_files.file_size`. |
| `output_duration_ms` | `INT NULL` | yes | Wall-clock render time reported by the worker | complete route | observability (§19) | Genuinely new operational data (not derivable from the input manifest) — worth keeping given Phase 2I0's explicit concern about render-duration growth. |
| `error_code` | `TEXT NULL` | yes | Short, stable, product-facing failure classification (§15) | fail route / lease-sweep | UI (safe to show), debugging | |
| `error_message` | `TEXT NULL` | yes | Short, human-readable, product-safe summary | fail route | UI (safe to show) | |
| `error_detail` | `TEXT NULL` | yes | Truncated internal diagnostic (e.g. last N chars of worker stderr) | fail route | **server-side/internal only** — never returned by the user-facing `GET` projection (§16) | Mirrors the existing precedent in `app/api/creative/static-authoring/render/route.ts:56`, which already truncates `stderr` to `.slice(-4000)` rather than returning it unbounded. |

**Explicitly decided NOT to include**, with reasons:
- **`channel_piece_id` / `library_file_id` (output side):** rejected. Per Task 12/§13, a render execution's output is never automatically a `LibraryFile` or `ChannelPieceMedia` — adding these columns here would blur exactly the boundary the phase brief insists on preserving.
- **Full `ResolvedTimelineInput` JSON (with signed URLs):** rejected — see §7. Persisting a presigned URL anywhere durable is the one thing every existing render-related doc in this repo (Phase 2G-B/C/D, 2H-C) has consistently refused to do ("the manifest never carries the signed URL string"), and this phase does not deviate from that invariant.
- **`priority`:** rejected. Single worker, FIFO by `queued_at` is already the entire scheduling policy needed; a priority column with no consumer is dead weight.
- **Separate `output_width`/`height`/`fps`/`duration_frames` columns:** rejected — already fully derivable from `input_snapshot.specification`, and duplicating them risks silent drift between "what was requested" and "a stale cached column."
- **`worker_id` as a distinct column from `claimed_by`:** rejected — one column already covers both purposes (identify the current/last claimant); a second column would be redundant until an actual reason to separate "worker fleet identity" from "specific claim owner" exists.

## 6. Snapshot / Immutability Semantics (Task 6)

**RECOMMENDATION: snapshot at execution creation, not "latest `VideoDraft` at execution start."** If the user clicks "Renderizar vídeo" and edits the `VideoDraft` while the row is `queued`, the render must **not** silently pick up the edit — `input_snapshot` (§5) is written once, at `INSERT`, and never re-read from `video_drafts` again for that row. This is the same determinism principle already established for `AssetRef`/`TimelineManifest` elsewhere in this codebase (the manifest is a frozen, neutral artifact; live domain state is never re-consulted mid-pipeline).

**What, precisely, is frozen:** the output of the *manifest-producing* half of `prepareVideoDraftTimeline` (`lib/creative/integration/prepare-video-draft-timeline.ts:38-93`) — i.e. `deriveVideoSceneAssetBindings` + `adaptVideoDraftToTimelineManifest`'s resulting `TimelineManifest`, which is **already, by construction, free of signed URLs, storage paths, and MIME snapshots** (confirmed across Phase 2G-B/C/D and 2H-C). The *asset-resolution* half (`prepareTimelineLibraryFileAssets` → real presigned URL) is deliberately **not** run at creation time — it is re-run at claim time (§7/§9), against the frozen manifest's `library_file` refs, which is what keeps signed-URL lifetime out of the picture entirely.

**This is the minimal snapshot, not a universal versioning system.** No `ContentVersion`/artifact-history table is introduced — a single JSONB column on the execution row is sufficient because the only consumer of the snapshot is that one execution's own claim/render cycle; nothing else in the product needs to browse historical manifest versions (Phase 2D0 §15/Phase 2F0 §14 already confirmed `ContentVersion` "does not exist" and is out of scope generally).

## 7. Input Authority Model (Task 5)

**Chosen: Option C (hybrid) — which, once the manifest/asset split above is applied, is really "Option B done correctly."**

| Option | Verdict |
|---|---|
| A — Vercel prepares the full `ResolvedTimelineInput` (with real signed URLs) at execution creation and stores it | **Rejected.** A row can sit `queued` for an unknown amount of time (Task 8's polling cadence, §9's claim cycle) before a worker claims it; a signed URL frozen at creation time could expire before it's ever fetched, and persisting a signed URL at all violates this codebase's own established invariant (§6). |
| B — Vercel stores only authoritative IDs/version references; reconstruction happens fully at claim time | Close, but naive: re-running the *entire* `prepareVideoDraftTimeline` (including re-deriving the manifest from `video_drafts.scenes`) at claim time would silently pick up any edits made after the user clicked render — violating §6's determinism requirement. |
| **C — chosen** | Freeze the **manifest** (deterministic, asset-identity-only, no live domain re-read) at creation time (§6); resolve **signed asset URLs** fresh, from that frozen manifest's `library_file` refs, only at claim time. Best of both: reproducible input shape, zero persisted secrets. |

**Reproducibility:** guaranteed — the frozen manifest plus the same underlying `LibraryFile` binary content always produces the same `TimelineComposition` render input (modulo Chromium/font rendering determinism, already an accepted, documented limit elsewhere in this architecture).

**Security:** no presigned URL, storage path, or credential is ever written to a durable row — `createPresignedReadUrl` (`lib/storage/s3.ts:296`) is called only inside the claim-time reconstruction, server-side, and the result flows directly into the claim response to the worker, never persisted.

**Stale authoring changes:** cannot leak into an in-flight execution — see §6.

**Retry behavior:** a retried execution (§4.2, new row) re-derives its own fresh `input_snapshot` from the *current* `VideoDraft` state at the moment of the retry click — which is the correct, expected behavior for a deliberate "try again" (it should reflect whatever the user has since fixed), while still never touching the old, terminal row.

**Signed URL lifetime:** the window between "URL generated" and "URL consumed by Chromium" shrinks to the length of one claim-response round-trip (milliseconds) plus the render itself (well inside `createPresignedReadUrl`'s existing 3600s expiry) — not "however long the row waited in `queued`."

**Execution determinism:** the worker never receives, and cannot construct, an authoritative render input on its own — it always receives it from the Vercel-side claim endpoint, which is the only place authorized to call `prepareTimelineLibraryFileAssets`'s ownership-and-active-status revalidation (`lib/creative/integration/prepare-video-draft-timeline.ts:69-75`, already unmodified and reusable exactly as Phase 2H-C built it).

## 8. Claim/Lease Algorithm (Task 7)

**RECOMMENDATION: one atomic Postgres function, modeled directly on `scripts/024_channel_piece_media_organization.sql`'s existing style**, not a generic broker.

Conceptual shape (architecture only — **not** to be applied this phase):

```sql
CREATE OR REPLACE FUNCTION claim_next_render_execution(p_worker_id TEXT, p_lease_seconds INT DEFAULT 300)
RETURNS render_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row render_executions;
BEGIN
  UPDATE render_executions
  SET status = 'claimed',
      claimed_by = p_worker_id,
      claimed_at = COALESCE(claimed_at, now()),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt = CASE WHEN status = 'claimed' THEN attempt + 1 ELSE attempt END,
      updated_at = now()
  WHERE id = (
    SELECT id FROM render_executions
    WHERE (status = 'queued')
       OR (status = 'claimed' AND lease_expires_at < now() AND attempt < max_attempts)
    ORDER BY queued_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO v_row;
  RETURN v_row; -- NULL row (no id) when nothing was claimable
END;
$$;

REVOKE ALL ON FUNCTION claim_next_render_execution(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_next_render_execution(TEXT, INT) TO service_role;
```

**Why `FOR UPDATE SKIP LOCKED` rather than `NOWAIT` (the CPM precedent's choice):** the CPM functions use `NOWAIT` because a lock conflict there means "reject this request, ask the human to retry" (a single specific row the human is actively editing). Here, the caller doesn't care *which* queued row it gets — `SKIP LOCKED` lets a (future) second concurrent worker simply move on to the next available row instead of erroring, which is the correct behavior for a work-queue claim and is PostgreSQL's standard idiom for exactly this pattern.

**`worker_id`:** a stable string the worker process supplies on every claim call (e.g. an env var set once per container, `RENDER_WORKER_ID`), not auto-generated — keeps `claimed_by` meaningful across restarts of the same container.

**Lease duration:** 300s default (§4) — generous relative to the 37-48s observed real renders, with headroom for cold-bundle first-request cost (Phase 2I-A1 measured 47.7s cold vs 30.7s warm).

**Renewal/heartbeat:** **not needed for MVP** — see §4's lease-duration reasoning. **OPEN QUESTION**, explicitly carried forward: if render durations grow toward the lease window (Phase 2I0 §17's long-form concern), a heartbeat-renewal call becomes necessary; nothing in this schema (`lease_expires_at` is just a timestamp, freely extendable by a future `PATCH`) precludes adding one later.

**Worker dies after claim, before rendering starts:** row sits `claimed` until `lease_expires_at`; naturally reclaimed by the next poll cycle (§4.1).

**Worker dies during render:** identical — the lease doesn't know or care whether the worker was "preparing" or "in `renderMedia`" (§4's collapsed-state decision), it just expires and the row becomes reclaimable.

**Max attempts:** `attempt < max_attempts` is part of the claim query's own `WHERE` clause — once exhausted, the row simply stops being claimable. A separate, later-slice sweep (§21) is responsible for flipping such rows to `failed` with `error_code = 'max_attempts_exceeded'` so they don't sit in permanent claimable-limbo silently.

**No broker introduced:** this is a single SQL statement executed via the existing Supabase Postgres connection Vercel already has (through the service-role client, §9) — not a new moving part.

## 9. Polling Model (Task 8)

**FACT restated:** the worker has no public port (given infrastructure fact) — it can only make outbound requests. **FACT:** no Realtime usage exists anywhere in this repo (§2). **RECOMMENDATION: the worker polls an authenticated Vercel API endpoint — never Supabase directly, never Realtime.**

Rejected alternatives:
- **Worker polls Supabase directly (PostgREST/`supabase-js`)** — would require the worker to hold *some* Supabase credential capable of calling `claim_next_render_execution` (service-role, since the function must see across all users' queued rows, which no per-user anon/authenticated JWT could ever do). This is exactly the "casually expose service-role credentials" the brief warns against (§11) — rejected in favor of the Vercel-broker model below.
- **Supabase Realtime + fallback polling** — no existing precedent, no established benefit demonstrated (queue depth and render cadence are both low-volume for an MVP with one worker), and would be new infrastructure surface for a problem plain polling already solves adequately at this scale. Rejected per the brief's own "do not overengineer" instruction.
- **Worker polls an authenticated Vercel endpoint** — **chosen.** The worker calls `POST /api/render-executions/claim` (§16) with a shared secret (§11); Vercel's route runs `claim_next_render_execution` via its own service-role connection and returns either "nothing to do" or the claimed row *plus* the freshly-reconstructed `resolvedInput` (§7) in one response. This keeps the Supabase service-role key exactly where it already lives today (Vercel's server environment only, per the one existing precedent in `app/api/nanobanana/callback/route.ts`) and never on the VPS at all.

**Cadence: RECOMMENDATION — conservative, fixed interval, e.g. every 5-10s**, matching the render durations observed (tens of seconds) — no benefit to sub-second polling for a single worker with no urgency SLA, and a fixed interval avoids any backoff/jitter complexity this MVP doesn't need. **OPEN QUESTION**, deferred to the implementation slice: whether the worker should also poll faster briefly after finishing a render (to reduce idle-to-next-pickup latency) — a cheap, optional refinement, not required for correctness.

## 10. Worker Authentication Model (Task 9)

| Option | Blast radius | Operational simplicity | Secret rotation | RLS implications | Claim atomicity | Vercel dependency | Least privilege |
|---|---|---|---|---|---|---|---|
| 1. Worker holds the Supabase service-role key directly | **Full database bypass** if leaked — every table, every row, every user | Simple to wire, but the single scariest secret in the whole stack now lives on a VPS container instead of only in Vercel's env | Rotating it means redeploying the worker too, coupling two independently-deployed systems | Moot — service-role bypasses RLS entirely | Trivial (direct RPC call) | None — works even if Vercel is down | **Violated** — the worker only ever needs to touch `render_executions`, not the whole database |
| **2. Worker talks only to authenticated Vercel endpoints (chosen)** | A leaked worker secret lets an attacker create fake claim/complete/fail calls **scoped to whatever those specific routes allow** — cannot read/write anything else in the database | One more small, purpose-built secret (`RENDER_WORKER_SECRET`) shared between Vercel env and the worker container; symmetric with how the worker already has no other Supabase-shaped credential (Phase 2I-A1's boundary) | Independent of the Supabase service-role key entirely — rotate it without touching Supabase at all | N/A — Vercel's routes use service-role internally, same as the one existing precedent | Still atomic — the atomicity lives in the Postgres function (§8), not in the transport | Worker cannot claim/report work if Vercel is down — acceptable: nothing renders without the control plane being reachable anyway (it's also the only source of the render input) | **Preserved** — narrowest secret that does the job |
| 3. A narrowly-scoped DB/RPC credential (custom Postgres role, direct connection) | Narrower than service-role, but still direct database access from the VPS | New infrastructure surface — a direct Postgres connection string as a VPS secret, independent connection pooling/retry logic the worker would need to own | Would need to be managed through Supabase's connection-string surface, separate from anything this repo currently does | Would need its own grants, bypassing the RLS model this schema otherwise relies on uniformly | Achievable, but duplicates what Option 2 already gets for free through the existing Postgres function | Same as Option 2 | Reasonable, but strictly more moving parts than Option 2 for no additional benefit given the current single-worker, low-volume scale |

**MVP recommendation: Option 2.** It reuses the exact secret-handling shape this repo already has exactly one precedent for (service-role key, Vercel-only, narrow route), adds only one new small shared secret (worker↔Vercel bearer token, comparable in spirit to `RENDER_WORKER_SECRET` — a bearer/HMAC token checked by the claim/complete/fail routes before doing anything), and keeps the worker permanently ignorant of how to reach Supabase or MinIO's control-plane credentials directly for domain data. **Harder/future model (only if warranted by scale):** Option 3, if/when multiple workers or a need for the worker to read/write outside the narrow `render_executions` surface ever materializes — not recommended now, no evidence demands it.

## 11. MinIO Output Strategy (Task 10)

**Bucket: reuse the existing `content-studio` bucket** (given instruction: "Do not invent a second bucket unless necessary"; also matches `S3_BUCKET_NAME` already used by every other storage path in this repo).

**Prefix convention: mirror, don't invent.** `lib/storage/s3.ts: uploadLibraryFile` already establishes `users/{userId}/library/{uuid}/{safeName}.{ext}` as this codebase's storage-path idiom. **RECOMMENDATION:**
```
users/{user_id}/renders/scratch/{render_execution_id}/output.mp4
```
— keyed by `render_execution_id` (already globally unique, already the row's own PK) rather than a second random UUID, and nested under the same `users/{userId}/...` top-level partition every other user-owned object in this bucket already uses (not the brief's own `renders/scratch/...` suggestion verbatim, since that would be a bucket-root prefix inconsistent with the established per-user partitioning this repo already relies on elsewhere for any future per-user storage tooling).

**MIME type:** `video/mp4` — matches `output_mime_type`'s default (§5) and is already in the accepted whitelist of the existing `/api/channel-piece-media/upload` route (confirmed by Phase 2G0 §14/Phase 2F0), which matters directly for §12's Save boundary.

**Metadata:** **RECOMMENDATION — none stored as S3 object metadata; the DB row is the sole source of truth** for `output_bucket`/`output_storage_path`/`output_mime_type`/`output_size_bytes`/`output_duration_ms` (§5), exactly mirroring how `library_files` is already the source of truth for its own objects rather than relying on S3-side metadata.

**Cleanup lifecycle:** **RECOMMENDATION, not implemented this phase:** scratch objects are deleted a fixed retention window (e.g. 7 days) after `completed_at`, **unless** promoted by an explicit Save (§12) — at which point the object has already been moved (not merely referenced) into the standard `library_files` path and the scratch copy can be deleted immediately. Deferred to a later slice per the brief's own instruction not to implement cleanup now.

**When local `/tmp` is deleted:** immediately after the MinIO upload is confirmed successful (synchronous cleanup inside the worker's own upload step, not deferred), and also after a small bounded number of failed upload attempts, to protect the single-node VPS's disk from an accumulation of orphaned files.

## 12. MinIO Credential Strategy (Task 11)

| Option | Assessment |
|---|---|
| A — Control Plane creates a presigned PUT URL; worker uploads without persistent MinIO credentials | **Rejected**, for a reason grounded directly in the given infrastructure facts, not preference: Vercel cannot reach `http://minio:9000` (that hostname only resolves inside `content-studio-backplane`) — it would have to presign against the **public** Traefik-fronted endpoint. A presigned S3 URL is host-bound (its signature covers the host) — the worker could not rewrite that URL to use the internal endpoint instead, so this option would force the actual MP4 upload traffic out through the public endpoint, directly contradicting the given guidance that "heavy internal traffic should not be forced through it without reason." |
| **B — worker holds a least-privilege MinIO access key scoped to the scratch prefix, uses `http://minio:9000` directly (chosen)** | Matches every given infrastructure fact: `content-studio-backplane` exists specifically for worker↔MinIO traffic; the bucket is private; the internal endpoint is already proven reachable (`→ HTTP 200`, given fact). No URL-expiry concern (a held credential, not a time-boxed URL). Simple retry (re-`PUT` the same key on failure — MinIO PUT is naturally idempotent for a fixed key). No practical file-size ceiling the way a single presigned-URL PUT can have. Blast radius: a leaked key exposes only whatever prefix/bucket policy it's scoped to (MinIO supports bucket/prefix-scoped policies natively) — and critically, this credential has **no relationship whatsoever to the Supabase control-plane data**, so even a full compromise cannot touch `VideoDraft`/`LibraryFile`/user rows, only scratch render objects. |
| C — another minimal model | None found in the given facts that beats B; B is not a compromise, it is what the stated network topology was evidently built for. |

**MVP recommendation: Option B.** Scope the credential's write (and, if the worker ever needs to verify its own upload, read) access to the `users/*/renders/scratch/*` prefix only, stored solely as an environment variable on the render-worker container (never in Vercel, never in the browser) — a third independent secret alongside the Supabase service-role key (Vercel-only) and the worker↔Vercel shared secret (§10), each with a deliberately narrow, non-overlapping blast radius.

**Consequence for Phase 2I-A1's dependency conclusion:** Phase 2I-A1 (`infra/render-worker-runtime/README.md` §9) correctly concluded the worker's *current* render path needs no AWS SDK. **This phase's output-upload step is new scope beyond that boundary** — implementing MinIO upload (a future slice, §21) will add `@aws-sdk/client-s3` (already a repo dependency, reused, not a new package to the *monorepo*, but genuinely new to the *worker's* own dependency closure) as a real, disclosed addition, not a silent one.

## 13. Output Authority Semantics (Task 12)

**RECOMMENDATION — "completed" means exactly:** render succeeded (worker's own `renderMedia` call returned without throwing) **and** the resulting object was successfully uploaded to `output_bucket`/`output_storage_path` **and** the execution row's output columns (§5) are populated — nothing less, nothing more. It explicitly does **not** mean a `LibraryFile` was created, a `ChannelPieceMedia` was created, anything was approved, or anything was published — those remain a strictly later, explicit, user-initiated action.

**Boundary, reusing existing, already-proven machinery — not inventing a new persistence path:**
```
render execution completed (scratch MP4 in MinIO, row status='completed')
        │
   explicit user "Salvar" action  (future product slice, out of scope here)
        │
   moveS3Object({ currentPath: <scratch path>, nextPath: users/{userId}/library/{uuid}/{name}.mp4 })
        │              (lib/storage/s3.ts — existing, unmodified, server-side COPY+DELETE)
        ▼
   POST /api/channel-piece-media/upload  (existing, already accepts video/mp4, already atomic w/ compensation)
        │
   LibraryFile(kind='video') → ChannelPieceMedia (when a ChannelPiece context exists)
```
This is the same conclusion Phase 2G0 §14/Phase 2H0 §19 already reached architecturally and Phase 2I0 §9 re-affirmed for the async case — this phase adds nothing new to that boundary, it only supplies the missing "where does the render live before Save" half (§11/§12), using the exact `moveS3Object` helper this repo already has (`lib/storage/s3.ts:254-289`), so the eventual Save step never needs to re-download-then-re-upload the MP4 — a server-side COPY is sufficient, exactly as this repo already does for Library file reorganization.

## 14. Error Taxonomy (Task 13)

**RECOMMENDATION — small, closed set of `error_code` values**, each mapped to retryable-or-terminal, product-facing `error_message` short strings, with any raw diagnostic confined to `error_detail` (never returned by the user-facing `GET`, §16) — directly mirroring the existing precedent of truncating renderer stderr rather than exposing it raw (`app/api/creative/static-authoring/render/route.ts:56`).

| `error_code` | Meaning | Retryable (by user, new row) |
|---|---|---|
| `invalid_input_snapshot` | The frozen manifest failed re-validation at claim time (should be rare — it was valid at creation) | No — indicates a real bug, not a transient condition |
| `library_file_missing` | A referenced `LibraryFile` no longer resolves (deleted, cross-project, `deleted_at` set) at claim time | **Yes** — user can re-bind the scene asset and retry |
| `asset_unfetchable` | Presigned URL was generated but the object could not be fetched (network/storage-side issue) | Yes |
| `bundle_failed` | `@remotion/bundler`'s `bundle()` call failed | No (infra issue, needs operator attention) |
| `render_failed` | `renderMedia` threw (Chromium/composition-level failure) | Maybe, case-by-case — default to yes for MVP, since most causes are content-shape issues a retry after a fix would resolve |
| `upload_failed` | Render succeeded but the MinIO `PUT` failed | Yes — same input, just retry the upload leg (still creates a new row per §4.2's "no in-place resurrection" rule, keeping the model simple rather than adding a fifth "upload-only retry" state) |
| `lease_expired` / `max_attempts_exceeded` | Worker never reported back within the lease window, repeatedly (§4.1/§8) | Yes, user-initiated |
| `worker_unreachable` | Not a worker-reported code at all — reserved for the (rare) case Vercel's own claim/complete/fail routes detect an inconsistency | Case-by-case |

**Retryable vs. terminal is a product-facing hint, not a backend action.** Per §4/§13's own design, the backend never auto-retries a terminal row — "retryable" only means the future UI (out of scope here, §21's later slice) is justified in showing a "Tentar novamente" action for that `error_code`.

## 15. Idempotency (Task 14)

**RECOMMENDATION — client-supplied `idempotency_key`, scoped `UNIQUE(user_id, idempotency_key)`, optional.** The render-trigger UI action (future slice) generates one key (e.g. `crypto.randomUUID()`) per user *gesture* (one button click), and includes it on the `POST /api/video-drafts/:id/render` call. If the same key arrives twice (double-click, browser retry after a flaky network response the user never saw) the creation route treats a unique-constraint conflict as "return the existing row's id" rather than erroring — the user never sees two renders for one click.

**Two deliberate legitimate renders of the same `VideoDraft`** (the user renders, is unsatisfied, edits nothing, and clicks render again moments later) use **different** keys (a fresh one per gesture) and correctly create two independent rows — **no global dedup by `video_draft_id` is applied**, per the brief's own explicit instruction not to deduplicate intentional renders.

**Worker retry of the same execution** is not a client-idempotency concern at all — it's the `attempt`/lease mechanism (§4.1/§8), a completely different layer.

## 16. RLS / Authorization Model (Task 15)

**FACT restated (§2):** no team/membership model exists anywhere in this schema — ownership is uniformly `user_id = auth.uid()`. **RECOMMENDATION, conceptual only (no policy written this phase):**

- `SELECT`: `USING (auth.uid() = user_id)` — a user can only see their own execution rows, identical in shape to every other table in this schema.
- `INSERT`: **not granted to `authenticated` at all in the RLS sense** — creation happens exclusively through the future `POST /api/video-drafts/:id/render` route, which itself uses the normal per-request Supabase client (anon key + user session, same as `video-drafts/route.ts`) and can therefore rely on a standard `WITH CHECK (auth.uid() = user_id)` policy for the insert it performs on the user's behalf — this still keeps the browser from inserting a row directly with a forged `user_id`/`project_id`, since RLS enforces `auth.uid() = user_id` regardless of what the route's insert payload claims.
- `UPDATE` (status/claim/lease/output/error fields): **never granted to `authenticated` at all.** Every mutation after creation (claim, complete, fail, lease-reclaim) happens exclusively through the service-role-backed Postgres function/routes (§9/§10) — the browser has no code path, authorized or otherwise, that can `UPDATE` this table. This directly satisfies the brief's explicit requirement: *"Browser must never be allowed to arbitrarily set status, claimed_by, output paths, errors, lease fields."*
- `DELETE`: **not exposed** for MVP — no product need identified for user-initiated deletion of an execution history row (retention/cleanup, §20, is an operator/scheduled concern, not a user action).

**Worker mutation rights stay entirely server-side** — the worker itself never holds a Supabase credential of any kind (§10); all its writes happen by proxy through Vercel's service-role-backed routes.

## 17. Future API Contract (Task 16)

**No route is implemented this phase.** Conceptual boundary, informed by the existing `app/api/video-drafts/route.ts` and `app/api/creative/static-authoring/render/route.ts` conventions (auth-first, ownership-revalidated, structured JSON errors):

| Route | Caller | Auth | Purpose |
|---|---|---|---|
| `POST /api/video-drafts/:id/render` | Browser | Normal user session (`supabase.auth.getUser()`) | Authorize → fetch the `VideoDraft` (ownership-checked, same pattern as existing GET) → build the frozen `input_snapshot` (§6/§7, reusing `deriveVideoSceneAssetBindings`/`adaptVideoDraftToTimelineManifest` unmodified) → honor `idempotency_key` (§15) → `INSERT render_executions` (`status='queued'`) → return `{ executionId }`. |
| `GET /api/render-executions/:id` | Browser | Normal user session | Authorize (`.eq('user_id', user.id)`, same shape as every existing GET) → return a **user-safe projection**: `status`, `queued_at`/`claimed_at`/`completed_at`/`failed_at`, `error_code`/`error_message` (never `error_detail`), and — once `completed` — enough output reference for a preview/download action (not raw MinIO credentials; a fresh presigned read URL generated by this same route at response time, mirroring `createPresignedReadUrl`'s existing use elsewhere). Never returns `claimed_by`, `lease_expires_at`, or `input_snapshot`. |
| `POST /api/render-executions/claim` | **Worker only** | Shared worker secret (§10), not a Supabase session | Calls `claim_next_render_execution` (§8) via service-role → if a row was claimed, reconstructs `resolvedInput` (§7, reusing `prepareTimelineLibraryFileAssets`/`patchResolvedTimelineAssets` unmodified) → returns `{ executionId, resolvedInput }` (or an empty/"nothing to do" response). |
| `POST /api/render-executions/:id/complete` | **Worker only** | Shared worker secret | Body: output metadata (§5) → validates the row is still `claimed` by *a* worker (defense against a stale/duplicate report) → sets `status='completed'`. |
| `POST /api/render-executions/:id/fail` | **Worker only** | Shared worker secret | Body: `{ error_code, error_message, error_detail? }` → sets `status='failed'` (terminal for this row; §4.2 governs any retry). |

**The browser never talks to `:3456` directly** (given constraint, restated as a hard design invariant) — every worker-facing interaction is brokered through these Vercel routes, and every browser-facing interaction only ever reads/creates through the two user-session routes above.

## 18. Observability (Task 17)

**RECOMMENDATION, no new platform.** Sufficient for MVP debugging:
- Every worker log line includes `execution_id`, `worker_id` (the same value passed as `claimed_by`), and `attempt`.
- The worker logs render duration and upload duration as two separate measured spans (both already naturally available: `renderMedia`'s own timing, already measured by `infra/render-worker-runtime/server.mjs`'s `duration_ms`, and the new MinIO PUT's timing once §12's upload step exists).
- `output_size_bytes`, `error_code`, and the four lifecycle timestamps (§5) are already persisted on the row itself — the row *is* the audit trail; no separate logging platform is needed to reconstruct "what happened to execution X."
- **RECOMMENDATION against Prometheus/Grafana** for this phase's scope — single worker, low volume, no SLA yet defined that would need dashboards; the persisted row + container logs already answer "why did this render fail" without new infrastructure.

## 19. Retention / Cleanup (Task 18)

Not implemented this phase (per brief). Conceptual policy:
- **Scratch MP4s:** retained a fixed window (e.g. 7 days) after `completed_at`, or immediately deletable once superseded by an explicit Save (§13 — the object is *moved*, not merely referenced, so nothing is lost).
- **After explicit Save:** the scratch copy is redundant the moment `moveS3Object` succeeds; safe to delete immediately rather than waiting for the retention window.
- **Failed execution rows:** retained indefinitely for MVP (they are small, and are the only audit trail for "what went wrong" — Task 17); a future slice can add a retention window once real volume data exists to justify one.
- **Completed execution rows:** same — retained; cheap, and useful history ("what has this VideoDraft rendered before").
- **Superseded scratch output:** may be deleted once a newer completed execution exists for the same `video_draft_id`, but this is a policy decision for a later slice, not architecture this phase needs to lock in.

## 20. Concurrency (Task 19)

**FACT:** one worker today, intended concurrency 1. The schema and claim algorithm (§8) already make this safe to scale without redesign:
- `FOR UPDATE SKIP LOCKED` means two concurrent claim calls (from a future second worker replica) can never claim the same row — one gets it, the other's query simply skips it and returns "nothing available" (or the next row, if more than one is queued).
- `claimed_by` already distinguishes which specific worker instance holds a given row.
- Nothing in the schema encodes "exactly one worker exists" anywhere — concurrency is entirely a property of *how many containers poll the claim endpoint*, not of the data model. Scaling to N workers later requires zero schema change, exactly as the brief asks.
- This is explicitly **not** a render farm — there is no work-splitting, no priority, no routing; it is a plain claim queue that happens to tolerate more than one consumer safely.

## 21. Security Threat Check (Task 20)

| Threat | Mitigation in this design |
|---|---|
| Arbitrary URL fetch / SSRF via `ResolvedTimelineInput` | The worker never receives a client-authored `ResolvedTimelineInput` at all — it only ever receives one reconstructed server-side (§7/§17) from a frozen manifest whose asset refs are opaque `library_file` IDs, re-validated (ownership + `deleted_at IS NULL` + same-project) by the existing `prepareVideoDraftTimeline` boundary before any URL is ever generated. |
| Arbitrary storage path writes | The worker's MinIO credential (§12) is scoped to a single prefix convention (§11) it never receives as free-form input — the object key is always `users/{user_id}/renders/scratch/{render_execution_id}/output.mp4`, computed server-side/worker-side from values the worker cannot forge (its own claimed execution's own id/owning user). |
| Cross-Project execution creation | `POST /api/video-drafts/:id/render` re-derives `project_id` from the authoritative `VideoDraft` row (never trusts a client-supplied project id), exactly matching the existing `video-drafts` route's own established pattern (§2). |
| Browser forging `completed` state | RLS grants the browser no `UPDATE` path on this table at all (§16) — only the service-role-backed worker routes can transition status. |
| Leaked signed URLs | Never persisted anywhere (§6/§7); generated fresh, short-lived, server-side, at the two moments they're actually needed (claim-time input read, completed-time output read for the `GET` route). |
| Leaked MinIO credentials | Scoped to a single narrow prefix (§12), unrelated to any Supabase/domain-data credential — worst case is scratch-render-object tampering, not a domain data breach. |
| Service-role exposure | Confined to Vercel's server environment only, exactly matching the repo's one pre-existing precedent (§2) — never given to the worker, never given to the browser. |
| Worker accepting user-provided executable/template data | The worker's render tree (Phase 2I-A1) only ever consumes a `ResolvedTimelineInput` built from this application's own fixed, registered template components (`component-resolver.ts`'s closed `COMPONENT_BINDINGS` map) — no user-supplied code or arbitrary template ever reaches it. |
| Stale asset URLs | Addressed structurally by §7's claim-time-only resolution — there is no window in this design where a stale URL could be used, by construction, not by a lifecycle policy that could be misconfigured. |
| Internal MinIO hostname leakage to the browser | The browser never sees `http://minio:9000` or any MinIO credential — it only ever sees a Vercel-generated, short-lived presigned **read** URL for a completed execution's output (§17's `GET` route), the same pattern already used for every other asset read in this codebase. |

**No new mitigation needs to be built before implementation beyond what this design already structurally guarantees** — the threats above are closed by the shape of the contract itself (routes, RLS, credential scoping), not by a separate defensive layer bolted on afterward.

## 22. Implementation Slicing (Task 21)

Adjusted slightly from the brief's own sketch based on the dependency order this design actually requires (the claim contract is worthless without something that can create a row to claim, so schema+creation are combined into one first slice rather than split):

| Slice | Exact scope | Stop condition | Proof required |
|---|---|---|---|
| **2I-B1** | `render_executions` migration (§5) + `claim_next_render_execution` function (§8) + `POST /api/video-drafts/:id/render` (creation only, §17) + `GET /api/render-executions/:id` (§17) | No worker code touched; no MinIO involved yet | A row can be created and read back through the two routes, RLS confirmed to block cross-user reads, `idempotency_key` conflict behavior tested |
| **2I-B2** | Worker polling loop + `POST /api/render-executions/claim`/`complete`/`fail` (§17) wired into `infra/render-worker-runtime/server.mjs`; output still written only to local `/tmp` (no MinIO yet) | No UI change | A queued row is claimed, rendered (reusing the already-proven `renderResolvedTimelineInput` path unmodified), and marked `completed`, end-to-end, against a real Supabase.com database |
| **2I-B3** | MinIO scratch upload (§11/§12) — adds the worker's `@aws-sdk/client-s3` dependency (§12's disclosed consequence), object key convention, `/tmp` cleanup | No LibraryFile/ChannelPieceMedia code touched | A real object lands at the documented scratch path and `output_*` columns are populated correctly |
| **2I-B4** | Lease-expiry reclaim proof (kill a worker mid-claim, confirm the next poll cycle reclaims it) + `max_attempts_exceeded` sweep | No UI change | Demonstrated recovery from a simulated worker crash, not merely designed on paper |
| **2I-C** | Product UI "Renderizar vídeo" wired to `POST /api/video-drafts/:id/render` + status polling UI (idle/queued/claimed/completed/failed, per §4's UI-vs-persisted distinction) | `/videos`' fake button finally replaced | User-visible render request → status progression → completed output preview, in the real product surface |

Each slice is independently provable, matches the sequencing already used successfully across Phases 2G-A→D and 2H-A→C (adapter → real proof → integration → UI, each gated on the previous one's green baseline).

## 23. Risks / Open Questions

| # | Item | Status |
|---|---|---|
| 1 | Heartbeat/lease-renewal for renders that grow toward the 300s lease window | **OPEN QUESTION**, explicitly deferred (§8) — not needed at today's 37-48s durations, but Phase 2I0 §17's long-form concern still applies here. |
| 2 | Exact retention window for scratch MP4s and terminal execution rows | **OPEN QUESTION**, deferred to §19/§20 — no volume data yet to size a policy against. |
| 3 | Whether `upload_failed` should be a fifth persisted state (retry-the-upload-only) instead of always requiring a whole new execution row | **OPEN QUESTION** — this phase chose the simpler four-state model (§4); revisit only if upload failures prove common enough in practice to justify the extra state. |
| 4 | MinIO bucket/prefix-scoped credential mechanics (exact IAM-policy syntax for the chosen provider) | **OPEN QUESTION** — this phase establishes the *prefix convention* and *credential model* (§11/§12); the concrete policy JSON is an implementation-slice (2I-B3) detail, not an architecture decision. |
| 5 | Worker→Vercel shared-secret rotation mechanics | **OPEN QUESTION** — a manual env-var rotation is sufficient for a single-worker MVP; not designed further here. |

## 24. Final Recommendation

**`READY_FOR_RENDER_EXECUTION_IMPLEMENTATION`**

Every required decision (Tasks 1-21) resolves to a concrete, evidence-grounded answer, each one either directly reusing an existing repo pattern (`organize_channel_piece_media`'s locking/error-code style for the claim function, `moveS3Object` for the eventual Save boundary, `video-drafts/route.ts`'s auth/ownership shape for the new routes, the universal `TEXT + CHECK` status convention) or explicitly justified against the given infrastructure facts (the MinIO credential choice in particular is close to forced by the stated network topology, not a preference). No Redis, queue broker, Kubernetes, generic job framework, or `generation_tasks` reuse is required. The one genuinely new piece of infrastructure this design introduces — a single Postgres claim function plus four small Vercel routes — is deliberately the smallest mechanism that satisfies every constraint in the brief (no browser↔worker direct contact, no persisted secrets, no forged status, safe multi-worker future, deterministic input).

## 25. Closure Report

- **Files changed this phase:** exactly one — this document.
- **Commit:** recorded separately after this document is written (see repository history for the exact SHA of the `docs:` commit closing Phase 2I-B0).
- **Key repo evidence inspected:** `scripts/002_create_drafts_tables.sql`, `scripts/005_create_generation_tasks.sql`, `scripts/015_create_library_files.sql`, `scripts/020_create_productions.sql`, `scripts/021_create_publication_entities.sql`, `scripts/024_channel_piece_media_organization.sql`, `lib/supabase/server.ts`, `lib/storage/s3.ts`, `app/api/video-drafts/route.ts`, `app/api/nanobanana/{generate,callback,status/[taskId]}/route.ts`, `app/api/creative/static-authoring/render/route.ts`, `lib/creative/integration/prepare-video-draft-timeline.ts`, `lib/creative/timeline-adapter/prepare-scene-assets.ts`, `infra/render-worker-runtime/server.mjs` and `README.md`, plus `PHASE_2I0_VIDEO_RENDER_EXECUTION_ARCHITECTURE.md`.
- **Chosen execution model:** persistent `render_executions` table, four states (`queued/claimed/completed/failed`), claim-based worker pull via polling.
- **Chosen claim/lease model:** single atomic `claim_next_render_execution` Postgres function (`FOR UPDATE SKIP LOCKED`), modeled on the existing CPM RPC pattern; 300s fixed lease, no heartbeat for MVP.
- **Chosen worker auth model:** worker holds only a narrow shared secret to call Vercel-only API routes (§10, Option 2) — never a Supabase service-role key, never a Supabase session.
- **Chosen MinIO upload model:** worker holds a least-privilege MinIO credential scoped to a `users/{user_id}/renders/scratch/{render_execution_id}/` prefix and uploads directly over the internal `content-studio-backplane` network (§11, Option B) — not a Vercel-issued presigned URL.
- **Proposed schema summary:** `render_executions` — 21 columns (§5), no new enum types, one self-referencing FK (`retry_of_execution_id`), one optional idempotency unique constraint.
- **Implementation slices:** 2I-B1 (schema + creation/read routes) → 2I-B2 (worker claim/complete/fail wiring) → 2I-B3 (MinIO scratch upload) → 2I-B4 (crash-recovery proof) → 2I-C (product UI).
- **Unresolved risks:** heartbeat-for-long-renders, retention windows, upload-retry granularity, exact MinIO IAM policy syntax, secret-rotation mechanics — all explicitly deferred, none blocking.
- **Final verdict:** **`READY_FOR_RENDER_EXECUTION_IMPLEMENTATION`**
