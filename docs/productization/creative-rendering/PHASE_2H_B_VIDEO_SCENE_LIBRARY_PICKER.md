# Phase 2H-B — Video Scene Library Picker

**Nature:** Productization implementation phase. Scope was limited to a client-side picker UI and the `VideoScene → library_file_id` selection/removal path already persisted by Phase 2H-A. No renderer wiring, fake-button change, AI generation, MP4 persistence, ChannelPiece linkage, migration, or new API was added.

## 1. Objective

Let a user pick an existing, project-scoped `LibraryFile` for a `/videos` scene from the real product UI, write the selection to the already-persisted `VideoScene.library_file_id` field via the existing autosave path, restore it on reload with display metadata, and allow clearing it back to `null` — without introducing base64 copies, manual signed URLs, or a new picker subsystem.

## 2. Existing Library Picker Audit

**FACT.** The only existing "pick a Library asset" UI is `components/publication/media-picker-dialog.tsx` (`MediaPickerDialog`), used by `components/publication/channel-piece-media-section.tsx`. It is a three-tab dialog (`Imagens geradas` / `Arquivos do projeto` / `Enviar arquivo`) that:

- fetches Gallery `images` directly via a Supabase client query scoped to `project_id`;
- fetches Library files via `GET /api/library-files?projectId=...`;
- on selection, immediately POSTs to `/api/channel-piece-media` to create a `ChannelPieceMedia` association with a `role`/`position` (`primary` vs `carousel_item`);
- owns upload-to-Library (`/api/channel-piece-media/upload`) and duplicate-in-current-association detection (`isDuplicateImage`/`isDuplicateFile` against `currentItems: ChannelPieceMediaResolved[]`).

**FINDING.** The dialog's listing/selection-card rendering (grid of thumbnail buttons, kind icon fallback, file-size label) is generic, but the dialog as a whole is not: it is wired to `ChannelPieceMedia` role/position semantics, a `channelPieceId`, an immediate side-effecting POST on selection, and an upload tab that this phase's scope explicitly excludes (`NÃO: ... video picker` was never in scope; uploading was excluded too — selection only). Reusing it directly would leak `ChannelPieceMedia` association semantics into `VideoScene` binding, which Phase 2H0 already rejected as the wrong reuse target for the same reason (`| D — reuse ChannelPieceMedia | ... falsely couple authoring media to publication context |`).

## 3. Reuse/Extraction Decision

**DECISION.** Extract the smallest generic core as a new component, `components/library/project-library-asset-picker.tsx` (`ProjectLibraryAssetPicker`), instead of adapting `MediaPickerDialog`.

It keeps only what Fase B's "generic picker responsibility" allows it to know: `projectId`, `allowedKinds`, `selectedId`, an `onSelect(file: LibraryFile)` callback, and open/close state. It does **not** know about `ChannelPieceMedia` roles/positions, `VideoScene`/JSONB, the renderer, or `TimelineManifest`. It performs no association POST itself — selection is reported to the caller via `onSelect`, which is exactly the seam `/videos` needed.

`MediaPickerDialog` was left completely unmodified. It keeps its Gallery tab, upload tab, and `ChannelPieceMedia` association responsibility; `channel-piece-media-section.tsx` still consumes it unchanged.

## 4. Project Scoping

`ProjectLibraryAssetPicker` receives `projectId` from its caller (never infers it) and requests `GET /api/library-files?projectId=<projectId>&kind=image` — the same endpoint `MediaPickerDialog`'s Biblioteca tab and Phase 2H-A's server validator already treat as the project-scoped Library source. A defensive client-side filter, `filterProjectLibraryFiles(files, projectId, allowedKinds)`, additionally requires `project_id === projectId`, `kind` in the allowed set, and `deleted_at === null` before rendering a card. This is UX-only; it does not replace or weaken the server-side same-Project/soft-delete validation added in Phase 2H-A (`lib/video-scene-library-bindings.ts`), which remains the authority at save time.

## 5. Supported Asset Kinds V0

`allowedKinds` defaults to `['image']` and `/videos` does not override it. The dialog title/description and empty-state copy are image-specific ("Selecione uma imagem do Projeto atual" / "Nenhuma imagem disponível neste Projeto"). Video/audio/document kinds are not exposed from `/videos` in this phase, consistent with the current image-only Timeline/Remotion preparation and the explicit `DO NOT: audio picker; video picker` constraint. The prop shape is generic enough that a future caller could pass a wider `allowedKinds`, but no such caller exists yet.

## 6. Videos Wrapper

The association between a selected `LibraryFile` and a `VideoScene` lives entirely in the Videos product layer, not in the generic picker:

- `app/(dashboard)/videos/page.tsx` loads `libraryFiles` for the active `selectedProject` (`GET /api/library-files?projectId=...&kind=image`) whenever the selected Project changes, and clears it when no Project is selected.
- `components/videos/scene-card.tsx` (`SceneCard`) now takes `projectId`, `libraryFiles`, and `onLibraryFileChange(libraryFileId: string | null)` props. It resolves `selectedLibraryFile = libraryFiles.find(f => f.id === scene.library_file_id)` for display, renders a "Mídia da Biblioteca" panel with "Escolher da Biblioteca" / "Trocar da Biblioteca" and a conditional "Remover da cena" action, and owns its own `isLibraryPickerOpen` dialog-open state.
- `ProjectLibraryAssetPicker` is instantiated inside `SceneCard`, scoped to that scene's `projectId` and `scene.library_file_id`; its `onSelect` calls `onLibraryFileChange(file.id)`.

## 7. Scene State Update

`lib/video-scene-state.ts` adds one pure function:

```ts
export function updateVideoSceneLibraryFile(
  scenes: VideoScene[],
  sceneId: string,
  libraryFileId: string | null,
): VideoScene[]
```

It maps scenes, replacing only `library_file_id` on the matching `sceneId` and returning every other scene (including its `image_url`) unchanged by reference-equal shallow copy. `app/(dashboard)/videos/page.tsx` wires it as `setSceneLibraryFile(sceneId, libraryFileId)`, called from `SceneCard`'s `onLibraryFileChange` (selection) and from the "Remover da cena" button (`null`). No new state-management subsystem was introduced; this sits next to the existing `updateScene`/`deleteScene` helpers in the same page component.

## 8. Autosave

No autosave code changed. `app/(dashboard)/videos/page.tsx` already serializes the full `scenes` array (`scenes,` in both the debounced autosave `POST/PATCH` body construction and the explicit save handler) as it existed before this phase. Because `library_file_id` is an ordinary property already present on `VideoScene` (Phase 2H-A) and `setSceneLibraryFile` only ever replaces that property via `updateVideoSceneLibraryFile`, a selection or removal is picked up by the next autosave tick through the unmodified payload — exactly the "usar exatamente o autosave existente" requirement. No additional storage/thumbnail/URL metadata is added to the payload; only the `LibraryFile.id` (a UUID string) is written.

## 9. Load/Restore

On draft load, the existing `GET`/`loadDraft` path already returns `scenes` with `library_file_id` verbatim (Phase 2H-A, §2/§9). `SceneCard` resolves display metadata (`selectedLibraryFile`) by looking the ID up in the `libraryFiles` list loaded for the active Project — the same list the picker itself lists from — and renders the file's `thumbnail_url`/`public_url` and `name`, never the raw UUID. If a persisted `library_file_id` is not found in that list (e.g. a Project mismatch or a file the picker's `kind=image` filter excludes), `SceneCard` shows "Asset selecionado indisponível neste Projeto." instead of failing or fabricating a preview.

## 10. Legacy `image_url` Behavior

`image_url` upload/preview/drag-drop/remove behavior in `SceneCard` is untouched — same `FileReader.readAsDataURL()` local-preview flow, same remove handler. The Library binding panel is additive UI beneath it, not a replacement. `updateVideoSceneLibraryFile` explicitly never touches `image_url` (proven by `lib/__tests__/video-scene-state.test.ts`, which asserts the legacy base64 value on an untouched scene survives both a selection and a clear on a different scene).

## 11. Thumbnail Behavior

`ProjectLibraryAssetPicker` and `SceneCard`'s selected-asset preview both reuse `LibraryFile.thumbnail_url` (falling back to `public_url` for images) exactly as already returned by `GET /api/library-files` — the same fields `MediaPickerDialog`'s Biblioteca tab already renders. No signed URL is generated client-side and no new S3 proxy or thumbnail endpoint was added; this phase relies entirely on the pre-existing Library API response shape.

## 12. Browser Proof

**CONSTRAINT — no legitimate local auth available.** This worktree has no `.env`/`.env.local` file at all (`find . -maxdepth 1 -iname ".env*"` returns nothing), so a local `next dev` server has no Supabase URL/keys to authenticate a real user session, and no real user credentials for this product were available to this phase to establish one through a hosted environment either. Per this phase's explicit instruction ("Se browser/local auth continuar indisponível: NÃO bypassar... Mas implemente a product UI real"), no interactive click-through proof was attempted, and no manual DB mutation, signed-URL fabrication, or auth bypass was used as a substitute.

What **was** verified instead, without touching product data:

- `pnpm build` succeeds, confirming `/videos` (and the new `components/library/project-library-asset-picker.tsx`) compiles and statically renders as part of the real Next.js route tree (`○ /videos` in the build output) — not just in isolation.
- The full component/integration test suite (§13) exercises the actual exported picker filter, the actual `SceneCard`/page wiring path (via `updateVideoSceneLibraryFile`), and the actual Phase 2H-A server validator/round-trip the picker's selection ultimately flows through.

This is reported as **PASS_WITH_CONSTRAINTS** per this phase's own acceptance rule ("PASS_WITH_CONSTRAINTS acceptable only for browser/auth interactive limitation if component/integration behavior is otherwise fully proven"). No `Portal Comunidades Alternativas` / `Teste Timeline Portal 01` draft was read, selected on, or mutated, since no authenticated session reached it.

## 13. Tests

New this phase:

- `lib/__tests__/project-library-asset-picker.test.ts` — `filterProjectLibraryFiles` keeps only active, requested-Project, requested-kind assets; excludes a different-Project file, a wrong-kind file, and a soft-deleted file from one mixed input.
- `lib/__tests__/video-scene-state.test.ts` — `updateVideoSceneLibraryFile` (a) sets `library_file_id` on the target scene only and leaves a sibling scene's legacy `image_url` untouched (multi-scene isolation), and (b) clears the target scene's binding to `null` without touching the sibling scene or deleting anything else.

These follow this repository's existing convention for `components/**` logic (pure functions exported and unit-tested under `lib/__tests__`, e.g. `filterProjectLibraryFiles`/`collectLibraryFileIds`) rather than DOM-interaction testing: no `@testing-library/react`/jsdom environment is configured in this project (`vitest run` uses the Node environment), and no test dependency was added to introduce one.

Regression: the full suite includes the unmodified Phase 2H-A `lib/__tests__/video-scene-library-bindings.test.ts` (server validator/round-trip), the Phase 2G timeline-adapter/LibraryFile-preparation suites, and the static-authoring/`ChannelPieceMedia` suites — all green (§14).

## 14. Baseline

- Full suite: **592/592 passed** (50 test files; +3 tests for this phase over the 589-test Phase 2H-A baseline)
- Typecheck: **PASS**
- Lint: **0 errors / 49 warnings** (+4 over the 45-warning baseline — all pre-existing warning *classes* already present elsewhere in the codebase: `@next/next/no-img-element` on the two new/changed `<img>` previews in `scene-card.tsx` and one in `project-library-asset-picker.tsx`, and one `react-hooks/set-state-in-effect` on the picker's load-on-open effect, the same pattern already flagged in `components/publication/quick-flow-dialog.tsx` and `components/ui/carousel.tsx`)
- Production build: **PASS** (`/videos` present in the route output)

## 15. Deferred Renderer Wiring

No changes were made to `adaptVideoDraftToTimelineManifest`, `prepareTimelineLibraryFileAssets`, `renderResolvedTimelineInput`, `TimelineComposition`, or Remotion. A persisted `scene.library_file_id` selected through this picker is not yet read by the Timeline/render preparation path; that remains Phase 2H0's deferred "product preparation before adaptation/render" step, which must re-fetch and re-validate the `LibraryFile` under the authenticated render context before building an `AssetRef`.

## 16. Deferred Generate/Render UX Split

The current "Gerar Vídeo" action in `/videos` was not modified and remains its pre-existing fake/placeholder behavior, unconditionally of whether a scene now has a `library_file_id`. Splitting "Generate" from "Render" semantics is out of scope for this phase, as instructed.

## 17. Verdict

**`PASS_WITH_CONSTRAINTS`**

The Library asset picker is integrated into the real `/videos` `SceneCard` UI, scoped to the active Project, image-filtered for V0, and writes/clears the selected `LibraryFile.id` through a minimal, tested `setSceneLibraryFile` action reusing the existing autosave path unchanged; load restores the binding with resolved display metadata (thumbnail/name, never a raw UUID) and gracefully degrades when the file isn't resolvable; legacy `image_url` is fully preserved; no base64 copy, signed URL, or new picker subsystem was created; existing server-side same-Project/soft-delete validation (Phase 2H-A) remains the sole authority; no renderer, fake-button, or generation-flow change was made; and the full baseline (§14) is green. The single open item is §12: no interactive browser click-through was possible because this worktree has no usable local or hosted authenticated session, so that one proof step is deferred to an environment where real credentials are available, exactly as this phase's own instructions anticipated.

## 18. Recommended Next Slice

## Lint baseline closure (Phase 2H-B.1)

The 49-warning result after Phase 2H-B contained four genuinely new warning
instances in Phase 2H-B-touched files: three `@next/next/no-img-element`
warnings at the picker card and two SceneCard previews, plus one
`react-hooks/set-state-in-effect` warning from the picker's no-Project state
reset. These were additional warning instances, so the baseline increase was
real despite the warning classes existing elsewhere beforehand.

The previews now use the repository's established `next/image` pattern with
fill layout and `unoptimized`, preserving data URLs and existing Library URLs.
The picker no longer writes redundant state when no Project is selected; it
renders that deterministic message directly. Final lint is **0 errors / 45
warnings**. No product architecture, renderer, autosave, API, or persistence
behavior changed.

Wire `scene.library_file_id` into `adaptVideoDraftToTimelineManifest`/`prepareTimelineLibraryFileAssets` (re-validating ownership/Project/soft-delete at that boundary, per Phase 2H0 §"Product preparation before adaptation/render") so a scene bound through this picker actually renders through the existing Timeline/Remotion path — the next deferred step named in both this phase and Phase 2H-A.
