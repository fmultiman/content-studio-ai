# CREATIVE_EDITOR_FREE_LAYER_DRAG_PARITY_V1

Status: complete and merged to Production.

## Closure identity

- Starting origin/main: a4c0d740c6d50d7bf5c45e400cb433bd67ce7bab.
- Feature worktree: D:/Traycer/worktrees/fmultiman__content-studio-ai/feat-creative-editor-free-layer-drag-parity-v1.
- Feature branch: feat/creative-editor-free-layer-drag-parity-v1.
- Implementation commit: 557dfff.
- Implementation PR: #121 (https://github.com/fmultiman/content-studio-ai/pull/121).
- Implementation merge / Production commit: 03eb908af8d38b61192b6b12f95c4cc7ae332a99.
- Production deployment: Vercel deployment 6844594176, commit 03eb908af8d38b61192b6b12f95c4cc7ae332a99.
- Documentation closure is this commit; the final docs PR and merge SHA are reported with the mission closure.
- The protected historical checkout was not used or modified.

## Phase 0 audit

### Free/Custom ordering authority

Static Free mode persists the existing composition.elements array in FreeSceneComposition, back-to-front. Template mode persists user-added overlays in the existing AuthoringState.elements field and derives the same Free composition for that overlay. Element ids remain stable and stay attached to the complete element payload.

The legacy Trazer para frente and Enviar para trás controls call moveFreeElement. That helper swaps one element with its immediate neighbour inside the Free array. Its domain is Free elements only; it never reaches Template-owned elements.

FreeStage and deriveFreeSegment consume the same array. The renderer assigns increasing local z-index values while traversing back-to-front, so the last Free array item is visually front-most. Camadas reverses the array for display, making the top row front and the bottom row back.

### Template Camadas authority

Template layers use the existing persisted AuthoringState.elementOrder, normalized by resolveElementStack and saved through the existing reducer/state path. The order is also back-to-front. ElementLayers displays the reverse, with front at the top. moveElementInOrder moves an item to a valid position in that same order.

The proven Template interaction is pointer-event based: the grip captures the pointer, live row rectangles determine the target, movement previews the displayed order, and only a changed drop calls onReorder. The grip also supports ArrowUp/ArrowDown. Eye, row disclosure, and panel controls stop their own events. Anatomy remains derived semantic structure and is not reorderable.

### Compatibility matrix

| Surface | Persisted authority | Valid reorder domain | Display order | Boundary |
| --- | --- | --- | --- | --- |
| Template Camadas | elementOrder | Template-owned stack | front -> back | Template grammar remains protected |
| Static Free/Custom | existing Free elements array | Free elements only | front -> back | Custom overlays remain above Template |
| Video Free Scene | existing Free composition.elements array | unchanged | front -> back | Video UI unchanged |
| Anatomy | derived Template sections | none | semantic structure | never reorderable |

The domains are compatible in interaction shape but remain separate in persisted state. A Free drag cannot enter the Template stack, reorder Anatomy, or alter protected Template order.

## Implemented behavior

useLayerDrag in components/creative/authoring/element-layers.tsx now contains the existing Template pointer/keyboard interaction and is reused by Static Free rows. FreeSceneElements accepts an explicit reorderable flag. Static entry points pass it; Video does not.

When enabled, each Free row is ordered as:

1. drag grip;
2. visibility eye;
3. element label/disclosure;
4. remove action.

The normal Static Free/Custom Camadas UI removes the duplicate +/-1 arrows because the grip and keyboard arrows provide the same capability. Video retains its arrows because Video is out of scope.

The drop calls reorderFreeElements, which validates the existing element-id set and returns the existing payloads in the requested order. A no-op or invalid order returns the original scene. Geometry, rotation, opacity, visibility, text, fit, and asset identity are not rewritten.

The eye stops pointer propagation and toggles visibility only. The grip stops propagation and starts reorder only. Row disclosure remains selection/open behavior. Remove remains removal only. Dragging does not call onOpen, so the selected element identity remains coherent.

## Dirty, save, reload, and render parity

Pointer down, movement, live preview, cancellation, and a drop in the original position do not call the authored onEdit path. A successful changed drop calls that path once. Existing save, revert, and reload state flow persists the same elements array. Existing saved elements are not recalculated or migrated on load.

Preview and final Static rendering consume the resulting array. Focused render-projection tests prove the top Camadas row is front-most. A real Production PNG was generated after the clean-state smoke and reached PNG pronto for slide 1 of 10, with the editor still reporting Salvo.

## Accessibility and input status

The reused grip has an accessible label/title and supports ArrowUp/ArrowDown as the Template control does. The eye retains its pressed state and show/hide label. Pointer capture plus touch-none supports pointer and touch-capable browsers without HTML5 drag-and-drop. No keyboard-shortcut framework or generalized DnD rewrite was introduced.

## Validation

- Focused layer, Free panel, Template panel, Static custom-element, render-projection, image-geometry, and numeric-policy tests: 194 passed in 11 files.
- Full pnpm test: 4,238 passed, 2 failed, 4,240 total. The two failures are unchanged baseline Estilo/Estilos expectation drift in lib/creative/authoring/__tests__/editor-workspace.test.ts and lib/creative/video-editor/__tests__/static-parity.test.ts; both paths are unchanged from current main.
- pnpm typecheck: passed.
- pnpm exec tsc --noEmit: passed.
- ESLint on all changed/versioned implementation, test, and page files: passed.
- pnpm build: passed; Next.js generated 54 static pages.
- git diff --check: passed.

The focused run also covers Template Camadas drag, selection/visibility isolation, Anatomy-vs-Camadas separation, Add Text/Add Image paths, Image Insertion Geometry, Numeric Range behavior, Template switching/reset, and render order.

## Production smoke

Authenticated Static Editor smoke used the canonical Production editor with temporary overlapping Free text elements A and B.

- Initial Camadas order was A above B.
- Dragging the selected A grip across B changed the list to B above A; selection stayed on A.
- Toggling the B eye changed it to hidden and did not initiate a drag.
- Save reported Salvo.
- Reload restored B above A, with B hidden and A visible.
- The temporary Free elements were removed by restoring Template mode.
- Cleanup was saved and reloaded as Template with no test elements, ten slides, disabled Save/Revert controls, and Salvo.
- A final PNG render reached PNG pronto without changing authored state.

The pre-smoke canonical text content was not available as a separate versioned snapshot because the authoring endpoint is overwrite-only. Cleanup restored a clean Template composition and ten-slide sequence; the current saved state is the authority and contains no temporary smoke elements.

## Responsive smoke

Read-only viewport checks used the authenticated editor at 1440, 1024, 768, and 390 CSS pixels. Each measured document.documentElement.scrollWidth === window.innerWidth and document.body.scrollWidth === window.innerWidth; no page-level horizontal overflow was observed. At 390, the Canvas, Slides controls, Adicionar slide, zoom controls, Template Inspector tabs, and layer-independent Inspector controls remained reachable in the accessibility tree. The viewport override was reset after the checks.

## Scope and impact

- Migration: none.
- New persisted field/order entity: none.
- Renderer source change: none; existing renderers consume the reordered authored array.
- Worker change or redeploy: none.
- Video impact: none; Video keeps the legacy arrow UI and behavior.
- Anatomy reorder: none.
- Template cross-boundary reorder: none.

Known limitations are the existing baseline label-drift failures, the lack of a new keyboard shortcut framework beyond the reused ArrowUp/ArrowDown path, and pointer/touch behavior being limited to the existing browser pointer implementation. Crop/focal-point, grouping, nesting, arbitrary z-index, Undo/Redo, Video Timeline, and Inspector shell redesign remain out of scope.

Recommended next slice: CREATIVE_EDITOR_INSPECTOR_ELEMENTS_SHELL_V1.

CREATIVE_EDITOR_FREE_LAYER_DRAG_PARITY_V1_COMPLETE
