# GEMINI_USAGE_LEDGER_ORPHAN_INTEGRITY_AUDIT_V1

FUTURE-048. Audit-first, **read-only**. Baseline `origin/main` `dda100af5ae48722bb3cf8906ccb843cedd6df90`
(Production application code = `20dec138…`; PR #149 was docs-only). Branch `audit/gemini-usage-ledger-orphan-integrity-v1`.
Paid provider calls: **0**. Database writes: **0**. Migration: **none**. No Gemini/OpenAI call, no Preview click.

Evidence sources: Supabase `execute_sql` (read-only SELECTs), Supabase edge/PostgREST **request logs** for the project
(retained 24 h — captured here before expiry), GitHub deployments/commits, repository source. Secrets are never quoted:
only configured / not-configured / same-project and JWT *signature prefixes* (non-secret log field) are used.

## 1. Verdict

`ROOT_CAUSE_PROVEN` for the orphan mechanism.

> Two real Video Review executions ran at 17:38Z through the normal Review API (authenticated user, Vercel function,
> service-role writes). The Review, artifact and provenance rows were created, the Gemini responses arrived, usage rows
> were appended, and both Reviews completed. Six minutes later a **local Node script with the Production service-role key**
> deleted the two `media_reviews` rows, the provenance and the artifact (HTTP 204) and also tried to delete the usage rows —
> which the ledger **refused (HTTP 403, no DELETE grant)**. The usage rows therefore survived and now reference Reviews that
> were deliberately removed out-of-band.

It is **not** a recorder-ordering bug, **not** a transaction bug, **not** test pollution, **not** a wrong `resource_id`, and
**not** a product cleanup path. It is an out-of-band cleanup that was only half-effective, made possible by (a) no environment
isolation (local and Preview talk to Production data with service-role power) and (b) asymmetric DB protection (the ledger is
append-only, Reviews/artifacts are deletable by `service_role`).

Not established (see §9): who/what clicked "review" twice, and whether the serving deployment was Preview or Production.

## 2. Facts

* `media_reviews`: 17 image completed + 2 video completed (`3c365b1e…`, `4f71a426…`), 0 pending/running.
* `provider_usage_events`: 5 Kling (`video_generation`) + 6 Gemini (`media_review`).
* Gemini rows (all `gemini` / `rest` / `video_review` / `gemini-3.5-flash` / `provider_reported` / `connection_id NULL`,
  user `35428fd4…`, project `48680ed1…`, production `35c306f2…`, `funding=user_byok`, `credential_source=user`,
  `provider_response=received`, review artifact `1ff8d1bf-fec6-4bde-85f7-89b0ef8d0c4e`):

| Execution | resource_id (Review id) | provider_task_id | occurred_at | input | output | thoughts | total |
|---|---|---|---|---|---|---|---|
| A | `b232b4d9-ed4f-4f5a-8ea7-3ee3feeafffb` | `G9XHavOdKr3g-sAPuN7SmA8` | 2026-10-08 17:38:46.650515Z | 698 | 1046 | 1398 | 3142 |
| B | `3b5daf92-410c-4bd4-a452-805b8f7126b0` | `LtXHasbaGdKL_uMPqYnB8AE` | 2026-10-08 17:39:03.609517Z | 698 | 968 | 1023 | 2689 |

Row ids — A: `eaeb3ebc-5ab1-4328-a642-d042f9386a9d` (input), `824c4d11-fdba-4a04-bf2d-2e36e85aa5cb` (output),
`4e4a40d7-8f27-4f9e-8ab7-62ea02750822` (thoughts). B: `9e5c64c2-6eab-4c75-b741-ab6031ad8e9a` (input),
`3d1b44c5-2271-4214-8265-470266c92819` (output), `90862464-423e-4e38-b8e9-2bfdb5f80b78` (thoughts).

* Neither Review id exists in `media_reviews`; artifact `1ff8d1bf…` and its provenance do not exist either.
* Orphan scan over the whole ledger: Gemini 6/6 rows orphaned (2 resources); Kling 5/5 rows resolve to existing
  `video_generations` (0 orphans). No row has a NULL `resource_id`.

## 3. Timeline (UTC; Brazil = UTC−3)

PROVEN = Supabase request log / DB / git. LIKELY = consistent inference. UNKNOWN = no evidence.

| Time | Event | Class |
|---|---|---|
| 2026-10-07 ~02:14 | PR #146 Preview smoke records `provider_usage_events` 5 rows, **0 Gemini**, `media_reviews` 19 | PROVEN (doc) |
| 10-08 16:45–16:47 | Commit `051f536` (FUTURE-040) pushed; Preview deployment created | PROVEN |
| 17:25→17:49 | Vercel cron/queue traffic (`claim_next_render_execution`, MCP video poll) from Vercel IPs, service-role | PROVEN |
| 17:30:23 | **Local** (`177.26.229.46`, São Paulo, Telefônica Brasil) Node script (`supabase-js-node/2.104.1`), service-role, begins read-only monitoring of `media_reviews`, `provider_usage_events`, `images`, `image_drafts`, `video_generations`, sessions (first query returns 400: wrong column) | PROVEN |
| 17:31–17:39 | Same IP, **Traycer/Electron browser** (`Traycer/1.4.2`), authenticated user: `/imagens` data, image attempts/reviews | PROVEN |
| 17:38:07 | Vercel function (`3.95.10.199`, AWS Ashburn), authenticated user JWT: library file `e53b4193…` + artifact provenance lookup (Video Review panel opened) | PROVEN |
| 17:38:30–32 | `auth/v1/user` → service-role: artifact **POST 201** (new `1ff8d1bf…`), provenance POST, Review **A POST 201** (`pending`), BYOK key read, **PATCH → running** | PROVEN |
| 17:38:46.641 | `provider_usage_events` **POST 201** (A, 3 rows); 0.06 s later Review A **PATCH → completed** (≈14 s after running) | PROVEN |
| 17:38:50 | Review **B POST 201** (artifact reused), PATCH running | PROVEN |
| 17:39:03.519 | `provider_usage_events` **POST 201** (B); Review B **PATCH → completed** (≈13 s) | PROVEN |
| 17:39:06 | Traycer browser opens Settings (`user_settings` read) | PROVEN |
| 17:42:31 / 17:44:20 | Local script reads artifact `1ff8d1bf…` and its provenance (it knows the ids) | PROVEN |
| **17:44:59.648** | Local script: `DELETE provider_usage_events?operation=eq.video_review&occurred_at=gte.17:38:00Z` → **403** (`PostgREST 42501`) | PROVEN |
| 17:45:00.625 | Local: `DELETE media_reviews?id=in.(b232b4d9…,3b5daf92…)` → **204** | PROVEN |
| 17:45:01.230 / .428 | Local: `DELETE media_artifact_provenance` and `DELETE media_artifacts` for `1ff8d1bf…` → **204** | PROVEN |
| 17:45:20–22 | Local script re-reads ledger/reviews | PROVEN |
| 17:48:59 | Commit `b04c807` records the FUTURE-040 "read-only" Preview smoke: "0 paid calls", "existing video reviews remain completed" | PROVEN |
| Who clicked Review twice (human vs agent-driven browser) | UNKNOWN |
| Which deployment served 17:38 (Preview `051f536` vs Production `a54672c`) | UNKNOWN |

Contradiction recorded, not rewritten: the PR #146 report said **0 Gemini usage rows** (true on 10-07/08 ~02:14Z); today's
Production has **6**, created 17:38–17:39Z the same day, *after* that report. Both statements are true at their timestamps.
Separately, the FUTURE-040 smoke note ("0 paid calls", video reviews unchanged) was written at 17:48Z, **after** two paid
Gemini executions and the deletion of their Review rows; whether that smoke was the actor is UNKNOWN, but its stated paid-call
count does not match the ledger for its own time window.

## 4. Code path and ordering (Video Review) — `lib/reviews/video-service.ts`

All steps use **one service-role client**; every step is a **separate PostgREST call (autocommit) — there is no multi-statement
transaction anywhere on this path.**

1. resolve source (owner-scoped) → 2. `registerVideoArtifact` (artifact + provenance upsert) → 3. authorize media →
4. context/fingerprint → 5. idempotency lookups → 6. `insertPendingReview` (**durable `pending` row before any provider call**) →
7. resolve BYOK credential → 8. `markReviewRunning` → 9. `provider.execute` (Gemini Files upload + `generateContent`) →
10. **`recordGeminiReviewUsage` (ledger insert, best-effort, one retry, never throws)** → 11. strict parse → 12. `markReviewCompleted`
(or `markReviewFailed`; an error path records `received_rejected` usage first).

Answers: provider call happens after the Review row exists; usage is written **after the provider answered and before Review
parsing/finalization**; `resource_id` = `row.id` of a Review that was already durable (the logs show Review POST 201 → running →
usage POST → completed). Usage can survive Review failure (by design). A Review row can be deleted by `service_role` (DELETE
granted; the `media_reviews_lifecycle` trigger is `BEFORE UPDATE` only; FKs from Reviews are `RESTRICT` toward parents, i.e.
they block deleting a *parent*, not the Review itself). No code in the repository deletes `media_reviews`, `media_artifacts`,
`media_artifact_provenance` or `provider_usage_events` (searched `lib`, `app`, `scripts`); stale recovery (FUTURE-046) only
updates `status`.

## 5. `resource_id` semantics

Migration 044: `resource_type` / `resource_id` = "The Content Studio entity that used the provider"; `resource_id UUID` is
**nullable with no foreign key**. Kling uses `video_generation`; Gemini uses `media_review` with `resource_id = Review id`
(FUTURE-043: "a Review row IS one provider execution"). So `resource_id` is an **explicit convention without referential
enforcement**. The ledger is explicitly designed to outlive other data (`project/production/connection` FKs are `SET NULL`;
`service_role` has `INSERT, SELECT` only: "history cannot be silently rewritten. A correction is a NEW event"). FUTURE-043
chose "one provider execution → usage rows linked to a Review" and "usage survives even if later Review processing fails";
it did **not** state what happens if the Review row is later deleted, because no product path deletes Reviews.

Contract mismatch, precisely: the ledger guarantees *usage outlives the entity*; the Review tables guarantee nothing equivalent
(terminal Reviews are update-immutable but delete-able by the server role). `resource_type='media_review'` is therefore a
**historical reference that can dangle** when a Review is removed out-of-band. No FK-like invariant was ever enforced.

## 6. Environment isolation

| Environment | Database | Evidence |
|---|---|---|
| Production Vercel | Supabase project `nuhd…` | cron/queue + user traffic |
| Preview Vercel | **Same project** (same rows/revisions visible from Preview and Production origins in the FUTURE-049 smoke) | PROVEN |
| Local app / scripts | Local `.env.local` is a `vercel env pull` with `VERCEL_ENV="production"`, `SUPABASE_URL` → the same project, `SUPABASE_SERVICE_ROLE_KEY` configured | PROVEN (names/targets only) |
| Local script at 17:30–17:45 | Production DB, **service-role** (same JWT signature prefix `RqW_rc` as the Vercel functions and cron) | PROVEN |
| Automated tests (vitest) | `environment: node`, **no** `setupFiles`/dotenv; service-role code is mocked or given fake keys (`'service-role-test-key'`); `createServiceRoleSupabase()` throws if env is absent; PGlite/fake-db helpers are in-process | no network path by default |
| GitHub Actions | none (`.github` absent) | PROVEN |
| Preview has service-role key / Preview Supabase differs | UNKNOWN — Vercel project is not visible to the available Vercel connector; **but** the Production service-role key demonstrably works from a Vercel function that served the 17:38 request | UNKNOWN |

Preview and local can write to Production data today. This is the enabling condition of the whole incident.

## 7. Test pollution

None found. The four identifiers (`b232b4d9…`, `3b5daf92…`, `G9XHavOdKr3g-sAPuN7SmA8`, `LtXHasbaGdKL_uMPqYnB8AE`) and the artifact
`1ff8d1bf…` appear **nowhere** in source or docs on `main` or in any of the 322 local/remote branch tips. Every creating write (artifact, Review, usage) came from a
Vercel egress IP, not from the developer machine, and tests cannot call Production without env injected into the shell
(none observed; the only local writes were the three DELETEs). Fixture usage in tests uses synthetic numbers and ids.

## 8. Paid-call evidence

`provider_task_id` = Gemini `generateContent` JSON field **`responseId`** (`lib/providers/gemini/client.ts` → `review-provider.ts`
→ `providerRequestId`); it is **not** locally generated. Both executions: ~13–14 s between `running` and the usage write (same
latency as the earlier real Reviews of 12–13 s), Files upload + generate through the user's BYOK key, `serviceTier`, per-modality
split (TEXT 500 / VIDEO 198) and thinking tokens as the API reports them, Review then parsed strictly and completed.

* Execution A — **1. PROVEN REAL PROVIDER RESPONSE** (application-side proof; a Google AI Studio usage view for 2026-10-08
  ~17:38Z would be the external confirmation).
* Execution B — **1. PROVEN REAL PROVIDER RESPONSE** (same).

No cost is computed or claimed (the ledger has no price column); billing amount depends on the user's Google tier.

## 9. Hypotheses

| Hypothesis | Verdict |
|---|---|
| Usage written before the Review was durable (ordering/transaction) | **Ruled out** — Review POST 201 and `running` precede the provider call; usage follows |
| Wrong/ungenerated `resource_id` | **Ruled out** — equals the real Review PK that existed at write time |
| Test/fixture pollution | **Ruled out** — creators are Vercel IPs; ids absent from source |
| Product cleanup/stale-recovery deleted Reviews | **Ruled out** — no delete path; recovery only updates status |
| FK cascade removed the Reviews | **Ruled out** — user still exists; `RESTRICT` parents; request log shows explicit DELETEs |
| Out-of-band service-role cleanup that could not delete the append-only ledger | **PROVEN** (3 DELETE 204 + 1 DELETE 403, Brazil IP, 17:44:59–17:45:01Z) |
| Environment isolation gap (local/Preview ↔ Production, service-role) | **Proven enabling condition** |
| Preview vs Production deployment as the creator | UNKNOWN |
| Human click vs agent-driven browser | UNKNOWN (Traycer browser from the same IP was active 17:31–17:39 and 17:39:06, but server-side API calls do not expose the client) |

Confidence: **High** for the row/ordering/deletion chain (provenance by request log); **Medium** that the actor was the
FUTURE-040 smoke session (temporal and IP coincidence only).

## 10. User-visible Settings screen

`/api/settings/usage` returns display columns only (no `resource_id`, no task id) and the UI has no link or wording tying a row
to a Review; the empty-state copy says each AI video and each Gemini review "appear here". The two executions render as
"Revisão de vídeo · Gemini API". That is **factually accurate**: they are real metered executions. The UI does not imply the
Reviews still exist, so it is **not misleading**; users cannot open the missing Reviews from it. No UI change needed for
correctness.

## 11. Cleanup recommendation (NOT executed)

Rows: the six ids in §2. **Deletion is not justified**: the rows are legitimate provider-reported usage of a real, billable BYOK
execution, not test fixtures. Deleting them would destroy the only local record of ~5.8k tokens of metered usage, contradict the
append-only design, and is impossible for `service_role` (403) — only the table owner could do it. If the owner nevertheless
wants them hidden, that needs separate explicit authorization, a recorded justification and an owner-level statement; a safer
path is to **keep the rows** and treat the missing Reviews as a documented out-of-band deletion (this document is that record).
Do **not** recreate Reviews/artifacts (fabrication). Recovery of the deleted Review content is not possible from the DB.

## 12. Answers to the 14 questions (short)

1 Yes, real. 2 Two clicks of the Video Review action on library video `e53b4193…` (authenticated session via a Vercel function, 17:38:30 and 17:38:50); clicker UNKNOWN. 3 Vercel function; Preview vs Production UNKNOWN; **not** local/dev/test for creation. 4 Yes, both (and artifact). 5 Deleted 17:45:00.6Z by a local service-role script. 6 n/a. 7 Convention, not FK. 8 Yes — by design usage may outlive any entity. 9 The usage is written after the Review row is durable; no cross-write transaction exists anywhere. 10 Yes (same project; local env is the Production pull). 11 No test/fixture used them. 12 Yes, legitimate usage evidence. 13 Primarily out-of-band cleanup + environment isolation; not recorder ordering/attribution/transaction. 14 In normal product use no (no delete path); with out-of-band service-role scripts, yes.

## 13. Remediation options (proposal only — nothing implemented)

1. **Environment isolation (required):** Preview/local must not hold Production service-role keys or write Production tables; options: separate Supabase project/branch for Preview, or Preview with its own keys; a guard that makes scripts refuse to run when `VERCEL_ENV=production` without an explicit flag.
2. **Smoke safety (required):** a read-only smoke must never press Review/Generate; add a mandatory ledger/`media_reviews` before/after count gate (the gate would have caught this), and forbid ad-hoc deletes of ledger-linked rows.
3. **DB hardening (recommended, needs a migration, separate mission):** `REVOKE DELETE` on `media_reviews`, `media_artifacts`, `media_artifact_provenance` from `service_role` (matching the ledger), or a delete-guard trigger that rejects deleting a Review that has usage; optionally a reconciliation view of ledger rows whose `resource_id` no longer resolves.
4. **Contract text (small):** state in FUTURE-043/migration docs that `resource_id` is a non-enforced reference that can dangle, and that deleting a Review never deletes its usage.
5. No change to the recorder, ordering or Settings UI is required by this incident.

Proposed next mission: `ENVIRONMENT_ISOLATION_AND_SMOKE_SAFETY_V1` (items 1, 2, 4; item 3 as its schema slice after owner approval).

## 14. Limits of this audit

Vercel runtime logs and env scopes were not accessible (the connector sees a different project), so the serving deployment and
Preview env scoping are UNKNOWN. Supabase request logs have 24 h retention; the log excerpts above should be exported if the
audit trail must be kept longer. No local agent transcript for the 17:30–17:45Z session was reachable from this epic.
