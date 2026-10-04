# VIDEO_GENERATION_VISIBILITY_TERMINOLOGY_AND_LEGACY_REUSE_V1 (FUTURE-036, slice 036D)

Production visibility, terminology separation, and legacy reuse architecture for the video generation domain.

## Status

- **036A — VIDEO_GENERATION_WORKING_STATE_CORE_V1:** CLOSED
- **036B — VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1:** CLOSED
- **036C — VIDEO_GENERATION_WORKSPACE_AUTOSAVE_V1:** CLOSED
- **036D — VIDEO_GENERATION_VISIBILITY_TERMINOLOGY_AND_LEGACY_REUSE_V1:** CLOSED
- **036E — OPERATIONAL HARDENING:** CLOSED (036E-A, 036E-B, 036E-C)
- **FUTURE-036 — VIDEO_GENERATION_WORKSPACE_AND_SESSION_PARITY_V1:** COMPLETE

## Delivery Evidence

- **Implementation PR:** [#112 — VIDEO_GENERATION_VISIBILITY_TERMINOLOGY_AND_LEGACY_REUSE_V1](https://github.com/fmultiman/content-studio-ai/pull/112)
- **Merge Commit SHA:** `064a97b1030fd36a7ab1b630e94afa6cfb31ce6f`
- **Vercel Production Deployment:** SUCCESS (`https://vercel.com/fmultimans-projects/content-studio-ai/6u6GD7mvETCLUxmf2STDqQkJmen6`)
- **Focused Test Suite:** 144 / 144 PASS (100%)
- **Full Test Suite:** 4,141 / 4,143 PASS (0 failures owned by 036D; 2 pre-existing Static Creative Editor expectation failures documented and out of scope)
- **Build:** `npm run build` exit code 0 cleanly generating dynamic route `ƒ /api/video-generations/[id]`, dynamic workspace `ƒ /videos/geracoes/[sessionId]`, and static hub `○ /videos`.
- **Responsive Production Smoke:** 1440×900, 768×1024, 390×844 verified live on `content.multihuman.com.br` with zero horizontal overflow.

## Domain Model & Terminology

| Concept | Nature | Surface | Actions |
|---|---|---|---|
| `VideoGenerationSession` | Mutable, resumable AI generation workspace | `/videos` (Gerações IA) & Production (Gerações IA) | `Continuar` → `/videos/geracoes/[id]` |
| `VideoGeneration` (legacy standalone) | Immutable submitted attempt (`session_id = null`) | `/videos` (Gerações IA) & Production (Gerações IA) | `Assistir`, `Reutilizar configurações`, `Salvar em Arquivos` |
| `VideoGeneration` (session-owned) | Immutable submitted attempt (`session_id = uuid`) | Child of Session in Workspace timeline & Session card summary | Summarized within parent Session card; not duplicated as standalone |
| `VideoDraft` | Downstream authoring & multi-scene composition | `/videos` (Edições) & Production (Edições) | `Abrir` / `Abrir Rascunho` → `/creative-editor/video/[id]` |

`Generation != Composition`, `VideoGeneration != VideoDraft`, `VideoGeneration != VideoGenerationSession`.

- **Hub CTA:** Provider-neutral `Gerar vídeo com IA` at the product level. Provider details (`Kling API` / `Kling MCP`) remain factual inside configuration selectors.
- **Independent Empty States:** Zero coupling between AI generations and Creative Editor drafts. Empty states render independently (`Nenhuma geração IA...` vs `Nenhuma edição de vídeo...`).

## Legacy Reuse Settings Flow

1. User clicks **"Reutilizar configurações"** on a standalone historical attempt (`session_id = null`).
2. Generates a fresh client UUID and routes to:
   `/videos/geracoes/[newSessionId]?new=1&project=[projectId]&production=[productionId]&reuseGenerationId=[attemptId]`
3. Workspace securely reads the attempt via `GET /api/video-generations/[id]?projectId=...&productionId=...` (strictly user/project/production scoped server-side).
4. Seeds workspace state via pure `attemptToWorkingState()` mapping (036A authority).
5. Reconciles seeded parameters against current provider capabilities (`reconcileSelection`).
6. Enters normal 036C debounced autosave lifecycle (creates new Session record in DB via `PUT`).
7. **Invariance:**
   - Original attempt remains untouched with `session_id = null` (never backfilled or mutated).
   - Zero automatic generation or provider billing.
   - Zero automatic VideoDraft creation.
   - Existing persisted sessions ignore `reuseGenerationId` query parameters to prevent accidental hydration overwrite.

## Security & API

- **`GET /api/video-generations/[id]`:**
  - Authenticated session required.
  - Strict tenant isolation (`user_id`).
  - Context enforcement: `projectId` and `productionId` required as query parameters; mismatches return safe 404.
  - Minimal response projection: only reusable fields returned; zero internal credentials, tokens, or fingerprints exposed.
- **`GET /api/video-generation-sessions?all=true`:**
  - Supports caller-owned session listing across productions for the root `/videos` Hub.
  - Strict user-id filtering enforced in DB query (cannot leak cross-tenant sessions).
  - Eliminates N+1 queries.
