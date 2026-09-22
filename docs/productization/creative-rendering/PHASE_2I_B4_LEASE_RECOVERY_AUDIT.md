# Phase 2I-B4.0 — Lease Recovery & Stale-Worker Fencing Audit

**Nature:** Read-only architecture/concurrency audit, code-first (not doc-first). No migration applied, no route deployed, no remote infrastructure touched. Findings are traced to exact file/line evidence, not inferred from B0–B3 documentation.

**Context:** Phase 2I-B3.1 already proved a real positive (`queued → claimed → render → MinIO scratch → complete → completed`) and a real negative (`upload fails → OUTPUT_UPLOAD_FAILED → failed`, never `completed`) end-to-end in production at commit `74e56874ba1cf918b7933bca597cb2347891e166`. This audit answers a different, narrower question before B4's crash/recovery proof is attempted: **can a stale (already-reclaimed) attempt still mutate an execution's terminal state?**

## 1. Current Claim Ownership Model (Task 1)

Traced from `scripts/031_create_render_executions.sql: claim_next_render_execution` (unmodified since B1) and `app/api/render-executions/claim/route.ts` (unmodified since B2):

```sql
UPDATE render_executions
SET status = 'claimed',
    claimed_by = p_worker_id,
    claimed_at = COALESCE(claimed_at, NOW()),
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
    attempt = CASE WHEN status = 'claimed' THEN attempt + 1 ELSE attempt END,
    updated_at = NOW()
WHERE id = ( SELECT id FROM render_executions
             WHERE (status = 'queued')
                OR (status = 'claimed' AND lease_expires_at < NOW() AND attempt < max_attempts)
             ORDER BY queued_at ASC FOR UPDATE SKIP LOCKED LIMIT 1 )
RETURNING * INTO v_row;
```

**What identifies "one claim attempt":** the pair `(status = 'claimed', attempt = N)` on the row, established atomically by this single `UPDATE ... WHERE id = (SELECT ...)` statement. `attempt` increments by exactly 1 on every reclaim (a fresh `queued` row keeps `attempt = 1`; a stale-lease reclaim of an already-`claimed` row increments it). `claimed_by` is overwritten unconditionally on every claim (first or reclaim) to whatever `p_worker_id` the caller supplied — it is **not** part of the eligibility `WHERE` clause and does not gate anything downstream.

The claim route returns `attempt: execution.attempt` to the worker (`app/api/render-executions/claim/route.ts:150`) and, as of this audit, also `userId` (B3 addition). **This `attempt` value is the only per-claim token the protocol currently produces** — there is no separate opaque claim token, no nonce, nothing beyond the row's own integer counter.

## 2. Complete Mutation Model (Task 1) — Exact Code

`app/api/render-executions/[id]/complete/route.ts`, traced end-to-end:

1. `verifyWorkerAuth` — validates the shared worker secret only. Says nothing about *which* claim attempt is calling.
2. Loads the row: `SELECT id, user_id, status FROM render_executions WHERE id = :id` — **`attempt` and `claimed_by` are not even selected.**
3. Validates `execution.status === 'claimed'` (409 otherwise).
4. Validates the worker-submitted `outputBucket`/`outputStoragePath` exactly match `buildScratchOutputTarget({ userId, executionId })` (B3 hardening — orthogonal to this audit; it fences *which object*, not *which attempt*).
5. Writes: `UPDATE render_executions SET status='completed', ... WHERE id = :id AND status = 'claimed'`.

**The request body accepted by this route is** `{ outputBucket, outputStoragePath, outputSizeBytes, outputDurationMs, outputMimeType? }` — confirmed by reading the full parameter-parsing block (lines 85-89). **There is no `attempt` field, no `worker_id`/`claimed_by` field, anywhere in the request contract.**

**Answer to Task 1's explicit questions:**
- Does `/complete` require the CURRENT attempt number? **No.**
- Does the worker send `attempt` back? **No** — `infra/render-worker-runtime/coordinator.mjs: reportCompleteWithRetry` sends exactly `{ outputBucket, outputStoragePath, outputSizeBytes, outputDurationMs, outputMimeType }` (line ~204), confirmed by grep — no `attempt` key anywhere in that object.
- Does `claimed_by` alone act as fencing? **No — it is never read by this route at all** (not present in the `SELECT`, not present in any comparison).
- **The only fencing this route has is `status = 'claimed'`**, enforced twice (an application-level `if` at step 3, and the `.eq('status','claimed')` atomic guard on the `UPDATE` at step 5 — the second one closes the TOCTOU gap between the read and the write for concurrent completions, but does nothing about attempt identity).

## 3. Fail Mutation Model (Task 1) — Exact Code

`app/api/render-executions/[id]/fail/route.ts`, traced end-to-end:

1. `verifyWorkerAuth` — same as complete.
2. Loads the row: `SELECT id, status, attempt, max_attempts FROM render_executions WHERE id = :id` — **`attempt` is selected this time, but only to compute the response field `isTerminal = attempt >= max_attempts` (line 138) — it is never compared against anything the caller sent.**
3. Validates `execution.status === 'claimed'` (409 otherwise) — identical shape to complete.
4. Writes: `UPDATE render_executions SET status='failed', ... WHERE id = :id AND status = 'claimed'`.

**Request body:** `{ errorCode, errorMessage?, errorDetail? }` — confirmed by reading the full parsing block (lines 70-90). No `attempt`, no `worker_id`/`claimed_by`.

**Answer to Task 1's explicit questions for `/fail`:** identical to `/complete` — no attempt requirement, no `claimed_by` check, fencing is `status = 'claimed'` only.

## 4. Stale-Attempt Race Analysis (Primary Question)

**Confirmed: YES, the race exists**, proven directly from the code above, not merely hypothesized:

```
t0  Worker A claims execution E.        status='claimed', attempt=1, claimed_by='A'
t1  Worker A begins render, then stalls (network partition / long GC pause / VPS
    hiccup) — it is NOT dead, just unresponsive for longer than the lease.
t2  lease_expires_at passes.
t3  Worker B (or a restarted Worker A — see §5) polls /claim.
    claim_next_render_execution reclaims E:  attempt=2, claimed_by='B' (or 'A' again),
    lease_expires_at extended. status remains 'claimed'.
t4  Worker B starts rendering E's attempt 2.
t5  Worker A's stalled request finally resolves. Worker A now calls
    POST /api/render-executions/E/fail  (or /complete, if it also finished a
    render+upload before stalling — see §6 for the output-key implication).
t6  The /fail (or /complete) route:
      - verifyWorkerAuth passes (Worker A still holds the one shared secret —
        there is only ONE shared secret for the whole fleet, not a per-attempt one).
      - SELECT ... WHERE id = E  →  status IS STILL 'claimed' (Worker B hasn't
        finished yet) — the route has no way to know this 'claimed' belongs to
        attempt 2, not attempt 1, because it never looks at `attempt` for fencing.
      - UPDATE ... WHERE id = E AND status = 'claimed'  →  MATCHES (1 row
        affected) → succeeds.
t7  Execution E is now terminally 'failed' (or wrongly 'completed'), attributed
    to Worker A's STALE attempt 1, while Worker B's live attempt 2 is still
    actively rendering/uploading, completely unaware its work has just been
    invalidated out from under it.
t8  When Worker B eventually finishes and calls its own /complete (or /fail),
    the route's status check now sees 'failed' (or 'completed') — NOT 'claimed'
    — and rejects with 409 INVALID_STATUS_TRANSITION. Worker B's real,
    possibly-successful work is silently discarded from the database's point
    of view (a real MinIO object may exist with no row correctly describing it,
    or the row may show a stale/wrong error from attempt 1 while attempt 2 was
    the one actually doing meaningful work).
```

This is not a theoretical corner case requiring adversarial input — it requires only ordinary infrastructure behavior already anticipated by this system's own design (B0 §4.1's entire reason for having lease expiry and reclaim is that a claimed worker can become unresponsive and later "wake up" — the protocol explicitly designs for exactly the t1→t5 gap above, but the mutation endpoints do not defend against the woken-up worker still being able to act).

## 5. Same-Stable-Worker-ID Analysis (Task 2)

Production currently runs `CONTENT_STUDIO_RENDER_WORKER_ID=vps-render-worker-01` (or equivalent — the value is intentionally stable across restarts, per `coordinator.mjs`'s own env-var default logic and the operator runbook).

Scenario: attempt 1 claims (`claimed_by='vps-render-worker-01'`), stalls; the same physical worker process restarts and reclaims the same row (`attempt=2, claimed_by='vps-render-worker-01'` — **identical string, since the ID is stable**); the old attempt-1 process (if it is a zombie process rather than a truly killed one — e.g. a hung child process not reaped, or a request already in flight against the control plane before the restart) later completes and calls `/complete`.

**Because `claimed_by` is never read by `/complete` or `/fail` at all (§2/§3), this scenario is exactly as vulnerable as the different-worker-ID case (§6) — the stable worker ID neither causes nor prevents the race.** A reviewer might intuitively expect "well, `claimed_by` is the same string both times, so some equality check would still (wrongly) pass" — but there is no such check to even wrongly pass; the vulnerability is unconditional. **Confirmed, not assumed: `claimed_by` equality is not part of the authorization decision anywhere in this codebase.**

## 6. Different-Worker-ID Analysis (Task 3)

Scenario: attempt 1 `claimed_by='worker-A'`, attempt 2 (after reclaim) `claimed_by='worker-B'`. Can worker-A mutate after reclaim?

**Yes — proven identically to §4/§5.** Worker-A's only credential is the single shared `CONTENT_STUDIO_RENDER_WORKER_SECRET` (`verifyWorkerAuth`, `lib/render-execution/worker-auth.ts`) — this secret is **fleet-wide, not per-worker and not per-claim**. Any holder of that one secret can call `/complete` or `/fail` for **any** execution row currently in `status='claimed'`, regardless of who claimed it or which attempt is current. There is no code path anywhere that ties a specific HTTP request back to a specific claim event.

## 7. Deterministic Output-Key Race (Task 5) — The Hardest Case

Both attempt 1 and attempt 2 compute the **same** scratch key (`lib/render-execution/scratch-output-target.ts: buildScratchOutputKey({ userId, executionId })` — keyed by `executionId` only, not by `attempt`; this was an intentional B3 decision: "same execution retried produces the SAME key," §14 of the B3 doc). If both attempts actually reach the upload step:

- Attempt 1 uploads → object exists at the shared key with attempt-1's bytes.
- Attempt 2 (after reclaim) uploads → **overwrites the same object** with attempt-2's bytes (S3/MinIO `PutObject` to an existing key is a plain overwrite, not a versioned write, in this configuration).
- Whichever attempt's `/complete` call reaches the database **first** (not necessarily whichever uploaded first — a slow database round-trip vs. a fast one can reorder this independently of upload order) wins the row; the other's `/complete` call is rejected by the `status='claimed'` guard (§4's t8).
- **Residual risk, distinct from the DB-fencing gap this audit is centered on:** even after the attempt-fencing fix in §10 closes the *database* race, the *physical object* can still be overwritten by whichever attempt's `PutObject` lands last in real time, independent of which attempt's `/complete` call the database accepted. In practice this is bounded and low-severity here: the coordinator only calls `/complete` **after its own successful upload** (`coordinator.mjs: runOneCycle`, the upload→complete ordering `shouldCallComplete` gate), so whichever attempt's database row transition succeeds is *by construction* an attempt that itself completed a real upload to the shared key — the row's metadata (`output_size_bytes`, `output_duration_ms`) will always correctly describe *some* real successful render of the same `VideoDraft` snapshot (the frozen input is identical for both attempts of the same execution — B0 §6's snapshot immutability), just possibly not the temporally-last physical object write. This is a pre-existing, already-accepted characteristic of the "safe to overwrite the same key on retry" design (B3 §11/§14) and is **not** a new problem the attempt-fencing fix needs to additionally solve — it is called out here for completeness because Task 5 asked for it explicitly, not because it changes the verdict.

## 8. Fail Race (Task 6)

**Yes — proven directly, and this is the more severe half of the race** (worse than §7's complete-vs-complete case): attempt 2 can be **actively, successfully rendering** — not yet even at the upload step — when attempt 1 wakes and calls `/fail`. `/fail`'s only precondition is `status='claimed'` (true, since attempt 2 currently holds it) — there is no work attempt 2 needs to have done wrong; attempt 1's mere existence and eventual wakeup is sufficient. This can terminally fail an execution that would otherwise have gone on to succeed, with zero attacker action and zero attempt-2 malfunction — purely a byproduct of §4's ordinary infrastructure-flakiness scenario.

## 9. Lease-Expiry Semantics (Task 4) — Confirmed From SQL

- **Eligibility for reclaim:** `status = 'queued'` OR (`status = 'claimed' AND lease_expires_at < NOW() AND attempt < max_attempts`) — exact `WHERE` clause, `scripts/031...sql` line 215-216.
- **`attempt` increments:** only on reclaim of an already-`'claimed'` row (`CASE WHEN status = 'claimed' THEN attempt + 1 ELSE attempt END`) — a fresh `queued→claimed` first claim leaves `attempt` at its `DEFAULT 1`.
- **`claimed_at` updates:** `COALESCE(claimed_at, NOW())` — set once, preserved across reclaims (so "time since the row was first claimed" stays visible even after N reclaims).
- **`lease_expires_at` updates:** unconditionally overwritten to `NOW() + make_interval(secs => p_lease_seconds)` on every claim, first or reclaim.
- **Output/error fields on reclaim:** **not touched at all** by `claim_next_render_execution` — `output_bucket`, `output_storage_path`, `error_code`, etc. are only ever written by `/complete`/`/fail`, never by the claim function. A reclaim does not clear or preserve them because it never references them; they simply remain whatever a *previous, different* execution row would have had (irrelevant here since these are per-row, and a row is reclaimed, not recreated) — in practice, for a row that has never reached `/complete`/`/fail` before, they are still `NULL` at reclaim time regardless.
- **300-second contract confirmed:** the claim route's `DEFAULT_LEASE_SECONDS = 300` (`app/api/render-executions/claim/route.ts`), and the coordinator explicitly requests `leaseSeconds: 300` on every claim call (`coordinator.mjs: claimExecution`) — matches B0 §4/§8's stated MVP value, unchanged through B1/B2/B3.
- **Terminal states confirmed non-reclaimable:** the eligibility `WHERE` clause only ever matches `'queued'` or `'claimed'` — `'completed'` and `'failed'` rows can never be selected by `claim_next_render_execution`, confirmed structurally (not merely by convention) by the SQL itself.

## 10. Fencing Verdict

**`STALE_WORKER_FENCING_REQUIRED`**

Current claim ownership is proven, by direct code inspection (not inference from documentation) to be insufficient: `/complete` and `/fail` authorize any request bearing the one fleet-wide worker secret and a row currently in `status='claimed'`, with **zero** dependency on which specific claim `attempt` — or even which `worker_id` — issued the request. This is true regardless of whether the stale and current attempts share a stable worker ID (§5) or not (§6), and applies symmetrically to both the completion race (§7) and the (more severe, action-free) failure race (§8). Deploying B4's crash/recovery proof against the current protocol would not merely fail to demonstrate safety — it risks demonstrating the opposite, corrupting the very execution this document is auditing before recovery.

## 11. Minimal Correction (Design Only — Not Implemented This Mission)

**Smallest sufficient fix: echo-and-verify the existing `attempt` integer.** No new table, no claim token/nonce, no Redis, no broker — reuses the column that already exists for exactly this purpose (B0 §4.1's own stated intent for `attempt`, just never wired into the two mutation endpoints).

### 11.1 Server-side (`/complete`, `/fail`)

Both routes gain one new required request field: `attempt: number`. Both routes' existing `SELECT` already includes (`/fail`) or needs to add (`/complete`) `attempt`. Both routes add one check, immediately after the existing `status === 'claimed'` check and before any further processing:

```ts
if (execution.attempt !== body.attempt) {
  return NextResponse.json(
    { error: `Stale attempt: execution is now on attempt ${execution.attempt}, request was for attempt ${body.attempt}.`,
      code: 'STALE_ATTEMPT', currentAttempt: execution.attempt },
    { status: 409 },
  )
}
```

And — critically, to close the TOCTOU gap between this `SELECT` and the eventual `UPDATE` the exact same way the existing `status='claimed'` atomicity guard already does — the `UPDATE`'s own `WHERE` clause gains `.eq('attempt', body.attempt)` alongside the existing `.eq('id', id).eq('status', 'claimed')`. This means even if attempt 2 reclaims in the exact instant between attempt 1's `SELECT` and `UPDATE`, the `UPDATE` simply matches zero rows (not a race-losing partial write) and the route returns `COMPLETE_RECORD_FAILED`/`FAIL_RECORD_FAILED` rather than silently succeeding — the same defense-in-depth pattern already used for `status`.

### 11.2 Worker-side (`coordinator.mjs`)

`runOneCycle()` already destructures `attempt` from the claim response (`const { executionId, userId, attempt, resolvedInput, warnings } = claim`) — it is simply never forwarded. Both call sites need one added field:
- `reportFail(executionId, attempt, errorCode, errorMessage, errorDetail)` → body becomes `{ attempt, errorCode, errorMessage, errorDetail }`.
- `reportCompleteWithRetry(executionId, attempt, outputMeta)` → body becomes `{ attempt, ...outputMeta }`.

No other coordinator logic changes — `attempt` is already immutable for the lifetime of one `runOneCycle()` call (a single claim owns it for that cycle's duration).

### 11.3 Explicitly NOT part of the minimal fix

- **No `claimed_by` check added.** `attempt` alone is already a strictly monotonic, per-row, reclaim-sensitive counter — adding a `claimed_by` comparison on top would be redundant (§5 already shows a stable worker ID doesn't weaken the `attempt`-based fix) and would only reintroduce exactly the stable-ID ambiguity `attempt` was chosen specifically to avoid.
- **No `lease_expires_at > NOW()` requirement added to `/complete`/`/fail`.** See §12 — this would be actively harmful.
- **No separate `render_execution_attempts` table.** The existing integer column is sufficient; B0's own schema design already anticipated this exact use (§4.1: "attempt... needed to bound infra retries **and distinguish a first claim from a reclaimed one**" — the "distinguish" half was simply never wired into the two routes that needed it).

## 12. The Lease-Expiry Question, Answered Explicitly (Task "Important Lease Question")

**Decision: `/complete` and `/fail` must NOT additionally require `lease_expires_at > NOW()`.** The `attempt`-echo fix in §11 already correctly implements the intended semantics without this addition, and adding it would introduce a real regression:

- **What `attempt`-matching already gets right:** as long as no *other* claim has actually reclaimed the row, `attempt` never changes — so the original attempt's `/complete`/`/fail` call, arriving even long after its nominal lease "expired," is still the **current, sole, legitimate** owner of the row and is correctly accepted. This is exactly right for a single-worker deployment (B0 §20's stated current topology) with **no heartbeat mechanism** (confirmed absent — B0 §8's own explicit "not needed for MVP" and this codebase's confirmed lack of any renewal call): a render that legitimately takes 310 seconds must not be punished merely because nothing else happened to reclaim it in the meantime.
- **What an additional `lease_expires_at > NOW()` check would break:** it would reject that same legitimate 310-second completion even though **no other attempt ever contested the row** — a false negative with no corresponding safety benefit, since `attempt`-matching already rejects every case where a contest *did* happen. The lease timestamp is correctly used as the *reclaim eligibility* threshold (§9, inside `claim_next_render_execution`'s own `WHERE` clause) — it was never meant to be re-checked as a second, independent authorization gate on the mutation endpoints, and doing so would conflate "this row's original claim is nominally old" with "this row's original claim has actually been superseded," which are different facts. Only `attempt` observably distinguishes the latter.

## 13. Test Plan (Task 8) — Specified, Not Implemented This Mission

Following the existing `lib/render-execution/__tests__/` convention (pure logic + static route-wiring proofs, matching how B2/B3's own `worker-coordination-contracts.test.ts`/`complete-route-output-authority.test.ts` are structured — no live DB in this repo's test suite):

1. **Attempt-mismatch rejection (pure logic):** a new `isCurrentAttempt(execution.attempt, body.attempt)`-shaped pure predicate (or equivalent inline logic proof) — `attempt 1 vs current 2` → `false`; `attempt 2 vs current 2` → `true`.
2. **Route wiring (static, matching `complete-route-output-authority.test.ts`'s pattern):** confirm both `/complete` and `/fail` route source (a) select `attempt`, (b) compare it against `body.attempt` before the DB write, (c) include `.eq('attempt', ...)` in the `UPDATE` `WHERE` clause, (d) return a distinct `STALE_ATTEMPT` code on mismatch.
3. **Stale attempt 1 complete rejected / attempt 2 complete accepted:** encode as two static-order assertions matching the sequence in §4 (claim attempt 1 → reclaim → attempt 1's body no longer matches current row attempt → rejected; attempt 2's body matches → accepted) — since no live DB exists in this repo's tests, this is proven at the level of "given a row state, does the predicate accept/reject the right body," not a live two-request race.
4. **Stale attempt 1 fail rejected:** same shape as #3, mirrored for `/fail`.
5. **Same stable worker_id across attempts still fenced correctly:** a test explicitly constructs `body.attempt=1` against `execution.attempt=2` with `claimed_by` held constant across both, proving the check depends only on `attempt`, never on `claimed_by` equality (directly encodes §5's finding).
6. **Different worker_id also fenced:** same as #5 with different `claimed_by` strings — proving the fix is worker-identity-agnostic (§6).
7. **Terminal execution cannot be reclaimed:** already covered by existing B1 claim-function reasoning (§9) — no new test needed, but worth a regression assertion that `status IN ('completed','failed')` is never matched by the claim eligibility clause (static SQL-text assertion, matching how B1's own tests already treat the claim function structurally).
8. **Positive B3 path remains valid:** re-run the existing `worker-coordination-contracts.test.ts`/`complete-route-output-authority.test.ts` suites unmodified except for the new required `attempt` field in the fixture bodies — must still pass.
9. **Negative upload-failure path remains valid:** same as #8 for the `/fail`-after-upload-failure path (`worker-lifecycle.test.ts`'s existing `shouldReportFailAfterUploadFailure` coverage, extended with the new `attempt` field in the constructed fail body).

## 14. Exact B4 Live-Proof Runbook (Task 9) — Sequencing Note First

**Precondition, before any live proof (new, required by this audit's finding):** §11's fix must be merged, deployed to production (Vercel auto-deploy from `main`, matching the B3.1A workflow), **and** the worker payload re-exported (`node infra/render-worker-runtime/export.mjs`) and re-copied to the VPS bind-mount (`/opt/content-studio/render-worker`) **before** step 6 below. Deploying only one side would either (a) break the already-proven positive path (server requires `attempt`, old worker doesn't send it → every `/complete`/`/fail` call fails with a missing-field error) or (b) leave the race from §4 fully open (old server, new worker). This is a synchronized two-sided deploy, not two independent ones.

**Live proof procedure (unchanged from the original B3.1 mission's Task 9, now safe to execute since §11 closes the race it would otherwise be measuring against an unfenced protocol):**

1. Create one real execution: `POST /api/video-drafts/[id]/render` (authenticated browser session, per the B3.1 runbook's established method — DevTools `fetch` with `credentials: 'include'`).
2. Manually claim it via the worker claim API **without starting the coordinator** — a single `curl -X POST .../api/render-executions/claim -H "Authorization: Bearer $SECRET" -d '{"leaseSeconds":300}'`.
3. Record: `executionId`, `attempt` (expect `1`), `claimed_by` (via a read-only SQL check against the row — the claim response itself doesn't currently echo `claimed_by`, only `attempt`/`leaseExpiresAt`), `lease_expires_at`.
4. Do nothing further — simulate the claiming process disappearing (do not start the coordinator, do not call `/complete`/`/fail`).
5. Wait the **real** 300 seconds (do not manually edit `lease_expires_at` — that would prove nothing about the actual timer). Poll `GET /api/render-executions/:id` (or a read-only SQL check) until `now() > lease_expires_at`.
6. Start the real coordinator (`node coordinator.bundle.cjs` inside the VPS container, via `docker exec`, per the B3.1 runbook's process model) with valid `CONTENT_STUDIO_MINIO_*` credentials. Optionally set a distinguishable `CONTENT_STUDIO_RENDER_WORKER_ID` (e.g. `vps-render-worker-recovery-proof`) purely for log legibility — §5 already proves this does not affect correctness either way.
7. Confirm in the coordinator's own log output (and independently via `GET /api/render-executions/:id`) that it reclaims the **same** execution row.
8. Confirm `attempt = 2` on the reclaimed row (log line `Claimed execution <id> (attempt 2)`, already emitted by existing `coordinator.mjs` code — no change needed here).
9. Let it render/upload/complete normally (this is now the already-proven B3.1 positive path, just starting from `attempt=2` instead of `attempt=1`).
10. Independently verify: same `executionId`; **exactly one** `render_executions` row for it (never two — confirms no duplicate-row model was accidentally introduced); `status='completed'`; `attempt=2`; correct `output_bucket`/`output_storage_path`/`output_size_bytes`/`output_duration_ms`; the real MinIO object exists at the logged key with a matching byte size (identical verification method to the B3.1 runbook).

## 15. Optional Stronger Stale-Attempt Proof (Task 10) — Defined, Not Executed This Mission

A second, more direct proof: after step 9 of §14 (attempt 2 already `completed`), **replay** an attempt-1-shaped `/complete` (or `/fail`) request by hand — same `executionId`, `attempt: 1` in the body, any plausible output metadata — and confirm it is rejected. Two layers, both expected to fire (either alone is sufficient, but proving both demonstrates defense-in-depth):
- `execution.status !== 'claimed'` (already `'completed'`) → `409 INVALID_STATUS_TRANSITION` (pre-existing guard, unrelated to §11's fix).
- If artificially tested *before* attempt 2 completes (i.e., replayed while `status` is still `'claimed'` but `attempt` is already `2`) → `409 STALE_ATTEMPT` (the new guard from §11, the one actually being proven).

Per the mission's explicit instruction, this replay is **not** to be executed against remote infrastructure in this mission — it is specified here for the next mission that performs the live B4 proof.

## 16. PASS/FAIL Criteria

**PASS (for the eventual live proof, once §11 is implemented and deployed):**
- Coordinator reclaims the same row after real 300s lease expiry, with `attempt` incrementing to `2`.
- Exactly one `render_executions` row exists for the execution throughout.
- The row reaches `status='completed'` with correct output metadata, `attempt=2`.
- The MinIO object exists and matches the row's `output_size_bytes`.
- (If §15's optional stronger proof is also run) a replayed attempt-1 mutation is rejected with `409` (either code, per the two-layer note above).

**FAIL:**
- Any stale-attempt request (from either §4's naturally-occurring scenario or §15's deliberate replay) is accepted and mutates the row.
- More than one `render_executions` row exists for what should be a single execution's reclaim.
- `attempt` does not increment on reclaim (would indicate the claim function itself regressed).
- The completed row's output metadata does not match a real, independently-verified MinIO object.

## 17. Confirmation

No remote infrastructure was accessed this mission (no VPS, no Portainer, no MinIO, no Vercel env mutation, no Supabase mutation, no real execution created, no code deployed). §11's fix is a design only, pending explicit authorization to implement, per this mission's own instruction not to silently implement a concurrency fix.

## 18. Original Audit Verdict (2I-B4.0)

**`STALE_WORKER_FENCING_REQUIRED`**

---

## 19. Implementation Record (Phase 2I-B4.1)

§11's design was implemented exactly as specified, with no deviation, and committed separately from this audit (audit: `7f3c248`; implementation: see this section's own commit once recorded by the closure report). **Local validation only — not yet deployed anywhere.**

### 19.1 What changed

- **`app/api/render-executions/[id]/complete/route.ts`:** requires `attempt` (positive integer) in the request body (`400 MISSING_ATTEMPT` otherwise); loads `attempt` alongside the existing `id, user_id, status` select; rejects a mismatch against the row's current `attempt` with `409 STALE_ATTEMPT` **before** the B3 output-target check and before any DB write; the `UPDATE`'s own `WHERE` clause gained `.eq('attempt', attempt)` alongside the pre-existing `.eq('id', id).eq('status', 'claimed')`; a zero-rows-affected `UPDATE` (the TOCTOU case — a reclaim landing between the read and the write) now returns the same `409 STALE_ATTEMPT` rather than a misleading success. All B3 output-target-authority (`OUTPUT_TARGET_MISMATCH`) and B2 transition (`INVALID_STATUS_TRANSITION`) checks are unchanged, just reordered to sit alongside the new one.
- **`app/api/render-executions/[id]/fail/route.ts`:** identical shape — required `attempt`, `409 STALE_ATTEMPT` on mismatch (both at the application-level read and via the `UPDATE`'s `.eq('attempt', attempt)`), zero-rows-affected also mapped to `409 STALE_ATTEMPT`. Bounded/sanitized error fields (`MAX_ERROR_MESSAGE_LENGTH`/`MAX_ERROR_DETAIL_LENGTH`/`MAX_ERROR_CODE_LENGTH`) and the terminal-on-explicit-fail semantics are unchanged.
- **`infra/render-worker-runtime/coordinator.mjs`:** `reportFail` and `reportCompleteWithRetry` each gained a required `claimAttempt` parameter (renamed to avoid shadowing `reportCompleteWithRetry`'s own pre-existing local HTTP-retry counter, itself renamed `retryAttempt` for clarity — a naming collision, not a semantic one). Both now send `attempt` in their JSON request bodies. All three existing call sites in `runOneCycle()` (render-failure → `/fail`, upload-failure → `/fail`, success → `/complete`) now pass the `attempt` value destructured directly from the `/claim` response (`const { executionId, userId, attempt, resolvedInput, warnings } = claim`, unchanged from B3) — never recomputed, never defaulted, no global mutable fallback.
- **`app/api/render-executions/claim/route.ts`:** no change — it already returned `attempt` (confirmed by audit §1; Task 5 required only verification, which passed).
- **No new table. No heartbeat. No queue/broker. No `lease_expires_at` check added anywhere in the mutation predicates** (verified by an explicit negative test — see §19.3).

### 19.2 The Lease Rule, As Implemented

Confirmed by code and by test: neither route's `UPDATE` `WHERE` clause nor its application-level check references `lease_expires_at` at all. A `claimed` row with a matching `attempt` is accepted regardless of how much wall-clock time has passed since its lease nominally expired — exactly §12's decision, now enforced, not merely documented.

### 19.3 Test Coverage (Task 8, now implemented)

New file `lib/render-execution/__tests__/stale-attempt-fencing.test.ts` (30 tests), covering, per the mission's task list:

| Task | Coverage |
|---|---|
| 6 — same worker ID | An in-memory row model reclaims with an IDENTICAL `claimed_by` string across attempts 1→2; proves attempt-1 `/complete` and `/fail` are both rejected (predicate returns `null`) and attempt-2 `/complete` succeeds — correctness never touches `claimed_by`. |
| 7 — different worker ID | Same shape with `worker-A`→`worker-B`; identical outcome, proving the fencing is worker-identity-agnostic. |
| 8 — lease expired, no reclaim | A row left at `attempt=1` (no `reclaim()` call simulated) still accepts a `/complete` and a `/fail` request carrying `attempt=1` — proves no implicit wall-clock cutoff exists. |
| 9 — reclaim / no duplicate row | `reclaim()` mutates the SAME row id and increments `attempt`; a completed row cannot be mutated again even by its own current attempt (status no longer `'claimed'`). |
| 10 — TOCTOU | A reclaim simulated to land strictly between a "read" and the eventual "write" still yields zero rows matched for the stale write — the predicate is evaluated against current state, never a cached read. |
| — | Static wiring proofs (matching the established `complete-route-output-authority.test.ts` pattern) confirm the REAL route source — not a reimplementation — selects `attempt`, requires it, checks it before the DB write, includes it in the `UPDATE` predicate, returns `409` (not 401/404/500) for `STALE_ATTEMPT`, and that the B2/B3 checks it sits alongside are untouched. |
| — | Coordinator wiring proofs confirm `reportFail`/`reportCompleteWithRetry`'s actual call sites (distinguished from their own function declarations via an `await`-prefixed regex) pass the claim-derived `attempt` identifier, and that `attempt` itself is destructured directly from the claim response. |

### 19.4 Validation

- Focused fencing tests: 30/30 pass (`stale-attempt-fencing.test.ts`), full `lib/render-execution/**` subset: 124/124.
- Full suite: **694 → 720** passing (62 test files).
- Typecheck: PASS.
- Lint: 0 errors / 45 pre-existing warnings — unchanged.
- Build: PASS — no new routes (same three worker routes as B2/B3, contract changed, paths unchanged).
- Worker export: PASS — `coordinator.bundle.cjs` regenerated; grep-confirmed it contains `JSON.stringify({ attempt: claimAttempt, errorCode, errorMessage, errorDetail })` and `JSON.stringify({ attempt: claimAttempt, ...outputMeta })` verbatim in the bundled output.
- Portable dependency-load smoke test: PASS (unchanged mechanism from B3 — bundle still loads its full module graph outside the repo with an empty environment).

### 19.5 B3 Regression Check

Re-ran `worker-coordination-contracts.test.ts` and `complete-route-output-authority.test.ts` unmodified — both still pass, confirming the B3 output-target-authority hardening, the B2 status-transition guard, B1.1's browser-authority hardening (worker routes still gate exclusively on `verifyWorkerAuth`/service-role, never a Supabase session), the deterministic scratch-key convention, and the truthful-completion invariant (`OUTPUT_UPLOAD_FAILED` still never reaches `completed`) are all untouched by this fix — the new checks are additive, not replacements.

### 19.6 Exact Synchronized Deployment Requirement (Unchanged From §14, Now Concrete)

This implementation is **local only** — not pushed, not merged, not deployed, not copied to the VPS. Per §14's precondition: deploying the Control Plane routes without also redeploying the worker bundle would break the already-proven B3.1 positive path (server would reject every `/complete`/`/fail` call with `400 MISSING_ATTEMPT` since the currently-running production worker doesn't send it yet); deploying only the worker without the routes would leave every mutation rejected for the opposite reason once the old routes ignore the new field harmlessly but the race itself would remain open. Both sides must ship together, in one coordinated release, before any live B4 proof.

## 20. Final Verdict (This Mission, 2I-B4.1)

**`READY_FOR_SYNCHRONIZED_FENCING_DEPLOYMENT`**


---

## 21. Deployment Closure (Phase 2I-B4.1A)

- PR #29 was squash-merged successfully.
- Final main SHA: \d9bbd9ae99089302d1548f241a00996df9aa3178\
- Vercel production deployment: \dpl_HtGBsCvk3jTRCueQCNXEhfWjNA7B\ (READY)
- Worker payload regenerated from final main (\infra/render-worker-runtime/dist/content-studio/\).
- **Compatibility Window**: The new Vercel routes are live and require \ttempt\. The old coordinator bundle on the VPS is incompatible (it does not send \ttempt\), but production is safe because the coordinator is NOT resident and remained stopped. Once the human replaces the worker payload on the VPS, the new Control Plane and the new coordinator bundle become compatible. No render execution should be started before this replacement.
- **Pending**: Manual VPS replacement, then the B4 live recovery proof.

