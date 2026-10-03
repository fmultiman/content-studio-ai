# CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1

Structural implementation of the first correction recommended by
[CREATIVE_EDITOR_ELEMENT_CAPABILITY_AND_TRANSFORM_MODEL_V1](./CREATIVE_EDITOR_ELEMENT_CAPABILITY_AND_TRANSFORM_MODEL_V1.md)
(docs PR #105, merge `7ad8816`): Template Element controls come from a **class baseline**,
not from whichever controls a component happened to wire.

> TEMPLATE CONSTRAINTS PROTECT COMPOSITION GRAMMAR. THEY MUST NOT ARBITRARILY REMOVE SAFE
> MANIPULATION CAPABILITIES FROM A USER-SELECTABLE ELEMENT.

| | |
| :-- | :-- |
| Worktree | `D:/Traycer/worktrees/fmultiman__content-studio-ai/traycer-witty-puma-23e2b43ebdbe` (canonical Static worktree) |
| Starting `origin/main` | `1393c43e0d4847ab761123422ed66d278f602590` (`fix(video-generation): add working-state and session to boundary allowlist (#104)`) |
| Branch | `feat/creative-editor-element-baseline-capabilities-v1` |
| MIGRATION | **NONE** (authored state is JSON; new fields are optional and read through the existing normalizers) |
| RENDERER | **YES** (Logo da marca Size/Opacity in four layouts; content-image Opacity) |
| WORKER | **YES** (`primitives.tsx`, Cover/Info/List/Closing variants are bundled by the render worker) |

## 1. Factual pre-implementation architecture

The audit document is high level; this is what the code actually did before the change.

* **Capability exposure was hardcoded per control type in `TemplateElementPanel`.** Each Element
  declares `control: transform | tuning | follows | fixed` (`template-definitions.ts`) and the panel
  switched on it, rendering a different hand-written control set per branch:
  * `transform` (14 material channels in `primitiveTransforms`): X, Y, Rotação, Escala, Opacidade;
  * `tuning hero`: X, Y, Rotação, Escala — **no Opacidade**;
  * `tuning title|source|kicker|intro|brand`: X, Y, Rotação only;
  * `follows` / `fixed`: a note, no control.
* **Logo da marca** was `tuning brand` on the Cover (X/Y/Rotação, no Size, no Opacity) and `fixed`
  (no control at all) on Info, Lista and Encerramento. It was the same Element in the same slot with
  four different capability sets.
* **Generic state sources that already existed**: `hiddenElements` (visibility), `elementOrder`
  (paint order), `primitiveTransforms` (X/Y/rotation/scale/opacity per channel), `tuning` groups,
  `assetOverrides`, `typography`. All are already Layout-owned (`layout-switch.ts`: `primitiveTransforms`
  and `tuning` are replaced wholesale by the target Layout's baseline).
* **Renderer support** was checked per source, not assumed: every `transform` channel Element is drawn
  through `AssetLayer` / `AssetTextLayer` / `ElementGroup` → `elementTransform`, which honours all five
  fields (so materials and the procedural `map` already truthfully supported Escala and Opacidade).
  `PlateImage` (content image) honoured offset/rotation/scale but not opacity. The Logo (`BrandLogo` /
  `BrandMark`) honoured offset/rotation on the Cover only.
* Element class metadata already existed as `kind` (`text | image | material | shape`) + `assetSlot`
  (`hero | logo | <material>`): enough to derive classes without any new per-Element list.
* The narrowest UI registry location is beside the authoring state (`lib/creative/authoring/`), **not**
  inside `template-definitions.ts` (a pure data file bundled verbatim into the render worker).

## 2. Element class model

Derived from the existing Template identity (`elementClassOf`), never listed per Element:

| Class | Derived from | Examples |
| :-- | :-- | :-- |
| `text` | `kind: 'text'` | Título, Chamada, Introdução, Fonte, Texto principal… |
| `contentImage` | `kind: 'image'`, slot `hero` | Imagem principal / do documento / Imagem |
| `brandAsset` | `kind: 'image'`, slot `logo` | Logo da marca (ONE complete logo) |
| `decorativeAsset` | `kind: 'material'` | papéis, fitas, pins, botânicas, fragmentos, ornamento |
| `proceduralVisual` | `kind: 'shape'` | Mapa do Brasil, Moldura da imagem, Conexões, Linha pontilhada |

No `UniversalElement`, no persisted capability arrays, no generic transform bag, no new renderer schema.

## 3. Capability registry design

`lib/creative/authoring/element-capabilities.ts` — a lightweight, pure, **non-persisted** answer to
"which controls are valid for this Element?":

* `ELEMENT_CLASS_BASELINE` — the floor per class.
* `FIXED_ELEMENT_EXCEPTIONS` + `CAPABILITY_EXCEPTION_EXPLANATIONS` — the only way (with `follows`) to
  omit the spatial baseline, each with a written reason.
* `transformBindingFor(control)` — the **state adapter**: for each existing source it declares the fields
  and ranges it stores and returns the **existing** actions (`SET_PRIMITIVE_TRANSFORM`,
  `RESET_PRIMITIVE_TRANSFORMS`, `SET_TUNING` with `setTuningField` / `resetTuningGroup`). The capability
  decides *whether* a control exists; the binding decides *how* it is stored.
* `resolveElementCapabilities(definition)` → `{ elementClass, capabilities, exception, missingBaseline }`.
  A spatial capability exists exactly when the Element's source can store it, so **no control is ever
  offered that the authored state and the renderer cannot honour**. `missingBaseline` reports any
  baseline capability that is absent *without* a documented exception; the registry test requires it to
  be `[]` for every Template Element, so a forgotten wiring is a failing build, not a missing control.

UI: `TemplateElementPanel` is now capability-driven and uses one `ElementTransformControls` component,
always in the same order — **Posição X/Y · Rotação · Escala · Opacidade · type-specific (note, resource) ·
Restaurar elemento**.

## 4. Baseline matrix

Baseline is a **floor**: extras a source already supports stay.

| Class | Visibility | Position X/Y | Size/Scale | Rotation | Opacity | Replace asset |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: |
| `text` | ✓ | ✓ | – (typography, Estilos) | ✓ | – (not classified) | – |
| `contentImage` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `brandAsset` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `decorativeAsset` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `proceduralVisual` | ✓ | ✓ | ✓ | ✓ | ✓ | – (no fake file/Library identity) |

What changed in the product (everything else already matched the baseline):

| Element | Before | After |
| :-- | :-- | :-- |
| Logo da marca — Cover | X, Y, Rotação | + **Escala**, + **Opacidade** |
| Logo da marca — Info / Lista / Encerramento | none (fixed) | X, Y, Rotação, **Escala**, **Opacidade** (same set as Cover) |
| Imagem principal (Cover/Lista/Citação) | X, Y, Rotação, Escala | + **Opacidade** |
| Materials, procedural `map`, `tiles` | already full | unchanged |
| Info Faixa da chamada / Aba da marca, Encerramento Linha pontilhada (exception audit) | none (fixed) | full material/procedural baseline (new channels) |
| 14 formerly fixed text blocks (Info Texto principal/Anotação, `intro` ×5, Rede `kicker`, Itens ×2, Legenda, Tópicos, Texto de apoio, Frase final) (exception audit) | none (fixed) | Posição X/Y + Rotação (tuning) |
| Info Chamada (`introText`) | none (fixed) | follows its banner (like every text on a paper) |
| Text (all tuning groups / `transform` channel) | unchanged | unchanged |

## 5. Explicit exceptions — and the exception audit

A baseline capability may be suppressed **only when the omission is semantically necessary**: the Element's place *is*
another unit's place (`follows-owner`), its geometry is structurally derived from another Template unit
(`derived-geometry`), or moving it alone would break an intentional compound relationship (`compound-relationship`).
"Not implemented yet", "deferred", "fixed in the current code" and "the component does not support it" are **not** reasons.
A test rejects those phrases in any explanation and rejects any reason outside the semantic list.

### Audit of the first delivery (PR #106, `d0cf68c`)

PR #106 shipped 34 exceptions: 16 `follows` and 18 `fixed`. The 18 `fixed` ones were justified as "fixed text slot / composite
block / backing / rule" — and one of the reasons even said "deferred". That is an implementation state, not a Template
meaning, so the audit re-judged every one against the layout semantics:

| Element (layout) / class | Baseline suppressed | Exception reason in #106 | Semantic? | Evidence from Template/layout |
| :-- | :-- | :-- | :-: | :-- |
| `follows` ×16 (text on its paper: noteText, card1Text, card2Text, calloutText, ideasText, cardsText, quoteText, inviteText; frame under its image: heroFrame ×2; pins/links of their owner: mapPins, links) / text, proceduralVisual | position, scale, rotation, opacity | follows-owner | **YES** | Each declares `stackPlacement { above | below: owner }`, is drawn inside its owner's visible box through the owner's channel (`AssetTextLayer`, `PlateFrame`, `ElementGroup`), and its owner is itself spatial. Its place is its owner's place by construction. |
| introText (Info) / text | position, rotation | fixed-text-slot | **NO → now `follows('introBanner')`** | It is the text printed on the "Faixa da chamada" paper (same box, `stackPlacement above introBanner`) — exactly the noteText/card1Text pattern. Its owner was unwired, not the text. |
| introBanner (Info) / decorativeAsset | position, scale, rotation, opacity | fixed-backing | **NO → transform channel `introBanner`** | A paper like every other paper (note, card1, paperDark…), all of which have the full channel. Nothing derives its geometry from another unit. |
| brandTab (Info) / decorativeAsset | position, scale, rotation, opacity | fixed-backing | **NO → transform channel `brandTab`** | Same: an independent paper. The logo no longer needs it as a "fixed anchor" — Logo da marca is itself movable (#106). |
| divider (Encerramento) / proceduralVisual | position, scale, rotation, opacity | fixed-rule | **NO → transform channel `divider`** | A decorative dotted line; no Template unit derives from it or it from them. Procedural visuals (Mapa) already have the full channel. |
| intro (Lista, Grade, Mapa, Rede, Citação) / text | position, rotation | fixed-text-slot | **NO → tuning `intro`** | Cover's `intro` is the same role and already positioned through tuning `intro`. Same Element, different wiring. |
| kicker (Rede) / text | position, rotation | fixed-text-slot | **NO → tuning `kicker`** | Cover's `kicker` already uses it. |
| bodyText, annotation (Info) / text | position, rotation | fixed-text-slot | **NO → tuning `body`, `annotation`** | Single text blocks with absolute coordinates; nothing else depends on their place. |
| body, tagline (Encerramento) / text | position, rotation | fixed-text-slot | **NO → tuning `body`, `tagline`** | Same. |
| items (Lista, Encerramento), legend (Mapa), bullets (Citação) / text | position, rotation | fixed-composite-block | **NO → tuning `items`, `legend`, `bullets`** | "Moving it breaks its parts" is false: the block moves as one unit. Grade's `tiles` is the same kind of composite block (rows of icon+text) and already has a full transform channel. |

Outcome: **all 18 `fixed` exceptions were implementation gaps** and were removed by implementing the missing baseline with the existing
architecture (no new model): six honestly-named optional tuning groups (`body`, `annotation`, `items`, `legend`, `bullets`, `tagline`;
`intro`/`kicker` already existed) and three material transform channels (`introBanner`, `brandTab`, `divider`). `introText` became a
`follows` of its banner.

### Current exceptions (after the audit)

| Exception | Elements | Semantic evidence |
| :-- | :-- | :-- |
| `follows-owner` | 17 `follows` Elements (the 16 above + Info `introText`, which now follows its banner: closing.inviteText, cover.noteText, grid.ideasText, info.card1Text, info.card2Text, info.introText, list.calloutText, list.heroFrame, list.noteText, map.mapPins, map.noteText, network.calloutText, network.cardsText, network.links, quote.calloutText, quote.heroFrame, quote.quoteText) | painted directly above/below an existing spatial owner and positioned by it |
| `derived-geometry` / `compound-relationship` | none | `SEMANTIC_FIXED_EXCEPTIONS` is deliberately empty; no Template Element is `control: fixed` any more |

The registry test pins this exact 17-element set.

Tests that enforce this: every exception is semantic with layout evidence; a `fixed` Element without a semantic entry is a reported
`missingBaseline` (never an exception); a source that cannot store a baseline field is reported; class baseline enforcement still fails when a
capability is arbitrarily omitted; the excuse phrases above are rejected.

## 6. State-source mapping (nothing duplicated)

| Capability | Authored truth (unchanged sources) |
| :-- | :-- |
| Visibility | `hiddenElements` (Camadas eye) |
| Material / procedural / `tiles` placement | `primitiveTransforms[channel]` (`offsetX/Y, rotation, scale, opacity`) |
| Content image placement | `tuning.hero` (`offsetX/Y, rotation, scale`, **+ optional `opacity`**) |
| Logo da marca placement | `tuning.brand` (`offsetX/Y, rotation`, **+ optional `scale`, `opacity`**) |
| Text placement | `tuning.title|source|kicker|intro` and, since the exception audit, `tuning.body|annotation|items|legend|bullets|tagline` (same bounds: X/Y ±60, rotation ±2°) |
| Formerly fixed materials / procedural visual | `primitiveTransforms.introBanner|brandTab|divider` (full five fields, same as every material) |
| Typography | `typography` (Estilos) — untouched |
| Resources | `assetOverrides` — untouched |
| Paint order | `elementOrder` — untouched |

New fields are **optional**: absent = Template size / fully opaque, a reset removes them, and every
slide authored before serializes and renders byte-for-byte as before. Schemas extended in the persisted
slide (`carousel-state.ts`) and the render request / frozen snapshot (`render-request.ts`).

## 7. Logo da marca — real-smoke fix

* `brandLogo` is `control: { type: 'tuning', group: 'brand' }` in **every** layout that has it (Cover, Info,
  Lista, Encerramento): same class, same controls, no per-layout drift.
* Size is stored in the existing `tuning.brand.scale` (no Logo-specific hack, no bigger default logo).
  Renderer: `brandLogoPlacement()` in `primitives.tsx`, a single helper used by the four variants. The Cover
  signature is bottom-left anchored, so a larger logo grows up and to the right and does not leave the
  canvas; the Info/Lista marks scale from their centre; Encerramento from its left-centre. The rotation pivot
  and the unscaled placement are unchanged (an untouched logo paints no transform at all on Info/Lista/Encerramento
  and the legacy transform on the Cover).
* The complete logo remains ONE Element (one `Project brand mark`, no name text, no `Nome da marca` Element).
* Asset replacement keeps the author's Size/Position/Opacity (nothing is silently reset) and the new logo
  can still be adapted; "Usar padrão" restores the Template **asset** only.

## 8. Reset, layout switch, Anatomy/Camadas/selection

* **Reset** (`Restaurar elemento`) calls the Element's existing reset action: a `tuning` group is replaced by
  its default (optional groups are removed), a transform channel by `RESET_PRIMITIVE_TRANSFORMS`. Tests assert the
  state, the persisted slide and the render equal a never-adjusted slide.
* **Layout switch**: all new fields live in `tuning`, which `replaceTemplateLayout` already replaces wholesale
  with the target Layout's baseline. Tests: Logo Size/Opacity and Hero Opacity do not leak Cover → Info/Lista/
  Encerramento/Citação, nor resurface on return; Custom Elements are preserved; a Logo authored on a layout whose
  Logo used to be `fixed` also resets.
* Anatomy (semantic structure), Camadas (paint order) and the shared `selectedTarget` are untouched: capability
  edits never change `elementOrder`, `hiddenElements` or Section grouping (tested).

## 9. Free/Custom, Video, shared impact

* Free/Custom keeps its box x/y/width/height + fit model; no Free code changed. No crop/focal point, no
  `DEFAULT_FREE_IMAGE_BOX` change, no Free reorder change.
* Video does not pass Static `tuning` into its Scene renderer, so Video output is unchanged; the Video worker
  bundle does contain the changed renderer files, which is why WORKER = YES.

## 10. Renderer / worker impact

Files bundled by the render worker that changed: `components/creative/documentary-card/{primitives,CoverVariant,
InfoVariant,ListVariant,ClosingVariant}.tsx`, `lib/creative/templates/template-definitions.ts` (data only: controls of `brandLogo` and, after the exception audit, the 18 formerly fixed Elements), `layout-kit.tsx`, and the Grade/Mapa/Rede/Citação variants (`kit.placed`). The Editor-only registry (`element-capabilities.ts`) is **not** in the export list (tested).
Preview and final render consume the same authored truth: a test freezes the state into a snapshot, parses it, builds the
renderer props through the worker's `editorial.documentary-card` binding and asserts the markup is byte-identical to
the Preview for a scaled Logo (4 layouts), a procedural visual with non-default Opacity and an image with a non-default
transform.

## 11. Tests

* New: `lib/creative/authoring/__tests__/element-baseline-capabilities.test.ts` (36 tests) — class resolution,
  baseline consistency, deliberate exceptions, "no fake control", non-persistence, extras kept, Logo (Scale, authored
  truth, preview, reset, asset replacement, one Element, no Nome da marca, bounds), visual baseline per class,
  procedural/asset truthfulness, Text safety, reset/persistence/snapshot, layout switch, Preview ≡ final render.
* Extended: `components/creative/authoring/template-element-panel.test.tsx` (Logo Escala slider → `tuning.brand`,
  reset, Hero Opacidade, resource section per class, exception reason, follows note), `cover-element-completeness.test.ts`
  (brand bounds now include Size/Opacity), existing Hero/Logo slider expectations updated to the new baseline.

## 12. Known limitations / numeric ranges (NOT changed here)

Range policy is the next slice. Visible current limits:

* Logo Size: `0.5 – 3` (new field's own initial range); Logo X/Y `±60`, rotation `±2°` (unchanged).
* Content image Escala `0.9 – 1.15` (unchanged — the exact case the audit flagged), X/Y `±120`, rotation `±4°`; Opacity `0 – 1`.
* Material channels: X/Y `±120`, rotation `±15°`, Escala `0.5 – 2`, Opacity `0 – 1`.
* Text groups: X/Y `±60`, rotation `±2°`.
* The formerly fixed text blocks take the same bounded position as every other text (X/Y ±60, rotation ±2°); their range is part of the later range-policy slice.
* Info/Lista logos are still drawn inside the existing circular mark (pre-existing; not part of this slice).
* Two pre-existing baseline failures (test-label drift, NOT part of this work; the product label stays "Estilos") (`Estilo` vs `Estilos` label assertions in `editor-workspace.test.ts` and
  `video-editor/__tests__/static-parity.test.ts`) fail identically on clean `origin/main` `1393c43`; unrelated and untouched.

## 13. Deferred next slices (not started)

`CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1`, `CREATIVE_EDITOR_IMAGE_INSERTION_GEOMETRY_V1`,
`CREATIVE_EDITOR_FREE_LAYER_DRAG_PARITY_V1`, `CREATIVE_EDITOR_INSPECTOR_ELEMENTS_SHELL_V1`; later only if still
justified: Template direct manipulation, crop / focal point, Anatomy naming, Static picker WebP/GIF.

## 14. Delivery evidence

_Filled at closure: validation counts, implementation SHA, PR, merge SHA, Production deployment SHA, worker parity, Production smoke._
