# CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1

Real-smoke-driven correctness fixes for the **Static Creative Editor**. A human Production authoring pass of about five
minutes exposed problems that the test-driven closures had not caught. This is **not** a feature mission: it fixes
regressions and wrong product truth, audits first, and defers every usability idea to
`CREATIVE_EDITOR_REAL_SMOKE_USABILITY_HARDENING_V1`.

## Provenance

| | |
|---|---|
| Canonical Static worktree | `D:/Traycer/worktrees/fmultiman__content-studio-ai/traycer-witty-puma-23e2b43ebdbe` |
| Session started in | the canonical Static worktree (no move was needed; no Video / neighbouring worktree was edited or read as a code source) |
| Starting `origin/main` | `9be3f604030ac53d76954d084a9e145fc81cd8de` (fetched with `--prune`; branch created from it) |
| Branch | `feat/creative-editor-real-smoke-correctness-hardening-v1` |
| Parallel `origin/main` advance since the last Static checkpoint (`ce830bc`) | #93 generated-media → Creative Editor handoff (merge `36953c5`), #94 handoff Static-target eligibility fix, #95 Kling MCP advanced-controls test update (`9be3f60`). Expected (Video track), not contamination. |
| Pre-existing helper scripts | the ~60 untracked `*.js` / `scratchpad-edit-*.py` files of the worktree were left untouched and never staged |

## Findings, root causes and fixes

### A — Image add regression (P0): the Canvas showed the file name instead of the image

**Trace.** `UnifiedMediaPickerDialog` → `I2vSourceBrowser` selection → (`library` | `generated` selection) → the dialog's own read →
`onSelect(file)` → page `projectImages` cache (`setProjectImages`) → `imageUrl(ref)` (`file.public_url`) → `FreeStage` `<img>`
(and `previewOverrideAssets` for Assets "Trocar") → final render (resolved server-side from `library_file_id`).

**Root cause (factual).** The browser lists are signed (`/api/library-files/browse`), but when a tile was *chosen* the dialog read
`library_files` **directly from Supabase** and passed the raw row to the editor. A raw row's `public_url` is the stored object URL,
which is not a usable browser source (private bucket; only a presigned URL is). The page then **overwrote its signed cache entry**
(`projectImages`, loaded from `/api/library-files`) with that row. The Canvas `<img>` failed to load and rendered its `alt`, which is the
file name. For a generated AI image the promotion route's response does not even select `public_url`, so the row had no source at all.
The final render was never affected: it resolves the image from `library_file_id` on the server.

| Origin | Before | After |
|---|---|---|
| Arquivos / Galeria / Enviar (all are `library` selections) | raw table row (unsigned `public_url`) | signed display row |
| Geradas por IA (promoted via save-to-library) | raw promotion row (no `public_url`) | promoted, then the same signed display row |
| Assets "Trocar" (hero / logo slots, same dialog) | same bug (`previewOverrideAssets` reads `public_url`) | fixed by the same path |

**Fix.** One new read-only, owner-scoped route, `GET /api/library-files/:id/display?projectId=` (`lib/library/display-file.ts`): owner + same
Project + `kind = image` + not deleted → the row shaped like the Library list entries with a **signed** `public_url` / `thumbnail_url`
(never the storage path). The dialog calls it for every selection and **never** reads the table itself. The authored identity is still
`library_file_id`; no second image identity exists; the renderer does not touch generation rows.

### B — Cover brand signature (P0)

**Root cause.** The atomic-visual decomposition had split the signature into *Logo da marca* (the file) and *Nome da marca* (the Project name as text).
The real logo asset is a **complete** logo/wordmark that already contains “Comunidades Alternativas”, so the name was printed twice. Also, the
logo was drawn inside a 118 px **circle** with a 2 px ring, which crops a wide wordmark.

**Audit of the scope.** The duplicate name existed in **Cover and Encerramento** (the only layouts with a `brandName` atom). Info and Lista draw the logo
alone and had no name. Fixed: Cover and Encerramento.

**Fix.** `Assinatura` = **one** Element, *Logo da marca*: the complete logo asset (slot `logo`, unchanged resource contract), drawn by a new
`BrandLogo` primitive: `contain`, anchored left, **no mask, no ring**, no name text. The `brandName` Element is removed from both layouts, from the
default stack and from Anatomy. `brand_label` stays in the content schema as an inert optional key (no migration; old rows keep it, nothing draws it);
the “Nome da marca” content fields (Video Scene forms) are removed because they would no longer render anything.
Old saved ids: `hiddenElements` / `elementOrder` containing `brandName` are dropped by the shared normalizers; the legacy compound `brand` now expands to `brandLogo` only.

### C — Cover Hero backing / moldura (P0)

**Fix.** The Cover has no `heroFrame` Element and the renderer draws no pale backing/shadow. Removing it does **not** resize the image: the image box is exactly
the box the photo always occupied by default (the former plate minus its 14 px margin: `440 × 648` at `(580, 228)` on the 1080 × 1350 reference, `padding: 0`).
There is no replacement frame. Lista / Citação keep their frame (their own `heroFrame` Element is unchanged).

**Saved-state compatibility (no DB migration).** A saved `hiddenElements: ['heroFrame']`, a saved `elementOrder` containing `heroFrame`, and the legacy
`tuning.hero.frame = false` toggle name an Element the Cover no longer has: they are **dropped on load** by `normalizeHiddenElements` /
`normalizeElementOrder` (and ignored by the renderer for a stale frozen snapshot). Nothing is re-persisted; the image is identical to the default in every case.

### D — Cover Hero image cropped on the left (P0)

**Root cause.** The Hero painted `background-size: cover` in a fixed 440 × 648 box (aspect 0.679). Any book cover that is not exactly that aspect has its
overflowing sides (or top/bottom) centre-cropped — the left edge is the one the eye catches. There is no crop state in the model (see the image resize/crop
audit), so it cannot be pan/zoomed back.

**Fix.** Cover-specific, no new state: the Hero **always paints `contain`** (the unused part of the box is transparent). The complete artwork is visible, never
stretched, never cropped. Other layouts are unchanged.

**Render comparison (local, frozen snapshot, Remotion `renderStill` of `StaticRenderManifestStill`, 1080 × 1350).** A test hero with marked edges (red LEFT,
blue RIGHT, green TOP, yellow BOTTOM) and a wide complete-wordmark logo, content `brand_label = “Comunidades Alternativas”`:

| | Before (`9be3f60` renderer) | After |
|---|---|---|
| Hero backing | cream frame + shadow behind the image | none |
| Hero edges | the cover was `cover`-cropped inside a bordered plate | all four marked edges fully visible, no distortion |
| Signature | circle-masked logo **and** the text “COMUNIDADES ALTERNATIVAS” | one complete wordmark, no text |

Known layering note (unchanged by design): the *Papel do título* is painted above the Hero by default and overlaps the image's top-left corner by a few
pixels; the author can reorder them in Camadas. This is collage layering, not clipping.

### E — Anatomy child order (P1)

The complaint concerned the **display order of children inside a Section** in `Elementos → Anatomia`, not Camadas and not paint order. Cover's Section registry now
lists children the way the visible object reads (what is on top first):

* **Hero** — Fita da imagem · Imagem principal
* **Nota editorial** — Fita da nota · Nota da edição · Papel da nota
* **Bloco de título** — Título · Papel do título (already so)

This is the **derived** Section registry only (`template-anatomy.ts`). It does not change `elementOrder`, paint order, persisted state, the renderer or
Camadas, does not move Elements between Sections and does not make a Section a Group. No “real-world physics” rule was applied to other layouts: only the Cover,
whose visual semantics are known, was reordered.

**Camadas regression result: unchanged and coherent.** It still lists the factual stack front-first (reverse of paint order) and keeps its supported reorder.
No independent discrepancy was found, so nothing in Camadas or render order was changed.

### F — Static picker Production default (P0/P1)

**Root cause.** `I2vSourceBrowser` defaults to “Production atual” (right for AI Video, where the generation belongs to one Production). A normal Library upload has no
`production_id`, so under that default it did not appear until the user chose “Todas as Productions”.

**Fix.** `I2vSourceBrowser` takes an optional `defaultProductionMode` (default `current`, i.e. AI Video is unchanged). The Static adapter
(`UnifiedMediaPickerDialog`) passes `all`. Production stays an optional filter (`Production atual`, `Todas`, `Sem Production`); an upload still takes the editor's
Production. Server scoping (Project / user) is untouched.

## Tests (all green)

| Area | Where |
|---|---|
| Picker → signed row for Arquivos / Galeria / Enviar / generated; no direct table read; unavailable file reported, not handed over; Static passes `all` | `components/creative/authoring/unified-media-picker-dialog.test.tsx` |
| Signed display route: owner / Project / kind / trashed / foreign user / auth / validation; no-Production file is returned | `lib/library/__tests__/display-file.test.ts` |
| Production default: Static `all` (no-Production file visible), explicit current / another / unscoped, Project scoping, AI Video default unchanged | `components/videos/i2v-source-browser-default-production.test.tsx` |
| Canvas image source (resolved draws, unresolved draws nothing); Cover Anatomy display order; `elementOrder` / paint order / persistence untouched; Sections non-persisted; Camadas data regression | `lib/creative/__tests__/real-smoke-correctness.test.ts` |
| Camadas component regression with the real Cover registry | `components/creative/authoring/camadas-regression.test.tsx` |
| Cover logo (one complete logo, no name, no mask, hide as one unit, resource replacement renders one file); Hero backing gone, `contain`, same box, stale saved state inert, no crop state, Lista / Citação keep their frame | `lib/creative/authoring/__tests__/cover-element-completeness.test.ts`, `atomic-visual-elements.test.ts`, `lib/creative/__tests__/documentary-card.test.ts`, `template-anatomy.test.ts`, `carousel-state.test.ts`, `template-element-panel.test.tsx`, `template-elements-tab.test.tsx`, `styles-tab.test.tsx` (updated to the corrected product truth) |

Final-render image resolution (`library_file_id` → signed URL at claim time) keeps its existing coverage (`static-template-custom-elements-render.test.ts`,
`free-default-and-template-entry.test.ts`, `atomic-visual-elements.test.ts`).

## “Salvar em Arquivos” — factual audit (read-only; no save flow was modified)

| Question | Creative Editor **video render** (`POST /api/render-executions/:id/save-to-library`) | **VideoGeneration** result (`POST /api/video-generations/:id/save-to-library`) |
|---|---|---|
| 1. LibraryFile created or reused | Created; reused (`already_saved`) when a live file with that `source_render_execution_id` exists | Created; reused when the generation already links a live file (`library_file_id`) |
| 2. Binary | **Copied** (S3 `CopyObject`, `HeadObject` first) from the app-owned scratch object; the scratch object is kept | **Copied** (same helper) from the app-owned tenant video object; the provider is never contacted |
| 3. Key pattern | `users/{userId}/library/{uuid}/{name}.mp4` | the same `users/{userId}/library/{uuid}/{name}.mp4` |
| 4. `project_id` | Always (frozen on the execution; the owner's current access is re-checked) | Always (from the generation row; ownership re-checked) |
| 5. `production_id` | Optional: render → VideoDraft → Production through `ownedProductionIdOrNull`, else `NULL` | Optional: the generation's own Production through `ownedProductionIdOrNull`, else `NULL` |
| 6–7. Folder | `folder = Project root folder path`, falling back to `'/'` if none. No `Generated` / `Rendered` sub-folder is encoded | same: Project root folder path, fallback `'/'`. No sub-folder rule |
| 8. Origin | `origin = 'studio_render'`, `source_render_execution_id = execution id` | no `origin` written (column default, i.e. `upload`); provenance is `video_generations.library_file_id` |
| 9. Gallery vs Library identity | `studio_render` **video** files list in Arquivos; only `studio_render` **images** are Galeria (Arquivos hides them) | not a Galeria item; an Arquivos item |
| 10. Meaning | Durable `LibraryFile` registration over a **copied durable object**, not an S3 URL pointer | the same |

Related, for the Static PNG (“Salvar nesta peça”, `POST /api/channel-piece-media/upload`): the PNG is **uploaded** (new object under the same key pattern), registered with
`origin = 'studio_render'` + `source_render_execution_id` (so it is a **Galeria** item), `production_id` from the ChannelPiece's EditorialContent, and `folder = '/'`
(the code writes `'/'` there, not the Project root). The AI-image promotion (`/api/images/:id/save-to-library`) copies the object, uses the Project root folder, and writes
`production_id` only when uniquely derivable from drafts. **No code path encodes a `Generated` or `Rendered` folder rule**; the audit states only what the routes write.

Observation (not changed here): the Static Arquivos browse and the AI Video source browser request `format=i2v-image`, i.e. **PNG / JPEG only**. That is the I2V rule; it also
hides WebP / GIF images from the Static picker. It is a separate usability/format decision, recorded under deferred items.

## Impact

| | |
|---|---|
| Migration | **NONE** (no schema change; stale saved ids are sanitized on load; `brand_label` stays as an inert optional key) |
| Renderer | **YES** — `CoverVariant`, `ClosingVariant`, `primitives.tsx` (`BrandLogo`), `template-definitions.ts` (Cover/Encerramento registry). Lista / Citação / Info rendering unchanged. |
| Worker | **YES** — the changed files are in the worker export set. Export: 60 files; deterministic manifest SHA256 `WORKER_MANIFEST_PLACEHOLDER` (see **Worker parity**). |
| Cross-medium | The Cover/Encerramento renderer is shared with **Video scenes**: the same corrected signature and Cover Hero apply there (the Scene content forms no longer offer “Nome da marca”). Video code was not edited. |

## Worker parity (operator step — NOT confirmed by this document)

The agent has no VPS access, so parity cannot be claimed here. The canonical procedure:

1. `node infra/render-worker-runtime/export.mjs`; manifest: `cd infra/render-worker-runtime/dist/content-studio && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.
2. Copy the export to `/opt/content-studio/render-worker`, then `docker service update --force content-studio-execution_render-worker`; `docker service ps … --no-trunc` must show the new task Running and the old one Shutdown.
3. In the **new** container, recompute the file count and the same manifest under `/app/content-studio`; they must equal the export.
4. Only then run the real Production render smoke below.

## Production smoke (to be recorded after merge, deploy and worker parity)

`PRODUCTION_SMOKE_PLACEHOLDER`

## Limitations

* Cover Hero is `contain`: an artwork whose aspect differs from the 440 × 648 box shows transparent margins (no frame replaces them). True crop / focal point remain out of scope (no crop state).
* Info and Lista still draw the logo inside a circular mask; only Cover and Encerramento were corrected (the reported scope).
* The static Cover default hero (an 800 × 1000 fixture) now letterboxes instead of filling the box.
* The Static picker's Arquivos / Galeria still list PNG / JPEG only (the I2V rule).

## Deferred — `CREATIVE_EDITOR_REAL_SMOKE_USABILITY_HARDENING_V1`

Recorded from the same human pass; **not implemented here**:

* **Camadas visibility** — the existing visibility source reachable directly in Camadas, preferably next to the drag controls, so a layer can be identified and hidden without returning to Anatomia.
* **Resource provenance** — when an Anatomy Element is expanded, a compact footer stating the factual resource (`Recurso usado: logo-completo.svg · Origem: Projeto / Template / Biblioteca`); for procedural/CSS atoms do not invent an asset — state the factual origin (Template / procedural).
* **Add elements accessibility** — *Adicionar elementos* sits too far below long Anatomy content (painful on mobile); likely expose *Texto* and *Imagem* near the top of Elementos, possibly sticky below *Anatomia | Camadas*.
* **Estilo → Estilos** — the tab label becomes plural.
* **Naming** — the user likes the Anatomy concept but is not convinced by the word “Anatomia”; do not rename yet.
* (new) Static picker formats: decide whether the Static picker should offer WebP / GIF Library images (currently the I2V PNG/JPEG filter applies).
