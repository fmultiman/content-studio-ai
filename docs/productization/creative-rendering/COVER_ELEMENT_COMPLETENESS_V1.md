# COVER_ELEMENT_COMPLETENESS_V1

Bounded implementation (Cover only, Static Template only): every meaningful visible unit of the Cover now has an explicit owner across the renderer, the Template Element registry, Content, the anatomy and authored state.
Authority: `STATIC_TEMPLATE_VISUAL_UNIT_AND_ELEMENT_COVERAGE_AUDIT_V1` (§4, §16). Depends on `STATIC_TEMPLATE_ANATOMY_TREE_V1` and `STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1`.

## Provenance

| Item | Value |
| :--- | :--- |
| Starting main SHA | `e6e75e5afabf345962dbcf33e830c760e6139a18` |
| Worktree | the existing Static worktree `D:/Traycer/worktrees/fmultiman__content-studio-ai/traycer-witty-puma-23e2b43ebdbe` (no worktree created; neighbours untouched) |
| Branch | `feat/cover-element-completeness-v1` |

## What was verified before changing anything (CURRENT FACT)

| Cover unit | Code reality before |
| :--- | :--- |
| Título + Papel do título | already sibling Elements |
| Intro "Uma pergunta lançada…" | content `subtitle`, labelled "Texto"; fixed top layer, no Element |
| "Publicado originalmente em 1983." + short line | content `source_line` (not editable in Static); fixed layer; the line is a decorative `<span>` of that same node |
| Kicker "MEMÓRIA VIVA • LIVROS" | content `eyebrow` (authored data seeded with fixture copy; not editable in Static); fixed layer |
| Hero "white backing" | **not** an asset or separate layer: the CSS frame (`#e8dcc3`, 14 px, shadow) **and** a paper-coloured (`palette.paper`) surface, both baked into the `hero` box |
| Editorial note | `note` Element was the paper with the `detail_note` text as its child (text not editable in Static; hiding paper hid the text) |
| Brand | `BrandMark` on the fixed layer: logo = hard-coded Portal fixture (`comunidades-alternativas-logo-v1.svg`), name = live Project name (`variantHasBrandLabel`); neither an Element, slot nor Content field |
| Sequence number, stars, grain, gradient | derived chrome / internal, no authoring identity |

## Decisions and final model

**New Cover Elements** (all in `defaultStackOrder`, so they are hideable and layerable):

| Id | Label | Kind | Controls (truthful only) | Content owner |
| :--- | :--- | :--- | :--- | :--- |
| `kicker` | Chamada | text | show/hide, layer order, X/Y ±60 px, rotation ±2° (`tuning.kicker`) | `eyebrow` |
| `intro` | Introdução | text | same (`tuning.intro`) | `subtitle` |
| `source` | Fonte editorial | text | same, reusing the existing `source` group (the same concept as Info's Fonte) | `source_line` |
| `brand` | Assinatura | image | same (`tuning.brand`) | none (see brand model) |
| `noteText` | Nota da edição | text | show/hide, layer order; **no spatial control** — `control: { type: 'follows', parent: 'note' }` | `detail_note` |

`note` (the paper) is relabelled **Papel da nota**; its id, transform channel and asset slot are unchanged, so saved slides keep their positions. No font/size/colour/weight control was added to any new Element (they render with the fixed Template typography they already had).

**Compounds (final ownership)**

- **Editorial note:** *Papel da nota* is the spatial owner (transform sliders, `paperScrap` slot, Assets tab). *Nota da edição* is its semantic child: the text is a sibling layer that takes the paper's exact box and transform (so moving the note moves both), and paints immediately above the paper. It can be hidden alone; **hiding the paper still hides the text** (previous behaviour preserved for saved slides). *Fita da nota* is unchanged. The panel of the child says so and points to Conteúdo.
- **Source line:** text = Element + Content field; the rule beside it = internal decorative child of that Element (hidden with it). No separate line Element.
- **Hero:** one spatial Element; its frame is a bounded presentation option, not a new Element (below). Tape unchanged.
- **Title + paper:** already two Elements; unchanged.

**Hero presentation model.** The "white backing" is two visual parts of the same treatment (CSS frame + paper-coloured backing surface), and the backing only exists inside the frame, so they are **one** bounded option: `tuning.hero.frame?: boolean` (absent = shown = legacy look; only `false` is stored; turning it back on removes the key). Declared per layout by `presentation: { frame: true }` — only Cover's Hero. Off = no frame background, no padding, no shadow, transparent backing; the hero box (position/size) and the image are untouched, so replacing the image and toggling the frame are independent (proved on a replaced, alpha-cornered image). "Restaurar elemento" also restores the frame. Not a frame builder; no generic decoration system.

**Brand ownership model (V1: identity first).** The block is now an explicit Cover Element, **Assinatura**, positionable and hideable, and its panel states its provenance: *the logo belongs to the Template; the name comes from the Project; logo replacement is not available yet.* No asset slot, no Project Identity change, no fake ownership. Logo replacement (a `logo` slot in the asset-override, snapshot, claim-time resolver and Assets tab) touches all of those and is **deferred**. `brand_label` is deliberately **not** a Content field: it is derived from the Project name (clearing it would be re-derived on reload, an editor/reload mismatch).

**Kicker ownership.** `eyebrow` is authored per-composition Content (the schema field, seeded with fixture copy or the channel), not Template-fixed metadata → exposed as **Chamada (kicker)**.

**Content (Static Cover tab).** `STATIC_COVER_CONTENT_FIELDS` through `LayoutContentForm` (Video keeps its own `COVER_CONTENT_FIELDS`): *Chamada (kicker)* 48, *Título* 120, *Introdução* 220, *Fonte editorial* 160, *Nota da edição* 240 (bounds = `DocumentaryCardCoverContentSchema`, enforced with `maxLength`; new optional descriptor prop). Optional fields are removed when cleared (the old inline form wrote `''`, which the schema rejects). No content field was invented.

**Anatomy (Cover).** Cabeçalho (Chamada) · Bloco de título (Título, Papel do título) · Introdução · Fonte editorial · Hero (Imagem principal, Fita da imagem) · Nota editorial (Papel da nota, Nota da edição, Fita da nota) · Assinatura · Decoração (4). Internal chrome is not exposed.

**Paint order.** Default `defaultStackOrder`: `ornament, archival, botanicalLeaf, hero, botanical, tape1, note, noteText, tape2, paper, title, kicker, intro, source, brand`. The four former fixed-layer units append on top, exactly as they painted before (stack z ≤ ~40, the sequence badge stays on the fixed layer at 200). For orders saved **before** these Elements existed, a new `stackPlacement: 'front'` (kicker, intro, source, brand) puts them on top instead of after `title`; `noteText` slots right after `note`. Legacy custom orders and hidden ids therefore render as before.

## Persistence and compatibility

- Additive optional keys only: `tuning.hero.frame`, `tuning.kicker`, `tuning.intro`, `tuning.brand` (persisted slide schema, render-request overrides schema, frozen snapshot schema — one shared schema), plus the new ids in `hiddenElements` / `elementOrder`.
- Missing keys resolve to the legacy Cover; a reset removes the optional groups, so a reset slide serialises exactly like one never adjusted; `deriveTuningOverrides` is unchanged for untouched slides.
- **MIGRATION: NONE.** No SQL, no row rewrite, no `static-authoring-state` version bump.
- **Layout switch:** the new state is Layout-owned (tuning, hidden ids), so Cover → other Layout resets it; Custom Elements survive; `hasLayoutOwnedAuthoredWork` counts it (confirmation shown).
- **Free / Video:** Free untouched. Video Cover scenes render through the same `CoverVariant` and Element registry, so their shared Elementos list now also lists the four new stack Elements (order/visibility only; Video's panel keeps saying position is layout-defined) and the renderer honours them; no Video code, persistence or timing changed.

## Renderer and worker impact

**RENDERER IMPACT: YES** — `components/creative/documentary-card/CoverVariant.tsx` only (Cover-specific; `DocumentaryCard`, other variants and primitives untouched; existing `elementTransform` reused).
**WORKER IMPACT: YES** — worker-copied files changed: `CoverVariant.tsx`, `lib/creative/templates/template-definitions.ts`, `lib/creative/templates/element-stack.ts` (all three are in `export.mjs`). Not worker-copied and not needed there: render-request/carousel-state/authoring-state/UI.

Expected sha256 of the changed worker-served files (export tree byte-identical to the repo):

| File (under `/app/content-studio/`) | sha256 |
| :--- | :--- |
| `components/creative/documentary-card/CoverVariant.tsx` | `3fed0838064d13855205e052b17245aa70626d86bb6b38e0ed445d94313e3921` |
| `lib/creative/templates/template-definitions.ts` | `e84d2f9a725edb79a42f4b03ce4be7f6313ff2503c7ca19aae25fc29debde869` |
| `lib/creative/templates/element-stack.ts` | `41d5569168056e1a47403972b546473adbb54c87a0b68ba1e83b2ab61d282137` |

**Worker parity procedure (operator, VPS — this session has no VPS access).** After the production merge: `node infra/render-worker-runtime/export.mjs`; copy `infra/render-worker-runtime/dist/` to `/opt/content-studio/render-worker` (bound read-only to `/app/content-studio`); `docker service update --force content-studio-execution_render-worker` (the Remotion bundle is built once at process start, so a copy without a restart keeps serving the old code); confirm in the **new** active container that the three hashes above match, that startup finished the bundle build, then run a real render. No `docker cp` into a running container. **Worker parity is NOT claimed from the export tree** (see *Worker parity status* below for what was and was not established).

## Tests and validation

- `cover-element-completeness.test.ts` (32) covers all 22 listed points: content ownership and schema bounds, exact Element set/ids/labels/controls, Sections, no internal node as Element, hero frame default/off/independent of the image, tape unchanged, note text vs paper (separate elements, shared box/transform, hide semantics), source text+line as one Element, brand default appearance, persistence round-trip, legacy row defaults, render request + frozen snapshot carrying the new state (and an old snapshot still parsing), legacy paint-order compatibility, layout-switch reset with Custom Elements kept.
- `template-element-panel.test.tsx` (9): each Element offers only its supported controls (Hero frame, X/Y/rotation only for new text/brand, none for the note text, brand provenance note, no logo-replacement control) and the Cover Content tab (labels, `maxLength`, single-field edits, clearing an optional field keeps content schema-valid).
- Updated (intended consequence of the Cover Element set): anatomy/tab expectations, `carousel-state` reorder fixture (15 ids), `editor-workspace` (`source` now also on Cover), the Video `scene-composition` z-index literal (now derived from the layout's stack length), a `≤ 15` element bound.
- **Full Vitest: 165 files / 2718 tests passed.** `pnpm tsc --noEmit` clean. `pnpm lint` 0 errors (43 pre-existing warnings, none in changed files). `pnpm build` succeeded.
  (One earlier full run failed 15 `credential-boundary` tests because my temporary source export for the parity proof sat inside the repo's ignored `.tmp/`, which that test scans; removing the scratch copy made it pass — it was never a code failure.)

## Local UI validation (no Auth, no data)

A temporary, uncommitted `/dev/*` harness (deleted) rendered the real `LayoutContentForm`, `TemplateElementsTab`, `TemplateElementPanel`, `LayoutSwitchDialog`, `DocumentaryCard` and Style panel in `next dev`:

- Content exposed *Chamada (kicker) / Título / Introdução / Fonte editorial / Nota da edição* with maxLengths 48/120/220/160/240; editing Introdução changed the preview; clearing Fonte editorial removed it from state and preview.
- Anatomy showed the eight Sections above; the Hero panel offered the frame toggle (on → off: `data-hero-frame` on→off, background transparent); the *Nota da edição* row had no sliders and named its owner; hiding it kept the paper and removed the text; Assinatura stated logo = Template / name = Project.
- Inspector scrolled with no horizontal overflow.
- Authored Cover (frame off, intro moved, note text hidden, Custom Text) → Info: dialog, Cancel left state identical, confirm reset every new field (no frame/kicker/intro/brand/hidden), the Custom Text stayed; back to Cover: clean and framed.
- Limitation: DOM/state verification (no pixel screenshot of the harness) and not inside the authenticated editor.

## Worker parity status (production)

The operator reported the worker updated and restarted (`docker service update --force content-studio-execution_render-worker`). **This session has no VPS access and did not receive the container's output**, so:

| Item | Status |
| :--- | :--- |
| `CoverVariant.tsx` served by the active worker | **Proven behaviourally, not by hash**: production PNGs show output that only the new file can produce (hero frame off, separate note text, moved kicker/intro/brand — renders 2–7 below). The legacy default render is unchanged. |
| `template-definitions.ts`, `element-stack.ts` served by the active worker | **NOT confirmed.** Nothing in the renders can distinguish them from the previous versions (the frozen `hiddenElements`/`elementOrder` are normalised on Vercel before the worker sees them). |
| sha256 of the three files inside the active container | **NOT provided to this session — pending operator output** (expected values in the table above). |
| Remotion bundle finished at service start | **NOT observed by this session.** Indirect signal only: the first render after the restart took 20 s (claimed 06:53:48 → completed 06:54:08), every later render 1–3 s, i.e. a cold-then-warm pattern. |

To close this row set, run on the VPS: `docker exec <active render-worker container> sha256sum /app/content-studio/components/creative/documentary-card/CoverVariant.tsx /app/content-studio/lib/creative/templates/template-definitions.ts /app/content-studio/lib/creative/templates/element-stack.ts` and `docker service logs content-studio-execution_render-worker --since <restart time>` (look for the bundle-ready line).

## Production render smoke (real worker, legitimate operator session)

Environment: `content.multihuman.com.br`, Vercel production `29c4e97`, the operator's own logged-in session; project *Portal Comunidades Alternativas*, channel piece `1247e54b-8f55-492e-825d-ed9b927f2e63` ("Carrossel 01 Instagram", 10-slide Template carousel), **Slide 1 (Cover)**. Every change was made through the editor UI; **nothing was saved** ("Salvar" never used, autosave off by default), the editor was reloaded afterwards and showed the saved state (`Salvo`, original texts, frame on). No Auth, service-role or DB shortcut. Side effects: 7 `render_executions` rows and their scratch PNGs (normal "Gerar PNG" behaviour).

All seven executions: `static_still`, attempt 1, `completed`, output **1080 × 1350 PNG**.

| # | Execution id | Authored state | Bytes | Result (inspected PNG) |
| :-- | :--- | :--- | :--- | :--- |
| 1 | `db4193af-0eac-4ed1-99c1-2666510b90a0` | untouched saved Cover (legacy/default) | 1,905,276 | Original Cover: cream frame around the book, note text on its paper, kicker, intro, source line, brand. |
| 2 | `0e34bf32-4244-41e7-8b77-b89b56461f0a` | *Moldura e fundo da imagem* **off**, image unchanged | 1,954,459 | The cream frame and its shadow are gone; the book image alone in the same box; everything else identical to #1. |
| 3 | `be66accf-238b-4a5f-8a4c-cf89c5b396d7` | frame back on; **Chamada** → "KICKER DE PROVA · 30/09" (+20 px X); **Introdução** → "INTRODUÇÃO DE PROVA: …" (+30 px Y); **Fonte editorial** → "Fonte editorial de prova, 2026."; **Nota da edição** → "Nota de prova: texto da nota editado, independente do papel."; **Assinatura** +40 px X | 1,897,937 | Every string appears exactly as authored, kicker shifted right, intro lower, brand block shifted right, the note's bold label/body split preserved, frame back. |
| 4 | `958f158b-6417-4e43-8d43-0603f856baac` | #3 + **Nota da edição** (text) hidden | 1,889,275 | The paper stays, text gone (paper region 97.7 % paper-coloured, ink 0.08 % vs 2.9 % in #3). |
| 5 | `3786b02d-0e97-4b9f-88cf-e781f55e624e` | text visible, **Papel da nota** hidden | 1,828,204 | Paper **and its text** are both absent (navy background); *Fita da nota* still drawn. This is the intended, documented current behaviour: hiding the owner hides its text child. |
| 6 | `beaaa221-a1d5-4180-9a51-e161bcfe9d33` | hero **replaced** via Assets (`ornament-celestial-gold-01.png`), frame **off** | 1,574,567 | Only the replacement image over the background — no frame, no backing. The toggle stayed *off* after the replacement (editor and render agree). |
| 7 | `6ab8b277-cb85-4705-9969-3c10a07e58b0` | same replaced hero, frame **on** | 1,352,203 | Same image on the cream frame and paper backing. Only the frame differs from #6, so replacing the image and toggling the frame are independent. |

Editor ↔ output agreement: the editor's preview nodes (`data-hero-frame`, per-element transforms, hidden state) matched the PNGs for every render. Introdução, Fonte editorial, Chamada and Assinatura in the output correspond to the Content fields and Element positions authored (#3); the Assinatura's name is the Project name (derived), its logo the Template default.

Limitations observed: (a) worker sha256/startup not observable from here (above); (b) the render API does not expose which worker claimed an execution; (c) hero replacement was checked with a transparent-cornered project asset, so the frame/backing difference is clearly visible — an opaque photo shows only the cream border.

## Local render proof (frozen snapshot, before merge)

Real Remotion `renderStill` (Chromium) of frozen snapshots resolved through the real claim-time `resolveStaticRuntimeInput`, no production, no Auth:

1. **Legacy default Cover, `main` renderer vs this branch on the same snapshot: 0 differing pixels of 1,458,000** (1080×1350) — output parity.
2. Replaced hero (alpha-cornered image) with frame on vs off: on = cream frame and paper backing visible; off = only the image, same box.
3. Introdução, Fonte editorial, Nota da edição and Chamada edited in Content (+ intro/kicker offset): the PNG shows exactly the authored text and positions; the note paper is unchanged.
4. Note text and brand hidden: paper stays, text and signature absent.

## Known limitations

- Logo replacement not implemented (identity/provenance first); the logo is still the Portal fixture; deferred to a Template ownership/brand decision.
- No numeric font size, font picker or per-element colour/weight (still fixed Template typography); no Selection Parity or contextual Styles.
- New text Elements move within ±60 px / ±2° (same bounded position as Título/Fonte), not free placement.
- Other layouts (Info, Lista, Grade, Mapa, Rede, Citação, Encerramento) keep their fixed-layer texts and unregistered units; the audit's rollout order stands (Lista next).
- Video Cover scenes list the new Elements in their read-only-position Elementos list (a consequence of the shared registry).

## Explicitly deferred

Cover logo asset slot and replacement; rollout to the other seven layouts; Anatomia | Camadas views; Assets → Recursos; font size/picker; Selection Parity; contextual Styles.
