---
kind: spec
title: "Generation Draft Autosave and Resume Regression Audit V1"
comments: none
---

# GENERATION_DRAFT_AUTOSAVE_AND_RESUME_REGRESSION_AUDIT_V1

Status: complete. TERRA read-only evidence reviewed by SOL. No fixes made.

## Delegation and safety

- TERRA delegation actually executed: YES.
- Audited HEAD: 54ed6f74151f0ddde07bce50ec9147e578fb50ed.
- TERRA repository writes: none.
- Authenticated Production smoke: not performed; no authenticated session was available and login was not requested.
- Disposable records/mutations/cleanup: none.
- Paid image/video generation calls: 0.

## Domain map and terminology

| Domain | Current owner and route | Classification |
|---|---|---|
| ImageDraft | /imagens and /api/image-drafts; /imagens/rascunhos lists and links to /imagens?draft=id | ACTIVE CURRENT GENERATION DOMAIN |
| VideoDraft | /creative-editor/video/[draftId] and /api/video-drafts; /videos and /videos/rascunhos are hubs | ACTIVE CURRENT AUTHORING DOMAIN, NOT GENERATION DOMAIN |
| Video Generation Session | /videos/geracoes/[sessionId] and /api/video-generation-sessions | ACTIVE CURRENT GENERATION DOMAIN |
| generation attempts/history | video_generations and /api/video-generations | submitted immutable attempt/history, separate from Session |
| /videos?draft | proxy to canonical Creative Editor | LEGACY BUT SUPPORTED |
| /videos/rascunhos | direct draft list/delete hub opening canonical editor | ACTIVE CURRENT AUTHORING HUB; not generation |

ImageDraft, VideoDraft, image generation working state, and Video Generation Session are distinct. A Video Generation Session is not VideoDraft/VideoScene authoring state.

## Image generation autosave and resume

Owner: app/(dashboard)/imagens/page.tsx with POST/PATCH/GET /api/image-drafts. Persisted fields include prompt, prompt_details, evaluation, generation attempts/current attempt, image status, current image reference, selected model, project, and production. Creation is lazy on first autosave when Production is present; later saves PATCH the owner-scoped row. Hydration signs referenced images. updated_at orders the hub; generation_attempts are generation history, not save history.

Autosave is an 800ms debounce. It has no optimistic revision, single-flight/coalescing, abort/version guard, or saved/error indicator. Unmount cancels the timer. beforeunload calls ordinary async autoSaveDraft without keepalive/sendBeacon and does not await; there is no pagehide/visibility flush.

| Area | Status | Evidence |
|---|---|---|
| Image generation autosave | PARTIAL | completed debounce saves work; immediate exit and concurrency are unsafe |
| Image generation resume | PARTIAL | persisted rows hydrate after completed save; unsaved exit is lossy |
| ImageDraft | PASS | active generation draft authority |
| /imagens/rascunhos | PASS | active list/delete/resume hub for persisted rows |

Scenario A, edit then wait beyond debounce, normally persists and hub return restores form fields, model, status, evaluation, attempt history, and current image reference. Scenario B, immediate exit, can lose edits for the full 800ms plus network completion. Scenario C, reload/close, is best effort only. Scenario D, hub return, restores only successfully persisted state.

High-severity concurrency repro: begin an autosave POST, edit again before the first response updates currentDraftId, let the next timer fire, and leave. Two POSTs can be created because both still see a null id; overlapping PATCHes can last-write-wins. Bounded follow-up: keyed single-flight/coalescing saver, server expectedUpdatedAt CAS, and unload-capable flush.

## VideoDraft authoring autosave and resume

Owner: app/(dashboard)/creative-editor/video/[draftId]/page.tsx with GET/PATCH /api/video-drafts. It hydrates name, scenes, timeline, canvas, project, and Production context. Explicit Save has status/error feedback. Optional autosave is a localStorage preference, OFF by default, with an 800ms debounce. There is no pagehide/beforeunload flush; router.push('/videos') does not flush. No optimistic revision or single-flight guard exists.

| Area | Status | Evidence |
|---|---|---|
| VideoDraft | LEGACY / NO LONGER APPLICABLE as generation state | active authoring state, not generation |
| /videos/rascunhos | LEGACY / NO LONGER APPLICABLE as generation route | active authoring hub; persisted resume works |
| VideoDraft autosave/resume | PARTIAL | opt-in completed autosave resumes; immediate exit and concurrent saves can lose data |

Concurrency repro: enable Auto-save, make edit A while PATCH is pending, make edit B, force B response before A, then reload. A can overwrite newer state and an older response can mark stale local state saved. Bounded follow-up: keyed single-flight/coalescing saver plus expectedUpdatedAt/document revision.

## Video Generation Session autosave and resume

Owner: /videos/geracoes/[sessionId]/page.tsx with /api/video-generation-sessions/[id]. The session is lazy-created by PUT on first meaningful edit/generation, then PATCHed. PATCH uses expectedUpdatedAt compare-and-swap. executeSaveLoop provides single-flight coalescing. Debounce is 800ms. Indicators include Salvo, Salvando, Erro ao salvar, and Conflito. Attempts/history are submitted to /api/video-generations and remain separate.

Persisted working state is prompt, source, and selection: connection/provider transport, operation, model, duration, resolution, aspect ratio, audio, multi-shot, ASMR, and prompts. Project and Production scope are immutable. Hydration reconciles unavailable model/connection choices in memory with a visible notice; it does not create history.

| Area | Status | Evidence |
|---|---|---|
| Video Generation Session autosave | PASS | debounce, single-flight, CAS, indicators, retry/conflict behavior |
| Video Generation Session resume | PARTIAL | hydrate and hubs work; route-exit and hard-unload durability are best effort |

Scenario A normally persists after 800ms. Scenario B invokes visibilitychange/pagehide flush, but ordinary fetch cannot guarantee completion during unload. Scenario C remains best effort. Scenario D resumes at /videos/geracoes/[sessionId]. The SPA Voltar para a Produção button calls router.push without awaiting flushSave, so immediate edit followed by that action can lose state. Generation submit explicitly flushes and refuses on save failure/conflict.

## Resume and restoration

- /imagens/rascunhos links persisted ImageDraft rows to /imagens?draft=id.
- /videos lists VideoDrafts, sessions, and attempts; session cards link to /videos/geracoes/[sessionId].
- Production pages link sessions to the same session route.
- /videos/rascunhos opens canonical VideoDraft authoring.
- Image resume restores persisted prompt/form state, selected model, mode/status/evaluation, generation attempts, current image, project, and Production.
- Video Session resume restores prompt/source/selection and immutable project/Production scope; unavailable model/provider choices are reconciled.
- VideoDraft resume restores name/scenes/timeline/canvas.
- Session attempts/history remain in video_generations and are not copied into VideoDraft or working state.

## Findings and bounded follow-ups

1. ImageDraft immediate exit can lose edits inside the 800ms debounce plus network window; overlapping saves can duplicate or overwrite. Severity high. Follow-up: GENERATION_DRAFT_AUTOSAVE_AND_RESUME_REGRESSION_CORRECTION_V1_IMAGE.
2. VideoDraft autosave is opt-in, immediate route/close has no flush, and overlapping PATCHes can reorder. Severity high for users relying on autosave. Follow-up: GENERATION_DRAFT_AUTOSAVE_AND_RESUME_REGRESSION_CORRECTION_V1_VIDEODRAFT.
3. Video Generation Session core persistence is sound, but SPA route exit bypasses flush and hard unload remains best effort. Severity medium/high. Follow-up: GENERATION_DRAFT_AUTOSAVE_AND_RESUME_REGRESSION_CORRECTION_V1_SESSION.

These persistence findings are separate from Creative Editor history. Persistence is durable authored/generation truth; history remains local interaction safety. No implementation is started by this mission.

GENERATION_DRAFT_AUTOSAVE_AND_RESUME_REGRESSION_AUDIT_V1_FINDINGS
