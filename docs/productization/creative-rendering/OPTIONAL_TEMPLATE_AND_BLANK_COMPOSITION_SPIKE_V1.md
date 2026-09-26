# OPTIONAL_TEMPLATE_AND_BLANK_COMPOSITION_SPIKE_V1

Spike question: what is the smallest truthful model for moving the Creative Editor from **Template-required** to **composition-first, Template-preferred**, for both Static and Video, without a fake "blank" Template, a generic CreativeDocument or a scene graph?

Outcome: **audit and architecture decision only** (no executable slice). The direction is valid and a bounded model exists, but two product decisions about *where the Template binding lives* must be taken first, and the smallest proof needs a new template-free render contract plus a worker update. Details in §12.

## 1. Starting checkpoint

`03904acd8d41b4ec09c8f3551fc6e5773361c98f` — the final SHA of VIDEO_CANVAS_OUTPUT_FORMAT_V1 (Mission A closed in production: feature `358a051`, Vercel success, VPS renders proven). Inter-mission gate: CASE 1.

## 2. Static audit (executing code)

| Aspect | Today |
|---|---|
| Persisted state | `channel_piece_static_authoring_states`: one row per ChannelPiece, `slides JSONB` (array, CHECK non-empty), `template_id TEXT NOT NULL DEFAULT 'editorial-documentary-collage-v1'` (migration 035). |
| Template binding | **Carousel root**, one per collection. `StaticAuthoringStateSchema.templateId` optional on write (older clients) → persisted as the default; unknown ids rejected. Load uses `resolveAuthoringTemplate` (missing/unknown → first Template, flagged). |
| Slide shape | `PersistedAuthoredSlideSchema` (strict): `variant` **required enum of Template layout ids**, `appearance`, `content` (per-layout schema), `primitiveSelection`, `primitiveTransforms` (full closed slot set), optional `heroRef`, `tuning`, `elementOrder`, `assetOverrides`, `hiddenElements`. Every field is Template-relative. |
| Layout / Appearance | Template-scoped (`TemplateLayoutDefinition.supportedAppearances`). |
| Content | Bounded per layout (zod schemas in `lib/schemas/creative/documentary-card`). |
| Asset overrides | Keyed by Template asset slots (`paper`, `tape`, `hero`, …). |
| Element transforms | `PrimitiveTransforms {offsetX, offsetY, rotation, scale, opacity}` **relative to the Template's home position**, keyed by the closed `PRIMITIVE_TRANSFORM_SLOTS` enum. No intrinsic box. |
| Element order / hidden | Template element ids, normalized against the layout. |
| Add Slide | `createTemplateSlide({ templateId, layoutId, appearance })` — a slide is always born from a Template layout. |
| Restore defaults | "Restaurar padrão do Template" → `createTemplateSlide` for the same layout. |
| renderStill | `StaticRenderManifest` **requires** `template: TemplateRef`; the resolver validates canvas/content/assets against the descriptor; the worker's `StaticRenderManifestStill` resolves the component by `component_key`. |
| Registry | Exactly **one** authoring Template (`editorial-documentary-collage-v1`, 8 layouts) and its renderer descriptor (`editorial.documentary-card`). The editor silently starts every carousel on it. |

## 3. Video audit (executing code)

| Aspect | Today |
|---|---|
| Template family | **Draft-wide and implicit**: `VIDEO_TEMPLATE_ID = DEFAULT_TEMPLATE_ID`, not persisted ("a stored id would be a choice that does not exist"); renderer identity `VIDEO_TEMPLATE_FAMILY` in the adapter. |
| Scene composition | Optional `VideoScene.composition {layout, appearance, content, element_order, hidden_elements}`; **absent = Cover · Dark · "Cena N"** — every Scene is Template-backed by construction; there is no representation of "no Template". |
| Layout scope | Per Scene, inside the family (`VIDEO_SCENE_LAYOUT_IDS`). |
| Media binding | `VideoScene.library_file_id` → the layout's `hero` slot (only layouts that draw a content image use it). |
| Element order / visibility | Template element ids (same normalization as Static). **No transforms** in Video. |
| Element timing | `VideoScene.element_timing` (Scene-local), only for elements whose Template definition declares `timing`. |
| Motion | Scene-level preset mapped to Template-declared motion presets. |
| Scene creation | `createVideoScene` → no composition → implicit Cover. |
| Output stage | Draft-level `canvas` (Mission A); the Template declares which stages it draws. |
| Neutral contract | `timeline.v0`: `template` segments (require `TemplateRef`) for Scenes; `media`, `text`, `audio` segments for root items. |
| Template-free kinds that exist | `media` (payload has `fit/scale/position`, but the renderer draws it **full-frame**, ignoring scale/position) and `text` (payload has `role`, but the renderer always draws the **lower third**). They are root overlays, **not** free elements. |
| Player / render | Same `TimelineComposition` → `TemplateSegment` (Template component) / `IndependentSegments` (root overlays). |

## 4. Matrix 1 — capabilities

| Capability | Static Template-backed | Video Template-backed | Actually shared semantic? | Template-dependent? | Could exist blank? |
|---|---|---|---|---|---|
| Output stage | channel/format target (1080×1350 or 1080×1920) | draft `canvas` (Mission A) | yes (px stage) | Template gates which stages it draws | **yes** — a free composition draws into any valid stage |
| Layout | required (`variant`) | per Scene (default Cover) | yes | yes | no (a layout *is* Template grammar) |
| Appearance | required | per Scene | yes | yes | no; a free composition would use Project Identity tokens directly |
| Content | per-layout schema | per-layout schema (same forms) | yes | yes | only as free element text, not as layout content |
| Asset slot | Template slots + overrides | `hero` slot via `library_file_id` | partly | yes | no slots; free images bind a LibraryFile directly |
| Element order | Template ids | Template ids | yes | ids are Template-scoped | yes — order of the free element list |
| Element visibility | Template ids | Template ids | yes | ids are Template-scoped | yes — per free element |
| Element transform | offset/rotation/scale/opacity **relative to Template home** | none | **no** | yes (home position) | needs an intrinsic box (new) |
| Element timing | — | Scene-local, Template-declared | Video only | declaration is Template metadata | yes, later, for free element ids (§10) |
| Motion | — | Scene preset | Video only | presets declared by Template | Scene-level fade could apply; element Motion out of scope |
| Typography | Template + Identity tokens | same | yes | yes | Identity tokens only |
| Render contract | `static-render.v0` requires `template` | `template` segment requires `TemplateRef` | yes | yes | **needs a new template-free payload** |

## 5. Matrix 2 — visual/authoring units

| Unit | Stable element id? | Current owner | Content or Element? | Asset slot? | Primitive? | Needs identity in Blank? | Why |
|---|---|---|---|---|---|---|---|
| title | yes `title` | layout element (text) | Element (with content `title` drawn in it) | — | text on strip | yes (as a free text element) | selected, hidden, timed and tuned independently today |
| quote (Citação) | yes `quote` = the **paper**; the quote text is Content drawn on it | layout element (material) | Element carrying Content | `paper` | paper material | the text yes, the paper only if the user places one | proves an Element can host Content without the text being its own Element |
| hero | yes `hero` | layout element (image) | Element | `hero` | image frame | yes (free image) | media placement is the core free use case |
| callout | yes `callout` | layout element (material) with `content.callout` | Element carrying Content | `paperDark` | dark paper | as text + optional box | same Content-in-Element pattern |
| paper/tape companions | yes (`paperStrip`, `tape1`) | layout elements; timing companions | Element (decorative backing) | `paperStrip`, `tape` | collage materials | no | decoration that belongs to the grammar; a free composition would not get them implicitly |
| intro | **no** | fixed text layer, `content.intro` | Content | — | typography | no | no capability needs it apart (see §11) |
| bullet units | **no** (array `content.bullets` / list `items`) | fixed text layer | Content collection | — | icon set (list) | no | per-item identity only if per-item reveal is wanted (§11) |
| sequence badge | **no** | template chrome from `sequence {index,total}` | derived chrome (not authored content) | — | badge | no | nothing to author; it is sequence context |
| decorative (botanicalLeaf, ornament, archival…) | yes | layout elements (material) | Element (decorative) | yes | materials | no | Template grammar, hideable/transformable today |

## 6. B1 — Content ≠ Element (evidence)

- **Content** is bounded semantic data (`title`, `intro`, `bullets`, `quote`, `callout`) validated per layout.
- **Element** is an addressable visual instance (`title`, `quote` paper, `hero`, `callout` box, materials) with stack order, visibility, Static transforms and, in Video, optional timing.
- **Asset slot** is a semantic resource role (`paper`, `tape`, `hero`, `paperDark`), filled by a Template default, a Project primitive or a LibraryFile override.
- **Primitive** is a reusable visual building block (paper, tape, strip, pin, grain) used by the Template's components.

The Citação `quote` element is the decisive example: the element is the paper, and the quote **text** is Content drawn on it. The hierarchical-timing spike worked because it timed Elements (with companions), not Content. So "everything visible must become an Element" is false. A unit is promoted only if an authoring capability needs it apart (§11).

## 7. B2 — Blank is not a fake Template (rejected option)

Registering `templateId = 'blank'` (an empty Template, or an "Em branco" layout inside the current one) is **rejected**:

- `PersistedAuthoredSlideSchema.variant`, the content schemas, slot transforms, element ids and `static-render.v0.template` would all still require Template grammar. "Blank" would be a Template with no grammar, and the architecture would stay Template-required under another name.
- The renderer would route free elements through a Template component to reuse a React tree, which B9 forbids.
- Every place that means "this unit has no Template" would instead mean "this unit has Template X", and a future apply-Template conversion could not tell the two apart.

A blank unit must be valid because its **own authored composition** holds the structure: a free element list, with no Template id at all.

## 8. B3 — Template binding scope (the open decisions)

**Static:** today the binding is **collection-level** (carousel root `template_id`), and slides can only be layouts of that Template. The evidence supports keeping it collection-level. Per-slide mixing (a blank slide inside a Template carousel, or two Templates in one carousel) is not required by any current workflow. A blank carousel means `template_id` has no value. But the column is `NOT NULL DEFAULT …` (035). Using `NULL` needs a small constraint migration (`DROP NOT NULL`). **B18 says stop before applying it**, and that is a user decision (D2).

**Video:** the Template family is **draft-level and implicit** (not persisted), while the Scene is the unit that already chooses its own layout. So two readings are defensible:

- **(a) Scene-level free composition.** `VideoScene.composition` gains a `free` kind; a Template-backed draft may hold one free Scene, for example a title card. No migration (Scene JSONB). It matches how Scenes already own layout.
- **(b) Draft-level blank.** A VideoDraft is created "Em branco" and all its Scenes are free. This needs a persisted draft-level binding that does not exist today (a column or field, so a migration), and it mirrors Static's collection-level binding.

This is a product choice about how people will assemble videos, not something the code can decide. It is left as **D1** (§12). Recommendation: **(a)**, because layout choice is already per Scene, it needs no migration, and it still allows a later draft-level "start blank" flow that simply creates free Scenes. Per-unit polymorphism is justified here by the existing per-Scene layout ownership, not by flexibility.

## 9. B4/B5/B6 — origin vs current mode, creation, Inspector

- **Start from Template** stays tractable: it is today's `createTemplateSlide` / Cover-default Scene.
- **Apply a Template to an existing free composition** needs a semantic mapper from arbitrary elements to layout roles/content/slots. It is **not** part of this mission and must be a separate conversion workflow. The Template tab must not offer "Aplicar template" on a populated free composition.
- **Creation:** today both editors silently pick the only Template. The truthful flow is `Começar com: ○ Em branco ○ Template recomendado ○ Escolher template…`, placed where the binding lives: carousel creation for Static; Scene creation (option a) or draft creation (option b) for Video. Existing Template-backed documents open unchanged.
- **Inspector:** the Template tab must say `Template · Nenhum template aplicado · Composição livre`, and offer `Começar de template` only for an empty unit (no conversion).

## 10. B7/B8/B9/B14/B15 — candidate minimum free model

Candidate (not implemented):

```ts
// Video: VideoScene.composition when kind = 'free' (option a); Static: slide shape when the carousel has no Template.
type FreeComposition = {
  kind: 'free'
  background?: { color: 'background' | 'foreground' | 'accent' } | { library_file_id: string; fit: 'cover' | 'contain' }
  elements: FreeElement[]            // array order = paint order (back → front)
}
type FreeElement = {
  id: string                         // stable uuid, never reused
  hidden?: boolean
  box: { x: number; y: number; w: number; h: number }   // fractions of the STAGE (0..1)
  rotation?: number; opacity?: number
} & (
  | { kind: 'text'; text: string; style: { role: 'display' | 'body'; size: number /* fraction of stage width */; align: 'left' | 'center' | 'right'; color: 'foreground' | 'background' | 'accent' } }
  | { kind: 'image'; library_file_id: string; fit: 'cover' | 'contain' }
)
```

- **Identity:** a stable uuid per element, so Scene-local `element_timing` could later key on free element ids. Every free element would be temporalizable by construction, but timing is **not** added here (B15).
- **Geometry:** the box is stored as fractions of the **Mission A stage**. The stage stays the draft's `canvas` (Video) or the channel target (Static); free elements live inside it and never define it (B14). Fractions keep a composition proportional when the stage changes; this is a considered choice, recorded for review.
- **Styling:** Project Identity tokens only (no free fonts or colors), so blank still respects brand governance.
- **Renderer (B9):** a new neutral payload (a `free` template-free segment payload in `timeline.v0`; a template-free variant of `static-render.v0`) and a new small component built from shared low-level primitives (`Img`, typography tokens). It must not go through `DocumentaryCard`. Both the Player and the worker bundle would change, so an **operator worker update** is required.
- **B8 — shared ElementInstance: not justified now.** Static transforms are Template-relative (offset from a home position, closed slot enum); Video has no transforms and has timing; neither has an intrinsic box; visibility and order are the only truly shared semantics, over Template-scoped ids. A free element would be the first element with intrinsic geometry in either medium. Keep medium-specific authored state and share only the low-level renderer primitives. No CreativeDocument.

## 11. B16 — Template anatomy pressure (should intro/bullets/badge become Elements?)

| Pattern | Class | Capability that would justify promotion | Verdict |
|---|---|---|---|
| intro (Cover subtitle, List/Quote intro) | 1 — bounded Content | none observed; wanting a timeline row is not enough | stays Content |
| bullets / list items | 3 — repeated collection | **per-item reveal** (bullets entering one by one) would need item identity (`content.bullets[i]` → element `bullet:i` or stable item ids) | **5 — unresolved**: promote only when per-item reveal is an actual product ask; do not promote the whole list as one Element just to time it |
| sequence badge | 4 — template chrome from `sequence` context | independent visibility ("hide page number") is the only plausible capability | stays chrome; a layout toggle is enough if asked |
| title, quote paper, hero, callout | 2 — Element (already) | selection, visibility, Static transforms, Video timing | keep |
| paper/tape companions | 4 — decorative backing (Element for stack/visibility) | none independent | keep as companions |
| decorative materials | 2/4 — Element for visibility/transform, decorative | hide/transform in Static | keep |

"Because timing wants rows" is not used as a justification anywhere above.

## 12. Verdict and decisions required

**VERDICT: B.** The Blank direction is valid and a bounded, non-generic model exists (§10). No fake Template is needed; no CreativeDocument or scene graph is needed. But before any slice:

1. **D1 — Video binding scope:** Scene-level free composition (recommended; no migration) **or** draft-level "Em branco" (needs a persisted draft binding and a migration).
2. **D2 — Static blank:** approve making `channel_piece_static_authoring_states.template_id` nullable (a constraint migration) so a carousel can exist with no Template, **or** keep Static Template-required for now and prove Blank on Video first (recommended order: Video first).
3. **D3 — render contract:** approve a new template-free payload in `timeline.v0` (and later `static-render.v0`) plus a worker update. This is new renderer surface and needs an operator VPS update.
4. **D4 — free-element geometry:** confirm stage-fraction boxes and Identity-token-only styling (§10).

**Why no executable slice tonight:** the smallest honest proof (one free Scene with a text and an image, preview + VPS render) depends on D1 and D3, and needs a worker update the operator cannot do overnight. Building it on a guessed binding scope would pre-empt D1. Stop conditions check: no generic document, scene graph, recursive layers or renderer rewrite is required. The **only** blockers are D1–D4.

**Next recommended mission (after D1–D4):** `VIDEO_FREE_SCENE_COMPOSITION_V1`: a Scene-level free composition (text + image, stage-fraction boxes, Identity tokens), a new `free` neutral payload and renderer component, a worker update, Live Player + VPS proof on the Mission A stage, a truthful "Nenhum template aplicado" Template tab, and no apply-Template.

## 13. Tests / validation

Audit only: no product code changed. The suite at this checkpoint is the Mission A result (95 files / 1250 tests, typecheck/lint/build green); nothing here alters it. Template-backed Static and Video behavior was re-verified in production during Mission A (Carousel PNG 1080×1350; Video renders with Scene timing, B-roll, lower third, two audio items).
