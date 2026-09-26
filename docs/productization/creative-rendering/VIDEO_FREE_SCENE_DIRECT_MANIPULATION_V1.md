# VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1

Bounded direct spatial manipulation of free-Scene Elements in the Live Authoring Player. There is an explicit **Selecionar** tool beside the default **Mão** (Hand/Pan). With it, the user can click a free text or image on the Player, move it, resize it from its corners, save, and render the same normalized boxes. This is not a generic canvas editor: it does not touch Template Elements, timing or the renderer.

## 1. Checkpoints

- Start: `b9e083060d88540f05774bc03374c3828c520654` (local = `origin/main` = remote, clean tree): the closure of VIDEO_FREE_SCENE_COMPOSITION_V1.
- Feature: `c897b3494d11eee28ae160a32b49d54c734ed505`, Vercel Production `6683541906` success.
- **Worker unchanged.** None of the changed files is in `infra/render-worker-runtime/export.mjs`; `FreeSegment` and `TimelineComposition` are untouched. No tarball and no operator step.
- **No migration.**

## 2. Phase 0: coordinate architecture (executing code)

- **Pan and zoom:** `usePreviewViewport` holds zoom (`'fit' | number`) and pan as UI state. Its `panHandlers` (pointer drag) are spread on the viewport container `live-player-viewport`, and wheel pans on desktop.
- **Authored stage on screen:** the absolutely positioned `div[data-testid="live-player"]`, with `left/top = viewport.origin` (centered + pan) and `width/height = stage × scale`.
  - This is **layout sizing, not a CSS transform**, so its `getBoundingClientRect()` is exactly the on-screen stage at any Fit, zoom or pan.
  - The Remotion `<Player>` scales the composition inside that box, and the box has `pointer-events: none`.
- **Where editor chrome can live:** a sibling of that box inside the viewport container, with the same `left/top/width/height`. It sits outside the Player/render tree, so nothing reaches `FreeSegment`, the manifest, a snapshot or the worker.
- **Selection:** the Inspector's free Elementos panel already had one open element (`openElementId`), so it becomes the one shared selection. The Scene under the playhead comes from `sceneIndexAtFrame(ranges, cursor)` (the single frame cursor).
- **Toolbar:** the shared `ViewportZoomControls` already exposes a `trailing` slot (used by the Inspector launcher), so no shared-workbench change was needed.

## 3. Tool mode

- `PreviewInteractionMode = 'pan' | 'select'`, a Video-page `useState` with **`'pan'` as the default**.
  - It is not persisted, not in the save body or dirty snapshot, and not in localStorage.
  - It returns to Mão after a reload.
- The toggle sits in the Player transport, next to the zoom controls and before the Inspector launcher: a radiogroup "Ferramenta da prévia" with **Selecionar** (pointer icon) and **Mão** (hand icon).
- **Mão:**
  - the viewport container gets `viewport.panHandlers`, exactly as before (grab cursor, drag pans);
  - the free overlay is not mounted at all, so nothing intercepts the pointer.
- **Selecionar:**
  - the container gets no pan handlers (default cursor, `touch-action: none`), so the stage never pans;
  - the overlay is mounted;
  - wheel pan and Fit/Centralizar/100% still work, because they are viewport-only.
- There is no auto-switch between tools, and opening or minimizing the Inspector doesn't change the tool.
- Static is untouched (no toggle, same pan).

## 4. Editor-only overlay and selection

`components/creative/video/free-scene-overlay.tsx` (`FreeSceneOverlay`) is mounted beside the Player with the same rectangle.

- It subscribes to the frame cursor. Only the **free Scene under the playhead** gets targets, so chrome never spills into a neighbouring Scene. Over a Template Scene it shows only a "Cena com template: edite pelo Inspector" hint, with no targets (Template Elements are never made free-form).
- Targets are the authored boxes (as % of the overlay), in paint order. **Hidden elements have no target.**
- **Click:**
  - selects the element's stable id through `selectFreeElementFromPreview`: it keeps the playhead, selects the owning Scene without seeking, sets `openElementId`, and switches the Inspector tab to Elementos (the Inspector panel itself is never forced open);
  - clicking the stage background clears the free selection;
  - selecting in the Inspector shows the chrome on the Player. There is one selection.
- **Chrome** (on the selected element, Select tool only): a 2 px outline and four 12 px corner handles with resize cursors, in screen pixels. Because the overlay is layout-sized, no inverse scaling is needed.
- **Playing:** starting a manipulation pauses the Player at the current frame (`LivePlayerController.pause`); there is no second clock.

## 5. Geometry mapping and edits

`lib/creative/video-editor/free-manipulation.ts` (pure functions):
- **`pointerToStage(clientX, clientY, rect)`:** `((x − rect.left) / rect.width, (y − rect.top) / rect.height)`, taken from the overlay's live rectangle, which is the stage. There is no second copy of the viewport math, and deltas are scale-independent.
- **`moveFreeBox(start, dx, dy)`:** translates only (width and height kept) and clamps on stage.
- **`resizeFreeBox(start, 'nw'|'ne'|'sw'|'se', dx, dy)`:** the opposite corner stays fixed; edges stay on stage and never closer than the existing domain minimum `MIN_FREE_BOX` (2%). Results go through `clampFreeBox` (4-decimal rounding).
- **`sameFreeBox`:** a click without a geometry delta is never an edit.

Each real delta is applied with the **existing** `setFreeElementBox(scene, id, box)` (the same helper as the Inspector's % fields). It keeps the id, kind, stack order, text, style, LibraryFile and fit, and is a no-op on Template Scenes. The persisted model is still the normalized stage box; no pixels are stored.

Text resizing changes only the box: the font size step is unchanged, and the existing clipping at the box stays authoritative. Image resizing changes only the box; the fit is unchanged. Only corner handles were built; there are no edge handles, rotation, aspect-lock, guides, snapping, multi-select or keyboard nudge.

## 6. Dirty and save

- **Authored (dirty):** moving and resizing. These run through `setScenes`, the same path as every free edit, so explicit Save and optional autosave apply unchanged.
- **Not authored:** switching tools, selecting, clearing the selection, hover, pointer capture, handle visibility, opening/minimizing the Inspector, zoom, Fit, Center, pan.
- Proven: switching the tool and clicking elements left "Salvo"; the first real delta dirtied the draft.

## 7. Proofs

**Local** (dev server; real draft; edits reverted with "Voltar ao salvo"):
- Mão is the default, and a stage drag panned 0,0 → 60,40 with the draft still "Salvo".
- In Selecionar a stage drag did not pan, and clicking the text selected its stable id; the Inspector opened the same element.
- **Deterministic mapping:**
  - at **Fit** (stage 270×337 px), a drag of +10% width / −5% height moved the text 10/25 → 20/20 %, keeping 80/27 %;
  - at **100%** (stage 1080×1350 px on screen), the inverse drag returned it exactly to 10/25 %;
  - changing the zoom moved nothing.
- **Image:** NW corner +10%/+10% gave 10/30/80/50 → 20/40/70/40 (bottom-right fixed), with the LibraryFile and order unchanged.
- **Inspector minimized:** manipulation still worked; restoring it showed the same element and its new geometry.

**Production** (dedicated draft `da9b61ce-926e-46a6-b9d3-e57958182c74`: Template Cover, free Scene with text + Library image, Template Citação, root B-roll, lower third and 2 audio items; 4:5):
- **Mão:** default after load (grab cursor); a stage drag panned 0,0 → 60,30; "Salvo".
- **Selecionar:** a stage drag stayed at 60,30 (no pan); "Salvo".
- **Text:**
  - clicked in the Player: the overlay and the Inspector both selected `79e83fb6…`;
  - move: 5/15 → 8/25 % with 90/22 kept, and the draft became dirty;
  - SE resize: 90×22 → 80×26 %, font still 118.8 px.
- **Image:**
  - move: 10/30 → 15/28 %; SW resize: 15/28/80/50 → 25/28/70/42 %;
  - the file stayed `pack-a-005-illustration.jpg` and the Player order stayed image z1 / text z2.
- **Inspector minimized:** moving the image worked (Player updated); restoring showed the image at 20/30/70/42 %.
- **Save → database:** image `{0.2,0.3,0.7,0.42}`, text `{0.08,0.25,0.8,0.26}`, same ids, LibraryFile, style and order; Scenes 1/3 kept `cover`/`quote` and the Citação `element_timing`; 4 root items.
- **Hard reload:** exact boxes; the tool is back to Mão; "Salvo".
- **Scene boundary** (Selecionar): targets only at frames 90–179, the free Scene. At 89 (Cover) and 180 (Citação) there are no targets, only the Template hint.
- **Alignment:**
  - the overlay rectangle equals the Player rectangle at Fit (103,235 286×358) and at 100% (−294,−261 1080×1350, panned);
  - each overlay box matches the drawn element within 0.3 px at Fit and exactly at 100% (text and image).
- **VPS render** `0e1d5a5a-9715-4779-a327-54955e423053` (worker unchanged):
  - the frozen snapshot carries exactly the manipulated boxes;
  - h264 1080×1350, 30 fps, 300 frames, AAC; overlap audio −15.4 / −5.6 dB (unchanged);
  - frames 89 (Cover), 100 (free Scene at the new boxes), 150 (root lower third above the free Scene), 180 (Citação): `evidence/video-free-scene-direct-manipulation-v1/vps-manipulated-draft-frames-89-100-150-180.jpg`.

## 8. Responsive

Fresh load per width, Selecionar on the free Scene, text clicked directly:

| Width | Layout | Page overflow-x | Tool toggle | Direct selection | Overlay aligned | Inspector geometry |
|---|---|---|---|---|---|---|
| 1440 | floating | none | reachable | ✓ | ✓ | reachable |
| 1024 | floating | none | reachable | ✓ | ✓ | reachable |
| 768 | stacked | none | reachable | ✓ | ✓ | reachable |
| 390 | stacked | none | reachable | ✓ | ✓ | reachable |

The Inspector % fields remain the fallback on narrow screens; there is no separate touch gesture system (Pointer Events only). Resizing the browser window *during* a session did not reflow the workbench in the test browser, so each width was measured on a fresh load. No page overflow was seen in either case, and the workbench's floating/stacked switch was not changed by this mission.

## 9. Regressions

- **Static:** the real 10-slide Carousel opens with the TPL./CONT./ASSETS/ESTILO/ELEM. tabs; the Canvas pans (0,0 → 50,30); 100% shows the 1080×1350 card; there is no tool toggle or free overlay. Shared `ViewportZoomControls` and `usePreviewViewport` are unchanged. No render or shared semantic code changed, so no renderStill was needed.
- **Template Scenes, element timing, root timeline, audio:** unchanged (tested and rendered). Free Element timing was not added (next mission: VIDEO_FREE_ELEMENT_TIMING_V1).
- The Player transport, Scene navigation, Timeline and dock are unchanged; zoom, Fit and 100% are exercised above.

## 10. Tests and gates

- New `lib/creative/video-editor/__tests__/free-manipulation.test.ts` (17 tests):
  - Pan is the default and the tool is UI-only (pan handlers only in Mão; never in the save body or dirty snapshot); selection doesn't dirty;
  - pointer mapping is identical under different scales and pans, and drag deltas are scale-independent;
  - move changes x/y only; each corner resize keeps the opposite corner; minimum and stage bounds hold; a click is a no-op;
  - applying an edit keeps id, kind, order, text, style and LibraryFile; Template Scenes are never mutated;
  - save/reload is exact and the renderer payload gets the same box, with no editor or tool data in the save body;
  - Template segments, timing and root items are unchanged;
  - overlay: only the free Scene under the playhead gets targets, keyed by stable ids in paint order; handles appear only on the selected element; hidden elements have no target; no chrome over Template Scenes; the overlay never enters the Player, render or worker files.
- `static-parity.test.ts` now states that Video applies the same shared pan handlers in its Mão tool.
- **Full suite:** 97 files / 1295 tests. `tsc --noEmit` clean. ESLint 0 errors on changed files. `pnpm build` success.

## 11. Limitations

- Corner resize only (no edge handles); no rotation, aspect-lock, snapping, guides, multi-select, nudge, or undo/redo beyond "Voltar ao salvo".
- Only the free Scene under the playhead is editable on the Player; other free Scenes are edited after moving the playhead or through the Inspector.
- Handles are 12 px squares; on very small Fit scales, small elements are easier to edit through the Inspector % fields.
- Text never auto-fits after resizing; overflow stays clipped at the box.

## 12. Final checkpoint

- Feature `c897b3494d11eee28ae160a32b49d54c734ed505` → Vercel `6683541906` success.
- Final SHA: the docs commit recording this validation (recorded by the next mission's housekeeping).
- Housekeeping done here: `VIDEO_FREE_SCENE_COMPOSITION_V1.md` now prints its closure SHA `b9e083060d88540f05774bc03374c3828c520654`.
- Production test data left: draft `da9b61ce…` (manipulated state saved) and execution `0e1d5a5a…`.
- Not committed: `.env.local`, `.next/`, `tsbuildinfo`, `infra/render-worker-runtime/dist/`, `.tmp/`, scratch files and downloaded MP4s.
