# VIDEO_FREE_SCENE_COMPOSITION_V1

First real **template-free** authored visual composition in the Content Studio. A Video Scene can now be explicitly free: `{ kind: 'free', elements }`, with free text and Library image elements, stored in the existing Scene JSONB. It renders through its own neutral segment kind in the Live Player and on the VPS, next to Template-backed Scenes and root items in the same VideoDraft.

## 1. Starting checkpoint and decisions

- Start: `56f2b59e33f94ad9604e1eb68c8a0a2c162a63ca` (local = `origin/main` = remote, clean tree).
- Approved decisions from OPTIONAL_TEMPLATE_AND_BLANK_COMPOSITION_SPIKE_V1:
  - **D1:** Blank is Scene-level in Video (implemented: no draft-level binding, no migration).
  - **D2:** Video first; Static stays Template-required (only regression-tested).
  - **D3:** a template-free render payload plus a worker update (implemented: the `free` segment kind and the `FreeSegment` layer).
  - **D4:** stage-fraction geometry and Identity-governed style (implemented).

## 2. Phase 0 audit (executing code)

| Concept | Template Scene today | Free Scene need | Reuse? | New state? | New render contract? |
|---|---|---|---|---|---|
| Scene identity / order | `VideoScene.id`, array order | same | yes | no | no |
| Duration | `duration` (s), frames at 30 fps | same | yes | no | no |
| Motion | `movement` → Template-declared preset drawn by the Template | none truthful (presets are drawn by Template components) | no, static | no | no |
| Composition | optional `composition` without a discriminant; absent = Cover | explicit free structure | shape no, storage yes | `kind: 'free'` variant | — |
| Content | per-layout schema | text belongs to text elements | no | in element | — |
| LibraryFile binding | `library_file_id` → `hero` slot | per image element | identity rule yes | `library_file_id` per element | reuse manifest `assets` |
| Element identity | Template element ids (`title`, `quote`…) | stable uuid per element | no | yes | yes |
| Geometry | Template home positions (Static offsets only) | intrinsic box | no | yes (stage fractions) | yes |
| Visibility | `hidden_elements` over Template ids | per element | concept yes | `hidden?` | omitted from payload |
| Paint order | `element_order` back → front | array order back → front | convention yes | array order | payload order |
| Element timing | `element_timing` for Template-declared elements | not in V1 | — | no | no |
| Typography / colors | Template + Identity tokens | Identity roles | tokens yes | role ids | roles in payload |
| Background | Template chrome | Identity `colors.background` | token yes | no | renderer default |
| Canvas | draft `canvas` (Mission A) | same stage | yes | no | no |
| Render segment | `template` (requires `TemplateRef`) | template-free | no | — | **`free`** |
| Player component | `TemplateSegment` → DocumentaryCard | own layer | primitives only | — | `FreeSegmentLayer` |

Findings that shaped the model:
- **Composition keys:** stored Template compositions have **no `kind` key**, and the write boundary rejected unknown keys. So an explicit `kind: 'free'` coexists with every legacy Scene unchanged, and the previously deployed API would refuse to save a free Scene.
- **Old worker:** the deployed `TimelineComposition` returned `null` for unknown segment kinds, so the old worker would silently draw nothing for a free Scene. The worker had to go first.
- **Library media:** the manifest-level `assets` map is already signed at claim time (`prepareTimelineLibraryFileAssets`) and patched by the Live Player, so free images need **no new preparation path**.
- **Identity:** `resolvedInput.tokens` already carries the real Project Identity (`colors.background/foreground/accent?/muted?`, `typography.display/body` with resolved families), so there is no second Identity model.
- **Existing template-free kinds:** `media` and `text` segments are root overlays (full-frame media; lower third only), **not** free elements.

## 3. Persistence and backward compatibility

```ts
// VideoScene.composition (existing Scene JSONB in video_drafts.scenes)
composition?: VideoSceneComposition /* Template, unchanged, no kind */ | FreeSceneComposition
interface FreeSceneComposition { kind: 'free'; elements: FreeSceneElement[] }   // order = paint order, back -> front
interface FreeElementBase { id: string /* uuid */; box: { x; y; width; height } /* stage fractions */; hidden?: boolean }
FreeTextElement  = base & { kind: 'text'; text; typography: 'display'|'body'; color: 'foreground'|'background'|'accent'|'muted'; align: 'left'|'center'|'right'; size: 'small'|'medium'|'large'|'title' }
FreeImageElement = base & { kind: 'image'; library_file_id: uuid; fit: 'cover'|'contain' }
```

- **Discriminant:** only `kind === 'free'` means free. Absent composition = legacy Template Cover (never Blank). Any other `kind` value is rejected as an unknown key. No existing Scene is rewritten or given `kind: 'template'`.
- **No migration:** the state lives in the existing `scenes` JSONB.
- **Template code paths are guarded:**
  - `resolveSceneComposition` throws on a free Scene, so it can never silently read it as Cover;
  - `setSceneLayout`, appearance, content, element order and visibility are no-ops on a free Scene (no conversion);
  - element-timing helpers return no rows or no-op.
- **Write boundary** (`validateFreeCompositionShape`), applied to both `POST` and `PATCH`:
  - strict keys, unique non-empty ids, on-stage boxes with at least 2% per side;
  - text ≤ 500 characters, Identity enums only, a UUID LibraryFile id, and at most 24 elements;
  - element timing on a free Scene is refused (`SCENE_ELEMENT_TIMING_INVALID`);
  - free images must be live, renderable **image** LibraryFiles of the draft's Project (`FREE_IMAGE_NOT_FOUND` / `FREE_IMAGE_KIND`);
  - the render route re-checks free images before enqueueing (`FREE_IMAGE_UNAVAILABLE`).

## 4. Element semantics

- **Identity:** `crypto.randomUUID()` at creation, persisted, never derived from array position, never regenerated on load. Scene-local; there is no platform Element registry.
- **Geometry:** `{x, y, width, height}` as fractions of the **VideoDraft canvas** (Mission A stays the only stage authority), origin top-left.
  - V1 keeps boxes on stage (no bleed) with a 2% minimum side; `clampFreeBox` keeps edits on stage and rounds to 4 decimals.
  - The UI shows and edits percentages and stores fractions; it has shortcuts "Centralizar ↔ / ↕" and "Palco inteiro".
  - No pixels, CSS or Remotion styles are persisted.
- **Text:**
  - text, alignment, and Identity **typography role** (display/body) and **color role** (foreground/background/accent/muted);
  - a semantic **size step**, which the renderer scales by the stage's shorter side (1080 → 38 / 54 / 81 / 119 px);
  - text wraps inside its box, and overflow is clipped at the box (bounded, no auto-fit);
  - accent/muted fall back to foreground if a Project's Identity omits them;
  - no free fonts, colors, rich text or effects.
- **Image:** `library_file_id` and `fit` only; no metadata copy and no URL. Deleting the element never deletes the LibraryFile.
- **Background:** no authored background in V1; a free Scene paints the Project Identity `colors.background`.
- **Visibility:** `hidden: true` is authored state, distinct from deletion, opacity and timing. Hidden elements are omitted from the render payload.
- **Paint order:** array order back → front; "Trazer para frente / Enviar para trás" swap one step. The list is shown front-first, like Camadas.
- **Motion:** Template presets are drawn by Template components, so a free Scene is **static**. The adapter emits no motion; a non-static `movement` only yields a `free_scene_motion_not_drawn` diagnostic, and the Motion tab says so.
- **Timing:** there is no free-element timing in V1. Stable element ids make it compatible later: `element_timing` is keyed by element id, and the free renderer already has the per-element seam. The API refuses timing on free Scenes today.

## 5. Neutral render contract (derived, never stored)

```ts
segment = { id: 'scene:<id>', track_id: 'video-main', start_frame, duration_frames, kind: 'free',
  payload: { elements: [ { element_id, kind: 'text', box, text, typography, color, align, size }
                       | { element_id, kind: 'image', box, asset_ref: 'library_file:<id>', fit } ] } }
```

- It has no `TemplateRef`, layout, content schema, component key or "blank" id. The renderer is selected by `segment.kind`.
- The free Scene stays in the primary contiguous sequence (same track). It never becomes a root item, and there is no Track per element.
- `validateTimelineSemantics` checks for unique element ids (`duplicate_free_element_id`) and that every image `asset_ref` exists in the manifest `assets` (`free_asset_not_found`).
- **Timeline version:** stays `timeline.v0`. The change is an additive union variant: every existing manifest parses and means exactly the same, and drafts without free Scenes produce byte-identical manifests (tested). Only a renderer that doesn't know the kind is affected, which is handled by the worker deployment order, not a version bump.

## 6. Renderer, Live Player and final render

- `remotion/timeline/FreeSegment.tsx` is a `Sequence` over the segment, with a container that has the Identity background and `isolation: 'isolate'`.
  - Each element is an absolutely positioned box (`box × stage`); text uses Identity family, weight, style and color; images use `<Img>` with `objectFit`.
  - It imports no Template module.
- `TimelineComposition` adds one branch (`segment.kind === 'free'`).
- Parity: `VideoScene.composition` → `buildRenderExecutionSnapshot` → adapter (`freeSceneToSegment`, `deriveFreeSegment`) → the same `free` segment for both paths:
  - **Live Player:** `buildLivePreviewInput` patches the browser display URL into the manifest assets.
  - **Render:** the frozen snapshot is resolved at claim time, where the claim loads the Project's LibraryFiles and presigns manifest assets.
  - A test asserts the Live Player manifest equals the render snapshot.

## 7. Canvas compatibility

`videoDraftCanvasSupport(scenes, canvas)`: the stage is drawable only if **every Template-backed Scene's** family declares it (the resolver enforces the same rule, because only `template` segments are canvas-validated). Free Scenes impose platform bounds only.

- **Mixed Template + free:** 9:16 and 4:5 are allowed; 1:1 and 16:9 stay blocked by the Template Scenes (Formato menu, Player blocker, enqueue).
- **Free-only:** every platform-valid stage is allowed, including 16:9 and custom sizes.
- Platform capability ≠ Template compatibility, and this is now visible in the product.

## 8. Editor UX

- **Nova cena:** always an explicit dialog, "Em branco" (free composition) or the current Template ("Editorial Documentary Collage", starting from Cover). Cancelling changes nothing. Opening the dialog does not dirty the draft; creating a Scene does.
- **Template tab (free Scene):** "Nenhum template aplicado · Composição livre". No structure, appearance or anatomy is shown, and there is no "Aplicar template" (conversion is deferred; free elements would be lost).
- **Conteúdo:** explains that texts are elements, edited in Elementos. **Assets:** lists the free images with "Trocar". **Motion:** static, as explained above.
- **Elementos:** "Texto" and "Imagem da Biblioteca" (images only); a front-first list with visibility, forward/back and remove; and, per element:
  - text: text, font, color, size and alignment (Identity roles);
  - image: "Trocar" and Preencher/Conter;
  - geometry in % with alignment shortcuts.
- **Direct manipulation:** not built in V1. The Inspector percentage controls are the truthful authoring surface; drag/resize on the Player is future UX.
- **Scene strip:** the free Scene shows "Livre · <first text>" and the first visible image as its thumbnail.

## 9. Proofs

**Local editor** (real Project, dedicated draft `da9b61ce-926e-46a6-b9d3-e57958182c74`, 4:5):
- Nova cena → Em branco inserted a free Scene 2 between the Cover and Citação Template Scenes.
- Adding text, editing text, style and geometry, adding and replacing the image, reordering, and hide/show each made the draft dirty.
- Save → reload was exact. The database holds only `{kind:'free', elements:[image, text]}` with the same uuids, `library_file_id` and no URL; Scenes 1 and 3 stayed `cover` / `quote` with their timing; the 4 root items are unchanged.
- Selecting and switching tabs does not dirty the draft.
- **Live Player DOM** at 4:5:
  - frame 89: the Cover;
  - frame 90: the free layer with background `#F6F0E4`; the image box is 108/405/864/675 px at z 1, drawn from the signed display URL of `pack-a-005-illustration.jpg`; the text box is 54/202.5/972/297 px at z 2, accent `#A34A27`, Fraunces 118.8 px;
  - frame 130: the root lower third over it;
  - frame 180: the Citação, with no leakage.

**Local exported worker:**
- Mixed 4:5 draft: 1080×1350, 270 frames, with AAC audio. Frames show the Template Cover, the free Scene (test image in its box, title in front), the root lower third, then the Citação.
- Free-only draft: 1920×1080, 90 frames.
- Evidence: `evidence/video-free-scene-composition-v1/local-exported-worker-mixed-frames.jpg`.

**Production** (feature `f21724e`, fix `73c943b`, preset fix `7c23054`):
- **Frozen snapshot** `6fc4c53f…`: the free segment has only element ids, boxes, roles and `library_file:` refs, with **no** `template`, variant or component key. Its neighbours carry `editorial.documentary-card` cover/quote, and the Citação keeps its `element_timing`.
- **VPS mixed render** `f8275b88-181e-41fd-9597-14d901918958`: h264 1080×1350, 30 fps, 300 frames, AAC, 10.048 s. Audio in the 3.5–5 s overlap window is −15.4 dB mean / −5.6 dB max, unchanged from earlier renders. Frames (`vps-mixed-4x5-frames-45-89-90-150-179-180.jpg`):
  - 45: root B-roll over the Cover;
  - 89: the Cover;
  - 90–179: the free Scene with the real Library image and the title in front;
  - 150 and 179: the root lower third **above** the free image;
  - 180: the Citação (quote not yet in, per its timing), with no free leakage.
- **VPS free-only render** `bc40813c-124c-4ec5-948c-66bc3116ef68` (draft `db0d9189-9699-4434-b8ba-4cc35105c2c0`): h264 **1920×1080**, 30 fps, 90 frames, AAC. It has a display title in the Identity foreground, a body line in accent, and the Library image in its box (`vps-free-only-16x9-frame-45.jpg`). This is a stage the current Template cannot draw, rendered in production.
- **Output Player:** its frame follows the MP4 (`1920 / 1080`, readyState 4). **Gallery:** 61 outputs, "Teste · só cena livre 16:9" first.
- **Formato:** in the mixed draft 9:16 and 4:5 are enabled and 1:1 and 16:9 blocked; in the free-only draft all four presets are enabled.
- **API:** timing on a free Scene → 400 `SCENE_ELEMENT_TIMING_INVALID`; a video as a free image → 400 `FREE_IMAGE_KIND`.

**Defect found by the production frames, and fixed:**
- **Symptom:** in the first VPS mixed render (`6fc4c53f…`), the free image covered the root lower third (`stacking-bug-before-fix-frame-150.jpg`).
- **Cause:** the free elements' `z-index` escaped the Scene, because there was no stacking context.
- **Fix:** `isolation: 'isolate'` on the free container (`73c943b`), proven first on the exported worker with a deliberate overlap, then on the VPS (`stacking-fixed-frame-150.jpg`).
- **Scope:** only free Scenes whose elements overlap root overlays were affected; Template Scenes never were.

**Web defect found in production, and fixed:**
- In a free-only draft all presets showed as unsupported, because the preset objects' extra keys failed the strict platform validator.
- `7c23054` validates dimensions only, with a regression test. It is web-only; `video-canvas.ts` is not in the worker bundle.
- It was pushed before its local `pnpm build` finished green; that first local run failed transiently, and two re-runs on the identical tree passed (exit 0, no errors), as did the Vercel build.

## 10. Regressions

- **Template Scenes:** neighbouring segments are identical with or without a free Scene (tested). The Citação timing is exact and its child rows (Título, Papel da citação, Imagem, Caixa de destaque) are shown. Expanding does not dirty the draft. The free Scene gets no chevron.
- **Scene reorder:** the free composition moves with its Scene; root B-roll and lower third keep their absolute frames (tested).
- **Root timeline / Audio V1:** root items are unchanged. The bed audio follows the new sequence end, which now includes the free Scene. The concurrent voice is kept, and overlap levels are unchanged.
- **Static:** the real 10-slide Carousel opens with TPL./CONT./ASSETS/ESTILO/ELEM.; "Adicionar slide" still uses the Template ("Editorial Documentary Co…"); there is no Blank anywhere; PNG `e3e726a6-2615-4dba-8ff7-9a831eebc316` is 1080×1350 (slide 5/10). No Static schema or code change.
- **Responsive** (free Scene selected, Elementos open, geometry scrolled into view):

  | Width | Page overflow-x | Geometry X input | Player |
  |---|---|---|---|
  | 1440 | none | 71×32 at 1065,474 ✓ | 398×498 |
  | 1024 | none | 71×32 at 561,474 ✓ | 398×498 |
  | 768 | none | 165×32 at 38,727 ✓ | 427×534 |
  | 390 | none | 70×32 at 38,638 ✓ | 317×396 |

  The draft stayed "Salvo" throughout.

## 11. Worker deployment

- **Worker files changed:** new `remotion/timeline/FreeSegment.tsx`, `remotion/timeline/TimelineComposition.tsx` (one branch), and `infra/render-worker-runtime/export.mjs` (list entry). The service command is unchanged.
- **First tarball:** `content-studio-video-free-scene-composition-v1.tar.gz`, sha256 `0ef7dd8395cb8f96243ec223c09404f55c0d5f983126f75109e74944a03592d8`. The operator updated the VPS, then `f21724e` was pushed.
- **Fix tarball:** `content-studio-video-free-scene-composition-v1-fix1.tar.gz` (75 files), sha256 `f485746675c6e3bf7c65296b7e029ff99cee669d21cc568e43bcf79ba767512b`. The operator updated the VPS, then `73c943b` was pushed.

## 12. Tests and gates

- New `lib/creative/video-editor/__tests__/free-composition.test.ts` (28 tests), covering:
  - legacy/absent composition stays Cover; Template compositions parse unchanged; any other discriminant is rejected;
  - free parse, validation and absence of Template identity (key scan); creation and insertion;
  - stable ids across reorder and reload; duplicate, missing, unknown and CSS keys rejected;
  - box bounds and clamping; Identity-only style; LibraryFile identity only;
  - hidden versus remove; paint order; the neutral segment and its schema and semantic validation;
  - neighbour Template segments unchanged; mixed and free-only Canvas rules (including preset objects); the stage never comes from media or boxes;
  - claim-time signing through manifest assets; Live Player/render parity and display-URL patch;
  - exact save/reload; dirty on every authored edit and never on UI state;
  - reorder, element timing (Citação intact, none on free), audio sequence end, API refusals;
  - renderer imports no Template module, keeps the `isolate` stacking context and is registered in the worker export; Static has no Blank.
- The Scene-composition test typing was adapted to the widened union.
- **Full suite:** 96 files / 1278 tests. `tsc --noEmit` clean. ESLint 0 errors on every changed file. `pnpm build` success.
- **Migration:** none.

## 13. Final checkpoint

- Feature `f21724e12080c68de0aa9110b4af85acec68d1cb` → Vercel `6682293126` success.
- Stacking fix `73c943bfeaf92b9691bdb72c1cdc9f8151e0f2b9` → Vercel `6682831648` success.
- Preset fix `7c23054965ea6799f2aad527c309c7dbc5e95bd2` → Vercel `6682878959` success.
- Final SHA: the docs commit recording this validation (recorded by the next mission's housekeeping).
- Housekeeping done here: `VIDEO_CANVAS_OUTPUT_FORMAT_V1.md` now prints its docs SHA `03904acd8d41b4ec09c8f3551fc6e5773361c98f`.
- **Production test data left intentionally:**
  - drafts `da9b61ce…` (mixed, 4:5) and `db0d9189…` (free-only, 16:9);
  - executions `6fc4c53f…` (pre-fix, shows the stacking defect), `f8275b88…`, `bc40813c…` (video) and `e3e726a6…` (static).
  - The canonical draft `7b12b65d…` was not touched.
- **Not committed:** `.env.local`, `.next/`, `tsbuildinfo`, `infra/render-worker-runtime/dist/` (tarballs), `.tmp/` (proof scripts, local renders, test media), scratch files and downloaded MP4s.

## 14. Known limitations

- No direct drag/resize on the Player; geometry is edited in the Inspector (%).
- Text does not auto-fit: overflow is clipped at its box, and the same fractional box is shallower on landscape stages.
- No authored background (Identity background only), no rotation/opacity, and no other element kinds (shapes, video).
- A free Scene is static; there is no per-element Motion and no free-element timing (ids are ready for it).
- There is no Template ↔ free conversion in either direction.
- Static stays Template-required (D2).
- Recommended next pressure: direct manipulation on the Player stage (drag/resize mapped through the viewport transform), or free-element timing reusing `element_timing` with free ids.
