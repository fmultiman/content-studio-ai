# Phase 2F0 — Static Output Lifecycle & Persistence Architecture

**Nature:** Read-only architecture study. No schema, migration, API, UI, or source change was made in this phase. Evidence labels used throughout: **FACT** (verified in code/schema/docs), **INFERENCE** (reasoned from facts, not directly stated), **RECOMMENDATION** (a proposed decision), **OPEN QUESTION** (unresolved, needs product input).

## 1. Executive Summary

**FACT.** The domain already contains a complete, mature, production-deployed media-attachment system (`channel_piece_media`, M1–M6, "aprovados e em produção") and a complete generic file-storage entity (`library_files`) with a full upload/CRUD API surface, including one atomic route (`POST /api/channel-piece-media/upload`) that already performs the exact sequence a persisted render needs: S3 upload → `LibraryFile` creation → `ChannelPieceMedia` attachment, with failure compensation.

**FACT.** An earlier architecture study in this same phase family (`PHASE_2D0_CREATIVE_WORKSPACE_PRODUCT_ARCHITECTURE.md`, §14) already reached the same conclusion in principle: *"estático pode apontar output `LibraryFile` via `ChannelPieceMedia`; aprovação formal de artifact é lacuna"* ("a static output can point to a `LibraryFile` via `ChannelPieceMedia`; formal artifact approval is a gap"). This phase confirms that conclusion with a full schema/API audit and turns it into a concrete, minimal, implementable recommendation.

**RECOMMENDATION (headline):** Do not invent a new entity. When a user wants to keep a render, upload it through the existing `library_files` + `channel_piece_media` pipeline (`kind: 'image'`, attached to the ChannelPiece that produced it). This mirrors, field-for-field, the already-approved future flow for video (`CPM-D13`: `VideoDraft → renderização/exportação → LibraryFile (kind: 'video') → ChannelPieceMedia`). Everything else this phase considered — `RenderExecution`, authoring-state persistence, structured provenance, render history/versioning — is either already unnecessary given current usage patterns, or a deferred extension with no current product evidence forcing it now.

**Verdict: `EXISTING_OUTPUT_MODEL_SUFFICIENT`**

## 2. Scope

In scope: read-only domain audit of every entity touching render output, media attachment, approval, and publication; a lifecycle recommendation; a minimal implementation slice description (description only — not implemented).

Out of scope (per handoff, and confirmed nothing was touched): schema changes, migrations, new APIs, render persistence, UI changes, source commits. Also explicitly out of scope for this phase's *findings*, even though touched by adjacent phases: raw range sliders, badge wording, browser auth constraints, S3 browser preview, Creative Studio menu — these are 2E-B topics, not re-litigated here.

## 3. Current Render Behavior

**FACT.** `POST /api/creative/static-authoring/render` (added in `93911b0`, Phase 2E-A) validates auth/ownership/project-consistency, spawns `scripts/creative/run-authoring-render.mjs` as a child process, reads the resulting PNG from disk, and returns it as a base64 `image_data_url` in the JSON response. Nothing is written to any database table or any durable storage location. The render is a pure request/response round-trip — the PNG exists only in the child process's temp output file and the HTTP response body.

**FACT.** The identical script is spawned by the pre-existing, unauthenticated `/dev/creative-preview/render` route — confirmed in Phase 2E-B by driving it live in-browser: a real render of the actual `Portal Comunidades Alternativas` ChannelPiece content completed in ~8.3s and returned a correct 1080×1350 PNG. Render is synchronous and fast, not a long-running or externally-dispatched job.

**FACT.** Once the HTTP response is sent, the render output is gone unless the browser/client retains the data URL in memory. Refreshing the authoring page loses it. There is no "latest render" persisted anywhere today.

## 4. Current Domain Map

| Entity | Purpose | Owner | Key relations | Status field | Persistence |
|---|---|---|---|---|---|
| `Project` | Top-level container | `user_id` | 1—N `Production`, `EditorialContent`, `Image`, `LibraryFile` | `active` \| `archived` | table |
| `Production` | Organizational grouping | `user_id`, `project_id` | 1—N `EditorialContent` (nullable link) | — | table |
| `EditorialContent` | Editorial core message | `user_id`, `project_id` | 1—N `ChannelPiece` | `draft` \| `ready` \| `archived` | table |
| `ChannelPiece` | Channel-specific adaptation | `user_id`, `editorial_content_id` | 1—N `ChannelPieceMedia` | `draft` \| `ready` \| `approved` \| `archived` | table |
| `ChannelPieceMedia` | Attached-media join row | `user_id`, `channel_piece_id` | XOR → `Image` or `LibraryFile` | — (role: primary/thumbnail/carousel_item/background/attachment) | table, RLS, RPCs for reorder |
| `LibraryFile` | Generic project-scoped file | `user_id`, `project_id` (nullable) | referenced by `ChannelPieceMedia` | soft-delete via `deleted_at` | table + S3 |
| `Image` | AI-generated image (prompt-driven) | `user_id`, `project_id` (nullable) | referenced by `ChannelPieceMedia` | `draft` \| `generating` \| `approved` \| `rejected` | table + S3 |
| `ImageDraft` / `VideoDraft` | Ephemeral generation/editing session | `user_id`, `project_id`, `production_id` | none to `ChannelPiece` (by design, PUB-D21) | — | table (JSONB workspace state) |
| `generation_tasks` | Async external-provider job tracking | `user_id`, `project_id` | none to Creative render | pending/processing/completed/failed | table |
| `Distribution` | Publication act (scheduled/published/failed) | — | `channel_piece_id` | scheduled/published/failed/cancelled | **does not exist** (deferred, PUB-D4) |
| `ContentVersion` | Any kind of content versioning | — | — | — | **does not exist** (confirmed, PHASE_2D0 §15) |
| `RenderExecution` | Render job/process tracking | — | — | — | **does not exist**, not found anywhere in schema or docs |

## 5. LibraryFile

**FACT** (schema, `scripts/015_create_library_files.sql`, mirrored in `lib/types.ts`): `id, user_id, project_id (nullable), folder, name, kind ('image'|'video'|'audio'|'document'|'other'), mime_type, file_size, storage_provider, storage_path, public_url, thumbnail_url, deleted_at, created_at, updated_at`. RLS is plain `user_id = auth.uid()` on all four operations. No `metadata` JSONB column exists.

**FACT:** `uploadLibraryFile({ userId, filename, mimeType, buffer })` in `lib/storage/s3.ts` already accepts a raw in-memory `Buffer` (exactly what the static-authoring render route produces before base64-encoding it) and returns a stored-file descriptor. `POST /api/library-files` already creates the DB row from a stored descriptor (`CPM-D17` flow). `POST /api/channel-piece-media/upload` already composes both steps plus the `channel_piece_media` insert atomically, with S3/DB compensation on partial failure (Cases A–D, `CPM-D24`).

**Decision reference (already made in this codebase, not by this phase):** `CPM-D13` — *"VideoDraft → renderização/exportação → LibraryFile (kind: 'video') → ChannelPieceMedia"* — is the explicitly approved precedent for turning a rendering/export session's output into a durable, attachable asset. Static authoring's PNG output is the same shape of problem for `kind: 'image'`.

**RECOMMENDATION:** Every render the user chooses to keep becomes a `LibraryFile` with `kind: 'image'`, `project_id` = the authoring context's Project, uploaded through the existing `uploadLibraryFile` helper — no new storage code.

## 6. Image

**FACT** (schema, `scripts/001_create_tables.sql`, mirrored in `lib/types.ts`): `id, user_id, project_id (nullable), user_input (NOT NULL), generated_prompt, image_url, status ('draft'|'generating'|'approved'|'rejected'), model, aspect_ratio, style, metadata (JSONB)`.

**FACT:** `user_input` is `NOT NULL` — every row is required to carry a generation prompt. `model`, `style`, `aspect_ratio`, `generated_prompt` are all prompt/generation-specific fields with no meaning for a deterministic compositing render.

**FACT (`CPM-D6`):** approved AI-generated `Image` rows are already referenced directly via `channel_piece_media.image_id` — no promotion to `LibraryFile` required for that specific, existing workflow (the Images generation lab → Gallery → attach-to-piece flow).

**INFERENCE:** `Image` represents "AI generation, prompt-in / image-out," not "any image asset in the system." A static-authoring render has no prompt and is not a generation attempt in that sense — forcing it into `Image` would require populating meaningless values into `user_input`/`model`/`style` and would incorrectly surface compositing outputs inside the Images-lab UI/counts (`/imagens`, `/galeria` filter by `images.status = 'approved'`, per `PUBLICATION_DOMAIN_DECISIONS.md` §12).

**Decision:** rendered outputs should **not** reuse `Image`. `LibraryFile` is the correct fit (§5).

## 7. ChannelPieceMedia

Answering the phase's explicit questions, all from the fully-approved decision log (`docs/CHANNEL_PIECE_MEDIA_DECISIONS.md`, M1–M6, "em produção"):

1. **What does it represent today?** **FACT:** a typed join row that attaches exactly one existing asset (`Image` XOR `LibraryFile`) to a `ChannelPiece`, with `position`, `role`, and `alt_text`.
2. **Candidate, attached, or published media?** **FACT:** attached media. There is no "candidate" concept in the schema — a CPM row exists once created; there is no draft/pending CPM state. Publication (the external act) is explicitly modeled as a separate, deferred entity (`Distribution`, §8) and is never touched by CPM.
3. **Can it point to LibraryFile?** **FACT:** yes, via `library_file_id` (RESTRICT on delete).
4. **Can it represent a Creative Core generated image?** **FACT (mechanically):** yes — any `LibraryFile` row can be attached regardless of how it was created, including one created from a render. Nothing in the schema distinguishes "uploaded by hand" from "produced by a render."
5. **Does it have order?** **FACT:** yes — `position SMALLINT`, unique per `(channel_piece_id, position)`, deferrable for atomic reordering via the `organize_channel_piece_media` RPC.
6. **Does it have status/approval?** **FACT:** no. Approval lives one level up, on `channel_pieces.status`.
7. **Is it used by real publication?** **FACT:** it is the authority for "what media does this piece have" (read via `GET /api/channel-piece-media`), but there is no `Distribution`/external-publish consumer yet — that layer doesn't exist (§8).
8. **Does creating a CPM implicitly approve anything?** **FACT:** no. Creating a CPM row and approving the `ChannelPiece` (`status = 'approved'`) are independent actions; nothing in the RLS, RPCs, or API ties them together.
9. **Risk of mixing source asset and rendered output?** **INFERENCE:** low, by design — CPM never stores bytes or duplicates source metadata (`CPM-D2`, `CPM-D9`, `CPM-D19`, `CPM-D20` all explicitly remove derivable/duplicated fields); it is a pure reference. A rendered `LibraryFile` sits in the exact same table, with the exact same shape, as an uploaded one. No mixing risk because there is nothing to mix — both are "a LibraryFile the CP points to."

**Decision:** `ChannelPieceMedia` is the correct, already-built "attach this output to this piece" mechanism. No extension needed.

## 8. Current Publication Flow

**FACT (`PUBLICATION_DOMAIN_DECISIONS.md` §9, §19, PUB-D17):** `ChannelPiece.status` deliberately does **not** include `published`. The act of publication belongs to a separate entity, `Distribution` (`scheduled_at`, `published_at`, `status`, `external_id`, `external_url`, `error_message`), which is **explicitly deferred** — it requires social-platform API integration, a scheduling service, and webhook confirmation, none of which exist today. `ChannelPiece.status = 'approved'` is as far as the current system models "ready to go out."

**INFERENCE:** because `Distribution` does not exist, there is no concept of "published media" for a render to become — the phase's own materials anticipated exactly this and correctly told me not to invent one.

## 9. Current Approval/Status Model

**FACT (`PUBLICATION_DOMAIN_DECISIONS.md` §19, quoting `PRODUCTION_DECISIONS.md` D7):** *"IA aprova qualidade; humano aprova uso"* — `channel_pieces.status = 'approved'` is a manual, human, editorial decision with **no formal workflow** (no multi-step review, no roles). This is intentional (`PUB-D11`) and not a gap to close.

**FACT:** `images.status` has its own independent `approved`/`rejected` vocabulary, scoped to the AI-generation lab only.

**Decision:** there is no per-asset ("this specific visual is the approved one") approval concept distinct from `ChannelPiece.status`, and the domain decisions explicitly chose not to build one at this layer. For V0, `role = 'primary'` on the attached `LibraryFile` (§7) is "the visual currently representing this piece," and `ChannelPiece.status = 'approved'` is "this piece, text and visual together, is approved" — together these already answer "what is the approved output" without a new field.

## 10. Authoring State Persistence

**FACT:** `AuthoringState` today is pure React runtime state (`useState`/`useReducer` in the client component), re-derived fresh from server context (`createContextualAuthoringState`) on every page load. Nothing is persisted; leaving and returning to `/editar-visual` always resets primitive selection/transforms/content overrides to the initial computed defaults.

**FACT (precedent search):** `image_drafts` carries JSONB workspace-state columns added specifically for this purpose (`scripts/010_add_image_draft_workspace_state.sql`: `prompt_details`, `current_evaluation`, `generation_attempts`, `current_attempt`). `video_drafts.scenes` is a JSONB session-state column. **No equivalent column exists on `channel_pieces` or `editorial_contents`** — persisting `AuthoringState` today would require a genuinely new column; there is no existing JSON field to slot it into.

**RECOMMENDATION: DEFER.** The render is fast (~8s) and fully deterministic from real inputs (ChannelPiece content, Project Identity, and whatever primitive selection/transforms the user picks in the session); default primitive selection is already sensible (the project's starter-pack primitives). A single-session edit-then-render loop does not need resume-after-leaving until product evidence shows users routinely leave mid-edit and expect to return to a non-default state. Building a new persistence column now is exactly the "premature infrastructure" this phase was told to avoid.

**OPEN QUESTION:** if/when this is validated as needed, where should it live — a new nullable JSONB column on `channel_pieces` (mirroring the `video_drafts.scenes` precedent), or something scoped per-user-per-piece (since multiple users could theoretically edit the same piece)? Not resolved here; no evidence today forces the choice.

## 11. Generated Render Semantics

**FACT:** today, "generated render" = the in-memory/in-flight PNG returned by the render endpoint for the duration of one browser session. It has no identity beyond `render_id` / `output_identifier` (script-generated, not persisted) and `duration_ms`.

**Decision:** this ephemeral stage needs no persistence at all — it is correctly transient, exactly matching the phase's own inherited framing ("`latest/generated render` != `approved/published output`").

## 12. Saved Output Semantics

**RECOMMENDATION:** "Saved" = the user explicitly chose to keep a render → it becomes a `LibraryFile` (`kind: 'image'`, real `project_id`, sensible generated filename e.g. `channel-piece-<id>-<timestamp>.png`) via the existing upload pipeline (§5). No new "saved" flag or state is needed — existence as a `LibraryFile` row **is** "saved," identical to how an uploaded file's existence as a `LibraryFile` row is "saved" today. No parallel concept required.

## 13. Approved Output Semantics

**RECOMMENDATION:** "Approved output for this ChannelPiece" = the `LibraryFile` attached via `ChannelPieceMedia` with `role = 'primary'` (already unique per ChannelPiece, already enforced at the DB level via `uq_cpm_cp_primary`), combined with `ChannelPiece.status = 'approved'` for the editorial decision. This reuses two already-existing, already-enforced mechanisms — no new "approved artifact" flag. This matches PHASE_2D0's own identified gap language ("aprovação formal de artifact é lacuna") by explicitly choosing *not* to close that gap with new machinery, since `role = 'primary'` + `ChannelPiece.status` already gives the product a usable, correct-enough signal for V0.

## 14. Version/History Implications

**FACT:** `ContentVersion` does not exist anywhere in the schema (confirmed independently here and by `PHASE_2D0` §15: *"Nenhum registro immutable/versioned existe... Um novo render não cria versão hoje"*). Editing any entity in this domain (`ChannelPiece`, `VideoDraft.scenes`, etc.) overwrites in place; there is no history table, no snapshot, no diff anywhere in the codebase.

Classification:
- **AuthoringState persistence** → LATER (see §10) — not needed now, no existing field to extend into, no validated user need.
- **A render "capturing a snapshot" of the state used to produce it** → NOT JUSTIFIED now. No consumer would read it (no versioning UI, no diff view, no rollback flow exists or is planned in this phase family).
- **New render replacing/coexisting with the previous one** → follows directly from CPM's existing model: attaching a new `LibraryFile` as `role = 'primary'` demotes the old primary to `carousel_item` automatically (`CPM-D26`, already implemented and tested) — old outputs are **not deleted**, they simply stop being primary. This already gives a soft, correct-enough "history" (every previously-saved render remains a non-primary CPM row) without building a history feature.
- **Layout/edit history (undo/redo, named versions)** → LATER, explicitly out of scope of this phase and unsupported by any current entity.

## 15. Provenance Requirements

**FACT:** the render request already carries a request-scoped provenance-shaped payload: `context.{projectId, editorialContentId, channelPieceId}`, `primitiveSelection.{projectRef, paper, tape}`, `primitiveTransforms.{paper, tape}`, `identitySnapshot.snapshot_ref`, manifest `source` + `identity`. None of it is persisted anywhere today.

**FACT:** `LibraryFile` has no `metadata` JSONB column (unlike `Image`, which does). Persisting the full recipe (exact primitive keys, transforms, identity snapshot ref, template version) would require a new nullable column — an available, low-risk, additive pattern (precedented by `images.metadata`), but a genuine schema change nonetheless.

**Classification:**
- **NEEDED NOW (free, zero extension):** which Project, which ChannelPiece the output belongs to (given for free by the `ChannelPieceMedia` row itself), plus filename and `created_at` on `LibraryFile`.
- **LATER (minimal extension, not required for V0 usefulness):** a structured JSONB provenance snapshot (primitive selection, transforms, identity snapshot ref, template id) on `library_files` or on the CPM row, for the day reproducibility/versioning is actually needed.
- **NOT JUSTIFIED now:** anything beyond that (e.g., a full immutable render-recipe object model) — over-engineering relative to any evidenced need.

## 16. Storage Path

**FACT (confirmed end-to-end, not assumed):**
```
render (existing)          → in-memory PNG buffer
uploadLibraryFile()         → S3 object (lib/storage/s3.ts, already used by 2 other routes)
POST /api/library-files     → library_files row (already exists, already used by CPM-D17 flow)
POST /api/channel-piece-media (or the atomic /upload variant) → channel_piece_media row (already exists)
```
Every step of "render → validate → S3 → LibraryFile → output/media relation" already exists in production code, most of it consolidated in one atomic, compensating route (`/api/channel-piece-media/upload`). **No new storage subsystem is required** — only a wiring decision (call the existing atomic upload route with the render's buffer, or replicate its three steps inline in the render route) is left, and that is implementation, not architecture.

## 17. RenderExecution Assessment

**FACT:** no `RenderExecution`-shaped entity exists anywhere in schema or docs. The one precedented "job tracking" entity in the domain, `generation_tasks`, exists specifically because NanoBanana generation is a genuinely asynchronous, externally-dispatched, webhook-confirmed process (`task_id`, `callback_received_at`, `raw_response`).

**INFERENCE:** static authoring's render is synchronous, local, in-process, and completes in single-digit seconds (confirmed live at 8.3s in Phase 2E-B) — it does not share the problem shape that justified `generation_tasks`. There is no polling need, no external callback, no retry/backoff state to track.

**Answers:**
- Problem it would solve: tracking render attempts/failures/history as first-class rows. Not needed — the render endpoint already returns success/failure synchronously to the caller; nothing is lost by not persisting attempts.
- Does output persistence depend on it? No — persistence (§16) is orthogonal to execution tracking; you can save a render's *output* without ever tracking the *render job* as an entity.
- Premature infrastructure? Yes, given current scale (one synchronous render per click, no queue, no worker).
- Is current logging sufficient for V0? Yes — server-side `console.error` on failure plus the synchronous HTTP error response is proportionate to a single-request, single-user, in-process render.

**Decision: NOT NEEDED.**

## 18. Static/Timeline Compatibility

**RECOMMENDATION:** the chosen model generalizes without modification. `LibraryFile.kind` already spans `image | video | audio | document | other`; `CPM-D13` already defines the *identical* pattern for video (`VideoDraft → renderização/exportação → LibraryFile (kind: 'video') → ChannelPieceMedia`). A future Timeline render producing an MP4 would follow the exact same three-step path with `kind: 'video'` — no static-specific architecture was introduced, and none is needed for this to extend to JPEG or MP4 outputs later. This was verified as a property of the existing model, not designed anew in this phase.

## 19. Options Considered

| Option | Verdict | Why |
|---|---|---|
| New `RenderOutput`/`Artifact` entity | Rejected | `LibraryFile` + `ChannelPieceMedia` already cover every required capability; a new entity would duplicate storage/RLS/CRUD that already exists and is tested |
| Reuse `images` table for renders | Rejected | Schema requires generation-specific fields (`user_input` NOT NULL, `model`, `style`) that don't apply; would leak into Images-lab UI/counts |
| Reuse `library_files` (chosen) | **Accepted** | Exact fit: generic project-scoped file, already has full CRUD/API/S3 pipeline, already the precedent for video render output (`CPM-D13`) |
| Build `RenderExecution` job entity | Rejected (for now) | Render is synchronous and fast; no async/queue/webhook problem exists to justify it (contrast with `generation_tasks`, built for a genuinely async provider) |
| Persist `AuthoringState` now | Rejected (for now) | No existing JSON field to extend into; no validated resume-after-leaving need; would be new schema for an unproven requirement |
| Formal approved-artifact flag | Rejected (for now) | `role = 'primary'` (CPM) + `ChannelPiece.status = 'approved'` already give an adequate, already-enforced signal |
| Structured provenance snapshot column | Deferred, not rejected | Additive, low-risk, precedented (`images.metadata`) — but no consumer/need exists yet to justify building it now |

## 20. Minimal Extension Required

**None, to ship the recommended slice (§23).** Every table, column, RLS policy, RPC, and API route needed already exists. The only genuinely *optional* future extension identified is a nullable `metadata JSONB` column on `library_files` for structured render provenance (§15) — explicitly not required for V0 and not recommended to build until a concrete reproducibility/versioning need is validated.

## 21. Deferred Capabilities

- Authoring-state persistence (resume mid-edit across sessions) — §10
- Render/edit history, undo/redo, named versions, `ContentVersion` — §14
- Structured provenance snapshot (exact recipe replay) — §15
- `RenderExecution` job/attempt tracking — §17
- `Distribution` (real external publication) — §8, pre-existing, unrelated to this phase
- Output cleanup/retention policy — no evidence of "garbage renders" accumulating, because nothing is persisted unless the user explicitly attaches it; revisit only if/when unattached-but-stored renders become possible (they are not, under the recommended slice)

## 22. Recommended UX Lifecycle

Based on the domain (not on appearance):

```
[Renderizar] → resultado temporário (na sessão, nao persistido)
      │
      ├── usuário descarta / ajusta e renderiza novamente → nada é gravado
      │
      └── [Salvar nesta peça] (ação explícita)
              → cria LibraryFile (kind: image, project real)
              → cria ChannelPieceMedia (role: primary, ou carousel_item se já existir uma primary)
              → visível imediatamente na peça, sem estado "published" implícito
```

This matches the domain exactly: rendering never implicitly creates anything (§11); an explicit user action is what turns a render into a `LibraryFile`+`CPM` pair (§12); "approved" stays a separate, existing, human decision at the `ChannelPiece` level (§9, §13); nothing resembling "publish" is touched, because `Distribution` does not exist (§8). The alternative sketched in the handoff — "candidate output salvo automaticamente → [Aprovar]" — was considered and rejected: it would mean every render attempt silently creates a `LibraryFile` row (storage growth with no user intent behind it) and would invent an implicit-save behavior with no precedent anywhere else in this domain (uploads, image generation, and video export are all explicit user actions today).

## 23. Recommended Implementation Slice

Smallest slice that turns "render que aparece" into "output útil e persistente," using only existing infrastructure:

1. Add one action, **"Salvar nesta peça,"** to the render-result panel already present in `app/(dashboard)/.../editar-visual/page.tsx` (visible only after a successful render).
2. On click, convert the already-produced `image_data_url` to a `File`/`Blob` client-side and `POST` it to the existing `/api/channel-piece-media/upload` route (multipart, `file` + `channelPieceId`) — **zero new API routes**.
3. That route already performs S3 upload, `library_files` insert, and `channel_piece_media` insert atomically, with existing compensation logic — **zero new backend code**.
4. Server-side role assignment already follows the correct existing rule (first CPM for a piece → `primary`, subsequent → `carousel_item`) — correct default behavior for both single-image and carousel `ChannelPiece`s with **zero new logic**.
5. No schema change, no migration, no new entity, no approval/publish semantics touched.

Explicitly **not** part of this slice (per the handoff's own guardrails, and consistent with the evidence above): a full DAM/approval workflow, a render queue, worker infrastructure, or a premature versioning engine.

## 24. Architecture Verdict

**`EXISTING_OUTPUT_MODEL_SUFFICIENT`**

Every entity, constraint, RLS policy, and API route required to turn a static-authoring render into a persistent, product-useful output already exists and is already in production for the equivalent problem (uploaded media, and the explicitly-approved future video-export path). Nothing evidenced in this audit requires a new entity, a new column, or a new API to ship a working "save this render to the piece" action. The only identified extension (structured provenance metadata) is additive, optional, and correctly deferred pending real need.
