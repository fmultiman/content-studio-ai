# VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1 (FUTURE-036, slice 036B)

Server-side infrastructure for the future video generation Workspace. **No UI, no autosave client, no Production
visibility, no evaluator** — those are 036C/036D and later.

## Model

| | `video_generation_sessions` | `video_generations` (attempt) |
|---|---|---|
| Nature | mutable, resumable **working state** | immutable submitted snapshot + provider/result lifecycle |
| Writer | validated server routes (service role) | create route, callback, poller, sync |
| Holds | `working_prompt`, `working_config`, scope, timestamps | prompt, mode, model, `request_config`, transport, connection, sources, status, results, `session_id?` |

`Generation != Composition`, `VideoGeneration != VideoDraft`, `VideoGeneration != VideoGenerationSession`.

- A Session belongs to exactly one `(user, project, production)`; all three are `NOT NULL` and cascade.
- `video_generations.session_id` is **nullable**, set once at insert, never changed. Legacy attempts stay standalone —
  **no Session is backfilled** (nothing invents intent, lineage or timestamps).
- No `status`, `selected_generation_id`, `name`, `archived_at`, `deleted_at`, provenance or `attempt_number`:
  status/selection are derived from attempts; attempt order is `created_at DESC, id DESC`.
- Ownership is enforced by the database: composite FK
  `(session_id, user_id, project_id, production_id) → sessions(id, user_id, project_id, production_id)
  ON DELETE SET NULL (session_id)`; the browser is never trusted.

## Working state persistence

One authority: `VideoGenerationWorkingStateV1Schema` (036A). Persistence only **splits** it:

- `working_prompt` ← `state.prompt` (verbatim, first-class)
- `working_config` ← `{ schemaVersion, source, selection }` (never contains the prompt)

Routes validate with the 036A schema plus bounds (`lib/video-generation/session.ts`): prompt ≤ 20 000 chars, config ≤ 32 KiB,
body ≤ 128 KiB, source id must be a UUID. Validation is **syntactic**; whether a source/connection still exists or is
usable is decided at Generate time by the existing authorities (`resolveGenerationConnection`, `resolveI2vSource`).
The database only guarantees `working_config` is a JSON object, so future schema versions need no migration.

## Session API

| Route | Contract |
|---|---|
| `PUT /api/video-generation-sessions/[id]` | idempotent create at a client UUID. First call → `201`. Same owner + same Project/Production repeat → `200`, stored Session **unchanged** (not an overwrite). Same owner, other scope → `409 SESSION_SCOPE_MISMATCH`. Someone else's id → `404`. |
| `GET /api/video-generation-sessions/[id]` | read one. Writes nothing (not even `updated_at`). |
| `PATCH /api/video-generation-sessions/[id]` | `{ expectedUpdatedAt, workingState }`. Compare-and-swap on `updated_at`; stale → `409 SESSION_VERSION_CONFLICT` with the current Session; unknown/foreign → `404`. `id/userId/projectId/productionId` in the body → `400 IMMUTABLE_FIELD`. |
| `GET /api/video-generation-sessions?productionId=` | caller's Sessions of one Production, `updated_at DESC, id DESC`, max 100. |
| `DELETE` | intentionally absent in V1. |

`updatedAt` is the concurrency token and must be echoed back verbatim as `expectedUpdatedAt`.
Writes are server-owned: `authenticated` only has `SELECT` (RLS, own rows), mirroring migration 043.

## Generate

`POST /api/video-generations` additionally accepts optional `sessionId` and `clientRequestId`.

- `sessionId` is lineage/ownership only: the Session must be the caller's and match `projectId`/`productionId`
  (`404 SESSION_NOT_FOUND` / `409 SESSION_SCOPE_MISMATCH`). **The request body stays the single attempt authority**; the
  Session's stored draft is never read to build a submission (a stale autosave must never bill the wrong prompt).
- `GET /api/video-generations?sessionId=` lists a Session's attempts (owner-checked, deterministic order).
- Without either field the route behaves exactly as before and inserts the same row it always did.

### Idempotency (`clientRequestId`, optional UUID)

- Durable: `UNIQUE (user_id, client_request_id) WHERE client_request_id IS NOT NULL`; keys never cross users.
- The key is checked **before** any credential, source or provider work; a lost insert race (`23505`) also settles on the
  winner's row. A replay never calls the provider.
- `request_fingerprint` (SHA-256 of the canonical request) makes a reused key with a different payload a
  `409 IDEMPOTENCY_KEY_REUSED`, never a silent replay.
- Replay returns the stored attempt (`idempotentReplay: true`, `outcomeUnknown` when the provider outcome was ambiguous),
  failed attempts included: **a key names one logical submit**; a deliberate new try needs a new key.
- If the key cannot be checked the route fails closed (`503`).
- Requests without a key keep today's behavior (no server-side de-duplication) until every caller sends one.

## Delete semantics and proof (Open-6)

Environment: throwaway local Postgres (PGlite 0.5.8, PostgreSQL **18.3**; the live database is 17.6 — column-list
`SET NULL` is PG ≥ 15), with the repo's real `039`, `042`, `043` and `049` applied over a stub of the live parent tables
whose FK actions were read from the live catalog (`productions.project_id → projects` is `ON DELETE RESTRICT`).
Production was only read (catalog queries), never mutated. 26/26 checks passed:

- migration re-applies cleanly; pre-existing row untouched; no Session created (no backfill)
- delete **Production** with Session + 0 attempts / Session + 3 attempts + 1 legacy attempt → no error, nothing orphaned
- delete **Project** while a Production exists → `RESTRICT` (pre-existing rule), atomic; after deleting the Production the
  Project deletes and every Session/attempt is gone
- delete a **Session** alone → attempts survive, only `session_id` becomes `NULL`
- attempt → Session of another user / other Project+Production / same Project other Production / nonexistent → FK violation
- re-parenting or late-attaching `session_id` → rejected by trigger; ordinary attempt updates unaffected
- a Session with attempts cannot change scope
- `authenticated`: reads only own Sessions; `INSERT/UPDATE/DELETE` denied; `anon` denied
- idempotency index: same `(user, key)` → unique violation; same key for another user OK; keyless rows never collide

The composite FK was kept: it is clean, `SET NULL (session_id)` never nulls the `NOT NULL` ownership columns, and the
cascade combination behaved correctly in every scenario.

## Rollout

Apply `scripts/049_video_generation_sessions.sql` **before** deploying code that uses `sessionId`/`clientRequestId`
(additive, forward-only, no backfill). The legacy Generate path inserts the same row as before, so it keeps working in
either order. Rollback is in the migration header.
