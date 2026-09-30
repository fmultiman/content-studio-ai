# STATIC_TEMPLATE_VISUAL_UNIT_AND_ELEMENT_COVERAGE_AUDIT_V1

Read-only factual audit. No source, schema, renderer, worker, Auth or data was changed. Every **CURRENT FACT** below was read from executing code
(`components/creative/documentary-card/*`, the Template registry, the authoring reducer/schemas and the Static editor page) on the commit named below.
Where something could not be proven from code it is marked **NOT PROVEN**.

Labels used throughout: **CURRENT FACT** (code-proven) · **HUMAN-OBSERVED PRESSURE** (from the reviewer's screenshots/report) · **AUDIT FINDING** (an inference I drew from the facts) ·
**RECOMMENDED DECISION** · **DEFERRED / NOT PROVEN**.

## 0. Provenance and method

| Item | Value |
| :--- | :--- |
| Starting SHA (`origin/main`) | `9311f87d4214080433d0542c71805467165bf9a6` |
| Baseline records read first | `CREATIVE_EDITOR_INSPECTOR_AND_TEMPLATE_ANATOMY_MODEL_V1.md` (modeling `1a7ee0f`, merge `5e213b9`), `STATIC_TEMPLATE_ANATOMY_TREE_V1.md` (impl `f517f88`, PR #57, merge `6796af4`) |
| Branch | `audit/static-template-visual-unit-element-coverage-v1` (docs only) |
| Method | Full read of all 8 layout renderers + `primitives.tsx`, `layout-kit.tsx`, `DocumentaryCard.tsx`; Registry (`template-definitions.ts`, `template-anatomy.ts`, `element-stack.ts`); content schema and Content-tab descriptors; reducer, persisted schemas, transform/tuning controls; `ElementLayers`, `TemplateElementsTab`, `FreeSceneElements`, `StyleSourcePanel`; Project Identity adapter; runtime font registry; the two Pack B reference PNGs. |
| Not done (by design) | No fixtures mutated, no app run, no production access, no Auth. No test suite run: the audit needed source reading, not behaviour proof. |

### Code surfaces inspected

`components/creative/documentary-card/{CoverVariant,InfoVariant,ListVariant,GridVariant,MapVariant,NetworkVariant,QuoteVariant,ClosingVariant,DocumentaryCard,primitives,layout-kit,types,icons}.tsx` ·
`lib/creative/templates/{template-definitions,template-anatomy,element-stack}.ts` · `lib/schemas/creative/documentary-card.ts` ·
`lib/creative/authoring/{authoring-state,reducer,types,carousel-state,layout-content-fields,asset-slots,render-request}.ts` ·
`lib/creative/primitives/transforms.ts` · `lib/creative/integration/project-identity-adapter.ts` · `lib/creative/typography/{resolve-typography,prepare-typography}.ts` ·
`lib/creative/assets/resolve-asset.ts` · `lib/creative/context/static-authoring.ts` · `components/creative/free/free-stage.tsx` ·
`components/creative/video/{free-scene-panels,free-scene-overlay}.tsx` · `components/creative/authoring/{element-layers,template-elements-tab,primitive-controls,inspector-panels}.tsx` ·
the Static editor page (`…/editar-visual/page.tsx`) · `components/projects/project-identity-form.tsx` ·
`docs/discovery/creative-rendering/visual-reference-pack/pack-b/{01,02}.png`.

## 1. Executive verdict

1. **The Template Element Registry is NOT complete enough to represent what users see.** Each layout registers only the *material/collage* units plus the title (and Info's source line). Almost all *narrative text* and the brand block are drawn on a **fixed top layer** (`fixedText`, `zIndex: STACK_TOP_Z`) with no Element identity, no visibility, no position and no place in the tree.
2. **There is no cross-cutting orphan the tree can show today**: intro, kicker, source line, body blocks, brand mark, tagline and the sequence badge exist visually and (mostly) as content fields, but are not Elements.
3. **Content coverage is worse than the Element coverage.** In the Static editor, Cover exposes only *Título* and *Texto* (`subtitle`), and Info only *Título/Introdução/Corpo*. `eyebrow`, `source_line`, `detail_note`, `brand_label` (Cover) and `fact_cards`, `source_line`, `annotation` (Info) are valid schema fields drawn on the slide yet **not editable in Static** — while the Video Scene editor already has descriptors for every one of them (`COVER_CONTENT_FIELDS`, `INFO_CONTENT_FIELDS`). The six structured layouts are fully editable.
4. **No compound Element needs spatial decomposition** to fix the reported pain. The problems are (a) missing Elements for fixed text/brand, (b) content children of paper materials (note, callout, caption, cards) that are not editable or nameable, and (c) one *presentation* child of Hero (its frame/backing).
5. **`font-size` is not representable** anywhere in Template authored state or the renderer for Template text (hard-coded constants per layout); only `lineHeight` is (Title). Custom/Free Text has discrete size steps only.
6. **The Style tab copy is stale** (Project Identity visual tokens have been adapted since `PROJECT_IDENTITY_VISUAL_TOKENS_V1`). Classified as UI truthfulness debt.
7. **A defect in the shipped anatomy tree was found**: `STATIC_TEMPLATE_ANATOMY_TREE_V1` places Info `tape3` ("Fita inferior") in *Cartão 2*; its geometry (bottom-left) and Pack B reference show it belongs with neither card. See G-14.
8. **Recommended first mission** `COVER_ELEMENT_COMPLETENESS_V1`, split into a UI-only Part 1 (content coverage, no renderer/worker impact) and a renderer-touching Part 2 (new Elements; worker impact YES). See §16.

## 2. Coverage model, gap classes, shorthand

**Owner categories** (mission §2): `ELEMENT` (Template Element) · `CHILD` (semantic child of a compound Element) · `CONTENT` (content field consumed by an Element) · `ASSET` (slot/resource) · `BACKGROUND` (layout-level grammar) · `CHROME` (derived, deterministic output) · `INTERNAL` (implementation detail) · `ORPHAN` (meaningful visible unit with no truthful authoring representation).

**Gap classes** (mission §21): 1 MISSING ELEMENT IDENTITY · 2 COMPOUND NEEDS DECOMPOSITION · 3 CONTENT FIELD GAP · 4 ASSET MODEL GAP · 5 STYLE CONTROL GAP · 6 TRANSFORM CONTROL GAP · 7 SELECTION GAP · 8 UI IA GAP · 9 STALE/FALSE COPY · 10 INTENTIONAL TEMPLATE CONSTRAINT · 11 INTERNAL — NO ACTION · 12 FUTURE MASTER/TEMPLATE CONCERN.

**Control shorthand** (all registered Elements also have the eye and a slot in the global paint order):
`T` = transform sliders: X/Y ±120 px, Rotação ±15°, Escala 0.5–2, Opacidade 0–1 (`PrimitiveTransformControls`) · `HT` = hero tuning: X/Y ±120 px, Rotação ±4°, Escala 0.9–1.15, no opacity (`HeroTuningControls`) ·
`TT` = title tuning: X/Y ±60 px, Rotação ±2°, plus Entrelinha when the layout Element declares `typography` (`TitleTuningControls`) · `ST` = `TT` without Entrelinha (Info `source`).

**Style shorthand:** `D` = display token (family + weight from Project Identity → Studio default) · `B` = body token family · `K` = hard-coded constant in the renderer (size, colour, line-height, letter-spacing, alignment). Sizes below are px on the 1080×1350 reference canvas.

## 3. Shared renderer facts (CURRENT FACT)

1. **Two paint planes inside the Template.** Registered Elements take `zIndex` from the normalized stack (`STACK_BASE_Z=10`, +2 per position, so ≤ ~40). Everything drawn as `fixedText` (or `STACK_TOP_Z`, `STACK_TOP_Z+1`) paints at **z ≥ 200**, above every stack member and unreachable by reorder. Custom Elements then sit above the whole Template.
2. **Chrome per layout**: background gradient (`isDark` variants), `GrainOverlay`, `Sparkle` stars at constant coordinates (Cover 6, List 3, Grid 2, Map 2, Network 3, Quote 2, Closing 4; Info none). Constants, not authored.
3. **Sequence badge** on every layout: derived from `context.sequence` (slide index, and total for aria only). Cover draws the number alone on a tan clipped scrap; the other seven use `SequenceBadge` (shared) / Info/List inline copies. Hard-coded colours, no Element.
4. **Brand block** (`BrandMark`: circular logo + optional `brand_label`): Cover, Info (logo only, on an unregistered dark paper card), List (logo only), Closing. **Grid, Map, Network, Quote draw no brand mark.**
5. **Logo source.** `authoring-state.ts` hard-codes `assets.logo = fixture:asset:comunidades-alternativas:logo-v1` (`public/creative-fixtures/comunidades-alternativas-logo-v1.svg`) for every non-"b" identity. It is **not** a Project Identity asset, **not** an asset slot (`AuthoringAssetSlotId` = 10 materials + `hero`), and cannot be replaced or hidden in the UI. It is a Portal-specific fixture bundled with the Template.
6. **Unregistered paper instances.** Info draws two `paperDark` cards with no Element identity (top-right brand card, bottom-right "intro" card); Network draws N `paperScrap` node cards inside the `cards` group.
7. **Transform channels are keyed by channel, not by layout+element.** `primitiveTransforms` uses fixed keys (`paper, paperStrip, tape1..3, botanical, botanicalLeaf, pin, pin2, paperDark, archival, ornament, note, card1`); `tuning` uses `hero/title/source`. Element ids are reused across layouts with *different* meanings (`note` = Nota da edição / Papel da legenda / Papel das ideias / Nota do mapa / Papel do convite; `paper` = Papel do título / Cartão 2 / Papel da citação; `callout`; `card1` drives Info card 1, Grid tiles, the Map and the Network cards).
8. **Layout switch** (`SET_VARIANT`) resets `contentOverride` (to that layout's defaults), `heroRef` and `elementOrder`, but **not** `primitiveTransforms`, `tuning`, `hiddenElements`, `assetOverrides` or Custom `elements`. AUDIT FINDING: a hidden `tape1` or a moved `note` carries onto the *semantically different* unit of the next layout; typed content is discarded.
9. **`kind` in the registry is loose**: `tiles` is `text`, `map` is `image` (it is code-drawn SVG, not an image slot), `note/callout/quote/cards` are `material` although they carry text. It is not a reliable capability discriminator.
10. **Typography faces are registered only in the render path** (`prepare-typography.ts`, worker `TypographyReadyBoundary`). No `@font-face`/`FontFace` registration exists in the browser editor code (only `next/font` for the app's own fonts). DEFERRED / NOT PROVEN visually: editor preview may substitute fallback fonts for `Fraunces`, `Source Sans 3`, `Space Grotesk`, `Inter` on machines that do not have them installed.

## 4. Cover — deep dive (reference case)

All eight human-observed items were verified against `CoverVariant.tsx`.

| # | Human observation | CURRENT FACT (code) | Owner today | Gap |
| :-- | :--- | :--- | :--- | :--- |
| 1 | Bloco de título: title + paper | `Papel do título` (`paper`, material `tornPaper`) and `Título` (`title`) are **sibling** layers, each its own Element. Title: 62 px `D` uppercase, letter-spacing −.02em, colour `#1b1a17` (K), width 500. | ELEMENT ×2 | 5 (no font size) |
| 2 | Intro text "Uma pergunta lançada…" | Content field `subtitle`, labelled **"Texto"** in Conteúdo. Drawn as `fixedText` at (74, 608), 30 px `B`, colour `text`, line-height 1.3 (K), `maxWidth` 470. No Element, no eye, no offset. | CONTENT + **ORPHAN** | 1, 3 (name), 6 |
| 3 | "Publicado originalmente em 1983." + short line | Field `source_line`. `fixedText` at (62, 798): 52 px gold rule `<span aria-hidden>` + 19 px italic `B`. **Not editable in Static** (no field in the inline Cover form; Video has "Linha de fonte"). | **ORPHAN**; rule = INTERNAL child | 1, 3 |
| 4 | Hero image + white backing + tape | `Imagem principal` (`hero`) is **one `<div>`**: a CSS frame (`background:#e8dcc3`, `padding:14`, box-shadow) around an inner surface with `backgroundColor: palette.paper` and the image (`cover`, or `contain` when the resolved asset says so; then the paper colour letterboxes). Tuning `HT`. `Fita da imagem` (`tape1`) is a separate `tape` Element. | ELEMENT (`hero`) with an **INTERNAL frame/backing** | 2 (presentation), 4 |
| 5 | Editorial note: text + paper + tape | `Nota da edição` (`note`) is an `AssetLayer` (`paperScrap`) whose **child** renders `detail_note` (label before the first `:` in bold, rest below; 21 px `B`, colour `#1b1a17`). `Fita da nota` (`tape2`) is separate. The text is a CHILD with **no editable field in Static** (Video: "Nota da edição"). | ELEMENT + CHILD(content) | 3, 2 (semantic child) |
| 6 | Decoration | `botanical` (Botânica seca), `botanicalLeaf` (Ramo de folhas), `archival` (label **"Fragmento de mapa"** here, **"Fragmento de arquivo"** in Info/List/Grid and in the slot), `ornament` (Ornamento celeste). Each `T`. Plus INTERNAL: 6 `Sparkle` stars, gradient, grain. | ELEMENT ×4; INTERNAL ×n | 8 (label drift) |
| 7 | Signature / branding | `BrandMark`: logo (`assets.logo` = hard-coded Portal fixture, 118 px circle) + divider + `brand_label` (uppercase display, ~26 px). `brand_label` is **derived** from the Project name at load (`variantHasBrandLabel`) and is not editable in Static. No Element, no slot. | **ORPHAN** (ASSET + CONTENT) | 1, 3, 4, 12 |
| 8 | Sequence / kicker / header chrome | Slide number: `CHROME` derived from carousel position (tan clipped scrap, 24 px `D`). Kicker "MEMÓRIA VIVA • LIVROS" = content field **`eyebrow`** (authored data, 21 px label-family, gold, .2em tracking, gold underline), fixed layer; **not editable in Static** (Video: "Chamada"). | number = CHROME; kicker = CONTENT + **ORPHAN** | 1, 3 |

AUDIT FINDING (Hero backing): the "white backing under the book" is **not** an asset, not template background and not a separate layer. It is a CSS frame plus a paper-coloured letterbox surface baked into the `hero` Element's box, so replacing the image can never remove it and it cannot be hidden. Which of the two (frame vs. letterbox) is visible on a given slide depends on the image's `fit`; **NOT PROVEN** for the reviewed slide without the asset. RECOMMENDED: treat the frame as a **presentation option of `hero`** (a semantic child), not a new spatial Element — a separate "backing" Element would have to inherit the hero's own transform to stay glued to it, which is an artificial split.

Reference (`pack-b/01.png`) also shows units the code never draws (mountains/moon illustration, handwritten tagline "Mais mundos são possíveis", top-right handwritten paper note). They are absent from current output, so they are **not** coverage gaps; they are DEFERRED template-authoring content (§14).

## 5. Layout matrices (all eight)

Columns: **Section** (as shipped in `template-anatomy.ts`, or *—* for none) · **Visible unit** · **Render source** · **Element id** · **Content field** · **Asset slot** · **Style** · **Controls** · **Class** · **Gap** · **Future owner**. Gap numbers refer to §15.

### 5.1 Cover

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Título | `div` z=stack | `title` | `title` | — | D, 62 K, colour K, lh authored (def 1.02) | TT+Entrelinha | ELEMENT | 5 | Element (keep) |
| Bloco de título | Papel do título | `AssetLayer` tornPaper | `paper` | — | paper | — | T | ELEMENT | — | Element (keep) |
| Hero | Imagem principal | `div` frame+`AssetSurface` | `hero` | (asset) | hero | frame K | HT | ELEMENT + INTERNAL frame | 2 | Element + presentation child "Moldura" |
| Hero | Fita da imagem | `AssetLayer` tape | `tape1` | — | tape | filter K | T | ELEMENT | — | Element (keep) |
| Nota editorial | Nota da edição (paper) | `AssetLayer` paperScrap | `note` | `detail_note` (child text) | paperScrap | 21 K, B | T | ELEMENT + CHILD | 3 | Element; text = content child |
| Nota editorial | Fita da nota | `AssetLayer` tape | `tape2` | — | tape | — | T | ELEMENT | — | keep |
| Decoração | Botânica seca / Ramo de folhas / Fragmento de mapa / Ornamento celeste | `AssetLayer` ×4 | `botanical`, `botanicalLeaf`, `archival`, `ornament` | — | 4 slots | filter K | T | ELEMENT | 8 (label) | keep |
| — | Introdução | `fixedText` | — | `subtitle` ("Texto") | — | B, 30 K, lh 1.3 K | none | **ORPHAN** | 1,3,6 | new Element `intro` |
| — | Fonte editorial + traço | `fixedText` + rule | — | `source_line` (no Static UI) | — | B italic 19 K | none | **ORPHAN** | 1,3 | new Element `source` |
| — | Chamada (kicker) | `fixedText` | — | `eyebrow` (no Static UI) | — | label/B 21 K, gold | none | **ORPHAN** | 1,3 | new Element `kicker` |
| — | Assinatura (logo + nome) | `BrandMark` fixed | — | `brand_label` (derived, no Static UI) | — (logo = fixture) | D | none | **ORPHAN** | 1,3,4,12 | new Element `brand` |
| — | Número do slide | fixed scrap | — | — (`sequence`) | — | D 24 K | none | CHROME | 10 | keep chrome (hideable later) |
| — | Fundo, grão, 6 estrelas | gradient, `GrainOverlay`, `Sparkle` | — | — | — | K/palette | none | BACKGROUND / INTERNAL | 11 | internal |

### 5.2 Info

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Faixa do título | `AssetLayer` paperStrip | `paperStrip` | — | paperStrip | — | T | ELEMENT | — | keep |
| Bloco de título | Faixa escura do título (only if 2nd line) | `AssetLayer` paperDark | `paperDark` | — | paperDark | — | T | ELEMENT (conditional) | 8 | keep |
| Bloco de título | Título (two lines, two colours) | one `div`, split by `splitInfoTitle` (comma / half) | `title` | `title` | — | D, 86/82 K, no lh | TT (no Entrelinha) | ELEMENT; split = INTERNAL | 5 | keep; document split rule |
| Cartão 1 | Cartão + texto (`primary`/`secondary`/`tertiary`) | `AssetLayer` paperDark + `factCard` child | `card1` | `fact_cards[0]` (**no Static UI**) | paperDark | D 84 K + B 30 K | T | ELEMENT + CHILD | 3 | Element; children = content |
| Cartão 1 | Pin | `AssetLayer` pin | `pin` | — | pin | — | T | ELEMENT | — | keep |
| Cartão 2 | Cartão + texto | `AssetLayer` tornPaper + `factCard` | `paper` | `fact_cards[1]` (**no Static UI**) | paper | same | T | ELEMENT + CHILD | 3, 8 (id `paper`) | Element; children = content |
| Cartão 2 | Pin | `AssetLayer` | `pin2` | — | pin | — | T | ELEMENT | — | keep |
| **Cartão 2 (shipped)** | Fita inferior | `AssetLayer` tape at (48,1012) rot 16 | `tape3` | — | tape | — | T | ELEMENT, **mis-sectioned** | **14** | Decoração |
| Fonte e crédito | Fonte (italic, rot −4) | `div` z=stack | `source` | `source_line` (**no Static UI**) | — | B italic 24 K | ST | ELEMENT | 3 | keep; make editable |
| Decoração | Ramo, Botânica, Fita do ramo 1/2, Fragmento de arquivo | `AssetLayer` ×5 | `botanicalLeaf`, `botanical`, `tape1`, `tape2`, `archival` | — | 4 slots | — | T | ELEMENT | — | keep |
| — | Corpo (2 parágrafos, divisor dourado) | `fixedText` | — | `body_blocks` ("Corpo") | — | B 29 K, lh 1.36 K | none | **ORPHAN** | 1 | new Element `body` |
| — | Anotação manuscrita (rot −6) | `fixedText` | — | `annotation` (**no Static UI**) | — | B italic 24 K | none | **ORPHAN** | 1,3 | new Element `annotation` |
| — | Introdução (uppercase, letter-spaced, on dark paper) | `STACK_TOP_Z+1` wrapper + **unregistered** paperDark | — | `intro` | paperDark (shared) | D 19 K | none | **ORPHAN** + unregistered paper | 1,4 | new Element `intro` (paper = child) |
| — | Cartão de marca (paper + logo) | fixed + **unregistered** paperDark + `BrandMark` | — | — (logo fixture) | paperDark (shared) | — | none | **ORPHAN** | 1,4,12 | new Element `brand` |
| — | Número (round-outlined on tan scrap) | fixed | — | — | — | D 34 K | none | CHROME | 10 | keep chrome |
| — | Fundo, grão | gradient, grain | — | — | — | K | none | BACKGROUND | 11 | internal |

### 5.3 Lista

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Faixa do título / Título | `AssetLayer` paperStrip / `div` | `paperStrip`, `title` | `title` | paperStrip | D 64 K, lh 1.04 | T / TT+Entrelinha | ELEMENT | 5 | keep |
| Hero · imagem do documento | Imagem do documento | `div` frame + `AssetSurface` (height 540/600 by `compact`) | `hero` | (asset) | hero | frame K | HT | ELEMENT + INTERNAL frame | 2 | Element + "Moldura" child |
| Hero · imagem do documento | Fita do documento | `AssetLayer` tape | `tape1` | — | tape | — | T | ELEMENT | — | keep |
| Legenda | Papel da legenda + texto | `AssetLayer` paperScrap + child | `note` | `image_caption` | paperScrap | B italic 23 K | T | ELEMENT + CHILD | 8 (id `note`) | Element; text = content |
| Legenda | Fita da legenda | `AssetLayer` tape | `tape2` | — | tape | — | T | ELEMENT | — | keep |
| Destaque | Caixa de destaque + texto + ícone folha | `AssetLayer` paperDark + child | `callout` | `callout` | paperDark | B 28 K, icon K | T | ELEMENT + CHILD | — | keep |
| Decoração | Ramo, Botânica, Fragmento | `AssetLayer` ×3 | 3 ids | — | 3 slots | — | T | ELEMENT | — | keep |
| — | Introdução (+ traço) | `fixedText` | — | `intro` | — | B 31 K | none | **ORPHAN** | 1 | new Element `intro` |
| — | Itens (2–4 linhas ícone + texto) | `fixedText` flex column | — | `items[].icon/text` | — | B 26 K; icon set K | none | **ORPHAN** (structured group) | 1 | new Element `items` (one, like `tiles`) |
| — | Marca (logo) | `BrandMark` fixed | — | — | logo fixture | — | none | **ORPHAN** | 1,4,12 | `brand` |
| — | Número, fundo, grão, 3 estrelas | — | — | — | — | K | none | CHROME / BACKGROUND | 10,11 | internal |

### 5.4 Grade

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Faixa / Título (`TitleOnStrip`, 58 px) / Fita do título | kit | `paperStrip`, `title`, `tape1` | `title` | paperStrip, tape | D 58 K | T / TT+Entrelinha / T | ELEMENT | 5 | keep |
| Grade de temas | 2–6 medalhões (ícone + rótulo) | `ElementGroup` (`card1` channel) | `tiles` | `tiles[]` | — | B 29 K; icons K | T | ELEMENT (compound, one transform) | — | keep one Element; tiles = content children |
| Ideias transversais | Papel + título + 0–6 ideias | `AssetLayer` paperScrap + child | `note` | `ideas_title`, `ideas[]` | paperScrap | B 27/19 K | T | ELEMENT + CHILD | 8 (id `note`) | Element; content children |
| Decoração | Ramo, Fragmento | `AssetLayer` ×2 | 2 ids | — | 2 slots | — | T | ELEMENT | — | keep |
| — | Introdução | `fixedText` | — | `intro` | — | B 31 K | none | **ORPHAN** | 1 | `intro` |
| — | Número, fundo, 2 estrelas | — | — | — | — | K | none | CHROME / BACKGROUND | 10,11 | internal |
| — | (no brand mark) | — | — | — | — | — | — | INTENTIONAL | 10 | — |

### 5.5 Mapa

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Faixa / Título (58) | kit | `paperStrip`, `title` | `title` | paperStrip | D 58 K | T / TT+Entrelinha | ELEMENT | 5 | keep |
| Mapa | Mapa do Brasil (27 UF paths, pins, "Base cartográfica: IBGE" credit) | `ElementGroup` (`card1`) | `map` (kind `image`, but code-drawn) | `places[].name/uf` | — (geometry K) | pin colours K | T | ELEMENT (compound); credit + pins INTERNAL | 8 (`kind`) | keep one Element |
| Nota do mapa | Papel + nota | `AssetLayer` paperScrap + child | `note` | `note` | paperScrap | B 25 K | T | ELEMENT + CHILD | — | keep |
| Nota do mapa | Fita da nota | `AssetLayer` tape | `tape1` | — | tape | — | T | ELEMENT | — | keep |
| Decoração | Ramo, Botânica | `AssetLayer` ×2 | 2 ids | — | 2 slots | — | T | ELEMENT | — | keep |
| — | Introdução | `fixedText` | — | `intro` | — | B 30 K | none | **ORPHAN** | 1 | `intro` |
| — | Legenda (pontos coloridos + nomes + `places_more`) | `fixedText` (does **not** move with the map) | — | `places[]`, `places_more` | — | B 26 K | none | **ORPHAN** (INTENTIONAL detach from map) | 1,10 | new Element `legend` |
| — | Número, fundo, 2 estrelas | — | — | — | — | K | none | CHROME / BACKGROUND | 10,11 | internal |

### 5.6 Rede

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Faixa / Título (62) | kit | `paperStrip`, `title` | `title` | paperStrip | D 62 K | T / TT+Entrelinha | ELEMENT | 5 | keep |
| Rede | 3–9 cartões + linhas tracejadas + nós | `ElementGroup` (`card1`): SVG links + N **unlabeled** `AssetLayer` paperScrap | `cards` (kind `material`) | `nodes[].title/subtitle` | paperScrap | D 21–24 K, B 17 K | T | ELEMENT (compound); links INTERNAL | 8 (`kind`) | keep one Element; nodes = content children |
| Destaque | Caixa + ícone + texto + tópicos | `AssetLayer` paperDark + child | `callout` | `callout.text`, `callout.bullets` (`callout.icon` **not** in descriptor) | paperDark | B 25/22 K | T | ELEMENT + CHILD | 3 (icon) | keep |
| Decoração | Ornamento celeste | `AssetLayer` | `ornament` | — | ornament | — | T | ELEMENT | — | keep |
| — | Chamada (kicker) | `fixedText` | — | `kicker` | — | B 27 K bold gold | none | **ORPHAN** | 1 | `kicker` |
| — | Introdução | `fixedText` | — | `intro` | — | B 28 K | none | **ORPHAN** | 1 | `intro` |
| — | Número, fundo, 3 estrelas | — | — | — | — | K | none | CHROME / BACKGROUND | 10,11 | internal |

### 5.7 Citação

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Faixa / Título (62) | kit | `paperStrip`, `title` | `title` | paperStrip | D 62 K | T / TT+Entrelinha | ELEMENT | 5 | keep |
| Citação | Papel da citação + aspas + texto (32/40 K by length) + fita | `AssetLayer` tornPaper + child; tape | `quote`, `tape1` | `quote` | paper, tape | D 40/32 K, marks 120 K | T | ELEMENT + CHILD | 8 (id `paper`) | keep |
| Hero · imagem | Imagem (wide, frame) | `div` frame + `AssetSurface` | `hero` | (asset) | hero | frame K | HT | ELEMENT + INTERNAL frame | 2 | Element + "Moldura" child |
| Destaque | Caixa + folha + texto | `AssetLayer` paperDark + child | `callout` | `callout` | paperDark | B 26 K | T | ELEMENT + CHILD | — | keep |
| Decoração | Ramo de folhas | `AssetLayer` | `botanicalLeaf` | — | botanicalLeaf | — | T | ELEMENT | — | keep |
| — | Introdução | `fixedText` | — | `intro` | — | B 29 K | none | **ORPHAN** | 1 | `intro` |
| — | Tópicos (0–4, marcador) | `fixedText` | — | `bullets[]` | — | B 25 K | none | **ORPHAN** | 1 | `bullets` |
| — | Número, fundo, 2 estrelas | — | — | — | — | K | none | CHROME / BACKGROUND | 10,11 | internal |

### 5.8 Encerramento

| Section | Visible unit | Render source | Element | Content | Slot | Style | Controls | Class | Gap | Future owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bloco de título | Título (72, `pre-line`) | `div` | `title` | `title` | — | D 72 K, lh 1.06 | TT+Entrelinha | ELEMENT | 5 | keep |
| Convite | Papel + envelope + `cta_title`/`cta_text`/`contact` | `AssetLayer` paperScrap + child | `note` | `cta_title`, `cta_text`, `contact` | paperScrap | B 30/25 K | T | ELEMENT + CHILD | 8 (id `note`) | keep |
| Convite | Fita do convite | `AssetLayer` tape | `tape1` | — | tape | — | T | ELEMENT | — | keep |
| Decoração | Ornamento, Ramo, Botânica | `AssetLayer` ×3 | 3 ids | — | 3 slots | — | T | ELEMENT | — | keep |
| — | Texto (1–3 parágrafos) | `fixedText` | — | `body[]` ("Texto") | — | B 29 K | none | **ORPHAN** | 1,3 (name) | `body` |
| — | Materiais (2–6 ícone + rótulo) | `fixedText` | — | `items[]` | — | B 21 K | none | **ORPHAN** | 1 | `items` |
| — | Divisor pontilhado | `fixedText` | — | — | — | gold K | none | INTERNAL | 11 | internal |
| — | Assinatura (logo + `brand_label`) | `BrandMark` fixed | — | `brand_label` | logo fixture | D | none | **ORPHAN** | 1,4,12 | `brand` |
| — | Tagline | `fixedText` | — | `tagline` ("Assinatura" in Conteúdo) | — | B 22 K gold | none | **ORPHAN** | 1,3 (name) | `tagline` |
| — | Número, fundo (night), 4 estrelas | — | — | — | — | K | none | CHROME / BACKGROUND | 10,11 | internal |

**Matrix totals (CURRENT FACT):** registered Elements 10/14/10/7/7/5/7/6 (Cover…Encerramento) versus meaningful fixed-layer text/brand units without identity 4/4/3/1/2/2/2/4 (+ Info's two unregistered paper cards). Note that in four layouts the fixed-layer text *is the layout's main narrative body* (Lista items, Encerramento body/items, Citação bullets, Info body blocks).

## 6. Compound Element audit

| Compound unit | Contained units | Recommended treatment (mission §8) | Persistence impact | Renderer impact |
| :--- | :--- | :--- | :--- | :--- |
| Cover title + paper | already two sibling Elements | **keep** (already split) | none | none |
| Cover / Lista / Quote **hero** | image + CSS frame + paper letterbox | **(3) one spatial Element, presentation child "Moldura"** (not a new Element) | optional boolean on `tuning.hero` | yes (hero div) |
| Cover **note** / Lista **caption** / Closing **convite** / Map **note** / Grid **ideas** | paper + text children | **(4) one spatial Element, separately editable content children** | none if the text is already a content field; content exposure only | none |
| Info **fact cards** | paper + 3 text lines + gold rule (+ pins are separate) | **(4)**; `fact_cards[i]` fields become content children | none | none |
| Lista / Encerramento / Quote **callout** | dark paper + icon (constant) + text | **(4)**; icon stays INTERNAL | none | none |
| Grid **tiles** | N icon medallions | **(1) keep one Element**; tiles are content items | none | none |
| Map | UF geometry + pins + IBGE credit | **(1) keep**; pins/credit INTERNAL; legend is a *separate* text unit by design | none | none |
| Network **cards** | N paper nodes + dashed links | **(1) keep**; nodes are content items; links INTERNAL | none | none |
| Quote **paper** | paper + open/close quote marks + text | **(4)**; marks INTERNAL | none | none |
| Info title | one text on two strips, split by comma/half | **(1) keep**; document `splitInfoTitle` as the rule | none | none |

**Verdict:** nothing requires a **spatial** split. Decomposition would be artificial for every compound above except that the Hero *frame* needs a presentation switch. The real deficit is **content children** (text inside papers) and **missing Elements for fixed text**.

## 7. Content coverage

Static editor (`page.tsx` Content tab): Cover and Info use **inline** fields; the six other layouts use `LAYOUT_CONTENT_FIELDS` via `LayoutContentForm`. Video Scene uses `COVER_CONTENT_FIELDS` / `INFO_CONTENT_FIELDS` for all eight.

| Layout | Field | Label in Static today | Consuming visual unit | Element | Editable in Static? | Video label / note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Cover | `eyebrow` | — | Chamada (kicker) | none | **No** | "Chamada" |
| Cover | `title` | Título | Título | `title` | Yes | Título |
| Cover | `subtitle` | **Texto** | Introdução | none | Yes | **Texto** |
| Cover | `source_line` | — | Fonte editorial | none | **No** | "Linha de fonte" |
| Cover | `detail_note` | — | Nota da edição (child of `note`) | `note` | **No** | "Nota da edição" |
| Cover | `brand_label` | — | Assinatura | none | **No** (derived from Project name) | "Nome da marca" |
| Info | `title` | Título | Título | `title` | Yes | — |
| Info | `intro` | Introdução | dark paper card, bottom-right | none | Yes | — |
| Info | `body_blocks` | Corpo (um parágrafo por linha) | Corpo | none | Yes | "Corpo" |
| Info | `fact_cards[]` | — | Cartão 1 / Cartão 2 | `card1`, `paper` | **No** | "Cartões" |
| Info | `source_line` | — | Fonte | `source` | **No** — an Element with a position control whose text is not editable | "Fonte" |
| Info | `annotation` | — | Anotação manuscrita | none | **No** | "Anotação" |
| Lista | `title`,`intro`,`items[]`,`image_caption`,`callout` | Título, Introdução, Itens, Legenda da imagem, Destaque final | title / intro / rows / `note` / `callout` | title, note, callout (intro, items none) | Yes | — |
| Grade | `title`,`intro`,`tiles[]`,`ideas_title`,`ideas[]` | Título, Introdução, Temas, Título das ideias, Ideias | … | title, tiles, note | Yes | — |
| Mapa | `title`,`intro`,`places[]`,`places_more`,`note` | Título, Introdução, Lugares, Linha final da legenda, Nota | … | title, map, note | Yes | — |
| Rede | `title`,`kicker`,`intro`,`nodes[]`,`callout.text/bullets` | Título, Chamada, Introdução, Cartões, Caixa de destaque (`callout.icon` not editable) | … | title, cards, callout | Yes | — |
| Citação | `title`,`intro`,`bullets[]`,`quote`,`callout` | Título, Introdução, Tópicos, Citação, Destaque final | … | title, quote, callout | Yes | — |
| Encerramento | `title`,`body[]`,`items[]`,`cta_*`,`contact`,`tagline`,`brand_label` | Título, **Texto**, Materiais, Convite—título/texto, Contato, **Assinatura** (= tagline), Nome da marca | … | title, note | Yes | — |
| all | *(fixed in code)* | — | "Base cartográfica: IBGE" (Map), envelope/leaf/icons, sequence number | — | No (INTERNAL/CHROME) | — |

Generic or misleading names (**do not rename yet**): Cover `subtitle` "Texto" → *Introdução*; Closing `body` "Texto" → *Mensagem*; Closing `tagline` labelled "Assinatura" while the visual signature is the brand block → *Frase final*; Info `annotation` → *Anotação manuscrita*; Cover `source_line` → *Fonte editorial*; `detail_note` → *Nota da edição* (already so in Video).

AUDIT FINDING: the Cover content tab in Static is a **regression against Video parity** of the same schema; exposing the missing Cover/Info fields needs **no schema, persistence, renderer or worker change** (the fields exist in `AuthoringCoverContent`/`AuthoringInfoContent`, and the descriptors exist). One caution: `SET_COVER_FIELD` writes `''` for optional fields whose schema is `min(1)`; the descriptor path (`SET_CONTENT_VALUE`) removes empty optionals, which is the safe path.

## 8. Asset coverage and the Assets tab

| Slot | Resource provenance / default | Elements consuming it (Cover / other layouts) | Shared? | Per-instance override | Replacement matches expectation? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `hero` (content) | Template example `documentary-card-hero-01.webp`, or a Project LibraryFile (`assetOverrides.hero` / `heroRef`), fit `cover` | `hero` (Cover *Imagem principal*, Lista *Imagem do documento*, Citação *Imagem*) | one image per slide | no | Changes only the image; the frame/letterbox **stays** (§4) |
| `paper` (tornPaper) | Template `paper-card-light-01`; Project primitive selection **or** `assetOverrides.paper` | Cover `paper`; Info Cartão 2; Citação `quote` | across layouts, one per slot | no | Replaced with `contain`; alpha bounds unknown |
| `paperStrip` | `paper-strip-light-01` | Info strip; title strip of Lista/Grade/Mapa/Rede/Citação | yes | no | Changes the strip in the layouts that share it |
| `paperDark` | `paper-card-dark-01` | Info `paperDark`+`card1` **+ two unregistered Info cards**; Lista/Rede/Citação `callout` | **yes: 3–5 uses per layout** | no | Changes Elements *and* non-Elements together |
| `paperScrap` | `paper-scrap-light-01` | Cover `note`; Lista `note`; Grade `note`; Mapa `note`; Encerramento `note`; Rede `cards` (N instances) | yes | no | Rede: replaces every node card |
| `archival` | `paper-archival-fragment-01` | Cover, Info, Lista, Grade | 1 per layout | no | — |
| `tape` | `tape-kraft-short-01`; Project primitive selection **or** `assetOverrides.tape` | Cover 2, Info 3, Lista 2, Grade 1, Mapa 1, Citação 1, Encerramento 1 (`tape1/2/3` are transform channels, **one asset**) | **yes: all tapes of a slide** | no | Replacing one tape replaces all |
| `pin` | `pin-brass-01` | Info `pin`, `pin2` | yes | no | — |
| `botanical`, `botanicalLeaf`, `ornament` | Template defaults | decoration Elements | 1 per layout | no | — |
| **logo** | hard-coded Portal fixture `comunidades-alternativas-logo-v1.svg` | Cover, Info, Lista, Encerramento brand blocks | yes | **no slot, no override** | Cannot be replaced or hidden (G-9) |
| UF geometry, icons | code | Mapa, Lista/Grade/Rede/Encerramento | n/a | n/a | INTERNAL |
| Custom Image | LibraryFile id on the Custom Element | Custom Elements only | no | per element | ✓ |

CURRENT FACT: there are two overlapping override mechanisms for `paper`/`tape` (Project primitive selection vs. `assetOverrides`) and material overrides are always fitted whole (`contain`), never by alpha bounds.

**Does Assets still deserve to be a primary tab?** Evidence-based answer:

| Assets provides unique value as… | Verdict |
| :--- | :--- |
| Resource inventory with **provenance** ("Template" vs "Projeto" badge, "Usado por") | **Unique today.** No other surface shows origin or sharing. |
| **Shared-resource management** (one replacement affecting many units) | **Unique and necessary for shared slots** (tape, paperDark, paperStrip, paperScrap). |
| Hero image replacement | **Better contextual** on the Hero Element (it is content, and owns the frame decision). |
| Logo / signature | **Not present at all** (G-9); would need a home. |

RECOMMENDED DECISION (do not remove now): keep the tab, but treat it as a **secondary "Recursos" surface** for *shared Template materials + provenance*, and move **Hero replacement** (and later logo) into the Element row. Re-evaluate after the Cover pilot proves Element-level replacement. Removing it earlier would delete the only place that exposes shared-slot semantics and provenance.

## 9. Authoring capability and typography coverage

### 9.1 Capabilities per control type (CURRENT FACT)

| Capability | Template text (`title`) | Template `source` (Info) | Template hero | Template material/compound (`T`) | Custom Text | Custom Image | Free Text/Image |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Selectable on canvas | **No** | **No** | **No** | **No** | Yes (overlay, *Select* mode) | Yes | Yes |
| Openable Inspector row | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Visibility (eye) | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Reorder / z-order | global stack (grip) | same | same | same | forward/backward within overlay | same | within slide |
| X / Y | offset px ±60 | ±60 | ±120 | ±120 | numeric % + drag | numeric % + drag | same |
| Rotation | ±2° | ±2° | ±4° | ±15° | **N/A** | **N/A** | N/A |
| Scale | no | no | 0.9–1.15 | 0.5–2 | N/A (resize) | N/A (resize) | N/A |
| Width / height | no | no | no | no | numeric % + drag handles | same | same |
| Opacity | no | no | no | 0–1 | no | no | no |
| Line-height | **Entrelinha** (all but Info) | no | N/A | N/A | no (const 1.08/1.3) | N/A | no |
| Font family | via Identity only (global) | same | N/A | N/A | role: Título/Texto (display/body) | N/A | role |
| Font weight | Identity token only | same | N/A | N/A | Identity token only | N/A | same |
| Font size | **no** (K) | **no** (K) | N/A | N/A | steps P/M/G/Título | N/A | steps |
| Text alignment | no (K) | no (K) | N/A | N/A | left/center/right | N/A | same |
| Text colour | no (K) | no (K) | N/A | N/A | roles (4) | N/A | same |
| Asset replacement | via Assets (`hero` slot) | N/A | via Assets | via Assets (per slot, all instances) | N/A | "Trocar" | "Trocar" |
| Fit / crop / presentation | N/A | N/A | none (`cover`/`contain` from asset) | none | N/A | cover/contain | same |
| Reset | "Restaurar elemento" | same | same | same | remove | remove | remove |
| Direct manipulation | **No** | **No** | **No** | **No** | Yes | Yes | Yes |
| Content mapping (row → field) | none | none | none | none | inline | inline | inline |
| Styles contextual mapping | **No** | **No** | **No** | **No** | **No** (roles live in the row, Estilo tab is global) | N/A | **No** |

### 9.2 Spatial transform vs typographic style (mission §12)

Spatial = x, y, width, height, rotation, scale. Typographic = family, weight, size, line-height, letter-spacing, colour, alignment.

| Template text unit | Spatial in authored state | Typographic in authored state | Typographic in renderer but not UI | Template constants only | Unsupported |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `title` (all except Info) | `tuning.title` X/Y/rot | `tuning.title.lineHeight` | family/weight from tokens (global) | **size** (Cover 62, Lista 64, Grade/Mapa 58, Rede/Citação 62, Encerramento 72), colour `#1b1a17`/`#23382c`, letter-spacing (−.02/−.01/.01 em), uppercase, alignment, width | per-element family/weight/size/colour |
| Info `title` | `tuning.title` X/Y/rot | none | — | sizes 86/82, colours, split rule | line-height, size |
| Info `source` | `tuning.source` X/Y/rot | none | family (body token) | 24 px italic, colour | line-height, size |
| Fixed-layer texts (intro, body, items, kicker, legend, tagline…) | **none** | none | family (body/display token) | all | everything |
| Custom Text | `box` (fractions) | `size` enum, `typography` role, `color` role, `align` | — | line-height 1.08/1.3, weight from token | numeric size, letter-spacing |

**AUDIT FINDING (typography gap): Título exposes *Entrelinha* but no size.** Line-height is a *multiplier of a font size the author cannot change*; bounds 0.8–1.5 protect a fixed 58–72 px headline. This is the concrete control-coverage gap the reviewer saw.

**Is `font-size` representable underneath?** **No** for Template text: it is a literal in each renderer (`fontSize: x(62)` etc.); it is absent from `TitleTuning`, the persisted strict schema (`carousel-state.ts`), the render-request `overrides` schema and `DocumentaryCardPreviewTuning`. Adding it means an **additive optional** field in all four plus a renderer change (worker-bundled). For **Custom/Free Text** it is representable *as steps only* (`size` enum → `FREE_TEXT_SIZE_SCALE` × shorter side: 38/54/81/119 px at 1080); a numeric size needs an additive optional `font_size` on the element (validated in `validateFreeCompositionShape`, honoured by `free-stage.tsx` and `deriveFreeSegment`) — JSON in the existing authored-state column, no SQL.

Future model consistent with the request: `Tamanho` numeric (bounded, unit = fraction of the shorter stage side to remain resolution independent) + quick presets `[P][M][G][Título]` that set that number; `Entrelinha` numeric/slider separately. No arbitrary fonts.

## 10. Project Identity / Styles truth

| Question | CURRENT FACT |
| :--- | :--- |
| What does Project Identity contribute? | `adaptProjectIdentityToVisualTokens` resolves `identity.visuals.colors.{background,foreground,accent,muted}` and `typography.{display_font,body_font}` (only `RUNTIME_FONT_REGISTRY` families), else `CREATIVE_IDENTITY_DEFAULTS`, per token independently. Fonts and display weight reach every layout (`tokens.typography.*`). |
| What does Template Appearance override? | `dark` replaces `background`, `foreground`, `paper`, `paperAlt`, `ink` with constants in `DocumentaryCard`. Most layouts also hard-code inks (`#1d2a22`, `#23382c`, `#1b1a17`, gold `#9a7a3a`/`#c9a45c`). |
| Effective colour consumption by Template layouts | Only Cover-light (gradient from `palette.background`, `text = palette.ink`) and the root fallback consume Identity colours visibly. `accent`/`muted` are effectively unused by Template variants (`BrandMark` receives `accent: gold`). **Font identity is the strong effect; colour identity is weak for Template.** |
| What do Free/Custom roles support? | Text `typography` (display/body) and `color` (foreground/background/accent/muted) resolve **directly** from the Identity snapshot. |
| What can a Template text Element override locally? | Only position, rotation and (Title) line-height. No role, size, colour or font. |
| **Is the Inspector copy stale?** | **Yes.** `StyleSourcePanel` says *"A Identidade do Projeto ainda não define tipografia nem cores visuais; estes valores não vêm dela."* and its doc comment says the adapter "does not read typography or colors". `project-identity-adapter.ts` reads `identity.visuals`; `project-identity-form.tsx` already exposes the pickers. The panel also shows "Padrão do Studio" regardless of whether Identity provided the value. A test (`authoring-usability.test.ts`) enshrines the false sentence. |

Classification: **G-3 STALE / FALSE COPY** (UI truthfulness debt). Not fixed here. Recommended treatment: a micro-fix outside the Cover pilot that states the real precedence (Identity → Studio default; Template Appearance overrides colour), and that lists the source of each shown value.

## 11. Selection coverage

| Concept | Where it lives | Reach |
| :--- | :--- | :--- |
| Canvas selected Element | `FreeElementsOverlay.selectedElementId` = **`openElementId`** | **Custom/Free only**; requires *Select* interaction mode; selecting also switches the tab to *Elementos*. The Template render layer has `pointer-events: none`. |
| Open accordion Element | `openElementId` (one variable) | Template rows (filtered to the current layout) **and** Custom rows share it: opening one closes the other |
| Template Element row | `TemplateAnatomyTree` row → `onToggle` | Opens its panel; **nothing is highlighted on the canvas** |
| Free/Custom selected Element | same `openElementId` | ✓ two-way (canvas ↔ row) |
| Content focus | none | No API to focus a Conteúdo field |
| Asset slot | `assetPickerSlot` (dialog state) | Independent |
| Style target | none | `StyleSourcePanel` takes only `tokens`; **Estilo does not change when a Custom Text is selected** (its style roles are edited in the Elementos row) |

Verified: the human observations hold. What is **missing for a Selection Parity mission**: (1) canvas hit targets for Template Elements; (2) a single "selected target" state that also accepts an *Estilo* and *Conteúdo* consumer; (3) `data-element-id` (today the renderer emits `data-element={label}`, a *label*, only on `AssetLayer`/`ElementGroup`; `title`, hero and fixed texts carry no marker).

**Which canonical Template Elements can become selection targets without changing persistence? All of them.** `openElementId` already accepts any registered Element id and nothing about selection is persisted. What is missing is hit-testing. Two options: preview-side overlay computed from DOM rects (no worker impact), or adding `data-element-id` to the renderers (behaviour-neutral but worker-bundled → redeploy). Orphans **cannot** be targets until they are Elements.

## 12. Anatomy vs Layers

CURRENT FACT: `elementOrder` persists a flat list of Template Element ids (`normalizeElementOrder` drops unknown ids and re-inserts new ones deterministically). Sections are derived and unordered. Paint order is **not contiguous per Section**: Cover's default stack (`ornament, archival, botanicalLeaf, hero, botanical, tape1, note, tape2, paper, title`) interleaves Decoração members with Hero.

AUDIT FINDING: this is exactly why the tree cannot itself be drag-orderable, and why the shipped "Ordem das camadas" block exists. The duplication reported is *visual*, not architectural: two projections of the same ids.

RECOMMENDED DECISION (future, not implemented, no persisted Section order): make them **two views of one state** — `ELEMENTOS [ Anatomia | Camadas ]`. *Anatomia* = Sections → Elements (rows with eye/panel; no grip). *Camadas* = the global back→front list with grip (today's `ElementLayers`). Compatible with authored state (no change) and with future Template/Master tooling (Template owns Sections + `defaultStackOrder`; the instance owns `elementOrder` + `hiddenElements`). Constraint to preserve: Custom Elements stay a separate overlay plane and must not appear in the Template *Camadas* list.

Also record: `data-testid="template-anatomy"` is used both by the Template-tab `TemplateAnatomy` and by `TemplateElementsTab`; they are never mounted together today (Radix unmounts inactive tabs) but the id is ambiguous (latent test hazard).

## 13. Control consistency (Template vs Custom vs Free)

| Kind | Position/size control | Reference frame | Notes |
| :--- | :--- | :--- | :--- |
| Template text | 3 sliders (X, Y ±60 px; rotation ±2°) + Entrelinha | **offset from Template geometry**, canvas px | bounded to protect the layout |
| Template image/material | 4–5 sliders (X, Y ±120 px; rotation; scale; opacity) | offset from Template geometry | hero has narrower bounds, no opacity |
| Custom Text/Image | 4 numeric % fields (X, Y, Largura, Altura) + Centralizar ↔ / ↕ + Palco inteiro + canvas drag/resize | **absolute box** in fractions of the stage | same component as Free |
| Static Free Text/Image | identical to Custom | same | `FreeSceneElements` is shared (also Video) |

AUDIT FINDING: Custom vs Free are **identical by construction**. The inconsistency is **Template vs Custom**, and it is partly *accidental* (slider vs numeric field) and partly *semantic* (relative offset vs absolute box — they are not the same authored concept and should not be forced into one capability set). RECOMMENDED (future): primary = direct manipulation + ergonomic slider/nudge controls with consistent labels ("Posição horizontal/vertical", "Girar", "Tamanho") and Centralizar/Preencher where meaningful; secondary "Precisão" disclosure with numeric X/Y/L/A (Custom) or px offsets (Template). Do not unify the underlying models.

## 14. Fonts, Template tab, ownership

**Font picker.** `RUNTIME_FONT_REGISTRY` = `Fraunces` (700), `Source Sans 3` (400, 600), `Space Grotesk` (700), `Inter` (400, 600), all `project_local` woff2 under `public/creative-fonts/`. Today the only picker is the Project Identity form (`Select` of family names, no preview). A picker can truthfully render each option in its own family **only if** the browser registers those faces; the editor has no `@font-face` for them (§3.10). So `FONT_PICKER_VISUAL_PREVIEW_V1` has a **prerequisite**: browser-side registration of exactly the registry files (no remote fonts, no arbitrary strings). Weight caveat: Fraunces/Space Grotesk exist only at 700, so a "regular" preview is not possible for them — preview at the registered weight.

**Template tab.** CURRENT FACT: the picker is titled *"Estrutura"* (id `static-layout-label`) while the mode panel and mission language say *Layout*; option labels come from the registry (`Cover` is English, the others Portuguese). `TemplateReference` (collapsed `<details>`, "Estrutura do template e do layout") shows `TemplateFamilyAnatomy` (4 generic regions, identical for every layout) and `TemplateAnatomy` (flat element list front-first + asset-slot list), which now **duplicates** the Elementos anatomy with less structure and more diagnostics. RECOMMENDED (future): Template = current Template + **Layout** picker (Portuguese labels, e.g. *Capa*) + one-sentence layout purpose + compact anatomy summary derived from Sections + **Aparência**; retire the diagnostic element/slot lists. Note the current layout switch discards typed content (§3.8), which the layout picker should warn about.

**Template ownership coupling (NOT decided here).** Costly-to-move couplings found: the Portal logo fixture and `brand_label`-from-Project are wired into the Template's authoring state; `EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE` is a code constant with `scope: 'system'` in `renderer.templateRef`, its default asset paths, `REQUIRED_STATIC_ASSETS` in the worker export, transform channel names in persisted schemas, and copy such as "Memória viva • Livros" in fixtures. Simple-to-move: layout/Section registry, labels, appearance. Moving ownership to project scope would need an asset/logo binding model first (G-9/G-12).

## 15. Gap register

| ID | Class | Finding | Layers |
| :--- | :--- | :--- | :--- |
| G-1 | 1 MISSING ELEMENT IDENTITY | Fixed-layer narrative text has no Element in any layout (Cover intro, source, kicker; Info body, annotation, intro; Lista intro, items; Grade/Mapa/Rede/Citação intro (+ kicker, legend, bullets); Encerramento body, items, tagline) | render, registry, UI |
| G-2 | 1 / 4 / 12 | Brand block (logo + label) is an orphan in Cover, Info, Lista, Encerramento; logo is a hard-coded Portal fixture, not a slot or Identity asset | render, asset |
| G-3 | 9 STALE / FALSE COPY | Style tab says Identity has no typography/colours (false since `PROJECT_IDENTITY_VISUAL_TOKENS_V1`); asserted by a test | UI |
| G-4 | 3 CONTENT FIELD GAP | Cover `eyebrow/source_line/detail_note/brand_label` and Info `fact_cards/source_line/annotation` are not editable in Static (Video has them) | content |
| G-5 | 3 (naming) | Generic labels: Cover `subtitle` "Texto", Closing `body` "Texto", Closing `tagline` "Assinatura" | content |
| G-6 | 5 STYLE CONTROL GAP | No font-size (Template text is constant); Entrelinha without size; no per-element colour/weight/alignment | style |
| G-7 | 2 (presentation) | Hero frame/letterbox is baked into `hero`; not hideable; survives image replacement | render |
| G-8 | 7 SELECTION GAP | Template Elements are not canvas-selectable; no shared target with Estilo/Conteúdo; renderer markers use labels, not ids | UI |
| G-9 | 4 ASSET MODEL GAP | No per-instance/per-element asset override; one asset per slot (all tapes, 3–5 `paperDark` uses incl. unregistered ones); two override mechanisms for `paper`/`tape` | asset |
| G-10 | 6 TRANSFORM CONTROL GAP | Template units: sliders with tiny bounds and different reference frame vs Custom numeric %; no width/height on Template Elements; fixed texts have no position at all | UI |
| G-11 | 8 UI IA GAP | Anatomy tree + duplicate "Ordem das camadas"; Template tab "Estrutura" duplicates Elementos; Assets tab semantics unclear; mixed EN/PT layout names | UI |
| G-12 | 12 FUTURE MASTER | Channel-keyed transforms/hidden ids drift across layouts on switch (§3.7–3.8); `kind` is not a real discriminator; Element ids overloaded per layout; ownership coupling | model |
| G-13 | 10 INTENTIONAL | Sequence badge is derived chrome; Grade/Mapa/Rede/Citação draw no brand; Map legend detached from the map group; icons/pins/links/credit/stars/grain/gradient INTERNAL | render |
| G-14 | 1 (defect in shipped registry) | `STATIC_TEMPLATE_ANATOMY_TREE_V1` lists Info `tape3` under *Cartão 2*. Geometry: `tape3` at (48,1012) w122 rot 16, Cartão 2 spans x 588–992; `pack-b/02.png` shows the bottom-left tape holding a books illustration the code does not draw. RECOMMENDED: move to *Decoração*. Not fixed here (read-only). | registry |
| G-15 | 8 | Label drift: `archival` is "Fragmento de mapa" (Cover) vs "Fragmento de arquivo" (Info/Lista/Grade and the slot) | UI |
| G-16 | 11 | Sparkle stars, grain, gradient, gold rules, dotted divider, quote marks, IBGE credit, dashed links, UF paths: no authoring identity needed | render |
| G-17 | (adjacent friction) | Layout switch discards typed content and leaves transforms/hidden/asset overrides in place | reducer |

## 16. COVER_ELEMENT_COMPLETENESS_V1 (proposed, not started)

Purpose: establish the pattern for closing G-1/G-2/G-4/G-5/G-7 on **one** layout and prove roundtrip.

**Deliver as two ordered parts; Part 2 starts only after Part 1 is merged and production-verified.**

### Part 1 — Cover content coverage (UI-only; renderer/worker/persistence impact NONE)
1. Static Cover Content tab uses `COVER_CONTENT_FIELDS` through `LayoutContentForm` (all six fields), replacing the inline form. Renames at the UI layer only: `subtitle` → *Introdução*, `source_line` → *Fonte editorial*, `detail_note` → *Nota da edição*, `eyebrow` → *Chamada*, `brand_label` → *Nome da marca*.
2. Optional-field removal semantics via `SET_CONTENT_VALUE` (never write `''`).
3. Fix `template-anatomy.ts` Info `tape3` membership (G-14) and the Cover label drift (G-15) in the registry label only if trivially safe.
4. Do **not** touch Style copy in this part (tracked separately as G-3).

### Part 2 — Cover fixed units become Elements (renderer + worker impact YES)
1. **New Cover Elements:** `kicker` (eyebrow), `intro` (subtitle), `source` (source_line + rule as child), `brand` (logo + label). The sequence number stays CHROME.
2. **Hero presentation child:** an additive optional `frame` boolean (default true) on the hero tuning; hides the CSS frame/backing. No new spatial Element.
3. **Paint order:** append the new ids to Cover's `defaultStackOrder` after `title` so the default render is unchanged; `normalizeElementOrder` already re-inserts unknown ids deterministically, so legacy orders load unchanged. They move from z ≥ 200 into stack z; only the sequence badge stays on the fixed layer.
4. **Position/visibility:** follow the `tuning.source` precedent — additive optional tuning keys (X/Y/rotation, `TitleTuning` shape) plus `hiddenElements` ids. Persisted strict schemas (`carousel-state.ts`, `render-request.ts`) gain optional keys; absent = today's render. No SQL, no `static-authoring-state` version bump if optional.
5. **Assets:** logo stays fixture/Identity-owned (visibility + position only); no new slot; hero replacement stays in Assets in V1 (a contextual "Trocar imagem" row action is out of scope).
6. **Sections (registry):** Cover = *Cabeçalho* (kicker) · *Bloco de título* · *Introdução* · *Fonte editorial* · *Hero* · *Nota editorial* · *Assinatura* · *Decoração*. Layout-scoped; still not persisted.
7. **Explicitly NOT in V1:** font size, colour/weight controls, Selection Parity, contextual Estilos, Assets-tab changes, other layouts, Custom Elements, Video, template ownership, sequence-badge hiding, new asset slots, any SQL.

**Persistence impact:** additive optional keys in JSON authored state (`tuning`, `hiddenElements`, `elementOrder`). **Renderer impact (Part 2):** `CoverVariant.tsx` (+ `DocumentaryCardPreviewTuning`), worker-bundled → **worker redeploy/restart required**, unlike `STATIC_TEMPLATE_ANATOMY_TREE_V1` (worker impact NONE). **Shared impact:** Video Scenes reuse `DocumentaryCard`; Cover in Video must be regression-tested and Video must **not** gain new Element timing here.

**Regressions to protect:** legacy Cover slides render pixel-identical with the new keys absent (existing render tests + a before/after PNG proof); legacy `elementOrder`/`hiddenElements`; Custom Elements remain an overlay above the Template; Free untouched; Info/other layouts untouched except the `tape3` section fix; carousel persistence (`static-authoring-state.v1`) strict-schema round trip; Video Cover scene render.

## 17. Rollout after Cover (chosen from code evidence)

| Step | Layouts | Why this grouping (code evidence) | New units |
| :--- | :--- | :--- | :--- |
| 1 | **Cover** | Pilot; also has the richest chrome | kicker, intro, source, brand, hero frame |
| 2 | **Lista** | Same hero/caption/tape grammar as Cover (`hero`, `note`, `tape1/2`, frame); reuses the frame flag and `brand` | intro, items, brand |
| 3 | **Encerramento** | Shares `BrandMark` + `brand_label` + note/tape grammar with Cover | body, items, tagline, brand |
| 4 | **Grade, Mapa, Rede, Citação** | One family: `layout-kit` (`TitleOnStrip`, `SequenceBadge`, `ElementGroup`), all fully editable in Content, only a fixed `intro` (+ `kicker`, `legend`, `bullets`) missing; one shared pattern applied four times | intro, kicker (Rede), legend (Mapa), bullets (Citação) |
| 5 | **Info** | Most orphaned and most bespoke: `body`, `annotation`, dark-paper `intro`, brand card, two unregistered `paperDark` cards, `fact_cards`/`annotation`/`source_line` **content** not editable in Static, and the `tape3` correction | see §5.2 |

Each step = bounded mission, renderer + worker deploy, additive keys only.

## 18. Inspector follow-up sequencing

| Item | Category | Depends on | Note |
| :--- | :--- | :--- | :--- |
| **Cover Part 1** (content coverage) | **BLOCKING DEPENDENCY** for Semantic Content | none | UI-only |
| Stale Style copy (G-3) | **REAL CURRENT FRICTION** (truthfulness) | none | tiny; can ship before or alongside Part 1 |
| Info `tape3` section fix (G-14) | REAL CURRENT FRICTION | none | one registry edit + test |
| **Cover Part 2** (Elements) | **BLOCKING DEPENDENCY** for Selection Parity on orphans, Contextual Styles | Part 1 | renderer + worker |
| Semantic Content (grouped by Section, Element links) | REAL CURRENT FRICTION | Part 1, Part 2 | |
| Numeric font size + Entrelinha model | REAL CURRENT FRICTION (Título has lh without size) | Element identities (for text Elements) | additive schema; renderer + worker; keep separate from Part 2 |
| Selection Parity | REAL CURRENT FRICTION | Element coverage; hit-testing choice (§11) | prerequisite of Contextual Styles |
| Contextual Styles | FRICTION → blocked | Selection Parity + font-size model | |
| Identity → Template → local overrides | FUTURE MASTER CONCERN (partly) | Contextual Styles | needs precedence/constraint model |
| Anatomia \| Camadas views | POLISH | none | cheap; no persistence |
| Assets tab → "Recursos" + hero/logo contextual | POLISH → decision | Cover Part 2 | keep tab until then |
| Geometry-control normalization | POLISH | none | do not unify models |
| Font picker preview | POLISH | browser `@font-face` registration | prerequisite is the real work |
| Template tab simplification / PT layout names | POLISH | none | |
| Resize vs Crop | POLISH (Free/Custom friction, independent) | none | |
| Protection/lock model, project-scoped ownership, Section ordering, Template constraints | **FUTURE MASTER CONCERN** | — | out of everyday editor |

## 19. Answers to the required final questions

1. **Is the Registry complete enough?** No. It covers the collage materials and the title; the layouts' narrative text and brand are fixed-layer orphans (G-1, G-2).
2. **Orphaned visible units:** Cover intro, source line, kicker, brand block; Info body, annotation, intro card, brand card; Lista intro, items, brand; Grade/Mapa/Rede/Citação intro (+ Rede kicker, Mapa legend, Citação bullets); Encerramento body, items, tagline, brand block. (Sequence badge is CHROME, not an orphan.)
3. **Improperly compound Elements:** none need a spatial split. Hero needs a *presentation* switch for its frame; paper-with-text units need editable **content children**, not new Elements.
4. **Visible text lacking semantic Content ownership in Static:** Cover `eyebrow`, `source_line`, `detail_note`, `brand_label`; Info `fact_cards`, `source_line`, `annotation`; plus Network `callout.icon`. (They have schema fields; the editor does not expose them.)
5. **Shared Assets vs Element-specific resources:** keep **shared**: tape, paperDark, paperStrip, paperScrap, pin, botanicals, ornament, archival (Template grammar). Make **Element-specific**: hero image (contextual), logo/brand (Identity- or project-owned), Custom images (already).
6. **Is Assets justified as a first-class tab?** Today yes (only provenance + shared-slot view); recommended to become a secondary "Recursos" once Element-level replacement exists. Do not remove now.
7. **Template text Elements lacking truthful typography controls:** every one lacks size, colour, weight, alignment; `title` has Entrelinha only; Info `title`/`source` have none; all fixed-layer texts have none.
8. **Is `font-size` representable?** Not for Template text (constants; needs additive optional field + renderer/worker + schemas). For Custom Text only as `size` steps; numeric size is an additive optional field, no SQL.
9. **Template Elements that can be selection targets without persistence change:** all registered Elements; only hit-testing is missing. Orphans need Element identity first.
10. **Anatomy and layers as two views?** Yes: two projections of one state (`elementOrder` flat, Sections derived); compatible with authored state and future Template/Master tooling. Sections are not contiguous in paint order, so they cannot be drag-ordered.
11. **What `COVER_ELEMENT_COMPLETENESS_V1` implements:** §16 (Part 1 UI-only content coverage; Part 2 four Elements + hero frame flag + Sections, worker impact YES).
12. **Safest rollout:** Cover → Lista → Encerramento → {Grade, Mapa, Rede, Citação} → Info (§17).
13. **Freedoms: everyday Creative Editor vs future Template/Master Editor.** *Everyday:* edit **every** visible text field; show/hide and bounded reposition of anatomy units; add Text/Image; hero/logo replacement; font from registry roles, size (numeric + presets) and Entrelinha; layer order. *Template/Master:* defining Sections and anatomy; splitting compound units or adding Element types; base geometry and absolute boxes; locks/protection and bounds; template-owned defaults and per-layout typography; project-scoped ownership; per-template constraints.

## 20. DEFERRED / NOT PROVEN

- Whether the reviewed slide's "white backing" is the CSS frame, the paper letterbox, or baked into the specific hero image (needs the asset; both mechanisms are code-proven).
- Editor-preview font substitution (no browser `@font-face`; not observed).
- Reference-only units in `pack-b/01.png`/`02.png` that current code does not draw (mountains/moon, handwritten notes, the books illustration).
- Layout-switch bleed of hidden/transform state: code-proven in the reducer; visual effect inferred.
- Any pixel-level behaviour: no rendering was run for this audit.

STATIC_TEMPLATE_VISUAL_UNIT_AND_ELEMENT_COVERAGE_AUDIT_V1_COMPLETE
