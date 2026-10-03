# CREATIVE_EDITOR_ELEMENT_CAPABILITY_AND_TRANSFORM_MODEL_V1

## 1. Executive Conclusion
The current Creative Editor architecture implements element manipulation through arbitrary, inconsistent mechanisms rather than a coherent semantic model. A Free Image supports X, Y, Width, Height, and Crop (Fit), but no rotation or opacity. A Template Image (Hero) supports X, Y, Rotation, and Scale, but Scale is strictly clamped to an arbitrary UI range (0.9 to 1.15), making it impossible to satisfy genuine compositional needs. File-backed Template elements (e.g., Logo) may completely lack sizing controls. 

Template definitions correctly declare visual hierarchy, but incorrectly enforce UI manipulation bounds—conflating compositional safety with constrained tooling. 

**Recommendation:** Shift to a domain model where baseline capabilities (X, Y, Size, Opacity, Rotation) are universally supported per element type, slider bounds become soft UX limits rather than strict schema clamps, and asset replacement never traps users within immutable geometry slots.

---

## 2. Factual Current Architecture
- **Composition Modes:** Strictly partitioned into `Free` (JSON arrays bounding percentage-based coordinates) and `Template` (resolved slot geometries from `template-definitions.ts`).
- **Template Identity:** Explicitly typed components with defined `kind` (`'image'`, `'text'`, `'material'`, `'shape'`) and predefined UI capabilities (`control` logic like `transform`, `tuning`, `follows`, `fixed`).
- **State Limits:** Transforms are firmly bounded via `clampTuningValue()` prior to persistence mapping directly to hardcoded slider UI bounds (e.g., Hero scale maxes forcefully at 1.15).
- **Size vs Scale Distinction:**
  - **Template Mode:** Relies entirely on layout-derived `intrinsic box + tuning scale (multiplier)`.
  - **Free Mode:** Relies entirely on percentage-based authored `width/height` bounded inside a Canvas aspect ratio.

---

## 3. Full Capability Matrix

| Element Class (Mode) | Selectable | Vis | X/Y | Size/Scale | Rotation | Opacity | Typography | Fit | Replace | Reorder | Classification / Problem |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Headline/Title** *(Template)* | Yes | Yes | Yes | Yes (Size) | Yes | No | Yes (Line, Font) | N/A | N/A | Yes | **Missing:** Opacity. Scale is decoupled from pure size via `fontSizePx`. |
| **Intro/Source/Kicker** *(Template)* | Yes | Yes | Yes | No | Yes | No | Yes (Font) | N/A | N/A | Yes | **Constraint Gap:** Typography overrides heavily limited per-slot basis. |
| **Hero Image** *(Template)* | Yes | Yes | Yes | Yes (Scale) | Yes | No | N/A | No (Fixed) | Yes | Yes | **Schema Limit:** Scale strictly clamped to 1.15. Fit property missing. |
| **Logo da marca** *(Template)* | Yes | Yes | Yes | **No** | Yes | No | N/A | No (Contain) | Yes | Yes | **Missing:** Size/Scale completely absent from `position/tuning`! |
| **Materials (Tapes/Papers)** *(Tmpl)* | Yes | Yes | Yes | Yes (Scale) | Yes | Yes | N/A | No | Yes | Yes | **Deviation:** The only class sporting Opacity via `primitiveTransforms`. |
| **Shapes / Fixed Lines** *(Tmpl)* | Yes | Yes | No | No | No | No | N/A | N/A | N/A | Yes | **Valid Constraint:** Genuine fixed geometric template boundaries. |
| **Custom Text** *(Free)* | Yes | Yes | Yes | Yes (W/H) | No | No | Yes (All) | N/A | N/A | Yes | **Missing:** Rotation, Opacity natively excluded from Free payload. |
| **Custom Image** *(Free)* | Yes | Yes | Yes | Yes (W/H) | No | No | N/A | Yes | Yes | Yes | **Missing:** Rotation, Opacity natively excluded from Free payload. |

---

## 4. Slider/Range Audit
The editor utilizes range sliders mapping directly to strict schema limits, lacking a standalone numeric input structure.

- **Hero Scale Range:** UI provides `0.9` to `1.15`. This is **NOT merely UI convenience**; it rigorously clamps the authored state entity. Users requiring a 1.5 multiplier are architecturally blocked.
- **Offsets (X/Y):** Clamped precisely to `±120` px. Direct manipulation interfaces or numeric overrides cannot surpass this parameter limit.
- **Opacity/Materials:** Ranges cleanly from `0` to `1` across `primitiveTransforms` channels.

**Slider Model Principle Recommendation:** Sliders should expose the optimal ergonomic "frequent" boundaries locally while permitting schema architectures, rendered bounds, and direct numeric text fields to authorize values crossing beyond the immediate slider constraint limits.

---

## 5. Logo Case Study (Real Smoke Scenario)
Replacing a narrow Brand Signature image with a squarer logo correctly adapted to the `contain` slot. However, because `Logo da marca` uses standard `tuning` without `Scale` implementations natively:
- **Authored geometry:** Bound dynamically to the predefined static layout.
- **Evaluation:** The UI natively stripped sizing modification abilities due to `Tuning` abstraction logic lacking `Scale` for position types.
- **Classification:** **TYPE-SPECIFIC CAPABILITY MISSING**. Logo templates require scale adjustments independent of global brand text configurations.

---

## 6. Opacity Case Study
`Fita da imagem` explicitly renders an Opacity control purely because its `TemplateElementControl` is explicitly classified as `transform`.
Text fields and standard images are routed beneath `tuning`, skipping opacity abstractions regardless of visual logic. 
- **Classification:** **ACCIDENTAL IMPLEMENTATION DRIFT.** Opacity capability should exist universally for overlay visual elements mapped independently to rendering support.

---

## 7. Image Insertion Geometry Audit
Newly inserted images via unified media picker into "Free Composition" invoke `addFreeImageElement()`.
- **Initial State:** Elements inherit the strict predefined `DEFAULT_FREE_IMAGE_BOX: { x: 0.1, y: 0.35, width: 0.8, height: 0.45 }`.
- **Aspect Ratio Disruption:** Metadata bounds (width/height dimensions from library origins) exist inherently in the data payload but are completely ignored upon JSON staging generation. 
- **Recommendation:** Recompute initial instantiation matrices leveraging innate file aspect proportions bound cleanly to a centralized canvas percentage cap, centering proportionally.

---

## 8. Frame/Fit/Crop Interaction Findings
The absence of a standalone focal point or rigid crop framework shifts weight onto `contain`/`cover` fit logic combined directly with bounding box dimension resets.
- Horizontal/Vertical handle stretch triggers aspect break bounding limits relying entirely on intrinsic CSS-mimicking `objectFit`.
- **Conclusion:** While focal targeting remains ideal for heavy editor use, the current model performs smoothly. Crop mode should properly remain *deferred* until `Width/Height` vs `Scale` architecture bridges resolve structurally.

---

## 9. Direct Manipulation Parity
- Free Mode implements robust interactive Canvas manipulation mapping bounds directly to percentages. 
- Template Mode restricts drag interaction heavily to specific layers, ignoring rotation or dimensional scaling entirely via pointer inputs.
- **Conclusion:** Integrating Safe Template Direct Manipulation mapped natively back translated into `tuning` parameters (scaling / X / Y movement constraints) is structurally sound without transforming the architecture fundamentally into Free format.

---

## 10. Free/Custom Reorder Findings
Free Elements execute restructuring sequentially utilizing explicit `moveFreeElement` (+1/-1 array increments), binding purely to Up/Down arrow user operations.
Template Camadas utilizes a Drag handle operating purely on `elementOrder` identifier array maps.
- **Conclusion:** Realigning Free elements to embrace the Camadas `GripVertical` interaction pattern unifies component behavior efficiently while preserving identical backing data transformations.

---

## 11. Inspector Shell UI Hierarchy
The prior usability modification appended "Adicionar elementos" into the core stack by binding directly into `TemplateElementsTab` via sticky headers. Although functional, structurally binding actions atop nested scrolling bounds creates floating disjoint views natively across mobile spans.
- **Model Revision Needed:**
  1. Top-Level Sticky Action Context: (`[ Anatomy | Camadas ] [ + Texto | + Imagem ]`).
  2. Fixed Scroll Context Content: Active Tab Rendering Content explicitly isolated beneath the global toolbars preventing overlap logic glitches natively.

---

## 12. Element Class Model
1. **TEXT:** Visibility, Alignment, Font Size/Line bounds, Color, X/Y.
2. **IMAGE:** Visibility, X/Y, Scale/Size, Opacity, Rotation, Asset Fit, Asset Swap.
3. **PROCEDURAL GRAPHIC:** Visibility, X/Y, Scale, Rotation, Opacity. 
4. **COMPOUND / FIXED ANCHORS:** Pure Visibility, Layer Sequencing.

---

## 13. Can Templates Remove Capabilities?
**NO.** Templates provide structural definitions and semantic constraints default loading definitions (Grammar, Start Boundaries). Once parsed within local `AuthoringState`, any elements exposing visible pixels natively should expose corresponding structural interactions bound universally to their abstract classifications (Text/Image/Graphic) to prevent hidden/arbitrary UX blockades natively.

---

## 14. Gap Classifications summary
- Logo Size Controls missing: **TYPE-SPECIFIC CAPABILITY MISSING**
- Opacity limited strictly to `Transforms`: **ACCIDENTAL IMPLEMENTATION DRIFT**
- Fixed Layout Slider Cap (Scale 1.15): **STATE/SCHEMA LIMITATION**
- Initial Image Aspect Ratio Insertion Break: **UX EXPOSURE PROBLEM**

---

## 15. Recommended Implementation Sequence
- **PHASE 1:** Reconcile property capability interfaces to strip arbitrary exclusions natively expanding `Logo` sizing mechanisms and global overlay `Opacity`. Support structural uniformity between `tuning` vs `transforms`.
- **PHASE 2:** Migrate structural slider limit arrays out of `AuthoringState` enforcing, redefining sliders as purely "comfortable interactive boundaries" paired smoothly with unrestricted numerical override inputs natively passing safe JSON ranges.
- **PHASE 3:** Rewrite insertion array logic matching factual image proportions upon Free Image staging creation limits minimizing squashing defaults natively.
- **PHASE 4:** Standardize layer `Grip` drag logic aligning Free Element ordering directly into the Camadas baseline component layout interaction structure.

---

## 16. Deferred Items
- Explicit crop and focal-point logic remains unprioritized against current `fit` models natively.
- Full Canva style unified Canvas DOM pointer editing across all complex layout bounds.

## 17. Risks of Continuing One-off Fixes
Persisting reactive, narrow UI enhancements continuously stacks overlapping components resulting inherently in fragmented UX logic states rendering structural maintenance exponentially demanding and creating arbitrary learning curves natively for end users navigating separated domain controls randomly restricted.