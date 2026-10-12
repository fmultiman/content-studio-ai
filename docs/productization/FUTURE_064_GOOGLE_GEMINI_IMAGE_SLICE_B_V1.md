# FUTURE-064 Slice B — Image editor (/imagens) and Settings integration for the official Google Gemini models

Status: implemented. **The Production release switch stays OFF** — nothing here enables Google generation, makes a paid call, runs a migration, or touches credentials. No image-to-image. The third-party NanoBananaAPI.ai integration is untouched and still works.
Builds on: `docs/productization/FUTURE_064_GOOGLE_GEMINI_IMAGE_SLICE_A_V1.md` (route `POST /api/gemini/generate-image`, merge `aef01fa`) and the Traycer audit `future-064-google-gemini-image-generation-audit`.

## What changed

| Area | File |
|---|---|
| One client-safe model catalog (types, labels, strict parsing, provider of each model, stored-value interpretation) | `lib/images/image-models.ts` |
| Per-provider readiness + grouped selector options + cost notice | `lib/images/image-readiness.ts` |
| Browser-safe availability class + pt-BR messages | `lib/images/gemini-availability.ts` |
| Slice A error-code → user message mapping, replay interpretation | `lib/images/gemini-image-errors.ts` |
| Server-derived availability (switch + FUTURE-050 policy) | `lib/providers/gemini/image-feature.ts` → `describeGeminiImageAvailability()` |
| Availability exposed to the signed-in user | `app/api/settings/providers/route.ts` → `imageGeneration.gemini` |
| Selector (grouped, Google options disabled with a reason, notices) | `components/images/prompt-section.tsx` |
| Workspace: readiness, dispatch, Google submit handler, unknown-model handling | `app/(dashboard)/imagens/page.tsx` |
| Default-model radios + provider cards copy/status | `app/(dashboard)/configuracoes/page.tsx` |
| Type unions now come from the catalog | `lib/types.ts` |
| Registry labels (em dash wording) | `lib/providers/gemini/image-models.ts` |

## Product contract

Three providers, never collapsed:

| Provider | Models (persisted selector value) | Credential | Label |
|---|---|---|---|
| OpenAI | `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` | OpenAI key | OpenAI |
| **Google Gemini (official)** | `gemini-nb-2.1`, `gemini-nb-lite` | the **existing** Gemini BYOK key (no new field) | Google Gemini — Nano Banana 2.1 (oficial) / Google Gemini — Nano Banana 2 Lite (oficial) |
| NanoBananaAPI.ai (third party, legacy) | `nanobanana-v1`, `nanobanana-v2` | NanoBananaAPI.ai key (field kept) | NanoBananaAPI.ai V1/V2 (terceiros — legado) |

Only the short aliases are persisted (≤ 20 chars; `user_settings.default_image_model` / `image_drafts.selected_model` are `varchar(20)`). The official Google ids never reach the browser, the draft or the Session; the server maps them (Slice A). Existing defaults, drafts, Sessions, Attempts, images and history are not rewritten or migrated.

## Readiness (`evaluateImageReadiness`)

| Model provider | Ready when |
|---|---|
| OpenAI | OpenAI key configured |
| NanoBananaAPI.ai | NanoBananaAPI.ai key configured (the Google key is irrelevant) |
| Google Gemini | canonical generation workspace **and** server availability `available` **and** Gemini key configured |

Order for Google: workspace → capability → credential. A disabled capability is reported as **disabled**, never as a missing key (even if the key is also missing); a configured key never implies the capability; an unknown/absent/malformed availability signal is treated as unavailable. The old rule "not OpenAI ⇒ NanoBanana" is removed: dispatch is a `switch` over the model's provider.

## Release switch (`CONTENT_STUDIO_GEMINI_IMAGE_GENERATION`) in the UI

- `GET /api/settings/providers` (authenticated) now includes `imageGeneration.gemini = { available, reason }`, `reason ∈ available | release_switch_off | environment_blocked`. It is `describeGeminiImageAvailability()`: switch exactly `enabled` **and** the FUTURE-050 policy allowing paid execution (so Preview stays `environment_blocked` even with the switch on). The variable name and value are never in the response; the field is independent of the credential status.
- OFF (the Production state): the Google group is listed in the selector but its options are **disabled** with the reason "A geração de imagem com o Google Gemini ainda não foi habilitada neste ambiente."; Criar Imagem is blocked for a Google selection; Automatic cannot start; no Google POST can be issued (handler re-checks readiness before any request). Settings shows the Google defaults disabled with the same explanation and the Gemini card says "Geração de imagem Google: ainda não habilitada neste ambiente."
- If the server ever answers `GEMINI_IMAGE_GENERATION_DISABLED` / `PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT`, the workspace flips its local availability to off (no substitution, no key message).
- **The switch was not enabled in Vercel.** Enabling remains the later release gate.

## Manual / Assisted / Automatic

- **Manual:** authored prompt + selected model → one explicit click → one request.
- **Assisted:** Create/Improve suggestions stay isolated; Apply/Discard issue zero image requests; generation only on the explicit click (tested with a Google model selected).
- **Automatic:** one explicit click → one `/api/prompt-assistance` call (text model configured independently of the image model) → exact resulting prompt → one image submission with the run id as `clientRequestId`. Start is gated on provider-specific readiness *before* the paid text call. A failure never retries or falls back; "Tentar só a imagem" is a new explicit action with a new id. Existing opt-in, locks, cancellation and cleanup are untouched. The run summary names the exact image model and, for Google, carries the cost notice.

## Dispatch contract (Google)

`POST /api/gemini/generate-image` with exactly `{ prompt, model, aspectRatio, sessionId, clientRequestId }`; `model` is the alias, `aspectRatio` is `1:1`, resolution (1K) is owned by the backend; no size/quality/provider/official-id/source-image fields (asserted on the wire). Canonical workspace only (the route is Session/Attempt based). Request ids: a definitive server answer (success or error) rotates the id so the next click is a new Attempt; a network failure keeps the same id so a retry replays rather than paying twice; a replayed `succeeded` shows the image, a replayed `failed` explains and rotates the id, a replayed in-flight attempt does not claim success and does not rotate.

Error mapping (all from Slice A codes; never echoes server text): `GEMINI_IMAGE_GENERATION_DISABLED`, `PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT`, `INVALID_IMAGE_MODEL`, `PROVIDER_NOT_CONFIGURED` (credential missing), `PROVIDER_CREDENTIAL_UNAVAILABLE` (retryable store failure), `PROVIDER_CREDENTIAL_REJECTED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_CONTENT_BLOCKED`, `SOURCE_NOT_SUPPORTED`, timeout/unavailable/empty/invalid/storage (with "a cobrança pode ter ocorrido" where the outcome is unknown), session/ownership/idempotency codes.

## Unknown model ids

`normalizeImageModel` (silent fallback to `gpt-image-2`) is gone. Saved values go through `interpretStoredImageModel`: absent → keep the current default; known id → select it; the historical `openai` default is read-mapped to GPT Image 2 (never written back); anything else is **unknown**: the selector shows no selection, a reason is displayed ("O modelo de imagem salvo (“x”) não é reconhecido…"), Criar Imagem and Automatic are blocked, **no provider is called**, and autosave keeps persisting the original unknown value untouched until the user explicitly picks a model. `handleCreateImageWithModel` re-validates the model before dispatch.

## Labels, Settings and cost communication

- Selector groups: "OpenAI", "Google Gemini (oficial)", "NanoBananaAPI.ai (terceiros — legado)" (listed when its key exists or when it is the current selection).
- Settings → Automação: Google radios (disabled with the explanation unless available, never stranding an already-saved Google default), legacy radios relabelled "terceiros — legado". Saving Settings never changes the stored default.
- Settings → API: card "NanoBananaAPI.ai (terceiros — legado)" (field and base URL kept), card "Google Gemini API" described as one BYOK key for Review, prompt assistance and official image generation, with the live capability status in the always-visible description and a charge warning in the help text. The stale "Nano Banana (Gemini Flash Image)" and "execução será habilitada em uma missão posterior" copy is gone.
- Cost: a concise notice appears whenever a Google model is selected and in the Automatic summary: official Google generation uses the user's Gemini key, **may incur charges** on their Google account, and the estimated cost is not yet available. No free-tier claim, no `$0`/zero estimate, no pricing SQL (Slices C/D).

## `PROVIDER_METADATA.gemini.executionImplemented` audit

Left `false`. Nothing reads the flag at runtime; two suites pin it; and Gemini already serves Review and prompt assistance, so flipping a provider-wide boolean would advertise unrelated capabilities. Image generation is a gated, capability-specific path whose availability is derived on the server (`describeGeminiImageAvailability`). A comment next to the entry records this.

## Tests (mocked only; 0 provider calls, 0 images)

- `components/images/gemini-image-workspace.test.tsx` (real `/imagens` shell, 43 tests): OFF/BLOCKED/unknown signal; disabled Google options with accurate reason; zero Google POSTs when OFF; OpenAI and legacy NanoBanana still generate when OFF; ON: Manual exact body + image, exact model alias preserved, varchar(20) values, selecting an enabled Google option, key-missing vs capability, per-provider readiness independence, request-id rotation rules, 13 Slice A error codes, disabled-route flip, replay outcomes; Assisted Apply/Discard; Automatic single run and failure without retry/fallback; unknown model (no fallback, no rewrite, explicit choice resolves it); legacy `openai` default; existing legacy Session preserved.
- `lib/images/__tests__/image-models-and-readiness.test.ts`: catalog, strict parsing, stored-value interpretation, readiness matrix, option groups, availability derivation (default OFF, boolean-ish rejected, Preview blocked), error mapping, cost wording.
- `lib/__tests__/settings-providers-image-availability.test.ts`: the new response field, independence from the credential, no variable name/value/secret.
- `components/settings/gemini-image-settings.test.tsx`: labels, disabled/enabled radios, default preserved on save, card copy/status, one Gemini key field and the third-party field kept.
- Updated deliberately: `lib/__tests__/gemini-image-boundary.test.ts` (UI may use only the browser-safe `lib/images/*` modules; the workspace page is the single caller of the route; CRLF-safe), `lib/credentials/__tests__/settings-and-resolver-modes.test.ts` (the providers response gained `imageGeneration`). The FUTURE-059 guard "no client component imports `providers/gemini`" passes unchanged.
- Mutation checks (capability gate bypassed) fail 7 tests as intended.

## Deployment notes

No migration, no new env var, no change to Vercel. Production behaviour after this slice: Google models are visible but disabled everywhere; OpenAI and NanoBananaAPI.ai are unchanged.

## Prerequisites for Slices C/D and the release gate

1. **C — usage:** record `provider_usage_events` for Gemini image calls from the `usage` already returned by the Slice A client (`candidatesTokensDetails` IMAGE modality, `serviceTier`); unknown ≠ 0; persist the usage capture on the Attempt or ledger idempotently by Attempt id.
2. **D — pricing registry:** an approved migration (owner-applied) for an image-output price dimension (the `usage_category` check has no image-output category) and verified list prices; until then cost stays "indisponível".
3. **Release gate:** set `CONTENT_STUDIO_GEMINI_IMAGE_GENERATION=enabled` in Production only after C (or an explicit decision to defer it), with one explicitly authorized single-image smoke (confirm `responseModalities:["IMAGE"]` + `imageSize:"1K"` for both models) and a rollback by unsetting the variable.
4. Optional follow-ups: aspect-ratio control, Automatic-mode price/confirmation UX once cost data exists, Preview for the legacy (non-canonical) workspace if Google models are ever wanted there.
