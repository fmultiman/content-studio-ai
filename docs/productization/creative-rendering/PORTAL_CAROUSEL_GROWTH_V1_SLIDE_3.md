# Portal Carousel Growth V1 — Add Slide + real Slide 3

Status: delivered. The production smoke passed after the operator's VPS update (§15); one smoke finding was fixed in `bce02e8`.

## 1. Starting SHA

`81471963f926fdd20435e55f6527714166bf2f58` (local HEAD = origin/main = remote main; Vercel production READY on it). Portal carousel ChannelPiece `1247e54b-8f55-492e-825d-ed9b927f2e63` had 2 persisted slides (`slide-1` cover/dark, `slide-2` info/light), no element-order or asset overrides.

## 2. Pack A Slide 3 — factual anatomy

Reference: `docs/discovery/creative-rendering/visual-reference-pack/pack-a/003.png` (1122×1402).

| Part | Content |
|---|---|
| Sequence | `3/10` badge, top left |
| Title | "QUEM ESTAVA FAZENDO ESSA PERGUNTA?" (display serif, 2 lines) |
| Intro | "**Carlos A. P. Tavares** (1956–) escrevia sobre aquele universo no momento em que ele se organizava." |
| Row 1 (microphone) | "Apresentava o programa **Sociedade Alternativa,** na Rádio Gazeta AM de São Paulo." |
| Row 2 (pencil) | "Escrevia a coluna **Anarquismo Vivo,** na revista **Planeta.**" |
| Row 3 (open book) | "Formado em Jornalismo pela Faculdade Cásper Líbero. Trabalhou como bancário e livreiro." |
| Content image | A magazine page, "ANARQUISMO VIVO — Por Carlos Tavares", dated 04/83, with a Krishnamurti photo |
| Caption | "Revista Planeta, março de 1983, texto “Anarquismo vivo”." |
| Decoration | Botanical branch (top right), dotted constellation, waveform line (bottom) |

The magazine page in Pack A is a generated re-creation: its body text is illegible pseudo-text. It is **not** the original scan.

**Original content image: not found (missing human input).** Searched: every repo path; the local `D:/Trabalhos/Comunidades Alternativas` and `Comunidades` source folders (only the Tavares book PDF exists, no Planeta scan); and all Portal `library_files` rows (paper, tape and studio renders only). Nothing was fabricated. Slide 3 shows the Template's example content image, exactly as Slide 1 does today, until someone uploads the real scan (Revista Planeta, March 1983, "Anarquismo vivo", p. 17) to the Portal Library and picks it in **Assets → Imagem principal → Trocar**. No code change is needed for that.

## 3. Quick structural scan, Slides 3–10 (provisional)

| Slide | Structure | Fits |
|---|---|---|
| 3 | Title, intro, 3 icon rows, document image + caption | **Lista** |
| 4 | Title, intro, catalog-card image (document), 4 legend bullets | Lista-like (document + short list); may need a "document" variant |
| 5 | Title, intro, 4 icon rows, large illustrative image, callout box | **Lista** (+ callout) |
| 6 | Title, intro, 6 icon tiles (grid) + 6 small icon chips | Grid (not built) |
| 7 | Title, intro, Brazil map with pins, legend list, note card | Map/legend (not built) |
| 8 | Title, subtitle, network of 9 publication cards, radio callout with bullets | Network/grid (not built) |
| 9 | Title, intro, bullet list, quote card, photo, callout | Quote + list (not built) |
| 10 | Title, text, 6 icon row, CTA, brand closing | Closing CTA (not built) |

"Icon-led rows + one documentary image + caption" recurs in Slides 3 and 5, and partly in 4 and 10.

## 4. Existing layout vs new layout

- **Cover:** a title on paper, subtitle, a hero and an edition note. No list rows; wrong hierarchy.
- **Info:** a two-strip title, 1–2 body paragraphs and 1–2 fact cards. It has **no content image** (no `hero` element) and no icon rows. Three rows would have to be forced into body paragraphs, and the document plus caption would have nowhere to go.
- **Decision:** add exactly ONE semantically named, reusable, code-backed layout, **`list` ("Lista")**, in `editorial-documentary-collage-v1`. It is justified by the recurrence in §3; it is not a Slide-3-only one-off. Grid, map, network, quote and closing-CTA structures were *not* built.

## 5. Add Slide contract

- **UI:** a compact **"+"** (`aria-label="Adicionar slide"`) beside the slide navigation. The navigation now shows for any carousel, including a 1-slide one. It opens the **Adicionar slide** dialog:
  - **Template:** read-only (the carousel's Template).
  - **Estrutura:** the Template's layouts (Cover, Info, Lista).
  - **Aparência:** the selected layout's supported appearances, defaulting to the layout default.
  - Buttons: **Cancelar** / **Adicionar slide**.
- **Effect:** the new slide is appended (`order = max(order) + 1`) with a unique, stable id (`nextSlideId`: `slide-<n>` past the highest numbered id, never reusing one). It is **selected** immediately.
- **Cap:** 20 slides (Instagram's carousel limit); the "+" disables with a tooltip.
- **State semantics:**
  - Adding marks the draft dirty ("Alterações não salvas").
  - **Voltar ao salvo** restores the saved collection, which removes the unsaved slide.
  - **Salvar** persists it; reload restores it.
  - Autosave uses the existing semantics (off by default, 600 ms debounce, same PUT).
- **Totals are the collection's:** the header indicator, the nav buttons (`1/3 2/3 3/3`), the render `slide {index,total}`, the manifest `sequence` and the saved PNG filename (`slide-3-de-3-…`) all derive from `slides.length`. No hardcoded 2 remains on these paths.
- **Not built (non-goals):** delete, duplicate, reorder, render-all, ZIP.

## 6. Default slide initialization

`createTemplateSlide({ templateId, layoutId, appearance?, id, order, primitiveProjectRef })` in `lib/creative/authoring/carousel-state.ts`:

- It validates the layout against the Template and returns `null` for an unknown template or layout.
- Appearance is honoured only if the layout supports it; otherwise the layout default applies.
- Content is the layout's example content (`defaultContentForVariant`).
- Slots use the Project paper/tape primitives when the Project has a catalog; otherwise the Template defaults.
- Transforms and tuning are neutral.
- There is **no `elementOrder`** (so the layout's default stack applies) and **no `assetOverrides`**.
- It never clones another slide (a test proves an edited slide does not leak into a new one).

Two existing paths now use the same initializer:

- `defaultCarouselSlides` (first open: cover/dark + info/light, unchanged output).
- **Restaurar padrão do Template**, which now resolves the default **by the slide's layout**. It used to match by position (`order`), which would have given a third slide the wrong default.

## 7. Slide 3 content mapping (`DocumentaryCardListContentSchema`)

| Field | Value |
|---|---|
| `title` | Quem estava fazendo essa pergunta? (rendered uppercase) |
| `intro` | `**Carlos A. P. Tavares** (1956–) escrevia sobre aquele universo no momento em que ele se organizava.` |
| `items[0]` | `microphone` · `Apresentava o programa **Sociedade Alternativa,** na Rádio Gazeta AM de São Paulo.` |
| `items[1]` | `pencil` · `Escrevia a coluna **Anarquismo Vivo,** na revista **Planeta.**` |
| `items[2]` | `book` · `Formado em Jornalismo pela Faculdade Cásper Líbero. Trabalhou como bancário e livreiro.` |
| `image_caption` | Revista Planeta, março de 1983, texto “Anarquismo vivo”. |

- Schema: items are bounded 2–4; icons are a closed, code-backed set (`microphone`, `pencil`, `book`); `intro` and `image_caption` are optional.
- `**…**` is the one bounded emphasis marker (bold only), because Pack A sets names in bold mid-sentence. It applies to List text only.
- These values are the List layout's Template example content, the same pattern as Cover/Info carrying Pack B Slides 1/2.
- The Content tab edits all of it: title, intro, per-item icon and text, add/remove item within 2–4, and caption.

## 8. Slide 3 asset mapping

| Element (label) | Slot | Resource today |
|---|---|---|
| Imagem do documento | `hero` (content image) | Template example image. **Missing human input:** the original Planeta scan (§2). |
| Faixa do título | `paperStrip` | Template default |
| Fita do documento, Fita da legenda | `tape` | Project primitive (tape-kraft-short-01) |
| Papel da legenda | `paperScrap` | Template default |
| Ramo de folhas | `botanicalLeaf` | Template default |
| Botânica seca | `botanical` | Template default |
| Fragmento de arquivo | `archival` | Template default |

Brand mark: the Project logo, top right. Icons are code-drawn SVG line icons.

## 9. Template slots/elements added

- **Slots added: none.** List reuses existing material slots plus the `hero` content-image slot.
- **Transform channels added: none.** The List elements reuse `paperStrip`, `tape1`, `tape2`, `note`, `botanicalLeaf`, `botanical` and `archival`.
- **New:** layout `list` with 9 elements.
- **Registry:** renderer variant `list` registered in `editorial.documentary-card@0.1.0`, with content and assets schemas (hero required, logo optional).
- **Enqueue route:** a hero override now binds on any layout that draws the content image (`layoutUsesContentImage`: Cover, Lista), not only Cover.

## 10. Stack / defaults

`list.defaultStackOrder` (back → front): `archival, botanicalLeaf, hero, tape1, botanical, note, tape2, paperStrip, title`. Text chrome sits on the fixed top layer: sequence badge, intro, rows and brand.

Slide 3 persists no `elementOrder`, so it follows this default. Camadas reorders it per slide exactly as on Cover/Info.

Default appearance is Light; Dark is supported (dark green ground, cream text, gold icons).

## 11. Persistence

- `PersistedAuthoredSlideSchema.variant` now accepts `list`. No DB migration: slides are a JSONB array.
- A 3-slide state validates (unique ids and orders) and round-trips.
- The authored collection is **never** derived from ChannelPieceMedia.
- **Historical media, recorded and not auto-deleted:**
  - a duplicate Slide 2 render (`8a2a7f38…`), attached to the piece at position 2;
  - an unattached `studio_render` LibraryFile (`60e6bfe3…`).

## 12. Render parity

- One renderer path: `DocumentaryCard` → `ListVariant` in both the Editor preview and the worker's `renderStill`.
- `resolveElementStack` normalizes the same stack in both.
- The enqueue route freezes the snapshot as before (the template/layout match is checked before the hero binding).
- **Local proof:** real Portal state for Slides 1–2 plus a `createTemplateSlide` List Slide 3, going through enqueue compile → frozen snapshot → claim-time resolution → exported worker `/render-still`:
  - `evidence/portal-carousel-growth-v1/local-renderstill-slides-1-3.jpg` (Slides 1, 2, 3 Light, 3 Dark; sequences 1/3, 2/3, 3/3);
  - `evidence/portal-carousel-growth-v1/slide-3-pack-a-vs-render.jpg`.
- The local Windows proof renders body text with a serif fallback. The VPS bundles Source Sans 3, the same known residual recorded in Template Foundation §8.

## 13. Regression evidence, Slides 1–2

- Local exported-worker renders of Slides 1 and 2 are pixel-structurally unchanged; only the sequence reads x/3.
- Tests, all green:
  - the Template Foundation suite, updated only where it used `'list'` as its example of an unknown layout (now `'gallery'`) and for the moved TEMPLATE_LAYOUT_MISMATCH line;
  - the authoring usability suite;
  - the Camadas suite;
  - the documentary-card suite.
- The first-open default is still exactly cover/dark + info/light.

## 14. Worker impact

- **Worker-shared files changed:** `components/creative/documentary-card/DocumentaryCard.tsx` (routes `list`), the new `ListVariant.tsx` (added to `export.mjs` REQUIRED_WORKER_SOURCE), and `lib/creative/templates/template-definitions.ts` (List stack).
- The coordinator/entrypoint bundles are unaffected: claim-time resolution runs on the control plane.
- **VPS update required:** the old runtime would draw a `list` slide as Info.
- **Operator tarball:** `infra/render-worker-runtime/dist/content-studio-carousel-growth-v1.tar.gz`, 48 files, sha256 `a16bbfb068acf9cba9c6a1fadac6c90424b85b513963f7d09145ebdacae62657`.

## 15. Production smoke

Setup:
- Authenticated production Creative Editor, Portal carousel `1247e54b…`.
- VPS worker updated by the operator to `content-studio-carousel-growth-v1`, reported healthy. The agent did not observe the VPS directly; the renders below prove it.
- Web builds: `6951d77` (`dpl_8gnzWC13fepmHZ36M78NMbXEHV4i`), then the fix `bce02e8` (`dpl_21ijBFQe3fWQbEJmXkxRiZ5tMpwy`), both READY.

Add Slide:
- The "+" sits beside the nav (`1/2 2/2 +`). The dialog shows Template "Editorial Documentary Collage" read-only, Estrutura Cover/Info/Lista (defaulting to the current slide's layout) and its Aparência options.
- Choosing Lista switched the appearance to Light (the layout default).
- **Cancelar** changed nothing (1/2, "Salvo").
- **Adicionar slide** produced `1/3 2/3 3/3`, with 3/3 selected, a List card, a `3/3` badge and "Alterações não salvas".

**Finding, fixed during the smoke:**
- **Voltar ao salvo** after adding left the selected index (2) outside the restored 2-slide collection, and the editor stayed on its loader.
- Fix `bce02e8`: clamp the selection to the restored slides (regression test added).
- Re-smoked on `bce02e8`: add → 3/3 → Voltar ao salvo → `1/2 2/2`, 2/2 selected, "Salvo".

Content tab:
- Title, Introdução, 3 item editors (Microfone / Lápis / Livro + text, Remover), Adicionar item (enabled at 3/4) and Legenda da imagem, all holding the exact Pack A text.
- A caption edit showed on the Canvas live; the exact text was restored afterwards.

Save and reload:
- **Salvar** gave "Salvo"; after reload the header reads `1/3` with nav `1/3 2/3 3/3`, "Salvo".
- The DB row has 3 slides. `slide-3` is order 2, `list`/light, with no elementOrder and no assetOverrides. Slides 1–2 are untouched.

Slide 3 render on the VPS:
- Execution `96e83321…`: queued 22:26:56, claimed 0.7 s later, completed in 23 s; 1080×1350, 1.97 MB.
- The snapshot froze `list`/light, sequence 3/3, slide `slide-3` (3/3), templateId `editorial-documentary-collage-v1`, the default stack, and the Template hero fixture, with **no signed URL**.
- The PNG matches the local render, with the bundled Source Sans 3 (`evidence/portal-carousel-growth-v1/vps-production-slides-1-3.jpg`).

Regression:
- Slide 1 (`d25fa26d…`, cover/dark, 1/3) and Slide 2 (`7135c3b4…`, info/light, 2/3) rendered on the VPS in 10 s each.
- Their layouts are unchanged; only the sequences read x/3.

Save to piece and Gallery:
- **Salvar nesta peça** on Slide 3 showed "✓ Salvo nesta peça".
- A LibraryFile `9eadd82f…` (`slide-3-de-3-96e83321.png`, `studio_render`) is attached as ChannelPieceMedia at position 3, after the historical duplicate at position 2, which was left untouched (§11).
- `/api/render-executions` shows `attached_to_piece: true` for `96e83321` only. Galeria lists "Creative Editor · Slide 3/3".
- This attachment was kept as the piece's real Slide 3 output.

Viewports:

| Viewport | Workbench | Slide 3 | "+" visible | Horizontal scroll |
|---|---|---|---|---|
| 1366×768 | floating | list, 3/3 | yes | none |
| 1440×900 | floating | list, 3/3 | yes | none |
| 768×1024 | stacked | list, 3/3 | yes | none |
| 390×844 | stacked | list, 3/3 | yes | none |

At 390 px the Add Slide dialog fits (x 16–374) and reads "Será o slide 4/4". Cancelar left 3/3 "Salvo".

Autosave: its code path is unchanged (same dirty gate, debounce and PUT) and it stayed **OFF**. It was not toggled in production, because a 4th slide saved by autosave could not be removed without a Delete feature (out of scope).

## 16. Final SHA

- Code: `bce02e8f76f06b392afd2d3a0ce93c8af7c958b8`. It sits on top of `6951d77`, and both are READY on Vercel.
- The commit recording this smoke contains docs and evidence only.

## 17. Lessons for Slide 4

- Slide 4's content image is a **document** (a catalog card: CIP "Catalogação-na-Publicação"). Like Slide 3, it needs the real scan from a human. Check the Portal Library before building anything.
- Slide 4's anatomy (document + 4 short legend bullets) is close to Lista. First try Lista with `fit: contain` for a full-page document and plain bullets (a `dot` icon would extend the closed icon set by one entry), before adding any new layout.
- Keep every new icon in the closed set, code-drawn. The set grows only when a slide needs it.
- Slide 5 is the strongest second Lista user (4 icon rows); its callout box is the next likely optional List field.
- Use the local proof script pattern (real Portal state + `createTemplateSlide` + exported worker) before the VPS gate; it caught a misplaced decoration here before any deploy.
- Any change to the slide *count* must keep `currentSlideIndex` valid. Revert was the one path that shrank the collection; it is clamped now, and a future Delete must do the same.
- Piece media order is attach order, not authored order: the duplicate Slide 2 sits at position 2 and Slide 3 at position 3. Tidy the piece's media (a human decision) before publishing a carousel.
