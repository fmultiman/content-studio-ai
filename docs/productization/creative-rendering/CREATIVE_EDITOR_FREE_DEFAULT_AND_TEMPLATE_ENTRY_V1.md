# CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1

The Creative Editor has exactly **two composition modes: FREE and TEMPLATE**.

- New authoring starts **FREE**. An empty free composition is simply a blank canvas/stage: a valid composition with zero elements.
- A **Template** is an explicit opt-in, chosen from the existing Template registry. It instantiates that Template's grammar and defaults.
- The Editorial Documentary Collage is one available reusable grammar. It is **not** the implicit default composition of any Project.

This applies to both media without a shared document:

| Medium | Free | Template |
|---|---|---|
| Static (ChannelPiece-owned authoring row) | free composition (post, story, feed, carousel) | Template-backed composition |
| Video (VideoDraft) | free Scene | Template-backed Scene |

## 1. Checkpoints

- **Start:** `269b11810d4e30d46f135ed1997e7dd7264c24bb`, equal on local, `origin/main` and remote `main`. It is the closure of VIDEO_FREE_ELEMENT_TIMING_V1.
  - The working tree held one foreign, uncommitted edit to `VIDEO_AUDIO_AUTHORING_V1.md`. It was left untouched and is outside this mission.
- **Feature:** `2beebe6a18e48696517fed7f9e4a30f62772df32` → Vercel Production `dpl_9LNC7dLpzStovL4cBYiHMUQWgQ41`, READY, aliased to `content.multihuman.com.br`.
- **Order followed:**
  1. local gates;
  2. export and local exported-worker proof;
  3. local commit;
  4. tarball;
  5. **explicit approval of migration 038**;
  6. operator VPS update (worker healthy);
  7. migration 038 applied;
  8. push;
  9. production proof.
- **Final SHA:** the docs commit recording this validation. The next mission's housekeeping prints it.

## 2. Clarified product model (and what was rejected)

- **Two modes, not three states.** There is no "unconfigured", no "new" kind, no fake Template `blank`, and no fake layout `blank`.
- **Free is explicit.**
  - A free unit carries `composition: { kind: 'free', elements }`.
  - A Template unit carries Template grammar.
  - The Static database uses `template_id NULL` only as the storage consequence of "no Template". It is always written together with explicit free slides, never as the mode signal on its own.
- **"Template-preferred"** means Templates are accelerators for repeatable production and automation. It does not mean "instantiate Documentary whenever authoring starts".
- **What this supersedes:**
  - OPTIONAL_TEMPLATE_AND_BLANK_COMPOSITION_SPIKE_V1 D2 ("Static stays Template-required").
  - VIDEO_FREE_SCENE_COMPOSITION_V1's always-asking "Nova cena" dialog.

## 3. Phase 0 — factual audit (executing code at `269b118`)

### Static

| Question | Finding |
|---|---|
| New state initialization | Carousel without a row → `defaultCarouselSlides` (Documentary Cover + Info). Non-carousel → an in-memory contextual Documentary Cover (`singleSlideDefault`). |
| Where Documentary is implicit | `DEFAULT_TEMPLATE_ID` in the page state, `resolveAuthoringTemplate`, the PUT route (`templateId ?? DEFAULT`) and migration 035's column default. |
| Template binding scope | Root/collection-level `templateId` (migration 035 column). |
| Template assumptions in the slide shape | Every field: `variant` (a layout enum), per-layout content, slot overrides, Template-relative transforms and element ids. |
| Render assumptions | `StaticRenderManifest.template` is required. The enqueue route, claim resolver, worker composition (`component_key`) and worker `server.mjs` validation all assumed it. |
| Non-carousel today | Ephemeral: save and autosave returned early, the piece was never dirty, and nothing warned. "Gerar PNG" and "Salvar nesta peça" still worked, so an output could be durable while its source was not. |
| Formats reaching the editor | Every non-video format (`isStaticChannelPiece`). Only `carousel` persisted. |
| Persist free without a migration? | **No.** The slides JSON can hold free slides additively, but `template_id` was `NOT NULL DEFAULT 'editorial-documentary-collage-v1'`. A free composition would have been forced to persist a Documentary id. |

### Video

| Question | Finding |
|---|---|
| New VideoDraft | `createVideoDraftForCreativeEditor` → `createVideoScene` → **absent composition**, which means Cover. |
| New Scenes | "Nova cena" always showed a dialog: Em branco or Template. The Template option used `createVideoScene`, again an absent composition. |
| Absent-composition creation paths | Both of the above wrote Scenes indistinguishable from legacy Cover Scenes. |
| Template tab assumption | It assumed a Template for every non-free Scene. A free Scene showed "Nenhum template aplicado" with no way in. |
| Free ↔ Template helpers | None: `setSceneLayout` refused free Scenes, and only `createFreeScene` existed. |
| Unchanged contracts | The free composition, element timing, overlay and `free` segment render contract. |

### Shared surface

- **Truly shared kernel:** workbench, viewport, Inspector panels and the Library picker.
- **Free spatial primitives that could be shared narrowly:**
  - element-array helpers;
  - `free-manipulation` geometry;
  - the Elementos panel (once decoupled from `VideoScene`);
  - the overlay core;
  - the drawing inside `FreeSegment`.
- **Video-specific:** element timing, the frame cursor, Scene ranges and the Remotion `Sequence`.
- **Conclusion:** a narrow shared *spatial* layer, with Static keeping its own persisted wrapper. No shared document ontology.

### Production reconnaissance (read-only, before any write)

**Static ChannelPieces by format:**

| Format | Pieces | With a row | Static renders | Other media |
|---|---|---|---|---|
| carousel | 1 | 1 | — | — |
| post | 3 | 0 | 0 | 0 |
| feed | 2 | 0 | 0 | 1 (not from the editor) |
| story | 1 | 0 | 0 | 0 |
| channel_message | 1 | 0 | 0 | 1 (not from the editor) |

- The only authoring row is the real 10-slide carousel, with `template_id = editorial-documentary-collage-v1`.
- No no-row piece has ever been rendered, so "no row → free" reinterprets no legacy Template authoring. No history-based bootstrap exception was needed.
- **VideoScenes:** 35 in total. 25 have an absent composition (legacy Cover), 7 have an explicit Template composition, and 3 are free.

## 4. Decision gate — the smallest model

There was one acceptable persistence model and one additive migration.

| Option | Verdict |
|---|---|
| Free slides in JSON, `template_id` kept `NOT NULL` (a Documentary id stored under a free composition) | **Rejected.** It is exactly the "no Template silently persisted / Free is not a Template" violation. |
| Free slides in JSON + explicit root `composition: 'free'` in the contract + `template_id NULL` (migration 038 `DROP NOT NULL`) | **Chosen.** Additive, nothing rewritten, same authority, no new table. |

- The migration was **stopped and explained before being applied**, and was then approved.
- **Rejected by design:**
  - StaticDraft;
  - CreativeDocument;
  - a universal ElementInstance;
  - a scene graph;
  - a nullable Template everywhere;
  - a universal transform model;
  - mixed free/Template slides inside one carousel.

## 5. Static representation

**Contract.** `StaticAuthoringStateSchema` (`lib/creative/authoring/carousel-state.ts`) gains:
- an explicit root `composition: 'free'` (collection-level, like `templateId`);
- a free slide variant `{ id, order, composition: { kind: 'free', elements } }`.

**The free slide.** Its composition is the **same value a Video free Scene carries**. It is validated by the same strict `validateFreeCompositionShape`: stable ids, on-stage fraction boxes with a 2% minimum, Identity roles only, a UUID LibraryFile id, and at most 24 elements.

**Refinement.**
- Free ⇒ no `templateId` and every slide free.
- Template ⇒ every slide is a Template slide.
- An older client omitting `templateId` still means the Template, never free.

**Route** (`app/api/creative/static-authoring-state/route.ts`):
- Write: `template_id = composition === 'free' ? NULL : templateId ?? default`.
- Read: only an explicit NULL is reported as free.
- A non-carousel piece must hold exactly one slide (`SINGLE_PIECE_CARDINALITY`).

**Migration 038.** `scripts/038_static_authoring_free_composition.sql` runs `ALTER COLUMN template_id DROP NOT NULL`.
- It keeps the column default and rewrites no row. The carousel row kept its Template and `updated_at`.
- Applied to production as migration `038_static_authoring_free_composition`. Verified: `is_nullable = YES`, default unchanged.

**Shared helpers.** The free-composition helpers are generic over their *host* (`FreeHost`: anything with `composition`). A Static free slide and a Video Scene share `add/update/setBox/setHidden/move/remove`. Only a Video Scene also carries `element_timing`, which `removeFreeElement` drops atomically.

## 6. Static single-piece durability (M1 absorbed)

Every static format now loads and saves through the **existing ChannelPiece-owned row**:
- Salvar, save status, "Voltar ao salvo" and autosave work for post, story and feed.
- A single piece is exactly **one** authored unit.
- Slide navigation, "Adicionar slide" and ZIP stay carousel-only.
- There is no StaticDraft and no new table.

**This absorbs the previously planned `STATIC_SINGLE_PIECE_AUTHORING_PERSISTENCE_V1` (audit M1 / architecture review P1-2).** Making Free/Template truthful required the same persistence boundary.

- **Dirty semantics.** Before the first save, the bootstrap itself is the clean baseline ("Ainda não salvo"): a blank free canvas is not an unsaved edit. Any mode change or element edit makes the piece dirty, and viewport and tool state never do.
- **Durable output rule** (audit AUDIT-003). "Salvar nesta peça" **saves dirty authoring first**, awaits success, and only then attaches. If that save fails, nothing is attached. "Gerar PNG" still renders the current (possibly unsaved) state for iteration, and the frozen snapshot keeps every PNG reproducible.

## 7. Static FREE authoring (a real mode)

- **Canvas:** the shared `FreeStage` drawing (the same component the still render uses) over Library display URLs, on the ChannelPiece's stage (1080×1350, or 1080×1920 for story).
- **Tools:** the Selecionar/Mão toggle, the same as Video. Selecionar mounts the host-agnostic `FreeElementsOverlay` (hit targets, outline, corner handles, drag-to-move and resize through `free-manipulation`). Mão pans.
- **Inspector:**

  | Tab | Content |
  |---|---|
  | Template | `CompositionModePanel` |
  | Conteúdo | "os textos são elementos" |
  | Assets | overview of the free images, with "Trocar" on the same single binding path as Elementos |
  | Estilo | Free-aware, truthful copy |
  | Elementos | the shared `FreeSceneElements` panel, generic over its host with unit wording |

- **No** timing, Motion, transitions, keyframes, groups, vectors or effects. *Free Static = space.*

## 8. Explicit Template entry and destructive switching

`components/creative/authoring/composition-mode-panel.tsx` is the Template tab's mode statement and the only place a composition changes mode. It is shared by Static (the whole piece) and Video (one Scene), and the caller applies the change with its own domain helpers.

| Case | Behaviour |
|---|---|
| A. empty free → Template | Switches directly. |
| B. free with authored work (any element, or a free carousel with more than one slide) → Template | Asks ("…serão descartados…"). Cancel keeps free; confirm replaces. |
| C. Template → free | Always asks. Replaces with one blank free unit. No conversion. |
| D. Template A → Template B | Only one family is registered. The same replacement path would apply; no multi-Template mapping was built. |

- **Static Template entry** instantiates the legitimate Template defaults: carousel → Cover + Info (`defaultCarouselSlides`); single piece → the contextual Cover from the ChannelPiece text.
- Switched-away slide ids are reserved, so a new unit never inherits an old slide's render jobs.
- Every switch is dirty until Save. "Voltar ao salvo" restores the saved mode.

## 9. Video: new Scenes are free

- **New VideoDraft:** the initial Scene is `createFreeScene(1, uuid, 3)`, an explicit empty free composition.
- **"Nova cena":** inserts an explicit free Scene directly (the dialog was removed) and opens Elementos.
- **Legacy Scenes** with an absent composition still resolve as the historical Template Cover. Nothing is backfilled or reinterpreted.
- **`applySceneTemplate`** writes an **explicit** Template composition, `{ layout: 'cover', content: { title: 'Cena N' } }`, never an absent one.
- **`applySceneFreeComposition`** replaces with `{ kind: 'free', elements: [] }`.
- Both drop `element_timing`, whose ids belong to the replaced element set, so there is no orphan. Duration, Motion, briefing, prompt and the Scene's hero binding are kept. Root timeline items and the other Scenes are untouched (tested through the adapter).
- **Style copy:** the Free-Scene Template-tab copy that claimed "cores e fontes da Identidade do Projeto" was replaced. The free roles are labelled "papel do estilo", and Estilo tells the truth for free compositions: Studio defaults, used directly. Project Identity token resolution is still separate work.

## 10. Render implications

**Template-free still.** `StaticFreeRenderManifestSchema` (`lib/schemas/creative/static-render.ts`) is an additive sibling of the Template manifest.
- It has the same envelope (source, context, canvas, identity, sequence, assets, output).
- It has **no `template` and no `content`**: `composition: { kind: 'free', elements }` holds the exact free payload elements Video renders.
- Images are manifest-level `library_file` refs. It never uses a TimelineManifest and never a TemplateRef.

**Snapshot.** The frozen static snapshot accepts either manifest. A free snapshot refuses every Template-only field.

**Enqueue** (`app/api/creative/static-authoring/render/route.ts`) accepts `{ context, composition }`, with the same ownership chain and execution plane.
- The canvas is the ChannelPiece target, never the browser's.
- Images must be live, owned Project images (`FREE_IMAGE_FORBIDDEN`).
- The manifest is resolved before it is queued.

**Claim** (`resolve-static-runtime-input.ts`) presigns only the frozen LibraryFile ids among the execution's project-scoped rows, the same boundary as before (`FREE_IMAGE_UNAVAILABLE`).

**Drawing.** `components/creative/free/free-stage.tsx` is the one free drawing, shared by:
- `FreeSegment` (Video, inside its Sequence, with element timing);
- `StaticFreeStill` (renderStill);
- the Static editor preview.

## 11. Worker

- **Changed worker files:**
  - new `components/creative/free/free-stage.tsx` (added to `export.mjs`);
  - `remotion/timeline/FreeSegment.tsx` (now draws through FreeStage; the DOM is unchanged);
  - `remotion/DocumentaryCardComposition.tsx` (free still branch, with an import-free kind guard);
  - `infra/render-worker-runtime/server.mjs`.
- **The `server.mjs` fix was found in local proofing.** `/render-still` rejected any still without a `resolvedTemplate`, so it now accepts `resolvedInput.kind === 'free'` with composition elements. The coordinator dispatches by claim `kind` and needed no change.
- **Tarball:** `content-studio-creative-editor-free-default-and-template-entry-v1.tar.gz`, 77 entries (the previous 75, plus `components/creative/free/` and `free-stage.tsx`).
  - SHA-256 `618c3fc16af1879566b26520ebe379e539d662fe4c889c622d9ec706840ef4e9`.
  - The operator updated the VPS and reported it healthy before the push.
- **Local exported-worker proof** (`server.mjs` on :3467, before commit):
  - free post 1080×1350, free story 1080×1920, and a Documentary Cover still regression;
  - a mixed Video (explicit Template Cover + a free Scene with element timing) at frames 15 / 40 / 75.
  - Evidence: `evidence/creative-editor-free-default-and-template-entry-v1/local-exported-worker-free-post-free-story-template-cover.jpg` and `local-exported-worker-video-mixed-frames-15-40-75.jpg`.

## 12. Production proof (after deploy)

**Dedicated test data** (Project Portal Comunidades Alternativas), created through the product APIs and flows:
- EditorialContent `629bd68f-990f-4377-9c92-920d5181e50c` "Teste · composição livre V1";
- ChannelPieces: feed `fb5b4df1-a523-4d96-b46b-7752f2bb013f`, story `808dbc66-a5c6-432b-8642-4024bf3694a9`, new carousel `b2518238-8692-42da-813a-9a4fb50a36e4`;
- VideoDraft `7fe4cf8e-4d98-4824-98d4-2fff5958bfed`, created by the Production page's "Criar Vídeo".
- (Instagram `post` is not a valid channel+format; the Instagram single image is `feed`.)

### Static feed (1080×1350)

1. **Bootstrap:**
   - the Template tab showed "Livre · nenhum template aplicado" and the header "Livre";
   - a blank FreeStage, no Documentary drawing, "Ainda não salvo";
   - only the registry Template was offered; no slide nav or ZIP; no page overflow;
   - **no row was written on open.**
2. **Authoring:**
   - Text added (dirty) and edited to accent, "Título" step: accent `#A34A27`, Fraunces, 118.8 px.
   - Library image added (`pack-a-005-illustration.jpg`).
   - Selecionar: move then SE-corner resize, 10/35/80/45 % → 15/40/80/45 → 15/40/70/35, selected with 4 handles.
   - Assets listed the image with "Trocar"; Estilo showed the free-truthful copy.
3. **Save → database:**
   - `template_id NULL` and one slide `{ id: 'slide-1', composition: { kind: 'free', elements: [text, image] } }`;
   - stable ids, exact boxes, `library_file_id`, no URL.
4. **Hard reload:** exact (the image at 162/540/756/472.5 px = 15/40/70/35 %); mode Free, "Salvo", the tool back to Mão.
5. **VPS PNG** `0f42ed8c-f73a-4d3b-8669-35a84686a75f`:
   - completed at 1080×1350;
   - the frozen snapshot has **no `template` and no `templateId`**, only free elements and one `library_file` asset;
   - the image matches the authored composition.
6. **Save-before-attach:** after an unsaved alignment change, "Salvar nesta peça" saved authoring at 03:12:12.46 (`align: center`), *then* created LibraryFile `ecbb0ccf-9f84-40dd-b466-71e3516a98a2` (`studio_render`, source `0f42ed8c…`) at 03:12:15.38. One attachment.
7. **Template entry from a populated free piece:**
   - the confirmation named the discarded free elements;
   - Cancel kept Free ("Salvo");
   - confirm → "Template · Editorial Documentary Collage", with anatomy, layouts and the Documentary card, dirty;
   - "Voltar ao salvo" restored the saved Free composition;
   - re-entered, saved and reloaded → Template.
   - Database: `template_id = editorial-documentary-collage-v1`, **1** slide, fresh id `slide-2` (never reusing the free `slide-1`), Cover/Dark, no free key.
8. **Template → free:** confirmation shown; confirm → blank Free (dirty); "Voltar ao salvo" → the saved Template.

### Static story (1080×1920)

- Bootstrap Free; text added; saved (`template_id NULL`, 1 slide); reload exact (centered, 81 px on the story stage).
- VPS PNG `edb7fcf9-1149-47ad-bc4e-31070e2919b0` completed at **1080×1920**, with no Template in the snapshot.
- Evidence: `evidence/.../vps-free-feed-0f42ed8c-free-story-edb7fcf9.jpg`.

### New carousel

- Opened Free; "Adicionar slide" added a blank free slide (no Template dialog); text added to slide 2; saved; reload exact.
- Database: `template_id NULL`, 2 free slides.

### Existing real 10-slide carousel `1247e54b…` (regression, read-only)

- Opened as "Template · Editorial Documentary Collage", "Salvo", "Slide 1 de 10".
- Documentary cards were drawn on slides 1, 3 and 5; Restaurar padrão and ZIP were present; there was no Free stage or tool.
- "Gerar PNG" on slide 5 → `011690bc-38ac-4291-bb88-b77d09284804`, completed at 1080×1350 through the `list` Template.
- ZIP export: 200, `application/zip`, 18.4 MB.
- The row is **unchanged**: Template id, 10 slides, `updated_at 2026-09-26 08:53:53.88978`.

### Video

1. **New draft `7fe4cf8e…`:** its persisted initial Scene is `{ kind: 'free', elements: [] }`. The Template tab says "Livre · nenhum template aplicado".
2. **"Nova cena":** inserted Scene 2 as free directly (no dialog) and opened Elementos; a text was added.
3. **Switching:**
   - Scene 2 (with a text) → Template asked ("elementos livres da cena 2…"), then confirm → Cover.
   - Scene 1 (empty) → Template switched directly.
   - Scene 1 → free asked, then confirm; a text was added.
4. **"Salvar e renderizar" → database:** Scene 1 free with its text; Scene 2 an **explicit** `{ layout: 'cover', content: { title: 'Cena 2' } }`. No orphan timing, durations 3 s.
5. **Hard reload:** exact modes (Scene 1 Livre, Scene 2 Template), clean.
6. **Live Player DOM:** Scene 1 has one free layer ("Cena 1 livre de novo") and no Template svg; Scene 2 has the Documentary svgs and no free layer.
7. **VPS render** `26e4aac4-3d1a-4a13-932b-bc4dcc1f6510`: h264 1080×1920, 180 frames, AAC, segments `[free, template]`. Frames 45 (the free Scene) and 135 (the explicit Cover "CENA 2"): `evidence/.../vps-video-mixed-26e4aac4-frames-45-135.jpg`.
8. **Legacy:** draft `be990ed0-fec1-4e4b-9d99-7071248b8ec2` (one absent-composition Scene, created by the previous code) opens as "Template · Editorial Documentary Collage" / Cover and stays clean. Its row is unchanged.

### Browser-tooling notes

- Radix tabs inside the floating Dockview Inspector did not react to synthetic clicks; `mousedown` activated them, and buttons were driven with DOM `click()`.
- Localhost had no signed-in session, so the editor proof was done on production test data.

## 13. Responsive (production, fresh load per width)

Pages checked: Static Free (story), Static Template (feed after Template entry), Video (mixed draft).

| Width | Page overflow-x | Mode panel + Template/free choice reachable | Stage/Player present |
|---|---|---|---|
| 1440 | none | yes (floating Inspector) | yes |
| 1024 | none | yes (choice 92/133 px, in view) | yes |
| 768 | none | yes (stacked) | yes |
| 390 | none | yes (stacked) | yes |

**Environment observation, not caused by this mission.** In this test browser the floating Dockview Inspector's inner view intermittently mounted at 100 px (inside a correct 358 px palette). It happened on **every** editor — the untouched real carousel, Static Free and Video alike (358 on some loads, 100 on others). The workbench was not changed by this mission. It is recorded for a real-browser check.

## 14. Tests and gates

**New tests:**
- `lib/creative/authoring/__tests__/free-default-and-template-entry.test.ts` (34 tests):
  1. Static bootstrap (free; empty free valid; clean baseline; no implicit Documentary; persisted Documentary stays Template).
  2. Free state (add text/image, geometry, binding, order, visibility, replace, remove, exact reload; the mixed/fake write boundary, including `'blank'`).
  3. Template entry (defaults, registry-only, persists as Template).
  4. Destructive switch (content detection, blank-free replacement with fresh ids, revert restores the mode).
  5. Single piece (no carousel gate, cardinality one, no collection UI leak, save-before-attach ordering, migration 038 shape).
  6. Video (new draft free, "Nova cena" free, legacy Cover, explicit Template entry, empty free entry, root timeline and neighbours unchanged).
  7. Render (template-free manifest, snapshot refusal of Template fields, claim presign / `FREE_IMAGE_UNAVAILABLE`, FreeStage markup, the enqueue free shape, worker export and still branch).
  8. Carousel compatibility (10-slide Template body, older client without `templateId`, Template path untouched).
- `components/creative/authoring/composition-mode-panel.test.tsx` (4 tests, jsdom): cases A, B and C at the UI boundary, including Cancel.

**Updated to the new contract:** `free-composition.test.ts` (FreeStage; "Static stays Template-required" → "Static free reuses the free composition and never fakes a Template"), `static-parity.test.ts`, `authoring-usability.test.ts`, `static-authoring-state-route.test.ts`, `carousel-completion.test.ts`.

**Gates:**

| Gate | Result |
|---|---|
| Full suite | 100 files / 1383 tests |
| `tsc --noEmit` | clean |
| ESLint | 0 errors, 42 warnings (the unchanged pre-existing baseline) |
| `pnpm build` | success |

## 15. Files

**New:**
- `lib/creative/authoring/free-static.ts`
- `components/creative/free/free-stage.tsx`
- `components/creative/authoring/composition-mode-panel.tsx` (+ test)
- `scripts/038_static_authoring_free_composition.sql`
- the tests and evidence listed above

**Changed:**
- the Static editor page; the Video editor page;
- `carousel-state.ts`; `free-composition.ts` (generic host); `scene-composition.ts` (mode switch helpers); `video-draft-entry.ts`;
- `static-render.ts`; `resolve-static-render.ts`; `static-snapshot.ts`; `resolve-static-runtime-input.ts`;
- both static API routes; `free-scene-panels.tsx` (generic host, wording); `free-scene-overlay.tsx` (host-agnostic core); `inspector-panels.tsx` (Estilo free copy);
- `FreeSegment.tsx`; `DocumentaryCardComposition.tsx`; `export.mjs`; `server.mjs`; `lib/types.ts` (comment).

## 16. Limitations

- **Static free:**
  - no rotation, opacity, crop, auto-fit or authored background (Studio-default Identity background);
  - text is clipped at its box;
  - corner-handle resize only; no snapping or guides;
  - no per-slide mix of free and Template inside one carousel;
  - no ZIP for single pieces.
- **Style:** free roles use the current Studio-default tokens. Project Identity → visual tokens is still unresolved (the adapter returns defaults) and remains separate work.
- **Mode switching** is replacement only. There is no semantic mapping between free elements and Template slots, and no multi-Template family UX (one family registered).
- **Bootstrap binding:** a never-saved piece bootstraps its free unit as `slide-1`. Had such a piece prior renders bound to `slide-1`, they could appear as that unit's (stale-flagged) render. The reconnaissance found none.
- **Video:** the Template entry starts from Cover with the positional title ("Cena N").
- **Test browser:** see §13 for the Dockview floating-view sizing observation.

## 17. Production data left intentionally

- EditorialContent `629bd68f…` with feed `fb5b4df1…` (now Template, with a saved PNG attached), story `808dbc66…` (free) and carousel `b2518238…` (free, 2 slides).
- VideoDraft `7fe4cf8e…` "Novo vídeo" (mixed free + Template).
- Executions `0f42ed8c…`, `edb7fcf9…`, `011690bc…` (carousel slide 5 regression) and `26e4aac4…`.
- LibraryFile `ecbb0ccf…`.
- The real carousel `1247e54b…` and the legacy draft `be990ed0…` were not modified.

CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1_COMPLETE
