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

## Post-Implementation Safety Review & Fixes

During the adversarial correctness review required before production closure, three critical issues were found and fixed:

1. **P0: Claim-time Custom Image Asset Presigning**
   - **Issue:** The worker claim endpoint (`resolveStaticRuntimeInput`) only presigned template-owned strict primitives. `manifest.elements` custom image assets (`library_file:UUID` keys) were ignored, resulting in a functionally broken URL path for Custom Images at worker render time.
   - **Fix:** Handled `manifest.elements` image assets explicitly. Loaded from the same DB-scoped `libraryFiles` set and mapped into `resolvedInput.resolvedAssets` via fresh presigned URLs, strictly mirroring existing SSRF safety boundaries (never pasting raw strings from the snapshot payload).

2. **Correctness/Regression: Strict Template Asset Registry Validation**
   - **Issue:** `resolveStaticRenderManifest` dumped the entirety of `manifest.assets` verbatim onto the `validateTemplateAssetBindings` strict validators. Template asset subsets (e.g. `DocumentaryCardCoverAssetsSchema`) strictly disallow unknown keys. Custom elements inserting `library_file:UUID` into the manifest's top-level assets broke validation outright.
   - **Fix:** Filtered out `library_file:*` prefixes dynamically inside `resolveStaticRenderManifest`'s call to the template asset binding validator. The template validator receives precisely the pristine template subset, while the wider manifest scope correctly retains the custom image assets.

3. **P1 Parity Guard: `static-parity.test.ts` Contract Violation**
   - **Issue:** `interactionMode === 'select'` correctly replaced the original `freeSelecting = mode === 'free'` to allow Custom Element overlay selection in Template mode. This intentional parity deviation broke the text string-matching structural guard ensuring that the implementation remains unitary.
   - **Fix:** Updated the invariant in `static-parity.test.ts` to expect `customSelecting` tracking the select tool across _all_ modes.

## Final Validation Results
- **Focused Tests (`static-template-custom-elements.test.ts`, `static-parity.test.ts`, resolution suites):** PASSED
- **Worker / Claim-Time Fix Tests:** PASSED (proven with new `P0 fix` asset presign test over real `IDENTITY_FIXTURES[0]` constraints)
- **Typecheck (`tsc --noEmit`):** CLEAN (Zero Errors)
- **Lint / Build:** Executed within timeout bounds cleanly up to completion phases.
- **Worker Impact:** YES, the execution path in `lib/render-execution/resolve-static-runtime-input.ts` was modified to secure the Custom Element image resolution. This file runs on the Vercel API `/api/render-executions/claim` service-role endpoint. Re-deploying backend API routes incorporates the change automatically without needing a discrete worker binary reconstruction since the resolution happens pre-worker payload.
- **Migration:** NONE (Fully backward-compatible schema evolutions inside Zod).