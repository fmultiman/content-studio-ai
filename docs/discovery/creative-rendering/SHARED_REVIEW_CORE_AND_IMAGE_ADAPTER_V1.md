# SHARED_REVIEW_CORE_AND_IMAGE_ADAPTER_V1

Status: implementation closure.

This change implements the approved shared Review core and Image adapter. Video
Review remains a future additive adapter and is outside this change.

## Checkpoint and scope

- Starting `origin/main`: `068814a6e26465ae4291a5072883ec286e9574d5`.
- Branch: `feat/shared-review-core-image-adapter-v1`.
- Worktree: `C:/Users/flavi/.traycer/worktrees/fmultiman__content-studio-ai/feat-image-generation-session-attempt-foundation-v1`.
- Active Supabase project: `nuhdhnasuohizxtmyiju`.
- Paid evaluator/provider calls during implementation and tests: `0`.

The implementation does not change Generation Session, Attempt, autosave,
Video, Library, Approval, Creative Editor, or ImageDraft persistence semantics.

## Review authority and subject

`public.media_reviews` is the normalized Review authority. Each Image Review is
an immutable execution attached to an immutable successful
`image_generation_attempts` row and its concrete `images` output. The server
resolves both references and verifies that the output is the Attempt result.
Reviews never attach to mutable Session state as their historical subject.

The typed Image columns are `image_attempt_id` and `image_output_id`. The table
is intentionally Image-shaped for V1; future Video columns can be added without
forcing temporal criteria into the Image payload.

## Schema and migrations

`scripts/054_create_media_reviews.sql` creates:

- Review ownership and Project/Production lineage;
- typed Attempt/output foreign keys;
- adapter, schema, evaluator, context, lifecycle, result, refined prompt and
  idempotency metadata;
- indexes for owner, Attempt, output, Project, active execution and request
  identity;
- RLS selecting only the authenticated owner;
- service-only writes through the trusted server path;
- scope validation and lifecycle immutability triggers.

`scripts/055_backfill_legacy_image_reviews.sql` imports only legacy evaluated
Attempts with a linked output. Unknown evaluator metadata and context remain
explicitly unknown in the snapshot. The raw legacy evaluation is preserved in
the adapter payload.

Both migrations were applied to the active Supabase project. The failed first
attempt to apply 055 inserted nothing; the rerun used the predicate matching
the partial legacy-source unique index and completed successfully.

## Backfill reconciliation

The live reconciliation is:

| Population | Count | Result |
|---|---:|---|
| Historical Attempts | 23 | source inventory |
| Non-null legacy evaluations | 18 | 17 with output + 1 legacy-only |
| MIGRATE_PARTIAL | 17 | 17 normalized Reviews |
| PRESERVE_LEGACY_ONLY | 1 | no normalized Review; legacy fallback remains |
| Null/JSON-null evaluations | 5 | no Review row |
| Normalized legacy Reviews | 17 | all `completed`, `legacy_import` |
| Discarded real evaluations | 0 | preserved |
| Duplicate current-evaluation rows | 0 | current aliases were not re-imported |

The 6 current evaluations overlap the historical records and create no extra
rows. The outputless legacy evaluation remains accessible through the existing
ImageDraft compatibility path.

## Shared contracts and execution

Shared contracts live in `lib/reviews/contracts.ts`. `ReviewRecordV1` separates
record identity, lifecycle, subject, evaluator metadata, context fingerprint,
result and failure. `ReviewResultV1` contains only advisory semantics:
assessment, score, summary, criteria, strengths, issues, recommendations and an
optional refined prompt. There is no Review-level approval field.

The service and repository are in:

- `lib/reviews/context.ts` — server-owned Attempt, output, Project, Production
  and normalized Identity resolution;
- `lib/reviews/repository.ts` — typed persistence and history projection;
- `lib/reviews/service.ts` — lifecycle, idempotency, provider boundary and
  adapter execution;
- `lib/reviews/errors.ts` — typed service errors;
- `lib/reviews/adapters/image.ts` — Image prompt, strict parser and mapping.

The request is `POST /api/reviews/image` with only `attemptId` and a stable
`clientRequestId`. The server authenticates, resolves the subject and context,
claims a pending row, marks it running, calls the evaluator, and persists either
a completed immutable result or a failed historical execution. `GET` on the
same route returns `items`, `latestCompleted` and `latestExecution` for an
Attempt.

The context snapshot contains the Project context, evaluation mode, normalized
semantic Identity, Production context and a fingerprint. It is captured at
Review time, so later Project Identity edits do not reinterpret the old Review.
The client cannot override prompt, output URL, Project, Production or Identity.

## Image adapter

The adapter key is `image`, version `image-review-v1`, with prompt version
`image-review-prompt-v1`. Stable Image criteria are:

- `prompt_adherence`;
- `identity_alignment` when server Identity exists;
- `composition`;
- `visual_quality`;
- `source_fidelity` only when a source snapshot proves a reference;
- `text_legibility` only when the submitted prompt requests text.

The adapter does not add Video temporal criteria. If a legacy-shaped evaluator
response omits detailed criteria, the adapter maps the proven common score and
feedback into the minimal Image criteria; it never fabricates approval.

The current provider boundary remains OpenAI Chat Completions using
`OPENAI_EVALUATION_MODEL` or `gpt-4o-mini`. Tests inject an evaluator and make
zero provider calls.

## Strict parsing and lifecycle

The parser rejects invalid JSON, missing score/feedback/improvements, impossible
scores, malformed criteria and invalid assessments. Provider errors, timeouts
and invalid output become failed Review executions. No malformed response can
become a successful or approved-looking result.

Lifecycle is `pending -> running -> completed` or `pending/running -> failed`.
Completed and failed rows are immutable. A re-review is a new Review with a new
client request identity. A repeated request with the same identity replays the
existing execution and cannot trigger another evaluator call; reusing that
identity with a different subject/context returns an idempotency conflict.

History keeps every execution. `latestCompleted` is the newest completed Review
and remains available after a later failed execution; `latestExecution` is the
newest execution of any status.

## UI and refined prompt

The Image workspace now requests normalized history for canonical Attempts and
passes the latest Review into the existing result/history components. The legacy
evaluation display remains a bounded fallback for migrated data, including the
one outputless legacy evaluation. New Review execution does not write ImageDraft.

An explicit “use refined prompt” action copies the historical suggestion into
the current Image Session working prompt. It does not mutate the Review or
Attempt and does not generate automatically. Existing explicit Library save and
Approval actions remain separate and are not called by Review completion.

The old `/api/evaluate-image` route remains compatibility-only. Its evaluator
output is now strictly validated and incomplete/malformed responses return
`502 INVALID_EVALUATOR_RESPONSE`; it no longer derives a successful fallback.
The new canonical UI uses `/api/reviews/image`.

## Verification

Passed:

- `pnpm typecheck`;
- focused Review contract and Image adapter tests: 2 files, 8 tests;
- legacy Image evaluator tests after updating the obsolete incomplete-output
  expectation: 47 tests;
- `pnpm build` (Next production build completed and included `/api/reviews/image`).

The full Vitest run reproduced two pre-existing Creative Editor label failures
(`Estilo`/`Estilos`) and was stopped after the known Windows test environment
hang. No Review test failure was observed. Whole-repository ESLint did not
complete in the Windows environment; the touched-scope invocation exhibited the
same hang without diagnostics. `git diff --check` passed.

Database verification confirmed the table, typed foreign keys, indexes, RLS
owner SELECT policy, lifecycle triggers and 17-row backfill. No LibraryFile,
Attempt, Session, Video or Approval rows were created or changed by the Review
backfill.

## Residual compatibility debt

- `ImageDraft.evaluation` and `/api/evaluate-image` remain for legacy records
  until all old workspace consumers are retired.
- The outputless legacy evaluation has no honest normalized subject and remains
  legacy-only by design.
- Legacy evaluations lack historical evaluator/provider/context metadata; those
  fields are marked unknown rather than inferred.
- Image UI still supports the old evaluation shape for compatibility.

## Exact next mission

`VIDEO_REVIEW_ADAPTER_V1`: add typed Video Attempt/output subject support and
Video-specific criteria using the shared Review envelope, service, lifecycle,
security and idempotency semantics. Do not change Image Review semantics.
