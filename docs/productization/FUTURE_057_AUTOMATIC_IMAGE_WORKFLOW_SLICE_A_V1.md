# FUTURE-057 — Automatic image workflow restoration, Slice A (core automation + manual authoring)

Status: **CODE_READY** — implemented and validated with mocked providers; **no paid smoke has been run** (none authorized). `COMPLETE` requires a separately authorized real-provider smoke (see "Paid smoke plan"). Slice B (evaluation/refinement automation) and Video Slice 2 are out of scope.

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

## Paid smoke plan (NOT run — needs separate authorization)

One bounded Automatic run on the Production test session: GPT-4o mini (text) + `gpt-image-1-mini` (cheapest image) → verify exactly one `POST /api/prompt-assistance` and one image Attempt, the prompt sent equals the generated prompt, ledger rows (`workflow: "automatic"`), zero Review/evaluation, cancellation UX, cleanup. Optionally one NanoBanana run. Report as COMPLETE only after it succeeds.

## Known limitations

- Browser-owned chain (not durable); an in-flight provider charge cannot be recalled.
- The text step has no server-side idempotency; protection is the synchronous client lock (a bypassed UI equals today's Create button).
- Image generation cost/usage is not in the usage ledger (future "usage by functionality" work); nothing is estimated.
- Automatic is available only in the canonical workspace (new images); the legacy `?draft=` workspace keeps Manual/Assisted.
- Assistant-model selection is still page-local until the future AI Model Preferences work.
- Slice B (automatic evaluation + bounded refinement) is not implemented; manual Avaliar / Usar prompt refinado keep working.

## Delivery evidence

Filled at merge time.
