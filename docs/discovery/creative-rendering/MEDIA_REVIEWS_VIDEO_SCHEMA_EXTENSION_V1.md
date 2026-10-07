# MEDIA_REVIEWS_VIDEO_SCHEMA_EXTENSION_V1

## Status

- Baseline: `origin/main` `5e277ad717ceb0c1d849ac398ce25333fc3ebe9e`.
- Deliverable: `scripts/060_extend_media_reviews_for_video.sql` plus behavioral tests. **Migration 060 is authored, NOT applied** to Production, Preview or any Supabase database. The owner applies it manually (procedure below).
- Application code changed: **none**. No Review adapter, route, contracts/repository change, Gemini execution or UI. Those follow only after 060 is applied and verified.
- Paid provider calls: 0.

## The blocker

`GEMINI_VIDEO_REVIEW_ADAPTER_V1` stopped before implementation because live `media_reviews` could not persist a Video Review. Verified against the live Production schema (read-only queries) and against `054` / `058`:

| Image-only element | Previous live shape |
|---|---|
| `media_reviews_subject_media_type_check` | `CHECK (subject_media_type = 'image')` |
| `image_attempt_id` | `uuid NOT NULL`, FK `media_reviews_image_attempt_id_fkey` → `image_generation_attempts(id)` `ON DELETE RESTRICT` |
| `image_output_id` | `uuid NOT NULL`, FK `media_reviews_image_output_id_fkey` → `images(id)` `ON DELETE RESTRICT` |
| `validate_media_review_scope()` | always loads the Image Attempt (raises `MEDIA_REVIEW_ATTEMPT_NOT_FOUND`) and, since `058`, requires `artifact.media_type = 'image'` |
| `media_reviews_active_attempt_key` | `UNIQUE (image_attempt_id) WHERE status IN ('pending','running')` |
| `media_artifact_id` | `uuid NOT NULL` FK → `media_artifacts(id)` `ON DELETE RESTRICT` (added by `058`) |

The live `validate_media_review_scope()` body was confirmed byte-for-byte identical to the one in `058` before authoring. Production holds 17 Review rows, all Image, none in flight.

No Image Attempt is fabricated for Video and no second Review table is created: `media_artifact` is the canonical subject and `media_reviews` stays the one universal Review store.

## New persistence shape

| | Image Review (unchanged) | Video Review (new) |
|---|---|---|
| `subject_media_type` | `image` | `video` |
| `image_attempt_id` | NOT NULL | NULL |
| `image_output_id` | NOT NULL | NULL |
| `media_artifact_id` | NOT NULL, artifact `image` | NOT NULL, artifact `video` |

Constraints changed or added (all explicit names):

1. `media_reviews_subject_media_type_check` → `CHECK (subject_media_type IN ('image','video'))`. No other media type.
2. `image_attempt_id` and `image_output_id` → `DROP NOT NULL` (physical only; their FKs, ON DELETE RESTRICT and the Image indexes stay).
3. `media_reviews_subject_shape` (new) restores the Image requirement and forbids Image links on Video:
   `(image AND attempt NOT NULL AND output NOT NULL AND artifact NOT NULL) OR (video AND attempt NULL AND output NULL AND artifact NOT NULL)`.
   Image integrity is not weakened: an Image row that lacks either link is still rejected.

## Trigger branching — `validate_media_review_scope()`

Replaced in place with `CREATE OR REPLACE`; the existing `media_reviews_scope` trigger (BEFORE INSERT OR UPDATE) keeps firing and `guard_media_review_lifecycle()` is unchanged (it already covers every subject column, so a Video Review is immutable once created and terminal states stay terminal).

- **Image branch:** the `058` logic verbatim (attempt exists, owner/output/Project/Production equality with the Attempt, output scope, artifact exists, owned, `image`, Project/Production equality), same order, same exception names. Behind an explicit `subject_media_type = 'image'` guard.
- **Video branch:** artifact required; artifact exists, belongs to the Review owner, and `media_type = 'video'`; Review Project and Production equal the artifact's (NULL-safe).
- **Shared checks (both branches, identical to `058`):** when `project_id` is present the Project belongs to the owner; when `production_id` is present the Production belongs to the owner **and** to the Review's Project.
- Any other `subject_media_type` raises `MEDIA_REVIEW_UNSUPPORTED_SUBJECT` (defense in depth next to the CHECK).

### Project / Production semantics (decision)

The artifact is the canonical subject, so a Review's scope **equals the artifact's scope, NULL-safe**, exactly as the Image branch already does. Consequences:

- A Library video with NULL Project and NULL Production is reviewable with a NULL-scoped Review. Nothing is required that the artifact contract allows to be NULL.
- A Project-only artifact is reviewed with that Project and NULL Production.
- A Review cannot claim a Project/Production the artifact does not have, and cannot omit one it has. A Production without a Project is rejected (also the `media_artifacts` rule).
- Ownership of Project/Production is still verified against the owner.

If a later product need arises to review a Library video "in the context of" a different Project, that would be a deliberate schema/contract change, not something to allow implicitly in a trigger.

## In-flight uniqueness

```sql
CREATE UNIQUE INDEX IF NOT EXISTS media_reviews_active_video_artifact_key
  ON public.media_reviews (media_artifact_id)
  WHERE subject_media_type = 'video' AND status IN ('pending','running');
```

- The lifecycle vocabulary is the existing one (`pending`, `running`, `completed`, `failed`, from `media_reviews_status_check`); the predicate uses exactly the two in-flight states the Image index uses.
- At most one in-flight Video Review per artifact (the Files API upload and model call are paid and slow).
- `completed` and `failed` never block, so one artifact keeps unlimited immutable Review history.
- `media_reviews_active_attempt_key` is **not touched**. A unique index treats NULLs as distinct, so Video rows (`image_attempt_id` NULL) can never collide on it and Image behavior is identical.

## Compatibility guarantees

- Additive and metadata-only: no `INSERT`, `UPDATE`, `DELETE`, backfill, table drop or column drop. Existing tuples are never rewritten (proved in tests by comparing `xmin` and full row JSON before/after).
- All 17 existing Reviews are Image rows with both links and an artifact, so every new constraint is satisfied by construction.
- Row count, IDs, Attempt/output/artifact links, payloads, status and timestamps are unchanged.
- No application code depends on 060 yet; until a Video adapter writes `video` rows, runtime behavior is unchanged. Image Review code paths and the OpenAI/Gemini Image providers are not involved.
- `ALTER ... DROP NOT NULL` and `ADD CONSTRAINT ... CHECK` take a short ACCESS EXCLUSIVE lock; the table has 17 rows, so the lock is momentary.

## Manual application procedure

1. Confirm baseline (read-only) — see check 0 below. Expect 17 rows, 0 in flight, and record the printed hash.
2. Open the Supabase SQL editor for project **Content Agent Studio** (`nuhdhnasuohizxtmyiju`) and paste the full contents of `scripts/060_extend_media_reviews_for_video.sql` (it is self-contained and wraps itself in `BEGIN; ... COMMIT;`). Run it once.
3. Run the post-apply verification below.
4. Report the results; only then does the Video Review adapter mission resume.

Failure characteristics: the script is one transaction. If any statement fails, PostgreSQL aborts the transaction and **none** of the changes apply (the editor will show the error and the schema stays exactly as before). Re-running the script is safe (`DROP ... IF EXISTS` / `IF NOT EXISTS` / `CREATE OR REPLACE`), so a retry after fixing an environmental problem is harmless. If the editor submits statements outside one transaction, a partial apply is still safe to finish by simply re-running the whole script, because each step is idempotent and ordered so that no intermediate state can reject existing Image rows.

## Post-apply verification (all read-only)

```sql
-- 0. Baseline BEFORE applying (record the values) and re-run AFTER; they must be identical.
SELECT count(*) AS n,
       count(*) FILTER (WHERE status IN ('pending','running')) AS in_flight,
       md5(string_agg(id::text||':'||image_attempt_id::text||':'||image_output_id::text||':'||media_artifact_id::text||':'||status, ',' ORDER BY id)) AS shape_hash
  FROM public.media_reviews;
-- Expected at authoring time: n=17, in_flight=0, shape_hash=b7eb6d5a253a215d91f2e6b477b3a8c4

-- 1. subject_media_type allows image and video.
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.media_reviews'::regclass AND conname='media_reviews_subject_media_type_check';
-- Expected: CHECK ((subject_media_type = ANY (ARRAY['image'::text, 'video'::text])))

-- 2. Image FK columns are physically nullable; artifact stays NOT NULL.
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='media_reviews'
   AND column_name IN ('image_attempt_id','image_output_id','media_artifact_id') ORDER BY column_name;
-- Expected: image_attempt_id YES, image_output_id YES, media_artifact_id NO

-- 3. Discriminated shape CHECK exists.
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.media_reviews'::regclass AND conname='media_reviews_subject_shape';

-- 4. Image foreign keys are still in place.
SELECT conname FROM pg_constraint
 WHERE conrelid='public.media_reviews'::regclass AND contype='f' ORDER BY conname;
-- Expected includes media_reviews_image_attempt_id_fkey, media_reviews_image_output_id_fkey, media_reviews_media_artifact_id_fkey

-- 5. Trigger function has both branches; the trigger still points at it.
SELECT position('subject_media_type = ''video''' IN pg_get_functiondef('public.validate_media_review_scope()'::regprocedure)) > 0 AS has_video_branch,
       position('subject_media_type = ''image''' IN pg_get_functiondef('public.validate_media_review_scope()'::regprocedure)) > 0 AS has_image_branch;
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid='public.media_reviews'::regclass AND NOT tgisinternal ORDER BY tgname;
-- Expected: both true; media_reviews_lifecycle, media_reviews_scope, media_reviews_updated_at all enabled ('O')

-- 6. Video in-flight index exists; Image index unchanged.
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname='public' AND tablename='media_reviews'
   AND indexname IN ('media_reviews_active_video_artifact_key','media_reviews_active_attempt_key') ORDER BY indexname;
-- Expected video: UNIQUE (media_artifact_id) WHERE ((subject_media_type = 'video') AND (status = ANY (ARRAY['pending','running'])))
-- Expected image: UNIQUE (image_attempt_id) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))   (unchanged)

-- 7. No existing Review violates the new constraints.
SELECT count(*) AS violating FROM public.media_reviews
 WHERE NOT ((subject_media_type='image' AND image_attempt_id IS NOT NULL AND image_output_id IS NOT NULL AND media_artifact_id IS NOT NULL)
         OR (subject_media_type='video' AND image_attempt_id IS NULL AND image_output_id IS NULL AND media_artifact_id IS NOT NULL));
-- Expected: 0

-- 8. No Video rows exist yet (nothing was backfilled).
SELECT subject_media_type, count(*) FROM public.media_reviews GROUP BY 1;
-- Expected: image 17 only
```

Checks 0 and 7–8 prove existing data is intact; 1–6 prove the schema shape. Re-run 0 after applying and compare `n`, `in_flight` and `shape_hash` to the pre-apply values.

## Rollback caveat

There is intentionally no destructive rollback script. Before any Video Review row exists, reverting is possible (restore the Image-only CHECK, `SET NOT NULL`, the `058` function body, drop `media_reviews_active_video_artifact_key` and `media_reviews_subject_shape`). **Once a Video Review row exists, that revert is impossible without deleting or corrupting immutable Review history** (`SET NOT NULL` and the Image-only CHECK would fail or require deleting those rows). If a problem is found after Video rows exist, fix forward with a new migration instead of reverting 060. Nothing here deletes data.

## Tests

`lib/reviews/__tests__/media-reviews-video-migration.test.ts` runs the real `054`, `056`, `057`, `058` and `060` scripts against **PGlite**, an isolated in-process PostgreSQL (WASM; no network, no Supabase). Only tables the scripts reference are stubbed. It reproduces the real history: Image-only table → legacy Image Reviews → artifact bridge (`058`) → snapshot → `060`.

Covered: existing rows untouched (same `xmin` and row JSON), re-run idempotence, Image Review still accepted, Image missing attempt/output rejected, Video with Image links rejected, Video without/with wrong-type/foreign-owner artifact rejected, Library-style NULL Project/Production accepted, Project and Production mismatches rejected, Production-without-Project rejected, first in-flight Video accepted and second rejected (pending and running), completed/failed history never blocks, different artifacts independent, Image active-attempt uniqueness and index definition unchanged, lifecycle immutability, physical nullability and FKs retained.

PGlite was added as a **dev-only** dependency for this test; it is not imported by application code.

## Residual risks

- PGlite is not Supabase: RLS role behavior, extensions and the real `auth` schema are stubbed, so the manual apply plus the post-apply checks remain the final proof.
- The migration relies on the Image branch being unchanged; any later edit to `validate_media_review_scope()` must keep both branches.
- After apply, the application still rejects Video (`ReviewRecordSchema`, `ReviewRequestSchema`, `toReviewRecord`, `MediaReviewRow` are Image-only). That alignment is the next mission and must ship together with the adapter.
- Review scope equals artifact scope (see decision above); cross-context Review of a Library video is deliberately not allowed by the database.
