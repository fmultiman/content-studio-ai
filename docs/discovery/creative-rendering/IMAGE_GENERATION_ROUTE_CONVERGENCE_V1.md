# IMAGE_GENERATION_ROUTE_CONVERGENCE_V1

Status: implementation closure for the route/workspace slice. This document records the implementation at branch `feat/image-generation-route-convergence-v1`.

## Provenance and scope

- Starting `origin/main`: `3a299c2f7a7aefe596e371025bab96162456f741`.
- Starting and switched branch HEAD: the same SHA; the existing worktree was reused.
- Architectural authority: `GENERATION_SESSION_AND_REVIEW_ARCHITECTURE_CONVERGENCE_V1.md`, `IMAGE_GENERATION_SESSION_AND_ATTEMPT_FOUNDATION_V1.md`, and the autosave regression audit.
- No schema migration was needed. Foundation migrations 050–053 already provide the Session and Attempt entities.
- No provider was called during implementation or verification.
- Review convergence, Video changes, Library semantics, approval semantics, and full autosave hardening remain outside this slice.

## Route map

| Surface | V1 behavior |
| --- | --- |
| `/imagens` | Image generation hub. A user chooses scope and explicitly creates a Session, so visiting the hub does not create empty Sessions. Existing Sessions are listed as resumable generations. |
| `/imagens/geracoes/[sessionId]` | Canonical resumable ImageGenerationSession workspace. Hydration reads the Session and normalized Attempts. |
| `/imagens/rascunhos` | Temporary compatibility redirect to `/imagens`; it no longer acts as a second generation hub. |
| `/imagens?draft=[id]` | Compatibility lookup resolves the migrated Session by `legacy_image_draft_id` and redirects to the canonical workspace when possible. |

The UI uses human terms such as “Geração”, “Continuar”, and “Histórico”. `Session` and `Attempt` remain domain terms rather than required labels.

## Session hydration and persistence

The canonical workspace loads `/api/image-generation-sessions/[id]` and `/api/image-generation-attempts?sessionId=[id]`. It restores Project, Production, editable description, generated prompts, prompt details, auto mode, model, generation configuration, current output pointer, status, and legacy evaluation metadata. Output URLs are resolved through the existing signed URL boundary.

The hub creates a Session only after the user chooses a Project and Production and activates “Criar na Production”. Creation uses the existing server-side scope validation. The API still permits a valid nullable Production for callers that have a project-only workflow.

Canonical working state is persisted through the existing Session PATCH/CAS contract. A short debounce and one in-flight save are retained for functional resumability. The route does not claim to close every unload or SPA route-exit loss window; single-flight/coalescing, durable flush, conflict UX, and exhaustive save-state semantics belong to `GENERATION_SESSION_AUTOSAVE_RELIABILITY_V1`.

New canonical work does not call `/api/image-drafts` and does not create new ImageDraft rows. The old API/table remain readable for compatibility and for the legacy review bridge.

## Attempt-before-provider invariant

Both first-party provider paths accept `sessionId` and a stable `clientRequestId` for canonical work:

- `/api/openai/generate-image` calls `freezeAndClaimImageAttempt` before its OpenAI fetch.
- `/api/nanobanana/generate` calls `freezeAndClaimImageAttempt` before its NanoBanana fetch.

The server loads the owner-scoped Session, verifies Project and Production ownership/relationship, freezes submitted prompt/provider/model/config/source snapshot, computes the request fingerprint, and claims the queued Attempt. A replay of the same client request returns the existing Attempt/result without dispatching another provider request. A conflicting reuse of the same request ID is rejected.

The Attempt request snapshot is immutable through the lifecycle API. Provider lifecycle updates may set `processing`, provider task identity, failure details, result metadata, and terminal status. They cannot change the submitted prompt, provider, model, config, source snapshot, or request identity.

OpenAI links its existing/generated image row to `image_generation_attempts.result_image_id`. NanoBanana stores its existing `generation_tasks` row, binds the local task ID to `provider_task_id`, and the status endpoint ingests the completed remote image through the existing protected storage path. Output ingestion is retry-safe and updates the Session current-output pointer using a revision comparison; a concurrent Session edit is never overwritten silently.

## History and reuse

Canonical history is read from Session → normalized Attempts → output rows. The UI maps that result to the existing history presentation, preserving sequence, prompt, provider/model, timestamp, output, and migrated `legacy_evaluation`. The old mutable `generation_attempts` JSON is not the canonical source for the new workspace.

Selecting a historical prompt/refined prompt updates the current Session working state. It does not mutate the old Attempt and does not submit automatically. The next explicit Generate action creates a new Attempt.

The 29 migrated Sessions and 23 migrated Attempts are therefore reopenable without paid regeneration. The 22 output-linked historical Attempts resolve to existing image rows; the one historical Attempt with a null output remains historical and is not fabricated into a media row.

## Review and refined prompt compatibility

The shared Review framework is not implemented here. Migrated Session `legacyCurrentEvaluation` and Attempt `legacyEvaluation` are exposed as read-only compatibility metadata so existing review display can survive the route transition. The current evaluator endpoint and its known correctness limitations remain legacy behavior. New review persistence and context hardening are deferred to the Review convergence mission.

`refinedPrompt` remains advisory. Applying it changes current Session working state only; it never changes `submitted_prompt` on an existing Attempt and never triggers a provider call by itself. Library promotion and approval remain explicit existing actions. Attempt success does not create a LibraryFile, attach to Creative Editor, or approve an image.

## Compatibility and data impact

Read-only verification before and after this implementation found:

| Relation | Count |
| --- | ---: |
| `image_drafts` | 29 |
| `images` | 26 |
| `library_files` | 69 |
| `image_generation_sessions` | 29 |
| `image_generation_attempts` | 23 |

No row was deleted, no ImageDraft was dropped, no Image output was duplicated as bytes, and no LibraryFile was created. No VideoGeneration, VideoGenerationSession, VideoDraft, VideoScene, Creative Editor, or Undo/Redo data was changed.

The remaining legacy debt is explicit: old ImageDraft APIs and storage remain for compatibility; the legacy Image evaluator still stores/reads JSON-shaped evaluation data; old production pages may still link through `/imagens?project=...&production=...` and now land at the hub; and `/imagens/rascunhos` can be removed after downstream links and legacy evaluation reads are retired.

## Implementation diagram

```mermaid
flowchart TD
  P[Project + Production + server scope validation] --> H[Image generation hub /imagens]
  H --> S[ImageGenerationSession\nmutable working state]
  S --> W[/imagens/geracoes/sessionId]
  W --> F[freeze + claim Attempt]
  F --> A[immutable submitted request]
  A --> O[provider execution + Image output]
  O --> R[normalized history/result pointer]
  O --> L[explicit Save to Library]
  O --> C[explicit authoring handoff]
  R --> V[legacy Review display bridge]
  V --> Q[optional refined prompt]
  Q --> S
```

## Verification

- Focused provider, BYOK, callback, trust-boundary, credential-boundary, and convergence tests: passed (`123` tests in the combined focused runs, including the new route contract tests).
- TypeScript: passed.
- Production build: passed; the build manifest includes `/imagens/geracoes/[sessionId]`.
- Touched-scope ESLint: passed with existing hook warnings in the large legacy page; no errors.
- `git diff --check`: passed.
- Full Vitest: `3822` tests passed; the known Creative Editor label failures remain (`Estilo` vs `Estilos`). The repository's component test collection also reports 32 pre-existing `/@fs/D:/Traycer/...` path-resolution failures in this Windows worktree environment. No image route test is among those failures after the convergence contract assertion was corrected.
- Authenticated responsive Production smoke was not available in this execution context. No paid generation was used; desktop/tablet/mobile must be run with an authenticated non-paid Session in the next environment-enabled verification pass.

## Exact next mission

`GENERATION_SESSION_AUTOSAVE_RELIABILITY_V1` should harden both `/imagens/geracoes/[sessionId]` and `/videos/geracoes/[sessionId]`: debounce semantics, single-flight queues, CAS conflict handling, SPA route-exit flush, unload behavior, save/error/conflict UX, and resumability guarantees. It must not start Review convergence or legacy cleanup as part of that work.
