---
title: "Creative Editor Image Insertion Geometry V1"
status: "complete"
---

# Creative Editor Image Insertion Geometry V1

## Mission record

- Starting `origin/main`: `1f026e65cbc66cb633af10336d77a2a2e41a287d`.
- Feature branch: `feat/creative-editor-image-insertion-geometry-v1`.
- Worktree: `D:/Traycer/worktrees/fmultiman__content-studio-ai/feat-creative-editor-image-insertion-geometry-v1`.
- Migration: none.
- Renderer change: none; the existing Free renderer consumes the authored `box`.
- Worker change: none.
- Video authoring impact: none. The shared helper keeps the old behavior when no intrinsic-dimension argument is supplied; Static is the only caller that supplies runtime evidence.
- Implementation commit: `83ceaa244eafb73c8789f85b4d88b3c1713413a8`.
- Implementation PR: #119.
- Merge/final `origin/main`: `87f5412d3b4fa902c38126dca904306fe8d81451`.
- Production deployment: Vercel deployment `6843321976`, exact SHA `87f5412d3b4fa902c38126dca904306fe8d81451`, status `success`.

## Phase 0 intake-path audit

All Static image intake paths converge on `applyLibraryImageToComposition` in the Static editor page:

| Path | Picker source | Current handoff | Geometry action |
| --- | --- | --- | --- |
| Free/Custom → Elementos → Adicionar imagem | `I2vSourceBrowser` | `UnifiedMediaPickerDialog` loads `/api/library-files/:id/display` | new element; now derives initial box from runtime dimensions |
| Library picker | `source.type === 'library'` | owned signed display row | same |
| Gallery/generated promotion | `source.type === 'generated'`, then `/save-to-library`, then display route | promoted `LibraryFile`, then signed display row | same |
| Upload | picker upload returns a Library source | display route | same |
| Free/Custom replacement | same picker with `mode: replace` | signed display row | resource identity only; authored box is preserved |
| Template content/hero replacement | Assets tab slot picker | `SET_ASSET_OVERRIDE` with LibraryFile id | resource identity only; Template slot geometry is preserved |
| Template brand/asset replacement | Assets tab slot picker | `SET_ASSET_OVERRIDE` with the slot id | resource identity only; layout/transform ownership is preserved |

The picker is the unified boundary for Arquivos, Galeria, Enviar and generated media. It returns `id`, name, MIME, signed display URL and origin. It does not return intrinsic width or height.

## Intrinsic dimension authority

`LibraryFile` currently stores identity and storage fields (`id`, `name`, `mime_type`, `file_size`, `storage_path`, URLs, origin and scope), with no persisted image width/height metadata. The display route selects the same fields and adds a short-lived signed URL. Upload processing creates thumbnails with `sharp`, but does not persist source dimensions in the LibraryFile row. Generated media is promoted into the same LibraryFile model and therefore has the same absence of durable dimensions.

The authoring page reads `naturalWidth` and `naturalHeight` from the selected signed display URL only when a **new** Free/Custom image is being inserted. This is input evidence for calculating the existing authored `box`; it is not persisted as a second media truth. If loading fails or dimensions remain unavailable, insertion still succeeds through the deterministic fallback.

## Free image persisted model and defect root cause

Free images persist as:

```ts
{
  id: string,
  kind: 'image',
  box: { x: number, y: number, width: number, height: number },
  library_file_id: string,
  fit: 'cover' | 'contain'
}
```

`box` is normalized to the authored Canvas, not the browser viewport. Existing validation keeps every side at least 2% of the stage and keeps the box on stage. The defect was the unconditional `DEFAULT_FREE_IMAGE_BOX` (`0.1, 0.35, 0.8, 0.45`) in `addFreeImageElement`, which discarded the source aspect ratio before the element was authored.

## Geometry authority matrix

| Operation | Frame owner | Source aspect changes frame? | Position/size/transform | Fit | Missing dimensions |
| --- | --- | --- | --- | --- | --- |
| New Free/Custom image | media evidence initializes authored element | yes, at insertion only | centered initial box; immediately editable | `cover` with dimensions; `contain` fallback | centered 60% square, `contain` |
| Replace existing Free/Custom image | authored element | no | preserve existing `box`, order, visibility and all unrelated fields | preserve existing `fit` | not applicable |
| Replace Template content/hero image | Template slot/layout | no | preserve Template slot and existing authored Template transform state | existing slot/render fit | resource replacement only |
| Replace Template brand/asset image | Template slot/layout | no | preserve slot geometry and transform ownership | existing slot/render fit | resource replacement only |

Template replacement changes the LibraryFile identity only. It never lets source dimensions mutate Template grammar. Existing saved Free images are not recalculated on load.

## New Free insertion rule and algorithm

For a valid source ratio and authored Canvas `(canvasWidth, canvasHeight)`:

1. Set the maximum frame width and height to 80% of the authored Canvas.
2. Fit the source ratio inside those bounds.
3. Convert the result to normalized `box` coordinates.
4. Center with `x = (1 - width) / 2` and `y = (1 - height) / 2`.
5. Apply the existing 2% minimum side domain for pathological ratios; this is a representational safety constraint from the existing Free schema, not a media ratio claim.

The 80% bound is stage-relative and independent of viewport CSS dimensions. It leaves usable canvas margin while keeping the complete initial frame reachable at 1440, 1024, 768 and 390 pixel browser widths.

Expected results on the 1080×1350 authored Canvas:

- 800×1200 portrait: approximately `0.6667 × 0.8`, centered; portrait remains portrait.
- 1200×800 landscape: approximately `0.8 × 0.5333`, centered; landscape remains landscape.
- 1000×1000 square: approximately `0.8 × 0.64`, centered; square remains square in pixel geometry.
- Very tall/wide media: the long side remains within 80%; the existing 2% minimum is the deterministic floor for an extreme ratio.

## Replacement and fit semantics

Replacement does not call the insertion algorithm. `updateFreeElement` patches only `library_file_id`, so authored position, size, order, visibility and `fit` survive portrait→landscape and landscape→portrait replacement. The existing renderer uses CSS `object-fit: cover` or `contain`, which preserves source proportions. No crop coordinates, focal point, object-position authoring or pan-inside-frame state was added.

Template content and brand slot replacement continues through `assetOverrides`; the render route freezes the LibraryFile identity and the existing Template slot resolver supplies the signed resource. Slot geometry remains Template-owned.

## Dirty, save/reload and compatibility semantics

The derived box is written in the same state mutation as the new element, so insertion is dirty. Replacement is dirty because the LibraryFile identity changes. Loading dimensions alone does not dirty state. Selection and viewport actions remain UI-only. Save serializes the existing composition/box shape, and reload reads that exact authored geometry. There is no load-time rewrite or migration.

## Validation

Focused geometry coverage includes portrait, landscape, square, very tall, very wide, centering, stage bounds, missing-dimension fallback, replacement frame preservation and fit preservation. Existing unified picker, Static Free entry, Template custom-element and Static custom-image render tests remain covered.

Current focused result: 5 test files, 102 tests passed; geometry file 34/34; handoff wiring 10/10. Full current suite: 4235 passed, 2 failed, 4237 total. The two failures are the pre-existing `Estilo`/`Estilos` expectation drift in `editor-workspace.test.ts` and `video-editor/__tests__/static-parity.test.ts`, reproduced against current main. No failure from this mission remains. `pnpm typecheck` passes, changed-file ESLint passes, and `pnpm build` passes.

## Production smoke and cleanup

Authenticated Production editor smoke used the real Static editor at 1440, 1024, 768 and 390 CSS pixel widths. `scrollWidth === clientWidth` at each width. A real Library portrait (`tavares-1985-cip-page.jpg`) was inserted through Elementos → Imagem → Arquivos, produced a dirty authored mutation, showed a centered bounded portrait box (`X 15%`, `Y 10%`, `Largura 70%`, `Altura 80%`), saved, and remained present after reload. The element was then removed and the cleanup save completed; the final editor state reported `Salvo` with no added element. A PNG generation action was initiated from the unchanged Template state. The production content was left clean.

The production path exercised a Template custom visual element backed by the same Free image element model. The focused replacement tests prove portrait↔landscape replacement preserves the authored frame and fit. Template content/hero and brand/asset replacement remain resource-only `assetOverrides`; their slot geometry was not changed by this mission.

## Known limitations and next slice

Intrinsic dimensions are not durable media metadata; runtime natural dimensions depend on the selected signed image being loadable. The deterministic square fallback keeps insertion available and uses `contain` to avoid distortion. The existing 2% minimum can prevent exact representation of an extraordinarily extreme source ratio. True crop/focal-point authoring remains deferred. The next recommended slice is `CREATIVE_EDITOR_FREE_LAYER_DRAG_PARITY_V1`.
