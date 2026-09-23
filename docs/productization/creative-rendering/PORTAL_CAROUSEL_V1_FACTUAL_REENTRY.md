# Portal Carousel V1 — Factual Re-Entry

**Status:** read-only factual audit. No schema, code, route, component, renderer, asset, test, worker, Gallery, or Library changes were made while producing this document.

**Checkpoint:** branch `main`, HEAD `0ea6625db69f9ee4c3b13445abe9ef1e4081471f` (the bounded-fix closure commit — Pack B export drift + `tiktok:reel` classification + versioning of `docs/architecture/MEDIA_PRODUCTION_ARCHITECTURE_V1.md`). Untracked scratch material present in the worktree (`check-pack.js`, `patch_*.js`, the four `visual-reference-pack` asset directories) was inspected read-only and left untouched.

This document treats `docs/architecture/MEDIA_PRODUCTION_ARCHITECTURE_V1.md` as the architecture freeze and does not reopen any of its confirmed decisions. It is evidence for the *next* implementation mission, not a design document.

---

## 1. Executive factual summary

The static authoring path ("Editar Visual") is real, narrow, and works exactly as the architecture freeze describes: a single ChannelPiece produces a single canvas rendered through one hardcoded template (DocumentaryCard, variant `cover`), from state that is fully transient and re-derived from the database on every page load. "Carousel" today is nothing more than a `ChannelPiece.format` enum value — there is no ordered-slide model, no multi-canvas manifest, no batch-render action, and no export bundling anywhere in the codebase.

Two structural facts, newly confirmed by this audit (not previously verified against the real reference material), materially affect the next implementation mission:

1. **DocumentaryCard's `cover` variant is unconditionally forced to a fixed dark palette**, regardless of Project Identity tokens — and **Project Identity's visual-token adapter itself ignores the identity argument entirely**, always returning hardcoded light defaults. Light/dark is not a reproducible, selectable axis today.
2. **Visual inspection of the real Pack A reference material (slides 001, 002, 003, 005, 006, 010 of 10) shows at least five materially different content layouts**, only two of which (cover hero-image layout, and a title+paragraph+stacked-fact-cards layout) are structurally close to what `CoverVariant`/`InfoVariant` already render. Icon-bullet-lists with a side image (slides 3, 5), an icon grid (slide 6), and a closing CTA/icon-row layout (slide 10) have no current structural home in either variant. This is direct evidence bearing on Key Decision #2 below.

Pack B's asset pipeline is in better shape than the most recent prior planning document (`CAROUSEL_VISUAL_REENTRY_AND_ASSET_INTEGRATION.md`) describes — that document is now stale, contradicted by a commit made ~77 minutes after it was written. The Pack B export/runtime path fix from the immediately preceding mission (`0ea6625`) has zero effect on the static carousel flow; it was scoped entirely to the separate video-worker export pipeline.

---

## 2. Current flow map

```mermaid
flowchart TD
  Project --> Production --> EC[EditorialContent] --> CP[ChannelPiece]
  CP -->|isStaticChannelPiece: format not in reel/short/video_description| Gate{Static-eligible?}
  Gate -->|yes, incl. carousel| Context[GET /api/creative/static-authoring-context]
  Context --> Init[createContextualAuthoringState\nvariant: cover hardcoded\nidentity: 'a' hardcoded\ncanvas: 1080x1350 unless instagram:story]
  Init --> Edit[React AuthoringState\ncontentOverride, primitiveSelection,\nprimitiveTransforms — all in-memory only]
  Edit --> Manifest[deriveManifestFromState\nsequence always index:1,total:1]
  Manifest --> Render[POST /api/creative/static-authoring/render\nsynchronous child-process render]
  Render --> PNG[base64 PNG, transient, never persisted]
  PNG -->|explicit "Salvar nesta peça", optional| Save[Upload: S3 + library_files + channel_piece_media\none atomic action]
  Save -.->|not visible| Gallery[Galeria — images + render_executions only]
```

No branch of this flow currently produces more than one canvas per ChannelPiece, and reopening the page re-enters at `Init` every time — nothing from a prior session is read back.

---

## 3. DocumentaryCard current anatomy

`components/creative/documentary-card/`:

| File | Role |
|---|---|
| `index.ts` | Public surface (`DocumentaryCard`, props builders, types) |
| `types.ts` | `DocumentaryCardVariant`, `DocumentaryCardMode`, `DocumentaryCardContent`, `DocumentaryCardProps`, `DocumentaryCardVisualContext` |
| `DocumentaryCard.tsx` | Root component; computes palette; branches to variant; builds runtime/resolved props |
| `CoverVariant.tsx` | Cover-structure rendering (eyebrow, title, subtitle, hero asset, source_line, detail_note) |
| `InfoVariant.tsx` | Info-structure rendering (title, intro, body_blocks, fact_cards[], source_line, annotation) |
| `primitives.tsx` | Visual primitive library (materials, overlays, badges, brand mark) |

For contrast, the only other registered template, `components/creative/quote-card/QuoteCard.tsx`, is a single flat component with one variant (`'default'`), no primitive library, and no palette-override logic — confirming DocumentaryCard's structural richness (two variants + a shared primitive library + palette computation) is unique to it, not a shared platform pattern.

**Scope — not static-only.** DocumentaryCard is hardcoded into the video path at the adapter level: `lib/creative/timeline-adapter/video-draft-to-timeline.ts:33/159` (`sceneToSegment`) assigns `{ id: 'editorial.documentary-card', variant: 'cover' }` to **every** `VideoScene`, unconditionally, with no content-based branching. This matches the architecture freeze's characterization exactly (§10, "proof-era coupling"). The nuance: the Remotion-facing component-resolution layer (`lib/creative/templates/component-resolver.ts`) is itself generic and already binds `QuoteCard` too — the hardcoding is one layer up, in the adapter that builds the manifest, not in the render tree.

---

## 4. Structural variants

`DocumentaryCardVariant = 'cover' | 'info'` — a real, closed union (`types.ts:18`), not a string. Selected via a `variant` prop, driven from `manifest.template.variant`, validated against the template registry (`lib/creative/templates/registry.ts`), which declares `documentaryCardDescriptor.variants = ['cover', 'info']` — exactly two, nothing else. No third structural variant is registered or reachable anywhere in current code. On the product page (`editar-visual/page.tsx`), the variant is additionally **hardcoded to `'cover'`** at state-construction time (`authoring-state.ts:112`) — the `SET_VARIANT` reducer action exists (`reducer.ts:25`) but is never dispatched from the real product UI, so `InfoVariant` is currently unreachable from the live carousel/ChannelPiece flow even though it exists in code.

Aspirational future variants (`map`, `icon-grid`, `network`, `quote`) appear only in `docs/discovery/creative-rendering/EDITORIAL_DOCUMENTARY_CARD_ANATOMY_V0.md` — doc-only, never implemented.

### Evidence from the real Pack A reference material (KEY DECISION #2 input)

Six of the ten Pack A slides were visually inspected directly (001, 002, 003, 005, 006, 010). Observed content layouts:

| Slide | Layout | Closest current match |
|---|---|---|
| 001 (cover) | eyebrow, title, subtitle, hero product image, publication note, edition-credit block, footer brand | **CoverVariant — strong structural match** (eyebrow/title/subtitle/hero/source_line/detail_note map almost 1:1) |
| 002 | title, two paragraphs, two stacked "year" fact cards (primary number + secondary/tertiary text), small illustration | **InfoVariant — partial match** (title/intro/body_blocks/fact_cards[] map reasonably; illustration slot does not exist) |
| 003 | title, paragraph, 3-item icon+label bullet list, side magazine-clipping image, audio-waveform decoration, caption | **No current match** — InfoVariant has no icon-list slot and no secondary side-image slot distinct from its fact-cards |
| 005 | title, paragraph, 4-item icon+label bullet list, side illustration, bordered quote callout box | **No current match** — same gap as 003, plus no bordered-callout slot |
| 006 | title, paragraph, 2-row × 3-col icon grid (6 items) + a second 6-icon theme row | **No current match** — no grid-layout concept exists in either variant |
| 010 (closing) | title, two paragraphs, 6-icon horizontal row, CTA/email block, footer brand, tagline | **No current match** — CoverVariant's hero/source_line/detail_note slots don't fit a CTA/icon-row closing layout |

**Factual conclusion (evidence only, no recommendation):** Cover and Info, as they exist today, structurally cover at most 2 of the 6 sampled real slides. The other 4 sampled slides (representing icon-list, icon-grid, and closing-CTA content shapes) have no structural home in the current two variants. Whether this is resolved by making Info's content schema more flexible/slot-based, or by adding a bounded number of new structural variants, is a decision for the next implementation mission — this audit only establishes that Cover+Info alone, unchanged, are evidenced as insufficient for the real 10-slide carousel.

---

## 5. Light/dark and Project Identity behavior (KEY DECISION #1 input)

There is **no explicit `theme`/`appearance`/`mode` prop** anywhere in `DocumentaryCardProps` or the registry descriptor. What exists instead:

1. `paletteFromTokens` (`primitives.tsx:32-42`) derives paper/paperAlt/ink colors via a **literal string-equality check**: `tokens.colors.background.toLowerCase() === '#0b1020' ? <dark set> : <light set>` — a magic-hex comparison, not a semantic boolean carried through the type system.
2. `DocumentaryCard.tsx:32-34` **unconditionally overrides** the palette to a fixed dark navy set whenever `variant === 'cover'`, regardless of what tokens actually supplied. `InfoVariant` always uses `tokenPalette` unmodified. Consequence: `CoverVariant`'s own `isDark` check (`palette.background.toLowerCase() === '#0b1020'`) is **always true**, because the value it's checking was just force-set one call frame earlier. Cover and "dark" are structurally inseparable today, not a per-slide choice.
3. `lib/creative/integration/project-identity-adapter.ts` (`adaptProjectIdentityToVisualTokens`) **ignores its `identity` argument entirely** (parameter named `_identity`) and always returns `CREATIVE_IDENTITY_DEFAULTS` — a fixed **light** palette (`#F6F0E4` background). This is fully consistent with the architecture freeze (§3, §12: "visual-token adapter currently uses defaults") and with `docs/productization/creative-rendering/PHASE_1A_PROJECT_IDENTITY_ADAPTER.md`, which documents this as a deliberate, tracked stand-in — no doc/code divergence here.
4. The only place a dark identity exists in code is a **dev/authoring fixture selector** (`AuthoringIdentity = 'a' | 'b'`, mapping to `comunidades-alternativas` (light) / `acme-labs` (dark) fixtures) — not part of any persisted manifest contract, and irrelevant to `cover` rendering regardless, per point 2. The product page hardcodes `identity: 'a'`.

### New evidence from the real reference material

Direct visual inspection of Pack A **and** Pack B slides 1 and 2 shows: slide 1 (cover) is dark in **both** packs; slide 2 is **light/cream in both packs** (confirmed identical structural intent in Pack A 002 and Pack B 02 — parchment/paper background, dark-green accent cards). Slides 3 and 6 (also inspected) are light. **Slide 5, however, is dark** despite being a content/bullet-list layout, not a cover. This is decisive evidence that **light/dark in the real reference material is not tied to the Cover/Info structural split** — it is an independent, per-slide art-direction choice driven by content tone (dramatic/threat content rendered dark; factual/historical content rendered light), that the current code's "cover is always forced dark, info always uses default light" coupling cannot reproduce for a real 10-slide sequence.

**Factual conclusion:** light/dark cannot remain implicitly coupled to the `variant` prop if the real carousel is to reproduce the reference material's actual art direction. This bears directly on Key Decision #1 — the audit's evidence points toward light/dark needing to become an explicit, independently-set input per slide, not a byproduct of which structural variant is chosen. No implementation is prescribed here.

---

## 6. Primitive/material inventory

`MaterialName = 'tornPaper' | 'paperStrip' | 'tape' | 'pin' | 'botanical'` (`primitives.tsx:16`), all raster, resolved via `MATERIAL_PATHS` → `public/creative-fixtures/pack-b/*.png`.

| Primitive component | Raster/CSS | Controls | Transform state (`PrimitiveTransforms`) |
|---|---|---|---|
| `AssetSurface` | Raster (arbitrary asset) | `asset`, `label`, `style` | No (caller-supplied inline transform only) |
| `PaperPlane` (renders `tornPaper`/`paperStrip` textures) | Raster + CSS clip-path | `color`, `rotation`, `material`, `primitiveTransform` | **Yes** |
| `Tape` | Pure CSS, no image | `color`, `rotation` | No — **unused by Cover/Info** (dead relative to the live variants, which use `MaterialTape` instead) |
| `MaterialTape` | Raster (`tape` image) | `color`, `rotation`, `primitiveTransform` | **Yes** |
| `GrainOverlay` | Pure CSS (radial gradients) | `color` | No |
| `Pin` | Raster (`pin` image) | `primitiveTransform` | **Yes** |
| `Botanical` | Raster (`botanical` image) | `primitiveTransform` | **Yes** |
| `NetworkLines` | Pure SVG | `color` | No |
| `SequenceMarker` | Pure CSS badge (`index/total`) | `index`, `total`, `color`, `ink` | No |
| `BrandMark` | Raster (logo) + text | `asset`, `tokens`, `palette` | No |

**Transform state** (`lib/creative/primitives/transforms.ts`): `PrimitiveTransforms { offsetX, offsetY, rotation, scale, opacity }` across exactly 5 slots (`paper`, `paperStrip`, `tape`, `botanical`, `pin`). This **is** driven by a real, working UI control (`PrimitiveTransformControls`, 5 range sliders, wired via `SET_PRIMITIVE_TRANSFORM`), reaches the render request (`derivePrimitiveTransformsRequest`), and is **shared unmodified by the video/timeline path** (`TemplateSegment.tsx`, `TimelineComposition.tsx` pass it straight through — one shared model, not a parallel one, confirmed against `PHASE_2D_A_PRIMITIVE_TRANSFORM_ROUNDTRIP.md`). It is real, pixel-effective, and cross-modality — but purely in-memory; **not persisted anywhere** (no DB column, no `LibraryFile` metadata field; explicitly documented in its own type comment as "NEVER serialised into a StaticRenderManifest directly").

**Primitive catalog / authorability:** only 2 of the 5 materials consumed by `primitives.tsx` (`paper-card-light-01`, `tape-kraft-short-01`) are registered in the discoverable catalog (`lib/creative/primitives/discovery.ts`) with a `library_file_ref`, and that catalog is hardcoded to a single project ref, `PORTAL_PROJECT_REF = 'project:portal-comunidades-alternativas'` — which happens to be exactly the real project this mission targets, but means primitive swapping is currently only possible for 2 of 5 materials, and only for this one project. `paper-strip-light-01`, `pin-brass-01`, `botanical-dried-sprig-01` are fixed, fallback-only, non-swappable materials today.

---

## 7. Pack B asset state

All 5 files `primitives.tsx` references are physically present in `public/creative-fixtures/pack-b/` and correctly listed in `infra/render-worker-runtime/export.mjs` (the immediately preceding mission's fix, `0ea6625`). `lib/creative/assets/resolve-asset.ts`'s `FIXTURE_ASSETS` map has two fixture *keys* still named after the old flat legacy files (`torn-paper-cream-01`, `tape-kraft-01`) but their **resolved paths** already point at the new `pack-b/*` files — a naming-only leftover, not a functional bug. The two literal legacy flat files (`public/creative-fixtures/torn-paper-cream-01.png`, `tape-kraft-01.png`) still physically exist, unreferenced by any live resolution path, except one test (`lib/creative/__tests__/static-render-path.test.ts`) that reads them directly by path — that test currently exercises dead assets, not the real resolution target.

**Dual sourcing confirmed:** the 2 catalog-registered materials are also mirrored as `LibraryFile` rows with a hardcoded S3 `storagePathMap` (`scripts/creative/render-authoring-request.ts`) under `Portal Comunidades Alternativas/assets/pack-b-staging/...` — used only when a user explicitly picks a primitive in the authoring UI. The static `public/` copies are the unconditional fallback when no selection is made. Both paths are exercised by different call sites in the same render request.

**The Pack B export fix (`0ea6625`) has zero effect on the static carousel path**, confirmed at the file level: the static render route bundles live from the repo's own `public/` directory on every invocation (`scripts/creative/render-authoring-request.ts`, `publicDir: path.join(repoRoot, 'public')`) and never touches `infra/render-worker-runtime/dist/`. The fix was scoped entirely to what gets copied into the separate, standalone video-worker export tree. One piece of documentation drift the fix left behind: `infra/render-worker-runtime/README.md` (§5, §9) still describes the pre-fix, obsolete flat-asset dependency list — not corrected by `0ea6625`, and not in scope to correct in this audit.

**Stale prior planning document — flagged, not corrected:** `docs/productization/creative-rendering/CAROUSEL_VISUAL_REENTRY_AND_ASSET_INTEGRATION.md` (committed `2b56b60`, 2026-09-22 18:39) declares as a "CRITICAL FINDING"/"IMPLEMENTATION BLOCKER" that Pack B's 18 raw material assets are "physically absent from the repository." Commit `135aa59` ("feat: integrate real carousel visual assets"), made **~77 minutes later the same day**, added exactly the 18-file staging tree (`docs/discovery/creative-rendering/visual-reference-pack/assets/pack-b-staging/`, confirmed present, 8 category subfolders) and promoted 5 of those 18 into production use. The document was never updated afterward and is now factually contradicted by the current repository state on its central premise. It also contains two more precise divergences worth flagging: its transform-slot list names only `paper`/`tape` (current code has 5 slots), and it conflates the legacy `torn-paper-cream-01`/`tape-kraft-01` filenames with the actual pack-b files the catalog uses. The next implementation mission should treat this document as historical/superseded on asset-availability claims, not authoritative.

---

## 8. Current AuthoringState

Real product path uses `createContextualAuthoringState` (`authoring-state.ts:105-117`), not the fixture-only `createInitialAuthoringState`.

| Field | Origin | Persisted? |
|---|---|---|
| `variant` | Hardcoded `'cover'` | No |
| `identity` | Hardcoded `'a'` | No |
| `canvas` | Derived from channel+format (one special case: `instagram:story` → 1080×1920; everything else, including carousel → 1080×1350) | No |
| `heroRef` | Undefined; no UI to select one on this page | No |
| `contentOverride` | Freshly derived every load from **current** ChannelPiece/EditorialContent DB rows, then user-edited in session | No — session edits lost on reload; only DB's current values reappear next time |
| `primitiveSelection` | `{}` unless a primitive catalog exists for the project, else hardcoded default `{paper, tape}` keys; user-edited | No |
| `primitiveTransforms` | All-default 5-slot state; user-edited via sliders | No |
| `productContext` | Fully derived (Project/Production/EditorialContent/ChannelPiece/Identity); by design never persisted | No (intentional) |
| `tuning` (PreviewTuning) | Fixed defaults | No (intentional, dev-only concept) |

**Direct answer:** reopening "Editar Visual" for the same ChannelPiece does **not** reconstruct a prior authored composition. There is no read-back path anywhere — every field is recomputed fresh from the current DB rows on every load. This matches the architecture freeze verbatim (§7, §12) and an earlier, more granular planning document, `PHASE_2F0_STATIC_OUTPUT_LIFECYCLE_ARCHITECTURE.md`, which independently reaches the same conclusion field-by-field — no divergence found there.

---

## 9. Persistence/reproducibility state

The **only** thing that persists from a static authoring session is the final rendered PNG, and only if the user explicitly clicks "Salvar nesta peça." That action is one atomic, orchestrated flow (`app/api/channel-piece-media/upload/route.ts`): S3 upload → `library_files` insert → `channel_piece_media` insert, with rollback on partial failure. Role assignment (`primary` vs `carousel_item`) is generic and automatic — the second saved media item on **any** ChannelPiece (regardless of its actual `format`) becomes `carousel_item`; this is pre-existing overflow-media logic, not carousel-slide-aware behavior.

`LibraryFile` has no metadata JSONB column today (unlike `Image`) to hold the recipe (primitive selection, transforms, content overrides, variant/canvas/identity choices) that produced a given PNG. Once saved, that recipe is unrecoverable — only the baked pixels remain. The render itself **does** use the actual in-session authored state (confirmed: `derivePrimitiveSelectionRequest`/`derivePrimitiveTransformsRequest` read live React state, and the server re-derives only the identity snapshot server-side for trust, not the content/primitive choices) — so authoring *works* correctly within a session; the gap is purely about what survives a reload.

A saved static PNG is **invisible to the Gallery** — `lib/gallery-output-library.ts` sources exclusively from `images` (AI-generation domain) and `render_executions`/`videoDrafts` (video domain); it never queries `library_files` or `channel_piece_media`.

---

## 10. ChannelPiece → Editar Visual trace

| Hop | Mechanism |
|---|---|
| Entry gate | `isStaticChannelPiece(channel, format)` — since `0ea6625`, channel-agnostic, excludes only `{reel, short, video_description}` by format. `carousel` is not excluded → routes into the static flow. |
| Route | `/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual` |
| Context fetch | `GET /api/creative/static-authoring-context` — validates ownership chain in app code, computes `target` via `staticAuthoringTarget`, exposes the primitive catalog only if the project's 2 hardcoded `library_files` IDs exist |
| Canvas derivation | Exactly two possible sizes: 1080×1920 for `instagram:story`, 1080×1350 for everything else (including carousel) — no format-specific carousel canvas branching exists |
| Template/variant selection | Hardcoded to DocumentaryCard `cover` — not derived from channel/format/content, and no UI exists to change it |
| Content seed | `contextualContentForChannelPiece` maps current `channelPiece`/`editorialContent` fields fresh on every load |

---

## 11. Static render/output trace

`deriveManifestFromState` always sets `sequence: {index: 1, total: 1}` in the real product path — no multi-slide manifest generation exists even structurally today. Render is synchronous (spawned child process, `scripts/creative/run-authoring-render.mjs`), returns a base64 PNG inline in the HTTP response, and persists nothing at that stage. Save is explicit/optional and, as covered in §9, atomically writes `LibraryFile` + `ChannelPieceMedia` together once triggered — there is no separate manual step between the two.

---

## 12. Current carousel limitations

Exhaustive repo-wide check confirms, precisely:

- `carousel` is **only** a `ChannelPiece.format` enum value, read by display-label maps and by the (non-excluding) static-eligibility check.
- `channel_piece_media.position` + `role='carousel_item'` **is** a real, production-deployed ordering mechanism — but it orders **attached files** generically for any ChannelPiece's second-and-later media item, regardless of format. It carries no authored composition (text, primitives, transforms) per ordered item — it is file-attachment ordering, not slide-authoring ordering.
- No multi-canvas type exists anywhere (`StaticRenderManifest`/`StaticAuthoringTarget` both model exactly one canvas).
- No render-all/batch action exists.
- No ZIP/grouped-export mechanism exists.
- `sequence.total` defaults to `10` only in the unused fixture/dev-tool code path (`authoring-state.ts`, non-product branch) — an inert, pre-existing "total:10" convention that nothing in the real product path currently reads or acts on.

---

## 13. Pack A / Pack B reference evidence

- **Pack A** (`"docs/discovery/creative-rendering/visual-reference-pack/pack a/"`, and its already-tracked byte-identical duplicate `pack-a/`): 10 full-page screenshots, `001.png`–`010.png`, one per slide — confirms all 10 slides exist with real text/imagery. Visual inspection (§4, §5 above) shows at least 5 distinct content layouts across the sampled 6 slides.
- **Pack B** (`"...pack b/"` / `pack-b/`): only 2 screenshots (`01.png`, `02.png`) — confirms only the first two slides are materially explored in the Pack B collage direction. Slide 1 matches Pack A's structure closely, rendered with paper/tape/torn-paper/botanical collage treatment; slide 2 matches Pack A's structure closely (light/cream), also with collage treatment.
- **`assets/pack-b-staging/`**: 18 raw material swatch files across 8 categories (archival, botanicals, frames, ornaments, papers, pins, references, tapes) — the broader candidate material palette, of which only 5 were promoted into `public/creative-fixtures/pack-b/` and only 2 of those 5 are catalog-registered/selectable.
- No manifest anywhere ties any of these reference images to code. No slide-number-to-authoring-input binding exists. The closest thing to a "real Portal fixture" (`PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json`) is a single-card "Terra Una" fixture for a **different** conceptual project, explicitly marked `not_a_database_record` / `source_verification_required_before_publication`. The one live end-to-end static-render proof on record (`PHASE_1C_REAL_PORTAL_STATIC_RENDER.md`) ran against a **different real project** (`Alquimia Cibernética`), explicitly calling its output "a canonical control, not a real Portal output." **No canonical, live, end-to-end "Portal Comunidades Alternativas" render exists today.**
- Two duplicate untracked directories (`"pack a"`, `"pack b"`, with spaces) are byte-identical to already git-tracked `pack-a`/`pack-b` (hyphenated). Flagged per instructions; left untouched.

---

## 14. KEEP / FORMALIZE / FIX NOW / LATER

| Finding | Bucket | Why |
|---|---|---|
| Cover/Info as a registry-driven, typed, validated variant mechanism | **KEEP** | Real, working, reusable structure; no evidence it needs to be replaced, only extended |
| CoverVariant's content slots (eyebrow/title/subtitle/hero/source_line/detail_note) | **KEEP** | Directly proven against real Pack A/B slide 1 |
| Shared `PrimitiveTransforms` model (5 slots, real UI, shared static+video) | **KEEP** | Working, pixel-effective, already correctly unified across modalities — architecture freeze's "no parallel systems" principle already honored here |
| Synchronous, in-session-state-driven static render (uses live authored values, not re-derived defaults) | **KEEP** | Render fidelity within a session is already correct; the gap is reload, not render |
| Explicit, optional, atomic LibraryFile+ChannelPieceMedia save on "Salvar nesta peça" | **KEEP** | Matches architecture freeze's explicit-approval-boundary principle |
| Light/dark as an explicit, per-slide-settable input (rather than implied by variant) | **FORMALIZE** | Already needed by the real reference material (slide 5 is dark despite being non-cover); currently only an implicit side effect |
| `sequence.index/total` as a real, populated field (rather than always `{1,1}`) | **FORMALIZE** | The display mechanism (`SequenceMarker`) already exists and works; it simply is never fed real values in the product path |
| `channel_piece_media.position`/ordering as the slide-ordering seam for carousel | **FORMALIZE** | An ordering primitive already exists in production; whether to reuse it for slide order (vs. inventing a new ordering field) is exactly the kind of decision the architecture freeze defers to evidence — this audit surfaces the seam, not the choice |
| DocumentaryCard `cover` variant's unconditional dark-palette override | **FIX NOW** | Directly blocks reproducing any light-cover or light-dependent-on-identity slide; currently structurally impossible without touching this |
| InfoVariant's single fixed content shape (no icon-list, no icon-grid, no side-image slot) | **FIX NOW** | Directly blocks 4 of the 6 sampled real Pack A slides from being authored at all today |
| Static AuthoringState persistence (nothing survives reload) | **FIX NOW** | Explicitly named by the architecture freeze as the primary current reproducibility gap; a 10-slide carousel without this means re-authoring from scratch every session, for every slide |
| No ordered multi-canvas/multi-output contract for one ChannelPiece | **FIX NOW** | Structurally required for "one ChannelPiece → 10 rendered PNGs" — currently the manifest model caps at exactly one canvas |
| Primitive catalog hardcoded to 2 of 5 materials, 1 hardcoded project ref | **LATER** | Works for this exact real use case (Portal Comunidades Alternativas) today; generalizing the catalog is explicitly a NEXT/LATER concern per the architecture freeze, not a Carousel V1 blocker |
| DocumentaryCard hardcoded in the video adapter | **LATER** | Confirmed proof-era coupling; architecture freeze already classifies this as a known gap unrelated to the static carousel slice |
| Stale `CAROUSEL_VISUAL_REENTRY_AND_ASSET_INTEGRATION.md` / `README.md` asset-list drift | **LATER** | Documentation-only drift; does not block implementation, but should not be relied upon as current |
| Duplicate `pack a`/`pack b` (space) vs `pack-a`/`pack-b` (hyphen) directories | **LATER** | Cosmetic/organizational; explicitly out of scope for this and the prior mission |

---

## 15. Minimum Carousel V1 implementation seam (RECOMMENDATION — not current fact)

Everything in this section is a recommendation for the next implementation mission to evaluate, not a decision made by this audit.

- Extend the manifest/authoring model from "one canvas" to "one ordered collection of canvases" scoped to a single ChannelPiece, reusing `sequence.index/total` (already real) to drive the count instead of hardcoding `{1,1}`.
- Give each slide in that collection its own minimal authored-state record (content override, primitive selection, primitive transforms, and an explicit light/dark input) — this is the same shape `AuthoringState` already computes per single card today, just repeated per slide index, not a new kind of state.
- Decide whether `channel_piece_media.position`/`role` (the existing generic media-ordering primitive) is reused to persist slide order and outputs, or whether a narrower, carousel-specific persistence seam is warranted — the evidence in §12 shows the existing mechanism is generic-but-present, which is exactly the kind of reuse-vs-new-seam tradeoff the architecture freeze's hybrid/template-constrained strategy calls for evaluating against real need.
- Decouple `isDark`/palette selection from `variant` in `DocumentaryCard.tsx`/`CoverVariant.tsx`, making it a value that can be set per authored slide (matching real evidence that slide 5, a non-cover, is dark).
- Extend `InfoVariant`'s content schema (or add a bounded number of new structural variants) only to the extent proven necessary by the real slides — the icon-list (slides 3, 5) and icon-grid (slide 6) shapes are the concretely evidenced gaps; a closing/CTA shape (slide 10) is a third.

---

## 16. Risks / guardrails

- Any persistence design must not introduce a `ContentVersion`, unified `Output` table, or `Clip` entity — the architecture freeze and this mission's non-goals explicitly forbid these.
- Extending `InfoVariant`/adding variants should be driven by the concretely observed Pack A layouts (§4), not by anticipating hypothetical future formats — the anti-overengineering rule applies directly here.
- Decoupling light/dark from `variant` touches `DocumentaryCard.tsx`/`CoverVariant.tsx`/`primitives.tsx` — code also used by the video path (`remotion/DocumentaryCardComposition.tsx`, the hardcoded video adapter). Any change here needs to verify it doesn't silently alter the video proof-composition's current (already-flagged-as-proof-era) appearance.
- The primitive catalog's hardcoded `PORTAL_PROJECT_REF` scoping is convenient for this exact use case but should not be mistaken for a generalized mechanism — it isn't one yet, and generalizing it is explicitly NEXT/LATER.
- `CAROUSEL_VISUAL_REENTRY_AND_ASSET_INTEGRATION.md` should not be used as a source of current asset-availability facts without re-verification against this document and current code — it is materially stale on that specific point.

---

## 17. Exact recommended next implementation slice

RECOMMENDATION only:

1. Design (not yet implement) the minimum persisted per-slide authored-state contract for one ChannelPiece with `format = 'carousel'` — scoped to exactly the fields already computed per single card today (content override, primitive selection, primitive transforms, light/dark), repeated per slide.
2. Decide the ordering/storage seam (reuse `channel_piece_media.position`/`role`, or a narrower new mechanism) using the evidence in §12 as the deciding input, not a fresh design.
3. Decouple the `cover` variant's dark-palette override so light/dark becomes settable per slide, validated against real slide 1 (dark) and slide 2 (light) as the acceptance evidence.
4. Extend `InfoVariant` (or add the minimum number of new registry variants) only far enough to cover the icon-list (slides 3/5), icon-grid (slide 6), and closing-CTA (slide 10) shapes actually observed in Pack A — validated slide-by-slide against the real reference images, not against a generalized content model.
5. Implement the render-all/multi-output path for the resulting ordered collection, reusing the existing synchronous per-card render mechanism per slide rather than inventing a new render execution model (no static `RenderExecution` merely for symmetry, per the architecture freeze's explicit non-goal).
6. Defer: primitive-catalog generalization beyond the 2 already-registered materials, any video-adapter change, any Gallery/Library redesign, and any documentation-tree correction — none are required to ship the real 10-slide carousel.

---

*Produced by read-only factual audit against `main` @ `0ea6625`. Supersedes `CAROUSEL_VISUAL_REENTRY_AND_ASSET_INTEGRATION.md` as the current factual reference for Pack B asset state and authoring-control inventory; that document should be treated as historical context only from this point forward.*
