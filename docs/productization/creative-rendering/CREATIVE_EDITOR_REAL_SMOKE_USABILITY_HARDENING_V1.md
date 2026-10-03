# CREATIVE_EDITOR_REAL_SMOKE_USABILITY_HARDENING_V1

## Mission Scope
This mission completes the usability follow-ups identified during the real human Production smoke pass for the Static Creative Editor. It addresses workflow friction around layer visibility, asset provenance transparency, Add Element accessibility, and Inspector nomenclature. 

## Git Context & Routing
- **Canonical Static worktree:** `D:/Traycer/worktrees/fmultiman__content-studio-ai/traycer-witty-puma-23e2b43ebdbe`
- **Initial pwd checked:** Yes. 
- **Starting origin/main SHA:** `12fd3695c615c9ff84068de0f3941dc869e1880c`
- **Parallel merges observed:** No new commits detected between the start and branch creation (`git fetch origin --prune`). 
- **Branch:** `feat/creative-editor-real-smoke-usability-hardening-v1`

## Audit Findings
- **Elementos Tabs:** Defined primarily in `TemplateElementsTab` and mapped over `INSPECTOR_SECTIONS` which lives in `editor-workspace.ts`.
- **Anatomy & Camadas rows:** Both render through `ElementLayers`. Anatomy uses sections with an inner tree list, whereas Camadas uses `ElementLayers` with `orderOnly={true}`.
- **Visibility state:** Driven by `AuthoringState` hidden items set. Dispached via `TOGGLE_ELEMENT_VISIBILITY`. Anatomy already had an eye icon dispatching this action.
- **Reorder mechanism:** `ElementLayers` manages its own pointer/drag state via the grip handle; it executes via `onReorder` dispatch.
- **Selection:** Handled by `selectedTarget`. Since `TemplateElementPanel` works entirely off the element id passed to it, switching between Anatomy and Camadas preserves context precisely.
- **Resource resolution:** Built-in `resolveSlotResource` (in `asset-slots.ts`) can produce a truthful derived `SlotResource` encompassing origin (`project`, `template`, `generated`) and display name.
- **Free mode & Add Element:** Uses `FreeSceneElements` component which renders text/image addition actions near the top but could scroll out of view.

## Implementation Details

### Camadas Visibility (Finding A)
- Extended `element-layers.tsx` to preserve the `data-layer-eye` button even when `orderOnly={true}`.
- Wired `onToggleVisibility` downward from `TemplateElementsTab` into the `ElementLayers` invocation for Camadas.
- **Proof of reuse:** The exact same `onToggleVisibility` callback is used by both the Anatomy loop and the Camadas `ElementLayers` instance. Clicking the eye immediately updates the singular `hiddenElements` set in `AuthoringState`, reflecting simultaneously on the Canvas, Anatomy tab, and Camadas tab. Visibility edits never trigger dragging or array reordering.

### Asset Provenance (Finding B)
- **Architecture:** Leveraged existing `resolveSlotResource` logic directly in `editar-visual/page.tsx` utilizing `projectImages` and `context?.primitives`.
- **Panel Enhancement:** Modified `TemplateElementPanel` to accept an optional `resource: SlotResource`. Added a compact footer beneath element constraints explicitly detailing "Recurso usado", its name, and its factual origin (e.g. `Projeto`, `Template`).
- **Examples:** 
  - A file-backed "Logo da marca" explicitly lists the image name and notes "Origem: Projeto".
  - A procedural Template slice (e.g. Fita da imagem without an asset slot) explicitly states "Recurso: Gerado pelo Template".
  - Text fields intrinsically omit this provenance panel to prevent pretending text has a media asset.
- **N+1 Avoidance:** Display relies entirely on existing in-memory data tables (like `projectImages` map) resolving deterministically.

### "Adicionar elementos" Accessibility (Finding C)
- Elevated `FreeElementAddActions` into a `sticky` container immediately above the `TabsContent` boundary in `TemplateElementsTab`.
- By residing at the root top of the Elementos inspector tab scope, the user can smoothly `Add` an element from either Anatomia or Camadas panes regardless of vertical scroll depth. No global absolute overlays were created over the Canvas.
- **Free-mode effect:** Free mode relies on `FreeSceneElements` directly. The identical sticky wrapping logic was applied to the inline insertion actions there, ensuring scrolling down a long Free stack doesn't bury the element creation tools.
- **Video Shared Component Effect:** Changes natively accommodate Video (as `FreeSceneElements` scales fluidly and avoids intrusive DOM jumps). 

### "Estilo" → "Estilos" Rename (Finding D)
- Edited precisely the `label` and `compactLabel` exports for the `'style'` slice globally in both `editor-workspace.ts` and `video-workspace.ts`. Tab UI immediately reflects "ESTILOS". 

## Validation
- **Focused tests:** Ran suite for elements testing across Static.
- **Full Vitest:** Passed cleanly (`npx vitest run`).
- **Types / Lint:** `pnpm tsc --noEmit` and `pnpm lint` passed (no strict errors).
- **Manual UI Smoke:**
  - Selecting "Cover" layout -> Elementos panel -> Anatomy
  - Verify "Texto / Imagem" explicitly stick to the top boundary.
  - Expanding Imagem principal identifies actual template asset source or overridden library file name gracefully.
  - Toggling Camadas reveals matching eye toggles exactly aligned with anatomy state.

## Impact Expectation
- **Migration:** NONE
- **Renderer:** NONE
- **Worker:** NONE
This branch consists entirely of non-destructive Editor UI derived data read operations and accessibility layout tuning.

## Deferred Items
1. Internal label "Anatomia" remains untouched.
2. WebP/GIF picker support remains unresolved.