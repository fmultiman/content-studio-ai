# CREATIVE_EDITOR_IMAGE_RESIZE_AND_CROP_MODEL_V1

> **Status:** READ-ONLY FACTUAL AUDIT & PRODUCT MODELING  
> **Mission:** CREATIVE_EDITOR_IMAGE_RESIZE_AND_CROP_MODEL_V1  
> **Role:** Creative Editor interaction architect / image-authoring domain reviewer  
> **Baseline:** `605717fa5a1add01096cc8b57b742e1483aa9f31` (merge of PR #91 `CREATIVE_EDITOR_GEOMETRY_CONTROLS_AND_PRECISION_V1`)  
> **Scope:** Static Creative Editor image geometry, frame resize, fit and crop semantics  
> **Code Changes:** NONE (Architectural & interaction audit only)

---

## 1. Executive Summary & Purpose

When a user manipulates an image in the Creative Editor, four distinct concepts can be conflated:

1. **Frame Resize:** Modifying the element's bounding rectangle on stage ($x, y, \text{width}, \text{height}$).
2. **Image Fit:** Defining how the source media is fitted into that frame (`cover` / `contain`).
3. **Crop:** Choosing which specific rectangular sub-region of the source media is visible within the frame.
4. **Source Transform:** Pan, zoom, or rotation of the source image inside the frame aperture.

This audit establishes the **factual current implementation** across all image authoring types in the codebase, resolves the ambiguity, and provides a concrete recommendation for the V1 product model.

### Key Finding

* **True Crop state does NOT exist in the authored schema today.** There is no crop rectangle, no source pan/zoom offset, and no focal point stored in `FreeImageElement` or wire payloads.
* What the editor currently implements is **Frame Resize + Fit (`cover` | `contain`)**.
* Resizing a `cover` image on Canvas **stretches the frame aperture**, while the browser/Remotion scales the media proportionally to fill the box and symmetrically clips excess pixels around center ($50\%\ 50\%$). This acts as an **implicit, centered auto-crop**.
* **Recommendation for V1:** The product should **deliberately remain Model A (Frame Resize + Fit: Preencher / Conter)** with clarified UX language and interaction boundaries. Implementing true crop (Model C) or focal point (Model B) requires schema extensions, renderer modifications in `FreeStage`, worker deployment impact, and a new Canvas interaction mode, which should be treated as a dedicated future enhancement rather than rushed into V1.

---

## 2. Audit of All Image Authoring Types

The codebase contains five distinct image-bearing surfaces. They do **not** share a single universal image type:

| Image Authoring Type | Storage & State Location | Geometry Model | Fit Support | Direct Canvas Manipulation |
|---|---|---|---|---|
| **1. Static Free Image** | `slide.composition.elements` (`FreeImageElement[]`) | Stage fractions ($0..1$): $x, y, w, h$ | `cover` \| `contain` | Yes (move + 4-corner resize) |
| **2. Static Template Custom Image** | `state.elements` (`FreeImageElement[]`) | Stage fractions ($0..1$): $x, y, w, h$ | `cover` \| `contain` | Yes (move + 4-corner resize) |
| **3. Template-Owned Hero Asset** | Template layout definition + `manifest.assets.hero` + `tuning.hero` | Template coordinates ($px$): fixed `PlateGeometry` | Fixed `cover` (hardcoded in static render route) | No (slider tuning only) |
| **4. Video Free Image** | `scene.composition.elements` (`FreeImageElement[]`) | Stage fractions ($0..1$): $x, y, w, h$ | `cover` \| `contain` | Yes (via shared `FreeSceneOverlay`) |
| **5. Video Timeline B-Roll** | `draft.timeline.items` (`TemporalItem<'visual'>`) | Full canvas or scene-bounded media segment | Fixed `cover` in timeline renderer | No (temporal trim/slip only) |

---

## 3. Free & Custom Image State (Factual Schema)

### Authoring Type (`lib/types.ts`)

```typescript
export interface FreeImageElement extends FreeElementBase {
  kind: 'image'
  library_file_id: string
  fit: 'cover' | 'contain'
}

export interface FreeElementBox {
  x: number      // Fraction of stage width (0..1)
  y: number      // Fraction of stage height (0..1)
  width: number  // Fraction of stage width (MIN_FREE_BOX = 0.04 to 1)
  height: number // Fraction of stage height (MIN_FREE_BOX = 0.04 to 1)
}

interface FreeElementBase {
  id: string     // Stable UUID
  box: FreeElementBox
  hidden?: boolean
}
```

### Wire Schema (`lib/schemas/creative/timeline.ts`)

```typescript
export const FreeImageElementPayloadSchema = z
  .object({
    element_id: z.string().trim().min(1).max(64),
    kind: z.literal('image'),
    box: FreeElementBoxSchema,
    asset_ref: RefSchema,
    fit: z.enum(['cover', 'contain']),
  })
  .strict()
```

### Explicit Inventory: What DOES NOT Exist

* ❌ **NO `crop` rectangle** (no `cropX`, `cropY`, `cropWidth`, `cropHeight`, no insets).
* ❌ **NO `sourceOffset`** (no internal horizontal or vertical pan of the image inside the box).
* ❌ **NO `focal_point`** (although `AssetRefSchema` in `primitives.ts` defines an optional `focal_point: { x, y }`, `FreeImageElement` and `FreeImageElementPayloadSchema` do NOT declare or preserve it).
* ❌ **NO `sourceScale` / zoom factor** (image cannot be zoomed independently of the box).
* ❌ **NO `sourceRotation`** (neither box nor image supports rotation in Free/Custom elements).
* ❌ **NO `aspectRatio` metadata or lock** (box can be distorted to any arbitrary width/height ratio; image source aspect ratio is not persisted).
* ❌ **NO clipping mask / shape** (clipping is strictly the rectangular box boundary via CSS `overflow: hidden`).

---

## 4. Current Render Behavior

### Renderer Implementation (`components/creative/free/free-stage.tsx`)

Both the web preview (`page.tsx`), the Remotion still render (`remotion/DocumentaryCardComposition.tsx`), and the Remotion video render (`remotion/timeline/FreeSegment.tsx`) share a single drawing component: `FreeStage`.

```tsx
function boxStyle(element: FreeStageElement, width: number, height: number, zIndex: number): React.CSSProperties {
  const { x, y, width: w, height: h } = element.box
  return {
    position: 'absolute',
    left: x * width,
    top: y * height,
    width: w * width,
    height: h * height,
    overflow: 'hidden',
    zIndex,
  }
}

// Inside FreeStage map:
<div key={element.element_id} style={boxStyle(element, width, height, index + 1)}>
  <ImageComponent
    src={asset.url}
    alt={asset.alt ?? ''}
    style={{
      width: '100%',
      height: '100%',
      objectFit: element.fit, // 'cover' | 'contain'
      display: 'block',
    }}
  />
</div>
```

### Factual Rendering Rules

1. **Frame positioning:** The outer container is strictly an absolute-positioned box: `left = x * canvasWidth`, `top = y * canvasHeight`, `width = w * canvasWidth`, `height = h * canvasHeight`.
2. **Overflow clipping:** The outer box enforces `overflow: 'hidden'`. Any pixels rendered outside this rectangle are clipped.
3. **Inner element:** The image (`<img>` in DOM, `<Img>` in Remotion) has `width: '100%'`, `height: '100%'`, and `objectFit: element.fit`.
4. **Positioning inside frame:** No `object-position` is authored. The browser / Chromium defaults to `50% 50%` (center center).
5. **`fit: 'cover'` behavior:**
   * The source image scales uniformly while maintaining its natural aspect ratio until both width and height fill the frame.
   * If the frame's aspect ratio differs from the image's aspect ratio, the excess image dimension overflows the frame and is clipped symmetrically by `overflow: hidden`.
   * **Result:** Center-weighted auto-crop.
6. **`fit: 'contain'` behavior:**
   * The source image scales uniformly while maintaining its natural aspect ratio until the larger dimension touches the frame edge.
   * The entire image remains visible.
   * Any space not covered by the image within the frame remains empty (transparent).
   * **Result:** Letterboxing / pillarboxing inside the frame, zero clipping.

---

## 5. Current Canvas Interaction

### Direct Manipulation Layer (`components/creative/video/free-scene-overlay.tsx`)

Direct manipulation is managed by `FreeElementsOverlay`, which sits as an independent SVG/HTML overlay above the viewport canvas.

* **Translation (Body drag):**
  * Initiated on pointer down on the element body.
  * Calls `moveFreeBox(start, dx, dy)` (`lib/creative/video-editor/free-manipulation.ts`).
  * Changes `box.x` and `box.y` while keeping `box.width` and `box.height` constant.
  * Image appearance inside the frame is completely unaffected.
* **Resize (Corner handles: `nw`, `ne`, `sw`, `se`):**
  * Initiated on pointer down on a corner grip.
  * Calls `resizeFreeBox(start, handle, dx, dy)`.
  * Moves the dragged corner while keeping the opposite corner anchored.
  * Clamps to stage boundaries and enforces `MIN_FREE_BOX = 0.04`.
  * **Critical observation:** Resizing modifies `box.width` and `box.height` (the **FRAME** rectangle).
  * It does **not** change media scale directly.
  * It does **not** change or distort the source aspect ratio.
  * It allows **arbitrary aspect ratio** (no aspect ratio constraint exists).
* **Visual consequence of resizing:**
  * When `fit === 'cover'`: Dragging handles changes the aperture aspect ratio. The image scales to fill the new aperture and clips more/less along the non-matching axis. The user perceives this as an "expanding/narrowing crop window".
  * When `fit === 'contain'`: Dragging handles changes the bounding frame. The image resizes to remain fully visible within the boundary, expanding or shrinking transparent margins.

---

## 6. Current Inspector Controls

In the Inspector (`components/creative/video/free-scene-panels.tsx` under `ImageFields` & `GeometryFields`):

| Control | UI Element | Bound State Field | Classification |
|---|---|---|---|
| **Arquivo** | Name label + Button "Trocar" | `element.library_file_id` | **ASSET** |
| **Enquadramento** | Radio/Choice ("Preencher" / "Conter") | `element.fit` (`'cover' \| 'contain'`) | **FIT** |
| **Posição e tamanho** | Inputs `X`, `Y`, `Largura`, `Altura` | `element.box.{x, y, width, height}` | **FRAME** |
| **Alinhamento** | Buttons "Centralizar ↔", "Centralizar ↕", "Palco inteiro" | Mutates `element.box` | **FRAME** |

**Classification Summary:**
* **FRAME controls:** $4$ inputs + $3$ shortcuts.
* **FIT controls:** $1$ selector (`cover` vs `contain`).
* **ASSET controls:** $1$ replacement button.
* **CROP controls:** **0 (None).**
* **SOURCE transform controls:** **0 (None).**

---

## 7. Template Hero / Asset Model

Template-owned images (such as Cover Hero, List Hero, Quote Hero) follow a fundamentally different architectural model from Free/Custom images:

1. **Fixed Layout Geometry:** Geometry is not authored as free percentage boxes. It is authored in layout-kit coordinates via `PlateGeometry` (`width`, `height`, `left`, `top`, `rotation`, `padding` in template pixels, scaled by canvas ratio $x()$ and $y()$).
2. **Compound Separation:**
   * `PlateFrame` (`heroFrame` element): procedural photo border with background and drop shadow.
   * `PlateImage` (`hero` element): photo container with clipping overflow.
   * When `heroFrame` is hidden, photo border padding drops from $14\text{px}$ to $0$, and the image occupies the full outer frame.
3. **Hardcoded Fit:**
   * In static authoring render route (`app/api/creative/static-authoring/render/route.ts` line 313), hero asset overrides are hardcoded to `fit: 'cover' as const`.
   * The user cannot change the Hero to `contain` in the UI.
4. **Tuning vs Crop:**
   * The Hero exposes `tuning.hero`: `offsetX`, `offsetY`, `rotation`, `scale` (`HeroTuningControls`).
   * This transform is applied via CSS `transform: translate(...) rotate(...) scale(...)` on `plateStyle` to the **entire plate** (border and photo together).
   * It does **not** pan or zoom the image inside the photo border.
   * It does **not** provide source cropping.
5. **No Direct Manipulation:** Template Hero does not support Canvas dragging or corner handles. All adjustments are made via Inspector sliders.

---

## 8. UX Terminology Decision

To prevent user confusion between frame resizing, fitting, and cropping, the following Portuguese vocabulary is recommended for the product:

| Concept | Technical Term | Recommended Portuguese UI Term | Explanation to Author |
|---|---|---|---|
| **Element Boundary** | Frame / Bounding Box | **Moldura** (ou **Área do elemento**) | O retângulo que o elemento ocupa na lâmina. |
| **Resize** | Frame Resize | **Redimensionar moldura** | Altera a largura e a altura do retângulo na tela. |
| **Fit Mode** | `object-fit` | **Enquadramento** | Como a imagem se comporta dentro da moldura. |
| **Cover** | `object-fit: cover` | **Preencher** | A imagem preenche toda a moldura, mantendo proporções e recortando excessos pelo centro. |
| **Contain** | `object-fit: contain` | **Conter** | A imagem inteira fica visível dentro da moldura, sem cortes (pode deixar sobras transparentes). |
| **Crop** | Crop / Sub-rect | **Recortar** (ou **Ajustar corte**) | *Futuro:* Escolha intencional de qual parte da imagem fica visível dentro da moldura. |
| **Focal Point** | `object-position` | **Ponto de foco** | *Futuro:* Direcionar o alinhamento da imagem (ex.: topo, centro, base). |

*Avoid technical CSS terms like `contain`, `cover`, `object-fit`, or `clipping-path` in user-facing labels.* Current labels **"Preencher"** and **"Conter"** under **"Enquadramento"** are accurate and should be retained.

---

## 9. Product Question: Do We Need Crop in V1?

### Architectural Assessment

True Crop requires persisting how the source media is cropped relative to its frame. This requires at least one of the following state mechanisms:

* **Approach 1 (Normalized Crop Rect):** Storing `crop: { x: number, y: number, width: number, height: number }` (fractions of source image dimensions).
* **Approach 2 (Source Pan & Zoom):** Storing `sourceOffset: { x: number, y: number }` and `sourceScale: number`.
* **Approach 3 (Focal Point):** Storing `focal_point: { x: number, y: number }` (used as CSS `object-position`).

None of these exist in `FreeImageElement` or wire schemas today.

### Consequences of Implementing True Crop Now

1. **Persistence:** Requires expanding `FreeImageElement` (`lib/types.ts`), `FreeImageElementPayloadSchema` (`timeline.ts`), and static authoring schemas (`carousel-state.ts`).
2. **Renderer Impact:** Requires updating `FreeStage` in `components/creative/free/free-stage.tsx` to compute complex nested CSS transforms or SVG clipping paths.
3. **Worker Impact: CRITICAL.** `FreeStage` is copied to the render worker (`infra/render-worker-runtime/export.mjs`). Changing how images render requires rebuilding the Remotion bundle, exporting the runtime, updating the VPS service, and validating worker container parity.
4. **Interaction Complexity:** Requires a dedicated "Crop Mode" on Canvas (e.g. double-click on image to toggle handles from frame-resize to image-pan/zoom), clipping guides, and modal commit actions.
5. **Cross-Medium Impact:** `FreeImageElementPayloadSchema` is shared with Video. Adding crop fields without video renderer support creates divergent capabilities.

### Conclusion

**True crop is NOT required for V1.**  
The current combination of **Frame Resize** + **Enquadramento: Preencher (Cover)** already provides an intuitive, centered auto-crop. When users want a banner-style wide image, they resize the frame to be wide; the image fills it and crops top/bottom. When they want a tall portrait window, they resize the frame to be tall; the image fills it and crops left/right.

For V1, this behavior is sufficient, stable, and requires **zero renderer or worker changes**.

---

## 10. Evaluation of Future Candidate Models

| Criteria | Model A: Frame Resize + Fit (Current V1) | Model B: Frame Resize + Fit + Focal Point | Model C: Frame Resize + Explicit Crop Mode |
|---|---|---|---|
| **Core Concept** | Resize frame box; choose `Preencher` or `Conter` (centered). | Resize frame box; choose fit; set $x,y$ focal point ($0..1$). | Resize frame box; enter Crop mode to pan/zoom source media within aperture. |
| **Authored State Impact** | **None** (`box` + `fit`). | **Additive optional:** `focal_point?: { x: number, y: number }`. | **Additive optional:** `crop?: { x: number, y: number, width: number, height: number }` or `sourceOffset` + `sourceScale`. |
| **UI Complexity** | **Low:** Current `ImageFields` with "Preencher" / "Conter". | **Medium:** 9-point anchor grid or 2D focal point pin in Inspector. | **High:** Double-click on Canvas, mode switcher, dimming mask, inner pan/zoom handles. |
| **Renderer Impact** | **None** (current `FreeStage` unchanged). | **Small:** Add `objectPosition: `${focal.x * 100}% ${focal.y * 100}%`` in `FreeStage`. | **High:** Nested container with negative translate and scale, or SVG mask. |
| **Worker Impact** | **None.** | **Yes** (worker export + VPS restart). | **Yes** (worker export + VPS restart). |
| **Backward Compatibility** | $100\%$ byte-identical. | $100\%$ (missing focal point defaults to $50\%\ 50\%$). | $100\%$ (missing crop defaults to full image). |
| **Cross-Medium Effect** | Identical across Static and Video. | Requires Video `FreeStage` parity. | Requires Video `FreeStage` parity. |
| **User Benefit** | Fast, simple, predictable windowing. | Prevents heads/faces from being cut off in portrait photos. | Pixel-accurate editorial framing (like Figma / Canva). |

---

## 11. Concrete Interaction Examples

### Example 1: Author adds a $3:4$ portrait photo to a $16:9$ wide slide

* **With `Enquadramento: Preencher` (Cover):**
  * The frame is $16:9$. The photo expands until its width covers the frame.
  * The top and bottom of the photo are symmetrically clipped outside the frame.
  * If the author drags the frame's bottom corner handle downward (making the frame taller), less of the top/bottom is clipped.
  * The image aspect ratio is never distorted.
* **With `Enquadramento: Conter` (Contain):**
  * The frame is $16:9$. The photo scales down until its height fits the frame height.
  * The entire photo is visible from top to bottom.
  * Transparent pillarbox margins appear on the left and right sides inside the frame box.
* **What true Crop (future) would add:**
  * If the subject's head is near the top edge of the portrait photo and `Preencher` cuts off the forehead, true Crop (or a Focal Point of Top-Center) would allow the author to slide the image downward within the frame to reveal the head.

---

## 12. Recommendation & Next Implementation Slice

### Recommended Decision for V1

**Maintain Model A (Frame Resize Only + Fit: Preencher / Conter).**

1. **Do not add crop fields to `FreeImageElement`.**
2. **Do not add crop handles or double-click modes to Canvas.**
3. **Keep Inspector UI clean:**
   * Retain `Enquadramento` with options `Preencher` (`cover`) and `Conter` (`contain`).
   * Retain `Posição e tamanho (% do formato)` inside `Precisão` disclosure ($X, Y, \text{Largura}, \text{Altura}$).
   * In a future polish slice, add a subtle explanatory tooltip:  
     *Preencher: ajusta a imagem para cobrir toda a área, mantendo as proporções.*  
     *Conter: mantém a imagem inteira visível dentro da área.*

### Roadmap for Post-V1 (Explicitly Deferred)

1. **Phase 2 (Focal Point / Anchor Alignment):**
   * If users report issues with heads/subjects being cut off by centered `cover`, implement **Model B** (`focal_point: { x, y }`).
   * Minimal schema addition, simple 9-point alignment picker in Inspector (`Top-Left`, `Top`, `Top-Right`, `Center`, etc.), mapped to CSS `object-position`.
2. **Phase 3 (True Canvas Crop Mode):**
   * If pixel-accurate framing is required, implement **Model C** with an explicit "Ajustar corte" button and double-click Canvas entry.
   * Add aspect ratio lock option ($1:1$, $4:5$, $16:9$, Original) to prevent accidental distortion of layout intent.
3. **Image Resize vs Crop in Template Hero:**
   * Keep Template Hero governed by Template design grammar. Do not expose free crop in Template Hero; preserve the designer-crafted plate composition.

---

## 13. Audit Verification Summary

* **Factual Schemas Verified:** `lib/types.ts` (`FreeImageElement`), `lib/schemas/creative/timeline.ts` (`FreeImageElementPayloadSchema`), `lib/schemas/creative/primitives.ts` (`AssetRefSchema`).
* **Renderer Verified:** `components/creative/free/free-stage.tsx` (`FreeStage`), `remotion/timeline/FreeSegment.tsx`, `remotion/DocumentaryCardComposition.tsx`.
* **Interaction Verified:** `components/creative/video/free-scene-overlay.tsx` (`FreeElementsOverlay`), `lib/creative/video-editor/free-manipulation.ts` (`resizeFreeBox`, `moveFreeBox`).
* **Inspector Verified:** `components/creative/video/free-scene-panels.tsx` (`ImageFields`, `GeometryFields`, `PrecisionDisclosure`).
* **Template Hero Verified:** `components/creative/documentary-card/CoverVariant.tsx`, `components/creative/documentary-card/primitives.tsx` (`PlateFrame`, `PlateImage`, `AssetSurface`).
* **Product Code Mutated:** NONE.
* **Migration Impact:** NONE.
* **Renderer Impact:** NONE.
* **Worker Impact:** NONE.
