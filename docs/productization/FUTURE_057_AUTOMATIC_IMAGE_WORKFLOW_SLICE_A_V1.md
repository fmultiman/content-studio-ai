# FUTURE-057 — Automatic image workflow restoration, Slice A (core automation + manual authoring)

Status: **COMPLETE** — implemented, validated with mocked providers, and proven by one authorized Production smoke on 2026-10-11 (see "Production smoke"). Slice B (evaluation/refinement automation) and Video Slice 2 are out of scope.

Source audit: Traycer artifact `future-057-automatic-image-workflow-audit` (starting point `origin/main` `10184614c37ea557635140b3272bac1714e8d23f`).

## What Slice A delivers

Three coexisting flows in the canonical Image workspace (`/imagens/geracoes/[id]`), selected with a mode control:

| Mode | What the user does | Paid calls |
| --- | --- | --- |
| **Manual** | Types/edits the prompt directly (available from an empty state) and clicks **Criar Imagem** | one image submission per click |
| **Assistido** | **Criar com IA / Melhorar com IA** produce an *unapplied* suggestion; **Aplicar / Descartar** are manual; **Criar Imagem** is a separate action | text per click; image only on the explicit click |
| **Automático** | Writes a description and clicks **Gerar automaticamente** once | exactly **one** text call + **one** image submission |

`Create`, `Improve`, `Apply` and `Discard` never trigger image generation in any mode.

## Architecture (reuse, no new engine)

```
description (immutable request-time snapshot)
  -> POST /api/prompt-assistance {operation:'create', workflow:'automatic', provider/model of the selected assistant}
  -> validated prompt (non-empty, answered by the SAME provider/model that was selected)
  -> applied to the editable prompt + saved with the session (flushImageSubmission)
  -> existing idempotent image submit (/api/openai/generate-image or /api/nanobanana/generate)
       clientRequestId = the run id  (freezeAndClaimImageAttempt replays a duplicate)
  -> existing result / session / history
```

No new server route, table, ledger, credential path or Identity path. Project/Production ids are the only context the browser sends; the server still resolves ownership and normalizes Identity (`/api/prompt-assistance`). The image routes keep their own ownership, environment guards and Attempt idempotency.

**Browser-owned chain.** The Automatic run executes in the user's browser while the workspace is mounted. It is **not** a durable background job: closing the tab, losing connectivity or navigating away stops the *next* stage (see "Cancellation"). An image request that was already submitted cannot be recalled.

## Safety design

| Requirement | Implementation |
| --- | --- |
| Explicit start only | The only entry point is the **Gerar automaticamente** click. Nothing runs on load, hydration, autosave, preference change, mode change or a persisted `autoMode` flag (tests assert zero requests) |
| Preference is not authorization | `automation_enabled` is a client-writable *UX opt-in* that makes the Automático option selectable. The server never trusts it; the routes stay authenticated, owner-scoped, environment-guarded and idempotent regardless |
| Bounded | One text call + one image submission per start. No loop, no refinement, no Review. A failure is retried only by a new explicit click ("Tentar só a imagem" / "Gerar tudo de novo") with a **new** request id |
| Immutable snapshot | Project, Production, description, assistant provider/model and image model are frozen at the click; inputs are locked (`readOnly`/`disabled`) during the run so later edits cannot change what is sent |
| No silent substitution | The assistance answer must report the same provider and model that were requested, otherwise the run fails before any image request |
| Double-click | Synchronous `ref` lock on the run **and** on every image submission (also protects Criar Imagem and Gerar Novamente); the run id is the image `clientRequestId`, so a replay returns the same Attempt |
| Stale prompt bug removed | The historical chain generated from a stale React closure (and, for NanoBanana, fell back to the raw description). The prompt is now resolved once and passed explicitly to both submit paths; the description fallback is gone |
| Overwrite | An existing prompt is replaced only after an inline confirmation; the text stage must succeed first, and a failure/cancel leaves the authored prompt untouched. Applying a CREATE suggestion over an authored prompt asks as well |
| Partial states | Text failure → no image request, nothing applied. Image failure after a good prompt → prompt stays in the editor and is saved; user chooses retry-image-only (no new text spend) or run again |
| Cancellation | **Cancelar** aborts the text request and prevents the image stage. If the paid text answer still arrives, it is kept as an *unapplied* suggestion. During the image stage the UI says the image was already sent and cannot be cancelled. We do not claim in-flight provider charges can be cancelled |
| Navigation | Leaving/unmounting marks the run cancelled and aborts the text request; a `beforeunload` warning is active while a run is in flight |
| Usage | The text step is recorded once by the existing ledger path (idempotent keys). Image generation has **no** usage/cost instrumentation today and none is invented |
| Analytics label | `workflow: 'assisted' \| 'automatic'` is an optional strict enum on the assistance request, stored only in `provider_metadata.workflow`. It never selects a provider, authorizes, bills or attributes ownership; `automatic` is accepted only with `operation: 'create'` |

## Other behaviour changes

- **Manual authoring:** the prompt editor and the image-model selector are always rendered (previously the prompt field appeared only once a prompt existed, so a user could not type one). The legacy rule that *hid* the image-model selector when the global automation preference was on is removed.
- **Gerar Novamente:** now regenerates from the **complete, exact** current prompt. The local template simulator (`regeneratePrompt`) that truncated the prompt to two comma segments and appended random phrases was removed from the billable path and deleted. A fresh request id is used for each new image.
- **Mode persistence:** only "Automático is selected" is persisted (the existing session `autoMode` flag; every stored value is `false`). It is a selection, never an execution.

## Settings → Automação

| Control | Change | Stored value |
| --- | --- | --- |
| Ativar Automação | Relabelled **Permitir o modo Automático**; explains that nothing runs without clicking **Gerar automaticamente** | `automation_enabled` unchanged (default OFF) |
| Explainer box | Describes Manual / Assistido / Automático and the browser-owned run | — |
| Modelo Padrão de Imagem | Copy now says it is the default image model for all three flows; wrong "DALL-E" subtitle removed | unchanged |
| Ativar Avaliador | "Mostra o botão Avaliar (avaliação manual)"; the false "automaticamente" and stale "style profile" copy removed | unchanged |
| Máximo de Refinamentos | Shown **disabled** with "Reservado: o refinamento automático ainda não está disponível" | `max_refinement_iterations` preserved |
| Modo Automático Padrão | **Hidden** (inert) | `auto_mode_default` preserved and still sent unchanged on save |
| Salvar Histórico de Prompts | **Hidden** (inert; nothing reads or writes `prompts`) | `save_prompt_history` preserved; historical `prompts` rows untouched |

No Settings redesign and no Models tab. Saved preferences round-trip unchanged (tested).

## Files changed

`app/(dashboard)/imagens/page.tsx` (orchestration, locks, explicit-prompt submits, exact-prompt regenerate), `components/images/image-workflow-controls.tsx` (new: mode control + run panel), `components/images/image-input-section.tsx`, `components/images/prompt-section.tsx`, `app/(dashboard)/configuracoes/page.tsx` (copy + hidden controls), `lib/prompt-assistance/contract.ts` + `usage.ts` + `app/api/prompt-assistance/route.ts` (optional `workflow` label), `lib/ai-simulator.ts` (simulator removed). Tests: `components/images/automatic-image-workflow.test.tsx` (new), `components/settings/automation-settings.test.tsx` (new), `lib/prompt-assistance/__tests__/contract.test.ts` (new), extended `usage.test.ts`, `prompt-assistance-route.test.ts`, and the two Prompt Assistance UI tests updated for the always-visible editor.

## Validation (all providers mocked; no paid call)

Coverage (new `automatic-image-workflow.test.tsx`, 25 tests on the real `/imagens` shell): Manual authoring from empty state and explicit generation; image selector visible with the preference on; Assisted isolation and apply-over-authored confirmation; Automatic one-text/one-image path with the exact prompt, correct body, run-id idempotency key and zero Review/draft/history writes; NanoBanana and Gemini provider/model selection; model-substitution rejection; unconfigured image provider; synchronous double-click; locks and snapshot during a run; existing-prompt confirmation (cancel / confirm / failure preserves); prompt-stage failure; image failure after a good prompt with image-only retry and a new request id; cancel during the text stage; late paid answer after cancel; unmount mid-run; zero requests on load/hydration/autosave/mode changes with a persisted Automatic selection; preference OFF; exact-prompt Gerar Novamente; double-click on Criar Imagem. Settings: copy, hidden controls, preserved values on save, reserved slider, preference toggle makes no provider call. Server: `workflow` contract (strict, automatic⇒create), usage metadata (no effect on quantities/keys/attribution), route (recorded label, invalid → 400, ownership unaffected).

| Check | Result |
| --- | --- |
| Focused (image components, settings, prompt-assistance, route) | PASS |
| Full suite | 5108 tests / 279 files: **5105 passed, 3 failed** — all baseline: `editor-workspace.test.ts` and `static-parity.test.ts` ("Estilo" vs source "Estilos", reproduced on clean `ec7afea` and documented in FUTURE-053) and the flaky `video-generation-workspace` optimistic-concurrency test (fails intermittently on clean `ec7afea`) |
| Typecheck | 0 errors |
| ESLint (changed areas) | 0 errors; warnings unchanged from baseline (`imagens/page.tsx` 15 pre-existing, none introduced; 3 pre-existing `no-img-element` in untouched files) |
| Build | See Delivery evidence |

## Verdicts

- **Migration:** none. **Worker:** none. **New persistence entity:** none. Existing `user_settings` columns, session `autoMode` and ledger metadata are reused; no value is rewritten or backfilled.
- **Rollback:** revert the PR; no data to undo; Settings values are untouched.

## Paid smoke plan (executed — results in "Production smoke")

One bounded Automatic run on the Production test session: GPT-4o mini (text) + `gpt-image-1-mini` (cheapest image) → verify exactly one `POST /api/prompt-assistance` and one image Attempt, the prompt sent equals the generated prompt, ledger rows (`workflow: "automatic"`), zero Review/evaluation, cancellation UX, cleanup. Optionally one NanoBanana run. Report as COMPLETE only after it succeeds.

## Known limitations

- Browser-owned chain (not durable); an in-flight provider charge cannot be recalled.
- The text step has no server-side idempotency; protection is the synchronous client lock (a bypassed UI equals today's Create button).
- Image generation cost/usage is not in the usage ledger (future "usage by functionality" work); nothing is estimated.
- Automatic is available only in the canonical workspace (new images); the legacy `?draft=` workspace keeps Manual/Assisted.
- Assistant-model selection is still page-local until the future AI Model Preferences work.
- Slice B (automatic evaluation + bounded refinement) is not implemented; manual Avaliar / Usar prompt refinado keep working.

## Delivery evidence

- Starting `origin/main`: `10184614c37ea557635140b3272bac1714e8d23f` (verified).
- PR [#163](https://github.com/fmultiman/content-studio-ai/pull/163), merged with a merge commit after the Vercel check passed: merge SHA `d143731fc8006c79906ab7e2c7ed66fffa15c429`.
- Production deployment: GitHub deployment `6989512798`, environment Production, SHA `d143731`, state `success`.
- Build: the Vercel build of the PR passed. A local `next build --webpack` compiles (112 s) and then trips the page-export type check on `ImagesPageShell`, which also fails identically on clean `ec7afea` (environment/mode artefact).
- Read-only Production checks (no paid call, nothing clicked): unauthenticated `POST /api/prompt-assistance` → `401 UNAUTHORIZED`; the authenticated test session shows the mode control (Manual / Assistido selectable, Assistido selected), **Automático disabled** with "ative "Permitir o modo Automático" em Configurações → Automação" (the global preference is OFF for every user), the prompt editor editable from the empty state, the image-model selector and a disabled **Criar Imagem**; no automatic panel is rendered.
- Production database: unchanged (no migration, no ledger row, no preference value written).
- Paid smoke: run and passed on 2026-10-11 (see "Production smoke").

## Production smoke (2026-10-11)

Authorization: exactly one Automatic run — at most one OpenAI `gpt-4o-mini` text inference and one OpenAI `gpt-image-1-mini` image generation; no retry, no evaluator/Review, no refinement, no video, no other model. The normal authenticated Production UI was used; no guard, capability check or ownership validation was bypassed.

**Deployed state tested.** `origin/main` and Production `c164815e8fe152115fc8117a060fce7dd846b18b` (Production deployment `6989535329`, success), carrying feature merge `d143731`. Workspace: the existing empty test session "Projeto teste · Smoke Test Final" (`295dce12-…`, owner and Project/Production verified from the session row), authenticated as the owner.

**Pre-flight (recorded before any spend).** Session: revision 8, `working_prompt` `""`, `generatedPrompt` null, `autoMode` false, `selectedModel` `gpt-image-2`, no image, no Attempt. `user_settings` of the user: `automation_enabled` **false** (the only field changed during the smoke), `default_image_model` `gpt-image-2`, `image_evaluator_enabled` true, `max_refinement_iterations` 3, `auto_mode_default` true, `save_prompt_history` true, theme/notification fields as stored. Ledger baseline for the user: 24 `provider_usage_events`, 23 image Attempts (0 in this session), 26 images, 19 media reviews, 10 video generations, 36 `prompts`. OpenAI pricing rows: 3.

**Enabling the preference.** Settings → Automação → "Permitir o modo Automático" → Salvar Preferências. A diff of the full settings row showed **only `automation_enabled` changed** (false → true); no provider request was made by the change, and the Automático option became selectable in `/imagens` while the image-model selector stayed visible. The assistant selector showed `OpenAI · GPT-4o mini`; the image model was set to `GPT Image 1 Mini` in the visible selector. The summary line read "Prompt: OpenAI · GPT-4o mini → Imagem: GPT Image 1 Mini. 1 chamada de texto + 1 geração de imagem." The prompt was empty, so no overwrite confirmation was needed.

**Input.** "Documentary photograph of the Atlantic rainforest at sunrise, soft morning mist, natural lighting, realistic vegetation, peaceful atmosphere."

### One run — observed requests (browser request log + database)

| Stage | Observation |
| --- | --- |
| Start | A single click on "Gerar automaticamente". Wall time to completion ≈ 16 s |
| A. Text | Exactly one `POST /api/prompt-assistance` → 200. Body: `operation: "create"`, `workflow: "automatic"`, `provider: "openai"`, `model: "gpt-4o-mini"`, `mediaType: "image"`, `originalText` = the typed description (no stale text), server-resolved Project/Production ids. The response reported the same `openai` / `gpt-4o-mini` / `create` (no silent substitution) and a 425-character prompt |
| B. Image | Exactly one `POST /api/openai/generate-image` → 200, `replayed: false`. Body: `model: "gpt-image-1-mini"`, `size 1024x1024`, `quality medium`, `sessionId` = the test session, `clientRequestId` = the run id. **The submitted prompt was byte-identical to the generated prompt** (425 chars; `promptEqualsGenerated: true`, not equal to the description) and the session's saved `generatedPrompt` equals the Attempt's `submitted_prompt` |
| Other | **0** NanoBanana, **0** Review/evaluator POSTs, **0** video requests, no retry. The only other calls were the session autosave `PATCH`es and read-only `GET`s (including `GET /api/reviews/image`, the existing Review-history *read* run after a refresh — not an execution) |
| UI | Prompt applied to the editor; description unchanged; image displayed; "Gerar Novamente" available; panel back to idle; no failure state |

### Persistence

One Attempt: `bcca9ed8-b12c-4e1f-945c-8b728f171378` — session `295dce12-…`, owner and Project/Production as the session, `sequence 1`, provider `openai`, model `gpt-image-1-mini`, status `succeeded`, `client_request_id` = the run id sent by the browser, config `{size: 1024x1024, quality: medium}`, no failure details, `result_image_id` = the same id (an `images` row owned by the user, status `draft`, model `gpt-image-1-mini`), submitted→completed in 11.7 s. Counts: Attempts 23 → 24 (session 0 → 1), images 26 → 27. **No duplicate Attempt.**

### Usage ledger and cost

Two new `provider_usage_events` rows (24 → 26), both owner/Project/Production-attributed, `provider openai`, `model gpt-4o-mini`, `operation create`, `measurement_source provider_reported`, sharing `provider_task_id` `chatcmpl-EXefGZ…`:

| Row | Unit | Quantity | Idempotency key |
| --- | --- | --- | --- |
| input | `input_tokens` | 267 | `prompt_assistance:chatcmpl-EXefGZ…:input` |
| output | `output_tokens` | 77 | `prompt_assistance:chatcmpl-EXefGZ…:output` |

`provider_metadata` on both: `{api: "openai_chat_completions", funding: "user_byok", workflow: "automatic", operation: "create", media_type: "image", usage: {serviceTier: "default", totalTokenCount: 344, cachedContentTokenCount: 0}}` — the reported tier is present, the `workflow` label is stored as analytics only, and no prompt text is in the ledger. The app's cost view derived **Standard-tier** estimates from the reported `service_tier: "default"`: input 267 × $0.15/1M = **$0.00004005**, output 77 × $0.60/1M = **$0.0000462** (total ≈ **$0.00008625**, list-price equivalent, BYOK invoice may differ). **No image-generation cost** exists or is shown: image generation writes no usage-ledger rows today and none was invented.

### Safety checks

Reviews (19), video generations (10) and `prompts` (36) are unchanged; no draft or library write; the `GET .../save-to-library` call is a status read. The preference change was the only settings write; no unrelated Project or Production was touched.

### Cleanup

- `automation_enabled` restored to **false** through the same Settings UI; a full-row comparison shows every other preference identical to the pre-flight values.
- The test session was restored through the UI: `working_prompt` `""`, `generatedPrompt` null, `selectedModel` `gpt-image-2`, `autoMode` false, no residual suggestion. Revision 8 → 17 and `updated_at` changed (autosave).
- **Remaining test artifacts (not removed — only destructive deletes could):** the one Attempt and its image row/object above, and the session's `current_image_id` pointing to it. All usage-ledger rows are preserved as billing evidence.

### Findings

1. **No defect in the Automatic workflow.** Counts, bodies, parity, idempotency, persistence and ledger all matched the design.
2. **Observation, not reproduced (no further paid request was allowed):** the first cleanup attempt, made on the same page that had just generated the image, was not persisted (the database kept revision 13 until the page was reloaded; the same edits made on a freshly loaded page saved normally). Post-generation autosave in a long-lived page may therefore stall; the save-status indicator was not captured during that attempt. This is **unverified** and should be investigated separately (it may pre-date Slice A).
3. **Security hygiene (unrelated to Slice A):** while recording the pre-flight preferences, a `select *` on `user_settings` showed that legacy plaintext provider-key columns still exist on that table. The values were not recorded anywhere. Recommend a separate review of those legacy columns.

### Remaining limitations

Unchanged from the section above, plus: the 16 s run depends on the browser staying open; NanoBanana was not exercised live; automatic evaluation/refinement (Slice B) is not implemented and the manual Avaliar / Usar prompt refinado actions were not touched.
