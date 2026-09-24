# Portal Carousel Completion V1 — Slides 4–10

Status: implemented, validated locally and authored in production (10 slides saved). Pending: the operator's VPS worker update, then one final production smoke (§12).

## 1. Starting SHA

`3d0e7d148134e0192c2b2a306c56a6dfa29631f7` (local HEAD = origin/main = remote main; Vercel production READY). Portal carousel `1247e54b-8f55-492e-825d-ed9b927f2e63` had 3 slides (cover/dark, info/light, list/light).

## 2. Factual audit, Slides 4–10

Source: the official Pack A files (`docs/discovery/creative-rendering/visual-reference-pack/pack-a/004.png`–`010.png`; byte-identical to `D:\Trabalhos\Content Agent Studio\content-studio-ai-git\…\pack a\`).

| # | Title (exact) | Structure | Media in Pack A | Fits |
|---|---|---|---|---|
| 4 | Até a ficha catalográfica fala | intro · catalog-card document · 4 coloured category markers | the CIP (Catalogação-na-Publicação) card of the 1985 edition | **Lista** (markers = items with the `dot` icon; document = content image) |
| 5 | Alternativa a quê? | intro · 4 icon rows · illustration · closing callout box | mushroom-cloud-over-city illustration | **Lista** + one optional field (`callout`) |
| 6 | “Comunidade alternativa” já era um termo longo | intro · 6 icon tiles (typology) · heading + 6 small icon ideas | none | new **Grade** |
| 7 | Um “Brasil alternativo” estava sendo desenhado | intro · Brazil map with pins · 10-place legend + "e muitas outras…" · note paper | a drawn map (pins illustrative) | new **Mapa** |
| 8 | Como essas ideias circulavam? | kicker · intro · 9 linked publication cards (3/2/4) · radio callout + 7 bullets | none | new **Rede** |
| 9 | O retrato não era definitivo | intro · 3 bullets · pull-quote card · wide photo band · closing callout | sepia "gathering in a circle" image | new **Citação** |
| 10 | Um livro. Muitos caminhos para seguir. | 2 paragraphs · 6 icon-labelled materials · invitation + e-mail · brand · tagline | Portal logo (+ decorative moon/mountains) | new **Encerramento** |

The provisional map (4 list-adjacent, 5 list, 6 grid, 7 map, 8 network, 9 quote, 10 closing) was confirmed by the images.

## 3. Final Layout taxonomy (10 slides)

| Layout | Slides | Introduced |
|---|---|---|
| Cover | 1 | Template Foundation V1 |
| Info | 2 | Template Foundation V1 |
| Lista | 3, 4, 5 | Growth V1 (+ optional `callout` here) |
| Grade | 6 | this mission |
| Mapa | 7 | this mission |
| Rede | 8 | this mission |
| Citação | 9 | this mission |
| Encerramento | 10 | this mission |

## 4. Reuse decisions

- **Slide 4 → Lista.** Honest fit: title + intro + short items + one documentary image. Markers are items with the closed-set `dot` icon; no caption (Pack A has none).
- **Slide 5 → Lista.** Four icon rows (Lista's maximum) plus a closing thought → a bounded optional `callout` on dark paper. Lista's other behaviour is unchanged; the caption paper is now drawn **only when a caption exists** (it used to draw an empty scrap).
- **Cover/Info/Lista rejected for 6–10:** a typology of tiles, a geographic map, a linked network, a focal pull quote and a closing invitation are distinct compositions; forcing them into Lista would have made it a kitchen sink.

## 5. New Layouts (template-scoped, reusable)

| Layout | Content contract | Authored elements (stack back→front) |
|---|---|---|
| **Grade** `grid` (light) | title, intro?, tiles 2–6 {icon,label}, ideas_title?, ideas 0–6 {icon,label} | archival, botanicalLeaf, **tiles** (Grade de temas), note (Papel das ideias), paperStrip, tape1, title |
| **Mapa** `map` (light) | title, intro?, places 1–12 {name, uf}, places_more?, note? | botanicalLeaf, **map** (Mapa do Brasil), botanical, note, tape1, paperStrip, title |
| **Rede** `network` (dark) | title, kicker?, intro?, nodes 3–9 {title, subtitle?}, callout? {icon, text, bullets 0–9} | ornament, **cards** (Cartões da rede), callout, paperStrip, title |
| **Citação** `quote` (light) | title, intro?, bullets 0–4, quote, callout? + required content image | botanicalLeaf, hero (Imagem), callout, quote (Papel da citação), tape1, paperStrip, title |
| **Encerramento** `closing` (dark, night tone) | title (manual line breaks), body 1–3, items 0–6 {icon,label}, cta_title?, cta_text?, contact?, tagline?, brand_label? | ornament, botanicalLeaf, botanical, note (Papel do convite), tape1, title |

Rationale: each is the structure of one Pack A slide and a reusable editorial grammar (typology, geography, circulation network, pull quote, closing call-to-action), named for the grammar, never for the slide. Grouped content (tiles, map, network cards) is **one** authored element with one transform; per-item positions are template geometry.

## 6. Media / source inventory

| Slide | Media | Source | Provenance |
|---|---|---|---|
| 1 | Imagem principal | Template example image | unchanged (Growth V1) |
| 3 | Imagem do documento | Template example image | **original scan still missing** (Revista Planeta, 03/1983, "Anarquismo vivo") |
| 4 | Imagem do documento | **Real source**: CIP page of *O que são comunidades alternativas* (Tavares, Nova Cultural/Brasiliense, 1985) | local book scan `D:/Trabalhos/Comunidades Alternativas/fontes-locais/bibliograficos/carlos a. p. tavares/…Tavares.pdf`, PDF page 3 (index 2), rendered at 300 dpi, left page cropped around the CIP block to the frame ratio 0.70 → Portal LibraryFile `295d0550-77ae-4126-aadc-ccfcde327214` (`tavares-1985-cip-page.jpg`) |
| 5 | Imagem do documento | Pack A illustration (not a historical photograph) | crop of `pack-a/005.png` (x 612–1122, y 300–1029), no overlapping text → LibraryFile `4cd37593-fc4a-4cb4-81e1-61ecd863e5d8` (`pack-a-005-illustration.jpg`) |
| 7 | Brazil map | **IBGE** malhas API v3 (`paises/BR?intrarregiao=UF&qualidade=minima`), public open data, retrieved 2026-09-24 | code-drawn geometry `components/creative/documentary-card/brazil-uf-geometry.ts`; the slide credits "Base cartográfica: IBGE" |
| 9 | Imagem | Pack A illustration (not a verified historical photograph) | crop of `pack-a/009.png` (x 0–1122, y 885–1240) → LibraryFile `0daa8aaa-7fcf-49eb-b69c-ec446dee89ab` (`pack-a-009-illustration.jpg`) |
| 10 | logo | Project logo (existing fixture) | — |

The three files were uploaded through the production Arquivos page (Portal project, folder `/Portal Comunidades Alternativas`, `origin=upload`) and bound per slide through **Assets → Imagem principal → Trocar**. No flattened Pack A slide is used anywhere; every slide is built from text, slots, elements and the Template.

## 7. Missing source assets (EDITORIAL ASSET PENDING)

- **Slide 3** — the original Revista Planeta page (March 1983, "Anarquismo vivo", p. 17). Pack A's page is a generated re-creation with illegible pseudo-text; using it would fabricate a document. Template example image until supplied.
- **Slide 5** — uses the Pack A illustration; an editorial decision is needed whether a licensed archival image should replace it.
- **Slide 9** — uses the Pack A illustration, which *resembles* a historical photograph but is not a verified one; replace with a real archival photo, or keep it knowingly as an illustration.
- Slide 1 still shows the Template example image (as before this mission); the real book-cover photo would be the natural replacement.

## 8. Per-slide mapping

| # | id | Layout | Appearance | Content | Media / slots | Notable elements |
|---|---|---|---|---|---|---|
| 4 | slide-4 | Lista | Light | title, intro, 4 `dot` items (exact uppercase markers), no caption | hero = CIP page | Imagem do documento, Fita do documento |
| 5 | slide-5 | Lista | Dark | title, intro, items nuclear/globe/factory/cart, callout | hero = Pack A 005 illustration | Caixa de destaque (paperDark) |
| 6 | slide-6 | Grade | Light | title, intro, 6 tiles, ideas_title, 6 ideas | — | Grade de temas, Papel das ideias |
| 7 | slide-7 | Mapa | Light | title, intro, 10 places with UF, "e muitas outras…", note | IBGE geometry | Mapa do Brasil, Nota do mapa |
| 8 | slide-8 | Rede | Dark | title, kicker, intro, 9 nodes, radio callout + 7 bullets | — | Cartões da rede, Caixa de destaque |
| 9 | slide-9 | Citação | Light | title, intro, 3 bullets, quote, callout | hero = Pack A 009 illustration | Papel da citação, Imagem |
| 10 | slide-10 | Encerramento | Dark | title (3 lines), 2 paragraphs, 6 materials, invitation, contact, tagline; brand label = Project name | logo | Papel do convite |

Wording notes (exact Pack A, typographic normalisation only): Slide 7's quotes around *movimento alternativo tupiniquim* are normalised to “ ”; Slide 8's "rurâis" rendering glitch is written "rurais"; Slide 7's UFs are as printed in Pack A (not re-verified against the book).

## 9. Template contract lessons

- Layout ≠ slide: 5 new layouts cover 5 distinct grammars; 3 slides share Lista.
- No new Asset Slot was needed: every new element uses an existing slot (paperStrip, paperScrap, paperDark, paper, tape, botanical, botanicalLeaf, archival, ornament) or the content image.
- Transform channels are per slide, so layouts reuse existing channel keys (e.g. `card1` drives "Grade de temas", "Mapa do Brasil" and "Cartões da rede") — no persisted-schema change.
- Groups are single elements: Camadas stays short and meaningful.
- A **closed, code-drawn icon set** (`DOCUMENTARY_CARD_ICONS`, 27 icons) serves every icon-bearing layout; a new icon is one enum entry + one drawing.
- Geography is Template data (IBGE UF geometry + centroids), not an image slot, so pins stay truthful (state-level) and nothing can misalign them.
- Content editing: a descriptor per layout (`lib/creative/authoring/layout-content-fields.ts`) with the SAME bounds as the schema, and three bounded generic actions (`SET_CONTENT_VALUE`, `ADD_CONTENT_ITEM`, `REMOVE_CONTENT_ITEM`) — not a generic form engine. The Lista-only actions were retired.
- Template example content per layout lives in one pure module (`lib/creative/templates/layout-examples.ts`), copied per new slide (never aliased).
- Line-height: **not** needed; no typographic capability was added.

## 10. Local 1–10 render evidence

Exported worker (`node server.mjs` on the exported runtime) via the real chain: persisted Slides 1–3 + `createTemplateSlide` Slides 4–10 → enqueue compile → frozen snapshot → claim-time resolution → `/render-still`. All ten: HTTP 200, 1080×1350, correct layout dispatch, sequence 1/10…10/10, no binding errors. Media not yet uploaded at that point was injected as a local data URI (proof only). Evidence: `evidence/portal-carousel-completion-v1/local-renderstill-slides-1-10.jpg`. Local body text uses a serif fallback; the VPS bundles Source Sans 3.

## 11. Worker runtime artifact

- Worker-shared changes: `DocumentaryCard.tsx` (dispatch table), `ListVariant.tsx`, `types.ts`, new `GridVariant/MapVariant/NetworkVariant/QuoteVariant/ClosingVariant.tsx`, `layout-kit.tsx`, `icons.tsx`, `brazil-uf-geometry.ts`; `template-definitions.ts` (layouts/stacks). Coordinator/entrypoint bundles unaffected (claim resolution runs on the control plane).
- Tarball `infra/render-worker-runtime/dist/content-studio-carousel-completion-v1.tar.gz` — 56 files, sha256 `2f0c29570888b0082f6a72af7a5c39e1b45217fb97cef07a6c6d087188de5b67`; every packaged source file byte-identical to commit `379e8ee`.

## 12. Production smoke

Pending the operator's VPS update. Recorded after the smoke.

## 13. Final SHA

Recorded after delivery.

## 14. Before publication / export

- Supply or decide the pending editorial media (§7): Slide 3 Planeta scan; Slides 5 and 9 illustrations vs archival photos; optionally Slide 1's real cover photo.
- Human editorial review of Slide 7's UFs against the book and of the full wording.
- Final render of all 10 and ordered attachment (done in §12 for the current media); re-render any slide whose media changes.
- Export/publication (ZIP, scheduling, Instagram publishing) is out of scope of the Creative Editor today.
