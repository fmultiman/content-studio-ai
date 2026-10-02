# GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1

A generated image or video that was **explicitly saved to Arquivos** can be handed to an **existing**
compatible Creative Editor target. The handoff is identity transfer only:

```
generated media → explicit LibraryFile → choose existing target → editor opens with ?media=<LibraryFile.id>
              → editor revalidates ("Mídia recebida") → user explicitly chooses how to use it
```

Invariants: Generation ≠ Composition · Generated media ≠ VideoDraft · LibraryFile ≠ ChannelPieceMedia ·
Open editor ≠ Insert media · Navigation ≠ Authoring mutation.

## Audited facts (against executing code on `ce830bc`)

| Question | Answer |
|---|---|
| Static route | `/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual` (client page) |
| Static id chain | Enforced server-side by `GET /api/creative/static-authoring-context`: owner-scoped Project, `editorial_contents.project_id == project.id`, `channel_pieces.editorial_content_id == editorialContent.id`. A mixed chain is a 404. |
| Static eligibility | `isStaticChannelPiece`: everything except `reel`, `short`, `video_description` (409 `TIMELINE_CONTEXT`). |
| Static Library image intake | `UnifiedMediaPickerDialog.onSelect` → authored state only (free image element add/replace, template custom element, slot `SET_ASSET_OVERRIDE`). **Never `ChannelPieceMedia`.** |
| Static open / autosave | Opening writes nothing. Autosave is OFF by default, debounced, and skips the hydration run. |
| Video route | `/creative-editor/video/[draftId]`; `VideoDraft` owner-scoped (`/api/video-drafts?id=`); Project = `draft.project_id`, never URL input. |
| Video Library intake | Scene hero (`patchSelectedScene`), free scene image (`addFreeImageElement`), B-roll (`addMediaItem('visual')`, image or video). Save re-validates every referenced LibraryFile (owner, Project, not deleted, kind, `isRenderableLibraryFile`). |
| Production | Context only: Library browsers default to the current Production but expose "all"; DB trigger only checks `production_id` ownership/Project. **Project is the sole hard boundary.** |
| Trust helper | `isTrustedLibraryStoragePath` / `presignLibraryRead` (single Library trust rule) — reused, not reimplemented. |

## Compatibility matrix (frozen)

| Library kind | Static editor | Video editor |
|---|---|---|
| image (renderable raster, not SVG) | **Supported** — add as image element (the picker's `add` path) | **Supported** — scene hero (template scene that draws one) · free-scene image · B-roll |
| video (mp4/webm/mov) | **Unsupported** | **Supported** — B-roll only |
| audio / document / other | Unsupported (V1) | Unsupported (V1) |

## Contract

* Navigation: `…/editar-visual?media=<id>` and `/creative-editor/video/<draftId>?media=<id>`. Only the id. The query is a *requested identity*, parsed by one helper (`parseIncomingMediaParam`).
* Chooser data: `GET /api/library-files/[id]/handoff` — validates the file, then lists same-Project targets in a constant number of queries (productions, editorial_contents, video_drafts in parallel, then channel_pieces); capped at 100 per family with a `truncated` flag. Same-Production targets sort first; other Productions and NULL stay available.
* Receiving validation: `GET /api/library-files/[id]/handoff-media` with the editor's REAL target — Static: `editor=static&projectId&editorialContentId&channelPieceId`; Video: `editor=video&draftId`. The receiving Project is derived on the server, never trusted from the query: Static re-verifies the owner-scoped Project → EditorialContent → ChannelPiece chain (same rules as `/api/creative/static-authoring-context`, including Static-piece eligibility); Video reads `project_id` of the owner-scoped VideoDraft (a `projectId` in a Video request is ignored). `editor` is only a routing discriminator. The LibraryFile must then be owner + active + same derived Project + kind/MIME compatible + trusted storage path. Error codes: `TARGET_NOT_FOUND` (missing / foreign / inconsistent target — indistinguishable), `NOT_FOUND` (unknown / foreign / trashed / untrusted-path file — indistinguishable), `NO_PROJECT`, `PROJECT_MISMATCH`, `UNSUPPORTED_KIND`, `INVALID_REQUEST`.
* "Mídia recebida" (`ReceivedMediaPanel`): read-only; holds no authored state; the editors' dirty/autosave derive from authored state only, so it can never be persisted by autosave. Actions are the editors' **existing** intake functions (extracted, not duplicated, so the Library pickers and the panel share one path). Refresh / back / deep link simply show it again. After an explicit use the param is cleared for UX; correctness does not depend on it.
* No target creation. No target → *"Nenhum destino compatível existente neste Projeto."*
* Migration: **none**.

## Out of scope (kept separate)

Provider generation, REST/MCP capabilities, Library storage security, editor anatomy, Gallery, a generic Creative Editor landing page, target creation, audio handoff.
