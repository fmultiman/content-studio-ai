# Phase 2H-A — Persisted VideoScene LibraryFile Binding

**Nature:** Productization implementation phase. Scope was limited to the VideoDraft persistence boundary. No Library picker, renderer wiring, fake-button change, AI generation, MP4 persistence, ChannelPiece linkage, migration, or storage mutation was added.

## 1. Objective

Persist an optional `VideoScene.library_file_id` inside the existing `video_drafts.scenes` JSONB document, preserve it through the existing VideoDraft POST/PATCH/GET and autosave flows, and reject invalid scene bindings before a draft write.

## 2. Existing Persistence Boundary

**FACT.** `VideoDraft` remains stored in `video_drafts`; `scenes` remains JSONB. The existing `/api/video-drafts` route still owns create, update, read, and delete operations. The `/videos` autosave still serializes the complete scenes array to the same POST/PATCH endpoint. No scene table or scene-assets endpoint was introduced.

**FACT.** GET already returns the database row unchanged, so the additive JSONB property round-trips without a separate read-path change. Existing scenes without the property remain valid.

## 3. VideoScene Type Extension

`lib/types.ts` now declares:

```ts
library_file_id?: string | null
```

The field is optional and nullable. `image_url`, duration, movement, description, prompt, order, and scene identity remain unchanged. No `AssetRef`, storage path, signed URL, or binary data was added to the persisted scene type.

## 4. Project Authority

The API no longer uses an arbitrary `body.projectId` as the sole authority for scene binding:

- POST derives the authoritative Project from the authenticated, user-owned Production already required by the route.
- PATCH loads the existing authenticated user-owned draft first.
- If a new Production is supplied, its authenticated ownership and Project are loaded and become authoritative.
- If `projectId` is supplied without a Production, it is independently checked against the authenticated user’s `projects` rows before becoming the target Project.
- If neither is supplied, the existing draft Project is preserved.

This closes the 2H0 finding that PATCH could accept an unvalidated `projectId` when no Production was supplied. The body may still be checked for consistency with a Production, but it does not establish ownership by assertion.

## 5. POST Validation

Before `video_drafts` INSERT, the route collects all non-null scene `library_file_id` values, deduplicates them, and validates them in one `library_files` query scoped to the authenticated user.

The authoritative Production Project is passed to the pure validator. A same-Project active LibraryFile is accepted; a missing, inaccessible, soft-deleted, malformed, or different-Project reference returns an explicit 400 response with a stable error code. The insert is not attempted after a validation failure.

## 6. PATCH Validation

Before `video_drafts` UPDATE, the route derives the target Project as described in §4 and validates the complete submitted scenes array against that Project. This applies whether the Project is unchanged, changed through a validated Production, or changed through a separately validated Project ID.

The update payload writes the authoritative Project value rather than blindly copying `body.projectId`. A binding for Project A cannot be saved onto a draft whose target context is Project B, even when both Projects belong to the same user.

## 7. Security Gap Handling

**PASS.** The required narrow security correction was possible inside the existing API boundary; no transversal auth rewrite was needed.

The implementation does not trust:

- a client-provided Project ID without ownership lookup;
- a LibraryFile ID without authenticated-user lookup;
- a Production/Project combination that disagrees;
- a previous draft Project when the request intentionally moves to a validated new context.

Independent authorization issues outside this binding path were not expanded into this phase.

## 8. LibraryFile Validation

`lib/video-scene-library-bindings.ts` provides the small pure validation seam:

- `collectLibraryFileIds(scenes)` deduplicates IDs, so duplicate references across scenes are allowed;
- UUID-shaped IDs are checked before database lookup;
- missing or inaccessible records return `LIBRARY_FILE_NOT_FOUND`;
- `deleted_at !== null` returns `LIBRARY_FILE_DELETED`;
- null or mismatched `project_id` returns `LIBRARY_FILE_PROJECT_MISMATCH`;
- a binding without an authoritative draft Project returns `DRAFT_PROJECT_REQUIRED`.

The persistence model stays generic across `LibraryFile.kind` values. The current renderer’s image-only capability is not encoded into this field or this validator.

## 9. Autosave Round-Trip

The existing autosave already carries the complete scene object. Since the new field is an ordinary optional property, it follows this unchanged path:

```text
VideoScene.library_file_id
  → client scenes state
  → existing POST/PATCH JSON payload
  → validated video_drafts.scenes JSONB
  → existing GET/loadDraft response
  → client scenes state
```

The focused test proves JSON serialization/deserialization preserves `library_file_id` and leaves legacy `image_url` unchanged. No conversion to `AssetRef`, URL, or storage metadata occurs.

## 10. Legacy `image_url` Compatibility

`image_url` remains untouched and optional in the existing type. Historical scenes containing a base64 data URL continue to serialize and load as before. This phase does not migrate, upload, delete, or reinterpret any legacy image data.

The future rule from Phase 2H0 remains: a valid `library_file_id` is the new canonical media identity for product preparation; `image_url` remains a legacy preview fallback only when no binding exists. Rendering precedence is not implemented in this phase.

## 11. Generic Binding vs Image-Only Renderer

`library_file_id` identifies a generic LibraryFile. The Library schema already supports `image`, `video`, `audio`, `document`, and `other`. No image-only restriction was added to persistence.

The existing Timeline/Remotion preparation remains unchanged and currently accepts image LibraryFiles for the Documentary Card hero. A future capability boundary, not this persistence validator, will determine whether a video or audio LibraryFile is valid for a particular render slot.

## 12. Error Behavior

Invalid bindings fail atomically with HTTP 400 and explicit codes:

| Case | Code |
|---|---|
| malformed UUID | `INVALID_LIBRARY_FILE_ID` |
| missing/inaccessible file | `LIBRARY_FILE_NOT_FOUND` |
| different or missing Project | `LIBRARY_FILE_PROJECT_MISMATCH` |
| soft-deleted file | `LIBRARY_FILE_DELETED` |
| binding without draft Project | `DRAFT_PROJECT_REQUIRED` |

The route does not silently clear an invalid field and does not fall back to `image_url` during validation.

## 13. Atomicity

All unique binding IDs are validated before INSERT or UPDATE. If any scene is invalid, no partial scene array or partial draft write is performed. Duplicate references are queried once and accepted when valid.

## 14. Tests

Added `lib/__tests__/video-scene-library-bindings.test.ts` covering:

- legacy/null scenes;
- valid same-Project binding;
- duplicate references across scenes;
- malformed, missing, cross-Project, and soft-deleted files;
- missing authoritative Project;
- JSON round-trip preserving `library_file_id` and legacy `image_url` without `AssetRef`/URL/storage fields.

Focused validation also reran the Phase 2G adapter and LibraryFile preparation suites: **57 tests passed**.

## 15. Baseline

- Full suite: **589/589 passed** (48 test files; +8 tests for this phase)
- Typecheck: **PASS**
- Lint: **0 errors / 45 warnings**
- Production build: **PASS**

The prior 581-test baseline remained green; the increase is solely from the new binding tests.

## 16. DB / Schema Impact

**Migration count: zero.** `video_drafts.scenes` is already JSONB and the new property is additive. No SQL file, database schema, row, storage object, or migration was changed.

No `AssetRef`, signed URL, `storage_path`, or renderer contract was persisted.

## 17. Deferred Library Picker

No `/videos` UI or picker was changed. The existing project-scoped Library picker remains available for a later phase. This phase proves the server boundary independently of client selection.

## 18. Deferred Renderer Wiring

No changes were made to `adaptVideoDraftToTimelineManifest`, `prepareTimelineLibraryFileAssets`, `renderResolvedTimelineInput`, `TimelineComposition`, Remotion, or the fake “Gerar Vídeo” action. The next product layer may derive `sceneAssets[scene.id] = { type: 'library_file', ref: scene.library_file_id }` only after loading and revalidating the persisted references.

## 19. Verdict

**`PASS`**

`library_file_id` is now an optional persisted VideoScene identity with existing-draft compatibility, POST/PATCH server validation, authoritative Project resolution, same-Project enforcement, soft-delete rejection, duplicate-reference support, atomic failure, and autosave JSON round-trip. `image_url` remains legacy-compatible. No migration, new API, renderer integration, picker, UI expansion, generation flow, or output persistence was introduced.
