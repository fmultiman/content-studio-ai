# STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1

## Context and Goal
This bounded mission introduces Custom Elements (Text and Image) into static Template-backed compositions. It evolves the architecture safely and additively over the previous factual anatomy audit. Elements added via the authoring interface are drawn spatially mapped on a Custom Free layer *above* the static Template background base.

- **Starting SHA:** 43b8e91df0f0d991bb655f22bc3516e5da4b8c3e
- **Audit Authority:** `STATIC_TEMPLATE_ANATOMY_AND_COMPOUND_ELEMENTS_AUDIT_V1`

## Implementation Details

### Exact Persistence Shape Chosen
The smallest backward-compatible additive evolution. Added the `elements` field to `PersistedAuthoredSlideSchema` matching precisely the `FreeSceneElement[]` contract used natively by Free slides (`elements: z.custom<FreeSceneComposition['elements']>(...).optional()`). Backwards compatibility guarantees are enforced: slides previously authored default effectively to empty layers, leaving behavior fully untouched.

### Compatibility Behavior
- Template slides load inherently fine without custom elements. Non-existent elements equate to an empty array.
- Existing Free compositions are completely decoupled and preserve their independent parsing routines.

### Paint-order Rule
Overlay. Custom elements render in a deterministic sequential Free array completely *above* the pre-defined back-to-front static template geometry queue. Re-inventing `element_order` or z-indexing generic scenes inside the template compound elements was deferred. 

### Render Proof
The generic renderer function (`deriveManifestFromState` / `resolvePreviewInput`) extracts `.elements` natively and computes the `FreeSegmentPayloadSchema`, merging both custom UI Text overlays and mapping referenced Library Files (`type: image`) right onto `.assets` of the actual `StaticRenderManifest`. Native template content is kept.

### UI / Element Surface
- Reused `<FreeSceneElements />` explicitly for managing adding text (`addFreeTextElement`), choosing images (`ProjectLibraryAssetPicker` -> `addFreeImageElement`), and adjusting visual properties (font styles and align) in real-time.
- Included alongside standard `TemplateAnatomy` and `Camadas` structure under the "Aba Elementos".

### Project Identity Behavior
Shared tokens apply dynamically via identical context hooks previously authored for Free slides. No persistent modifications or reworks were applied to `VisualTokensSnapshot`.

## Regression
- **Free regression:** Evaluated extensively. Code routines like `freeUnitElements` intelligently separate context depending strictly on current author mode.
- **Video regression:** Entirely shielded. The additive parameters bypass `.timeline` or `.motion` objects entirely, protecting asynchronous renderer adapters.
- **Worker Impact:** NONE (Renderer schemas parse independent elements lists cleanly. New output simply builds above previous layer sets).
- **Migration:** NONE

## Next Bounded Tasks
- Font picker previews.
- Custom element crop mode interactions vs raw corner resize.
- Compound layer decomposition of the core static layouts.