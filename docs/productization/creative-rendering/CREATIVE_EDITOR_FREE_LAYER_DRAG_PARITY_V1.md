# CREATIVE_EDITOR_FREE_LAYER_DRAG_PARITY_V1

Status: implementation complete on the feature branch; production closure is recorded below after merge and smoke.

## Starting point and scope

- Starting `origin/main`: `a4c0d740c6d50d7bf5c45e400cb433bd67ce7bab`.
- Feature worktree: `D:/Traycer/worktrees/fmultiman__content-studio-ai/feat-creative-editor-free-layer-drag-parity-v1`.
- Feature branch: `feat/creative-editor-free-layer-drag-parity-v1`.
- Implementation commit: `557dfff` (`feat(creative-editor): add free layer drag parity`).
- The protected historical checkout was not used.
- Scope is Static Creative Editor Free/Custom layer interaction. Video Scene reorder remains unchanged.

This slice changes the interaction language only. It does not create a new ordering model, z-index field, grouping model, cross-boundary capability, or DnD architecture.

## Phase 0 audit

### Free/Custom ordering authority

Free order is the existing `composition.elements` array in `FreeSceneComposition`, stored back-to-front. Static Free mode uses this composition on the current Free slide. Template mode stores user-added overlay elements in the existing `AuthoringState.elements` field and derives the same Free composition for the overlay. Element ids are stable and remain attached to their complete element payload.

The legacy `Trazer para frente` and `Enviar para trás` buttons call `moveFreeElement`. That helper swaps one element with its immediate neighbour in the Free array. The domain is the Free array only; it never reaches Template-owned elements.

`FreeStage` and `deriveFreeSegment` consume the same array order. The renderer assigns increasing local z-index values while traversing back-to-front, so the last Free array item is visually front-most. The list reverses this array, therefore the top row is front and the bottom row is back.

### Template Camadas authority

Template layers use the existing persisted `AuthoringState.elementOrder` field, normalized by `resolveElementStack` and persisted through the existing reducer/save/render request path. The order is also back-to-front. `ElementLayers` displays the reverse, with front at the top. `moveElementInOrder` moves an item to a valid position in this same order.

The existing Template drag primitive is pointer-event based: the grip captures the pointer, live row rectangles determine the drop target, movement previews the displayed order, and only a changed drop calls `onReorder`. The grip also supports ArrowUp/ArrowDown. Eye, row disclosure, and panel controls stop their own events. Anatomy remains derived structure and is not reorderable.

### Shared media/renderer boundary

No renderer-facing source was changed. No worker source was changed and no worker deployment is required. The existing Static Preview and final render already consume the authored Free array order. No database migration or new persisted field is required.

## Geometry/order ownership matrix

| Surface | Persisted authority | Valid reorder domain | Display order | Template boundary |
| --- | --- | --- | --- | --- |
| Template Camadas | `elementOrder` | Template-owned stack | front → back | protected by Template grammar/normalization |
| Static Free/Custom | existing Free `elements` array | Free elements only | front → back | Custom overlays remain above Template |
| Video Free Scene | existing Free `composition.elements` array | Free elements only | front → back | unchanged in this mission |
| Anatomy | derived Template sections | none | semantic structure | never reorderable |

The two reorder domains are compatible in interaction shape and deliberately remain separate in persisted state. A Free drag cannot enter the Template stack, reorder Anatomy, or alter Template-owned order.

## Implemented behavior

`useLayerDrag` in `components/creative/authoring/element-layers.tsx` now contains the proven Template pointer/keyboard interaction and is reused by Static Free rows. `FreeSceneElements` accepts an explicit `reorderable` flag. Static entry points pass the flag; Video does not.

When enabled, a Free row is ordered:

1. drag grip;
2. visibility eye;
3. element label/disclosure;
4. remove action.

The normal Static Free/Custom UI removes the duplicate +/-1 arrows because the grip and keyboard arrows provide the same authoring capability. Video retains its existing arrows because Video is out of scope.

The drop calls `reorderFreeElements`, which validates the same element-id set and returns the existing Free payloads in the requested order. A no-op returns the original host. Geometry, rotation-equivalent element payload fields, opacity-equivalent fields, visibility, text, fit, and asset identity are not rewritten.

The eye stops pointer propagation and toggles visibility only. The grip stops propagation and starts reorder only. Row disclosure remains selection/open-state behavior. Remove remains removal only. Dragging does not call `onOpen`, so the existing selected element identity stays coherent.

## Dirty, save, reload, and render parity

Pointer down, pointer movement, live preview, cancellation, and a drop in the original position do not call the authored `onEdit` path. A successful changed drop calls that path once. The host then uses the existing Static save/revert state flow. The resulting existing `elements` array is what persistence, Preview, and the final Static render consume. Loading does not recalculate or migrate any existing order.

## Accessibility and input status

The reused grip has an accessible label and title and supports ArrowUp/ArrowDown as the existing Template control does. The eye has its existing pressed state and accessible show/hide label. Pointer capture plus `touch-none` supports mouse and pointer/touch input without HTML5 drag-and-drop. No keyboard-shortcut framework or generalized DnD rewrite was introduced.

## Focused validation

The focused layer, Free panel, Template panel, Static custom-element, render-projection, geometry, and numeric-policy run passed: 194 tests in 11 files. The full current suite finished with 4,238 passing tests and 2 failing tests out of 4,240. Both failures are the existing `Estilo` versus `Estilos` expectation drift in `lib/creative/authoring/__tests__/editor-workspace.test.ts` and `lib/creative/video-editor/__tests__/static-parity.test.ts`; neither file is changed by this branch and `git diff --quiet origin/main` confirms both are unchanged from current main.

New coverage verifies:

- multi-element Free reorder and front/back direction;
- existing payload preservation and invalid-order rejection;
- no-op drop does not edit;
- eye action remains independent;
- arrows disappear only in Static reorderable mode;
- existing Template drag, keyboard, scroll-targeting, disclosure, and eye behavior remain passing;
- existing Free image geometry and render order remain passing;
- `pnpm typecheck` passes;
- ESLint passes for all changed/versioned source and test files;
- `pnpm build` passes (Next.js production build, 54 static pages generated).

The current Production deployment before this feature is `a4c0d740c6d50d7bf5c45e400cb433bd67ce7bab` (GitHub deployment `6843605588`). Authenticated Production smoke and final render evidence are appended after the merged feature deployment.

## Known limitations and next slice

This does not add arbitrary z-index authoring, cross-boundary ordering, grouping, nesting, Anatomy reorder, Video parity, crop/focal-point behavior, or undo/redo. The next queued slice remains `CREATIVE_EDITOR_INSPECTOR_ELEMENTS_SHELL_V1` after the separate Free layer drag parity closure.
