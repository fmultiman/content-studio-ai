# REVIEW_STALE_RUNNING_RECOVERY_V1

## Status

- Mission: FUTURE-046. Baseline: `origin/main` `1cf66354c18dbbbec1377cd841cbc0621327d016` (FUTURE-042 complete, Production on that SHA).
- Branch: `fix/review-stale-running-recovery-v1`.
- Schema: **no migration**. New infrastructure (cron / reaper / RPC): **none**. Paid provider calls: **0**.
- Behavior change: a later explicit Review request recovers an abandoned `pending`/`running` Review into a truthful terminal failure, then proceeds normally. History GET is unchanged and read-only.

## Phase 0 — factual audit

### Lifecycle (Image and Video share one table and one repository)

```
insertPendingReview   status=pending   created_at = updated_at = now (INSERT; the updated_at trigger is BEFORE UPDATE only)
markReviewRunning     status=running   started_at=now           (guard: status = pending)
markReviewCompleted   status=completed completed_at=now         (guard: status = running)
markReviewFailed      status=failed    failed_at=now, failure_code, failure_details (guard: status in pending|running)
```

DB guards (`scripts/054`, `058`, `060`): `guard_media_review_lifecycle` allows `pending→running|failed`, `running→completed|failed`, and raises `MEDIA_REVIEW_TERMINAL_IMMUTABLE` for any update of a terminal row; subject columns are immutable; `media_reviews_failed_requires_code` is the only rule on failure (`failure_code text`, **no value list**). `media_reviews_updated_at` stamps `updated_at` on every UPDATE.

Order inside a request: (Video only) source → artifact → authorized media; `findReviewByClientRequest` (replay) → `findActive…` → `insertPendingReview` → credential → `markReviewRunning` → provider → `markReviewCompleted` / `markReviewFailed`.

### The eight questions

| # | Question | Answer |
|---|---|---|
| 1 | Reliable last-progress timestamp | `media_reviews.updated_at`. |
| 2 | Is `updated_at` changed only by lifecycle updates? | Yes. `repository.ts` is the only writer of `media_reviews` (insert, running, completed, failed); the trigger stamps it on each. Nothing else touches the table. `GET` history issues SELECTs only. |
| 3 | Heartbeat? | None. None is needed: the in-flight window is bounded by the provider envelope below. |
| 4 | Maximum legitimate wall-clock per path | See envelope table. Longest: Gemini video, ≤ 1245 s (20.75 min) by code. |
| 5 | Can a live request outlive the UI's ~15 min warning? | **By code, yes** (1245 s > 900 s). In practice Vercel kills the video route at `maxDuration = 300`, which is itself the most likely way a Review gets abandoned. The old 15 min number was shorter than the code envelope, so it could not be used as a recovery threshold. |
| 6 | Same stale-lock risk for Image? | **Yes.** Same table and lifecycle; `media_reviews_active_attempt_key` (`UNIQUE (image_attempt_id) WHERE status IN ('pending','running')`) blocks the Attempt forever. The Image route has no `maxDuration` (platform default). |
| 7 | What prevents a second Review? | Video: `media_reviews_active_video_artifact_key` — `UNIQUE (media_artifact_id) WHERE subject_media_type='video' AND status IN ('pending','running')` (060). Image: `media_reviews_active_attempt_key` — `UNIQUE (image_attempt_id) WHERE status IN ('pending','running')` (054). Both are partial; terminal rows never block. |
| 8 | Can recovery use the existing schema? | **Yes.** `updated_at` is the clock, `failure_code` is free text, `pending|running → failed` is an allowed transition. Migration: none. |

### Provider envelopes (from the executing constants)

| Path | Bound | Source |
|---|---|---|
| OpenAI Image | 60 s | `OPENAI_REVIEW_DEFAULT_TIMEOUT_MS` |
| Gemini Image | ~120 s | inline bytes + `GEMINI_GENERATE_TIMEOUT_MS` |
| Gemini Video upload | ≤ 900 s | 600 s total deadline checked between chunks + one last 300 s chunk request |
| Gemini Video processing | ≤ 210 s | 180 s wait deadline + one 30 s status check |
| Gemini Video generate | 120 s | `GEMINI_GENERATE_TIMEOUT_MS` |
| Gemini Video cleanup | 15 s | `GEMINI_CLEANUP_TIMEOUT_MS` |
| **Gemini Video total** | **≤ 1245 s (20.75 min)** | sum |

The pre-insert Video work (source resolution, artifact registration, hashing) runs before the row exists and is outside the window.

## Policy

`lib/reviews/stale-policy.ts` — `REVIEW_STALE_AFTER_MS = 30 min`.

- Greater than the longest envelope (20.75 min) with ≈ 9 min (≈ 44 %) margin; it follows the **code** envelope, not the Vercel cap, so it stays safe if the cap is raised or the service runs elsewhere.
- Pinned by `stale-policy.test.ts`: the test recomputes the envelopes from the real provider constants and fails if the threshold is not ≥ longest + 5 min. Raising a provider timeout without revisiting the policy fails CI.
- The Video Review panel now reads this same number (`VIDEO_REVIEW_STALE_MS = REVIEW_STALE_AFTER_MS`), so the UI never calls a Review "interrupted" earlier than the backend will recover it.
- Eligible for recovery only when: `status IN ('pending','running')` **and** `updated_at < now − 30 min` **and** still non-terminal at the moment of the guarded UPDATE. Unreadable `updated_at` is treated as not stale (fail safe).

## Architecture chosen: request-time recovery (no scheduler)

```
POST (explicit Review request)
  -> clientRequestId replay        (unchanged; returns BEFORE any recovery)
  -> findActive...                 (existing)
       -> none                     : insert as before
       -> active, not stale        : 409 REVIEW_IN_PROGRESS            (unchanged)
       -> active, stale            : guarded UPDATE -> failed
            -> recovered / settled : continue to the normal insert
            -> still in flight     : 409 REVIEW_IN_PROGRESS
  -> insertPendingReview           (partial unique index = final authority; 23505 -> 409)
```

Why no cron/reaper: the stale lock only matters at the instant a user asks for a new Review, and that request can do the repair atomically. There is no idle mutation, no new scheduler surface and no new auth surface. A periodic collector would only matter for dashboards that count in-flight rows; none exist.

`lib/reviews/stale-recovery.ts` is shared by `service.ts` (Image) and `video-service.ts` (Video). `repository.ts` gains `markReviewStaleFailed` and `findReviewById`.

### Exact guarded predicate

```sql
UPDATE media_reviews
   SET status = 'failed', failure_code = 'execution_stale',
       failure_details = { message, recovery: { reason, previousStatus, staleAgeMs, thresholdMs } },
       failed_at = now()
 WHERE id = $id AND user_id = $user
   AND status IN ('pending','running')
   AND updated_at < $cutoff            -- now − 30 min
RETURNING ...                          -- .maybeSingle(): zero rows is a normal outcome
```

### Failure representation

`failure_code = 'execution_stale'` (lowercase like every persisted code; normalized by `toReviewRecord`, added to `ReviewFailureV1Schema`). Message: *"The previous Review execution was interrupted and did not complete."* It does not claim Gemini/OpenAI failed, the media was invalid, or the user cancelled. UI wording: *"A revisão anterior foi interrompida e não foi concluída. Você pode revisar novamente."*

### Concurrency

- The UPDATE re-evaluates `status` and `updated_at` under the row lock (READ COMMITTED), so a Review that completed, or merely advanced `pending→running`, between the SELECT and the UPDATE matches zero rows and is untouched. On zero rows the row is re-read: terminal ⇒ `settled` (proceed), still in flight ⇒ 409.
- Only one of N concurrent recoveries gets a row back; the rest settle. Exactly one log line is written.
- Two concurrent *new* requests may both recover/settle and both insert; the partial unique index admits one, the other gets 23505 → **409 REVIEW_IN_PROGRESS**. Image previously mapped a lost active-index race to 503; it now maps like Video (shared coherence fix).
- The zombie process's own terminal writes are guarded (`eq status running` / `in pending,running`) and match nothing after recovery, so a recovered Review is never resurrected or overwritten.
- Indexes are untouched.

### Idempotency

| Case | Behavior |
|---|---|
| Same `clientRequestId`, terminal | replayed, unchanged |
| Same `clientRequestId`, still `pending`/`running` (even if old) | replayed **without** reaping — an ambiguous-network retry never kills a valid execution |
| Older stale execution, **new** `clientRequestId` | recovered, new Review created |
| Concurrent new ids | at most one in flight |

### Provider boundary and observability

Recovery runs before the insert and any provider call. If recovery errors → `503 REVIEW_STORE_UNAVAILABLE`, no insert, no provider call. If recovery succeeds and a later step fails, the database keeps the truth (recovered failure + the new Review's own outcome); nothing is retried automatically. One `console.warn('[reviews] stale in-flight Review recovered', { reviewId, mediaType, previousStatus, staleAgeMs, outcome })` per actual recovery — no keys, payloads or URLs. No `provider_usage_events` (FUTURE-043 is separate).

### History GET

Unchanged and read-only. `getVideoReviewHistory` / `getImageReviewHistory` never import the recovery module; a test runs history with a client whose write methods throw and a stale row present, and asserts no write and an unchanged row.

## UI

Copy only: the stale note now reads the shared 30-minute number and says a new Review will close the interrupted one; `execution_stale` has its own wording. No layout change, no force-unlock or admin action.

## Tests

| File | Proves |
|---|---|
| `stale-policy.test.ts` | threshold ≥ envelope(real constants) + 5 min; UI uses the same number; boundaries; terminal never stale; fail-safe on bad timestamps |
| `stale-recovery-pglite.test.ts` | **real migrations 054–060 in PGlite**, repository SQL via a thin builder→SQL shim: fresh pending/running not reaped; stale pending/running recovered with truthful metadata; completed/failed untouched (xmin unchanged); completed-during-race not overwritten; progress-during-race not reaped; concurrent recoveries idempotent; owner scope; unique in-flight index authoritative (video + image); zombie writes inert; CHECK/trigger invariants; Video and Image |
| `stale-recovery-video-service.test.ts` | service flow: recover→create, fresh 409, same-id replay, terminal rows untouched, recovery failure fails closed with 0 provider calls, missing credential, provider error, concurrent requests ≤ 1 in flight, competitor wins, history read-only |
| `stale-recovery-image-service.test.ts` | the same matrix for Image over the real repository, plus active-index race ⇒ 409 (was 503) |
| `video-review-presentation` / `video-review-control` | wording, stale note |

PGlite is a single session: it proves predicate/index semantics and sequentially interleaved races, not cross-connection locking, which is PostgreSQL's documented READ COMMITTED re-check of the WHERE clause on the locked row.

## Not done (by design)

No cron, no RPC, no migration, no backfill, no Production cleanup (no stale row exists), no manual unlock/cancel, no heartbeat, no change to FUTURE-040 / 043 / 045, no worker changes.

## Residual gaps

- A replay (same `clientRequestId`) of an old still-`pending`/`running` row returns HTTP 200 with that in-flight record; the panel's success toast text assumes completion. Pre-existing; a user who retries with a **new** click gets a new id and recovery.
- The recovery threshold is 30 min: a Review killed by Vercel's 300 s cap stays blocked for up to 30 min. Shortening it safely would require a heartbeat or a platform-aware bound — a separate mission.
- The panel computes age from `createdAt`; the backend uses `updated_at` (a few seconds later for `running`), so in the final seconds around the threshold a click can still get a 409 and the next poll fixes the display.
- Clock: the cutoff is computed from the app clock; skew vs the database clock is orders of magnitude below the 9 min margin.
