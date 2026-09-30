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

**Worker parity procedure (operator, VPS — this session has no VPS access).** After the production merge: `node infra/render-worker-runtime/export.mjs`; copy `infra/render-worker-runtime/dist/` to `/opt/content-studio/render-worker` (bound read-only to `/app/content-studio`); `docker service update --force content-studio-execution_render-worker` (the Remotion bundle is built once at process start, so a copy without a restart keeps serving the old code); confirm in the **new** active container that the three hashes above match, that startup finished the bundle build, then run a real render. No `docker cp` into a running container. **Worker parity is NOT claimed from the export tree.**

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

## Render proof (local frozen snapshot; production render NOT performed)

Real Remotion `renderStill` (Chromium) of frozen snapshots resolved through the real claim-time `resolveStaticRuntimeInput`, no production, no Auth:

1. **Legacy default Cover, `main` renderer vs this branch on the same snapshot: 0 differing pixels of 1,458,000** (1080×1350) — output parity.
2. Replaced hero (alpha-cornered image) with frame on vs off: on = cream frame and paper backing visible; off = only the image, same box.
3. Introdução, Fonte editorial, Nota da edição and Chamada edited in Content (+ intro/kicker offset): the PNG shows exactly the authored text and positions; the note paper is unchanged.
4. Note text and brand hidden: paper stays, text and signature absent.

The three production renders (legacy, frame off, semantic text) require the worker parity step and a legitimate operator session; **not performed** by this session.

## Known limitations

- Logo replacement not implemented (identity/provenance first); the logo is still the Portal fixture; deferred to a Template ownership/brand decision.
- No numeric font size, font picker or per-element colour/weight (still fixed Template typography); no Selection Parity or contextual Styles.
- New text Elements move within ±60 px / ±2° (same bounded position as Título/Fonte), not free placement.
- Other layouts (Info, Lista, Grade, Mapa, Rede, Citação, Encerramento) keep their fixed-layer texts and unregistered units; the audit's rollout order stands (Lista next).
- Video Cover scenes list the new Elements in their read-only-position Elementos list (a consequence of the shared registry).

## Explicitly deferred

Cover logo asset slot and replacement; rollout to the other seven layouts; Anatomia | Camadas views; Assets → Recursos; font size/picker; Selection Parity; contextual Styles.
