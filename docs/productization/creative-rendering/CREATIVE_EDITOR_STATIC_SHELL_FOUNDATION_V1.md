# Creative Editor — Static/Carousel Shell Foundation V1

**Status:** implemented on `main` from checkpoint `f39b086`. One acceptance item (§13, the `Gerar PNG` 500) has a confirmed root cause and a concrete follow-up path, but is **not resolved** in this slice — see that section for why, and why fixing it is correctly out of scope here.

Scope: rebrand and reshape the static authoring surface into "Creative Editor" (Canvas-first shell, zoom, slide strip, progressive-disclosure tool sections, active-element Inspector), extend persistence to cover template-sanctioned title/hero positioning, replace always-on autosave with an explicit-Save model (autosave optional, default off), add Revert/Restore Default, fix a real material-overlay clipping bug, and fix a real (but not root-cause) content-validation bug. Slides 3–10, Video, and a generic layers engine remain untouched, per the mission's non-goals.

## 1. Creative Editor naming

- User-facing surface renamed "Editar visual" → "Creative Editor" (page `<h1>`), with contextual mode info directly beneath it: `Static` badge, `channel:format`, and — for carousels — `Slide N de M`.
- ChannelPiece card action renamed "Editar visual" → "Abrir no Creative Editor" (`app/(dashboard)/.../conteudos/[editorialContentId]/page.tsx`). The route path (`.../editar-visual`) and every internal domain type/function name are unchanged — this was a branding change only, not a domain rename.

## 2. Static shell anatomy (this slice) / future Video-shell relationship

Implemented hierarchy, matching the mission's locked grammar:

```
PREVIEW / CANVAS (zoom controls attached directly below it)
SLIDE STRIP  [Slide 1] [Slide 2]        (carousel only)
TABS: Template | Content | Assets | Style | Element
  → compact contextual panel directly below the tabs, same viewport
```

Everything lives in one narrow (`max-w-4xl`) vertical column so Preview, slide strip, and controls are never more than a short scroll apart — satisfying the "no long-page authoring" addendum. Project/Production context, previously a permanent third column, is now a one-line header (`project · production`) plus a collapsible `<details>` block for EditorialContent/ChannelPiece/Identity detail that most edits never need open.

This is the **Static** instance only. The Video/Timeline shell (Player, Scene strip, Motion/Timing sections) was not built — the mission's non-goals explicitly exclude it — but the same grammar (Preview→strip→tabs, zoom-around-the-viewport, active-element Inspector) is intended to carry over there per the mission's own framing; nothing here couples the shell markup to StaticRenderManifest in a way that would block that later.

## 3. Actual logical canvas dimensions / Preview Surface behavior

Verified against the existing, unchanged source of truth: `staticAuthoringTarget()` (`lib/creative/context/static-authoring.ts`) returns `1080×1350` (4:5) for `instagram:carousel` — confirmed factually, not re-hardcoded; the page reads `context.target.canvas.width/height` directly.

Preview Surface: a `ResizeObserver` measures the available container width; `fitScale = min(containerWidth / canvasWidth, 1)`. The canvas div is always rendered at its true `canvasWidth × canvasHeight` and scaled via CSS `transform: scale()` — the DOM node Remotion-equivalent markup renders at is always the real target size, only its on-screen presentation scales, so the preview stays representative of the final PNG. `Fit` (default) always shows the whole 4:5 frame with no horizontal scroll; explicit zoom levels beyond the container width scroll within the bounded preview box (`overflow:auto`, `max-height:62vh`), never the page.

## 4. Slide strip

Replaced the previous/next-only navigation with `[Slide 1] [Slide 2]` buttons (clear active state via `variant="default"` vs `"outline"`) plus prev/next as secondary affordances on either side. **`[+]` was deliberately not implemented** — the mission explicitly said not to show a fake control, and adding a real one requires deciding how a newly-inserted slide's default content/order should be chosen relative to existing slides, which is Slide 3–10 territory (out of scope). Deferred explicitly, not silently.

## 5. Tool-section mapping

| Tab | Real current capability mapped |
|---|---|
| Template | Cover/Info structural selection (existing `SET_VARIANT`, now actually reachable) |
| Content | Title + (Subtitle or Intro/Body depending on variant) — existing content editing, unchanged fields |
| Assets | Paper/Tape primitive pickers (moved here from the old single "Authoring" panel); a factual note that Hero has no image picker in this version (there never was one — not newly removed) |
| Style | Light/Dark appearance toggle (existing) |
| Element | The active-element selector + contextual Inspector (see §6) |

No empty/fake sections were added — each tab maps to something that already existed in Slice 1, just regrouped.

## 6. Active-element / Inspector model

Previously all 5 primitive transform groups (paper, paperStrip, tape, botanical, pin) rendered simultaneously. Now: a single `Element` selector (chip buttons — `Título`, `Hero` [cover only], `Paper`, `Faixa do título`, `Fita`, `Pin`, `Botânica`) drives one Inspector panel showing only that element's controls. Title/Hero get `TitleTuningControls`/`HeroTuningControls` (X/Y [+rotation/scale for Hero]); the 5 primitive slots reuse the existing `PrimitiveTransformControls` unchanged. This reuses the existing reducer actions (`SET_PRIMITIVE_TRANSFORM`, `SET_TUNING`) — no parallel transform system, no generic Layers engine.

## 7. Template-sanctioned text/hero position boundary

**New capability, extending the persisted contract.** Human smoke found text/content blocks couldn't be repositioned at all. Investigation found the plumbing already existed and was simply unwired and never persisted: `DocumentaryCardPreviewTuning` (`hero: {offsetX,offsetY,rotation,scale}`, `title: {offsetX,offsetY,rotation}`) was already a real `AuthoringState.tuning` field, already consumed by `CoverVariant.tsx`, and already had a render-request channel (`authoringRenderOverridesSchema` → `overrides.documentaryCard`) reaching the actual PNG renderer — but the product page never sent it with a render request, never showed it in the live preview, and it was hardcoded to `DEFAULT_TUNING` on every load (Slice 1's own type comment said "NEVER persisted").

This slice:
- Added `tuning` (optional, for backward compatibility with rows persisted before it existed) to `PersistedAuthoredSlideSchema`, with the exact same bounds as the existing `TUNING_BOUNDS` (hero offset ±120px/±4°/0.9–1.15×, title offset ±60px/±2°) — a persisted value can never be more than the UI could have produced.
- Added `deriveTuningOverrides(state)` (mirrors `derivePrimitiveTransformsRequest`'s "absence means default" pattern) and wired it into the render request's `overrides` field.
- Wired `state.tuning` into the live preview (`documentaryCardPropsFromResolvedInput`'s 4th argument), which the page previously never passed — meaning position refinement was invisible in preview before this slice, independent of the persistence gap.
- Extended `InfoVariant.tsx` with the identical title-tuning read `CoverVariant.tsx` already had (previously Info's title had no tuning support at all) — same shape, same bounds, no new mechanism, for parity between the two variants.
- Hero position is Cover-only (Info has no hero asset) — matches the mission's "if current architecture supports them" scoping.

Rows persisted before this slice (confirmed: the real Portal ChannelPiece's row) have no `tuning` key; `persistedSlideToAuthoringState` defaults it to `DEFAULT_TUNING` — no migration, no backfill, exactly the existing rendering.

## 8. Explicit Save — previous vs. new behavior

**Factual previous behavior (Slice 1):** every dispatch to the carousel's `slides` array triggered a 600ms-debounced `PUT` automatically, with no manual save action, no dirty indicator, and no way to discard an in-progress edit short of reloading and losing it. This was confirmed by re-reading Slice 1's own `page.tsx` before this mission's edits.

**New behavior:** `dirty` is a derived value (`persistedSnapshot(slides) !== lastSavedSnapshot`, computed inline, not stored — avoids a setState-in-effect render cascade). A `[Salvar]` button is enabled only when dirty (or after a failed save), and calls the same `PUT /api/creative/static-authoring-state` explicitly. Status is shown in the header: `Alterações não salvas` / `Salvando…` / `Salvo` / `Ainda não salvo` (nothing saved yet) / `Falha ao salvar`.

## 9. Autosave — behavior and default

Autosave is now an explicit `Auto-save` checkbox next to the slide strip, **default OFF** (read from `localStorage` key `creative-editor:autosave-enabled` via a lazy `useState` initializer — no database migration, no existing app-wide preference mechanism was found to reuse, so a local/browser preference is used exactly as the mission allowed). When ON, it reuses the exact same 600ms-debounced `PUT` and the same `saveNow()` explicit-Save calls — one code path, two triggers. When OFF, edits stay local/dirty until the user clicks Save.

## 10. Revert / Restore Default semantics

Two distinct actions, not one "Reset":
- **Reverter** (`Undo2` icon): restores the current in-memory slides to `lastSavedSnapshot` (the last successful Save/load). Disabled when not dirty or when nothing has ever been saved.
- **Restaurar padrão** (`RotateCcw` icon): overwrites only the *current* slide with the Slice 1 template default matching its position (cover/dark for order 0, info/light for order 1), gated behind a `window.confirm` since it's destructive to that slide's in-memory state. It does not touch the DB until the user subsequently saves.
- Per-element **Reset** (inside the Inspector) remains a third, local, non-destructive action, unchanged from Slice 1, correctly left distinct from the two above.

## 11. Material overlay clipping — root cause and fix

**Root cause, confirmed by code inspection:** `MaterialTape`/`Pin` were rendered as *children* of the hero/fact-card `PaperPlane` div, which carries a `clip-path` (the card's own torn-paper silhouette). CSS `clip-path` clips a container's descendants to that path — any authored offset moving Tape/Pin past the card's own box was silently cut, because it was geometrically still "inside" the clipping parent's stacking context.

**Fix:** in both `CoverVariant.tsx` (hero) and `InfoVariant.tsx` (fact cards), `MaterialTape`/`Pin` are now siblings of the card's `PaperPlane`, inside a plain wrapper `div` that occupies exactly the box the `PaperPlane` used to occupy (so every existing coordinate, authored relative to that box, is byte-for-byte unchanged). `PaperPlane` now fills that wrapper via `inset:0` and keeps its own clip-path/background; Tape/Pin sit beside it, free to cross the card's edge. The canvas root (`DocumentaryCard`'s own `overflow:hidden`) remains the only clip that still applies — matching the mission's required semantics exactly (internal boundaries crossable, final output boundary still clips). Verified both by a local render with an extreme tape offset (visually confirmed escaping the card, floating on the dark background) and by two new regression tests asserting Tape/Pin's markup appears strictly after the card's own closing tag, not nested inside it.

## 12. Render 500 — root cause and fix status

**Verified, not the root cause for the real carousel:** the mission's suspected cause (`contextualContentForChannelPiece` producing `detail_note: ''` when `cta` is null, which `DocumentaryCardCoverContentSchema`'s `min(1)`-when-present rule rejects) is real and was fixed (now omits the key entirely when there's no CTA) — but it does not explain the carousel's 500, because the carousel path never calls that function; it uses persisted/default content, which already has a non-empty `detail_note`. Confirmed directly: the real Portal ChannelPiece's persisted slide 1 has `detail_note: "Edição apresentada: Nova Cultural / Brasiliense, 1985."`, and re-running that exact content locally produces a correct render. Fixed anyway, since it's a real bug for any non-carousel static piece with `cta IS NULL`.

**Actual root cause, confirmed by Remotion's own official documentation** (`remotion.dev/docs/miscellaneous/vercel-functions`, `.../nextjs`): *"It is currently not possible to render videos or stills on Vercel Serverless functions due to the 50MB maximum function size. Since Chromium is a dependency of Remotion, it alone almost entirely fills the quota available."* `/api/creative/static-authoring/render` spawns a child process that bundles the Remotion composition and launches a full headless Chromium — a mechanism the render script's own return type already labels `bridge: 'local-dev-only'`. This was never adapted for Vercel serverless; an unauthenticated `curl` against the deployed route confirmed the route itself loads and authenticates correctly (`401 Nao autorizado`), narrowing the failure to the render step specifically, consistent with this diagnosis.

**Correct fix (per user confirmation): route static rendering through the existing VPS render worker** (`infra/render-worker-runtime/`) already proven end-to-end for video — not a new AWS Lambda buildout. That worker currently exposes an HTTP `/render` endpoint (`server.mjs`) hardcoded to `renderMedia`/video, reached only by its own on-VPS coordinator polling `render_executions` (Vercel never calls the worker directly; the worker pulls via `POST /api/render-executions/claim` with a shared secret). Making static rendering work the same way requires: a queue-based async path for static jobs (extending `render_executions` or a sibling queue to carry a `StaticRenderManifest` target instead of only `video_draft_id`), worker-side `renderStill` support alongside the existing `renderMedia` path, and a frontend change from the current synchronous "click → inline PNG" UX to the async "queued → poll → ready" UX the video pipeline already uses. This is a genuine, bounded, and clearly-scoped follow-up — architecturally identical in shape to the video pipeline's own multi-phase build-out — but it is not a same-session bugfix, and was correctly not attempted here.

**What was done regardless:** §13 (render UI states) ensures whatever the real failure is, the user now sees the actual server error message instead of a silent 500, and can retry — real, independent value whether or not the deeper infra fix has landed yet.

## 13. Render feedback / UX

`Ready` / `Rendering…` / `Success` / `Failure` are now explicit and visible directly under the Preview (not buried in a separate panel): a spinner while rendering, a destructive-styled error message with `AlertCircle` on failure (the route's own `error.message` — never a raw stack trace, since the route only ever sends `.message`), and a small result block with duration + a `Salvar nesta peça` action on success. The three boundaries are kept structurally distinct exactly as required: `render()` (PNG generation only) → `saveRenderOutput()` (PNG → LibraryFile/ChannelPieceMedia, lazy-imported and independent) → `saveNow()` (authoring state persistence, a completely separate endpoint). Retrying is just clicking `Gerar PNG` again — no additional state to reset.

## 14. Tests / typecheck / lint / build

- New: 2 clipping regression tests (`documentary-card.test.ts`, DOM-nesting assertions via markup index comparison for both Cover's hero and Info's fact card), 1 `detail_note`-omission test (`static-authoring-context.test.ts`), 3 tuning-persistence tests (round-trip, legacy-row default, out-of-bounds rejection — `carousel-state.test.ts`), 2 `deriveTuningOverrides` tests (`authoring-state.test.ts`).
- `pnpm typecheck` — clean.
- `pnpm exec eslint` on every changed file — clean, 0 errors/0 warnings (two pre-existing, unrelated `react-hooks/set-state-in-effect` warnings remain in `conteudos/[editorialContentId]/page.tsx`, a file this mission touched only for a one-line label rename; left as-is per "do not fix unrelated failures").
- Full suite: `pnpm test` — **863/863 passed** (855 from the prior checkpoint + 8 new).
- `pnpm build` (full Next.js production build) — succeeded cleanly, including the rewritten route and the new `page.tsx`.

## 15. Files changed

Modified: `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` (label only), `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx` (full shell rewrite), `components/creative/authoring/primitive-controls.tsx` (+TitleTuningControls/HeroTuningControls), `components/creative/documentary-card/{CoverVariant.tsx,InfoVariant.tsx}` (clipping fix + Info title tuning), `lib/creative/authoring/{authoring-state.ts,carousel-state.ts,types.ts,index.ts}` (tuning persistence + `deriveTuningOverrides`), `lib/creative/context/static-authoring.ts` (`detail_note` fix), `lib/creative/__tests__/{documentary-card.test.ts,authoring-state.test.ts,static-authoring-context.test.ts}`, `lib/creative/authoring/__tests__/carousel-state.test.ts`.

No migration was required — `tuning` is an optional JSON field within the existing `slides` JSONB column.

## 16. Remaining bounded work before slides 3–10

- Route static rendering through the VPS worker (§12) — the one real blocker to `Gerar PNG` succeeding in production; concretely scoped above, not vague.
- Slide `[+]` add action (§4) — deferred, needs a decision on new-slide default content/position.
- Hero image picker (Assets tab) — never existed; noted, not newly introduced as a gap.
- Info `fact_cards` editing in the Content tab — still not exposed (same gap Slice 1 had).
- Icon-list / icon-grid / closing-CTA structural variants, drag-reorder, render-all, ZIP export — unchanged non-goals, per the factual re-entry audit.
