---
kind: spec
title: "Creative Editor Undo/Redo Discovery V1"
comments: none
---

# CREATIVE_EDITOR_UNDO_REDO_DISCOVERY_V1

Status: complete. Discovery only; no product implementation.

## Checkpoint and evidence

Undo is a confirmed authoring requirement. Current Static actions include text/content, transforms, free move/resize, visibility, asset replacement, layer order, add/remove, slide operations, template/layout/appearance, and render-affecting authored changes. Video has scene, temporal, media, geometry, order, and timing mutations.

| Item | Value |
|---|---|
| remote main / selected HEAD | 54ed6f74151f0ddde07bce50ec9147e578fb50ed |
| branch | discovery/creative-editor-undo-redo-v1 |
| worktree | D:/Traycer/worktrees/fmultiman__content-studio-ai/discovery-creative-editor-undo-redo-v1 |
| product changes | none |

The discovery worktree was fast-forwarded to verified origin/main. Protected historical checkout was not used.

## Authored authorities

Static is owned by app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx. Its persisted authority is the ChannelPiece-owned row through /api/creative/static-authoring-state. Template mode persists template/layout/appearance, content, typography, tuning, primitive transforms/selections, asset overrides, hidden elements, element order, and custom elements in slides[]. Free mode persists freeSlides[] and FreeSceneComposition elements. saveNow() uses PUT. Render jobs are separate and never save authoring. Dirty compares the current persisted body to lastSavedSnapshot or bootstrap baselineSnapshot. Voltar ao salvo reconstructs the saved body.

Reducer/helper authority is lib/creative/authoring/reducer.ts plus free-static.ts, free-composition.ts, template definitions, and slide collection helpers. The reducer has explicit actions for all authored fields but no history.

Video is owned by app/(dashboard)/creative-editor/video/[draftId]/page.tsx. VideoDraft is loaded from /api/video-drafts and saved by PATCH /api/video-drafts. Authored fields are name, scenes[], independent timeline items, and videoCanvas. buildVideoDraftSaveBody() and persistedVideoSnapshot() define the save/dirty contract. Project identity, Production context, render executions, and generated outputs are separate.

## Static mutation matrix

| Mutation | Current authority | Authored field | Transaction in V1 |
|---|---|---|---|
| title/body/structured text | LayoutContentForm/page; content actions | contentOverride | one focus-to-blur transaction; short idle fallback |
| typography/line style | StylesTab/text-style-controls | typography/tuning | one control edit; numeric blur/Enter one |
| x/y/scale/rotation/opacity | TemplateElementPanel/primitive-controls | primitiveTransforms/tuning | slider gesture one; numeric commit one |
| free move/resize | FreeElementsOverlay | element box | pointerdown to pointerup one |
| add text/image | FreeSceneElements/media picker | elements[] | one successful insertion |
| remove/visibility | FreeSceneElements/layers | elements[]/hidden ids | one each |
| asset replacement/default | asset card/picker | asset override or library id | one successful application |
| layer reorder | TemplateElementsTab/ElementLayers | element order | one completed reorder |
| template/layout/appearance | CompositionModePanel/LayoutSwitchDialog | mode/template/slides | one confirmed switch |
| slide add/remove | page toolbar and collection helper | slides[] | one each |
| slide reorder/duplicate | not currently implemented | future slides[] | one meaningful operation if added |
| restore Template default | page/createTemplateSlide | current slide | one |

Current Static has no history stack, command log, Undo/Redo controls, or editor-global keyboard shortcuts.

## Video mutation matrix

| Mutation | Current authority | Authored field | Transaction in V1 |
|---|---|---|---|
| scene name/text/prompt/layout/appearance/motion/source | page/updateVideoScene/composition helpers | name/scenes[] | one completed control; text blur/idle |
| scene add/remove/reorder | insert/remove/reorder helpers and SceneStrip | scenes[] | one completed action/gesture |
| scene duration/trim | setSceneDuration/SceneTimeline | scene duration | one completed trim |
| free move/resize | FreeSceneOverlay/setFreeElementBox | free box | one pointer gesture |
| free add/remove/replace/order/visibility | FreeSceneElements/helpers | scene composition | one each |
| temporal add/remove/replace | temporal-items/page | timeline.items[] | one each |
| temporal move/resize/trim | SceneTimeline/numeric fields | item timing | one gesture or numeric commit |
| temporal text/volume/fit/audio mode | timeline inspector | timeline item fields | one control; text blur/idle |
| playhead/scrub/playback | frame-cursor/transport | none | never history |
| selection/tabs/viewport/dock | UI hooks | none | never history |

Timeline scrub is ephemeral. Timeline trim and item timing are authored.

## State classification

| Category | Static | Video | History rule |
|---|---|---|---|
| A authored/document | mode, template, slides, content, transforms, assets, visibility, order | name, scenes, timeline, canvas | snapshot source |
| B saved baseline | baselineSnapshot/lastSavedSnapshot/server row | lastSavedSnapshot/VideoDraft row | dirty only |
| C selection/UI | selected target/slide, inspector, Anatomy/Camadas, dialogs | selected scene/item/element, tabs, dialogs | exclude |
| D viewport | zoom/pan/fit/panning/dock | same | exclude |
| E playback/temporal UI | none | playhead/playing/scrub | exclude |
| F async | render jobs, save status, picker, signed URL/intrinsic load | render polling, save status, picker, prompt busy | exclude |
| G remote sync | hydration, PUT response, updated_at, library hydration | PATCH response, updated_at, render status | baseline/context only |

Hover, pointer preview, media-picker open, render progress, save spinner, and playhead never become history.

## Transaction boundaries

Use an adapter around authored state. Apply live updates for responsiveness, then commit one canonical snapshot at semantic completion. Suppress no-op commits. Initialize history after hydration; remote and async updates never dispatch entries.

- drag and resize: pointerdown plus all pointermoves plus pointerup = one;
- rotation/slider: one pointer gesture = one;
- typed numeric: blur or Enter = one;
- text: focus-to-blur transaction, with 500–750ms idle coalescing only as a fallback;
- layer reorder: one completed reorder;
- add/remove/replace/visibility: one click or successful picker completion;
- slide add/remove/reorder and template/layout/appearance/reset: one meaningful confirmed operation.

## Architecture decision

Snapshot past/present/future is simple, deterministic, naturally supports Redo, and is testable. Command inversion is smaller in theory but makes structural layout, slide, media, and async actions require fragile inverses. Persistent event sourcing adds migrations and replay complexity without product evidence. Choose a hybrid transaction snapshot: retain existing pure reducers/helpers, but snapshot only canonical authored state at committed boundaries.

V1 is session-local: past[], present, future[]. No DB history, no migration, no past/future JSON in AuthoringState, and no event sourcing.

## Dirty, Save, Revert, reload

- CURRENT is displayed authored state.
- SAVED BASELINE is the last successfully persisted authored snapshot, initialized from server hydration. Static bootstrap is baseline before first Save.
- PAST and FUTURE are committed authored snapshots.
- DIRTY means CURRENT differs from SAVED BASELINE, independent of stack contents.
- Undo to the saved baseline makes dirty false.
- Redo away makes dirty true.
- Save moves the saved-baseline pointer to CURRENT and preserves history; it is not a history entry.
- Undo can reach a pre-save state, which is then dirty relative to the new baseline.
- Voltar ao salvo restores SAVED BASELINE, clears past and future, and leaves dirty false. It is a recovery reset, not Undo.
- A new mutation after Undo clears future.
- Save failure leaves baseline and history unchanged.
- Reload, route exit, and reopen hydrate authored truth and start a fresh history. History is not persisted.

Async rules: hydration, save responses, render enqueue/poll/completion, signed URLs, image dimensions, library hydration, worker metadata, and generation status never create entries. Media selection commits one authored decision only after applying it. Stale async responses cannot replace newer CURRENT state.

## Memory and depth

Snapshots contain authored JSON metadata and library ids, not media bytes.

| Composition | Estimate |
|---|---:|
| 10-slide carousel | 50–150 KB |
| 20-slide Static carousel with custom elements | 150–400 KB |
| 10 Free Elements | 5–50 KB |
| multi-scene VideoDraft with timeline | 20–120 KB |

These are schema-based engineering estimates. Cap V1 at 50 committed session transactions, roughly 2.5–20 MB for ordinary work. Add structural sharing only if measurements require it.

## Undo/Redo and shortcuts

Decision: **UNDO + REDO V1**. Redo is not independently evidenced, but the selected future branch already exists naturally and shipping both avoids a second interaction model.

Place Undo and Redo near Save and Voltar ao salvo, with disabled boundary states and accessible labels.

- Ctrl/Cmd+Z: Undo.
- Ctrl/Cmd+Shift+Z: Redo.
- Ctrl/Cmd+Y: Redo where platform convention expects it.

Inside input, textarea, contentEditable, or any text editor, native text undo/redo wins. Do not intercept there. Outside editable focus, editor-global shortcuts apply. Avoid duplicate bubbling handlers.

## Static/Video sharing decision

| Concern | Static | Video | Shareable core? | Why |
|---|---|---|---|---|
| snapshot | ChannelPiece body | VideoDraft body | adapter contract only | different schemas |
| begin/commit | reducer/page/gesture | scene/timeline/page/gesture | yes | same semantic boundaries |
| dirty baseline | Static PUT snapshot | Video PATCH snapshot | policy only | different authorities |
| Save/Revert | separate API/reconstruction | separate API/reconstruction | no transport | domains differ |
| selection/viewport | UI only | UI only | no | separate UI |
| drag/resize/reorder | free/template | free/scene | gesture contract | host data differs |
| scrub | absent | playhead only | no | temporal UI |
| trim/timing | absent | authored temporal domain | no | Video-specific |
| async | render/library/save | render/library/save | policy | separate transports |

Recommendation: **Static first only**. Build an explicit adapter boundary, then adopt it in Video in a separate mission after Static transaction semantics pass. Do not call this primitive global.

## Scope, impacts, and tests

Exact implementation mission: CREATIVE_EDITOR_UNDO_REDO_STATIC_V1.

Follow-up: CREATIVE_EDITOR_UNDO_REDO_VIDEO_ADAPTER_V1.

Only if Terra confirms generation persistence regression: GENERATION_DRAFT_AUTOSAVE_AND_RESUME_REGRESSION_CORRECTION_V1.

Expected migration: NONE. Renderer impact: NONE. Worker impact: NONE. No authored schema change is required. No Video or generation code changes belong in this discovery.

Future tests must cover one/multiple Undo, Redo, future clearing, drag/resize/slider/numeric/text grouping, reorder, add/remove/visibility/asset replacement, template/layout/appearance/reset, slide operations, Save baseline movement, Undo to baseline, Redo away, Save with history, Voltar ao salvo reset, failed Save, reload fresh history, selection/viewport/zoom/pan/playhead/playback exclusion, async/hydration exclusion, stale async protection, keyboard shortcuts, text isolation, and disabled toolbar boundaries. Keep Video adapter tests separate.

Risks are keystroke explosion, gesture explosion, baseline confusion, phantom async entries, memory growth, cross-domain coupling, and ambiguous Revert; the rules above address each with transaction boundaries, separate baseline, async isolation, a cap, Static-first adapters, and explicit reset semantics.

CREATIVE_EDITOR_UNDO_REDO_DISCOVERY_V1_COMPLETE
