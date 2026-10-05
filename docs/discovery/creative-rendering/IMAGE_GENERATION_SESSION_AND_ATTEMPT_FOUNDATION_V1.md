# Image Generation Session and Attempt Foundation V1

Status: implemented foundation; route convergence intentionally deferred.

Starting `origin/main`: `781a208f3f50e1bf1168c8a98ed8f396fbf3382a`
Implementation branch: `feat/image-generation-session-attempt-foundation-v1`
Worktree: `D:/Traycer/worktrees/fmultiman__content-studio-ai/feat-image-generation-session-attempt-foundation-v1`

This slice implements the durable Image generation foundation approved by the convergence discovery. It does not move `/imagens`, does not retire `ImageDraft`, does not change Review, Library promotion, Video generation, Creative Editor, or provider execution. The existing `ImageDraft` remains the compatibility authority until `IMAGE_GENERATION_ROUTE_CONVERGENCE_V1`.

## Before state

The architectural authority is `GENERATION_SESSION_AND_REVIEW_ARCHITECTURE_CONVERGENCE_V1.md`; the autosave audit remains the reliability input. The pre-migration read-only inventory is [image-generation-session-attempt-foundation-v1-inventory.json](../../migrations/image-generation-session-attempt-foundation-v1-inventory.json).

The current Image path is:

| Concern | Current authority before this slice |
| --- | --- |
| Workspace route | `app/(dashboard)/imagens/page.tsx` |
| Draft route/list | `/imagens/rascunhos`, `app/api/image-drafts/route.ts` |
| Working state | `public.image_drafts` scalar fields plus JSONB `prompt_details`, `current_evaluation`, and `generation_attempts` |
| Generated output | `public.images`; the current draft points to `current_image_id` and duplicates `image_url` |
| Provider execution | `/api/openai/generate-image` and `/api/nanobanana/generate`; Nano Banana also uses `generation_tasks` |
| Attempt history | Browser-derived `GenerationAttempt[]` persisted inside `image_drafts.generation_attempts` |
| Evaluation | Browser/current draft JSON and history JSON; no normalized Review rows |
| Library | Explicit `/api/images/[id]/save-to-library`; unchanged |
| Project/Production | Draft POST validates owner and Project/Production coherence; output rows do not carry the complete draft lineage |

The old model conflated editable prompt/configuration, current result pointer, attempt history, and evaluation. Its history does not preserve a complete immutable provider request: provider, exact generation config, source identity, and execution status are frequently absent. The browser also derives attempt numbering. This slice preserves those facts without fabricating them.

Pre-migration counts from the active Supabase project `nuhdhnasuohizxtmyiju` were:

| Entity | Count |
| --- | ---: |
| `image_drafts` | 29 |
| `images` | 26 |
| `library_files` | 69 |
| drafts with Project | 25 |
| drafts with Production | 24 |
| drafts with current image | 12 |
| drafts with history | 13 |
| history entries | 23 |
| drafts with current evaluation | 6 |
| legacy `video_generations` | 10 |

All 29 drafts had a structurally usable working state. The 12 current image references were same-user/same-Project and non-dangling; all non-null Production references were same-user/same-Project. Four legacy drafts are unscoped (`project_id` and `production_id` null), and one has a Project without a Production. Those scopes remain nullable; no owner or Production was invented. One history entry in draft `8c5bbdb7-e864-4cfe-8745-63e1030be9cd` lacks `imageId`; it remains a historical Attempt with a null output pointer.

## Implemented persistence contract

### `image_generation_sessions`

This is mutable editable working state, not historical generation truth.

| Field | Meaning |
| --- | --- |
| `id` | Durable Session id; the backfill uses the legacy draft id as a deterministic lineage key |
| `user_id` | Server-derived owner |
| `project_id`, `production_id` | Nullable scope copied from the draft and checked by database trigger and API |
| `name` | Existing workspace name |
| `working_prompt` | Editable user prompt |
| `working_state` | Versioned Image-specific JSON document |
| `current_image_id` | Existing output pointer; references `images`, never copies media bytes |
| `status` | `active` or `archived` |
| `revision` | Integer CAS token; editable updates must advance it by exactly one |
| `legacy_image_draft_id` | Temporary one-to-one source lineage |
| `legacy_current_evaluation` | Compatibility preservation only; it is not Review authority |
| timestamps | Creation and last mutation |

The V1 working document is `ImageGenerationWorkingStateV1` in `lib/image-generation/session.ts`:

```json
{
  "schemaVersion": 1,
  "generatedPrompt": null,
  "generatedPromptPt": null,
  "promptDetails": null,
  "autoMode": false,
  "selectedModel": null,
  "imageStatus": null,
  "currentAttempt": null,
  "currentImageId": null,
  "sourceReferences": [],
  "generationConfig": {
    "size": null,
    "quality": null,
    "aspectRatio": null,
    "style": null,
    "providerOptions": {}
  },
  "legacyImageUrl": null
}
```

The migration fills only values present in `image_drafts`; unknown image controls and source media remain empty/unknown. `current_image_id` is also stored as a server-validated indexed pointer. Session PATCH updates the pointer and document together.

### `image_generation_attempts`

This is the durable submission lineage. Submission fields are immutable after insert; only execution lifecycle fields may change.

Immutable submission fields are `session_id`, owner/scope, `sequence`, `submitted_prompt`, `provider`, `model`, `submitted_config`, `source_snapshot`, `client_request_id`, `request_fingerprint`, legacy backfill identity/evaluation, `submitted_at`, and `created_at`.

Lifecycle/output fields are `status`, `provider_task_id`, `result_image_id`, `result_metadata`, `failure_details`, `completed_at`, and `updated_at`. Statuses are `queued`, `submitted`, `processing`, `succeeded`, `failed`, or `legacy`.

`result_image_id` points to an existing `images` row. No image bytes are copied and no LibraryFile is created. The one history entry without an image id has a null result pointer; its source record remains identified by `legacy_image_draft_id` and `legacy_attempt_key`.

The database trigger rejects updates to submission fields. The API does the same by accepting only lifecycle fields on `PATCH /api/image-generation-attempts/[id]`. A later Session edit therefore cannot rewrite an old Attempt. A new Generate submission must create a new Attempt.

## Ownership and concurrency

The new routes are server-owned writes using the verified authenticated user and the service-role client only after the user session has been checked. Project ownership is verified server-side. A non-null Production must belong to the user and the supplied Project. A Production without a Project is rejected. Attempt scope is copied from its Session; the client cannot submit a different scope. Output/source references are checked against the authenticated owner and Project where applicable.

Database triggers enforce the same relationships, including current/result image ownership and Project scope. RLS is enabled on both tables. Authenticated users receive SELECT only for their own rows; service-role writes are used by trusted server routes. No client role receives direct INSERT/UPDATE access.

Session PATCH uses `expectedRevision`. The update predicate includes owner, id, and revision, and the database trigger requires revision `old + 1`. A stale update returns `409 SESSION_VERSION_CONFLICT` with the current session. Debouncing, single-flight, unload flushing, and route-exit behavior remain in the old UI and are deliberately deferred.

Attempt POST accepts optional `clientRequestId`. When supplied, the server stores a SHA-256 fingerprint of the exact session, prompt, provider, model, config, and source snapshot. A retry with the same key and fingerprint replays the existing Attempt; the same key with a different fingerprint returns `409 IDEMPOTENCY_CONFLICT`. The route does not call a provider. The next route-convergence mission must make the client key mandatory before provider dispatch.

## APIs for the next mission

| Method | Route | Contract |
| --- | --- | --- |
| `GET` | `/api/image-generation-sessions` | Own sessions, optionally filtered by Project/Production |
| `POST` | `/api/image-generation-sessions` | Create an owned Session with validated working state; client id is optional for migration-era idempotent creation |
| `GET` | `/api/image-generation-sessions/[id]` | Own Session only |
| `PATCH` | `/api/image-generation-sessions/[id]` | Replace working document with `expectedRevision`; scope/name are immutable |
| `GET` | `/api/image-generation-attempts?sessionId=` | Own Attempt history |
| `POST` | `/api/image-generation-attempts` | Freeze a validated Session lineage into a queued Attempt; no provider call |
| `GET` | `/api/image-generation-attempts/[id]` | Own Attempt only |
| `PATCH` | `/api/image-generation-attempts/[id]` | Provider lifecycle/output fields only |

The compatibility `/api/image-drafts` API, `/imagens`, and `/imagens/rascunhos` remain unchanged and continue to read/write `image_drafts`. There is no dual-write from the old UI, so there is no uncontrolled second mutable authority: migrated Sessions are the future authority, while the old UI is explicitly the temporary compatibility authority until route convergence.

## Preserving migration

The migration is split into:

1. `scripts/050_create_image_generation_session_attempts.sql`: tables, indexes, RLS, scope triggers, revision guard, immutable Attempt guard.
2. `scripts/051_backfill_image_generation_sessions_and_attempts.sql`: deterministic preserving backfill with reconciliation assertions.
3. `scripts/052_image_generation_session_attempt_indexes.sql`: single-column foreign-key indexes after backfill.
4. `scripts/053_freeze_image_attempt_submission_time.sql`: freezes the submitted timestamp after the schema migration was applied.

They were applied to project `nuhdhnasuohizxtmyiju` after the inventory and dry-run checks. The backfill is rerun-safe: it keys Sessions by `legacy_image_draft_id` and Attempts by `(legacy_image_draft_id, legacy_attempt_key)`. It never updates or deletes an `image_drafts` row.

The complete disposition is:

| Disposition | Count | Meaning |
| --- | ---: | --- |
| `MIGRATE` | 16 | Working state migrated; no legacy attempt array |
| `MIGRATE_WITH_PARTIAL_HISTORY` | 13 | Working state plus 23 stored history entries migrated; unknown immutable fields remain unknown |
| `COMPATIBILITY_ONLY` | 0 | None needed |
| `AMBIGUOUS / QUARANTINE` | 0 | No unsafe or cross-tenant reference found |
| `INVALID — REVIEW BEFORE DISCARD` | 0 | No row discarded |
| Discarded | 0 | Preserving migration |

Reconciliation after migration: 29 source drafts → 29 Sessions; 23 source history entries → 23 Attempts; 22 historical Attempts linked to an existing Image output and 1 intentionally `legacy` Attempt with no output id; 0 source drafts without a Session; 0 history entries without an Attempt; 6 current evaluations preserved on Sessions; 23 history evaluations preserved on Attempts; 26 Images unchanged; 69 LibraryFiles unchanged; 10 legacy VideoGenerations unchanged; 0 new LibraryFiles. Post-migration scope checks returned zero Session, Production, Attempt, or output-reference mismatches.

The old `image_drafts` rows and JSON evaluation/history remain intact for the later compatibility retirement and Review migration. No evaluator behavior was changed, and no evaluation was converted into approval.

## Verification

Focused foundation tests: **5 passed** (`lib/image-generation/__tests__/foundation.test.ts`). They cover the versioned working contract, size rejection, deterministic idempotency fingerprint, SQL immutability/RLS protections, and closed inventory reconciliation.

Typecheck: **passed** (`pnpm exec tsc --noEmit -p tsconfig.typecheck.json`).
Touched-scope lint: **passed** (`pnpm exec eslint app/api/image-generation-sessions app/api/image-generation-attempts lib/image-generation`).
Diff check: **passed** (`git diff --check`).

The full suite ran with 4,246 tests: 4,244 passed and two unrelated existing Creative Editor tests failed. Both expect `Estilo` while the current implementation on the starting commit uses `Estilos`; the failure is present outside this slice and those files were not changed. The service-role boundary test initially discovered the new server-owned route families; its allow-list was updated as the required security test maintenance, after which it passed. The two pre-existing Creative Editor failures remain for their own mission.

Provider calls: **0**. No OpenAI, Replicate, Nano Banana, Kling, video provider, or other paid provider was invoked.

## Explicit non-goals and residual debt

- `/imagens` still uses `ImageDraft`; `/imagens/geracoes/[sessionId]` is not introduced here.
- `/imagens/rascunhos`, old APIs, and old autosave remain temporarily available.
- The old client debounce/unload and route-exit gaps remain for the reliability/route mission.
- The current Image evaluator remains JSONB compatibility data. Review, refined prompt semantics, approval, and Project Identity review context remain for the Review convergence mission.
- The old generation provider routes do not yet create Attempts. The route-convergence mission must wire provider dispatch after freezing an Attempt and must require `clientRequestId` before paid execution.
- `ImageDraft` is not deleted, renamed, or dual-written in this foundation.
- No Video table, Session, Draft, Scene, or legacy VideoGeneration row was changed.

## Next mission contract

The exact next mission is `IMAGE_GENERATION_ROUTE_CONVERGENCE_V1`. It may assume that Image Sessions and Attempts exist, are ownership-scoped, have CAS and immutable submission guards, and have a verified preserving backfill. It must move the UI and provider submission flow in a bounded step, choose the Session as the sole new working-state authority, require idempotent Attempt creation before provider dispatch, and retain the old Draft API only as an explicitly measured compatibility boundary.

It must not start Review convergence or legacy cleanup as part of that route slice.
