---
title: Creative Editor — Template Foundation V1 + Pack B Slides 1–2
---

# Creative Editor — Template Foundation V1

Starting revision: `73ebbfef895963c6b5f72fe8ed3e331757c4010f` (local HEAD = origin/main = remote main = Vercel production, READY), after the operator closed Static Render Worker V1 in production (see `STATIC_RENDER_WORKER_V1.md`).

This mission uses the real Portal Comunidades Alternativas Pack B case to establish the platform's first reusable **Template** contract, rebuild Pack B Slides 1–2 from real transparent assets, and add only the authoring capability the reconstruction proved necessary: **per-slide element stack order**. It is not a Canva clone and not a Master/Template Editor.

## 1. Product model

```
Project → Production → EditorialContent → ChannelPiece → Creative Editor
                                                          └─ authors the piece USING a Template
```

A Template is a reusable **visual system**. It is not owned by a ChannelPiece (the piece's authored state only references `templateId`), and it is not an appearance.

| Concept | Meaning | Example |
|---|---|---|
| Template | Reusable visual system, code-backed | `editorial-documentary-collage-v1` · *Editorial Documentary Collage* |
| Layout | Template-scoped composition structure | `cover`, `info` (only meaningful inside this template) |
| Appearance | Rendering-style axis **of a layout** | `light`, `dark` |
| Asset slot | Semantic resource role a template defines | `tape`, `paperDark`, `ornament` |
| Element | One authored instance in a layout, referencing a slot | *Fita da nota* → slot `tape` |

**Template ≠ Appearance.** There is no "Dark Template": the model is *Template = Editorial Documentary Collage, Layout = Cover, Appearance = Dark*. Cover and Info both support Light and Dark.

`Cover`/`Info` are **not** universal slide types. A future template may have entirely different layouts. `List`, `Grid`, `Quote`, `Closing CTA` are deliberately not implemented.

## 2. Template registry (code, no DB)

`lib/creative/templates/template-definitions.ts` — pure data + pure functions, no imports (it ships in the VPS worker bundle).

```
TemplateDefinition
  id: 'editorial-documentary-collage-v1'      // project-neutral; no "Portal" in the id
  name: 'Editorial Documentary Collage'
  category, description
  renderer: { componentKey: 'editorial.documentary-card',
              templateRef: { id: 'editorial.documentary-card', version: '0.1.0', scope: 'system' } }
  assetSlots: Record<AssetSlotId, { label, material, defaultAsset{key,label,path,metrics}, projectCategory? }>
  layouts: [{ id, label, supportedAppearances, defaultAppearance, elements[], defaultStackOrder[] }]
```

API: `listTemplateDefinitions`, `getTemplateDefinition` (strict), `resolveAuthoringTemplate` (missing → first template; unknown → first template **flagged** `fallback: true`), `getTemplateLayout`, `isAppearanceSupported`, `layoutAssetSlots`.

**Code-backed renderer decision.** Rendering stays DocumentaryCard (`CoverVariant` / `InfoVariant`). The registry gives that renderer a product identity and declares its layouts, slots, elements and default stacks. There is no generic JSON scene renderer, no dynamic component loading, and no `templates` / `template_versions` table. The pre-existing renderer registry (`lib/creative/templates/registry.ts`, `editorial.documentary-card@0.1.0`) is unchanged; it validates manifests. The new definition points at it through `renderer.templateRef`, and the enqueue route rejects a mismatch (`TEMPLATE_LAYOUT_MISMATCH`).

## 3. Authoring state

- **`templateId` lives at the carousel root**, not per slide: `StaticAuthoringStateSchema.templateId` (optional on write for old clients, rejected if unregistered; read back as the default when absent).
- **Factual constraint that required a column:** `channel_piece_static_authoring_states.slides` is a JSONB **array**, so a root key cannot be added to it without reshaping it. Migration 035 therefore adds `template_id TEXT NOT NULL DEFAULT 'editorial-documentary-collage-v1'`. The one existing row (Portal) now reads `editorial-documentary-collage-v1`.
- **Per slide** (JSONB, backward compatible): `variant` (layout), `appearance`, `content`, `primitiveSelection` (asset choice), `primitiveTransforms` (7 new optional channels: `paperDark, botanicalLeaf, pin2, archival, ornament, note, card1`), `tuning`, and the new optional **`elementOrder`**.
- Cover content gains optional `brand_label` (Pack B's brand block shows the project name). When absent it is filled from the live Project name on load. That replaced the hardcoded `"Field notes"` placeholder.
- Legacy rows load unchanged. Missing channels are filled with neutral transforms, a missing `elementOrder` means the template default stack, and a missing `templateId` means the first template.

## 4. Asset slots vs elements (locked semantics)

- **Asset** = which resource fills a semantic slot → **Assets** tab. No X/Y there.
- **Element** = an instance in the composition → **Element** tab (transform + stack).

Multiple elements may share a slot. All tapes share slot `tape` (the Pack B references use one kraft tape everywhere), and *Faixa escura do título* shares `paperDark` with *Cartão 1*. Different elements may also use different slots: *Cartão 1* uses `paperDark` while *Cartão 2* uses `paper`.

**Project assets vs Template assets vs Content media.** Slots `paper` and `tape` are Project-selectable, backed by the two Portal LibraryFiles through the existing primitive catalog. Every other slot uses a template-bundled default under `public/creative-fixtures/pack-b/` (a future "Template Asset"). The hero is content media: the fixture hero, with no picker yet *(superseded: Authoring Usability Completion V1 made the hero and every slot replaceable with a Project LibraryFile — see `CREATIVE_EDITOR_AUTHORING_USABILITY_COMPLETION_V1.md`)*. Global Template Asset infrastructure is deferred; storage was not redesigned.

## 5. Element stack order

**Why now:** reconstructing Pack B put elements on the wrong side of each other (tape vs photo, pin vs card, title paper vs photo). Without authorable order, every fix is a code change. This is a small authoring-level control, not a Layers engine.

**Contract.**
- The template defines `defaultStackOrder` per layout (paint order, **back first → front last**).
- A slide may persist `elementOrder` (same convention). It is per slide, so Slide 1 never affects Slide 2.
- The UI shows it reversed: **top row = FRONT**. No numbers are ever shown, and nothing is typed.

**One normalizer** — `lib/creative/templates/element-stack.ts#normalizeElementOrder`:
missing or non-array → default; unknown ids and non-strings dropped; duplicates → first wins; an element the template gained later → inserted right after its nearest present default-order predecessor (or at the back), deterministically. Known persisted relative order is always preserved.

**Parity by construction.** `DocumentaryCard` itself calls `resolveElementStack(templateId, variant, elementOrder)`. The Editor preview and the worker's `renderStill` both render DocumentaryCard, so they cannot diverge. The request sends the full normalized order, the enqueue route re-normalizes it and **freezes** it into `render_executions.input_snapshot` (`templateId`, `elementOrder`, both optional so older snapshots still parse), and claim-time resolution passes it through untouched. Background chrome sits below the stack (z < 10), and template text sits above it (z ≥ 200).

**Camadas UX** (`components/creative/authoring/element-layers.tsx`, inside the existing Element tab). The list is compact and vertical-scrolling, with Frente/Trás cues and product labels only. Rows are dragged by the grip using **pointer events with pointer capture and stopped propagation**. HTML5 drag-and-drop was avoided because Dockview uses it for docking, so a row drag cannot move the floating Inspector (only its header can). ArrowUp/ArrowDown reorder a focused grip, clicking a row selects that element, and **Ordem padrão** restores the template stack. Slide-level *Restaurar padrão* also restores it, *Reverter* restores the persisted order, and Save/Autosave persist it through the same PUT. No new dependency was added.

Not implemented (by design): visibility eye, rename, delete, arbitrary new elements, groups, numeric z-index.

## 6. Pack B asset inventory (18 files)

Source: `docs/discovery/creative-rendering/visual-reference-pack/assets/pack-b-staging/`. All are RGBA with real alpha (0–255).

| File | px | Role | LibraryFile (Portal) | Slide 1 | Slide 2 |
|---|---|---|---|---|---|
| papers/paper-card-light-01.png | 1254² | light torn card | **yes** `afa6868e…` | Papel do título | Cartão 2 |
| tapes/tape-kraft-short-01.png | 2172×724 | kraft tape | **yes** `3f593474…` | Fita da imagem, Fita da nota | Fitas do ramo 1/2, Fita inferior |
| papers/paper-strip-light-01.png | 1448×1086 | light strip | no (bundled) | — | Faixa do título |
| papers/paper-card-dark-01.png | 1448×1086 | dark green card | no (**bundled, new**) | — | Faixa escura do título, Cartão 1, brand/intro chrome |
| papers/paper-scrap-light-01.png | 1254² | paper scrap | no (**bundled, new**) | Nota da edição | — |
| archival/paper-archival-fragment-01.png | 1448×1086 | archival/map fragment | no (**bundled, new**) | Fragmento de mapa | Fragmento de arquivo |
| pins/pin-brass-01.png | 1254² | brass pin | no (bundled) | — | Pins dos cartões 1/2 |
| botanicals/botanical-dried-sprig-01.png | 1086×1448 | dried sprig | no (bundled) | Botânica seca | Botânica seca |
| botanicals/botanical-sprig-large-01.png | 1254² | leaf branch | no (**bundled, new**) | Ramo de folhas | Ramo de folhas |
| ornaments/ornament-celestial-gold-01.png | 1254² | celestial ornament | no (**bundled, new**) | Ornamento celeste | — |
| tapes/tape-kraft-long-01.png | 2172×724 | long tape | no | not needed | not needed |
| frames/frame-paper-dark-celestial-01.png | 1254² | pre-composed frame | no | not needed | not needed |
| frames/frame-paper-light-01.png | 1254² | pre-composed frame | no | not needed | not needed |
| pins/pin-brass-02.png | 1254² | **byte-identical to pin-brass-01** | no | duplicate | duplicate |
| pins/pin-red-01.png, pin-red-02.png | 1254² | red pin (02 identical to 01) | no | not needed | not needed |
| references/reference-pin-sheet-01.png, reference-tape-sheet-01.png | 1254² | multi-object reference sheets | no | not placeable | not placeable |

**Uploaded:** none. **Reused LibraryFiles:** `paper-card-light-01`, `tape-kraft-short-01`, frozen by immutable LibraryFile id + sha256 at enqueue, presigned only at claim. **Bundled as template defaults (new):** 5 files, byte-identical copies. Frames were not used because they bake tape and botanicals into one PNG, which would defeat independently authorable elements.

Reference elements with **no source asset** in the set are not fabricated: the moon/mountain landscape, the real book-cover photo (the hero stays the template fixture until a hero picker exists), the books illustration, the real CA logo (the fixture logo is used), and the handwritten notes that are not part of the content schema.

## 7. Slide mappings (visible-bounds placement)

Every asset is placed by its **visible alpha bounds** (`AssetLayer`, metrics in the registry), on 1080×1350 reference coordinates.

**Slide 1 — Cover / Dark** (paint order back→front): `ornament` (Ornamento celeste) · `archival` (Fragmento de mapa, 90°, bottom-right) · `botanicalLeaf` (Ramo de folhas, mirrored) · `hero` (Imagem principal, 3.2°) · `botanical` (Botânica seca, over the photo edge) · `tape1` (Fita da imagem) · `note` (Nota da edição: paper scrap + detail_note, label bolded before ":") · `tape2` (Fita da nota, bridging note and photo) · `paper` (Papel do título, over the photo's left edge) · `title` (Título).
Template chrome: navy background, grain, gold sparkles, and a 1/N label. Template text: eyebrow with gold rule, subtitle, source line with gold dash, and the brand block (logo | PORTAL COMUNIDADES ALTERNATIVAS).

**Slide 2 — Info / Light**: `archival` · `botanicalLeaf` · `tape1` · `tape2` (Fitas do ramo) · `botanical` · `card1` (Cartão 1 = fact 1 on dark paper) · `pin` (Pin do cartão 1) · `paper` (Cartão 2 = fact 2 on light paper) · `pin2` · `tape3` (Fita inferior) · `paperStrip` (Faixa do título) · `paperDark` (Faixa escura do título) · `title` (split after the first comma: "UMA PERGUNTA," / "DUAS EDIÇÕES", gold underline) · `source` (Fonte, independent tuning — Title/Source independence preserved).
Template text: 2/N oval on a kraft label, body paragraphs with a gold rule, the annotation, the intro on a dark card (bottom-right), and the logo on a dark card (top-right).

Evidence (real exported-worker `renderStill`, left = render, right = Pack B reference):
`evidence/template-foundation-v1/slide-1-render-vs-pack-b.jpg`, `evidence/template-foundation-v1/slide-2-render-vs-pack-b.jpg`.

## 8. Render parity evidence

Real exported worker (`infra/render-worker-runtime/dist/content-studio`, `POST /render-still`, Remotion `renderStill`), driven by the production path: real Portal authored state → enqueue compile → frozen snapshot (LibraryFile paper/tape frozen) → claim-time resolution → worker.

| Render | Order | Result |
|---|---|---|
| Slide 1 default | template stack | 1080×1350 PNG, 11.5 s (cold bundle) |
| Slide 2 default | template stack | 1080×1350 PNG, 3.6 s |
| Slide 1 reordered | Imagem principal above Fita da imagem | pixels differ only in the tape/photo overlap region |
| Slide 2 reordered | Pin do cartão 1 behind Cartão 1 | pin head hidden by the card (`stack-reorder-renderstill.jpg`) |

The Editor preview renders the same DocumentaryCard with the same `templateId`/`elementOrder`; unit tests assert the z-index flip in the rendered markup and the wiring (preview props, request body, route freeze, worker forward).

### Production smoke (after the operator's VPS runtime update)

Commits `eb255b9` (feature) and `54f4136` (Camadas fix below) are READY on Vercel. The operator reported the VPS worker updated and healthy. The agent then drove the authenticated production Creative Editor (Portal carousel, ChannelPiece `1247e54b…`) at 1366×768:

- **Template tab:** Editorial Documentary Collage, Estrutura Cover/Info, Aparência Dark/Light. **Assets:** 7 slots on Cover with "Usado por". **Style:** identity typography. **Camadas:** front→back with product labels only.
- **Drag found a real bug.** The first drag committed nothing: the list scrolled under a stationary, captured pointer, and the target was computed from the `clientY` delta. Fixed in `54f4136` by hit-testing the row under the pointer, with a regression test. After the fix, a mouse drag put *Pin do cartão 1* behind *Cartão 1* (preview z 20 < 22). The floating Inspector did not move (969,111).
- **Gerar PNG on the VPS:** execution `6c2a9cd3…`, queue 7 s, render 18 s. The frozen snapshot holds `templateId` and `elementOrder` with `pin` before `card1`, plus the immutable paper/tape LibraryFile ids. Decoding the real PNG at the pin: dark card (≈45,51,37), versus brass (≈247,241,217) in the default stack. **Ordem padrão** then another render (`31c07938…`, 12 s) brought brass back (245,233,201).
- **Save round-trip:** a saved reorder persisted `elementOrder` on slide-2 only (slide-1 none) and `brand_label` on the Cover, and survived a reload. Ordem padrão + Salvar returned slide-2 to the template default.
- **Salvar nesta peça** (new path): `slide-2-de-2-31c07938.png` was created as `origin=studio_render` with `source_render_execution_id` and attached as carousel item 2.
- **Discovery:** Galeria lists "Creative Editor · Slide 1/2" and "· Slide 2/2" and no paper/tape. Arquivos lists paper/tape and no renders. The picker's "Imagens geradas" has the saved slides; "Arquivos do projeto" has only paper/tape. The piece media list labels saved renders "Imagem gerada".
- **Viewports:** 1366×768, 1440×900 (floating Inspector), 768×1024 and 390×844 (stacked). No body horizontal overflow at any size, Camadas fits with no row truncation, and header and toolbar are present.
- **VPS vs local reconstruction:** Slide 1 (`6bc5998e…`) and Slide 2 (`31c07938…`) are the reconstructed layouts (`evidence/template-foundation-v1/vps-production-slides-1-2.jpg`). On a 9×9 luminance grid the mean delta to the local exported-worker render is 7.6 / 6.1, versus 44.6 / 47.6 to the pre-mission layout. The residual is body text: the VPS uses the bundled Source Sans 3 as intended; the local Windows proof fell back to a serif.

## 9. Gallery vs Arquivos

Production smoke showed saved Creative Editor PNGs listed under Arquivos / "Arquivos do projeto". The fix changes **UI discovery**, not persistence (still one LibraryFile + one ChannelPieceMedia):

- Migration 035 adds `library_files.origin` (`upload` | `studio_render`, default `upload`) and `source_render_execution_id` (FK, `ON DELETE SET NULL`, only allowed on studio renders).
- `/api/channel-piece-media/upload` accepts an optional `renderExecutionId` and marks `studio_render` **only after** verifying (server-side) that it is the caller's own **completed `static_still`** execution for **this ChannelPiece**. `Salvar nesta peça` sends it.
- The backfill matched exactly the 2 operator-saved PNGs (`slide-1-de-2-d65f13ee.png`, `slide-2-de-2-54d56b3c.png`) to their executions by owner + completed static execution + exact saved-filename pattern. The other 7 files stay `upload`.
- **Arquivos** lists `origin=upload`. **Galeria** adds studio renders as a third, isolated source (tagged `source: 'studio_render'`). **Adicionar mídia:** "Imagens geradas" = AI images + studio renders; "Arquivos do projeto" = uploads. The piece's media list labels a saved render "Imagem gerada".
- Unchanged: scratch renders (not LibraryFiles until the explicit save, so never in Galeria), AI image Gallery items, video Gallery federation, ChannelPieceMedia semantics, and approval (nothing is auto-approved). `/api/library-files` without `origin` still returns everything, so the video-scene picker is unaffected.

## 10. Future Master / Template Editor (recorded, not built)

Three authoring levels: **Produce** (automatic generation), **Edit** (this Creative Editor), **Master / Template development** (a visual editor that creates Templates: layers, arbitrary placement, rename, z-order, asset-slot definition, editable/locked roles, layout authoring, template saving). Today the code and the agent act as the Master Editor. `TemplateDefinition` is the contract such an editor would eventually produce. No persistence for it was added.

## 11. Deferred

- **Add Slide** (the "+" workflow), **layouts 3–10** (Pack A structure in the Pack B visual system), a hero/content-media picker, handwritten annotations as content, render-all/batch/ZIP.
- Template Asset storage (global, template-owned), a DB template catalog, visibility per element instance, and the Master Editor.
- Reel (1080×1920) uses the same coordinates scaled by canvas size. It renders but has not been art-directed.
