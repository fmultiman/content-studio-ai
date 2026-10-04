# VIDEO_GENERATION_CALLER_WIDE_IDEMPOTENCY_HARDENING_V1 (FUTURE-036, slice 036E-A)

Caller-wide idempotency policy hardening across first-party video generation submission paths.

## Status

- **036A — VIDEO_GENERATION_WORKING_STATE_CORE_V1:** CLOSED
- **036B — VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1:** CLOSED
- **036C — VIDEO_GENERATION_WORKSPACE_AUTOSAVE_V1:** CLOSED
- **036D — VIDEO_GENERATION_VISIBILITY_TERMINOLOGY_AND_LEGACY_REUSE_V1:** CLOSED
- **036E-A — VIDEO_GENERATION_CALLER_WIDE_IDEMPOTENCY_HARDENING_V1:** CLOSED
- **036E-B — MIGRATION LEDGER OPERATIONAL RECONCILIATION:** CLOSED (DOCUMENT-ONLY)
- **036E-C — FINAL FUTURE-036 CLOSURE GATES AND EVIDENCE:** NEXT

## Delivery Evidence

- **Implementation PR:** [#114 — feat: enforce caller-wide clientRequestId idempotency policy across product callers](https://github.com/fmultiman/content-studio-ai/pull/114)
- **Implementation Head SHA:** `e3b80cb35508a8d1df8a9a4e9b945ff6060c55f1`
- **Merge Commit SHA:** `0d149e1ef7d25bfb49fd559de94bde62f89112fc`
- **Focused Test Suite:** 272 / 272 PASS across all video caller, route, and boundary suites
- **Full Test Suite:** 4,229 / 4,231 PASS (0 failures owned by 036E-A; 2 pre-existing Static Creative Editor expectation failures documented and out of scope)
- **Build:** `npm run build` exit code 0
- **Scope Safeguards:** Zero database migrations, zero DDL, zero migration ledger mutation, zero paid provider calls

## Idempotency Policy (POLICY A)

First-party paid video generation submissions now carry stable idempotency keys. Replay of the same logical submission with the retained key cannot invoke the paid provider twice.

- **First-Party Product Callers:**
  - All first-party UI submission flows unconditionally generate and send a unique UUID `clientRequestId`.
- **API Boundary Compatibility:**
  - `POST /api/video-generations` retains optional compatibility for `clientRequestId`. If a third-party or scripted caller omits the key, standard execution proceeds without failing.
- **Server Enforcement:**
  - When `clientRequestId` is present, `video_generations` enforces atomicity via the partial unique index `uq_video_generations_user_client_request` on `(user_id, client_request_id)`.
  - Replay with identical fingerprint returns the existing record without second provider invocation.
  - Replay with altered payload returns `409 IDEMPOTENCY_KEY_REUSED` prior to provider execution.

## Runtime Reachability & Caller Inventory

| Caller | Status | Lifecycle & Behavior |
|---|---|---|
| `app/(dashboard)/videos/geracoes/[sessionId]/page.tsx` | **Active / Reachable** (Primary UI) | Bound to `currentClientRequestId = useRef(crypto.randomUUID())`. Retains key across ambiguous network/5xx outcomes; rotates to fresh UUID strictly upon confirmed server acceptance. |
| `components/videos/create-video-generation-dialog.tsx` | **Dormant / Not Product-Reachable** (Compatibility component retained for test suites) | Bound to `currentClientRequestId = useRef(crypto.randomUUID())`. Hardened with identical semantics: retains key across ambiguous network outcomes and dialog close/reopen while unresolved; rotates strictly upon confirmed acceptance or new form reset. |

## Persistence Boundary & Reload Guarantees

- **Mounted First-Party Flow:** Within a mounted submission flow, the same logical submission retains its idempotency key across ambiguous responses and supported close/reopen behavior.
- **Browser Reload / Remount Boundary:** Full browser reload or route unmount/remount does not preserve the in-memory ref key.
- **Session-Based Mitigation:** The primary active generation surface is the Resumable Generation Workspace (`/videos/geracoes/[sessionId]`). Upon reload or remount, the workspace automatically queries `GET /api/video-generations?sessionId=[id]`. Any server-recorded attempt (in `submitted`, `processing`, or `succeeded` status) is hydrated into the **Attempt Timeline**, eliminating ambiguity and preventing accidental duplicate submissions.
