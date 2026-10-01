# STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1

Bounded structural implementation across **all eight Documentary layouts** (Cover, Info, Lista, Grade, Mapa, Rede, Citação, Encerramento) of the Static Template **Editorial Documentary Collage**: every meaningful, independent, visible unit is now its own authoring **visual atom** — its own Element identity, its own visibility, its own place in the real paint order and, when a file is behind it, its own Asset Slot.

Authority: `STATIC_TEMPLATE_VISUAL_UNIT_AND_ELEMENT_COVERAGE_AUDIT_V1`; builds on `STATIC_TEMPLATE_ANATOMY_TREE_V1`, `STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1` and `COVER_ELEMENT_COMPLETENESS_V1` (which made the Cover editorial note text an Element but still tied its visibility to the paper, and kept the Hero frame as a tuning toggle and the brand as one compound Element).

## Provenance

| Item | Value |
| :--- | :--- |
| Starting main SHA | `50b138b666c34a8f61c7c00e63ed8690442d9595` (merge of PR #77) |
| Implementation SHA | `ed2e90b1fc0e8e072ee248d015514cde4fa13933` |
| Worktree | the existing Static worktree `D:/Traycer/worktrees/fmultiman__content-studio-ai/traycer-witty-puma-23e2b43ebdbe` (no worktree created; neighbour worktrees untouched) |
| Branch | `feat/static-template-atomic-visual-elements-v1` |
| Migration | **none** — additive optional state only (see Backward compatibility) |

## The model (what "atom" means, and what it is not)

| Rule | Consequence |
| :--- | :--- |
| One visible unit = one Element | A paper and the text printed on it are two Elements; a photo and its frame are two; a logo and the brand name are two; two tapes are two even when they share the default `tape` resource. |
| No compound visibility | Hiding an Element hides exactly that Element. Nothing is hidden "because its parent is". |
| Sections stay derived UI metadata | Section (`template-anatomy.ts`) is still registry-only UI grouping: no persisted Group, no parent/child graph, not read by the renderer, the worker or any save/enqueue path. |
| An atom may *follow* an anchor's position, never its visibility | `control: { type: 'follows', parent }` = "takes the anchor's position/rotation/scale". An anchor is always an Element with its own spatial control (`transform` or `tuning`): no chains, no graph (asserted by test). |
| File-backed atoms own an explicit Asset Slot | `material` / `image` atoms declare `assetSlot`. Text and procedural atoms declare none — no fake asset is invented. |
| Procedural units are `kind: 'shape'` | Frames, links, pins, rules: Element identity and visibility, no file. |
| Fixed Template geometry is a first-class classification | `control: { type: 'fixed' }` — the atom is independent (visibility + paint order) but its position is part of the layout, so no spatial control is offered. |
| Real paint order | Every new atom has a `defaultStackOrder` slot and receives its z-layer from the normalized stack (`10 + 2·index`), exactly like the existing Elements. The sequence-number badge stays derived chrome on the fixed layer. |

Transform classification used below: **independent** (`transform` / `tuning`), **follows anchor**, **fixed geometry**.

### Registry / stack additions (worker-copied files)

- `TemplateElementControl` gains `{ type: 'fixed' }`; `TemplateElementDefinition.kind` gains `'shape'`.
- `stackPlacement` now accepts `'front' | { above: id } | { below: id }`: an atom the Template gained *after* a slide's paint order was saved is placed directly over/under its partner (text over its paper, frame under its image), or on top (former fixed-layer text), whatever the saved order is. Default rule (after the nearest preceding default neighbour) is unchanged for everything else.
- `replaces?: string[]` — a compound id persisted by an earlier mission keeps its meaning: hidden `brand` hides `brandLogo` **and** `brandName`; `brand` inside a saved order expands in place (`normalizeHiddenElements` / `normalizeElementOrder`). This is the only legacy compound (`brand`, introduced the day before by `COVER_ELEMENT_COMPLETENESS_V1`).
- New `logo` Asset Slot (content role, like `hero`): `AUTHORING_ASSET_SLOT_IDS`, `AuthoringAssetSlotId`, `contentImageSlots.logo`, `slotView`, `layoutUsesLogo`, `variantUsesLogo`.

### Renderer primitives (worker-copied)

- `AssetTextLayer` — the text printed on a paper as its **own** Element: a sibling of the paper's `AssetLayer` with the same box, rotation and transform channel (the anchor's position, opacity included), its own z-layer and its own visibility.
- `PlateFrame` / `PlateImage` — a framed content image split in two layers that use the **same inline geometry** (height/width + padding stay on the element so content-box (worker, no Tailwind) and border-box (editor) layouts stay identical). Hiding the frame only changes the image's *geometry* (it takes the whole plate — the existing "no frame" look), never its presence.
- `BrandMark show='logo' | 'name' | 'both'` — the signature is painted twice with the same container; the part not being painted keeps its layout space (`visibility: hidden`), so hiding the logo never moves the name and vice-versa, with no geometry maths.
- `layoutKit.fixedAtom(id)` — the former fixed-layer text units as stack-painted, hideable atoms (on top by default).

## CRITICAL COVER RULE — Editorial note stacking

> **Nota da edição** (`noteText`, content `detail_note`) is painted **above** **Papel da nota** (`note`).

| Requirement | How it holds | Proof |
| :--- | :--- | :--- |
| text above paper by default | `defaultStackOrder` … `note`, `noteText` …; `stackPlacement: { above: 'note' }` | test "NOTE RULE … ABOVE" (order, z-index, DOM order) |
| hide the paper → the text stays | the `noteText` layer no longer reads `hidden('note')` | test + render `state-cover-note-paper-hidden.png` |
| hide the text → the paper stays | independent visibility | test + render `state-cover-note-text-hidden.png` |
| paper resource change does not touch the text | paper file = `paperScrap` slot on the `AssetLayer`; the text layer has no image | test (swapped paper URL, text markup identical) |
| legacy Cover output keeps text on top of paper | saved orders get `noteText` directly above `note`; default render is pixel-identical to `origin/main` | test + **0 differing pixels** (below) |

## Per-layout atom tables

Legend — **Kind**: `image` = file-backed image, `mat` = file-backed material, `text`, `shape` = procedural. **Slot**: Asset Slot id. **Tf**: transform classification — *ind* independent, *fol(x)* follows `x`, *fix* fixed geometry. `NEW` marks atoms created by this mission.

### 1. Cover

| Atom | Kind | Content | Slot | Tf | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ornament`, `archival`, `botanicalLeaf`, `botanical` | mat | — | own | ind | unchanged |
| `heroFrame` **NEW** | shape | — | — | fol(hero) | pale photo border + shadow (`#e8dcc3`, 14 px), directly under the image; replaces the `tuning.hero.frame` toggle |
| `hero` | image | (content image) | `hero` | ind | the image only; image geometry fills the plate when the frame is hidden |
| `tape1`, `tape2` | mat | — | `tape` | ind | independent even though they share the slot |
| `note` | mat | — | `paperScrap` | ind | the paper only (no children) |
| `noteText` | text | `detail_note` | — | fol(note) | **above** the paper; independent visibility |
| `paper`, `title` | mat / text | `title` | `paper` | ind | already separate |
| `kicker`, `intro`, `source` | text | `eyebrow`, `subtitle`, `source_line` | — | ind (tuning) | unchanged; the source rule is internal to `source` |
| `brandLogo` **NEW** | image | — | **`logo`** (new) | ind (tuning `brand`) | replaces half of the compound `brand` (`replaces: ['brand']`) |
| `brandName` **NEW** | text | Project name (derived `brand_label`) | — | fol(brandLogo) | the other half; not a Content field (derived) |

Internal / derived (not Elements): background gradient, grain, stars, sequence badge, the source rule, the kicker underline.
Splits: hero → `heroFrame` + `hero`; brand → `brandLogo` + `brandName`; note paper ↔ text decoupled.

### 2. Info

| Atom | Kind | Content | Slot | Tf |
| :--- | :--- | :--- | :--- | :--- |
| `archival`, `botanicalLeaf`, `botanical`, `tape1/2/3`, `pin`, `pin2` | mat | — | own | ind |
| `card1` | mat | — | `paperDark` | ind |
| `card1Text` **NEW** | text | `fact_cards[0]` | — | fol(card1) |
| `paper` ("Cartão 2") | mat | — | `paper` | ind |
| `card2Text` **NEW** | text | `fact_cards[1]` | — | fol(paper) |
| `paperStrip`, `paperDark` (title strips) | mat | — | own | ind |
| `title` | text | `title` | — | ind (tuning); one text over two strips, the gold underline of line 2 is internal |
| `source` | text | `source_line` | — | ind (tuning) |
| `bodyText` **NEW** | text | `body_blocks` | — | fix |
| `annotation` **NEW** | text | `annotation` | — | fix |
| `introBanner` **NEW** | mat | — | `paperDark` | fix |
| `introText` **NEW** | text | `intro` | — | fix (above `introBanner`) |
| `brandTab` **NEW** | mat | — | `paperDark` | fix |
| `brandLogo` **NEW** | image | — | **`logo`** | fix |

Splits: card paper ↔ card text (×2); intro banner ↔ intro text; brand tab ↔ logo. The former fixed-layer body/annotation/intro/brand become atoms that still paint on top by default.

### 3. Lista

| Atom | Kind | Content | Slot | Tf |
| :--- | :--- | :--- | :--- | :--- |
| `archival`, `botanicalLeaf`, `botanical`, `paperStrip`, `tape1`, `tape2` | mat | — | own | ind |
| `heroFrame` **NEW** | shape | — | — | fol(hero) |
| `hero` | image | content image | `hero` | ind |
| `note` | mat | — | `paperScrap` | ind |
| `noteText` **NEW** | text | `image_caption` | — | fol(note) |
| `callout` | mat | — | `paperDark` | ind |
| `calloutText` **NEW** | text | `callout` (the leaf icon is internal) | — | fol(callout) |
| `title` | text | `title` | — | ind |
| `intro` **NEW** | text | `intro` | — | fix |
| `items` **NEW** | text | `items` (icon medallion + text per row: one repeated unit) | — | fix |
| `brandLogo` **NEW** | image | — | **`logo`** | fix |

### 4. Grade

| Atom | Kind | Content | Slot | Tf |
| :--- | :--- | :--- | :--- | :--- |
| `archival`, `botanicalLeaf`, `paperStrip`, `tape1` | mat | — | own | ind |
| `tiles` | text | `tiles` (repeated medallion + label: one unit) | — | ind (`card1` channel) |
| `note` | mat | — | `paperScrap` | ind |
| `ideasText` **NEW** | text | `ideas_title`, `ideas` | — | fol(note) |
| `title` | text | `title` | — | ind |
| `intro` **NEW** | text | `intro` | — | fix |

### 5. Mapa

| Atom | Kind | Content | Slot | Tf |
| :--- | :--- | :--- | :--- | :--- |
| `botanicalLeaf`, `botanical`, `paperStrip`, `tape1` | mat | — | own | ind |
| `map` | shape | (IBGE UF geometry; the "Base cartográfica: IBGE" credit is derived chrome inside it) | — | ind (`card1`) |
| `mapPins` **NEW** | shape | `places` (UF markers) | — | fol(map) |
| `note` | mat | — | `paperScrap` | ind |
| `noteText` **NEW** | text | `note` | — | fol(note) |
| `title` | text | `title` | — | ind |
| `intro` **NEW** | text | `intro` | — | fix |
| `legend` **NEW** | text | `places`, `places_more` | — | fix |

`map` was declared `kind: 'image'` but was always procedural; it is now `shape` (no consumer read `kind`).

### 6. Rede

| Atom | Kind | Content | Slot | Tf |
| :--- | :--- | :--- | :--- | :--- |
| `ornament`, `paperStrip` | mat | — | own | ind |
| `links` **NEW** | shape | (dashed links between cards; derived from `nodes`) | — | fol(cards), under the cards |
| `cards` | mat | — | `paperScrap` | ind (`card1`) |
| `cardsText` **NEW** | text | `nodes` | — | fol(cards) |
| `callout` | mat | — | `paperDark` | ind |
| `calloutText` **NEW** | text | `callout` (icon, text, bullets) | — | fol(callout) |
| `title` | text | `title` | — | ind |
| `kicker` **NEW**, `intro` **NEW** | text | `kicker`, `intro` | — | fix |

### 7. Citação

| Atom | Kind | Content | Slot | Tf |
| :--- | :--- | :--- | :--- | :--- |
| `botanicalLeaf`, `paperStrip`, `tape1` | mat | — | own | ind |
| `heroFrame` **NEW** | shape | — | — | fol(hero) |
| `hero` | image | content image | `hero` | ind |
| `callout` | mat | — | `paperDark` | ind |
| `calloutText` **NEW** | text | `callout` | — | fol(callout) |
| `quote` | mat | — | `paper` | ind |
| `quoteText` **NEW** | text | `quote` (the decorative quotation marks are internal) | — | fol(quote) |
| `title` | text | `title` | — | ind |
| `intro` **NEW**, `bullets` **NEW** | text | `intro`, `bullets` | — | fix |

Video (`timing.companions`, this registry): `title → [paperStrip]`, `quote → [quoteText, tape1]`, `hero → [heroFrame]`, `callout → [calloutText]` — the atoms drawn *with* a timed unit enter and leave with it (Video element-timing tests updated).

### 8. Encerramento

| Atom | Kind | Content | Slot | Tf |
| :--- | :--- | :--- | :--- | :--- |
| `ornament`, `botanicalLeaf`, `botanical`, `tape1` | mat | — | own | ind |
| `note` | mat | — | `paperScrap` | ind |
| `inviteText` **NEW** | text | `cta_title`, `cta_text`, `contact` (envelope icon internal) | — | fol(note) |
| `title` | text | `title` | — | ind |
| `body` **NEW**, `items` **NEW**, `tagline` **NEW** | text | `body`, `items`, `tagline` | — | fix |
| `divider` **NEW** | shape | (dotted rule) | — | fix |
| `brandLogo` **NEW** | image | — | **`logo`** | fix |
| `brandName` **NEW** | text | Project name (`brand_label`) | — | fix |

## The `logo` Asset Slot (existing LibraryFile model; no Project Identity redesign)

- Registry: `logo` is a content asset slot (role `content`, default = the Template logo fixture). Layouts that draw a brand signature (Cover, Info, Lista, Encerramento) expose it through their `brandLogo` atom, so the Assets tab lists **Logo da marca** with the existing picker / "Usar padrão".
- State: `assetOverrides.logo = { libraryFileId }`, persisted/validated like every slot (`PersistedAuthoredSlideSchema`, `authoringRenderRequestSchema`, frozen snapshot schema).
- Enqueue (`app/api/creative/static-authoring/render/route.ts`): the same ownership / project / `kind: image` / MIME checks as every override; the manifest binds `assets.logo` to that `library_file` (`fit: 'contain'`) **only on layouts that draw a logo** (`layoutUsesLogo`).
- Claim time (`resolve-static-runtime-input.ts`): only the frozen LibraryFile id is presigned (same SSRF boundary as hero); a missing file fails the claim (`ASSET_LIBRARY_FILE_UNAVAILABLE`), never a substitution.
- Editor preview (`previewOverrideAssets` + page): paints the override with the same shape the worker gets.
- Not offered: Video (its Assets UI only knows the hero slot; Video keeps the Template logo) — documented limitation.

## Backward compatibility (migration: none)

- Persisted data is unchanged: `hiddenElements`, `elementOrder`, `primitiveTransforms`, `tuning`, `assetOverrides` keep their schemas; new atom ids are just more valid ids. A slide without any of them renders as before.
- Saved paint orders: missing atoms are inserted by `stackPlacement` (`{above}` text-on-paper, `{below}` frame/links, `'front'` former fixed text), known relative order is preserved.
- Compound id `brand` (hidden or ordered) expands to `brandLogo` + `brandName`.
- The Cover's old **hero frame toggle** (`tuning.hero.frame === false`, shipped the day before): on load it becomes a hidden `heroFrame` Element and the stored tuning no longer carries `frame`; the renderer still reads a stale `frame:false` (old frozen snapshot / stale client) as a hidden frame, and the render-request schema still accepts the field. The "Moldura" checkbox is gone from the Hero panel (the frame is now an Element in Elementos).
- One intentional behaviour change (asked for by the mission): hiding the Cover `note` paper **no longer hides** `noteText`.
- Layout switch semantics are untouched: `replaceTemplateLayout` still resets Layout-owned state (hidden ids, order, tuning, transforms, asset overrides) and keeps Custom Elements; per-layout tests assert it (matrix point 10).

## Inspector (minimal, truthful — no redesign)

`TemplateElementPanel` only learned the new classification: `fixed` atoms show "Posição fixa do Template … visibilidade e ordem próprias"; `follows` atoms say they take the anchor's position but hiding one never hides the other; the Hero panel lost the frame checkbox; the brand note now says the logo is replaceable in Assets. Assets tab, Elementos tree, selection model, Style, fonts, Video and Auth are unchanged.

## Worker impact — YES (operator action required)

Worker-copied files changed: `template-definitions.ts`, `element-stack.ts`, `layout-kit.tsx`, `primitives.tsx`, and the eight `*Variant.tsx`. `DocumentaryCard.tsx` and the asset list are unchanged (no new file, no new asset). The render worker must be updated and restarted (Remotion bundle is cached per process) — see *Deployment / worker parity*.

## Validation

- Focused final gate: `pnpm vitest run` over the atomic matrix, template anatomy/foundation, Static authoring/Assets, layout switch, Template Custom Elements, renderer isolation/static paths and Static/Video parity: **11 test files / 253 tests passed**.
- Full Vitest suite on the final working tree: **185 test files / 3,459 tests passed**.
- TypeScript: `pnpm exec tsc --noEmit` — **PASS** (exit 0).
- Lint: `pnpm lint` — **PASS** (exit 0; 0 errors, 42 repository warnings).
- Production build: `pnpm build` — **PASS**; Next.js 16.2.4/Turbopack compiled successfully, completed TypeScript, generated 53/53 static pages and finalized optimization.
- `git diff --check`: clean after the final whitespace fix.

### Local frozen-snapshot render proof

The existing proof under `.tmp/atomic-proof/out` was preserved and not rerun wholesale during final closure.

- Baseline parity against `origin/main` (`50b138b…`): Cover, Info, Lista, Grade, Mapa, Rede, Citação and Encerramento, dark/light where supported, plus replaced-Hero cases — **0 differing pixels of 1,458,000** for each stable comparison.
- Full-content and legacy-reversed-order parity: all stable comparisons were **0 differing pixels**. One first render of **Lista / Light / legacy-reversed-order** produced a transient 2,457-pixel diff; the deterministic rerender showed `main1 == main2 == branch2`, with only the first `branch1` differing. This is retained as first-render/nondeterministic artifact evidence, not a semantic regression.
- Cover state renders: default; note paper hidden; note text hidden; tape hidden; Hero backing hidden; Hero image hidden; logo replacement; logo hidden/name stays; name hidden/logo stays.
- Other decomposed-layout state renders: Info card paper hidden + logo replacement/tab hidden; Lista frame/caption paper hidden; Grade ideas paper hidden; Mapa pins/note paper hidden; Rede links hidden/cards text stays; Citação quote paper/frame hidden; Encerramento invitation paper/name hidden.
- The Cover note contract is covered both structurally and visually: `noteText` paints directly above `note`, and either can be hidden independently without hiding the other.

## Limitations (stated, not hidden)

- Text inside a paper inherits the paper's transform **including opacity** (it is the anchor's position channel); there is no independent text opacity.
- When a Hero frame is hidden the image fills the whole plate (the pre-existing "no frame" geometry); the image is never hidden by it, and the frame hiding does not crop or move the image's box.
- The Info title stays one text Element over two strips (one authored field): hiding the dark strip leaves its cream text.
- Repeated units stay one Element (`items`, `tiles`, `cards` texts, `nodes`, `bullets`, `places`): per-item Elements are out of scope.
- Video does not offer the `logo` slot; Video renders the new atoms through the shared renderer, covered by unit tests, not by a local pixel proof.
- Inspector UX for the larger Element count (grouping density, selection) is a separate mission (not started).

## Deployment / worker parity

Repository implementation is ready for merge. Renderer/worker impact is **YES** because worker-copied registry, stack, shared primitives/layout kit and all eight Documentary variants changed.

After merge, the canonical runtime export must be generated with `node infra/render-worker-runtime/export.mjs`; no `docker cp` patching is permitted. Worker closure requires the operator to update/restart the render worker, confirm the expected hashes from inside the active container, confirm one healthy replica / completed Remotion bundle startup, and execute a real production render. Vercel Production must also be verified against the exact merge SHA. Until those post-merge checks are complete, the correct status is **IMPLEMENTATION COMPLETE / WORKER-PRODUCTION CLOSURE PENDING**.
