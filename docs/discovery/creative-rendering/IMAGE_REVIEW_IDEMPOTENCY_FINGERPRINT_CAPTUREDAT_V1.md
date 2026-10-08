# IMAGE_REVIEW_IDEMPOTENCY_FINGERPRINT_CAPTUREDAT_V1

## Status

- Mission: FUTURE-040. Baseline: `origin/main` `a54672ce130a270cb753f5ef2c004cbb4bc44b5e`.
- Branch: `fix/image-review-idempotency-capturedat-v1`.
- Schema: **no migration**. Public request/response contract: **unchanged**. UI: **unchanged**. Paid provider calls: **0**.
- Smoke/merge/Production closure: pending a separate stage (see Handoff).

## Phase 0 — factual audit

### The pipeline (Image Review POST)

`app/api/reviews/image/route.ts` → `ReviewRequestSchema` (`attemptId`, `clientRequestId`, strict) → `createImageReviewExecution`:

1. `resolveImageReviewContext(db, userId, attemptId)` (owner-scoped Attempt, output, Project, Production, normalized Identity) → `{ context, subject, contextFingerprint }`.
2. `resolveImageArtifact` → canonical artifact id (bound to the stored bytes).
3. `fingerprint = buildRequestFingerprint(attemptId, outputId, contextFingerprint, artifactId)`.
4. `findReviewByClientRequest` → same fingerprint ⇒ replay (`replayed: true`, no provider); different ⇒ `409 REVIEW_IDEMPOTENCY_CONFLICT`. **This check runs before any insert, credential lookup or provider call.**
5. Active-Review check / stale recovery (FUTURE-046), insert, credential, provider, terminal write.

### The twelve questions

| # | Question | Answer |
|---|---|---|
| 1 | Old fingerprint inputs | `sha256(JSON.stringify({ attemptId, outputId, artifactId, adapter:'image', adapterVersion:'image-review-v1', contextFingerprint }))`, where `contextFingerprint = sha256(JSON.stringify(context))` and `context = { schemaVersion, capturedAt, project:{id, context, evaluationMode, identity}, production:{id,title,intention,type}\|null }`. |
| 2 | Origin of `capturedAt` | `new Date().toISOString()` inside `resolveImageReviewContext` (`lib/reviews/context.ts`). |
| 3 | Regenerated every resolution? | **Yes.** Every POST resolves the context afresh. |
| 4 | Persisted? | Yes: in `media_reviews.context_snapshot` (with the hash as `fingerprint`). |
| 5 | Alters provider execution? | **No.** `capturedAt` is read by no prompt builder, adapter, provider, repository mapper or UI (`grep capturedAt` over `lib components app` finds only its creation, its type and the Video adapter that already removes it). |
| 6 | Alters media identity? | No (media is bound by `artifactId`). |
| 7 | Alters prompt / model / provider selection? | No. |
| 8 | Alters authorization / ownership? | No (owner scoping is by `user_id` filters, independent of it). |
| 9 | Can the same semantic request get a different one? | **Always**, whenever the two requests resolve at different milliseconds. |
| 10 | Other volatile fields inside the fingerprint? | **None.** `output.updated_at` and the signed output URL are in `subject`, not in the fingerprint. |
| 11 | Image-only or shared? | Image-only. `video-context.ts` already strips `capturedAt` before hashing (a comment says so); Video is untouched. |
| 12 | Reproducible deterministically? | **Yes.** Two POSTs with the same `clientRequestId` and unchanged data, one clock tick apart, produce different `contextFingerprint`s, hence different request fingerprints, hence `REVIEW_IDEMPOTENCY_CONFLICT`. Reproduced red before the fix (8 failing assertions across OpenAI and Gemini paths). |

Consequence beyond the title: because the hash always differed, **every** same-id retry of an Image Review conflicted — the replay branch was effectively unreachable for real traffic (the old unit tests mocked the fingerprint function, so they never saw it).

## Field classification

| Input | Class | Why |
|---|---|---|
| `attemptId`, `outputId` | semantic | which generation is reviewed |
| `artifactId` | semantic | the canonical bytes reviewed |
| `adapter`, `adapterVersion` | semantic | evaluation contract |
| `context.schemaVersion` | semantic | context contract |
| `project.id/context/evaluationMode/identity` | semantic | the evaluator is prompted with them; a change is a different Review |
| `production.id/title/intention/type` | semantic | same |
| `context.capturedAt` | **observational / volatile** | regenerated per resolution, read by nothing |
| Attempt prompt / provider / model / config / source | derived-stable | fixed per Attempt (`IMAGE_ATTEMPT_SUBMISSION_IMMUTABLE`), so `attemptId` already carries them; a different prompt means a different Attempt, which conflicts |
| `output.updated_at`, signed URL, file size | outside the fingerprint | never were in it; unchanged |

## Fix

`lib/reviews/context.ts`:

- `IMAGE_REVIEW_CONTEXT_SEMANTIC_FIELDS` / `IMAGE_REVIEW_CONTEXT_OBSERVATIONAL_FIELDS` document the classification.
- `semanticImageReviewContext(context)`: an explicit **allow-list** projection (not a delete at the call site), so a new context field is excluded from identity until someone classifies it.
- `fingerprintImageReviewContext(context)` hashes the projection through `canonicalJson` (sorted keys at every depth), removing property-order accidents. No pre-existing canonicalization helper existed for this; the small function lives next to its only use.
- `resolveImageReviewContext` returns that stable hash as `contextFingerprint`; `buildRequestFingerprint` uses `canonicalJson` too. Signatures are unchanged, so `service.ts` is untouched.

Stored data: `context_snapshot` still carries `capturedAt` (history/provenance) — **not removed, not rewritten**. Its `fingerprint` field is now the stable hash for new Reviews.

## Historical rows

No backfill, no migration. Existing rows keep their old, capturedAt-inclusive fingerprints. They were already unreplayable (the old hash could never be reproduced by a later request), and a `clientRequestId` is a one-shot UUID per gesture, so nothing regresses: a retry against a pre-fix row still answers `REVIEW_IDEMPOTENCY_CONFLICT` exactly as before. Completed/failed rows stay immutable (a test asserts a replay writes nothing).

## Boundaries

- **Video:** untouched. It already excludes `capturedAt`; no shared helper was refactored; its suites are green.
- **Provider safety:** the fingerprint check stays before every provider call; a replay and a conflict both make 0 provider calls (OpenAI and Gemini paths counted).
- **Usage ledger (FUTURE-043):** a replay and a conflict write no `provider_usage_events`; a new `clientRequestId` that executes writes a new set.
- **Stale recovery (FUTURE-046):** unchanged; a same-id retry of an old in-flight Review replays it and never reaps it.
- **Public contract:** `REVIEW_IDEMPOTENCY_CONFLICT` and the response shapes are unchanged; no fingerprint or hash is exposed.

## Tests

- `image-review-idempotency.test.ts` (22): real context resolution + repository + services over the in-memory DB, faked clock. Covers: capture-time change replays (OpenAI and Gemini, provider calls = 1 total); same clock replays; in-flight same-id replay not reaped; `capturedAt` still stored; stable fingerprint across two Reviews; conflicts for a different artifact, output, Attempt, Project context, evaluation mode, Identity, Production title/intention/type with provider/usage/DB untouched; Gemini usage exactly-once across replay/conflict/new Review; new id runs normally; completed row not rewritten; failed row replays.
- `image-review-fingerprint.test.ts`: allow-list projection never contains `capturedAt` or unknown fields (the regression guard that fails if `capturedAt` is added back); every semantic input changes the hash; property-order independence; every key of a REAL resolved context is classified; real resolutions at two instants share one fingerprint.
- Existing Image, Video, stale-recovery, Gemini usage, Settings usage and Video UI/history suites unchanged and green.

## Residual gaps

- Pre-fix Image Reviews cannot be replayed (unchanged behavior; not a regression).
- Project/Production text edited between a request and its retry conflicts by design.

## Preview smoke evidence (READ-ONLY)

- **Preview deployment:** `https://content-studio-mkcxvx6ts-fmultimans-projects.vercel.app` (HEAD `051f536051d8a3eedc88213665753cb977ede9d5`).
- **Vercel bypass:** successful via share link.
- **App authentication:** authenticated as `flavio.multiman` on the Preview origin.
- **Image Review panel & history:** loaded normally on `/imagens/geracoes/73e8a48d-636a-4a7e-9884-ea0d1f3631f0`; existing attempts, legacy evaluations, and feedback displayed correctly.
- **Image Review no-write proof:** opening and browsing history created 0 reviews; `media_reviews` image rows count remained exactly 17 (all `completed`).
- **Provider calls:** 0 paid Gemini/OpenAI calls for Image Review.
- **Video Review status:** existing video reviews remain completed (0 pending/running); video generation workspace (`/videos/geracoes/11912666-ecbc-4b71-b810-3c24aecd41fc`) loaded without errors.
- **Settings → Uso e custos:** loaded normally on `/configuracoes?tab=usage`, rendering summary cards, per-provider aggregations, and execution details.
- **Database invariants:** 0 pending/running review rows; 17 image review rows remain completed; paid calls count = 0.

