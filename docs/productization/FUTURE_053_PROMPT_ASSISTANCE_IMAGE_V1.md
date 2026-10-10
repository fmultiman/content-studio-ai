# FUTURE-053 — AI Prompt Assistance V1 (Image Slice)

Status: **COMPLETE** — merged, deployed and proven by an authenticated Production smoke (4 paid text-model attempts, 2026-10-09). Cost estimation for these events is unavailable by design (see "Production smoke"). Video Slice 2 is out of scope.

## Authority and scope

- Starting authority: `origin/main` at `ec7afead545d346ed7dd9617028e98314246f861`, verified before implementation.
- Feature branch: `feat/future-053-prompt-assistance-image-v1`.
- Previous audit: `FUTURE_053_PROMPT_ASSISTANCE_AUDIT_READY`.
- Scope: explicit, optional prompt assistance for `/imagens`, with a small server boundary that can accept `mediaType: 'video'` in a later slice without implementing video execution here.
- Excluded: `/videos`, media provider changes, worker changes, new persistence tables, billing, automatic prompt submission and paid provider smoke.

## Phase 0 findings confirmed

The existing image workspace had a legacy `POST /api/prompts/generate-image-prompt` flow backed by a hardcoded OpenAI `gpt-3.5-turbo` path. The browser supplied project context and Identity to that route, inserted generated prompts directly into `prompts`, and the legacy handler could join existing Auto Mode generation behavior. The route remains available for compatibility; the workspace now uses the explicit `/api/prompt-assistance` boundary for the new buttons.

The existing server credential boundary is `resolveProviderExecution()`. Gemini's official server client and its bounded model registry are reused. OpenAI text execution remains server-side. Existing image generation, translation, Review, Video and Kling paths were left unchanged.

`buildImageGenerationContext()` is the established compiler for project context, purpose, audience, `expression.visual_identity`, voice, principles, restrictions and generation preferences. Prompt Assistance reuses it and adds validated `visuals.colors` and `visuals.typography` as labeled text. The canonical Identity field is `expression.visual_identity`; no `style_profile` field is added. Principles are positive guidance, restrictions are hard constraints, and preferences remain flexible guidance. Raw Identity JSON is never sent as the proposed prompt.

## Prompt Assistance V1 contract

`POST /api/prompt-assistance` accepts a strict request:

```ts
{
  projectId?: string | null
  productionId?: string | null
  mediaType: 'image'
  videoMode?: undefined
  operation: 'create' | 'improve'
  originalText: string
  currentText?: string
  provider: 'openai' | 'gemini'
  model: string
  sourceReference?: undefined
}
```

`create` requires non-empty creative intent. `improve` requires non-empty `currentText`. The catalog rejects arbitrary provider/model combinations before execution.

The success response is:

```ts
{
  suggestedPrompt: string
  provider: 'openai' | 'gemini'
  model: string
  operation: 'create' | 'improve'
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    providerRequestId?: string
    serviceTier?: string | null
  } | null
}
```

The response is an editable suggestion only. It does not apply, persist, submit or generate media. Errors are typed (`INVALID_REQUEST`, ownership/context errors, `IDENTITY_INVALID`, `UNSUPPORTED_MODEL`, `PROVIDER_NOT_CONFIGURED`, rate-limit/unavailable/invalid-response errors). Provider secrets and hidden instructions are never returned.

## Authority, ownership and Identity

The route authenticates every request with the current Supabase user. Project lookup is constrained by both `id` and `user_id`. A supplied Production must match the selected Project and authenticated user; inaccessible or mismatched IDs are rejected. The client cannot provide authoritative Project, Production or Identity context: the server reads the records and normalizes Identity with `normalizeProjectIdentity()`.

Absent Identity is valid and assistance remains available. Structurally invalid Identity returns a controlled error and no provider call. A visuals-only valid Identity is retained by the normalizer and its colors/fonts are included in compiled context. Project isolation is preserved because context is assembled only from the authorized rows.

## Image workspace behavior

The New Image workflow now exposes:

- `Criar com IA`: proposes a new prompt from the user's intent and authorized context.
- `Melhorar com IA`: proposes a refinement of the current authored prompt.
- An assistant-model selector filtered by configured provider status.
- A read-only suggestion preview with `Aplicar` and `Descartar`.
- Direct prompt editing and explicit `Criar Imagem` remain available.

Apply writes through the existing editable prompt state. Discard leaves authored content unchanged. Suggestions do not create a second draft truth. Request snapshots and stale-response guards prevent a response from an obsolete Project, Production, model or edited input from being shown. A suggestion cannot expose the media-generation button until it is applied.

### Auto Mode (decision recorded)

The only code that ever consumed the `Modo Automático` switch was the legacy `handleGeneratePrompt` handler (`Gerar Prompt (IA)` / `Gerar Prompt + Imagem`), which chained prompt generation into image generation and was replaced by the assistance actions. Creating or improving a prompt must never start media generation, so that chain was **not** carried over to the new actions. Consequently the switch had no remaining consumer, and leaving it enabled and labelled "Gerar prompt + imagem automaticamente" would have promised behaviour that no longer exists.

Decision for this slice: the switch is shown **disabled** with the label "(indisponível: a assistência de IA nunca gera imagem automaticamente)". The persisted `autoMode` value in sessions and drafts is read and written unchanged (no data loss, no migration) and the user's `automation_enabled` setting is untouched. The legacy `POST /api/prompts/generate-image-prompt` route remains in the repository for compatibility but `/imagens` no longer calls it. Re-introducing an explicit automatic prompt-then-image action, if wanted, is a separate product decision with its own explicit generation path.

Prompt assistance is isolated from image generation: clicking either assistance action does not submit an image provider request, retry generation, evaluate an image, enter an automatic loop or write a prompt row. This is asserted at page level with a session persisted with `autoMode: true`.

## Async response isolation

Every assistance request takes a generation id and an `AbortController`. `cancelPromptAssistance()` advances the id, aborts the client request, drops any pending suggestion and clears the loading state. It is called from Discard, from the new-image reset, and when a draft or canonical session is loaded. A response is additionally compared against a snapshot of Project, Production, selected assistant model and the exact source text; a mismatch discards it. A response arriving for an obsolete request never sets state, never toasts and never clears the loading flag of a newer request.

The assistant model is derived from the configured-provider catalog. Nothing is advertised until `/api/settings/providers` has answered; a failed or unauthenticated lookup leaves both providers unconfigured and the actions disabled.

## Provider and credential catalog

The explicit text-assistance catalog is:

| Provider | Model | Credential/execution boundary |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` | Existing server-side OpenAI credential resolution and bounded Chat Completions adapter; V1 default because it is already used by current text integrations. |
| OpenAI | `gpt-3.5-turbo` | Existing compatibility model, still server-side and explicitly selected. |
| Gemini | `gemini-3.5-flash` | Existing official Gemini server client and configured BYOK credential. |
| Gemini | `gemini-3.5-flash-lite` | Existing official Gemini server client and configured BYOK credential. |

Gemini is called in plain-text mode (`responseMimeType: text/plain`, no response schema); structured Review calls keep `application/json` + schema. Configuration status is not a quota guarantee. Missing credentials, provider 429s, timeouts and malformed provider responses are surfaced as controlled errors. Automated tests mock both adapters; no paid provider call is part of this implementation.

## Usage and cost semantics

Assistance records factual usage in the existing `provider_usage_events` ledger when token counts are reported — including a paid call that returned an unusable response (Gemini blocked/truncated/empty or an empty OpenAI completion), whose provider-reported tokens are preserved on the typed error and recorded before the sanitized error is returned. A failure with no reported usage records nothing. Recording lives in the server-only `lib/prompt-assistance/usage.ts` (service-role client, allow-listed in the credential-boundary test). Input/output events use stable per-invocation idempotency keys; if the provider reports no token counts, one unknown event records the invocation without fabricated quantities. Metadata contains only non-sensitive capability facts (`media_type` and operation), never prompt or Identity text. Ledger failures are best-effort and do not turn a successful suggestion into a failed user operation.

The existing pricing registry remains the source for estimated cost. Missing token counts or price coverage keep cost unknown; no billing amount is invented. An estimated list-price equivalent is not an actual provider invoice, and a BYOK invoice may differ. No migration is required for this slice.

## Review findings and dispositions

Source: `future-053-prompt-assistance-review` (Traycer review artifact).

| # | Finding | Disposition | Proof |
| --- | --- | --- | --- |
| P1 | Gemini requested JSON mode (`application/json`) although Prompt Assistance needs plain text | Fixed: `generateContent` sends `text/plain` unless a response schema is supplied; Review calls unchanged | `providers.test.ts` asserts the outgoing `responseMimeType`; `review-provider.test.ts` still asserts JSON + schema |
| P1 | Auto Mode promised "prompt + image" but its only consumer was removed | Fixed by disabling the switch with a truthful label (see Auto Mode); persisted value preserved | `prompt-assistance-workspace.test.tsx` (switch disabled, label, no image request with `autoMode: true`) |
| P1 | Provider-reported usage dropped when a paid call returned an unusable response | Fixed: Gemini and OpenAI adapters carry usage on the typed error; the route records it before returning the sanitized error | `providers.test.ts` (MAX_TOKENS 200, empty OpenAI), `prompt-assistance-route.test.ts` (events recorded, no prompt text; none when no usage) |
| P2 | Reset/new-draft did not invalidate an in-flight request | Fixed: `cancelPromptAssistance()` (id + abort) on reset, discard, draft load and session load; snapshot check kept as second guard | Page tests cover snapshot/stale and sequential flows. The reset path itself is only reachable in the non-canonical (draft) workspace and is not exercised by a page-level test |

Additional corrections found during validation: typecheck errors in the route/page/test (fixed), a render-time ref write and an effect-driven model fallback replaced by an after-commit ref update and a derived model, and a stale-capability window (actions are now disabled until provider status is known).

## Validation record

| Check | Result |
| --- | --- |
| Focused Prompt Assistance (providers, context, route, normalizer, suggestion card, page-level workspace) | PASS |
| Credential-boundary / governance scans after allow-list updates | PASS |
| Typecheck (`tsc --noEmit -p tsconfig.typecheck.json`) | PASS, 0 errors |
| ESLint on changed files | 0 errors; 15 warnings, all pre-existing in `imagens/page.tsx` (none on lines added by this slice) |
| Full test suite (final run, 274 files / 5026 tests) | 5019 passed, 7 failed — all classified below; the one slice-caused failure in that run was fixed and re-verified |
| Build | Vercel build for PR #157 SUCCESS and Production deployment SUCCESS. A local `next build` (webpack, offline) compiles but trips the page-export type check on `ImagesPageShell`; the identical error reproduces on a clean checkout of `ec7afea`, so it is an environment/mode artefact, not a regression |
| Paid live provider smoke | PASS — 4 of 4 authorized attempts succeeded (see "Production smoke") |

### Full-suite classification

First full run: 15 failures; final run: 7 failures. All classified, none unexplained:

- 4 caused by this slice and fixed: the credential-boundary allow-lists for the OpenAI adapter, the credential-resolving route and the service-role usage recorder, and the `params:` regex in `image-route-convergence` (renamed a local parameter).
- 2 pre-existing on `ec7afea` (`editor-workspace.test.ts`, `static-parity.test.ts` expect "Estilo"; the source label is "Estilos") — reproduced on a clean checkout of `ec7afea`, unrelated to this slice.
- 1 flaky timing test (`video-generation-workspace.test.tsx` optimistic-concurrency case) — passes 3/3 on this branch in isolation and failed 1/3 on clean `ec7afea`.
- Repository-scanning tests that exceed the 5 s default timeout when the whole suite loads the machine (8 in the first run; 4 in the final run: `environment-isolation`, `supabase-admin-credential`, `renderer-isolation`, `single-writer`); they pass in isolation with a raised timeout.
- 1 in the final run caused by this slice and fixed afterwards: `provider-usage-ledger` forbids any file other than the recorder naming the ledger table, and `lib/prompt-assistance/usage.ts` named it in a comment (reworded; test passes).

## Delivery evidence

- PR: [#157](https://github.com/fmultiman/content-studio-ai/pull/157), merged with a merge commit (repository convention) after the Vercel check passed.
- Branch commit: `f2ba9f0`. Merge SHA on `origin/main`: `85b3648afcfe3577b98565a047acd5dd5bd59373`.
- Production deployment: GitHub deployment `6974369553`, environment Production, SHA `85b3648`, state `success`.
- Read-only Production smoke: `POST https://content.multihuman.com.br/api/prompt-assistance` without a session returns `401 UNAUTHORIZED` (route deployed, authentication enforced, no provider reached); `/imagens` without a session redirects to `/login`. No authenticated or paid invocation was performed.
- Paid live provider smoke: **run and passed** on 2026-10-09 (see "Production smoke").
- Migration: none.
- New persistence entity: none.
- Render worker: unchanged.

## Production smoke

Date: 2026-10-09 (local, 23:23–23:25 BRT; ledger timestamps 2026-10-10 02:23–02:25 UTC). Authorization: exactly four paid text-model inferences, no image, video or evaluator calls, no retries.

**Deployed state tested.** `origin/main` `ca7a34c` (docs-only on top of the feature merge `85b3648`); Production deployments `6974369553` (`85b3648`) and `6974418447` (`ca7a34c`) both `success`; application code identical. Tested at `https://content.multihuman.com.br`, authenticated as the owner account.

**Pre-flight.** Workspace `/imagens/geracoes/295dce12-…` (Project "Projeto teste", Production "Smoke Test Final"; an empty pre-existing test session: `working_prompt` `""`, `generatedPrompt` null, `autoMode` false, revision 0, no image, no attempts). The workspace showed "Criar com IA" and "Melhorar com IA", the "Assistência" selector with all four catalog models (OpenAI GPT-4o mini / GPT-3.5 Turbo, Gemini 3.5 Flash / Flash-Lite), the Auto Mode switch disabled and labelled "(indisponível: a assistência de IA nunca gera imagem automaticamente)", and an editable prompt field.

**Inputs.** CREATE: "A peaceful Atlantic rainforest at sunrise, soft natural light, documentary photography, realistic vegetation, no futuristic elements." IMPROVE: the deliberately basic prompt "A rainforest at sunrise." with the same intent as source.

### Matrix

| Test | Provider / model | Operation | HTTP | Result | Tokens in / out | Disposition of suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| A | OpenAI `gpt-4o-mini` | create | 200 | Valid English prompt shown as "Sugestão da IA — Não aplicada" | 265 / 74 | Applied |
| B | OpenAI `gpt-4o-mini` | improve | 200 | Valid improved prompt | 285 / 26 | Discarded |
| C | Gemini `gemini-3.5-flash-lite` | create | 200 | Valid plain-text prompt (no JSON shape — confirms the `text/plain` fix) | 273 / 79 | Discarded |
| D | Gemini `gemini-3.5-flash-lite` | improve | 200 | Valid improved prompt | 296 / 56 | Applied |

Exactly four `POST /api/prompt-assistance` requests were issued (browser request log), each with the selected provider/model, server-side Project/Production ids and no Identity or context payload. No errors, rate limits or retries occurred. The first click on "Criar com IA" did not register in the automation harness and sent nothing (verified: no request, no ledger row); it was repeated once, before any spend. Totals: OpenAI 550 in / 100 out; Gemini 569 in / 135 out.

### Apply / Discard and persistence

- Each suggestion appeared in a separate card marked "Não aplicada"; the intent field and the prompt field were unchanged until Apply.
- **Apply (A, D)** wrote the suggestion only into the editable prompt field (still editable, `readOnly` false) and triggered one normal autosave `PATCH` of the session; the intent text was untouched.
- **Discard (B, C)** removed the card and preserved the authored text exactly ("A rainforest at sunrise."); no write followed.
- Between a request and Apply/Discard there were no session writes: the request log shows `PATCH` only after typing and after Apply. A reload does not restore a suggestion.
- `images` (26), `prompts` (36) and `video_generations` (10) row counts for the user were identical before and after; no `image_generation_attempts` were created; `provider_usage_events` rows not from Prompt Assistance since the smoke started: 0.

### Auto Mode

The switch stayed disabled (`aria-checked=false`) with the accurate label throughout. Create, Improve, Apply and Discard issued no image, video, evaluator, review or attempt request: zero non-GET calls other than the four assistance `POST`s and the session autosave `PATCH`es.

### Usage ledger (`provider_usage_events`)

Eight rows (two per attempt), all `resource_type = prompt_assistance`, `transport = api`, owner user id, Project and Production ids of the test workspace, `measurement_source = provider_reported`, actual model, `operation` create/improve, `provider_metadata` exactly `{"media_type":"image","operation":"<op>"}` (no prompt, Identity or response text), idempotency key `prompt_assistance:<provider request id>:<input|output>`. Eight distinct keys, no duplicates; the user's ledger rose from 11 to 19 rows. The Settings "Uso e custos" page shows all eight as provider-reported tokens.

### Cost

Not estimated by the application, and none is asserted here:

- OpenAI `gpt-4o-mini`: no pricing version exists in `provider_pricing_versions` → "Preço indisponível".
- Gemini `gemini-3.5-flash-lite`: pricing versions exist, but the estimate requires a service tier proven by the event, and Prompt Assistance does not persist the provider-reported `serviceTier` on its ledger rows → "Preço indisponível" (ambiguity is surfaced rather than guessed).

### Cleanup

The test session was restored through the UI: `working_prompt` `""`, `generatedPrompt` null, `autoMode` false, all other working state identical to the recorded initial state; only `revision` (0 → 6) and `updated_at` differ. No suggestion remains. No ledger rows were modified, deleted or backfilled. No other user data was touched.

### Findings (no fixes made in this mission)

1. **Gemini thinking tokens are not recorded for Prompt Assistance.** The recorder stores input and output only; the Gemini Review integration also records "raciocínio" tokens. Whether these four Flash-Lite calls produced thinking tokens cannot be determined from stored data, so billable Gemini output may be under-recorded. Recording is truthful (nothing fabricated) but possibly incomplete.
2. **`serviceTier` is not persisted**, which is why Gemini estimates stay unavailable (above).
3. **No OpenAI pricing version** for `gpt-4o-mini` (or any OpenAI text model) in the registry.

Recommended follow-up (separate mission): record Gemini thinking tokens and `serviceTier` on Prompt Assistance ledger rows and add an OpenAI `gpt-4o-mini` pricing version with evidence. Not required for Slice 1 acceptance.

## Known limitations

- Auto Mode has no active behaviour on `/imagens` in this slice (see decision above).
- Automated tests mock both providers; real provider behaviour was proven once by the Production smoke above (one create and one improve per provider), not by a recurring test.
- Prompt Assistance usage rows lack Gemini thinking tokens and the provider service tier, so cost stays unavailable (see Findings).
- The reset-form abort path is covered by code review, not by a page-level test (only reachable outside the canonical workspace).
- Estimated list-price cost is derived from the existing pricing registry only when token counts, price coverage and (for Gemini) a proven service tier exist; otherwise cost stays unknown — currently true for all Prompt Assistance events.

## Video Slice 2 handoff

The boundary already has typed operation/provider/model/media fields, server context ownership, normalized Identity compilation and factual usage output. Video integration still requires a separate audit of T2V/I2V prompt semantics, VideoDraft/session persistence and submit boundaries. It is deliberately not implemented in this slice.
