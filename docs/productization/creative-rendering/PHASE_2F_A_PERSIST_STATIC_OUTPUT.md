# Phase 2F-A — Persist Static Render Output to ChannelPiece

## 1. Objective

Add one explicit action, **"Salvar nesta peça,"** to the static authoring render result, so a rendered PNG can become a real, product-visible `LibraryFile` attached to the `ChannelPiece` — using only the existing upload pipeline identified as sufficient in `PHASE_2F0_STATIC_OUTPUT_LIFECYCLE_ARCHITECTURE.md` (verdict `EXISTING_OUTPUT_MODEL_SUFFICIENT`). No new entity, schema, or API route.

## 2. Existing Upload Route Audit

`POST /api/channel-piece-media/upload` (`app/api/channel-piece-media/upload/route.ts`) was read in full before writing any client code.

- **Payload:** `multipart/form-data` with exactly two fields: `file` (a `File`) and `channelPieceId` (string UUID). No `role` field is accepted or needed.
- **Auth:** `supabase.auth.getUser()`; 401 if missing.
- **Ownership:** verifies the `ChannelPiece` belongs to the user, resolves `project_id` via `ChannelPiece → EditorialContent`, rejects if the project chain is broken (400/404).
- **MIME validation:** whitelist includes `image/jpeg, image/png, image/webp, image/gif, video/mp4, video/webm, video/quicktime` — `image/png` (our render output) is accepted.
- **Size limit:** 50 MB — a 1080×1350/1920 PNG is well under this.
- **Orchestration:** S3 upload (`uploadLibraryFile`) → `library_files` insert → `channel_piece_media` insert, with compensation on partial failure (S3/DB cleanup on each failure case).
- **Role/position:** server-decided — first CPM for a `ChannelPiece` gets `role: 'primary'`, subsequent ones get `carousel_item`; position is `max(existing) + 1` or `0`. The client sends nothing role-related.
- **Response (201):** `{ channelPieceMedium: <resolved CPM row>, libraryFile: <raw library_files row> }`.

**Conclusion: the route fully supports this flow as-is.** No `OUTPUT_PERSISTENCE_ROUTE_MISMATCH` — zero backend changes were made or needed.

## 3. Render Result Representation

**FACT:** the render result (`RenderResult` type in `editar-visual/page.tsx`) already holds `image_data_url: string` — a `data:image/png;base64,...` URL — plus `duration_ms`, `output_identifier`, `diagnostics`. This is exactly what needed converting into a `File`.

## 4. File Conversion

New pure module `lib/creative/authoring/render-output.ts`:
- `dataUrlToFile(dataUrl, filename?)` — parses the `data:<mime>;base64,<data>` shape, decodes with `atob`, builds a `File` with the original MIME type preserved (`image/png`). Throws a clear, catchable error on malformed input rather than producing a corrupt file.
- `renderOutputFilename(timestamp = Date.now())` — produces `static-render-<timestamp>.png`. Deliberately carries **no** project/content/channel-piece identifiers or any other information — just a timestamp, per the "no sensitive information in the filename" instruction.

This module has zero knowledge of storage, S3, or the domain — it is a pure client-side conversion utility, independently unit-tested (`lib/creative/__tests__/render-output.test.ts`).

## 5. Save Action

New orchestration module `lib/creative/authoring/save-render.ts`, `saveRenderToChannelPiece({ imageDataUrl, channelPieceId, filename?, fetchImpl? })`:
- Converts the data URL to a `File` (§4).
- Builds a `FormData` with exactly `file` and `channelPieceId` — the same two fields the existing route expects, nothing more.
- `POST`s to `/api/channel-piece-media/upload` (exported as `CHANNEL_PIECE_MEDIA_UPLOAD_ROUTE` so tests assert against the real, existing path rather than a string literal).
- Returns `{ ok: true, libraryFileId, channelPieceMediaId }` or `{ ok: false, error }` — never throws, so the calling UI never needs a try/catch around it.

Wired into `app/(dashboard)/.../editar-visual/page.tsx` as `saveRender()`, gated on `context` + `renderResult` existing. The button only renders inside the existing render-result block (`{renderResult && ...}`), so it is invisible until a render exists — it never appears standalone.

## 6. Save States

New pure state machine, `lib/creative/authoring/save-state.ts`, keyed by the render's own `output_identifier` (not by a boolean), so a specific render — not "the button" — is what's marked saved:

- `idle` → button reads "Salvar nesta peça", enabled.
- `saving` → button reads "Salvar nesta peça" with a spinner, **disabled**.
- `success` (for the current render's `output_identifier`) → button reads "Salvo nesta peça", **disabled** (no re-save without a new render).
- `error` → button re-enabled, plus a destructive-styled message with the server's actual error text below it.

No modal was introduced; the existing `Button` component and the page's existing text/spacing conventions were reused as-is (per the Design System instruction — no redesign).

## 7. Duplicate Prevention

- The button's `disabled` prop is driven by `canSave(saveStatus, renderResult.output_identifier)`, which returns `false` while `state === 'saving'` — a double-click cannot fire a second request while the first is in flight (verified by unit test).
- Once `success` is recorded for a given `output_identifier`, `canSave` also returns `false` for that same identifier — a second click after success is a no-op in the UI, with no second network call. This is a **session/UI-level** protection only, as instructed — no backend dedup was added (none existed, none was requested).

## 8. New-Render Behavior

`render()` now calls `setSaveStatus((current) => resetForNewRender(current))` at the start of every new render attempt. `resetForNewRender` clears `state`/`error` back to `idle` but **keeps** the previous render's `savedForOutputId` marker — since the new render carries a different `output_identifier`, `isSavedForCurrent` naturally evaluates `false` for it, re-enabling the button for the new candidate output without deleting any record of the prior save. Verified by unit test (`resets saved state for a new render while preserving the previous save marker`).

## 9. LibraryFile Result

**FACT:** unchanged from the existing route — a `library_files` row is created with `kind: 'image'`, `project_id` = the ChannelPiece's real project (resolved server-side, never trusted from the client), `folder: '/'`, and the deterministic non-sensitive filename from §4. This phase added no new field, no new table, no new storage code — the client only supplies bytes, MIME, and a filename.

## 10. ChannelPieceMedia Result

**FACT:** unchanged from the existing route — a `channel_piece_media` row is created pointing at the new `library_file_id`, `image_id: null`. The client never constructs this row directly; it only ever sees the route's JSON response (`channelPieceMedium.id`), which is kept in memory for the success confirmation and never rendered as a raw ID in the UI.

## 11. Role Behavior

**FACT:** the client sends no `role`. The existing server rule applies unmodified: the first saved render for a `ChannelPiece` becomes `role: 'primary'`; a second saved render (e.g. after adjusting and re-rendering, then saving again) becomes `role: 'carousel_item'`, exactly like a second manually-uploaded file would. No approval semantics were attached to `role: 'primary'` — it is purely "first attached media," as it already was before this phase.

## 12. ChannelPiece Status Behavior

**FACT:** neither the client code nor the existing upload route touches `channel_pieces.status` in any way. Saving a render does not move the piece from `draft` toward `ready`/`approved`. No status mutation was added — the existing route already had none, and this phase introduced none.

## 13. Live Proof, if Available

Not attempted. Phase 2E-B already established, by driving the real local dev environment in-browser, that no legitimate authenticated session exists for the new authenticated routes on `localhost` without a real login the automation should not perform (`AUTH_INTERACTIVE_CONSTRAINT`). Nothing about that constraint has changed since — no new credentials became available — so it was not re-investigated from scratch this phase; re-running the same environment/browser dance would not have produced a different, legitimate outcome.

## 14. Auth Constraint

**`AUTH_INTERACTIVE_CONSTRAINT`** carried forward from Phase 2E-B, unchanged. Per the handoff's own instruction, this is covered instead by component-level and API-contract-level proof:
- The upload route's exact contract (fields, auth, ownership, MIME, size, response shape, role/position rule) was read directly from source, not assumed (§2).
- The client's request construction was unit-tested against a mocked `fetch` to assert it sends exactly `file` + `channelPieceId` to `/api/channel-piece-media/upload`, with no `role` field (§15).
- No direct DB/S3 manipulation was performed to "prove" persistence — the integration is proven by contract and test, not by simulated success.

## 15. Tests

21 new tests added, all passing, organized exactly along the categories requested:

**Client/result state** (`lib/creative/__tests__/save-state.test.ts`, 7 tests): save disabled without a render; enabled once a render exists; saving prevents duplicate submission; success marks the current render saved and disables further saves for it; a new render resets saved state while preserving the previous marker; failure preserves the render and allows retry.

**Payload / file conversion** (`lib/creative/__tests__/render-output.test.ts`, 6 tests): deterministic non-sensitive filename generation (asserted to never contain a UUID-shaped identifier); PNG MIME preserved through conversion; correct `File` produced from a real base64 PNG; malformed/empty input rejected with a clear error instead of producing a corrupt file.

**API contract** (`lib/creative/__tests__/save-render.test.ts`, 8 tests): the existing `/api/channel-piece-media/upload` route is the one called (asserted against the exported route constant, not a re-typed literal); correct `channelPieceId` and `file` fields sent, and explicitly asserted that no `role` or `status` field is sent (the route decides); success maps the route's response into `{ libraryFileId, channelPieceMediaId }`; a 401 and a 404 domain error both surface the server's real message without throwing; a network failure is handled gracefully; malformed render data never even calls `fetch`; an unexpected response shape is treated as an error rather than crashing.

**Regression:** full suite re-run at 526/526 (505 pre-existing + 21 new) — nothing pre-existing was touched or broken; `/dev/creative-preview` and its own render route were not modified at all (verified by `git status` — only files listed in §17 changed).

## 16. Baseline

- Full suite: **526/526 passed** (44 test files; 505 pre-existing + 21 new)
- typecheck: **PASS** (one regex-flag fix was needed — see below — otherwise zero source logic changes required)
- lint: **0 errors / 45 warnings** — identical to the inherited baseline, no new warnings
- production build: **PASS**, exit code 0, no errors

One factual correction made during implementation: the initial data-URL regex used the `s` (dotAll) flag, which the project's TypeScript target does not support (`tsc` error TS1501). Replaced with an equivalent `[\s\S]*` character class — behavior-identical, confirmed by re-running the affected tests after the fix.

## 17. Remaining Lifecycle Debt

Unchanged from Phase 2F0, none of it addressed or expanded here (out of scope by design):
- Authoring-state persistence (resume mid-edit) — still deferred.
- Structured render provenance (primitive selection/transforms/identity snapshot ref) is not attached to the saved `LibraryFile` — still deferred, no `metadata` column exists or was added.
- No render/edit history or versioning UI — still deferred.
- No approval workflow change — `ChannelPiece.status` and `role='primary'` semantics are exactly as they were.
- Browser interactive local proof of this exact flow remains blocked by the pre-existing auth constraint (§14), not a regression introduced here.

## 18. Verdict

**`PASS_WITH_CONSTRAINTS`**

The explicit save action exists, reuses the existing upload API and both existing persistence paths (`LibraryFile`, `ChannelPieceMedia`) with zero new API routes and zero schema changes. No automatic approval, no automatic delete/replace of prior media, double-click is guarded, a new render correctly resets the saved indicator, and the full baseline (526/526, typecheck, lint, build) is green. The sole constraint is the carried-forward, pre-existing local browser/auth limitation (§13–14), which the handoff itself designates as acceptable for `PASS_WITH_CONSTRAINTS` provided the integration is otherwise fully proven by contract and test — which it is.
