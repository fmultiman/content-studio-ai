# VIDEO_GENERATION_WORKSPACE_SESSION_PARITY_V1_FINAL_CLOSURE (FUTURE-036)

Final architectural, operational, and delivery closure for initiative **FUTURE-036: VIDEO_GENERATION_WORKSPACE_AND_SESSION_PARITY_V1**.

---

## 1. Initiative Purpose & Executive Summary

FUTURE-036 established a first-class, resumable working state model for AI video generation, elevating generation to parity with other media workflows while preserving clean architectural boundaries:
1. **Resumable AI Generation Workspace:** Replaced the legacy one-shot dialog with an auto-saving, conflict-resilient workspace backed by durable `VideoGenerationSession` records.
2. **Lineage & Authority Invariants:** Maintained strict decoupling between working draft state (`VideoGenerationSession`), immutable submitted execution attempts (`VideoGeneration`), and downstream authoring/composition (`VideoDraft`).
3. **Full Product Visibility & Legacy Reuse:** Grouped video activity across both the root `/videos` Hub and Production detail pages into *Gerações IA* and *Edições*, providing a secure, non-destructive "Reutilizar configurações" bridge for standalone historical attempts without backfill.
4. **Caller-Wide Idempotency Hardening:** Enforced mandatory `clientRequestId` generation and ambiguity retention across all first-party UI submission flows while preserving backward compatibility for API callers.
5. **Operational Migration Governance:** Established documented governance and audit evidence for historical ledger-only drift (migrations 039, 045, 049) without re-running DDL or hand-editing metadata.

---

## 2. Canonical Domain Model

| Entity | Role & Lifecycle | Authority & Storage |
|---|---|---|
| **`VideoGenerationSession`** | Mutable, resumable working state of a video generation in progress. | Client-side autosave loop via `PUT`/`PATCH` to `video_generation_sessions`. Schema 036A (`VideoGenerationWorkingStateV1`). |
| **`VideoGeneration`** (Attempt) | Immutable snapshot of a submitted generation request, provider execution metadata, and result lifecycle. | Created upon explicit "Gerar vídeo" via `POST /api/video-generations`. Linked via nullable `session_id` FK. |
| **`VideoDraft`** | Downstream multi-scene composition and timeline authoring in the Creative Editor. | Independent authoring tables (`video_drafts`, `video_scenes`). Never coupled to raw AI generation attempts. |

### Core Architectural Invariants:
- `Generation != Composition`
- `VideoGeneration != VideoDraft`
- `VideoGeneration != VideoGenerationSession`
- `Render != Save`
- `Generated Media = Source Media First`
- `Session stored state != provider submission authority`: The submitted request body is built exclusively from the explicit current form state at click time, never from stale reloaded session state.

---

## 3. Slice Delivery Matrix

| Slice | Title | Status | Deliverables & Artifacts |
|---|---|---|---|
| **036A** | VIDEO_GENERATION_WORKING_STATE_CORE_V1 | **CLOSED** | PR #98. Versioned working state schema (`working-state.ts`), `attemptToWorkingState()`, capability reconciliation, source identity model. |
| **036B** | VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1 | **CLOSED** | PR #100. Database schema (migration 049), `video_generation_sessions` table, server-owned writes, compare-and-swap optimistic concurrency (`expectedUpdatedAt`), session-scoped attempt listing. |
| **036C** | VIDEO_GENERATION_WORKSPACE_AUTOSAVE_V1 | **CLOSED** | PR #103, PR #104. Workspace route (`/videos/geracoes/[sessionId]`), `VideoGenerationForm` extraction, lazy session creation, 800ms coalescing single-flight autosave, conflict resolution UX, pre-generate flush, attempt timeline & status refresh. |
| **036D** | VIDEO_GENERATION_VISIBILITY_TERMINOLOGY_AND_LEGACY_REUSE_V1 | **CLOSED** | PR #112, PR #113. Terminology overhaul (*Gerações IA* vs *Edições*), `/videos` Hub productization, Production detail visibility, secure single-attempt endpoint (`GET /api/video-generations/[id]`), standalone legacy reuse flow. |
| **036E-A** | VIDEO_GENERATION_CALLER_WIDE_IDEMPOTENCY_HARDENING_V1 | **CLOSED** | PR #114, PR #115. Caller-wide `clientRequestId` enforcement (POLICY A), ambiguity retention across network drops and dialog close/reopen, dormant legacy dialog hardening, reload persistence boundary documentation. |
| **036E-B** | VIDEO_GENERATION_MIGRATION_LEDGER_OPERATIONAL_RECONCILIATION_V1 | **CLOSED** | PR #116. Catalog audit of 039/045/049, DOCUMENT-ONLY decision, future migration governance rules, operational risk documentation. |
| **036E-C** | VIDEO_GENERATION_WORKSPACE_SESSION_PARITY_FINAL_CLOSURE_V1 | **CLOSED** | Current PR. Full regression test gates, build verification, production smoke verification, canonical documentation closure. |

**Initiative Status:** **FUTURE-036 COMPLETE**

---

## 4. Final Product Behavior

### `/videos` Hub:
- Grouped into two independent sections: **Gerações IA** and **Edições**.
- Top-level CTA: Provider-neutral **"Gerar vídeo com IA"** (routes to a fresh workspace with client-generated UUID).
- **Session Cards:** Render prompt excerpt, attempt count, newest attempt status, context, and **"Continuar"** action.
- **Legacy Attempt Cards:** Standalone historical attempts (`session_id = null`) provide **"Assistir"**, **"Salvar em Arquivos"**, and **"Reutilizar configurações"**.
- Session-owned attempts are summarized inside their parent session card and never duplicated as standalone cards.
- **VideoDraft Cards:** Open canonical Creative Editor (`/creative-editor/video/[id]`).
- Independent empty states: Each group renders its own truthful empty state without collapsing the other.

### Resumable Generation Workspace (`/videos/geracoes/[sessionId]`):
- **Lazy Creation:** Empty workspaces write nothing to the database on mount; sessions persist via `PUT` upon first meaningful edit or pre-generate flush.
- **Autosave Engine:** Single-flight save loop with 800ms debounce and state coalescing; optimistic concurrency Precondition (`expectedUpdatedAt`).
- **Conflict Handling:** HTTP 409 pauses autosave, preserves local input, and provides explicit choices ("Recarregar versão salva" vs "Manter minhas alterações").
- **Generate Flow:** Validates and flushes unsaved state to DB before paid submission; sends mandatory `clientRequestId` and `sessionId`. Form locks on ambiguous outcomes to prevent accidental double-billing.
- **Attempt Timeline:** Polls active attempts via `STATUS_REFRESH_MS`, updates status truthfully, and offers in-app playback and explicit Library promotion.

### Production Detail Page (`/projetos/[id]/producoes/[productionId]`):
- Video tab mirrors the hub grammar with **Gerações IA** and **Edições** subsections.
- Strict production scoping (`productionId` query parameter enforced server-side; zero cross-production leakage).
- Independent empty states for both domains.

### Legacy Reuse Flow:
- Standalone attempts (`session_id = null`) offer **"Reutilizar configurações"**.
- Generates a new client UUID and navigates to `/videos/geracoes/[newUuid]?new=1&project=[pId]&production=[prodId]&reuseGenerationId=[attemptId]`.
- Secure endpoint `GET /api/video-generations/[id]?projectId=...&productionId=...` verifies server-side ownership.
- Form working state is seeded via pure `attemptToWorkingState()`, reconciled against current provider capabilities, and autosaved into a new session.
- Original attempt remains standalone (`session_id = null`); zero automatic generation; zero VideoDrafts created.

---

## 5. Idempotency & Persistence Policy (POLICY A)

- **First-Party UI Mandate:** All first-party generation submission flows unconditionally generate and transmit a unique UUID `clientRequestId`.
- **API Boundary Compatibility:** `POST /api/video-generations` keeps `clientRequestId` optional for external or scripted clients without breaking backward compatibility.
- **Database Enforcement:** Unique partial index `uq_video_generations_user_client_request` prevents concurrent same-key insert races. Replays with matching fingerprints return the existing attempt; conflicting payloads return `409 IDEMPOTENCY_KEY_REUSED`.
- **Persistence Boundary:** Within a mounted first-party submission flow, the same logical submission retains its idempotency key across ambiguous responses and supported close/reopen behavior. Full browser reload or route unmount/remount does not preserve the in-memory ref key; the primary Workspace recovers server-recorded Attempts through Session history.

---

## 6. Migration Governance (DOCUMENT-ONLY)

- **Factual Physical Status:** Migrations 039 (`video_generations`), 045 (`source_image_id`), and 049 (`video_generation_sessions` + idempotency columns) are physically present, active, and verified in the Production database.
- **Ledger Status:** Absent from `supabase_migrations.schema_migrations` (historical ledger-only drift).
- **Decision:** **DOCUMENT-ONLY.** No synthetic timestamps invented; no fake/dummy migrations created; no manual SQL insertions into `schema_migrations`; zero DDL re-execution.
- **Future Governance Rule:** Future schema-changing initiatives must adopt official timestamped migrations (`supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`) containing real SQL, with emergency SQL Editor execution reconciled via official CLI repair tools.

---

## 7. Deferred Items (Out of Scope for FUTURE-036)

The following items are explicitly classified as separate future roadmap initiatives and were not absorbed into FUTURE-036:
1. **Video Native Evaluator / Temporal Review:** Quality scoring, timeline feedback, and review loops.
2. **AI Prompt Assistance:** Prompt expansion, Project Identity prompt synthesis, and conversational rewriting.
3. **Second Provider Proof:** Adding additional video generation providers beyond Kling.
4. **External Browser Bridge:** Automated recording or capture via browser automation.
5. **Session Retention & Archival:** Lifecycle pruning or soft-delete UI for old sessions.
6. **Promotion Crash-Window Hardening:** Hardening unique constraints on library promotion.
7. **LibraryFile Permanent-Delete Hazard:** Garbage collection and cascading delete safety for promoted source files.
8. **Billing Observability:** Dedicated provider quota and credit usage ledger dashboard.
9. **Application-Managed Credential Encryption:** Extending AES-256-GCM encryption to user-supplied BYOK API keys.

---

## 8. Verification & Delivery Evidence

- **Focused Test Suite:** 272 / 272 PASS across all video generation, workspace, hub, API, and boundary suites.
- **Full Test Suite:** 4,229 / 4,231 PASS across 217 test files (0 failures owned by FUTURE-036; 2 pre-existing Static Creative Editor expectation failures documented and out of scope).
- **Typecheck:** `npm run typecheck` → 0 errors.
- **Lint:** Clean across all initiative files.
- **Build:** `npm run build` → Exit code 0.
- **Responsive Production Smoke:** 1440×900, 768×1024, 390×844 verified live on `content.multihuman.com.br` with zero horizontal overflow and truthful domain representation.
- **Production Deployments:** Slices 036A, 036B, 036C, 036D, 036E-A, and 036E-B deployed to Production with reported SUCCESS.

---

**FINAL MARKER:**
`VIDEO_GENERATION_WORKSPACE_SESSION_PARITY_V1_COMPLETE`
`FUTURE_036_COMPLETE`
