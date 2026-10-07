# VIDEO_REVIEW_UI_AND_HISTORY_V1

## Status

- Baseline: `origin/main` `e07dbdb38e7b9b3519883678a0c70acdc49bc9a4` (FUTURE-042).
- Branch: `feat/video-review-ui-and-history-v1`, PR **#144**.
- **Preview smoke performed and passed.** Real authenticated functional and responsive smoke executed on the current PR #144 Preview deployment (`https://content-studio-p6i0aiia9-fmultimans-projects.vercel.app`) at commit `5bb6f2e640ff5a23ffef4e9339d529dcfb2dc3a9`.
- Schema: **no migration**. Paid provider calls: **0**. No provider/model picker, no VideoDraft/VideoScene mutation, no usage/cost display.

## Phase 0 — what the executing code actually is

| Question | Finding |
|---|---|
| Generation workspace | `app/(dashboard)/videos/geracoes/[sessionId]/page.tsx`. Attempts load from `GET /api/video-generations?sessionId=`; each completed result is an attempt card (`attempt-card-<id>`) with "Assistir" and `SaveGenerationToLibrary`. The list route signs `public_url` and nulls both `storage_path` and `public_url` for a path outside the owner's namespace, so "has a usable persisted result" is `status === 'succeeded' && (storage_path || public_url)`. |
| Library | `app/(dashboard)/arquivos/page.tsx` (files grid). Each card has a `CardActions` row (Visualizar, Baixar) and a trash toggle (`showTrash`); rows are `library_files` with `kind` and `deleted_at`. Gallery is not the action surface for either source family, so it was left alone. |
| Existing action pattern | `SaveGenerationToLibrary`: a ref-guarded request, server-owned state, a code→copy map and `useToast`. The Review control follows it. |
| Image Review UI | Inline in `imagens/page.tsx` and `components/images/image-result.tsx`; it does not render criteria and is not reusable for Video, so the Video result is its own component and Image Review is untouched. |
| Review read APIs | `/api/reviews/image` has a history GET keyed by Attempt (with the user's session client). There was **no** Video history read and `lib/reviews/repository.ts` had no list-by-artifact. |
| Safe owner-scoped history path | RLS gives the user SELECT on `video_generations`, `render_executions`, `library_files`, `media_artifacts`, `media_artifact_provenance` and `media_reviews`, so a history read can run with the caller's own session client. |
| Toast / error / loading conventions | `useToast` toasts, `StateMessage` (tone, `actionLabel`, `onAction`), `Loader2` spinners. |
| Missing-credential navigation | `StateMessage` + `router.push('/configuracoes?tab=api')` (used by the Image page). |

Nothing contradicted the mission, so no STOP was needed.

## Surfaces

1. **Generation workspace attempt cards** — `Revisar` only when `isGenerationReviewable(generation)`; source `{ kind: 'video_generation', id }`.
2. **Library video cards** — `Revisar` inside the existing `CardActions`, only when `!showTrash && isLibraryFileReviewable(file)` (a live video); source `{ kind: 'library_file', id }`. Image and other file kinds are unchanged.

A structural test asserts the control is imported by exactly these two pages. Creative Editor, Gallery and RenderExecution have no entry point (the backend still supports `render_execution`).

## History read contract

`GET /api/reviews/video?kind=<video_generation|render_execution|library_file>&id=<uuid>` → `{ items: VideoReviewHistoryItem[] }`, newest first (max 50), `Cache-Control: private, no-store`.

```
typed source -> owner-scoped existence check -> provenance rows of THIS source
  -> artifacts they point at -> owner-scoped Video Reviews of those artifacts
```

### No-write invariant

Only SELECTs are issued, with the caller's own session client (RLS is a second structural guard). It never calls `ensureVideoArtifact`/`registerVideoArtifact`, never writes provenance or a Review, never opens, hashes or probes media, never resolves a credential and never contacts a provider. A source with no artifact yet answers `{ items: [] }`; another user's or an unknown source answers `404 REVIEW_SUBJECT_NOT_FOUND` (indistinguishable). Tests prove it three ways: a client whose write methods throw, a static scan that the module imports nothing that could write or read media, and a check that the GET handler uses the session client and not the service-role client (so no allowlist change was needed).

### DTO

`VideoReviewHistoryItem`: `id`, `status`, `createdAt`, `completedAt`, `evaluator { provider, model }`, `result { overall, summary, criteria, strengths, issues, recommendations, refinedPrompt, analyzed }` or `null`, and `failure { code, message }` or `null`. It deliberately omits the artifact id, content hash, storage coordinates, source ids, context fingerprint, prompt version and provider payloads. It was also verified against the real persisted Production Review row (`3c365b1e…`).

## UI states

Closed: no request is made. Opening reads history and the Gemini credential *status* (GETs only).

- empty → "Nenhuma revisão ainda" + `Revisar vídeo`;
- pending / running → duplicate submission disabled, "Revisão em andamento", slow refresh (`VIDEO_REVIEW_POLL_MS` = 15 s) that stops when nothing is in flight, and an in-flight Review older than 15 minutes is called out as possibly interrupted (polling stops, a new attempt is allowed and the server decides);
- completed → full result; the action becomes `Revisar novamente`;
- failed → the failure explained from its normalized code; a new Review is allowed;
- history load error → explicit error with retry (never shown as empty).

Older Reviews are collapsed; the newest is expanded; each shows its position ("Revisão 3 de 3") and timestamp.

## clientRequestId behavior

One user gesture = one id. A ref guards the request (two clicks in the same tick can both observe `running === false`), so a double click is one POST. The id is kept only while the outcome is **unknown** (connection dropped, so a retry replays the same Review) and rotated after **any definitive answer** (success or an HTTP error), so each intentional `Revisar novamente` sends a brand-new id and never an existing Review's id. The body is exactly `{ source: { kind, id }, clientRequestId }`.

## Missing Gemini credential

If `GET /api/settings/providers` says Gemini is `missing`, the panel replaces the run button with "A API do Google Gemini precisa estar configurada em Configurações → API…" and an "Abrir Configurações" action (`/configuracoes?tab=api`), and sends nothing (no junk failed Review is recorded). If the status is unknown and the server answers `REVIEW_PROVIDER_NOT_CONFIGURED`, the same controlled message appears. The key is never read or shown.

## Error UX

Specific copy for 401, 400, 404, 409 `REVIEW_IN_PROGRESS` (controlled notice + refreshed history), 409 idempotency conflict, 422 output unavailable, 422 guardrails (size 500 MB, duration 10 min, unknown duration/size, each distinct), 502 invalid response / provider error, 503 and 504, plus an honest "connection failed, check the history" notice. Raw server text is never echoed except the already-safe guardrail reason mapped to fixed copy.

## Result presentation

Score and assessment badge, summary, criteria, strengths, problems, recommendations and the timestamp/position, with no raw JSON.

- `applicable = false` → neutral "Não se aplica" (no score, no evidence); `insufficient_evidence` → neutral "Evidência insuficiente". Neither is styled as a failure.
- "Análise somente visual: o áudio do vídeo não foi avaliado." whenever the adapter reports `visual_only`; audio is never implied.
- The Gemini model is shown as factual metadata only; there is no selector.

### refinedPrompt

Displayed as "Sugestão de prompt" with "É apenas uma sugestão: nada é alterado nem gerado automaticamente." It is display-only: no button adopts it, nothing is sent, and a test asserts the UI makes no request and has no adopt/apply action. Adopting a refinement is deferred.

## Image Review regression

Image Review code is unchanged. `lib/reviews` Image suites, the Gemini provider tests, the Image page tests and the credential boundary are green.

## Tests

- `video-history.test.ts` (10): empty + no writes, owner DTO newest-first, in-flight rows, every source family, cross-user 404 with no further reads, other users' Reviews never returned, Image Reviews ignored + cap, store failure, structural read-only scans.
- `video-route-history.test.ts` (5): auth, typed-source validation, session client + verified user, empty history, 404/500 without leakage.
- `video-review-presentation.test.ts`: eligibility, in-flight/stale, wording, every error mapping.
- `components/reviews/video-review-control.test.tsx` (31): read-only open, empty/error, result rendering, not-applicable/insufficient, visual-only, refinedPrompt display-only, long-text wrapping, history order, failed/pending/running/stale, slow refresh, exact POST body, double click, new id on re-review, id kept after a dropped connection and rotated after a definitive answer, 409, missing key (known and server-reported), guardrails, each status.
- `video-review-surfaces.test.ts` + a workspace test that renders real attempt cards: eligibility on completed / result-gone / failed / processing attempts, Library structure, "exactly two importers", no picker/cost/adopt action, no mutation endpoints.
- Regression: Review, artifact, Gemini, storage, Image, Library and generation-workspace (Session/autosave) suites.

## Preview smoke — PERFORMED & PASSED

Executed against the active PR #144 Preview deployment at head `5bb6f2e640ff5a23ffef4e9339d529dcfb2dc3a9`:
URL: `https://content-studio-p6i0aiia9-fmultimans-projects.vercel.app`

1. **Authentication:**
   - Vercel bypass established via share link `?_vercel_share=IjwzmQTRVybLEKtyMtSazxCSwy87uXvB`.
   - Content Studio/Supabase session authenticated as `flavio.multiman`.
2. **Surface 1 (`/videos/geracoes/[sessionId]`):**
   - Workspace loads and hydrates cleanly; Session autosave shows "Salvo".
   - Completed eligible generation attempt card renders with "Assistir", "Salvar em Arquivos", and "Revisar" button.
   - Review panel opens upon interaction; zero accidental POSTs triggered merely by opening.
   - Session/autosave UI remains completely unaffected.
3. **Surface 2 (`/arquivos`):**
   - Video library items expose "Revisar" button (e.g. `video-ia-19d664dd.mp4`, `render-0ee1ef93-41d6-41d1-85f3-2adbec5caca6.mp4`, `render-db4f91e4-03e5-4fec-a0f7-44a858a0bbb6.mp4`, `gateb-broll-arquivo.mp4`).
   - Image items (`imagem-ia-3a49939e.png`, `frame-paper-dark-celestial-01.png`, etc.) do NOT expose Video Review action.
   - Audio and XML document items do NOT expose Video Review action.
   - Real completed Review for `render-0ee1ef93-41d6-41d1-85f3-2adbec5caca6.mp4` (`0c5e4fba-142f-4ed5-b353-b2be089ef0e2`) renders via read-only GET:
     - Completed state with position/timestamp ("Revisão 1 de 1 · 07/10/2026, 05:05").
     - Model metadata `Gemini · gemini-3.5-flash`, score `70/100`, assessment `Misto`.
     - 8 criteria rendered with Brazilian Portuguese localized copy; `prompt_adherence` neutrally rendered as "Não se aplica".
     - "Análise somente visual: o áudio do vídeo não foi avaliado." disclosure present.
     - Strengths, issues, recommendations displayed clearly; zero raw JSON; no model/provider picker.
   - Zero Library mutations occurred.
4. **Safe non-paid states exercised:**
   - Empty history ("Nenhuma revisão ainda", action "Revisar vídeo").
   - In-flight running state ("Revisão em andamento…", disabled button, poll notice).
   - Failed state ("Falhou", "A revisão não pôde ser concluída.", retry enabled).
   - Missing Gemini credentials ("Configure o Google Gemini", "Abrir Configurações" navigating to `/configuracoes?tab=api`, run button hidden).
   - History load error ("Não foi possível carregar o histórico", "Tentar de novo").
   - Controlled 409 `REVIEW_IN_PROGRESS` ("Revisão em andamento", "Já existe uma revisão em andamento para este vídeo. Aguarde a conclusão.").
   - Controlled 422 guardrails error.
   - `refinedPrompt` display-only ("Sugestão de prompt", "É apenas uma sugestão: nada é alterado nem gerado automaticamente.", no apply button, no auto-generation).
5. **Responsive smoke measurements (real Preview UI):**
   - **1440px:** `panelHScroll = 0`, `pageHOverflow = 0`, dialog in viewport, 0 escaping descendants.
   - **768px:** `panelHScroll = 0`, `pageHOverflow = 0`, dialog in viewport, 0 escaping descendants.
   - **390px:** `panelHScroll = 0`, `pageHOverflow = 0`, dialog in viewport, 0 escaping descendants.
   - Long unbroken criterion and refinedPrompt text wraps safely with `[overflow-wrap:anywhere]`.
6. **Write safety:**
   - Gemini paid calls = 0.
   - New `media_reviews` rows = 0.
   - History GET remained strictly read-only.

## Supplementary evidence (local harness)

A temporary, uncommitted local harness rendered the real `VideoReviewControl`/`VideoReviewResult` inside real Library-style and attempt-style cards with a stubbed `fetch` (dummy env, no network, no credentials), driven in the in-app browser at 1440, 768 and 390:

- It found a real defect the unit tests could not: with long unbroken text the dialog's CSS grid column grew to the longest word (`panelHScroll` 2408–2714 px). Fixed with `grid-cols-[minmax(0,1fr)]` plus an inherited `overflow-wrap:anywhere`; after the fix `panelHScroll = 0`, no descendant escapes the panel and the page has no horizontal overflow at all three widths. The structural classes are asserted in a unit test (jsdom has no layout).
- Empty, running (button disabled), failed, missing-key (config message, no run button) and many-Reviews (two collapsed) states render at 390 with zero overflow; a stubbed 422 shows the specific "Vídeo fora dos limites da revisão" notice; the Library-card and attempt-card buttons wrap without overflow.
- The real persisted Production Review row (`3c365b1e…`) was mapped through the new DTO locally: status, model, 8 criteria with `prompt_adherence` not-applicable, `visual_only`, and no identifiers exposed.

## Production read-only smoke

Not applicable yet (not merged). Before this work Production holds the completed live Video Review and 17 Image Reviews (hash `b7eb6d5a253a215d91f2e6b477b3a8c4`); no write was made by this mission.

## Residual gaps

- An in-flight Review whose server process died stays `running` and keeps the single in-flight slot occupied (no reaper exists in the backend); the UI flags it as possibly interrupted after 15 minutes but cannot clear it. (Tracked as FUTURE-046).
- A backend Review of a missing-credential Gemini key records a failed Review row when the credential status was unknown beforehand (the UI avoids this whenever the status is known).
- No Creative Editor, Gallery or RenderExecution entry point (by scope); no explicit "use this prompt" action (by scope).
- Usage/cost (FUTURE-043), the `capturedAt` fingerprint (FUTURE-040), Library move keys (FUTURE-039) and the worker's `output_duration_ms` (FUTURE-045) are untouched.
